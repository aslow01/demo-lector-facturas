// Conciliación de pagos contra facturas (cuentas a pagar). Todo ficticio: CUIT con verificador válido, números inventados.
// Sin reglas fiscales: el cruce es por CUIT, importe y referencia; lo dudoso queda para la persona.

import { describe, expect, it } from "vitest";
import { comprobanteVacio } from "../src/comprobante.ts";
import {
  MAX_FACTURAS_EN_SUMA,
  TOLERANCIA_CENTAVOS_POR_DEFECTO,
  conciliarPagos,
  extraerReferencias,
  facturasDeFilas,
  type ConciliacionPagos,
  type FacturaAPagar,
} from "../src/cuentas-a-pagar.ts";
import { CUIT_FICTICIOS } from "../src/ejemplos.ts";
import type { Pago } from "../src/extracto.ts";
import { crearFila } from "../src/planilla.ts";

const { valle: VALLE, transportes: TRANSPORTES, ferreteria: FERRETERIA } = CUIT_FICTICIOS;
const HOY = "2026-11-12";

let siguienteId = 1;
function factura(nroCmp: number, importe: number, extra: Partial<FacturaAPagar> = {}): FacturaAPagar {
  return { id: siguienteId++, cuit: VALLE, tipoCmp: 1, ptoVta: 3, nroCmp, fecha: "2026-10-05", importe, ...extra };
}

let siguienteLinea = 2;
function pago(importe: number, extra: Partial<Pago> = {}): Pago {
  return {
    linea: siguienteLinea++,
    fecha: "2026-10-30",
    importe,
    cuit: VALLE,
    referencia: "",
    concepto: "",
    cargo: "ana.demo",
    autorizo: "bruno.demo",
    operacion: "",
    ...extra,
  };
}

function conciliar(facturas: FacturaAPagar[], pagos: Pago[], opciones = {}): ConciliacionPagos {
  return conciliarPagos(facturas, pagos, { hoy: HOY, ...opciones });
}

function deFactura(c: ConciliacionPagos, f: FacturaAPagar) {
  const s = c.facturas.find((x) => x.factura.id === f.id);
  if (s === undefined) throw new Error("factura no encontrada");
  return s;
}

function dePago(c: ConciliacionPagos, p: Pago) {
  const r = c.pagos.find((x) => x.pago.linea === p.linea);
  if (r === undefined) throw new Error("pago no encontrado");
  return r;
}

describe("extraerReferencias", () => {
  it("encuentra punto de venta y número en el texto libre, con o sin ceros", () => {
    expect(extraerReferencias("FA 0003-00001245")).toEqual([{ ptoVta: 3, nroCmp: 1245, texto: "0003-00001245" }]);
    expect(extraerReferencias("pago fact 3-1245 y 3-1246 oct")).toEqual([
      { ptoVta: 3, nroCmp: 1245, texto: "3-1245" },
      { ptoVta: 3, nroCmp: 1246, texto: "3-1246" },
    ]);
  });

  it("no confunde una fecha ni un CUIT con una referencia", () => {
    expect(extraerReferencias("transferencia 2026-10-05 a 30-99000001-4")).toEqual([]);
    expect(extraerReferencias("Varios")).toEqual([]);
    expect(extraerReferencias("")).toEqual([]);
  });

  it("no repite la misma referencia", () => {
    expect(extraerReferencias("0003-00001245 / 3-1245")).toHaveLength(1);
  });
});

