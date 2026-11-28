import { describe, expect, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import type { Desglose } from "../src/control.ts";
import { crearFila, estadoFila, type Fila } from "../src/planilla.ts";
import {
  anuncioFilaAbierta,
  etiquetaControl,
  nombreSeveridad,
  filaVisible,
  observacionesDeFila,
  presentacionResumenControl,
  resumenControl,
  severidadDeFila,
  textoConteoFila,
  textoDetalleResumenControl,
  textoResumenControl,
  tituloObservaciones,
  type ObservacionVista,
} from "../src/vista-control.ts";

const HOY = new Date(2026, 10, 17, 12);

function comprobante(cambios: Partial<Comprobante> = {}): Comprobante {
  return {
    ...comprobanteVacio(),
    ver: 1,
    fecha: "2026-10-05",
    cuit: "30990000014",
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1245,
    importe: 1210,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: 80,
    nroDocRec: "20123456786",
    tipoCodAut: "E",
    codAut: "70000000007919",
    ...cambios,
  };
}

function fila(cambios: Partial<Comprobante> = {}, desglose?: Desglose): Fila {
  return crearFila(1, "factura.pdf", comprobante(cambios), "", "", desglose);
}

const error = (mensaje = "e"): ObservacionVista => ({ severidad: "error", mensaje });
const aviso = (mensaje = "a"): ObservacionVista => ({ severidad: "aviso", mensaje });

describe("observaciones de una fila", () => {
  it("un comprobante coherente no tiene ninguna", () => {
    expect(observacionesDeFila(fila(), HOY)).toEqual([]);
  });

  it("una fila sin QR no se controla, aunque falten datos", () => {
    const sinQr = crearFila(1, "foto.png", null);
    expect(observacionesDeFila(sinQr, HOY)).toEqual([]);
  });

  it("un CUIT con el verificador roto es un error", () => {
    const [o, ...resto] = observacionesDeFila(fila({ cuit: "30990000015" }), HOY);
    expect(resto).toEqual([]);
    expect(o).toEqual({ severidad: "error", mensaje: "El CUIT del emisor tiene el dígito verificador inválido." });
  });

  it("un total en cero, que el control no juzga, se muestra como aviso", () => {
    expect(observacionesDeFila(fila({ importe: 0 }), HOY)).toEqual([{ severidad: "aviso", mensaje: "El total es cero." }]);
  });

  it("los errores van antes que los avisos", () => {
    const o = observacionesDeFila(fila({ importe: 0, fecha: "2026-12-28" }), HOY);
    expect(o.map((x) => x.severidad)).toEqual(["error", "aviso"]);
  });

  it("con desglose que no cierra, dice la diferencia", () => {
    const o = observacionesDeFila(fila({ importe: 1210.05 }, { neto: 1000, iva: 210, otros: 0, vencimientoCae: "" }), HOY);
    expect(o).toHaveLength(1);
    expect(o[0]?.severidad).toBe("error");
    expect(o[0]?.mensaje).toContain("$ 0,05");
  });

  it("no repite un mismo motivo que ya dice el control (CUIT, fecha)", () => {
    const o = observacionesDeFila(fila({ cuit: "", fecha: "" }), HOY);
    expect(o.map((x) => x.mensaje)).toEqual(["Falta el CUIT del emisor.", "Falta la fecha de emisión."]);
  });

  it("hay observaciones exactamente cuando el estado de la fila es Revisar", () => {
    const casos: Array<[Partial<Comprobante>, Desglose?]> = [
      [{}],
      [{ cuit: "" }],
      [{ cuit: "123" }],
      [{ cuit: "30990000015" }],
      [{ importe: null }],
      [{ importe: 0 }],
      [{ importe: -5 }],
      [{ fecha: "" }],
      [{ fecha: "2026-13-45" }],
      [{ fecha: "2026-12-28" }],
      [{ tipoCmp: null }],
      [{ ptoVta: null, nroCmp: null }],
      [{ ver: 2 }],
      [{ codAut: "123" }],
      [{ tipoDocRec: 80, nroDocRec: "20123456787" }],
      [{ tipoCmp: 6, tipoDocRec: 96, nroDocRec: "12345678" }],
      [{ tipoCmp: 1, tipoDocRec: 96, nroDocRec: "12345678" }],
      [{ importe: 1210.05 }, { neto: 1000, iva: 210, otros: 0, vencimientoCae: "" }],
      [{ tipoCmp: 11 }, { neto: 1000, iva: 210, otros: 0, vencimientoCae: "" }],
      [{}, { neto: 1000, iva: 210, otros: 0, vencimientoCae: "2026-10-01" }],
    ];
    for (const [cambios, desglose] of casos) {
      const f = fila(cambios, desglose);
      const hay = observacionesDeFila(f, HOY).length > 0;
      expect(hay, JSON.stringify([cambios, desglose])).toBe(estadoFila(f, HOY).estado === "revisar");
    }
  });
});

describe("etiqueta y conteo de una fila", () => {
  it("sin observaciones no hay etiqueta", () => {
    expect(etiquetaControl([])).toBeNull();
    expect(severidadDeFila([])).toBeNull();
    expect(textoConteoFila([])).toBe("");
  });

  it("con errores manda el error: cuenta solo los errores, con ícono y tono propios", () => {
    expect(etiquetaControl([error(), aviso()])).toEqual({ texto: "1 error", tono: "diferencia", icono: "error" });
    expect(etiquetaControl([error(), error(), aviso()])?.texto).toBe("2 errores");
  });

  it("con solo avisos es ámbar y con otro ícono", () => {
    expect(etiquetaControl([aviso()])).toEqual({ texto: "1 aviso", tono: "revisar", icono: "alerta" });
    expect(etiquetaControl([aviso(), aviso()])?.texto).toBe("2 avisos");
  });

  it("el conteo dice lo que hay, en singular y plural", () => {
    expect(textoConteoFila([error(), aviso(), aviso()])).toBe("1 error y 2 avisos");
    expect(textoConteoFila([error(), error()])).toBe("2 errores");
    expect(textoConteoFila([aviso()])).toBe("1 aviso");
  });

  it("el título del detalle y el anuncio usan el conteo", () => {
    expect(tituloObservaciones([error(), aviso()])).toBe("Observaciones del comprobante: 1 error y 1 aviso");
    expect(anuncioFilaAbierta(8, [error()])).toBe("Fila 8: 1 error. El detalle está antes de los campos.");
    expect(anuncioFilaAbierta(8, [])).toBe("");
  });

  it("la gravedad se escribe con palabras", () => {
    expect(nombreSeveridad("error")).toBe("Error");
    expect(nombreSeveridad("aviso")).toBe("Aviso");
  });
});

describe("resumen sobre la planilla", () => {
  const filas = [
    { controlada: true, observaciones: [error(), aviso()] },
    { controlada: true, observaciones: [aviso()] },
    { controlada: true, observaciones: [] },
    { controlada: false, observaciones: [] },
  ];
  const limpia = { controlada: true, observaciones: [] };
  const sinQr = { controlada: false, observaciones: [] };
  const duplicada = { controlada: true, duplicada: true, observaciones: [] };

  it("cuenta filas, no observaciones, y separa las que tienen errores de las que solo tienen avisos", () => {
    expect(resumenControl(filas)).toEqual({ controladas: 3, conObservaciones: 2, conErrores: 1, soloAvisos: 1, sinControlar: 1, duplicadas: 0, conDesglose: 0 });
  });

  it("cuenta aparte las filas que no se pudieron controlar y las duplicadas", () => {
    expect(resumenControl([limpia, sinQr, sinQr, duplicada])).toMatchObject({ controladas: 2, sinControlar: 2, duplicadas: 1 });
  });

  it("dice «N comprobantes con observaciones», en singular y plural", () => {
    expect(textoResumenControl(resumenControl(filas))).toBe("2 comprobantes con observaciones");
    expect(textoResumenControl(resumenControl([{ controlada: true, observaciones: [aviso()] }]))).toBe("1 comprobante con observaciones");
  });

  it("sin observaciones dice entre cuántos controlados, no afirma de más", () => {
    expect(textoResumenControl(resumenControl([limpia, limpia, limpia]))).toBe("Ningún comprobante con observaciones entre los 3 controlados");
    expect(textoResumenControl(resumenControl([limpia]))).toBe("El comprobante controlado no tiene observaciones");
    expect(textoResumenControl(resumenControl([limpia, limpia, sinQr]))).toBe("Ningún comprobante con observaciones entre los 2 controlados");
  });

  it("sin filas controlables no afirma nada", () => {
    expect(textoResumenControl(resumenControl([sinQr]))).toBe("");
    expect(textoResumenControl(resumenControl([]))).toBe("");
  });

  it("la segunda línea separa errores y avisos, y dice lo que quedó sin controlar", () => {
    expect(textoDetalleResumenControl(resumenControl(filas))).toBe("1 con error · 1 con aviso · 1 sin QR, sin controlar");
    expect(textoDetalleResumenControl(resumenControl([{ controlada: true, observaciones: [error()] }, { controlada: true, observaciones: [error()] }]))).toBe("2 con errores");
    expect(textoDetalleResumenControl(resumenControl([limpia]))).toBe("");
    expect(textoDetalleResumenControl(resumenControl([limpia, sinQr, sinQr]))).toBe("2 sin QR, sin controlar");
    expect(textoDetalleResumenControl(resumenControl([limpia, duplicada]))).toBe("1 duplicada, marcada aparte");
    expect(textoDetalleResumenControl(resumenControl([limpia, duplicada, duplicada]))).toBe("2 duplicadas, marcadas aparte");
  });

  it("el tilde verde solo aparece si no hay observaciones y no queda nada sin controlar ni duplicado", () => {
    expect(presentacionResumenControl(resumenControl([limpia, limpia]))).toEqual({ tono: "ok", icono: "check" });
    expect(presentacionResumenControl(resumenControl([limpia, sinQr]))).toEqual({ tono: "neutro", icono: "punto" });
    expect(presentacionResumenControl(resumenControl([limpia, duplicada]))).toEqual({ tono: "neutro", icono: "punto" });
  });

  it("con observaciones manda la gravedad, aunque haya filas sin controlar", () => {
    expect(presentacionResumenControl(resumenControl([{ controlada: true, observaciones: [error()] }, sinQr]))).toEqual({ tono: "diferencia", icono: "error" });
    expect(presentacionResumenControl(resumenControl([{ controlada: true, observaciones: [aviso()] }]))).toEqual({ tono: "revisar", icono: "alerta" });
  });
});

describe("qué filas se ven: el filtro de conciliación y «Ver solo estos» se combinan", () => {
  const conAviso = [aviso()];

  it("sin ningún filtro se ve todo", () => {
    expect(filaVisible({ filtro: "todas", resultado: undefined, duplicada: false, soloConObservaciones: false, observaciones: [] })).toBe(true);
  });

  it("«Ver solo estos» deja las que tienen observaciones y saca las limpias", () => {
    const base = { filtro: "todas", resultado: undefined, duplicada: false, soloConObservaciones: true } as const;
    expect(filaVisible({ ...base, observaciones: conAviso })).toBe(true);
    expect(filaVisible({ ...base, observaciones: [] })).toBe(false);
  });

  it("con un filtro de conciliación hay que cumplir los dos", () => {
    const base = { filtro: "faltan", soloConObservaciones: true } as const;
    expect(filaVisible({ ...base, resultado: { tipo: "falta" }, duplicada: false, observaciones: conAviso })).toBe(true);
    expect(filaVisible({ ...base, resultado: { tipo: "falta" }, duplicada: false, observaciones: [] })).toBe(false);
    expect(filaVisible({ ...base, resultado: { tipo: "ya-cargada" }, duplicada: false, observaciones: conAviso })).toBe(false);
    expect(filaVisible({ ...base, resultado: { tipo: "falta" }, duplicada: true, observaciones: conAviso })).toBe(false);
  });

  it("el filtro de conciliación solo, sin «Ver solo estos», no mira las observaciones", () => {
    const base = { filtro: "faltan", soloConObservaciones: false } as const;
    expect(filaVisible({ ...base, resultado: { tipo: "falta" }, duplicada: false, observaciones: [] })).toBe(true);
  });
});
