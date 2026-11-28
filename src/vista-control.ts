// Cómo se dice y se pinta el control del comprobante en la interfaz: qué observaciones tiene una fila, con qué etiqueta,
// y cuántas filas tienen alguna (para el resumen y el filtro). Funciones puras, sin DOM. Las observaciones salen de
// `control.ts`; acá solo se ordenan y se les pone texto. No se calcula nada fiscal.

import { motivosDeLectura, type CodigoMotivo } from "./comprobante.ts";
import { mostrarConFiltro, type FiltroFilas, type Resultado } from "./conciliacion.ts";
import { controlarComprobante, type Severidad } from "./control.ts";
import type { Fila } from "./planilla.ts";
import type { EtiquetaVista } from "./vista.ts";

export interface ObservacionVista {
  severidad: Severidad;
  mensaje: string;
}

const NOMBRE_SEVERIDAD: Record<Severidad, string> = { error: "Error", aviso: "Aviso" };

/** "Error" o "Aviso": el texto que acompaña al ícono en el detalle (el color nunca va solo). */
export function nombreSeveridad(s: Severidad): string {
  return NOMBRE_SEVERIDAD[s];
}

/**
 * Motivos de lectura que el control del comprobante ya dice con su propia severidad (CUIT del emisor y fecha): no se repiten.
 * Lo que queda de la lectura (total en cero, falta el tipo o el número, versión de QR desconocida) es algo que conviene mirar
 * pero que puede tener explicación: se muestra como aviso.
 */
const DICHO_POR_EL_CONTROL: ReadonlySet<CodigoMotivo> = new Set(["cuit-emisor", "fecha", "fecha-futura"]);

/**
 * Todo lo que hay para mirar en una fila con QR, con los errores primero. Vacío si la fila no tiene QR (la lectura automática no la
 * validó, así que no se la controla) o si no hay nada. Los duplicados no entran: la planilla ya los marca con su propio sello.
 */
export function observacionesDeFila(fila: Fila, hoy: Date = new Date()): ObservacionVista[] {
  if (!fila.conQr) return [];
  const control = controlarComprobante(fila.datos, fila.desglose, hoy).map((o) => ({ severidad: o.severidad, mensaje: o.mensaje }));
  const extras = motivosDeLectura(fila.datos, hoy)
    .filter((m) => !DICHO_POR_EL_CONTROL.has(m.codigo))
    .map((m): ObservacionVista => ({ severidad: "aviso", mensaje: m.mensaje }));
  return [...control.filter((o) => o.severidad === "error"), ...control.filter((o) => o.severidad === "aviso"), ...extras];
}

