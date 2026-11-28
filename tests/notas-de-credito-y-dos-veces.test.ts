// QA medio 6 (notas de crédito aparte en "falta cargar") y fila "cargada dos veces en el sistema" en tono de atención.

import { describe, expect, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import {
  TEXTO_CARGADA_DOS_VECES,
  conciliar,
  filasCargadasDosVeces,
  leerRegistro,
  resumenConciliacion,
  type LecturaRegistro,
  type Registro,
  type ResumenConciliacion,
} from "../src/conciliacion.ts";
import { aCsv } from "../src/csv.ts";
import { generarEjemplos, registroEjemplo } from "../src/ejemplos.ts";
import { agregarFila, crearFila, siguienteId, totalesPorMoneda, type Fila } from "../src/planilla.ts";
import { leerUrlQr } from "../src/qr-arca.ts";
import { anuncioConciliacion, etiquetaConciliacion, metaResultado, protagonista } from "../src/vista.ts";

const HOY = new Date(2026, 10, 17, 12);
const CUIT = "30990000014";

function dato(cambios: Partial<Comprobante> = {}): Comprobante {
  return { ...comprobanteVacio(), ver: 1, cuit: CUIT, ptoVta: 1, tipoCmp: 1, nroCmp: 1, importe: 100, moneda: "PES", fecha: "2026-10-01", ...cambios };
}

function planilla(...datos: Array<Partial<Comprobante>>): Fila[] {
  let filas: Fila[] = [];
  for (const d of datos) filas = agregarFila(filas, crearFila(siguienteId(filas), `a-${filas.length + 1}.pdf`, dato(d)));
  return filas;
}

function resumenDe(filas: Fila[], registros: Registro[] = []): ResumenConciliacion {
  return resumenConciliacion(filas, conciliar(filas, registros, HOY));
}

function lectura(texto: string): LecturaRegistro {
  const r = leerRegistro(texto);
  if (r instanceof Error) throw r;
  return r;
}

const FACTURA = { tipoCmp: 1 };
const NC = { tipoCmp: 3 };

describe("resumen: facturas y notas de crédito por separado (QA medio 6)", () => {
  const filas = planilla(
    { ...FACTURA, nroCmp: 1, importe: 1000 },
    { ...FACTURA, nroCmp: 2, importe: 500 },
    { ...NC, nroCmp: 3, importe: 300 },
    { ...NC, nroCmp: 4, importe: 50, moneda: "DOL" },
  );

  it("cuenta aparte las notas de crédito y deja el total de filas en `faltan`", () => {
    const r = resumenDe(filas);
    expect(r.faltan).toBe(4);
    expect(r.faltanNotasCredito).toBe(2);
  });

  it("`faltanPorMoneda` solo suma los comprobantes que no son notas de crédito", () => {
    expect(resumenDe(filas).faltanPorMoneda.map((t) => [t.moneda, t.total, t.cantidad])).toEqual([["PES", 1500, 2]]);
  });

  it("las notas de crédito tienen su propio importe, positivo y por moneda (pesos primero)", () => {
    expect(resumenDe(filas).faltanNotasCreditoPorMoneda.map((t) => [t.moneda, t.total, t.cantidad])).toEqual([
      ["PES", 300, 1],
      ["DOL", 50, 1],
    ]);
  });

  it("una nota de crédito no resta del total de las facturas (antes daba -$ 300 o $ 0)", () => {
    const soloNc = resumenDe(planilla({ ...NC, importe: 300 }));
    expect(soloNc.faltanPorMoneda).toEqual([]);
    expect(soloNc.faltanNotasCreditoPorMoneda.map((t) => t.total)).toEqual([300]);
  });

  it("no cuenta las notas de crédito que ya están cargadas ni las duplicadas de la planilla", () => {
    const f = planilla({ ...NC, nroCmp: 1, importe: 300 }, { ...NC, nroCmp: 1, importe: 300 }, { ...NC, nroCmp: 2, importe: 80 });
    const reg: Registro[] = [{ cuit: CUIT, tipoCmp: 3, ptoVta: 1, nroCmp: 2, importe: 80, linea: 2 }];
    const r = resumenDe(f, reg);
    expect(r.faltan).toBe(1);
    expect(r.faltanNotasCredito).toBe(1);
    expect(r.faltanNotasCreditoPorMoneda.map((t) => t.total)).toEqual([300]);
  });

  it("sin notas de crédito, todo en cero", () => {
    const r = resumenDe(planilla({ ...FACTURA, importe: 100 }));
    expect(r.faltanNotasCredito).toBe(0);
    expect(r.faltanNotasCreditoPorMoneda).toEqual([]);
  });
});

describe("protagonista con notas de crédito", () => {
  const filas = planilla(
    { ...FACTURA, nroCmp: 1, importe: 1000 },
    { ...FACTURA, nroCmp: 2, importe: 500 },
    { ...NC, nroCmp: 3, importe: 300 },
  );

  it("facturas y notas de crédito en renglones separados, con cantidad e importe cada una", () => {
    const p = protagonista(filas.length, totalesPorMoneda(filas), resumenDe(filas));
    expect(p.variante).toBe("faltan");
    expect(p.rotulo).toBe("Falta cargar");
    expect(p.cifra).toBe("2");
    expect(p.unidad).toBe("facturas");
    expect(p.montos).toEqual(["$ 1.500,00"]);
    expect(p.ademas).toEqual({ cifra: "1", unidad: "nota de crédito", montos: ["$ 300,00"] });
    // El botón lleva a todas las filas que faltan (comprobantes y notas).
    expect(p.accion?.texto).toBe("Ver los 3 en la planilla");
  });

  it("si solo faltan notas de crédito, ellas son el renglón principal (nunca '0 facturas' ni un monto negativo)", () => {
    const f = planilla({ ...NC, nroCmp: 1, importe: 300 });
    const p = protagonista(1, totalesPorMoneda(f), resumenDe(f));
    expect(p).toMatchObject({ rotulo: "Falta cargar", cifra: "1", unidad: "nota de crédito", montos: ["$ 300,00"], ademas: null });
    expect(p.montos.join("")).not.toContain("-");
  });

  it("varias notas de crédito en plural", () => {
    const f = planilla({ ...NC, nroCmp: 1, importe: 300 }, { ...NC, nroCmp: 2, importe: 200 });
    const p = protagonista(2, totalesPorMoneda(f), resumenDe(f));
    expect(p).toMatchObject({ rotulo: "Falta cargar", cifra: "2", unidad: "notas de crédito", montos: ["$ 500,00"], ademas: null });
  });

  it("sin notas de crédito, `ademas` es null y el resto no cambia", () => {
    const f = planilla({ ...FACTURA, importe: 100 });
    expect(protagonista(1, [], resumenDe(f))).toMatchObject({ cifra: "1", unidad: "factura", ademas: null });
  });

  it("una factura y una nota de crédito: ambas en singular", () => {
    const f = planilla({ ...FACTURA, nroCmp: 1, importe: 100 }, { ...NC, nroCmp: 2, importe: 40 });
    const p = protagonista(2, [], resumenDe(f));
    expect(p).toMatchObject({ rotulo: "Falta cargar", cifra: "1", unidad: "factura", ademas: { cifra: "1", unidad: "nota de crédito" } });
  });
});

describe("textos de lo que falta cargar con notas de crédito", () => {
  const filas = planilla(
    { ...FACTURA, nroCmp: 1, importe: 1000 },
    { ...FACTURA, nroCmp: 2, importe: 500 },
    { ...NC, nroCmp: 3, importe: 300 },
  );

  it("el anuncio nombra cada grupo con su importe", () => {
    expect(anuncioConciliacion(resumenDe(filas))).toBe(
      "Conciliación terminada. Falta cargar 2 facturas por $ 1.500,00; además, 1 nota de crédito por $ 300,00. Nada requiere atención.",
    );
  });

  it("el anuncio con solo una nota de crédito", () => {
    const f = planilla({ ...NC, importe: 300 });
    expect(anuncioConciliacion(resumenDe(f))).toBe("Conciliación terminada. Falta cargar 1 nota de crédito por $ 300,00. Nada requiere atención.");
  });

  it("el anuncio sin notas de crédito queda igual que antes", () => {
    const f = planilla({ ...FACTURA, importe: 100 });
    expect(anuncioConciliacion(resumenDe(f))).toBe("Conciliación terminada. Falta cargar 1 factura por $ 100,00. Nada requiere atención.");
  });

  it("el rótulo de la ventana también las separa", () => {
    expect(metaResultado(3, resumenDe(filas))).toBe("Falta cargar 2 facturas y 1 nota de crédito");
    expect(metaResultado(1, resumenDe(planilla({ ...NC, importe: 1 })))).toBe("Falta cargar 1 nota de crédito");
    expect(metaResultado(1, resumenDe(planilla({ ...FACTURA, importe: 1 })))).toBe("Falta cargar 1 factura");
    expect(metaResultado(2, resumenDe(planilla({ ...FACTURA, nroCmp: 1 }, { ...FACTURA, nroCmp: 2 })))).toBe("Falta cargar 2 facturas");
  });
});

describe("fila cargada dos veces en el sistema: tono de atención", () => {
  const registros = lectura(`cuit;tipo;pv;nro;importe\n${CUIT};1;1;1;100\n${CUIT};1;1;1;100\n${CUIT};1;1;2;50\n`);

  it("la fila cuyo comprobante figura dos veces en el sistema queda marcada", () => {
    const filas = planilla({ nroCmp: 1, importe: 100 }, { nroCmp: 2, importe: 50 });
    const c = conciliar(filas, registros.registros, HOY);
    const marcadas = filasCargadasDosVeces(filas, c, registros.clavesRepetidas);
    expect([...marcadas]).toEqual([filas[0]?.id]);
  });

  it("sin claves repetidas no se marca ninguna", () => {
    const filas = planilla({ nroCmp: 2, importe: 50 });
    const c = conciliar(filas, registros.registros, HOY);
    expect(filasCargadasDosVeces(filas, c, []).size).toBe(0);
  });

  it("una duplicada de la planilla no se marca: ya tiene su propio sello", () => {
    const filas = planilla({ nroCmp: 1, importe: 100 }, { nroCmp: 1, importe: 100 });
    const c = conciliar(filas, registros.registros, HOY);
    expect([...filasCargadasDosVeces(filas, c, registros.clavesRepetidas)]).toEqual([filas[0]?.id]);
  });

  it("también marca las 'otro importe' de una clave repetida: es un error del sistema (regla del 17/11, ver mal-cargada-y-copias)", () => {
    const filas = planilla({ nroCmp: 1, importe: 999 });
    const c = conciliar(filas, registros.registros, HOY);
    expect(c.porFila.get(filas[0]?.id ?? -1)?.tipo).toBe("otro-importe");
    expect(filasCargadasDosVeces(filas, c, registros.clavesRepetidas).size).toBe(1);
  });

  it("la etiqueta es ámbar (tono 'revisar'), con el ícono del sistema (distinto del de la duplicada de la planilla), y no verde", () => {
    const e = etiquetaConciliacion({ tipo: "ya-cargada" }, undefined, true);
    expect(e).toEqual({ texto: "Cargada dos veces en el sistema", tono: "revisar", icono: "sistema" });
    expect(TEXTO_CARGADA_DOS_VECES).toBe(e.texto);
  });

  it("sin la marca, 'Ya cargada' sigue en verde", () => {
    expect(etiquetaConciliacion({ tipo: "ya-cargada" })).toMatchObject({ texto: "Ya cargada", tono: "ok" });
    expect(etiquetaConciliacion({ tipo: "ya-cargada" }, undefined, false)).toMatchObject({ tono: "ok" });
  });

  it("la marca no cambia otros resultados", () => {
    expect(etiquetaConciliacion({ tipo: "falta" }, undefined, true)).toMatchObject({ texto: "Falta cargar", tono: "pendiente" });
  });

  it("el CSV usa el mismo texto en la columna Conciliación", () => {
    const filas = planilla({ nroCmp: 1, importe: 100 }, { nroCmp: 2, importe: 50 });
    const c = conciliar(filas, registros.registros, HOY);
    const marcadas = filasCargadasDosVeces(filas, c, registros.clavesRepetidas);
    const lineas = aCsv(filas, HOY, c.porFila, marcadas).split(/\r?\n/);
    expect(lineas[1]).toContain("Cargada dos veces en el sistema");
    expect(lineas[2]).toContain("Ya cargada");
    expect(lineas[2]).not.toContain("dos veces");
  });

  it("con el ejemplo completo, la factura cargada dos veces es la única fila marcada", () => {
    const filas = generarEjemplos(HOY).map((e, i) => {
      if (e.url === null) return crearFila(i + 1, e.origen, null);
      const c = leerUrlQr(e.url);
      if (c instanceof Error) throw c;
      return crearFila(i + 1, e.origen, c);
    });
    const lect = lectura(registroEjemplo());
    const c = conciliar(filas, lect.registros, HOY);
    const marcadas = filasCargadasDosVeces(filas, c, lect.clavesRepetidas);
    expect(marcadas.size).toBe(1);
    expect(filas.find((f) => marcadas.has(f.id))?.datos.tipoCmp).toBe(6);
  });
});
