// Presentación de la pestaña «Pagos» (sin DOM): etiquetas, cifra protagonista, «Requieren atención», textos y anuncios.

import { describe, expect, it } from "vitest";
import { FECHA_REFERENCIA_EJEMPLO } from "../src/antiguedad.ts";
import { conciliarPagos, facturasDeFilas, type ConciliacionPagos, type FacturaAPagar } from "../src/cuentas-a-pagar.ts";
import { generarEjemplosCompletos } from "../src/ejemplos.ts";
import { extractoEjemplo } from "../src/ejemplos-pagos.ts";
import { leerExtracto } from "../src/extracto.ts";
import { crearFila, type Fila } from "../src/planilla.ts";
import { leerUrlQr } from "../src/qr-arca.ts";
import {
  ID_BLOQUE,
  anuncioDeMensaje,
  anuncioPagos,
  candidatasDePago,
  conteosFacturas,
  detalleFactura,
  etiquetaAntiguaPago,
  etiquetaFactura,
  etiquetaPago,
  facturaVisible,
  imputacionesDePago,
  itemsAtencionPagos,
  lineaDePago,
  lineaMenorPagos,
  metaExcepciones,
  metaResultadoPagos,
  protagonistaPagos,
  textoEdad,
  textoExtractoCargado,
  textoFacturasAConciliar,
  textoLineas,
  textosZonaExtracto,
} from "../src/vista-pagos.ts";

const HOY = new Date(2026, 10, 17, 12);

function filasDelEjemplo(): Fila[] {
  return generarEjemplosCompletos(HOY).map((e, i) => {
    if (e.url === null) return crearFila(i + 1, e.origen, null);
    const c = leerUrlQr(e.url);
    if (c instanceof Error) throw c;
    return crearFila(i + 1, e.origen, c);
  });
}

const lectura = (() => {
  const r = leerExtracto(extractoEjemplo());
  if (r instanceof Error) throw r;
  return r;
})();

function conciliacion(facturas?: readonly FacturaAPagar[]): { c: ConciliacionPagos; facturas: FacturaAPagar[] } {
  const f = facturas === undefined ? facturasDeFilas(filasDelEjemplo()).facturas : [...facturas];
  return { c: conciliarPagos(f, lectura.pagos, { hoy: FECHA_REFERENCIA_EJEMPLO }), facturas: f };
}

describe("textoLineas", () => {
  it("nombra una, dos o más líneas en forma natural", () => {
    expect(textoLineas([])).toBe("");
    expect(textoLineas([3])).toBe("la línea 3");
    expect(textoLineas([2, 8])).toBe("las líneas 2 y 8");
    expect(textoLineas([2, 8, 11])).toBe("las líneas 2, 8 y 11");
  });
});

describe("etiquetas", () => {
  it("cada estado de una factura tiene texto, tono e ícono propios (el color nunca va solo)", () => {
    const { c } = conciliacion();
    const por = (estado: string) => c.facturas.find((s) => s.estado === estado);
    expect(etiquetaFactura(por("pagada")!)).toEqual({ texto: "Pagada", tono: "ok", icono: "check" });
    expect(etiquetaFactura(por("parcial")!)).toEqual({ texto: "Pago parcial", tono: "revisar", icono: "distinto" });
    expect(etiquetaFactura(por("impaga")!)).toEqual({ texto: "Impaga", tono: "pendiente", icono: "punto" });
  });

  it("cada resultado de un pago tiene su etiqueta, y el duplicado dice de cuál línea", () => {
    const { c } = conciliacion();
    const etiquetas = c.pagos.map((r) => etiquetaPago(r).texto);
    expect(etiquetas).toContain("Emparejado");
    expect(etiquetas).toContain("Sin factura");
    expect(etiquetas).toContain("Para revisar");
    expect(etiquetas).toContain("Duplicado de la línea 3");
    const iconos = new Set(c.pagos.map((r) => etiquetaPago(r).icono));
    expect(iconos.size).toBeGreaterThanOrEqual(4);
  });

  it("la marca de antigua solo la lleva lo que cumple el umbral", () => {
    const { c } = conciliacion();
    const antiguas = c.facturas.filter((s) => etiquetaAntiguaPago(s, 30) !== null);
    expect(antiguas).toHaveLength(1);
    expect(etiquetaAntiguaPago(antiguas[0]!, 30)?.texto).toBe("30 días o más");
  });
});