function cuantas(observaciones: readonly ObservacionVista[], severidad: Severidad): number {
  return observaciones.filter((o) => o.severidad === severidad).length;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** La severidad más grave de la fila, o `null` si no tiene observaciones. */
export function severidadDeFila(observaciones: readonly ObservacionVista[]): Severidad | null {
  if (observaciones.length === 0) return null;
  return cuantas(observaciones, "error") > 0 ? "error" : "aviso";
}

/**
 * La etiqueta de la fila: la severidad más grave y cuántas hay de esa ("2 errores", "1 aviso"). `null` si no hay nada que decir:
 * "Leída" sigue siendo texto suave, sin etiqueta.
 */
export function etiquetaControl(observaciones: readonly ObservacionVista[]): EtiquetaVista | null {
  const severidad = severidadDeFila(observaciones);
  if (severidad === null) return null;
  const n = cuantas(observaciones, severidad);
  return severidad === "error"
    ? { texto: plural(n, "error", "errores"), tono: "diferencia", icono: "error" }
    : { texto: plural(n, "aviso", "avisos"), tono: "revisar", icono: "alerta" };
}

/** "2 errores y 1 aviso" (solo lo que hay). Vacío si no hay nada. */
export function textoConteoFila(observaciones: readonly ObservacionVista[]): string {
  const e = cuantas(observaciones, "error");
  const a = cuantas(observaciones, "aviso");
  const partes = [e > 0 ? plural(e, "error", "errores") : "", a > 0 ? plural(a, "aviso", "avisos") : ""].filter((p) => p !== "");
  return partes.join(" y ");
}

/** Título del detalle de una fila abierta: "Observaciones del comprobante: 2 errores y 1 aviso". */
export function tituloObservaciones(observaciones: readonly ObservacionVista[]): string {
  return `Observaciones del comprobante: ${textoConteoFila(observaciones)}`;
}

/** Lo que se anuncia al abrir una fila con observaciones (el foco va al primer campo, y el detalle queda antes de los campos). */
export function anuncioFilaAbierta(numeroDeFila: number, observaciones: readonly ObservacionVista[]): string {
  if (observaciones.length === 0) return "";
  return `Fila ${numeroDeFila}: ${textoConteoFila(observaciones)}. El detalle está antes de los campos.`;
}

export interface ResumenControl {
  /** Filas que se controlan (con QR). */
  controladas: number;
  /** Filas con al menos una observación. */
  conObservaciones: number;
  /** De esas, las que tienen al menos un error. */
  conErrores: number;
  /** De esas, las que tienen solo avisos. */
  soloAvisos: number;
  /** Filas que no se pudieron controlar (sin QR): el resumen no dice nada de ellas. */
  sinControlar: number;
  /** Filas que la planilla marca como duplicadas: el control no las cuenta, tienen su propio sello. */
  duplicadas: number;
  /** Filas controladas con desglose (del registro o escrito a mano): en ellas también se controló el cuadre del total y el vencimiento del CAE. */
  conDesglose: number;
}

export interface FilaParaResumen {
  controlada: boolean;
  /** `true` si la planilla la marca como duplicada de otra. */
  duplicada?: boolean;
  /** `true` si la fila tiene neto, IVA, otros conceptos o vencimiento del CAE informados. */
  conDesglose?: boolean;
  observaciones: readonly ObservacionVista[];
}

export function resumenControl(filas: readonly FilaParaResumen[]): ResumenControl {
  const r: ResumenControl = { controladas: 0, conObservaciones: 0, conErrores: 0, soloAvisos: 0, sinControlar: 0, duplicadas: 0, conDesglose: 0 };
  for (const f of filas) {
    if (f.controlada) r.controladas++;
    else r.sinControlar++;
    if (f.controlada && f.conDesglose === true) r.conDesglose++;
    if (f.duplicada === true) r.duplicadas++;
    const severidad = severidadDeFila(f.observaciones);
    if (severidad === null) continue;
    r.conObservaciones++;
    if (severidad === "error") r.conErrores++;
    else r.soloAvisos++;
  }
  return r;
}

/**
 * El titular del resumen sobre la planilla. Sin observaciones dice entre cuántos comprobantes controlados, para no afirmar de más.
 * Vacío si ninguna fila se pudo controlar (no hay nada que afirmar).
 */
export function textoResumenControl(r: ResumenControl): string {
  if (r.controladas === 0) return "";
  if (r.conObservaciones > 0) return plural(r.conObservaciones, "comprobante con observaciones", "comprobantes con observaciones");
  if (r.controladas === 1) return "El comprobante controlado no tiene observaciones";
  return `Ningún comprobante con observaciones entre los ${r.controladas} controlados`;
}

/** La segunda línea del resumen: cuántos tienen errores y cuántos solo avisos, y lo que quedó sin controlar o marcado aparte. */
export function textoDetalleResumenControl(r: ResumenControl): string {
  const partes = [
    r.conErrores > 0 ? plural(r.conErrores, "con error", "con errores") : "",
    r.soloAvisos > 0 ? plural(r.soloAvisos, "con aviso", "con avisos") : "",
    r.conDesglose > 0 ? `${r.conDesglose} con desglose informado` : "",
    r.sinControlar > 0 ? `${r.sinControlar} sin QR, sin controlar` : "",
    r.duplicadas > 0 ? `${plural(r.duplicadas, "duplicada", "duplicadas")}, ${r.duplicadas === 1 ? "marcada" : "marcadas"} aparte` : "",
  ].filter((p) => p !== "");
  return partes.join(" · ");
}

/** Tono e ícono del resumen. El tilde verde solo si no hay observaciones y tampoco queda nada sin controlar ni duplicado. */
export function presentacionResumenControl(r: ResumenControl): { tono: "ok" | "neutro" | "revisar" | "diferencia"; icono: "check" | "punto" | "alerta" | "error" } {
  if (r.conErrores > 0) return { tono: "diferencia", icono: "error" };
  if (r.conObservaciones > 0) return { tono: "revisar", icono: "alerta" };
  if (r.sinControlar > 0 || r.duplicadas > 0) return { tono: "neutro", icono: "punto" };
  return { tono: "ok", icono: "check" };
}

/**
 * Si una fila se ve: tiene que cumplir el filtro de conciliación (`mostrarConFiltro`) y, con «Ver solo estos» activo,
 * tener observaciones del control. Una fila que se está editando se sigue mostrando aparte (ver `main.ts`).
 */
export function filaVisible(e: {
  filtro: FiltroFilas;
  resultado: Resultado | undefined;
  duplicada: boolean;
  soloConObservaciones: boolean;
  observaciones: readonly ObservacionVista[];
}): boolean {
  return mostrarConFiltro(e.filtro, e.resultado, e.duplicada) && (!e.soloConObservaciones || e.observaciones.length > 0);
}
