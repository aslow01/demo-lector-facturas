import { describe, expect, it } from "vitest";
import { resumenAntiguedad } from "../src/vista.ts";

describe("resumenAntiguedad (rótulo del bloque plegado)", () => {
  it("dice el umbral y no menciona el orden cuando es el de la planilla", () => {
    expect(resumenAntiguedad(30, "numero")).toBe("desde 30 días");
  });
  it("suma el orden cuando no es el de la planilla", () => {
    expect(resumenAntiguedad(45, "antiguedad")).toBe("desde 45 días · más antiguas primero");
  });
  it("usa el singular y los miles como el resto de la pantalla", () => {
    expect(resumenAntiguedad(1, "numero")).toBe("desde 1 día");
    expect(resumenAntiguedad(3650, "numero")).toBe("desde 3.650 días");
  });
});

describe("resumenAntiguedad con un valor por corregir (accesibilidad m3 de la etapa 3)", () => {
  it("avisa que hay un campo con error aunque el bloque esté plegado", () => {
    expect(resumenAntiguedad(30, "numero", true)).toBe("desde 30 días · hay un valor por corregir");
    expect(resumenAntiguedad(45, "antiguedad", true)).toBe("desde 45 días · más antiguas primero · hay un valor por corregir");
  });
  it("sin error queda como antes", () => {
    expect(resumenAntiguedad(30, "numero", false)).toBe("desde 30 días");
  });
});
