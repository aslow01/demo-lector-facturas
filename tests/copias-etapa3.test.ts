// Etapa 3 (QA M3 y M4, revisión de código): "otro emisor" con copias, tope del detalle de copias, importe de planilla vacío,
// filas editadas a mano y el cruce "otro emisor" cuando el importe coincide con la segunda copia.

import { describe, expect, it } from "vitest";
import { comprobanteVacio, formatearMonto, type Comprobante } from "../src/comprobante.ts";
import {
  ACCION_MAL_CARGADA,
  TOPE_COPIAS_EN_DETALLE,
  conciliar,
  describirClaveRepetida,
  detalleCopias,
  filasCargadasDosVeces,
  leerRegistro,
  resumenConciliacion,
  textoResultado,
  type LecturaRegistro,
  type Resultado,
} from "../src/conciliacion.ts";
import { aCsv } from "../src/csv.ts";
import { crearFila, type Fila } from "../src/planilla.ts";
import { detalleFila, etiquetaConciliacion } from "../src/vista.ts";

const HOY = new Date(2026, 10, 17);
const CUIT_A = "30990001010";
const CUIT_B = "33990002016";

function dato(cambios: Partial<Comprobante> = {}): Comprobante {
  return { ...comprobanteVacio(), ver: 1, cuit: CUIT_A, ptoVta: 5, tipoCmp: 1, nroCmp: 104, importe: 800, moneda: "PES", fecha: "2026-10-01", ...cambios };
}

function fila(cambios: Partial<Comprobante> = {}, editados: Fila["editados"] = []): Fila {
  return { ...crearFila(1, "a.pdf", dato(cambios)), editados };
}

function registro(...lineas: string[]): LecturaRegistro {
  const r = leerRegistro(`cuit;tipo;pv;nro;importe\n${lineas.join("\n")}\n`);
  if (r instanceof Error) throw r;
  return r;
}

const texto = (partes: ReadonlyArray<{ texto: string }>): string => partes.map((p) => p.texto).join("");
const pesos = (n: number): string => formatearMonto("PES", n);

describe("M3: 'otro emisor' cuyo CUIT figura más de una vez en el sistema", () => {
  const lectura = registro(`${CUIT_B};1;5;104;800,00`, `${CUIT_B};1;5;104;800,00`);
  const filas = [fila()];
  const c = conciliar(filas, lectura.registros, HOY);
  const r = c.porFila.get(1) as Resultado;

  it("el resultado sigue siendo 'otro emisor' y trae el importe de cada copia", () => {
    expect(r).toEqual({ tipo: "otro-emisor", cuitRegistro: CUIT_B, copias: [800, 800] });
  });

  it("sin repetición, el resultado no cambia (sin copias)", () => {
    const solo = conciliar(filas, registro(`${CUIT_B};1;5;104;800,00`).registros, HOY).porFila.get(1);
    expect(solo).toEqual({ tipo: "otro-emisor", cuitRegistro: CUIT_B });
  });

  it("la fila se marca como cargada dos veces (ámbar), igual que 'ya cargada' repetida", () => {
    expect(filasCargadasDosVeces(filas, c, lectura.clavesRepetidas).has(1)).toBe(true);
    expect(etiquetaConciliacion(r, undefined, true)).toMatchObject({ texto: "Cargada dos veces en el sistema", tono: "revisar", icono: "sistema" });
  });

  it("el detalle avisa de las copias y la acción va en plural", () => {
    const t = detalleFila(r, filas[0] as Fila, []);
    expect(t).toContain("En el sistema figura 2 veces con el CUIT 33-99000201-6");
    expect(t).toContain("$ 800,00 y $ 800,00");
    expect(t).toContain("Dé de baja las 2 cargas");
    expect(t).not.toBe(`En el sistema con CUIT 33-99000201-6. ${ACCION_MAL_CARGADA}`);
  });

  it("el CSV dice lo mismo que la planilla, en una celda", () => {
    const csv = aCsv(filas, HOY, c.porFila, filasCargadasDosVeces(filas, c, lectura.clavesRepetidas));
    expect(csv).toContain("Cargada dos veces en el sistema (En el sistema figura 2 veces con el CUIT 33-99000201-6: $ 800,00 y $ 800,00.");
  });

  it("cuenta como mal cargada y como cargada dos veces (dos señales sobre el mismo comprobante)", () => {
    const res = resumenConciliacion(filas, c, lectura.clavesRepetidas);
    expect(res.otroEmisor).toBe(1);
    expect(res.cargadasDosVeces).toBe(1);
  });
});

describe("el cruce 'otro emisor' compara contra todas las copias del otro CUIT", () => {
  it("la coincidencia está en la segunda copia, no en la primera", () => {
    const lectura = registro(`${CUIT_B};1;5;104;500,00`, `${CUIT_B};1;5;104;800,00`);
    const res = conciliar([fila()], lectura.registros, HOY).porFila.get(1);
    expect(res).toEqual({ tipo: "otro-emisor", cuitRegistro: CUIT_B, copias: [500, 800] });
  });
  it("si ninguna copia coincide, no es 'otro emisor' (falta cargar)", () => {
    const lectura = registro(`${CUIT_B};1;5;104;500,00`, `${CUIT_B};1;5;104;600,00`);
    expect(conciliar([fila()], lectura.registros, HOY).porFila.get(1)).toEqual({ tipo: "falta" });
  });
  it("en una nota de crédito vale el valor absoluto contra cada copia", () => {
    const lectura = registro(`${CUIT_B};3;5;104;-800,00`, `${CUIT_B};3;5;104;50,00`);
    expect(conciliar([fila({ tipoCmp: 3 })], lectura.registros, HOY).porFila.get(1)?.tipo).toBe("otro-emisor");
  });
});

