// Interfaz. Todo el texto que viene de datos del usuario se inserta con textContent / value, nunca como HTML.
// Qué se dice y con qué tono lo decide `vista.ts` (puro, con tests); aquí solo se arman y se actualizan los elementos.
// Los ids, clases y atributos que se usan acá son los de `index.html` y los estilos.

import "./estilos.css";
import {
  UMBRAL_ANTIGUEDAD_POR_DEFECTO,
  diasDeFila,
  ordenarPorAntiguedad,
  resolverReferencia,
  textoReferencia,
  contarAntiguas,
  type Referencia,
  validarFechaReferencia,
  validarUmbral,
} from "./antiguedad.ts";
import {
  NOMBRES_TIPO,
  formatearFecha,
  formatearMonto,
  formatearNumeroCmp,
  nombreTipo,
  simboloMoneda,
  formatearImporte,
  type Campo,
  type Comprobante,
} from "./comprobante.ts";
import {
  LIMITE_BYTES,
  conciliar,
  filasCargadasDosVeces,
  partesClaveRepetida,
  describirEncabezadosDuplicados,
  describirImportesExcesivos,
  describirLineasInvalidas,
  partesRegistro,
  itemsAtencion,
  leerRegistro,
  lineaMenor,
  mostrarConFiltro,
  resumenConciliacion,
  type Conciliacion,
  type FiltroFilas,
  type LecturaRegistro,
} from "./conciliacion.ts";
import { aCsv } from "./csv.ts";
import { formatearCuit } from "./cuit.ts";
import { confirmacionPermitida } from "./confirmacion.ts";
import { esFilaDeEjemplo, generarEjemplos, registroEjemplo } from "./ejemplos.ts";
import { cerrarGlobo, iniciarGuia } from "./guia.ts";
import { icono } from "./iconos.ts";
import { ErrorLectura, cancelarLecturas, textosQrDeArchivo } from "./lectura.ts";
import { procesarLote, type Lectura } from "./lote.ts";
import { desplazarA, irA } from "./navegacion.ts";
import { acomodarNodos } from "./orden-dom.ts";
import {
  agregarFila,
  crearFila,
  duplicadas,
  editarFila,
  estadoFila,
  quitarFila,
  resumen,
  siguienteId,
  totalesPorMoneda,
  type Fila,
} from "./planilla.ts";
import { ErrorQr, leerUrlQr } from "./qr-arca.ts";
import { decodificarTexto } from "./texto.ts";
import {
  ETIQUETA_EDITADA,
  anuncioConciliacion,
  anuncioOrden,
  anuncioReferencia,
  anuncioUmbral,
  avisosDeFila,
  conteosFiltros,
  detalleFilaPartes,
  estadoDeZona,
  etiquetaConciliacion,
  etiquetaAntigua,
  etiquetaDuplicada,
  etiquetaLectura,
  limitarLista,
  metaComprobantes,
  metaPlanilla,
  metaRegistro,
  metaResultado,
  monedaDeRegistro,
  nombreBotonEditar,
  presentarAtencion,
  protagonista,
  resumenAntiguedad,
  textoErrorRegistro,
  textoFinalLote,
  textoLectura,
  textoMostrando,
  textosZonaComprobantes,
  textosZonaRegistro,
  tituloComprobante,
  totalesVista,
  type EstadoZona,
  type EtiquetaVista,
  describedbyConError,
  textoPlanillaVaciada,
  textoRegistroCargado,
  type ParteDetalle,
  type TextosZona,
} from "./vista.ts";
import { desplegarSiHaceFalta, iniciarVentanas } from "./ventanas.ts";

// ------------------------------------------------------------------ Configuración

/**
 * D5: mientras el repositorio sea privado el enlace "Código fuente" da 404, así que se oculta.
 * Al publicarlo hay que cambiar solo estas dos líneas: la dirección del repositorio público y este interruptor.
 */
const URL_REPOSITORIO_PUBLICO = "https://github.com/aslow01/demo-lector-facturas";
const REPOSITORIO_PUBLICO = true;
const DESTELLO_FILA_NUEVA_EN_MS = 1200;

// ------------------------------------------------------------------ Estado y elementos

let filas: Fila[] = [];
/** Registro de lo ya cargado en el sistema de gestión (opcional) y el cruce con la planilla actual. */
let registro: LecturaRegistro | null = null;
let origenRegistro = "";
let conciliacion: Conciliacion | null = null;
let cola: Promise<void> = Promise.resolve();
/** Cuántas filas deja ver el filtro actual (para anunciar "Mostrando N de M"). */
let visiblesEnPlanilla = 0;
/**
 * Se incrementa cada vez que la planilla se vacía o se reemplaza. Cada tanda de archivos guarda el número con el que nació y
 * se corta sola si ya no coincide: así "Vaciar" durante la lectura no deja que la planilla se vuelva a llenar.
 */
let generacion = 0;
/** Antigüedad de lo que falta cargar (ver `antiguedad.ts`). La fecha manual vacía = la de referencia por defecto. */
let fechaReferenciaManual = "";
let umbralAntiguedad = UMBRAL_ANTIGUEDAD_POR_DEFECTO;
let ordenPlanilla: "numero" | "antiguedad" = "numero";
/** Mensaje de un valor inválido en el campo (vacío si el valor es válido). Mientras hay uno, el campo conserva lo que se escribió. */
// Lo último que se escribió y no era válido (`null` si el campo está bien). El mensaje se arma al pintar, con el valor que se sigue
// usando en ese momento: si guardara el texto armado, "Se sigue usando 12/11/2026" quedaría viejo al cambiar la planilla.
let invalidoUmbral: string | null = null;
let invalidoFecha: string | null = null;
let referenciaVigente: Referencia = { fecha: "", origen: "hoy" };

/** Lo que cada zona de carga necesita para saber en qué estado está. */
const zonaFacturas = { arrastrando: false, procesando: false, error: "", actual: 0, total: 0, archivo: "" };
const zonaCsv = { arrastrando: false, error: "" };

function elemento<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Falta el elemento #${id}`);
  return e as T;
}

const zona = elemento<HTMLDivElement>("zona");
const entradaArchivos = elemento<HTMLInputElement>("archivos");
const formularioUrl = elemento<HTMLFormElement>("form-url");
const areaUrl = elemento<HTMLTextAreaElement>("url-qr");
const botonEjemplos = elemento<HTMLButtonElement>("ejemplos");
const mensajes = elemento<HTMLParagraphElement>("mensajes");
const textoEstadoZona = elemento<HTMLElement>("estado-zona");
const barraProgreso = elemento<HTMLProgressElement>("progreso");
const ventanaComprobantes = elemento<HTMLElement>("fuente-comprobantes");
const metaComprobantesEl = elemento<HTMLElement>("meta-comprobantes");
const metaRegistroEl = elemento<HTMLElement>("meta-registro");
const metaResultadoEl = elemento<HTMLElement>("meta-resultado");
const metaPlanillaEl = elemento<HTMLElement>("meta-planilla");

const seccionResultado = elemento<HTMLElement>("resultado");
const resumenResultado = elemento<HTMLElement>("resultado-resumen");
const vacioResultado = elemento<HTMLElement>("vacio-resultado");
const pasoSiguiente = elemento<HTMLElement>("siguiente-paso");
const principalConcilia = elemento<HTMLElement>("concilia-principal");
const tarjetaAtencion = elemento<HTMLElement>("concilia-resumen");
const atencionConcilia = elemento<HTMLElement>("concilia-atencion");
const menorConcilia = elemento<HTMLElement>("concilia-menor");
const lecturaResumen = elemento<HTMLElement>("lectura-resumen");
const avisosConcilia = elemento<HTMLElement>("concilia-avisos");
const bloqueDosVeces = elemento<HTMLElement>("dos-veces");
const listaDosVeces = elemento<HTMLUListElement>("lista-dos-veces");
const bloqueNoRecibidas = elemento<HTMLElement>("no-recibidas");
const listaNoRecibidas = elemento<HTMLUListElement>("lista-no-recibidas");

const grupoFiltros = elemento<HTMLElement>("filtros");
const planillaSeccion = elemento<HTMLElement>("planilla");
const envoltorio = elemento<HTMLDivElement>("envoltorio");
const tabla = elemento<HTMLTableElement>("tabla");
const cuerpo = elemento<HTMLTableSectionElement>("cuerpo");
const notaEjemplo = elemento<HTMLElement>("nota-ejemplo");
const bloqueTotales = elemento<HTMLElement>("totales");
const listaTotales = elemento<HTMLUListElement>("lista-totales");
const botonExportar = elemento<HTMLButtonElement>("exportar");
const botonVaciar = elemento<HTMLButtonElement>("vaciar");

