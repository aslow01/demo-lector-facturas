// CSV de la conciliación de pagos: un renglón por pago o por factura, y todo texto del usuario protegido contra fórmulas.

import { describe, expect, it } from "vitest";
import { FECHA_REFERENCIA_EJEMPLO } from "../src/antiguedad.ts";
import { ENCABEZADOS_FACTURAS_PAGOS, ENCABEZADOS_PAGOS, diaParaArchivo, facturasPagosACsv, pagosACsv } from "../src/csv-pagos.ts";
import { conciliarPagos, facturasDeFilas, type FacturaAPagar } from "../src/cuentas-a-pagar.ts";
import { generarEjemplosCompletos } from "../src/ejemplos.ts";
import { extractoEjemplo } from "../src/ejemplos-pagos.ts";
import { leerExtracto } from "../src/extracto.ts";
import { crearFila } from "../src/planilla.ts";
import { leerUrlQr } from "../src/qr-arca.ts";

function ejemplo() {
  const filas = generarEjemplosCompletos(new Date(2026, 10, 17, 12)).map((e, i) => {
    if (e.url === null) return crearFila(i + 1, e.origen, null);
    const c = leerUrlQr(e.url);
    if (c instanceof Error) throw c;
    return crearFila(i + 1, e.origen, c);
  });
  const { facturas } = facturasDeFilas(filas);
  const lectura = leerExtracto(extractoEjemplo());
  if (lectura instanceof Error) throw lectura;
  return { facturas, c: conciliarPagos(facturas, lectura.pagos, { hoy: FECHA_REFERENCIA_EJEMPLO }) };
}

/** Parte un CSV generado por la demo en celdas (sin comillas dobles dentro de las celdas, salvo las que protegen `;`). */
function lineas(csv: string): string[] {
  return csv.replace(/^﻿/, "").split("\r\n").filter((l) => l !== "");
}

describe("CSV de pagos", () => {
  it("empieza con BOM, usa punto y coma y CRLF, y trae un renglón por pago más el encabezado", () => {
    const { c, facturas } = ejemplo();
    const csv = pagosACsv(c, facturas);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const l = lineas(csv);
    expect(l).toHaveLength(1 + 10);
    expect(l[0]).toBe(ENCABEZADOS_PAGOS.join(";"));
  });

  it("dice el resultado, la regla y a qué facturas se aplicó cada pago", () => {
    const { c, facturas } = ejemplo();
    const l = lineas(pagosACsv(c, facturas));
    const linea6 = l.find((x) => x.startsWith("6;"))!;
    expect(linea6).toContain("Emparejado");
    expect(linea6).toContain("Por la referencia de la factura");
    expect(linea6).toContain("Factura A 0003-00001270 (100000,00) + Factura A 0003-00001275 (24200,03)");
    expect(l.find((x) => x.startsWith("10;"))).toContain("Sin factura");
    expect(l.find((x) => x.startsWith("11;"))).toContain("Duplicado de la línea 3");
    expect(l.find((x) => x.startsWith("4;"))).toContain("El mismo usuario (carla.demo)");
  });

  it("los importes llevan coma decimal y el que no se aplicó a ninguna factura queda en «Sin aplicar»", () => {
    const { c, facturas } = ejemplo();
    const l = lineas(pagosACsv(c, facturas));
    expect(l.find((x) => x.startsWith("9;"))).toContain(";25000,00;");
    const celdas = l.find((x) => x.startsWith("10;"))!.split(";");
    expect(celdas[ENCABEZADOS_PAGOS.indexOf("Sin aplicar")]).toBe("18000,00");
  });

  it("neutraliza fórmulas en todo texto que viene del extracto", () => {
    const csv = [
      "Fecha;Importe;CUIT;Referencia;Concepto;Cargó;Autorizó;Operación",
      '01/11/2026;1000,00;30-99000101-0;=HYPERLINK("http://x");+cmd;-1+1;@usuario;\t5',
    ].join("\r\n");
    const lectura = leerExtracto(csv);
    if (lectura instanceof Error) throw lectura;
    const c = conciliarPagos([], lectura.pagos, { hoy: "2026-11-12" });
    const salida = pagosACsv(c, []);
    expect(salida).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(salida).toContain(";'+cmd;");
    expect(salida).toContain(";'-1+1;");
    expect(salida).toContain(";'@usuario;");
    // Ninguna celda de texto del usuario queda empezando con un carácter de fórmula.
    for (const celda of lineas(salida)[1]!.split(";")) expect(celda).not.toMatch(/^[=+@]/);
  });
});

describe("CSV de facturas con su estado de pago", () => {
  it("trae un renglón por factura con pagado, saldo, estado, días y líneas", () => {
    const { c } = ejemplo();
    const l = lineas(facturasPagosACsv(c));
    expect(l).toHaveLength(1 + 16);
    expect(l[0]).toBe(ENCABEZADOS_FACTURAS_PAGOS.join(";"));
    const parcial = l.find((x) => x.includes("Pago parcial"))!;
    const celdas = parcial.split(";");
    expect(celdas[ENCABEZADOS_FACTURAS_PAGOS.indexOf("Pagado")]).toBe("40000,00");
    expect(celdas[ENCABEZADOS_FACTURAS_PAGOS.indexOf("Saldo")]).toBe("21750,00");
    expect(celdas[ENCABEZADOS_FACTURAS_PAGOS.indexOf("Pagos (líneas del extracto)")]).toBe("2, 8");
    const antigua = l.find((x) => x.includes(";Sí;"))!;
    expect(antigua).toContain("Impaga");
    expect(antigua).toContain(";34;");
  });

  it("neutraliza un nombre de archivo que parece una fórmula", () => {
    const f: FacturaAPagar = { id: 1, cuit: "30990001010", tipoCmp: 6, ptoVta: 1, nroCmp: 876, fecha: "2026-10-07", importe: 100, origen: "=cmd|' /C calc'!A0.pdf" };
    const salida = facturasPagosACsv(conciliarPagos([f], [], { hoy: "2026-11-12" }));
    expect(lineas(salida)[1]!.startsWith("'=cmd")).toBe(true);
  });
});

describe("diaParaArchivo", () => {
  it("arma AAAA-MM-DD con ceros", () => {
    expect(diaParaArchivo(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
    expect(diaParaArchivo(new Date(2026, 10, 28, 12))).toBe("2026-11-28");
  });
});
