import { describe, expect, it } from "vitest";
import type { Comprobante } from "../src/comprobante.ts";
import {
  ErrorRegistro,
  LIMITE_BYTES,
  LIMITE_LINEAS,
  conciliar,
  filasCargadasDosVeces,
  describirLineasInvalidas,
  describirRegistro,
  detectarSeparador,
  diferenciaImporte,
  interpretarImporte,
  interpretarTipo,
  leerRegistro,
  itemsAtencion,
  lineaMenor,
  mostrarConFiltro,
  normalizarTexto,
  partesRegistro,
  resumenConciliacion,
  textoResultado,
  type LecturaRegistro,
  type Registro,
  type Resultado,
} from "../src/conciliacion.ts";
import { aCsv } from "../src/csv.ts";
import { CUIT_FICTICIOS, generarEjemplos, registroEjemplo } from "../src/ejemplos.ts";
import { agregarFila, crearFila, siguienteId, type Fila } from "../src/planilla.ts";
import { leerUrlQr } from "../src/qr-arca.ts";

const HOY = new Date(2026, 10, 17);
const CUIT_A = "30990000014";
const CUIT_B = "30990000200";

function dato(cambios: Partial<Comprobante> = {}): Comprobante {
  return {
    ver: 1,
    fecha: "2026-10-05",
    cuit: CUIT_A,
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1245,
    importe: 1000,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: null,
    nroDocRec: "",
    tipoCodAut: "E",
    codAut: "70000000007919",
    ...cambios,
  };
}

function planilla(...datos: Array<Partial<Comprobante> | null>): Fila[] {
  let filas: Fila[] = [];
  for (const d of datos) {
    filas = agregarFila(filas, crearFila(siguienteId(filas), `a-${filas.length + 1}.pdf`, d === null ? null : dato(d)));
  }
  return filas;
}

function registro(cambios: Partial<Registro> = {}): Registro {
  return { cuit: CUIT_A, tipoCmp: 1, ptoVta: 3, nroCmp: 1245, importe: 1000, linea: 2, ...cambios };
}

function lectura(texto: string): LecturaRegistro {
  const r = leerRegistro(texto);
  if (r instanceof Error) throw r;
  return r;
}

function resultadoUnico(filas: Fila[], registros: Registro[]): Resultado {
  return conciliar(filas, registros).porFila.get(1) as Resultado;
}

// ---------------------------------------------------------------- Lectura

describe("normalizarTexto e interpretarTipo", () => {
  it("quita tildes, mayúsculas, puntos y espacios de más", () => {
    expect(normalizarTexto("  Pto. Vta. ")).toBe("pto vta");
    expect(normalizarTexto("NÚMERO")).toBe("numero");
  });
  it("entiende el tipo por código", () => {
    expect(interpretarTipo("6")).toBe(6);
    expect(interpretarTipo(" 011 ")).toBe(11);
    expect(interpretarTipo("99")).toBe(99);
  });
  it("entiende el tipo por nombre, sin importar mayúsculas ni tildes", () => {
    expect(interpretarTipo("Factura A")).toBe(1);
    expect(interpretarTipo("nota de credito b")).toBe(8);
    expect(interpretarTipo("NOTA DE CRÉDITO C")).toBe(13);
    expect(interpretarTipo("Tipo 99")).toBe(99);
  });
  it("devuelve null si no lo reconoce", () => {
    expect(interpretarTipo("")).toBeNull();
    expect(interpretarTipo("Remito")).toBeNull();
    expect(interpretarTipo("-1")).toBeNull();
  });
});

describe("leerRegistro: formato", () => {
  it("detecta el separador ; y el separador ,", () => {
    expect(detectarSeparador("cuit;tipo;importe\n1;2;3")).toBe(";");
    expect(detectarSeparador("cuit,tipo,importe\n1,2,3")).toBe(",");
    expect(detectarSeparador('"a,b";c;d')).toBe(";");
  });

  it("lee un registro con coma como separador y decimales con punto", () => {
    const r = lectura(`CUIT,Tipo,Punto de venta,Número,Importe\n${CUIT_A},1,3,1245,1234.56\n`);
    expect(r.registros).toEqual([{ cuit: CUIT_A, tipoCmp: 1, ptoVta: 3, nroCmp: 1245, importe: 1234.56, linea: 2 }]);
  });

  it("lee un registro con punto y coma, BOM y CRLF", () => {
    const r = lectura(`﻿CUIT;Tipo;Punto de venta;Número;Importe\r\n${CUIT_A};6;1;876;1.234,56\r\n`);
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]).toMatchObject({ tipoCmp: 6, ptoVta: 1, nroCmp: 876, importe: 1234.56 });
  });

  it("acepta encabezados con tildes, mayúsculas, alias y en cualquier orden", () => {
    const r = lectura(`TOTAL;PV;NRO;Tipo Comprobante;CUIT Proveedor;Observaciones\n500,25;2;31;Nota de crédito A;${CUIT_B};x\n`);
    expect(r.registros[0]).toEqual({ cuit: CUIT_B, tipoCmp: 3, ptoVta: 2, nroCmp: 31, importe: 500.25, linea: 2 });
  });

  it("acepta el CUIT con guiones y el importe con signo $", () => {
    const r = lectura(`cuit emisor;tipo;pto vta;numero comprobante;importe\n30-99000001-4;Factura A;3;1245;$ 1.000,00\n`);
    expect(r.registros[0]).toMatchObject({ cuit: CUIT_A, importe: 1000 });
  });

  it("acepta los importes en formato argentino y en formato con punto decimal", () => {
    const r = lectura(`cuit;tipo;pv;nro;importe\n${CUIT_A};1;1;1;1.234,56\n${CUIT_A};1;1;2;1234.56\n${CUIT_A};1;1;3;12,5\n${CUIT_A};1;1;4;7\n`);
    expect(r.registros.map((x) => x.importe)).toEqual([1234.56, 1234.56, 12.5, 7]);
  });

  it("respeta las comillas: separadores y saltos de línea dentro de una celda", () => {
    const r = lectura(`Observaciones;cuit;tipo;pv;nro;importe\n"a;b\nc";${CUIT_A};1;1;1;10\n"x ""y""";${CUIT_A};1;1;2;20\n`);
    expect(r.registros.map((x) => x.nroCmp)).toEqual([1, 2]);
    expect(r.lineasInvalidas).toEqual([]);
    // la segunda fila empieza en la línea 4 porque la primera ocupa dos líneas del archivo
    expect(r.registros[1]?.linea).toBe(4);
  });

  it("ignora las líneas vacías", () => {
    const r = lectura(`cuit;tipo;pv;nro;importe\n\n${CUIT_A};1;1;1;10\n;;;;\n\n`);
    expect(r.registros).toHaveLength(1);
    expect(r.lineasInvalidas).toEqual([]);
  });
});

