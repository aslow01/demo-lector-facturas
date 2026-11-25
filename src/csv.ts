// Exportación a CSV pensada para Excel en configuración regional argentina:
// separador ";", decimales con coma, UTF-8 con BOM, fin de línea CRLF.

import {
  ETIQUETA_ESTADO,
  esNotaDeCredito,
  formatearFecha,
  formatearMonto,
  nombreTipo,
} from "./comprobante.ts";
import { formatearCuit } from "./cuit.ts";
import { detalleCargadaVariasVeces, editoDatosDelCruce, textoCargadaVeces, textoResultado, type Resultado } from "./conciliacion.ts";
import { duplicadas, estadoFila, type Fila } from "./planilla.ts";

export const BOM = "﻿";
const SEPARADOR = ";";
const FIN_DE_LINEA = "\r\n";

export const ENCABEZADOS = [
  "Origen",
  "Estado",
  "Avisos",
  "Duplicada",
  "Editada a mano",
  "CUIT emisor",
  "Tipo",
  "Punto de venta",
  "Número",
  "Fecha",
  "Moneda",
  "Importe",
  "Importe en el total",
  "CAE",
  "Conciliación",
] as const;

/**
 * Celda de texto. Un texto que empieza con `=`, `+`, `-`, `@`, tabulación o retorno de carro
 * podría ejecutarse como fórmula en Excel: se antepone `'`. Luego se escapan comillas, separadores y saltos de línea.
 */
export function celdaTexto(texto: string): string {
  let t = texto;
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  if (/[";\r\n]/.test(t)) t = `"${t.replace(/"/g, '""')}"`;
  return t;
}

/** Celda numérica (decimales con coma, sin separador de miles). Se genera aquí, nunca desde texto del usuario. */
export function celdaNumero(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
  return n.toFixed(2).replace(".", ",");
}

/** Mismo vocabulario que la planilla. Un comprobante que el sistema trae más de una vez dice cuántas veces y qué copia sobra. */
function textoResultadoOpcional(r: Resultado | undefined, fila: Fila, cargadaDosVeces: boolean): string {
  if (r === undefined) return "";
  const editada = editoDatosDelCruce(fila);
  const variasVeces = cargadaDosVeces ? detalleCargadaVariasVeces(r, fila.datos.importe, fila.datos.tipoCmp, (n) => formatearMonto(fila.datos.moneda, n), editada) : null;
  if (variasVeces === null) return textoResultado(r, editada);
  const detalle = variasVeces.partes
    .map((t) => t.texto)
    .join("")
    .replace(/\.$/, "");
  return `${textoCargadaVeces(variasVeces.veces)} (${detalle})`;
}

/**
 * Arma el CSV completo (con BOM) de la planilla actual.
 * `conciliacion` (id de fila → resultado) es opcional: sin registro, la columna "Conciliación" queda vacía.
 */
export function aCsv(filas: readonly Fila[], hoy: Date = new Date(), conciliacion?: ReadonlyMap<number, Resultado>, cargadasDosVeces?: ReadonlySet<number>): string {
  const repetidas = duplicadas(filas);
  const lineas: string[] = [ENCABEZADOS.map(celdaTexto).join(SEPARADOR)];

  for (const fila of filas) {
    const { estado, motivos } = estadoFila(fila, hoy);
    const d = fila.datos;
    const original = repetidas.get(fila.id);
    const duplicada = original !== undefined;
    const signo = esNotaDeCredito(d.tipoCmp) ? -1 : 1;
    const enTotal = duplicada || d.importe === null ? null : signo * d.importe;
    const avisos = [fila.nota, ...motivos].filter((x) => x !== "").join(" ");

    lineas.push(
      [
        celdaTexto(fila.origen),
        celdaTexto(ETIQUETA_ESTADO[estado]),
        celdaTexto(avisos),
        celdaTexto(duplicada ? "Sí" : "No"),
        celdaTexto(fila.editados.length > 0 ? "Sí" : "No"),
        celdaTexto(formatearCuit(d.cuit)),
        celdaTexto(nombreTipo(d.tipoCmp)),
        d.ptoVta === null ? "" : String(d.ptoVta),
        d.nroCmp === null ? "" : String(d.nroCmp),
        celdaTexto(formatearFecha(d.fecha)),
        celdaTexto(d.moneda),
        celdaNumero(d.importe),
        celdaNumero(enTotal),
        celdaTexto(d.codAut),
        celdaTexto(textoResultadoOpcional(conciliacion?.get(fila.id), fila, cargadasDosVeces?.has(fila.id) ?? false)),
      ].join(SEPARADOR),
    );
  }

  return BOM + lineas.join(FIN_DE_LINEA) + FIN_DE_LINEA;
}