const zonaRegistro = elemento<HTMLDivElement>("zona-registro");
const entradaRegistro = elemento<HTMLInputElement>("archivo-registro");
const textoEstadoZonaRegistro = elemento<HTMLElement>("estado-zona-registro");
const botonRegistroEjemplo = elemento<HTMLButtonElement>("registro-ejemplo");
const botonRegistroEjemplo2 = elemento<HTMLButtonElement>("registro-ejemplo-2");
const botonQuitarRegistro = elemento<HTMLButtonElement>("quitar-registro");
const mensajesRegistro = elemento<HTMLParagraphElement>("mensajes-registro");
const botonEjemploCompleto = elemento<HTMLButtonElement>("ejemplo-completo");
const botonEjemploCompleto2 = elemento<HTMLButtonElement>("ejemplo-completo-2");

/** Id viejo del texto de "sin filas"; si la maquetación todavía lo conserva, se muestra y oculta junto con el estado vacío. */
const textoVacioViejo = document.getElementById("vacio");

type TonoMensaje = "info" | "ok" | "aviso" | "error";

function pintarMensaje(destino: HTMLElement, texto: string, tono: TonoMensaje): void {
  destino.textContent = texto;
  if (texto === "") delete destino.dataset.tono;
  else destino.dataset.tono = tono;
}

function avisar(texto: string, tono: TonoMensaje = "info"): void {
  pintarMensaje(mensajes, texto, tono);
}

function avisarRegistro(texto: string, tono: TonoMensaje = "info"): void {
  pintarMensaje(mensajesRegistro, texto, tono);
}

function hijo<K extends keyof HTMLElementTagNameMap>(
  padre: HTMLElement,
  etiqueta: K,
  clase?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  padre.appendChild(e);
  return e;
}

/**
 * Región de estado solo para lectores de pantalla (A1): "Mostrando N de M comprobantes" al filtrar y el resumen al terminar
 * de conciliar. Existe desde el arranque (si aparece junto con el texto, los lectores no la anuncian) y se vacía antes de
 * escribir para que un texto repetido vuelva a anunciarse.
 */
const regionAnuncios = document.createElement("p");
regionAnuncios.id = "anuncios";
regionAnuncios.className = "solo-lectores";
regionAnuncios.setAttribute("role", "status");
regionAnuncios.setAttribute("aria-live", "polite");
document.body.appendChild(regionAnuncios);

function anunciar(texto: string): void {
  regionAnuncios.textContent = "";
  if (texto !== "") window.setTimeout(() => (regionAnuncios.textContent = texto), 60);
}

function tituloPlanilla(): HTMLElement | null {
  return document.getElementById("titulo-planilla") ?? planillaSeccion.querySelector<HTMLElement>("h2");
}

function esTactil(): boolean {
  return window.matchMedia("(hover: none)").matches;
}

/**
 * Confirmación en dos pasos: el primer clic cambia el texto y marca `data-confirmando`
 * (la maquetación lo pinta como "peligro"); el segundo ejecuta. **No vence por tiempo** (A2: un cambio automático que
 * nadie pidió sorprende a quien lee despacio o usa un lector de pantalla). Se restablece con Esc, al salir del botón, al
 * pasar el foco a otro elemento o al tocar fuera, y entonces limpia su mensaje.
 */
function conConfirmacion(
  boton: HTMLButtonElement,
  opciones: { necesita: () => boolean; textoConfirmar: string; aviso: string; accion: () => void },
): void {
  const original = Array.from(boton.childNodes).map((n) => n.cloneNode(true));
  let confirmando = false;
  let pedidaEn = 0;
  const salioDelBoton = (e: Event): void => {
    if (!(e.target instanceof Node) || !boton.contains(e.target)) restablecer(true);
  };
  function restablecer(limpiarMensaje: boolean): void {
    if (!confirmando) return;
    confirmando = false;
    document.removeEventListener("focusin", salioDelBoton);
    document.removeEventListener("pointerdown", salioDelBoton);
    boton.replaceChildren(...original.map((n) => n.cloneNode(true)));
    boton.removeAttribute("data-confirmando");
    // Solo se borra el mensaje propio: si ya apareció otro, no se pisa.
    if (limpiarMensaje && mensajes.textContent === opciones.aviso) avisar("");
  }
  boton.addEventListener("click", () => {
    // QA M1: un doble clic (o Enter dos veces) no es una confirmación: el segundo clic pegado al primero se ignora.
    if (confirmando && !confirmacionPermitida(pedidaEn, performance.now())) return;
    if (!confirmando && opciones.necesita()) {
      confirmando = true;
      pedidaEn = performance.now();
      boton.textContent = opciones.textoConfirmar;
      boton.dataset.confirmando = "true";
      avisar(opciones.aviso, "aviso");
      document.addEventListener("focusin", salioDelBoton);
      document.addEventListener("pointerdown", salioDelBoton);
      return;
    }
    restablecer(false);
    opciones.accion();
  });
  boton.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !confirmando) return;
    e.preventDefault();
    e.stopPropagation(); // el primer Esc solo cancela la confirmación; no cierra además el panel de edición
    restablecer(true);
  });
  boton.addEventListener("blur", () => restablecer(true));
}

// ------------------------------------------------------------------ Texto de cada campo

function textoDeCampo(d: Comprobante, campo: Campo): string {
  switch (campo) {
    case "cuit":
      return formatearCuit(d.cuit);
    case "tipoCmp":
      return d.tipoCmp === null ? "" : String(d.tipoCmp);
    case "ptoVta":
      return d.ptoVta === null ? "" : String(d.ptoVta).padStart(4, "0");
    case "nroCmp":
      return d.nroCmp === null ? "" : String(d.nroCmp).padStart(8, "0");
    case "fecha":
      return formatearFecha(d.fecha);
    case "moneda":
      return simboloMoneda(d.moneda);
    case "importe":
      return formatearImporte(d.importe);
    case "codAut":
      return d.codAut;
  }
}

/** Un único marcador de "sin dato" en las celdas (E11): el guion se ve, el lector de pantalla oye "Sin dato". */
function marcaSinDato(): HTMLSpanElement {
  const marca = document.createElement("span");
  marca.className = "sin-dato";
  hijo(marca, "span", undefined, "—").setAttribute("aria-hidden", "true");
  hijo(marca, "span", "solo-lectores", "Sin dato");
  return marca;
}

/** El texto de una celda, o la marca de "sin dato" si no hay. */
function ponerCelda(celda: HTMLElement, texto: string): void {
  if (texto === "") celda.replaceChildren(marcaSinDato());
  else celda.textContent = texto;
}

/** Pinta el detalle de una línea: el CUIT y los importes en su propio `span`, para que nunca se corten entre renglones (E7). */
function pintarDetalle(destino: HTMLElement, partes: readonly ParteDetalle[]): void {
  if (partes.length === 0) return;
  agregarPartes(hijo(destino, "p", "detalle"), partes);
}

/** Agrega los trozos a un elemento: el texto suelto como texto y los códigos y montos en su `span` (con `textContent`, nunca `innerHTML`). */
function agregarPartes(destino: HTMLElement, partes: readonly ParteDetalle[]): void {
  for (const parte of partes) {
    if (parte.tipo === "texto") destino.append(parte.texto);
    else hijo(destino, "span", parte.tipo, parte.texto);
  }
}

// ------------------------------------------------------------------ Etiquetas y filas

function crearEtiqueta(e: EtiquetaVista, claseExtra = ""): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = `etiqueta-estado${claseExtra === "" ? "" : ` ${claseExtra}`}`;
  s.dataset.tono = e.tono;
  s.append(icono(e.icono), document.createTextNode(e.texto));
  return s;
}

interface Control {
  entrada: HTMLInputElement | HTMLSelectElement;
  marcaEditado: HTMLElement;
  error: HTMLElement;
  textoError: HTMLElement;
}

/** El panel de edición que se inserta debajo de la fila mientras se edita. */
interface Panel {
  tr: HTMLTableRowElement;
  celda: HTMLTableCellElement;
  titulo: HTMLElement;
  controles: Map<Campo, Control>;
  listaAvisos: HTMLElement;
  bloqueAvisos: HTMLElement;
}

interface Celdas {
  tr: HTMLTableRowElement;
  numero: HTMLElement;
  concilia: HTMLElement;
  linea1: HTMLElement;
  linea2: HTMLElement;
  meta: HTMLElement;
  emisor: HTMLElement;
  fecha: HTMLElement;
  importe: HTMLElement;
  lectura: HTMLElement;
  botonEditar: HTMLButtonElement;
  panel: Panel | null;
}
const celdasPorFila = new Map<number, Celdas>();
/** Filas que se están editando (por id). */
const enEdicion = new Set<number>();

function filtroActual(): FiltroFilas {
  const marcado = grupoFiltros.querySelector<HTMLInputElement>('input[name="filtro"]:checked');
  const v = marcado?.value;
  return v === "faltan" || v === "revisar" || v === "diferencias" ? v : "todas";
}

function marcarFiltro(filtro: FiltroFilas): void {
  for (const radio of grupoFiltros.querySelectorAll<HTMLInputElement>('input[name="filtro"]')) radio.checked = radio.value === filtro;
}