describe("pagos que nombran la factura (referencia)", () => {
  it("referencia, CUIT e importe: pagada, y dice por qué", () => {
    const f = factura(1245, 118470.5);
    const p = pago(118470.5, { referencia: "FA 0003-00001245" });
    const c = conciliar([f], [p]);
    const r = dePago(c, p);
    expect(r.estado).toBe("emparejado");
    expect(r.regla).toBe("referencia");
    expect(r.imputaciones).toEqual([{ facturaId: f.id, importe: 118470.5 }]);
    expect(r.porQue).toContain("0003-00001245");
    expect(r.porQue).toMatch(/coincide/);
    expect(deFactura(c, f)).toMatchObject({ estado: "pagada", pagado: 118470.5, saldo: 0, pagos: [p.linea] });
    expect(c.emparejamientos).toEqual([{ pagoLinea: p.linea, facturaId: f.id, importe: 118470.5, regla: "referencia", porQue: r.porQue }]);
  });

  it("sin CUIT en el pago, la referencia sola alcanza si nombra una sola factura", () => {
    const f = factura(1245, 5000);
    const p = pago(5000, { cuit: "", referencia: "0003-00001245" });
    const r = dePago(conciliar([f], [p]), p);
    expect(r).toMatchObject({ estado: "emparejado", regla: "referencia" });
    expect(r.porQue).toMatch(/solo con la referencia/i);
  });

  it("sin CUIT y con la referencia en facturas de dos proveedores: no se decide, queda para revisar", () => {
    const f1 = factura(7, 5000);
    const f2 = factura(7, 5000, { cuit: TRANSPORTES });
    const p = pago(5000, { cuit: "", referencia: "0003-00000007" });
    const c = conciliar([f1, f2], [p]);
    const r = dePago(c, p);
    expect(r.estado).toBe("revisar");
    expect(r.candidatas.sort()).toEqual([f1.id, f2.id].sort());
    expect(r.imputaciones).toEqual([]);
    expect(deFactura(c, f1)).toMatchObject({ estado: "impaga", enRevision: [p.linea] });
  });

  it("una referencia a dos facturas cuyo saldo suma el pago paga las dos", () => {
    const f1 = factura(1270, 100000);
    const f2 = factura(1275, 24200.03);
    const p = pago(124200.03, { referencia: "0003-00001270 y 0003-00001275" });
    const c = conciliar([f1, f2], [p]);
    const r = dePago(c, p);
    expect(r).toMatchObject({ estado: "emparejado", regla: "referencia" });
    expect(r.imputaciones).toEqual([
      { facturaId: f1.id, importe: 100000 },
      { facturaId: f2.id, importe: 24200.03 },
    ]);
    expect(r.porQue).toMatch(/2 facturas/);
    expect(c.emparejamientos).toHaveLength(2);
    expect(c.resumen.pagadas).toBe(2);
  });

  it("un pago menor que la factura la deja parcial con su saldo; el siguiente la completa", () => {
    const f = factura(2101, 61750);
    const p1 = pago(30000, { fecha: "2026-10-28", referencia: "0003-00002101 cuota 1" });
    const c1 = conciliar([f], [p1]);
    expect(dePago(c1, p1).porQue).toMatch(/parte/i);
    expect(deFactura(c1, f)).toMatchObject({ estado: "parcial", pagado: 30000, saldo: 31750 });
    expect(c1.parciales.map((s) => s.factura.id)).toEqual([f.id]);
    expect(c1.impagas).toEqual([]);

    const p2 = pago(31750, { fecha: "2026-11-05", referencia: "0003-00002101 cuota 2" });
    const c2 = conciliar([f], [p1, p2]);
    expect(deFactura(c2, f)).toMatchObject({ estado: "pagada", saldo: 0, pagos: [p1.linea, p2.linea] });
    expect(dePago(c2, p2).porQue).toMatch(/salda|completa/i);
  });

  it("un pago mayor que el saldo imputa el saldo y deja lo que sobra a la vista", () => {
    const f = factura(1, 1000);
    const p = pago(1200, { referencia: "0003-00000001" });
    const c = conciliar([f], [p]);
    const r = dePago(c, p);
    expect(r.estado).toBe("emparejado");
    expect(r.imputaciones).toEqual([{ facturaId: f.id, importe: 1000 }]);
    expect(r.sinImputar).toBe(200);
    expect(r.porQue).toMatch(/sobran/i);
    expect(deFactura(c, f).estado).toBe("pagada");
  });

  it("un pago que nombra una factura ya pagada no se imputa: queda para revisar", () => {
    const f = factura(1, 1000);
    const p1 = pago(1000, { fecha: "2026-10-20", referencia: "0003-00000001" });
    const p2 = pago(1000, { fecha: "2026-10-25", referencia: "0003-00000001" });
    const c = conciliar([f], [p1, p2]);
    const r = dePago(c, p2);
    expect(r.estado).toBe("revisar");
    expect(r.imputaciones).toEqual([]);
    expect(r.sinImputar).toBe(1000);
    expect(r.porQue).toMatch(/ya está pagada/);
    expect(deFactura(c, f)).toMatchObject({ estado: "pagada", pagado: 1000 });
  });

  it("una referencia que no corresponde a ninguna factura del CUIT se avisa, y el pago sigue por CUIT e importe", () => {
    const f = factura(77, 6120);
    const p = pago(6120, { referencia: "0003-00000070" }); // un dígito cambiado
    const r = dePago(conciliar([f], [p]), p);
    expect(r).toMatchObject({ estado: "emparejado", regla: "importe-exacto" });
    expect(r.porQue).toContain("0003-00000070");
    expect(r.porQue).toMatch(/no (corresponde|figura)/);
  });

  it("una referencia a una factura de otro CUIT no se usa", () => {
    const ajena = factura(5, 999, { cuit: TRANSPORTES });
    const propia = factura(9, 4000);
    const p = pago(4000, { referencia: "0003-00000005" });
    const c = conciliar([ajena, propia], [p]);
    expect(dePago(c, p)).toMatchObject({ estado: "emparejado", regla: "importe-exacto", imputaciones: [{ facturaId: propia.id, importe: 4000 }] });
    expect(deFactura(c, ajena).estado).toBe("impaga");
  });
});

