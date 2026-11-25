// QA alto 3 y bajo 11: tamaño y dimensiones de la imagen se miran ANTES de decodificarla (una imagen chica en bytes puede
// ser enorme en píxeles). Se arman encabezados mínimos a mano: no hace falta ningún archivo real.

import { describe, expect, it } from "vitest";
import {
  LADO_MAXIMO_PX,
  PIXELES_MAXIMOS,
  dimensionesDeDestino,
  dimensionesDeImagen,
  evaluarImagen,
  motivoDeRechazoPorTamano,
} from "../src/imagen.ts";

function bytes(...partes: Array<number[] | Uint8Array>): Uint8Array {
  return Uint8Array.from(partes.flatMap((p) => Array.from(p)));
}
const texto = (t: string): number[] => Array.from(t, (c) => c.charCodeAt(0));
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const be16 = (n: number): number[] => [(n >> 8) & 255, n & 255];
const le16 = (n: number): number[] => [n & 255, (n >> 8) & 255];

function png(ancho: number, alto: number): Uint8Array {
  return bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), texto("IHDR"), be32(ancho), be32(alto), [8, 0, 0, 0, 0]);
}

function jpeg(ancho: number, alto: number, relleno = 0): Uint8Array {
  const app = [0xff, 0xe0, ...be16(2 + relleno), ...new Array<number>(relleno).fill(7)];
  const sof = [0xff, 0xc0, ...be16(11), 8, ...be16(alto), ...be16(ancho), 1, 1, 0x11, 0];
  return bytes([0xff, 0xd8], app, sof, [0xff, 0xda]);
}

function gif(ancho: number, alto: number): Uint8Array {
  return bytes(texto("GIF89a"), le16(ancho), le16(alto), [0, 0, 0]);
}

function bmp(ancho: number, alto: number): Uint8Array {
  return bytes(texto("BM"), new Array<number>(16).fill(0), le32(ancho), le32(alto), [1, 0, 24, 0]);
}

function webpSimple(ancho: number, alto: number): Uint8Array {
  return bytes(texto("RIFF"), le32(30), texto("WEBP"), texto("VP8 "), le32(18), [0, 0, 0], [0x9d, 0x01, 0x2a], le16(ancho), le16(alto));
}

function webpSinPerdida(ancho: number, alto: number): Uint8Array {
  const a = ancho - 1;
  const h = alto - 1;
  const b = [a & 255, ((a >> 8) & 0x3f) | ((h & 3) << 6), (h >> 2) & 255, (h >> 10) & 15];
  return bytes(texto("RIFF"), le32(30), texto("WEBP"), texto("VP8L"), le32(5), [0x2f], b);
}

function webpExtendido(ancho: number, alto: number): Uint8Array {
  const tres = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
  return bytes(texto("RIFF"), le32(30), texto("WEBP"), texto("VP8X"), le32(10), [0, 0, 0, 0], tres(ancho - 1), tres(alto - 1));
}

describe("dimensionesDeImagen (sin decodificar)", () => {
  it("PNG", () => expect(dimensionesDeImagen(png(14000, 12000))).toEqual({ ancho: 14000, alto: 12000 }));
  it("JPEG, también con segmentos antes del cuadro", () => {
    expect(dimensionesDeImagen(jpeg(4032, 3024))).toEqual({ ancho: 4032, alto: 3024 });
    expect(dimensionesDeImagen(jpeg(640, 480, 300))).toEqual({ ancho: 640, alto: 480 });
  });
  it("GIF", () => expect(dimensionesDeImagen(gif(320, 200))).toEqual({ ancho: 320, alto: 200 }));
  it("BMP", () => expect(dimensionesDeImagen(bmp(800, 600))).toEqual({ ancho: 800, alto: 600 }));
  it("WebP (con y sin pérdida, y extendido)", () => {
    expect(dimensionesDeImagen(webpSimple(1000, 700))).toEqual({ ancho: 1000, alto: 700 });
    expect(dimensionesDeImagen(webpSinPerdida(1234, 5678))).toEqual({ ancho: 1234, alto: 5678 });
    expect(dimensionesDeImagen(webpExtendido(10000, 20000))).toEqual({ ancho: 10000, alto: 20000 });
  });
  it("devuelve null si no reconoce el formato o el encabezado está cortado o es absurdo", () => {
    expect(dimensionesDeImagen(new Uint8Array())).toBeNull();
    expect(dimensionesDeImagen(bytes(texto("no soy una imagen")))).toBeNull();
    expect(dimensionesDeImagen(png(10, 10).subarray(0, 20))).toBeNull();
    expect(dimensionesDeImagen(png(0, 10))).toBeNull();
    expect(dimensionesDeImagen(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull(); // JPEG que empieza la imagen sin cuadro
    expect(dimensionesDeImagen(bytes([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]))).toBeNull(); // segmento más largo que el archivo
  });
});

describe("dimensionesDeDestino", () => {
  it("no agranda ni toca lo que ya entra", () => {
    expect(dimensionesDeDestino(800, 600, LADO_MAXIMO_PX)).toEqual({ ancho: 800, alto: 600 });
  });
  it("reduce manteniendo la proporción hasta el lado máximo", () => {
    expect(dimensionesDeDestino(6000, 3000, 3000)).toEqual({ ancho: 3000, alto: 1500 });
    expect(dimensionesDeDestino(14000, 14000, 3000)).toEqual({ ancho: 3000, alto: 3000 });
  });
  it("nunca baja de 1 píxel", () => {
    expect(dimensionesDeDestino(30000, 1, 3000)).toEqual({ ancho: 3000, alto: 1 });
  });
});

describe("evaluarImagen", () => {
  it("una imagen razonable se lee y trae su tamaño de destino", () => {
    expect(evaluarImagen(png(4000, 3000))).toEqual({ tipo: "ok", ancho: 4000, alto: 3000, destino: { ancho: 3000, alto: 2250 } });
  });
  it("rechaza por tope de píxeles, aunque pese poco, y dice las medidas", () => {
    const r = evaluarImagen(png(14000, 14000));
    expect(r.tipo).toBe("error");
    if (r.tipo === "error") {
      expect(r.mensaje).toContain("14000 × 14000");
      expect(r.mensaje).toContain("megapíxeles");
    }
  });
  it("justo en el tope entra; un píxel más, no", () => {
    expect(PIXELES_MAXIMOS).toBe(50_000_000);
    expect(evaluarImagen(png(10000, 5000)).tipo).toBe("ok");
    expect(evaluarImagen(png(10001, 5000)).tipo).toBe("error");
  });
  it("si no puede leer el tamaño, lo dice y nombra los formatos admitidos", () => {
    const r = evaluarImagen(bytes(texto("????")));
    expect(r.tipo).toBe("error");
    if (r.tipo === "error") expect(r.mensaje).toMatch(/PNG.*JPG/);
  });
});

describe("motivoDeRechazoPorTamano", () => {
  it("un archivo de 0 bytes está vacío", () => {
    expect(motivoDeRechazoPorTamano(0, 15 * 1024 * 1024)).toBe("El archivo está vacío.");
  });
  it("uno demasiado grande lo dice con el máximo en MB", () => {
    expect(motivoDeRechazoPorTamano(15 * 1024 * 1024 + 1, 15 * 1024 * 1024)).toBe("El archivo supera los 15 MB.");
  });
  it("uno normal pasa", () => {
    expect(motivoDeRechazoPorTamano(1, 15 * 1024 * 1024)).toBeNull();
    expect(motivoDeRechazoPorTamano(15 * 1024 * 1024, 15 * 1024 * 1024)).toBeNull();
  });
});
