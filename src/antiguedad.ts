// Antigüedad de lo que falta cargar: días corridos desde la fecha de emisión hasta una fecha de referencia.
// No dice nada fiscal (plazos, períodos, créditos): solo cuánto hace que se emitió y todavía no está cargada.
// Funciones puras, sin acceso al navegador.

import { conMiles, formatearFecha, normalizarFecha } from "./comprobante.ts";
import type { Resultado } from "./conciliacion.ts";
import type { Fila } from "./planilla.ts";

/** Desde cuántos días se marca una factura como "antigua" si el usuario no elige otro valor. */
export const UMBRAL_ANTIGUEDAD_POR_DEFECTO = 30;
export const UMBRAL_ANTIGUEDAD_MAXIMO = 3650;

/**
 * Fecha de referencia del ejemplo completo: fija, para que el ejemplo se vea igual hoy y dentro de un año. Con ella, una de
 * las dos facturas por cargar tiene 31 días (se marca) y la otra 28 (no).
 */
export const FECHA_REFERENCIA_EJEMPLO = "2026-11-12";

const DIA_EN_MS = 86_400_000;

function aUtc(fechaIso: string): number | null {
  const f = normalizarFecha(fechaIso);
  if (f === null) return null;
  const [anio = 0, mes = 1, dia = 1] = f.split("-").map(Number);
  return Date.UTC(anio, mes - 1, dia);
}

/** Días corridos de `emision` a `referencia` (ambas `AAAA-MM-DD`). Negativo si se emitió después. `null` si alguna no es válida. */
export function diasEntre(emision: string, referencia: string): number | null {
  const desde = aUtc(emision);
  const hasta = aUtc(referencia);
  return desde === null || hasta === null ? null : Math.round((hasta - desde) / DIA_EN_MS);
}

/**
 * "Emitida hace 45 días; todavía no está cargada". Con una emisión posterior a la referencia, lo dice sin números negativos.
 * "Hoy" solo cuando la referencia es hoy: con una fecha elegida o la fija del ejemplo, el día cero es "el día de la fecha de referencia".
 */
export function textoAntiguedad(dias: number, origen: OrigenReferencia = "hoy"): string {
  if (dias < 0) return "La fecha de emisión es posterior a la fecha de referencia";
  if (dias === 0) return `Emitida ${origen === "hoy" ? "hoy" : "el día de la fecha de referencia"}; todavía no está cargada`;
  return `Emitida hace ${textoDias(dias)}; todavía no está cargada`;
}

/** "1 día", "30 días". */
export function textoDias(n: number): string {
  return n === 1 ? "1 día" : `${conMiles(n)} días`;
}

/** Se marca desde el umbral, inclusive. */
export function esAntigua(dias: number | null, umbral: number): boolean {
  return dias !== null && dias >= umbral;
}

/** Umbral escrito por el usuario: entero de 1 a 3650 días. `null` si no es válido (se usa el anterior). */
export function interpretarUmbral(texto: string): number | null {
  if (!/^\s*\d+\s*$/.test(texto)) return null;
  const n = Number(texto.trim());
  return n >= 1 && n <= UMBRAL_ANTIGUEDAD_MAXIMO ? n : null;
}

export type ResultadoUmbral = { ok: true; valor: number } | { ok: false; mensaje: string };

/** Como `interpretarUmbral`, pero con un mensaje para quien lo escribió mal. `vigente` es el umbral que se sigue usando. */
export function validarUmbral(texto: string, vigente: number): ResultadoUmbral {
  const valor = interpretarUmbral(texto);
  if (valor !== null) return { ok: true, valor };
  return { ok: false, mensaje: `Escriba un número entero de días entre 1 y ${UMBRAL_ANTIGUEDAD_MAXIMO}. Se sigue usando ${vigente}.` };
}

// ---------------------------------------------------------------- Fecha de referencia

/** Rango de fechas de referencia que se acepta: más allá no tiene sentido ("Emitida hace 2925591 días"). */
export const FECHA_REFERENCIA_MINIMA = "2000-01-01";
export const FECHA_REFERENCIA_MAXIMA = "2100-12-31";

/** `AAAA-MM-DD` real y dentro del rango que se acepta; `null` si no. */
function referenciaSoportada(texto: string): string | null {
  const f = normalizarFecha(texto);
  return f !== null && f >= FECHA_REFERENCIA_MINIMA && f <= FECHA_REFERENCIA_MAXIMA ? f : null;
}

