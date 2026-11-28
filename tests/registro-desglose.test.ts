// Columnas opcionales del registro (neto, IVA, otros conceptos, vencimiento del CAE): el desglose que el QR no trae.
// Un registro sin esas columnas se lee exactamente igual que antes.

import { describe, expect, it } from "vitest";
import {
  contarConDesglose,
  describirDesgloseIlegible,
  leerRegistro,
  type LecturaRegistro,
} from "../src/conciliacion.ts";

const CUIT = "30990000014";

function lectura(texto: string): LecturaRegistro {
  const r = leerRegistro(texto);
  if (r instanceof Error) throw r;
  return r;
}

const BASE = "CUIT;Tipo;Punto de venta;Número;Importe";

describe("compatibilidad: un registro sin columnas de desglose", () => {
  it("se lee igual que siempre: sin desglose en ningún registro y sin líneas ilegibles de desglose", () => {
    const r = lectura(`${BASE}\n${CUIT};1;3;1245;1.000,00\n${CUIT};6;1;876;45.020,00\n`);
    expect(r.registros).toHaveLength(2);
    for (const x of r.registros) expect(x).not.toHaveProperty("desglose");
    expect(r.lineasDesgloseIlegible).toEqual([]);
    expect(contarConDesglose(r)).toBe(0);
  });
});

describe("columnas opcionales del desglose", () => {
  it("lee neto, IVA, otros y vencimiento del CAE, con importes en formato argentino", () => {
    const r = lectura(`${BASE};Neto;IVA;Otros;Vencimiento CAE\n${CUIT};1;3;1245;121.000,00;100.000,00;21.000,00;0;25/10/2026\n`);
    expect(r.registros[0]?.desglose).toEqual({ neto: 100000, iva: 21000, otros: 0, vencimientoCae: "2026-10-25" });
    expect(r.lineasDesgloseIlegible).toEqual([]);
    expect(contarConDesglose(r)).toBe(1);
  });

  it("acepta otros nombres de columna, sin tildes ni mayúsculas", () => {
    const r = lectura(
      `cuit;tipo;pto vta;nro;total;Neto Gravado;Importe IVA;Otros Tributos;Vto. CAE\n${CUIT};1;3;1245;1210;1000;210;;2026-10-15\n`,
    );
    expect(r.registros[0]?.desglose).toEqual({ neto: 1000, iva: 210, otros: null, vencimientoCae: "2026-10-15" });
  });

  it("el vencimiento se acepta como AAAA-MM-DD, DD/MM/AAAA o AAAAMMDD y se guarda como AAAA-MM-DD", () => {
    const filas = ["2026-10-15", "15/10/2026", "20261015"].map((v, i) => `${CUIT};1;3;${1000 + i};10;;;;${v}`);
    const r = lectura(`${BASE};Neto;IVA;Otros;Vencimiento CAE\n${filas.join("\n")}\n`);
    expect(r.registros.map((x) => x.desglose?.vencimientoCae)).toEqual(["2026-10-15", "2026-10-15", "2026-10-15"]);
  });

  it("una celda vacía es 'no informado': null, o texto vacío en el vencimiento", () => {
    const r = lectura(`${BASE};Neto;IVA;Otros;Vencimiento CAE\n${CUIT};1;3;1245;1210;1000;;;\n`);
    expect(r.registros[0]?.desglose).toEqual({ neto: 1000, iva: null, otros: null, vencimientoCae: "" });
  });

  it("una línea con todas las celdas de desglose vacías no tiene desglose", () => {
    const r = lectura(`${BASE};Neto;IVA;Otros;Vencimiento CAE\n${CUIT};1;3;1245;1210;;;;\n${CUIT};1;3;1246;1210;1000;210;;\n`);
    expect(r.registros[0]).not.toHaveProperty("desglose");
    expect(r.registros[1]?.desglose).toBeDefined();
    expect(contarConDesglose(r)).toBe(1);
  });

  it("'Importe neto' no se confunde con la columna obligatoria de importe", () => {
    const r = lectura(`CUIT;Tipo;Punto de venta;Número;Importe neto;Importe\n${CUIT};1;3;1245;1000;1210\n`);
    expect(r.registros[0]?.importe).toBe(1210);
    expect(r.registros[0]?.desglose?.neto).toBe(1000);
  });

  it("una celda que no se puede leer no invalida la línea: se ignora ese dato y se avisa la línea", () => {
    const r = lectura(`${BASE};Neto;IVA;Otros;Vencimiento CAE\n${CUIT};1;3;1245;1210;1000;21%;;31/02/2026\n${CUIT};1;3;1246;1210;1000;210;;\n`);
    expect(r.lineasInvalidas).toEqual([]);
    expect(r.registros).toHaveLength(2);
    expect(r.registros[0]?.desglose).toEqual({ neto: 1000, iva: null, otros: null, vencimientoCae: "" });
    expect(r.lineasDesgloseIlegible).toEqual([2]);
  });

  it("una fórmula en una celda de desglose no se interpreta: es solo un dato ilegible", () => {
    const r = lectura(`${BASE};Neto\n${CUIT};1;3;1245;1210;=1+1\n${CUIT};1;3;1246;1210;"@SUM(A1)"\n`);
    expect(r.registros).toHaveLength(2);
    for (const x of r.registros) expect(x).not.toHaveProperty("desglose");
    expect(r.lineasDesgloseIlegible).toEqual([2, 3]);
  });

  it("con más de dos decimales o más de 12 dígitos enteros el importe de desglose es ilegible", () => {
    const r = lectura(`${BASE};Neto;IVA\n${CUIT};1;3;1245;1210;1000,123;1234567890123\n`);
    expect(r.registros[0]).not.toHaveProperty("desglose");
    expect(r.lineasDesgloseIlegible).toEqual([2]);
  });

  it("si el archivo repite la clave, el desglose es el de la primera línea", () => {
    const r = lectura(`${BASE};Neto;IVA\n${CUIT};1;3;1245;1210;1000;210\n${CUIT};1;3;1245;1210;900;190\n`);
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]?.desglose).toMatchObject({ neto: 1000, iva: 210 });
    expect(r.clavesRepetidas).toHaveLength(1);
  });

  it("una columna de desglose repetida usa la primera y lo avisa", () => {
    const r = lectura(`${BASE};Neto;Neto\n${CUIT};1;3;1245;1210;1000;5\n`);
    expect(r.registros[0]?.desglose?.neto).toBe(1000);
    expect(r.encabezadosDuplicados).toEqual(["neto"]);
  });

  it("separado por tabulador y con comillas", () => {
    const r = lectura(`CUIT\tTipo\tPunto de venta\tNúmero\tImporte\tNeto\tIVA\n${CUIT}\t1\t3\t1245\t1210\t"1.000,00"\t210\n`);
    expect(r.registros[0]?.desglose).toMatchObject({ neto: 1000, iva: 210 });
  });
});

describe("avisos del registro con desglose", () => {
  it("describe las líneas con datos ilegibles, en singular y plural, con tope", () => {
    expect(describirDesgloseIlegible([])).toBe("");
    expect(describirDesgloseIlegible([4])).toBe("1 línea tiene un neto, IVA, otros conceptos o vencimiento del CAE que no se pudo leer: 4. Se ignoró ese dato.");
    expect(describirDesgloseIlegible([4, 9])).toBe("2 líneas tienen un neto, IVA, otros conceptos o vencimiento del CAE que no se pudieron leer: 4, 9. Se ignoraron esos datos.");
    expect(describirDesgloseIlegible(Array.from({ length: 17 }, (_, i) => i + 2))).toContain("y 2 más");
  });
});
