// Exportación a CSV de la conciliación de pagos, pensada para Excel en configuración regional argentina (mismo formato que `csv.ts`:
// separador ";", decimales con coma, UTF-8 con BOM, fin de línea CRLF). Todo texto que viene de un archivo del usuario (nombre del
// archivo, referencia, concepto, usuarios) pasa por `celdaTexto`: lo que empieza con `=`, `+`, `-`, `@`, tabulación o retorno de carro
// se neutraliza para que Excel no lo ejecute como fórmula.

import { formatearFecha, nombreTipo } from "./comprobante.ts";
import { BOM, celdaNumero, celdaTexto } from "./csv.ts";
import type { ConciliacionPagos, FacturaAPagar, ResultadoPago, SituacionFactura } from "./cuentas-a-pagar.ts";
import { formatearCuit } from "./cuit.ts";
import { NOMBRE_REGLA, cuitDelPago, etiquetaFactura, etiquetaPago, nombreFactura } from "./vista-pagos.ts";

const SEPARADOR = ";";
const FIN_DE_LINEA = "\r\n";

export const ENCABEZADOS_PAGOS = [
  "Línea",
  "Fecha",
  "CUIT",
  "Importe",
  "Referencia",
  "Concepto",
  "Cargó",
  "Autorizó",
  "Operación",
  "Resultado",
  "Cómo se emparejó",
  "Aplicado a",
  "Sin aplicar",
  "Por qué",
  "Avisos",
] as const;

export const ENCABEZADOS_FACTURAS_PAGOS = [
  "Origen",
  "CUIT emisor",
  "Tipo",
  "Punto de venta",
  "Número",
  "Fecha",
  "Importe",
  "Pagado",
  "Saldo",
  "Estado de pago",
  "Días desde la emisión",
  "Sin pagar hace tiempo",
  "Pagos (líneas del extracto)",
  "Pagos para revisar (líneas)",
] as const;

function armar(encabezados: readonly string[], filas: readonly string[][]): string {
  const lineas = [encabezados.map(celdaTexto).join(SEPARADOR), ...filas.map((f) => f.join(SEPARADOR))];
  return BOM + lineas.join(FIN_DE_LINEA) + FIN_DE_LINEA;
}

/** Un renglón por pago, en el orden del extracto. */
export function pagosACsv(c: ConciliacionPagos, facturas: readonly FacturaAPagar[]): string {
  const porId = new Map(facturas.map((f) => [f.id, f] as const));
  const filas = c.pagos.map((r: ResultadoPago) => {
    const p = r.pago;
    const aplicado = r.imputaciones
      .map((i) => {
        const f = porId.get(i.facturaId);
        return f === undefined ? "" : `${nombreFactura(f)} (${celdaNumero(i.importe)})`;
      })
      .filter((x) => x !== "")
      .join(" + ");
    return [
      String(p.linea),
      celdaTexto(formatearFecha(p.fecha)),
      celdaTexto(cuitDelPago(p)),
      celdaNumero(p.importe),
      celdaTexto(p.referencia),
      celdaTexto(p.concepto),
      celdaTexto(p.cargo),
      celdaTexto(p.autorizo),
      celdaTexto(p.operacion),
      celdaTexto(etiquetaPago(r).texto),
      celdaTexto(r.regla === null ? "" : NOMBRE_REGLA[r.regla]),
      celdaTexto(aplicado),
      celdaNumero(r.sinImputar),
      celdaTexto(r.porQue),
      celdaTexto(r.avisos.map((a) => a.mensaje).join(" ")),
    ];
  });
  return armar(ENCABEZADOS_PAGOS, filas);
}

/** Un renglón por factura conciliable, en el orden de la planilla. */
export function facturasPagosACsv(c: ConciliacionPagos): string {
  const filas = c.facturas.map((s: SituacionFactura) => {
    const f = s.factura;
    return [
      celdaTexto(f.origen ?? ""),
      celdaTexto(formatearCuit(f.cuit)),
      celdaTexto(nombreTipo(f.tipoCmp)),
      String(f.ptoVta),
      String(f.nroCmp),
      celdaTexto(formatearFecha(f.fecha)),
      celdaNumero(f.importe),
      celdaNumero(s.pagado),
      celdaNumero(s.saldo),
      celdaTexto(etiquetaFactura(s).texto),
      s.dias === null ? "" : String(s.dias),
      s.antigua ? "Sí" : "No",
      celdaTexto(s.pagos.join(", ")),
      celdaTexto(s.enRevision.join(", ")),
    ];
  });
  return armar(ENCABEZADOS_FACTURAS_PAGOS, filas);
}

/** Para los tests y para el nombre del archivo: `AAAA-MM-DD` con la fecha local. */
export function diaParaArchivo(ahora: Date): string {
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}
