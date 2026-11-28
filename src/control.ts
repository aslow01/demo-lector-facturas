// Control del comprobante: revisa la coherencia interna de lo que el comprobante trae. Funciones puras, sin DOM.
//
// No aplica reglas fiscales: no conoce alícuotas, regímenes, percepciones ni retenciones, y no consulta padrones.
// Solo dice si los datos se contradicen entre sí (el total no cierra, una C trae IVA, el CUIT no verifica, el CAE vence
// antes de la emisión). El IVA y los otros conceptos los informa quien carga el comprobante: acá no se calculan.
//
// Los duplicados no se controlan acá: la planilla los marca con su propio sello (`duplicadas`, en `planilla.ts`).

import {
  formatearFecha,
  formatearMonto,
  motivoCuitEmisor,
  motivoFecha,
  normalizarFecha,
  type Comprobante,
  type MotivoLectura,
} from "./comprobante.ts";
import { cuitValido, soloDigitos } from "./cuit.ts";

export type Severidad = "error" | "aviso";

export type CodigoObservacion =
  | "total-no-cierra"
  | "letra-c-con-iva"
  | "letra-a-sin-cuit-receptor"
  | "cuit-emisor"
  | "cuit-receptor"
  | "cae-formato"
  | "cae-vencimiento"
  | "fecha"
  | "fecha-futura";

export interface Observacion {
  codigo: CodigoObservacion;
  /** `error`: los datos se contradicen. `aviso`: conviene mirarlo, puede ser correcto. */
  severidad: Severidad;
  /** Frase completa que dice qué mirar, en español neutro. */
  mensaje: string;
}

/**
 * Lo que el QR de ARCA no trae y quien carga el comprobante sí puede informar. `null` o vacío = no informado.
 * Los importes van como en el comprobante (en una nota de crédito, positivos).
 */
export interface Desglose {
  /** Neto gravado. Sin este dato no se controla el cuadre del total. */
  neto: number | null;
  /** IVA discriminado, sumadas todas las alícuotas. */
  iva: number | null;
  /** Todo lo demás que suma al total (no gravado, exento, otros tributos), ya sumado por quien carga. */
  otros: number | null;
  /** `AAAA-MM-DD`, `DD/MM/AAAA` o `AAAAMMDD`. Vacío si no se informó. */
  vencimientoCae: string;
}

/** Diferencia de redondeo que se perdona entre el total y la suma de sus partes (el IVA se redondea línea por línea). */
export const TOLERANCIA_REDONDEO_CENTAVOS = 1;

const LETRAS: Readonly<Record<number, "A" | "B" | "C" | "M">> = {
  1: "A", 2: "A", 3: "A", 201: "A", 202: "A", 203: "A",
  6: "B", 7: "B", 8: "B", 206: "B", 207: "B", 208: "B",
  11: "C", 12: "C", 13: "C", 211: "C", 212: "C", 213: "C",
  51: "M", 52: "M", 53: "M",
};

/** Letra del comprobante según el código de tipo. `null` si el tipo no tiene letra o la demo no lo conoce. */
export function letraDe(tipo: number | null): "A" | "B" | "C" | "M" | null {
  if (tipo === null) return null;
  return LETRAS[tipo] ?? null;
}

/** Tipos de documento del receptor que se identifican con 11 dígitos y dígito verificador: CUIT (80) y CUIL (86). */
const DOCUMENTOS_CON_VERIFICADOR = new Set([80, 86]);
const TIPO_DOC_CUIT = 80;
/** Un documento se escribe con números y, a lo sumo, guiones, puntos o espacios: `20abc123456787` no es un CUIT. */
const SOLO_NUMERO_DE_DOCUMENTO = /^[\d\-\s.]+$/;

function centavos(n: number): number {
  return Math.round(n * 100);
}

/** `AAAA-MM-DD` desde `AAAA-MM-DD`, `DD/MM/AAAA` o `AAAAMMDD`. `null` si no es una fecha real. */
export function normalizarVencimiento(texto: string): string | null {
  const t = texto.trim();
  const compacta = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  return normalizarFecha(compacta ? `${compacta[1]}-${compacta[2]}-${compacta[3]}` : t);
}

function error(codigo: CodigoObservacion, mensaje: string): Observacion {
  return { codigo, severidad: "error", mensaje };
}

function aviso(codigo: CodigoObservacion, mensaje: string): Observacion {
  return { codigo, severidad: "aviso", mensaje };
}

/** Lo que la lectura ya sabe decir (CUIT del emisor y fecha), como error: una sola frase para la lectura y para el control. */
function comoError(m: MotivoLectura<"cuit-emisor" | "fecha" | "fecha-futura"> | null): Observacion[] {
  return m === null ? [] : [error(m.codigo, m.mensaje)];
}

