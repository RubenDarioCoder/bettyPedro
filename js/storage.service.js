

const StorageService = (function () {
    "use strict";

    // ------------------------------------------------------------
    // Claves de almacenamiento (se mantienen idénticas a versiones
    // anteriores para no perder datos ya guardados por los usuarios).
    // ------------------------------------------------------------
    const KEYS = Object.freeze({
        PRODUCTOS: "almacen_v5_productos",
        RUBROS: "almacen_v5_rubros",
        VENTAS: "almacen_historial_ventas",
        FIADOS: "almacen_registros",
        PROVEEDORES: "almacen_proveedores",
        TEMA: "almacen_tema",
    });

    const RUBROS_INICIALES = ["ALMACÉN", "BEBIDAS", "FIAMBRES"];

    const DESGLOSE_PAGO_VACIO = Object.freeze({
        EFECTIVO: 0,
        DEBITO: 0,
        CREDITO: 0,
        TRANSFERENCIA: 0,
        FIADO: 0,
    });

    // ------------------------------------------------------------
    // Lectura / escritura genérica con manejo de errores
    // ------------------------------------------------------------

    /**
     * Lee y parsea una clave de localStorage. Si no existe o el JSON
     * está corrupto, devuelve `valorPorDefecto` sin lanzar excepciones.
     * @param {string} clave
     * @param {*} valorPorDefecto
     * @returns {*}
     */
    function leer(clave, valorPorDefecto) {
        try {
            const crudo = localStorage.getItem(clave);
            if (crudo === null) return valorPorDefecto;
            const parseado = JSON.parse(crudo);
            return parseado === null || parseado === undefined ? valorPorDefecto : parseado;
        } catch (error) {
            console.error(`StorageService: no se pudo leer "${clave}". Se usan valores por defecto.`, error);
            return valorPorDefecto;
        }
    }

    /**
     * Serializa y guarda un valor en localStorage.
     * @param {string} clave
     * @param {*} valor
     * @returns {boolean} true si se guardó correctamente
     */
    function escribir(clave, valor) {
        try {
            localStorage.setItem(clave, JSON.stringify(valor));
            return true;
        } catch (error) {
            console.error(`StorageService: no se pudo guardar "${clave}".`, error);
            return false;
        }
    }

    // ------------------------------------------------------------
    // Sanitización de modelos de datos
    // ------------------------------------------------------------

    /**
     * Normaliza un registro de producto, garantizando todos los campos
     * numéricos y de texto requeridos por el resto de la aplicación.
     * @param {object} producto
     * @returns {object}
     */
    function sanitizarProducto(producto) {
        const p = producto && typeof producto === "object" ? producto : {};
        return {
            nombre: typeof p.nombre === "string" ? p.nombre : "",
            descripcion: typeof p.descripcion === "string" ? p.descripcion : "",
            rubro: typeof p.rubro === "string" && p.rubro.trim() ? p.rubro : "ALMACÉN",
            costo: Helpers.aNumero(p.costo, 0),
            porcentaje: Helpers.aNumero(p.porcentaje, 0),
            precioVenta: Helpers.aNumero(p.precioVenta, 0),
            stock: Helpers.aEntero(p.stock, 0),
            limiteStock: Helpers.aEntero(p.limiteStock, 3),
        };
    }

    /**
     * Normaliza el diccionario completo de productos (clave = código de
     * barras / SKU). Descarta entradas sin código válido.
     * @param {object} db
     * @returns {object}
     */
    function sanitizarProductosDB(db) {
        const limpio = {};
        if (db && typeof db === "object") {
            Object.keys(db).forEach((codigo) => {
                if (!codigo) return;
                limpio[String(codigo)] = sanitizarProducto(db[codigo]);
            });
        }
        return limpio;
    }

    /**
     * Normaliza la lista de rubros disponibles, eliminando duplicados
     * y valores vacíos.
     * @param {Array} rubros
     * @returns {string[]}
     */
    function sanitizarRubros(rubros) {
        const base = Array.isArray(rubros) ? rubros : [];
        const limpio = base
            .map((r) => (typeof r === "string" ? r.trim().toUpperCase() : ""))
            .filter((r) => r.length > 0);
        return Array.from(new Set(limpio.length ? limpio : RUBROS_INICIALES));
    }

    /**
     * Normaliza un ítem individual dentro del ticket de una venta.
     * @param {object} item
     * @returns {object}
     */
    function sanitizarItemVenta(item) {
        const i = item && typeof item === "object" ? item : {};
        return {
            codigo: i.codigo !== undefined && i.codigo !== null ? String(i.codigo) : "",
            nombre: typeof i.nombre === "string" ? i.nombre : "",
            rubro: typeof i.rubro === "string" ? i.rubro : "ALMACÉN",
            costo: Helpers.aNumero(i.costo, 0),
            precio: Helpers.aNumero(i.precio, 0),
            cantidad: Helpers.aEntero(i.cantidad, 0),
        };
    }

    /**
     * Normaliza un registro de venta del historial. Si el registro es
     * inválido (no es un objeto), devuelve `null` para que el llamador
     * lo descarte.
     *
     * IMPORTANTE — compatibilidad con registros antiguos: las ventas
     * creadas antes de incorporar el cobro combinado no tienen el
     * campo `desglosePago`. Para que el cálculo de efectivo en caja
     * siga siendo correcto sobre ese historial, se reconstruye el
     * desglose a partir de `metodoPago` + `total` cuando el campo no
     * existe (ej: una venta vieja "EFECTIVO" por $100 se reconstruye
     * como `{ EFECTIVO: 100, ... resto en 0 }`).
     *
     * @param {object} venta
     * @returns {object|null}
     */
    function sanitizarVenta(venta) {
        if (!venta || typeof venta !== "object") return null;

        const metodoPago = typeof venta.metodoPago === "string" && venta.metodoPago ? venta.metodoPago : "EFECTIVO";
        const total = Helpers.aNumero(venta.total, 0);

        let origenDesglose = venta.desglosePago;
        if (!origenDesglose || typeof origenDesglose !== "object") {
            origenDesglose = {};
            if (Object.prototype.hasOwnProperty.call(DESGLOSE_PAGO_VACIO, metodoPago)) {
                origenDesglose[metodoPago] = total;
            }
        }
        const desglose = Object.assign({}, DESGLOSE_PAGO_VACIO, origenDesglose);
        Object.keys(desglose).forEach((clave) => (desglose[clave] = Helpers.aNumero(desglose[clave], 0)));

        return {
            id: venta.id || Helpers.generarId("TK"),
            fechaIso: typeof venta.fechaIso === "string" ? venta.fechaIso : new Date().toISOString(),
            fechaFormateada: typeof venta.fechaFormateada === "string" ? venta.fechaFormateada : "",
            cliente: typeof venta.cliente === "string" && venta.cliente.trim() ? venta.cliente : "Mostrador",
            metodoPago,
            total,
            productos: Array.isArray(venta.productos) ? venta.productos.map(sanitizarItemVenta) : [],
            desglosePago: desglose,
            vueltoEntregado: Helpers.aNumero(venta.vueltoEntregado, 0),
        };
    }

    /**
     * Normaliza un registro de cuenta corriente (fiado).
     * @param {object} registro
     * @returns {object|null}
     */
    function sanitizarFiado(registro) {
        if (!registro || typeof registro !== "object") return null;
        return {
            id: registro.id || Helpers.generarId("FD"),
            nombre: typeof registro.nombre === "string" ? registro.nombre : "",
            monto: Helpers.aNumero(registro.monto, 0),
            tipo: registro.tipo === "PAGO" ? "PAGO" : "DEUDA",
            fechaHora: typeof registro.fechaHora === "string" ? registro.fechaHora : "",
        };
    }

    /**
     * Normaliza un registro de pago/gasto a proveedor.
     * @param {object} registro
     * @returns {object|null}
     */
    function sanitizarProveedor(registro) {
        if (!registro || typeof registro !== "object") return null;
        return {
            id: registro.id || Helpers.generarId("PROV"),
            nombre: typeof registro.nombre === "string" ? registro.nombre : "",
            monto: Helpers.aNumero(registro.monto, 0),
            detalle: typeof registro.detalle === "string" && registro.detalle ? registro.detalle : "Gasto",
            fecha: typeof registro.fecha === "string" ? registro.fecha : "",
        };
    }

    // ------------------------------------------------------------
    // API: Productos y Rubros
    // ------------------------------------------------------------

    /**
     * Devuelve el catálogo de productos almacenado, sanitizado.
     * Devuelve `null` si nunca se inicializó (primera ejecución).
     * @returns {object|null}
     */
    function cargarProductos() {
        const crudo = leer(KEYS.PRODUCTOS, null);
        if (crudo === null) return null;
        return sanitizarProductosDB(crudo);
    }

    /** Persiste el catálogo de productos. */
    function guardarProductos(productosDB) {
        return escribir(KEYS.PRODUCTOS, productosDB);
    }

    /** Devuelve la lista de rubros disponibles, sanitizada. */
    function cargarRubros() {
        return sanitizarRubros(leer(KEYS.RUBROS, RUBROS_INICIALES));
    }

    /** Persiste la lista de rubros disponibles. */
    function guardarRubros(rubros) {
        return escribir(KEYS.RUBROS, sanitizarRubros(rubros));
    }

    // ------------------------------------------------------------
    // API: Historial de ventas
    // ------------------------------------------------------------

    /** Devuelve el historial completo de ventas, sanitizado. */
    function cargarVentas() {
        const crudo = leer(KEYS.VENTAS, []);
        return Array.isArray(crudo) ? crudo.map(sanitizarVenta).filter(Boolean) : [];
    }

    /** Persiste el historial completo de ventas. */
    function guardarVentas(ventas) {
        return escribir(KEYS.VENTAS, ventas);
    }

    // ------------------------------------------------------------
    // API: Fiados
    // ------------------------------------------------------------

    /** Devuelve los registros de cuentas corrientes (fiados), sanitizados. */
    function cargarFiados() {
        const crudo = leer(KEYS.FIADOS, []);
        return Array.isArray(crudo) ? crudo.map(sanitizarFiado).filter(Boolean) : [];
    }

    /** Persiste los registros de cuentas corrientes (fiados). */
    function guardarFiados(registros) {
        return escribir(KEYS.FIADOS, registros);
    }

    // ------------------------------------------------------------
    // API: Proveedores
    // ------------------------------------------------------------

    /** Devuelve los registros de pagos a proveedores, sanitizados. */
    function cargarProveedores() {
        const crudo = leer(KEYS.PROVEEDORES, []);
        return Array.isArray(crudo) ? crudo.map(sanitizarProveedor).filter(Boolean) : [];
    }

    /** Persiste los registros de pagos a proveedores. */
    function guardarProveedores(registros) {
        return escribir(KEYS.PROVEEDORES, registros);
    }

    // ------------------------------------------------------------
    // API: Tema (claro / oscuro)
    // ------------------------------------------------------------

    /** Devuelve el tema guardado ("light" | "dark") o `null` si no hay preferencia. */
    function cargarTema() {
        const tema = leer(KEYS.TEMA, null);
        return tema === "dark" || tema === "light" ? tema : null;
    }

    /** Persiste la preferencia de tema del usuario. */
    function guardarTema(tema) {
        return escribir(KEYS.TEMA, tema === "dark" ? "dark" : "light");
    }

    // ------------------------------------------------------------
    // Inicialización / siembra de datos de referencia
    // ------------------------------------------------------------

    /**
     * Inicializa el almacenamiento en el primer arranque de la
     * aplicación. Si ya existen productos guardados, no hace nada.
     *
     * Si es la primera vez (no hay catálogo guardado) y el archivo de
     * referencia `database.js` está disponible (función global
     * `instalarBaseDeDatosOriginal`), se utiliza para precargar el
     * catálogo y los rubros. `database.js` no se modifica: solo se
     * consume su función de exportación.
     *
     * @returns {{ productos: object, rubros: string[] }}
     */
    function inicializar() {
        let productos = cargarProductos();
        let rubros = cargarRubros();

        if (productos === null) {
            if (typeof instalarBaseDeDatosOriginal === "function") {
                try {
                    const semilla = instalarBaseDeDatosOriginal();
                    productos = sanitizarProductosDB(semilla && semilla.db);
                    rubros = sanitizarRubros([...RUBROS_INICIALES, ...((semilla && semilla.rubros) || [])]);
                } catch (error) {
                    console.error("StorageService: error al cargar la base de datos de referencia.", error);
                    productos = {};
                    rubros = sanitizarRubros(RUBROS_INICIALES);
                }
            } else {
                productos = {};
                rubros = sanitizarRubros(RUBROS_INICIALES);
            }
            guardarProductos(productos);
            guardarRubros(rubros);
        }

        return { productos, rubros };
    }

    // ------------------------------------------------------------
    // Backup / Restore — exportación e importación TOTAL del sistema
    // ------------------------------------------------------------

    /**
     * Versión del formato de backup. Se incrementa si algún día
     * cambia la estructura interna; permite que `restaurarTodo`
     * detecte archivos de una versión incompatible y lo informe
     * en lugar de silenciosamente romper datos.
     */
    const VERSION_BACKUP = 1;

    /**
     * Empaqueta TODA la información del sistema en un único objeto
     * JSON listo para descargar como archivo.
     *
     * Incluye: catálogo de productos, rubros, historial de ventas,
     * fiados (cuentas corrientes) y pagos a proveedores.
     * No incluye la preferencia de tema (es una preferencia visual
     * por dispositivo, no un dato de negocio).
     *
     * El archivo generado se llama:
     *   backup_almacen_AAAA-MM-DD_HH-MM.json
     *
     * @returns {{ nombre: string, contenido: string }}
     *   `nombre` es el nombre de archivo sugerido para la descarga.
     *   `contenido` es el JSON serializado listo para escribir.
     */
    function exportarTodo() {
        const ahora = new Date();
        const marca =
            `${ahora.getFullYear()}-` +
            `${Helpers.pad(ahora.getMonth() + 1)}-` +
            `${Helpers.pad(ahora.getDate())}_` +
            `${Helpers.pad(ahora.getHours())}-` +
            `${Helpers.pad(ahora.getMinutes())}`;

        const backup = {
            version: VERSION_BACKUP,
            generadoEn: ahora.toISOString(),
            productos: leer(KEYS.PRODUCTOS, {}),
            rubros: leer(KEYS.RUBROS, RUBROS_INICIALES),
            ventas: leer(KEYS.VENTAS, []),
            fiados: leer(KEYS.FIADOS, []),
            proveedores: leer(KEYS.PROVEEDORES, []),
        };

        return {
            nombre: `backup_almacen_${marca}.json`,
            contenido: JSON.stringify(backup, null, 2),
        };
    }

    /**
     * Restaura TODO el sistema a partir de un objeto ya parseado
     * (el contenido de un archivo de backup exportado previamente).
     *
     * Sanitiza cada sección antes de escribirla para que un archivo
     * corrupto o de versión antigua no rompa el estado en memoria.
     *
     * @param {object} backup  El objeto parseado del archivo JSON.
     * @param {"combinar"|"reemplazar"} modo
     *   - "reemplazar" (default): borra los datos actuales y escribe
     *     lo que viene del backup. Ideal para sincronizar un
     *     dispositivo nuevo con la última copia maestra.
     *   - "combinar": fusiona lo que viene del backup con los datos
     *     existentes. Para ventas/fiados/proveedores se agregan los
     *     registros que no existan ya (comparados por id). Para
     *     productos, los del backup prevalecen sobre los locales
     *     (se actualiza el catálogo pero no se borra lo que no esté
     *     en el backup).
     *
     * @returns {{ ok: boolean, mensaje: string, resumen: object }}
     */
    function restaurarTodo(backup, modo = "reemplazar") {
        if (!backup || typeof backup !== "object") {
            return { ok: false, mensaje: "El archivo no contiene datos válidos.", resumen: {} };
        }
        if (backup.version && backup.version > VERSION_BACKUP) {
            return {
                ok: false,
                mensaje: `El archivo fue generado con una versión más nueva (v${backup.version}). Actualizá la aplicación antes de restaurar.`,
                resumen: {},
            };
        }

        // ---- Sanitizar todas las secciones ----
        const productosNuevos = sanitizarProductosDB(backup.productos || {});
        const rubrosNuevos = sanitizarRubros(backup.rubros || []);
        const ventasNuevas = Array.isArray(backup.ventas) ? backup.ventas.map(sanitizarVenta).filter(Boolean) : [];
        const fiadosNuevos = Array.isArray(backup.fiados) ? backup.fiados.map(sanitizarFiado).filter(Boolean) : [];
        const proveedoresNuevos = Array.isArray(backup.proveedores) ? backup.proveedores.map(sanitizarProveedor).filter(Boolean) : [];

        let productos, rubros, ventas, fiados, proveedores;

        if (modo === "combinar") {
            // Catálogo: el backup actualiza/agrega sin borrar lo local.
            const productosLocales = cargarProductos() || {};
            productos = Object.assign({}, productosLocales, productosNuevos);

            // Rubros: unión sin duplicados.
            const rubrosLocales = cargarRubros();
            rubros = sanitizarRubros(Array.from(new Set([...rubrosLocales, ...rubrosNuevos])));

            // Listas: agregar solo los registros cuyo `id` no existe ya.
            const idsVentas = new Set((cargarVentas()).map((v) => v.id));
            ventas = [...cargarVentas(), ...ventasNuevas.filter((v) => !idsVentas.has(v.id))];

            const idsFiados = new Set((cargarFiados()).map((f) => f.id));
            fiados = [...cargarFiados(), ...fiadosNuevos.filter((f) => !idsFiados.has(f.id))];

            const idsProv = new Set((cargarProveedores()).map((p) => p.id));
            proveedores = [...cargarProveedores(), ...proveedoresNuevos.filter((p) => !idsProv.has(p.id))];
        } else {
            // Modo "reemplazar": sustituir todo por el backup.
            productos = productosNuevos;
            rubros = rubrosNuevos;
            ventas = ventasNuevas;
            fiados = fiadosNuevos;
            proveedores = proveedoresNuevos;
        }

        // ---- Persistir ----
        guardarProductos(productos);
        guardarRubros(rubros);
        guardarVentas(ventas);
        guardarFiados(fiados);
        guardarProveedores(proveedores);

        const resumen = {
            productos: Object.keys(productos).length,
            rubros: rubros.length,
            ventas: ventas.length,
            fiados: fiados.length,
            proveedores: proveedores.length,
        };

        return { ok: true, mensaje: "Restauración completada.", resumen, productos, rubros, ventas, fiados, proveedores };
    }

    return Object.freeze({
        KEYS,
        DESGLOSE_PAGO_VACIO,
        inicializar,
        cargarProductos,
        guardarProductos,
        cargarRubros,
        guardarRubros,
        cargarVentas,
        guardarVentas,
        cargarFiados,
        guardarFiados,
        cargarProveedores,
        guardarProveedores,
        cargarTema,
        guardarTema,
        sanitizarProducto,
        sanitizarProductosDB,
        sanitizarVenta,
        sanitizarFiado,
        sanitizarProveedor,
        exportarTodo,
        restaurarTodo,
    });
})();