describe("detalle de una factura", () => {
  it("la parcial dice cuánto se pagó, con qué líneas y cuánto falta", () => {
    const { c } = conciliacion();
    const parcial = c.facturas.find((s) => s.estado === "parcial")!;
    const texto = detalleFactura(parcial).join(" ");
    expect(texto).toContain("Pagado $ 40.000,00 de $ 61.750,00 (las líneas 2 y 8). Falta $ 21.750,00.");
    expect(texto).toContain("Emitida hace 23 días.");
  });

  it("la impaga dice sus días y avisa si un pago para revisar podría ser suyo", () => {
    const { c } = conciliacion();
    const conRevision = c.facturas.find((s) => s.estado === "impaga" && s.enRevision.length > 0)!;
    expect(detalleFactura(conRevision).join(" ")).toContain("El pago de la línea 9 está para revisar y podría ser de esta factura.");
  });

  it("una pagada nombra la línea que la pagó", () => {
    const { c } = conciliacion();
    const pagada = c.facturas.find((s) => s.estado === "pagada" && s.pagos.length === 1)!;
    expect(detalleFactura(pagada)[0]).toMatch(/^Pagada con la línea \d+\.$/);
  });

  it("una factura emitida después de la fecha de referencia no muestra días negativos", () => {
    expect(textoEdad(-46)).toBe("La fecha de emisión es posterior a la fecha de referencia.");
    expect(textoEdad(0)).toBe("Emitida el día de la fecha de referencia.");
    expect(textoEdad(1)).toBe("Emitida hace 1 día.");
    expect(textoEdad(null)).toBe("");
  });
});

describe("textos de un pago", () => {
  it("la línea que lo identifica trae línea, fecha, importe y CUIT", () => {
    const { c } = conciliacion();
    const sinFactura = c.sinFactura[0]!.pago;
    expect(lineaDePago(sinFactura)).toBe("Línea 10 · 10/11/2026 · $ 18.000,00 · 30-99000402-8");
  });

  it("las facturas aplicadas y las candidatas salen con su nombre", () => {
    const { c, facturas } = conciliacion();
    const porId = new Map(facturas.map((f) => [f.id, f] as const));
    const situaciones = new Map(c.facturas.map((s) => [s.factura.id, s] as const));
    const dos = c.pagos.find((r) => r.pago.linea === 6)!;
    expect(imputacionesDePago(dos, porId)).toEqual(["Factura A 0003-00001270 · $ 100.000,00", "Factura A 0003-00001275 · $ 24.200,03"]);
    const revisar = c.paraRevisar[0]!;
    const candidatas = candidatasDePago(revisar, situaciones);
    expect(candidatas).toHaveLength(revisar.candidatas.length);
    expect(candidatas[0]).toMatch(/^Factura [A-C] \d{4}-\d{8} · saldo \$ /);
  });
});

