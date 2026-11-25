// QA medio 5 y bajo 11: UTF-16, tabulador, archivos vacíos y mensajes que dicen la causa real.

import { describe, expect, it } from "vitest";
import { detectarSeparador, leerRegistro, type LecturaRegistro } from "../src/conciliacion.ts";
import { decodificarTexto } from "../src/texto.ts";

const CUIT = "30990000014";

function utf16le(texto: string, conBom = true): Uint8Array {
  const bytes = new Uint8Array((texto.length + (conBom ? 1 : 0)) * 2);
  let i = 0;
  const poner = (code: number): void => {
    bytes[i++] = code & 0xff;
    bytes[i++] = code >> 8;
  };
  if (conBom) poner(0xfeff);
  for (let k = 0; k < texto.length; k++) poner(texto.charCodeAt(k));
  return bytes;
}

function utf16be(texto: string): Uint8Array {
  const bytes = new Uint8Array((texto.length + 1) * 2);
  let i = 0;
  const poner = (code: number): void => {
    bytes[i++] = code >> 8;
    bytes[i++] = code & 0xff;
  };
  poner(0xfeff);
  for (let k = 0; k < texto.length; k++) poner(texto.charCodeAt(k));
  return bytes;
}

describe("decodificarTexto", () => {
  it("lee UTF-8, con y sin BOM", () => {
    const sinBom = new TextEncoder().encode("Número;Ñandú");
    expect(decodificarTexto(sinBom)).toBe("Número;Ñandú");
    expect(decodificarTexto(new Uint8Array([0xef, 0xbb, 0xbf, ...sinBom]))).toBe("Número;Ñandú");
  });
  it("lee UTF-16 con BOM (el 'Texto Unicode' de Excel), little y big endian", () => {
    expect(decodificarTexto(utf16le("CUIT\tNúmero\r\n"))).toBe("CUIT\tNúmero\r\n");
    expect(decodificarTexto(utf16be("CUIT\tNúmero"))).toBe("CUIT\tNúmero");
  });
  it("cae a Windows-1252 si no es UTF-8 válido", () => {
    expect(decodificarTexto(new Uint8Array([0x4e, 0xfa, 0x6d, 0x65, 0x72, 0x6f]))).toBe("Número");
  });
  it("UTF-16 sin BOM (bytes nulos) no se puede leer: error que dice la causa", () => {
    const r = decodificarTexto(utf16le("CUIT;Tipo", false));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toContain("UTF-16");
  });
  it("un archivo vacío es un error", () => {
    const r = decodificarTexto(new Uint8Array());
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toBe("El archivo está vacío.");
  });
});

describe("separador tabulador", () => {
  it("se detecta y gana cuando es el que más aparece", () => {
    expect(detectarSeparador("cuit\ttipo\tpv\tnro\timporte\n1\t2\t3\t4\t5")).toBe("\t");
    expect(detectarSeparador("cuit;tipo;importe")).toBe(";");
  });
  it("lee un registro separado por tabulaciones, también decodificado desde UTF-16", () => {
    const texto = `CUIT\tTipo\tPunto de venta\tNúmero\tImporte\r\n${CUIT}\t1\t3\t1245\t1.234,50\r\n`;
    const directo = leerRegistro(texto) as LecturaRegistro;
    expect(directo.registros).toEqual([{ cuit: CUIT, tipoCmp: 1, ptoVta: 3, nroCmp: 1245, importe: 1234.5, linea: 2 }]);
    const desdeBytes = decodificarTexto(utf16le(texto));
    expect(typeof desdeBytes).toBe("string");
    expect(leerRegistro(desdeBytes as string)).toEqual(directo);
  });
});

describe("leerRegistro: la causa real del error", () => {
  it("un encabezado sin separadores no dice 'falta la columna de CUIT'", () => {
    const r = leerRegistro("CUIT Tipo Punto de venta Numero Importe\n1 2 3 4 5\n");
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toContain("separado por punto y coma, coma o tabulador");
    expect((r as Error).message).not.toContain("Falta la columna");
  });
  it("con separador pero sin las columnas, sigue diciendo cuál falta", () => {
    expect((leerRegistro("a;b;c\n1;2;3\n") as Error).message).toContain("Falta la columna de CUIT");
  });
});
