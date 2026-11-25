// Cómo se nombra lo que falta cargar (decisión del 17/11/2026): "comprobante" también incluye a las notas de crédito,
// así que el grupo que no son notas de crédito se llama por lo que realmente es: facturas, notas de débito o ambas.

import { describe, expect, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import { conciliar, resumenConciliacion, type ResumenConciliacion } from "../src/conciliacion.ts";
import { agregarFila, crearFila, siguienteId, type Fila } from "../src/planilla.ts";
import { anuncioConciliacion, metaResultado, protagonista } from "../src/vista.ts";

const HOY = new Date(2026, 10, 17);
const CUIT = "30990000014";

const FACTURA = { tipoCmp: 1 };
const ND = { tipoCmp: 2 };
const NC = { tipoCmp: 3 };

function planilla(...datos: Array<Partial<Comprobante>>): Fila[] {
  let filas: Fila[] = [];
  for (const d of datos) {
    const dato: Comprobante = { ...comprobanteVacio(), ver: 1, cuit: CUIT, ptoVta: 1, tipoCmp: 1, nroCmp: filas.length + 1, importe: 100, moneda: "PES", fecha: "2026-10-01", ...d };
    filas = agregarFila(filas, crearFila(siguienteId(filas), `a-${filas.length + 1}.pdf`, dato));
  }
  return filas;
}

function resumenDe(filas: Fila[]): ResumenConciliacion {
  return resumenConciliacion(filas, conciliar(filas, [], HOY));
}

describe("resumen: notas de débito entre lo que falta", () => {
  it("cuenta las notas de débito (tipos 2, 7 y 12) sin tocar los demás conteos", () => {
    const r = resumenDe(planilla({ ...FACTURA }, { tipoCmp: 2 }, { tipoCmp: 7 }, { tipoCmp: 12 }, { ...NC }));
    expect(r.faltan).toBe(5);
    expect(r.faltanNotasCredito).toBe(1);
    expect(r.faltanNotasDebito).toBe(3);
  });

  it("sin notas de débito es cero, y las duplicadas de la planilla no cuentan", () => {
    expect(resumenDe(planilla({ ...FACTURA })).faltanNotasDebito).toBe(0);
    const r = resumenDe(planilla({ ...ND, nroCmp: 1 }, { ...ND, nroCmp: 1 }));
    expect(r.faltan).toBe(1);
    expect(r.faltanNotasDebito).toBe(1);
  });

  it("las notas de débito siguen sumando en `faltanPorMoneda`", () => {
    const r = resumenDe(planilla({ ...FACTURA, importe: 100 }, { ...ND, importe: 50 }));
    expect(r.faltanPorMoneda.map((t) => [t.moneda, t.total, t.cantidad])).toEqual([["PES", 150, 2]]);
  });
});

describe("protagonista: el nombre sale de lo que falta", () => {
  it("solo facturas: 'facturas' (plural) y 'factura' (singular)", () => {
    expect(protagonista(2, [], resumenDe(planilla({ ...FACTURA }, { ...FACTURA }))).unidad).toBe("facturas");
    expect(protagonista(1, [], resumenDe(planilla({ ...FACTURA }))).unidad).toBe("factura");
  });

  it("solo notas de débito: 'notas de débito' y 'nota de débito'", () => {
    expect(protagonista(2, [], resumenDe(planilla({ ...ND }, { ...ND }))).unidad).toBe("notas de débito");
    expect(protagonista(1, [], resumenDe(planilla({ ...ND }))).unidad).toBe("nota de débito");
  });

  it("mezcla: 'facturas y notas de débito', también si cada una es una sola", () => {
    const p = protagonista(2, [], resumenDe(planilla({ ...FACTURA }, { ...ND })));
    expect(p).toMatchObject({ rotulo: "Falta cargar", cifra: "2", unidad: "facturas y notas de débito", ademas: null });
    expect(protagonista(3, [], resumenDe(planilla({ ...FACTURA }, { ...FACTURA }, { ...ND }))).unidad).toBe("facturas y notas de débito");
  });

  it("la concordancia sigue a la cantidad aunque el resumen sea artificial (1 con nota de débito)", () => {
    const base = resumenDe([]);
    const mezclaDeUno = { ...base, faltan: 1, faltanNotasDebito: 1 };
    expect(protagonista(1, [], mezclaDeUno).unidad).toBe("nota de débito");
    const raro = { ...base, faltan: 3, faltanNotasDebito: 1 };
    expect(protagonista(3, [], raro).unidad).toBe("facturas y notas de débito");
  });

  it("solo notas de crédito: ellas son el renglón principal, sin la palabra 'comprobante'", () => {
    const p = protagonista(2, [], resumenDe(planilla({ ...NC }, { ...NC })));
    expect(p).toMatchObject({ cifra: "2", unidad: "notas de crédito", ademas: null });
  });

  it("facturas y notas de crédito: el segundo grupo va aparte", () => {
    const p = protagonista(2, [], resumenDe(planilla({ ...FACTURA }, { ...NC })));
    expect(p).toMatchObject({ cifra: "1", unidad: "factura", ademas: { cifra: "1", unidad: "nota de crédito" } });
  });

  it("notas de débito y de crédito: cada grupo con su nombre", () => {
    const p = protagonista(3, [], resumenDe(planilla({ ...ND }, { ...ND }, { ...NC })));
    expect(p).toMatchObject({ cifra: "2", unidad: "notas de débito", ademas: { cifra: "1", unidad: "nota de crédito" } });
  });
});

describe("anuncio y rótulo de la ventana usan el mismo nombre", () => {
  it("anuncio: solo notas de débito", () => {
    expect(anuncioConciliacion(resumenDe(planilla({ ...ND, importe: 40 })))).toBe(
      "Conciliación terminada. Falta cargar 1 nota de débito por $ 40,00. Nada requiere atención.",
    );
  });

  it("anuncio: mezcla con notas de crédito", () => {
    const f = planilla({ ...FACTURA, importe: 100 }, { ...ND, importe: 50 }, { ...NC, importe: 30 });
    expect(anuncioConciliacion(resumenDe(f))).toBe(
      "Conciliación terminada. Falta cargar 2 facturas y notas de débito por $ 150,00; además, 1 nota de crédito por $ 30,00. Nada requiere atención.",
    );
  });

  it("rótulo de la ventana: siempre se nombra cada grupo, también sin notas de crédito (QA B5)", () => {
    expect(metaResultado(3, resumenDe(planilla({ ...FACTURA }, { ...ND }, { ...NC })))).toBe("Falta cargar 2 facturas y notas de débito y 1 nota de crédito");
    expect(metaResultado(2, resumenDe(planilla({ ...ND }, { ...NC })))).toBe("Falta cargar 1 nota de débito y 1 nota de crédito");
    expect(metaResultado(2, resumenDe(planilla({ ...FACTURA }, { ...ND })))).toBe("Falta cargar 2 facturas y notas de débito");
    expect(metaResultado(3, resumenDe(planilla({ ...ND }, { ...ND }, { ...ND })))).toBe("Falta cargar 3 notas de débito");
  });
});
