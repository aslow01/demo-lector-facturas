import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { Pagina, armarPdf } from "../scripts/pdf-ejemplo/pdf-minimo.ts";

const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

async function abrir(bytes: Uint8Array) {
  const tarea = pdfjs.getDocument({ data: new Uint8Array(bytes), useWasm: false, verbosity: 0 });
  return tarea.promise;
}

async function textoDe(bytes: Uint8Array): Promise<string> {
  const doc = await abrir(bytes);
  const pagina = await doc.getPage(1);
  const contenido = await pagina.getTextContent();
  return contenido.items.map((i) => ("str" in i ? i.str : "")).join("\n");
}

function paginaDePrueba(): Pagina {
  const p = new Pagina();
  p.texto(50, 780, "Hola (mundo) \\ con acentos: Ferretería, ñandú — fin", { tamano: 12 });
  p.texto(50, 760, "Negrita", { tamano: 14, negrita: true });
  p.rectangulo(50, 700, 100, 20, { relleno: 0.9 });
  p.cuadrados([[0, 0, 1, 1], [1, 0, 1, 1]], 300, 300, 3);
  return p;
}

describe("armarPdf", () => {
  const bytes = armarPdf(paginaDePrueba(), { titulo: "Prueba" });

  it("es un PDF con cabecera, pie y tabla de referencias cruzadas que apunta a cada objeto", () => {
    const texto = latin1(bytes);
    expect(texto.startsWith("%PDF-1.4")).toBe(true);
    expect(texto.trimEnd().endsWith("%%EOF")).toBe(true);
    const inicioXref = Number(/startxref\s+(\d+)\s+%%EOF/.exec(texto)?.[1]);
    expect(texto.slice(inicioXref, inicioXref + 4)).toBe("xref");
    const entradas = [...texto.slice(inicioXref).matchAll(/^(\d{10}) \d{5} n/gm)].map((m) => Number(m[1]));
    expect(entradas.length).toBeGreaterThanOrEqual(5);
    entradas.forEach((desplazamiento, i) => {
      expect(texto.slice(desplazamiento).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1}`).toBe(true);
    });
  });

  it("es determinístico: no lleva fechas ni identificadores al azar", () => {
    expect(armarPdf(paginaDePrueba(), { titulo: "Prueba" })).toEqual(bytes);
  });

  it("pdf.js lo abre, con una página A4", async () => {
    const doc = await abrir(bytes);
    expect(doc.numPages).toBe(1);
    const pagina = await doc.getPage(1);
    const [, , ancho, alto] = pagina.view;
    expect([ancho, alto]).toEqual([595, 842]);
  });

  it("el texto con paréntesis, barra invertida, acentos y raya larga se lee igual que se escribió", async () => {
    const texto = await textoDe(bytes);
    expect(texto).toContain("Hola (mundo) \\ con acentos: Ferretería, ñandú — fin");
    expect(texto).toContain("Negrita");
  });

  it("un carácter fuera de WinAnsi se reemplaza por un signo de pregunta en vez de romper el archivo", async () => {
    const q = new Pagina();
    q.texto(50, 780, "Cafœ 中", { tamano: 12 }); // œ sí existe en WinAnsi; el ideograma no
    const texto = await textoDe(armarPdf(q, { titulo: "x" }));
    expect(texto).toContain("Cafœ ?");
  });
});