function construirFila(fila: Fila): Celdas {
  const tr = document.createElement("tr");
  tr.setAttribute("role", "row");
  const celda = (clase: string, etiqueta: string): HTMLTableCellElement => {
    const td = hijo(tr, "td", clase);
    td.setAttribute("role", "cell");
    td.dataset.etiqueta = etiqueta;
    return td;
  };

  const numero = celda("c-num", "N.º");
  const concilia = celda("c-concilia", "Conciliación");
  const comprobante = celda("c-comprobante", "Comprobante");
  // A5: el comprobante nombra la fila ("Factura A 0003-00001245"), así que es su cabecera. Rol explícito, como el resto de la tabla.
  comprobante.setAttribute("role", "rowheader");
  const emisor = celda("c-emisor", "CUIT emisor");
  const fecha = celda("c-fecha", "Fecha");
  const importe = celda("c-importe", "Importe");
  const lectura = celda("c-lectura", "Lectura");
  const acciones = celda("c-acciones", "Acciones");

  const botonEditar = hijo(acciones, "button", "boton boton-chico boton-secundario", "Editar");
  botonEditar.type = "button";
  botonEditar.setAttribute("aria-expanded", "false");
  botonEditar.addEventListener("click", () => {
    if (enEdicion.has(fila.id)) cerrarEdicion(fila.id);
    else abrirEdicion(fila.id);
  });

  const celdas: Celdas = {
    tr,
    numero,
    concilia,
    linea1: hijo(comprobante, "span", "linea-1"),
    linea2: hijo(comprobante, "span", "linea-2"),
    meta: hijo(comprobante, "span", "meta-compacta"),
    emisor,
    fecha,
    importe,
    lectura,
    botonEditar,
    panel: null,
  };
  tr.classList.add("fila-nueva");
  window.setTimeout(() => tr.classList.remove("fila-nueva"), DESTELLO_FILA_NUEVA_EN_MS);
  return celdas;
}

// ------------------------------------------------------------------ Panel de edición

const CAMPOS_EDICION: ReadonlyArray<{ campo: Campo; etiqueta: string; mono?: boolean; modo?: HTMLInputElement["inputMode"] }> = [
  { campo: "importe", etiqueta: "Importe", modo: "decimal" },
  { campo: "moneda", etiqueta: "Moneda" },
  { campo: "cuit", etiqueta: "CUIT emisor", mono: true, modo: "numeric" },
  { campo: "tipoCmp", etiqueta: "Tipo" },
  { campo: "ptoVta", etiqueta: "Punto de venta", mono: true, modo: "numeric" },
  { campo: "nroCmp", etiqueta: "Número", mono: true, modo: "numeric" },
  { campo: "fecha", etiqueta: "Fecha" },
  { campo: "codAut", etiqueta: "CAE", mono: true, modo: "numeric" },
];

function crearSelectorTipo(fila: Fila): HTMLSelectElement {
  const select = document.createElement("select");
  select.add(new Option("(sin dato)", ""));
  const codigos = Object.keys(NOMBRES_TIPO).map(Number);
  const actual = fila.datos.tipoCmp;
  if (actual !== null && !codigos.includes(actual)) codigos.push(actual);
  for (const codigo of codigos) select.add(new Option(nombreTipo(codigo), String(codigo)));
  select.value = actual === null ? "" : String(actual);
  return select;
}

function construirPanel(fila: Fila): Panel {
  const tr = document.createElement("tr");
  tr.className = "fila-edicion";
  tr.id = `panel-edicion-${fila.id}`;
  tr.setAttribute("role", "row");
  const celda = hijo(tr, "td");
  celda.setAttribute("role", "cell");
  celda.colSpan = columnasVisibles();

  const titulo = hijo(celda, "h3", "solo-lectores");
  const rejilla = hijo(celda, "div", "campos-edicion");
  const controles = new Map<Campo, Control>();
  for (const def of CAMPOS_EDICION) {
    const id = `campo-${fila.id}-${def.campo}`;
    const grupo = hijo(rejilla, "div", "campo");
    grupo.dataset.campo = def.campo;
    const etiqueta = hijo(grupo, "label", "campo-etiqueta", def.etiqueta);
    etiqueta.htmlFor = id;

    let entrada: HTMLInputElement | HTMLSelectElement;
    if (def.campo === "tipoCmp") {
      entrada = crearSelectorTipo(fila);
      entrada.className = "entrada";
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.value = textoDeCampo(fila.datos, def.campo);
      input.autocomplete = "off";
      input.spellcheck = false;
      if (def.modo) input.inputMode = def.modo;
      input.className = def.mono ? "entrada entrada-mono" : "entrada";
      entrada = input;
    }
    entrada.id = id;
    grupo.appendChild(entrada);

    const marcaEditado = hijo(grupo, "span", "campo-editado", "Editado");
    marcaEditado.hidden = true;
    const error = hijo(grupo, "p", "error-campo");
    error.id = `error-${id}`;
    error.hidden = true;
    error.appendChild(icono("alerta"));
    const textoError = hijo(error, "span");

    entrada.addEventListener("change", () => alEditar(fila.id, def.campo));
    controles.set(def.campo, { entrada, marcaEditado, error, textoError });
  }

  const lectura = hijo(celda, "div", "edicion-lectura");
  const archivo = hijo(lectura, "p", "edicion-archivo", "Archivo: ");
  hijo(archivo, "span", "mono", fila.origen);
  if (fila.detalle !== "") hijo(lectura, "p", "edicion-caso", `Caso de ejemplo: ${fila.detalle}`);
  const bloqueAvisos = hijo(lectura, "div", "edicion-avisos");
  hijo(bloqueAvisos, "p", "edicion-avisos-titulo", "Avisos de la lectura");
  const listaAvisos = hijo(bloqueAvisos, "ul", "motivos");

  const acciones = hijo(celda, "div", "edicion-acciones");
  const listo = hijo(acciones, "button", "boton boton-chico", "Listo");
  listo.type = "button";
  listo.addEventListener("click", () => cerrarEdicion(fila.id));
  const quitar = hijo(acciones, "button", "boton boton-chico boton-secundario", "Quitar fila");
  quitar.type = "button";
  conConfirmacion(quitar, {
    necesita: () => true,
    textoConfirmar: "Confirmar: quitar la fila",
    aviso: "Vuelva a presionar el botón para quitar la fila.",
    accion: () => quitarDePlanilla(fila.id),
  });

  tr.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cerrarEdicion(fila.id);
    }
  });
  return { tr, celda, titulo, controles, listaAvisos, bloqueAvisos };
}

/** Cantidad de columnas que se ven ahora (la maquetación oculta algunas según el ancho de la planilla). */
function columnasVisibles(): number {
  let n = 0;
  for (const th of tabla.querySelectorAll<HTMLElement>("thead th")) if (window.getComputedStyle(th).display !== "none") n++;
  return Math.max(1, n);
}

function ajustarPaneles(): void {
  const n = columnasVisibles();
  for (const celdas of celdasPorFila.values()) if (celdas.panel) celdas.panel.celda.colSpan = n;
}

function abrirEdicion(id: number): void {
  const celdas = celdasPorFila.get(id);
  const fila = filas.find((f) => f.id === id);
  if (!celdas || !fila || celdas.panel) return;
  enEdicion.add(id);
  celdas.panel = construirPanel(fila);
  celdas.tr.after(celdas.panel.tr);
  actualizarEstados();
  celdas.panel.controles.get("importe")?.entrada.focus();
}

/** Cierra el panel y devuelve el foco al botón "Editar" de esa fila. */
function cerrarEdicion(id: number): void {
  const celdas = celdasPorFila.get(id);
  enEdicion.delete(id);
  if (!celdas) return;
  celdas.panel?.tr.remove();
  celdas.panel = null;
  actualizarEstados();
  celdas.botonEditar.focus();
}

/**
 * Aplica lo que se escribió en un campo. Si no es válido (A3), el texto **queda en el campo** con `aria-invalid` y su
 * mensaje hasta que se corrija o se cierre el panel con Esc: borrarlo obligaría a tipear todo de nuevo. La planilla
 * conserva el valor anterior mientras tanto.
 */
function alEditar(id: number, campo: Campo): void {
  const panel = celdasPorFila.get(id)?.panel;
  const control = panel?.controles.get(campo);
  if (!panel || !control) return;
  const resultado = editarFila(filas, id, campo, control.entrada.value);
  if (resultado instanceof Error) {
    // El mensaje queda hasta el siguiente cambio válido: uno que desaparece solo no lo alcanza a leer todo el mundo (WCAG 2.2.1).
    control.entrada.setAttribute("aria-invalid", "true");
    control.entrada.setAttribute("aria-describedby", control.error.id);
    control.textoError.textContent = resultado.message;
    control.error.hidden = false;
    avisar(`${resultado.message} La planilla conserva el valor anterior hasta que lo corrija.`, "error");
    return;
  }
  filas = resultado;
  control.entrada.removeAttribute("aria-invalid");
  control.entrada.removeAttribute("aria-describedby");
  control.error.hidden = true;
  control.textoError.textContent = "";
  const nueva = filas.find((f) => f.id === id);
  if (nueva) control.entrada.value = textoDeCampo(nueva.datos, campo);
  // El aviso general solo se limpia si ya no queda otro campo de este panel con error.
  if (!Array.from(panel.controles.values()).some((c) => c.entrada.hasAttribute("aria-invalid"))) avisar("");
  actualizarEstados();
}

