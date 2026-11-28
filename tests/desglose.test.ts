// Desglose de una fila: el que trae el registro y el que se escribe a mano en el detalle de la fila.

import { describe, expect, expectTypeOf, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import type { Registro } from "../src/conciliacion.ts";
import type { Desglose } from "../src/control.ts";
import {
  CAMPOS_DESGLOSE,
  conDesgloseDelRegistro,
  editarDesglose,
  hayDesglose,
  interpretarCeldaDesglose,
  origenDesglose,
  textoDeDesglose,
  textoOrigenDesglose,
} from "../src/desglose.ts";
import { crearFila, estadoFila, type Fila } from "../src/planilla.ts";
import { observacionesDeFila } from "../src/vista-control.ts";

const HOY = new Date(2026, 10, 17, 12);
const CUIT = "30990000014";

function comprobante(cambios: Partial<Comprobante> = {}): Comprobante {
  return {
    ...comprobanteVacio(),
    ver: 1,
    fecha: "2026-10-05",
    cuit: CUIT,
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1245,
    importe: 1210,
    moneda: "PES",
    ctz: 1,
    tipoCodAut: "E",
    codAut: "70000000007919",
    ...cambios,
  };
}

function fila(id: number, cambios: Partial<Comprobante> = {}, desglose?: Desglose): Fila {
  return crearFila(id, `factura-${id}.pdf`, comprobante(cambios), "", "", desglose);
}

function registro(cambios: Partial<Registro> = {}): Registro {
  return { cuit: CUIT, tipoCmp: 1, ptoVta: 3, nroCmp: 1245, importe: 1210, linea: 2, ...cambios };
}

const CUADRA: Desglose = { neto: 1000, iva: 210, otros: 0, vencimientoCae: "2026-10-15" };
const NO_CUADRA: Desglose = { neto: 1000, iva: 200, otros: 0, vencimientoCae: "" };

describe("hayDesglose", () => {
  it("es falso sin desglose o con todo vacío, y verdadero con cualquier dato", () => {
    expect(hayDesglose(undefined)).toBe(false);
    expect(hayDesglose({ neto: null, iva: null, otros: null, vencimientoCae: "" })).toBe(false);
    expect(hayDesglose({ neto: null, iva: 0, otros: null, vencimientoCae: "" })).toBe(true);
    expect(hayDesglose({ neto: null, iva: null, otros: null, vencimientoCae: "2026-10-15" })).toBe(true);
  });
});

describe("conDesgloseDelRegistro", () => {
  it("la fila toma el desglose del registro que tiene su misma clave", () => {
    const [f] = conDesgloseDelRegistro([fila(1)], [registro({ desglose: NO_CUADRA })]);
    expect(f?.desglose).toEqual(NO_CUADRA);
  });

  it("no toca las filas cuya clave no está en el registro ni las que el registro trae sin desglose", () => {
    const filas = [fila(1), fila(2, { nroCmp: 9999 })];
    const r = conDesgloseDelRegistro(filas, [registro({ desglose: NO_CUADRA }), registro({ nroCmp: 5 })]);
    expect(r[0]?.desglose).toEqual(NO_CUADRA);
    expect(r[1]).not.toHaveProperty("desglose");
  });

  it("lo escrito a mano manda sobre el registro", () => {
    const [f] = conDesgloseDelRegistro([fila(1, {}, CUADRA)], [registro({ desglose: NO_CUADRA })]);
    expect(f?.desglose).toEqual(CUADRA);
  });

  it("no modifica las filas que recibe y conserva su orden y sus ids", () => {
    const filas = [fila(1), fila(2, { nroCmp: 7 })];
    const r = conDesgloseDelRegistro(filas, [registro({ desglose: NO_CUADRA })]);
    expect(filas[0]).not.toHaveProperty("desglose");
    expect(r.map((x) => x.id)).toEqual([1, 2]);
    expect(r[0]?.datos).toBe(filas[0]?.datos);
  });

  it("sin registro devuelve las mismas filas", () => {
    const filas = [fila(1)];
    expect(conDesgloseDelRegistro(filas, [])).toEqual(filas);
  });

  it("no inventa nada para una fila sin QR", () => {
    const sinQr = crearFila(1, "foto.png", null);
    expect(conDesgloseDelRegistro([sinQr], [registro({ desglose: NO_CUADRA })])[0]).not.toHaveProperty("desglose");
  });

  it("con el desglose del registro el control marca que el total no cierra", () => {
    const [f] = conDesgloseDelRegistro([fila(1)], [registro({ desglose: NO_CUADRA })]);
    const obs = observacionesDeFila(f as Fila, HOY);
    expect(obs.map((o) => o.severidad)).toEqual(["error"]);
    expect(obs[0]?.mensaje).toContain("$ 10,00");
    expect(estadoFila(f as Fila, HOY).estado).toBe("revisar");
  });
});

describe("origenDesglose", () => {
  it("manual si la fila lo trae, aunque el registro también", () => {
    expect(origenDesglose(fila(1, {}, CUADRA), [registro({ desglose: NO_CUADRA })])).toEqual({ tipo: "manual" });
  });
  it("registro con su línea cuando viene de ahí", () => {
    expect(origenDesglose(fila(1), [registro({ desglose: NO_CUADRA, linea: 7 })])).toEqual({ tipo: "registro", linea: 7 });
  });
  it("ninguno si no hay de ningún lado, o si el de la fila está vacío", () => {
    expect(origenDesglose(fila(1), [registro()])).toEqual({ tipo: "ninguno" });
    expect(origenDesglose(fila(1, {}, { neto: null, iva: null, otros: null, vencimientoCae: "" }), [])).toEqual({ tipo: "ninguno" });
  });
  it("los textos dicen de dónde viene y qué hacer", () => {
    expect(textoOrigenDesglose({ tipo: "manual" })).toBe("Desglose escrito a mano. Vacíe los cuatro campos para volver al del registro.");
    expect(textoOrigenDesglose({ tipo: "registro", linea: 7 })).toBe("Desglose tomado del registro (línea 7). Si escribe algo acá, vale lo escrito.");
    expect(textoOrigenDesglose({ tipo: "ninguno" })).toContain("Sin desglose");
    expect(textoOrigenDesglose({ tipo: "ninguno" })).toContain("vencimiento del CAE");
  });
});

describe("interpretarCeldaDesglose", () => {
  it("el tipo del valor depende del campo: un importe nunca es un texto ni la fecha un número", () => {
    expectTypeOf(interpretarCeldaDesglose("neto", "1")).toEqualTypeOf<{ valor: number | null } | Error>();
    expectTypeOf(interpretarCeldaDesglose("vencimientoCae", "")).toEqualTypeOf<{ valor: string } | Error>();
  });
  it("importes: formato argentino, vacío es no informado", () => {
    expect(interpretarCeldaDesglose("neto", "1.234,56")).toEqual({ valor: 1234.56 });
    expect(interpretarCeldaDesglose("iva", "  210 ")).toEqual({ valor: 210 });
    expect(interpretarCeldaDesglose("otros", "")).toEqual({ valor: null });
    expect(interpretarCeldaDesglose("otros", "0")).toEqual({ valor: 0 });
  });
  it("un importe que no es número, o con más de dos decimales, es un error que dice cuál campo", () => {
    const e = interpretarCeldaDesglose("neto", "abc");
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toContain("neto");
    expect(interpretarCeldaDesglose("iva", "1,234")).toBeInstanceOf(Error);
    expect(interpretarCeldaDesglose("otros", "=1+1")).toBeInstanceOf(Error);
  });
  it("vencimiento: tres formatos, guardado como AAAA-MM-DD", () => {
    expect(interpretarCeldaDesglose("vencimientoCae", "15/10/2026")).toEqual({ valor: "2026-10-15" });
    expect(interpretarCeldaDesglose("vencimientoCae", "2026-10-15")).toEqual({ valor: "2026-10-15" });
    expect(interpretarCeldaDesglose("vencimientoCae", "20261015")).toEqual({ valor: "2026-10-15" });
    expect(interpretarCeldaDesglose("vencimientoCae", "")).toEqual({ valor: "" });
  });
  it("una fecha imposible es un error con el formato esperado", () => {
    const e = interpretarCeldaDesglose("vencimientoCae", "31/02/2026");
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe("El vencimiento del CAE debe ser una fecha válida, con formato DD/MM/AAAA.");
  });
});

describe("textoDeDesglose", () => {
  it("escribe cada campo como se lo escribiría a mano", () => {
    expect(textoDeDesglose(CUADRA, "neto")).toBe("1.000,00");
    expect(textoDeDesglose(CUADRA, "iva")).toBe("210,00");
    expect(textoDeDesglose(CUADRA, "otros")).toBe("0,00");
    expect(textoDeDesglose(CUADRA, "vencimientoCae")).toBe("15/10/2026");
  });
  it("sin dato, vacío", () => {
    expect(textoDeDesglose(undefined, "neto")).toBe("");
    expect(textoDeDesglose({ neto: null, iva: null, otros: null, vencimientoCae: "" }, "vencimientoCae")).toBe("");
  });
  it("lo escrito se vuelve a leer igual (ida y vuelta)", () => {
    for (const campo of ["neto", "iva", "otros", "vencimientoCae"] as const) {
      const r = interpretarCeldaDesglose(campo, textoDeDesglose(CUADRA, campo));
      expect(r).toEqual({ valor: CUADRA[campo] });
    }
  });
  it("hay un campo por cada dato del desglose, con su etiqueta", () => {
    expect(CAMPOS_DESGLOSE.map((c) => c.campo)).toEqual(["neto", "iva", "otros", "vencimientoCae"]);
    for (const c of CAMPOS_DESGLOSE) expect(c.etiqueta).not.toBe("");
  });
});

describe("editarDesglose", () => {
  it("escribe un dato y crea el desglose de la fila", () => {
    const r = editarDesglose([fila(1)], 1, "neto", "1.000,00");
    if (r instanceof Error) throw r;
    expect(r[0]?.desglose).toEqual({ neto: 1000, iva: null, otros: null, vencimientoCae: "" });
  });

  it("parte del desglose que traía el registro, para no perder lo que no se toca", () => {
    const r = editarDesglose([fila(1)], 1, "iva", "205", NO_CUADRA);
    if (r instanceof Error) throw r;
    expect(r[0]?.desglose).toEqual({ ...NO_CUADRA, iva: 205 });
    const r2 = editarDesglose([fila(1)], 1, "iva", "210", NO_CUADRA);
    if (r2 instanceof Error) throw r2;
    expect(r2[0]?.desglose).toEqual({ ...NO_CUADRA, iva: 210 });
  });

  it("no cambia nada (ni congela el del registro) si el valor escrito es el que ya había", () => {
    const filas = [fila(1)];
    const r = editarDesglose(filas, 1, "iva", "200,00", NO_CUADRA);
    if (r instanceof Error) throw r;
    expect(r[0]).not.toHaveProperty("desglose");
  });

  it("un valor inválido es un Error y la lista no cambia", () => {
    const filas = [fila(1, {}, CUADRA)];
    const r = editarDesglose(filas, 1, "neto", "mucho");
    expect(r).toBeInstanceOf(Error);
    expect(filas[0]?.desglose).toEqual(CUADRA);
  });

  it("vaciar los cuatro campos quita el desglose de la fila (vuelve el del registro)", () => {
    let filas: Fila[] = [fila(1, {}, { neto: 1000, iva: null, otros: null, vencimientoCae: "" })];
    const r = editarDesglose(filas, 1, "neto", "");
    if (r instanceof Error) throw r;
    filas = r;
    expect(filas[0]).not.toHaveProperty("desglose");
  });

  it("no modifica la lista original y deja las otras filas como estaban", () => {
    const filas = [fila(1), fila(2, { nroCmp: 2 })];
    const r = editarDesglose(filas, 1, "neto", "5");
    if (r instanceof Error) throw r;
    expect(filas[0]).not.toHaveProperty("desglose");
    expect(r[1]).toBe(filas[1]);
  });

  it("una fila que ya no existe es un Error", () => {
    expect(editarDesglose([fila(1)], 9, "neto", "5")).toBeInstanceOf(Error);
  });

  it("lo escrito a mano alcanza para que el control marque la factura C con IVA y el CAE vencido", () => {
    let filas: Fila[] = [fila(1, { tipoCmp: 11 })];
    for (const [campo, texto] of [["iva", "210"], ["vencimientoCae", "01/10/2026"]] as const) {
      const r = editarDesglose(filas, 1, campo, texto);
      if (r instanceof Error) throw r;
      filas = r;
    }
    const mensajes = observacionesDeFila(filas[0] as Fila, HOY).map((o) => o.mensaje);
    expect(mensajes.some((m) => m.includes("factura C"))).toBe(true);
    expect(mensajes.some((m) => m.includes("antes de la emisión"))).toBe(true);
  });
});
