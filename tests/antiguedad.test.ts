// Antigüedad de lo que falta cargar (aprobada el 17/11/2026). Solo días corridos desde la emisión: nada fiscal.

import { describe, expect, it } from "vitest";
import {
  FECHA_REFERENCIA_EJEMPLO,
  UMBRAL_ANTIGUEDAD_POR_DEFECTO,
  diasDeFila,
  diasEntre,
  esAntigua,
  interpretarUmbral,
  ordenarPorAntiguedad,
  resolverReferencia,
  textoAntiguedad,
  textoReferencia,
  validarFechaReferencia,
  validarUmbral,
} from "../src/antiguedad.ts";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import { conciliar, type Resultado } from "../src/conciliacion.ts";
import { generarEjemplos } from "../src/ejemplos.ts";
import { agregarFila, crearFila, siguienteId, type Fila } from "../src/planilla.ts";
import { leerUrlQr } from "../src/qr-arca.ts";
import { detalleFila, detalleFilaPartes, etiquetaAntigua, textoMarcadas } from "../src/vista.ts";

const CUIT = "30990000014";

function dato(cambios: Partial<Comprobante>): Comprobante {
  return { ...comprobanteVacio(), ver: 1, cuit: CUIT, ptoVta: 1, tipoCmp: 1, nroCmp: 1, importe: 100, moneda: "PES", fecha: "2026-10-01", ...cambios };
}

function planilla(...datos: Array<Partial<Comprobante>>): Fila[] {
  let filas: Fila[] = [];
  for (const d of datos) filas = agregarFila(filas, crearFila(siguienteId(filas), `a-${filas.length + 1}.pdf`, dato(d)));
  return filas;
}

describe("diasEntre", () => {
  it("cuenta días corridos entre la emisión y la referencia", () => {
    expect(diasEntre("2026-10-12", "2026-11-12")).toBe(31);
    expect(diasEntre("2026-11-12", "2026-11-12")).toBe(0);
    expect(diasEntre("2026-11-11", "2026-11-12")).toBe(1);
  });
  it("no se confunde con el horario de verano ni con los años bisiestos", () => {
    expect(diasEntre("2024-02-28", "2024-03-01")).toBe(2);
    expect(diasEntre("2025-12-31", "2026-01-01")).toBe(1);
    expect(diasEntre("2026-01-01", "2027-01-01")).toBe(365);
  });
  it("da negativo si la emisión es posterior a la referencia", () => {
    expect(diasEntre("2026-11-20", "2026-11-12")).toBe(-8);
  });
  it("null si alguna fecha no es válida", () => {
    expect(diasEntre("", "2026-11-12")).toBeNull();
    expect(diasEntre("2026-13-45", "2026-11-12")).toBeNull();
    expect(diasEntre("2026-10-12", "ayer")).toBeNull();
  });
});