/** Quita la fila y lleva el foco al "Editar" de la siguiente fila visible o, si no hay, al título de la planilla. */
function quitarDePlanilla(id: number): void {
  const posicion = filas.findIndex((f) => f.id === id);
  filas = quitarFila(filas, id);
  enEdicion.delete(id);
  renderTodo();
  avisar("Fila quitada.");
  const siguiente = filas.slice(posicion).find((f) => celdasPorFila.get(f.id)?.tr.hidden === false);
  const boton = siguiente ? celdasPorFila.get(siguiente.id)?.botonEditar : undefined;
  if (boton) boton.focus();
  else irA(tituloPlanilla());
}

// ------------------------------------------------------------------ Refresco

/** Sincroniza las filas del DOM con la lista: reutiliza las que ya existen (así no se pierde lo que se está tipeando). */
function renderTodo(): void {
  const vigentes = new Set(filas.map((f) => f.id));
  for (const [id, celdas] of celdasPorFila) {
    if (vigentes.has(id)) continue;
    celdas.tr.remove();
    celdas.panel?.tr.remove();
    celdasPorFila.delete(id);
    enEdicion.delete(id);
  }
  for (const fila of filas) if (!celdasPorFila.has(fila.id)) celdasPorFila.set(fila.id, construirFila(fila));
  acomodarFilasEnDom(filas);
  actualizarEstados();
}

