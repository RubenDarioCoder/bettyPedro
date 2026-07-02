/**
 * =====================================================================
 *  StorageService — Única capa que lee/escribe localStorage
 * =====================================================================
 */
const StorageService = (function () {
    "use strict";

    const KEYS = Object.freeze({
        PRODUCTOS:   "almacen_v5_productos",
        RUBROS:      "almacen_v5_rubros",
        VENTAS:      "almacen_historial_ventas",
        FIADOS:      "almacen_registros",
        PROVEEDORES: "almacen_proveedores",
        TEMA:        "almacen_tema",
    });

    const RUBROS_INICIALES = ["ALMACÉN", "BEBIDAS", "FIAMBRES"];

    const DESGLOSE_PAGO_VACIO = Object.freeze({
        EFECTIVO: 0, DEBITO: 0, CREDITO: 0, TRANSFERENCIA: 0, FIADO: 0,
    });

    const VERSION_BACKUP = 1;

    // ----------------------------------------------------------------
    // Lectura / escritura genérica
    // ----------------------------------------------------------------

    function leer(clave, porDefecto) {
        try {
            const v = localStorage.getItem(clave);
            if (v === null) return porDefecto;
            const p = JSON.parse(v);
            return (p === null || p === undefined) ? porDefecto : p;
        } catch { return porDefecto; }
    }

    function escribir(clave, valor) {
        try { localStorage.setItem(clave, JSON.stringify(valor)); return true; }
        catch (e) { console.error(`StorageService: no se pudo guardar "${clave}".`, e); return false; }
    }

    // ----------------------------------------------------------------
    // Sanitización
    // ----------------------------------------------------------------

    function sanitizarProducto(p) {
        p = (p && typeof p === "object") ? p : {};
        return {
            nombre:      typeof p.nombre === "string" ? p.nombre : "",
            descripcion: typeof p.descripcion === "string" ? p.descripcion : "",
            rubro:       (typeof p.rubro === "string" && p.rubro.trim()) ? p.rubro : "ALMACÉN",
            // Precios guardados como número (sin centavos al nivel de catálogo)
            costo:       Helpers.redondear2(Helpers.aNumero(p.costo, 0)),
            porcentaje:  Helpers.aNumero(p.porcentaje, 0),
            precioVenta: Helpers.redondear2(Helpers.aNumero(p.precioVenta, 0)),
            // Stock puede ser decimal (productos por peso)
            stock:       Helpers.aDecimal(p.stock, 3, 0),
            limiteStock: Helpers.aDecimal(p.limiteStock, 3, 3),
        };
    }

    function sanitizarProductosDB(db) {
        const out = {};
        if (db && typeof db === "object") {
            Object.keys(db).forEach(cod => { if (cod) out[String(cod)] = sanitizarProducto(db[cod]); });
        }
        return out;
    }

    function sanitizarRubros(arr) {
        const base = Array.isArray(arr) ? arr : [];
        const limpio = base.map(r => typeof r === "string" ? r.trim().toUpperCase() : "").filter(r => r);
        return Array.from(new Set(limpio.length ? limpio : RUBROS_INICIALES));
    }

    function sanitizarItemVenta(item) {
        item = (item && typeof item === "object") ? item : {};
        return {
            codigo:   (item.codigo !== undefined && item.codigo !== null) ? String(item.codigo) : "",
            nombre:   typeof item.nombre === "string" ? item.nombre : "",
            rubro:    typeof item.rubro  === "string" ? item.rubro  : "ALMACÉN",
            costo:    Helpers.aNumero(item.costo, 0),
            precio:   Helpers.aNumero(item.precio, 0),      // precio unitario, se guarda como número
            cantidad: Helpers.aDecimal(item.cantidad, 3, 0),// cantidad decimal permitida
        };
    }

    function sanitizarVenta(venta) {
        if (!venta || typeof venta !== "object") return null;

        const metodoPago = (typeof venta.metodoPago === "string" && venta.metodoPago)
            ? venta.metodoPago : "EFECTIVO";
        const total = Helpers.redondear2(Helpers.aNumero(venta.total, 0));

        // Compatibilidad con registros anteriores sin desglosePago
        let origenDesglose = venta.desglosePago;
        if (!origenDesglose || typeof origenDesglose !== "object") {
            origenDesglose = {};
            if (Object.prototype.hasOwnProperty.call(DESGLOSE_PAGO_VACIO, metodoPago)) {
                origenDesglose[metodoPago] = total;
            }
        }
        const desglose = Object.assign({}, DESGLOSE_PAGO_VACIO, origenDesglose);
        Object.keys(desglose).forEach(k => (desglose[k] = Helpers.aNumero(desglose[k], 0)));

        return {
            id:              venta.id || Helpers.generarId("TK"),
            fechaIso:        typeof venta.fechaIso === "string" ? venta.fechaIso : new Date().toISOString(),
            fechaFormateada: typeof venta.fechaFormateada === "string" ? venta.fechaFormateada : "",
            cliente:         (typeof venta.cliente === "string" && venta.cliente.trim()) ? venta.cliente : "Mostrador",
            metodoPago,
            total,
            productos:       Array.isArray(venta.productos) ? venta.productos.map(sanitizarItemVenta) : [],
            desglosePago:    desglose,
            vueltoEntregado: Helpers.redondear2(Helpers.aNumero(venta.vueltoEntregado, 0)),
        };
    }

    function sanitizarFiado(r) {
        if (!r || typeof r !== "object") return null;
        return {
            id:       r.id || Helpers.generarId("FD"),
            nombre:   typeof r.nombre === "string" ? r.nombre : "",
            monto:    Helpers.redondear2(Helpers.aNumero(r.monto, 0)),
            tipo:     r.tipo === "PAGO" ? "PAGO" : "DEUDA",
            fechaHora:typeof r.fechaHora === "string" ? r.fechaHora : "",
        };
    }

    function sanitizarProveedor(r) {
        if (!r || typeof r !== "object") return null;
        return {
            id:      r.id || Helpers.generarId("PROV"),
            nombre:  typeof r.nombre === "string" ? r.nombre : "",
            monto:   Helpers.redondear2(Helpers.aNumero(r.monto, 0)),
            detalle: (typeof r.detalle === "string" && r.detalle) ? r.detalle : "Gasto",
            fecha:   typeof r.fecha === "string" ? r.fecha : "",
        };
    }

    // ----------------------------------------------------------------
    // API CRUD
    // ----------------------------------------------------------------

    function cargarProductos() {
        const v = leer(KEYS.PRODUCTOS, null);
        return v === null ? null : sanitizarProductosDB(v);
    }
    function guardarProductos(db) { return escribir(KEYS.PRODUCTOS, db); }

    function cargarRubros()      { return sanitizarRubros(leer(KEYS.RUBROS, RUBROS_INICIALES)); }
    function guardarRubros(arr)  { return escribir(KEYS.RUBROS, sanitizarRubros(arr)); }

    function cargarVentas() {
        const v = leer(KEYS.VENTAS, []);
        return Array.isArray(v) ? v.map(sanitizarVenta).filter(Boolean) : [];
    }
    function guardarVentas(arr)  { return escribir(KEYS.VENTAS, arr); }

    function cargarFiados() {
        const v = leer(KEYS.FIADOS, []);
        return Array.isArray(v) ? v.map(sanitizarFiado).filter(Boolean) : [];
    }
    function guardarFiados(arr)  { return escribir(KEYS.FIADOS, arr); }

    function cargarProveedores() {
        const v = leer(KEYS.PROVEEDORES, []);
        return Array.isArray(v) ? v.map(sanitizarProveedor).filter(Boolean) : [];
    }
    function guardarProveedores(arr) { return escribir(KEYS.PROVEEDORES, arr); }

    function cargarTema()  { const t = leer(KEYS.TEMA, null); return (t === "dark" || t === "light") ? t : null; }
    function guardarTema(t){ return escribir(KEYS.TEMA, t === "dark" ? "dark" : "light"); }

    // ----------------------------------------------------------------
    // Inicialización
    // ----------------------------------------------------------------

    function inicializar() {
        let productos = cargarProductos();
        let rubros    = cargarRubros();

        if (productos === null) {
            if (typeof instalarBaseDeDatosOriginal === "function") {
                try {
                    const semilla = instalarBaseDeDatosOriginal();
                    productos = sanitizarProductosDB(semilla && semilla.db);
                    rubros    = sanitizarRubros([...RUBROS_INICIALES, ...((semilla && semilla.rubros) || [])]);
                } catch (e) {
                    console.error("StorageService: error al cargar la base de datos de referencia.", e);
                    productos = {};
                    rubros    = sanitizarRubros(RUBROS_INICIALES);
                }
            } else {
                productos = {};
                rubros    = sanitizarRubros(RUBROS_INICIALES);
            }
            guardarProductos(productos);
            guardarRubros(rubros);
        }

        return { productos, rubros };
    }

    // ----------------------------------------------------------------
    // Backup / Restore — copia de seguridad completa
    // ----------------------------------------------------------------

    /**
     * Genera el objeto de backup y devuelve el nombre de archivo y el
     * JSON serializado listos para descargar.
     */
    function exportarTodo() {
        const ahora = new Date();
        const marca =
            `${ahora.getFullYear()}-${Helpers.pad(ahora.getMonth() + 1)}-${Helpers.pad(ahora.getDate())}` +
            `_${Helpers.pad(ahora.getHours())}-${Helpers.pad(ahora.getMinutes())}`;

        const backup = {
            version:     VERSION_BACKUP,
            generadoEn:  ahora.toISOString(),
            productos:   leer(KEYS.PRODUCTOS,   {}),
            rubros:      leer(KEYS.RUBROS,       RUBROS_INICIALES),
            ventas:      leer(KEYS.VENTAS,       []),
            fiados:      leer(KEYS.FIADOS,       []),
            proveedores: leer(KEYS.PROVEEDORES,  []),
        };

        return { nombre: `backup_almacen_${marca}.json`, contenido: JSON.stringify(backup, null, 2) };
    }

    /**
     * Aplica un objeto de backup parseado.
     * @param {object} backup
     * @param {"reemplazar"|"combinar"} modo
     * @returns {{ ok: boolean, mensaje: string, resumen: object, ...datos }}
     */
    function restaurarTodo(backup, modo = "reemplazar") {
        if (!backup || typeof backup !== "object") {
            return { ok: false, mensaje: "El archivo no contiene datos válidos.", resumen: {} };
        }
        if (backup.version && backup.version > VERSION_BACKUP) {
            return { ok: false, mensaje: `Archivo de versión más nueva (v${backup.version}). Actualizá la app.`, resumen: {} };
        }

        const pNuevos  = sanitizarProductosDB(backup.productos || {});
        const rNuevos  = sanitizarRubros(backup.rubros || []);
        const vNuevas  = Array.isArray(backup.ventas)      ? backup.ventas.map(sanitizarVenta).filter(Boolean)       : [];
        const fNuevos  = Array.isArray(backup.fiados)      ? backup.fiados.map(sanitizarFiado).filter(Boolean)       : [];
        const prNuevos = Array.isArray(backup.proveedores) ? backup.proveedores.map(sanitizarProveedor).filter(Boolean) : [];

        let productos, rubros, ventas, fiados, proveedores;

        if (modo === "combinar") {
            const pLocal  = cargarProductos() || {};
            productos = Object.assign({}, pLocal, pNuevos);
            rubros    = sanitizarRubros(Array.from(new Set([...cargarRubros(), ...rNuevos])));

            const idsV = new Set(cargarVentas().map(v => v.id));
            ventas     = [...cargarVentas(),      ...vNuevas.filter(v  => !idsV.has(v.id))];

            const idsF = new Set(cargarFiados().map(f => f.id));
            fiados     = [...cargarFiados(),      ...fNuevos.filter(f  => !idsF.has(f.id))];

            const idsP = new Set(cargarProveedores().map(p => p.id));
            proveedores= [...cargarProveedores(), ...prNuevos.filter(p => !idsP.has(p.id))];
        } else {
            productos   = pNuevos;
            rubros      = rNuevos;
            ventas      = vNuevas;
            fiados      = fNuevos;
            proveedores = prNuevos;
        }

        guardarProductos(productos);
        guardarRubros(rubros);
        guardarVentas(ventas);
        guardarFiados(fiados);
        guardarProveedores(proveedores);

        return {
            ok: true,
            mensaje: "Restauración completada.",
            resumen: {
                productos:   Object.keys(productos).length,
                rubros:      rubros.length,
                ventas:      ventas.length,
                fiados:      fiados.length,
                proveedores: proveedores.length,
            },
            productos, rubros, ventas, fiados, proveedores,
        };
    }

    // ----------------------------------------------------------------
    // API pública
    // ----------------------------------------------------------------
    return Object.freeze({
        KEYS,
        DESGLOSE_PAGO_VACIO,
        inicializar,
        cargarProductos,  guardarProductos,
        cargarRubros,     guardarRubros,
        cargarVentas,     guardarVentas,
        cargarFiados,     guardarFiados,
        cargarProveedores,guardarProveedores,
        cargarTema,       guardarTema,
        sanitizarProducto,
        sanitizarProductosDB,
        sanitizarVenta,
        sanitizarFiado,
        sanitizarProveedor,
        exportarTodo,
        restaurarTodo,
    });
})();
