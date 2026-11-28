import { describe, expect, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import { conciliar, itemsAtencion, resumenConciliacion, type Registro, type Resultado } from "../src/conciliacion.ts";
import { ICONOS } from "../src/iconos.ts";
import html from "../index.html?raw";
import { agregarFila, crearFila, siguienteId, totalesPorMoneda, type Fila } from "../src/planilla.ts";
import {
  anuncioConciliacion,
  avisosConControl,
  avisosDeFila,
  conteosFiltros,
  detalleFila,
  detalleFilaPartes,
  estadoDeZona,
  etiquetaConciliacion,
  etiquetaDuplicada,
  etiquetaLectura,
  metaComprobantes,
  metaPlanilla,
  metaRegistro,
  metaResultado,
  monedaDeRegistro,
  nombreBotonEditar,
  presentarAtencion,
  protagonista,
  textoLectura,
  textoMostrando,
  textosZonaComprobantes,
  textosZonaRegistro,
  totalesVista,
  unaLinea,
} from "../src/vista.ts";

const HOY = new Date(2026, 10, 17, 12);
const CUIT_A = "30990000014";
const CUIT_B = "30990000200";

function dato(cambios: Partial<Comprobante> = {}): Comprobante {
  return {
    ...comprobanteVacio(),
    ver: 1,
    fecha: "2026-10-05",
    cuit: CUIT_A,
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1245,
    importe: 1000,
    moneda: "PES",
    ctz: 1,
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

describe("etiquetas de estado", () => {
  it("cada resultado de conciliación tiene texto, tono e ícono propios (el color nunca va solo)", () => {
    const resultados: Resultado[] = [
      { tipo: "falta" },
      { tipo: "revisar" },
      { tipo: "ya-cargada" },
      { tipo: "otro-importe", importeFila: 1, importeRegistro: 2 },
      { tipo: "otro-emisor", cuitRegistro: CUIT_B },
      { tipo: "no-conciliable" },
      { tipo: "duplicada", original: 1 },
    ];
    expect(resultados.map((r) => etiquetaConciliacion(r))).toEqual([
      { texto: "Falta cargar", tono: "pendiente", icono: "punto" },
      { texto: "Revisar antes de cargar", tono: "revisar", icono: "alerta" },
      { texto: "Ya cargada", tono: "ok", icono: "check" },
      { texto: "Mal cargada: otro importe", tono: "diferencia", icono: "distinto" },
      { texto: "Mal cargada: otro emisor", tono: "diferencia", icono: "distinto" },
      { texto: "No se puede conciliar", tono: "neutro", icono: "guion" },
      { texto: "Duplicada en la planilla", tono: "revisar", icono: "copias" },
    ]);
  });

  it("la duplicada nombra la fila que repite cuando se la conoce", () => {
    expect(etiquetaConciliacion({ tipo: "duplicada", original: 7 }, 1)).toEqual({ texto: "Duplicada de la fila 1", tono: "revisar", icono: "copias" });
    expect(etiquetaConciliacion({ tipo: "falta" }, 1).texto).toBe("Falta cargar");
  });

  it("C1: ningún resultado distinto de 'ya cargada' se pinta de verde, y la duplicada pide atención", () => {
    expect(etiquetaConciliacion({ tipo: "duplicada", original: 1 }).tono).not.toBe("ok");
    expect(etiquetaDuplicada(1).tono).not.toBe("ok");
    expect(etiquetaConciliacion({ tipo: "duplicada", original: 1 }).tono).toBe("revisar");
  });

  it("lectura: 'Leída' no lleva etiqueta; Revisar y Sin QR sí", () => {
    expect(etiquetaLectura("leida")).toBeNull();
    expect(etiquetaLectura("revisar")).toEqual({ texto: "Revisar", tono: "revisar", icono: "alerta" });
    expect(etiquetaLectura("sin-qr")).toEqual({ texto: "Sin QR", tono: "diferencia", icono: "sin-qr" });
  });

  it("duplicada: nombra la fila original", () => {
    expect(etiquetaDuplicada(4)).toEqual({ texto: "Duplicada de la fila 4", tono: "revisar", icono: "copias" });
  });

  it("'Cargada dos veces en el sistema' y 'Duplicada en la planilla' tienen formas distintas (no solo el texto)", () => {
    const dosVeces = etiquetaConciliacion({ tipo: "ya-cargada", copias: [1, 1] }, undefined, true);
    const duplicada = etiquetaConciliacion({ tipo: "duplicada", original: 1 });
    expect(dosVeces.texto).toBe("Cargada dos veces en el sistema");
    expect(duplicada.texto).toBe("Duplicada en la planilla");
    expect(dosVeces.icono).toBe("sistema");
    expect(duplicada.icono).toBe("copias");
    expect(dosVeces.icono).not.toBe(duplicada.icono);
    // En "Requieren atención" también: la cargada dos veces lleva el ícono del sistema y la duplicada el de las copias.
    const iconos = Object.fromEntries(presentarAtencion(itemsAtencion(unResumen({ duplicadas: 1, cargadasDosVeces: 1 }))).map((i) => [i.clave, i.icono]));
    expect(iconos).toEqual({ duplicadas: "copias", dosVeces: "sistema" });
  });

  it("cada ícono del contrato está dibujado en el sprite de index.html", () => {
    for (const i of ICONOS) expect(html, `falta <symbol id="i-${i}">`).toContain(`<symbol id="i-${i}"`);
  });

  it("todos los íconos que se usan existen en el contrato", () => {
    const usados = [
      etiquetaConciliacion({ tipo: "falta" }).icono,
      etiquetaLectura("sin-qr")?.icono,
      etiquetaDuplicada(1).icono,
      ...presentarAtencion(itemsAtencion(unResumen({ revisar: 1, conDiferencias: 1, cargadasDosVeces: 1, noRecibidas: 1 }))).map((i) => i.icono),
    ];
    for (const i of usados) expect(ICONOS).toContain(i);
  });
});

function unResumen(parcial: Partial<ReturnType<typeof resumenConciliacion>>): ReturnType<typeof resumenConciliacion> {
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

describe("filtros con cantidades", () => {
  it("cuenta cada filtro con la misma regla con que se filtra la planilla (sin duplicados)", () => {
    const filas = planilla(
      { nroCmp: 1 }, // ya cargada
      { nroCmp: 2 }, // falta
      { nroCmp: 3 }, // falta
      { nroCmp: 4, cuit: "30990000015" }, // CUIT inválido → revisar
      { nroCmp: 5, importe: 50 }, // otro importe
      { nroCmp: 3 }, // duplicada de la 3
    );
    const reg = [registro({ nroCmp: 1 }), registro({ nroCmp: 5, importe: 70 })];
    const c = conciliar(filas, reg, HOY);
    expect(conteosFiltros(filas, c)).toEqual({ todas: 6, faltan: 2, revisar: 1, diferencias: 1 });
  });

  it("sin registro, solo 'todas' tiene cantidad", () => {
    expect(conteosFiltros(planilla({}, { nroCmp: 2 }), null)).toEqual({ todas: 2, faltan: 0, revisar: 0, diferencias: 0 });
  });
});

describe("protagonista del resultado", () => {
  const pesos = (total: number) => ({ moneda: "PES", nombre: "Pesos (PES)", total, cantidad: 1 });
  const dolares = (total: number) => ({ moneda: "DOL", nombre: "Dólares (DOL)", total, cantidad: 1 });

  it("sin registro: cuántos comprobantes hay y su total por moneda, en franja neutra", () => {
    const p = protagonista(11, [dolares(1250), pesos(229115.65)], null);
    expect(p).toMatchObject({
      variante: "leidos",
      tono: "neutro",
      rotulo: "Comprobantes leídos",
      cifra: "11",
      unidad: "",
      montos: ["$ 229.115,65", "US$ 1.250,00"],
      accion: null,
    });
  });

  it("con registro y faltantes: la cifra, la unidad, los montos y la acción de ver los faltantes", () => {
    const p = protagonista(11, [], unResumen({ faltan: 2, faltanPorMoneda: [pesos(6120), dolares(1250)] }));
    expect(p).toEqual({
      variante: "faltan",
      tono: "pendiente",
      rotulo: "Falta cargar",
      cifra: "2",
      unidad: "facturas",
      montos: ["$ 6.120,00", "US$ 1.250,00"],
      mensaje: "",
      ademas: null,
      accion: { texto: "Ver los 2 en la planilla", filtro: "faltan" },
    });
  });

  it("singular: 'Falta cargar 1 factura'", () => {
    const p = protagonista(3, [], unResumen({ faltan: 1, faltanPorMoneda: [dolares(1250)] }));
    expect(p).toMatchObject({ rotulo: "Falta cargar", cifra: "1", unidad: "factura", montos: ["US$ 1.250,00"] });
    expect(p.accion?.texto).toBe("Ver el comprobante en la planilla");
  });

  it("sin importes legibles no se inventa un monto", () => {
    expect(protagonista(3, [], unResumen({ faltan: 3 })).montos).toEqual([]);
  });

  it("con cero faltantes: franja ok, el 0 sin repetirlo en una frase (QA B6) y sin botón", () => {
    expect(protagonista(5, [], unResumen({ yaCargadas: 5 }))).toEqual({
      variante: "cero",
      tono: "ok",
      rotulo: "Falta cargar",
      cifra: "0",
      unidad: "comprobantes",
      montos: [],
      mensaje: "",
      ademas: null,
      accion: null,
    });
  });
});

describe("requieren atención", () => {
  it("cada ítem sabe qué hacer: los de planilla filtran, los de detalle llevan a su lista", () => {
    const items = presentarAtencion(itemsAtencion(unResumen({ revisar: 3, conDiferencias: 2, cargadasDosVeces: 1, noRecibidas: 2 })));
    expect(items.map((i) => `${i.cifra} ${i.texto}`)).toEqual([
      "3 para revisar",
      "2 mal cargadas",
      "1 cargada dos veces en el sistema",
      "2 cargadas en el sistema y no recibidas",
    ]);
    expect(items.map((i) => i.accion)).toEqual([
      { tipo: "filtro", filtro: "revisar", texto: "Ver" },
      { tipo: "filtro", filtro: "diferencias", texto: "Ver" },
      { tipo: "detalle", destino: "dos-veces", texto: "Ver detalle" },
      { tipo: "detalle", destino: "no-recibidas", texto: "Ver detalle" },
    ]);
    // "Cargada dos veces" va en ámbar, con el ícono del sistema, igual que en su fila (decisión de Matías, 17/11/2026); "mal cargada" sigue en rojo.
    expect(items.map((i) => i.tono)).toEqual(["revisar", "diferencia", "revisar", "neutro"]);
    expect(items.map((i) => i.icono)).toEqual(["alerta", "distinto", "sistema", "guion"]);
  });

  it("C1: las duplicadas de la planilla cuentan como atención y llevan a la primera de ellas", () => {
    const items = presentarAtencion(itemsAtencion(unResumen({ duplicadas: 2, revisar: 1 })));
    expect(items.map((i) => `${i.cifra} ${i.texto}`)).toEqual(["1 para revisar", "2 duplicadas en la planilla"]);
    expect(items[1]).toMatchObject({ tono: "revisar", icono: "copias", accion: { tipo: "duplicadas", texto: "Ver" } });
  });

  it("plural de 'cargadas dos veces' y los ceros no aparecen", () => {
    const items = presentarAtencion(itemsAtencion(unResumen({ cargadasDosVeces: 2 })));
    expect(items.map((i) => `${i.cifra} ${i.texto}`)).toEqual(["2 cargadas dos veces en el sistema"]);
  });
});

describe("línea de lectura", () => {
  it("resume la lectura con singular y plural", () => {
    expect(textoLectura({ total: 11, leidas: 7, revisar: 3, sinQr: 1, duplicadas: 1, editadas: 0 })).toBe(
      "Lectura: 11 comprobantes (7 leídos, 3 para revisar, 1 sin QR, 1 duplicado)",
    );
    expect(textoLectura({ total: 1, leidas: 1, revisar: 0, sinQr: 0, duplicadas: 0, editadas: 0 })).toBe(
      "Lectura: 1 comprobante (1 leído, 0 para revisar, 0 sin QR, 0 duplicados)",
    );
    expect(textoLectura({ total: 0, leidas: 0, revisar: 0, sinQr: 0, duplicadas: 0, editadas: 0 })).toBe("");
  });
});

describe("totales por moneda", () => {
  it("nombre corto, monto con símbolo y cantidad, pesos primero", () => {
    const filas = planilla({ nroCmp: 1, importe: 100 }, { nroCmp: 2, importe: 50.5 }, { nroCmp: 3, moneda: "DOL", importe: 1250 });
    expect(totalesVista(totalesPorMoneda(filas))).toEqual([
      { nombre: "Pesos", monto: "$ 150,50", cantidad: "2 comprobantes" },
      { nombre: "Dólares", monto: "US$ 1.250,00", cantidad: "1 comprobante" },
    ]);
  });
});

describe("detalle de una línea por fila", () => {
  it("avisos: con QR, la nota y todos los motivos; sin QR, la nota o el primer motivo", () => {
    const [conQr] = planilla({});
    const [sinQr] = planilla(null);
    expect(avisosDeFila(conQr as Fila, ["Fecha futura.", "Total en cero."])).toEqual(["Fecha futura.", "Total en cero."]);
    expect(avisosDeFila({ ...(conQr as Fila), nota: "Aviso." }, ["Fecha futura."])).toEqual(["Aviso.", "Fecha futura."]);
    expect(avisosDeFila({ ...(sinQr as Fila), nota: "No se encontró ningún QR." }, ["Falta algo."])).toEqual(["No se encontró ningún QR."]);
    expect(avisosDeFila(sinQr as Fila, ["Falta algo.", "Falta otra cosa."])).toEqual(["Falta algo."]);
    expect(avisosDeFila(conQr as Fila, [])).toEqual([]);
  });

  it("avisosConControl: con observaciones del control, la nota y esas frases; sin ellas, lo de siempre", () => {
    const [conQr] = planilla({});
    const [sinQr] = planilla(null);
    const o = [{ mensaje: "Error uno." }, { mensaje: "Aviso dos." }];
    expect(avisosConControl({ ...(conQr as Fila), nota: "Nota." }, ["Fecha futura."], o)).toEqual(["Nota.", "Error uno.", "Aviso dos."]);
    expect(avisosConControl(conQr as Fila, ["Fecha futura."], o)).toEqual(["Error uno.", "Aviso dos."]);
    expect(avisosConControl(conQr as Fila, ["Fecha futura."], [])).toEqual(["Fecha futura."]);
    expect(avisosConControl({ ...(sinQr as Fila), nota: "No se encontró ningún QR." }, ["Falta algo."], [])).toEqual(["No se encontró ningún QR."]);
  });

  it("revisar: el primer motivo y 'y N más' si hay varios", () => {
    const [f] = planilla({ cuit: "30990000015" });
    expect(detalleFila({ tipo: "revisar" }, f as Fila, ["CUIT con dígito inválido."])).toBe("CUIT con dígito inválido.");
    expect(detalleFila({ tipo: "revisar" }, f as Fila, ["CUIT con dígito inválido.", "Fecha futura.", "Total en cero."])).toBe(
      "CUIT con dígito inválido y 2 más.",
    );
    expect(detalleFila({ tipo: "revisar" }, f as Fila, ["A.", "B."])).toBe("A y 1 más.");
  });

  it("otro importe: los dos importes con su moneda", () => {
    const [f] = planilla({ importe: 45200 });
    expect(detalleFila({ tipo: "otro-importe", importeFila: 45200, importeRegistro: 45020 }, f as Fila, [])).toBe(
      "Planilla $ 45.200,00 · Sistema $ 45.020,00 · Diferencia $ 180,00. Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos.",
    );
    expect(detalleFila({ tipo: "otro-importe", importeFila: null, importeRegistro: 45020 }, f as Fila, [])).toBe(
      "Planilla sin importe · Sistema $ 45.020,00. Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos.",
    );
  });

  it("otro emisor: el CUIT con que figura en el sistema", () => {
    const [f] = planilla({});
    expect(detalleFila({ tipo: "otro-emisor", cuitRegistro: CUIT_A }, f as Fila, [])).toBe(
      "En el sistema con CUIT 30-99000001-4. Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos.",
    );
  });

  it("no se puede conciliar: dice qué falta; si no hay QR, el aviso de lectura", () => {
    const [sinNro, sinQr] = planilla({ nroCmp: null }, null);
    expect(detalleFila({ tipo: "no-conciliable" }, sinNro as Fila, [])).toBe("Falta el número de comprobante.");
    const f2 = { ...(sinNro as Fila), datos: { ...(sinNro as Fila).datos, cuit: "", tipoCmp: null } };
    expect(detalleFila({ tipo: "no-conciliable" }, f2, [])).toBe("Faltan el CUIT, el tipo de comprobante y el número de comprobante.");
    expect(detalleFila({ tipo: "no-conciliable" }, sinQr as Fila, ["No se encontró ningún QR en el archivo."])).toBe(
      "No se encontró ningún QR en el archivo.",
    );
  });

  it("falta cargar y ya cargada no llevan detalle", () => {
    const [f] = planilla({});
    expect(detalleFila({ tipo: "falta" }, f as Fila, [])).toBe("");
    expect(detalleFila({ tipo: "ya-cargada" }, f as Fila, [])).toBe("");
  });

  it("sin registro: el primer aviso de lectura", () => {
    const [f] = planilla({});
    expect(detalleFila(undefined, f as Fila, ["Fecha futura.", "Total en cero."])).toBe("Fecha futura y 1 más.");
    expect(detalleFila(undefined, f as Fila, [])).toBe("");
  });

  it("unaLinea agrega 'y N más' solo si hay más de un texto", () => {
    expect(unaLinea([])).toBe("");
    expect(unaLinea(["A."])).toBe("A.");
    expect(unaLinea(["A.", "B."])).toBe("A y 1 más.");
  });

  it("unaLinea no deja un punto antes de la «y»: el texto compuesto se lee de corrido", () => {
    expect(unaLinea(["El CUIT del emisor tiene el dígito verificador inválido.", "B.", "C.", "D.", "E."])).toBe(
      "El CUIT del emisor tiene el dígito verificador inválido y 4 más.",
    );
    expect(unaLinea(["Sin punto final", "B."])).toBe("Sin punto final y 1 más.");
    expect(unaLinea(["Total: $ 1.000,00.", "B."])).toBe("Total: $ 1.000,00 y 1 más.");
  });
});

describe("estado de las zonas de carga", () => {
  const base = { arrastrando: false, procesando: false, error: "", hayDatos: false };

  it("precedencia: arrastrando, procesando, error, con datos, vacía", () => {
    expect(estadoDeZona(base)).toBe("vacia");
    expect(estadoDeZona({ ...base, hayDatos: true })).toBe("con-datos");
    expect(estadoDeZona({ ...base, hayDatos: true, error: "Falló." })).toBe("error");
    expect(estadoDeZona({ ...base, hayDatos: true, error: "Falló.", procesando: true })).toBe("procesando");
    expect(estadoDeZona({ ...base, hayDatos: true, error: "Falló.", procesando: true, arrastrando: true })).toBe("arrastrando");
  });

  const ctx = { tactil: false, cantidad: 0, actual: 0, total: 0, archivo: "", error: "" };

  it("facturas: vacía, táctil, arrastrando, procesando, con datos y error", () => {
    expect(textosZonaComprobantes("vacia", ctx)).toEqual({
      titulo: "Arrastre PDF o imágenes aquí o elíjalos",
      ayuda: "Con el QR de ARCA. Hasta 15 MB por archivo.",
      accion: "",
    });
    expect(textosZonaComprobantes("vacia", { ...ctx, tactil: true }).titulo).toBe("Elegir archivos");
    expect(textosZonaComprobantes("arrastrando", ctx)).toMatchObject({ titulo: "Suelte para agregar" });
    expect(textosZonaComprobantes("procesando", { ...ctx, actual: 3, total: 12, archivo: "factura-03.pdf" })).toEqual({
      titulo: "Procesando 3 de 12",
      ayuda: "factura-03.pdf",
      accion: "",
    });
    expect(textosZonaComprobantes("con-datos", { ...ctx, cantidad: 11 })).toEqual({ titulo: "11 comprobantes cargados", ayuda: "", accion: "Agregar más" });
    expect(textosZonaComprobantes("con-datos", { ...ctx, cantidad: 1 }).titulo).toBe("1 comprobante cargado");
    expect(textosZonaComprobantes("error", { ...ctx, error: "Ocurrió un error." })).toMatchObject({ ayuda: "Ocurrió un error.", accion: "" });
  });

  const ctxR = { tactil: false, cantidad: 0, origen: "", error: "" };

  it("registro: vacía, con datos (con su origen) y error", () => {
    expect(textosZonaRegistro("vacia", ctxR)).toEqual({
      titulo: "Arrastre el CSV aquí o elíjalo",
      ayuda: "Hasta 2 MB y 20.000 líneas.",
      accion: "",
    });
    expect(textosZonaRegistro("vacia", { ...ctxR, tactil: true }).titulo).toBe("Elegir CSV");
    expect(textosZonaRegistro("arrastrando", ctxR).titulo).toBe("Suelte para cargar el registro");
    expect(textosZonaRegistro("con-datos", { ...ctxR, cantidad: 6, origen: "ejemplo ficticio" })).toEqual({
      titulo: "Registro: 6 comprobantes (ejemplo ficticio)",
      ayuda: "",
      accion: "Cambiar",
    });
    expect(textosZonaRegistro("con-datos", { ...ctxR, cantidad: 1, origen: "x.csv" }).titulo).toBe("Registro: 1 comprobante (x.csv)");
    expect(textosZonaRegistro("error", { ...ctxR, error: "El archivo supera el máximo de 2 MB." })).toMatchObject({
      ayuda: "El archivo supera el máximo de 2 MB.",
    });
  });
});

describe("detalle de una fila en partes sin cortes (C2, C6)", () => {
  it("otro importe: los montos van en su propia parte, con la diferencia en la moneda de la fila", () => {
    const [f] = planilla({ importe: 45200 });
    expect(detalleFilaPartes({ tipo: "otro-importe", importeFila: 45200, importeRegistro: 45020 }, f as Fila, [])).toEqual([
      { tipo: "texto", texto: "Planilla " },
      { tipo: "monto", texto: "$ 45.200,00" },
      { tipo: "texto", texto: " · Sistema " },
      { tipo: "monto", texto: "$ 45.020,00" },
      { tipo: "texto", texto: " · Diferencia " },
      { tipo: "monto", texto: "$ 180,00" },
      { tipo: "texto", texto: ". Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos." },
    ]);
  });

  it("la diferencia es siempre positiva y usa el símbolo de la moneda (dólares)", () => {
    const [f] = planilla({ importe: 1000, moneda: "DOL" });
    const partes = detalleFilaPartes({ tipo: "otro-importe", importeFila: 1000, importeRegistro: 1250.5 }, f as Fila, []);
    expect(partes.filter((p) => p.tipo === "monto").map((p) => p.texto)).toEqual(["US$ 1.000,00", "US$ 1.250,50", "US$ 250,50"]);
  });

  it("sin importe en la planilla no se inventa una diferencia", () => {
    const [f] = planilla({ importe: null });
    expect(detalleFila({ tipo: "otro-importe", importeFila: null, importeRegistro: 45020 }, f as Fila, [])).toBe(
      "Planilla sin importe · Sistema $ 45.020,00. Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos.",
    );
  });

  it("otro emisor: el CUIT va en su propia parte (no se corta)", () => {
    const [f] = planilla({});
    expect(detalleFilaPartes({ tipo: "otro-emisor", cuitRegistro: CUIT_A }, f as Fila, [])).toEqual([
      { tipo: "texto", texto: "En el sistema con CUIT " },
      { tipo: "codigo", texto: "30-99000001-4" },
      { tipo: "texto", texto: ". Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos." },
    ]);
  });

  it("los demás detalles son una sola parte de texto, y sin detalle no hay partes", () => {
    const [f] = planilla({});
    expect(detalleFilaPartes({ tipo: "revisar" }, f as Fila, ["A.", "B."])).toEqual([{ tipo: "texto", texto: "A y 1 más." }]);
    expect(detalleFilaPartes({ tipo: "falta" }, f as Fila, [])).toEqual([]);
    expect(detalleFilaPartes({ tipo: "duplicada", original: 1 }, f as Fila, [])).toEqual([]);
  });
});

describe("C3: la moneda del registro", () => {
  const [f1, f2] = planilla({ nroCmp: 1, moneda: "DOL" }, { nroCmp: 2, moneda: "" });
  it("toma la de la factura con la misma clave", () => {
    expect(monedaDeRegistro([f1 as Fila], registro({ nroCmp: 1 }))).toBe("DOL");
  });
  it("sin factura que coincida, o con una sin moneda, son pesos", () => {
    expect(monedaDeRegistro([f1 as Fila], registro({ nroCmp: 99 }))).toBe("PES");
    expect(monedaDeRegistro([f2 as Fila], registro({ nroCmp: 2 }))).toBe("PES");
    expect(monedaDeRegistro([], registro())).toBe("PES");
  });
});

describe("A4: nombre del botón Editar", () => {
  it("incluye el número de fila y el comprobante, para distinguirlo de los demás", () => {
    const [f] = planilla({ nroCmp: 1245 });
    expect(nombreBotonEditar(false, 3, f as Fila)).toBe("Editar la fila 3: Factura A 0003-00001245");
    expect(nombreBotonEditar(true, 3, f as Fila)).toBe("Editando la fila 3: Factura A 0003-00001245");
  });
  it("sin datos del comprobante, usa el nombre del archivo", () => {
    const [f] = planilla(null);
    expect(nombreBotonEditar(false, 11, f as Fila)).toBe("Editar la fila 11: a-1.pdf");
  });
});

describe("datos de las barras de título (13.4)", () => {
  it("facturas recibidas: vacío, procesando y cantidad", () => {
    expect(metaComprobantes({ procesando: false, actual: 0, total: 0, cantidad: 0 })).toBe("");
    expect(metaComprobantes({ procesando: false, actual: 0, total: 0, cantidad: 1 })).toBe("1 comprobante");
    expect(metaComprobantes({ procesando: false, actual: 0, total: 0, cantidad: 11 })).toBe("11 comprobantes");
    expect(metaComprobantes({ procesando: true, actual: 3, total: 12, cantidad: 2 })).toBe("Procesando 3 de 12");
  });

  it("lo ya cargado: 'Opcional' hasta que hay registro", () => {
    expect(metaRegistro(null)).toBe("Opcional");
    expect(metaRegistro(6)).toBe("6 registros");
    expect(metaRegistro(1)).toBe("1 registro");
  });

  it("resultado: vacío, sin registro, cuánto falta y cero", () => {
    expect(metaResultado(0, null)).toBe("");
    expect(metaResultado(11, null)).toBe("Sin registro para cruzar");
    expect(metaResultado(11, unResumen({ faltan: 2 }))).toBe("Falta cargar 2 facturas");
    expect(metaResultado(11, unResumen({ faltan: 1 }))).toBe("Falta cargar 1 factura");
    expect(metaResultado(11, unResumen({ faltan: 0, yaCargadas: 5 }))).toBe("No falta cargar nada");
  });

  it("planilla: el total y, con filtro, 'N de M'", () => {
    expect(metaPlanilla(0, 0)).toBe("");
    expect(metaPlanilla(11, 11)).toBe("11 comprobantes");
    expect(metaPlanilla(1, 1)).toBe("1 comprobante");
    expect(metaPlanilla(2, 11)).toBe("2 de 11");
    expect(metaPlanilla(0, 11)).toBe("0 de 11");
  });
});

describe("A1: anuncios para lectores de pantalla", () => {
  it("al filtrar: 'Mostrando N de M comprobantes'", () => {
    expect(textoMostrando(2, 11)).toBe("Mostrando 2 de 11 comprobantes");
    expect(textoMostrando(11, 11)).toBe("Mostrando 11 de 11 comprobantes");
    expect(textoMostrando(0, 11)).toBe("Mostrando 0 de 11 comprobantes");
    expect(textoMostrando(1, 1)).toBe("Mostrando 1 de 1 comprobante");
  });

  it("al terminar la conciliación: lo que falta y lo que requiere atención", () => {
    const r = unResumen({
      faltan: 2,
      faltanPorMoneda: [
        { moneda: "PES", nombre: "Pesos (PES)", total: 6120, cantidad: 1 },
        { moneda: "DOL", nombre: "Dólares (DOL)", total: 1250, cantidad: 1 },
      ],
      revisar: 3,
      conDiferencias: 2,
      duplicadas: 1,
      cargadasDosVeces: 1,
      noRecibidas: 2,
    });
    expect(anuncioConciliacion(r)).toBe(
      "Conciliación terminada. Falta cargar 2 facturas por $ 6.120,00 y US$ 1.250,00. " +
        "Requieren atención: 3 para revisar, 2 mal cargadas, 1 duplicada en la planilla, 1 cargada dos veces en el sistema, 2 cargadas en el sistema y no recibidas.",
    );
  });

  it("singular, sin montos y sin nada que atender", () => {
    expect(anuncioConciliacion(unResumen({ faltan: 1, revisar: 1 }))).toBe(
      "Conciliación terminada. Falta cargar 1 factura. Requieren atención: 1 para revisar.",
    );
    expect(anuncioConciliacion(unResumen({ faltan: 0, yaCargadas: 4 }))).toBe(
      "Conciliación terminada. No falta cargar ningún comprobante. Nada requiere atención.",
    );
  });
});