/** Pone las filas (y sus paneles de edición) en el DOM en el orden dado. Solo mueve lo que no está en su lugar. */
function acomodarFilasEnDom(ordenadas: readonly Fila[]): void {
  const deseados: HTMLElement[] = [];
  for (const fila of ordenadas) {
    const celdas = celdasPorFila.get(fila.id);
    if (!celdas) continue;
    deseados.push(celdas.tr);
    if (celdas.panel) deseados.push(celdas.panel.tr);
  }
  // QA A1: mover una fila que contiene el campo enfocado lo desenfocaría; `acomodarNodos` le devuelve el foco (sin desplazar).
  acomodarNodos<Element, HTMLElement>(cuerpo, deseados, {
    actual: () => (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    enfocar: (e) => e.focus({ preventScroll: true }),
    sigueEnLaPagina: (e) => e.isConnected,
    // QA M2 (etapa 3): `nearest` no mueve nada si el campo ya se ve; si la fila saltó de lugar, lo trae sin tocar el foco.
    traerALaVista: (e) => e.scrollIntoView({ block: "nearest" }),
  });
}

function actualizarEstados(): void {
  const hoy = new Date();
  conciliacion = registro === null ? null : conciliar(filas, registro.registros, hoy);
  const filtro: FiltroFilas = conciliacion === null ? "todas" : filtroActual();
  let filasQueCumplen = 0;
  const repetidas = duplicadas(filas);
  const indicePorId = new Map(filas.map((f, i) => [f.id, i + 1] as const));
  tabla.classList.toggle("sin-conciliar", conciliacion === null);
  const cargadasDosVeces = registro === null || conciliacion === null ? new Set<number>() : filasCargadasDosVeces(filas, conciliacion, registro.clavesRepetidas);
  const referencia = resolverReferencia({ manual: fechaReferenciaManual, soloEjemplo: filas.length > 0 && filas.every(esFilaDeEjemplo), hoy });

  filas.forEach((fila, i) => {
    const celdas = celdasPorFila.get(fila.id);
    if (!celdas) return;
    const numero = i + 1;
    const { estado, motivos } = estadoFila(fila, hoy);
    const original = repetidas.get(fila.id);
    const resultado = conciliacion?.porFila.get(fila.id);
    const avisos = avisosDeFila(fila, motivos);
    const dias = diasDeFila(fila, resultado, referencia.fecha);
    const detalle = detalleFilaPartes(resultado, fila, avisos, dias, referencia.origen);
    const antigua = etiquetaAntigua(dias, umbralAntiguedad);
    const d = fila.datos;
    const editando = enEdicion.has(fila.id);

    // Atributos que la maquetación usa para pintar la franja de la fila (una sola señal de color por fila).
    const tr = celdas.tr;
    if (resultado) tr.dataset.concilia = resultado.tipo;
    else delete tr.dataset.concilia;
    tr.dataset.lectura = estado;
    if (antigua) tr.dataset.antigua = "true";
    else delete tr.dataset.antigua;
    if (original !== undefined) tr.dataset.duplicada = String(indicePorId.get(original) ?? "");
    else delete tr.dataset.duplicada;
    // "Ya cargada" pero el sistema la tiene dos veces: se pinta como la duplicada (tono "revisar"), no en verde.
    const dosVeces = cargadasDosVeces.has(fila.id);
    if (dosVeces) tr.dataset.dosVeces = "true";
    else delete tr.dataset.dosVeces;
    tr.classList.toggle("fila-editando", editando);

    celdas.numero.textContent = String(numero);

    // Etiquetas de lectura: "Revisar" / "Sin QR", "Duplicada de la fila N" y "Editada a mano". Con registro, el sello de
    // duplicada es el de conciliación (C1: estado propio, no "Ya cargada"), así que no se repite en la columna Lectura.
    const numeroDelOriginal = original === undefined ? undefined : (indicePorId.get(original) ?? "?");
    const etiquetasLectura: HTMLElement[] = [];
    const lectura = etiquetaLectura(estado);
    if (lectura) etiquetasLectura.push(crearEtiqueta(lectura));
    if (numeroDelOriginal !== undefined && resultado === undefined) etiquetasLectura.push(crearEtiqueta(etiquetaDuplicada(numeroDelOriginal)));
    if (fila.editados.length > 0) etiquetasLectura.push(crearEtiqueta(ETIQUETA_EDITADA, "etiqueta-editada"));

    // Conciliación: etiqueta, una línea de detalle y, para la disposición compacta, las etiquetas de lectura repetidas.
    celdas.concilia.replaceChildren();
    if (resultado) celdas.concilia.appendChild(crearEtiqueta(etiquetaConciliacion(resultado, numeroDelOriginal, dosVeces)));
    if (antigua) celdas.concilia.appendChild(crearEtiqueta(antigua, "etiqueta-antigua"));
    pintarDetalle(celdas.concilia, detalle);
    if (etiquetasLectura.length > 0) {
      const compacta = hijo(celdas.concilia, "div", "lectura-compacta");
      for (const e of etiquetasLectura) compacta.appendChild(e.cloneNode(true));
    }

    // Lectura: "Leída" en texto suave o las etiquetas; sin registro, aquí va también el detalle.
    celdas.lectura.replaceChildren();
    if (estado === "leida") hijo(celdas.lectura, "span", "lectura-ok", "Leída");
    for (const e of etiquetasLectura) celdas.lectura.appendChild(e);
    if (resultado === undefined) pintarDetalle(celdas.lectura, detalle);

    celdas.linea1.textContent = tituloComprobante(fila);
    celdas.linea2.textContent = formatearNumeroCmp(d.ptoVta, d.nroCmp);
    // Línea de datos de la disposición compacta: el CUIT en su propio `span` para que no se corte.
    const cuitFormateado = formatearCuit(d.cuit);
    const fechaFormateada = formatearFecha(d.fecha);
    celdas.meta.replaceChildren();
    if (cuitFormateado !== "") hijo(celdas.meta, "span", "codigo", cuitFormateado);
    if (cuitFormateado !== "" && fechaFormateada !== "") celdas.meta.append(" · ");
    if (fechaFormateada !== "") celdas.meta.append(fechaFormateada);
    ponerCelda(celdas.emisor, cuitFormateado);
    ponerCelda(celdas.fecha, fechaFormateada);
    ponerCelda(celdas.importe, d.importe === null ? "" : formatearMonto(d.moneda, d.importe));

    const mostrar = mostrarConFiltro(filtro, resultado, original !== undefined);
    if (mostrar) filasQueCumplen++;
    // Una fila que se está editando no desaparece aunque el cambio la saque del filtro: se perdería el foco y el panel.
    celdas.tr.hidden = !mostrar && !editando;

    celdas.botonEditar.textContent = editando ? "Editando" : "Editar";
    // A4: el nombre dice de qué comprobante es ("Editar la fila 3: Factura A 0003-00001245"), no solo el número.
    celdas.botonEditar.setAttribute("aria-label", nombreBotonEditar(editando, numero, fila));
    celdas.botonEditar.setAttribute("aria-expanded", String(editando));
    if (celdas.panel) {
      celdas.botonEditar.setAttribute("aria-controls", celdas.panel.tr.id);
      actualizarPanel(celdas.panel, fila, numero, avisos, celdas.tr.hidden);
    } else {
      celdas.botonEditar.removeAttribute("aria-controls");
    }
  });
  // Orden de la planilla: por número (el de siempre) o por antigüedad de lo que falta cargar. El N.º de cada fila no cambia.
  acomodarFilasEnDom(ordenPlanilla === "antiguedad" && conciliacion !== null ? ordenarPorAntiguedad(filas, conciliacion.porFila, referencia.fecha) : filas);
  ajustarPaneles();
  pintarControlesDeAntiguedad(referencia);

  const hay = filas.length > 0;
  const r = resumen(filas, hoy);
  const hayRegistro = registro !== null && conciliacion !== null;

  document.body.toggleAttribute("data-hay-datos", hay);
  document.body.toggleAttribute("data-conciliado", hayRegistro);

  // Sin filas: estado vacío en lugar del resultado y la ventana de la planilla no existe. Plegar una ventana oculta solo su
  // barra de herramientas y su interior, nunca elementos que se muestran u ocultan aquí: no se pisan entre sí.
  visiblesEnPlanilla = filasQueCumplen;
  vacioResultado.hidden = hay;
  if (textoVacioViejo) textoVacioViejo.hidden = hay;
  resumenResultado.hidden = !hay;
  planillaSeccion.hidden = !hay;
  envoltorio.hidden = !hay;
  botonVaciar.hidden = !hay;
  notaEjemplo.hidden = !filas.some(esFilaDeEjemplo);

  const totales = totalesPorMoneda(filas);
  listaTotales.replaceChildren();
  for (const t of totalesVista(totales)) {
    const li = hijo(listaTotales, "li");
    hijo(li, "strong", undefined, t.nombre);
    li.append(" ");
    hijo(li, "span", "monto", t.monto);
    li.append(" ");
    hijo(li, "span", "nota", `· ${t.cantidad}`);
  }
  bloqueTotales.hidden = totales.length === 0;

  lecturaResumen.textContent = textoLectura(r);
  metaPlanillaEl.textContent = metaPlanilla(filasQueCumplen, filas.length);
  pintarResultado(filasQueCumplen, filtro);
  pintarFiltros();
  pintarZonas();
}

function actualizarPanel(panel: Panel, fila: Fila, numero: number, avisos: readonly string[], oculto: boolean): void {
  panel.tr.hidden = oculto;
  panel.titulo.textContent = `Editar la fila ${numero}`;
  for (const [campo, control] of panel.controles) {
    const editado = fila.editados.includes(campo);
    control.entrada.classList.toggle("editada", editado);
    control.marcaEditado.hidden = !editado;
  }
  panel.listaAvisos.replaceChildren();
  for (const aviso of avisos) hijo(panel.listaAvisos as HTMLElement, "li", undefined, aviso);
  panel.bloqueAvisos.hidden = avisos.length === 0;
}

// ------------------------------------------------------------------ Antigüedad (controles opcionales)

// Los controles no son parte de la maquetación actual: si existen en la página, se conectan (los ids son los de esos controles en la página);
// si no, la antigüedad se calcula igual con los valores por defecto. Se usa delegación de eventos para que
// funcionen aunque se agreguen después de cargar el script.

/** Muestra (o quita) el mensaje de un valor inválido junto al campo: `aria-invalid` y el mensaje asociado con `aria-describedby`. */
function ponerErrorDeCampo(campo: HTMLInputElement, mensaje: string): void {
  const id = `error-${campo.id}`;
  let aviso = document.getElementById(id);
  if (!aviso) {
    aviso = document.createElement("p");
    aviso.id = id;
    aviso.className = "error-campo";
    aviso.hidden = true;
    aviso.append(icono("alerta"), document.createElement("span"));
    campo.insertAdjacentElement("afterend", aviso);
  }
  const hayError = mensaje !== "";
  // Accesibilidad m1: con error, su id va primero en `aria-describedby` (el lector dice antes lo que está mal que la nota del campo).
  const descripcion = describedbyConError(campo.getAttribute("aria-describedby"), id, hayError);
  if (descripcion === null) campo.removeAttribute("aria-describedby");
  else campo.setAttribute("aria-describedby", descripcion);
  if (hayError) campo.setAttribute("aria-invalid", "true");
  else campo.removeAttribute("aria-invalid");
  // El texto también se vacía al corregir: un mensaje viejo no debe quedar escondido en el DOM.
  const texto = aviso.querySelector("span");
  if (texto) texto.textContent = mensaje;
  aviso.hidden = !hayError;
}

function mensajeUmbral(): string {
  if (invalidoUmbral === null) return "";
  const r = validarUmbral(invalidoUmbral, umbralAntiguedad);
  return r.ok ? "" : r.mensaje;
}

function mensajeFecha(referencia: Referencia): string {
  if (invalidoFecha === null) return "";
  const r = validarFechaReferencia(invalidoFecha, referencia.fecha);
  return r.ok ? "" : r.mensaje;
}

function pintarControlesDeAntiguedad(referencia: Referencia): void {
  referenciaVigente = referencia;
  const texto = document.getElementById("referencia-antiguedad");
  if (texto) texto.textContent = textoReferencia(referencia);
  // Con un valor inválido el campo conserva lo que se escribió (y su mensaje): borrarlo obligaría a tipear todo de nuevo.
  const fecha = document.getElementById("fecha-referencia");
  if (fecha instanceof HTMLInputElement) {
    if (invalidoFecha === null && document.activeElement !== fecha) fecha.value = referencia.fecha;
    ponerErrorDeCampo(fecha, mensajeFecha(referencia));
  }
  const umbral = document.getElementById("umbral-antiguedad");
  if (umbral instanceof HTMLInputElement) {
    if (invalidoUmbral === null && document.activeElement !== umbral) umbral.value = String(umbralAntiguedad);
    ponerErrorDeCampo(umbral, mensajeUmbral());
  }
  const orden = document.getElementById("orden-planilla");
  if (orden instanceof HTMLSelectElement) orden.value = ordenPlanilla;
  // Con el bloque plegado, el rótulo dice lo que está activo (el CSS lo muestra solo plegado).
  const activo = document.getElementById("antiguedad-activo");
  // Accesibilidad m3: si quedó un campo con error, plegar el bloque no lo esconde sin avisar.
  if (activo) activo.textContent = resumenAntiguedad(umbralAntiguedad, ordenPlanilla, invalidoUmbral !== null || invalidoFecha !== null);
}

/** Cuántos comprobantes por cargar llegan al umbral con la referencia vigente (para el anuncio). */
function marcadasPorAntiguedad(): number {
  return conciliacion === null ? 0 : contarAntiguas(filas, conciliacion.porFila, referenciaVigente.fecha, umbralAntiguedad);
}

document.addEventListener("change", (e) => {
  const destino = e.target;
  if (destino instanceof HTMLInputElement && destino.id === "fecha-referencia") {
    const r = validarFechaReferencia(destino.value, referenciaVigente.fecha);
    if (r.ok) {
      invalidoFecha = null;
      fechaReferenciaManual = r.manual; // vacía: se vuelve a la fecha por defecto, y la nota de la referencia dice cuál es
    } else {
      invalidoFecha = destino.value;
    }
    actualizarEstados();
    anunciar(r.ok ? anuncioReferencia(referenciaVigente, umbralAntiguedad, marcadasPorAntiguedad()) : r.mensaje);
  } else if (destino instanceof HTMLInputElement && destino.id === "umbral-antiguedad") {
    const r = validarUmbral(destino.value, umbralAntiguedad);
    if (r.ok) {
      invalidoUmbral = null;
      umbralAntiguedad = r.valor;
    } else {
      invalidoUmbral = destino.value;
    }
    actualizarEstados();
    anunciar(r.ok ? anuncioUmbral(umbralAntiguedad, marcadasPorAntiguedad()) : r.mensaje);
  } else if (destino instanceof HTMLSelectElement && destino.id === "orden-planilla") {
    ordenPlanilla = destino.value === "antiguedad" ? "antiguedad" : "numero";
    actualizarEstados();
    anunciar(anuncioOrden(ordenPlanilla)); // las filas cambian de lugar sin mover el foco: se dice en voz alta (accesibilidad M2)
  }
});

// ------------------------------------------------------------------ Filtros, resultado y zonas

function pintarFiltros(): void {
  const hayRegistro = registro !== null && conciliacion !== null;
  grupoFiltros.hidden = !hayRegistro;
  const cuentas = conteosFiltros(filas, conciliacion);
  for (const filtro of ["todas", "faltan", "revisar", "diferencias"] as const) {
    const conteo = document.getElementById(`conteo-${filtro}`);
    if (!conteo) continue;
    conteo.textContent = String(cuentas[filtro]);
    if (cuentas[filtro] === 0) conteo.dataset.cero = "true";
    else delete conteo.dataset.cero;
  }
}

/** La parte de conciliación de la línea menor ("Ya cargadas: 2 · No se pueden conciliar: 1"); sin registro queda vacía. */
function textoMenor(texto: string): void {
  menorConcilia.textContent = texto;
  menorConcilia.hidden = texto === "";
}

/** Lista de "Requieren atención": se crea una vez dentro de `#concilia-atencion` (el título y la tarjeta son de la maquetación). */
function listaDeAtencion(): HTMLUListElement {
  return atencionConcilia.querySelector<HTMLUListElement>("ul") ?? hijo(atencionConcilia, "ul", "lista-atencion");
}

function pintarResultado(filasQueCumplen: number, filtro: FiltroFilas): void {
  const hay = filas.length > 0;
  const activa = registro !== null && conciliacion !== null;
  listaNoRecibidas.replaceChildren();
  listaDosVeces.replaceChildren();
  bloqueNoRecibidas.hidden = true;
  bloqueDosVeces.hidden = true;
  botonQuitarRegistro.hidden = !activa;
  pasoSiguiente.hidden = !hay || activa;
  tarjetaAtencion.hidden = !activa;

  const r = registro !== null && conciliacion !== null ? resumenConciliacion(filas, conciliacion, registro.clavesRepetidas) : null;
  metaResultadoEl.textContent = metaResultado(filas.length, r);
  pintarProtagonista(r);
  textoMenor(r === null ? "" : lineaMenor(r));

  if (registro === null || conciliacion === null || r === null) {
    avisosConcilia.textContent = "";
    avisosConcilia.hidden = true;
    return;
  }

  const items = presentarAtencion(itemsAtencion(r));
  const lista = listaDeAtencion();
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
    const accion = item.accion;
    if (accion.tipo === "detalle") {
      const enlace = hijo(li, "a", "boton-enlace atencion-accion");
      enlace.href = `#${accion.destino}`;
      textoDeAccion(enlace, accion.texto);
      enlace.setAttribute("aria-label", `Ver detalle: ${item.cifra} ${item.texto}`);
      enlace.addEventListener("click", (e) => {
        e.preventDefault();
        irA(document.getElementById(accion.destino)?.querySelector<HTMLElement>("h3") ?? null);
      });
    } else {
      const boton = hijo(li, "button", "boton-enlace atencion-accion");
      boton.type = "button";
      textoDeAccion(boton, accion.texto);
      boton.setAttribute("aria-label", `Ver en la planilla: ${item.cifra} ${item.texto}`);
      boton.addEventListener("click", () => (accion.tipo === "filtro" ? verFiltro(accion.filtro) : verPrimeraDuplicada()));
    }
  }

  if (registro.clavesRepetidas.length > 0) {
    bloqueDosVeces.hidden = false;
    const lista = limitarLista(registro.clavesRepetidas);
    for (const c of lista.visibles) {
      agregarPartes(hijo(listaDosVeces, "li"), partesClaveRepetida(c, monedaDeRegistro(filas, c.registro)));
    }
    if (lista.resto > 0) hijo(listaDosVeces, "li", "lista-resto", lista.textoResto);
  }
  if (conciliacion.soloEnRegistro.length > 0) {
    bloqueNoRecibidas.hidden = false;
    const lista = limitarLista(conciliacion.soloEnRegistro);
    for (const solo of lista.visibles) agregarPartes(hijo(listaNoRecibidas, "li"), partesRegistro(solo, monedaDeRegistro(filas, solo)));
    if (lista.resto > 0) hijo(listaNoRecibidas, "li", "lista-resto", lista.textoResto);
  }

  const avisos: string[] = [];
  const columnasRepetidas = describirEncabezadosDuplicados(registro.encabezadosDuplicados);
  if (columnasRepetidas !== "") avisos.push(columnasRepetidas);
  const invalidas = describirLineasInvalidas(registro.lineasInvalidas);
  const excesivos = describirImportesExcesivos(registro.lineasImporteExcesivo);
  // Si todas las líneas ilegibles lo son por el importe, el mensaje de la causa alcanza.
  const todasPorImporte = registro.lineasImporteExcesivo.length === registro.lineasInvalidas.length;
  if (invalidas !== "" && !todasPorImporte) avisos.push(`En el registro, ${invalidas.charAt(0).toLowerCase()}${invalidas.slice(1)}`);
  if (excesivos !== "") avisos.push(`En el registro, ${excesivos.charAt(0).toLowerCase()}${excesivos.slice(1)}`);
  if (filtro !== "todas" && filasQueCumplen === 0) avisos.push("Ninguna fila cumple con el filtro elegido.");
  avisosConcilia.textContent = avisos.join(" ");
  avisosConcilia.hidden = avisos.length === 0;
}