describe("textos y umbral", () => {
  it("la frase pedida, con singular y hoy", () => {
    expect(textoAntiguedad(45)).toBe("Emitida hace 45 días; todavía no está cargada");
    expect(textoAntiguedad(1)).toBe("Emitida hace 1 día; todavía no está cargada");
    expect(textoAntiguedad(0)).toBe("Emitida hoy; todavía no está cargada");
  });
  it("'hoy' solo si la referencia es hoy: con otra fecha de referencia dice 'el día de la fecha de referencia' (QA B1 de la etapa 3)", () => {
    expect(textoAntiguedad(0, "hoy")).toBe("Emitida hoy; todavía no está cargada");
    expect(textoAntiguedad(0, "manual")).toBe("Emitida el día de la fecha de referencia; todavía no está cargada");
    expect(textoAntiguedad(0, "ejemplo")).toBe("Emitida el día de la fecha de referencia; todavía no está cargada");
    expect(textoAntiguedad(5, "manual")).toBe("Emitida hace 5 días; todavía no está cargada");
  });
  it("detalleFila pasa el origen de la referencia", () => {
    const filas = planilla({ fecha: "2026-10-06" });
    expect(detalleFila({ tipo: "falta" }, filas[0] as Fila, [], 0, "manual")).toBe("Emitida el día de la fecha de referencia; todavía no está cargada");
    expect(detalleFila({ tipo: "falta" }, filas[0] as Fila, [], 0)).toBe("Emitida hoy; todavía no está cargada");
  });
  it("una emisión posterior a la referencia se dice tal cual, sin días negativos", () => {
    expect(textoAntiguedad(-3)).toBe("La fecha de emisión es posterior a la fecha de referencia");
  });
  it("marca desde el umbral (30 por defecto), inclusive", () => {
    expect(UMBRAL_ANTIGUEDAD_POR_DEFECTO).toBe(30);
    expect(esAntigua(29, 30)).toBe(false);
    expect(esAntigua(30, 30)).toBe(true);
    expect(esAntigua(null, 30)).toBe(false);
    expect(esAntigua(-5, 30)).toBe(false);
  });
  it("interpreta el umbral escrito: entero de 1 a 3650", () => {
    expect(interpretarUmbral("15")).toBe(15);
    expect(interpretarUmbral(" 45 ")).toBe(45);
    for (const t of ["", "0", "-3", "1.5", "abc", "3651", "1e3"]) expect(interpretarUmbral(t)).toBeNull();
  });
});

describe("fecha de referencia", () => {
  const hoy = new Date("2026-11-17T15:00:00Z"); // mediodía en Argentina
  it("en el ejemplo completo es fija, para que no cambie con el paso del tiempo", () => {
    const r = resolverReferencia({ manual: "", soloEjemplo: true, hoy });
    expect(r).toEqual({ fecha: FECHA_REFERENCIA_EJEMPLO, origen: "ejemplo" });
    expect(resolverReferencia({ manual: "", soloEjemplo: true, hoy: new Date(2030, 0, 1, 12) }).fecha).toBe(FECHA_REFERENCIA_EJEMPLO);
  });
  it("hoy es el día de Argentina, sin importar el huso de la computadora (22:30 del 12/11 allá es el 13/11 en UTC)", () => {
    const tardeEnArgentina = new Date("2026-11-13T01:30:00Z");
    expect(resolverReferencia({ manual: "", soloEjemplo: false, hoy: tardeEnArgentina })).toEqual({ fecha: "2026-11-12", origen: "hoy" });
  });
  it("con archivos propios es hoy (el día de Argentina)", () => {
    expect(resolverReferencia({ manual: "", soloEjemplo: false, hoy })).toEqual({ fecha: "2026-11-17", origen: "hoy" });
  });
  it("una fecha elegida por el usuario manda sobre las otras; una inválida se ignora", () => {
    expect(resolverReferencia({ manual: "2026-11-30", soloEjemplo: true, hoy })).toEqual({ fecha: "2026-11-30", origen: "manual" });
    expect(resolverReferencia({ manual: "ayer", soloEjemplo: false, hoy }).origen).toBe("hoy");
  });
  it("el texto dice de dónde sale la fecha", () => {
    expect(textoReferencia({ fecha: "2026-11-12", origen: "ejemplo" })).toBe("Fecha de referencia: 12/11/2026 (fija en el ejemplo).");
    expect(textoReferencia({ fecha: "2026-11-17", origen: "hoy" })).toBe("Fecha de referencia: 17/11/2026 (hoy).");
    expect(textoReferencia({ fecha: "2026-11-30", origen: "manual" })).toBe("Fecha de referencia: 30/11/2026 (elegida por usted).");
  });
});