function controlarReceptor(c: Comprobante): Observacion[] {
  const salida: Observacion[] = [];
  if (c.tipoDocRec !== null && DOCUMENTOS_CON_VERIFICADOR.has(c.tipoDocRec)) {
    const digitos = soloDigitos(c.nroDocRec);
    if (c.nroDocRec.trim() !== "" && !SOLO_NUMERO_DE_DOCUMENTO.test(c.nroDocRec)) salida.push(error("cuit-receptor", "El CUIT del receptor tiene caracteres que no son números."));
    else if (digitos.length !== 11) salida.push(error("cuit-receptor", "El CUIT del receptor no tiene 11 dígitos."));
    else if (!cuitValido(digitos)) salida.push(error("cuit-receptor", "El CUIT del receptor tiene el dígito verificador inválido."));
  }
  const letra = letraDe(c.tipoCmp);
  if ((letra === "A" || letra === "M") && c.tipoDocRec !== null && c.tipoDocRec !== TIPO_DOC_CUIT) {
    salida.push(aviso("letra-a-sin-cuit-receptor", `Una factura ${letra} se emite a un receptor identificado con CUIT, y este se identifica de otra forma. Revise la letra o el receptor.`));
  }
  return salida;
}

function controlarCae(c: Comprobante, d: Desglose | undefined): Observacion[] {
  const salida: Observacion[] = [];
  // Sin CAE no hay contradicción que señalar (la planilla admite filas con datos faltantes): solo se juzga el que viene.
  if (c.codAut !== "" && !/^\d{14}$/.test(c.codAut)) salida.push(error("cae-formato", "El CAE debe tener 14 dígitos."));

  const texto = d?.vencimientoCae.trim() ?? "";
  if (texto === "") return salida;
  const vencimiento = normalizarVencimiento(texto);
  if (vencimiento === null) {
    salida.push(error("cae-vencimiento", "La fecha de vencimiento del CAE no es válida."));
    return salida;
  }
  const emision = normalizarFecha(c.fecha);
  if (emision !== null && vencimiento < emision) {
    salida.push(error("cae-vencimiento", `El CAE vence el ${formatearFecha(vencimiento)}, antes de la emisión (${formatearFecha(emision)}).`));
  }
  return salida;
}

function controlarImportes(c: Comprobante, d: Desglose | undefined): Observacion[] {
  if (d === undefined) return [];
  const salida: Observacion[] = [];
  const letra = letraDe(c.tipoCmp);
  if (letra === "C" && d.iva !== null && d.iva !== 0) {
    salida.push(error("letra-c-con-iva", `Una factura C no discrimina IVA y este comprobante trae ${formatearMonto(c.moneda, d.iva)} de IVA. Revise la letra o el importe.`));
  }
  // En una A, B o M el IVA va discriminado: si solo se cargó el neto, falta el IVA y el cuadre no se puede juzgar (no es un error del comprobante).
  const faltaIva = d.iva === null && (letra === "A" || letra === "B" || letra === "M");
  if (d.neto !== null && c.importe !== null && !faltaIva) {
    if (![d.neto, d.iva ?? 0, d.otros ?? 0, c.importe].every(Number.isFinite)) {
      salida.push(error("total-no-cierra", "El neto, el IVA o los otros conceptos no son un número válido: no se puede controlar el total."));
      return salida;
    }
    const partes = centavos(d.neto) + centavos(d.iva ?? 0) + centavos(d.otros ?? 0);
    const total = centavos(c.importe);
    const diferencia = Math.abs(total - partes);
    if (diferencia > TOLERANCIA_REDONDEO_CENTAVOS) {
      const m = (cts: number): string => formatearMonto(c.moneda, cts / 100);
      salida.push(
        error("total-no-cierra", `El neto, el IVA y los otros conceptos suman ${m(partes)}, pero el total es ${m(total)}: difieren en ${m(diferencia)}.`),
      );
    }
  }
  return salida;
}

/**
 * Observaciones de un comprobante, errores primero. No incluye duplicados (hace falta ver los demás: los marca la planilla).
 * `desglose` es opcional: sin él solo se controlan los datos que trae el QR.
 */
export function controlarComprobante(c: Comprobante, desglose?: Desglose, hoy: Date = new Date()): Observacion[] {
  const todas = [
    ...comoError(motivoCuitEmisor(c)),
    ...controlarReceptor(c),
    ...comoError(motivoFecha(c, hoy)),
    ...controlarCae(c, desglose),
    ...controlarImportes(c, desglose),
  ];
  return [...todas.filter((o) => o.severidad === "error"), ...todas.filter((o) => o.severidad === "aviso")];
}
