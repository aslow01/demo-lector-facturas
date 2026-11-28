// Lectura del extracto de pagos (CSV ficticio): fecha, importe, CUIT o referencia, concepto y los dos usuarios del pago.

import { describe, expect, it } from "vitest";
import { LIMITE_BYTES } from "../src/conciliacion.ts";
import { LIMITE_TEXTO, leerExtracto, type LecturaExtracto } from "../src/extracto.ts";

const CUIT = "30990000014"; // se valida abajo: si el dígito no cierra, la prueba lo dice

function leer(texto: string): LecturaExtracto {
  const r = leerExtracto(texto);
  if (r instanceof Error) throw r;
  return r;
}

const ENCABEZADO = "Fecha;Importe;CUIT;Referencia;Concepto;Cargó;Autorizó;Operación";

describe("leerExtracto: lo que lee", () => {
  it("lee una línea completa: fecha, importe, CUIT, referencia, concepto, usuarios y operación", () => {
    const r = leer(`${ENCABEZADO}\r\n30/10/2026;118.470,50;30-99000001-4;FA 0003-00001245;Factura;ana.demo;bruno.demo;10000001\r\n`);
    expect(r.lineasInvalidas).toEqual([]);
    expect(r.pagos).toEqual([
      {
        linea: 2,
        fecha: "2026-10-30",
        importe: 118470.5,
        cuit: "30990000014",
        referencia: "FA 0003-00001245",
        concepto: "Factura",
        cargo: "ana.demo",
        autorizo: "bruno.demo",
        operacion: "10000001",
      },
    ]);
  });

  it("acepta coma o tabulador, fecha ISO, importe con punto decimal y un CUIT sin guiones", () => {
    const r = leer("fecha,importe,cuit\n2026-10-30,\"1.234,50\",30990000014\n2026-10-31,99.5,30990000014\n");
    expect(r.pagos.map((p) => [p.fecha, p.importe, p.cuit])).toEqual([
      ["2026-10-30", 1234.5, "30990000014"],
      ["2026-10-31", 99.5, "30990000014"],
    ]);
    const t = leer("Fecha\tImporte\tReferencia\n30/10/2026\t500\t0001-00000007\n");
    expect(t.pagos[0]?.referencia).toBe("0001-00000007");
  });

  it("la referencia puede venir sola, sin columna de CUIT", () => {
    const r = leer("Fecha;Importe;Referencia\n30/10/2026;500;0001-00000007\n");
    expect(r.pagos[0]).toMatchObject({ cuit: "", referencia: "0001-00000007" });
  });

  it("reconoce otros nombres de columna, con tildes y mayúsculas", () => {
    const r = leer("Fecha de pago;Monto;CUIT destino;Descripción;Cargado por;Autorizado por\n30/10/2026;500;30-99000001-4;Varios;ana.demo;bruno.demo\n");
    expect(r.pagos[0]).toMatchObject({ importe: 500, cuit: "30990000014", concepto: "Varios", cargo: "ana.demo", autorizo: "bruno.demo" });
    expect(r.tieneUsuarios).toBe(true);
  });

  it("sin las columnas de usuarios lo dice (el control interno no se puede hacer)", () => {
    const r = leer("Fecha;Importe;CUIT\n30/10/2026;500;30-99000001-4\n");
    expect(r.tieneUsuarios).toBe(false);
    expect(r.pagos[0]).toMatchObject({ cargo: "", autorizo: "", concepto: "", referencia: "", operacion: "" });
  });

  it("ignora la marca de orden de bytes y las líneas vacías, y numera las líneas del archivo", () => {
    const r = leer(`﻿${ENCABEZADO}\r\n\r\n30/10/2026;500;30-99000001-4;;;;;\r\n\r\n31/10/2026;700;30-99000001-4;;;;;\r\n`);
    expect(r.pagos.map((p) => p.linea)).toEqual([3, 5]);
  });

  it("un texto que parece fórmula se guarda como texto: nunca se interpreta", () => {
    const r = leer(`Fecha;Importe;CUIT;Referencia\n30/10/2026;500;30-99000001-4;=HYPERLINK("x")\n`);
    expect(r.pagos[0]?.referencia).toBe('=HYPERLINK("x")');
  });

  it("corta los textos largos para que una celda hostil no ocupe la pantalla", () => {
    const largo = "x".repeat(LIMITE_TEXTO + 50);
    const r = leer(`Fecha;Importe;CUIT;Concepto\n30/10/2026;500;30-99000001-4;${largo}\n`);
    expect(r.pagos[0]?.concepto).toHaveLength(LIMITE_TEXTO);
  });
});

