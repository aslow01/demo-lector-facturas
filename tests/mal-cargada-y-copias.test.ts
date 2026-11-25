// Regla de negocio de Matías (17/11/2026): en el sistema real NO se puede cargar dos veces el mismo comprobante (CUIT emisor +
// tipo + punto de venta + número). Si algo está mal cargado, primero se da de baja y recién después se vuelve a cargar.
//  - Mismos datos: "Ya cargada".
//  - Otro importe u otro dato: "Mal cargada" (dé de baja la carga y vuelva a cargarla con los datos correctos).
//  - Misma clave repetida en el registro: error del sistema, en ámbar. El comprobante leído se compara contra TODAS las copias:
//    si coincide con alguna, sobra(n) la(s) otra(s); si con ninguna, se dan de baja todas y se carga una sola vez.

import { describe, expect, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import {
  ACCION_MAL_CARGADA,
  conciliar,
  describirClaveRepetida,
  partesClaveRepetida,
  filasCargadasDosVeces,
  itemsAtencion,
  leerRegistro,
  resumenConciliacion,
  textoResultado,
  type LecturaRegistro,
  type Resultado,
} from "../src/conciliacion.ts";
import { aCsv } from "../src/csv.ts";
import { agregarFila, crearFila, type Fila } from "../src/planilla.ts";
import { anuncioConciliacion, detalleFila, etiquetaConciliacion } from "../src/vista.ts";

const HOY = new Date(2026, 10, 17);
const CUIT = "30990000014";
const OTRO_CUIT = "30990000200";

function dato(cambios: Partial<Comprobante> = {}): Comprobante {
  return { ...comprobanteVacio(), ver: 1, cuit: CUIT, ptoVta: 1, tipoCmp: 1, nroCmp: 5, importe: 2000, moneda: "PES", fecha: "2026-10-01", ...cambios };
}

function una(cambios: Partial<Comprobante> = {}): Fila[] {
  return agregarFila([], crearFila(1, "a.pdf", dato(cambios)));
}

function registro(...importes: string[]): LecturaRegistro {
  const lineas = importes.map((i) => `${CUIT};1;1;5;${i}`);
  const r = leerRegistro(`cuit;tipo;pv;nro;importe\n${lineas.join("\n")}\n`);
  if (r instanceof Error) throw r;
  return r;
}

function resultadoDe(filas: Fila[], r: LecturaRegistro): Resultado {
  const res = conciliar(filas, r.registros, HOY).porFila.get(1);
  if (!res) throw new Error("sin resultado");
  return res;
}

describe("el registro guarda cada copia de una clave repetida", () => {
  it("con importes distintos, cada línea con el suyo", () => {
    const r = registro("2.000,00", "2.500,00");
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]?.copias).toEqual([
      { linea: 2, importe: 2000 },
      { linea: 3, importe: 2500 },
    ]);
  });
  it("una clave que aparece una sola vez no lleva copias", () => {
    expect(registro("2.000,00").registros[0]?.copias).toBeUndefined();
  });
});