describe("cifra protagonista", () => {
  it("con el ejemplo: 9 facturas por $ 215.935,65, con el desglose y la acción para verlas", () => {
    const p = protagonistaPagos(conciliacion().c);
    expect(p).toMatchObject({ variante: "faltan", tono: "pendiente", rotulo: "Falta pagar", cifra: "9", unidad: "facturas", montos: ["$ 215.935,65"] });
    expect(p.mensaje).toBe("De 16 facturas: 7 pagadas, 1 con pago parcial y 8 impagas.");
    expect(p.accion).toEqual({ texto: "Ver las 9 en la lista", filtro: "falta" });
  });

  it("sin facturas no dice «0 pagadas»: explica que no hay con qué conciliar", () => {
    const p = protagonistaPagos(conciliacion([]).c);
    expect(p.variante).toBe("sin-facturas");
    expect(p.tono).toBe("neutro");
    expect(p.mensaje).toContain("No hay facturas en la planilla");
    expect(p.accion).toBeNull();
  });

  it("con todo pagado, el cero es verde y no hay acción", () => {
    const factura: FacturaAPagar = { id: 1, cuit: "30990001010", tipoCmp: 6, ptoVta: 1, nroCmp: 876, fecha: "2026-10-07", importe: 45200 };
    const pagos = leerExtracto("Fecha;Importe;CUIT;Referencia\r\n31/10/2026;45200,00;30-99000101-0;\r\n");
    if (pagos instanceof Error) throw pagos;
    const c = conciliarPagos([factura], pagos.pagos, { hoy: "2026-11-12" });
    const p = protagonistaPagos(c);
    expect(p).toMatchObject({ variante: "cero", tono: "ok", cifra: "0", montos: [], accion: null });
  });

  it("una sola factura pendiente va en singular y sin grupos en cero", () => {
    const f1: FacturaAPagar = { id: 1, cuit: "30990001010", tipoCmp: 6, ptoVta: 1, nroCmp: 876, fecha: "2026-10-07", importe: 100 };
    const c = conciliarPagos([f1], [], { hoy: "2026-11-12" });
    const p = protagonistaPagos(c);
    expect(p.cifra).toBe("1");
    expect(p.unidad).toBe("factura");
    expect(p.mensaje).toBe("De 1 factura: 1 impaga.");
    expect(p.accion?.texto).toBe("Ver la factura en la lista");
  });
});

describe("requieren atención", () => {
  it("con el ejemplo: cinco ítems, en este orden, cada uno con destino", () => {
    const items = itemsAtencionPagos(conciliacion().c, 0, 30);
    expect(items.map((i) => i.clave)).toEqual(["sinFactura", "revisar", "duplicados", "mismoUsuario", "antiguas"]);
    expect(items[0]).toMatchObject({ cifra: 1, texto: "pago sin factura por $ 18.000,00", destino: { tipo: "bloque", id: ID_BLOQUE.sinFactura } });
    expect(items[4]).toMatchObject({ texto: "factura sin pagar con 30 días o más", destino: { tipo: "facturas" } });
  });

  it("las líneas ilegibles del extracto suman su ítem; sin nada, no hay ítems", () => {
    expect(itemsAtencionPagos(conciliacion().c, 2, 30).at(-1)).toMatchObject({ clave: "lineasIlegibles", cifra: 2, texto: "líneas del extracto que no se pudieron leer" });
    const f1: FacturaAPagar = { id: 1, cuit: "30990001010", tipoCmp: 6, ptoVta: 1, nroCmp: 876, fecha: "2026-10-07", importe: 100 };
    const pagos = leerExtracto("Fecha;Importe;CUIT;Referencia\r\n31/10/2026;100,00;30-99000101-0;\r\n");
    if (pagos instanceof Error) throw pagos;
    expect(itemsAtencionPagos(conciliarPagos([f1], pagos.pagos, { hoy: "2026-11-12" }), 0, 30)).toEqual([]);
  });

  it("un CUIT inválido en el extracto es un ítem propio", () => {
    const pagos = leerExtracto("Fecha;Importe;CUIT;Referencia\r\n31/10/2026;100,00;30-99000101-9;FA 0001-00000876\r\n");
    if (pagos instanceof Error) throw pagos;
    const c = conciliarPagos([], pagos.pagos, { hoy: "2026-11-12" });
    expect(itemsAtencionPagos(c, 0, 30).map((i) => i.clave)).toContain("cuitInvalido");
  });

  it("un número de operación repetido con otro importe es un ítem propio, con su bloque", () => {
    const pagos = leerExtracto("Fecha;Importe;CUIT;Operación\r\n30/10/2026;100,00;30-99000101-0;1\r\n31/10/2026;250,00;30-99000101-0;1\r\n");
    if (pagos instanceof Error) throw pagos;
    const c = conciliarPagos([], pagos.pagos, { hoy: "2026-11-12" });
    const item = itemsAtencionPagos(c, 0, 30).find((i) => i.clave === "operacionRepetida");
    expect(item).toMatchObject({ cifra: 1, texto: "pago con un número de operación que ya figuraba con otro importe o CUIT", destino: { tipo: "bloque", id: ID_BLOQUE.operacionRepetida } });
  });
});

