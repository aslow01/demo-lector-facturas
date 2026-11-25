// QA alto 2: "Vaciar" durante la lectura corta la cola y el conteo final nunca es negativo.

import { describe, expect, it } from "vitest";
import { procesarLote, type Lectura } from "../src/lote.ts";
import { textoFinalLote } from "../src/vista.ts";

type Archivo = { name: string };
const archivos = (n: number): Archivo[] => Array.from({ length: n }, (_, i) => ({ name: `f${i + 1}.png` }));

/** Un lote con las filas que "agrega" cada lectura y un `cancelado` que se puede encender a mitad. */
function armar(total: number, cancelarAl?: { archivo: number; momento: "antes-de-leer" | "durante-la-lectura" | "despues-de-agregar" }) {
  const filas: string[] = [];
  const iniciados: string[] = [];
  let cancelado = false;
  const resultado = procesarLote(archivos(total), {
    cancelado: () => cancelado,
    alIniciar: (a) => {
      iniciados.push(a.name);
      if (cancelarAl?.momento === "antes-de-leer" && a.name === `f${cancelarAl.archivo}.png`) cancelado = true;
    },
    leer: async (a) => {
      if (cancelarAl?.momento === "durante-la-lectura" && a.name === `f${cancelarAl.archivo}.png`) cancelado = true;
      return a.name;
    },
    agregar: (_a, lectura: Lectura<string>) => {
      filas.push(lectura.ok ? lectura.valor : "error");
      if (cancelarAl?.momento === "despues-de-agregar" && filas.length === cancelarAl.archivo) cancelado = true;
      return 1;
    },
    ceder: async () => {},
  });
  return { resultado, filas, iniciados, cancelar: () => (cancelado = true) };
}

describe("procesarLote", () => {
  it("sin cancelar procesa todo y cuenta las filas agregadas", async () => {
    const { resultado, filas } = armar(3);
    expect(await resultado).toEqual({ procesados: 3, agregadas: 3, cancelado: false });
    expect(filas).toEqual(["f1.png", "f2.png", "f3.png"]);
  });

  it("un error de lectura se entrega como lectura fallida y el lote sigue", async () => {
    const recibidas: Array<Lectura<string>> = [];
    const r = await procesarLote(archivos(2), {
      cancelado: () => false,
      alIniciar: () => {},
      leer: async (a) => {
        if (a.name === "f1.png") throw new Error("roto");
        return a.name;
      },
      agregar: (_a, l) => {
        recibidas.push(l);
        return 1;
      },
      ceder: async () => {},
    });
    expect(r).toEqual({ procesados: 2, agregadas: 2, cancelado: false });
    expect(recibidas[0]?.ok).toBe(false);
    expect(recibidas[1]).toEqual({ ok: true, valor: "f2.png" });
  });

  it("si se cancela antes de empezar un archivo, no se lee ni ese ni los que siguen", async () => {
    const { resultado, filas, iniciados } = armar(5, { archivo: 3, momento: "despues-de-agregar" });
    // filas.length === 3 cancela justo después de agregar el tercero
    expect(await resultado).toEqual({ procesados: 3, agregadas: 3, cancelado: true });
    expect(filas).toHaveLength(3);
    expect(iniciados).toEqual(["f1.png", "f2.png", "f3.png"]);
  });

  it("si se cancela mientras se lee un archivo, su resultado se descarta (no repuebla la planilla)", async () => {
    const { resultado, filas } = armar(4, { archivo: 2, momento: "durante-la-lectura" });
    expect(await resultado).toEqual({ procesados: 1, agregadas: 1, cancelado: true });
    expect(filas).toEqual(["f1.png"]);
  });

  it("cancelado desde el principio: no hace nada", async () => {
    const lote = procesarLote(archivos(3), {
      cancelado: () => true,
      alIniciar: () => {
        throw new Error("no debería empezar ninguno");
      },
      leer: async () => "x",
      agregar: () => 1,
      ceder: async () => {},
    });
    expect(await lote).toEqual({ procesados: 0, agregadas: 0, cancelado: true });
  });

  it("las filas agregadas nunca son negativas, aunque la planilla se haya vaciado y vuelto a llenar a mitad", async () => {
    const { resultado } = armar(3, { archivo: 2, momento: "despues-de-agregar" });
    const r = await resultado;
    expect(r.agregadas).toBeGreaterThanOrEqual(0);
    expect(r.procesados).toBeGreaterThanOrEqual(r.agregadas > 0 ? 1 : 0);
  });
});

describe("textoFinalLote", () => {
  it("terminado", () => {
    expect(textoFinalLote({ procesados: 3, agregadas: 4, cancelado: false })).toBe("Listo: 3 archivos procesados, 4 filas agregadas.");
    expect(textoFinalLote({ procesados: 1, agregadas: 1, cancelado: false })).toBe("Listo: 1 archivo procesado, 1 fila agregada.");
    expect(textoFinalLote({ procesados: 2, agregadas: 0, cancelado: false })).toBe("Listo: 2 archivos procesados, 0 filas agregadas.");
  });
  it("cancelado: no cuenta filas ni habla de un total que ya no existe", () => {
    const t = textoFinalLote({ procesados: 2, agregadas: 2, cancelado: true });
    expect(t).toBe("Lectura cancelada: la planilla se vació antes de terminar.");
    expect(t).not.toMatch(/-\d/);
  });
});
