// Pestaña «Pagos»: arma y actualiza los elementos de `index.html` (panel #panel-pagos). Qué se dice y con qué tono lo decide
// `vista-pagos.ts` (puro, con tests); el cruce es `cuentas-a-pagar.ts`. Todo texto que viene de un archivo (referencias, conceptos,
// usuarios, nombres) entra con `textContent`, nunca como HTML.
//
// Cómo se mantiene al día: `actualizar()` lo llama `main.ts` cada vez que cambia la planilla (o la fecha de referencia y el umbral de
// antigüedad, que son los mismos que usa la planilla). Solo recalcula si algo de lo que entra al cruce cambió de verdad, así que
// tipear en un campo de la planilla no redibuja las tablas de pagos.

import type { Referencia } from "./antiguedad.ts";
import { formatearFecha, formatearMonto } from "./comprobante.ts";
import { LIMITE_BYTES } from "./conciliacion.ts";
import { diaParaArchivo, facturasPagosACsv, pagosACsv } from "./csv-pagos.ts";
import {
  TOLERANCIA_CENTAVOS_POR_DEFECTO,
  conciliarPagos,
  facturasDeFilas,
  type CodigoAviso,
  type ConciliacionPagos,
  type FacturaAPagar,
  type FacturaOmitida,
  type ResultadoPago,
  type SituacionFactura,
} from "./cuentas-a-pagar.ts";
import { formatearCuit } from "./cuit.ts";
import { crearEtiqueta, hijo, marcaSinDato, pintarMensaje, textoDeAccion, type TonoMensaje } from "./dom.ts";
import { leerExtracto, type LecturaExtracto } from "./extracto.ts";
import { icono } from "./iconos.ts";
import { irA } from "./navegacion.ts";
import type { Fila } from "./planilla.ts";
import { decodificarTexto } from "./texto.ts";
import { estadoDeZona, limitarLista, tituloComprobante, type EstadoZona } from "./vista.ts";
import {
  ID_BLOQUE,
  anuncioDeMensaje,
  anuncioPagos,
  candidatasDePago,
  conteosFacturas,
  cuitDelPago,
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
  metaExtracto,
  metaFacturasPagos,
  metaPagosLista,
  metaResultadoPagos,
  nombreFactura,
  protagonistaPagos,
  textoErrorExtracto,
  textoExtractoCargado,
  textoFacturasAConciliar,
  textoMostrandoFacturas,
  textosZonaExtracto,
  type FiltroFacturasPagos,
} from "./vista-pagos.ts";

/** Cuántas filas se dibujan de una vez en cada tabla (un extracto puede tener 20.000 líneas); el resto se pide con un botón. */
export const LIMITE_FILAS_PAGOS = 100;

type FiltroListaPagos = "todos" | "emparejados" | "excepciones";

export interface ContextoPagos {
  /** Las filas de la planilla de facturas: de ahí salen las facturas que se concilian. */
  filas: () => readonly Fila[];
  /** La fecha de referencia vigente (la misma de la antigüedad en la planilla). */
  referencia: () => Referencia;
  /** Desde cuántos días una factura sin pagar se marca como antigua (el mismo umbral de la planilla). */
  umbral: () => number;
  /** Mensaje para lectores de pantalla (región de estado de la página). */
  anunciar: (texto: string) => void;
}

export interface ControlPagos {
  /** Vuelve a cruzar si cambió algo que entra al cruce (la planilla, la fecha de referencia, el umbral) y redibuja. */
  actualizar: () => void;
  /** Lee el texto de un extracto y lo concilia. `false` si no se pudo leer (y dice por qué). */
  cargarTexto: (texto: string, origen: string) => boolean;
  /** La región de estado de la ventana del extracto: ahí se escriben los avisos de la pestaña. */
  mensajes: HTMLElement;
  /** `true` si hay un extracto cargado. */
  hayExtracto: () => boolean;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Falta el elemento #${id} en index.html`);
  return e as T;
}

function esTactil(): boolean {
  return window.matchMedia("(hover: none)").matches;
}

function pesos(n: number): string {
  return formatearMonto("PES", n);
}

