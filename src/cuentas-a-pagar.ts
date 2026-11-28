// Cuentas a pagar: cruza las facturas de la planilla con un extracto de pagos y dice, para cada pago, a qué factura va y por qué.
// Funciones puras, sin acceso al navegador. Sin reglas fiscales: no calcula percepciones, retenciones ni alícuotas; el cruce es por
// CUIT, importe y referencia. Lo dudoso no se decide: queda "para revisar" con las facturas candidatas.
//
// Orden del cruce (cada fase solo mira los pagos que las anteriores no resolvieron):
//   0. Duplicados: el mismo número de operación con el mismo CUIT e importe, o la misma fecha, CUIT, importe y referencia. El segundo no
//      cuenta. Un número de operación repetido con otro CUIT u otro importe no es un duplicado: se cruza y lleva un aviso.
//   1. Referencia: el texto libre nombra la factura ("FA 0003-00001245"). Paga esa factura, completa o en parte.
//   2. CUIT e importe: una sola factura abierta del CUIT tiene ese saldo (el saldo exacto gana a uno que solo entra en la tolerancia) y
//      ningún otro pago compite por ella.
//   3. Suma: una sola combinación de facturas abiertas del CUIT suma el importe y ningún otro pago compite por ella.
//   4. Lo que queda: única factura abierta y pago menor = pago parcial; pago igual a lo que falta = la salda; varias abiertas = no se
//      sabe a cuál; ninguna = sin factura.
// Dentro de cada fase los pagos se toman por fecha y por línea, y las facturas por fecha y número: el resultado no depende del orden
// en que vengan las listas.

import { UMBRAL_ANTIGUEDAD_POR_DEFECTO, diasEntre, esAntigua } from "./antiguedad.ts";
import { claveDuplicado, esNotaDeCredito, fechaArgentinaIso, formatearMonto, formatearNumeroCmp, nombreTipo } from "./comprobante.ts";
import { formatearCuit } from "./cuit.ts";
import type { Pago } from "./extracto.ts";
import { duplicadas, type Fila } from "./planilla.ts";

/** Diferencia de centavos que se perdona entre un pago y un saldo (redondeos del banco o del sistema). */
export const TOLERANCIA_CENTAVOS_POR_DEFECTO = 2;
/** Con más facturas abiertas de un mismo CUIT no se prueban combinaciones (crecen demasiado y casi siempre son ambiguas). */
export const MAX_FACTURAS_EN_SUMA = 12;
/** Un pago "para revisar" nombra las facturas que podrían ser hasta este número; con más, no se listan (la lista no ayudaría a decidir). */
export const MAX_CANDIDATAS = 20;

/** Una factura a pagar: lo mínimo que el cruce necesita. `id` identifica a la factura en el resultado y no se repite. */
export interface FacturaAPagar {
  id: number;
  /** Solo dígitos (11). */
  cuit: string;
  tipoCmp: number;
  ptoVta: number;
  nroCmp: number;
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** En pesos, mayor que cero. */
  importe: number;
  /** De dónde salió (el nombre del archivo en la planilla). */
  origen?: string;
}

export type ReglaPago = "referencia" | "importe-exacto" | "suma-de-facturas" | "pago-parcial";
export type EstadoPago = "emparejado" | "sin-factura" | "duplicado" | "revisar";
export type EstadoFactura = "pagada" | "parcial" | "impaga";
export type CodigoAviso = "mismo-usuario" | "cuit-invalido" | "operacion-repetida";

/** Cuánto de un pago se aplicó a una factura. */
export interface Imputacion {
  facturaId: number;
  importe: number;
}

export interface AvisoPago {
  codigo: CodigoAviso;
  mensaje: string;
}

export interface ResultadoPago {
  pago: Pago;
  estado: EstadoPago;
  /** Con qué regla se emparejó. `null` si no se emparejó. */
  regla: ReglaPago | null;
  imputaciones: Imputacion[];
  /** Lo que del pago no quedó aplicado a ninguna factura (un pago de más, o todo el pago si no se emparejó). 0 en un duplicado. */
  sinImputar: number;
  /** Solo en "revisar": las facturas que podrían ser (la persona decide). */
  candidatas: number[];
  /** Solo en "duplicado": línea del pago que se conserva. */
  duplicadoDe: number | null;
  /** La explicación, en una o dos frases. Siempre está. */
  porQue: string;
  /** Control interno (no cambia el cruce). */
  avisos: AvisoPago[];
}

