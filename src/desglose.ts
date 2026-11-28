// Desglose de una fila: neto, IVA, otros conceptos y vencimiento del CAE. El QR de ARCA no los trae, así que salen de dos lugares:
// las columnas opcionales del registro (lo que el sistema tiene cargado) o lo que la persona escribe en el detalle de la fila.
// Funciones puras, sin DOM. No se calcula nada: el IVA y los otros conceptos los informa quien carga, y acá solo se guardan.

import { claveDuplicado, formatearFecha, formatearImporte } from "./comprobante.ts";
import { interpretarImporte, type Registro } from "./conciliacion.ts";
import { normalizarVencimiento, type Desglose } from "./control.ts";
import type { Fila } from "./planilla.ts";

export type CampoDesglose = keyof Desglose;

export const CAMPOS_DESGLOSE: ReadonlyArray<{ campo: CampoDesglose; etiqueta: string }> = [
  { campo: "neto", etiqueta: "Neto gravado" },
  { campo: "iva", etiqueta: "IVA" },
  { campo: "otros", etiqueta: "Otros conceptos" },
  { campo: "vencimientoCae", etiqueta: "Vencimiento del CAE" },
];

/** De dónde sale el desglose de una fila. */
export type OrigenDesglose = { tipo: "manual" } | { tipo: "registro"; linea: number } | { tipo: "ninguno" };

export function desgloseVacio(): Desglose {
  return { neto: null, iva: null, otros: null, vencimientoCae: "" };
}

/** `true` si hay al menos un dato informado (un `0` es un dato). */
export function hayDesglose(d: Desglose | undefined): d is Desglose {
  return d !== undefined && (d.neto !== null || d.iva !== null || d.otros !== null || d.vencimientoCae.trim() !== "");
}

function desglosesDelRegistro(registros: readonly Registro[]): Map<string, { desglose: Desglose; linea: number }> {
  const porClave = new Map<string, { desglose: Desglose; linea: number }>();
  for (const r of registros) {
    const clave = claveDuplicado(r);
    // Si el archivo repite la clave, `leerRegistro` ya deja una sola entrada; si llegan repetidas igual, vale la primera.
    if (clave === null || r.desglose === undefined || porClave.has(clave)) continue;
    porClave.set(clave, { desglose: r.desglose, linea: r.linea });
  }
  return porClave;
}

/**
 * Las mismas filas, con el desglose del registro puesto en las que tienen QR, no escribieron el suyo y figuran en el registro con
 * desglose. Lo escrito a mano manda. No modifica las filas que recibe: devuelve copias donde hace falta.
 */
export function conDesgloseDelRegistro(filas: readonly Fila[], registros: readonly Registro[]): Fila[] {
  const delRegistro = desglosesDelRegistro(registros);
  if (delRegistro.size === 0) return [...filas];
  return filas.map((fila) => {
    if (!fila.conQr || hayDesglose(fila.desglose)) return fila;
    const clave = claveDuplicado(fila.datos);
    const encontrado = clave === null ? undefined : delRegistro.get(clave);
    return encontrado === undefined ? fila : { ...fila, desglose: encontrado.desglose };
  });
}

export function origenDesglose(fila: Pick<Fila, "datos" | "desglose">, registros: readonly Registro[]): OrigenDesglose {
  if (hayDesglose(fila.desglose)) return { tipo: "manual" };
  const clave = claveDuplicado(fila.datos);
  const encontrado = clave === null ? undefined : desglosesDelRegistro(registros).get(clave);
  return encontrado === undefined ? { tipo: "ninguno" } : { tipo: "registro", linea: encontrado.linea };
}

export function textoOrigenDesglose(o: OrigenDesglose): string {
  switch (o.tipo) {
    case "manual":
      return "Desglose escrito a mano. Vacíe los cuatro campos para volver al del registro.";
    case "registro":
      return `Desglose tomado del registro (línea ${o.linea}). Si escribe algo acá, vale lo escrito.`;
    case "ninguno":
      return "Sin desglose: el QR no trae neto, IVA ni vencimiento del CAE. Escríbalos acá, o agregue esas columnas al registro, para controlar el cuadre del total y el vencimiento del CAE.";
  }
}