describe("antigüedad de cada fila que falta cargar", () => {
  const referencia = "2026-11-12";
  it("solo se calcula para 'Falta cargar'", () => {
    const filas = planilla({ nroCmp: 1, fecha: "2026-10-01" }, { nroCmp: 2, fecha: "2026-10-01" });
    const c = conciliar(filas, [{ cuit: CUIT, tipoCmp: 1, ptoVta: 1, nroCmp: 2, importe: 100, linea: 2 }]);
    expect(diasDeFila(filas[0] as Fila, c.porFila.get(1), referencia)).toBe(42);
    expect(diasDeFila(filas[1] as Fila, c.porFila.get(2), referencia)).toBeNull(); // ya cargada
    expect(diasDeFila(filas[0] as Fila, undefined, referencia)).toBeNull(); // sin registro
  });
  it("sin fecha válida no se inventa nada", () => {
    const filas = planilla({ fecha: "" });
    expect(diasDeFila(filas[0] as Fila, { tipo: "falta" }, referencia)).toBeNull();
  });
  it("el detalle de la fila lleva la frase y la etiqueta marca desde el umbral", () => {
    const filas = planilla({ fecha: "2026-10-01" });
    const falta: Resultado = { tipo: "falta" };
    expect(detalleFila(falta, filas[0] as Fila, [], 42)).toBe("Emitida hace 42 días; todavía no está cargada");
    expect(detalleFilaPartes(falta, filas[0] as Fila, [], 42)).toEqual([{ tipo: "texto", texto: "Emitida hace 42 días; todavía no está cargada" }]);
    expect(detalleFila(falta, filas[0] as Fila, [])).toBe("");
    expect(detalleFila(falta, filas[0] as Fila, [], null)).toBe("");
    expect(etiquetaAntigua(42, 30)).toEqual({ texto: "30 días o más", tono: "revisar", icono: "reloj" });
    expect(etiquetaAntigua(29, 30)).toBeNull();
    expect(etiquetaAntigua(null, 30)).toBeNull();
  });
});

describe("orden por antigüedad", () => {
  it("lo que falta cargar va primero, de la más antigua a la más nueva; el resto sigue en su orden", () => {
    const filas = planilla(
      { nroCmp: 1, fecha: "2026-11-01" }, // falta, 11 días
      { nroCmp: 2, fecha: "2026-10-01" }, // ya cargada
      { nroCmp: 3, fecha: "2026-09-20" }, // falta, 53 días
      { nroCmp: 4, fecha: "" }, // sin fecha: queda "revisar", no "falta"
      { nroCmp: 5, fecha: "2026-10-20" }, // falta, 23 días
    );
    const c = conciliar(filas, [{ cuit: CUIT, tipoCmp: 1, ptoVta: 1, nroCmp: 2, importe: 100, linea: 2 }]);
    const orden = ordenarPorAntiguedad(filas, c.porFila, "2026-11-12").map((f) => f.datos.nroCmp);
    expect(orden).toEqual([3, 5, 1, 2, 4]);
  });
  it("misma antigüedad: se respeta el orden de la planilla", () => {
    const filas = planilla({ nroCmp: 1, fecha: "2026-10-01" }, { nroCmp: 2, fecha: "2026-10-01" });
    const c = conciliar(filas, []);
    expect(ordenarPorAntiguedad(filas, c.porFila, "2026-11-12").map((f) => f.datos.nroCmp)).toEqual([1, 2]);
  });
  it("no modifica la lista que recibe", () => {
    const filas = planilla({ nroCmp: 1, fecha: "2026-11-01" }, { nroCmp: 2, fecha: "2026-10-01" });
    const c = conciliar(filas, []);
    ordenarPorAntiguedad(filas, c.porFila, "2026-11-12");
    expect(filas.map((f) => f.datos.nroCmp)).toEqual([1, 2]);
  });
});

describe("en el ejemplo completo, con la referencia fija", () => {
  it("hay una factura de 31 días (marcada) y otra de 28 (sin marcar)", () => {
    const filas = generarEjemplos(new Date(2026, 10, 17, 12)).map((e, i) => {
      const c = e.url === null ? null : leerUrlQr(e.url);
      return crearFila(i + 1, e.origen, c !== null && !(c instanceof Error) ? c : null);
    });
    // Las dos facturas que "faltan cargar" en el ejemplo son la 1251 (dólares) y la 77.
    const dias = filas
      .filter((f) => f.conQr && f.datos.nroCmp !== null && [1251, 77].includes(f.datos.nroCmp))
      .map((f) => diasEntre(f.datos.fecha, FECHA_REFERENCIA_EJEMPLO));
    expect(dias.sort()).toEqual([28, 31]);
    expect(esAntigua(31, UMBRAL_ANTIGUEDAD_POR_DEFECTO)).toBe(true);
    expect(esAntigua(28, UMBRAL_ANTIGUEDAD_POR_DEFECTO)).toBe(false);
  });
});

