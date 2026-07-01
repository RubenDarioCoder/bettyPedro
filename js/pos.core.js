
const POSCore = (function () {
    "use strict";

    /** Medios de pago soportados por el cobro combinado. */
    const METODOS_PAGO_COMBINADO = ["EFECTIVO", "DEBITO", "CREDITO", "TRANSFERENCIA", "FIADO"];

    /**
     * Estado privado: ítems del ticket actualmente en curso.
     * Cada ítem: { codigo, nombre, rubro, costo, precio, cantidad }
     * @type {Array<object>}
     */
    let ticketActual = [];

    // ------------------------------------------------------------
    // Carrito / Ticket actual
    // ------------------------------------------------------------

    /**
     * Devuelve una copia defensiva del ticket actual, para que la capa
     * de presentación no pueda mutar el estado interno directamente.
     * @returns {Array<object>}
     */
    function obtenerTicket() {
        return ticketActual.map((item) => ({ ...item }));
    }

    /**
     * Agrega un producto al ticket (o incrementa su cantidad si ya
     * estaba agregado).
     * @param {string} codigo
     * @param {object} producto Registro de `productosDB[codigo]`
     */
    function agregarProducto(codigo, producto) {
        const existente = ticketActual.find((i) => i.codigo === codigo);
        if (existente) {
            existente.cantidad += 1;
            return;
        }
        ticketActual.push({
            codigo,
            nombre: producto.nombre,
            rubro: producto.rubro,
            costo: Helpers.aNumero(producto.costo),
            precio: Helpers.aNumero(producto.precioVenta),
            cantidad: 1,
        });
    }

    /**
     * Modifica la cantidad de un ítem del ticket. Si la cantidad
     * resultante es 0 o menor, el ítem se elimina del ticket.
     *
     * Usa `Helpers.aDecimal` (no `Helpers.aNumero`) para no truncar a
     * entero, ya que las cantidades pueden ser fraccionarias (ej:
     * productos vendidos por peso), y para limpiar errores de coma
     * flotante tras la suma (ej: 0.1 + 0.2).
     * @param {number} indice
     * @param {number} delta +1 / -1 (o cualquier fracción)
     */
    function cambiarCantidad(indice, delta) {
        const item = ticketActual[indice];
        if (!item) return;
        const nueva = Helpers.aDecimal(item.cantidad + delta, 3, 0);
        if (nueva <= 0) {
            ticketActual.splice(indice, 1);
        } else {
            item.cantidad = nueva;
        }
    }

    /**
     * Establece directamente la cantidad de un ítem del ticket a un
     * valor exacto (en lugar de sumar un delta), tal como se necesita
     * al tipear manualmente una cantidad fraccionaria (ej: "0,550" kg).
     * Si el valor resultante es 0 o menor, el ítem se elimina.
     * @param {number} indice
     * @param {*} nuevaCantidad Valor crudo (string u number), admite coma decimal
     */
    function establecerCantidad(indice, nuevaCantidad) {
        const item = ticketActual[indice];
        if (!item) return;
        const cantidad = Helpers.aDecimal(nuevaCantidad, 3, 0);
        if (cantidad <= 0) {
            ticketActual.splice(indice, 1);
        } else {
            item.cantidad = cantidad;
        }
    }

    /**
     * Elimina un ítem del ticket por índice.
     * @param {number} indice
     */
    function eliminarItem(indice) {
        if (indice >= 0 && indice < ticketActual.length) ticketActual.splice(indice, 1);
    }

    /** Vacía completamente el ticket actual. */
    function vaciarTicket() {
        ticketActual = [];
    }

    /**
     * Calcula el total monetario del ticket actual.
     * @returns {number}
     */
    function calcularTotalTicket() {
        return Helpers.redondear2(
            ticketActual.reduce((acumulado, item) => acumulado + item.precio * item.cantidad, 0)
        );
    }

    // ------------------------------------------------------------
    // Cálculos de precios y vueltos
    // ------------------------------------------------------------

    /**
     * Calcula el precio de venta sugerido a partir de un costo y un
     * porcentaje de ganancia.
     * Fórmula: precioVenta = costo * (1 + porcentaje / 100)
     * @param {number} costo
     * @param {number} porcentajeGanancia
     * @returns {number}
     */
    function calcularPrecioVenta(costo, porcentajeGanancia) {
        const c = Helpers.aNumero(costo);
        const p = Helpers.aNumero(porcentajeGanancia);
        return Helpers.redondear2(c * (1 + p / 100));
    }

    /**
     * Valida la suma de un cobro combinado contra el total a cobrar.
     * El redondeo a centavos evita falsos "no coincide" por errores de
     * coma flotante (ej. 0.1 + 0.2 !== 0.3).
     *
     * @param {number} total Total a cobrar
     * @param {object} desglose { EFECTIVO, DEBITO, CREDITO, TRANSFERENCIA, FIADO }
     * @returns {{ suma: number, restante: number, cubierto: boolean }}
     */
    function validarCobroCombinado(total, desglose) {
        const d = desglose || {};
        const suma = Helpers.redondear2(
            METODOS_PAGO_COMBINADO.reduce((acumulado, metodo) => acumulado + Helpers.aNumero(d[metodo]), 0)
        );
        const restante = Helpers.redondear2(Helpers.aNumero(total) - suma);
        return { suma, restante, cubierto: restante === 0 };
    }

    /**
     * Calcula el vuelto a entregar al cliente.
     *
     * - Si el pago es combinado, solo la porción "EFECTIVO" del
     *   desglose se considera contra lo entregado.
     * - Si el pago es simple y el método NO es EFECTIVO, el vuelto no
     *   aplica (se paga el monto exacto con tarjeta/transferencia/fiado).
     * - El vuelto nunca es negativo (si paga de menos, vuelto = 0).
     *
     * @param {object} params
     * @param {number} params.total
     * @param {number} params.pagaCon Monto entregado en efectivo
     * @param {boolean} params.esCombinado
     * @param {object} params.desglose Desglose de pago combinado
     * @param {string} params.metodoPago Método de pago simple
     * @returns {{ aplica: boolean, vuelto: number }}
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

    // ------------------------------------------------------------
    // Construcción del registro de venta
    // ------------------------------------------------------------

    /**
     * Construye el objeto final de "venta" listo para agregarse al
     * historial, calculando ID, fechas y vuelto real entregado.
     *
     * @param {object} params
     * @param {number} params.total
     * @param {string} params.cliente
     * @param {string} params.metodoPago "EFECTIVO" | "DEBITO" | ... | "COMBINADO"
     * @param {object} params.desglosePago
     * @param {number} params.pagaCon
     * @param {Array<object>} params.items Copia de `ticketActual`
     * @returns {object} Registro de venta normalizado
     */
    function construirVenta({ total, cliente, metodoPago, desglosePago, pagaCon, items }) {
        const ahora = new Date();
        const esCombinado = metodoPago === "COMBINADO";
        const { vuelto } = calcularVuelto({
            total,
            pagaCon,
            esCombinado,
            desglose: desglosePago,
            metodoPago,
        });

        return {
            id: Helpers.generarId("TK"),
            fechaIso: ahora.toISOString(),
            fechaFormateada: Helpers.formatearFechaHora(ahora),
            cliente: cliente && cliente.trim() ? cliente.trim() : "Mostrador",
            metodoPago,
            total: Helpers.redondear2(total),
            productos: items.map((item) => ({ ...item })),
            desglosePago: { ...desglosePago },
            vueltoEntregado: vuelto,
        };
    }

    // ------------------------------------------------------------
    // Inventario
    // ------------------------------------------------------------

    /**
     * Descuenta del catálogo el stock vendido en un ticket. Muta el
     * objeto `productosDB` recibido (operación intencionalmente
     * destructiva ya que opera sobre el catálogo en memoria del
     * `UIManager`, que es responsable de persistirlo luego).
     *
     * El stock nunca queda por debajo de 0.
     *
     * @param {object} productosDB
     * @param {Array<object>} items
     * @returns {object} El mismo `productosDB`, para encadenar llamadas
     */
    function descontarStock(productosDB, items) {
        items.forEach((item) => {
            const producto = productosDB[item.codigo];
            if (producto) {
                producto.stock = Math.max(0, Helpers.aDecimal(producto.stock, 3, 0) - Helpers.aDecimal(item.cantidad, 3, 0));
            }
        });
        return productosDB;
    }

    // ------------------------------------------------------------
    // Caja maestra (efectivo estimado)
    // ------------------------------------------------------------

    /**
     * Calcula el efectivo neto estimado en caja a partir de:
     *   + Ingresos en efectivo por ventas (pago simple o porción
     *     "EFECTIVO" de pagos combinados)
     *   - Vueltos entregados en esas ventas
     *   + Pagos de deudas (fiados cobrados)
     *   - Egresos a proveedores
     *
     * @param {Array<object>} historialVentas
     * @param {Array<object>} registrosFiados
     * @param {Array<object>} registrosProveedores
     * @returns {number}
     */
    function calcularEfectivoEnCaja(historialVentas, registrosFiados, registrosProveedores) {
        let efectivo = 0;

        (historialVentas || []).forEach((venta) => {
            if (!venta) return;
            const vuelto = Helpers.aNumero(venta.vueltoEntregado);
            if (venta.desglosePago) {
                efectivo += Helpers.aNumero(venta.desglosePago.EFECTIVO);
            } else if (venta.metodoPago === "EFECTIVO") {
                efectivo += Helpers.aNumero(venta.total);
            }
            efectivo -= vuelto;
        });

        (registrosFiados || []).forEach((registro) => {
            if (registro && registro.tipo === "PAGO") {
                efectivo += Helpers.aNumero(registro.monto);
            }
        });

        (registrosProveedores || []).forEach((registro) => {
            if (registro) efectivo -= Helpers.aNumero(registro.monto);
        });

        return Helpers.redondear2(efectivo);
    }

    // ------------------------------------------------------------
    // Cuentas corrientes (fiados)
    // ------------------------------------------------------------

    /**
     * Calcula el balance neto pendiente de cobro (cuentas corrientes).
     * Un valor positivo indica dinero que los clientes deben al
     * almacén; un valor negativo indicaría un saldo a favor del cliente.
     * @param {Array<object>} registros
     * @returns {number}
     */
    function calcularBalanceFiados(registros) {
        const neto = (registros || []).reduce((acumulado, registro) => {
            if (!registro) return acumulado;
            return acumulado + (registro.tipo === "DEUDA" ? registro.monto : -registro.monto);
        }, 0);
        return Helpers.redondear2(neto);
    }

    // ------------------------------------------------------------
    // Estadísticas
    // ------------------------------------------------------------

    /**
     * Agrupa el historial de ventas por producto o por rubro dentro de
     * un rango de fechas, devolviendo el acumulado monetario por clave
     * y el gran total del período.
     *
     * @param {Array<object>} historialVentas
     * @param {object} filtros
     * @param {"PRODUCTO"|"RUBRO"} filtros.tipo
     * @param {Date|null} filtros.desde
     * @param {Date|null} filtros.hasta
     * @returns {{ acumulador: object, granTotal: number }}
     */
    function agruparEstadisticas(historialVentas, { tipo, desde, hasta }) {
        const acumulador = {};
        let granTotal = 0;

        (historialVentas || []).forEach((venta) => {
            if (!venta || !venta.fechaIso) return;
            const fechaVenta = new Date(venta.fechaIso);
            if (desde && fechaVenta < desde) return;
            if (hasta && fechaVenta > hasta) return;

            (venta.productos || []).forEach((item) => {
                const clave = tipo === "PRODUCTO" ? item.nombre : item.rubro;
                const subtotal = Helpers.aNumero(item.precio) * Helpers.aDecimal(item.cantidad, 3, 0);
                granTotal += subtotal;
                acumulador[clave] = (acumulador[clave] || 0) + subtotal;
            });
        });

        return { acumulador, granTotal: Helpers.redondear2(granTotal) };
    }

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
