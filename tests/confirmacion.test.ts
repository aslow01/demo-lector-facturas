// QA M1 (etapa 3): un doble clic o un doble Enter no debe saltarse la confirmación de "Vaciar planilla" ni de "Quitar fila".

import { describe, expect, it } from "vitest";
import { MS_ANTES_DE_CONFIRMAR, confirmacionPermitida } from "../src/confirmacion.ts";

describe("confirmacionPermitida", () => {
  it("el segundo clic pegado al primero (doble clic, doble Enter) no confirma", () => {
    expect(confirmacionPermitida(1000, 1000)).toBe(false);
    expect(confirmacionPermitida(1000, 1000 + 120)).toBe(false);
    expect(confirmacionPermitida(1000, 1000 + MS_ANTES_DE_CONFIRMAR - 1)).toBe(false);
  });
  it("un segundo clic deliberado, pasado el margen, sí confirma", () => {
    expect(confirmacionPermitida(1000, 1000 + MS_ANTES_DE_CONFIRMAR)).toBe(true);
    expect(confirmacionPermitida(1000, 1000 + 5000)).toBe(true);
  });
  it("un reloj que retrocede no deja confirmar", () => {
    expect(confirmacionPermitida(1000, 900)).toBe(false);
  });
});
