import { describe, expect, it } from "vitest";
import {
  aCodigoMoneda,
  formatearMonto,
  listarMontos,
  nombreMonedaCorto,
  pesosPrimero,
  simboloMoneda,
} from "../src/comprobante.ts";
import { crearFila, editarFila, type Fila } from "../src/planilla.ts";
import { comprobanteVacio } from "../src/comprobante.ts";

describe("monedas en la interfaz: $ y US$", () => {
  it("símbolo por código de ARCA", () => {
    expect(simboloMoneda("PES")).toBe("$");
    expect(simboloMoneda("DOL")).toBe("US$");
    expect(simboloMoneda("060")).toBe("€");
    expect(simboloMoneda("XYZ")).toBe("XYZ");
    expect(simboloMoneda("")).toBe("");
  });

  it("monto con símbolo y formato argentino", () => {
    expect(formatearMonto("PES", 43920)).toBe("$ 43.920,00");
    expect(formatearMonto("DOL", 1250)).toBe("US$ 1.250,00");
    expect(formatearMonto("", 7.5)).toBe("7,50");
    expect(formatearMonto("PES", -9350.25)).toBe("-$ 9.350,25");
    expect(formatearMonto("PES", null)).toBe("");
  });

  it("nombre corto sin el código de ARCA", () => {
    expect(nombreMonedaCorto("PES")).toBe("Pesos");
    expect(nombreMonedaCorto("DOL")).toBe("Dólares");
    expect(nombreMonedaCorto("")).toBe("Sin moneda");
    expect(nombreMonedaCorto("XYZ")).toBe("XYZ");
  });

  it("pesos, dólares, el resto y la moneda vacía al final", () => {
    expect(["060", "DOL", "", "PES"].sort(pesosPrimero)).toEqual(["PES", "DOL", "060", ""]);
  });

  it("lista de montos: '$ X y US$ Y', solo las monedas presentes", () => {
    expect(listarMontos([])).toBe("");
    expect(listarMontos([{ moneda: "PES", total: 6120 }])).toBe("$ 6.120,00");
    expect(listarMontos([{ moneda: "DOL", total: 1250 }, { moneda: "PES", total: 6120 }])).toBe("$ 6.120,00 y US$ 1.250,00");
    expect(listarMontos([{ moneda: "PES", total: 1 }, { moneda: "DOL", total: 2 }, { moneda: "060", total: 3 }])).toBe("$ 1,00, US$ 2,00 y € 3,00");
  });

  it("al editar la moneda se acepta el símbolo y se guarda el código", () => {
    expect(aCodigoMoneda("$")).toBe("PES");
    expect(aCodigoMoneda("us$")).toBe("DOL");
    expect(aCodigoMoneda("U$S")).toBe("DOL");
    expect(aCodigoMoneda("€")).toBe("060");
    expect(aCodigoMoneda("dol")).toBe("DOL");
    const filas: Fila[] = [crearFila(1, "a.pdf", { ...comprobanteVacio(), moneda: "PES" })];
    const editadas = editarFila(filas, 1, "moneda", "US$") as Fila[];
    expect(editadas[0]?.datos.moneda).toBe("DOL");
  });
});

describe("detalle del caso en la fila", () => {
  it("crearFila guarda el detalle (para el atributo title) y por defecto queda vacío", () => {
    expect(crearFila(1, "a.pdf", null).detalle).toBe("");
    expect(crearFila(1, "a.pdf", null, "", "base64 sin relleno").detalle).toBe("base64 sin relleno");
  });
});
