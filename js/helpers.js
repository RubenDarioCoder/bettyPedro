/**
 * =====================================================================
 *  Helpers — Utilidades transversales sin estado, sin DOM
 * =====================================================================
 *
 *  Reglas de conversión numérica:
 *
 *  · aDecimal(valor)   → preserva decimales. Acepta "0,550" → 0.55
 *                         Usada para CANTIDADES tipeadas a mano.
 *
 *  · aNumero(valor)    → preserva decimales, NO redondea.
 *                         Usada para PRECIOS / MONTOS (pueden tener
 *                         centavos internamente durante el cálculo).
 *
 *  · redondear2(valor) → redondea al entero más cercano (sin centavos).
 *                         Solo se aplica al MOSTRAR en pantalla o al
 *                         persistir el total final de una venta.
 *
 *  · formatearMoneda() → formatea sin decimales ($ 1.400, no $ 1400,00)
 *
 *  · formatearCantidad() → formatea con coma decimal (0,55; 2; 1,5)
 */
const Helpers = (function () {
    "use strict";

    // ----------------------------------------------------------------
    // Utilidades generales
    // ----------------------------------------------------------------

    /**
     * Rellena un número con ceros a la izquierda.
     * @param {number} numero
     * @param {number} longitud
     * @returns {string}
     */
    function pad(numero, longitud = 2) {
        return String(numero).padStart(longitud, "0");
    }

    /**
     * Genera un ID único con marca de tiempo.
     * Formato: `${PREFIJO}-${AAAAMMDDHHmmssSSS}-${ALEATORIO}`
     * @param {string} prefijo  Ej: "TK", "FD", "PROV"
     * @returns {string}
     */
    function generarId(prefijo) {
        const ahora = new Date();
        const ts =
            `${ahora.getFullYear()}${pad(ahora.getMonth() + 1)}${pad(ahora.getDate())}` +
            `${pad(ahora.getHours())}${pad(ahora.getMinutes())}${pad(ahora.getSeconds())}` +
            `${pad(ahora.getMilliseconds(), 3)}`;
        const sufijo = Math.random().toString(36).slice(2, 6).toUpperCase();
        return `${prefijo}-${ts}-${sufijo}`;
    }

    // ----------------------------------------------------------------
    // Conversión numérica
    // ----------------------------------------------------------------

    /**
     * Convierte un valor a número decimal (punto como separador interno).
     * Acepta tanto punto como coma como separador decimal.
     * NO redondea.  Usado para PRECIOS y MONTOS.
     *
     * @param {*} valor
     * @param {number} [porDefecto=0]
     * @returns {number}
     */
    function aNumero(valor, porDefecto = 0) {
        if (valor === null || valor === undefined || valor === "") return porDefecto;
        if (typeof valor === "number") return isNaN(valor) ? porDefecto : valor;
        // Reemplaza coma decimal por punto y elimina separadores de miles
        const texto = String(valor)
            .trim()
            .replace(/[^\d.,-]/g, "")   // deja solo dígitos, punto, coma, guión
            .replace(/^(-?)(\d+)\.(\d{3})$/, "$1$2$3")   // 1.400 (miles) → 1400
            .replace(",", ".");          // coma decimal → punto
        const n = parseFloat(texto);
        return isNaN(n) ? porDefecto : n;
    }

    /**
     * Alias que convierte a número; utilizado donde el código espera
     * un entero (paginación, índices). El redondeo es a entero.
     * @param {*} valor
     * @param {number} [porDefecto=0]
     * @returns {number}
     */
    function aEntero(valor, porDefecto = 0) {
        return Math.round(aNumero(valor, porDefecto));
    }

    /**
     * Convierte una cantidad tipeada a mano a número decimal.
     * Regla simple: una sola coma siempre es separador DECIMAL
     * (nunca separador de miles), porque nadie escribe "1,200" para
     * decir "mil doscientas unidades" en el teclado del almacén.
     *
     * Ejemplos: "0,550" → 0.55  |  "2,5" → 2.5  |  "1.234,56" → 1234.56
     *
     * @param {*} valor
     * @param {number} [decimales=3]   máximo de decimales a preservar
     * @param {number} [porDefecto=0]
     * @returns {number}
     */
    function aDecimal(valor, decimales = 3, porDefecto = 0) {
        if (valor === null || valor === undefined || valor === "") return porDefecto;
        if (typeof valor === "number") return isNaN(valor) ? porDefecto : valor;

        let texto = String(valor).trim().replace(/[^\d.,-]/g, "");
        if (texto === "") return porDefecto;

        const tieneComa  = texto.includes(",");
        const tienePunto = texto.includes(".");

        if (tieneComa && tienePunto) {
            // 1.234,56 → 1234.56  (punto=miles, coma=decimal)
            texto = texto.replace(/\./g, "").replace(",", ".");
        } else if (tieneComa) {
            // 0,550 → 0.550  (la coma ES decimal, no miles)
            texto = texto.replace(",", ".");
        }
        // si solo hay punto, ya es el formato estándar

        const n = parseFloat(texto);
        if (isNaN(n)) return porDefecto;
        const factor = Math.pow(10, decimales);
        return Math.round(n * factor) / factor;
    }

    /**
     * Redondea al entero más cercano (sin centavos).
     * Solo se usa en el total final de una venta o al mostrar montos.
     * @param {number} valor
     * @returns {number}
     */
    function redondear2(valor) {
        if (valor === null || valor === undefined) return 0;
        return Math.round(Number(valor) || 0);
    }

    // ----------------------------------------------------------------
    // Formateo
    // ----------------------------------------------------------------

    /**
     * Formatea un monto en pesos sin centavos.
     * Ej: 1400 → "$ 1.400"  |  2500.7 → "$ 2.501"
     * @param {number|string} valor
     * @returns {string}
     */
    function formatearMoneda(valor) {
        const n = redondear2(aNumero(valor));
        return n.toLocaleString("es-AR", {
            style: "currency",
            currency: "ARS",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });
    }

    /**
     * Formatea una cantidad decimal para mostrar en pantalla,
     * usando coma como separador decimal y eliminando ceros finales.
     * Ej: 0.55 → "0,55"  |  1 → "1"  |  2.5 → "2,5"  |  3.333 → "3,333"
     * @param {*} valor
     * @returns {string}
     */
    function formatearCantidad(valor) {
        const n = aDecimal(valor, 3, 0);
        // toFixed(3) garantiza 3 decimales, luego recorta ceros finales
        let texto = n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
        return texto.replace(".", ",");
    }

    /**
     * Formatea una fecha (Date) a fecha y hora legible en es-AR.
     * @param {Date} fecha
     * @returns {string}
     */
    function formatearFechaHora(fecha) {
        return `${fecha.toLocaleDateString("es-AR")} ${fecha.toLocaleTimeString("es-AR")}`;
    }

    // ----------------------------------------------------------------
    // Utilidades de texto / DOM
    // ----------------------------------------------------------------

    /**
     * Escapa caracteres especiales de HTML para prevenir inyección.
     * @param {*} texto
     * @returns {string}
     */
    function escaparHtml(texto) {
        if (texto === null || texto === undefined) return "";
        return String(texto)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /**
     * Versión "debounced" de una función.
     * @param {Function} fn
     * @param {number} espera  milisegundos
     * @returns {Function}
     */
    function debounce(fn, espera = 250) {
        let t = null;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), espera);
        };
    }

    // ----------------------------------------------------------------
    // CSV
    // ----------------------------------------------------------------

    /**
     * Normaliza una clave de encabezado CSV (sin acentos, minúsculas,
     * sin símbolos). Permite reconocer "Código" = "codigo", etc.
     * @param {*} texto
     * @returns {string}
     */
    function normalizarClave(texto) {
        return String(texto === null || texto === undefined ? "" : texto)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9%]/g, "");
    }

    /**
     * Detecta el delimitador más probable de una línea CSV (coma o punto y coma).
     * @param {string} linea
     * @returns {","|";"}
     */
    function detectarDelimitadorCsv(linea) {
        const t = String(linea || "");
        return ((t.match(/;/g) || []).length > (t.match(/,/g) || []).length) ? ";" : ",";
    }

    /**
     * Parser CSV tolerante: soporta campos entre comillas dobles,
     * comillas escapadas `""` y saltos de línea \r\n o \n.
     * @param {string} texto
     * @param {string} [delimitador=","]
     * @returns {string[][]}
     */
    function parsearCsv(texto, delimitador) {
        const delim = delimitador || ",";
        const filas = [];
        let fila = [], campo = "", dentro = false;
        const s = String(texto || "");

        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (dentro) {
                if (c === '"') {
                    if (s[i + 1] === '"') { campo += '"'; i++; }
                    else { dentro = false; }
                } else { campo += c; }
                continue;
            }
            if      (c === '"')  { dentro = true; }
            else if (c === delim){ fila.push(campo); campo = ""; }
            else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
            else if (c !== "\r") { campo += c; }
        }
        if (campo !== "" || fila.length > 0) { fila.push(campo); filas.push(fila); }

        return filas.map(f => f.map(c => c.trim())).filter(f => f.some(c => c !== ""));
    }

    /**
     * Normaliza números en formato es-AR para importación CSV
     * (donde "1.234,56" sí significa miles + decimal).
     * NO usar para cantidades tipeadas a mano — usar `aDecimal`.
     * @param {*} valor
     * @returns {string}  String apto para parseFloat
     */
    function normalizarNumeroLocal(valor) {
        let s = String(valor === null || valor === undefined ? "" : valor).trim();
        if (!s) return "0";
        s = s.replace(/[^\d.,-]/g, "");

        if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) { s = s.replace(/\./g, "").replace(",", "."); }
        else if (/^-?\d{1,3}(,\d{3})+$/.test(s))  { s = s.replace(/,/g, ""); }
        else if (/^-?\d{1,3}(\.\d{3})+$/.test(s))  { s = s.replace(/\./g, ""); }
        else if (/^-?\d+,\d+$/.test(s))             { s = s.replace(",", "."); }

        return s || "0";
    }

    /**
     * Escapa un valor para insertarlo como campo CSV.
     * @param {*} valor
     * @returns {string}
     */
    function escaparCsv(valor) {
        const t = valor === null || valor === undefined ? "" : String(valor);
        return `"${t.replace(/"/g, '""')}"`;
    }

    /**
     * Dispara la descarga de un archivo de texto desde el navegador.
     * @param {string} contenido
     * @param {string} nombreArchivo
     * @param {string} [tipoMime]
     */
    function descargarTexto(contenido, nombreArchivo, tipoMime) {
        const blob = new Blob([contenido], { type: tipoMime || "text/plain;charset=utf-8;" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = nombreArchivo;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    // ----------------------------------------------------------------
    // API pública
    // ----------------------------------------------------------------
    return Object.freeze({
        pad,
        generarId,
        aNumero,
        aEntero,
        aDecimal,
        redondear2,
        formatearMoneda,
        formatearCantidad,
        formatearFechaHora,
        escaparHtml,
        debounce,
        normalizarClave,
        detectarDelimitadorCsv,
        parsearCsv,
        normalizarNumeroLocal,
        escaparCsv,
        descargarTexto,
    });
})();