describe("filtro, datos de barras y anuncios", () => {
  it("«Falta pagar» junta impagas y parciales", () => {
    const { c } = conciliacion();
    expect(conteosFacturas(c)).toEqual({ todas: 16, falta: 9, pagadas: 7 });
    expect(c.facturas.filter((s) => facturaVisible(s, "falta"))).toHaveLength(9);
    expect(c.facturas.filter((s) => facturaVisible(s, "pagadas"))).toHaveLength(7);
    expect(conteosFacturas(null)).toEqual({ todas: 0, falta: 0, pagadas: 0 });
  });

  it("metas de las ventanas", () => {
    const { c } = conciliacion();
    expect(metaResultadoPagos(c)).toBe("Falta pagar 9 facturas");
    expect(metaResultadoPagos(null)).toBe("");
    expect(metaExcepciones(c, 0, 5)).toBe("9 excepciones");
    expect(lineaMenorPagos(2, { fecha: "2026-11-12", origen: "ejemplo" })).toContain("hasta 2 centavos");
    expect(lineaMenorPagos(2, { fecha: "2026-11-12", origen: "ejemplo" })).toContain("12/11/2026");
  });

  it("el anuncio para lectores de pantalla resume pagos, lo que falta y lo que requiere atención", () => {
    const a = anuncioPagos(conciliacion().c, 0, 30);
    expect(a).toContain("Extracto conciliado: 10 pagos.");
    expect(a).toContain("7 emparejados, 1 sin factura, 1 duplicados y 1 para revisar.");
    expect(a).toContain("Falta pagar 9 facturas por $ 215.935,65.");
    expect(a).toContain("Requieren atención: 1 pago sin factura por $ 18.000,00");
  });

  it("un error se anuncia como alerta y lo demás como estado", () => {
    expect(anuncioDeMensaje("error")).toEqual({ role: "alert", live: "assertive" });
    for (const tono of ["info", "ok", "aviso"] as const) expect(anuncioDeMensaje(tono)).toEqual({ role: "status", live: "polite" });
  });

  it("mensajes de carga: avisan lo que no se puede hacer", () => {
    const t = textoExtractoCargado("pagos.csv", { pagos: lectura.pagos, lineasInvalidas: [{ linea: 3, motivo: "x" }], tieneUsuarios: false, encabezadosDuplicados: ["importe", "CUIT"] }, 0);
    expect(t).toContain("Se leyó pagos.csv: 10 pagos.");
    expect(t).toContain("Columnas repetidas en el encabezado (importe, CUIT): se usó la primera de cada una.");
    expect(textoExtractoCargado("p.csv", { ...lectura, encabezadosDuplicados: [] }, 3)).not.toContain("repetidas");
    expect(t).toContain("1 línea no se pudo leer");
    expect(t).toContain("no se puede hacer el control interno");
    expect(t).toContain("No hay facturas en la planilla");
    expect(textoFacturasAConciliar(16, 5)).toBe("Se concilia con 16 facturas en pesos de la planilla. 5 quedan afuera (motivo en las excepciones).");
    expect(textoFacturasAConciliar(0, 0)).toContain("La planilla no tiene facturas");
  });

  it("la zona de carga cambia de texto según el estado", () => {
    const base = { tactil: false, cantidad: 10, origen: "ejemplo", error: "Falta la columna de fecha." };
    expect(textosZonaExtracto("vacia", base).titulo).toBe("Arrastre el CSV aquí o elíjalo");
    expect(textosZonaExtracto("con-datos", base)).toEqual({ titulo: "Extracto: 10 pagos (ejemplo)", ayuda: "", accion: "Cambiar" });
    expect(textosZonaExtracto("error", base).ayuda).toBe("Falta la columna de fecha.");
    expect(textosZonaExtracto("vacia", { ...base, tactil: true }).titulo).toBe("Elegir CSV");
  });
});