/**
 * El texto de una acción de "Requieren atención". Lo que sigue a la primera palabra ("detalle", en "Ver detalle") va en
 * su propio `span.accion-extra`: en interiores angostos la maquetación lo oculta y queda "Ver" (E8). El nombre
 * accesible completo va en `aria-label`.
 */
function textoDeAccion(destino: HTMLElement, texto: string): void {
  const [base = "", ...resto] = texto.split(" ");
  const visible = hijo(destino, "span", "accion-texto", base);
  if (resto.length > 0) hijo(visible, "span", "accion-extra", ` ${resto.join(" ")}`);
  destino.appendChild(icono("flecha-der"));
}

/** Aplica un filtro desde "Ver" o "Ver los N en la planilla" y lleva el foco al título de la planilla. */
function verFiltro(filtro: FiltroFilas): void {
  marcarFiltro(filtro);
  actualizarEstados();
  anunciar(textoMostrando(visiblesEnPlanilla, filas.length));
  irA(tituloPlanilla());
}

/** "Ver" de las duplicadas: con todas las filas a la vista, lleva el foco al botón de la primera fila duplicada. */
function verPrimeraDuplicada(): void {
  marcarFiltro("todas");
  actualizarEstados();
  const repetidas = duplicadas(filas);
  const primera = filas.find((f) => repetidas.has(f.id));
  const celdas = primera ? celdasPorFila.get(primera.id) : undefined;
  if (!celdas) return;
  desplegarSiHaceFalta(celdas.tr);
  celdas.botonEditar.focus({ preventScroll: true });
  desplazarA(celdas.tr, "center");
}

function pintarMontos(montos: readonly string[], prefijoParaLectores: string): void {
  if (montos.length === 0) return;
  const contenedor = hijo(principalConcilia, "p", "montos");
  hijo(contenedor, "span", "solo-lectores", prefijoParaLectores);
  montos.forEach((monto, i) => {
    if (i > 0) {
      hijo(contenedor, "span", undefined, " · ").setAttribute("aria-hidden", "true");
      hijo(contenedor, "span", "solo-lectores", " y ");
    }
    hijo(contenedor, "span", "monto", monto);
  });
}

/**
 * El resultado protagonista. Se lee como una frase, en este orden de DOM: "Falta cargar 2 facturas por $ 6.120,00 y US$ 1.250,00"
 * (el "·" visual va aria-hidden y el "y" y el "por" solo los oyen los lectores de pantalla).
 */
function pintarProtagonista(r: ReturnType<typeof resumenConciliacion> | null): void {
  const totales = totalesPorMoneda(filas);
  const p = protagonista(filas.length, totales, r);
  principalConcilia.dataset.tono = p.tono;
  principalConcilia.dataset.variante = p.variante;
  if (zonaFacturas.procesando) principalConcilia.setAttribute("aria-busy", "true");
  else principalConcilia.removeAttribute("aria-busy");
  principalConcilia.replaceChildren();

  hijo(principalConcilia, "p", "rotulo-resultado", p.rotulo);
  const linea = hijo(principalConcilia, "p", "cifra-linea");
  if (p.variante === "cero") linea.appendChild(icono("check", "icono icono-grande"));
  hijo(linea, "strong", "cifra", p.cifra);
  if (p.unidad !== "") {
    linea.append(" ");
    hijo(linea, "span", "cifra-unidad", p.unidad);
  }
  pintarMontos(p.montos, p.variante === "faltan" ? "por " : "por un total de ");
  if (p.ademas) {
    // Las notas de crédito que faltan van aparte de las facturas, en un renglón de texto: "Y 1 nota de crédito por $ 300,00".
    const otra = hijo(principalConcilia, "p", "mensaje-resultado cifra-ademas");
    otra.append("Y ");
    hijo(otra, "strong", undefined, `${p.ademas.cifra} ${p.ademas.unidad}`);
    if (p.ademas.montos.length > 0) {
      // Cada monto en su span.monto: nunca se parte entre el símbolo y la cifra ("$ / 900,00") y el texto que se lee es el mismo.
      otra.append(" por ");
      p.ademas.montos.forEach((monto, i) => {
        if (i > 0) otra.append(" y ");
        hijo(otra, "span", "monto", monto);
      });
    }
  }
  if (p.mensaje !== "") hijo(principalConcilia, "p", "mensaje-resultado", p.mensaje);
  if (p.accion) {
    const filtro = p.accion.filtro;
    const boton = hijo(principalConcilia, "button", "boton", p.accion.texto);
    boton.type = "button";
    boton.addEventListener("click", () => verFiltro(filtro));
  }
}