describe("tolerancia de centavos", () => {
  it("el valor por defecto es de dos centavos", () => {
    expect(TOLERANCIA_CENTAVOS_POR_DEFECTO).toBe(2);
  });

  it("una diferencia de dos centavos se perdona y se dice", () => {
    const f = factura(1, 1000);
    const p = pago(999.98);
    const c = conciliar([f], [p]);
    const r = dePago(c, p);
    expect(r).toMatchObject({ estado: "emparejado", regla: "importe-exacto" });
    expect(r.porQue).toMatch(/2 centavos/);
    expect(deFactura(c, f)).toMatchObject({ estado: "pagada", saldo: 0.02 });
  });

  it("con tres centavos de diferencia ya no coincide: es un pago parcial", () => {
    const f = factura(1, 1000);
    const p = pago(999.97);
    const c = conciliar([f], [p]);
    expect(dePago(c, p).regla).toBe("pago-parcial");
    expect(deFactura(c, f).estado).toBe("parcial");
  });

  it("la tolerancia se puede cambiar", () => {
    const f = factura(1, 1000);
    const p = pago(999.97);
    const c = conciliar([f], [p], { toleranciaCentavos: 5 });
    expect(dePago(c, p).regla).toBe("importe-exacto");
    expect(deFactura(c, f).estado).toBe("pagada");
  });

  it("un pago de más por dos centavos también se perdona", () => {
    const f = factura(1, 1000);
    const p = pago(1000.02, { referencia: "0003-00000001" });
    const r = dePago(conciliar([f], [p]), p);
    expect(r.sinImputar).toBe(0);
    expect(r.porQue).toMatch(/2 centavos/);
  });
});

describe("CUIT más importe", () => {
  it("un pago sin referencia que coincide con una sola factura del CUIT la paga", () => {
    const f = factura(876, 45200, { cuit: TRANSPORTES });
    const otra = factura(902, 30875.4, { cuit: TRANSPORTES });
    const p = pago(45200, { cuit: TRANSPORTES, concepto: "Varios" });
    const c = conciliar([f, otra], [p]);
    const r = dePago(c, p);
    expect(r).toMatchObject({ estado: "emparejado", regla: "importe-exacto", imputaciones: [{ facturaId: f.id, importe: 45200 }] });
    expect(r.porQue).toMatch(/CUIT/);
    expect(deFactura(c, otra).estado).toBe("impaga");
  });

  it("con dos facturas del mismo importe no se elige: queda para revisar con las dos candidatas", () => {
    const f1 = factura(1, 5000);
    const f2 = factura(2, 5000);
    const p = pago(5000);
    const c = conciliar([f1, f2], [p]);
    const r = dePago(c, p);
    expect(r.estado).toBe("revisar");
    expect(r.candidatas).toEqual([f1.id, f2.id]);
    expect(r.porQue).toMatch(/2 facturas/);
    expect(deFactura(c, f1)).toMatchObject({ estado: "impaga", enRevision: [p.linea] });
    expect(c.paraRevisar).toHaveLength(1);
  });

  it("dos pagos que compiten por la misma factura quedan los dos para revisar", () => {
    const f = factura(1, 5000);
    const p1 = pago(5000, { fecha: "2026-10-20" });
    const p2 = pago(5000, { fecha: "2026-10-25" });
    const c = conciliar([f], [p1, p2]);
    expect(dePago(c, p1).estado).toBe("revisar");
    expect(dePago(c, p2).estado).toBe("revisar");
    expect(dePago(c, p1).porQue).toMatch(/otro pago/i);
    expect(deFactura(c, f).estado).toBe("impaga");
  });

  it("el resultado no depende del orden de las líneas del extracto", () => {
    const fs = [factura(1, 5000), factura(2, 7000), factura(3, 12000), factura(4, 300, { cuit: TRANSPORTES })];
    const ps = [
      pago(7000),
      pago(12000, { referencia: "0003-00000003" }),
      pago(5000, { fecha: "2026-10-20" }),
      pago(5000, { fecha: "2026-10-22" }),
      pago(19000),
      pago(300, { cuit: TRANSPORTES }),
    ];
    const resumirPagos = (c: ConciliacionPagos) => c.pagos.map((r) => `${r.pago.linea}:${r.estado}:${r.regla}`).sort();
    const base = resumirPagos(conciliar(fs, ps));
    expect(resumirPagos(conciliar(fs, [...ps].reverse()))).toEqual(base);
    expect(resumirPagos(conciliar([...fs].reverse(), ps))).toEqual(base);
  });
});