/** El valor de un campo como se lo escribe a mano: importes con coma decimal, fecha como DD/MM/AAAA. Vacío si no hay dato. */
export function textoDeDesglose(d: Desglose | undefined, campo: CampoDesglose): string {
  if (d === undefined) return "";
  if (campo === "vencimientoCae") return formatearFecha(d.vencimientoCae);
  const n = d[campo];
  return n === null ? "" : formatearImporte(n);
}

const ETIQUETA_EN_MENSAJE: Record<CampoDesglose, string> = {
  neto: "neto",
  iva: "IVA",
  otros: "importe de otros conceptos",
  vencimientoCae: "vencimiento del CAE",
};

/** Interpreta lo escrito en una celda del desglose. Vacío es "no informado". `Error` si no es válido (la celda conserva el valor anterior). */
export function interpretarCeldaDesglose(campo: "vencimientoCae", texto: string): { valor: string } | Error;
export function interpretarCeldaDesglose(campo: Exclude<CampoDesglose, "vencimientoCae">, texto: string): { valor: number | null } | Error;
export function interpretarCeldaDesglose(campo: CampoDesglose, texto: string): { valor: number | null | string } | Error;
export function interpretarCeldaDesglose(campo: CampoDesglose, texto: string): { valor: number | null | string } | Error {
  const t = texto.trim();
  if (campo === "vencimientoCae") {
    if (t === "") return { valor: "" };
    const f = normalizarVencimiento(t);
    return f === null ? new Error("El vencimiento del CAE debe ser una fecha válida, con formato DD/MM/AAAA.") : { valor: f };
  }
  if (t === "") return { valor: null };
  const n = interpretarImporte(t);
  return n === null ? new Error(`El ${ETIQUETA_EN_MENSAJE[campo]} debe ser un número con hasta 2 decimales, por ejemplo 1.234,56.`) : { valor: n };
}

/** El desglose con un campo reemplazado por lo escrito, o `Error` si no es válido. Cada campo recibe solo el tipo de valor que le corresponde. */
function conCampo(d: Desglose, campo: CampoDesglose, texto: string): Desglose | Error {
  if (campo === "vencimientoCae") {
    const v = interpretarCeldaDesglose(campo, texto);
    return v instanceof Error ? v : { ...d, vencimientoCae: v.valor };
  }
  const n = interpretarCeldaDesglose(campo, texto);
  if (n instanceof Error) return n;
  switch (campo) {
    case "neto":
      return { ...d, neto: n.valor };
    case "iva":
      return { ...d, iva: n.valor };
    case "otros":
      return { ...d, otros: n.valor };
  }
}

function iguales(a: Desglose, b: Desglose): boolean {
  return a.neto === b.neto && a.iva === b.iva && a.otros === b.otros && a.vencimientoCae === b.vencimientoCae;
}

/**
 * Escribe un dato del desglose de una fila. `base` es el desglose con el que la fila se ve ahora (el del registro, si no escribió el
 * suyo): el desglose escrito parte de él para no perder lo que no se toca. Si el valor no cambia nada devuelve las mismas filas, y si
 * quedan los cuatro campos vacíos, la fila vuelve a no tener desglose propio. `Error` si el texto no es válido o la fila ya no existe.
 */
export function editarDesglose(filas: readonly Fila[], id: number, campo: CampoDesglose, texto: string, base?: Desglose): Fila[] | Error {
  const actual = filas.find((f) => f.id === id);
  if (!actual) return new Error("La fila ya no existe.");
  const vigente = actual.desglose ?? base ?? desgloseVacio();
  const siguiente = conCampo(vigente, campo, texto);
  if (siguiente instanceof Error) return siguiente;
  if (iguales(siguiente, vigente)) return [...filas];
  return filas.map((f) => {
    if (f.id !== id) return f;
    const { desglose: _anterior, ...sinDesglose } = f;
    return hayDesglose(siguiente) ? { ...sinDesglose, desglose: siguiente } : sinDesglose;
  });
}
