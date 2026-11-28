// Lógica de presentación de la pestaña «Pagos», sin DOM: qué se dice y con qué tono, ícono y acción en cada pieza.
// `pagos-pantalla.ts` solo arma elementos con lo que devuelven estas funciones. Sin reglas fiscales: todo sale de `cuentas-a-pagar.ts`.

import { textoDias, textoReferencia, type Referencia } from "./antiguedad.ts";
import { conMiles, formatearFecha, formatearMonto, formatearNumeroCmp, nombreTipo } from "./comprobante.ts";
import type { CodigoAviso, ConciliacionPagos, FacturaAPagar, ResultadoPago, SituacionFactura } from "./cuentas-a-pagar.ts";
import { formatearCuit } from "./cuit.ts";
import type { LecturaExtracto, Pago } from "./extracto.ts";
import type { NombreIcono } from "./iconos.ts";
import type { EstadoZona, EtiquetaVista, TextosZona, Tono } from "./vista.ts";

const pesos = (n: number): string => formatearMonto("PES", n);

function plural(n: number, uno: string, varios: string): string {
  return `${conMiles(n)} ${n === 1 ? uno : varios}`;
}

/** "Factura A 0003-00001245". */
export function nombreFactura(f: FacturaAPagar): string {
  return `${nombreTipo(f.tipoCmp)} ${formatearNumeroCmp(f.ptoVta, f.nroCmp)}`;
}

/** "la línea 3", "las líneas 2 y 8", "las líneas 2, 8 y 11". Vacío si no hay ninguna. */
export function textoLineas(lineas: readonly number[]): string {
  if (lineas.length === 0) return "";
  if (lineas.length === 1) return `la línea ${lineas[0]}`;
  return `las líneas ${lineas.slice(0, -1).join(", ")} y ${lineas[lineas.length - 1]}`;
}

/** CUIT con guiones, o lo que traía la celda cuando no servía, o vacío. */
export function cuitDelPago(p: Pago): string {
  if (p.cuit !== "") return formatearCuit(p.cuit);
  return p.cuitIlegible ?? "";
}

// ---------------------------------------------------------------- Etiquetas

export function etiquetaFactura(s: SituacionFactura): EtiquetaVista {
  if (s.estado === "pagada") return { texto: "Pagada", tono: "ok", icono: "check" };
  if (s.estado === "parcial") return { texto: "Pago parcial", tono: "revisar", icono: "distinto" };
  return { texto: "Impaga", tono: "pendiente", icono: "punto" };
}

/** Marca de una factura sin pagar (o pagada en parte) desde hace `umbral` días o más. `null` si no corresponde. */
export function etiquetaAntiguaPago(s: SituacionFactura, umbral: number): EtiquetaVista | null {
  return s.antigua ? { texto: `${textoDias(umbral)} o más`, tono: "revisar", icono: "reloj" } : null;
}

export function etiquetaPago(r: ResultadoPago): EtiquetaVista {
  switch (r.estado) {
    case "emparejado":
      return { texto: "Emparejado", tono: "ok", icono: "check" };
    case "revisar":
      return { texto: "Para revisar", tono: "revisar", icono: "alerta" };
    case "sin-factura":
      return { texto: "Sin factura", tono: "diferencia", icono: "distinto" };
    case "duplicado":
      return { texto: r.duplicadoDe === null ? "Duplicado" : `Duplicado de la línea ${r.duplicadoDe}`, tono: "revisar", icono: "copias" };
  }
}

export const NOMBRE_REGLA: Record<NonNullable<ResultadoPago["regla"]>, string> = {
  referencia: "Por la referencia de la factura",
  "importe-exacto": "Por CUIT e importe",
  "suma-de-facturas": "Por suma de facturas",
  "pago-parcial": "Pago parcial",
};

export function nombreEstadoFactura(s: SituacionFactura): string {
  return etiquetaFactura(s).texto;
}

// ---------------------------------------------------------------- Texto de cada fila

/** "Emitida hace 34 días." Vacío si la fecha no es válida. */
export function textoEdad(dias: number | null): string {
  if (dias === null) return "";
  if (dias < 0) return "La fecha de emisión es posterior a la fecha de referencia.";
  if (dias === 0) return "Emitida el día de la fecha de referencia.";
  return `Emitida hace ${textoDias(dias)}.`;
}