export interface SituacionFactura {
  factura: FacturaAPagar;
  estado: EstadoFactura;
  pagado: number;
  /** Lo que falta pagar. Con una diferencia dentro de la tolerancia, la factura figura pagada y el saldo muestra esa diferencia. */
  saldo: number;
  /** Líneas de los pagos que la pagaron, completa o en parte. */
  pagos: number[];
  /** Días corridos desde la emisión hasta la fecha de referencia. Negativo si se emitió después. `null` si la fecha no es válida. */
  dias: number | null;
  /** Impaga o parcial, y con el umbral de días cumplido. */
  antigua: boolean;
  /** Líneas de pagos "para revisar" que podrían ser de esta factura: no se la puede dar por impaga sin mirarlos. */
  enRevision: number[];
}

export interface Emparejamiento {
  pagoLinea: number;
  facturaId: number;
  importe: number;
  regla: ReglaPago;
  porQue: string;
}

export interface AvisoControl extends AvisoPago {
  linea: number;
}

export interface ResumenPagos {
  facturas: number;
  pagadas: number;
  parciales: number;
  impagas: number;
  /** Impagas o parciales con el umbral de antigüedad cumplido. */
  antiguas: number;
  pagos: number;
  emparejados: number;
  sinFactura: number;
  duplicados: number;
  paraRevisar: number;
  /** Pagos con algún aviso de control interno. */
  conAvisoDeControl: number;
  importeFacturado: number;
  /** Lo imputado a facturas. */
  importePagado: number;
  /** Suma de lo que falta de las facturas no pagadas. */
  saldoPendiente: number;
  importeSinFactura: number;
}

export interface ConciliacionPagos {
  /** Uno por pago, en el orden en que llegaron. */
  pagos: ResultadoPago[];
  /** Una por factura, en el orden en que llegaron. */
  facturas: SituacionFactura[];
  /** Un renglón por cada factura que un pago toca. */
  emparejamientos: Emparejamiento[];
  /** Facturas sin ningún pago, de la más antigua a la más nueva. */
  impagas: SituacionFactura[];
  /** Facturas pagadas en parte, de la más antigua a la más nueva. */
  parciales: SituacionFactura[];
  sinFactura: ResultadoPago[];
  duplicados: ResultadoPago[];
  paraRevisar: ResultadoPago[];
  avisos: AvisoControl[];
  resumen: ResumenPagos;
}

export interface OpcionesPagos {
  /** Diferencia que se perdona, en centavos. Por defecto `TOLERANCIA_CENTAVOS_POR_DEFECTO`. */
  toleranciaCentavos?: number;
  /** Fecha de referencia (`AAAA-MM-DD`) para la antigüedad. Por defecto, hoy en Argentina. */
  hoy?: string;
  /** Desde cuántos días una factura impaga se marca como antigua. Por defecto 30. */
  umbralAntiguedad?: number;
}

// ---------------------------------------------------------------- Facturas de la planilla

export interface FacturaOmitida {
  id: number;
  motivo: string;
}

/**
 * Las facturas de la planilla que se pueden cruzar con pagos. Quedan afuera, con su motivo, las duplicadas de la planilla, las que no tienen
 * los datos de la clave, las notas de crédito (no se pagan: se descuentan), las que no están en pesos (el extracto no trae moneda) y
 * las sin importe positivo.
 */
export function facturasDeFilas(filas: readonly Fila[]): { facturas: FacturaAPagar[]; omitidas: FacturaOmitida[] } {
  const repetidas = duplicadas(filas);
  const facturas: FacturaAPagar[] = [];
  const omitidas: FacturaOmitida[] = [];
  for (const fila of filas) {
    const d = fila.datos;
    const omitir = (motivo: string): void => void omitidas.push({ id: fila.id, motivo });
    if (repetidas.has(fila.id)) {
      omitir("Duplicada en la planilla: ya cuenta la primera.");
    } else if (claveDuplicado(d) === null || d.tipoCmp === null || d.ptoVta === null || d.nroCmp === null) {
      omitir("Faltan datos del comprobante (CUIT, tipo, punto de venta o número).");
    } else if (esNotaDeCredito(d.tipoCmp)) {
      omitir("Es una nota de crédito: no se paga, se descuenta. No se concilia con pagos.");
    } else if (d.moneda !== "PES" && d.moneda !== "") {
      omitir("No está en pesos: el extracto no trae moneda, así que solo se concilian facturas en pesos.");
    } else if (d.importe === null || d.importe <= 0) {
      omitir("No tiene un importe mayor que cero.");
    } else if (aCentavos(d.importe) <= TOLERANCIA_CENTAVOS_POR_DEFECTO) {
      omitir(`Su importe no supera la tolerancia de ${centavos(TOLERANCIA_CENTAVOS_POR_DEFECTO)}: figuraría pagada sin ningún pago.`);
    } else {
      facturas.push({ id: fila.id, cuit: d.cuit, tipoCmp: d.tipoCmp, ptoVta: d.ptoVta, nroCmp: d.nroCmp, fecha: d.fecha, importe: d.importe, origen: fila.origen });
    }
  }
  return { facturas, omitidas };
}