describe("leerExtracto: lo que no se puede leer", () => {
  it("una línea con fecha imposible, importe ilegible, cero o negativo se informa con su motivo y no frena al resto", () => {
    const r = leer(
      `${ENCABEZADO}\n` +
        "31/02/2026;500;30-99000001-4;;;;;\n" + // línea 2
        "30/10/2026;abc;30-99000001-4;;;;;\n" + // 3
        "30/10/2026;0;30-99000001-4;;;;;\n" + // 4
        "30/10/2026;-50;30-99000001-4;;;;;\n" + // 5
        "30/10/2026;1,234;30-99000001-4;;;;;\n" + // 6: 3 decimales, no es un importe
        "30/10/2026;500;30-99000001-4;;;;;\n", // 7: buena
    );
    expect(r.pagos.map((p) => p.linea)).toEqual([7]);
    expect(r.lineasInvalidas.map((l) => l.linea)).toEqual([2, 3, 4, 5, 6]);
    expect(r.lineasInvalidas[0]?.motivo).toMatch(/fecha/i);
    expect(r.lineasInvalidas[1]?.motivo).toMatch(/importe/i);
    expect(r.lineasInvalidas[2]?.motivo).toMatch(/mayor que cero/i);
  });

  it("un CUIT con dígito verificador inválido no se usa: queda vacío y se guarda lo que decía", () => {
    const r = leer("Fecha;Importe;CUIT;Referencia\n30/10/2026;500;30-99000001-9;0001-00000007\n");
    expect(r.pagos[0]).toMatchObject({ cuit: "", cuitIlegible: "30-99000001-9", referencia: "0001-00000007" });
  });

  it("un CUIT vacío no es un error: el pago puede identificarse por la referencia", () => {
    const r = leer("Fecha;Importe;CUIT;Referencia\n30/10/2026;500;;0001-00000007\n");
    expect(r.pagos[0]?.cuitIlegible).toBeUndefined();
  });
});

describe("leerExtracto: el archivo entero", () => {
  it("falla con un mensaje claro si falta la fecha o el importe", () => {
    expect(leerExtracto("Importe;CUIT\n500;30-99000001-4\n")).toEqual(expect.objectContaining({ message: expect.stringMatching(/columna de fecha/i) }));
    expect(leerExtracto("Fecha;CUIT\n30/10/2026;30-99000001-4\n")).toEqual(expect.objectContaining({ message: expect.stringMatching(/columna de importe/i) }));
  });

  it("falla si no hay forma de identificar al proveedor: ni CUIT ni referencia", () => {
    const r = leerExtracto("Fecha;Importe;Concepto\n30/10/2026;500;Varios\n");
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/CUIT o la referencia/);
  });

  it("falla si está vacío, si no tiene columnas o si pasa el tamaño máximo", () => {
    expect(leerExtracto("")).toBeInstanceOf(Error);
    expect(leerExtracto("   \n")).toBeInstanceOf(Error);
    expect(leerExtracto("solo una columna\nuno\n")).toBeInstanceOf(Error);
    const grande = leerExtracto(`${ENCABEZADO}\n${"x".repeat(LIMITE_BYTES + 1)}`);
    expect(grande).toBeInstanceOf(Error);
    expect((grande as Error).message).toMatch(/2 MB/);
  });

  it("falla si hay una comilla sin cerrar", () => {
    const r = leerExtracto(`${ENCABEZADO}\n30/10/2026;500;"30-99000001-4;;;;;\n`);
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/comilla/);
  });

  it("el CUIT de las pruebas es válido", () => {
    expect(leer(`Fecha;Importe;CUIT\n30/10/2026;1;${CUIT}\n`).pagos[0]?.cuit).toBe(CUIT);
  });
});