/** Los renglones de detalle de una factura: qué la pagó, cuánto falta, de cuándo es y si un pago por revisar podría ser suyo. */
export function detalleFactura(s: SituacionFactura): string[] {
  const lineas: string[] = [];
  const f = s.factura;
  if (s.estado === "pagada") {
    lineas.push(
      `${s.pagos.length === 0 ? "Pagada" : `Pagada con ${textoLineas(s.pagos)}`}.${s.saldo > 0 ? ` Queda una diferencia de ${pesos(s.saldo)}, dentro de la tolerancia.` : ""}`,
    );
  } else if (s.estado === "parcial") {
    lineas.push(`Pagado ${pesos(s.pagado)} de ${pesos(f.importe)} (${textoLineas(s.pagos)}). Falta ${pesos(s.saldo)}.`);
  }
  if (s.estado !== "pagada") {
    const edad = textoEdad(s.dias);
    if (edad !== "") lineas.push(edad);
  }
  if (s.enRevision.length === 1) {
    lineas.push(`El pago de ${textoLineas(s.enRevision)} está para revisar y podría ser de esta factura.`);
  } else if (s.enRevision.length > 1) {
    lineas.push(`Los pagos de ${textoLineas(s.enRevision)} están para revisar y podrían ser de esta factura.`);
  }
  return lineas;
}

/** "Línea 9 · 09/11/2026 · $ 25.000,00 · 30-99000101-0": lo que identifica a un pago. */
export function lineaDePago(p: Pago): string {
  return [`Línea ${p.linea}`, formatearFecha(p.fecha), pesos(p.importe), cuitDelPago(p)].filter((x) => x !== "").join(" · ");
}

/** A qué facturas se aplicó un pago: "Factura A 0003-00001245 · $ 118.470,50". */
export function imputacionesDePago(r: ResultadoPago, facturas: ReadonlyMap<number, FacturaAPagar>): string[] {
  const textos: string[] = [];
  for (const i of r.imputaciones) {
    const f = facturas.get(i.facturaId);
    if (f !== undefined) textos.push(`${nombreFactura(f)} · ${pesos(i.importe)}`);
  }
  return textos;
}

/** Las facturas que un pago "para revisar" podría estar pagando, con lo que les falta. */
export function candidatasDePago(r: ResultadoPago, situaciones: ReadonlyMap<number, SituacionFactura>): string[] {
  const textos: string[] = [];
  for (const id of r.candidatas) {
    const s = situaciones.get(id);
    if (s !== undefined) textos.push(`${nombreFactura(s.factura)} · saldo ${pesos(s.saldo)}`);
  }
  return textos;
}

// ---------------------------------------------------------------- Filtro de la lista de facturas

export type FiltroFacturasPagos = "todas" | "falta" | "pagadas";

export function facturaVisible(s: SituacionFactura, filtro: FiltroFacturasPagos): boolean {
  if (filtro === "todas") return true;
  return filtro === "pagadas" ? s.estado === "pagada" : s.estado !== "pagada";
}

export function conteosFacturas(c: ConciliacionPagos | null): Record<FiltroFacturasPagos, number> {
  if (c === null) return { todas: 0, falta: 0, pagadas: 0 };
  const pagadas = c.resumen.pagadas;
  return { todas: c.resumen.facturas, falta: c.resumen.impagas + c.resumen.parciales, pagadas };
}

export function textoMostrandoFacturas(visibles: number, total: number): string {
  return `Mostrando ${visibles} de ${plural(total, "factura", "facturas")}`;
}

// ---------------------------------------------------------------- Resultado: la cifra protagonista

export interface ProtagonistaPagos {
  /** `sin-facturas`: no hay con qué conciliar. `cero`: todo está pagado. `faltan`: hay facturas por pagar. */
  variante: "sin-facturas" | "cero" | "faltan";
  tono: "neutro" | "pendiente" | "ok";
  rotulo: string;
  cifra: string;
  unidad: string;
  /** El saldo que falta pagar, en pesos (vacío si no hay). */
  montos: string[];
  mensaje: string;
  accion: { texto: string; filtro: "falta" } | null;
}