describe("leerRegistro: errores", () => {
  it("dice qué columna falta y qué nombres acepta", () => {
    const r = leerRegistro("cuit;tipo;pv;importe\n1;2;3;4\n");
    expect(r).toBeInstanceOf(ErrorRegistro);
    expect((r as Error).message).toContain("número");
    expect((r as Error).message).toContain("numero, nro, numero comprobante");
    const sinCuit = leerRegistro("tipo;pv;nro;importe\n");
    expect((sinCuit as Error).message).toContain("cuit, cuit emisor, cuit proveedor");
  });

  it("rechaza un archivo vacío o con solo espacios", () => {
    expect(leerRegistro("")).toBeInstanceOf(Error);
    expect(leerRegistro("  \r\n \n")).toBeInstanceOf(Error);
  });

  it("rechaza un archivo de más de 2 MB", () => {
    const grande = "cuit;tipo;pv;nro;importe\n" + "x".repeat(LIMITE_BYTES);
    const r = leerRegistro(grande);
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toContain("2 MB");
  });

  it("rechaza un archivo de más de 20.000 líneas", () => {
    const filas = Array.from({ length: LIMITE_LINEAS + 1 }, (_, i) => `${CUIT_A};1;1;${i + 1};1`);
    const r = leerRegistro(["cuit;tipo;pv;nro;importe", ...filas].join("\n"));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toContain("líneas");
  });

  it("acepta un archivo justo en el límite de líneas", () => {
    const filas = Array.from({ length: LIMITE_LINEAS - 1 }, (_, i) => `${CUIT_A};1;1;${i + 1};1`);
    const r = leerRegistro(["cuit;tipo;pv;nro;importe", ...filas].join("\n"));
    expect(r).not.toBeInstanceOf(Error);
  });

  it("saltea las líneas inválidas y dice cuáles son", () => {
    const texto = [
      "cuit;tipo;pv;nro;importe", // 1
      `${CUIT_A};1;1;1;10`, // 2 ok
      `${CUIT_A};1;1;2;abc`, // 3 importe inválido
      `123;1;1;3;10`, // 4 CUIT corto
      `${CUIT_A};Remito;1;4;10`, // 5 tipo desconocido
      `${CUIT_A};1;-1;5;10`, // 6 punto de venta negativo
      `${CUIT_A};1;1`, // 7 faltan celdas
      `${CUIT_A};1;1;8;10`, // 8 ok
    ].join("\n");
    const r = lectura(texto);
    expect(r.registros.map((x) => x.nroCmp)).toEqual([1, 8]);
    expect(r.lineasInvalidas).toEqual([3, 4, 5, 6, 7]);
  });

  it("redacta el aviso de líneas inválidas", () => {
    expect(describirLineasInvalidas([])).toBe("");
    expect(describirLineasInvalidas([4])).toBe("1 línea no se pudo leer: 4.");
    expect(describirLineasInvalidas([4, 9, 12])).toBe("3 líneas no se pudieron leer: 4, 9, 12.");
    expect(describirLineasInvalidas(Array.from({ length: 20 }, (_, i) => i + 2))).toContain("y 5 más");
  });

  it("devuelve la lista de claves repetidas (comprobantes cargados dos veces) y se queda con la primera", () => {
    const r = lectura(`cuit;tipo;pv;nro;importe\n${CUIT_A};1;1;1;10\n${CUIT_A};1;1;1;99\n${CUIT_A};1;1;1;77\n${CUIT_A};1;1;2;5\n`);
    expect(r.registros).toHaveLength(2);
    expect(r.registros[0]?.importe).toBe(10);
    expect(r.clavesRepetidas).toHaveLength(1);
    expect(r.clavesRepetidas[0]).toMatchObject({ veces: 3, lineas: [2, 3, 4] });
    expect(r.clavesRepetidas[0]?.registro).toMatchObject({ cuit: CUIT_A, tipoCmp: 1, ptoVta: 1, nroCmp: 1 });
  });

  it("una comilla sin cerrar es un error claro con la línea donde se abrió (no se traga el resto del archivo)", () => {
    const texto = `cuit;tipo;pv;nro;importe;obs\n${CUIT_A};1;1;1;10;ok\n${CUIT_A};1;1;2;20;"sin cerrar\n${CUIT_A};1;1;3;30;ok\n`;
    const r = leerRegistro(texto);
    expect(r).toBeInstanceOf(ErrorRegistro);
    expect((r as Error).message).toBe("El archivo tiene una comilla sin cerrar a partir de la línea 3.");
  });

  it("una comilla cerrada que ocupa varias líneas no es error", () => {
    const r = leerRegistro(`cuit;tipo;pv;nro;importe;obs\n${CUIT_A};1;1;1;10;"dos\nlíneas"\n`);
    expect(r).not.toBeInstanceOf(Error);
  });

  it("avisa si un encabezado está duplicado y usa la primera columna", () => {
    const r = lectura(`CUIT;cuit emisor;tipo;pv;nro;importe\n${CUIT_A};${CUIT_B};1;1;1;10\n`);
    expect(r.encabezadosDuplicados).toEqual(["CUIT"]);
    expect(r.registros[0]?.cuit).toBe(CUIT_A);
    expect(lectura(`cuit;tipo;pv;nro;importe\n`).encabezadosDuplicados).toEqual([]);
  });

  it("el texto con fórmulas o HTML se trata como dato inválido, nunca se interpreta", () => {
    const r = lectura(`cuit;tipo;pv;nro;importe\n=1+1;<img src=x onerror=alert(1)>;1;1;10\n`);
    expect(r.registros).toEqual([]);
    expect(r.lineasInvalidas).toEqual([2]);
  });
});