interface Calculo {
  clave: string;
  facturas: FacturaAPagar[];
  omitidas: FacturaOmitida[];
  conc: ConciliacionPagos | null;
  referencia: Referencia;
  umbral: number;
}

export function iniciarPagos(ctx: ContextoPagos): ControlPagos {
  const panel = el("panel-pagos");
  const zona = el("zona-extracto");
  const entrada = el<HTMLInputElement>("archivo-extracto");
  const textoZona = el("estado-zona-extracto");
  const botonQuitar = el<HTMLButtonElement>("quitar-extracto");
  const mensajes = el<HTMLParagraphElement>("mensajes-pagos");
  const notaFacturas = el("facturas-a-conciliar");
  const metaExtractoEl = el("meta-extracto");
  const metaResultadoEl = el("meta-resultado-pagos");
  const metaExcepcionesEl = el("meta-excepciones-pagos");
  const metaFacturasEl = el("meta-facturas-pagos");
  const metaListaEl = el("meta-lista-pagos");
  const vacio = el("vacio-pagos");
  const resumen = el("resumen-pagos");
  const principal = el("pagos-principal");
  const atencion = el("pagos-atencion");
  const menor = el("pagos-menor");
  const sinExcepciones = el("sin-excepciones");
  const cuerpoFacturas = el("cuerpo-facturas-pagos");
  const cuerpoPagos = el("cuerpo-lista-pagos");
  const masFacturasCaja = el("mas-facturas-pagos-caja");
  const masFacturas = el<HTMLButtonElement>("mas-facturas-pagos");
  const masPagosCaja = el("mas-lista-pagos-caja");
  const masPagos = el<HTMLButtonElement>("mas-lista-pagos");
  const grupoFacturas = el("filtros-facturas-pagos");

  let lectura: LecturaExtracto | null = null;
  let origen = "";
  /** Cambia con cada extracto cargado o quitado: forma parte de la clave del cálculo. */
  let version = 0;
  let calculo: Calculo | null = null;
  let filtroFacturas: FiltroFacturasPagos = "todas";
  let filtroPagos: FiltroListaPagos = "todos";
  let todasLasFacturas = false;
  let todosLosPagos = false;
  const zonaEstado = { arrastrando: false, error: "" };

  // Las tablas pasan a lista en pantallas angostas (display distinto de table): los roles van explícitos para no perder la semántica.
  for (const tabla of [el("tabla-facturas-pagos"), el("tabla-lista-pagos")]) {
    tabla.setAttribute("role", "table");
    for (const parte of tabla.querySelectorAll("thead, tbody")) parte.setAttribute("role", "rowgroup");
    for (const tr of tabla.querySelectorAll("thead tr")) tr.setAttribute("role", "row");
    for (const th of tabla.querySelectorAll("thead th")) th.setAttribute("role", "columnheader");
  }

  function avisar(texto: string, tono: TonoMensaje = "info"): void {
    // Un error de lectura se anuncia como alerta (WCAG 4.1.3); lo demás, como estado.
    const { role, live } = anuncioDeMensaje(tono);
    mensajes.setAttribute("role", role);
    mensajes.setAttribute("aria-live", live);
    pintarMensaje(mensajes, texto, tono);
  }

  // ---------------------------------------------------------------- Cálculo

  /** Cruza de nuevo si cambió algo que entra al cruce. `true` si hay un cálculo nuevo. */
  function calcular(): boolean {
    const { facturas, omitidas } = facturasDeFilas(ctx.filas());
    const referencia = ctx.referencia();
    const umbral = ctx.umbral();
    const clave = JSON.stringify([
      version,
      referencia.fecha,
      referencia.origen,
      umbral,
      facturas.map((f) => [f.id, f.cuit, f.tipoCmp, f.ptoVta, f.nroCmp, f.fecha, f.importe, f.origen]),
      omitidas.map((o) => [o.id, o.motivo]),
    ]);
    if (calculo !== null && calculo.clave === clave) return false;
    const conc = lectura === null ? null : conciliarPagos(facturas, lectura.pagos, { hoy: referencia.fecha, umbralAntiguedad: umbral });
    calculo = { clave, facturas, omitidas, conc, referencia, umbral };
    return true;
  }

  // ---------------------------------------------------------------- La zona de carga

  function estadoZona(): EstadoZona {
    return estadoDeZona({ arrastrando: zonaEstado.arrastrando, procesando: false, error: zonaEstado.error, hayDatos: lectura !== null });
  }

  function pintarZona(): void {
    const estado = estadoZona();
    const textos = textosZonaExtracto(estado, { tactil: esTactil(), cantidad: lectura?.pagos.length ?? 0, origen: origen === "ejemplo" ? "ejemplo" : origen, error: zonaEstado.error });
    zona.dataset.estado = estado;
    textoZona.textContent = textos.titulo;
    const ayuda = zona.querySelector<HTMLElement>(".zona-ayuda");
    if (ayuda) {
      ayuda.replaceChildren();
      if (estado === "error") ayuda.appendChild(icono("alerta"));
      ayuda.append(textos.ayuda);
      ayuda.hidden = textos.ayuda === "";
    }
    const accion = zona.querySelector<HTMLElement>(".zona-accion");
    if (accion && textos.accion !== "") accion.textContent = textos.accion;
  }

  function errorDeExtracto(texto: string): void {
    const mensaje = textoErrorExtracto(texto, lectura !== null);
    zonaEstado.error = mensaje;
    avisar(mensaje, "error");
    pintarZona();
  }

  // ---------------------------------------------------------------- Resultado

  function pintarProtagonista(c: ConciliacionPagos): void {
    const p = protagonistaPagos(c);
    principal.dataset.tono = p.tono;
    principal.dataset.variante = p.variante;
    principal.replaceChildren();
    hijo(principal, "p", "rotulo-resultado", p.rotulo);
    const linea = hijo(principal, "p", "cifra-linea");
    if (p.variante === "cero") linea.appendChild(icono("check", "icono icono-grande"));
    hijo(linea, "strong", "cifra", p.cifra);
    linea.append(" ");
    hijo(linea, "span", "cifra-unidad", p.unidad);
    if (p.montos.length > 0) {
      const montos = hijo(principal, "p", "montos");
      hijo(montos, "span", "solo-lectores", "por ");
      p.montos.forEach((monto) => hijo(montos, "span", "monto", monto));
    }
    if (p.mensaje !== "") hijo(principal, "p", "mensaje-resultado", p.mensaje);
    if (p.accion) {
      const boton = hijo(principal, "button", "boton", p.accion.texto);
      boton.type = "button";
      boton.addEventListener("click", () => verFacturas(p.accion?.filtro ?? "falta"));
    }
  }

  function pintarAtencion(c: ConciliacionPagos, ilegibles: number, umbral: number): void {
    const items = itemsAtencionPagos(c, ilegibles, umbral);
    const lista = atencion.querySelector<HTMLUListElement>("ul") ?? hijo(atencion, "ul", "lista-atencion");
    lista.replaceChildren();
    if (items.length === 0) {
      const li = hijo(lista, "li", "atencion-nada");
      li.append(icono("check"), document.createTextNode("Nada requiere atención."));
    }
    for (const item of items) {
      const li = hijo(lista, "li", "atencion-item");
      li.dataset.tono = item.tono;
      li.appendChild(icono(item.icono));
      hijo(li, "strong", "atencion-cifra", String(item.cifra));
      hijo(li, "span", "atencion-texto", item.texto);
      const boton = hijo(li, "button", "boton-enlace atencion-accion");
      boton.type = "button";
      textoDeAccion(boton, "Ver detalle");
      boton.setAttribute("aria-label", `Ver detalle: ${item.cifra} ${item.texto}`);
      const destino = item.destino;
      boton.addEventListener("click", () => {
        if (destino.tipo === "facturas") verFacturas("falta");
        else irA(document.getElementById(destino.id)?.querySelector<HTMLElement>("h3") ?? null);
      });
    }
  }

  // ---------------------------------------------------------------- Excepciones

  /** Llena un bloque de la bandeja: lo muestra si hay algo (con tope de renglones y «y N más») y lo oculta si no. */
  function llenarBloque<T>(id: string, datos: readonly T[], pintarItem: (li: HTMLLIElement, dato: T) => void): void {
    const seccion = el(id);
    const lista = el<HTMLUListElement>(`lista-${id}`);
    lista.replaceChildren();
    seccion.hidden = datos.length === 0;
    const limitada = limitarLista(datos);
    for (const dato of limitada.visibles) pintarItem(hijo(lista, "li"), dato);
    if (limitada.resto > 0) hijo(lista, "li", "lista-resto", limitada.textoResto);
  }

  function pintarExcepciones(c: ConciliacionPagos, conc: Calculo, ilegibles: readonly { linea: number; motivo: string }[]): void {
    const filas = ctx.filas();
    const situaciones = new Map(c.facturas.map((s) => [s.factura.id, s] as const));
    const pagoDe = (li: HTMLLIElement, r: ResultadoPago, motivo: string): HTMLElement => {
      hijo(li, "strong", "exc-linea", lineaDePago(r.pago));
      hijo(li, "span", "exc-motivo", motivo);
      return li;
    };

    llenarBloque(ID_BLOQUE.sinFactura, c.sinFactura, (li, r) => pagoDe(li, r, r.porQue));
    llenarBloque(ID_BLOQUE.revisar, c.paraRevisar, (li, r) => {
      pagoDe(li, r, r.porQue);
      const candidatas = candidatasDePago(r, situaciones);
      if (candidatas.length > 0) hijo(li, "span", "exc-candidatas", `Podría ser: ${candidatas.join("; ")}.`);
    });
    llenarBloque(ID_BLOQUE.duplicados, c.duplicados, (li, r) => pagoDe(li, r, r.porQue));
    const avisosDe = (codigo: CodigoAviso): ResultadoPago[] =>
      c.pagos.filter((r) => r.avisos.some((a) => a.codigo === codigo));
    llenarBloque(ID_BLOQUE.mismoUsuario, avisosDe("mismo-usuario"), (li, r) =>
      pagoDe(li, r, r.avisos.find((a) => a.codigo === "mismo-usuario")?.mensaje ?? ""),
    );
    llenarBloque(ID_BLOQUE.cuitInvalido, avisosDe("cuit-invalido"), (li, r) =>
      pagoDe(li, r, r.avisos.find((a) => a.codigo === "cuit-invalido")?.mensaje ?? ""),
    );
    llenarBloque(ID_BLOQUE.operacionRepetida, avisosDe("operacion-repetida"), (li, r) =>
      pagoDe(li, r, r.avisos.find((a) => a.codigo === "operacion-repetida")?.mensaje ?? ""),
    );
    llenarBloque(ID_BLOQUE.lineasIlegibles, ilegibles, (li, l) => {
      hijo(li, "strong", "exc-linea", `Línea ${l.linea}`);
      hijo(li, "span", "exc-motivo", l.motivo);
    });
    llenarBloque("exc-omitidas", conc.omitidas, (li, o) => {
      const indice = filas.findIndex((f) => f.id === o.id);
      const fila = indice >= 0 ? filas[indice] : undefined;
      hijo(li, "strong", "exc-linea", fila === undefined ? "Factura" : `Fila ${indice + 1} · ${tituloComprobante(fila)}`);
      hijo(li, "span", "exc-motivo", o.motivo);
    });

    const hayAlgo = c.sinFactura.length + c.paraRevisar.length + c.duplicados.length + c.avisos.length + ilegibles.length + conc.omitidas.length > 0;
    sinExcepciones.hidden = hayAlgo;
    metaExcepcionesEl.textContent = metaExcepciones(c, ilegibles.length, conc.omitidas.length);
  }

  // ---------------------------------------------------------------- Tablas

  function fila(tbody: HTMLElement, estado: string): HTMLTableRowElement {
    const tr = hijo(tbody, "tr");
    tr.setAttribute("role", "row");
    tr.dataset.estado = estado;
    return tr;
  }

  function celda(tr: HTMLElement, clase: string, etiqueta: string): HTMLTableCellElement {
    const td = hijo(tr, "td", clase);
    td.setAttribute("role", "cell");
    td.dataset.etiqueta = etiqueta;
    return td;
  }

  /** Un valor de una celda numérica, o la marca de «sin dato» si no corresponde mostrar nada. */
  function ponerMonto(td: HTMLElement, valor: number | null): void {
    if (valor === null) td.replaceChildren(marcaSinDato());
    else td.textContent = pesos(valor);
  }

  function dibujarFactura(tbody: HTMLElement, s: SituacionFactura, umbral: number): HTMLTableRowElement {
    const f = s.factura;
    const tr = fila(tbody, s.estado);
    if (s.antigua) tr.dataset.antigua = "true";
    if (s.enRevision.length > 0) tr.dataset.revision = "true";

    const estado = celda(tr, "p-estado", "Estado");
    estado.appendChild(crearEtiqueta(etiquetaFactura(s)));
    const antigua = etiquetaAntiguaPago(s, umbral);
    if (antigua) estado.appendChild(crearEtiqueta(antigua, "etiqueta-antigua"));

    const factura = celda(tr, "p-factura", "Factura");
    // El comprobante nombra la fila, así que es su cabecera (como en la planilla).
    factura.setAttribute("role", "rowheader");
    hijo(factura, "span", "linea-1", nombreFactura(f));
    const cuit = formatearCuit(f.cuit);
    const meta = hijo(factura, "span", "linea-2");
    hijo(meta, "span", "codigo", cuit);
    for (const texto of detalleFactura(s)) hijo(factura, "span", "detalle-pago", texto);

    celda(tr, "p-fecha", "Fecha").textContent = formatearFecha(f.fecha);
    celda(tr, "p-importe", "Importe").textContent = pesos(f.importe);
    ponerMonto(celda(tr, "p-importe p-pagado", "Pagado"), s.pagado > 0 ? s.pagado : null);
    ponerMonto(celda(tr, "p-importe p-saldo", "Saldo"), s.estado === "pagada" && s.saldo === 0 ? null : s.saldo);
    const dias = celda(tr, "p-dias", "Días");
    if (s.estado === "pagada" || s.dias === null) dias.replaceChildren(marcaSinDato());
    else dias.textContent = String(s.dias);
    return tr;
  }

  /** `facturasPorId` y `situaciones` se arman una vez por tabla (con 20.000 pagos, una vez por fila serían millones de inserciones). */
  function dibujarPago(
    tbody: HTMLElement,
    r: ResultadoPago,
    facturasPorId: ReadonlyMap<number, FacturaAPagar>,
    situaciones: ReadonlyMap<number, SituacionFactura>,
  ): HTMLTableRowElement {
    const p = r.pago;
    const tr = fila(tbody, r.estado);
    if (r.avisos.length > 0) tr.dataset.aviso = "true";

    celda(tr, "p-linea", "Línea").textContent = String(p.linea);
    celda(tr, "p-estado", "Resultado").appendChild(crearEtiqueta(etiquetaPago(r)));

    const pago = celda(tr, "p-pago", "Pago");
    pago.setAttribute("role", "rowheader");
    hijo(pago, "span", "linea-1", formatearFecha(p.fecha));
    const cuit = cuitDelPago(p);
    const meta = hijo(pago, "span", "linea-2");
    if (cuit === "") meta.appendChild(marcaSinDato());
    else hijo(meta, "span", p.cuit === "" ? "codigo codigo-ilegible" : "codigo", cuit);
    const texto = [p.referencia !== "" ? `Ref.: ${p.referencia}` : "", p.concepto !== "" ? p.concepto : ""].filter((x) => x !== "").join(" · ");
    if (texto !== "") hijo(pago, "span", "detalle-pago", texto);
    const usuarios = [p.cargo !== "" ? `Cargó ${p.cargo}` : "", p.autorizo !== "" ? `Autorizó ${p.autorizo}` : ""].filter((x) => x !== "").join(" · ");
    if (usuarios !== "") hijo(pago, "span", "detalle-pago", usuarios);

    celda(tr, "p-importe", "Importe").textContent = pesos(p.importe);

    const motivo = celda(tr, "p-motivo", "Con qué factura y por qué");
    const aplicadas = imputacionesDePago(r, facturasPorId);
    for (const a of aplicadas) hijo(motivo, "strong", "pago-factura", a);
    hijo(motivo, "span", "pago-porque", r.porQue);
    const candidatas = candidatasDePago(r, situaciones);
    if (candidatas.length > 0) hijo(motivo, "span", "pago-porque", `Podría ser: ${candidatas.join("; ")}.`);
    if (r.estado === "emparejado" && r.sinImputar > 0) hijo(motivo, "span", "pago-porque", `Quedan ${pesos(r.sinImputar)} sin aplicar a ninguna factura.`);
    for (const aviso of r.avisos) {
      const linea = hijo(motivo, "span", "pago-aviso");
      linea.append(icono("alerta"), document.createTextNode(aviso.mensaje));
    }
    return tr;
  }

  function ponerConteo(id: string, n: number): void {
    const e = el(id);
    e.textContent = String(n);
    if (n === 0) e.setAttribute("data-cero", "");
    else e.removeAttribute("data-cero");
  }

  function facturasVisibles(c: ConciliacionPagos): SituacionFactura[] {
    const lista = c.facturas.filter((s) => facturaVisible(s, filtroFacturas));
    // Lo que falta pagar va de la más antigua a la más nueva: lo primero que conviene mirar.
    if (filtroFacturas === "falta") lista.sort((a, b) => a.factura.fecha.localeCompare(b.factura.fecha) || a.factura.id - b.factura.id);
    return lista;
  }

  function pagosVisibles(c: ConciliacionPagos): ResultadoPago[] {
    if (filtroPagos === "emparejados") return c.pagos.filter((r) => r.estado === "emparejado");
    if (filtroPagos === "excepciones") return c.pagos.filter((r) => r.estado !== "emparejado" || r.avisos.length > 0);
    return [...c.pagos];
  }

  function pintarFacturas(c: ConciliacionPagos, conc: Calculo): void {
    const conteos = conteosFacturas(c);
    ponerConteo("conteo-fp-todas", conteos.todas);
    ponerConteo("conteo-fp-falta", conteos.falta);
    ponerConteo("conteo-fp-pagadas", conteos.pagadas);
    const lista = facturasVisibles(c);
    const mostradas = todasLasFacturas ? lista : lista.slice(0, LIMITE_FILAS_PAGOS);
    cuerpoFacturas.replaceChildren();
    for (const s of mostradas) dibujarFactura(cuerpoFacturas, s, conc.umbral);
    metaFacturasEl.textContent = metaFacturasPagos(lista.length, c.facturas.length);
    const restantes = lista.length - mostradas.length;
    masFacturasCaja.hidden = restantes <= 0;
    masFacturas.textContent = `Mostrar las ${restantes.toLocaleString("es-AR")} restantes`;
    if (c.facturas.length === 0) {
      const tr = hijo(cuerpoFacturas, "tr", "fila-vacia");
      tr.setAttribute("role", "row");
      const td = hijo(tr, "td", undefined, "No hay facturas en la planilla para conciliar con este extracto.");
      td.setAttribute("role", "cell");
      td.colSpan = 7;
    }
  }

  function pintarPagos(c: ConciliacionPagos, conc: Calculo): void {
    const excepciones = c.pagos.filter((r) => r.estado !== "emparejado" || r.avisos.length > 0).length;
    ponerConteo("conteo-lp-todos", c.pagos.length);
    ponerConteo("conteo-lp-emparejados", c.resumen.emparejados);
    ponerConteo("conteo-lp-excepciones", excepciones);
    const lista = pagosVisibles(c);
    const mostrados = todosLosPagos ? lista : lista.slice(0, LIMITE_FILAS_PAGOS);
    cuerpoPagos.replaceChildren();
    const facturasPorId = new Map(conc.facturas.map((f) => [f.id, f] as const));
    const situaciones = new Map(c.facturas.map((s) => [s.factura.id, s] as const));
    for (const r of mostrados) dibujarPago(cuerpoPagos, r, facturasPorId, situaciones);
    metaListaEl.textContent = lista.length === c.pagos.length ? metaPagosLista(c.pagos.length) : `${lista.length} de ${c.pagos.length}`;
    const restantes = lista.length - mostrados.length;
    masPagosCaja.hidden = restantes <= 0;
    masPagos.textContent = `Mostrar los ${restantes.toLocaleString("es-AR")} restantes`;
  }

  // ---------------------------------------------------------------- Todo junto

  function pintar(): void {
    pintarZona();
    const conc = calculo;
    const c = conc?.conc ?? null;
    const hay = lectura !== null && c !== null && conc !== null;
    panel.toggleAttribute("data-con-extracto", hay);
    botonQuitar.hidden = !hay;
    metaExtractoEl.textContent = metaExtracto(lectura === null ? null : lectura.pagos.length);
    notaFacturas.textContent = conc === null ? "" : textoFacturasAConciliar(conc.facturas.length, conc.omitidas.length);
    vacio.hidden = hay;
    resumen.hidden = !hay;
    metaResultadoEl.textContent = metaResultadoPagos(c);
    menor.textContent = hay && conc !== null ? lineaMenorPagos(TOLERANCIA_CENTAVOS_POR_DEFECTO, conc.referencia) : "";
    if (!hay || c === null || conc === null || lectura === null) {
      cuerpoFacturas.replaceChildren();
      cuerpoPagos.replaceChildren();
      return;
    }
    pintarProtagonista(c);
    pintarAtencion(c, lectura.lineasInvalidas.length, conc.umbral);
    pintarExcepciones(c, conc, lectura.lineasInvalidas);
    pintarFacturas(c, conc);
    pintarPagos(c, conc);
  }

  /** «Ver» desde el resultado: deja la lista de facturas en un filtro y lleva el foco a su título. */
  function verFacturas(filtro: FiltroFacturasPagos): void {
    filtroFacturas = filtro;
    todasLasFacturas = false;
    for (const radio of grupoFacturas.querySelectorAll<HTMLInputElement>("input[type=radio]")) radio.checked = radio.value === filtro;
    pintar();
    if (calculo?.conc) {
      const visibles = facturasVisibles(calculo.conc).length;
      ctx.anunciar(textoMostrandoFacturas(visibles, calculo.conc.facturas.length));
    }
    irA(document.getElementById("titulo-facturas-pagos"));
  }

  // ---------------------------------------------------------------- Cargar, quitar y exportar

  function cargarTexto(texto: string, nombre: string): boolean {
    const r = leerExtracto(texto);
    if (r instanceof Error) {
      errorDeExtracto(r.message);
      return false;
    }
    zonaEstado.error = "";
    lectura = r;
    origen = nombre;
    version++;
    todasLasFacturas = false;
    todosLosPagos = false;
    calcular();
    pintar();
    const conc = calculo;
    avisar(textoExtractoCargado(nombre, r, conc?.facturas.length ?? 0), "ok");
    // Al terminar de conciliar se anuncia el resumen: lo que se pagó, lo que falta y lo que requiere atención.
    if (conc?.conc) ctx.anunciar(anuncioPagos(conc.conc, r.lineasInvalidas.length, conc.umbral));
    return true;
  }

  async function procesarArchivo(archivo: File | undefined): Promise<void> {
    if (!archivo) return;
    if (archivo.size === 0) return errorDeExtracto("El archivo está vacío.");
    if (archivo.size > LIMITE_BYTES) return errorDeExtracto("El archivo supera el máximo de 2 MB.");
    try {
      // UTF-8, UTF-16 con BOM (el «Texto Unicode» de Excel) o Windows-1252; si no se puede, el error dice por qué.
      const texto = decodificarTexto(new Uint8Array(await archivo.arrayBuffer()));
      if (texto instanceof Error) errorDeExtracto(texto.message);
      else cargarTexto(texto, archivo.name);
    } catch {
      errorDeExtracto("No se pudo leer el archivo.");
    }
  }

  function descargar(nombre: string, contenido: string): void {
    const blob = new Blob([contenido], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  entrada.addEventListener("change", () => {
    const archivo = entrada.files?.[0];
    entrada.value = "";
    void procesarArchivo(archivo);
  });
  zona.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!zonaEstado.arrastrando) {
      zonaEstado.arrastrando = true;
      pintarZona();
    }
  });
  zona.addEventListener("dragleave", (e) => {
    if (e.relatedTarget instanceof Node && zona.contains(e.relatedTarget)) return;
    zonaEstado.arrastrando = false;
    pintarZona();
  });
  zona.addEventListener("drop", (e) => {
    e.preventDefault();
    zonaEstado.arrastrando = false;
    pintarZona();
    void procesarArchivo(e.dataTransfer?.files?.[0]);
  });

  botonQuitar.addEventListener("click", () => {
    lectura = null;
    origen = "";
    version++;
    zonaEstado.error = "";
    calcular();
    pintar();
    ctx.anunciar("");
    avisar("Extracto quitado. Las facturas siguen en la planilla.");
    // El botón desaparece al quitar: el foco pasa a la zona de carga para no perderlo.
    entrada.focus({ preventScroll: true });
  });

  for (const [id, filtro] of [["filtros-facturas-pagos", "facturas"], ["filtros-lista-pagos", "pagos"]] as const) {
    for (const radio of el(id).querySelectorAll<HTMLInputElement>("input[type=radio]")) {
      radio.addEventListener("change", () => {
        if (filtro === "facturas") {
          filtroFacturas = radio.value === "falta" || radio.value === "pagadas" ? radio.value : "todas";
          todasLasFacturas = false;
        } else {
          filtroPagos = radio.value === "emparejados" || radio.value === "excepciones" ? radio.value : "todos";
          todosLosPagos = false;
        }
        pintar();
        const c = calculo?.conc;
        if (!c) return;
        ctx.anunciar(
          filtro === "facturas"
            ? textoMostrandoFacturas(facturasVisibles(c).length, c.facturas.length)
            : `Mostrando ${pagosVisibles(c).length} de ${c.pagos.length} ${c.pagos.length === 1 ? "pago" : "pagos"}`,
        );
      });
    }
  }

  /** Mostrar más filas: el botón desaparece, así que el foco pasa a la primera fila nueva (sin ella se perdería). */
  function mostrarResto(cuerpo: HTMLElement, cuantasHabia: number, activar: () => void): void {
    activar();
    pintar();
    const primera = cuerpo.children[cuantasHabia];
    if (primera instanceof HTMLElement) {
      primera.tabIndex = -1;
      primera.focus({ preventScroll: true });
    }
  }
  masFacturas.addEventListener("click", () => mostrarResto(cuerpoFacturas, LIMITE_FILAS_PAGOS, () => (todasLasFacturas = true)));
  masPagos.addEventListener("click", () => mostrarResto(cuerpoPagos, LIMITE_FILAS_PAGOS, () => (todosLosPagos = true)));

  el("exportar-lista-pagos").addEventListener("click", () => {
    const conc = calculo;
    if (!conc?.conc) return;
    descargar(`pagos-conciliados-${diaParaArchivo(new Date())}.csv`, pagosACsv(conc.conc, conc.facturas));
    avisar("CSV de pagos exportado. Se abre en Excel con separador punto y coma.", "ok");
  });
  el("exportar-facturas-pagos").addEventListener("click", () => {
    const conc = calculo;
    if (!conc?.conc) return;
    descargar(`facturas-con-estado-de-pago-${diaParaArchivo(new Date())}.csv`, facturasPagosACsv(conc.conc));
    avisar("CSV de facturas con su estado de pago exportado. Se abre en Excel con separador punto y coma.", "ok");
  });

  function actualizar(): void {
    if (calcular()) pintar();
  }

  calcular();
  pintar();
  return { actualizar, cargarTexto, mensajes, hayExtracto: () => lectura !== null };
}