export function protagonistaPagos(c: ConciliacionPagos): ProtagonistaPagos {
  const r = c.resumen;
  if (r.facturas === 0) {
    return {
      variante: "sin-facturas",
      tono: "neutro",
      rotulo: "Falta pagar",
      cifra: "0",
      unidad: "facturas",
      montos: [],
      mensaje: "No hay facturas en la planilla para conciliar con estos pagos. Cargue facturas o vea el ejemplo.",
      accion: null,
    };
  }
  const faltan = r.impagas + r.parciales;
  if (faltan === 0) {
    return { variante: "cero", tono: "ok", rotulo: "Falta pagar", cifra: "0", unidad: "facturas", montos: [], mensaje: "", accion: null };
  }
  // Solo los grupos que existen: "7 pagadas, 1 con pago parcial y 8 impagas", sin "0 con pago parcial".
  const partes = [
    r.pagadas > 0 ? plural(r.pagadas, "pagada", "pagadas") : "",
    r.parciales > 0 ? `${conMiles(r.parciales)} con pago parcial` : "",
    r.impagas > 0 ? plural(r.impagas, "impaga", "impagas") : "",
  ].filter((x) => x !== "");
  const grupos = partes.length === 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
  return {
    variante: "faltan",
    tono: "pendiente",
    rotulo: "Falta pagar",
    cifra: conMiles(faltan),
    unidad: faltan === 1 ? "factura" : "facturas",
    montos: [pesos(r.saldoPendiente)],
    mensaje: `De ${plural(r.facturas, "factura", "facturas")}: ${grupos}.`,
    accion: { texto: faltan === 1 ? "Ver la factura en la lista" : `Ver las ${faltan} en la lista`, filtro: "falta" },
  };
}

// ---------------------------------------------------------------- Resultado: lo que requiere atención

export type ClaveAtencionPagos = "sinFactura" | "revisar" | "duplicados" | "mismoUsuario" | "cuitInvalido" | "operacionRepetida" | "antiguas" | "lineasIlegibles";

export interface ItemAtencionPagos {
  clave: ClaveAtencionPagos;
  cifra: number;
  texto: string;
  tono: Tono;
  icono: NombreIcono;
  /** Dónde lleva «Ver»: un bloque de la bandeja de excepciones o la lista de facturas filtrada. */
  destino: { tipo: "bloque"; id: string } | { tipo: "facturas" };
}

export const ID_BLOQUE: Record<Exclude<ClaveAtencionPagos, "antiguas">, string> = {
  sinFactura: "exc-sin-factura",
  revisar: "exc-revisar",
  duplicados: "exc-duplicados",
  mismoUsuario: "exc-usuario",
  cuitInvalido: "exc-cuit",
  operacionRepetida: "exc-operacion",
  lineasIlegibles: "exc-ilegibles",
};

export function cantidadDeAvisos(c: ConciliacionPagos, codigo: CodigoAviso): number {
  return c.avisos.filter((a) => a.codigo === codigo).length;
}