// ---------------------------------------------------------------- Cruce

describe("conciliar: cada resultado", () => {
  it("falta cargar: la clave no está en el registro", () => {
    expect(resultadoUnico(planilla({}), [registro({ nroCmp: 9999 })])).toEqual({ tipo: "falta" });
    expect(resultadoUnico(planilla({}), [])).toEqual({ tipo: "falta" });
  });

  it("ya cargada: la clave está y el importe coincide", () => {
    expect(resultadoUnico(planilla({}), [registro()])).toEqual({ tipo: "ya-cargada" });
  });

  it("el importe se compara exacto al centavo: sin tolerancia", () => {
    expect(
      resultadoUnico(planilla({ importe: 1000 }), [
        registro({ importe: 1000.01 }),
      ]),
    ).toMatchObject({ tipo: "otro-importe" });
    expect(
      resultadoUnico(planilla({ importe: 1000 }), [
        registro({ importe: 999.99 }),
      ]),
    ).toMatchObject({ tipo: "otro-importe" });
    // Los errores de coma flotante no cuentan como diferencia:
    // se compara en centavos enteros.
    expect(
      resultadoUnico(planilla({ importe: 0.1 + 0.2 }), [
        registro({ importe: 0.3 }),
      ]),
    ).toEqual({ tipo: "ya-cargada" });
    expect(
      resultadoUnico(planilla({ importe: 118470.5 }), [
        registro({ importe: 118470.5 }),
      ]),
    ).toEqual({ tipo: "ya-cargada" });
  });

  it("cargada con otro importe: muestra los dos importes", () => {
    expect(resultadoUnico(planilla({ importe: 1000 }), [registro({ importe: 1000.02 })])).toEqual({
      tipo: "otro-importe",
      importeFila: 1000,
      importeRegistro: 1000.02,
    });
    expect(resultadoUnico(planilla({ importe: 45200 }), [registro({ importe: 45020 })])).toMatchObject({ tipo: "otro-importe" });
  });

  it("cargada con otro emisor: mismo tipo, punto de venta, número e importe con otro CUIT", () => {
    expect(resultadoUnico(planilla({}), [registro({ cuit: CUIT_B })])).toEqual({ tipo: "otro-emisor", cuitRegistro: CUIT_B });
  });

  it("otro emisor exige que el importe coincida; si no, falta cargar", () => {
    expect(resultadoUnico(planilla({}), [registro({ cuit: CUIT_B, importe: 5 })])).toEqual({ tipo: "falta" });
  });

  it("otro emisor no se confunde con un tipo distinto", () => {
    expect(resultadoUnico(planilla({}), [registro({ cuit: CUIT_B, tipoCmp: 6 })])).toEqual({ tipo: "falta" });
  });

  it("si la clave exacta está, gana sobre un registro de otro emisor", () => {
    const registros = [registro({ cuit: CUIT_B, nroCmp: 1245 }), registro()];
    expect(resultadoUnico(planilla({}), registros)).toEqual({ tipo: "ya-cargada" });
  });

  it("una fila 'sin QR' vacía no se puede conciliar", () => {
    expect(resultadoUnico(planilla(null), [registro()])).toEqual({ tipo: "no-conciliable" });
  });

  it("una fila 'sin QR' completada a mano con la clave completa sí se concilia", () => {
    const completada = [crearFila(1, "a.pdf", null)];
    completada[0] = { ...completada[0]!, datos: dato(), editados: ["cuit", "tipoCmp", "ptoVta", "nroCmp", "importe"] };
    expect(resultadoUnico(completada, [registro()])).toEqual({ tipo: "ya-cargada" });
    expect(resultadoUnico(completada, [])).toEqual({ tipo: "falta" });
    // Si todavía le falta un dato de la clave, sigue sin poder conciliarse.
    const incompleta = [{ ...completada[0]!, datos: dato({ nroCmp: null }) }];
    expect(resultadoUnico(incompleta, [registro()])).toEqual({ tipo: "no-conciliable" });
  });

  it("revisar antes de cargar: una fila dudosa que no está en el registro no figura como 'falta cargar'", () => {
    for (const dudosa of [{ cuit: "30990000015" }, { importe: 0 }, { fecha: "2099-01-01" }] as Array<Partial<Comprobante>>) {
      expect(conciliar(planilla(dudosa), [], HOY).porFila.get(1)).toEqual({ tipo: "revisar" });
    }
  });

  it("una fila dudosa que sí está en el registro conserva su resultado (ya cargada, otro importe, otro emisor)", () => {
    expect(conciliar(planilla({ importe: 0 }), [registro({ importe: 0 })], HOY).porFila.get(1)).toEqual({ tipo: "ya-cargada" });
    expect(conciliar(planilla({ fecha: "2099-01-01" }), [registro({ importe: 5 })], HOY).porFila.get(1)).toMatchObject({ tipo: "otro-importe" });
    expect(conciliar(planilla({ fecha: "2099-01-01" }), [registro({ cuit: CUIT_B })], HOY).porFila.get(1)).toMatchObject({ tipo: "otro-emisor" });
  });

  it("una fila sin dudas que no está en el registro sigue siendo 'falta cargar'", () => {
    expect(conciliar(planilla({}), [], HOY).porFila.get(1)).toEqual({ tipo: "falta" });
  });

  it("otro emisor: un registro que ya coincide exacto con otra fila no se usa para acusar a una fila vecina", () => {
    // A (CUIT_A) y B (CUIT_B) tienen mismo tipo, punto de venta, número e importe; el sistema solo tiene B.
    const filas = planilla({ cuit: CUIT_A, tipoCmp: 6, ptoVta: 1, nroCmp: 1, importe: 1000 }, { cuit: CUIT_B, tipoCmp: 6, ptoVta: 1, nroCmp: 1, importe: 1000 });
    const c = conciliar(filas, [registro({ cuit: CUIT_B, tipoCmp: 6, ptoVta: 1, nroCmp: 1, importe: 1000 })], HOY);
    expect(c.porFila.get(1)).toEqual({ tipo: "falta" });
    expect(c.porFila.get(2)).toEqual({ tipo: "ya-cargada" });
    expect(c.soloEnRegistro).toEqual([]);
  });

  it("otro emisor: el orden de las filas no cambia el resultado", () => {
    const filas = planilla({ cuit: CUIT_B, tipoCmp: 6, ptoVta: 1, nroCmp: 1, importe: 1000 }, { cuit: CUIT_A, tipoCmp: 6, ptoVta: 1, nroCmp: 1, importe: 1000 });
    const c = conciliar(filas, [registro({ cuit: CUIT_B, tipoCmp: 6, ptoVta: 1, nroCmp: 1, importe: 1000 })], HOY);
    expect(c.porFila.get(1)).toEqual({ tipo: "ya-cargada" });
    expect(c.porFila.get(2)).toEqual({ tipo: "falta" });
  });

  it("otro emisor: si varias filas comparten tipo, número e importe con un registro de otro CUIT, todas son candidatas (en cualquier orden)", () => {
    const CUIT_C = "30990000308";
    const a = { cuit: CUIT_A, nroCmp: 5 };
    const c = { cuit: CUIT_C, nroCmp: 5 };
    const delRegistro = [registro({ cuit: CUIT_B, nroCmp: 5 })];

    const directo = conciliar(planilla(a, c), delRegistro, HOY);
    expect([directo.porFila.get(1), directo.porFila.get(2)]).toEqual([
      { tipo: "otro-emisor", cuitRegistro: CUIT_B },
      { tipo: "otro-emisor", cuitRegistro: CUIT_B },
    ]);
    expect(directo.soloEnRegistro).toEqual([]);

    // Con las filas en el orden inverso, cada comprobante tiene el mismo resultado que antes.
    const inverso = conciliar(planilla(c, a), delRegistro, HOY);
    expect(inverso.porFila.get(2)).toEqual(directo.porFila.get(1));
    expect(inverso.porFila.get(1)).toEqual(directo.porFila.get(2));
  });

  it("otro emisor: con dos registros candidatos de CUIT distintos se elige siempre el primero del registro, sin importar el orden de las filas", () => {
    const CUIT_C = "30990000308";
    const registros = [registro({ cuit: CUIT_B, nroCmp: 5 }), registro({ cuit: CUIT_C, nroCmp: 5, linea: 3 })];
    const una = conciliar(planilla({ cuit: CUIT_A, nroCmp: 5 }), registros, HOY).porFila.get(1);
    expect(una).toEqual({ tipo: "otro-emisor", cuitRegistro: CUIT_B });
    const vecinas = conciliar(planilla({ cuit: "30990000014", nroCmp: 9 }, { cuit: CUIT_A, nroCmp: 5 }), registros, HOY).porFila.get(2);
    expect(vecinas).toEqual(una);
    // El segundo registro no lo reclama nadie: queda como "no recibido".
    expect(conciliar(planilla({ cuit: CUIT_A, nroCmp: 5 }), registros, HOY).soloEnRegistro).toEqual([registros[1]]);
  });

  it("no se puede conciliar: falta CUIT, tipo, punto de venta o número", () => {
    for (const faltante of [{ cuit: "" }, { tipoCmp: null }, { ptoVta: null }, { nroCmp: null }] as Array<Partial<Comprobante>>) {
      expect(resultadoUnico(planilla(faltante), [registro()])).toEqual({ tipo: "no-conciliable" });
    }
  });

  it("una fila con la clave completa pero sin importe queda 'otro importe'", () => {
    expect(resultadoUnico(planilla({ importe: null }), [registro()])).toEqual({
      tipo: "otro-importe",
      importeFila: null,
      importeRegistro: 1000,
    });
  });
});

