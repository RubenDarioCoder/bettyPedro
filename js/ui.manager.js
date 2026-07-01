
const UIManager = (function () {
    "use strict";

    // ------------------------------------------------------------
    // Constantes de configuración
    // ------------------------------------------------------------

    /** Cantidad de elementos por página en cada listado paginado. */
    const TAMANO_PAGINA_HISTORIAL = 12;
    const TAMANO_PAGINA_FIADOS = 10;
    const TAMANO_PAGINA_PROVEEDORES = 10;

    /** Límite de resultados renderizados simultáneamente en el ABM de productos. */
    const LIMITE_ABM = 150;

    /** Mapeo de medios de pago combinados a sus inputs en el DOM. */
    const COMBO_IDS = Object.freeze({
        EFECTIVO: "compEfectivo",
        DEBITO: "compDebito",
        CREDITO: "compCredito",
        TRANSFERENCIA: "compTransf",
        FIADO: "compFiado",
    });

    /** Etiquetas legibles para cada medio de pago. */
    const ETIQUETAS_METODO = Object.freeze({
        EFECTIVO: "Efectivo",
        DEBITO: "Débito",
        CREDITO: "Crédito",
        TRANSFERENCIA: "Transf/MP",
        FIADO: "Fiado",
        COMBINADO: "Combinado",
    });

    /**
     * Variantes de encabezado reconocidas (ya normalizadas mediante
     * `Helpers.normalizarClave`) para cada campo del producto, usadas
     * al importar un catálogo desde CSV. Permite que el archivo tenga
     * columnas en cualquier orden, con o sin acentos/mayúsculas.
     */
    const MAPA_CAMPOS_PRODUCTO = Object.freeze({
        codigo: ["codigo", "cod", "sku", "codbarra", "codigobarras", "codigodebarras", "ean", "barcode"],
        nombre: ["nombre", "producto", "descripcion", "articulo", "item", "detalle"],
        rubro: ["rubro", "categoria", "seccion", "familia", "departamento", "tipo"],
        costo: ["costo", "coste", "preciocosto", "costounitario", "preciocompra"],
        porcentaje: ["porcentaje", "ganancia", "margen", "porcentajeganancia", "%"],
        precioVenta: ["precioventa", "precio", "pvp", "preciodeventa", "precioventaajustado", "precioventafinal"],
        stock: ["stock", "cantidad", "existencia", "existencias", "unidades"],
        limiteStock: ["limitestock", "minimo", "stockminimo", "minimocritico", "limite", "stockcritico"],
    });

    /** Tabla inversa: variante normalizada → nombre del campo del producto. */
    const REVERSO_CAMPOS_PRODUCTO = (function () {
        const reverso = {};
        Object.keys(MAPA_CAMPOS_PRODUCTO).forEach((campo) => {
            MAPA_CAMPOS_PRODUCTO[campo].forEach((variante) => {
                reverso[variante] = campo;
            });
        });
        return reverso;
    })();

    /** Orden posicional de respaldo, idéntico al de `exportarCatalogoCSV`. */
    const MAPEO_POSICIONAL_PRODUCTO = Object.freeze({
        0: "codigo",
        1: "nombre",
        2: "rubro",
        3: "costo",
        4: "porcentaje",
        5: "precioVenta",
        6: "stock",
        7: "limiteStock",
    });

    // ------------------------------------------------------------
    // Estado privado en memoria
    // ------------------------------------------------------------
    let productosDB = {};
    let rubrosDisponibles = [];
    let historialVentas = [];
    let registrosFiados = [];
    let registrosProveedores = [];
    let modoPagoCombinado = false;
    let graficoVentas = null;
    let confirmCallback = null;
    /** Resultado de un CSV procesado, pendiente de confirmación del usuario. */
    let importacionPendiente = null;

    /** Estado de paginación de cada listado (página actual, 1-indexada). */
    const paginacion = {
        historial: { pagina: 1 },
        fiados: { pagina: 1 },
        proveedores: { pagina: 1 },
    };

    // ------------------------------------------------------------
    // Utilidades de DOM
    // ------------------------------------------------------------

    /** Acceso corto a `document.getElementById`. */
    function $(id) {
        return document.getElementById(id);
    }

    /** Suscribe un listener a un elemento por ID, ignorando si no existe. */
    function on(id, evento, manejador) {
        const el = $(id);
        if (el) el.addEventListener(evento, manejador);
    }

    /** Lee una Custom Property CSS resuelta (para pasarle colores a Chart.js). */
    function obtenerVariableCss(nombre) {
        return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    }

    // ==============================================================
    // TEMA (Modo Claro / Oscuro)
    // ==============================================================

    /**
     * Aplica el tema indicado al documento y sincroniza el estado
     * visual del interruptor (icono sol/luna + atributos ARIA).
     * @param {"light"|"dark"} tema
     */
    function aplicarTema(tema) {
        document.documentElement.setAttribute("data-theme", tema);

        const boton = $("themeToggleBtn");
        if (boton) {
            boton.setAttribute("aria-pressed", tema === "dark" ? "true" : "false");
            boton.setAttribute("aria-label", tema === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
        }

        const iconoSol = document.querySelector(".theme-toggle__icon-sun");
        const iconoLuna = document.querySelector(".theme-toggle__icon-moon");
        if (iconoSol && iconoLuna) {
            iconoSol.classList.toggle("u-hidden", tema === "dark");
            iconoLuna.classList.toggle("u-hidden", tema !== "dark");
        }
    }

    /** Alterna entre tema claro y oscuro, persistiendo la preferencia. */
    function alternarTema() {
        const actual = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        const nuevo = actual === "dark" ? "light" : "dark";
        aplicarTema(nuevo);
        StorageService.guardarTema(nuevo);
        // Si el gráfico de estadísticas ya existe, se vuelve a dibujar
        // para que sus colores (texto/grillas) coincidan con el nuevo tema.
        if (graficoVentas) renderEstadisticas();
    }

    /** Inicializa el tema según preferencia guardada o del sistema operativo. */
    function initTema() {
        const guardado = StorageService.cargarTema();
        let temaInicial = guardado;
        if (!temaInicial) {
            const prefiereOscuro = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
            temaInicial = prefiereOscuro ? "dark" : "light";
        }
        aplicarTema(temaInicial);
        on("themeToggleBtn", "click", alternarTema);
    }

    // ==============================================================
    // NOTIFICACIONES (Toast)
    // ==============================================================

    let temporizadorToast = null;

    /**
     * Muestra una notificación flotante temporal.
     * @param {string} mensaje
     * @param {"success"|"error"|"info"} tipo
     */
    function mostrarToast(mensaje, tipo) {
        const toast = $("toast");
        if (!toast) return;
        toast.textContent = mensaje;
        toast.classList.remove("toast--success", "toast--error", "toast--info");
        toast.classList.add(`toast--${tipo || "info"}`);
        toast.classList.add("toast--visible");

        clearTimeout(temporizadorToast);
        temporizadorToast = setTimeout(() => toast.classList.remove("toast--visible"), 2600);
    }

    // ==============================================================
    // MODALES (genérico abrir/cerrar + confirmación)
    // ==============================================================

    /** Abre un modal por ID (agrega clase de overlay visible). */
    function abrirModal(id) {
        const modal = $(id);
        if (!modal) return;
        modal.classList.add("modal-overlay--open");
        modal.setAttribute("aria-hidden", "false");
    }

    /** Cierra un modal por ID. */
    function cerrarModal(id) {
        const modal = $(id);
        if (!modal) return;
        modal.classList.remove("modal-overlay--open");
        modal.setAttribute("aria-hidden", "true");
    }

    /**
     * Asegura que ningún modal quede abierto al iniciar la aplicación,
     * sin importar el estado con el que haya quedado el HTML (medida
     * defensiva ante recargas o estados inconsistentes).
     */
    function cerrarTodosLosModales() {
        ["modalTicketImpreso", "modalNuevoRubro", "modalConfirmacion"].forEach(cerrarModal);
    }

    /**
     * Reemplazo estilizado de `window.confirm()`. Muestra un modal con
     * el mensaje indicado y ejecuta `onAceptar` solo si el usuario
     * confirma la acción.
     * @param {string} mensaje
     * @param {Function} onAceptar
     * @param {{titulo?: string, textoAceptar?: string}} [opciones]
     */
    function confirmar(mensaje, onAceptar, opciones) {
        const opts = opciones || {};
        const modal = $("modalConfirmacion");
        if (!modal) {
            // Fallback defensivo si el modal no está presente en el DOM.
            if (window.confirm(mensaje)) onAceptar();
            return;
        }
        $("confirmMensaje").textContent = mensaje;
        $("confirmTitulo").textContent = opts.titulo || "Confirmar acción";
        $("btnConfirmAceptar").textContent = opts.textoAceptar || "Eliminar";
        confirmCallback = onAceptar;
        abrirModal("modalConfirmacion");
    }

    /** Inicializa los listeners de los modales secundarios (confirmación y rubro). */
    function initModales() {
        on("btnConfirmCancelar", "click", () => {
            confirmCallback = null;
            cerrarModal("modalConfirmacion");
        });
        on("btnConfirmAceptar", "click", () => {
            const callback = confirmCallback;
            confirmCallback = null;
            cerrarModal("modalConfirmacion");
            if (typeof callback === "function") callback();
        });

        // Cierre al hacer clic fuera del contenido (no aplica al ticket
        // fiscal, que mantiene bloqueo estricto de pantalla).
        ["modalNuevoRubro", "modalConfirmacion", "modalImportarCatalogo"].forEach((id) => {
            const overlay = $(id);
            if (!overlay) return;
            overlay.addEventListener("click", (evento) => {
                if (evento.target === overlay) {
                    if (id === "modalConfirmacion") confirmCallback = null;
                    if (id === "modalImportarCatalogo") importacionPendiente = null;
                    cerrarModal(id);
                }
            });
        });
    }

    // ==============================================================
    // NAVEGACIÓN DE SOLAPAS
    // ==============================================================

    /** Inicializa los botones de navegación entre solapas. */
    function initTabs() {
        document.querySelectorAll(".tabs__btn").forEach((boton) => {
            boton.addEventListener("click", () => cambiarSolapa(boton.dataset.tab));
        });
    }

    /**
     * Activa la solapa indicada y dispara el render correspondiente
     * (los listados pesados se renderizan "on demand" al visitarlos).
     * @param {string} idSolapa
     */
    function cambiarSolapa(idSolapa) {
        document.querySelectorAll(".tabs__btn").forEach((boton) => {
            boton.classList.toggle("tabs__btn--active", boton.dataset.tab === idSolapa);
        });
        document.querySelectorAll(".tab-panel").forEach((panel) => {
            panel.classList.toggle("tab-panel--active", panel.id === idSolapa);
        });

        switch (idSolapa) {
            case "solapa-productos":
                renderListaProductos();
                break;
            case "solapa-historial-ventas":
                renderHistorial();
                break;
            case "solapa-estadisticas":
                renderEstadisticas();
                break;
            case "solapa-fiados":
                renderFiados();
                break;
            case "solapa-proveedores":
                renderProveedores();
                break;
            default:
                break;
        }
    }

    // ==============================================================
    // PAGINACIÓN (componente reutilizable)
    // ==============================================================

    /**
     * Renderiza los controles "Anterior / Página X de Y / Siguiente"
     * dentro de `contenedorId`, y clampa `estado.pagina` al rango
     * válido. Si todos los registros entran en una sola página, no
     * se muestra ningún control.
     *
     * @param {string} contenedorId
     * @param {{pagina:number}} estado Objeto mutable con la página actual
     * @param {number} totalItems
     * @param {number} tamanoPagina
     * @param {Function} onCambiarPagina Callback a invocar al cambiar de página
     */
    function renderPaginacion(contenedorId, estado, totalItems, tamanoPagina, onCambiarPagina) {
        const contenedor = $(contenedorId);
        if (!contenedor) return;

        const totalPaginas = Math.max(1, Math.ceil(totalItems / tamanoPagina));
        if (estado.pagina > totalPaginas) estado.pagina = totalPaginas;
        if (estado.pagina < 1) estado.pagina = 1;

        contenedor.innerHTML = "";
        if (totalItems <= tamanoPagina) return;

        const btnAnterior = document.createElement("button");
        btnAnterior.type = "button";
        btnAnterior.className = "btn btn--ghost pagination__btn";
        btnAnterior.textContent = "← Anterior";
        btnAnterior.disabled = estado.pagina <= 1;
        btnAnterior.addEventListener("click", () => {
            estado.pagina -= 1;
            onCambiarPagina();
        });

        const info = document.createElement("span");
        info.className = "pagination__info";
        info.textContent = `Página ${estado.pagina} de ${totalPaginas} · ${totalItems} registros`;

        const btnSiguiente = document.createElement("button");
        btnSiguiente.type = "button";
        btnSiguiente.className = "btn btn--ghost pagination__btn";
        btnSiguiente.textContent = "Siguiente →";
        btnSiguiente.disabled = estado.pagina >= totalPaginas;
        btnSiguiente.addEventListener("click", () => {
            estado.pagina += 1;
            onCambiarPagina();
        });

        contenedor.appendChild(btnAnterior);
        contenedor.appendChild(info);
        contenedor.appendChild(btnSiguiente);
    }

    // ==============================================================
    // SOLAPA 1: CAJA / VENTAS
    // ==============================================================

    /** Inicializa todos los listeners de la solapa de Caja/Ventas. */
    function initCaja() {
        // --- Escáner de códigos ---
        const scanner = $("scannerInput");
        if (scanner) {
            scanner.addEventListener("keydown", (evento) => {
                if (evento.key === "Enter") {
                    evento.preventDefault();
                    agregarPorCodigo(scanner.value.trim());
                }
            });
        }
        on("btnScannerManual", "click", () => {
            const input = $("scannerInput");
            agregarPorCodigo(input ? input.value.trim() : "");
        });

        // --- Delegación de eventos sobre las filas del ticket ---
        on("cuerpoTicket", "click", (evento) => {
            const boton = evento.target.closest("button[data-accion]");
            if (!boton) return;
            const indice = Helpers.aEntero(boton.dataset.index, -1);
            switch (boton.dataset.accion) {
                case "sumar":
                    POSCore.cambiarCantidad(indice, 1);
                    break;
                case "restar":
                    POSCore.cambiarCantidad(indice, -1);
                    break;
                case "eliminar":
                    POSCore.eliminarItem(indice);
                    break;
                default:
                    return;
            }
            renderTicket();
        });

        // --- Delegación para cambios manuales en el input de cantidad ---
        on("cuerpoTicket", "change", (evento) => {
            const input = evento.target.closest(".ticket-cantidad-input");
            if (!input) return;

            const indice = Helpers.aEntero(input.dataset.index, -1);
            if (indice === -1) return;

            // Admite coma o punto decimal (ej: "0,550" kg de un producto
            // vendido por peso) sin truncar la cantidad a entero.
            POSCore.establecerCantidad(indice, input.value);
            renderTicket();
        });

        // Permite confirmar la cantidad tipeada con la tecla Enter
        // (dispara el "blur", que a su vez activa el listener "change").
        on("cuerpoTicket", "keydown", (evento) => {
            if (evento.key !== "Enter") return;
            const input = evento.target.closest(".ticket-cantidad-input");
            if (!input) return;
            evento.preventDefault();
            input.blur();
        });

        // --- Buscador de productos por nombre ---
        initBuscadorVentas();

        // --- Pago combinado ---
        on("btnAlternarCombinado", "click", alternarModoPagoCombinado);
        Object.keys(COMBO_IDS).forEach((metodo) => {
            on(COMBO_IDS[metodo], "input", () => {
                actualizarPagoCombinado();
                actualizarVuelto();
            });
        });

        // --- Método de pago simple ---
        on("metodoPago", "change", () => {
            sincronizarVisibilidadClienteFiado();
            actualizarVuelto();
        });

        // --- Monto entregado / vuelto ---
        on("pagaConInput", "input", actualizarVuelto);

        // --- Acciones principales ---
        on("btnCancelarTicket", "click", () => {
            if (POSCore.obtenerTicket().length === 0) return;
            confirmar("¿Vaciar el ticket actual? Se perderán los productos agregados.", () => {
                POSCore.vaciarTicket();
                renderTicket();
                mostrarToast("🧹 Ticket vaciado", "info");
            }, { titulo: "Vaciar ticket", textoAceptar: "Vaciar" });
        });
        on("btnFinalizarVenta", "click", finalizarVenta);

        // --- Cierre del comprobante (bloqueo estricto: solo este botón lo cierra) ---
        on("btnCerrarModalTicket", "click", () => {
            cerrarModal("modalTicketImpreso");
            mostrarToast("✅ Listo para una nueva venta", "success");
        });
    }

    /**
     * Muestra u oculta el campo "Nombre del cliente para el fiado"
     * según corresponda: se muestra si el método de pago simple es
     * FIADO, o si el modo combinado está activo (puede incluir una
     * porción a fiado).
     */
    function sincronizarVisibilidadClienteFiado() {
        const grupo = $("grupoClienteFiado");
        if (!grupo) return;
        const metodoSimple = $("metodoPago").value;
        const debeMostrarse = modoPagoCombinado || metodoSimple === "FIADO";
        grupo.classList.toggle("u-hidden", !debeMostrarse);
        if (debeMostrarse) {
            const input = $("clienteFiadoNombre");
            if (input && document.activeElement !== input) input.focus();
        }
    }

    /** Lee los montos ingresados en el panel de pago combinado. */
    function leerDesgloseCombinado() {
        const desglose = {};
        Object.keys(COMBO_IDS).forEach((metodo) => {
            const input = $(COMBO_IDS[metodo]);
            desglose[metodo] = Helpers.aNumero(input ? input.value : 0);
        });
        return desglose;
    }

    /** Activa/desactiva el panel de cobro combinado. */
    function alternarModoPagoCombinado() {
        modoPagoCombinado = !modoPagoCombinado;

        const panelSimple = $("panelPagoSimple");
        const panelCombinado = $("panelPagoCombinado");
        const boton = $("btnAlternarCombinado");

        panelSimple.classList.toggle("u-hidden", modoPagoCombinado);
        panelCombinado.classList.toggle("u-hidden", !modoPagoCombinado);
        boton.textContent = modoPagoCombinado ? "⬅️ Pago Simple" : "➕ Combinar Pagos";
        boton.classList.toggle("btn--ghost", !modoPagoCombinado);
        boton.classList.toggle("btn--neutral", modoPagoCombinado);

        sincronizarVisibilidadClienteFiado();
        actualizarPagoCombinado();
        actualizarVuelto();
    }

    /** Recalcula y muestra cuánto falta (o sobra) para cubrir el total con el cobro combinado. */
    function actualizarPagoCombinado() {
        const texto = $("txtMontoRestanteCombinado");
        if (!texto) return;
        if (!modoPagoCombinado) return;

        const total = POSCore.calcularTotalTicket();
        const desglose = leerDesgloseCombinado();
        const { restante, cubierto } = POSCore.validarCobroCombinado(total, desglose);

        texto.classList.remove("payment-combo__remaining--ok", "payment-combo__remaining--pending");
        if (cubierto) {
            texto.textContent = "✅ Total cubierto correctamente";
            texto.classList.add("payment-combo__remaining--ok");
        } else if (restante > 0) {
            texto.textContent = `Faltan cubrir: ${Helpers.formatearMoneda(restante)}`;
            texto.classList.add("payment-combo__remaining--pending");
        } else {
            texto.textContent = `Excede el total por: ${Helpers.formatearMoneda(Math.abs(restante))}`;
            texto.classList.add("payment-combo__remaining--pending");
        }
    }

    /** Recalcula y muestra el vuelto a entregar según el medio de pago actual. */
    function actualizarVuelto() {
        const caja = $("vueltoBox");
        if (!caja) return;

        const total = POSCore.calcularTotalTicket();
        const pagaConInput = $("pagaConInput");
        const pagaCon = Helpers.aNumero(pagaConInput ? pagaConInput.value : 0);
        const metodoPago = $("metodoPago").value;
        const desglose = modoPagoCombinado ? leerDesgloseCombinado() : null;

        const { aplica, vuelto } = POSCore.calcularVuelto({
            total,
            pagaCon,
            esCombinado: modoPagoCombinado,
            desglose,
            metodoPago,
        });

        caja.classList.remove("change-box--positive");
        if (!aplica) {
            caja.textContent = "El pago electrónico cubre el total exacto (sin vuelto)";
            return;
        }
        caja.textContent = `Vuelto a entregar: ${Helpers.formatearMoneda(vuelto)}`;
        if (vuelto > 0) caja.classList.add("change-box--positive");
    }

    /** Inicializa el buscador de productos por nombre (resultados desplegables). */
    function initBuscadorVentas() {
        const input = $("buscadorNombreVentas");
        const resultados = $("resultadosBuscador");
        if (!input || !resultados) return;

        const ejecutarBusqueda = Helpers.debounce(() => {
            const consulta = input.value.toLowerCase().trim();
            resultados.innerHTML = "";

            if (consulta.length < 2) {
                resultados.classList.remove("search-combo__results--open");
                return;
            }

            const coincidencias = [];
            for (const codigo in productosDB) {
                if (!Object.prototype.hasOwnProperty.call(productosDB, codigo)) continue;
                const producto = productosDB[codigo];
                if (producto.nombre.toLowerCase().includes(consulta) || codigo.toLowerCase().includes(consulta)) {
                    coincidencias.push({ codigo, producto });
                    if (coincidencias.length >= 8) break;
                }
            }

            coincidencias.forEach(({ codigo, producto }) => {
                const opcion = document.createElement("div");
                opcion.className = "search-combo__option";
                opcion.setAttribute("role", "button");
                opcion.setAttribute("tabindex", "0");
                opcion.innerHTML =
                    `<strong>${Helpers.escaparHtml(producto.nombre)}</strong> ` +
                    `<span>· ${Helpers.formatearMoneda(producto.precioVenta)} · Stock: ${producto.stock}</span>`;
                const seleccionar = () => {
                    agregarPorCodigo(codigo);
                    input.value = "";
                    resultados.innerHTML = "";
                    resultados.classList.remove("search-combo__results--open");
                };
                opcion.addEventListener("click", seleccionar);
                opcion.addEventListener("keydown", (evento) => {
                    if (evento.key === "Enter" || evento.key === " ") {
                        evento.preventDefault();
                        seleccionar();
                    }
                });
                resultados.appendChild(opcion);
            });

            resultados.classList.toggle("search-combo__results--open", coincidencias.length > 0);
        }, 150);

        input.addEventListener("input", ejecutarBusqueda);
        input.addEventListener("focus", ejecutarBusqueda);

        document.addEventListener("click", (evento) => {
            if (evento.target !== input && !resultados.contains(evento.target)) {
                resultados.classList.remove("search-combo__results--open");
            }
        });
    }

    /**
     * Agrega un producto al ticket actual a partir de su código.
     * @param {string} codigo
     */
    function agregarPorCodigo(codigo) {
        if (!codigo) return;
        const producto = productosDB[codigo];
        if (!producto) {
            mostrarToast(`❌ Código "${codigo}" no encontrado en el catálogo`, "error");
            return;
        }
        POSCore.agregarProducto(codigo, producto);
        const scanner = $("scannerInput");
        if (scanner) {
            scanner.value = "";
            scanner.focus();
        }
        renderTicket();
    }

    /** Renderiza la tabla del ticket actual y actualiza los totales de venta. */
    function renderTicket() {
        const cuerpo = $("cuerpoTicket");
        if (!cuerpo) return;

        const ticket = POSCore.obtenerTicket();
        cuerpo.innerHTML = "";

        if (ticket.length === 0) {
            cuerpo.innerHTML = `
                <tr>
                    <td colspan="6" class="u-text-center u-text-muted" style="padding: var(--space-6);">
                        🛒 El ticket está vacío. Escanee o busque un producto para comenzar.
                    </td>
                </tr>`;
            actualizarTotalesTicket(0);
            return;
        }

        ticket.forEach((item, index) => {
            const subtotal = Helpers.redondear2(Helpers.aNumero(item.precio) * Helpers.aDecimal(item.cantidad, 3, 0));
            const fila = document.createElement("tr");

            fila.innerHTML = `
                <td class="ticket-table__name"><strong>${item.nombre}</strong><br><small class="u-text-muted">${item.codigo}</small></td>
                <td class="ticket-table__qty">
                    <div class="qty-stepper">
                        <button type="button" class="qty-stepper__btn" data-accion="restar" data-index="${index}" aria-label="Restar">−</button>
                        <input type="text"
                            class="ticket-cantidad-input"
                            data-index="${index}"
                            value="${Helpers.formatearCantidad(item.cantidad)}"
                            inputmode="decimal"
                            autocomplete="off"
                            aria-label="Cantidad">
                        <button type="button" class="qty-stepper__btn" data-accion="sumar" data-index="${index}" aria-label="Sumar">+</button>
                    </div>
                </td>
                <td class="ticket-table__price">${Helpers.formatearMoneda(item.precio)}</td>
                <td class="ticket-table__subtotal">${Helpers.formatearMoneda(subtotal)}</td>
                <td class="ticket-table__remove">
                    <button type="button" class="icon-btn" data-accion="eliminar" data-index="${index}" title="Quitar ítem" aria-label="Quitar ítem">
                        🗑️
                    </button>
                </td>
            `;
            cuerpo.appendChild(fila);
        });

        const total = POSCore.calcularTotalTicket();
        actualizarTotalesTicket(total);
    }

    /**
     * Actualiza el total mostrado en el "Resumen de Venta" y refresca
     * los paneles que dependen de él (cobro combinado y vuelto).
     *
     * Esta función se perdió durante el refactor del input de cantidad
     * tipeable, lo que provocaba un `ReferenceError` en cada render del
     * ticket (impidiendo que el total se actualizara al agregar
     * productos).
     * @param {number} total
     */
    function actualizarTotalesTicket(total) {
        const totalEl = $("totalVenta");
        if (totalEl) totalEl.textContent = Helpers.formatearMoneda(total);

        actualizarPagoCombinado();
        actualizarVuelto();
    }

    /**
     * Valida, registra y persiste la venta actual: descuenta stock,
     * agrega el ticket al historial, registra el fiado (si corresponde),
     * muestra el comprobante y reinicia el formulario de cobro.
     */
    function finalizarVenta() {
        const items = POSCore.obtenerTicket();
        if (items.length === 0) {
            mostrarToast("❌ El ticket está vacío", "error");
            return;
        }

        const total = POSCore.calcularTotalTicket();
        const nombreCliente = $("clienteFiadoNombre").value.trim();
        let metodoPago;
        let desglosePago = Object.assign({}, StorageService.DESGLOSE_PAGO_VACIO);

        if (modoPagoCombinado) {
            desglosePago = leerDesgloseCombinado();
            const { cubierto } = POSCore.validarCobroCombinado(total, desglosePago);
            if (!cubierto) {
                mostrarToast("❌ Los montos combinados no coinciden con el total a cobrar", "error");
                return;
            }
            if (desglosePago.FIADO > 0 && !nombreCliente) {
                mostrarToast("❌ Ingresa el nombre del cliente para registrar la porción a fiado", "error");
                return;
            }
            metodoPago = "COMBINADO";
        } else {
            metodoPago = $("metodoPago").value;
            if (metodoPago === "FIADO" && !nombreCliente) {
                mostrarToast("❌ Ingresa el nombre del cliente para registrar el fiado", "error");
                return;
            }
            desglosePago[metodoPago] = total;
        }

        const pagaCon = Helpers.aNumero($("pagaConInput").value);
        const venta = POSCore.construirVenta({
            total,
            cliente: nombreCliente,
            metodoPago,
            desglosePago,
            pagaCon,
            items,
        });

        // Inventario: descuenta stock vendido del catálogo en memoria.
        POSCore.descontarStock(productosDB, items);
        StorageService.guardarProductos(productosDB);

        // Historial de ventas.
        historialVentas.push(venta);
        StorageService.guardarVentas(historialVentas);

        // Cuenta corriente: si parte (o todo) el cobro fue a fiado, se
        // registra automáticamente como una deuda nueva.
        const montoFiado = modoPagoCombinado ? desglosePago.FIADO : (metodoPago === "FIADO" ? total : 0);
        if (montoFiado > 0) {
            registrosFiados.push({
                id: Helpers.generarId("FD"),
                nombre: venta.cliente,
                monto: Helpers.redondear2(montoFiado),
                tipo: "DEUDA",
                fechaHora: venta.fechaFormateada,
            });
            StorageService.guardarFiados(registrosFiados);
        }

        mostrarComprobante(venta, pagaCon, venta.vueltoEntregado);

        // Reinicia el formulario de cobro para la próxima venta.
        POSCore.vaciarTicket();
        $("pagaConInput").value = "";
        $("clienteFiadoNombre").value = "";
        Object.keys(COMBO_IDS).forEach((metodo) => {
            const input = $(COMBO_IDS[metodo]);
            if (input) input.value = "0";
        });

        renderTicket();
        renderListaProductos();
        paginacion.historial.pagina = 1;
        renderHistorial();
        if (montoFiado > 0) {
            paginacion.fiados.pagina = 1;
            renderFiados();
        }
        actualizarEfectivoCaja();
    }

    /**
     * Construye y muestra el comprobante de venta dentro del modal de
     * ticket fiscal (formato "papel térmico" con tipografía monoespaciada).
     * @param {object} venta
     * @param {number} pagaCon
     * @param {number} vuelto
     */
    function mostrarComprobante(venta, pagaCon, vuelto) {
        const contenedor = $("contenidoTicketImpreso");
        if (!contenedor) return;

        const lineas = (venta.productos || [])
            .map((item) => {
                const subtotal = Helpers.redondear2(item.precio * Helpers.aDecimal(item.cantidad, 3, 0));
                return `
                    <div class="receipt__line-name">${Helpers.escaparHtml(item.nombre)}</div>
                    <div class="receipt__line-detail">
                        <span>${Helpers.formatearCantidad(item.cantidad)} x ${Helpers.formatearMoneda(item.precio)}</span>
                        <span>${Helpers.formatearMoneda(subtotal)}</span>
                    </div>
                `;
            })
            .join("");

        let bloquePagos;
        if (venta.metodoPago === "COMBINADO") {
            const filas = Object.keys(ETIQUETAS_METODO)
                .filter((clave) => clave !== "COMBINADO" && Helpers.aNumero(venta.desglosePago[clave]) > 0)
                .map(
                    (clave) =>
                        `<div><span>${ETIQUETAS_METODO[clave]}</span><span>${Helpers.formatearMoneda(venta.desglosePago[clave])}</span></div>`
                )
                .join("");
            bloquePagos = `<div class="receipt__payments receipt__divider"><strong>Detalle del Pago Combinado:</strong>${filas}</div>`;
        } else {
            const etiqueta = ETIQUETAS_METODO[venta.metodoPago] || venta.metodoPago;
            bloquePagos = `<div class="receipt__meta receipt__divider"><strong>Forma de Pago:</strong> ${Helpers.escaparHtml(etiqueta)}</div>`;
        }

        const bloqueCambio =
            pagaCon > 0
                ? `
            <div class="receipt__change receipt__divider">
                <div class="receipt__change-row"><span>Entregado:</span><span>${Helpers.formatearMoneda(pagaCon)}</span></div>
                <div class="receipt__change-row"><span>Vuelto:</span><span>${Helpers.formatearMoneda(vuelto)}</span></div>
            </div>`
                : "";

        contenedor.innerHTML = `
            <div class="receipt__header">
                <div>*** TICKET DE VENTA ***</div>
                <div class="receipt__store">ALMACÉN INTEGRADO</div>
                <div class="receipt__datetime">${Helpers.escaparHtml(venta.fechaFormateada)}</div>
            </div>
            <div class="receipt__meta">
                <div><strong>Comprobante:</strong> ${Helpers.escaparHtml(venta.id)}</div>
                <div><strong>Cliente:</strong> ${Helpers.escaparHtml(venta.cliente)}</div>
            </div>
            <div class="receipt__divider">${lineas}</div>
            <div class="receipt__total receipt__divider">
                <span>TOTAL</span><span>${Helpers.formatearMoneda(venta.total)}</span>
            </div>
            ${bloquePagos}
            ${bloqueCambio}
            <div class="receipt__thanks">¡ GRACIAS POR SU COMPRA !</div>
        `;

        abrirModal("modalTicketImpreso");
    }

    // ==============================================================
    // SOLAPA 2: GESTIÓN DE PRODUCTOS (ABM)
    // ==============================================================

    /** Inicializa los listeners del formulario y listado de productos. */
    function initProductos() {
        on("buscadorABM", "input", Helpers.debounce(renderListaProductos, 200));

        on("prodCosto", "input", actualizarPrecioVentaDinamico);
        on("prodPorcentaje", "input", actualizarPrecioVentaDinamico);

        on("formProducto", "submit", (evento) => {
            evento.preventDefault();
            guardarProducto();
        });
        on("btnLimpiarProdForm", "click", limpiarFormularioProducto);

        on("btnAbrirModalRubro", "click", () => {
            const input = $("inputNuevoRubro");
            if (input) input.value = "";
            abrirModal("modalNuevoRubro");
            if (input) setTimeout(() => input.focus(), 50);
        });
        on("btnGuardarNuevoRubro", "click", guardarNuevoRubro);
        on("btnCerrarModalRubro", "click", () => cerrarModal("modalNuevoRubro"));

        on("btnExportarCSV", "click", exportarCatalogoCSV);


        on("btnImportarCSV", "click", () => {
            const input = $("inputImportarCSV");
            if (input) input.click();
        });
        on("inputImportarCSV", "change", manejarArchivoImportado);

        on("btnImportarCombinar", "click", () => aplicarImportacion("combinar"));
        on("btnImportarReemplazar", "click", () => {
            cerrarModal("modalImportarCatalogo");
            confirmar(
                "Esta acción eliminará TODOS los productos actuales del catálogo y los reemplazará por los del archivo importado. ¿Deseas continuar?",
                () => aplicarImportacion("reemplazar"),
                { titulo: "Reemplazar catálogo completo", textoAceptar: "Reemplazar Todo" }
            );
        });
        on("btnCancelarImportacion", "click", () => {
            importacionPendiente = null;
            cerrarModal("modalImportarCatalogo");
        });

        on("listaABM", "click", (evento) => {
            const boton = evento.target.closest("button[data-accion]");
            if (!boton) return;
            const codigo = boton.dataset.codigo;
            if (boton.dataset.accion === "editar") editarProducto(codigo);
            else if (boton.dataset.accion === "eliminar") eliminarProducto(codigo);
        });

        actualizarSelectRubros();
    }

    /** Sugiere automáticamente el precio de venta según costo + % de ganancia. */
    function actualizarPrecioVentaDinamico() {
        const costo = $("prodCosto").value;
        const porcentaje = $("prodPorcentaje").value;
        $("prodPrecioVenta").value = POSCore.calcularPrecioVenta(costo, porcentaje).toFixed(2);
    }

    /** Reconstruye el `<select>` de rubros a partir de `rubrosDisponibles`. */
    function actualizarSelectRubros() {
        const select = $("prodRubro");
        if (!select) return;
        const seleccionPrevia = select.value;

        select.innerHTML = "";
        rubrosDisponibles
            .slice()
            .sort()
            .forEach((rubro) => {
                const opcion = document.createElement("option");
                opcion.value = rubro;
                opcion.textContent = rubro;
                select.appendChild(opcion);
            });

        if (seleccionPrevia && rubrosDisponibles.includes(seleccionPrevia)) {
            select.value = seleccionPrevia;
        }
    }

    /** Crea un nuevo rubro a partir del modal y lo selecciona en el formulario. */
    function guardarNuevoRubro() {
        const input = $("inputNuevoRubro");
        if (!input) return;
        const nuevoRubro = input.value.trim().toUpperCase();

        if (nuevoRubro) {
            if (!rubrosDisponibles.includes(nuevoRubro)) {
                rubrosDisponibles.push(nuevoRubro);
                StorageService.guardarRubros(rubrosDisponibles);
                actualizarSelectRubros();
                mostrarToast(`📂 Rubro "${nuevoRubro}" creado`, "success");
            }
            $("prodRubro").value = nuevoRubro;
        }
        cerrarModal("modalNuevoRubro");
    }

    /** Valida y guarda (alta o edición) un producto del catálogo. */
    function guardarProducto() {
        const codigo = $("prodCodigo").value.trim();
        const nombre = $("prodNombre").value.trim();

        if (!codigo || !nombre) {
            mostrarToast("❌ El código y el nombre son obligatorios", "error");
            return;
        }

        productosDB[codigo] = StorageService.sanitizarProducto({
            nombre,
            descripcion: (productosDB[codigo] && productosDB[codigo].descripcion) || "",
            rubro: $("prodRubro").value,
            costo: $("prodCosto").value,
            porcentaje: $("prodPorcentaje").value,
            precioVenta: $("prodPrecioVenta").value,
            stock: $("prodStock").value,
            limiteStock: $("prodLimiteStock").value,
        });

        StorageService.guardarProductos(productosDB);
        limpiarFormularioProducto();
        renderListaProductos();
        mostrarToast("💾 Producto guardado correctamente", "success");
    }

    /** Carga un producto existente en el formulario para edición. */
    function editarProducto(codigo) {
        const producto = productosDB[codigo];
        if (!producto) return;

        $("tituloFormProducto").textContent = "📝 Editar Producto";
        $("prodCodigo").value = codigo;
        $("prodCodigo").disabled = true;
        $("prodNombre").value = producto.nombre;
        $("prodRubro").value = producto.rubro;
        $("prodCosto").value = producto.costo;
        $("prodPorcentaje").value = producto.porcentaje;
        $("prodPrecioVenta").value = producto.precioVenta;
        $("prodStock").value = producto.stock;
        $("prodLimiteStock").value = producto.limiteStock;

        $("prodNombre").scrollIntoView({ behavior: "smooth", block: "center" });
    }

    /** Elimina un producto del catálogo tras confirmación. */
    function eliminarProducto(codigo) {
        const producto = productosDB[codigo];
        const nombre = producto ? producto.nombre : codigo;

        confirmar(
            `¿Eliminar "${nombre}" (código ${codigo}) del catálogo? Esta acción no se puede deshacer.`,
            () => {
                delete productosDB[codigo];
                StorageService.guardarProductos(productosDB);
                renderListaProductos();
                mostrarToast("🗑️ Producto eliminado", "info");
            },
            { titulo: "Eliminar producto", textoAceptar: "Eliminar" }
        );
    }

    /** Restablece el formulario de productos a su estado de "Nuevo producto". */
    function limpiarFormularioProducto() {
        $("tituloFormProducto").textContent = "Nuevo / Editar Producto";
        $("prodCodigo").disabled = false;
        $("formProducto").reset();
    }

    /**
     * Renderiza el listado del catálogo (ABM) aplicando el filtro de
     * búsqueda. Para evitar degradar el rendimiento con catálogos muy
     * grandes, se limita la cantidad de tarjetas renderizadas
     * simultáneamente a `LIMITE_ABM`, mostrando un aviso si hay más
     * resultados disponibles.
     */
    function renderListaProductos() {
        const contenedor = $("listaABM");
        if (!contenedor) return;

        const consulta = $("buscadorABM").value.toLowerCase().trim();
        const codigos = Object.keys(productosDB).filter((codigo) => {
            if (!consulta) return true;
            const producto = productosDB[codigo];
            return producto.nombre.toLowerCase().includes(consulta) || codigo.toLowerCase().includes(consulta);
        });

        contenedor.innerHTML = "";

        if (codigos.length === 0) {
            contenedor.innerHTML = '<p class="table__empty">No se encontraron productos.</p>';
            return;
        }

        codigos
            .sort((a, b) => productosDB[a].nombre.localeCompare(productosDB[b].nombre))
            .slice(0, LIMITE_ABM)
            .forEach((codigo) => {
                const producto = productosDB[codigo];
                const stockCritico = producto.stock <= (producto.limiteStock || 0);

                const item = document.createElement("div");
                item.className = `abm-item${stockCritico ? " abm-item--critical" : ""}`;
                item.innerHTML = `
                    <div class="abm-item__info">
                        <div class="abm-item__code">${Helpers.escaparHtml(codigo)} · ${Helpers.escaparHtml(producto.rubro)}</div>
                        <div class="abm-item__name">${Helpers.escaparHtml(producto.nombre)}</div>
                        <div class="abm-item__stock${stockCritico ? " abm-item__stock--critical" : ""}">
                            Stock: ${producto.stock}${stockCritico ? " ⚠️ Stock crítico" : ""}
                        </div>
                    </div>
                    <div class="u-text-right">
                        <div class="abm-item__price">${Helpers.formatearMoneda(producto.precioVenta)}</div>
                        <div class="abm-item__actions">
                            <button type="button" class="btn btn--ghost btn--xs btn--auto" data-accion="editar" data-codigo="${Helpers.escaparHtml(codigo)}" aria-label="Editar ${Helpers.escaparHtml(producto.nombre)}">✏️</button>
                            <button type="button" class="btn btn--danger btn--xs btn--auto" data-accion="eliminar" data-codigo="${Helpers.escaparHtml(codigo)}" aria-label="Eliminar ${Helpers.escaparHtml(producto.nombre)}">🗑️</button>
                        </div>
                    </div>
                `;
                contenedor.appendChild(item);
            });

        if (codigos.length > LIMITE_ABM) {
            const aviso = document.createElement("p");
            aviso.className = "abm-list__notice";
            aviso.textContent = `Mostrando ${LIMITE_ABM} de ${codigos.length} productos. Refina la búsqueda para ver más resultados.`;
            contenedor.appendChild(aviso);
        }
    }

    /** Exporta el catálogo completo a un archivo CSV descargable. */
    function exportarCatalogoCSV() {
        const codigos = Object.keys(productosDB);
        if (codigos.length === 0) {
            mostrarToast("No hay productos para exportar", "info");
            return;
        }

        const filas = ['"Codigo","Nombre","Rubro","Costo","Porcentaje","PrecioVenta","Stock","LimiteStock"'];
        codigos.forEach((codigo) => {
            const p = productosDB[codigo];
            filas.push(
                [Helpers.escaparCsv(codigo), Helpers.escaparCsv(p.nombre), Helpers.escaparCsv(p.rubro), p.costo, p.porcentaje, p.precioVenta, p.stock, p.limiteStock].join(",")
            );
        });

        Helpers.descargarTexto(filas.join("\n"), `catalogo_productos_${new Date().toISOString().split("T")[0]}.csv`, "text/csv;charset=utf-8;");
        mostrarToast("📥 Catálogo exportado a CSV", "success");
    }



  
    function manejarArchivoImportado(evento) {
        const archivo = evento.target.files && evento.target.files[0];
        if (!archivo) return;

        const lector = new FileReader();
        lector.onload = (e) => {
            evento.target.value = "";
            try {
                prepararImportacionCatalogo(String(e.target.result || ""));
            } catch (error) {
                console.error("Error al procesar el archivo de importación:", error);
                mostrarToast("❌ No se pudo procesar el archivo. Verifica que sea un CSV válido.", "error");
            }
        };
        lector.onerror = () => {
            evento.target.value = "";
            mostrarToast("❌ No se pudo leer el archivo seleccionado", "error");
        };
        lector.readAsText(archivo, "UTF-8");
    }

    /**
     * Intenta reconocer la fila de encabezados de un CSV de productos.
     * Solo se considera válida si identifica al menos las columnas
     * "codigo" y "nombre" (sin éstas, no hay forma de construir un
     * producto). Devuelve un mapeo {indiceColumna: nombreCampo} o
     * `null` si no se reconoce un encabezado válido.
     * @param {string[]} filaEncabezado
     * @returns {object|null}
     */
    function mapearEncabezadosProducto(filaEncabezado) {
        const mapeo = {};
        filaEncabezado.forEach((celda, indice) => {
            const clave = Helpers.normalizarClave(celda);
            if (REVERSO_CAMPOS_PRODUCTO[clave]) mapeo[indice] = REVERSO_CAMPOS_PRODUCTO[clave];
        });
        const campos = Object.values(mapeo);
        return campos.includes("codigo") && campos.includes("nombre") ? mapeo : null;
    }

    /**
     * Construye un producto sanitizado a partir de una fila del CSV y
     * el mapeo de columnas. Devuelve `null` si la fila no tiene código
     * o nombre (campos obligatorios).
     *
     * Si el código ya existe en el catálogo actual, se conserva su
     * `descripcion` (campo que el CSV no transporta) para no perder
     * datos que no forman parte del formato de importación/exportación.
     *
     * @param {string[]} fila
     * @param {object} mapeo {indiceColumna: nombreCampo}
     * @returns {{codigo: string, producto: object}|null}
     */
    function construirProductoDesdeFila(fila, mapeo) {
        const datos = {};
        Object.keys(mapeo).forEach((indice) => {
            datos[mapeo[indice]] = fila[Number(indice)];
        });

        const codigo = datos.codigo !== undefined ? String(datos.codigo).trim() : "";
        const nombre = datos.nombre !== undefined ? String(datos.nombre).trim() : "";
        if (!codigo || !nombre) return null;

        const producto = StorageService.sanitizarProducto({
            nombre,
            rubro: datos.rubro ? String(datos.rubro).trim().toUpperCase() : "ALMACÉN",
            costo: Helpers.normalizarNumeroLocal(datos.costo),
            porcentaje: Helpers.normalizarNumeroLocal(datos.porcentaje),
            precioVenta: Helpers.normalizarNumeroLocal(datos.precioVenta),
            stock: Helpers.normalizarNumeroLocal(datos.stock),
            limiteStock: Helpers.normalizarNumeroLocal(datos.limiteStock),
        });

        const existente = productosDB[codigo];
        if (existente && existente.descripcion) producto.descripcion = existente.descripcion;

        return { codigo, producto };
    }

    /**
     * Procesa el texto plano de un CSV de catálogo: detecta el
     * delimitador, reconoce (o infiere) las columnas, construye los
     * productos válidos y muestra el modal de confirmación con un
     * resumen de los cambios antes de aplicarlos.
     * @param {string} textoPlano
     */
    function prepararImportacionCatalogo(textoPlano) {
        const primeraLinea = (textoPlano.split(/\r?\n/).find((linea) => linea.trim() !== "") || "");
        const delimitador = Helpers.detectarDelimitadorCsv(primeraLinea);
        const filas = Helpers.parsearCsv(textoPlano, delimitador);

        if (filas.length === 0) {
            mostrarToast("❌ El archivo está vacío", "error");
            return;
        }

        let mapeo = mapearEncabezadosProducto(filas[0]);
        let filasDatos;

        if (mapeo) {
            // Encabezado reconocido: se descarta la primera fila.
            filasDatos = filas.slice(1);
        } else {
            // Sin encabezado reconocible: se usa el orden del archivo
            // exportado. Si la primera fila "parece" un encabezado
            // (la columna de costo no es numérica pero sí lo es en la
            // siguiente fila), también se descarta.
            mapeo = MAPEO_POSICIONAL_PRODUCTO;
            const indiceCosto = Number(Object.keys(mapeo).find((indice) => mapeo[indice] === "costo"));
            const valorCosto = filas[0][indiceCosto];
            const primeraFilaPareceEncabezado =
                filas.length > 1 &&
                valorCosto !== undefined &&
                !Number.isFinite(parseFloat(Helpers.normalizarNumeroLocal(valorCosto)));
            filasDatos = primeraFilaPareceEncabezado ? filas.slice(1) : filas;
        }

        const productosImportados = {};
        filasDatos.forEach((fila) => {
            const resultado = construirProductoDesdeFila(fila, mapeo);
            if (resultado) productosImportados[resultado.codigo] = resultado.producto;
        });

        const codigos = Object.keys(productosImportados);
        if (codigos.length === 0) {
            mostrarToast("❌ No se encontraron productos válidos (se requiere al menos Código y Nombre por fila)", "error");
            return;
        }

        let nuevos = 0;
        let actualizados = 0;
        codigos.forEach((codigo) => {
            if (productosDB[codigo]) actualizados += 1;
            else nuevos += 1;
        });

        const rubrosNuevos = Array.from(new Set(codigos.map((codigo) => productosImportados[codigo].rubro))).filter(
            (rubro) => !rubrosDisponibles.includes(rubro)
        );

        importacionPendiente = { productos: productosImportados, rubrosNuevos };
        mostrarResumenImportacion({ total: codigos.length, nuevos, actualizados, rubrosNuevos });
        abrirModal("modalImportarCatalogo");
    }

    /**
     * Renderiza el resumen de la importación pendiente dentro del
     * modal de confirmación.
     * @param {{total:number, nuevos:number, actualizados:number, rubrosNuevos:string[]}} resumen
     */
    function mostrarResumenImportacion({ total, nuevos, actualizados, rubrosNuevos }) {
        const contenedor = $("resumenImportacion");
        if (!contenedor) return;

        const filaRubros = rubrosNuevos.length
            ? `<div class="import-summary__row"><span>📂 Rubros nuevos a crear</span><strong>${Helpers.escaparHtml(rubrosNuevos.join(", "))}</strong></div>`
            : "";

        contenedor.innerHTML = `
            <div class="import-summary">
                <div class="import-summary__row"><span>📦 Filas válidas detectadas</span><strong>${total}</strong></div>
                <div class="import-summary__row"><span>🆕 Productos nuevos</span><strong>${nuevos}</strong></div>
                <div class="import-summary__row"><span>♻️ Productos a actualizar</span><strong>${actualizados}</strong></div>
                ${filaRubros}
            </div>
            <p class="u-text-sm u-text-muted u-mt-3">Elige cómo aplicar estos cambios:</p>
        `;
    }

    /**
     * Aplica la importación pendiente al catálogo.
     * @param {"combinar"|"reemplazar"} modo
     *   - "combinar": agrega los productos nuevos y actualiza los
     *     existentes (por código), conservando el resto del catálogo.
     *   - "reemplazar": descarta el catálogo actual por completo y lo
     *     sustituye por los productos importados.
     */
    function aplicarImportacion(modo) {
        if (!importacionPendiente) return;
        const { productos, rubrosNuevos } = importacionPendiente;
        const codigos = Object.keys(productos);

        if (modo === "reemplazar") {
            productosDB = { ...productos };
        } else {
            codigos.forEach((codigo) => {
                productosDB[codigo] = productos[codigo];
            });
        }

        if (rubrosNuevos.length) {
            rubrosDisponibles = Array.from(new Set([...rubrosDisponibles, ...rubrosNuevos]));
            StorageService.guardarRubros(rubrosDisponibles);
            actualizarSelectRubros();
        }

        StorageService.guardarProductos(productosDB);
        renderListaProductos();
        cerrarModal("modalImportarCatalogo");

        const detalleRubros = rubrosNuevos.length ? ` y ${rubrosNuevos.length} rubro(s) nuevo(s)` : "";
        const verbo = modo === "reemplazar" ? "Catálogo reemplazado" : "Importación completada";
        mostrarToast(`✅ ${verbo}: ${codigos.length} producto(s) procesado(s)${detalleRubros}`, "success");

        importacionPendiente = null;
    }

    // ==============================================================
    // SOLAPA 3: VENTAS REALIZADAS (HISTORIAL)
    // ==============================================================

    /** Inicializa los filtros del historial de ventas. */
    function initHistorial() {
        on(
            "buscarHistorialCliente",
            "input",
            Helpers.debounce(() => {
                paginacion.historial.pagina = 1;
                renderHistorial();
            }, 200)
        );
        on("buscarHistorialFecha", "change", () => {
            paginacion.historial.pagina = 1;
            renderHistorial();
        });
    }

    /**
     * Renderiza el historial de ventas (más recientes primero) con
     * filtros por cliente/fecha y paginación, para soportar miles de
     * registros sin degradar el rendimiento.
     */
    function renderHistorial() {
        const contenedor = $("contenedorListaTicketsMaestro");
        if (!contenedor) return;

        const filtroCliente = $("buscarHistorialCliente").value.toLowerCase().trim();
        const filtroFecha = $("buscarHistorialFecha").value;

        const filtrados = historialVentas
            .filter((venta) => {
                if (filtroCliente && !venta.cliente.toLowerCase().includes(filtroCliente)) return false;
                if (filtroFecha && venta.fechaIso.split("T")[0] !== filtroFecha) return false;
                return true;
            })
            .slice()
            .reverse();

        contenedor.innerHTML = "";

        if (filtrados.length === 0) {
            contenedor.innerHTML = '<p class="table__empty">No se encontraron ventas con esos filtros.</p>';
            $("paginacionHistorial").innerHTML = "";
            return;
        }

        const estado = paginacion.historial;
        const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAMANO_PAGINA_HISTORIAL));
        if (estado.pagina > totalPaginas) estado.pagina = totalPaginas;
        const inicio = (estado.pagina - 1) * TAMANO_PAGINA_HISTORIAL;

        filtrados.slice(inicio, inicio + TAMANO_PAGINA_HISTORIAL).forEach((venta) => {
            const itemsHtml = (venta.productos || [])
                .map(
                    (item) =>
                        `<div class="history-card__item"><span>${Helpers.formatearCantidad(item.cantidad)}x ${Helpers.escaparHtml(item.nombre)}</span><span>${Helpers.formatearMoneda(item.precio * Helpers.aDecimal(item.cantidad, 3, 0))}</span></div>`
                )
                .join("");

            let etiquetaPago = ETIQUETAS_METODO[venta.metodoPago] || venta.metodoPago;
            if (venta.metodoPago === "COMBINADO") {
                etiquetaPago = Object.keys(ETIQUETAS_METODO)
                    .filter((clave) => clave !== "COMBINADO" && Helpers.aNumero(venta.desglosePago[clave]) > 0)
                    .map((clave) => ETIQUETAS_METODO[clave])
                    .join(" + ");
            }

            const tarjeta = document.createElement("article");
            tarjeta.className = "history-card";
            tarjeta.innerHTML = `
                <div>
                    <div class="history-card__header">
                        <span>${Helpers.escaparHtml(venta.id)}</span>
                        <span>${Helpers.escaparHtml(venta.fechaFormateada)}</span>
                    </div>
                    <div class="history-card__client u-mt-2">👤 ${Helpers.escaparHtml(venta.cliente)}</div>
                    <div class="history-card__items u-mt-2">${itemsHtml}</div>
                </div>
                <div class="history-card__footer">
                    <span class="badge badge--neutral">${Helpers.escaparHtml(etiquetaPago)}</span>
                    <span class="history-card__total">${Helpers.formatearMoneda(venta.total)}</span>
                </div>
            `;
            contenedor.appendChild(tarjeta);
        });

        renderPaginacion("paginacionHistorial", estado, filtrados.length, TAMANO_PAGINA_HISTORIAL, renderHistorial);
    }

    // ==============================================================
    // SOLAPA 4: ESTADÍSTICAS DE VENTAS
    // ==============================================================

    /** Inicializa los filtros de la solapa de estadísticas. */
    function initEstadisticas() {
        on("filtoTipoVis", "change", renderEstadisticas);
        on("filtroFechaDesde", "change", renderEstadisticas);
        on("filtroFechaHasta", "change", renderEstadisticas);
    }

    /**
     * Calcula el acumulado de ventas por producto o por rubro dentro
     * del rango de fechas elegido y lo grafica con Chart.js, además de
     * listar el desglose en una tabla lateral.
     */
    function renderEstadisticas() {
        const canvas = $("graficoVentas");
        const listaDesglose = $("listaDesgloseStats");
        if (!canvas || !listaDesglose) return;

        const tipoVisualizacion = $("filtoTipoVis").value;
        const valorDesde = $("filtroFechaDesde").value;
        const valorHasta = $("filtroFechaHasta").value;

        const desde = valorDesde ? new Date(`${valorDesde}T00:00:00`) : null;
        const hasta = valorHasta ? new Date(`${valorHasta}T23:59:59`) : null;

        const { acumulador, granTotal } = POSCore.agruparEstadisticas(historialVentas, {
            tipo: tipoVisualizacion,
            desde,
            hasta,
        });

        $("totalAcumuladoStats").textContent = Helpers.formatearMoneda(granTotal);

        const entradas = Object.entries(acumulador).sort((a, b) => b[1] - a[1]);

        listaDesglose.innerHTML = "";
        if (entradas.length === 0) {
            listaDesglose.innerHTML = '<p class="stats-list__empty">No hay ventas registradas en el período seleccionado.</p>';
        } else {
            entradas.forEach(([clave, valor]) => {
                const fila = document.createElement("div");
                fila.className = "stats-list__item";
                fila.innerHTML = `<span>${Helpers.escaparHtml(clave)}</span><strong>${Helpers.formatearMoneda(valor)}</strong>`;
                listaDesglose.appendChild(fila);
            });
        }

        // Si la librería de gráficos no pudo cargarse (ej: sin red en
        // entornos de vista previa offline), se omite la creación del
        // gráfico y se informa de forma amigable sin romper el resto
        // de la solapa (el desglose textual y el total ya se muestran).
        if (typeof Chart === "undefined") {
            const wrapper = canvas.closest(".stats-canvas-wrap");
            if (wrapper && !wrapper.querySelector(".stats-canvas-wrap__error")) {
                const aviso = document.createElement("p");
                aviso.className = "table__empty stats-canvas-wrap__error";
                aviso.textContent = "No se pudo cargar la librería de gráficos (Chart.js).";
                wrapper.appendChild(aviso);
            }
            return;
        }

        const etiquetas = entradas.length ? entradas.map(([clave]) => clave) : ["Sin ventas en el período"];
        const datos = entradas.length ? entradas.map(([, valor]) => valor) : [0];

        const colorTexto = obtenerVariableCss("--color-text") || "#0f172a";
        const colorBorde = obtenerVariableCss("--color-border") || "#e2e8f0";
        const paleta = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

        if (graficoVentas) {
            graficoVentas.destroy();
        }

        const esCircular = tipoVisualizacion === "RUBRO";
        graficoVentas = new Chart(canvas.getContext("2d"), {
            type: esCircular ? "pie" : "bar",
            data: {
                labels: etiquetas,
                datasets: [
                    {
                        label: "Acumulado ($)",
                        data: datos,
                        backgroundColor: paleta,
                        borderRadius: esCircular ? 0 : 6,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: esCircular ? "right" : "top",
                        labels: { color: colorTexto },
                    },
                },
                scales: esCircular
                    ? {}
                    : {
                          x: { ticks: { color: colorTexto }, grid: { color: colorBorde } },
                          y: { ticks: { color: colorTexto }, grid: { color: colorBorde }, beginAtZero: true },
                      },
            },
        });
    }

    // ==============================================================
    // SOLAPA 5: CONTROL DE FIADOS (CUENTAS CORRIENTES)
    // ==============================================================

    /**
     * Intenta interpretar una fecha guardada en formato local
     * "DD/MM/AAAA[, ]HH:MM:SS" (el formato que produce
     * `Helpers.formatearFechaHora` en configuraciones regionales
     * es-AR) y devuelve solo la porción de fecha como objeto `Date`.
     * Devuelve `null` si el formato no es reconocible.
     * @param {string} fechaHora
     * @returns {Date|null}
     */
    function parsearFechaRegistro(fechaHora) {
        if (!fechaHora) return null;
        const soloFecha = fechaHora.split(" ")[0].split(",")[0];
        const partes = soloFecha.split("/");
        if (partes.length !== 3) return null;
        const [dia, mes, anio] = partes;
        const fecha = new Date(`${anio}-${Helpers.pad(mes)}-${Helpers.pad(dia)}`);
        return Number.isNaN(fecha.getTime()) ? null : fecha;
    }

    /** Inicializa formularios, filtros y exportación/importación de la solapa de fiados. */
    function initFiados() {
        on("formularioFiado", "submit", (evento) => {
            evento.preventDefault();
            registrarMovimientoFiado();
        });
        on("btn-cancelar-fiado", "click", cancelarEdicionFiado);

        on(
            "buscar-nombre-fiado",
            "input",
            Helpers.debounce(() => {
                paginacion.fiados.pagina = 1;
                renderFiados();
            }, 200)
        );
        on("buscar-fecha-inicio-fiado", "change", () => {
            paginacion.fiados.pagina = 1;
            renderFiados();
        });
        on("buscar-fecha-fin-fiado", "change", () => {
            paginacion.fiados.pagina = 1;
            renderFiados();
        });

        on("btnExportarFiados", "click", exportarFiadosFiltrados);
        on("btnImportarFiados", "click", importarRegistrosFiado);

        on("tabla-registros-fiados", "click", (evento) => {
            const boton = evento.target.closest("button[data-accion]");
            if (!boton) return;
            if (boton.dataset.accion === "editar") editarFiado(boton.dataset.id);
            else if (boton.dataset.accion === "eliminar") eliminarFiado(boton.dataset.id);
        });
    }

    /** Devuelve los registros de fiados que pasan los filtros activos. */
    function obtenerFiadosFiltrados() {
        const filtroNombre = $("buscar-nombre-fiado").value.toLowerCase().trim();
        const valorDesde = $("buscar-fecha-inicio-fiado").value;
        const valorHasta = $("buscar-fecha-fin-fiado").value;
        const desde = valorDesde ? new Date(valorDesde) : null;
        const hasta = valorHasta ? new Date(`${valorHasta}T23:59:59`) : null;

        return registrosFiados.filter((registro) => {
            if (filtroNombre && !registro.nombre.toLowerCase().includes(filtroNombre)) return false;
            if (desde || hasta) {
                const fechaRegistro = parsearFechaRegistro(registro.fechaHora);
                if (fechaRegistro) {
                    if (desde && fechaRegistro < desde) return false;
                    if (hasta && fechaRegistro > hasta) return false;
                }
            }
            return true;
        });
    }

    /** Renderiza la tabla de fiados (filtrada y paginada) y el balance neto. */
    function renderFiados() {
        const cuerpo = $("tabla-registros-fiados");
        if (!cuerpo) return;

        const filtrados = obtenerFiadosFiltrados().slice().reverse();
        cuerpo.innerHTML = "";

        if (filtrados.length === 0) {
            cuerpo.innerHTML = '<tr><td colspan="5" class="table__empty">No se encontraron registros.</td></tr>';
            $("paginacionFiados").innerHTML = "";
        } else {
            const estado = paginacion.fiados;
            const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAMANO_PAGINA_FIADOS));
            if (estado.pagina > totalPaginas) estado.pagina = totalPaginas;
            const inicio = (estado.pagina - 1) * TAMANO_PAGINA_FIADOS;

            filtrados.slice(inicio, inicio + TAMANO_PAGINA_FIADOS).forEach((registro) => {
                const fila = document.createElement("tr");
                const esDeuda = registro.tipo === "DEUDA";
                fila.innerHTML = `
                    <td class="td--muted">${Helpers.escaparHtml(registro.fechaHora)}</td>
                    <td class="td--strong">${Helpers.escaparHtml(registro.nombre)}</td>
                    <td class="td--center"><span class="badge ${esDeuda ? "badge--deuda" : "badge--pago"}">${esDeuda ? "Fió" : "Pagó"}</span></td>
                    <td class="td--right ${esDeuda ? "td--danger" : "td--success"}">${Helpers.formatearMoneda(registro.monto)}</td>
                    <td class="td--center">
                        <div class="table-actions">
                            <button type="button" class="btn btn--ghost btn--xs btn--auto" data-accion="editar" data-id="${registro.id}" aria-label="Editar registro de ${Helpers.escaparHtml(registro.nombre)}">✏️</button>
                            <button type="button" class="btn btn--danger btn--xs btn--auto" data-accion="eliminar" data-id="${registro.id}" aria-label="Eliminar registro de ${Helpers.escaparHtml(registro.nombre)}">🗑️</button>
                        </div>
                    </td>
                `;
                cuerpo.appendChild(fila);
            });

            renderPaginacion("paginacionFiados", estado, filtrados.length, TAMANO_PAGINA_FIADOS, renderFiados);
        }

        const balance = POSCore.calcularBalanceFiados(registrosFiados);
        $("total-general-fiados").textContent = Helpers.formatearMoneda(balance);
    }

    /** Registra (alta o edición) un movimiento de cuenta corriente. */
    function registrarMovimientoFiado() {
        const idEdicion = $("edit-id-fiado").value;
        const nombre = $("nombreFiado").value.trim();
        const monto = Helpers.aNumero($("montoFiado").value);
        const tipo = $("tipoFiado").value === "PAGO" ? "PAGO" : "DEUDA";

        if (!nombre) {
            mostrarToast("❌ El nombre del cliente es obligatorio", "error");
            return;
        }
        if (monto <= 0) {
            mostrarToast("❌ El monto debe ser mayor a cero", "error");
            return;
        }

        if (idEdicion) {
            const indice = registrosFiados.findIndex((registro) => registro.id === idEdicion);
            if (indice !== -1) {
                registrosFiados[indice] = { ...registrosFiados[indice], nombre, monto, tipo };
            }
            mostrarToast("💾 Registro actualizado", "success");
        } else {
            registrosFiados.push({
                id: Helpers.generarId("FD"),
                nombre,
                monto,
                tipo,
                fechaHora: Helpers.formatearFechaHora(new Date()),
            });
            mostrarToast("💾 Movimiento registrado", "success");
        }

        StorageService.guardarFiados(registrosFiados);
        cancelarEdicionFiado();
        paginacion.fiados.pagina = 1;
        renderFiados();
        actualizarEfectivoCaja();
    }

    /** Carga un registro de fiado en el formulario para edición. */
    function editarFiado(id) {
        const registro = registrosFiados.find((item) => item.id === id);
        if (!registro) return;

        $("titulo-formulario-fiado").textContent = "📝 Editar Registro de Cuenta";
        $("edit-id-fiado").value = registro.id;
        $("nombreFiado").value = registro.nombre;
        $("montoFiado").value = registro.monto;
        $("tipoFiado").value = registro.tipo;
        $("nombreFiado").scrollIntoView({ behavior: "smooth", block: "center" });
    }

    /** Restablece el formulario de fiados a su estado de "Nuevo registro". */
    function cancelarEdicionFiado() {
        $("titulo-formulario-fiado").textContent = "Nuevo Registro de Cuenta";
        $("edit-id-fiado").value = "";
        $("formularioFiado").reset();
    }

    /** Elimina un registro de cuenta corriente tras confirmación. */
    function eliminarFiado(id) {
        const registro = registrosFiados.find((item) => item.id === id);
        if (!registro) return;

        confirmar(
            `¿Eliminar el registro de "${registro.nombre}" por ${Helpers.formatearMoneda(registro.monto)}?`,
            () => {
                registrosFiados = registrosFiados.filter((item) => item.id !== id);
                StorageService.guardarFiados(registrosFiados);
                renderFiados();
                actualizarEfectivoCaja();
                mostrarToast("🗑️ Registro eliminado", "info");
            },
            { titulo: "Eliminar registro de cuenta" }
        );
    }

    /**
     * Copia al portapapeles los registros de fiados actualmente
     * filtrados, uno por línea, en formato
     * `fechaHora|nombre|tipo|monto` — compatible con `importarRegistrosFiado`.
     */
    function exportarFiadosFiltrados() {
        const filtrados = obtenerFiadosFiltrados();
        if (filtrados.length === 0) {
            mostrarToast("No hay registros para copiar con los filtros actuales", "info");
            return;
        }

        const texto = filtrados.map((r) => `${r.fechaHora}|${r.nombre}|${r.tipo}|${r.monto}`).join("\n");

        copiarAlPortapapeles(texto)
            .then(() => mostrarToast(`📋 ${filtrados.length} registro(s) copiados al portapapeles`, "success"))
            .catch(() => mostrarToast("❌ No se pudo acceder al portapapeles del dispositivo", "error"));
    }

    /**
     * Procesa el texto pegado en el área de importación (formato
     * `fechaHora|nombre|tipo|monto`, una línea por registro) y agrega
     * los registros válidos a las cuentas corrientes.
     */
    function importarRegistrosFiado() {
        const textarea = $("texto-importar-fiado");
        if (!textarea) return;

        const lineas = textarea.value.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lineas.length === 0) {
            mostrarToast("Pega registros en el formato fecha|nombre|tipo|monto", "info");
            return;
        }

        let importados = 0;
        lineas.forEach((linea) => {
            const partes = linea.split("|").map((p) => p.trim());
            if (partes.length < 4) return;

            const [fechaHora, nombre, tipoCrudo, montoCrudo] = partes;
            const monto = Helpers.aNumero(montoCrudo);
            if (!nombre || monto <= 0) return;

            registrosFiados.push({
                id: Helpers.generarId("FD"),
                nombre,
                monto,
                tipo: tipoCrudo.toUpperCase() === "PAGO" ? "PAGO" : "DEUDA",
                fechaHora: fechaHora || Helpers.formatearFechaHora(new Date()),
            });
            importados += 1;
        });

        if (importados === 0) {
            mostrarToast("❌ No se reconoció ningún registro válido (formato: fecha|nombre|tipo|monto)", "error");
            return;
        }

        StorageService.guardarFiados(registrosFiados);
        textarea.value = "";
        paginacion.fiados.pagina = 1;
        renderFiados();
        actualizarEfectivoCaja();
        mostrarToast(`✅ ${importados} registro(s) importado(s) correctamente`, "success");
    }

    /**
     * Copia un texto al portapapeles, con respaldo (`execCommand`) para
     * navegadores/WebViews sin soporte de la Clipboard API moderna.
     * @param {string} texto
     * @returns {Promise<void>}
     */
    function copiarAlPortapapeles(texto) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(texto);
        }
        return new Promise((resolve, reject) => {
            try {
                const area = document.createElement("textarea");
                area.value = texto;
                area.style.position = "fixed";
                area.style.opacity = "0";
                document.body.appendChild(area);
                area.select();
                document.execCommand("copy");
                document.body.removeChild(area);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    // ==============================================================
    // SOLAPA 6: PAGO A PROVEEDORES
    // ==============================================================

    /** Inicializa el formulario, filtros y acciones de la solapa de proveedores. */
    function initProveedores() {
        on("formularioProveedor", "submit", (evento) => {
            evento.preventDefault();
            registrarPagoProveedor();
        });
        on("btn-cancelar-prov", "click", cancelarEdicionProveedor);

        on(
            "buscar-proveedor-input",
            "input",
            Helpers.debounce(() => {
                paginacion.proveedores.pagina = 1;
                renderProveedores();
            }, 200)
        );

        on("tabla-registros-proveedores", "click", (evento) => {
            const boton = evento.target.closest("button[data-accion]");
            if (!boton) return;
            if (boton.dataset.accion === "editar") editarProveedor(boton.dataset.id);
            else if (boton.dataset.accion === "eliminar") eliminarProveedor(boton.dataset.id);
        });
    }

    /** Registra (alta o edición) un pago/egreso a proveedor. */
    function registrarPagoProveedor() {
        const idEdicion = $("edit-id-proveedor").value;
        const nombre = $("provNombreGasto").value.trim();
        const monto = Helpers.aNumero($("provMontoGasto").value);
        const detalle = $("provDetalleGasto").value.trim() || "Gasto";

        if (!nombre) {
            mostrarToast("❌ El nombre del proveedor es obligatorio", "error");
            return;
        }
        if (monto <= 0) {
            mostrarToast("❌ El monto debe ser mayor a cero", "error");
            return;
        }

        if (idEdicion) {
            const indice = registrosProveedores.findIndex((registro) => registro.id === idEdicion);
            if (indice !== -1) {
                registrosProveedores[indice] = { ...registrosProveedores[indice], nombre, monto, detalle };
            }
            mostrarToast("💾 Registro actualizado", "success");
        } else {
            registrosProveedores.push({
                id: Helpers.generarId("PROV"),
                nombre,
                monto,
                detalle,
                fecha: Helpers.formatearFechaHora(new Date()),
            });
            mostrarToast("💾 Registro guardado", "success");
        }

        StorageService.guardarProveedores(registrosProveedores);
        cancelarEdicionProveedor();
        paginacion.proveedores.pagina = 1;
        renderProveedores();
        actualizarEfectivoCaja();
    }

    /**
     * Renderiza la tabla de pagos a proveedores (filtrada y paginada).
     * El KPI superior refleja la suma de los registros que cumplen el
     * filtro actual (no el total histórico global).
     */
    function renderProveedores() {
        const cuerpo = $("tabla-registros-proveedores");
        if (!cuerpo) return;

        const filtro = $("buscar-proveedor-input").value.toLowerCase().trim();
        const filtrados = registrosProveedores
            .filter((registro) => !filtro || registro.nombre.toLowerCase().includes(filtro))
            .slice()
            .reverse();

        const totalFiltrado = filtrados.reduce((acumulado, registro) => acumulado + registro.monto, 0);
        $("total-gastos-proveedores").textContent = Helpers.formatearMoneda(totalFiltrado);

        cuerpo.innerHTML = "";

        if (filtrados.length === 0) {
            cuerpo.innerHTML = '<tr><td colspan="5" class="table__empty">No se encontraron registros.</td></tr>';
            $("paginacionProveedores").innerHTML = "";
            return;
        }

        const estado = paginacion.proveedores;
        const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAMANO_PAGINA_PROVEEDORES));
        if (estado.pagina > totalPaginas) estado.pagina = totalPaginas;
        const inicio = (estado.pagina - 1) * TAMANO_PAGINA_PROVEEDORES;

        filtrados.slice(inicio, inicio + TAMANO_PAGINA_PROVEEDORES).forEach((registro) => {
            const fila = document.createElement("tr");
            fila.innerHTML = `
                <td class="td--muted">${Helpers.escaparHtml(registro.fecha)}</td>
                <td class="td--strong">${Helpers.escaparHtml(registro.nombre)}</td>
                <td>${Helpers.escaparHtml(registro.detalle)}</td>
                <td class="td--right td--danger">${Helpers.formatearMoneda(registro.monto)}</td>
                <td class="td--center">
                    <div class="table-actions">
                        <button type="button" class="btn btn--ghost btn--xs btn--auto" data-accion="editar" data-id="${registro.id}" aria-label="Editar registro de ${Helpers.escaparHtml(registro.nombre)}">✏️</button>
                        <button type="button" class="btn btn--danger btn--xs btn--auto" data-accion="eliminar" data-id="${registro.id}" aria-label="Eliminar registro de ${Helpers.escaparHtml(registro.nombre)}">🗑️</button>
                    </div>
                </td>
            `;
            cuerpo.appendChild(fila);
        });

        renderPaginacion("paginacionProveedores", estado, filtrados.length, TAMANO_PAGINA_PROVEEDORES, renderProveedores);
    }

    /** Carga un registro de proveedor en el formulario para edición. */
    function editarProveedor(id) {
        const registro = registrosProveedores.find((item) => item.id === id);
        if (!registro) return;

        $("titulo-form-proveedor").textContent = "📝 Editar Registro";
        $("edit-id-proveedor").value = registro.id;
        $("provNombreGasto").value = registro.nombre;
        $("provMontoGasto").value = registro.monto;
        $("provDetalleGasto").value = registro.detalle;
        $("btn-cancelar-prov").classList.remove("u-hidden");
        $("provNombreGasto").scrollIntoView({ behavior: "smooth", block: "center" });
    }

    /** Restablece el formulario de proveedores a su estado de "Nuevo registro". */
    function cancelarEdicionProveedor() {
        $("titulo-form-proveedor").textContent = "Registrar Pago / Factura";
        $("edit-id-proveedor").value = "";
        $("formularioProveedor").reset();
        $("btn-cancelar-prov").classList.add("u-hidden");
    }

    /** Elimina un registro de proveedor tras confirmación. */
    function eliminarProveedor(id) {
        const registro = registrosProveedores.find((item) => item.id === id);
        if (!registro) return;

        confirmar(
            `¿Eliminar el registro de "${registro.nombre}" por ${Helpers.formatearMoneda(registro.monto)}?`,
            () => {
                registrosProveedores = registrosProveedores.filter((item) => item.id !== id);
                StorageService.guardarProveedores(registrosProveedores);
                renderProveedores();
                actualizarEfectivoCaja();
                mostrarToast("🗑️ Registro eliminado", "info");
            },
            { titulo: "Eliminar registro de proveedor" }
        );
    }

    // ==============================================================
    // CAJA MAESTRA (Efectivo estimado)
    // ==============================================================

    /** Recalcula y muestra el efectivo estimado en caja en el header. */
    function actualizarEfectivoCaja() {
        const efectivo = POSCore.calcularEfectivoEnCaja(historialVentas, registrosFiados, registrosProveedores);
        const elemento = $("txtEfectivoEnCajaGlobal");
        if (elemento) elemento.textContent = Helpers.formatearMoneda(efectivo);
    }

    // ==============================================================
    // INICIALIZACIÓN GENERAL
    // ==============================================================

    /**
     * Punto de entrada de la aplicación. Carga el estado desde
     * `StorageService`, conecta todos los listeners y realiza el
     * primer renderizado de cada panel.
     */
    function init() {
        cerrarTodosLosModales();

        const semilla = StorageService.inicializar();
        productosDB = semilla.productos;
        rubrosDisponibles = semilla.rubros;
        historialVentas = StorageService.cargarVentas();
        registrosFiados = StorageService.cargarFiados();
        registrosProveedores = StorageService.cargarProveedores();

        initTema();
        initTabs();
        initModales();
        initCaja();
        initProductos();
        initHistorial();
        initEstadisticas();
        initFiados();
        initProveedores();

        // Rango por defecto de estadísticas: desde el primer día del mes hasta hoy.
        const hoy = new Date();
        const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const inputDesde = $("filtroFechaDesde");
        const inputHasta = $("filtroFechaHasta");
        if (inputDesde) inputDesde.value = primerDiaMes.toISOString().split("T")[0];
        if (inputHasta) inputHasta.value = hoy.toISOString().split("T")[0];

        renderTicket();
        renderListaProductos();
        renderHistorial();
        renderFiados();
        renderProveedores();
        actualizarEfectivoCaja();
        sincronizarVisibilidadClienteFiado();

        // El gráfico se crea tras el primer pintado; si la solapa de
        // estadísticas no está activa se recreará correctamente al
        // visitarla (ver `cambiarSolapa`).
        requestAnimationFrame(renderEstadisticas);
    }

    return Object.freeze({ init });
})();
