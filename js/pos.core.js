/**
 * =====================================================================
 *  POSCore — Núcleo de lógica de negocio. Sin DOM, sin localStorage.
 * =====================================================================
 */
const POSCore = (function () {
    "use strict";

    const METODOS_PAGO_COMBINADO = ["EFECTIVO", "DEBITO", "CREDITO", "TRANSFERENCIA", "FIADO"];

    /** Ticket en curso. Cada ítem: { codigo, nombre, rubro, costo, precio, cantidad } */
    let ticketActual = [];

    // ----------------------------------------------------------------
    // Carrito
    // ----------------------------------------------------------------

    /** Copia defensiva del ticket. */
    function obtenerTicket() { return ticketActual.map(item => ({ ...item })); }

    /**
     * Agrega un producto (o incrementa en 1 su cantidad si ya existe).
     * El precio se guarda sin centavos (redondear2) para que el total
     * siempre sea entero limpio.
     */
    function agregarProducto(codigo, producto) {
        const existente = ticketActual.find(i => i.codigo === codigo);
        if (existente) { existente.cantidad = Helpers.aDecimal(existente.cantidad + 1, 3, 1); return; }
        ticketActual.push({
            codigo,
            nombre:   producto.nombre,
            rubro:    producto.rubro,
            costo:    Helpers.redondear2(Helpers.aNumero(producto.costo)),
            precio:   Helpers.redondear2(Helpers.aNumero(producto.precioVenta)),
            cantidad: 1,
        });
    }

    /**
     * Suma/resta `delta` a la cantidad de un ítem.
     * Usa aDecimal para no acumular errores de coma flotante.
     * Si la cantidad resultante ≤ 0, elimina el ítem.
     */
    function cambiarCantidad(indice, delta) {
        const item = ticketActual[indice];
        if (!item) return;
        const nueva = Helpers.aDecimal(item.cantidad + delta, 3, 0);
        if (nueva <= 0) ticketActual.splice(indice, 1);
        else item.cantidad = nueva;
    }

    /**
     * Establece la cantidad de un ítem a un valor exacto tipeado.
     * Acepta "0,550" → 0.55 (via aDecimal).
     * Si la cantidad resultante ≤ 0, elimina el ítem.
     * @param {number} indice
     * @param {string|number} nuevaCantidad
     */
    function establecerCantidad(indice, nuevaCantidad) {
        const item = ticketActual[indice];
        if (!item) return;
        const cantidad = Helpers.aDecimal(nuevaCantidad, 3, 0);
        if (cantidad <= 0) ticketActual.splice(indice, 1);
        else item.cantidad = cantidad;
    }

    /** Elimina un ítem por índice. */
    function eliminarItem(indice) {
        if (indice >= 0 && indice < ticketActual.length) ticketActual.splice(indice, 1);
    }

    /** Vacía el ticket. */
    function vaciarTicket() { ticketActual = []; }

    /**
     * Calcula el total del ticket.
     * El subtotal de cada ítem = precio (entero) × cantidad (decimal)
     * y el gran total se redondea al entero más cercano.
     */
    function calcularTotalTicket() {
        const suma = ticketActual.reduce((acc, item) => acc + item.precio * item.cantidad, 0);
        return Helpers.redondear2(suma);
    }

    // ----------------------------------------------------------------
    // Precios y vueltos
    // ----------------------------------------------------------------

    /**
     * Precio de venta sugerido = costo × (1 + porcentaje/100), redondeado.
     */
    function calcularPrecioVenta(costo, porcentajeGanancia) {
        const c = Helpers.aNumero(costo);
        const p = Helpers.aNumero(porcentajeGanancia);
        return Helpers.redondear2(c * (1 + p / 100));
    }

    /**
     * Valida que la suma del cobro combinado cubra exactamente el total.
     */
    function validarCobroCombinado(total, desglose) {
        const d = desglose || {};
        const suma = Helpers.redondear2(
            METODOS_PAGO_COMBINADO.reduce((acc, m) => acc + Helpers.aNumero(d[m]), 0)
        );
        const restante = Helpers.redondear2(Helpers.aNumero(total) - suma);
        return { suma, restante, cubierto: restante === 0 };
    }

    /**
     * Calcula el vuelto a entregar.
     */
    function calcularVuelto({ total, pagaCon, esCombinado, desglose, metodoPago }) {
        let baseEfectivo;
        if (esCombinado) {
            baseEfectivo = Helpers.aNumero(desglose && desglose.EFECTIVO);
        } else if (metodoPago === "EFECTIVO") {
            baseEfectivo = Helpers.aNumero(total);
        } else {
            return { aplica: false, vuelto: 0 };
        }
        const vuelto = Helpers.redondear2(Math.max(0, Helpers.aNumero(pagaCon) - baseEfectivo));
        return { aplica: true, vuelto };
    }

    // ----------------------------------------------------------------
    // Construcción del registro de venta
    // ----------------------------------------------------------------

    function construirVenta({ total, cliente, metodoPago, desglosePago, pagaCon, items }) {
        const ahora = new Date();
        const { vuelto } = calcularVuelto({ total, pagaCon, esCombinado: metodoPago === "COMBINADO", desglose: desglosePago, metodoPago });
        return {
            id:              Helpers.generarId("TK"),
            fechaIso:        ahora.toISOString(),
            fechaFormateada: Helpers.formatearFechaHora(ahora),
            cliente:         (cliente && cliente.trim()) ? cliente.trim() : "Mostrador",
            metodoPago,
            total:           Helpers.redondear2(total),
            productos:       items.map(item => ({ ...item })),
            desglosePago:    { ...desglosePago },
            vueltoEntregado: vuelto,
        };
    }

    // ----------------------------------------------------------------
    // Inventario
    // ----------------------------------------------------------------

    /**
     * Descuenta stock (fraccionario). El stock resultante no puede ser < 0.
     */
    function descontarStock(productosDB, items) {
        items.forEach(item => {
            const p = productosDB[item.codigo];
            if (p) {
                const stockActual = Helpers.aDecimal(p.stock, 3, 0);
                const vendido     = Helpers.aDecimal(item.cantidad, 3, 0);
                p.stock = Math.max(0, Helpers.aDecimal(stockActual - vendido, 3, 0));
            }
        });
        return productosDB;
    }

    // ----------------------------------------------------------------
    // Caja y fiados
    // ----------------------------------------------------------------

    function calcularEfectivoEnCaja(historialVentas, registrosFiados, registrosProveedores) {
        let efectivo = 0;
        (historialVentas || []).forEach(venta => {
            if (!venta) return;
            if (venta.desglosePago) efectivo += Helpers.aNumero(venta.desglosePago.EFECTIVO);
            else if (venta.metodoPago === "EFECTIVO") efectivo += Helpers.aNumero(venta.total);
            efectivo -= Helpers.aNumero(venta.vueltoEntregado);
        });
        (registrosFiados || []).forEach(r => {
            if (r && r.tipo === "PAGO") efectivo += Helpers.aNumero(r.monto);
        });
        (registrosProveedores || []).forEach(r => {
            if (r) efectivo -= Helpers.aNumero(r.monto);
        });
        return Helpers.redondear2(efectivo);
    }

    function calcularBalanceFiados(registros) {
        const neto = (registros || []).reduce((acc, r) => {
            if (!r) return acc;
            return acc + (r.tipo === "DEUDA" ? r.monto : -r.monto);
        }, 0);
        return Helpers.redondear2(neto);
    }

    // ----------------------------------------------------------------
    // Estadísticas
    // ----------------------------------------------------------------

    function agruparEstadisticas(historialVentas, { tipo, desde, hasta }) {
        const acumulador = {};
        let granTotal = 0;
        (historialVentas || []).forEach(venta => {
            if (!venta || !venta.fechaIso) return;
            const fecha = new Date(venta.fechaIso);
            if (desde && fecha < desde) return;
            if (hasta && fecha > hasta) return;
            (venta.productos || []).forEach(item => {
                const clave    = tipo === "PRODUCTO" ? item.nombre : item.rubro;
                const subtotal = Helpers.redondear2(Helpers.aNumero(item.precio) * Helpers.aDecimal(item.cantidad, 3, 0));
                granTotal += subtotal;
                acumulador[clave] = (acumulador[clave] || 0) + subtotal;
            });
        });
        return { acumulador, granTotal: Helpers.redondear2(granTotal) };
    }

    // ----------------------------------------------------------------
    // API pública
    // ----------------------------------------------------------------
    return Object.freeze({
        METODOS_PAGO_COMBINADO,
        obtenerTicket,
        agregarProducto,
        cambiarCantidad,
        establecerCantidad,
        eliminarItem,
        vaciarTicket,
        calcularTotalTicket,
        calcularPrecioVenta,
        validarCobroCombinado,
        calcularVuelto,
        construirVenta,
        descontarStock,
        calcularEfectivoEnCaja,
        calcularBalanceFiados,
        agruparEstadisticas,
    });
})();