describe("el comprobante leído se compara contra TODAS las copias (el resultado no depende del orden del archivo)", () => {
  it("coincide con alguna: 'Ya cargada' (y se marca como cargada dos veces)", () => {
    for (const r of [registro("2.000,00", "2.500,00"), registro("2.500,00", "2.000,00")]) {
      const filas = una({ importe: 2000 });
      const c = conciliar(filas, r.registros, HOY);
      expect(c.porFila.get(1)?.tipo).toBe("ya-cargada");
      expect(filasCargadasDosVeces(filas, c, r.clavesRepetidas).has(1)).toBe(true);
    }
  });
  it("coincide con la segunda copia, no solo con la primera", () => {
    expect(resultadoDe(una({ importe: 2500 }), registro("2.000,00", "2.500,00")).tipo).toBe("ya-cargada");
  });
  it("no coincide con ninguna: 'otro importe' (mal cargada), con las copias; también marcada como cargada dos veces", () => {
    const filas = una({ importe: 3000 });
    const r = registro("2.000,00", "2.500,00");
    const c = conciliar(filas, r.registros, HOY);
    expect(c.porFila.get(1)).toEqual({ tipo: "otro-importe", importeFila: 3000, importeRegistro: 2000, copias: [2000, 2500] });
    expect(filasCargadasDosVeces(filas, c, r.clavesRepetidas).has(1)).toBe(true);
  });
  it("en una nota de crédito se compara el valor absoluto contra cada copia", () => {
    const r = leerRegistro(`cuit;tipo;pv;nro;importe\n${CUIT};3;1;5;9.350,25\n${CUIT};3;1;5;-9.350,25\n`);
    if (r instanceof Error) throw r;
    expect(resultadoDe(una({ tipoCmp: 3, importe: 9350.25 }), r).tipo).toBe("ya-cargada");
  });
  it("sin repetición, todo sigue igual: sin copias en el resultado", () => {
    expect(resultadoDe(una({ importe: 2000 }), registro("2.000,00"))).toEqual({ tipo: "ya-cargada" });
  });
  it("la clave repetida sin comprobante leído queda en el resumen para avisarla", () => {
    const r = registro("2.000,00", "2.500,00");
    const res = resumenConciliacion([], conciliar([], r.registros, HOY), r.clavesRepetidas);
    expect(res.cargadasDosVeces).toBe(1);
  });
});

describe("'Mal cargada' (otro importe u otro emisor)", () => {
  const otroImporte: Resultado = { tipo: "otro-importe", importeFila: 45200, importeRegistro: 45020 };

  it("las etiquetas dicen 'Mal cargada' y qué difiere", () => {
    expect(etiquetaConciliacion(otroImporte).texto).toBe("Mal cargada: otro importe");
    expect(etiquetaConciliacion({ tipo: "otro-emisor", cuitRegistro: OTRO_CUIT }).texto).toBe("Mal cargada: otro emisor");
  });

  it("el detalle conserva la diferencia y sugiere dar de baja y volver a cargar", () => {
    expect(ACCION_MAL_CARGADA).toBe("Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos.");
    const filas = una({ importe: 45200 });
    expect(detalleFila(otroImporte, filas[0] as Fila, [])).toBe(`Planilla $ 45.200,00 · Sistema $ 45.020,00 · Diferencia $ 180,00. ${ACCION_MAL_CARGADA}`);
    expect(detalleFila({ tipo: "otro-emisor", cuitRegistro: OTRO_CUIT }, filas[0] as Fila, [])).toBe(`En el sistema con CUIT 30-99000020-0. ${ACCION_MAL_CARGADA}`);
  });

  it("el CSV usa el mismo vocabulario", () => {
    expect(textoResultado(otroImporte)).toBe(`Mal cargada: otro importe (Planilla: 45.200,00. Sistema: 45.020,00. ${ACCION_MAL_CARGADA.replace(/\.$/, "")})`);
  });

  it("'Requieren atención' y el anuncio dicen 'mal cargadas', no 'con diferencias'", () => {
    const filas = una({ importe: 3000 });
    const r = resumenConciliacion(filas, conciliar(filas, registro("2.000,00").registros, HOY));
    expect(itemsAtencion(r).map((i) => `${i.cifra} ${i.texto}`)).toEqual(["1 mal cargada"]);
    expect(anuncioConciliacion(r)).toContain("Requieren atención: 1 mal cargada.");
    expect(itemsAtencion({ ...r, conDiferencias: 2 })[0]?.texto).toBe("mal cargadas");
  });
});

