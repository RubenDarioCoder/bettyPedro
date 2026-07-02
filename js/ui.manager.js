
const UIManager = (function () {
    "use strict";

    // ----------------------------------------------------------------
    // Constantes
    // ----------------------------------------------------------------
    const TAMANO_PAGINA_HISTORIAL  = 12;
    const TAMANO_PAGINA_FIADOS     = 10;
    const TAMANO_PAGINA_PROVEEDORES= 10;
    const LIMITE_ABM               = 150;

    const COMBO_IDS = Object.freeze({
        EFECTIVO: "compEfectivo", DEBITO: "compDebito", CREDITO: "compCredito",
        TRANSFERENCIA: "compTransf", FIADO: "compFiado",
    });
    const ETIQUETAS_METODO = Object.freeze({
        EFECTIVO: "Efectivo", DEBITO: "Débito", CREDITO: "Crédito",
        TRANSFERENCIA: "Transf/MP", FIADO: "Fiado", COMBINADO: "Combinado",
    });
    const MAPA_CAMPOS_PRODUCTO = Object.freeze({
        codigo:      ["codigo","cod","sku","codbarra","codigobarras","codigodebarras","ean","barcode"],
        nombre:      ["nombre","producto","descripcion","articulo","item","detalle"],
        rubro:       ["rubro","categoria","seccion","familia","departamento","tipo"],
        costo:       ["costo","coste","preciocosto","costounitario","preciocompra"],
        porcentaje:  ["porcentaje","ganancia","margen","porcentajeganancia","%"],
        precioVenta: ["precioventa","precio","pvp","preciodeventa","precioventaajustado","precioventafinal"],
        stock:       ["stock","cantidad","existencia","existencias","unidades"],
        limiteStock: ["limitestock","minimo","stockminimo","minimocritico","limite","stockcritico"],
    });
    const REVERSO_CAMPOS_PRODUCTO = (function () {
        const r = {};
        Object.keys(MAPA_CAMPOS_PRODUCTO).forEach(campo =>
            MAPA_CAMPOS_PRODUCTO[campo].forEach(v => (r[v] = campo)));
        return r;
    })();
    const MAPEO_POSICIONAL_PRODUCTO = Object.freeze({
        0:"codigo",1:"nombre",2:"rubro",3:"costo",4:"porcentaje",5:"precioVenta",6:"stock",7:"limiteStock",
    });

    // ----------------------------------------------------------------
    // Estado privado
    // ----------------------------------------------------------------
    let productosDB          = {};
    let rubrosDisponibles    = [];
    let historialVentas      = [];
    let registrosFiados      = [];
    let registrosProveedores = [];
    let modoPagoCombinado    = false;
    let graficoVentas        = null;
    let confirmCallback      = null;
    let importacionPendiente = null;
    let backupPendiente      = null;

    const paginacion = {
        historial:   { pagina: 1 },
        fiados:      { pagina: 1 },
        proveedores: { pagina: 1 },
    };

    // ----------------------------------------------------------------
    // Utilidades de DOM
    // ----------------------------------------------------------------
    function $(id)                    { return document.getElementById(id); }
    function on(id, ev, fn)           { const el = $(id); if (el) el.addEventListener(ev, fn); }
    function obtenerVariableCss(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

    // ================================================================
    // TEMA
    // ================================================================
    function aplicarTema(tema) {
        document.documentElement.setAttribute("data-theme", tema);
        const btn = $("themeToggleBtn");
        if (btn) {
            btn.setAttribute("aria-pressed", tema === "dark" ? "true" : "false");
            btn.setAttribute("aria-label", tema === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
        }
        const sol  = document.querySelector(".theme-toggle__icon-sun");
        const luna = document.querySelector(".theme-toggle__icon-moon");
        if (sol)  sol.classList.toggle("u-hidden", tema === "dark");
        if (luna) luna.classList.toggle("u-hidden", tema !== "dark");
    }
    function alternarTema() {
        const nuevo = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        aplicarTema(nuevo);
        StorageService.guardarTema(nuevo);
        if (graficoVentas) renderEstadisticas();
    }
    function initTema() {
        const guardado = StorageService.cargarTema();
        const prefiereOscuro = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        aplicarTema(guardado || (prefiereOscuro ? "dark" : "light"));
        on("themeToggleBtn", "click", alternarTema);
    }

    // ================================================================
    // TOAST
    // ================================================================
    let _toastTimer = null;
    function mostrarToast(mensaje, tipo) {
        const t = $("toast");
        if (!t) return;
        t.textContent = mensaje;
        t.classList.remove("toast--success","toast--error","toast--info");
        t.classList.add(`toast--${tipo || "info"}`, "toast--visible");
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => t.classList.remove("toast--visible"), 2600);
    }

    // ================================================================
    // MODALES
    // ================================================================
    function abrirModal(id) {
        const m = $(id); if (!m) return;
        m.classList.add("modal-overlay--open");
        m.setAttribute("aria-hidden", "false");
    }
    function cerrarModal(id) {
        const m = $(id); if (!m) return;
        m.classList.remove("modal-overlay--open");
        m.setAttribute("aria-hidden", "true");
    }
    function cerrarTodosLosModales() {
        ["modalTicketImpreso","modalNuevoRubro","modalConfirmacion",
         "modalImportarCatalogo","modalRestaurar"].forEach(cerrarModal);
    }
    function confirmar(mensaje, onAceptar, opciones) {
        const opts = opciones || {};
        const m = $("modalConfirmacion");
        if (!m) { if (window.confirm(mensaje)) onAceptar(); return; }
        $("confirmMensaje").textContent = mensaje;
        $("confirmTitulo").textContent  = opts.titulo       || "Confirmar acción";
        $("btnConfirmAceptar").textContent = opts.textoAceptar || "Eliminar";
        confirmCallback = onAceptar;
        abrirModal("modalConfirmacion");
    }
    function initModales() {
        on("btnConfirmCancelar","click",() => { confirmCallback = null; cerrarModal("modalConfirmacion"); });
        on("btnConfirmAceptar", "click",() => {
            const cb = confirmCallback; confirmCallback = null;
            cerrarModal("modalConfirmacion");
            if (typeof cb === "function") cb();
        });
        ["modalNuevoRubro","modalConfirmacion","modalImportarCatalogo","modalRestaurar"].forEach(id => {
            const ov = $(id); if (!ov) return;
            ov.addEventListener("click", ev => {
                if (ev.target !== ov) return;
                if (id === "modalConfirmacion") confirmCallback = null;
                if (id === "modalImportarCatalogo") importacionPendiente = null;
                if (id === "modalRestaurar") backupPendiente = null;
                cerrarModal(id);
            });
        });
    }

    // ================================================================
    // TABS
    // ================================================================
    function initTabs() {
        document.querySelectorAll(".tabs__btn").forEach(btn =>
            btn.addEventListener("click", () => cambiarSolapa(btn.dataset.tab)));
    }
    function cambiarSolapa(id) {
        document.querySelectorAll(".tabs__btn").forEach(b =>
            b.classList.toggle("tabs__btn--active", b.dataset.tab === id));
        document.querySelectorAll(".tab-panel").forEach(p =>
            p.classList.toggle("tab-panel--active", p.id === id));
        const mapa = {
            "solapa-productos": renderListaProductos,
            "solapa-historial-ventas": renderHistorial,
            "solapa-estadisticas": renderEstadisticas,
            "solapa-fiados": renderFiados,
            "solapa-proveedores": renderProveedores,
        };
        if (mapa[id]) mapa[id]();
    }

    // ================================================================
    // PAGINACIÓN
    // ================================================================
    function renderPaginacion(contenedorId, estado, totalItems, tamano, onCambiar) {
        const c = $(contenedorId); if (!c) return;
        const totalPag = Math.max(1, Math.ceil(totalItems / tamano));
        if (estado.pagina > totalPag) estado.pagina = totalPag;
        if (estado.pagina < 1)        estado.pagina = 1;
        c.innerHTML = "";
        if (totalItems <= tamano) return;

        const btnPrev = document.createElement("button");
        btnPrev.type = "button"; btnPrev.className = "btn btn--ghost pagination__btn";
        btnPrev.textContent = "← Anterior"; btnPrev.disabled = estado.pagina <= 1;
        btnPrev.addEventListener("click", () => { estado.pagina--; onCambiar(); });

        const info = document.createElement("span");
        info.className = "pagination__info";
        info.textContent = `Página ${estado.pagina} de ${totalPag} · ${totalItems} registros`;

        const btnNext = document.createElement("button");
        btnNext.type = "button"; btnNext.className = "btn btn--ghost pagination__btn";
        btnNext.textContent = "Siguiente →"; btnNext.disabled = estado.pagina >= totalPag;
        btnNext.addEventListener("click", () => { estado.pagina++; onCambiar(); });

        c.appendChild(btnPrev); c.appendChild(info); c.appendChild(btnNext);
    }

    // ================================================================
    // BACKUP / RESTORE
    // ================================================================
    function initBackup() {
        const menu = $("menuBackup");

        on("btnBackupMenu", "click", ev => {
            ev.stopPropagation();
            if (menu) menu.classList.toggle("u-hidden");
        });
        document.addEventListener("click", () => {
            if (menu && !menu.classList.contains("u-hidden")) menu.classList.add("u-hidden");
        });

        on("btnExportarBackup", "click", () => {
            if (menu) menu.classList.add("u-hidden");
            const { nombre, contenido } = StorageService.exportarTodo();
            Helpers.descargarTexto(contenido, nombre, "application/json;charset=utf-8;");
            mostrarToast("✅ Copia guardada: " + nombre, "success");
        });

        on("btnTriggerRestaurar", "click", () => {
            if (menu) menu.classList.add("u-hidden");
            const inp = $("inputRestaurarBackup");
            if (inp) { inp.value = ""; inp.click(); }
        });

        on("inputRestaurarBackup", "change", ev => {
            const archivo = ev.target.files && ev.target.files[0];
            if (!archivo) return;
            const lector = new FileReader();
            lector.onload = e => {
                ev.target.value = "";
                try { prepararRestauracion(JSON.parse(e.target.result)); }
                catch { mostrarToast("❌ El archivo no es un JSON válido", "error"); }
            };
            lector.onerror = () => mostrarToast("❌ No se pudo leer el archivo", "error");
            lector.readAsText(archivo, "UTF-8");
        });

        on("btnRestaurarReemplazar", "click", () => aplicarRestauracion("reemplazar"));
        on("btnRestaurarCombinar",   "click", () => aplicarRestauracion("combinar"));
        on("btnCancelarRestaurar",   "click", () => { backupPendiente = null; cerrarModal("modalRestaurar"); });
    }

    function prepararRestauracion(backup) {
        if (!backup || typeof backup !== "object") {
            mostrarToast("❌ El archivo no contiene datos válidos", "error"); return;
        }
        backupPendiente = backup;
        const prods = backup.productos   ? Object.keys(backup.productos).length : 0;
        const rubs  = Array.isArray(backup.rubros)      ? backup.rubros.length      : 0;
        const vents = Array.isArray(backup.ventas)      ? backup.ventas.length      : 0;
        const fiad  = Array.isArray(backup.fiados)      ? backup.fiados.length      : 0;
        const provs = Array.isArray(backup.proveedores) ? backup.proveedores.length : 0;
        const fecha = backup.generadoEn ? Helpers.formatearFechaHora(new Date(backup.generadoEn)) : "desconocida";
        const c = $("resumenBackup");
        if (c) c.innerHTML = `
            <p class="u-text-sm u-text-muted u-mb-3">
                Archivo generado el <strong>${Helpers.escaparHtml(fecha)}</strong>.
                Revisá el resumen antes de aplicar:
            </p>
            <div class="backup-summary">
                <div class="backup-summary__row"><span>📦 Productos en catálogo</span><strong>${prods}</strong></div>
                <div class="backup-summary__row"><span>📂 Rubros</span><strong>${rubs}</strong></div>
                <div class="backup-summary__row"><span>🧾 Tickets de venta</span><strong>${vents}</strong></div>
                <div class="backup-summary__row"><span>👥 Fiados (cuentas corrientes)</span><strong>${fiad}</strong></div>
                <div class="backup-summary__row"><span>🚚 Pagos a proveedores</span><strong>${provs}</strong></div>
            </div>`;
        abrirModal("modalRestaurar");
    }

    function aplicarRestauracion(modo) {
        if (!backupPendiente) return;
        cerrarModal("modalRestaurar");
        const resultado = StorageService.restaurarTodo(backupPendiente, modo);
        backupPendiente = null;
        if (!resultado.ok) { mostrarToast("❌ " + resultado.mensaje, "error"); return; }

        productosDB          = resultado.productos;
        rubrosDisponibles    = resultado.rubros;
        historialVentas      = resultado.ventas;
        registrosFiados      = resultado.fiados;
        registrosProveedores = resultado.proveedores;

        actualizarSelectRubros();
        renderTicket();
        renderListaProductos();
        paginacion.historial.pagina = paginacion.fiados.pagina = paginacion.proveedores.pagina = 1;
        renderHistorial(); renderFiados(); renderProveedores(); renderEstadisticas();
        actualizarEfectivoCaja();

        const r = resultado.resumen;
        mostrarToast(
            `✅ ${modo === "reemplazar" ? "Restauración" : "Combinación"} completada — ` +
            `${r.productos} productos · ${r.ventas} ventas · ${r.fiados} fiados · ${r.proveedores} proveedores`,
            "success"
        );
    }

    // ================================================================
    // CAJA / VENTAS
    // ================================================================
    function initCaja() {
        const scanner = $("scannerInput");
        if (scanner) {
            scanner.addEventListener("keydown", ev => {
                if (ev.key === "Enter") { ev.preventDefault(); agregarPorCodigo(scanner.value.trim()); }
            });
        }
        on("btnScannerManual","click",() => agregarPorCodigo(($("scannerInput") || {}).value?.trim()));

        // Click en botones del ticket (sumar / restar / eliminar)
        on("cuerpoTicket","click", ev => {
            const btn = ev.target.closest("button[data-accion]"); if (!btn) return;
            const idx = Helpers.aEntero(btn.dataset.index, -1);
            if (btn.dataset.accion === "sumar")    POSCore.cambiarCantidad(idx,  1);
            if (btn.dataset.accion === "restar")   POSCore.cambiarCantidad(idx, -1);
            if (btn.dataset.accion === "eliminar") POSCore.eliminarItem(idx);
            renderTicket();
        });

        // Cambio manual de cantidad tipeada (acepta coma decimal: "0,550")
        on("cuerpoTicket","change", ev => {
            const inp = ev.target.closest(".ticket-cantidad-input"); if (!inp) return;
            const idx = Helpers.aEntero(inp.dataset.index, -1); if (idx === -1) return;
            POSCore.establecerCantidad(idx, inp.value); // aDecimal interno
            renderTicket();
        });
        // Enter en el input de cantidad = confirmar
        on("cuerpoTicket","keydown", ev => {
            if (ev.key !== "Enter") return;
            const inp = ev.target.closest(".ticket-cantidad-input"); if (!inp) return;
            ev.preventDefault(); inp.blur();
        });

        initBuscadorVentas();

        on("btnAlternarCombinado","click", alternarModoPagoCombinado);
        Object.keys(COMBO_IDS).forEach(m =>
            on(COMBO_IDS[m],"input",() => { actualizarPagoCombinado(); actualizarVuelto(); }));

        on("metodoPago","change",() => { sincronizarVisibilidadClienteFiado(); actualizarVuelto(); });
        on("pagaConInput","input", actualizarVuelto);

        on("btnCancelarTicket","click",() => {
            if (!POSCore.obtenerTicket().length) return;
            confirmar("¿Vaciar el ticket actual? Se perderán los productos agregados.",
                () => { POSCore.vaciarTicket(); renderTicket(); mostrarToast("🧹 Ticket vaciado","info"); },
                { titulo:"Vaciar ticket", textoAceptar:"Vaciar" });
        });
        on("btnFinalizarVenta","click", finalizarVenta);
        on("btnCerrarModalTicket","click",() => { cerrarModal("modalTicketImpreso"); mostrarToast("✅ Listo para una nueva venta","success"); });
    }

    function sincronizarVisibilidadClienteFiado() {
        const g = $("grupoClienteFiado"); if (!g) return;
        const muestra = modoPagoCombinado || $("metodoPago").value === "FIADO";
        g.classList.toggle("u-hidden", !muestra);
        if (muestra) { const inp = $("clienteFiadoNombre"); if (inp && document.activeElement !== inp) inp.focus(); }
    }

    function leerDesgloseCombinado() {
        const d = {};
        Object.keys(COMBO_IDS).forEach(m => {
            const inp = $(COMBO_IDS[m]);
            d[m] = Helpers.aNumero(inp ? inp.value : 0);
        });
        return d;
    }

    function alternarModoPagoCombinado() {
        modoPagoCombinado = !modoPagoCombinado;
        $("panelPagoSimple").classList.toggle("u-hidden", modoPagoCombinado);
        $("panelPagoCombinado").classList.toggle("u-hidden", !modoPagoCombinado);
        const btn = $("btnAlternarCombinado");
        btn.textContent = modoPagoCombinado ? "⬅️ Pago Simple" : "➕ Combinar Pagos";
        btn.classList.toggle("btn--ghost",   !modoPagoCombinado);
        btn.classList.toggle("btn--neutral",  modoPagoCombinado);
        sincronizarVisibilidadClienteFiado();
        actualizarPagoCombinado();
        actualizarVuelto();
    }

    function actualizarPagoCombinado() {
        const txt = $("txtMontoRestanteCombinado"); if (!txt || !modoPagoCombinado) return;
        const total = POSCore.calcularTotalTicket();
        const { restante, cubierto } = POSCore.validarCobroCombinado(total, leerDesgloseCombinado());
        txt.classList.remove("payment-combo__remaining--ok","payment-combo__remaining--pending");
        if (cubierto) {
            txt.textContent = "✅ Total cubierto correctamente";
            txt.classList.add("payment-combo__remaining--ok");
        } else {
            txt.textContent = restante > 0
                ? `Faltan cubrir: ${Helpers.formatearMoneda(restante)}`
                : `Excede el total por: ${Helpers.formatearMoneda(Math.abs(restante))}`;
            txt.classList.add("payment-combo__remaining--pending");
        }
    }

    function actualizarVuelto() {
        const caja = $("vueltoBox"); if (!caja) return;
        const total      = POSCore.calcularTotalTicket();
        const pagaCon    = Helpers.aNumero($("pagaConInput").value);
        const metodoPago = $("metodoPago").value;
        const desglose   = modoPagoCombinado ? leerDesgloseCombinado() : null;
        const { aplica, vuelto } = POSCore.calcularVuelto({ total, pagaCon, esCombinado: modoPagoCombinado, desglose, metodoPago });
        caja.classList.remove("change-box--positive");
        if (!aplica) { caja.textContent = "El pago electrónico cubre el total exacto (sin vuelto)"; return; }
        caja.textContent = `Vuelto a entregar: ${Helpers.formatearMoneda(vuelto)}`;
        if (vuelto > 0) caja.classList.add("change-box--positive");
    }

    function initBuscadorVentas() {
        const inp = $("buscadorNombreVentas");
        const res = $("resultadosBuscador");
        if (!inp || !res) return;

        const buscar = Helpers.debounce(() => {
            const q = inp.value.toLowerCase().trim();
            res.innerHTML = "";
            if (q.length < 2) { res.classList.remove("search-combo__results--open"); return; }
            const found = [];
            for (const cod in productosDB) {
                if (!Object.prototype.hasOwnProperty.call(productosDB, cod)) continue;
                const p = productosDB[cod];
                if (p.nombre.toLowerCase().includes(q) || cod.toLowerCase().includes(q)) {
                    found.push({ cod, p });
                    if (found.length >= 8) break;
                }
            }
            found.forEach(({ cod, p }) => {
                const op = document.createElement("div");
                op.className = "search-combo__option";
                op.setAttribute("role","button"); op.setAttribute("tabindex","0");
                op.innerHTML = `<strong>${Helpers.escaparHtml(p.nombre)}</strong> <span>· ${Helpers.formatearMoneda(p.precioVenta)} · Stock: ${Helpers.formatearCantidad(p.stock)}</span>`;
                const seleccionar = () => { agregarPorCodigo(cod); inp.value = ""; res.innerHTML = ""; res.classList.remove("search-combo__results--open"); };
                op.addEventListener("click", seleccionar);
                op.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); seleccionar(); } });
                res.appendChild(op);
            });
            res.classList.toggle("search-combo__results--open", found.length > 0);
        }, 150);

        inp.addEventListener("input", buscar);
        inp.addEventListener("focus", buscar);
        document.addEventListener("click", ev => { if (ev.target !== inp && !res.contains(ev.target)) res.classList.remove("search-combo__results--open"); });
    }

    function agregarPorCodigo(codigo) {
        if (!codigo) return;
        const producto = productosDB[codigo];
        if (!producto) { mostrarToast(`❌ Código "${codigo}" no encontrado en el catálogo`, "error"); return; }
        POSCore.agregarProducto(codigo, producto);
        const s = $("scannerInput");
        if (s) { s.value = ""; s.focus(); }
        renderTicket();
    }

    /** Renderiza la tabla del ticket con columnas: Producto | Cant | Precio | Subtotal | Acción */
    function renderTicket() {
        const cuerpo = $("cuerpoTicket"); if (!cuerpo) return;
        const ticket = POSCore.obtenerTicket();
        cuerpo.innerHTML = "";

        if (ticket.length === 0) {
            cuerpo.innerHTML = `<tr><td colspan="5" class="ticket-table__empty">🛒 El ticket está vacío. Escanee o busque un producto para comenzar.</td></tr>`;
            actualizarTotalesTicket(0);
            return;
        }

        ticket.forEach((item, idx) => {
            // Precio es entero (sin centavos). Subtotal = precio × cantidad decimal, redondeado.
            const subtotal = Helpers.redondear2(item.precio * item.cantidad);
            const fila = document.createElement("tr");
            fila.innerHTML = `
                <td class="ticket-table__name">
                    <strong>${Helpers.escaparHtml(item.nombre)}</strong>
                    <br><small class="u-text-muted">${Helpers.escaparHtml(item.codigo)}</small>
                </td>
                <td class="ticket-table__qty">
                    <div class="qty-stepper">
                        <button type="button" class="qty-stepper__btn" data-accion="restar" data-index="${idx}" aria-label="Restar">−</button>
                        <input type="text"
                            class="ticket-cantidad-input field__input"
                            data-index="${idx}"
                            value="${Helpers.formatearCantidad(item.cantidad)}"
                            inputmode="decimal"
                            autocomplete="off"
                            aria-label="Cantidad">
                        <button type="button" class="qty-stepper__btn" data-accion="sumar" data-index="${idx}" aria-label="Sumar">+</button>
                    </div>
                </td>
                <td class="ticket-table__price">${Helpers.formatearMoneda(item.precio)}</td>
                <td class="ticket-table__subtotal">${Helpers.formatearMoneda(subtotal)}</td>
                <td class="ticket-table__remove">
                    <button type="button" class="icon-btn" data-accion="eliminar" data-index="${idx}" aria-label="Quitar ítem">🗑️</button>
                </td>`;
            cuerpo.appendChild(fila);
        });

        actualizarTotalesTicket(POSCore.calcularTotalTicket());
    }

    function actualizarTotalesTicket(total) {
        const el = $("totalVenta");
        if (el) el.textContent = Helpers.formatearMoneda(total);
        actualizarPagoCombinado();
        actualizarVuelto();
    }

    function finalizarVenta() {
        const items = POSCore.obtenerTicket();
        if (!items.length) { mostrarToast("❌ El ticket está vacío","error"); return; }

        const total = POSCore.calcularTotalTicket();
        const nombreCliente = $("clienteFiadoNombre").value.trim();
        let metodoPago, desglosePago = Object.assign({}, StorageService.DESGLOSE_PAGO_VACIO);

        if (modoPagoCombinado) {
            desglosePago = leerDesgloseCombinado();
            if (!POSCore.validarCobroCombinado(total, desglosePago).cubierto) {
                mostrarToast("❌ Los montos combinados no coinciden con el total a cobrar","error"); return;
            }
            if (desglosePago.FIADO > 0 && !nombreCliente) {
                mostrarToast("❌ Ingresa el nombre del cliente para registrar la porción a fiado","error"); return;
            }
            metodoPago = "COMBINADO";
        } else {
            metodoPago = $("metodoPago").value;
            if (metodoPago === "FIADO" && !nombreCliente) {
                mostrarToast("❌ Ingresa el nombre del cliente para registrar el fiado","error"); return;
            }
            desglosePago[metodoPago] = total;
        }

        const pagaCon = Helpers.aNumero($("pagaConInput").value);
        const venta   = POSCore.construirVenta({ total, cliente: nombreCliente, metodoPago, desglosePago, pagaCon, items });

        POSCore.descontarStock(productosDB, items);
        StorageService.guardarProductos(productosDB);
        historialVentas.push(venta);
        StorageService.guardarVentas(historialVentas);

        const montoFiado = modoPagoCombinado ? desglosePago.FIADO : (metodoPago === "FIADO" ? total : 0);
        if (montoFiado > 0) {
            registrosFiados.push({ id: Helpers.generarId("FD"), nombre: venta.cliente, monto: Helpers.redondear2(montoFiado), tipo: "DEUDA", fechaHora: venta.fechaFormateada });
            StorageService.guardarFiados(registrosFiados);
        }

        mostrarComprobante(venta, pagaCon, venta.vueltoEntregado);

        POSCore.vaciarTicket();
        $("pagaConInput").value = "";
        $("clienteFiadoNombre").value = "";
        Object.keys(COMBO_IDS).forEach(m => { const i = $(COMBO_IDS[m]); if (i) i.value = "0"; });
        renderTicket();
        renderListaProductos();
        paginacion.historial.pagina = 1;
        renderHistorial();
        if (montoFiado > 0) { paginacion.fiados.pagina = 1; renderFiados(); }
        actualizarEfectivoCaja();
    }

    function mostrarComprobante(venta, pagaCon, vuelto) {
        const c = $("contenidoTicketImpreso"); if (!c) return;

        const lineas = (venta.productos || []).map(item => {
            const subtotal = Helpers.redondear2(item.precio * item.cantidad);
            return `
                <div class="receipt__line-name">${Helpers.escaparHtml(item.nombre)}</div>
                <div class="receipt__line-detail">
                    <span>${Helpers.formatearCantidad(item.cantidad)} x ${Helpers.formatearMoneda(item.precio)}</span>
                    <span>${Helpers.formatearMoneda(subtotal)}</span>
                </div>`;
        }).join("");

        let bloquePagos;
        if (venta.metodoPago === "COMBINADO") {
            const filas = Object.keys(ETIQUETAS_METODO)
                .filter(k => k !== "COMBINADO" && Helpers.aNumero(venta.desglosePago[k]) > 0)
                .map(k => `<div><span>${ETIQUETAS_METODO[k]}</span><span>${Helpers.formatearMoneda(venta.desglosePago[k])}</span></div>`)
                .join("");
            bloquePagos = `<div class="receipt__payments receipt__divider"><strong>Detalle del Pago Combinado:</strong>${filas}</div>`;
        } else {
            bloquePagos = `<div class="receipt__meta receipt__divider"><strong>Forma de Pago:</strong> ${Helpers.escaparHtml(ETIQUETAS_METODO[venta.metodoPago] || venta.metodoPago)}</div>`;
        }

        const bloqueCambio = pagaCon > 0 ? `
            <div class="receipt__change receipt__divider">
                <div class="receipt__change-row"><span>Entregado:</span><span>${Helpers.formatearMoneda(pagaCon)}</span></div>
                <div class="receipt__change-row"><span>Vuelto:</span><span>${Helpers.formatearMoneda(vuelto)}</span></div>
            </div>` : "";

        c.innerHTML = `
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
            ${bloquePagos}${bloqueCambio}
            <div class="receipt__thanks">¡ GRACIAS POR SU COMPRA !</div>`;

        abrirModal("modalTicketImpreso");
    }

    // ================================================================
    // GESTIÓN DE PRODUCTOS (ABM)
    // ================================================================
    function initProductos() {
        on("buscadorABM","input", Helpers.debounce(renderListaProductos, 200));
        on("prodCosto","input", actualizarPrecioVentaDinamico);
        on("prodPorcentaje","input", actualizarPrecioVentaDinamico);
        on("formProducto","submit", ev => { ev.preventDefault(); guardarProducto(); });
        on("btnLimpiarProdForm","click", limpiarFormularioProducto);
        on("btnAbrirModalRubro","click",() => {
            const inp = $("inputNuevoRubro"); if (inp) inp.value = "";
            abrirModal("modalNuevoRubro");
            if (inp) setTimeout(() => inp.focus(), 50);
        });
        on("btnGuardarNuevoRubro","click", guardarNuevoRubro);
        on("btnCerrarModalRubro","click",() => cerrarModal("modalNuevoRubro"));
        on("btnExportarCSV","click", exportarCatalogoCSV);
        on("btnDescargarPlantilla","click", descargarPlantillaCSV);
        on("btnImportarCSV","click",() => { const i = $("inputImportarCSV"); if (i) i.click(); });
        on("inputImportarCSV","change", manejarArchivoImportado);
        on("btnImportarCombinar","click",() => aplicarImportacion("combinar"));
        on("btnImportarReemplazar","click",() => {
            cerrarModal("modalImportarCatalogo");
            confirmar("Esta acción eliminará TODOS los productos actuales del catálogo. ¿Continuar?",
                () => aplicarImportacion("reemplazar"),
                { titulo:"Reemplazar catálogo completo", textoAceptar:"Reemplazar Todo" });
        });
        on("btnCancelarImportacion","click",() => { importacionPendiente = null; cerrarModal("modalImportarCatalogo"); });
        on("listaABM","click", ev => {
            const btn = ev.target.closest("button[data-accion]"); if (!btn) return;
            if (btn.dataset.accion === "editar")   editarProducto(btn.dataset.codigo);
            if (btn.dataset.accion === "eliminar") eliminarProducto(btn.dataset.codigo);
        });
        actualizarSelectRubros();
    }

    function actualizarPrecioVentaDinamico() {
        const costo      = Helpers.aDecimal($("prodCosto").value);
        const porcentaje = Helpers.aNumero($("prodPorcentaje").value);
        $("prodPrecioVenta").value = Helpers.redondear2(costo * (1 + porcentaje / 100));
    }

    function actualizarSelectRubros() {
        const sel = $("prodRubro"); if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = "";
        rubrosDisponibles.slice().sort().forEach(r => {
            const op = document.createElement("option"); op.value = r; op.textContent = r; sel.appendChild(op);
        });
        if (prev && rubrosDisponibles.includes(prev)) sel.value = prev;
    }

    function guardarNuevoRubro() {
        const inp = $("inputNuevoRubro"); if (!inp) return;
        const r = inp.value.trim().toUpperCase();
        if (r && !rubrosDisponibles.includes(r)) {
            rubrosDisponibles.push(r);
            StorageService.guardarRubros(rubrosDisponibles);
            actualizarSelectRubros();
            mostrarToast(`📂 Rubro "${r}" creado`, "success");
        }
        if (r) $("prodRubro").value = r;
        cerrarModal("modalNuevoRubro");
    }

    function guardarProducto() {
        const codigo = $("prodCodigo").value.trim();
        const nombre = $("prodNombre").value.trim();
        if (!codigo || !nombre) { mostrarToast("❌ El código y el nombre son obligatorios","error"); return; }

        productosDB[codigo] = StorageService.sanitizarProducto({
            nombre,
            descripcion: (productosDB[codigo] && productosDB[codigo].descripcion) || "",
            rubro:       $("prodRubro").value,
            costo:       $("prodCosto").value,
            porcentaje:  $("prodPorcentaje").value,
            precioVenta: $("prodPrecioVenta").value,
            stock:       $("prodStock").value,
            limiteStock: $("prodLimiteStock").value,
        });

        StorageService.guardarProductos(productosDB);
        limpiarFormularioProducto();
        renderListaProductos();
        mostrarToast("💾 Producto guardado correctamente","success");
    }

    function editarProducto(codigo) {
        const p = productosDB[codigo]; if (!p) return;
        $("tituloFormProducto").textContent = "📝 Editar Producto";
        $("prodCodigo").value    = codigo;
        $("prodCodigo").disabled = true;
        $("prodNombre").value    = p.nombre;
        $("prodRubro").value     = p.rubro;
        $("prodCosto").value     = p.costo;
        $("prodPorcentaje").value= p.porcentaje;
        $("prodPrecioVenta").value = p.precioVenta;
        $("prodStock").value     = Helpers.formatearCantidad(p.stock);
        $("prodLimiteStock").value = Helpers.formatearCantidad(p.limiteStock);
        $("prodNombre").scrollIntoView({ behavior:"smooth", block:"center" });
    }

    function eliminarProducto(codigo) {
        const nombre = (productosDB[codigo] || {}).nombre || codigo;
        confirmar(`¿Eliminar "${nombre}" (${codigo})? Esta acción no se puede deshacer.`,
            () => { delete productosDB[codigo]; StorageService.guardarProductos(productosDB); renderListaProductos(); mostrarToast("🗑️ Producto eliminado","info"); },
            { titulo:"Eliminar producto", textoAceptar:"Eliminar" });
    }

    function limpiarFormularioProducto() {
        $("tituloFormProducto").textContent = "Nuevo / Editar Producto";
        $("prodCodigo").disabled = false;
        $("formProducto").reset();
    }

    function renderListaProductos() {
        const cont = $("listaABM"); if (!cont) return;
        const q = $("buscadorABM").value.toLowerCase().trim();
        const codigos = Object.keys(productosDB).filter(cod => {
            if (!q) return true;
            return productosDB[cod].nombre.toLowerCase().includes(q) || cod.toLowerCase().includes(q);
        });
        cont.innerHTML = "";
        if (!codigos.length) { cont.innerHTML = '<p class="table__empty">No se encontraron productos.</p>'; return; }

        codigos.sort((a,b) => productosDB[a].nombre.localeCompare(productosDB[b].nombre))
               .slice(0, LIMITE_ABM)
               .forEach(cod => {
                   const p = productosDB[cod];
                   const critico = p.stock <= (p.limiteStock || 0);
                   const d = document.createElement("div");
                   d.className = `abm-item${critico ? " abm-item--critical" : ""}`;
                   d.innerHTML = `
                       <div class="abm-item__info">
                           <div class="abm-item__code">${Helpers.escaparHtml(cod)} · ${Helpers.escaparHtml(p.rubro)}</div>
                           <div class="abm-item__name">${Helpers.escaparHtml(p.nombre)}</div>
                           <div class="abm-item__stock${critico ? " abm-item__stock--critical" : ""}">
                               Stock: ${Helpers.formatearCantidad(p.stock)}${critico ? " ⚠️ Stock crítico" : ""}
                           </div>
                       </div>
                       <div class="u-text-right">
                           <div class="abm-item__price">${Helpers.formatearMoneda(p.precioVenta)}</div>
                           <div class="abm-item__actions">
                               <button type="button" class="btn btn--ghost btn--xs btn--auto" data-accion="editar"   data-codigo="${Helpers.escaparHtml(cod)}" aria-label="Editar">✏️</button>
                               <button type="button" class="btn btn--danger btn--xs btn--auto" data-accion="eliminar" data-codigo="${Helpers.escaparHtml(cod)}" aria-label="Eliminar">🗑️</button>
                           </div>
                       </div>`;
                   cont.appendChild(d);
               });

        if (codigos.length > LIMITE_ABM) {
            const av = document.createElement("p"); av.className = "abm-list__notice";
            av.textContent = `Mostrando ${LIMITE_ABM} de ${codigos.length}. Refina la búsqueda.`;
            cont.appendChild(av);
        }
    }

    function exportarCatalogoCSV() {
        const keys = Object.keys(productosDB);
        if (!keys.length) { mostrarToast("No hay productos para exportar","info"); return; }
        const filas = ['"Codigo","Nombre","Rubro","Costo","Porcentaje","PrecioVenta","Stock","LimiteStock"'];
        keys.forEach(cod => {
            const p = productosDB[cod];
            filas.push([Helpers.escaparCsv(cod), Helpers.escaparCsv(p.nombre), Helpers.escaparCsv(p.rubro), p.costo, p.porcentaje, p.precioVenta, p.stock, p.limiteStock].join(","));
        });
        Helpers.descargarTexto(filas.join("\n"), `catalogo_productos_${new Date().toISOString().split("T")[0]}.csv`, "text/csv;charset=utf-8;");
        mostrarToast("📥 Catálogo exportado a CSV","success");
    }

    function descargarPlantillaCSV() {
        const filas = ['"Codigo","Nombre","Rubro","Costo","Porcentaje","PrecioVenta","Stock","LimiteStock"'];
        (rubrosDisponibles.length ? rubrosDisponibles.slice().sort() : ["ALMACÉN"]).forEach((r, i) => {
            filas.push([Helpers.escaparCsv(`EJEMPLO${String(i+1).padStart(3,"0")}`), Helpers.escaparCsv(`Producto de ejemplo - ${r}`), Helpers.escaparCsv(r), 100, 50, 150, 10, 3].join(","));
        });
        Helpers.descargarTexto(filas.join("\n"), `plantilla_catalogo_${new Date().toISOString().split("T")[0]}.csv`, "text/csv;charset=utf-8;");
        mostrarToast("📄 Plantilla de ejemplo descargada","success");
    }

    function manejarArchivoImportado(ev) {
        const archivo = ev.target.files && ev.target.files[0]; if (!archivo) return;
        const lector = new FileReader();
        lector.onload = e => { ev.target.value = ""; try { prepararImportacionCatalogo(String(e.target.result || "")); } catch { mostrarToast("❌ No se pudo procesar el archivo CSV","error"); } };
        lector.onerror = () => { ev.target.value = ""; mostrarToast("❌ No se pudo leer el archivo","error"); };
        lector.readAsText(archivo, "UTF-8");
    }

    function mapearEncabezadosProducto(fila) {
        const m = {};
        fila.forEach((c, i) => { const k = Helpers.normalizarClave(c); if (REVERSO_CAMPOS_PRODUCTO[k]) m[i] = REVERSO_CAMPOS_PRODUCTO[k]; });
        const campos = Object.values(m);
        return campos.includes("codigo") && campos.includes("nombre") ? m : null;
    }

    function construirProductoDesdeFila(fila, mapeo) {
        const datos = {};
        Object.keys(mapeo).forEach(i => (datos[mapeo[i]] = fila[Number(i)]));
        const codigo = datos.codigo !== undefined ? String(datos.codigo).trim() : "";
        const nombre = datos.nombre !== undefined ? String(datos.nombre).trim() : "";
        if (!codigo || !nombre) return null;
        const p = StorageService.sanitizarProducto({
            nombre, rubro: datos.rubro ? String(datos.rubro).trim().toUpperCase() : "ALMACÉN",
            costo: Helpers.normalizarNumeroLocal(datos.costo),
            porcentaje: Helpers.normalizarNumeroLocal(datos.porcentaje),
            precioVenta: Helpers.normalizarNumeroLocal(datos.precioVenta),
            stock: Helpers.normalizarNumeroLocal(datos.stock),
            limiteStock: Helpers.normalizarNumeroLocal(datos.limiteStock),
        });
        if (productosDB[codigo] && productosDB[codigo].descripcion) p.descripcion = productosDB[codigo].descripcion;
        return { codigo, producto: p };
    }

    function prepararImportacionCatalogo(texto) {
        const primera = (texto.split(/\r?\n/).find(l => l.trim()) || "");
        const delim = Helpers.detectarDelimitadorCsv(primera);
        const filas = Helpers.parsearCsv(texto, delim);
        if (!filas.length) { mostrarToast("❌ El archivo está vacío","error"); return; }

        let mapeo = mapearEncabezadosProducto(filas[0]);
        let datos;
        if (mapeo) { datos = filas.slice(1); }
        else {
            mapeo = MAPEO_POSICIONAL_PRODUCTO;
            const idx = Number(Object.keys(mapeo).find(i => mapeo[i] === "costo"));
            const val = filas[0][idx];
            const pareceEncabezado = filas.length > 1 && val !== undefined && !Number.isFinite(parseFloat(Helpers.normalizarNumeroLocal(val)));
            datos = pareceEncabezado ? filas.slice(1) : filas;
        }

        const importados = {};
        datos.forEach(f => { const r = construirProductoDesdeFila(f, mapeo); if (r) importados[r.codigo] = r.producto; });
        const codigos = Object.keys(importados);
        if (!codigos.length) { mostrarToast("❌ No se encontraron productos válidos","error"); return; }

        let nuevos = 0, actualizados = 0;
        codigos.forEach(c => (productosDB[c] ? actualizados++ : nuevos++));
        const rubrosNuevos = Array.from(new Set(codigos.map(c => importados[c].rubro))).filter(r => !rubrosDisponibles.includes(r));

        importacionPendiente = { productos: importados, rubrosNuevos };
        const cont = $("resumenImportacion");
        if (cont) cont.innerHTML = `
            <div class="import-summary">
                <div class="import-summary__row"><span>📦 Filas válidas detectadas</span><strong>${codigos.length}</strong></div>
                <div class="import-summary__row"><span>🆕 Productos nuevos</span><strong>${nuevos}</strong></div>
                <div class="import-summary__row"><span>♻️ Productos a actualizar</span><strong>${actualizados}</strong></div>
                ${rubrosNuevos.length ? `<div class="import-summary__row"><span>📂 Rubros nuevos</span><strong>${Helpers.escaparHtml(rubrosNuevos.join(", "))}</strong></div>` : ""}
            </div>
            <p class="u-text-sm u-text-muted u-mt-3">Elige cómo aplicar estos cambios:</p>`;
        abrirModal("modalImportarCatalogo");
    }

    function aplicarImportacion(modo) {
        if (!importacionPendiente) return;
        const { productos, rubrosNuevos } = importacionPendiente;
        const codigos = Object.keys(productos);
        if (modo === "reemplazar") productosDB = { ...productos };
        else codigos.forEach(c => (productosDB[c] = productos[c]));
        if (rubrosNuevos.length) {
            rubrosDisponibles = Array.from(new Set([...rubrosDisponibles, ...rubrosNuevos]));
            StorageService.guardarRubros(rubrosDisponibles);
            actualizarSelectRubros();
        }
        StorageService.guardarProductos(productosDB);
        renderListaProductos();
        cerrarModal("modalImportarCatalogo");
        mostrarToast(`✅ ${modo === "reemplazar" ? "Catálogo reemplazado" : "Importación completada"}: ${codigos.length} producto(s)`, "success");
        importacionPendiente = null;
    }

    // ================================================================
    // HISTORIAL DE VENTAS
    // ================================================================
    function initHistorial() {
        on("buscarHistorialCliente","input", Helpers.debounce(() => { paginacion.historial.pagina = 1; renderHistorial(); }, 200));
        on("buscarHistorialFecha","change",() => { paginacion.historial.pagina = 1; renderHistorial(); });
    }

    function renderHistorial() {
        const cont = $("contenedorListaTicketsMaestro"); if (!cont) return;
        const fc = $("buscarHistorialCliente").value.toLowerCase().trim();
        const ff = $("buscarHistorialFecha").value;

        const filtrados = historialVentas
            .filter(v => {
                if (fc && !v.cliente.toLowerCase().includes(fc)) return false;
                if (ff && v.fechaIso.split("T")[0] !== ff) return false;
                return true;
            }).slice().reverse();

        cont.innerHTML = "";
        if (!filtrados.length) { cont.innerHTML = '<p class="table__empty">No se encontraron ventas con esos filtros.</p>'; $("paginacionHistorial").innerHTML = ""; return; }

        const estado = paginacion.historial;
        const totalPag = Math.max(1, Math.ceil(filtrados.length / TAMANO_PAGINA_HISTORIAL));
        if (estado.pagina > totalPag) estado.pagina = totalPag;
        const inicio = (estado.pagina - 1) * TAMANO_PAGINA_HISTORIAL;

        filtrados.slice(inicio, inicio + TAMANO_PAGINA_HISTORIAL).forEach(venta => {
            const itemsHtml = (venta.productos || []).map(item =>
                `<div class="history-card__item">
                    <span>${Helpers.formatearCantidad(item.cantidad)}x ${Helpers.escaparHtml(item.nombre)}</span>
                    <span>${Helpers.formatearMoneda(Helpers.redondear2(item.precio * item.cantidad))}</span>
                </div>`).join("");
            let etiquetaPago = ETIQUETAS_METODO[venta.metodoPago] || venta.metodoPago;
            if (venta.metodoPago === "COMBINADO") {
                etiquetaPago = Object.keys(ETIQUETAS_METODO)
                    .filter(k => k !== "COMBINADO" && Helpers.aNumero(venta.desglosePago[k]) > 0)
                    .map(k => ETIQUETAS_METODO[k]).join(" + ");
            }
            const tar = document.createElement("article");
            tar.className = "history-card";
            tar.innerHTML = `
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
                </div>`;
            cont.appendChild(tar);
        });
        renderPaginacion("paginacionHistorial", estado, filtrados.length, TAMANO_PAGINA_HISTORIAL, renderHistorial);
    }

    // ================================================================
    // ESTADÍSTICAS
    // ================================================================
    function initEstadisticas() {
        on("filtoTipoVis","change", renderEstadisticas);
        on("filtroFechaDesde","change", renderEstadisticas);
        on("filtroFechaHasta","change", renderEstadisticas);
    }

    function renderEstadisticas() {
        const canvas = $("graficoVentas");
        const lista  = $("listaDesgloseStats");
        if (!canvas || !lista) return;

        const tipo  = $("filtoTipoVis").value;
        const desde = $("filtroFechaDesde").value ? new Date(`${$("filtroFechaDesde").value}T00:00:00`) : null;
        const hasta = $("filtroFechaHasta").value ? new Date(`${$("filtroFechaHasta").value}T23:59:59`) : null;
        const { acumulador, granTotal } = POSCore.agruparEstadisticas(historialVentas, { tipo, desde, hasta });

        $("totalAcumuladoStats").textContent = Helpers.formatearMoneda(granTotal);
        const entradas = Object.entries(acumulador).sort((a,b) => b[1] - a[1]);

        lista.innerHTML = "";
        if (!entradas.length) { lista.innerHTML = '<p class="stats-list__empty">No hay ventas en el período seleccionado.</p>'; }
        else entradas.forEach(([k,v]) => {
            const f = document.createElement("div"); f.className = "stats-list__item";
            f.innerHTML = `<span>${Helpers.escaparHtml(k)}</span><strong>${Helpers.formatearMoneda(v)}</strong>`;
            lista.appendChild(f);
        });

        if (typeof Chart === "undefined") return;
        if (graficoVentas) graficoVentas.destroy();

        const colorTexto = obtenerVariableCss("--color-text") || "#0f172a";
        const colorBorde = obtenerVariableCss("--color-border") || "#e2e8f0";
        const paleta = ["#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#6366f1","#84cc16"];
        const esCircular = tipo === "RUBRO";
        const etqs = entradas.length ? entradas.map(([k]) => k) : ["Sin ventas"];
        const dats = entradas.length ? entradas.map(([,v]) => v) : [0];

        graficoVentas = new Chart(canvas.getContext("2d"), {
            type: esCircular ? "pie" : "bar",
            data: { labels: etqs, datasets: [{ label:"Acumulado ($)", data: dats, backgroundColor: paleta, borderRadius: esCircular ? 0 : 6 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: esCircular ? "right" : "top", labels: { color: colorTexto } } },
                scales: esCircular ? {} : {
                    x: { ticks: { color: colorTexto }, grid: { color: colorBorde } },
                    y: { ticks: { color: colorTexto }, grid: { color: colorBorde }, beginAtZero: true },
                },
            },
        });
    }

    // ================================================================
    // FIADOS
    // ================================================================
    function parsearFechaRegistro(fh) {
        if (!fh) return null;
        const partes = fh.split(" ")[0].split(",")[0].split("/");
        if (partes.length !== 3) return null;
        const [d,m,a] = partes;
        const f = new Date(`${a}-${Helpers.pad(m)}-${Helpers.pad(d)}`);
        return isNaN(f.getTime()) ? null : f;
    }

    function initFiados() {
        on("formularioFiado","submit", ev => { ev.preventDefault(); registrarMovimientoFiado(); });
        on("btn-cancelar-fiado","click", cancelarEdicionFiado);
        on("buscar-nombre-fiado","input", Helpers.debounce(() => { paginacion.fiados.pagina = 1; renderFiados(); }, 200));
        on("buscar-fecha-inicio-fiado","change",() => { paginacion.fiados.pagina = 1; renderFiados(); });
        on("buscar-fecha-fin-fiado",  "change",() => { paginacion.fiados.pagina = 1; renderFiados(); });
        on("btnExportarFiados","click", exportarFiadosFiltrados);
        on("btnImportarFiados","click", importarRegistrosFiado);
        on("tabla-registros-fiados","click", ev => {
            const btn = ev.target.closest("button[data-accion]"); if (!btn) return;
            if (btn.dataset.accion === "editar")   editarFiado(btn.dataset.id);
            if (btn.dataset.accion === "eliminar") eliminarFiado(btn.dataset.id);
        });
    }

    function obtenerFiadosFiltrados() {
        const fn = $("buscar-nombre-fiado").value.toLowerCase().trim();
        const vd = $("buscar-fecha-inicio-fiado").value;
        const vh = $("buscar-fecha-fin-fiado").value;
        const desde = vd ? new Date(vd) : null;
        const hasta = vh ? new Date(`${vh}T23:59:59`) : null;
        return registrosFiados.filter(r => {
            if (fn && !r.nombre.toLowerCase().includes(fn)) return false;
            if (desde || hasta) {
                const fr = parsearFechaRegistro(r.fechaHora);
                if (fr) { if (desde && fr < desde) return false; if (hasta && fr > hasta) return false; }
            }
            return true;
        });
    }

    function renderFiados() {
        const cuerpo = $("tabla-registros-fiados"); if (!cuerpo) return;
        const filtrados = obtenerFiadosFiltrados().slice().reverse();
        cuerpo.innerHTML = "";
        if (!filtrados.length) {
            cuerpo.innerHTML = '<tr><td colspan="5" class="table__empty">No se encontraron registros.</td></tr>';
            $("paginacionFiados").innerHTML = "";
        } else {
            const estado = paginacion.fiados;
            const totalPag = Math.max(1, Math.ceil(filtrados.length / TAMANO_PAGINA_FIADOS));
            if (estado.pagina > totalPag) estado.pagina = totalPag;
            const inicio = (estado.pagina - 1) * TAMANO_PAGINA_FIADOS;
            filtrados.slice(inicio, inicio + TAMANO_PAGINA_FIADOS).forEach(r => {
                const esDeuda = r.tipo === "DEUDA";
                const fila = document.createElement("tr");
                fila.innerHTML = `
                    <td class="td--muted">${Helpers.escaparHtml(r.fechaHora)}</td>
                    <td class="td--strong">${Helpers.escaparHtml(r.nombre)}</td>
                    <td class="td--center"><span class="badge ${esDeuda ? "badge--deuda" : "badge--pago"}">${esDeuda ? "Fió" : "Pagó"}</span></td>
                    <td class="td--right ${esDeuda ? "td--danger" : "td--success"}">${Helpers.formatearMoneda(r.monto)}</td>
                    <td class="td--center"><div class="table-actions">
                        <button type="button" class="btn btn--ghost btn--xs btn--auto" data-accion="editar"   data-id="${r.id}" aria-label="Editar">✏️</button>
                        <button type="button" class="btn btn--danger btn--xs btn--auto" data-accion="eliminar" data-id="${r.id}" aria-label="Eliminar">🗑️</button>
                    </div></td>`;
                cuerpo.appendChild(fila);
            });
            renderPaginacion("paginacionFiados", estado, filtrados.length, TAMANO_PAGINA_FIADOS, renderFiados);
        }
        $("total-general-fiados").textContent = Helpers.formatearMoneda(POSCore.calcularBalanceFiados(registrosFiados));
    }

    function registrarMovimientoFiado() {
        const id     = $("edit-id-fiado").value;
        const nombre = $("nombreFiado").value.trim();
        const monto  = Helpers.aNumero($("montoFiado").value);
        const tipo   = $("tipoFiado").value === "PAGO" ? "PAGO" : "DEUDA";
        if (!nombre) { mostrarToast("❌ El nombre del cliente es obligatorio","error"); return; }
        if (monto <= 0) { mostrarToast("❌ El monto debe ser mayor a cero","error"); return; }
        if (id) {
            const idx = registrosFiados.findIndex(r => r.id === id);
            if (idx !== -1) registrosFiados[idx] = { ...registrosFiados[idx], nombre, monto, tipo };
            mostrarToast("💾 Registro actualizado","success");
        } else {
            registrosFiados.push({ id: Helpers.generarId("FD"), nombre, monto, tipo, fechaHora: Helpers.formatearFechaHora(new Date()) });
            mostrarToast("💾 Movimiento registrado","success");
        }
        StorageService.guardarFiados(registrosFiados);
        cancelarEdicionFiado();
        paginacion.fiados.pagina = 1;
        renderFiados();
        actualizarEfectivoCaja();
    }

    function editarFiado(id) {
        const r = registrosFiados.find(i => i.id === id); if (!r) return;
        $("titulo-formulario-fiado").textContent = "📝 Editar Registro de Cuenta";
        $("edit-id-fiado").value  = r.id;
        $("nombreFiado").value    = r.nombre;
        $("montoFiado").value     = r.monto;
        $("tipoFiado").value      = r.tipo;
        $("nombreFiado").scrollIntoView({ behavior:"smooth", block:"center" });
    }

    function cancelarEdicionFiado() {
        $("titulo-formulario-fiado").textContent = "Nuevo Registro de Cuenta";
        $("edit-id-fiado").value = "";
        $("formularioFiado").reset();
    }

    function eliminarFiado(id) {
        const r = registrosFiados.find(i => i.id === id); if (!r) return;
        confirmar(`¿Eliminar el registro de "${r.nombre}" por ${Helpers.formatearMoneda(r.monto)}?`,
            () => { registrosFiados = registrosFiados.filter(i => i.id !== id); StorageService.guardarFiados(registrosFiados); renderFiados(); actualizarEfectivoCaja(); mostrarToast("🗑️ Registro eliminado","info"); },
            { titulo:"Eliminar registro de cuenta" });
    }

    function exportarFiadosFiltrados() {
        const filtrados = obtenerFiadosFiltrados();
        if (!filtrados.length) { mostrarToast("No hay registros para copiar","info"); return; }
        const texto = filtrados.map(r => `${r.fechaHora}|${r.nombre}|${r.tipo}|${r.monto}`).join("\n");
        copiarAlPortapapeles(texto)
            .then(() => mostrarToast(`📋 ${filtrados.length} registro(s) copiados al portapapeles`,"success"))
            .catch(() => mostrarToast("❌ No se pudo acceder al portapapeles","error"));
    }

    function importarRegistrosFiado() {
        const ta = $("texto-importar-fiado"); if (!ta) return;
        const lineas = ta.value.split("\n").map(l => l.trim()).filter(Boolean);
        if (!lineas.length) { mostrarToast("Pega registros en el formato fecha|nombre|tipo|monto","info"); return; }
        let importados = 0;
        lineas.forEach(l => {
            const [fh, nb, tc, mc] = l.split("|").map(p => p.trim());
            const monto = Helpers.aNumero(mc);
            if (!nb || monto <= 0) return;
            registrosFiados.push({ id: Helpers.generarId("FD"), nombre: nb, monto, tipo: tc?.toUpperCase() === "PAGO" ? "PAGO" : "DEUDA", fechaHora: fh || Helpers.formatearFechaHora(new Date()) });
            importados++;
        });
        if (!importados) { mostrarToast("❌ No se reconoció ningún registro válido","error"); return; }
        StorageService.guardarFiados(registrosFiados);
        ta.value = "";
        paginacion.fiados.pagina = 1;
        renderFiados();
        actualizarEfectivoCaja();
        mostrarToast(`✅ ${importados} registro(s) importado(s) correctamente`,"success");
    }

    function copiarAlPortapapeles(texto) {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
        return new Promise((res, rej) => {
            try {
                const a = document.createElement("textarea"); a.value = texto; a.style.cssText = "position:fixed;opacity:0";
                document.body.appendChild(a); a.select(); document.execCommand("copy"); document.body.removeChild(a); res();
            } catch(e) { rej(e); }
        });
    }

    // ================================================================
    // PROVEEDORES
    // ================================================================
    function initProveedores() {
        on("formularioProveedor","submit", ev => { ev.preventDefault(); registrarPagoProveedor(); });
        on("btn-cancelar-prov","click", cancelarEdicionProveedor);
        on("buscar-proveedor-input","input", Helpers.debounce(() => { paginacion.proveedores.pagina = 1; renderProveedores(); }, 200));
        on("tabla-registros-proveedores","click", ev => {
            const btn = ev.target.closest("button[data-accion]"); if (!btn) return;
            if (btn.dataset.accion === "editar")   editarProveedor(btn.dataset.id);
            if (btn.dataset.accion === "eliminar") eliminarProveedor(btn.dataset.id);
        });
    }

    function registrarPagoProveedor() {
        const id      = $("edit-id-proveedor").value;
        const nombre  = $("provNombreGasto").value.trim();
        const monto   = Helpers.aNumero($("provMontoGasto").value);
        const detalle = $("provDetalleGasto").value.trim() || "Gasto";
        if (!nombre) { mostrarToast("❌ El nombre del proveedor es obligatorio","error"); return; }
        if (monto <= 0) { mostrarToast("❌ El monto debe ser mayor a cero","error"); return; }
        if (id) {
            const idx = registrosProveedores.findIndex(r => r.id === id);
            if (idx !== -1) registrosProveedores[idx] = { ...registrosProveedores[idx], nombre, monto, detalle };
            mostrarToast("💾 Registro actualizado","success");
        } else {
            registrosProveedores.push({ id: Helpers.generarId("PROV"), nombre, monto, detalle, fecha: Helpers.formatearFechaHora(new Date()) });
            mostrarToast("💾 Registro guardado","success");
        }
        StorageService.guardarProveedores(registrosProveedores);
        cancelarEdicionProveedor();
        paginacion.proveedores.pagina = 1;
        renderProveedores();
        actualizarEfectivoCaja();
    }

    function renderProveedores() {
        const cuerpo = $("tabla-registros-proveedores"); if (!cuerpo) return;
        const q = $("buscar-proveedor-input").value.toLowerCase().trim();
        const filtrados = registrosProveedores.filter(r => !q || r.nombre.toLowerCase().includes(q)).slice().reverse();
        $("total-gastos-proveedores").textContent = Helpers.formatearMoneda(filtrados.reduce((a,r) => a + r.monto, 0));
        cuerpo.innerHTML = "";
        if (!filtrados.length) { cuerpo.innerHTML = '<tr><td colspan="5" class="table__empty">No se encontraron registros.</td></tr>'; $("paginacionProveedores").innerHTML = ""; return; }

        const estado = paginacion.proveedores;
        const totalPag = Math.max(1, Math.ceil(filtrados.length / TAMANO_PAGINA_PROVEEDORES));
        if (estado.pagina > totalPag) estado.pagina = totalPag;
        const inicio = (estado.pagina - 1) * TAMANO_PAGINA_PROVEEDORES;
        filtrados.slice(inicio, inicio + TAMANO_PAGINA_PROVEEDORES).forEach(r => {
            const fila = document.createElement("tr");
            fila.innerHTML = `
                <td class="td--muted">${Helpers.escaparHtml(r.fecha)}</td>
                <td class="td--strong">${Helpers.escaparHtml(r.nombre)}</td>
                <td>${Helpers.escaparHtml(r.detalle)}</td>
                <td class="td--right td--danger">${Helpers.formatearMoneda(r.monto)}</td>
                <td class="td--center"><div class="table-actions">
                    <button type="button" class="btn btn--ghost btn--xs btn--auto" data-accion="editar"   data-id="${r.id}" aria-label="Editar">✏️</button>
                    <button type="button" class="btn btn--danger btn--xs btn--auto" data-accion="eliminar" data-id="${r.id}" aria-label="Eliminar">🗑️</button>
                </div></td>`;
            cuerpo.appendChild(fila);
        });
        renderPaginacion("paginacionProveedores", estado, filtrados.length, TAMANO_PAGINA_PROVEEDORES, renderProveedores);
    }

    function editarProveedor(id) {
        const r = registrosProveedores.find(i => i.id === id); if (!r) return;
        $("titulo-form-proveedor").textContent = "📝 Editar Registro";
        $("edit-id-proveedor").value  = r.id;
        $("provNombreGasto").value    = r.nombre;
        $("provMontoGasto").value     = r.monto;
        $("provDetalleGasto").value   = r.detalle;
        $("btn-cancelar-prov").classList.remove("u-hidden");
        $("provNombreGasto").scrollIntoView({ behavior:"smooth", block:"center" });
    }

    function cancelarEdicionProveedor() {
        $("titulo-form-proveedor").textContent = "Registrar Pago / Factura";
        $("edit-id-proveedor").value = "";
        $("formularioProveedor").reset();
        $("btn-cancelar-prov").classList.add("u-hidden");
    }

    function eliminarProveedor(id) {
        const r = registrosProveedores.find(i => i.id === id); if (!r) return;
        confirmar(`¿Eliminar el registro de "${r.nombre}" por ${Helpers.formatearMoneda(r.monto)}?`,
            () => { registrosProveedores = registrosProveedores.filter(i => i.id !== id); StorageService.guardarProveedores(registrosProveedores); renderProveedores(); actualizarEfectivoCaja(); mostrarToast("🗑️ Registro eliminado","info"); },
            { titulo:"Eliminar registro de proveedor" });
    }

    // ================================================================
    // CAJA MAESTRA
    // ================================================================
    function actualizarEfectivoCaja() {
        const el = $("txtEfectivoEnCajaGlobal"); if (!el) return;
        el.textContent = Helpers.formatearMoneda(POSCore.calcularEfectivoEnCaja(historialVentas, registrosFiados, registrosProveedores));
    }

    // ================================================================
    // INIT
    // ================================================================
    function init() {
        cerrarTodosLosModales();
        const semilla = StorageService.inicializar();
        productosDB          = semilla.productos;
        rubrosDisponibles    = semilla.rubros;
        historialVentas      = StorageService.cargarVentas();
        registrosFiados      = StorageService.cargarFiados();
        registrosProveedores = StorageService.cargarProveedores();

        initTema(); initTabs(); initModales(); initBackup();
        initCaja(); initProductos(); initHistorial(); initEstadisticas();
        initFiados(); initProveedores();

        const hoy = new Date();
        const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const inputDesde = $("filtroFechaDesde"), inputHasta = $("filtroFechaHasta");
        if (inputDesde) inputDesde.value = primerDiaMes.toISOString().split("T")[0];
        if (inputHasta) inputHasta.value = hoy.toISOString().split("T")[0];

        renderTicket(); renderListaProductos(); renderHistorial();
        renderFiados(); renderProveedores(); actualizarEfectivoCaja();
        sincronizarVisibilidadClienteFiado();
        requestAnimationFrame(renderEstadisticas);
    }

    return Object.freeze({ init });
})();
