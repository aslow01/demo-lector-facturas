// QA alto 1 (no declarar "todo cargado" sin lecturas), medio 4 (registro anterior) y medio 7 (tope de listas).

import { describe, expect, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import { conciliar, describirImportesExcesivos, resumenConciliacion, type Registro } from "../src/conciliacion.ts";
import { agregarFila, crearFila, siguienteId, totalesPorMoneda, type Fila } from "../src/planilla.ts";
import { TOPE_LISTA, anuncioConciliacion, limitarLista, metaResultado, protagonista, textoErrorRegistro, textoPlanillaVaciada } from "../src/vista.ts";

const CUIT = "30990000014";

describe("qué se reinicia al vaciar (QA B9 de la etapa 3)", () => {
  it("sin registro, solo dice que se vació", () => {
    expect(textoPlanillaVaciada(false)).toBe("Planilla vaciada.");
  });
  it("con registro cargado, avisa que se conserva (y que el filtro vuelve a 'Todas')", () => {
    expect(textoPlanillaVaciada(true)).toBe("Planilla vaciada. El registro y los ajustes de antigüedad se conservan; el filtro vuelve a Todas.");
  });
});

function dato(cambios: Partial<Comprobante> = {}): Comprobante {
  return { ...comprobanteVacio(), ver: 1, cuit: CUIT, ptoVta: 1, tipoCmp: 1, nroCmp: 1, importe: 100, moneda: "PES", fecha: "2026-10-01", ...cambios };
}

function planilla(...datos: Array<Partial<Comprobante> | null>): Fila[] {
  let filas: Fila[] = [];
  for (const d of datos) filas = agregarFila(filas, crearFila(siguienteId(filas), `a-${filas.length + 1}.pdf`, d === null ? null : dato(d)));
  return filas;
}

function resumenDe(filas: Fila[], registros: Registro[] = []) {
  return resumenConciliacion(filas, conciliar(filas, registros, new Date(2026, 10, 17)));
}

const REGISTRO_1: Registro = { cuit: CUIT, tipoCmp: 1, ptoVta: 1, nroCmp: 1, importe: 100, linea: 2 };

describe("protagonista sin lecturas (QA alto 1)", () => {
  it("todas las filas sin QR: no dice que no falta nada", () => {
    const filas = planilla(null, null, null);
    const p = protagonista(filas.length, totalesPorMoneda(filas), resumenDe(filas));
    expect(p.variante).toBe("sin-lecturas");
    expect(p.tono).toBe("neutro");
    expect(p.mensaje).toContain("No se pudo leer ningún comprobante");
    expect(p.mensaje).not.toContain("No falta cargar");
    expect(p.cifra).toBe("0");
    expect(p.montos).toEqual([]);
    expect(p.accion).toBeNull();
  });
  it("QR leídos pero sin los datos para conciliar: tampoco", () => {
    const filas = planilla({ cuit: "" }, { nroCmp: null });
    expect(protagonista(2, [], resumenDe(filas)).variante).toBe("sin-lecturas");
  });
  it("sin comprobantes en la planilla (registro cargado antes): lo dice de otra manera", () => {
    const p = protagonista(0, [], resumenDe([]));
    expect(p.variante).toBe("sin-lecturas");
    expect(p.mensaje).toContain("Todavía no hay comprobantes");
  });
  it("con al menos un comprobante comparable y nada pendiente, sigue siendo el 'cero' verde", () => {
    const filas = planilla({ nroCmp: 1 }, null);
    const p = protagonista(2, [], resumenDe(filas, [REGISTRO_1]));
    expect(p.variante).toBe("cero");
    expect(p).toMatchObject({ cifra: "0", unidad: "comprobantes", mensaje: "" });
  });
  it("una diferencia de importe ya cuenta como comparado", () => {
    const filas = planilla({ nroCmp: 1, importe: 5 });
    expect(protagonista(1, [], resumenDe(filas, [REGISTRO_1])).variante).toBe("cero");
  });
  it("con comprobantes que faltan, sin cambios", () => {
    const filas = planilla({ nroCmp: 1 });
    expect(protagonista(1, [], resumenDe(filas)).variante).toBe("faltan");
  });
  it("la barra de título y el anuncio tampoco afirman que no falta nada", () => {
    const filas = planilla(null);
    const r = resumenDe(filas);
    expect(metaResultado(1, r)).toBe("Sin comprobantes para comparar");
    expect(anuncioConciliacion(r)).toContain("No se pudo leer ningún comprobante");
    expect(anuncioConciliacion(r)).not.toContain("No falta cargar");
    expect(anuncioConciliacion(r)).not.toContain("Nada requiere atención");
    expect(anuncioConciliacion(resumenDe([]))).toContain("Todavía no hay comprobantes");
  });
  it("con comparables, la barra y el anuncio siguen como antes", () => {
    const filas = planilla({ nroCmp: 1 });
    const r = resumenDe(filas, [REGISTRO_1]);
    expect(metaResultado(1, r)).toBe("No falta cargar nada");
    expect(anuncioConciliacion(r)).toContain("No falta cargar ningún comprobante.");
  });
});

describe("registro con error (QA medio 4)", () => {
  it("con un registro activo, el aviso dice que se mantiene", () => {
    expect(textoErrorRegistro("Falta la columna de CUIT.", true)).toBe("Falta la columna de CUIT. Se mantiene el registro anterior.");
  });
  it("sin registro activo, el mensaje va solo", () => {
    expect(textoErrorRegistro("El archivo está vacío.", false)).toBe("El archivo está vacío.");
  });
});

describe("tope de listas (QA medio 7)", () => {
  it("una lista corta se muestra completa", () => {
    expect(limitarLista([1, 2, 3], 5)).toEqual({ visibles: [1, 2, 3], resto: 0, textoResto: "" });
  });
  it("una larga se corta y dice cuántos quedan, con puntos de miles", () => {
    const l = limitarLista(Array.from({ length: 20_000 }, (_, i) => i), 50);
    expect(l.visibles).toHaveLength(50);
    expect(l.resto).toBe(19_950);
    expect(l.textoResto).toBe("y 19.950 más");
  });
  it("justo en el tope no corta nada", () => {
    expect(limitarLista(Array.from({ length: 50 }, (_, i) => i), 50).resto).toBe(0);
    expect(TOPE_LISTA).toBe(50);
  });
});

describe("líneas con importe fuera de rango", () => {
  it("se explica la causa y se muestran hasta 15", () => {
    expect(describirImportesExcesivos([])).toBe("");
    expect(describirImportesExcesivos([4])).toBe("1 línea tiene un importe con más de 2 decimales o más de 12 dígitos enteros: 4.");
    expect(describirImportesExcesivos([3, 4])).toBe("2 líneas tienen un importe con más de 2 decimales o más de 12 dígitos enteros: 3, 4.");
    expect(describirImportesExcesivos(Array.from({ length: 20 }, (_, i) => i + 2))).toContain("y 5 más.");
  });
});
