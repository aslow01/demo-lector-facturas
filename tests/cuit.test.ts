import { describe, expect, it } from "vitest";
import { armarCuit, cuitValido, digitoVerificador, formatearCuit } from "../src/cuit.ts";

describe("cuitValido", () => {
  it("acepta CUIT con dígito verificador correcto, como texto, con guiones y como número", () => {
    expect(cuitValido("20123456786")).toBe(true);
    expect(cuitValido("30-12345678-1")).toBe(true);
    expect(cuitValido("27123456780")).toBe(true);
    expect(cuitValido(30990000014)).toBe(true);
  });

  it("rechaza un dígito verificador equivocado", () => {
    expect(cuitValido("20123456787")).toBe(false);
    expect(cuitValido("30123456780")).toBe(false);
  });

  it("rechaza largos distintos de 11 dígitos y textos vacíos o con letras", () => {
    expect(cuitValido("")).toBe(false);
    expect(cuitValido("2012345678")).toBe(false);
    expect(cuitValido("201234567866")).toBe(false);
    expect(cuitValido("abc")).toBe(false);
    expect(cuitValido(1e21)).toBe(false);
  });

  it("rechaza las bases cuyo resto es 1 (no existe dígito válido)", () => {
    expect(digitoVerificador("3010000008")).toBeNull();
    expect(cuitValido("30100000080")).toBe(false);
    expect(cuitValido("30100000081")).toBe(false);
    expect(cuitValido("30100000089")).toBe(false);
  });

  it("usa 0 cuando el resto es 0", () => {
    expect(digitoVerificador("2712345678")).toBe(0);
    expect(cuitValido("27123456780")).toBe(true);
  });
});

describe("formatearCuit", () => {
  it("muestra 30-12345678-1", () => {
    expect(formatearCuit("30123456781")).toBe("30-12345678-1");
    expect(formatearCuit(30123456781)).toBe("30-12345678-1");
  });
  it("devuelve el texto tal cual si no tiene 11 dígitos", () => {
    expect(formatearCuit("123")).toBe("123");
    expect(formatearCuit("")).toBe("");
  });
});

describe("armarCuit", () => {
  it("genera CUIT válidos", () => {
    const cuit = armarCuit("30", "99000001");
    expect(cuit).toBe("30990000014");
    expect(cuitValido(cuit as string)).toBe(true);
  });
  it("devuelve null si la base no admite verificador", () => {
    expect(armarCuit("30", "10000008")).toBeNull();
  });
});
