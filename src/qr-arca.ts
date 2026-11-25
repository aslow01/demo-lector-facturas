// Lectura del QR de ARCA según su especificación pública:
//   https://www.afip.gob.ar/fe/qr/?p=<base64 de un JSON>   (también arca.gob.ar)
// Validación defensiva: la entrada puede ser cualquier cosa. Nunca lanza: devuelve un Comprobante o un ErrorQr.

import {
  aDecimal,
  aDigitos,
  aEnteroNoNegativo,
  mensajeProblemaImporte,
  normalizarFecha,
  problemaDeImporte,
  type Comprobante,
} from "./comprobante.ts";

export type CodigoErrorQr = "vacio" | "url" | "host" | "parametro" | "base64" | "json" | "campos" | "importe";

export class ErrorQr extends Error {
  readonly codigo: CodigoErrorQr;
  constructor(codigo: CodigoErrorQr, mensaje: string) {
    super(mensaje);
    this.name = "ErrorQr";
    this.codigo = codigo;
  }
}

const HOSTS_PERMITIDOS = new Set(["www.afip.gob.ar", "afip.gob.ar", "www.arca.gob.ar", "arca.gob.ar"]);
const LARGO_MAXIMO = 4096;
const CAMPOS_OBLIGATORIOS = ["fecha", "cuit", "ptoVta", "tipoCmp", "nroCmp", "importe"] as const;

/** Decodifica base64 estándar o URL-safe, con o sin relleno, a texto UTF-8. `null` si no es base64 o no es UTF-8. */
export function decodificarBase64(texto: string): string | null {
  const limpio = texto.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (limpio === "" || !/^[A-Za-z0-9+/]+$/.test(limpio) || limpio.length % 4 === 1) return null;
  const relleno = limpio + "=".repeat((4 - (limpio.length % 4)) % 4);
  try {
    const binario = atob(relleno);
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Valor crudo del parámetro `p` (sin que `+` se convierta en espacio). */
function extraerParametroP(url: URL): string | null {
  const consulta = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  for (const par of consulta.split("&")) {
    const igual = par.indexOf("=");
    const nombre = igual === -1 ? par : par.slice(0, igual);
    if (nombre === "p") return igual === -1 ? "" : par.slice(igual + 1);
  }
  return null;
}

function parseJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Convierte el JSON del QR en un Comprobante. Los campos inválidos quedan vacíos (la fila se marcará "revisar"). */
export function normalizarJson(datos: Record<string, unknown>): Comprobante | ErrorQr {
  const faltan = CAMPOS_OBLIGATORIOS.filter((campo) => datos[campo] === undefined || datos[campo] === null);
  if (faltan.length > 0) {
    return new ErrorQr("campos", `Al QR le faltan campos obligatorios: ${faltan.join(", ")}.`);
  }

  // Un importe fuera de rango (1e23, 3 decimales) no se corrige ni se redondea en silencio: se rechaza el QR con la causa.
  const importe = aDecimal(datos.importe);
  const problemaImporte = importe === null ? null : problemaDeImporte(importe);
  if (problemaImporte !== null) return new ErrorQr("importe", `El importe del QR no es válido. ${mensajeProblemaImporte(problemaImporte)}`);

  const fechaCruda = typeof datos.fecha === "string" ? datos.fecha.trim() : String(datos.fecha);
  const moneda = typeof datos.moneda === "string" ? datos.moneda.trim().toUpperCase().slice(0, 3) : "";
  const tipoCodAut = typeof datos.tipoCodAut === "string" ? datos.tipoCodAut.trim().toUpperCase() : "";
  const nroDoc = aDigitos(datos.nroDocRec);

  return {
    ver: aEnteroNoNegativo(datos.ver),
    fecha: normalizarFecha(fechaCruda) ?? fechaCruda,
    cuit: aDigitos(datos.cuit) ?? "",
    ptoVta: aEnteroNoNegativo(datos.ptoVta),
    tipoCmp: aEnteroNoNegativo(datos.tipoCmp),
    nroCmp: aEnteroNoNegativo(datos.nroCmp),
    importe,
    moneda,
    ctz: aDecimal(datos.ctz),
    tipoDocRec: aEnteroNoNegativo(datos.tipoDocRec),
    nroDocRec: nroDoc ?? "",
    tipoCodAut: tipoCodAut === "E" || tipoCodAut === "A" ? tipoCodAut : "",
    codAut: aDigitos(datos.codAut) ?? "",
  };
}

/** Lee el texto de un QR de ARCA (la URL completa). */
export function leerUrlQr(texto: string): Comprobante | ErrorQr {
  if (typeof texto !== "string" || texto.trim() === "") {
    return new ErrorQr("vacio", "El texto está vacío.");
  }
  const limpio = texto.trim();
  if (limpio.length > LARGO_MAXIMO) {
    return new ErrorQr("url", "El texto es demasiado largo para ser un QR de ARCA.");
  }

  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return new ErrorQr("url", "El texto no es una dirección web válida.");
  }

  if (url.protocol !== "https:" || !HOSTS_PERMITIDOS.has(url.hostname) || !url.pathname.startsWith("/fe/qr")) {
    return new ErrorQr("host", "La dirección no es un QR de ARCA (https://www.afip.gob.ar/fe/qr/ o arca.gob.ar).");
  }

  let crudo = extraerParametroP(url);
  if (crudo === null || crudo === "") {
    return new ErrorQr("parametro", "La dirección no trae el parámetro p con los datos del comprobante.");
  }
  try {
    crudo = decodeURIComponent(crudo);
  } catch {
    // se usa tal cual; si no es base64 válido falla más abajo
  }

  // Un "+" puede haber llegado como espacio; si no sirve así, se prueba descartando los espacios.
  const candidatos = [crudo.trim().replace(/\s/g, "+"), crudo];
  let decodificado = false;
  let datos: unknown = undefined;
  for (const candidato of candidatos) {
    const json = decodificarBase64(candidato);
    if (json === null) continue;
    decodificado = true;
    datos = parseJson(json);
    if (datos !== undefined) break;
  }
  if (!decodificado) {
    return new ErrorQr("base64", "Los datos del QR no son base64 válido.");
  }
  if (!esObjeto(datos)) {
    return new ErrorQr("json", "Los datos del QR no son un JSON con la forma esperada.");
  }
  return normalizarJson(datos);
}

/** Arma la URL de un QR de ARCA a partir de un objeto (para los ejemplos ficticios y los tests). */
export function armarUrlQr(datos: Record<string, unknown>): string {
  const json = JSON.stringify(datos);
  const bytes = new TextEncoder().encode(json);
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return `https://www.afip.gob.ar/fe/qr/?p=${btoa(binario)}`;
}