describe("conciliar: casos particulares", () => {
  it("un duplicado de la planilla tiene su propio resultado (nunca 'ya cargada') y nombra a su original", () => {
    const filas = planilla({}, {});
    const c = conciliar(filas, [registro()]);
    expect(c.porFila.get(1)).toEqual({ tipo: "ya-cargada" });
    expect(c.porFila.get(2)).toEqual({ tipo: "duplicada", original: 1 });
    const sinRegistro = conciliar(filas, []);
    expect(sinRegistro.porFila.get(1)).toEqual({ tipo: "falta" });
    expect(sinRegistro.porFila.get(2)).toEqual({ tipo: "duplicada", original: 1 });
  });

  it("el duplicado no depende de lo que le pase al original (revisar, otro importe)", () => {
    const revisar = conciliar(planilla({ importe: 0 }, { importe: 0 }), [], HOY);
    expect(revisar.porFila.get(1)).toEqual({ tipo: "revisar" });
    expect(revisar.porFila.get(2)).toEqual({ tipo: "duplicada", original: 1 });
    const otroImporte = conciliar(planilla({ importe: 50 }, { importe: 50 }, { importe: 50 }), [registro({ importe: 70 })]);
    expect(otroImporte.porFila.get(1)).toMatchObject({ tipo: "otro-importe" });
    expect(otroImporte.porFila.get(2)).toEqual({ tipo: "duplicada", original: 1 });
    expect(otroImporte.porFila.get(3)).toEqual({ tipo: "duplicada", original: 1 });
  });

  it("el original es la primera fila con esa clave, aunque haya otras filas en el medio", () => {
    const filas = planilla({ nroCmp: 9 }, { nroCmp: 1 }, { nroCmp: 9 });
    const c = conciliar(filas, [], HOY);
    expect(c.porFila.get(3)).toEqual({ tipo: "duplicada", original: 1 });
    expect(c.porFila.get(2)).toEqual({ tipo: "falta" });
  });

  it("una nota de crédito se concilia por su clave, también si el sistema la guarda en negativo", () => {
    const filas = planilla({ tipoCmp: 3, importe: 9350.25, nroCmp: 31 });
    expect(conciliar(filas, [registro({ tipoCmp: 3, nroCmp: 31, importe: 9350.25 })]).porFila.get(1)).toEqual({ tipo: "ya-cargada" });
    expect(conciliar(filas, [registro({ tipoCmp: 3, nroCmp: 31, importe: -9350.25 })]).porFila.get(1)).toEqual({ tipo: "ya-cargada" });
    // Una factura A con el mismo número no es la nota de crédito.
    expect(conciliar(filas, [registro({ tipoCmp: 1, nroCmp: 31, importe: 9350.25 })]).porFila.get(1)).toEqual({ tipo: "falta" });
  });

  it("el signo cuenta salvo en las notas de crédito: una factura contra un importe negativo es otro importe", () => {
    expect(resultadoUnico(planilla({ importe: 1000 }), [registro({ importe: -1000 })])).toMatchObject({ tipo: "otro-importe" });
    expect(resultadoUnico(planilla({ tipoCmp: 11, importe: 1000 }), [registro({ tipoCmp: 11, importe: -1000 })])).toMatchObject({ tipo: "otro-importe" });
    expect(resultadoUnico(planilla({ importe: -1000 }), [registro({ importe: -1000 })])).toEqual({ tipo: "ya-cargada" });
    // Las tres notas de crédito (A, B y C) admiten los dos signos.
    for (const tipoCmp of [3, 8, 13]) {
      expect(resultadoUnico(planilla({ tipoCmp, importe: 500 }), [registro({ tipoCmp, importe: -500 })])).toEqual({ tipo: "ya-cargada" });
    }
  });

  it("otro emisor también respeta el signo", () => {
    expect(resultadoUnico(planilla({ importe: 1000 }), [registro({ cuit: CUIT_B, importe: -1000 })])).toEqual({ tipo: "falta" });
    expect(resultadoUnico(planilla({ tipoCmp: 3, importe: 1000 }), [registro({ cuit: CUIT_B, tipoCmp: 3, importe: -1000 })])).toMatchObject({ tipo: "otro-emisor" });
  });

  it("filtro 'solo lo que falta cargar': deja afuera los duplicados de la planilla y todo lo que no falta", () => {
    expect(mostrarConFiltro("faltan", { tipo: "falta" }, false)).toBe(true);
    expect(mostrarConFiltro("faltan", { tipo: "falta" }, true)).toBe(false);
    for (const tipo of ["ya-cargada", "revisar", "no-conciliable"] as const) expect(mostrarConFiltro("faltan", { tipo }, false)).toBe(false);
    expect(mostrarConFiltro("faltan", undefined, false)).toBe(false);
  });

  it("filtros 'para revisar' y 'mal cargadas'", () => {
    expect(mostrarConFiltro("revisar", { tipo: "revisar" }, false)).toBe(true);
    expect(mostrarConFiltro("revisar", { tipo: "falta" }, false)).toBe(false);
    expect(mostrarConFiltro("revisar", { tipo: "revisar" }, true)).toBe(false);
    expect(mostrarConFiltro("diferencias", { tipo: "otro-importe", importeFila: 1, importeRegistro: 2 }, false)).toBe(true);
    expect(mostrarConFiltro("diferencias", { tipo: "otro-emisor", cuitRegistro: CUIT_B }, false)).toBe(true);
    expect(mostrarConFiltro("diferencias", { tipo: "ya-cargada" }, false)).toBe(false);
  });

  it("ningún filtro muestra la fila con resultado 'duplicada' (cada comprobante cuenta una vez)", () => {
    for (const filtro of ["faltan", "revisar", "diferencias"] as const) {
      expect(mostrarConFiltro(filtro, { tipo: "duplicada", original: 1 }, true)).toBe(false);
    }
  });

  it("sin filtro se ve todo, también los duplicados y las filas sin resultado", () => {
    expect(mostrarConFiltro("todas", { tipo: "ya-cargada" }, true)).toBe(true);
    expect(mostrarConFiltro("todas", undefined, false)).toBe(true);
  });

  it("soloEnRegistro: lo cargado que ninguna fila reclama", () => {
    const filas = planilla({ nroCmp: 1 }, { nroCmp: 2 });
    const sobrante = registro({ nroCmp: 3, linea: 4 });
    const c = conciliar(filas, [registro({ nroCmp: 1 }), registro({ nroCmp: 2, importe: 5 }), sobrante]);
    expect(c.soloEnRegistro).toEqual([sobrante]);
  });

  it("soloEnRegistro no repite como 'no recibido' lo que ya se explica como otro emisor", () => {
    const c = conciliar(planilla({}), [registro({ cuit: CUIT_B })]);
    expect(c.soloEnRegistro).toEqual([]);
  });

  it("no modifica la planilla ni el registro que recibe", () => {
    const filas = planilla({});
    const registros = [registro()];
    const copiaFilas = JSON.stringify(filas);
    const copiaRegistros = JSON.stringify(registros);
    conciliar(filas, registros);
    expect(JSON.stringify(filas)).toBe(copiaFilas);
    expect(JSON.stringify(registros)).toBe(copiaRegistros);
  });
});

