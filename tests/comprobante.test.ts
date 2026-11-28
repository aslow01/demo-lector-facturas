import { describe, expect, it } from "vitest";
import {
  claveDuplicado,
  comprobanteVacio,
  estadoDe,
  fechaArgentinaIso,
  formatearFecha,
  formatearImporte,
  formatearNumeroCmp,
  motivosDeLectura,
  motivosRevisar,
  nombreTipo,
  normalizarFecha,
  parsearImporteTexto,
  type Comprobante,
} from "../src/comprobante.ts";

const HOY = new Date("2026-11-17T15:00:00Z"); // 12:00 del 17/11/2026 en Argentina (UTC-3), el mismo instante en cualquier huso

function valido(cambios: Partial<Comprobante> = {}): Comprobante {
  return {
    ver: 1,
    fecha: "2026-10-05",
    cuit: "30990000014",
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

describe("nombreTipo", () => {
  it("nombra los tipos conocidos", () => {
    expect(nombreTipo(1)).toBe("Factura A");
    expect(nombreTipo(2)).toBe("Nota de débito A");
    expect(nombreTipo(3)).toBe("Nota de crédito A");
    expect(nombreTipo(6)).toBe("Factura B");
    expect(nombreTipo(7)).toBe("Nota de débito B");
    expect(nombreTipo(8)).toBe("Nota de crédito B");
    expect(nombreTipo(11)).toBe("Factura C");
    expect(nombreTipo(12)).toBe("Nota de débito C");
    expect(nombreTipo(13)).toBe("Nota de crédito C");
    expect(nombreTipo(51)).toBe("Factura M");
  });
  it("muestra 'Tipo N' para el resto y vacío si no hay dato", () => {
    expect(nombreTipo(201)).toBe("Tipo 201");
    expect(nombreTipo(null)).toBe("");
  });
});

describe("claveDuplicado", () => {
  it("combina CUIT emisor, tipo, punto de venta y número", () => {
    expect(claveDuplicado(valido())).toBe("30990000014|1|3|1245");
  });
  it("es igual para el mismo comprobante y distinta si cambia cualquiera de los cuatro datos", () => {
    const base = claveDuplicado(valido());
    expect(claveDuplicado(valido({ importe: 5, fecha: "2026-01-01", codAut: "1" }))).toBe(base);
    expect(claveDuplicado(valido({ cuit: "33990002016" }))).not.toBe(base);
    expect(claveDuplicado(valido({ tipoCmp: 6 }))).not.toBe(base);
    expect(claveDuplicado(valido({ ptoVta: 4 }))).not.toBe(base);
    expect(claveDuplicado(valido({ nroCmp: 1246 }))).not.toBe(base);
  });
  it("es null si falta algún dato (nunca se marca duplicada)", () => {
    expect(claveDuplicado(valido({ nroCmp: null }))).toBeNull();
    expect(claveDuplicado(valido({ cuit: "" }))).toBeNull();
    expect(claveDuplicado(valido({ cuit: "123" }))).toBeNull();
    expect(claveDuplicado(valido({ tipoCmp: null }))).toBeNull();
    expect(claveDuplicado(valido({ ptoVta: null }))).toBeNull();
  });
});

describe("estadoDe", () => {
  it("es 'leida' si no hay nada dudoso", () => {
    expect(estadoDe(valido(), HOY)).toEqual({ estado: "leida", motivos: [] });
  });
  it("es 'sin-qr' si no hay comprobante", () => {
    expect(estadoDe(null, HOY).estado).toBe("sin-qr");
  });
  it("marca 'revisar' un CUIT con dígito verificador inválido", () => {
    const r = estadoDe(valido({ cuit: "30990000015" }), HOY);
    expect(r.estado).toBe("revisar");
    expect(r.motivos.join(" ")).toContain("verificador");
  });
  it("marca 'revisar' un CUIT vacío o de largo incorrecto", () => {
    expect(estadoDe(valido({ cuit: "" }), HOY).estado).toBe("revisar");
    expect(estadoDe(valido({ cuit: "123" }), HOY).estado).toBe("revisar");
  });
  it("marca 'revisar' un total en cero, negativo o ausente", () => {
    expect(estadoDe(valido({ importe: 0 }), HOY).motivos.join(" ")).toContain("cero");
    expect(estadoDe(valido({ importe: -5 }), HOY).estado).toBe("revisar");
    expect(estadoDe(valido({ importe: null }), HOY).estado).toBe("revisar");
  });
  it("marca 'revisar' una fecha futura, pero no la de hoy", () => {
    expect(estadoDe(valido({ fecha: "2026-11-18" }), HOY).motivos.join(" ")).toContain("futura");
    expect(estadoDe(valido({ fecha: "2026-11-17" }), HOY).estado).toBe("leida");
  });
  it("marca 'revisar' una fecha inválida o vacía", () => {
    expect(estadoDe(valido({ fecha: "2026-02-30" }), HOY).estado).toBe("revisar");
    expect(estadoDe(valido({ fecha: "" }), HOY).estado).toBe("revisar");
  });
  it("marca 'revisar' si falta el tipo, el punto de venta o el número", () => {
    expect(estadoDe(valido({ tipoCmp: null }), HOY).estado).toBe("revisar");
    expect(estadoDe(valido({ ptoVta: null }), HOY).estado).toBe("revisar");
    expect(estadoDe(valido({ nroCmp: null }), HOY).estado).toBe("revisar");
  });
  it("marca 'revisar' una versión de QR desconocida", () => {
    expect(estadoDe(valido({ ver: 2 }), HOY).estado).toBe("revisar");
  });
  it("junta todos los motivos", () => {
    expect(motivosRevisar(valido({ cuit: "1", importe: 0, fecha: "2099-01-01" }), HOY)).toHaveLength(3);
  });
  it("un comprobante vacío sale con varios motivos", () => {
    expect(motivosRevisar(comprobanteVacio(), HOY).length).toBeGreaterThan(3);
  });
});

describe("el día de hoy es el de Argentina", () => {
  // 22:30 del 17/11 en Buenos Aires = 01:30 UTC del 18/11 (en Tokio o en Madrid ya es 18/11). Instante fijo: no depende del huso de la máquina.
  const NOCHE_EN_ARGENTINA = new Date("2026-11-18T01:30:00Z");

  it("fechaArgentinaIso da el día de Buenos Aires, no el del navegador", () => {
    expect(fechaArgentinaIso(NOCHE_EN_ARGENTINA)).toBe("2026-11-17");
    expect(fechaArgentinaIso(new Date("2026-11-17T02:59:59Z"))).toBe("2026-11-16");
    expect(fechaArgentinaIso(new Date("2026-11-17T03:00:00Z"))).toBe("2026-11-17");
  });
  it("una factura emitida hoy en Argentina no es futura, esté donde esté quien la mira", () => {
    expect(motivosRevisar(valido({ fecha: "2026-11-17" }), NOCHE_EN_ARGENTINA)).toEqual([]);
    expect(estadoDe(valido({ fecha: "2026-11-17" }), NOCHE_EN_ARGENTINA).estado).toBe("leida");
  });
  it("la del día siguiente a hoy en Argentina sí es futura", () => {
    expect(motivosRevisar(valido({ fecha: "2026-11-18" }), NOCHE_EN_ARGENTINA)).toEqual(["La fecha de emisión es futura."]);
  });
});

describe("motivosDeLectura: cada motivo trae su código", () => {
  it("los motivos de siempre, con código y las mismas palabras que el control del comprobante", () => {
    const c = valido({ cuit: "", fecha: "", importe: 0, tipoCmp: null, ver: 2 });
    expect(motivosDeLectura(c, HOY)).toEqual([
      { codigo: "cuit-emisor", mensaje: "Falta el CUIT del emisor." },
      { codigo: "total", mensaje: "El total es cero." },
      { codigo: "fecha", mensaje: "Falta la fecha de emisión." },
      { codigo: "datos-faltantes", mensaje: "Falta o no es válido: tipo de comprobante." },
      { codigo: "version-qr", mensaje: "Versión de QR desconocida (2)." },
    ]);
  });
  it("la fecha inválida y la futura", () => {
    expect(motivosDeLectura(valido({ fecha: "31/02/2026" }), HOY).map((m) => [m.codigo, m.mensaje])).toEqual([["fecha", "La fecha de emisión no es válida."]]);
    expect(motivosDeLectura(valido({ fecha: "2026-12-01" }), HOY).map((m) => [m.codigo, m.mensaje])).toEqual([["fecha-futura", "La fecha de emisión es futura."]]);
  });
  it("motivosRevisar es lo mismo, solo con las frases", () => {
    const c = valido({ cuit: "1", importe: -5 });
    expect(motivosRevisar(c, HOY)).toEqual(motivosDeLectura(c, HOY).map((m) => m.mensaje));
  });
});

describe("normalizarFecha y formatearFecha", () => {
  it("acepta AAAA-MM-DD y DD/MM/AAAA", () => {
    expect(normalizarFecha("2026-10-05")).toBe("2026-10-05");
    expect(normalizarFecha("5/10/2026")).toBe("2026-10-05");
    expect(normalizarFecha("05-10-2026")).toBe("2026-10-05");
  });
  it("rechaza fechas que no existen", () => {
    expect(normalizarFecha("2026-02-30")).toBeNull();
    expect(normalizarFecha("31/04/2026")).toBeNull();
    expect(normalizarFecha("hola")).toBeNull();
    expect(normalizarFecha("")).toBeNull();
  });
  it("reconoce el 29 de febrero solo en años bisiestos", () => {
    expect(normalizarFecha("2028-02-29")).toBe("2028-02-29");
    expect(normalizarFecha("2027-02-29")).toBeNull();
  });
  it("muestra DD/MM/AAAA y deja intacto lo que no es fecha", () => {
    expect(formatearFecha("2026-10-05")).toBe("05/10/2026");
    expect(formatearFecha("2026-13-45")).toBe("2026-13-45");
  });
});

describe("importes", () => {
  it("formatea con puntos de miles y coma decimal", () => {
    expect(formatearImporte(1234.5)).toBe("1.234,50");
    expect(formatearImporte(118470.5)).toBe("118.470,50");
    expect(formatearImporte(0)).toBe("0,00");
    expect(formatearImporte(-9350.25)).toBe("-9.350,25");
    expect(formatearImporte(1234567.891)).toBe("1.234.567,89");
    expect(formatearImporte(null)).toBe("");
  });
  it("interpreta lo escrito a mano en formato argentino", () => {
    expect(parsearImporteTexto("1.234,56")).toBe(1234.56);
    expect(parsearImporteTexto("1234,5")).toBe(1234.5);
    expect(parsearImporteTexto("1.234")).toBe(1234);
    expect(parsearImporteTexto("12.5")).toBe(12.5);
    expect(parsearImporteTexto("1.234.567,00")).toBe(1234567);
    expect(parsearImporteTexto(" 100 ")).toBe(100);
  });
  it("rechaza lo que no es un número", () => {
    expect(parsearImporteTexto("")).toBeNull();
    expect(parsearImporteTexto("abc")).toBeNull();
    expect(parsearImporteTexto("1,2,3")).toBeNull();
    expect(parsearImporteTexto("=1+1")).toBeNull();
  });
});

describe("formatearNumeroCmp", () => {
  it("rellena con ceros como en la factura", () => {
    expect(formatearNumeroCmp(3, 1245)).toBe("0003-00001245");
    expect(formatearNumeroCmp(null, null)).toBe("");
    expect(formatearNumeroCmp(1, null)).toBe("0001-?");
  });
});
