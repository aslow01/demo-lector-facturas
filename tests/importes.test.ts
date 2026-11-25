// QA bajo 9: tope de dígitos y rechazo de más de 2 decimales, sin notación exponencial (edición, registro y QR).

import { describe, expect, it } from "vitest";
import { comprobanteVacio, mensajeProblemaImporte, problemaDeImporte, type Comprobante } from "../src/comprobante.ts";
import { interpretarImporte, leerRegistro, type LecturaRegistro } from "../src/conciliacion.ts";
import { agregarFila, crearFila, editarFila, siguienteId, type Fila } from "../src/planilla.ts";
import { ErrorQr, armarUrlQr, leerUrlQr } from "../src/qr-arca.ts";

const CUIT = "30990000014";
const BASE = { ver: 1, fecha: "2026-10-05", cuit: Number(CUIT), ptoVta: 3, tipoCmp: 1, nroCmp: 1245, importe: 100, moneda: "PES" };

function filaVacia(): Fila[] {
  const c: Comprobante = { ...comprobanteVacio(), importe: 10 };
  return agregarFila([], crearFila(siguienteId([]), "a.pdf", c));
}

describe("problemaDeImporte", () => {
  it("acepta hasta 12 dígitos enteros y 2 decimales", () => {
    expect(problemaDeImporte(0)).toBeNull();
    expect(problemaDeImporte(1234.56)).toBeNull();
    expect(problemaDeImporte(-9350.25)).toBeNull();
    expect(problemaDeImporte(999_999_999_999.99)).toBeNull();
  });
  it("rechaza más de 12 dígitos enteros", () => {
    expect(problemaDeImporte(1_000_000_000_000)).toBe("enteros");
    expect(problemaDeImporte(-1e13)).toBe("enteros");
    expect(problemaDeImporte(1e23)).toBe("enteros");
  });
  it("rechaza más de 2 decimales", () => {
    expect(problemaDeImporte(1.005)).toBe("decimales");
    expect(problemaDeImporte(1.234)).toBe("decimales");
    expect(problemaDeImporte(0.001)).toBe("decimales");
  });
  it("los mensajes dicen el límite", () => {
    expect(mensajeProblemaImporte("decimales")).toContain("2 decimales");
    expect(mensajeProblemaImporte("enteros")).toContain("12 dígitos");
  });
});

describe("importe escrito a mano", () => {
  it("rechaza más de 2 decimales con un mensaje claro", () => {
    const r = editarFila(filaVacia(), 1, "importe", "10,123");
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toContain("2 decimales");
  });
  it("`1,234` no se lee en silencio como 1,23", () => {
    expect(editarFila(filaVacia(), 1, "importe", "1,234")).toBeInstanceOf(Error);
  });
  it("rechaza más de 12 dígitos enteros, también si vienen con puntos de miles", () => {
    for (const t of ["1234567890123", "1.234.567.890.123,00", "99999999999999999999999"]) {
      const r = editarFila(filaVacia(), 1, "importe", t);
      expect(r).toBeInstanceOf(Error);
      expect((r as Error).message).toContain("12 dígitos");
    }
  });
  it("nunca deja pasar notación exponencial", () => {
    expect(editarFila(filaVacia(), 1, "importe", "1e+23")).toBeInstanceOf(Error);
    expect(editarFila(filaVacia(), 1, "importe", "1e5")).toBeInstanceOf(Error);
  });
  it("sigue aceptando el máximo permitido", () => {
    const r = editarFila(filaVacia(), 1, "importe", "999.999.999.999,99") as Fila[];
    expect(r[0]?.datos.importe).toBe(999_999_999_999.99);
  });
});

describe("importe en el registro", () => {
  it("interpretarImporte devuelve null para más de 2 decimales o más de 12 dígitos", () => {
    expect(interpretarImporte("1,234")).toBeNull();
    expect(interpretarImporte("12,3456")).toBeNull();
    expect(interpretarImporte("1234567890123")).toBeNull();
    expect(interpretarImporte("1e+23")).toBeNull();
    expect(interpretarImporte("1.234,56")).toBe(1234.56);
  });
  it("las líneas con importe fuera de rango se descartan y se cuentan aparte", () => {
    const r = leerRegistro(`cuit;tipo;pv;nro;importe
${CUIT};1;1;1;100,50
${CUIT};1;1;2;1,234
${CUIT};1;1;3;1234567890123
${CUIT};1;1;4;1e+23
${CUIT};1;1;5;abc
`) as LecturaRegistro;
    expect(r.registros).toHaveLength(1);
    expect(r.lineasInvalidas).toEqual([3, 4, 5, 6]);
    // "1e+23" y "abc" no son números (otra causa): solo cuentan aparte las que tienen demasiados decimales o dígitos.
    expect(r.lineasImporteExcesivo).toEqual([3, 4]);
  });
});

describe("importe en el QR", () => {
  it("más de 2 decimales o más de 12 dígitos enteros: el QR se rechaza con un mensaje claro", () => {
    for (const importe of [1.234, 1e23, 1_000_000_000_000]) {
      const r = leerUrlQr(armarUrlQr({ ...BASE, importe }));
      expect(r).toBeInstanceOf(ErrorQr);
      expect((r as ErrorQr).codigo).toBe("importe");
      expect((r as ErrorQr).message).toMatch(/2 decimales|12 dígitos/);
    }
  });
  it("también si el importe llega como texto", () => {
    expect(leerUrlQr(armarUrlQr({ ...BASE, importe: "10.125" }))).toBeInstanceOf(ErrorQr);
  });
  it("un importe normal se lee igual", () => {
    const r = leerUrlQr(armarUrlQr({ ...BASE, importe: 1234.5 }));
    expect(r).not.toBeInstanceOf(ErrorQr);
    expect((r as Comprobante).importe).toBe(1234.5);
  });
});