describe("resumenConciliacion", () => {
  it("cuenta cada resultado una sola vez (sin duplicados) y suma lo que falta por moneda", () => {
    const filas = planilla(
      { nroCmp: 1, importe: 100 }, // ya cargada
      { nroCmp: 2, importe: 200 }, // falta
      { nroCmp: 2, importe: 200 }, // duplicada de la anterior
      { nroCmp: 3, importe: 300, moneda: "DOL" }, // falta, en dólares
      { nroCmp: 4, tipoCmp: 3, importe: 50 }, // nota de crédito que falta: se cuenta aparte, no resta
      { nroCmp: 5, importe: 10 }, // otro importe
      { nroCmp: 6, importe: 60 }, // otro emisor
      null, // sin QR
    );
    const registros = [
      registro({ nroCmp: 1, importe: 100 }),
      registro({ nroCmp: 5, importe: 11 }),
      registro({ nroCmp: 6, importe: 60, cuit: CUIT_B }),
      registro({ nroCmp: 77, importe: 1 }),
    ];
    const r = resumenConciliacion(filas, conciliar(filas, registros, HOY));
    expect(r.faltan).toBe(3);
    expect(r.yaCargadas).toBe(1);
    expect(r.otroImporte).toBe(1);
    expect(r.otroEmisor).toBe(1);
    expect(r.conDiferencias).toBe(2);
    expect(r.noConciliables).toBe(1);
    expect(r.noRecibidas).toBe(1);
    expect(r.duplicadas).toBe(1);
    // Pesos primero, después el resto de las monedas.
    expect(r.faltanPorMoneda.map((t) => [t.moneda, t.total, t.cantidad])).toEqual([
      ["PES", 200, 1],
      ["DOL", 300, 1],
    ]);
    expect(r.faltanNotasCredito).toBe(1);
    expect(r.faltanNotasCreditoPorMoneda.map((t) => [t.moneda, t.total, t.cantidad])).toEqual([["PES", 50, 1]]);
  });

  it("las filas para revisar no suman en lo que falta cargar y tienen su propio conteo", () => {
    const filas = planilla(
      { nroCmp: 1, importe: 100 }, // falta
      { nroCmp: 2, importe: 0 }, // revisar (total cero)
      { nroCmp: 3, importe: 900, fecha: "2099-01-01" }, // revisar (fecha futura)
      { nroCmp: 3, importe: 900, fecha: "2099-01-01" }, // duplicada de la anterior: no cuenta
    );
    const r = resumenConciliacion(filas, conciliar(filas, [], HOY));
    expect(r.faltan).toBe(1);
    expect(r.revisar).toBe(2);
    expect(r.faltanPorMoneda.map((t) => [t.moneda, t.total])).toEqual([["PES", 100]]);
  });

  it("cuenta los comprobantes cargados dos veces en el sistema", () => {
    const lect = lectura(`cuit;tipo;pv;nro;importe\n${CUIT_A};1;3;1;10\n${CUIT_A};1;3;1;10\n`);
    const filas = planilla({ nroCmp: 1, importe: 10 });
    const r = resumenConciliacion(filas, conciliar(filas, lect.registros, HOY), lect.clavesRepetidas);
    expect(r.cargadasDosVeces).toBe(1);
    expect(r.yaCargadas).toBe(1);
    expect(resumenConciliacion(filas, conciliar(filas, lect.registros, HOY)).cargadasDosVeces).toBe(0);
  });

  it("sin filas ni registro, todo en cero", () => {
    const r = resumenConciliacion([], conciliar([], []));
    expect(r).toMatchObject({ faltan: 0, revisar: 0, yaCargadas: 0, conDiferencias: 0, noConciliables: 0, noRecibidas: 0, cargadasDosVeces: 0, duplicadas: 0 });
    expect(r.faltanPorMoneda).toEqual([]);
  });
});

