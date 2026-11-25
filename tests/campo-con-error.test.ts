// Accesibilidad m1 (etapa 3): con un valor inválido, el lector debe decir primero el error y después la explicación del campo.

import { describe, expect, it } from "vitest";
import { describedbyConError } from "../src/vista.ts";

describe("describedbyConError", () => {
  it("pone el id del error primero y deja las demás descripciones detrás", () => {
    expect(describedbyConError("nota-dias", "error-umbral", true)).toBe("error-umbral nota-dias");
    expect(describedbyConError("referencia nota-dias", "error-fecha", true)).toBe("error-fecha referencia nota-dias");
  });
  it("sin descripciones previas queda solo el error", () => {
    expect(describedbyConError(null, "error-umbral", true)).toBe("error-umbral");
    expect(describedbyConError("", "error-umbral", true)).toBe("error-umbral");
  });
  it("no repite el id si ya estaba, y lo deja primero", () => {
    expect(describedbyConError("nota-dias error-umbral", "error-umbral", true)).toBe("error-umbral nota-dias");
  });
  it("al corregir, quita solo el id del error (o devuelve null si no queda nada)", () => {
    expect(describedbyConError("error-umbral nota-dias", "error-umbral", false)).toBe("nota-dias");
    expect(describedbyConError("error-umbral", "error-umbral", false)).toBeNull();
    expect(describedbyConError(null, "error-umbral", false)).toBeNull();
  });
});
