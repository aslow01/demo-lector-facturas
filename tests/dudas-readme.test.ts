// Dudas que el README dejaba abiertas ("no se comprobó"): ahora cada una tiene un test que documenta el comportamiento real.

import { describe, expect, it } from "vitest";
import { estadoDe } from "../src/comprobante.ts";
import { conciliar, leerRegistro, resumenConciliacion, type LecturaRegistro, type Resultado } from "../src/conciliacion.ts";
import { crearFila, type Fila } from "../src/planilla.ts";
import { ErrorQr, armarUrlQr, leerUrlQr } from "../src/qr-arca.ts";

const HOY = new Date(2026, 10, 17);
const CUIT = "30990000014";
const BASE = { ver: 1, fecha: "2026-10-05", cuit: Number(CUIT), ptoVta: 3, tipoCmp: 1, nroCmp: 1245, importe: 1000, moneda: "PES" };

function filaDeQr(datos: Record<string, unknown>): Fila {
  const r = leerUrlQr(armarUrlQr({ ...BASE, ...datos }));
  if (r instanceof ErrorQr) throw r;
  return crearFila(1, "factura.png", r);
}

function registroDe(lineas: string[]): LecturaRegistro {
  const r = leerRegistro(["CUIT;Tipo;Punto de venta;Número;Importe", ...lineas].join("\n"));
  if (r instanceof Error) throw r;
  return r;
}

function resultadoDe(fila: Fila, registro: LecturaRegistro): Resultado {
  return conciliar([fila], registro.registros, HOY).porFila.get(fila.id) as Resultado;
}

describe("punto de venta y número con y sin ceros a la izquierda", () => {
  it("el QR con '0003' y '00001245' como texto coincide con un registro que dice '3' y '1245'", () => {
    const fila = filaDeQr({ ptoVta: "0003", nroCmp: "00001245" });
    expect(resultadoDe(fila, registroDe([`${CUIT};1;3;1245;1000`]))).toEqual({ tipo: "ya-cargada" });
  });
  it("y al revés: un registro con ceros ('0003', '00001245') coincide con un QR que trae números", () => {
    const fila = filaDeQr({});
    expect(resultadoDe(fila, registroDe([`${CUIT};1;0003;00001245;1000`]))).toEqual({ tipo: "ya-cargada" });
  });
  it("el punto de venta 0 no existe en el registro (QA B5 de la etapa 3): la línea se descarta y no concilia con nada", () => {
    const fila = filaDeQr({ ptoVta: 0 });
    const registro = registroDe([`${CUIT};1;0000;1245;1000`]);
    expect(registro.registros).toEqual([]);
    expect(registro.lineasInvalidas).toEqual([2]);
    expect(resultadoDe(fila, registro)).toEqual({ tipo: "falta" });
  });
  it("dos comprobantes que solo difieren en los ceros son el mismo (misma clave)", () => {
    const a = filaDeQr({ ptoVta: "0003" });
    const b = { ...filaDeQr({ ptoVta: 3 }), id: 2 };
    const c = conciliar([a, b], [], HOY);
    expect(c.porFila.get(2)).toEqual({ tipo: "duplicada", original: 1 });
  });
});

describe("factura cargada con otro tipo de comprobante", () => {
  // Comportamiento real: el tipo es parte de la clave. Una Factura A cargada como Factura B no se reconoce como "la misma":
  // la factura figura como "Falta cargar" y la línea del sistema queda en "Cargadas en el sistema y no recibidas". La herramienta
  // no adivina equivalencias entre tipos; la persona ve las dos listas y decide.
  it("figura como falta cargar, y el registro queda como cargado y no recibido", () => {
    const fila = filaDeQr({ tipoCmp: 1 });
    const registro = registroDe([`${CUIT};6;3;1245;1000`]);
    const c = conciliar([fila], registro.registros, HOY);
    expect(c.porFila.get(1)).toEqual({ tipo: "falta" });
    expect(c.soloEnRegistro).toHaveLength(1);
    expect(resumenConciliacion([fila], c).faltan).toBe(1);
    expect(resumenConciliacion([fila], c).noRecibidas).toBe(1);
  });
});

describe("pagos parciales o en cuotas", () => {
  // Comportamiento real: no hay ninguna regla para ellos. Un importe distinto es "Otro importe en el sistema" y la planilla
  // muestra la diferencia; nunca se da por cargada.
  it("un importe menor en el sistema (pago parcial) es 'otro importe', con la diferencia", () => {
    const fila = filaDeQr({ importe: 1000 });
    const r = resultadoDe(fila, registroDe([`${CUIT};1;3;1245;400`]));
    expect(r).toEqual({ tipo: "otro-importe", importeFila: 1000, importeRegistro: 400 });
  });
  it("varias cuotas del mismo comprobante son un registro repetido: se toma la primera y se avisa como cargada dos veces", () => {
    const registro = registroDe([`${CUIT};1;3;1245;400`, `${CUIT};1;3;1245;600`]);
    expect(registro.registros).toHaveLength(1);
    expect(registro.clavesRepetidas).toHaveLength(1);
    expect(registro.clavesRepetidas[0]?.veces).toBe(2);
    expect(resultadoDe(filaDeQr({ importe: 1000 }), registro).tipo).toBe("otro-importe");
  });
});

describe("QR con una versión distinta de la 1", () => {
  // Comportamiento real: el QR se lee igual (los campos son los mismos), pero la fila queda para revisar con el motivo.
  it("se lee y se marca para revisar con la versión en el aviso", () => {
    const fila = filaDeQr({ ver: 2 });
    expect(fila.datos.ver).toBe(2);
    const { estado, motivos } = estadoDe(fila.datos, HOY);
    expect(estado).toBe("revisar");
    expect(motivos).toContain("Versión de QR desconocida (2).");
  });
  it("sin el registro, la conciliación la pone en 'revisar antes de cargar', no en 'falta cargar'", () => {
    expect(resultadoDe(filaDeQr({ ver: 2 }), registroDe([]))).toEqual({ tipo: "revisar" });
  });
  it("si coincide con el registro, se concilia igual como ya cargada (la marca de lectura sigue a la vista)", () => {
    expect(resultadoDe(filaDeQr({ ver: 2 }), registroDe([`${CUIT};1;3;1245;1000`]))).toEqual({ tipo: "ya-cargada" });
  });
  it("una versión que no es un número queda sin dato y se marca igual", () => {
    const fila = filaDeQr({ ver: "x" });
    expect(fila.datos.ver).toBeNull();
    expect(estadoDe(fila.datos, HOY).estado).toBe("leida");
  });
});