describe("varias facturas que suman el pago", () => {
  it("sin referencia, una única combinación de dos facturas del CUIT que suma el pago las paga", () => {
    const f1 = factura(1, 9350.25, { cuit: FERRETERIA });
    const f2 = factura(2, 15000.01, { cuit: FERRETERIA });
    const f3 = factura(3, 22800, { cuit: FERRETERIA });
    const p = pago(24350.26, { cuit: FERRETERIA });
    const c = conciliar([f1, f2, f3], [p]);
    const r = dePago(c, p);
    expect(r).toMatchObject({ estado: "emparejado", regla: "suma-de-facturas" });
    expect(r.imputaciones.map((i) => i.facturaId)).toEqual([f1.id, f2.id]);
    expect(r.porQue).toMatch(/suma/);
    expect(deFactura(c, f3).estado).toBe("impaga");
  });

  it("con dos combinaciones posibles no se decide", () => {
    const fs = [factura(1, 1000), factura(2, 2000), factura(3, 3000), factura(4, 500), factura(5, 2500)];
    const p = pago(3500); // 1000+2500 y 500+3000
    const r = dePago(conciliar(fs, [p]), p);
    expect(r.estado).toBe("revisar");
    expect(r.porQue).toMatch(/combinaciones/);
    expect(r.imputaciones).toEqual([]);
  });

  it("con demasiadas facturas abiertas no prueba combinaciones y lo dice", () => {
    const fs = Array.from({ length: MAX_FACTURAS_EN_SUMA + 1 }, (_, i) => factura(i + 1, 1000 + i * 10));
    const p = pago(2010); // 1000 + 1010 podría ser, pero no se busca
    const r = dePago(conciliar(fs, [p]), p);
    expect(r.estado).toBe("revisar");
    expect(r.imputaciones).toEqual([]);
  });
});

describe("pago parcial sin referencia", () => {
  it("si el CUIT tiene una sola factura abierta y el pago es menor, es un pago parcial", () => {
    const f = factura(1, 36300);
    const p = pago(20000);
    const c = conciliar([f], [p]);
    const r = dePago(c, p);
    expect(r).toMatchObject({ estado: "emparejado", regla: "pago-parcial" });
    expect(r.porQue).toMatch(/única factura abierta/);
    expect(deFactura(c, f)).toMatchObject({ estado: "parcial", pagado: 20000, saldo: 16300 });
  });

  it("con varias facturas abiertas y un importe que no coincide, no sabe a cuál: revisar", () => {
    const f1 = factura(1, 30875.4, { cuit: TRANSPORTES });
    const f2 = factura(2, 21780, { cuit: TRANSPORTES });
    const p = pago(25000, { cuit: TRANSPORTES });
    const c = conciliar([f1, f2], [p]);
    const r = dePago(c, p);
    expect(r.estado).toBe("revisar");
    expect(r.candidatas).toEqual([f1.id, f2.id]);
    expect(r.porQue).toMatch(/no se puede saber a cuál/i);
    expect(c.impagas).toHaveLength(2);
    expect(deFactura(c, f1).enRevision).toEqual([p.linea]);
  });

  it("si el pago es mayor que la única factura abierta, no se imputa", () => {
    const f = factura(1, 1000);
    const p = pago(1500);
    const r = dePago(conciliar([f], [p]), p);
    expect(r.estado).toBe("revisar");
    expect(r.imputaciones).toEqual([]);
    expect(r.porQue).toMatch(/supera/);
  });
});

describe("pagos sin factura", () => {
  it("un CUIT sin ninguna factura", () => {
    const f = factura(1, 1000);
    const p = pago(18000, { cuit: FERRETERIA });
    const c = conciliar([f], [p]);
    expect(dePago(c, p)).toMatchObject({ estado: "sin-factura", regla: null, imputaciones: [] });
    expect(dePago(c, p).porQue).toMatch(/ninguna factura/);
    expect(c.sinFactura.map((r) => r.pago.linea)).toEqual([p.linea]);
    expect(c.resumen.importeSinFactura).toBe(18000);
  });

  it("un CUIT cuyas facturas ya están todas pagadas", () => {
    const f = factura(1, 1000);
    const p1 = pago(1000, { fecha: "2026-10-20" });
    const p2 = pago(700, { fecha: "2026-10-25" });
    const r = dePago(conciliar([f], [p1, p2]), p2);
    expect(r.estado).toBe("sin-factura");
    expect(r.porQue).toMatch(/ya está pagada/);
  });

  it("sin CUIT ni una referencia que corresponda a una factura", () => {
    const f = factura(1, 1000);
    const p = pago(1000, { cuit: "", referencia: "0009-00000999" });
    const r = dePago(conciliar([f], [p]), p);
    expect(r.estado).toBe("sin-factura");
    expect(r.porQue).toMatch(/CUIT/);
  });

  it("un CUIT que no sirvió lo dice y avisa en el control", () => {
    const p = pago(1000, { cuit: "", cuitIlegible: "30-99000001-9" });
    const c = conciliar([factura(1, 1000)], [p]);
    expect(dePago(c, p).porQue).toContain("30-99000001-9");
    expect(dePago(c, p).avisos.map((a) => a.codigo)).toEqual(["cuit-invalido"]);
  });
});