// ---------------------------------------------------------------- Referencias en el texto libre

export interface Referencia {
  ptoVta: number;
  nroCmp: number;
  /** Tal como está escrita ("0003-00001245"). */
  texto: string;
}

/**
 * Punto de venta y número de comprobante escritos en un texto libre: `0003-00001245` o `3-1245`. No toma fechas (`2026-10-05`) ni CUIT
 * (`30-99000001-4`): un guion pegado a otro número no es una referencia. Sin repetidas.
 */
export function extraerReferencias(texto: string): Referencia[] {
  const vistas = new Set<string>();
  const salida: Referencia[] = [];
  for (const m of texto.matchAll(/(?:^|[^\d-])(\d{1,5})-(\d{1,8})(?![\d-])/g)) {
    const ptoVta = Number(m[1]);
    const nroCmp = Number(m[2]);
    if (ptoVta === 0 || nroCmp === 0) continue; // no existe un punto de venta ni un número cero
    const clave = `${ptoVta}|${nroCmp}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push({ ptoVta, nroCmp, texto: `${m[1]}-${m[2]}` });
  }
  return salida;
}

// ---------------------------------------------------------------- Cruce

const aCentavos = (n: number): number => Math.round(n * 100);
const monto = (centavos: number): string => formatearMonto("PES", centavos / 100);
const nombreFactura = (f: FacturaAPagar): string => `${nombreTipo(f.tipoCmp)} ${formatearNumeroCmp(f.ptoVta, f.nroCmp)}`;
const centavos = (n: number): string => `${n} ${n === 1 ? "centavo" : "centavos"}`;

/** Para comparar usuarios y referencias: sin tildes, sin mayúsculas, con espacios simples. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Suma `valor` a la lista de `clave`, sin copiar la lista. */
function agregar<K, V>(mapa: Map<K, V[]>, clave: K, valor: V): void {
  const lista = mapa.get(clave);
  if (lista === undefined) mapa.set(clave, [valor]);
  else lista.push(valor);
}

function porFechaYNumero(a: FacturaAPagar, b: FacturaAPagar): number {
  return a.fecha.localeCompare(b.fecha) || a.ptoVta - b.ptoVta || a.nroCmp - b.nroCmp || a.id - b.id;
}

interface Trabajo {
  pago: Pago;
  centavos: number;
  r: ResultadoPago;
  resuelto: boolean;
  /** Frases que se anteponen a la explicación (por ejemplo, una referencia que no corresponde a nada). */
  notas: string[];
  imputadoCentavos: number;
}

/** Combinaciones de al menos dos facturas cuyo saldo suma el objetivo (con tolerancia). Se corta al encontrar dos. */
function combinaciones(saldos: readonly number[], objetivo: number, tolerancia: number): number[][] {
  const restante: number[] = new Array<number>(saldos.length + 1).fill(0);
  for (let i = saldos.length - 1; i >= 0; i--) restante[i] = (restante[i + 1] ?? 0) + (saldos[i] ?? 0);
  const soluciones: number[][] = [];
  const elegidas: number[] = [];
  const buscar = (i: number, suma: number): void => {
    if (soluciones.length >= 2 || i === saldos.length) return;
    if (suma - tolerancia > objetivo || suma + (restante[i] ?? 0) + tolerancia < objetivo) return;
    elegidas.push(i);
    const conEsta = suma + (saldos[i] ?? 0);
    if (elegidas.length >= 2 && Math.abs(conEsta - objetivo) <= tolerancia) soluciones.push([...elegidas]);
    buscar(i + 1, conEsta);
    elegidas.pop();
    buscar(i + 1, suma);
  };
  buscar(0, 0);
  return soluciones;
}

/**
 * Cruza las facturas con los pagos. No modifica lo que recibe.
 * `pago.linea` identifica a cada pago y `factura.id` a cada factura: no deben repetirse.
 */
export function conciliarPagos(facturas: readonly FacturaAPagar[], pagos: readonly Pago[], opciones: OpcionesPagos = {}): ConciliacionPagos {
  const tol = opciones.toleranciaCentavos ?? TOLERANCIA_CENTAVOS_POR_DEFECTO;
  const hoy = opciones.hoy ?? fechaArgentinaIso(new Date());
  const umbral = opciones.umbralAntiguedad ?? UMBRAL_ANTIGUEDAD_POR_DEFECTO;

  const ordenadas = [...facturas].sort(porFechaYNumero);
  const saldo = new Map<number, number>(ordenadas.map((f) => [f.id, aCentavos(f.importe)]));
  const porCuit = new Map<string, FacturaAPagar[]>();
  const porNumero = new Map<string, FacturaAPagar[]>();
  for (const f of ordenadas) {
    agregar(porCuit, f.cuit, f);
    agregar(porNumero, `${f.ptoVta}|${f.nroCmp}`, f);
  }
  const pagosDeFactura = new Map<number, number[]>();
  const enRevision = new Map<number, number[]>();

  const saldoDe = (f: FacturaAPagar): number => saldo.get(f.id) ?? 0;
  // Las abiertas de cada CUIT se calculan una vez y se rehacen solo cuando una factura se cierra (el saldo solo baja).
  const abiertasPorCuit = new Map<string, FacturaAPagar[]>();
  const abiertas = (cuit: string): FacturaAPagar[] => {
    let lista = abiertasPorCuit.get(cuit);
    if (lista === undefined) {
      lista = (porCuit.get(cuit) ?? []).filter((f) => saldoDe(f) > tol);
      abiertasPorCuit.set(cuit, lista);
    }
    return lista;
  };

  const trabajos: Trabajo[] = pagos.map((pago) => ({
    pago,
    centavos: aCentavos(pago.importe),
    resuelto: false,
    notas: [],
    imputadoCentavos: 0,
    r: { pago, estado: "sin-factura", regla: null, imputaciones: [], sinImputar: 0, candidatas: [], duplicadoDe: null, porQue: "", avisos: [] },
  }));
  const enOrden = [...trabajos].sort((a, b) => a.pago.fecha.localeCompare(b.pago.fecha) || a.pago.linea - b.pago.linea);
  const pendientes = (): Trabajo[] => enOrden.filter((t) => !t.resuelto);

  const cerrar = (t: Trabajo, estado: EstadoPago, regla: ReglaPago | null, porQue: string): void => {
    t.r.estado = estado;
    t.r.regla = regla;
    t.r.porQue = [...t.notas, porQue].join(" ");
    t.resuelto = true;
  };
  const aRevisar = (t: Trabajo, candidatas: readonly FacturaAPagar[], porQue: string): void => {
    const muchas = candidatas.length > MAX_CANDIDATAS;
    if (!muchas) {
      t.r.candidatas = candidatas.map((f) => f.id);
      for (const f of candidatas) agregar(enRevision, f.id, t.pago.linea);
    }
    cerrar(t, "revisar", null, muchas ? `${porQue} Podrían ser ${candidatas.length} facturas: no se listan.` : porQue);
  };
  /** Aplica el pago a las facturas, en orden, hasta donde alcance. Devuelve lo que sobró y si alguna ya tenía pagos antes. */
  const imputar = (t: Trabajo, aPagar: readonly FacturaAPagar[]): { sobra: number; completaUnaParcial: boolean } => {
    let resto = t.centavos - t.imputadoCentavos;
    let completaUnaParcial = false;
    for (const f of aPagar) {
      if (resto <= 0) break;
      const s = saldoDe(f);
      const aplicado = Math.min(resto, s);
      if ((pagosDeFactura.get(f.id) ?? []).length > 0) completaUnaParcial = true;
      saldo.set(f.id, s - aplicado);
      if (s - aplicado <= tol) abiertasPorCuit.delete(f.cuit);
      t.imputadoCentavos += aplicado;
      resto -= aplicado;
      t.r.imputaciones.push({ facturaId: f.id, importe: aplicado / 100 });
      agregar(pagosDeFactura, f.id, t.pago.linea);
    }
    return { sobra: resto, completaUnaParcial };
  };
  /** La frase que compara el pago con el saldo que cubre. */
  const comparar = (pagoC: number, saldoC: number, sobra: number, completa: boolean): string => {
    const dif = pagoC - saldoC;
    if (dif === 0) return `El importe coincide al centavo con el saldo${completa ? "; con este pago queda saldada" : ""}.`;
    if (Math.abs(dif) <= tol) return `El importe difiere en ${centavos(Math.abs(dif))} del saldo, dentro de la tolerancia${completa ? "; con este pago queda saldada" : ""}.`;
    if (sobra > tol) return `Sobran ${monto(sobra)} que ninguna factura abierta explica: revise si es un pago de más.`;
    return "";
  };

  // ---- Fase 0: duplicados
  // Un número de operación solo identifica al mismo pago si además coinciden el CUIT y el importe: muchos bancos repiten los números
  // (secuencias diarias, lotes). Si el número se repite con otro CUIT u otro importe, se cruza igual y se avisa.
  const porOperacion = new Map<string, Trabajo[]>();
  const porDatos = new Map<string, Trabajo[]>();
  const claveOperacion = (operacion: string): string => operacion.replace(/^0+(?=.)/, "");
  const quienPaga = (p: Pago): string => `${p.cuit}|${p.cuitIlegible ?? ""}`;
  for (const t of [...trabajos].sort((a, b) => a.pago.linea - b.pago.linea)) {
    const { pago } = t;
    const clave = `${pago.cuit}|${pago.fecha}|${t.centavos}|${normalizar(pago.referencia)}`;
    const operacion = claveOperacion(pago.operacion);
    const conEsaOperacion = operacion === "" ? [] : (porOperacion.get(operacion) ?? []);
    let original = conEsaOperacion.find((o) => o.centavos === t.centavos && quienPaga(o.pago) === quienPaga(pago));
    const mismaOperacion = original !== undefined;
    original ??= (porDatos.get(clave) ?? []).find((o) => operacion === "" || o.pago.operacion === "" || claveOperacion(o.pago.operacion) === operacion);
    if (original !== undefined) {
      t.r.duplicadoDe = original.pago.linea;
      cerrar(
        t,
        "duplicado",
        null,
        mismaOperacion
          ? `Tiene el mismo número de operación (${pago.operacion}), el mismo CUIT y el mismo importe que el pago de la línea ${original.pago.linea}: es el mismo pago y no se cuenta dos veces.`
          : `Con la misma fecha, el mismo CUIT, el mismo importe y la misma referencia que el pago de la línea ${original.pago.linea}: parece el mismo pago cargado dos veces y no se cuenta dos veces. Si son dos pagos, cargue el número de operación para distinguirlos.`,
      );
      continue;
    }
    const otro = conEsaOperacion[0];
    if (otro !== undefined) {
      t.r.avisos.push({
        codigo: "operacion-repetida",
        mensaje: `El número de operación (${pago.operacion}) ya figura en el pago de la línea ${otro.pago.linea}, pero con otro CUIT u otro importe: se cuenta como otro pago. Conviene revisar el extracto.`,
      });
    }
    if (operacion !== "") agregar(porOperacion, operacion, t);
    agregar(porDatos, clave, t);
  }
  // ---- Fase 1: la referencia nombra la factura
  for (const t of pendientes()) {
    const { pago } = t;
    const resueltas = new Map<number, FacturaAPagar>();
    let entreProveedores: FacturaAPagar[] = [];
    let ambiguaEn = "";
    for (const ref of extraerReferencias(`${pago.referencia} ${pago.concepto}`)) {
      const delNumero = porNumero.get(`${ref.ptoVta}|${ref.nroCmp}`) ?? [];
      const candidatas = pago.cuit === "" ? delNumero : delNumero.filter((f) => f.cuit === pago.cuit);
      if (candidatas.length === 1 && candidatas[0] !== undefined) {
        resueltas.set(candidatas[0].id, candidatas[0]);
      } else if (candidatas.length > 1 && pago.cuit === "") {
        entreProveedores = candidatas;
        ambiguaEn = ref.texto;
      } else if (candidatas.length > 1) {
        t.notas.push(`La referencia ${ref.texto} coincide con ${candidatas.length} comprobantes de este CUIT (de distinto tipo): no se usó.`);
      } else {
        t.notas.push(
          pago.cuit === ""
            ? `La referencia ${ref.texto} no corresponde a ninguna factura.`
            : `La referencia ${ref.texto} no corresponde a ninguna factura de este CUIT; se buscó por CUIT e importe.`,
        );
      }
    }
    if (resueltas.size === 0) {
      if (entreProveedores.length > 0) {
        aRevisar(t, entreProveedores, `La referencia ${ambiguaEn} coincide con facturas de ${new Set(entreProveedores.map((f) => f.cuit)).size} proveedores y el pago no trae CUIT: no se elige una.`);
      }
      continue;
    }
    const nombradas = [...resueltas.values()].sort(porFechaYNumero);
    const abiertasNombradas = nombradas.filter((f) => saldoDe(f) > tol);
    if (abiertasNombradas.length === 0) {
      const lista = nombradas.map(nombreFactura).join(", ");
      aRevisar(t, [], `${nombradas.length === 1 ? `${lista} ya está pagada` : `${lista} ya están pagadas`}: este pago no se imputa. ¿Es un pago de más o un pago repetido?`);
      continue;
    }
    const totalSaldo = abiertasNombradas.reduce((suma, f) => suma + saldoDe(f), 0);
    const { sobra, completaUnaParcial } = imputar(t, abiertasNombradas);
    const nombre = abiertasNombradas.length === 1 ? nombreFactura(abiertasNombradas[0] as FacturaAPagar) : "";
    const referencias = nombradas.map((f) => formatearNumeroCmp(f.ptoVta, f.nroCmp)).join(" y ");
    const intro =
      pago.cuit === ""
        ? `El pago no trae CUIT: se identificó solo con la referencia ${referencias}, que corresponde a una única factura.`
        : abiertasNombradas.length === 1
          ? `La referencia dice ${referencias} y esa factura (${nombre}) es de este CUIT.`
          : `La referencia nombra ${abiertasNombradas.length} facturas de este CUIT (${referencias}).`;
    const resultado =
      t.centavos < totalSaldo - tol
        ? abiertasNombradas.length === 1
          ? `El pago cubre una parte de la factura: ${monto(t.centavos)} de ${monto(totalSaldo)}; quedan ${monto(totalSaldo - t.centavos)}.`
          : `El pago cubre una parte de las ${abiertasNombradas.length} facturas (${monto(t.centavos)} de ${monto(totalSaldo)}): se aplica primero a las más antiguas.`
        : abiertasNombradas.length > 1 && Math.abs(t.centavos - totalSaldo) <= tol
          ? `El importe es la suma de sus saldos${t.centavos === totalSaldo ? "" : ` (difiere en ${centavos(Math.abs(t.centavos - totalSaldo))}, dentro de la tolerancia)`}.`
          : comparar(t.centavos, totalSaldo, sobra, completaUnaParcial);
    cerrar(t, "emparejado", "referencia", `${intro} ${resultado}`.trim());
  }

  // ---- Fase 2: CUIT e importe exacto (con una "foto" de los saldos al empezar, para no depender del orden)
  {
    const candidatasDe = new Map<Trabajo, FacturaAPagar[]>();
    const reclamos = new Map<number, number>();
    for (const t of pendientes()) {
      if (t.pago.cuit === "") continue;
      const dentro = abiertas(t.pago.cuit).filter((f) => Math.abs(saldoDe(f) - t.centavos) <= tol);
      // Lo que coincide al centavo gana a lo que solo entra en la tolerancia.
      const exactas = dentro.filter((f) => saldoDe(f) === t.centavos);
      const c = exactas.length > 0 ? exactas : dentro;
      if (c.length === 0) continue;
      candidatasDe.set(t, c);
      for (const f of c) reclamos.set(f.id, (reclamos.get(f.id) ?? 0) + 1);
    }
    for (const [t, c] of candidatasDe) {
      const unica = c.length === 1 ? (c[0] as FacturaAPagar) : undefined;
      if (unica === undefined) {
        aRevisar(t, c, `Hay ${c.length} facturas abiertas de este CUIT con ese importe${c.length > MAX_CANDIDATAS ? "" : ` (${c.map(nombreFactura).join(", ")})`}: no se elige una.`);
      } else if ((reclamos.get(unica.id) ?? 0) > 1) {
        aRevisar(t, c, `Otro pago del mismo CUIT y del mismo importe compite por ${nombreFactura(unica)}: no se decide cuál la paga.`);
      }
    }
    for (const [t, c] of candidatasDe) {
      if (t.resuelto || c[0] === undefined) continue;
      const f = c[0];
      const s = saldoDe(f);
      const { sobra, completaUnaParcial } = imputar(t, [f]);
      const base = `Mismo CUIT (${formatearCuit(t.pago.cuit)}) e importe: ${nombreFactura(f)} tiene un saldo de ${monto(s)} y el pago es de ${monto(t.centavos)}.`;
      cerrar(t, "emparejado", "importe-exacto", `${base} ${comparar(t.centavos, s, sobra, completaUnaParcial)}`.trim());
    }
  }

  // ---- Fase 3: varias facturas que suman el pago (con una "foto" de los saldos al empezar: si dos pagos solo pueden ser la misma combinación, compiten)
  {
    const propuestas = new Map<Trabajo, FacturaAPagar[]>();
    const reclamos = new Map<number, number>();
    for (const t of pendientes()) {
      if (t.pago.cuit === "") continue;
      const ab = abiertas(t.pago.cuit);
      if (ab.length < 2 || ab.length > MAX_FACTURAS_EN_SUMA) continue;
      const encontradas = combinaciones(ab.map(saldoDe), t.centavos, tol);
      if (encontradas.length === 0) continue;
      if (encontradas.length > 1) {
        const candidatas = [...new Set(encontradas.flat())].sort((a, b) => a - b).map((i) => ab[i] as FacturaAPagar);
        aRevisar(t, candidatas, "Hay varias combinaciones de facturas abiertas de este CUIT que suman ese importe: no se elige una.");
        continue;
      }
      const elegidas = (encontradas[0] as number[]).map((i) => ab[i] as FacturaAPagar);
      propuestas.set(t, elegidas);
      for (const f of elegidas) reclamos.set(f.id, (reclamos.get(f.id) ?? 0) + 1);
    }
    for (const [t, elegidas] of propuestas) {
      if (elegidas.some((f) => (reclamos.get(f.id) ?? 0) > 1)) {
        aRevisar(t, elegidas, `Otro pago del mismo CUIT puede ser la misma combinación de facturas (${elegidas.map(nombreFactura).join(", ")}): no se decide cuál las paga.`);
      }
    }
    for (const [t, elegidas] of propuestas) {
      if (t.resuelto) continue;
      const total = elegidas.reduce((suma, f) => suma + saldoDe(f), 0);
      const { sobra } = imputar(t, elegidas);
      const dif = Math.abs(t.centavos - total);
      const cierre = dif === 0 ? "" : ` (difiere en ${centavos(dif)}, dentro de la tolerancia)`;
      cerrar(
        t,
        "emparejado",
        "suma-de-facturas",
        `Sin referencia: una sola combinación de ${elegidas.length} facturas abiertas de este CUIT suma el importe${cierre}: ${elegidas.map(nombreFactura).join(", ")}.${sobra > tol ? ` Sobran ${monto(sobra)}.` : ""}`,
      );
    }
  }
  // ---- Fase 4: lo que queda
  for (const t of pendientes()) {
    const { pago } = t;
    if (pago.cuit === "") {
      const sinDatos = pago.cuitIlegible === undefined && pago.referencia === "" && pago.concepto === "";
      const falta = sinDatos
        ? "El pago no trae CUIT ni referencia"
        : `${pago.cuitIlegible !== undefined ? `El CUIT del pago (${pago.cuitIlegible}) no es válido` : "El pago no trae CUIT"} y no hay una referencia que corresponda a una factura`;
      cerrar(t, "sin-factura", null, `${falta}: no se puede saber a quién se pagó.`);
      continue;
    }
    const todas = porCuit.get(pago.cuit) ?? [];
    const ab = abiertas(pago.cuit);
    const unica = ab.length === 1 ? (ab[0] as FacturaAPagar) : undefined;
    if (todas.length === 0) {
      cerrar(t, "sin-factura", null, `Este CUIT (${formatearCuit(pago.cuit)}) no tiene ninguna factura en la planilla.`);
    } else if (ab.length === 0) {
      cerrar(t, "sin-factura", null, `${todas.length === 1 ? "La única factura de este CUIT ya está pagada" : `Las ${todas.length} facturas de este CUIT ya están pagadas`}: no hay una abierta a la que imputar el pago.`);
    } else if (unica !== undefined && Math.abs(t.centavos - saldoDe(unica)) <= tol) {
      // La última cuota: el pago es lo que falta de la única factura abierta.
      const s = saldoDe(unica);
      const { sobra } = imputar(t, [unica]);
      cerrar(
        t,
        "emparejado",
        "importe-exacto",
        `Ninguna referencia coincide, pero es la única factura abierta de este CUIT (${nombreFactura(unica)}) y el pago de ${monto(t.centavos)} es lo que le faltaba (saldo de ${monto(s)}): con este pago queda saldada.${sobra > tol ? ` Sobran ${monto(sobra)}.` : ""}`,
      );
    } else if (unica !== undefined && t.centavos < saldoDe(unica) - tol) {
      const s = saldoDe(unica);
      imputar(t, [unica]);
      cerrar(
        t,
        "emparejado",
        "pago-parcial",
        `Ninguna referencia ni importe coincide, pero es la única factura abierta de este CUIT (${nombreFactura(unica)}): se toma como pago parcial, ${monto(t.centavos)} de ${monto(s)}; quedan ${monto(s - t.centavos)}.`,
      );
    } else if (unica !== undefined) {
      aRevisar(t, ab, `El pago (${monto(t.centavos)}) supera el saldo de la única factura abierta de este CUIT (${nombreFactura(unica)}, ${monto(saldoDe(unica))}): no se imputa.`);
    } else {
      const nota = ab.length > MAX_FACTURAS_EN_SUMA ? ` Son más de ${MAX_FACTURAS_EN_SUMA} facturas abiertas: no se probaron combinaciones.` : "";
      aRevisar(t, ab, `No coincide con ninguna factura abierta de este CUIT ni con una suma de ellas: no se puede saber a cuál corresponde.${nota}`);
    }
  }

  // ---- Control interno
  const avisos: AvisoControl[] = [];
  for (const t of trabajos) {
    const { pago } = t;
    if (pago.cuitIlegible !== undefined) {
      t.r.avisos.push({ codigo: "cuit-invalido", mensaje: `El CUIT del pago (${pago.cuitIlegible}) no es válido: no se usó para cruzar.` });
    }
    if (pago.cargo !== "" && normalizar(pago.cargo) === normalizar(pago.autorizo)) {
      t.r.avisos.push({ codigo: "mismo-usuario", mensaje: `El mismo usuario (${pago.cargo}) cargó y autorizó este pago. Conviene que lo autorice otra persona.` });
    }
    for (const a of t.r.avisos) avisos.push({ linea: pago.linea, ...a });
    const resto = t.centavos - t.imputadoCentavos;
    t.r.sinImputar = t.r.estado === "duplicado" ? 0 : t.r.estado === "emparejado" && resto <= tol ? 0 : resto / 100;
  }

  // ---- Situación de cada factura
  const situaciones: SituacionFactura[] = facturas.map((factura) => {
    const total = aCentavos(factura.importe);
    const s = saldoDe(factura);
    const pagado = total - s;
    const estado: EstadoFactura = s <= tol ? "pagada" : pagado > 0 ? "parcial" : "impaga";
    const dias = diasEntre(factura.fecha, hoy);
    const antigua = estado !== "pagada" && esAntigua(dias, umbral);
    return {
      factura,
      estado,
      pagado: pagado / 100,
      saldo: s / 100,
      pagos: pagosDeFactura.get(factura.id) ?? [],
      dias,
      antigua,
      enRevision: enRevision.get(factura.id) ?? [],
    };
  });
  const masAntiguaPrimero = (a: SituacionFactura, b: SituacionFactura): number => (b.dias ?? -Infinity) - (a.dias ?? -Infinity) || porFechaYNumero(a.factura, b.factura);
  const impagas = situaciones.filter((s) => s.estado === "impaga").sort(masAntiguaPrimero);
  const parciales = situaciones.filter((s) => s.estado === "parcial").sort(masAntiguaPrimero);

  const resultados = trabajos.map((t) => t.r);
  const emparejamientos: Emparejamiento[] = resultados.flatMap((r) =>
    r.regla === null ? [] : r.imputaciones.map((i) => ({ pagoLinea: r.pago.linea, facturaId: i.facturaId, importe: i.importe, regla: r.regla as ReglaPago, porQue: r.porQue })),
  );
  const sinFactura = resultados.filter((r) => r.estado === "sin-factura");
  const duplicados = resultados.filter((r) => r.estado === "duplicado");
  const paraRevisar = resultados.filter((r) => r.estado === "revisar");

  const suma = (valores: readonly number[]): number => valores.reduce((a, b) => a + b, 0);
  const resumen: ResumenPagos = {
    facturas: situaciones.length,
    pagadas: situaciones.filter((s) => s.estado === "pagada").length,
    parciales: parciales.length,
    impagas: impagas.length,
    antiguas: situaciones.filter((s) => s.antigua).length,
    pagos: resultados.length,
    emparejados: resultados.filter((r) => r.estado === "emparejado").length,
    sinFactura: sinFactura.length,
    duplicados: duplicados.length,
    paraRevisar: paraRevisar.length,
    conAvisoDeControl: resultados.filter((r) => r.avisos.length > 0).length,
    importeFacturado: suma(facturas.map((f) => aCentavos(f.importe))) / 100,
    importePagado: suma(emparejamientos.map((e) => aCentavos(e.importe))) / 100,
    saldoPendiente: suma(situaciones.filter((s) => s.estado !== "pagada").map((s) => aCentavos(s.saldo))) / 100,
    importeSinFactura: suma(sinFactura.map((r) => aCentavos(r.pago.importe))) / 100,
  };

  return { pagos: resultados, facturas: situaciones, emparejamientos, impagas, parciales, sinFactura, duplicados, paraRevisar, avisos, resumen };
}