/** `destino` es el título de la zona (`#estado-zona`); la ayuda y la acción son sus hermanas dentro de la misma etiqueta. */
function pintarZona(destino: HTMLElement, contenedor: HTMLElement, estado: EstadoZona, textos: TextosZona): void {
  contenedor.dataset.estado = estado;
  destino.textContent = textos.titulo;
  const ayuda = contenedor.querySelector<HTMLElement>(".zona-ayuda");
  if (ayuda) {
    ayuda.replaceChildren();
    if (estado === "error") ayuda.appendChild(icono("alerta"));
    ayuda.append(textos.ayuda);
    ayuda.hidden = textos.ayuda === "";
  }
  const accion = contenedor.querySelector<HTMLElement>(".zona-accion");
  if (accion && textos.accion !== "") accion.textContent = textos.accion;
}

function pintarZonas(): void {
  const estadoFacturas = estadoDeZona({ ...zonaFacturas, hayDatos: filas.length > 0 });
  pintarZona(
    textoEstadoZona,
    zona,
    estadoFacturas,
    textosZonaComprobantes(estadoFacturas, { ...zonaFacturas, tactil: esTactil(), cantidad: filas.length }),
  );
  barraProgreso.hidden = estadoFacturas !== "procesando";
  if (estadoFacturas === "procesando") {
    barraProgreso.max = Math.max(1, zonaFacturas.total);
    barraProgreso.value = Math.max(0, zonaFacturas.actual - 1);
  }
  // La ventana está ocupada mientras se procesan archivos; su barra de título lo dice ("Procesando 3 de 12").
  if (zonaFacturas.procesando) ventanaComprobantes.setAttribute("aria-busy", "true");
  else ventanaComprobantes.removeAttribute("aria-busy");
  metaComprobantesEl.textContent = metaComprobantes({ ...zonaFacturas, cantidad: filas.length });
  metaRegistroEl.textContent = metaRegistro(registro === null ? null : registro.registros.length);

  const estadoRegistro = estadoDeZona({ arrastrando: zonaCsv.arrastrando, procesando: false, error: zonaCsv.error, hayDatos: registro !== null });
  pintarZona(
    textoEstadoZonaRegistro,
    zonaRegistro,
    estadoRegistro,
    textosZonaRegistro(estadoRegistro, { tactil: esTactil(), cantidad: registro?.registros.length ?? 0, origen: origenRegistro, error: zonaCsv.error }),
  );
}

// ------------------------------------------------------------------ Registro (CSV)

function errorDeRegistro(texto: string): void {
  // Con un registro ya activo, un archivo con error no lo reemplaza: el aviso lo dice (QA medio 4).
  const mensaje = textoErrorRegistro(texto, registro !== null);
  zonaCsv.error = mensaje;
  avisarRegistro(mensaje, "error");
  pintarZonas();
}

function aplicarRegistro(texto: string, origen: string, extra = ""): void {
  const r = leerRegistro(texto);
  if (r instanceof Error) {
    errorDeRegistro(r.message);
    return;
  }
  zonaCsv.error = "";
  registro = r;
  origenRegistro = origen;
  marcarFiltro("todas");
  actualizarEstados();
  avisarRegistro(
    [
      textoRegistroCargado(origen, r),
      extra,
      describirEncabezadosDuplicados(r.encabezadosDuplicados),
      describirLineasInvalidas(r.lineasInvalidas),
    ]
      .filter((x) => x !== "")
      .join(" "),
    "ok",
  );
  // A1: al terminar de conciliar se anuncia el resumen (lo que falta y lo que requiere atención).
  if (conciliacion !== null) anunciar(anuncioConciliacion(resumenConciliacion(filas, conciliacion, r.clavesRepetidas)));
}

async function procesarRegistro(archivo: File | undefined): Promise<void> {
  if (!archivo) return;
  if (archivo.size === 0) {
    errorDeRegistro("El archivo está vacío.");
    return;
  }
  if (archivo.size > LIMITE_BYTES) {
    errorDeRegistro("El archivo supera el máximo de 2 MB.");
    return;
  }
  try {
    // UTF-8, UTF-16 con BOM (el "Texto Unicode" de Excel) o Windows-1252; si no se puede, el error dice por qué.
    const texto = decodificarTexto(new Uint8Array(await archivo.arrayBuffer()));
    if (texto instanceof Error) errorDeRegistro(texto.message);
    else aplicarRegistro(texto, archivo.name);
  } catch {
    errorDeRegistro("No se pudo leer el archivo.");
  }
}

entradaRegistro.addEventListener("change", () => {
  const archivo = entradaRegistro.files?.[0];
  entradaRegistro.value = "";
  void procesarRegistro(archivo);
});
zonaRegistro.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (!zonaCsv.arrastrando) {
    zonaCsv.arrastrando = true;
    pintarZonas();
  }
});
zonaRegistro.addEventListener("dragleave", (e) => {
  if (e.relatedTarget instanceof Node && zonaRegistro.contains(e.relatedTarget)) return;
  zonaCsv.arrastrando = false;
  pintarZonas();
});
zonaRegistro.addEventListener("drop", (e) => {
  e.preventDefault();
  zonaCsv.arrastrando = false;
  pintarZonas();
  void procesarRegistro(e.dataTransfer?.files?.[0]);
});

function cargarRegistroDeEjemplo(): void {
  // El registro de ejemplo está armado para las facturas de ejemplo: si la planilla está vacía, se cargan también.
  let extra = "";
  if (filas.length === 0) {
    const cantidad = cargarFacturasDeEjemplo();
    extra = `También se cargaron ${cantidad} facturas de ejemplo en la planilla.`;
    renderTodo();
  }
  aplicarRegistro(registroEjemplo(), "ejemplo", extra);
}
botonRegistroEjemplo.addEventListener("click", cargarRegistroDeEjemplo);
botonRegistroEjemplo2.addEventListener("click", cargarRegistroDeEjemplo);

botonQuitarRegistro.addEventListener("click", () => {
  registro = null;
  origenRegistro = "";
  zonaCsv.error = "";
  marcarFiltro("todas");
  actualizarEstados();
  anunciar("");
  avisarRegistro("Registro quitado. La planilla vuelve a mostrarse sin conciliar.");
});

for (const radio of grupoFiltros.querySelectorAll<HTMLInputElement>('input[name="filtro"]')) {
  radio.addEventListener("change", () => {
    actualizarEstados();
    anunciar(textoMostrando(visiblesEnPlanilla, filas.length)); // A1
  });
}

// ------------------------------------------------------------------ Carga

function agregarComprobante(origen: string, comprobante: Comprobante | null, nota = "", detalle = ""): void {
  filas = agregarFila(filas, crearFila(siguienteId(filas), origen, comprobante, nota, detalle));
}

/** Lee una tanda de archivos de a uno. Se corta sola si la planilla se vació (`generacion` cambió) mientras se leía. */
async function procesarArchivos(archivos: File[], suGeneracion: number): Promise<void> {
  if (generacion !== suGeneracion) return; // se vació la planilla mientras esperaba en la cola: no llega a empezar
  zonaFacturas.error = "";
  zonaFacturas.procesando = true;
  zonaFacturas.total = archivos.length;
  let resultado = { procesados: 0, agregadas: 0, cancelado: false };
  try {
    resultado = await procesarLote(archivos, {
      cancelado: () => generacion !== suGeneracion,
      alIniciar: (archivo, numero, total) => {
        zonaFacturas.actual = numero;
        zonaFacturas.archivo = archivo.name;
        avisar(`Procesando ${numero} de ${total}: ${archivo.name}`);
        pintarZonas();
      },
      leer: textosQrDeArchivo,
      agregar: (archivo, lectura) => {
        const antes = filas.length;
        agregarLectura(archivo, lectura);
        renderTodo();
        return filas.length - antes;
      },
      // cede el hilo para que el navegador pinte entre archivos
      ceder: () => new Promise((continuar) => setTimeout(continuar, 0)),
    });
  } finally {
    // Si la planilla se vació, `vaciarPlanilla` ya apagó el estado de "procesando": no se lo pisa a una tanda posterior.
    if (generacion === suGeneracion) zonaFacturas.procesando = false;
    renderTodo();
  }
  avisar(textoFinalLote(resultado), resultado.cancelado ? "aviso" : "ok");
}

/** Convierte lo que se leyó de un archivo en una o más filas (o en una fila "sin QR" con el motivo). */
function agregarLectura(archivo: File, lectura: Lectura<string[]>): void {
  if (!lectura.ok) {
    const motivo = lectura.error instanceof ErrorLectura ? lectura.error.message : "No se pudo procesar el archivo.";
    agregarComprobante(archivo.name, null, motivo);
    return;
  }
  const leidos: Comprobante[] = [];
  let primerError: ErrorQr | null = null;
  for (const texto of lectura.valor) {
    const r = leerUrlQr(texto);
    if (r instanceof ErrorQr) primerError ??= r;
    else leidos.push(r);
  }
  if (leidos.length > 0) {
    leidos.forEach((c, i) => agregarComprobante(leidos.length > 1 ? `${archivo.name} (QR ${i + 1})` : archivo.name, c));
  } else if (primerError) {
    agregarComprobante(archivo.name, null, `Se encontró un QR, pero no es de ARCA o está incompleto: ${primerError.message}`);
  } else {
    agregarComprobante(archivo.name, null, "No se encontró ningún QR en el archivo. Si es una foto o un escaneo, pruebe con más resolución (150 ppp o más) o con el PDF original del comprobante.");
  }
}