export type ResultadoFechaReferencia = { ok: true; manual: string } | { ok: false; mensaje: string };

/**
 * Fecha escrita o elegida en el campo. Vacía es válida y significa "usar la de por defecto" (`manual: ""`). Una fecha imposible o
 * fuera del rango da un mensaje; `vigente` (`AAAA-MM-DD`) es la fecha que se sigue usando.
 */
export function validarFechaReferencia(texto: string, vigente: string): ResultadoFechaReferencia {
  if (texto.trim() === "") return { ok: true, manual: "" };
  const f = referenciaSoportada(texto);
  if (f !== null) return { ok: true, manual: f };
  return {
    ok: false,
    mensaje: `Escriba una fecha válida entre el ${formatearFecha(FECHA_REFERENCIA_MINIMA)} y el ${formatearFecha(FECHA_REFERENCIA_MAXIMA)}. Se sigue usando ${formatearFecha(vigente)}.`,
  };
}

export type OrigenReferencia = "manual" | "ejemplo" | "hoy";

export interface Referencia {
  /** `AAAA-MM-DD`. */
  fecha: string;
  origen: OrigenReferencia;
}

function hoyIso(hoy: Date): string {
  const mm = String(hoy.getMonth() + 1).padStart(2, "0");
  const dd = String(hoy.getDate()).padStart(2, "0");
  return `${String(hoy.getFullYear()).padStart(4, "0")}-${mm}-${dd}`;
}

/**
 * Qué fecha se usa: la que eligió el usuario (si es válida); si no, la fija del ejemplo cuando la planilla solo tiene filas
 * de ejemplo; si no, hoy (fecha local).
 */
export function resolverReferencia(o: { manual: string; soloEjemplo: boolean; hoy: Date }): Referencia {
  const manual = referenciaSoportada(o.manual);
  if (manual !== null) return { fecha: manual, origen: "manual" };
  if (o.soloEjemplo) return { fecha: FECHA_REFERENCIA_EJEMPLO, origen: "ejemplo" };
  return { fecha: hoyIso(o.hoy), origen: "hoy" };
}

const ORIGEN_EN_PALABRAS: Record<OrigenReferencia, string> = {
  manual: "elegida por usted",
  ejemplo: "fija en el ejemplo",
  hoy: "hoy",
};

export function textoReferencia(r: Referencia): string {
  return `Fecha de referencia: ${formatearFecha(r.fecha)} (${ORIGEN_EN_PALABRAS[r.origen]}).`;
}

// ---------------------------------------------------------------- Por fila

/** Días desde la emisión de una fila que "falta cargar". `null` para cualquier otro resultado o si la fecha no es válida. */
export function diasDeFila(fila: Fila, resultado: Resultado | undefined, referencia: string): number | null {
  if (resultado?.tipo !== "falta") return null;
  return diasEntre(fila.datos.fecha, referencia);
}

/** Cuántas filas por cargar tienen `umbral` días o más. Las duplicadas de la planilla no cuentan (no son "falta"). */
export function contarAntiguas(filas: readonly Fila[], porFila: ReadonlyMap<number, Resultado>, referencia: string, umbral: number): number {
  return filas.filter((f) => esAntigua(diasDeFila(f, porFila.get(f.id), referencia), umbral)).length;
}

/**
 * Orden por antigüedad: primero lo que falta cargar, de la más antigua a la más nueva (las que no tienen fecha válida, al
 * final de ese grupo); después el resto, en el orden de la planilla. A igual antigüedad se respeta el orden de la planilla.
 */
export function ordenarPorAntiguedad(filas: readonly Fila[], porFila: ReadonlyMap<number, Resultado>, referencia: string): Fila[] {
  const faltantes: Array<{ fila: Fila; dias: number | null; posicion: number }> = [];
  const resto: Fila[] = [];
  filas.forEach((fila, posicion) => {
    const resultado = porFila.get(fila.id);
    if (resultado?.tipo === "falta") faltantes.push({ fila, dias: diasDeFila(fila, resultado, referencia), posicion });
    else resto.push(fila);
  });
  faltantes.sort((a, b) => {
    if (a.dias === null || b.dias === null) return a.dias === b.dias ? a.posicion - b.posicion : a.dias === null ? 1 : -1;
    return b.dias - a.dias || a.posicion - b.posicion;
  });
  return [...faltantes.map((f) => f.fila), ...resto];
}
