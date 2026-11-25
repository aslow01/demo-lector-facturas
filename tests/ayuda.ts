// Utilidades de los tests (sin depender de tipos de Node).

/** Base64 estándar de un texto UTF-8. */
export function b64(texto: string): string {
  return b64Bytes(new TextEncoder().encode(texto));
}

export function b64Bytes(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}
