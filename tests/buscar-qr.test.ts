// Búsqueda del QR en píxeles (el mismo código que corre dentro del Web Worker).

import { describe, expect, it } from "vitest";
import { buscarQrEnPixeles, type Pixeles } from "../src/buscar-qr.ts";

function lienzo(ancho: number, alto: number, valor: number): Pixeles {
  return { ancho, alto, data: new Uint8ClampedArray(ancho * alto * 4).fill(valor) };
}

describe("buscarQrEnPixeles", () => {
  it("una imagen sin QR (blanca, negra o con ruido) da null", () => {
    expect(buscarQrEnPixeles([lienzo(120, 120, 255)])).toBeNull();
    expect(buscarQrEnPixeles([lienzo(120, 120, 0)])).toBeNull();
    const ruido = lienzo(200, 200, 0);
    for (let i = 0; i < ruido.data.length; i += 4) {
      const v = (i * 2654435761) % 255 > 127 ? 255 : 0;
      ruido.data[i] = ruido.data[i + 1] = ruido.data[i + 2] = v;
      ruido.data[i + 3] = 255;
    }
    expect(buscarQrEnPixeles([ruido])).toBeNull();
  });
  it("sin intentos devuelve null", () => {
    expect(buscarQrEnPixeles([])).toBeNull();
  });
  it("salta un intento mal armado (datos que no coinciden con las medidas) en vez de lanzar", () => {
    const roto: Pixeles = { ancho: 100, alto: 100, data: new Uint8ClampedArray(10) };
    expect(buscarQrEnPixeles([roto, lienzo(50, 50, 255)])).toBeNull();
  });
});
