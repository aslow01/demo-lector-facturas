// QA medio M2: las notas de crédito y de débito de tipos poco comunes (52, 53, 203, etc.) no se cuentan como "facturas".

import { describe, expect, it } from "vitest";
import { comprobanteVacio, esNotaDeCredito, esNotaDeDebito, nombreTipo, type Comprobante } from "../src/comprobante.ts";
import { conciliar, interpretarTipo, resumenConciliacion } from "../src/conciliacion.ts";
import { agregarFila, crearFila, siguienteId, totalesPorMoneda, type Fila } from "../src/planilla.ts";
import { anuncioConciliacion, protagonista } from "../src/vista.ts";

const HOY = new Date(2026, 10, 17);
const CUIT = "30990000014";

function planilla(...datos: Array<Partial<Comprobante>>): Fila[] {
  let filas: Fila[] = [];
  for (const d of datos) {
    const dato: Comprobante = { ...comprobanteVacio(), ver: 1, cuit: CUIT, ptoVta: 1, tipoCmp: 1, nroCmp: filas.length + 1, importe: 100, moneda: "PES", fecha: "2026-10-01", ...d };
    filas = agregarFila(filas, crearFila(siguienteId(filas), `a-${filas.length + 1}.pdf`, dato));
  }
  return filas;
}

const resumenDe = (filas: Fila[]) => resumenConciliacion(filas, conciliar(filas, [], HOY));

describe("clasificación de tipos", () => {
  it("reconoce las notas de crédito M, de crédito electrónica (FCE) y de operaciones con el exterior", () => {
    for (const t of [3, 8, 13, 53, 203, 208, 213, 21]) expect(esNotaDeCredito(t), `tipo ${t}`).toBe(true);
    for (const t of [1, 2, 6, 7, 11, 12, 51, 52, 202, 20]) expect(esNotaDeCredito(t), `tipo ${t}`).toBe(false);
  });

  it("reconoce las notas de débito M, FCE y del exterior", () => {
    for (const t of [2, 7, 12, 52, 202, 207, 212, 20]) expect(esNotaDeDebito(t), `tipo ${t}`).toBe(true);
    for (const t of [1, 3, 53, 203, 21]) expect(esNotaDeDebito(t), `tipo ${t}`).toBe(false);
  });

  it("les pone nombre, y el registro también entiende ese nombre", () => {
    expect(nombreTipo(53)).toBe("Nota de crédito M");
    expect(nombreTipo(52)).toBe("Nota de débito M");
    expect(nombreTipo(203)).toBe("Nota de crédito FCE A");
    expect(interpretarTipo("Nota de crédito M")).toBe(53);
  });
});

describe("lo que falta cargar con tipos poco comunes", () => {
  it("una nota de crédito M no se cuenta como factura ni suma", () => {
    const filas = planilla({ tipoCmp: 1, importe: 1000 }, { tipoCmp: 53, importe: 300 });
    const r = resumenDe(filas);
    expect(r.faltanNotasCredito).toBe(1);
    expect(r.faltanPorMoneda.map((t) => t.total)).toEqual([1000]);
    expect(totalesPorMoneda(filas)[0]?.total).toBe(700); // en el total de la planilla resta
  });

  it("una nota de débito M se nombra nota de débito", () => {
    const p = protagonista(1, [], resumenDe(planilla({ tipoCmp: 52 })));
    expect(p.unidad).toBe("nota de débito");
  });

  it("una nota de crédito FCE sola es el renglón principal, nunca 'facturas'", () => {
    const p = protagonista(1, [], resumenDe(planilla({ tipoCmp: 203, importe: 900 })));
    expect(p.unidad).toBe("nota de crédito");
  });
});

describe("tipos que la demo no sabe clasificar", () => {
  it("el grupo se llama 'comprobantes', no 'facturas'", () => {
    const r = resumenDe(planilla({ tipoCmp: 83 }, { tipoCmp: 1 }));
    expect(r.faltanOtrosTipos).toBe(1);
    expect(protagonista(2, [], r).unidad).toBe("comprobantes");
    expect(anuncioConciliacion(r)).toContain("Falta cargar 2 comprobantes");
  });

  it("uno solo, en singular", () => {
    expect(protagonista(1, [], resumenDe(planilla({ tipoCmp: 83 }))).unidad).toBe("comprobante");
  });

  it("con tipos conocidos no cambia nada", () => {
    const r = resumenDe(planilla({ tipoCmp: 1 }, { tipoCmp: 51 }));
    expect(r.faltanOtrosTipos).toBe(0);
    expect(protagonista(2, [], r).unidad).toBe("facturas");
  });
});