describe("textos", () => {
  it("la etiqueta lleva el detalle cuando lo hay", () => {
    expect(textoResultado({ tipo: "falta" })).toBe("Falta cargar");
    expect(textoResultado({ tipo: "ya-cargada" })).toBe("Ya cargada");
    expect(textoResultado({ tipo: "no-conciliable" })).toBe("No se puede conciliar");
    expect(textoResultado({ tipo: "otro-importe", importeFila: 45200, importeRegistro: 45020 })).toBe(
      "Mal cargada: otro importe (Planilla: 45.200,00. Sistema: 45.020,00. Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos)",
    );
    expect(textoResultado({ tipo: "otro-emisor", cuitRegistro: CUIT_A })).toBe(
      "Mal cargada: otro emisor (En el sistema figura con el CUIT 30-99000001-4. Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos)",
    );
    expect(textoResultado({ tipo: "duplicada", original: 1 })).toBe("Duplicada en la planilla");
  });

  it("describe un registro no recibido", () => {
    expect(describirRegistro(registro({ nroCmp: 1260, importe: 52000 }))).toBe("30-99000001-4 · Factura A 0003-00001260 · $ 52.000,00");
  });

  it("describe un registro con el símbolo de su moneda (el CSV del sistema no la trae: sin otro dato, pesos)", () => {
    expect(describirRegistro(registro({ nroCmp: 1260, importe: 1250 }), "DOL")).toBe("30-99000001-4 · Factura A 0003-00001260 · US$ 1.250,00");
    expect(describirRegistro(registro({ importe: -9350.25 }))).toBe("30-99000001-4 · Factura A 0003-00001245 · -$ 9.350,25");
  });

  it("partesRegistro separa el CUIT, el número y el importe para pintarlos sin cortarlos (código, código y monto)", () => {
    const partes = partesRegistro(registro({ nroCmp: 1260, importe: 52000 }));
    expect(partes).toEqual([
      { tipo: "codigo", texto: "30-99000001-4" },
      { tipo: "texto", texto: " · Factura A " },
      { tipo: "codigo", texto: "0003-00001260" },
      { tipo: "texto", texto: " · " },
      { tipo: "monto", texto: "$ 52.000,00" },
    ]);
    expect(partes.map((p) => p.texto).join("")).toBe(describirRegistro(registro({ nroCmp: 1260, importe: 52000 })));
  });
});

// ---------------------------------------------------------------- Ida y vuelta con el CSV propio

