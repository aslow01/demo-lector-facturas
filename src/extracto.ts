// Extracto de pagos: lee el CSV (ficticio en la demo) con lo que se pagó, a quién y quién lo cargó y lo autorizó.
// Funciones puras, sin acceso al navegador. El texto del archivo nunca se interpreta como HTML ni como fórmula.

import { aDigitos, normalizarFecha, tieneTresDecimalesAmbiguos } from "./comprobante.ts";
import { ErrorRegistro, LIMITE_BYTES, LIMITE_LINEAS, detectarSeparador, interpretarImporte, normalizarTexto, partirRegistros } from "./conciliacion.ts";
import { cuitValido } from "./cuit.ts";

/** Cuántos caracteres se guardan de cada texto libre (referencia, concepto, usuarios): una celda hostil no ocupa la pantalla. */
export const LIMITE_TEXTO = 200;

export interface Pago {
  /** Línea del archivo (el encabezado es la línea 1). Identifica al pago en todo el cruce: no se repite. */
  linea: number;
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** En pesos, mayor que cero. */
  importe: number;
  /** Solo dígitos (11) y con verificador válido, o vacío si el pago no trae CUIT o el que trae no sirve. */
  cuit: string;
  /** Lo que decía la celda de CUIT cuando no sirvió (no son 11 dígitos o el verificador no cierra). Ausente si no hubo problema. */
  cuitIlegible?: string;
  /** Texto libre donde quien paga suele escribir la factura ("FA 0003-00001245"). */
  referencia: string;
  concepto: string;
  /** Usuario que cargó el pago en el banco. */
  cargo: string;
  /** Usuario que lo autorizó. */
  autorizo: string;
  /** Número de operación del banco. Dos pagos con el mismo número son el mismo pago. */
  operacion: string;
}

export interface LineaInvalida {
  linea: number;
  motivo: string;
}

export interface LecturaExtracto {
  pagos: Pago[];
  /** Líneas que no se pudieron leer, con el motivo. No frenan al resto. */
  lineasInvalidas: LineaInvalida[];
  /** `false` si el archivo no trae ninguna de las dos columnas de usuarios: el control interno no se puede hacer. */
  tieneUsuarios: boolean;
  /** Columnas que el encabezado trae más de una vez (se usa la primera). Por ejemplo `["importe"]`. */
  encabezadosDuplicados: string[];
}

type Columna = "fecha" | "importe" | "cuit" | "referencia" | "concepto" | "cargo" | "autorizo" | "operacion";

const COLUMNAS: Record<Columna, { etiqueta: string; nombres: string[] }> = {
  fecha: { etiqueta: "fecha", nombres: ["fecha", "fecha pago", "fecha de pago"] },
  importe: { etiqueta: "importe", nombres: ["importe", "monto", "importe pagado"] },
  cuit: { etiqueta: "CUIT", nombres: ["cuit", "cuit destino", "cuit beneficiario", "cuit proveedor"] },
  referencia: { etiqueta: "referencia", nombres: ["referencia", "ref"] },
  concepto: { etiqueta: "concepto", nombres: ["concepto", "descripcion"] },
  cargo: { etiqueta: "usuario que cargó", nombres: ["cargo", "cargado por", "usuario carga", "usuario que cargo", "usuario ingreso"] },
  autorizo: { etiqueta: "usuario que autorizó", nombres: ["autorizo", "autorizado por", "usuario autoriza", "usuario que autorizo", "autoriza"] },
  operacion: { etiqueta: "operación", nombres: ["operacion", "nro operacion", "numero de operacion", "numero operacion", "id operacion"] },
};

const OBLIGATORIAS: readonly Columna[] = ["fecha", "importe"];

/** Caracteres de control, de formato invisible y los que invierten el sentido del texto (U+202E): no tienen lugar en lo que se muestra ni se exporta. */
const CARACTERES_INVISIBLES = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;

function texto(campos: readonly string[], i: number | undefined): string {
  if (i === undefined) return "";
  return (campos[i] ?? "").replace(CARACTERES_INVISIBLES, " ").trim().slice(0, LIMITE_TEXTO);
}

/**
 * Lee el CSV del extracto. `Error` si el archivo es demasiado grande, está vacío, tiene una comilla sin cerrar o le falta una columna
 * necesaria: la fecha, el importe y alguna forma de saber a quién se pagó (el CUIT o la referencia).
 * Una línea que no se puede leer (fecha imposible, importe ilegible o no positivo) se informa y se sigue con las demás.
 */
