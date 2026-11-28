import { describe, expect, it } from "vitest";
import { estadoDe } from "../src/comprobante.ts";
import { cuitValido } from "../src/cuit.ts";
import { CUIT_FICTICIOS, esFilaDeEjemplo, esOrigenDeEjemplo, generarEjemplos, registroEjemplo } from "../src/ejemplos.ts";
import { leerRegistro } from "../src/conciliacion.ts";
import { crearFila, duplicadas, estadoFila, type Fila } from "../src/planilla.ts";
import { ErrorQr, leerUrlQr } from "../src/qr-arca.ts";

const HOY = new Date(2026, 10, 17, 12);

function cargar(): Fila[] {
  return generarEjemplos(HOY).map((e, i) => {
    if (e.url === null) return crearFila(i + 1, e.origen, null);
    const r = leerUrlQr(e.url);
    if (r instanceof Error) throw r;
    return crearFila(i + 1, e.origen, r);
  });
}

describe("QA B4 de la etapa 3: un archivo propio llamado ejemplo-01.png no es un ejemplo", () => {
  it("la fila es de ejemplo solo si trae el caso que ilustra (lo que el programa pone al cargar los ejemplos)", () => {
    const ejemplos = generarEjemplos(HOY);
    for (const e of ejemplos) expect(esFilaDeEjemplo(crearFila(1, e.origen, null, "", e.caso))).toBe(true);
  });
  it("un archivo de la persona con ese nombre, sin caso, no se trata como ejemplo", () => {
    expect(esFilaDeEjemplo(crearFila(1, "ejemplo-01.png", null))).toBe(false);
    expect(esFilaDeEjemplo(crearFila(1, "ejemplo-01.png", null, "Sin QR legible."))).toBe(false);
  });
  it("y un caso con otro nombre de archivo tampoco", () => {
    expect(esFilaDeEjemplo(crearFila(1, "factura.png", null, "", "Un caso"))).toBe(false);
  });
});

describe("ejemplos ficticios", () => {
  it("la clave cargada dos veces en el sistema es una factura con dos copias positivas e iguales (no una nota de crédito que parezca alta y anulación)", () => {
    const lect = leerRegistro(registroEjemplo());
    if (lect instanceof Error) throw lect;
    expect(lect.clavesRepetidas).toHaveLength(1);
    const repetida = lect.clavesRepetidas[0];
    expect(repetida?.veces).toBe(2);
    expect(repetida?.registro.tipoCmp).toBe(6);
    expect(repetida?.registro.copias?.map((c) => c.importe)).toEqual([9350.25, 9350.25]);
    // La fila de ejemplo que la reclama es la misma factura, con ese importe.
    const fila = cargar().find((f) => f.datos.nroCmp === repetida?.registro.nroCmp && f.datos.ptoVta === repetida?.registro.ptoVta);
    expect(fila?.datos).toMatchObject({ tipoCmp: 6, importe: 9350.25 });
  });

  it("los CUIT ficticios tienen dígito verificador válido", () => {
    for (const cuit of Object.values(CUIT_FICTICIOS)) {
      expect(cuit).toHaveLength(11);
      expect(cuitValido(cuit)).toBe(true);
    }
  });

  it("los ejemplos se muestran como archivos ficticios numerados (ejemplo-01.png, ejemplo-02.png…)", () => {
    const origenes = generarEjemplos(HOY).map((e) => e.origen);
    origenes.forEach((o, i) => expect(o).toBe(`ejemplo-${String(i + 1).padStart(2, "0")}.png`));
    for (const o of origenes) expect(esOrigenDeEjemplo(o)).toBe(true);
    expect(esOrigenDeEjemplo("factura-real.pdf")).toBe(false);
  });

  it("cada ejemplo explica su caso de prueba, sin nombrar empresas (el QR no trae razón social)", () => {
    for (const e of generarEjemplos(HOY)) {
      expect(e.caso.length).toBeGreaterThan(10);
      expect(e.caso).not.toMatch(/Demo|S\.A\.|S\.R\.L\./);
      expect(e.origen).not.toMatch(/Demo|S\.A\.|S\.R\.L\./);
    }
  });

  it("todas las direcciones se leen como QR de ARCA", () => {
    for (const e of generarEjemplos(HOY)) {
      if (e.url !== null) expect(leerUrlQr(e.url)).not.toBeInstanceOf(ErrorQr);
    }
  });

  it("cubren los estados: leídas, para revisar, sin QR y un duplicado", () => {
    const filas = cargar();
    const estados = filas.map((f) => estadoFila(f, HOY).estado);
    expect(estados).toContain("leida");
    expect(estados).toContain("revisar");
    expect(estados).toContain("sin-qr");
    expect(duplicadas(filas).size).toBe(1);
  });

  it("incluyen CUIT inválido, total cero y fecha futura entre los casos a revisar", () => {
    const motivos = cargar()
      .filter((f) => f.conQr)
      .flatMap((f) => estadoDe(f.datos, HOY).motivos)
      .join(" ");
    expect(motivos).toContain("verificador");
    expect(motivos).toContain("cero");
    expect(motivos).toContain("futura");
  });

  it("la fecha futura sigue siendo futura sea cual sea el día en que se genere", () => {
    const hoy = new Date(2030, 0, 31, 12);
    const futura = generarEjemplos(hoy).filter((e) => e.url !== null).map((e) => leerUrlQr(e.url as string)).filter((r) => !(r instanceof Error));
    expect(futura.some((c) => !(c instanceof Error) && estadoDe(c, hoy).motivos.some((m) => m.includes("futura")))).toBe(true);
  });

  it("es determinista (mismos datos para el mismo día)", () => {
    expect(generarEjemplos(HOY)).toEqual(generarEjemplos(HOY));
  });

  it("no contiene correos ni datos de contacto", () => {
    const textos = generarEjemplos(HOY).map((e) => `${e.origen} ${e.caso}`).join(" ");
    expect(textos).not.toMatch(/@/);
  });
});