export function itemsAtencionPagos(c: ConciliacionPagos, lineasIlegibles: number, umbral: number): ItemAtencionPagos[] {
  const r = c.resumen;
  const bloque = (clave: Exclude<ClaveAtencionPagos, "antiguas">): ItemAtencionPagos["destino"] => ({ tipo: "bloque", id: ID_BLOQUE[clave] });
  const items: ItemAtencionPagos[] = [];
  if (r.sinFactura > 0) {
    items.push({
      clave: "sinFactura",
      cifra: r.sinFactura,
      texto: `${r.sinFactura === 1 ? "pago sin factura" : "pagos sin factura"} por ${pesos(r.importeSinFactura)}`,
      tono: "diferencia",
      icono: "distinto",
      destino: bloque("sinFactura"),
    });
  }
  if (r.paraRevisar > 0) {
    items.push({
      clave: "revisar",
      cifra: r.paraRevisar,
      texto: r.paraRevisar === 1 ? "pago para revisar: no se sabe a qué factura va" : "pagos para revisar: no se sabe a qué factura van",
      tono: "revisar",
      icono: "alerta",
      destino: bloque("revisar"),
    });
  }
  if (r.duplicados > 0) {
    items.push({ clave: "duplicados", cifra: r.duplicados, texto: r.duplicados === 1 ? "pago duplicado" : "pagos duplicados", tono: "revisar", icono: "copias", destino: bloque("duplicados") });
  }
  const mismo = cantidadDeAvisos(c, "mismo-usuario");
  if (mismo > 0) {
    items.push({
      clave: "mismoUsuario",
      cifra: mismo,
      texto: mismo === 1 ? "pago cargado y autorizado por la misma persona" : "pagos cargados y autorizados por la misma persona",
      tono: "revisar",
      icono: "alerta",
      destino: bloque("mismoUsuario"),
    });
  }
  const cuit = cantidadDeAvisos(c, "cuit-invalido");
  if (cuit > 0) {
    items.push({ clave: "cuitInvalido", cifra: cuit, texto: cuit === 1 ? "pago con CUIT inválido" : "pagos con CUIT inválido", tono: "diferencia", icono: "error", destino: bloque("cuitInvalido") });
  }
  const repetidas = cantidadDeAvisos(c, "operacion-repetida");
  if (repetidas > 0) {
    items.push({
      clave: "operacionRepetida",
      cifra: repetidas,
      texto: repetidas === 1 ? "pago con un número de operación que ya figuraba con otro importe o CUIT" : "pagos con un número de operación que ya figuraba con otro importe o CUIT",
      tono: "revisar",
      icono: "alerta",
      destino: bloque("operacionRepetida"),
    });
  }
  if (r.antiguas > 0) {
    items.push({
      clave: "antiguas",
      cifra: r.antiguas,
      texto: `${r.antiguas === 1 ? "factura sin pagar" : "facturas sin pagar"} con ${textoDias(umbral)} o más`,
      tono: "revisar",
      icono: "reloj",
      destino: { tipo: "facturas" },
    });
  }
  if (lineasIlegibles > 0) {
    items.push({
      clave: "lineasIlegibles",
      cifra: lineasIlegibles,
      texto: lineasIlegibles === 1 ? "línea del extracto que no se pudo leer" : "líneas del extracto que no se pudieron leer",
      tono: "neutro",
      icono: "guion",
      destino: bloque("lineasIlegibles"),
    });
  }
  return items;
}

// ---------------------------------------------------------------- Anuncios y datos de las barras

/** Se anuncia al terminar de conciliar un extracto: lo que se pagó, lo que falta y lo que requiere atención. */
export function anuncioPagos(c: ConciliacionPagos, lineasIlegibles: number, umbral: number): string {
  const r = c.resumen;
  const pagos = `Extracto conciliado: ${plural(r.pagos, "pago", "pagos")}. ${r.emparejados} emparejados, ${r.sinFactura} sin factura, ${r.duplicados} duplicados y ${r.paraRevisar} para revisar.`;
  const falta =
    r.facturas === 0
      ? "No hay facturas en la planilla para conciliar."
      : r.impagas + r.parciales === 0
        ? "Todas las facturas están pagadas."
        : `Falta pagar ${plural(r.impagas + r.parciales, "factura", "facturas")} por ${pesos(r.saldoPendiente)}.`;
  const items = itemsAtencionPagos(c, lineasIlegibles, umbral);
  const atencion = items.length === 0 ? "Nada requiere atención." : `Requieren atención: ${items.map((i) => `${i.cifra} ${i.texto}`).join(", ")}.`;
  return `${pagos} ${falta} ${atencion}`;
}

export function metaExtracto(cantidad: number | null): string {
  return cantidad === null ? "" : plural(cantidad, "pago", "pagos");
}

export function metaResultadoPagos(c: ConciliacionPagos | null): string {
  if (c === null) return "";
  const r = c.resumen;
  if (r.facturas === 0) return "Sin facturas para conciliar";
  const faltan = r.impagas + r.parciales;
  return faltan === 0 ? "Todo pagado" : `Falta pagar ${plural(faltan, "factura", "facturas")}`;
}

/** "10 de 16" cuando un filtro deja ver solo una parte. */
export function metaFacturasPagos(visibles: number, total: number): string {
  if (total === 0) return "";
  return visibles === total ? plural(total, "factura", "facturas") : `${visibles} de ${total}`;
}

