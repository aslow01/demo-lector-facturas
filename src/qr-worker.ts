// Web Worker de la búsqueda de QR. Recibe los píxeles (transferidos, sin copiar) y contesta con el texto del QR o `null`.
// Se carga desde el mismo sitio (`worker-src 'self'`): no usa red.

import { buscarQrEnPixeles, type Pixeles } from "./buscar-qr.ts";

export interface PedidoQr {
  id: number;
  intentos: Pixeles[];
}

export interface RespuestaQr {
  id: number;
  texto: string | null;
  error?: string;
}

self.onmessage = (e: MessageEvent<PedidoQr>): void => {
  const { id, intentos } = e.data;
  try {
    const respuesta: RespuestaQr = { id, texto: buscarQrEnPixeles(intentos) };
    self.postMessage(respuesta);
  } catch {
    const respuesta: RespuestaQr = { id, texto: null, error: "No se pudo analizar la imagen." };
    self.postMessage(respuesta);
  }
};