describe("clave repetida: error del sistema, con el importe de cada copia", () => {
  const filaConCopias = (importeFila: number, ...copias: number[]) => {
    const filas = una({ importe: importeFila });
    const res: Resultado = copias.some((c) => c === importeFila)
      ? { tipo: "ya-cargada", copias }
      : { tipo: "otro-importe", importeFila, importeRegistro: copias[0] as number, copias };
    return { fila: filas[0] as Fila, res };
  };

  it("coincide con una: nombra la copia que coincide y cuál sobra", () => {
    const { fila, res } = filaConCopias(2000, 2000, 2500);
    expect(detalleFila(res, fila, [])).toBe(
      "En el sistema figura 2 veces: $ 2.000,00 y $ 2.500,00. Coincide con la copia de $ 2.000,00. Dé de baja la copia de $ 2.500,00 que sobra.",
    );
  });
  it("coincide con la segunda: sobra la primera", () => {
    const { fila, res } = filaConCopias(2500, 2000, 2500);
    expect(detalleFila(res, fila, [])).toContain("Coincide con la copia de $ 2.500,00. Dé de baja la copia de $ 2.000,00 que sobra.");
  });
  it("con tres copias, dos que sobran", () => {
    const { fila, res } = filaConCopias(2000, 2000, 2500, 3000);
    expect(detalleFila(res, fila, [])).toBe(
      "En el sistema figura 3 veces: $ 2.000,00, $ 2.500,00 y $ 3.000,00. Coincide con la copia de $ 2.000,00. Dé de baja las copias de $ 2.500,00 y $ 3.000,00 que sobran.",
    );
  });
  it("con exactamente dos copias iguales, el texto va en dual: 'Las dos coinciden: dé de baja una.'", () => {
    const { fila, res } = filaConCopias(2000, 2000, 2000);
    expect(detalleFila(res, fila, [])).toBe("En el sistema figura 2 veces: $ 2.000,00 y $ 2.000,00. Las dos coinciden: dé de baja una.");
  });
  it("con tres o más copias iguales, queda el plural: se deja una sola", () => {
    const { fila, res } = filaConCopias(2000, 2000, 2000, 2000);
    expect(detalleFila(res, fila, [])).toBe(
      "En el sistema figura 3 veces: $ 2.000,00, $ 2.000,00 y $ 2.000,00. Todas coinciden con el comprobante: dé de baja las que sobran y deje una sola.",
    );
  });
  it("si coinciden varias y otra no, se da de baja la distinta y se deja una de las que coinciden", () => {
    const { fila, res } = filaConCopias(2000, 2000, 2000, 2500);
    expect(detalleFila(res, fila, [])).toContain("Coinciden 2 copias con el comprobante. Dé de baja la copia de $ 2.500,00 y deje una sola de las que coinciden.");
  });
  it("si no coincide ninguna: se dan de baja todas y se carga una sola vez", () => {
    const { fila, res } = filaConCopias(3000, 2000, 2500);
    expect(detalleFila(res, fila, [])).toBe(
      "En el sistema figura 2 veces: $ 2.000,00 y $ 2.500,00. Ninguna copia coincide con el comprobante: dé de baja todas y cárguelo una sola vez con los datos correctos.",
    );
  });

  it("la etiqueta dice cuántas veces figura (QA B3): dos o más", () => {
    expect(etiquetaConciliacion({ tipo: "ya-cargada", copias: [1, 1] }, undefined, true).texto).toBe("Cargada dos veces en el sistema");
    expect(etiquetaConciliacion({ tipo: "ya-cargada", copias: [1, 1, 1] }, undefined, true).texto).toBe("Cargada 3 veces en el sistema");
    expect(etiquetaConciliacion({ tipo: "otro-importe", importeFila: 1, importeRegistro: 2, copias: [2, 3] }, undefined, true)).toMatchObject({
      texto: "Cargada dos veces en el sistema",
      tono: "revisar",
      icono: "sistema",
    });
    expect(etiquetaConciliacion({ tipo: "ya-cargada" }).texto).toBe("Ya cargada");
  });

  it("'Requieren atención' no dice 'dos veces' si alguna figura 3 o más veces (QA B3)", () => {
    const vacia = { porFila: new Map<number, Resultado>(), soloEnRegistro: [] };
    const r2 = resumenConciliacion([], vacia, registro("1,00", "2,00").clavesRepetidas);
    expect(itemsAtencion(r2).map((i) => i.texto)).toEqual(["cargada dos veces en el sistema"]);
    const r3 = resumenConciliacion([], vacia, registro("1,00", "2,00", "3,00").clavesRepetidas);
    expect(itemsAtencion(r3).map((i) => i.texto)).toEqual(["cargada más de una vez en el sistema"]);
  });

  it("el aviso de la lista, sin comprobante leído: error del sistema con las copias", () => {
    const [c] = registro("2.000,00", "2.500,00").clavesRepetidas;
    expect(describirClaveRepetida(c as NonNullable<typeof c>, "PES")).toBe(
      "30-99000001-4 · Factura A 0001-00000005. Este comprobante figura cargado dos veces; el sistema no debería permitirlo. Dé de baja la copia que sobra. Copias: línea 2 ($ 2.000,00) y línea 3 ($ 2.500,00).",
    );
    const [c3] = registro("1,00", "2,00", "3,00").clavesRepetidas;
    expect(describirClaveRepetida(c3 as NonNullable<typeof c3>, "PES")).toContain(
      "figura cargado 3 veces; el sistema no debería permitirlo. Dé de baja las copias que sobran. Copias: línea 2 ($ 1,00), línea 3 ($ 2,00) y línea 4 ($ 3,00).",
    );
  });

  it("el aviso de la lista, con dos copias de igual importe, dice 'Las dos copias tienen el mismo importe: dé de baja una.'", () => {
    const [c] = registro("2.000,00", "2.000,00").clavesRepetidas;
    expect(describirClaveRepetida(c as NonNullable<typeof c>, "PES")).toBe(
      "30-99000001-4 · Factura A 0001-00000005. Este comprobante figura cargado dos veces; el sistema no debería permitirlo. Las dos copias tienen el mismo importe: dé de baja una. Copias: línea 2 ($ 2.000,00) y línea 3 ($ 2.000,00).",
    );
    // Con 3 iguales sigue el plural de siempre.
    const [c3] = registro("2.000,00", "2.000,00", "2.000,00").clavesRepetidas;
    expect(describirClaveRepetida(c3 as NonNullable<typeof c3>, "PES")).toContain("Dé de baja las copias que sobran.");
  });

  it("partesClaveRepetida pinta CUIT y número como código y cada importe como monto, y suma lo mismo que el texto plano", () => {
    const [c] = registro("2.000,00", "2.500,00").clavesRepetidas;
    const partes = partesClaveRepetida(c as NonNullable<typeof c>, "PES");
    expect(partes.filter((p) => p.tipo === "codigo").map((p) => p.texto)).toEqual(["30-99000001-4", "0001-00000005"]);
    expect(partes.filter((p) => p.tipo === "monto").map((p) => p.texto)).toEqual(["$ 2.000,00", "$ 2.500,00"]);
    expect(partes.map((p) => p.texto).join("")).toBe(describirClaveRepetida(c as NonNullable<typeof c>, "PES"));
  });
  it("partesClaveRepetida con más de cinco copias dice 'y N más' igual que el texto plano", () => {
    const [c] = registro("1,00", "2,00", "3,00", "4,00", "5,00", "6,00", "7,00").clavesRepetidas;
    const partes = partesClaveRepetida(c as NonNullable<typeof c>, "PES");
    expect(partes.filter((p) => p.tipo === "monto")).toHaveLength(5);
    expect(partes.map((p) => p.texto).join("")).toContain("y 2 más");
    expect(partes.map((p) => p.texto).join("")).toBe(describirClaveRepetida(c as NonNullable<typeof c>, "PES"));
  });

  it("el CSV con dos copias iguales dice lo mismo que la planilla", () => {
    const filas = una({ importe: 2000 });
    const r = registro("2.000,00", "2.000,00");
    const c = conciliar(filas, r.registros, HOY);
    const csv = aCsv(filas, HOY, c.porFila, filasCargadasDosVeces(filas, c, r.clavesRepetidas));
    expect(csv).toContain("Cargada dos veces en el sistema (En el sistema figura 2 veces: $ 2.000,00 y $ 2.000,00. Las dos coinciden: dé de baja una)");
  });

  it("el CSV dice lo mismo que la planilla", () => {
    const filas = una({ importe: 2000 });
    const r = registro("2.000,00", "2.500,00");
    const c = conciliar(filas, r.registros, HOY);
    const csv = aCsv(filas, HOY, c.porFila, filasCargadasDosVeces(filas, c, r.clavesRepetidas));
    expect(csv).toContain(
      "Cargada dos veces en el sistema (En el sistema figura 2 veces: $ 2.000,00 y $ 2.500,00. Coincide con la copia de $ 2.000,00. Dé de baja la copia de $ 2.500,00 que sobra)",
    );
  });
});
