// Búsqueda de términos prohibidos (`scripts/prohibidos.mjs`). Los términos de estas pruebas son inventados:
// el repositorio público no puede traer los reales ni siquiera en los tests. Los reales viven en un archivo local
// no versionado (`scripts/prohibidos.local.json`).
import { describe, expect, it } from "vitest";
import {
  ARCHIVO_LOCAL,
  contieneProhibido,
  lineasConProhibido,
  normalizar,
  terminosDeJson,
  tokenizar,
} from "../scripts/prohibidos.mjs";

const terminos = terminosDeJson(JSON.stringify({ palabras: ["Zorbalux", "Quéntaro Brisa Norte", "30-99999999-1"] }));

describe("normalizar y tokenizar", () => {
  it("pasa a minúsculas, quita acentos y trata la eñe como la ene", () => {
    expect(normalizar("ZORBALUX")).toBe("zorbalux");
    expect(normalizar("Quéntaro Pingüino")).toBe("quentaro pinguino");
    expect(normalizar("Ñandú")).toBe(normalizar("Nandu"));
  });
  it("parte por todo lo que no es letra ni número y no devuelve vacíos", () => {
    expect(tokenizar("Quéntaro-Brisa_Norte, 2026!")).toEqual(["quentaro", "brisa", "norte", "2026"]);
    expect(tokenizar("  ...  ")).toEqual([]);
  });
});

describe("terminosDeJson", () => {
  it("lee { palabras: [...] } y deja cada término como lista de palabras normalizadas", () => {
    expect(terminos).toEqual([["zorbalux"], ["quentaro", "brisa", "norte"], ["30", "99999999", "1"]]);
  });
  it("ignora lo que no es texto o no tiene letras ni números", () => {
    expect(terminosDeJson(JSON.stringify({ palabras: ["", "  ", "...", 7, null, "abc"] }))).toEqual([["abc"]]);
  });
  it("sin el campo palabras no hay términos", () => {
    expect(terminosDeJson("{}")).toEqual([]);
  });
  it("un JSON roto o de otra forma falla con un mensaje claro: no puede apagar la regla en silencio", () => {
    expect(() => terminosDeJson("{no es json")).toThrow(ARCHIVO_LOCAL);
    expect(() => terminosDeJson("[]")).toThrow(ARCHIVO_LOCAL);
    expect(() => terminosDeJson('{"palabras":"zorbalux"}')).toThrow(ARCHIVO_LOCAL);
  });
});

describe("contieneProhibido", () => {
  it("encuentra un término de una palabra como trozo de otra palabra, sin importar mayúsculas ni acentos", () => {
    expect(contieneProhibido("Cliente: ZORBALUX", terminos)).toBe(true);
    expect(contieneProhibido("const zorbaluxId = 1", terminos)).toBe(true);
  });
  it("una frase se busca como palabras consecutivas, con cualquier separador", () => {
    expect(contieneProhibido("Quéntaro, Brisa-Norte", terminos)).toBe(true);
    expect(contieneProhibido("quentaro del norte", terminos)).toBe(false);
  });
  it("encuentra un CUIT escrito con o sin guiones o espacios", () => {
    expect(contieneProhibido("CUIT 30-99999999-1", terminos)).toBe(true);
    expect(contieneProhibido("CUIT 30 99999999 1", terminos)).toBe(true);
    expect(contieneProhibido("CUIT 30-99999998-1", terminos)).toBe(false);
  });
  it("sin términos no encuentra nada", () => {
    expect(contieneProhibido("ZORBALUX", [])).toBe(false);
  });
});

describe("lineasConProhibido", () => {
  it("devuelve los números de línea (desde 1) sin repetir el término", () => {
    const texto = "uno\r\nZorbalux aquí\ntres\nQuentaro Brisa Norte";
    expect(lineasConProhibido(texto, terminos)).toEqual([2, 4]);
  });
  it("sin hallazgos devuelve una lista vacía", () => {
    expect(lineasConProhibido("nada que ver", terminos)).toEqual([]);
  });
});