describe("M4: el detalle de las copias tiene tope", () => {
  const muchas = Array.from({ length: 3000 }, (_, i) => (i % 2 === 0 ? 9180.52 : 2000));
  const lineas = muchas.map((i) => `${CUIT_A};1;5;104;${String(i).replace(".", ",")}`);

  it("lista hasta el tope y dice cuántas más hay", () => {
    expect(TOPE_COPIAS_EN_DETALLE).toBe(5);
    const t = texto(detalleCopias(2000, muchas, 1, pesos));
    expect(t).toContain("En el sistema figura 3.000 veces: ");
    expect(t).toContain("y 2.995 más");
    expect(t.length).toBeLessThan(700);
  });
  it("con pocas copias no cambia nada (el tope es 5)", () => {
    expect(texto(detalleCopias(2000, [2000, 2500, 3000, 3500, 4000], 1, pesos))).toContain("$ 2.000,00, $ 2.500,00, $ 3.000,00, $ 3.500,00 y $ 4.000,00.");
  });
  it("las copias que sobran también se acotan", () => {
    const t = texto(detalleCopias(1, [1, ...Array.from({ length: 100 }, () => 2)], 1, pesos));
    expect(t).toContain("Dé de baja las copias de ");
    expect(t).toContain("y 95 más que sobran.");
  });
  it("el CSV (misma redacción) no se dispara", () => {
    const filas = [fila({ importe: 2000 })];
    const lectura = registro(...lineas);
    const c = conciliar(filas, lectura.registros, HOY);
    const csv = aCsv(filas, HOY, c.porFila, filasCargadasDosVeces(filas, c, lectura.clavesRepetidas));
    expect(csv.length).toBeLessThan(2000);
    expect(csv).toContain("Cargada 3000 veces en el sistema");
  });
  it("el aviso de la lista de 'cargadas dos veces' también", () => {
    const [clave] = registro(...lineas).clavesRepetidas;
    const t = describirClaveRepetida(clave as NonNullable<typeof clave>, "PES");
    expect(t).toContain("figura cargado 3000 veces");
    expect(t).toContain("y 2.995 más");
    expect(t.length).toBeLessThan(700);
  });
});

describe("importe vacío en la planilla con copias en el sistema", () => {
  it("no dice 'Ninguna copia coincide': explica que no hay importe para compararlas", () => {
    const t = texto(detalleCopias(null, [2000, 2500], 1, pesos));
    expect(t).not.toContain("Ninguna copia coincide");
    expect(t).toContain("En el sistema figura 2 veces: $ 2.000,00 y $ 2.500,00.");
    expect(t).toContain("no tiene importe");
  });
});

describe("filas 'Editada a mano' con 'Mal cargada': texto neutro", () => {
  const otroImporte: Resultado = { tipo: "otro-importe", importeFila: 800, importeRegistro: 700 };
  const otroEmisor: Resultado = { tipo: "otro-emisor", cuitRegistro: CUIT_B };

  it("si se escribió a mano un dato del cruce, no dice 'dé de baja la carga'", () => {
    const editada = fila({}, ["importe"]);
    for (const r of [otroImporte, otroEmisor]) {
      const t = detalleFila(r, editada, []);
      expect(t).not.toContain("Dé de baja");
      expect(t).toContain("a mano");
    }
  });
  it("conserva lo que difiere (importes, CUIT)", () => {
    const editada = fila({}, ["importe"]);
    expect(detalleFila(otroImporte, editada, [])).toContain("Planilla $ 800,00 · Sistema $ 700,00 · Diferencia $ 100,00.");
    expect(detalleFila(otroEmisor, editada, [])).toContain("En el sistema con CUIT 33-99000201-6.");
  });
  it("si lo editado no entra en el cruce (la fecha, el CAE), sigue la acción de siempre", () => {
    expect(detalleFila(otroImporte, fila({}, ["fecha", "codAut"]), [])).toContain(ACCION_MAL_CARGADA);
  });
  it("sin ediciones, igual que antes", () => {
    expect(detalleFila(otroEmisor, fila(), [])).toBe(`En el sistema con CUIT 33-99000201-6. ${ACCION_MAL_CARGADA}`);
  });
  it("el CSV usa el mismo criterio", () => {
    const filas = [fila({}, ["nroCmp"])];
    const csv = aCsv(filas, HOY, new Map([[1, otroImporte]]));
    expect(csv).toContain("Mal cargada: otro importe (Planilla: 800,00. Sistema: 700,00. ");
    expect(csv).not.toContain("Dé de baja");
    expect(textoResultado(otroImporte)).toContain("Dé de baja");
  });
  it("con 'ninguna copia coincide' tampoco manda a dar de baja todo", () => {
    const t = texto(detalleCopias(3000, [2000, 2500], 1, pesos, true));
    expect(t).toContain("Ninguna copia coincide");
    expect(t).toContain("a mano");
    expect(t).not.toContain("dé de baja todas");
  });
});
