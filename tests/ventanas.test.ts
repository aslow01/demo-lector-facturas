import { describe, expect, it } from "vitest";
import { idsControlados } from "../src/ventanas.ts";

describe("idsControlados (aria-controls de una ventana)", () => {
  it("separa por espacios y ignora los vacíos", () => {
    expect(idsControlados("interior-planilla barra-planilla")).toEqual(["interior-planilla", "barra-planilla"]);
    expect(idsControlados("  uno   dos \n tres ")).toEqual(["uno", "dos", "tres"]);
  });

  it("sin atributo o vacío, no controla nada", () => {
    expect(idsControlados(null)).toEqual([]);
    expect(idsControlados("")).toEqual([]);
    expect(idsControlados("   ")).toEqual([]);
  });

  it("no repite ids", () => {
    expect(idsControlados("a b a")).toEqual(["a", "b"]);
  });
});
