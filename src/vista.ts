// Lógica de presentación sin DOM: qué se dice y con qué tono, ícono y acción en cada pieza de la interfaz.
// `main.ts` solo arma elementos con lo que devuelven estas funciones.

import { esAntigua, textoAntiguedad, textoDias, textoReferencia, type OrigenReferencia, type Referencia } from "./antiguedad.ts";
import {
  claveDuplicado,
  conMiles,
  formatearMonto,
  formatearNumeroCmp,
  listarMontos,
  nombreMonedaCorto,
  nombreTipo,
  pesosPrimero,
  type Estado,
} from "./comprobante.ts";
import {
  ETIQUETA_RESULTADO,
  TEXTO_CARGADA_DOS_VECES,
  copiasDe,
  detalleCargadaVariasVeces,
  diferenciaImporte,
  accionDeMalCargada,
  editoDatosDelCruce,
  contarConDesglose,
  lineasLeidas,
  textoCargadaVeces,
  itemsAtencion,
  mostrarConFiltro,
  type Conciliacion,
  type FiltroFilas,
  type ItemAtencion,
  type LecturaRegistro,
  type ParteDetalle,
  type Registro,
  type Resultado,
  type ResumenConciliacion,
} from "./conciliacion.ts";
import { formatearCuit } from "./cuit.ts";
import type { NombreIcono } from "./iconos.ts";
import { duplicadas, type Fila, type Resumen, type TotalMoneda } from "./planilla.ts";

/** Tonos de estado. El color nunca va solo: cada etiqueta lleva texto e ícono. */
export type Tono = "ok" | "pendiente" | "revisar" | "diferencia" | "neutro";