// ---------------------------------------------------------------- Valores inválidos: se avisa, no se ignora en silencio
// (accesibilidad S1, QA medio 3 y bajo 1)

describe("validarUmbral", () => {
  it("un entero de 1 a 3650 es válido", () => {
    expect(validarUmbral("15", 30)).toEqual({ ok: true, valor: 15 });
    expect(validarUmbral(" 3650 ", 30)).toEqual({ ok: true, valor: 3650 });
  });
  it("lo inválido da un mensaje claro que dice qué se sigue usando", () => {
    for (const t of ["", "0", "3651", "-5", "5.5", "abc", "1e3", "09999"]) {
      expect(validarUmbral(t, 30), `"${t}"`).toEqual({
        ok: false,
        mensaje: "Escriba un número entero de días entre 1 y 3650. Se sigue usando 30.",
      });
    }
  });
  it("el mensaje nombra el valor vigente, no siempre 30", () => {
    const r = validarUmbral("0", 45);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain("Se sigue usando 45.");
  });
});

describe("validarFechaReferencia", () => {
  it("una fecha dentro del rango es válida", () => {
    expect(validarFechaReferencia("2026-11-30", "2026-11-12")).toEqual({ ok: true, manual: "2026-11-30" });
    expect(validarFechaReferencia("2000-01-01", "2026-11-12")).toEqual({ ok: true, manual: "2000-01-01" });
    expect(validarFechaReferencia("2100-12-31", "2026-11-12")).toEqual({ ok: true, manual: "2100-12-31" });
  });
  it("vacía es válida: vuelve a la fecha por defecto (la nota de la referencia dice cuál es)", () => {
    expect(validarFechaReferencia("", "2026-11-12")).toEqual({ ok: true, manual: "" });
  });
  it("una fecha imposible o fuera de 2000 a 2100 da un mensaje que dice qué se sigue usando", () => {
    for (const t of ["1999-12-31", "2101-01-01", "9999-12-31", "0001-01-01", "275760-09-13", "2026-02-31", "ayer"]) {
      expect(validarFechaReferencia(t, "2026-11-12"), t).toEqual({
        ok: false,
        mensaje: "Escriba una fecha válida entre el 01/01/2000 y el 31/12/2100. Se sigue usando 12/11/2026.",
      });
    }
  });
});

describe("resolverReferencia con fechas fuera de rango", () => {
  const hoy = new Date("2026-11-17T15:00:00Z"); // mediodía en Argentina
  it("una fecha manual fuera de 2000 a 2100 no se usa", () => {
    expect(resolverReferencia({ manual: "9999-12-31", soloEjemplo: false, hoy }).origen).toBe("hoy");
    expect(resolverReferencia({ manual: "1999-12-31", soloEjemplo: true, hoy }).origen).toBe("ejemplo");
    expect(resolverReferencia({ manual: "2100-12-31", soloEjemplo: false, hoy })).toEqual({ fecha: "2100-12-31", origen: "manual" });
  });
});

describe("textos de la antigüedad (QA B2)", () => {
  it("la marca con umbral 1 dice '1 día', no '1 días'", () => {
    expect(etiquetaAntigua(5, 1)?.texto).toBe("1 día o más");
    expect(etiquetaAntigua(50, 30)?.texto).toBe("30 días o más");
  });
  it("los días llevan separador de miles, como los importes", () => {
    expect(textoAntiguedad(13469)).toBe("Emitida hace 13.469 días; todavía no está cargada");
    expect(textoAntiguedad(999)).toBe("Emitida hace 999 días; todavía no está cargada");
    expect(textoMarcadas(1500, 1000)).toBe("1.500 comprobantes por cargar tienen 1.000 días o más.");
  });
});