export function metaPagosLista(total: number): string {
  return total === 0 ? "" : plural(total, "pago", "pagos");
}

export function metaExcepciones(c: ConciliacionPagos | null, lineasIlegibles: number, omitidas: number): string {
  if (c === null) return "";
  const n = c.paraRevisar.length + c.sinFactura.length + c.duplicados.length + c.avisos.length + lineasIlegibles + omitidas;
  return n === 0 ? "Sin excepciones" : plural(n, "excepción", "excepciones");
}

/** La línea de la barra de estado del resultado: tolerancia y fecha de referencia. */
export function lineaMenorPagos(toleranciaCentavos: number, referencia: Referencia): string {
  const tolerancia =
    toleranciaCentavos === 0 ? "Importes al centavo exacto" : `Se perdonan diferencias de hasta ${plural(toleranciaCentavos, "centavo", "centavos")}`;
  return `${tolerancia} · ${textoReferencia(referencia)}`;
}

// ---------------------------------------------------------------- La carga del extracto

export function textoExtractoCargado(origen: string, l: LecturaExtracto, facturas: number): string {
  const nombre = origen === "ejemplo" ? "el extracto de ejemplo" : origen;
  const base = `Se leyó ${nombre}: ${plural(l.pagos.length, "pago", "pagos")}.`;
  const invalidas = l.lineasInvalidas.length === 0 ? "" : ` ${plural(l.lineasInvalidas.length, "línea no se pudo leer", "líneas no se pudieron leer")} (el motivo está en las excepciones).`;
  const usuarios = l.tieneUsuarios ? "" : " El archivo no trae las columnas de usuarios («Cargó» y «Autorizó»), así que no se puede hacer el control interno.";
  const repetidas = l.encabezadosDuplicados.length === 0 ? "" : ` Columnas repetidas en el encabezado (${l.encabezadosDuplicados.join(", ")}): se usó la primera de cada una.`;
  const conFacturas = facturas === 0 ? " No hay facturas en la planilla: todos los pagos van a quedar sin factura." : "";
  return `${base}${invalidas}${repetidas}${usuarios}${conFacturas}`;
}

export function textoFacturasAConciliar(conciliables: number, omitidas: number): string {
  if (conciliables === 0 && omitidas === 0) return "La planilla no tiene facturas. Cargue facturas o use el ejemplo.";
  const base = `Se concilia con ${plural(conciliables, "factura en pesos de la planilla", "facturas en pesos de la planilla")}.`;
  return omitidas === 0 ? base : `${base} ${plural(omitidas, "queda afuera", "quedan afuera")} (motivo en las excepciones).`;
}

/** Cómo se anuncia un mensaje de la pestaña: un error interrumpe al lector de pantalla (`alert`); el resto espera su turno (`status`). */
export function anuncioDeMensaje(tono: "info" | "ok" | "aviso" | "error"): { role: "alert" | "status"; live: "assertive" | "polite" } {
  return tono === "error" ? { role: "alert", live: "assertive" } : { role: "status", live: "polite" };
}

/** Motivo de un error al leer el archivo de pagos, para el mensaje de la zona. */
export function textoErrorExtracto(mensaje: string, hayExtractoActivo: boolean): string {
  return hayExtractoActivo ? `${mensaje} Se sigue usando el extracto anterior.` : mensaje;
}

export function textosZonaExtracto(estado: EstadoZona, d: { tactil: boolean; cantidad: number; origen: string; error: string }): TextosZona {
  const vacia: TextosZona = {
    titulo: d.tactil ? "Elegir CSV" : "Arrastre el CSV aquí o elíjalo",
    ayuda: "Hasta 2 MB y 20.000 líneas.",
    accion: "",
  };
  switch (estado) {
    case "vacia":
    case "procesando":
      return vacia;
    case "arrastrando":
      return { ...vacia, titulo: "Suelte para cargar el extracto" };
    case "con-datos":
      return { titulo: `Extracto: ${plural(d.cantidad, "pago", "pagos")} (${d.origen})`, ayuda: "", accion: "Cambiar" };
    case "error":
      return { ...vacia, ayuda: d.error };
  }
}