describe("el CSV que exporta esta demo también se acepta como registro", () => {
  it("ida y vuelta: todo lo exportado queda 'ya cargado'", () => {
    const filas = planilla({ nroCmp: 1, importe: 118470.5 }, { nroCmp: 2, tipoCmp: 3, importe: 9350.25 }, { nroCmp: 3, cuit: CUIT_B, tipoCmp: 11, importe: 1234567.89 });
    const csv = aCsv(filas, HOY);
    const r = lectura(csv);
    expect(r.registros).toHaveLength(3);
    expect(r.lineasInvalidas).toEqual([]);
    const c = conciliar(filas, r.registros);
    expect([...c.porFila.values()].map((x) => x.tipo)).toEqual(["ya-cargada", "ya-cargada", "ya-cargada"]);
    expect(c.soloEnRegistro).toEqual([]);
  });

  it("las filas sin datos completos del CSV propio se saltean como líneas inválidas", () => {
    const filas = [...planilla({}), crearFila(2, "sin.pdf", null)];
    const r = lectura(aCsv(filas, HOY));
    expect(r.registros).toHaveLength(1);
    expect(r.lineasInvalidas).toEqual([3]);
  });

  it("una planilla con un duplicado exportada de vuelta lo informa como clave repetida", () => {
    const r = lectura(aCsv(planilla({}, {}), HOY));
    expect(r.registros).toHaveLength(1);
    expect(r.clavesRepetidas).toHaveLength(1);
  });

  it("el CSV exportado con la conciliación puesta sigue siendo legible", () => {
    const filas = planilla({});
    const c = conciliar(filas, [registro({ importe: 5 })]);
    const r = lectura(aCsv(filas, HOY, c.porFila));
    expect(r.registros).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- Ejemplo ficticio

function filasDeEjemplo(): Fila[] {
  return generarEjemplos(HOY).map((e, i) => {
    if (e.url === null) return crearFila(i + 1, e.origen, null);
    const c = leerUrlQr(e.url);
    if (c instanceof Error) throw c;
    return crearFila(i + 1, e.origen, c);
  });
}

describe("registroEjemplo", () => {
  it("se lee sin errores ni líneas inválidas, con exactamente un comprobante cargado dos veces", () => {
    const r = lectura(registroEjemplo());
    expect(r.lineasInvalidas).toEqual([]);
    expect(r.encabezadosDuplicados).toEqual([]);
    expect(r.clavesRepetidas).toHaveLength(1);
    expect(r.registros.length).toBeGreaterThanOrEqual(6);
  });

  it("al cruzarlo con las facturas de ejemplo da todos los resultados, dos 'no recibidas' y una cargada dos veces", () => {
    const filas = filasDeEjemplo();
    const lect = lectura(registroEjemplo());
    const c = conciliar(filas, lect.registros, HOY);
    const tipos = new Set([...c.porFila.values()].map((x) => x.tipo));
    for (const t of ["falta", "revisar", "ya-cargada", "otro-importe", "otro-emisor", "no-conciliable"]) expect(tipos).toContain(t);
    expect(c.soloEnRegistro).toHaveLength(2);
    const r = resumenConciliacion(filas, c, lect.clavesRepetidas);
    expect(r.cargadasDosVeces).toBe(1);
    // Lo que falta cargar es en pesos y en dólares, para mostrar las dos monedas.
    expect(r.faltanPorMoneda.map((t) => t.moneda)).toEqual(["PES", "DOL"]);
    expect(r.revisar).toBe(3);
  });

  it("el comprobante cargado dos veces coincide con una fila de la planilla", () => {
    const filas = filasDeEjemplo();
    const lect = lectura(registroEjemplo());
    const repetida = lect.clavesRepetidas[0]?.registro as Registro;
    const fila = filas.find((f) => f.datos.cuit === repetida.cuit && f.datos.nroCmp === repetida.nroCmp && f.datos.ptoVta === repetida.ptoVta && f.datos.tipoCmp === repetida.tipoCmp);
    expect(fila).toBeDefined();
  });

  it("el origen es un nombre de archivo ficticio y el caso de prueba va aparte", () => {
    const ejemplos = generarEjemplos(HOY);
    for (const e of ejemplos) {
      expect(e.origen).toMatch(/^ejemplo-\d{2}\.png$/);
      expect(e.caso).not.toBe("");
    }
  });

  it("solo usa CUIT ficticios (los mismos de las facturas de ejemplo)", () => {
    const permitidos = new Set(Object.values(CUIT_FICTICIOS));
    for (const r of lectura(registroEjemplo()).registros) expect(permitidos.has(r.cuit)).toBe(true);
    expect(registroEjemplo()).not.toMatch(/@/);
  });

  it("es determinista", () => {
    expect(registroEjemplo()).toBe(registroEjemplo());
  });
});

// ---------------------------------------------------------------- Importes

describe("interpretarImporte", () => {
  it("con punto y coma a la vez, el último de los dos es el decimal", () => {
    expect(interpretarImporte("1,234.56")).toBe(1234.56);
    expect(interpretarImporte("1.234,56")).toBe(1234.56);
    expect(interpretarImporte("1,234,567.89")).toBe(1234567.89);
    expect(interpretarImporte("1.234.567,89")).toBe(1234567.89);
    expect(interpretarImporte("$ 12,345.60")).toBe(12345.6);
    expect(interpretarImporte("-1,234.50")).toBe(-1234.5);
  });
  it("mantiene los formatos de un solo separador", () => {
    expect(interpretarImporte("1234.56")).toBe(1234.56);
    expect(interpretarImporte("1234,56")).toBe(1234.56);
    expect(interpretarImporte("12,5")).toBe(12.5);
    expect(interpretarImporte("1.234")).toBe(1234);
    expect(interpretarImporte("7")).toBe(7);
  });
  it("devuelve null si no es un importe", () => {
    for (const t of ["", "abc", "1.2.3,4,5", "1,234.5.6", "12a", "--5"]) expect(interpretarImporte(t)).toBeNull();
  });
  it("las líneas del registro con importe en formato mixto se leen bien", () => {
    const r = lectura(`cuit;tipo;pv;nro;importe\n${CUIT_A};1;1;1;"1,234.56"\n${CUIT_A};1;1;2;1.234,56\n`);
    expect(r.registros.map((x) => x.importe)).toEqual([1234.56, 1234.56]);
  });
});

// ---------------------------------------------------------------- Jerarquía del resumen

function resumenDe(parcial: Partial<ReturnType<typeof resumenConciliacion>>): ReturnType<typeof resumenConciliacion> {
  return {
    faltan: 0,
    faltanNotasCredito: 0,
    faltanNotasDebito: 0,
    faltanOtrosTipos: 0,
    faltanPorMoneda: [],
    faltanNotasCreditoPorMoneda: [],
    revisar: 0,
    yaCargadas: 0,
    otroImporte: 0,
    otroEmisor: 0,
    conDiferencias: 0,
    noConciliables: 0,
    noRecibidas: 0,
    cargadasDosVeces: 0,
    cargadasMasDeDosVeces: 0,
    yaCargadasRepetidas: 0,
    duplicadas: 0,
    ...parcial,
  };
}

describe("resumen: atención y línea menor", () => {
  it("requieren atención: en orden, con singular y plural, y sin los que valen cero", () => {
    const r = resumenDe({ revisar: 3, conDiferencias: 2, duplicadas: 1, cargadasDosVeces: 1, noRecibidas: 2, yaCargadas: 9 });
    expect(itemsAtencion(r).map((i) => `${i.cifra} ${i.texto}`)).toEqual([
      "3 para revisar",
      "2 mal cargadas",
      "1 duplicada en la planilla",
      "1 cargada dos veces en el sistema",
      "2 cargadas en el sistema y no recibidas",
    ]);
    expect(itemsAtencion(r).map((i) => i.clave)).toEqual(["revisar", "diferencias", "duplicadas", "dosVeces", "sinComprobante"]);
    expect(itemsAtencion(resumenDe({ duplicadas: 3 })).map((i) => `${i.cifra} ${i.texto}`)).toEqual(["3 duplicadas en la planilla"]);
    expect(itemsAtencion(resumenDe({ noRecibidas: 1 })).map((i) => `${i.cifra} ${i.texto}`)).toEqual(["1 cargada en el sistema y no recibida"]);
    expect(itemsAtencion(resumenDe({ cargadasDosVeces: 2, revisar: 1 })).map((i) => `${i.cifra} ${i.texto}`)).toEqual([
      "1 para revisar",
      "2 cargadas dos veces en el sistema",
    ]);
  });

  it("si todo vale cero, no hay línea de atención", () => {
    expect(itemsAtencion(resumenDe({ yaCargadas: 5, noConciliables: 1 }))).toEqual([]);
  });

  it("línea menor: ya cargadas y no se pueden conciliar", () => {
    expect(lineaMenor(resumenDe({ yaCargadas: 2, noConciliables: 1 }))).toBe("Ya cargadas: 2 · No se pueden conciliar: 1");
    expect(lineaMenor(resumenDe({}))).toBe("Ya cargadas: 0 · No se pueden conciliar: 0");
  });

  it("línea menor: si alguna 'ya cargada' se ve como 'Cargada dos veces', lo aclara (la regla de conteo no cambia)", () => {
    expect(lineaMenor(resumenDe({ yaCargadas: 5, yaCargadasRepetidas: 1, noConciliables: 1 }))).toBe(
      "Ya cargadas: 5 (1 de ellas figura repetida en el sistema y se ve como “Cargada dos veces en el sistema”) · No se pueden conciliar: 1",
    );
    expect(lineaMenor(resumenDe({ yaCargadas: 5, yaCargadasRepetidas: 2 }))).toBe(
      "Ya cargadas: 5 (2 de ellas figuran repetidas en el sistema y se ven como “Cargada dos veces en el sistema”) · No se pueden conciliar: 0",
    );
  });
});

// ---------------------------------------------------------------- Diferencia de importe (C2)

describe("diferenciaImporte", () => {
  it("es la distancia entre lo de la planilla y lo del sistema, al centavo, siempre positiva", () => {
    expect(diferenciaImporte(45200, 45020, 1)).toBe(180);
    expect(diferenciaImporte(45020, 45200, 1)).toBe(180);
    expect(diferenciaImporte(0.3, 0.1, 1)).toBe(0.2); // sin error de coma flotante
    expect(diferenciaImporte(1250, 1250.01, 6)).toBe(0.01);
  });

  it("en las notas de crédito se ignora el signo, como al comparar", () => {
    expect(diferenciaImporte(9350.25, -9350.1, 3)).toBe(0.15);
    expect(diferenciaImporte(-9350.25, 9350.25, 3)).toBe(0);
    // En una factura el signo cuenta: 1000 contra -1000 son 2000 de diferencia.
    expect(diferenciaImporte(1000, -1000, 1)).toBe(2000);
  });

  it("sin importe en la planilla no hay diferencia que mostrar", () => {
    expect(diferenciaImporte(null, 45020, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------- Coherencia entre conteos y sellos (C4)

describe("los conteos del resumen coinciden con los sellos de la planilla", () => {
  it("con el ejemplo completo, cada conteo es la cantidad de filas con ese sello (los duplicados tienen el suyo)", () => {
    const filas = filasDeEjemplo();
    const lect = lectura(registroEjemplo());
    const c = conciliar(filas, lect.registros, HOY);
    const r = resumenConciliacion(filas, c, lect.clavesRepetidas);
    const sellos = (tipo: string): number => [...c.porFila.values()].filter((x) => x.tipo === tipo).length;
    expect(r.yaCargadas).toBe(sellos("ya-cargada"));
    expect(r.faltan).toBe(sellos("falta"));
    expect(r.revisar).toBe(sellos("revisar"));
    expect(r.otroImporte).toBe(sellos("otro-importe"));
    expect(r.otroEmisor).toBe(sellos("otro-emisor"));
    expect(r.noConciliables).toBe(sellos("no-conciliable"));
    expect(r.duplicadas).toBe(sellos("duplicada"));
    expect(r.duplicadas).toBe(1);
    // De las "ya cargadas", una es la factura que el sistema tiene repetida: sigue contando como ya cargada y se ve como "Cargada dos veces".
    expect(r.yaCargadas).toBe(2);
    expect(r.yaCargadasRepetidas).toBe(1);
    expect(r.yaCargadasRepetidas).toBe(filasCargadasDosVeces(filas, c, lect.clavesRepetidas).size);
    // Todas las filas tienen exactamente un sello.
    expect(filas.length).toBe(r.yaCargadas + r.faltan + r.revisar + r.conDiferencias + r.noConciliables + r.duplicadas);
  });
});
