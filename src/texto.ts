// Decodificación de archivos de texto subidos por el usuario (el CSV del registro). Sin acceso al navegador.

import { ErrorRegistro } from "./conciliacion.ts";

function empiezaCon(bytes: Uint8Array, ...inicio: number[]): boolean {
  return inicio.every((b, i) => bytes[i] === b);
}

/**
 * Pasa los bytes a texto: UTF-8 (con o sin BOM), UTF-16 con BOM (el "Texto Unicode" de Excel) o, si no es UTF-8 válido,
 * Windows-1252 (Excel en Windows). Un archivo con bytes nulos sin BOM es UTF-16 sin marca: no se adivina, se avisa.
 * Devuelve `ErrorRegistro` con la causa si el archivo está vacío o no se puede leer como texto.
 */
export function decodificarTexto(bytes: Uint8Array): string | ErrorRegistro {
  if (bytes.length === 0) return new ErrorRegistro("El archivo está vacío.");
  if (empiezaCon(bytes, 0xff, 0xfe)) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (empiezaCon(bytes, 0xfe, 0xff)) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes.includes(0)) {
    return new ErrorRegistro(
      "El archivo parece estar en UTF-16 sin marca de orden de bytes, o no es un CSV de texto. Guárdelo como CSV UTF-8 o CSV (delimitado por comas).",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
