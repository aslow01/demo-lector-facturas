// Datos de un comprobante y sus reglas de validación. Funciones puras, sin acceso al navegador.

import { cuitValido, soloDigitos } from "./cuit.ts";

export type Campo = "cuit" | "tipoCmp" | "ptoVta" | "nroCmp" | "fecha" | "moneda" | "importe" | "codAut";

export type Estado = "leida" | "revisar" | "sin-qr";

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  leida: "Leída",
  revisar: "Revisar",
  "sin-qr": "Sin QR",
};

export interface Comprobante {
  ver: number | null;
  /** `AAAA-MM-DD` si es una fecha válida; si no, el texto original. */
  fecha: string;
  /** Solo dígitos. */
  cuit: string;
  ptoVta: number | null;
  tipoCmp: number | null;
  nroCmp: number | null;
  importe: number | null;
  moneda: string;
  ctz: number | null;
  tipoDocRec: number | null;
  nroDocRec: string;
  tipoCodAut: "E" | "A" | "";
  codAut: string;
}

export function comprobanteVacio(): Comprobante {
  return {
    ver: null,
    fecha: "",
    cuit: "",
    ptoVta: null,
    tipoCmp: null,
    nroCmp: null,
    importe: null,
    moneda: "",
    ctz: null,
    tipoDocRec: null,
    nroDocRec: "",
    tipoCodAut: "",
    codAut: "",
  };
}

// ---------------------------------------------------------------- Tipos de comprobante

export const NOMBRES_TIPO: Readonly<Record<number, string>> = {
  1: "Factura A",
  2: "Nota de débito A",
  3: "Nota de crédito A",
  6: "Factura B",
  7: "Nota de débito B",
  8: "Nota de crédito B",
  11: "Factura C",
  12: "Nota de débito C",
  13: "Nota de crédito C",
  51: "Factura M",
  52: "Nota de débito M",
  53: "Nota de crédito M",
  // Factura de crédito electrónica MiPyMEs (FCE): se nombran solo las notas; las facturas FCE (201, 206, 211) quedan como "Tipo N".
  202: "Nota de débito FCE A",
  203: "Nota de crédito FCE A",
  207: "Nota de débito FCE B",
  208: "Nota de crédito FCE B",
  212: "Nota de débito FCE C",
  213: "Nota de crédito FCE C",
  // Operaciones con el exterior.
  20: "Nota de débito por operaciones con el exterior",
  21: "Nota de crédito por operaciones con el exterior",
};

const NOTAS_DE_CREDITO = new Set([3, 8, 13, 53, 203, 208, 213, 21]);

export function nombreTipo(tipo: number | null): string {
  if (tipo === null) return "";
  return NOMBRES_TIPO[tipo] ?? `Tipo ${tipo}`;
}

const NOTAS_DE_DEBITO = new Set([2, 7, 12, 52, 202, 207, 212, 20]);

export function esNotaDeDebito(tipo: number | null): boolean {
  return tipo !== null && NOTAS_DE_DEBITO.has(tipo);
}

/** `true` si la demo conoce el tipo (tiene nombre). Con los otros no puede decir si es factura, nota de débito o de crédito. */
export function esTipoConocido(tipo: number | null): boolean {
  return tipo !== null && Object.hasOwn(NOMBRES_TIPO, tipo);
}

export function esNotaDeCredito(tipo: number | null): boolean {
  return tipo !== null && NOTAS_DE_CREDITO.has(tipo);
}

// ---------------------------------------------------------------- Monedas

const NOMBRES_MONEDA: Readonly<Record<string, string>> = {
  PES: "Pesos (PES)",
  DOL: "Dólares (DOL)",
  "060": "Euros (060)",
};

export function nombreMoneda(moneda: string): string {
  if (moneda === "") return "Sin moneda";
  return NOMBRES_MONEDA[moneda] ?? moneda;
}

// ---------------------------------------------------------------- Monedas para la interfaz ($ y US$)

const SIMBOLOS_MONEDA: Readonly<Record<string, string>> = { PES: "$", DOL: "US$", "060": "€" };
const NOMBRES_MONEDA_CORTOS: Readonly<Record<string, string>> = { PES: "Pesos", DOL: "Dólares", "060": "Euros" };

/** `PES` → `$`, `DOL` → `US$`. Un código desconocido se muestra tal cual. Los códigos de ARCA quedan para el CSV. */
export function simboloMoneda(moneda: string): string {
  return SIMBOLOS_MONEDA[moneda] ?? moneda;
}