export interface EtiquetaVista {
  texto: string;
  tono: Tono;
  icono: NombreIcono;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

// ---------------------------------------------------------------- Etiquetas de estado (5.3)

const PRESENTACION_RESULTADO: Record<Resultado["tipo"], { tono: Tono; icono: NombreIcono }> = {
  falta: { tono: "pendiente", icono: "punto" },
  revisar: { tono: "revisar", icono: "alerta" },
  "ya-cargada": { tono: "ok", icono: "check" },
  "otro-importe": { tono: "diferencia", icono: "distinto" },
  "otro-emisor": { tono: "diferencia", icono: "distinto" },
  "no-conciliable": { tono: "neutro", icono: "guion" },
  // Estado propio de atención (C1): nunca verde, para que no se confunda con una factura ya cargada.
  duplicada: { tono: "revisar", icono: "copias" },
};

export type { ParteDetalle };

/** Un comprobante que el sistema trae dos veces: error del sistema, estado de atención como la duplicada, nunca verde. Lleva el ícono del sistema y no el de las copias de la planilla, para distinguirlas por la forma y no solo por el texto. */
export const ETIQUETA_CARGADA_DOS_VECES: EtiquetaVista = { texto: TEXTO_CARGADA_DOS_VECES, tono: "revisar", icono: "sistema" };

/**
 * `numeroDelOriginal` es el número (en la tabla) de la fila que la duplicada repite: con él la etiqueta lo nombra.
 * `cargadaDosVeces` (`filasCargadasDosVeces`) cambia el "Ya cargada" o el "Mal cargada: otro importe" de un comprobante repetido en el sistema.
 */
export function etiquetaConciliacion(r: Resultado, numeroDelOriginal?: number | string, cargadaDosVeces = false): EtiquetaVista {
  if (r.tipo === "duplicada" && numeroDelOriginal !== undefined) return etiquetaDuplicada(numeroDelOriginal);
  if (cargadaDosVeces && (r.tipo === "ya-cargada" || r.tipo === "otro-importe" || r.tipo === "otro-emisor")) {
    return { ...ETIQUETA_CARGADA_DOS_VECES, texto: textoCargadaVeces(copiasDe(r)?.length ?? 2) };
  }
  return { texto: ETIQUETA_RESULTADO[r.tipo], ...PRESENTACION_RESULTADO[r.tipo] };
}

/** `null` si la lectura salió bien: "Leída" no es una etiqueta sino texto suave. */
export function etiquetaLectura(estado: Estado): EtiquetaVista | null {
  if (estado === "revisar") return { texto: "Revisar", tono: "revisar", icono: "alerta" };
  if (estado === "sin-qr") return { texto: "Sin QR", tono: "diferencia", icono: "sin-qr" };
  return null;
}

export function etiquetaDuplicada(numeroDeFila: number | string): EtiquetaVista {
  return { texto: `Duplicada de la fila ${numeroDeFila}`, tono: "revisar", icono: "copias" };
}

/** Marca de una factura que falta cargar desde hace `umbral` días o más. `null` si no corresponde. */
export function etiquetaAntigua(dias: number | null, umbral: number): EtiquetaVista | null {
  return esAntigua(dias, umbral) ? { texto: `${textoDias(umbral)} o más`, tono: "revisar", icono: "reloj" } : null;
}

/**
 * Lo que está activo en "Ordenar y antigüedad", para el rótulo del bloque cuando está plegado: el umbral siempre ("desde 30 días") y el
 * orden solo si no es el de la planilla. Ejemplo: "desde 30 días · más antiguas primero". Si algún campo quedó con un valor inválido,
 * lo dice al final ("· hay un valor por corregir"): plegado, el mensaje del campo no se ve.
 */
export function resumenAntiguedad(umbral: number, orden: "numero" | "antiguedad", hayValorPorCorregir = false): string {
  return `desde ${textoDias(umbral)}${orden === "antiguedad" ? " · más antiguas primero" : ""}${hayValorPorCorregir ? " · hay un valor por corregir" : ""}`;
}

/**
 * `aria-describedby` de un campo: con error, el id del mensaje va primero (el lector dice antes lo que está mal que la explicación
 * larga del campo); sin error, se lo quita. `null` si no queda ninguna descripción (hay que quitar el atributo).
 */
export function describedbyConError(actual: string | null, idError: string, hayError: boolean): string | null {
  const otros = (actual ?? "").split(" ").filter((x) => x !== "" && x !== idError);
  const ids = hayError ? [idError, ...otros] : otros;
  return ids.length === 0 ? null : ids.join(" ");
}

export const ETIQUETA_EDITADA: EtiquetaVista = { texto: "Editada a mano", tono: "neutro", icono: "lapiz" };

// ---------------------------------------------------------------- Filtros (5.11)

/** Cantidad de filas de cada filtro, con la misma regla con que se filtra (los duplicados no cuentan, "todas" sí). */
export function conteosFiltros(filas: readonly Fila[], conciliacion: Conciliacion | null): Record<FiltroFilas, number> {
  const cuenta: Record<FiltroFilas, number> = { todas: filas.length, faltan: 0, revisar: 0, diferencias: 0 };
  if (conciliacion === null) return cuenta;
  const repetidas = duplicadas(filas);
  for (const fila of filas) {
    const resultado = conciliacion.porFila.get(fila.id);
    const esDuplicada = repetidas.has(fila.id);
    for (const filtro of ["faltan", "revisar", "diferencias"] as const) {
      if (mostrarConFiltro(filtro, resultado, esDuplicada)) cuenta[filtro]++;
    }
  }
  return cuenta;
}

// ---------------------------------------------------------------- Resultado protagonista (5.7)

export interface Protagonista {
  /**
   * `leidos`: hay comprobantes pero no registro. `faltan`: hay que cargar. `cero`: no falta nada (y se comparó al menos uno).
   * `sin-lecturas`: hay registro pero ningún comprobante se pudo comparar: no se puede afirmar que no falte nada.
   */
  variante: "leidos" | "faltan" | "cero" | "sin-lecturas";
  tono: "neutro" | "pendiente" | "ok";
  rotulo: string;
  cifra: string;
  /** "facturas", "notas de débito", "facturas y notas de débito" o "notas de crédito", al lado de la cifra. Vacío si no corresponde. */
  unidad: string;
  /** Un monto por moneda, pesos primero: `["$ 6.120,00", "US$ 1.250,00"]`. */
  montos: string[];
  mensaje: string;
  /** Las notas de crédito que faltan, en su propio renglón (no se suman a las facturas). `null` si no hay, o si ya son el renglón principal. */
  ademas: { cifra: string; unidad: string; montos: string[] } | null;
  accion: { texto: string; filtro: "faltan" } | null;
}

interface GrupoFaltan {
  cantidad: number;
  unidad: string;
  montos: TotalMoneda[];
}

/**
 * Cómo se llama el grupo que no son notas de crédito. No es "comprobantes" (una nota de crédito también lo es): sale de lo que falte.
 * Solo facturas, solo notas de débito, o las dos juntas (en ese caso siempre en plural).
 */
function unidadSinNotasDeCredito(cantidad: number, notasDebito: number, otrosTipos: number): string {
  // Un tipo que la demo no conoce puede ser cualquier cosa: no se lo llama factura (ni nota de débito).
  if (otrosTipos > 0) return cantidad === 1 ? "comprobante" : "comprobantes";
  if (notasDebito === 0) return cantidad === 1 ? "factura" : "facturas";
  if (notasDebito === cantidad) return cantidad === 1 ? "nota de débito" : "notas de débito";
  return "facturas y notas de débito";
}

/** Lo que falta cargar, en grupos no vacíos: primero facturas y notas de débito (nombradas por lo que haya) y después las notas de crédito. */
function gruposFaltan(r: ResumenConciliacion): GrupoFaltan[] {
  const sinNotasDeCredito = r.faltan - r.faltanNotasCredito;
  const grupos: GrupoFaltan[] = [
    { cantidad: sinNotasDeCredito, unidad: unidadSinNotasDeCredito(sinNotasDeCredito, r.faltanNotasDebito, r.faltanOtrosTipos), montos: r.faltanPorMoneda },
    { cantidad: r.faltanNotasCredito, unidad: r.faltanNotasCredito === 1 ? "nota de crédito" : "notas de crédito", montos: r.faltanNotasCreditoPorMoneda },
  ];
  return grupos.filter((g) => g.cantidad > 0);
}

/** `true` si al menos un comprobante se pudo comparar con el registro (los duplicados no cuentan: dependen de su original). */
export function hayComprobantesParaComparar(r: ResumenConciliacion): boolean {
  return r.faltan + r.revisar + r.yaCargadas + r.conDiferencias > 0;
}

function montosDe(items: ReadonlyArray<{ moneda: string; total: number }>): string[] {
  return [...items].sort((a, b) => pesosPrimero(a.moneda, b.moneda)).map((i) => formatearMonto(i.moneda, i.total));
}

/**
 * `totalesPlanilla` y `cantidadFilas` se usan sin registro; con registro manda `resumen` (cuánto falta cargar).
 */
export function protagonista(cantidadFilas: number, totalesPlanilla: readonly TotalMoneda[], resumen: ResumenConciliacion | null): Protagonista {
  if (resumen === null) {
    return {
      variante: "leidos",
      tono: "neutro",
      rotulo: "Comprobantes leídos",
      cifra: String(cantidadFilas),
      unidad: "",
      montos: montosDe(totalesPlanilla),
      mensaje: "",
      ademas: null,
      accion: null,
    };
  }
  if (!hayComprobantesParaComparar(resumen)) {
    return {
      variante: "sin-lecturas",
      tono: "neutro",
      rotulo: "Comprobantes leídos",
      cifra: "0",
      unidad: "",
      montos: [],
      mensaje:
        cantidadFilas === 0
          ? "Todavía no hay comprobantes para comparar con su sistema."
          : "No se pudo leer ningún comprobante, así que no hay nada para comparar con su sistema. Revise los avisos de cada fila o complete los datos a mano.",
      ademas: null,
      accion: null,
    };
  }
  if (resumen.faltan === 0) {
    return {
      variante: "cero",
      tono: "ok",
      // El 0 ya lo dice todo: una frase que repitiera "no falta cargar" sería lo mismo dos veces (QA B6). La frase queda en el anuncio y el rótulo.
      rotulo: "Falta cargar",
      cifra: "0",
      unidad: "comprobantes",
      montos: [],
      mensaje: "",
      ademas: null,
      accion: null,
    };
  }
  const uno = resumen.faltan === 1;
  const [principal, segundo] = gruposFaltan(resumen) as [GrupoFaltan, GrupoFaltan | undefined];
  return {
    variante: "faltan",
    tono: "pendiente",
    rotulo: "Falta cargar",
    cifra: String(principal.cantidad),
    unidad: principal.unidad,
    montos: montosDe(principal.montos),
    mensaje: "",
    ademas: segundo === undefined ? null : { cifra: String(segundo.cantidad), unidad: segundo.unidad, montos: montosDe(segundo.montos) },
    accion: { texto: uno ? "Ver el comprobante en la planilla" : `Ver los ${resumen.faltan} en la planilla`, filtro: "faltan" },
  };
}

// ---------------------------------------------------------------- Requieren atención (5.8)

export type AccionAtencion =
  | { tipo: "filtro"; filtro: Exclude<FiltroFilas, "todas">; texto: string }
  | { tipo: "detalle"; destino: "dos-veces" | "no-recibidas"; texto: string }
  /** Lleva a la primera fila duplicada de la planilla (con todas las filas a la vista). */
  | { tipo: "duplicadas"; texto: string };

export interface ItemAtencionVista extends ItemAtencion {
  tono: Tono;
  icono: NombreIcono;
  accion: AccionAtencion;
}

const PRESENTACION_ATENCION: Record<ItemAtencion["clave"], { tono: Tono; icono: NombreIcono; accion: AccionAtencion }> = {
  revisar: { tono: "revisar", icono: "alerta", accion: { tipo: "filtro", filtro: "revisar", texto: "Ver" } },
  diferencias: { tono: "diferencia", icono: "distinto", accion: { tipo: "filtro", filtro: "diferencias", texto: "Ver" } },
  duplicadas: { tono: "revisar", icono: "copias", accion: { tipo: "duplicadas", texto: "Ver" } },
  dosVeces: { tono: "revisar", icono: "sistema", accion: { tipo: "detalle", destino: "dos-veces", texto: "Ver detalle" } },
  sinComprobante: { tono: "neutro", icono: "guion", accion: { tipo: "detalle", destino: "no-recibidas", texto: "Ver detalle" } },
};

export function presentarAtencion(items: readonly ItemAtencion[]): ItemAtencionVista[] {
  return items.map((item) => ({ ...item, ...PRESENTACION_ATENCION[item.clave] }));
}

// ---------------------------------------------------------------- Línea de lectura y totales (5.8, 5.14)

/** "Lectura: 11 comprobantes (7 leídos, 3 para revisar, 1 sin QR, 1 duplicado)". Vacío si no hay filas. */
export function textoLectura(r: Resumen): string {
  if (r.total === 0) return "";
  const leidos = plural(r.leidas, "leído", "leídos");
  return `Lectura: ${plural(r.total, "comprobante", "comprobantes")} (${leidos}, ${r.revisar} para revisar, ${r.sinQr} sin QR, ${plural(r.duplicadas, "duplicado", "duplicados")})`;
}

export interface TotalVista {
  nombre: string;
  monto: string;
  cantidad: string;
}

export function totalesVista(totales: readonly TotalMoneda[]): TotalVista[] {
  return [...totales]
    .sort((a, b) => pesosPrimero(a.moneda, b.moneda))
    .map((t) => ({ nombre: nombreMonedaCorto(t.moneda), monto: formatearMonto(t.moneda, t.total), cantidad: plural(t.cantidad, "comprobante", "comprobantes") }));
}

// ---------------------------------------------------------------- Detalle de una línea por fila (6.3)

/** Todos los avisos de lectura de una fila: con QR, la nota y los motivos; sin QR, la nota o el primer motivo. */
export function avisosDeFila(fila: Fila, motivos: readonly string[]): string[] {
  const avisos = fila.conQr ? [fila.nota, ...motivos] : [fila.nota || motivos[0] || ""];
  return avisos.filter((a) => a !== "");
}

/**
 * Los avisos de una fila cuando el control del comprobante tiene observaciones: la nota de la fila y esas frases (con lo más grave
 * primero, y con las mismas palabras que el detalle). Sin observaciones, los de siempre (`avisosDeFila`).
 */
export function avisosConControl(fila: Fila, motivos: readonly string[], observaciones: readonly { mensaje: string }[]): string[] {
  if (observaciones.length === 0) return avisosDeFila(fila, motivos);
  return [fila.nota, ...observaciones.map((o) => o.mensaje)].filter((a) => a !== "");
}

/** El primer texto y, si hay más, "y N más." (la lista completa vive en el panel de edición). Sin punto doble antes de la «y». */
export function unaLinea(textos: readonly string[]): string {
  const [primero, ...resto] = textos;
  if (primero === undefined) return "";
  return resto.length === 0 ? primero : `${primero.replace(/\.$/, "")} y ${resto.length} más.`;
}

function faltantesParaConciliar(fila: Fila): string {
  const d = fila.datos;
  const faltan: string[] = [];
  if (d.cuit.length !== 11) faltan.push("el CUIT");
  if (d.tipoCmp === null) faltan.push("el tipo de comprobante");
  if (d.ptoVta === null) faltan.push("el punto de venta");
  if (d.nroCmp === null) faltan.push("el número de comprobante");
  if (faltan.length === 0) return "";
  if (faltan.length === 1) return `Falta ${faltan[0]}.`;
  return `Faltan ${faltan.slice(0, -1).join(", ")} y ${faltan[faltan.length - 1]}.`;
}

const parteTexto = (t: string): ParteDetalle => ({ tipo: "texto", texto: t });

/**
 * La única línea secundaria que lleva la fila bajo su etiqueta (o bajo "Lectura" si no hay registro), en partes para que
 * la interfaz proteja el CUIT y los importes de un corte de renglón.
 */
export function detalleFilaPartes(
  resultado: Resultado | undefined,
  fila: Fila,
  avisos: readonly string[],
  /** Días desde la emisión, solo para "Falta cargar" (`diasDeFila`). `null` o ausente: no se dice nada. */
  dias?: number | null,
  /** De dónde sale la fecha de referencia: con `"hoy"` el día cero se dice "hoy". */
  origenReferencia: OrigenReferencia = "hoy",
): ParteDetalle[] {
  const plano = (t: string): ParteDetalle[] => (t === "" ? [] : [parteTexto(t)]);
  if (resultado === undefined || resultado.tipo === "revisar") return plano(unaLinea(avisos));
  const moneda = fila.datos.moneda;
  // Con datos escritos a mano la diferencia puede estar en lo escrito: el texto no manda a dar de baja nada (ver `ACCION_MAL_CARGADA_EDITADA`).
  const editada = editoDatosDelCruce(fila);
  // El sistema tiene el comprobante más de una vez: error del sistema; se lo compara con todas las copias y se dice cuál sobra.
  const variasVeces = detalleCargadaVariasVeces(resultado, fila.datos.importe, fila.datos.tipoCmp, (n) => formatearMonto(moneda, n), editada);
  if (variasVeces !== null) return variasVeces.partes;
  switch (resultado.tipo) {
    case "otro-importe": {
      const monto = (n: number): ParteDetalle => ({ tipo: "monto", texto: formatearMonto(moneda, n) });
      const diferencia = diferenciaImporte(resultado.importeFila, resultado.importeRegistro, fila.datos.tipoCmp);
      return [
        parteTexto("Planilla "),
        resultado.importeFila === null ? parteTexto("sin importe") : monto(resultado.importeFila),
        parteTexto(" · Sistema "),
        monto(resultado.importeRegistro),
        ...(diferencia === null ? [] : [parteTexto(" · Diferencia "), monto(diferencia)]),
        parteTexto(`. ${accionDeMalCargada(editada)}`),
      ];
    }
    case "otro-emisor":
      return [parteTexto("En el sistema con CUIT "), { tipo: "codigo", texto: formatearCuit(resultado.cuitRegistro) }, parteTexto(`. ${accionDeMalCargada(editada)}`)];
    case "falta":
      return dias === undefined || dias === null ? [] : plano(textoAntiguedad(dias, origenReferencia));
    case "no-conciliable":
      return plano(!fila.conQr && avisos.length > 0 ? unaLinea(avisos) : faltantesParaConciliar(fila));
    default:
      return [];
  }
}

/** El mismo detalle como un solo texto (para pruebas y para quien no necesita las partes). */
export function detalleFila(
  resultado: Resultado | undefined,
  fila: Fila,
  avisos: readonly string[],
  dias?: number | null,
  origenReferencia: OrigenReferencia = "hoy",
): string {
  return detalleFilaPartes(resultado, fila, avisos, dias, origenReferencia)
    .map((p) => p.texto)
    .join("");
}

/** Nombre accesible del botón de cada fila: dice cuál es ("Editar la fila 3: Factura A 0003-00001245"). */
export function nombreBotonEditar(editando: boolean, numeroDeFila: number, fila: Fila): string {
  const numero = formatearNumeroCmp(fila.datos.ptoVta, fila.datos.nroCmp);
  return `${editando ? "Editando" : "Editar"} la fila ${numeroDeFila}: ${tituloComprobante(fila)}${numero === "" ? "" : ` ${numero}`}`;
}

/**
 * El CSV del sistema no trae la moneda: se usa la de la factura con la misma clave y, si no hay (o no tiene moneda), pesos.
 * Sirve para que los importes de las listas lleven su símbolo (C3).
 */
export function monedaDeRegistro(filas: readonly Fila[], r: Registro): string {
  const clave = claveDuplicado({ cuit: r.cuit, tipoCmp: r.tipoCmp, ptoVta: r.ptoVta, nroCmp: r.nroCmp });
  const moneda = filas.find((f) => claveDuplicado(f.datos) === clave)?.datos.moneda ?? "";
  return moneda === "" ? "PES" : moneda;
}

/** Línea 1 de la celda "Comprobante": el tipo; si la fila no tiene datos, el nombre del archivo para poder reconocerla. */
export function tituloComprobante(fila: Fila): string {
  const d = fila.datos;
  if (d.tipoCmp !== null) return nombreTipo(d.tipoCmp);
  return d.nroCmp === null && d.ptoVta === null ? fila.origen : "Sin tipo";
}

// ---------------------------------------------------------------- Zonas de carga (5.4)

export type EstadoZona = "vacia" | "arrastrando" | "procesando" | "con-datos" | "error";

export interface TextosZona {
  titulo: string;
  ayuda: string;
  /** Texto de la acción de la derecha ("Agregar más", "Cambiar") cuando la zona ya tiene datos; vacío si no hay. */
  accion: string;
}

export function estadoDeZona(e: { arrastrando: boolean; procesando: boolean; error: string; hayDatos: boolean }): EstadoZona {
  if (e.arrastrando) return "arrastrando";
  if (e.procesando) return "procesando";
  if (e.error !== "") return "error";
  return e.hayDatos ? "con-datos" : "vacia";
}

export function textosZonaComprobantes(
  estado: EstadoZona,
  d: { tactil: boolean; cantidad: number; actual: number; total: number; archivo: string; error: string },
): TextosZona {
  const vacia: TextosZona = {
    titulo: d.tactil ? "Elegir archivos" : "Arrastre PDF o imágenes aquí o elíjalos",
    ayuda: "Con el QR de ARCA. Hasta 15 MB por archivo.",
    accion: "",
  };
  switch (estado) {
    case "vacia":
      return vacia;
    case "arrastrando":
      return { ...vacia, titulo: "Suelte para agregar" };
    case "procesando":
      return { titulo: `Procesando ${d.actual} de ${d.total}`, ayuda: d.archivo, accion: "" };
    case "con-datos":
      return { titulo: plural(d.cantidad, "comprobante cargado", "comprobantes cargados"), ayuda: "", accion: "Agregar más" };
    case "error":
      return { ...vacia, ayuda: d.error };
  }
}

export function textosZonaRegistro(estado: EstadoZona, d: { tactil: boolean; cantidad: number; origen: string; error: string }): TextosZona {
  const vacia: TextosZona = {
    titulo: d.tactil ? "Elegir CSV" : "Arrastre el CSV aquí o elíjalo",
    ayuda: "Hasta 2 MB y 20.000 líneas.",
    accion: "",
  };
  switch (estado) {
    case "vacia":
    case "procesando":
      return vacia;
    case "arrastrando":
      return { ...vacia, titulo: "Suelte para cargar el registro" };
    case "con-datos":
      return { titulo: `Registro: ${plural(d.cantidad, "comprobante", "comprobantes")} (${d.origen})`, ayuda: "", accion: "Cambiar" };
    case "error":
      return { ...vacia, ayuda: d.error };
  }
}

/** Aviso al terminar de leer una tanda de archivos. Si se cortó porque se vació la planilla, no habla de filas que ya no están. */
export function textoFinalLote(r: { procesados: number; agregadas: number; cancelado: boolean }): string {
  if (r.cancelado) return "Lectura cancelada: la planilla se vació antes de terminar.";
  return `Listo: ${plural(r.procesados, "archivo procesado", "archivos procesados")}, ${plural(r.agregadas, "fila agregada", "filas agregadas")}.`;
}

/**
 * Aviso de un registro leído. "Comprobantes" son claves distintas (CUIT, tipo, punto de venta y número), no líneas: si el archivo repite
 * alguna, lo aclara con las líneas leídas y cuántas claves figuran más de una vez (QA B3 de la etapa 3).
 */
export function textoRegistroCargado(origen: string, r: LecturaRegistro): string {
  const base = origen === "ejemplo" ? "Registro de ejemplo cargado" : `Registro cargado (${origen})`;
  const distintos = r.registros.length;
  const lineas = lineasLeidas(r);
  const conDesglose = contarConDesglose(r);
  const desglose = conDesglose === 0 ? "" : ` El desglose (neto, IVA, otros o vencimiento del CAE) viene en ${plural(conDesglose, "comprobante", "comprobantes")}.`;
  if (lineas === distintos) return `${base}: ${plural(distintos, "comprobante", "comprobantes")}.${desglose}`;
  const repetidas = r.clavesRepetidas.length;
  return `${base}: ${plural(distintos, "comprobante distinto", "comprobantes distintos")} en ${conMiles(lineas)} ${lineas === 1 ? "línea" : "líneas"}; ${plural(repetidas, "figura", "figuran")} más de una vez.${desglose}`;
}

/**
 * Aviso al vaciar la planilla. "Vaciar" reinicia lo que es de la planilla (filas, ediciones abiertas, lectura en curso, error de la zona
 * y el filtro, que vuelve a "Todas"); el registro cargado y los ajustes de antigüedad (umbral, orden y fecha de referencia) son de la
 * persona y se conservan: por eso, con un registro activo, lo dice.
 */
export function textoPlanillaVaciada(hayRegistro: boolean): string {
  return hayRegistro ? "Planilla vaciada. El registro y los ajustes de antigüedad se conservan; el filtro vuelve a Todas." : "Planilla vaciada.";
}

/** Aviso de un registro que no se pudo leer. Con uno ya activo, aclara que sigue valiendo (QA medio 4). */
export function textoErrorRegistro(mensaje: string, hayRegistroActivo: boolean): string {
  return hayRegistroActivo ? `${mensaje} Se mantiene el registro anterior.` : mensaje;
}

// ---------------------------------------------------------------- Listas largas (QA medio 7)

/** Cuántos renglones se pintan como máximo en las listas del resultado ("cargadas dos veces", "cargadas y no recibidas"). */
export const TOPE_LISTA = 50;

export interface ListaLimitada<T> {
  visibles: T[];
  /** Cuántos quedaron sin mostrar. */
  resto: number;
  /** "y 19.950 más" (vacío si se muestra todo). */
  textoResto: string;
}

export function limitarLista<T>(items: readonly T[], maximo: number = TOPE_LISTA): ListaLimitada<T> {
  const resto = Math.max(0, items.length - maximo);
  return { visibles: items.slice(0, maximo), resto, textoResto: resto === 0 ? "" : `y ${conMiles(resto)} más` };
}

// ---------------------------------------------------------------- Dato de cada barra de título (13.4)

export function metaComprobantes(e: { procesando: boolean; actual: number; total: number; cantidad: number }): string {
  if (e.procesando) return `Procesando ${e.actual} de ${e.total}`;
  return e.cantidad === 0 ? "" : plural(e.cantidad, "comprobante", "comprobantes");
}

/** `null` = sin registro cargado. */
export function metaRegistro(cantidad: number | null): string {
  return cantidad === null ? "Opcional" : plural(cantidad, "registro", "registros");
}

export function metaResultado(cantidadFilas: number, resumen: ResumenConciliacion | null): string {
  if (cantidadFilas === 0) return "";
  if (resumen === null) return "Sin registro para cruzar";
  if (!hayComprobantesParaComparar(resumen)) return "Sin comprobantes para comparar";
  if (resumen.faltan === 0) return "No falta cargar nada";
  // Siempre se nombra cada grupo: "2 facturas y 1 nota de crédito" (no se suman como si fueran facturas) o "3 notas de débito" (QA B5).
  return `Falta cargar ${gruposFaltan(resumen).map((g) => `${g.cantidad} ${g.unidad}`).join(" y ")}`;
}

/** "11 comprobantes", o "2 de 11" cuando un filtro deja ver solo una parte. */
export function metaPlanilla(visibles: number, total: number): string {
  if (total === 0) return "";
  return visibles === total ? plural(total, "comprobante", "comprobantes") : `${visibles} de ${total}`;
}

// ---------------------------------------------------------------- Anuncios para lectores de pantalla (A1)

/** Se anuncia al cambiar el filtro de la planilla. */
export function textoMostrando(visibles: number, total: number): string {
  return `Mostrando ${visibles} de ${total} ${total === 1 ? "comprobante" : "comprobantes"}`;
}

/** Resumen que se anuncia al terminar de conciliar: lo que falta y lo que requiere atención. */
export function anuncioConciliacion(r: ResumenConciliacion): string {
  if (!hayComprobantesParaComparar(r)) {
    const motivo = r.noConciliables > 0 ? "No se pudo leer ningún comprobante, así que no hay nada para comparar." : "Todavía no hay comprobantes para comparar.";
    return `Conciliación terminada. ${motivo}`;
  }
  const falta =
    r.faltan === 0
      ? "No falta cargar ningún comprobante."
      : // Cada grupo con sus montos; el segundo (notas de crédito) va tras "además": una "y" lo confundiría con otro monto (accesibilidad M5).
        `Falta cargar ${gruposFaltan(r)
          .map((g) => `${g.cantidad} ${g.unidad}${g.montos.length > 0 ? ` por ${listarMontos(g.montos)}` : ""}`)
          .join("; además, ")}.`;
  const items = itemsAtencion(r);
  const atencion = items.length === 0 ? "Nada requiere atención." : `Requieren atención: ${items.map((i) => `${i.cifra} ${i.texto}`).join(", ")}.`;
  return `Conciliación terminada. ${falta} ${atencion}`;
}

// ---------------------------------------------------------------- Anuncios de ordenar y de antigüedad (accesibilidad M2)

export function anuncioOrden(orden: "numero" | "antiguedad"): string {
  return orden === "antiguedad"
    ? "Planilla ordenada: lo que falta cargar, de la más antigua a la más nueva."
    : "Planilla en el orden en que se cargaron los comprobantes.";
}

/** "3 comprobantes por cargar tienen 30 días o más." */
export function textoMarcadas(cantidad: number, umbral: number): string {
  const desde = `${textoDias(umbral)} o más`;
  if (cantidad === 0) return `Ningún comprobante por cargar tiene ${desde}.`;
  return cantidad === 1 ? `1 comprobante por cargar tiene ${desde}.` : `${conMiles(cantidad)} comprobantes por cargar tienen ${desde}.`;
}

export function anuncioUmbral(umbral: number, marcadas: number): string {
  return textoMarcadas(marcadas, umbral);
}

export function anuncioReferencia(referencia: Referencia, umbral: number, marcadas: number): string {
  return `${textoReferencia(referencia)} ${textoMarcadas(marcadas, umbral)}`;
}