function encolarArchivos(lista: FileList | File[] | null | undefined): void {
  const archivos = lista ? Array.from(lista) : [];
  if (archivos.length === 0) return;
  const suGeneracion = generacion; // la tanda nace con el número actual: si se vacía antes de empezar, ni arranca
  cola = cola.then(() => procesarArchivos(archivos, suGeneracion)).catch(() => {
    zonaFacturas.error = "Ocurrió un error inesperado al procesar los archivos.";
    avisar(zonaFacturas.error, "error");
    pintarZonas();
  });
}

/**
 * Vacía la planilla y corta todo lo que se esté leyendo o esté en la cola: lo que ya estaba en vuelo se descarta. Lo usan
 * "Vaciar" y "Ver un ejemplo completo" (que reemplaza la planilla).
 *
 * Qué se reinicia (QA B9 de la etapa 3): lo que es de la planilla (filas, ediciones abiertas, lectura en curso, error de la zona y el
 * filtro, que vuelve a "Todas": con "Mal cargadas" activo, las facturas nuevas se verían a medias). Qué se conserva: el registro
 * cargado y los ajustes de antigüedad (umbral, orden, fecha de referencia), que son de la persona y no de las facturas.
 */
function vaciarPlanilla(): void {
  generacion++;
  cancelarLecturas();
  zonaFacturas.procesando = false;
  zonaFacturas.actual = 0;
  zonaFacturas.total = 0;
  zonaFacturas.error = "";
  filas = [];
  enEdicion.clear();
  marcarFiltro("todas");
}

entradaArchivos.addEventListener("change", () => {
  encolarArchivos(entradaArchivos.files);
  entradaArchivos.value = "";
});

zona.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (!zonaFacturas.arrastrando) {
    zonaFacturas.arrastrando = true;
    pintarZonas();
  }
});
zona.addEventListener("dragleave", (e) => {
  if (e.relatedTarget instanceof Node && zona.contains(e.relatedTarget)) return;
  zonaFacturas.arrastrando = false;
  pintarZonas();
});
zona.addEventListener("drop", (e) => {
  e.preventDefault();
  zonaFacturas.arrastrando = false;
  pintarZonas();
  encolarArchivos(e.dataTransfer?.files);
});
// Soltar un archivo fuera de la zona no debe hacer que el navegador lo abra y se pierda la planilla.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

formularioUrl.addEventListener("submit", (e) => {
  e.preventDefault();
  const lineas = areaUrl.value.split(/\r?\n/);
  const pendientes: string[] = [];
  const problemas: string[] = [];
  let agregadas = 0;
  lineas.forEach((linea, i) => {
    if (linea.trim() === "") return;
    const r = leerUrlQr(linea);
    if (r instanceof ErrorQr) {
      problemas.push(`Línea ${i + 1}: ${r.message}`);
      pendientes.push(linea);
    } else {
      agregarComprobante("Dirección pegada", r);
      agregadas++;
    }
  });
  areaUrl.value = pendientes.join("\n");
  if (agregadas > 0) renderTodo();
  if (agregadas === 0 && problemas.length === 0) avisar("Pegue al menos una dirección.", "aviso");
  else avisar([`${agregadas} ${agregadas === 1 ? "fila agregada" : "filas agregadas"}.`, ...problemas].join(" "), problemas.length > 0 ? "aviso" : "ok");
});

/** Agrega las facturas de ejemplo a la planilla (sin redibujar). Devuelve cuántas filas agregó. */
function cargarFacturasDeEjemplo(): number {
  const ejemplos = generarEjemplos(new Date());
  for (const ejemplo of ejemplos) {
    if (ejemplo.url === null) {
      agregarComprobante(ejemplo.origen, null, "Imagen de ejemplo sin QR legible: se puede completar a mano.", ejemplo.caso);
      continue;
    }
    const r = leerUrlQr(ejemplo.url);
    if (r instanceof ErrorQr) agregarComprobante(ejemplo.origen, null, r.message, ejemplo.caso);
    else agregarComprobante(ejemplo.origen, r, "", ejemplo.caso);
  }
  return ejemplos.length;
}

botonEjemplos.addEventListener("click", () => {
  zonaFacturas.error = "";
  const cantidad = cargarFacturasDeEjemplo();
  renderTodo();
  avisar(`Se cargaron ${cantidad} filas de ejemplo.`, "ok");
});

// Un solo arranque: facturas + registro de ejemplo, y se muestra el resultado de la conciliación.
function cargarEjemploCompleto(): void {
  cerrarGlobo(); // pulsar "Ver un ejemplo completo" cuenta como haber visto la primera visita (7.4)
  vaciarPlanilla();
  registro = null;
  origenRegistro = "";
  zonaFacturas.error = "";
  zonaCsv.error = "";
  const cantidad = cargarFacturasDeEjemplo();
  renderTodo();
  avisar("");
  aplicarRegistro(registroEjemplo(), "ejemplo", `También se cargaron ${cantidad} facturas de ejemplo.`);
  desplegarSiHaceFalta(seccionResultado);
  desplazarA(seccionResultado);
}

// Cargar el ejemplo reemplaza la planilla: si hay datos propios, se pide confirmar antes de perderlos.
for (const boton of [botonEjemploCompleto, botonEjemploCompleto2]) {
  conConfirmacion(boton, {
    necesita: () => filas.some((f) => !esFilaDeEjemplo(f)),
    textoConfirmar: "Confirmar: reemplazar la planilla por el ejemplo",
    aviso: "La planilla actual se reemplazará por el ejemplo. Vuelva a presionar el botón para confirmar.",
    accion: cargarEjemploCompleto,
  });
}

// ------------------------------------------------------------------ Exportar y vaciar

botonExportar.addEventListener("click", () => {
  const ahora = new Date();
  const dosVeces = registro === null || conciliacion === null ? undefined : filasCargadasDosVeces(filas, conciliacion, registro.clavesRepetidas);
  const csv = aCsv(filas, ahora, conciliacion?.porFila, dosVeces);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  const dia = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
  enlace.href = url;
  enlace.download = `cuentas-a-pagar-${dia}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  avisar(
    conciliacion === null
      ? "CSV exportado. Se abre en Excel con separador punto y coma."
      : "CSV exportado, con la columna de conciliación. Se abre en Excel con separador punto y coma.",
    "ok",
  );
});

conConfirmacion(botonVaciar, {
  necesita: () => true,
  textoConfirmar: "Confirmar: vaciar todo",
  aviso: "Vuelva a presionar el botón para vaciar la planilla.",
  accion: () => {
    vaciarPlanilla();
    renderTodo();
    avisar(textoPlanillaVaciada(registro !== null));
  },
});

// ------------------------------------------------------------------ Arranque

// Tabla en tarjetas: al cambiar `display` algunos navegadores le quitan la semántica, así que los roles van explícitos.
tabla.setAttribute("role", "table");
for (const parte of tabla.querySelectorAll("thead, tbody")) parte.setAttribute("role", "rowgroup");
for (const tr of tabla.querySelectorAll("thead tr")) tr.setAttribute("role", "row");
for (const th of tabla.querySelectorAll("thead th")) th.setAttribute("role", "columnheader");

if (typeof ResizeObserver !== "undefined") new ResizeObserver(ajustarPaneles).observe(envoltorio);

iniciarVentanas();
iniciarGuia();

// "Ordenar y antigüedad": abierto desde 40 rem (el mismo corte que pasa la planilla a tarjetas) y plegado en celular. Solo fija el
// estado inicial y sigue al ancho mientras la persona no lo haya tocado; si lo abre o lo cierra ella, se respeta su elección.
const bloqueAntiguedad = document.getElementById("barra-antiguedad");
if (bloqueAntiguedad instanceof HTMLDetailsElement) {
  const ancho = window.matchMedia("(min-width: 40rem)");
  let elegidoPorLaPersona = false;
  bloqueAntiguedad.open = ancho.matches;
  bloqueAntiguedad.querySelector("summary")?.addEventListener("click", () => {
    elegidoPorLaPersona = true;
  });
  ancho.addEventListener("change", () => {
    if (!elegidoPorLaPersona) bloqueAntiguedad.open = ancho.matches;
  });
}

// "Ir al resultado": si la ventana está plegada, se despliega antes de llevar el foco a su título.
document.querySelector<HTMLAnchorElement>("a.saltar")?.addEventListener("click", (e) => {
  e.preventDefault();
  irA(document.getElementById("titulo-resultado"));
});

const enlaceCodigo = document.querySelector<HTMLAnchorElement>("#enlace-codigo");
if (enlaceCodigo) {
  if (REPOSITORIO_PUBLICO) enlaceCodigo.href = URL_REPOSITORIO_PUBLICO;
  (enlaceCodigo.closest("li") ?? enlaceCodigo).hidden = !REPOSITORIO_PUBLICO;
}

renderTodo();