export function nombreMonedaCorto(moneda: string): string {
  if (moneda === "") return "Sin moneda";
  return NOMBRES_MONEDA_CORTOS[moneda] ?? moneda;
}

/** `$ 43.920,00`, `US$ 1.250,00`, `-$ 9.350,25`. Sin moneda, solo el número. */
export function formatearMonto(moneda: string, importe: number | null): string {
  if (importe === null) return "";
  const simbolo = simboloMoneda(moneda);
  const numero = formatearImporte(Math.abs(importe));
  return `${importe < 0 ? "-" : ""}${simbolo === "" ? "" : `${simbolo} `}${numero}`;
}

/** Orden para mostrar monedas: pesos, dólares, el resto por código y la moneda vacía al final. */
export function pesosPrimero(a: string, b: string): number {
  const peso = (m: string): number => (m === "PES" ? 0 : m === "DOL" ? 1 : m === "" ? 3 : 2);
  return peso(a) - peso(b) || a.localeCompare(b);
}

/** `$ 6.120,00 y US$ 1.250,00`: solo las monedas que están, pesos primero. */
export function listarMontos(items: ReadonlyArray<{ moneda: string; total: number }>): string {
  const textos = [...items].sort((x, y) => pesosPrimero(x.moneda, y.moneda)).map((i) => formatearMonto(i.moneda, i.total));
  if (textos.length <= 1) return textos.join("");
  return `${textos.slice(0, -1).join(", ")} y ${textos[textos.length - 1]}`;
}

/** Lo que el usuario escribe en la celda de moneda: acepta `$`, `US$` y `€` y guarda el código de ARCA. */
export function aCodigoMoneda(texto: string): string {
  const t = texto.trim().toUpperCase();
  if (t === "$") return "PES";
  if (t === "US$" || t === "U$S") return "DOL";
  if (t === "€") return "060";
  return t;
}

// ---------------------------------------------------------------- Normalización de valores