describe("leerExtracto: revisión (28/11/2026)", () => {
  it("«Ingreso» no es el usuario que cargó: en un banco suele ser un importe", () => {
    const r = leer("Fecha;Importe;CUIT;Ingreso\n30/10/2026;500;30-99000001-4;1500\n");
    expect(r.pagos[0]?.cargo).toBe("");
    expect(r.tieneUsuarios).toBe(false);
  });

  it("avisa las columnas repetidas y usa la primera", () => {
    const r = leer("Fecha;Importe;Monto;CUIT\n30/10/2026;500;999;30-99000001-4\n");
    expect(r.encabezadosDuplicados).toEqual(["importe"]);
    expect(r.pagos[0]?.importe).toBe(500);
    expect(leer("Fecha;Importe;CUIT\n30/10/2026;500;30-99000001-4\n").encabezadosDuplicados).toEqual([]);
  });

  it("«1,500», «10,000» y «2,000» no se leen como $ 1,50, $ 10 y $ 2: el importe es ambiguo y la línea se informa", () => {
    const r = leer(`${ENCABEZADO}\n30/10/2026;1,500;30-99000001-4;;;;;\n30/10/2026;10,000;30-99000001-4;;;;;\n30/10/2026;2,000;30-99000001-4;;;;;\n30/10/2026;1.500,00;30-99000001-4;;;;;\n`);
    expect(r.pagos.map((p) => p.importe)).toEqual([1500]);
    expect(r.lineasInvalidas.map((l) => l.linea)).toEqual([2, 3, 4]);
    expect(r.lineasInvalidas[0]?.motivo).toMatch(/ambiguo/i);
    expect(r.lineasInvalidas[0]?.motivo).toContain("1,500");
  });

  it("una línea con más columnas que el encabezado se informa (típico de un importe con coma decimal sin comillas)", () => {
    const r = leer("Fecha,Importe,CUIT\n30/10/2026,1500,50,30-99000001-4\n31/10/2026,700,30-99000001-4\n");
    expect(r.pagos.map((p) => p.linea)).toEqual([3]);
    expect(r.lineasInvalidas).toHaveLength(1);
    expect(r.lineasInvalidas[0]?.linea).toBe(2);
    expect(r.lineasInvalidas[0]?.motivo).toMatch(/más columnas/);
    expect(r.lineasInvalidas[0]?.motivo).toMatch(/comillas/);
  });

  it("los separadores de más al final de la línea, vacíos, no cuentan como columnas de más", () => {
    const r = leer("Fecha;Importe;CUIT\n30/10/2026;500;30-99000001-4;;\n");
    expect(r.pagos).toHaveLength(1);
    expect(r.lineasInvalidas).toEqual([]);
  });

  it("los caracteres de control y los que invierten el sentido del texto no pasan a la pantalla ni al CSV", () => {
    const r = leer(`${ENCABEZADO}\n30/10/2026;500;30-99000001-4;FA 3-1\u202Eexe.txt;Pago\u0007x\u200Bz;ana\u2066.demo;b;00123\n`);
    const p = r.pagos[0];
    expect(p?.referencia).not.toMatch(/[\u202E]/);
    expect(p?.concepto).not.toMatch(/[\u0007\u200B]/);
    expect(p?.cargo).not.toMatch(/\u2066/);
    expect(p?.referencia).toContain("FA 3-1");
  });
});