describe("pagos duplicados", () => {
  it("el mismo número de operación es el mismo pago: el segundo no resta saldo dos veces", () => {
    const f = factura(1, 1000);
    const p1 = pago(1000, { operacion: "10000001", referencia: "0003-00000001" });
    const p2 = pago(1000, { operacion: "10000001", referencia: "0003-00000001" });
    const c = conciliar([f], [p1, p2]);
    expect(dePago(c, p1).estado).toBe("emparejado");
    const r = dePago(c, p2);
    expect(r).toMatchObject({ estado: "duplicado", duplicadoDe: p1.linea, imputaciones: [] });
    expect(r.porQue).toMatch(/operación/);
    expect(deFactura(c, f)).toMatchObject({ estado: "pagada", pagado: 1000, pagos: [p1.linea] });
    expect(c.duplicados).toHaveLength(1);
  });

  it("sin número de operación, la misma fecha, CUIT, importe y referencia también es un duplicado", () => {
    const f = factura(1, 1000);
    const p1 = pago(1000, { referencia: "0003-00000001" });
    const p2 = pago(1000, { referencia: "0003-00000001" });
    const c = conciliar([f], [p1, p2]);
    expect(dePago(c, p2)).toMatchObject({ estado: "duplicado", duplicadoDe: p1.linea });
    expect(dePago(c, p2).porQue).toMatch(/misma fecha/);
  });

  it("con números de operación distintos son dos pagos, aunque lo demás sea igual", () => {
    const p1 = pago(1000, { operacion: "10000001" });
    const p2 = pago(1000, { operacion: "10000002" });
    const c = conciliar([factura(1, 1000)], [p1, p2]);
    expect(dePago(c, p1).estado).not.toBe("duplicado");
    expect(dePago(c, p2).estado).not.toBe("duplicado");
  });

  it("otra fecha u otro importe no son duplicados", () => {
    const p1 = pago(1000);
    const p2 = pago(1000, { fecha: "2026-10-31" });
    const p3 = pago(1001);
    const c = conciliar([], [p1, p2, p3]);
    expect(c.duplicados).toEqual([]);
  });

  it("el duplicado se señala en el segundo aunque aparezca primero en el archivo con otra fecha de carga", () => {
    const original = pago(1000, { operacion: "7" });
    const copia = pago(1000, { operacion: "7" });
    const c = conciliar([], [copia, original]);
    // el original es el de la línea más baja
    expect(dePago(c, original).estado).not.toBe("duplicado");
    expect(dePago(c, copia).estado).toBe("duplicado");
  });
});

describe("control interno", () => {
  it("avisa cuando el mismo usuario cargó y autorizó, sin importar mayúsculas, tildes ni espacios", () => {
    const p = pago(1000, { cargo: "Ana.Demo", autorizo: " ana.demo " });
    const c = conciliar([], [p]);
    const r = dePago(c, p);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ codigo: "mismo-usuario" });
    expect(r.avisos[0]?.mensaje).toContain("Ana.Demo");
    expect(c.avisos).toEqual([{ linea: p.linea, ...r.avisos[0] }]);
    expect(c.resumen.conAvisoDeControl).toBe(1);
  });

  it("no avisa con usuarios distintos ni cuando falta alguno de los dos", () => {
    const c = conciliar([], [pago(1, { cargo: "ana.demo", autorizo: "bruno.demo" }), pago(2, { cargo: "ana.demo", autorizo: "" }), pago(3, { cargo: "", autorizo: "" })]);
    expect(c.avisos).toEqual([]);
  });

  it("el aviso no cambia el cruce: un pago puede estar bien emparejado y mal autorizado", () => {
    const f = factura(1, 1000);
    const p = pago(1000, { cargo: "ana.demo", autorizo: "ana.demo" });
    const r = dePago(conciliar([f], [p]), p);
    expect(r.estado).toBe("emparejado");
    expect(r.avisos).toHaveLength(1);
  });

  it("también controla los duplicados y los pagos sin factura", () => {
    const p = pago(1000, { cuit: FERRETERIA, cargo: "carla.demo", autorizo: "carla.demo" });
    const c = conciliar([], [p]);
    expect(dePago(c, p).estado).toBe("sin-factura");
    expect(c.avisos).toHaveLength(1);
  });
});

