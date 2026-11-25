import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { crearQr, type MatrizQr } from "../scripts/pdf-ejemplo/qr-minimo.ts";

/** Dibuja la matriz como píxeles RGBA (con zona de silencio) para pasársela a un decodificador real. */
function aPixeles(qr: MatrizQr, modulo = 4, silencio = 4): { data: Uint8ClampedArray; ancho: number } {
  const ancho = (qr.tamano + silencio * 2) * modulo;
  const data = new Uint8ClampedArray(ancho * ancho * 4).fill(255);
  for (let y = 0; y < qr.tamano; y++) {
    for (let x = 0; x < qr.tamano; x++) {
      if (!qr.modulos[y]?.[x]) continue;
      for (let dy = 0; dy < modulo; dy++) {
        for (let dx = 0; dx < modulo; dx++) {
          const i = (((y + silencio) * modulo + dy) * ancho + (x + silencio) * modulo + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, ancho };
}

function decodificar(texto: string, nivel?: "L" | "M"): string | null {
  const qr = crearQr(texto, nivel);
  const { data, ancho } = aPixeles(qr);
  return jsQR(data, ancho, ancho)?.data ?? null;
}

describe("crearQr: lo que genera lo lee un decodificador real (jsQR)", () => {
  it("un texto corto (versión 1)", () => {
    expect(decodificar("hola")).toBe("hola");
    expect(crearQr("hola").tamano).toBe(21);
  });

  it("una dirección de ARCA típica de unos 250 bytes", () => {
    const url = "https://www.afip.gob.ar/fe/qr/?p=" + "eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0xMC0wNSIs".repeat(5);
    expect(decodificar(url)).toBe(url);
  });

  it("varios tamaños, para pasar por varias versiones y por la partición en bloques", () => {
    const versiones = new Set<number>();
    for (const largo of [1, 14, 17, 32, 60, 100, 154, 213, 251, 300, 420, 600]) {
      const texto = Array.from({ length: largo }, (_, i) => String.fromCharCode(33 + ((i * 7) % 90))).join("");
      for (const nivel of ["L", "M"] as const) {
        const qr = crearQr(texto, nivel);
        versiones.add(qr.version);
        expect(decodificar(texto, nivel), `largo ${largo}, nivel ${nivel}`).toBe(texto);
      }
    }
    expect(Math.max(...versiones)).toBeGreaterThanOrEqual(7); // incluye versiones con bloque de información de versión
    expect(versiones.size).toBeGreaterThan(8);
  });

  it("acentos y caracteres fuera del ASCII (UTF-8)", () => {
    const texto = "Ferretería Andina — ñandú";
    expect(decodificar(texto)).toBe(texto);
  });

  it("elige la versión más chica que alcanza", () => {
    expect(crearQr("a".repeat(14)).version).toBe(1); // 14 bytes entran en la versión 1 con nivel M
    expect(crearQr("a".repeat(15)).version).toBe(2);
  });

  it("rechaza un texto que no entra", () => {
    expect(() => crearQr("a".repeat(5000))).toThrow(/demasiado largo/i);
  });

  it("es determinístico: el mismo texto da la misma matriz", () => {
    expect(crearQr("igual").modulos).toEqual(crearQr("igual").modulos);
  });
});
