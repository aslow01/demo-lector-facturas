// Las facturas de ejemplo en PDF (public/ejemplos/*.pdf): datos ficticios, QR con el formato de ARCA y archivos al día con el script.
// El camino completo en el navegador (pdf.js + jsQR sobre el PDF real) se prueba aparte: `scripts/e2e-pdf-ejemplo.py`.

import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import { formatearImporte } from "../src/comprobante.ts";
import { cuitValido } from "../src/cuit.ts";
import { ErrorQr, leerUrlQr } from "../src/qr-arca.ts";
import { FACTURAS, LEYENDA_FICTICIA, totalesDe, urlQrDe } from "../scripts/pdf-ejemplo/datos.ts";
import { pdfDeFactura } from "../scripts/pdf-ejemplo/maqueta.ts";

const latin1 = (b: Uint8Array): string => new TextDecoder("latin1").decode(b);

async function lineasDeTexto(pdf: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useWasm: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const contenido = await pagina.getTextContent();
  return contenido.items.map((i) => ("str" in i ? i.str : ""));
}

/** Rasteriza los rectángulos del QR del PDF (el trazado negro de la página) y lo decodifica con jsQR, como haría un lector real. */
function leerQrDelPdf(pdf: Uint8Array): string | null {
  const flujo = latin1(pdf);
  const bloque = /q 0 g\n((?:[\d. -]+ re\n)+)f Q/.exec(flujo);
  if (!bloque?.[1]) return null;
  const rectas = [...bloque[1].matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g)].map((m) => m.slice(1, 5).map(Number) as [number, number, number, number]);
  const escala = 4; // píxeles por punto
  const ancho = 595 * escala;
  const alto = 842 * escala;
  const datos = new Uint8ClampedArray(ancho * alto * 4).fill(255);
  for (const [x, y, w, h] of rectas) {
    // El PDF tiene el origen abajo; la imagen, arriba.
    const x0 = Math.round(x * escala);
    const x1 = Math.round((x + w) * escala);
    const y0 = Math.round((842 - (y + h)) * escala);
    const y1 = Math.round((842 - y) * escala);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * ancho + px) * 4;
        datos[i] = datos[i + 1] = datos[i + 2] = 0;
      }
    }
  }
  return jsQR(datos, ancho, alto)?.data ?? null;
}

describe("facturas de ejemplo: datos", () => {
  it("hay tres, con nombres de archivo distintos", () => {
    expect(FACTURAS).toHaveLength(3);
    expect(new Set(FACTURAS.map((f) => f.archivo)).size).toBe(3);
    for (const f of FACTURAS) expect(f.archivo).toMatch(/^factura-ejemplo-[a-z0-9-]+\.pdf$/);
  });

  it("los importes suman: el total del QR es neto + IVA (o el IVA contenido) y coincide con lo previsto", () => {
    const totales = FACTURAS.map((f) => totalesDe(f).total);
    expect(totales).toEqual([118470.5, 6120, 1250]);
    for (const f of FACTURAS) {
      const t = totalesDe(f);
      if (f.tipo.letra === "A") expect(Math.round((t.neto + t.iva) * 100)).toBe(Math.round(t.total * 100));
      const suma = f.items.reduce((s, i) => s + i.cantidad * i.precioCentavos, 0);
      expect(suma / 100).toBe(f.tipo.letra === "A" ? t.neto : t.total);
    }
  });

  it("los CUIT son ficticios: de la serie inventada y con dígito verificador válido", () => {
    for (const f of FACTURAS) {
      for (const cuit of [f.emisor.cuit, f.receptor.cuit]) {
        expect(cuitValido(cuit)).toBe(true);
        expect(cuit.slice(2, 5)).toBe("990");
      }
    }
  });

  it("el QR trae el formato de ARCA y los datos de la factura", () => {
    for (const f of FACTURAS) {
      const c = leerUrlQr(urlQrDe(f));
      if (c instanceof ErrorQr) throw c;
      expect(c.cuit).toBe(f.emisor.cuit);
      expect(c.ptoVta).toBe(f.ptoVta);
      expect(c.nroCmp).toBe(f.numero);
      expect(c.tipoCmp).toBe(f.tipo.codigo);
      expect(c.fecha).toBe(f.fecha);
      expect(c.moneda).toBe(f.moneda);
      expect(c.importe).toBe(totalesDe(f).total);
      expect(c.nroDocRec).toBe(f.receptor.cuit);
      expect(c.codAut).toBe(f.cae);
    }
  });
});

describe("facturas de ejemplo: el PDF", () => {
  for (const f of FACTURAS) {
    describe(f.archivo, () => {
      const pdf = pdfDeFactura(f);

      it("lleva la leyenda de ejemplo, el CUIT rotulado como ficticio y el importe a la vista", async () => {
        const texto = (await lineasDeTexto(pdf)).join("\n");
        expect(texto).toContain(LEYENDA_FICTICIA);
        expect(texto).toMatch(/CUIT de ejemplo, ficticio/);
        expect(texto).toContain(formatearImporte(totalesDe(f).total));
        expect(texto).toContain(f.emisor.nombre);
      });

      it("no nombra ni imita a ARCA/AFIP (sin logos ni encabezados oficiales)", () => {
        expect(latin1(pdf)).not.toMatch(/afip|arca|\/Image|\/XObject/i);
      });

      it("el QR dibujado en la página se lee con un decodificador real y da los datos de la factura", () => {
        expect(leerQrDelPdf(pdf)).toBe(urlQrDe(f));
      });
    });
  }
});

describe("facturas de ejemplo: los archivos versionados", () => {
  it("public/ejemplos/*.pdf son exactamente lo que genera el script (si cambia la maqueta, hay que correr `npm run ejemplos-pdf`)", () => {
    for (const f of FACTURAS) {
      const enDisco = new Uint8Array(readFileSync(new URL(`../public/ejemplos/${f.archivo}`, import.meta.url)));
      expect(enDisco, f.archivo).toEqual(pdfDeFactura(f));
    }
  });
});

describe("facturas de ejemplo: la interfaz", () => {
  it('junto a la zona de carga hay un enlace "Descargar una factura de ejemplo (PDF ficticio)" a la primera factura', () => {
    expect(html).toMatch(
      /<a class="boton-enlace" id="descargar-pdf" href="ejemplos\/factura-ejemplo-a-1245\.pdf" download>Descargar una factura de ejemplo \(PDF ficticio\)<\/a>/,
    );
  });

  it("cada factura de ejemplo se puede descargar desde la página (atributo download) y el archivo existe", () => {
    for (const f of FACTURAS) {
      expect(html, f.archivo).toContain(`href="ejemplos/${f.archivo}" download`);
      expect(readFileSync(new URL(`../public/ejemplos/${f.archivo}`, import.meta.url)).length).toBeGreaterThan(1000);
    }
  });

  it("los enlaces no llevan estilos en línea (la política de contenido los bloquea)", () => {
    const bloque = /<p class="fuente-ejemplo" id="facturas-pdf">[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(bloque).not.toBe("");
    expect(bloque).not.toMatch(/\sstyle=/);
  });
});