/** Entero no negativo desde un número o un texto de dígitos (los JSON de ARCA a veces traen números como texto). */
export function aEnteroNoNegativo(valor: unknown): number | null {
  if (typeof valor === "number") {
    return Number.isSafeInteger(valor) && valor >= 0 ? valor : null;
  }
  if (typeof valor === "string" && /^\s*\d+\s*$/.test(valor)) {
    const n = Number(valor.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** Decimal con punto (formato del JSON de ARCA). Tolera coma si no hay punto. `null` si no es un número. */
export function aDecimal(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;
  let texto = valor.trim();
  if (/^-?\d+,\d+$/.test(texto)) texto = texto.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(texto)) return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/** Texto de dígitos desde un número o un texto con guiones/espacios/puntos. `null` si no hay dígitos o hay otros caracteres. */
export function aDigitos(valor: unknown): string | null {
  if (typeof valor === "number") {
    return Number.isSafeInteger(valor) && valor >= 0 ? String(valor) : null;
  }
  if (typeof valor === "string" && /^[\d\-\s.]+$/.test(valor)) {
    const d = soloDigitos(valor);
    return d === "" ? null : d;
  }
  return null;
}

function esFechaReal(anio: number, mes: number, dia: number): boolean {
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Acepta `AAAA-MM-DD` y `DD/MM/AAAA` (o con guiones). Devuelve `AAAA-MM-DD` o `null`. */
export function normalizarFecha(texto: string): string | null {
  const t = texto.trim();
  let anio: number, mes: number, dia: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    anio = Number(m[1]);
    mes = Number(m[2]);
    dia = Number(m[3]);
  } else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
    if (!m) return null;
    dia = Number(m[1]);
    mes = Number(m[2]);
    anio = Number(m[3]);
  }
  if (!esFechaReal(anio, mes, dia)) return null;
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Importe escrito a mano en formato argentino: `1.234,56` (coma decimal, puntos de miles).
 * Sin coma, un punto seguido de tres dígitos se toma como separador de miles (`1.234` = 1234);
 * en otro caso el punto es decimal (`12.5`).
 */
export function parsearImporteTexto(texto: string): number | null {
  let t = texto.trim().replace(/\s/g, "");
  if (t === "") return null;
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- Límites de los importes

/** Un importe tiene hasta 12 dígitos enteros y 2 decimales: más allá es casi seguro un error y rompe el formato. */
export const MAXIMO_DIGITOS_ENTEROS = 12;
const TOPE_IMPORTE = 10 ** MAXIMO_DIGITOS_ENTEROS;

export type ProblemaImporte = "enteros" | "decimales";

/** `null` si el importe cabe en el formato (12 enteros y 2 decimales); si no, qué límite rompe. */
export function problemaDeImporte(n: number): ProblemaImporte | null {
  if (Math.abs(n) >= TOPE_IMPORTE) return "enteros";
  // Un valor con 2 decimales vuelve a sí mismo al redondear a centavos (la división está correctamente redondeada).
  return Math.round(n * 100) / 100 === n ? null : "decimales";
}

export function mensajeProblemaImporte(problema: ProblemaImporte): string {
  return problema === "enteros"
    ? `El importe no puede tener más de ${MAXIMO_DIGITOS_ENTEROS} dígitos enteros.`
    : "El importe no puede tener más de 2 decimales.";
}

// ---------------------------------------------------------------- Presentación

/** `1234.5` se muestra como `1.234,50`. */
export function formatearImporte(n: number | null): string {
  if (n === null) return "";
  const negativo = n < 0;
  const [entera = "0", decimales = "00"] = Math.abs(n).toFixed(2).split(".");
  const conMiles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${conMiles},${decimales}`;
}

/** `AAAA-MM-DD` se muestra como `DD/MM/AAAA`. Si no es una fecha válida, devuelve el texto tal cual. */
export function formatearFecha(fecha: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!iso || normalizarFecha(fecha) === null) return fecha;
  return `${iso[3]}/${iso[2]}/${iso[1]}`;
}

/** Punto de venta y número como en la factura: `0001-00000123`. */
export function formatearNumeroCmp(ptoVta: number | null, nroCmp: number | null): string {
  if (ptoVta === null && nroCmp === null) return "";
  const pv = ptoVta === null ? "?" : String(ptoVta).padStart(4, "0");
  const nro = nroCmp === null ? "?" : String(nroCmp).padStart(8, "0");
  return `${pv}-${nro}`;
}

// ---------------------------------------------------------------- Duplicados y estado

/** Clave de duplicado: CUIT emisor + tipo + punto de venta + número. `null` si falta algún dato (nunca se marca duplicada). */
export function claveDuplicado(c: Pick<Comprobante, "cuit" | "tipoCmp" | "ptoVta" | "nroCmp">): string | null {
  if (c.cuit.length !== 11 || c.tipoCmp === null || c.ptoVta === null || c.nroCmp === null) return null;
  return `${c.cuit}|${c.tipoCmp}|${c.ptoVta}|${c.nroCmp}`;
}

function fechaLocalIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear()).padStart(4, "0")}-${mm}-${dd}`;
}

/** Datos dudosos del comprobante, en palabras. Vacío si no hay nada que revisar. */
export function motivosRevisar(c: Comprobante, hoy: Date = new Date()): string[] {
  const motivos: string[] = [];

  if (c.cuit === "") motivos.push("Falta el CUIT del emisor.");
  else if (c.cuit.length !== 11) motivos.push("El CUIT del emisor no tiene 11 dígitos.");
  else if (!cuitValido(c.cuit)) motivos.push("El CUIT del emisor tiene el dígito verificador inválido.");

  if (c.importe === null) motivos.push("El total falta o no es un número.");
  else if (c.importe === 0) motivos.push("El total es cero.");
  else if (c.importe < 0) motivos.push("El total es negativo.");

  const fecha = normalizarFecha(c.fecha);
  if (c.fecha === "") motivos.push("Falta la fecha.");
  else if (fecha === null) motivos.push("La fecha no es válida.");
  else if (fecha > fechaLocalIso(hoy)) motivos.push("La fecha es futura.");

  const faltan: string[] = [];
  if (c.tipoCmp === null) faltan.push("tipo de comprobante");
  if (c.ptoVta === null) faltan.push("punto de venta");
  if (c.nroCmp === null) faltan.push("número");
  if (faltan.length > 0) motivos.push(`Falta o no es válido: ${faltan.join(", ")}.`);

  if (c.ver !== null && c.ver !== 1) motivos.push(`Versión de QR desconocida (${c.ver}).`);

  return motivos;
}

/** Estado de un comprobante leído del QR (`null` = no se encontró QR). */
export function estadoDe(c: Comprobante | null, hoy: Date = new Date()): { estado: Estado; motivos: string[] } {
  if (c === null) return { estado: "sin-qr", motivos: ["No se encontró un QR de ARCA. Puede completar los datos a mano."] };
  const motivos = motivosRevisar(c, hoy);
  return { estado: motivos.length > 0 ? "revisar" : "leida", motivos };
}

/** `13469` → `13.469`: el separador de miles de los importes, para cantidades y días. */
export function conMiles(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
