// Búsqueda del QR en los píxeles con jsQR. Es la parte pesada de la lectura (puede tardar decenas de segundos en una imagen
// compleja), así que corre dentro de un Web Worker (`qr-worker.ts`) y no en el hilo de la interfaz.

import jsQR from "jsqr";

export interface Pixeles {
  /** RGBA, como `ImageData.data`. */
  data: Uint8ClampedArray;
  ancho: number;
  alto: number;
}

/** Prueba cada variante (por ejemplo, tamaño original y reducido a la mitad) hasta encontrar un QR con contenido. */
export function buscarQrEnPixeles(intentos: readonly Pixeles[]): string | null {
  for (const p of intentos) {
    if (p.ancho < 1 || p.alto < 1 || p.data.length !== p.ancho * p.alto * 4) continue;
    const hallado = jsQR(p.data, p.ancho, p.alto, { inversionAttempts: "attemptBoth" });
    if (hallado && hallado.data !== "") return hallado.data;
  }
  return null;
}