export function leerExtracto(contenido: string): LecturaExtracto | Error {
  if (contenido.length > LIMITE_BYTES) return new ErrorRegistro("El archivo supera el máximo de 2 MB.");
  const limpio = contenido.replace(/^﻿/, "");
  if (limpio.trim() === "") return new ErrorRegistro("El archivo está vacío.");

  const separador = detectarSeparador(limpio);
  const { registros: crudos, comillaAbiertaEn } = partirRegistros(limpio, separador);
  if (comillaAbiertaEn !== null) return new ErrorRegistro(`El archivo tiene una comilla sin cerrar a partir de la línea ${comillaAbiertaEn}.`);
  if (crudos.length > LIMITE_LINEAS) return new ErrorRegistro(`El archivo supera el máximo de ${LIMITE_LINEAS.toLocaleString("es-AR")} líneas.`);
  const encabezado = crudos[0];
  if (!encabezado) return new ErrorRegistro("El archivo está vacío.");
  if (encabezado.campos.length === 1) {
    return new ErrorRegistro(
      "No se reconocen columnas en la primera línea: el archivo debe estar separado por punto y coma, coma o tabulador. Revise que sea un CSV con encabezados.",
    );
  }

  const nombres = encabezado.campos.map(normalizarTexto);
  const indice: Partial<Record<Columna, number>> = {};
  const encabezadosDuplicados: string[] = [];
  for (const clave of Object.keys(COLUMNAS) as Columna[]) {
    const posiciones = nombres.flatMap((n, i) => (COLUMNAS[clave].nombres.includes(n) ? [i] : []));
    const primera = posiciones[0];
    if (primera !== undefined) indice[clave] = primera;
    if (posiciones.length > 1) encabezadosDuplicados.push(COLUMNAS[clave].etiqueta);
  }
  for (const clave of OBLIGATORIAS) {
    if (indice[clave] === undefined) {
      const { etiqueta, nombres: aceptados } = COLUMNAS[clave];
      return new ErrorRegistro(`Falta la columna de ${etiqueta}. Nombres aceptados: ${aceptados.join(", ")}. Revise la primera línea del archivo.`);
    }
  }
  if (indice.cuit === undefined && indice.referencia === undefined) {
    return new ErrorRegistro(
      "Falta la columna del CUIT o la referencia: sin ellas no hay cómo saber a quién se pagó. " +
        `Nombres aceptados para el CUIT: ${COLUMNAS.cuit.nombres.join(", ")}. Para la referencia: ${COLUMNAS.referencia.nombres.join(", ")}.`,
    );
  }

  const pagos: Pago[] = [];
  const lineasInvalidas: LineaInvalida[] = [];
  for (const crudo of crudos.slice(1)) {
    const c = crudo.campos;
    // Con una coma como separador, un importe con coma decimal sin comillas (1500,50) se parte en dos y corre todas las columnas.
    if (c.length > encabezado.campos.length && c.slice(encabezado.campos.length).some((x) => x.trim() !== "")) {
      lineasInvalidas.push({
        linea: crudo.linea,
        motivo: `Tiene más columnas que el encabezado (${c.length} contra ${encabezado.campos.length}). Si el importe usa coma decimal, póngalo entre comillas o separe el archivo con punto y coma.`,
      });
      continue;
    }
    const fecha = normalizarFecha(texto(c, indice.fecha));
    if (fecha === null) {
      lineasInvalidas.push({ linea: crudo.linea, motivo: "La fecha no es válida (use AAAA-MM-DD o DD/MM/AAAA)." });
      continue;
    }
    const celdaImporte = texto(c, indice.importe);
    const importe = interpretarImporte(celdaImporte);
    if (importe === null) {
      lineasInvalidas.push({
        linea: crudo.linea,
        motivo: tieneTresDecimalesAmbiguos(celdaImporte.replace(/\s/g, ""), ",")
          ? `El importe «${celdaImporte}» es ambiguo: la coma puede ser el separador de miles o de decimales. Escríbalo como 1500,00 o 1.500,00.`
          : "El importe no es un número válido (hasta 12 dígitos enteros y 2 decimales).",
      });
      continue;
    }
    if (importe <= 0) {
      lineasInvalidas.push({ linea: crudo.linea, motivo: "El importe debe ser mayor que cero." });
      continue;
    }
    const celdaCuit = texto(c, indice.cuit);
    const digitos = celdaCuit === "" ? null : aDigitos(celdaCuit);
    const cuitBueno = digitos !== null && cuitValido(digitos);
    pagos.push({
      linea: crudo.linea,
      fecha,
      importe,
      cuit: cuitBueno ? digitos : "",
      ...(celdaCuit !== "" && !cuitBueno ? { cuitIlegible: celdaCuit } : {}),
      referencia: texto(c, indice.referencia),
      concepto: texto(c, indice.concepto),
      cargo: texto(c, indice.cargo),
      autorizo: texto(c, indice.autorizo),
      operacion: texto(c, indice.operacion),
    });
  }
  return { pagos, lineasInvalidas, tieneUsuarios: indice.cargo !== undefined && indice.autorizo !== undefined, encabezadosDuplicados };
}