describe("facturas impagas y antigüedad", () => {
  it("lista las impagas de la más antigua a la más nueva, con los días corridos desde la emisión", () => {
    const nueva = factura(1, 100, { fecha: "2026-11-10" });
    const vieja = factura(2, 200, { fecha: "2026-10-09" });
    const media = factura(3, 300, { fecha: "2026-10-25" });
    const c = conciliar([nueva, vieja, media], []);
    expect(c.impagas.map((s) => [s.factura.id, s.dias])).toEqual([
      [vieja.id, 34],
      [media.id, 18],
      [nueva.id, 2],
    ]);
  });

  it("marca como antigua desde el umbral, inclusive, y el umbral se puede cambiar", () => {
    const f = factura(1, 100, { fecha: "2026-10-13" }); // 30 días
    expect(deFactura(conciliar([f], []), f).antigua).toBe(true);
    expect(deFactura(conciliar([f], [], { umbralAntiguedad: 31 }), f).antigua).toBe(false);
  });

  it("una factura parcial también envejece; una pagada no se marca", () => {
    const parcial = factura(1, 1000, { fecha: "2026-09-01" });
    const paga = factura(2, 500, { fecha: "2026-09-01" });
    const c = conciliar([parcial, paga], [pago(400, { referencia: "0003-00000001" }), pago(500, { referencia: "0003-00000002" })]);
    expect(deFactura(c, parcial)).toMatchObject({ estado: "parcial", antigua: true });
    expect(deFactura(c, paga)).toMatchObject({ estado: "pagada", antigua: false });
  });

  it("sin pagos, todas las facturas están impagas y el resumen lo cuenta", () => {
    const c = conciliar([factura(1, 100), factura(2, 250.5)], []);
    expect(c.resumen).toMatchObject({ facturas: 2, impagas: 2, pagadas: 0, parciales: 0, importeFacturado: 350.5, importePagado: 0, saldoPendiente: 350.5 });
  });

  it("con una fecha de referencia anterior a la emisión no inventa antigüedad", () => {
    const f = factura(1, 100, { fecha: "2026-12-01" });
    const s = deFactura(conciliar([f], []), f);
    expect(s.dias).toBe(-19);
    expect(s.antigua).toBe(false);
  });
});

describe("resumen", () => {
  it("cuenta cada cosa una vez y los importes cierran", () => {
    const f1 = factura(1, 1000);
    const f2 = factura(2, 2000, { cuit: TRANSPORTES });
    const f3 = factura(3, 3000, { cuit: FERRETERIA });
    const ps = [
      pago(1000, { referencia: "0003-00000001", operacion: "1" }),
      pago(1000, { referencia: "0003-00000001", operacion: "1" }), // duplicado
      pago(800, { cuit: TRANSPORTES }), // parcial (única abierta)
      pago(500, { cuit: "30000000019" }), // sin factura
    ];
    const c = conciliar([f1, f2, f3], ps);
    expect(c.resumen).toMatchObject({
      facturas: 3,
      pagadas: 1,
      parciales: 1,
      impagas: 1,
      pagos: 4,
      emparejados: 2,
      duplicados: 1,
      sinFactura: 1,
      paraRevisar: 0,
      importeFacturado: 6000,
      importePagado: 1800,
      saldoPendiente: 4200,
      importeSinFactura: 500,
    });
  });
});

describe("no modifica lo que recibe", () => {
  it("acepta listas congeladas y devuelve lo mismo dos veces", () => {
    const fs = Object.freeze([Object.freeze(factura(1, 1000)), Object.freeze(factura(2, 500))]);
    const ps = Object.freeze([Object.freeze(pago(1000)), Object.freeze(pago(200))]);
    const a = conciliarPagos(fs, ps, { hoy: HOY });
    const b = conciliarPagos(fs, ps, { hoy: HOY });
    expect(b).toEqual(a);
  });
});

describe("facturasDeFilas", () => {
  const base = { ...comprobanteVacio(), fecha: "2026-10-05", cuit: VALLE, tipoCmp: 1, ptoVta: 3, nroCmp: 1245, importe: 1000, moneda: "PES" };

  it("toma las facturas de la planilla y deja afuera, con su motivo, lo que no se puede pagar ni cruzar", () => {
    const filas = [
      crearFila(1, "a.png", base),
      crearFila(2, "b.png", base), // duplicada de la 1
      crearFila(3, "c.png", { ...base, nroCmp: 2, tipoCmp: 3 }), // nota de crédito
      crearFila(4, "d.png", { ...base, nroCmp: 3, moneda: "DOL" }),
      crearFila(5, "e.png", { ...base, nroCmp: 4, importe: 0 }),
      crearFila(6, "f.png", null), // sin QR
      crearFila(7, "g.png", { ...base, nroCmp: 5, importe: null }),
      crearFila(8, "h.png", { ...base, nroCmp: 6, importe: 250.5 }),
    ];
    const { facturas, omitidas } = facturasDeFilas(filas);
    expect(facturas).toEqual([
      { id: 1, cuit: VALLE, tipoCmp: 1, ptoVta: 3, nroCmp: 1245, fecha: "2026-10-05", importe: 1000, origen: "a.png" },
      { id: 8, cuit: VALLE, tipoCmp: 1, ptoVta: 3, nroCmp: 6, fecha: "2026-10-05", importe: 250.5, origen: "h.png" },
    ]);
    expect(omitidas.map((o) => o.id)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(omitidas[0]?.motivo).toMatch(/duplicada/i);
    expect(omitidas[1]?.motivo).toMatch(/nota de crédito/i);
    expect(omitidas[2]?.motivo).toMatch(/pesos/i);
  });
});

describe("entradas grandes", () => {
  it("20.000 pagos contra 12 facturas abiertas del mismo CUIT terminan enseguida", () => {
    const fs = Array.from({ length: MAX_FACTURAS_EN_SUMA }, (_, i) => factura(i + 1, 5_000_000 + i * 137));
    const ps = Array.from({ length: 20_000 }, (_, i) => pago(50.01 + i, { fecha: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` }));
    const inicio = Date.now();
    const c = conciliar(fs, ps);
    expect(Date.now() - inicio).toBeLessThan(5000);
    expect(c.pagos).toHaveLength(20_000);
    expect(c.paraRevisar).toHaveLength(20_000);
  });
});

// ---------------------------------------------------------------- Revisión del conciliador (28/11/2026)

describe("revisión: números de operación repetidos", () => {
  it("la misma operación con otro importe no es el mismo pago: se cruza y lleva un aviso", () => {
    const f1 = factura(1, 100);
    const f2 = factura(2, 250);
    const p1 = pago(100, { operacion: "1", fecha: "2026-10-20" });
    const p2 = pago(250, { operacion: "1", fecha: "2026-10-21" });
    const c = conciliar([f1, f2], [p1, p2]);
    expect(dePago(c, p2).estado).toBe("emparejado");
    expect(dePago(c, p2).sinImputar).toBe(0);
    expect(c.duplicados).toEqual([]);
    expect(deFactura(c, f2).estado).toBe("pagada");
    const aviso = dePago(c, p2).avisos.find((a) => a.codigo === "operacion-repetida");
    expect(aviso?.mensaje).toContain("línea " + p1.linea);
    expect(c.avisos.some((a) => a.codigo === "operacion-repetida" && a.linea === p2.linea)).toBe(true);
  });

  it("la misma operación con otro CUIT tampoco es un duplicado", () => {
    const p1 = pago(500, { operacion: "9", cuit: VALLE });
    const p2 = pago(500, { operacion: "9", cuit: TRANSPORTES });
    const c = conciliar([], [p1, p2]);
    expect(c.duplicados).toEqual([]);
    expect(dePago(c, p2).avisos.map((a) => a.codigo)).toContain("operacion-repetida");
  });

  it("la misma operación con mismo CUIT e importe sigue siendo un duplicado", () => {
    const p1 = pago(500, { operacion: "9" });
    const p2 = pago(500, { operacion: "9", fecha: "2026-11-02" });
    expect(conciliar([], [p1, p2]).duplicados.map((r) => r.pago.linea)).toEqual([p2.linea]);
  });

  it("los ceros a la izquierda no distinguen operaciones (000123 y 123)", () => {
    const p1 = pago(500, { operacion: "000123" });
    const p2 = pago(500, { operacion: "123" });
    expect(conciliar([], [p1, p2]).duplicados.map((r) => r.pago.linea)).toEqual([p2.linea]);
  });

  it("una operación que no se repite no lleva aviso", () => {
    const p = pago(500, { operacion: "55" });
    expect(dePago(conciliar([], [p]), p).avisos).toEqual([]);
  });
});

describe("revisión: importe exacto antes que tolerancia", () => {
  it("con facturas de 100,00 y 100,01 y un pago de 100,00 paga la de 100,00", () => {
    const f1 = factura(1, 100);
    const f2 = factura(2, 100.01);
    const p = pago(100);
    const c = conciliar([f1, f2], [p]);
    expect(dePago(c, p)).toMatchObject({ estado: "emparejado", regla: "importe-exacto", imputaciones: [{ facturaId: f1.id, importe: 100 }] });
    expect(deFactura(c, f2).estado).toBe("impaga");
  });

  it("si no hay ninguna exacta y hay dos dentro de la tolerancia, sigue sin decidir", () => {
    const f1 = factura(1, 100.01);
    const f2 = factura(2, 99.99);
    const p = pago(100);
    expect(dePago(conciliar([f1, f2], [p]), p).estado).toBe("revisar");
  });
});

describe("revisión: la suma tampoco se decide si dos pagos compiten", () => {
  it("dos pagos que solo pueden ser la misma combinación quedan los dos para revisar", () => {
    const f1 = factura(1, 1000, { cuit: FERRETERIA });
    const f2 = factura(2, 2000, { cuit: FERRETERIA });
    const f3 = factura(3, 9000, { cuit: FERRETERIA });
    const p1 = pago(3000, { cuit: FERRETERIA, fecha: "2026-10-20" });
    const p2 = pago(3000, { cuit: FERRETERIA, fecha: "2026-10-25" });
    const c = conciliar([f1, f2, f3], [p1, p2]);
    expect(dePago(c, p1).estado).toBe("revisar");
    expect(dePago(c, p2).estado).toBe("revisar");
    expect(dePago(c, p1).porQue).toMatch(/otro pago/i);
    expect(c.emparejamientos).toEqual([]);
    expect(deFactura(c, f1)).toMatchObject({ estado: "impaga", enRevision: [p1.linea, p2.linea] });
  });

  it("un pago con su propia combinación sigue emparejándose", () => {
    const f1 = factura(1, 1000, { cuit: FERRETERIA });
    const f2 = factura(2, 2000, { cuit: FERRETERIA });
    const f3 = factura(3, 400, { cuit: FERRETERIA });
    const f4 = factura(4, 600, { cuit: FERRETERIA });
    const p1 = pago(3000, { cuit: FERRETERIA });
    const p2 = pago(1000.01, { cuit: FERRETERIA, fecha: "2026-10-31" }); // 400 + 600 (la factura de 1000 también entra en la tolerancia)
    const c = conciliar([f1, f2, f3, f4], [p1, p2]);
    expect(dePago(c, p1)).toMatchObject({ estado: "emparejado", regla: "suma-de-facturas" });
  });
});

describe("revisión: cuotas sin referencia", () => {
  for (const [a, b] of [[50, 50], [60, 40], [40, 60]] as const) {
    it(`una factura de 100 pagada en dos cuotas de ${a} y ${b} queda pagada`, () => {
      const f = factura(1, 100);
      const p1 = pago(a, { fecha: "2026-10-20" });
      const p2 = pago(b, { fecha: "2026-10-25" });
      const c = conciliar([f], [p1, p2]);
      expect(dePago(c, p1)).toMatchObject({ estado: "emparejado", regla: "pago-parcial" });
      expect(dePago(c, p2)).toMatchObject({ estado: "emparejado", sinImputar: 0 });
      expect(dePago(c, p2).porQue).not.toMatch(/supera/);
      expect(deFactura(c, f)).toMatchObject({ estado: "pagada", saldo: 0, pagos: [p1.linea, p2.linea] });
      expect(c.paraRevisar).toEqual([]);
    });
  }

  it("una cuota mayor que lo que falta sigue yendo a revisar", () => {
    const f = factura(1, 100);
    const p1 = pago(50, { fecha: "2026-10-20" });
    const p2 = pago(70, { fecha: "2026-10-25" });
    const c = conciliar([f], [p1, p2]);
    expect(dePago(c, p2).estado).toBe("revisar");
    expect(dePago(c, p2).porQue).toMatch(/supera/);
  });
});

describe("revisión: muchas facturas abiertas de un mismo CUIT", () => {
  it("con más de 20 facturas candidatas no se listan: el aviso lo dice y no se arma una lista enorme por pago", () => {
    const fs = Array.from({ length: 30 }, (_, i) => factura(i + 1, 1000 + i * 10));
    const p = pago(777);
    const c = conciliar(fs, [p]);
    const r = dePago(c, p);
    expect(r.estado).toBe("revisar");
    expect(r.candidatas).toEqual([]);
    expect(r.porQue).toMatch(/30 facturas/);
    expect(deFactura(c, fs[0] as FacturaAPagar).enRevision).toEqual([]);
  });

  it("3.000 facturas de un mismo CUIT y 6.000 pagos terminan enseguida", () => {
    const fs = Array.from({ length: 3000 }, (_, i) => factura(i + 1, 10_000 + i * 7));
    const ps = Array.from({ length: 6000 }, (_, i) => pago(i % 2 === 0 ? 10_000 + (i / 2) * 7 : 1.01 + i, { fecha: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` }));
    const inicio = Date.now();
    const c = conciliar(fs, ps);
    expect(Date.now() - inicio).toBeLessThan(5000);
    expect(c.pagos).toHaveLength(6000);
    expect(c.resumen.emparejados).toBeGreaterThan(2900);
  });
});

describe("revisión: referencias y facturas mínimas", () => {
  it("un número o un punto de venta cero no son una referencia", () => {
    expect(extraerReferencias("0-0")).toEqual([]);
    expect(extraerReferencias("0003-00000000")).toEqual([]);
    expect(extraerReferencias("0000-00001245")).toEqual([]);
  });

  it("una factura cuyo importe cae dentro de la tolerancia no se concilia (figuraría pagada sin pago)", () => {
    const base = { ...comprobanteVacio(), fecha: "2026-10-05", cuit: VALLE, tipoCmp: 1, ptoVta: 3, nroCmp: 1245, importe: 0.02, moneda: "PES" };
    const { facturas, omitidas } = facturasDeFilas([crearFila(1, "a.png", base), crearFila(2, "b.png", { ...base, nroCmp: 2, importe: 0.03 })]);
    expect(facturas.map((f) => f.id)).toEqual([2]);
    expect(omitidas).toEqual([{ id: 1, motivo: expect.stringMatching(/centavos/) }]);
  });
});
