// Conciliación: cruza la planilla (lo recibido) con un registro de lo ya cargado en el sistema de gestión.
// Funciones puras, sin acceso al navegador. El texto del registro nunca se interpreta como HTML ni como fórmula.

import {
  NOMBRES_TIPO,
  aDigitos,
  conMiles,
  aEnteroNoNegativo,
  claveDuplicado,
  esNotaDeCredito,
  esNotaDeDebito,
  esTipoConocido,
  formatearImporte,
  formatearMonto,
  formatearNumeroCmp,
  nombreMoneda,
  nombreTipo,
  parsearImporteTexto,
  pesosPrimero,
  problemaDeImporte,
  tieneTresDecimalesAmbiguos,
  type Campo,
} from "./comprobante.ts";
import { normalizarVencimiento, type Desglose } from "./control.ts";
import { formatearCuit } from "./cuit.ts";
import { duplicadas, estadoFila, totalesPorMoneda, type Fila, type TotalMoneda } from "./planilla.ts";

export const LIMITE_BYTES = 2 * 1024 * 1024;
export const LIMITE_LINEAS = 20_000;
/** El punto de venta de ARCA tiene hasta 5 dígitos. Con más, o con 0, la línea no es un comprobante real. */
const MAXIMO_PUNTO_DE_VENTA = 99_999;

export class ErrorRegistro extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorRegistro";
  }
}

export interface Registro {
  /** Solo dígitos (11). */
  cuit: string;
  tipoCmp: number;
  ptoVta: number;
  nroCmp: number;
  importe: number;
  /** Línea del archivo (el encabezado es la línea 1). */
  linea: number;
  /**
   * Neto, IVA, otros conceptos y vencimiento del CAE, si el archivo trae esas columnas y la línea las completó. Es lo que el QR
   * no trae y el control del comprobante necesita para el cuadre del total. Si la clave se repite, vale el de la primera línea.
   */
  desglose?: Desglose;
  /**
   * Solo si el archivo repite la clave (el comprobante figura más de una vez): una entrada por copia, en el orden del archivo,
   * con la primera incluida. `importe` y `linea` de arriba son los de la primera.
   */
  copias?: CopiaRegistro[];
}

export interface CopiaRegistro {
  linea: number;
  importe: number;
}

/** Una clave que el registro trae más de una vez: el comprobante quedó cargado dos veces en el sistema. */
export interface ClaveRepetida {
  /** La primera aparición (es la que se usa para conciliar). */
  registro: Registro;
  veces: number;
  /** Todas las líneas del archivo donde aparece. */
  lineas: number[];
}

export interface LecturaRegistro {
  /** Un registro por clave: si el archivo repite una clave, se toma la primera. */
  registros: Registro[];
  /** Números de línea que no se pudieron leer. */
  lineasInvalidas: number[];
  /** De esas, las que traen un importe con más de 2 decimales o más de 12 dígitos enteros (la causa se explica aparte). */
  lineasImporteExcesivo: number[];
  /** Claves que aparecen más de una vez en el archivo (comprobantes cargados dos veces). */
  clavesRepetidas: ClaveRepetida[];
  /** Columnas que el encabezado trae más de una vez (se usa la primera). Por ejemplo `["CUIT"]`. */
  encabezadosDuplicados: string[];
  /**
   * Líneas válidas cuyo neto, IVA, otros conceptos o vencimiento del CAE no se pudo leer. La línea no se descarta (concilia igual):
   * solo se ignora ese dato.
   */
  lineasDesgloseIlegible: number[];
}

export type Resultado =
  | { tipo: "falta" }
  | { tipo: "revisar" }
  /** `copias`: los importes de TODAS las copias, solo si el sistema tiene el comprobante más de una vez (error del sistema). */
  | { tipo: "ya-cargada"; copias?: number[] }
  | { tipo: "otro-importe"; importeFila: number | null; importeRegistro: number; copias?: number[] }
  /** `copias`: los importes de todas las copias que el sistema tiene con ese otro CUIT, si figura más de una vez. */
  | { tipo: "otro-emisor"; cuitRegistro: string; copias?: number[] }
  | { tipo: "no-conciliable" }
  /** La misma factura ya figura antes en la planilla (`original` es el id de esa fila). Tiene estado propio: no es "ya cargada". */
  | { tipo: "duplicada"; original: number };

export type TipoResultado = Resultado["tipo"];

/** Cómo se llama una fila "ya cargada" cuyo comprobante figura dos veces en el sistema (se muestra en tono de atención). */
export const TEXTO_CARGADA_DOS_VECES = "Cargada dos veces en el sistema";

/**
 * Regla de negocio: en el sistema real no se puede cargar dos veces el mismo comprobante. Si está mal cargado, primero se da de baja
 * y recién entonces se vuelve a cargar: la demo nunca sugiere cargar encima.
 */
export const ACCION_MAL_CARGADA = "Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos.";

/**
 * Lo mismo para una fila con datos escritos a mano: la diferencia puede estar en lo que se escribió y no en el sistema, así que
 * no se manda a dar de baja nada hasta que la persona lo revise.
 */
export const ACCION_MAL_CARGADA_EDITADA = "Esta fila tiene datos escritos a mano: revise que la diferencia no esté en lo que escribió antes de tocar el sistema.";

/** Los campos que entran en el cruce con el registro: si se escribió alguno a mano, la diferencia puede ser del propio dato. */
const CAMPOS_DEL_CRUCE: readonly Campo[] = ["cuit", "tipoCmp", "ptoVta", "nroCmp", "importe"];

/** `true` si la persona corrigió a mano algún dato que se usa para cruzar la fila con el registro. */
export function editoDatosDelCruce(fila: Pick<Fila, "editados">): boolean {
  return fila.editados.some((c) => CAMPOS_DEL_CRUCE.includes(c));
}

export function accionDeMalCargada(editada: boolean): string {
  return editada ? ACCION_MAL_CARGADA_EDITADA : ACCION_MAL_CARGADA;
}

/** Cuántas copias se nombran en el detalle de una fila o en un aviso: el resto se cuenta ("y 2.995 más"). */
export const TOPE_COPIAS_EN_DETALLE = 5;

/** Un trozo de un detalle. Los códigos y los montos no se cortan nunca entre renglones (la interfaz los pinta con `white-space: nowrap`). */
export interface ParteDetalle {
  tipo: "texto" | "codigo" | "monto";
  texto: string;
}

export const ETIQUETA_RESULTADO: Record<TipoResultado, string> = {
  falta: "Falta cargar",
  revisar: "Revisar antes de cargar",
  "ya-cargada": "Ya cargada",
  "otro-importe": "Mal cargada: otro importe",
  "otro-emisor": "Mal cargada: otro emisor",
  "no-conciliable": "No se puede conciliar",
  duplicada: "Duplicada en la planilla",
};

export interface Conciliacion {
  /** `id de la fila → resultado`. */
  porFila: Map<number, Resultado>;
  /** Registros que ninguna fila de la planilla reclama (cargados en el sistema pero no recibidos). */
  soloEnRegistro: Registro[];
}

export interface ResumenConciliacion {
  /** Todos los conteos excluyen las filas duplicadas de la planilla: cada comprobante cuenta una vez. */
  faltan: number;
  /** De `faltan`, cuántas son notas de crédito (se muestran aparte: no se suman como si fueran facturas). */
  faltanNotasCredito: number;
  /** De `faltan`, cuántas son notas de débito (el resto de los que no son notas de crédito son facturas). Sirve para nombrar el grupo. */
  faltanNotasDebito: number;
  /** De `faltan` (sin notas de crédito), cuántas son de un tipo que la demo no conoce: no puede llamarlas facturas. */
  faltanOtrosTipos: number;
  /** Lo que falta cargar por moneda, pesos primero. Sin las notas de crédito ni las filas "para revisar". */
  faltanPorMoneda: TotalMoneda[];
  /** Lo que falta cargar en notas de crédito, por moneda, pesos primero. */
  faltanNotasCreditoPorMoneda: TotalMoneda[];
  revisar: number;
  yaCargadas: number;
  otroImporte: number;
  otroEmisor: number;
  conDiferencias: number;
  noConciliables: number;
  noRecibidas: number;
  /** Comprobantes que el sistema tiene cargados dos veces (o más: ver `cargadasMasDeDosVeces`). */
  cargadasDosVeces: number;
  /** De esos, los que figuran 3 o más veces: el texto ya no puede decir "dos veces". */
  cargadasMasDeDosVeces: number;
  /**
   * De `yaCargadas`, las filas cuyo comprobante el sistema trae repetido: cuentan como "ya cargadas" (el comprobante está en el sistema) pero
   * la fila muestra "Cargada dos veces". Sirve para aclararlo en la línea menor, sin cambiar la regla de conteo.
   */
  yaCargadasRepetidas: number;
  /** Filas de la planilla que repiten una factura anterior. Cada una lleva su propio sello "Duplicada". */
  duplicadas: number;
}

// ---------------------------------------------------------------- Lectura del registro (CSV)

/** Minúsculas, sin tildes, sin puntos y con espacios simples. Sirve para encabezados y nombres de tipo. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ColumnaClave = "cuit" | "tipo" | "ptoVta" | "numero" | "importe";

const COLUMNAS: Record<ColumnaClave, { etiqueta: string; nombres: string[] }> = {
  cuit: { etiqueta: "CUIT", nombres: ["cuit", "cuit emisor", "cuit proveedor"] },
  tipo: { etiqueta: "tipo de comprobante", nombres: ["tipo", "tipo comprobante"] },
  ptoVta: { etiqueta: "punto de venta", nombres: ["punto de venta", "pto vta", "pv"] },
  numero: { etiqueta: "número", nombres: ["numero", "nro", "numero comprobante"] },
  importe: { etiqueta: "importe", nombres: ["importe", "total"] },
};

type ColumnaDesglose = "neto" | "iva" | "otros" | "vencimientoCae";

/** Columnas opcionales: si el archivo no las trae, se lee igual que siempre. */
const COLUMNAS_DESGLOSE: Record<ColumnaDesglose, { etiqueta: string; nombres: string[] }> = {
  neto: { etiqueta: "neto", nombres: ["neto", "neto gravado", "importe neto", "importe neto gravado", "imp neto gravado"] },
  iva: { etiqueta: "IVA", nombres: ["iva", "importe iva", "iva total", "total iva"] },
  otros: { etiqueta: "otros conceptos", nombres: ["otros", "otros tributos", "otros conceptos", "importe otros tributos"] },
  vencimientoCae: {
    etiqueta: "vencimiento del CAE",
    nombres: ["vencimiento cae", "vencimiento del cae", "fecha vencimiento cae", "vto cae", "fecha vto cae", "venc cae", "cae vencimiento", "cae vto"],
  },
};

const NOMBRES_DE_TIPO_NORMALIZADOS = new Map<string, number>(
  Object.entries(NOMBRES_TIPO).map(([codigo, nombre]) => [normalizarTexto(nombre), Number(codigo)] as const),
);

/** Código de tipo desde un número (`6`) o un nombre (`Factura B`, `nota de credito b`, `Tipo 99`). */
export function interpretarTipo(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null;
  const numero = aEnteroNoNegativo(t);
  if (numero !== null) return numero;
  const normal = normalizarTexto(t);
  const porNombre = NOMBRES_DE_TIPO_NORMALIZADOS.get(normal);
  if (porNombre !== undefined) return porNombre;
  const otro = /^tipo (\d+)$/.exec(normal);
  return otro ? aEnteroNoNegativo(otro[1]) : null;
}

/** Importe de una celda sin límites de tamaño ni de decimales (ver `interpretarImporte`). `null` si no es un número. */
function importeCrudo(texto: string): number | null {
  const t = texto.replace(/^\s*(-?)\s*\$\s*/, "$1").replace(/\s/g, "");
  const punto = t.lastIndexOf(".");
  const coma = t.lastIndexOf(",");
  if (punto >= 0 && coma >= 0) {
    const [decimal, miles] = punto > coma ? [".", ","] : [",", "."];
    if (t.split(decimal).length !== 2) return null;
    if (tieneTresDecimalesAmbiguos(t, decimal)) return null;
    const limpio = t.split(miles).join("").replace(decimal, ".");
    return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : null;
  }
  return parsearImporteTexto(t);
}

/**
 * Importe de una celda del registro. Con punto y coma a la vez, el último de los dos es el separador decimal
 * (`1.234,56` y `1,234.56` valen 1234,56). Con uno solo, vale lo de `parsearImporteTexto`. Acepta un `$` delante.
 * Más de 2 decimales (`1,234` no se lee como 1,23), una coma con exactamente tres dígitos detrás (`1,500`: ¿miles o decimales?) o más
 * de 12 dígitos enteros no son un importe: devuelve `null`.
 */
export function interpretarImporte(texto: string): number | null {
  const n = importeCrudo(texto);
  return n === null || problemaDeImporte(n) !== null ? null : n;
}

export interface RegistroCrudo {
  linea: number;
  campos: string[];
}

/**
 * Separador del archivo según su encabezado: `;`, `,` o tabulador (el "Texto Unicode" de Excel va separado por tabulaciones).
 * Gana el que más aparece fuera de comillas en la primera línea con separadores; si empatan, `;`, luego `,`.
 */
export function detectarSeparador(texto: string): ";" | "," | "\t" {
  let puntoYComa = 0;
  let comas = 0;
  let tabs = 0;
  let enComillas = false;
  for (const c of texto) {
    if (c === '"') enComillas = !enComillas;
    else if (!enComillas && (c === "\n" || c === "\r")) {
      if (puntoYComa + comas + tabs > 0) break; // ya pasó una línea con separadores: es el encabezado
    } else if (!enComillas && c === ";") puntoYComa++;
    else if (!enComillas && c === ",") comas++;
    else if (!enComillas && c === "\t") tabs++;
  }
  if (tabs > puntoYComa && tabs > comas) return "\t";
  return comas > puntoYComa ? "," : ";";
}

/**
 * CSV estándar: comillas dobles, comillas escapadas duplicadas y saltos de línea dentro de comillas. Omite líneas vacías.
 * `comillaAbiertaEn` es la línea donde se abrió una comilla que nunca se cerró (`null` si todas se cerraron).
 */
export function partirRegistros(texto: string, separador: string): { registros: RegistroCrudo[]; comillaAbiertaEn: number | null } {
  const salida: RegistroCrudo[] = [];
  let campos: string[] = [];
  let actual = "";
  let enComillas = false;
  let lineaComilla = 0;
  let linea = 1;
  let lineaInicio = 1;

  const cerrar = (): void => {
    campos.push(actual);
    if (campos.some((c) => c.trim() !== "")) salida.push({ linea: lineaInicio, campos });
    campos = [];
    actual = "";
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i] as string;
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          actual += '"';
          i++;
        } else enComillas = false;
      } else {
        if (c === "\n") linea++;
        actual += c;
      }
    } else if (c === '"' && actual === "") {
      enComillas = true;
      lineaComilla = linea;
    } else if (c === separador) {
      campos.push(actual);
      actual = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      cerrar();
      linea++;
      lineaInicio = linea;
    } else {
      actual += c;
    }
  }
  if (actual !== "" || campos.length > 0) cerrar();
  return { registros: salida, comillaAbiertaEn: enComillas ? lineaComilla : null };
}

/**
 * Lee el CSV exportado del sistema de gestión (o el que exporta esta misma demo).
 * `Error` si el archivo es demasiado grande, está vacío, tiene una comilla sin cerrar o le falta una columna obligatoria.
 */
export function leerRegistro(texto: string): LecturaRegistro | Error {
  if (texto.length > LIMITE_BYTES) return new ErrorRegistro("El archivo supera el máximo de 2 MB.");
  const limpio = texto.replace(/^﻿/, "");
  if (limpio.trim() === "") return new ErrorRegistro("El archivo está vacío.");

  const separador = detectarSeparador(limpio);
  const { registros: crudos, comillaAbiertaEn } = partirRegistros(limpio, separador);
  if (comillaAbiertaEn !== null) {
    return new ErrorRegistro(`El archivo tiene una comilla sin cerrar a partir de la línea ${comillaAbiertaEn}.`);
  }
  if (crudos.length > LIMITE_LINEAS) {
    return new ErrorRegistro(`El archivo supera el máximo de ${LIMITE_LINEAS.toLocaleString("es-AR")} líneas.`);
  }
  const encabezado = crudos[0];
  if (!encabezado) return new ErrorRegistro("El archivo está vacío.");
  if (encabezado.campos.length === 1) {
    return new ErrorRegistro(
      "No se reconocen columnas en la primera línea: el archivo debe estar separado por punto y coma, coma o tabulador. Revise que sea un CSV con encabezados.",
    );
  }

  const nombres = encabezado.campos.map(normalizarTexto);
  const indice = {} as Record<ColumnaClave, number>;
  const encabezadosDuplicados: string[] = [];
  for (const clave of Object.keys(COLUMNAS) as ColumnaClave[]) {
    const { etiqueta, nombres: aceptados } = COLUMNAS[clave];
    const posiciones = nombres.flatMap((n, i) => (aceptados.includes(n) ? [i] : []));
    const primera = posiciones[0];
    if (primera === undefined) {
      return new ErrorRegistro(
        `Falta la columna de ${etiqueta}. Nombres aceptados: ${aceptados.join(", ")}. Revise la primera línea del archivo.`,
      );
    }
    indice[clave] = primera;
    if (posiciones.length > 1) encabezadosDuplicados.push(etiqueta);
  }

  const indiceDesglose: Partial<Record<ColumnaDesglose, number>> = {};
  for (const clave of Object.keys(COLUMNAS_DESGLOSE) as ColumnaDesglose[]) {
    const { etiqueta, nombres: aceptados } = COLUMNAS_DESGLOSE[clave];
    const posiciones = nombres.flatMap((n, i) => (aceptados.includes(n) ? [i] : []));
    const primera = posiciones[0];
    if (primera === undefined) continue;
    indiceDesglose[clave] = primera;
    if (posiciones.length > 1) encabezadosDuplicados.push(etiqueta);
  }

  const lineasInvalidas: number[] = [];
  const lineasImporteExcesivo: number[] = [];
  const lineasDesgloseIlegible: number[] = [];
  const porClave = new Map<string, ClaveRepetida>();

  for (const crudo of crudos.slice(1)) {
    const c = crudo.campos;
    const cuit = aDigitos((c[indice.cuit] ?? "").trim());
    const tipoCmp = interpretarTipo(c[indice.tipo] ?? "");
    const ptoVta = aEnteroNoNegativo((c[indice.ptoVta] ?? "").trim());
    const nroCmp = aEnteroNoNegativo((c[indice.numero] ?? "").trim());
    const importeLeido = importeCrudo(c[indice.importe] ?? "");
    const excesivo = importeLeido !== null && problemaDeImporte(importeLeido) !== null;
    const importe = importeLeido === null || excesivo ? null : importeLeido;
    const claveImposible = tipoCmp === 0 || ptoVta === 0 || nroCmp === 0 || (ptoVta ?? 0) > MAXIMO_PUNTO_DE_VENTA;
    if (cuit === null || cuit.length !== 11 || tipoCmp === null || ptoVta === null || nroCmp === null || importe === null || claveImposible) {
      lineasInvalidas.push(crudo.linea);
      if (excesivo) lineasImporteExcesivo.push(crudo.linea);
      continue;
    }
    const clave = claveRegistro({ cuit, tipoCmp, ptoVta, nroCmp });
    const previa = porClave.get(clave);
    if (previa) {
      previa.veces++;
      previa.lineas.push(crudo.linea);
      // La clave repetida guarda el importe de cada copia: el cruce compara contra todas, no solo contra la primera.
      previa.registro.copias ??= [{ linea: previa.registro.linea, importe: previa.registro.importe }];
      previa.registro.copias.push({ linea: crudo.linea, importe });
    } else {
      const { desglose, ilegible } = leerDesglose(c, indiceDesglose);
      if (ilegible) lineasDesgloseIlegible.push(crudo.linea);
      porClave.set(clave, {
        registro: { cuit, tipoCmp, ptoVta, nroCmp, importe, linea: crudo.linea, ...(desglose === undefined ? {} : { desglose }) },
        veces: 1,
        lineas: [crudo.linea],
      });
    }
  }

  const todas = [...porClave.values()];
  return {
    registros: todas.map((x) => x.registro),
    lineasInvalidas,
    lineasImporteExcesivo,
    clavesRepetidas: todas.filter((x) => x.veces > 1),
    encabezadosDuplicados,
    lineasDesgloseIlegible,
  };
}

/**
 * El desglose de una línea. Una celda vacía es "no informado". Una que no se puede leer (texto, más de 2 decimales, una fecha imposible,
 * una fórmula) se ignora y se avisa; nunca invalida la línea. Sin ningún dato leído no hay desglose.
 */
function leerDesglose(c: readonly string[], indice: Partial<Record<ColumnaDesglose, number>>): { desglose?: Desglose; ilegible: boolean } {
  let ilegible = false;
  const celda = (columna: ColumnaDesglose): string => {
    const i = indice[columna];
    return i === undefined ? "" : (c[i] ?? "").trim();
  };
  const importe = (columna: ColumnaDesglose): number | null => {
    const texto = celda(columna);
    if (texto === "") return null;
    const n = interpretarImporte(texto);
    if (n === null) ilegible = true;
    return n;
  };
  const textoVencimiento = celda("vencimientoCae");
  const vencimiento = textoVencimiento === "" ? "" : normalizarVencimiento(textoVencimiento);
  if (vencimiento === null) ilegible = true;
  const desglose: Desglose = { neto: importe("neto"), iva: importe("iva"), otros: importe("otros"), vencimientoCae: vencimiento ?? "" };
  const hayDato = desglose.neto !== null || desglose.iva !== null || desglose.otros !== null || desglose.vencimientoCae !== "";
  return hayDato ? { desglose, ilegible } : { ilegible };
}

/** Cuántos comprobantes del registro traen desglose (la clave repetida cuenta una vez). */
export function contarConDesglose(l: LecturaRegistro): number {
  return l.registros.filter((r) => r.desglose !== undefined).length;
}

/** Líneas del archivo que se leyeron bien: una por comprobante distinto más una por cada copia de una clave repetida. */
export function lineasLeidas(l: LecturaRegistro): number {
  return l.registros.length + l.clavesRepetidas.reduce((suma, c) => suma + c.veces - 1, 0);
}

/** "3 líneas no se pudieron leer: 4, 9, 12". Muestra hasta 15 números. Vacío si no hay ninguna. */
export function describirLineasInvalidas(lineas: readonly number[]): string {
  if (lineas.length === 0) return "";
  const visibles = lineas.slice(0, 15).join(", ");
  const resto = lineas.length > 15 ? ` y ${lineas.length - 15} más` : "";
  const sujeto = lineas.length === 1 ? "1 línea no se pudo leer" : `${lineas.length} líneas no se pudieron leer`;
  return `${sujeto}: ${visibles}${resto}.`;
}

/** "2 líneas tienen un importe con más de 2 decimales o más de 12 dígitos enteros: 3, 4." Muestra hasta 15 números. */
export function describirImportesExcesivos(lineas: readonly number[]): string {
  if (lineas.length === 0) return "";
  const visibles = lineas.slice(0, 15).join(", ");
  const resto = lineas.length > 15 ? ` y ${lineas.length - 15} más` : "";
  const sujeto = lineas.length === 1 ? "1 línea tiene un importe" : `${lineas.length} líneas tienen un importe`;
  return `${sujeto} con más de 2 decimales o más de 12 dígitos enteros: ${visibles}${resto}.`;
}

/** "1 línea tiene un neto, IVA, otros conceptos o vencimiento del CAE que no se pudo leer: 4. Se ignoró ese dato." Hasta 15 números. */
export function describirDesgloseIlegible(lineas: readonly number[]): string {
  if (lineas.length === 0) return "";
  const visibles = lineas.slice(0, 15).join(", ");
  const resto = lineas.length > 15 ? ` y ${lineas.length - 15} más` : "";
  const uno = lineas.length === 1;
  const sujeto = uno ? "1 línea tiene" : `${lineas.length} líneas tienen`;
  return `${sujeto} un neto, IVA, otros conceptos o vencimiento del CAE que no se ${uno ? "pudo" : "pudieron"} leer: ${visibles}${resto}. Se ${uno ? "ignoró ese dato" : "ignoraron esos datos"}.`;
}

/** "Hay más de una columna de CUIT: se usó la primera." Vacío si no hay encabezados repetidos. */
export function describirEncabezadosDuplicados(columnas: readonly string[]): string {
  return columnas.map((c) => `Hay más de una columna de ${c}: se usó la primera.`).join(" ");
}

// ---------------------------------------------------------------- Cruce

/**
 * Compara en centavos enteros, sin tolerancia. El signo cuenta, salvo en las notas de crédito: algunos sistemas
 * las exportan en negativo y otros en positivo, y ahí se compara el valor absoluto.
 */
function mismoImporte(a: number | null, b: number, tipoCmp: number | null): boolean {
  if (a === null) return false;
  const ca = Math.round(a * 100);
  const cb = Math.round(b * 100);
  return esNotaDeCredito(tipoCmp) ? Math.abs(ca) === Math.abs(cb) : ca === cb;
}

/** `true` si el importe coincide con alguno de los del sistema (con la clave repetida, alcanza con una copia). */
function coincideConAlguno(importe: number | null, importes: readonly number[], tipoCmp: number | null): boolean {
  return importes.some((i) => mismoImporte(importe, i, tipoCmp));
}

/** Los importes con que el sistema tiene el comprobante: uno, o uno por copia si figura repetido. */
function importesDe(r: Registro): number[] {
  return r.copias === undefined ? [r.importe] : r.copias.map((c) => c.importe);
}

function claveRegistro(r: Pick<Registro, "cuit" | "tipoCmp" | "ptoVta" | "nroCmp">): string {
  return `${r.cuit}|${r.tipoCmp}|${r.ptoVta}|${r.nroCmp}`;
}

/** Clave sin emisor, para detectar la carga con otro CUIT. */
function claveSinEmisor(tipoCmp: number, ptoVta: number, nroCmp: number): string {
  return `${tipoCmp}|${ptoVta}|${nroCmp}`;
}

/**
 * Cruza cada fila de la planilla con el registro. Un duplicado de la planilla (misma clave que una fila anterior) no
 * hereda el resultado de su original: tiene el suyo, "duplicada", que apunta a esa fila. Así nunca se ve como "ya cargada"
 * y los conteos del resumen coinciden con los sellos de la tabla.
 *
 * - "Otro emisor" solo se marca con registros que NINGUNA fila reclama por clave exacta. Si varias filas comparten
 *   tipo, punto de venta, número e importe con ese registro, TODAS quedan como "otro emisor": la herramienta no puede
 *   saber cuál es la que se cargó mal y lo dice para cada una; la persona decide. Así el resultado de cada fila depende
 *   solo de los datos y no del orden de la planilla. Si dos registros de CUIT distintos son candidatos de una misma
 *   fila, se elige el primero del registro (el orden del archivo, no el de la planilla).
 * - "Revisar antes de cargar": una fila con datos dudosos que no está en el registro (en vez de "Falta cargar").
 * - `soloEnRegistro` deja afuera los registros que ya se explican como coincidencia exacta o como "otro emisor", y las claves repetidas
 *   (esas tienen su propio aviso: "Cargadas dos veces").
 */
export function conciliar(filas: readonly Fila[], registros: readonly Registro[], hoy: Date = new Date()): Conciliacion {
  const porClave = new Map<string, Registro>();
  const porNumero = new Map<string, Registro[]>();
  for (const r of registros) {
    const clave = claveRegistro(r);
    if (porClave.has(clave)) continue; // si por error llegan repetidos, vale el primero
    porClave.set(clave, r);
    const k = claveSinEmisor(r.tipoCmp, r.ptoVta, r.nroCmp);
    const lista = porNumero.get(k);
    if (lista) lista.push(r);
    else porNumero.set(k, [r]);
  }

  // Pasada 1: registros que alguna fila reclama por clave exacta. No pueden usarse para acusar a otra de "otro emisor".
  const exactos = new Set<Registro>();
  for (const fila of filas) {
    const clave = claveDuplicado(fila.datos);
    const r = clave === null ? undefined : porClave.get(clave);
    if (r) exactos.add(r);
  }

  // Pasada 2: resultado de cada fila.
  const porFila = new Map<number, Resultado>();
  const primeraPorClave = new Map<string, number>();
  const comoOtroEmisor = new Set<Registro>();

  for (const fila of filas) {
    const d = fila.datos;
    const clave = claveDuplicado(d);
    if (clave === null || d.tipoCmp === null || d.ptoVta === null || d.nroCmp === null) {
      porFila.set(fila.id, { tipo: "no-conciliable" });
      continue;
    }
    const original = primeraPorClave.get(clave);
    if (original !== undefined) {
      porFila.set(fila.id, { tipo: "duplicada", original });
      continue;
    }
    primeraPorClave.set(clave, fila.id);

    let resultado: Resultado;
    const registro = porClave.get(clave);
    const { importe, tipoCmp, ptoVta, nroCmp } = d;
    if (registro) {
      // Con la clave repetida se compara contra TODAS las copias: coincidir con alguna alcanza, y el resultado no depende del orden.
      const importes = importesDe(registro);
      const copias = registro.copias === undefined ? {} : { copias: importes };
      resultado = coincideConAlguno(importe, importes, tipoCmp)
        ? { tipo: "ya-cargada", ...copias }
        : { tipo: "otro-importe", importeFila: importe, importeRegistro: registro.importe, ...copias };
    } else {
      // También el otro emisor puede tener el comprobante repetido: alcanza con que alguna de sus copias coincida.
      const otro =
        importe === null
          ? undefined
          : (porNumero.get(claveSinEmisor(tipoCmp, ptoVta, nroCmp)) ?? []).find(
              (r) => r.cuit !== d.cuit && !exactos.has(r) && coincideConAlguno(importe, importesDe(r), tipoCmp),
            );
      if (otro) {
        comoOtroEmisor.add(otro);
        resultado = { tipo: "otro-emisor", cuitRegistro: otro.cuit, ...(otro.copias === undefined ? {} : { copias: importesDe(otro) }) };
      } else {
        resultado = { tipo: estadoFila(fila, hoy).estado === "revisar" ? "revisar" : "falta" };
      }
    }
    porFila.set(fila.id, resultado);
  }

  // Una clave repetida que nadie recibió va solo en la lista "Cargadas dos veces": en las dos listas a la vez contaría dos veces lo mismo.
  const soloEnRegistro = [...porClave.values()].filter((r) => !exactos.has(r) && !comoOtroEmisor.has(r) && r.copias === undefined);
  return { porFila, soloEnRegistro };
}

export type FiltroFilas = "todas" | "faltan" | "revisar" | "diferencias";

/**
 * Qué filas se ven con cada filtro. Con un filtro activo no se muestran los duplicados de la planilla
 * (cada comprobante cuenta una vez); sin filtro se ve todo.
 */
export function mostrarConFiltro(filtro: FiltroFilas, resultado: Resultado | undefined, duplicada: boolean): boolean {
  if (filtro === "todas") return true;
  if (duplicada || resultado === undefined) return false;
  if (filtro === "faltan") return resultado.tipo === "falta";
  if (filtro === "revisar") return resultado.tipo === "revisar";
  return resultado.tipo === "otro-importe" || resultado.tipo === "otro-emisor";
}

// ---------------------------------------------------------------- Resumen y textos

/** Suma de notas de crédito por moneda, pesos primero. Los importes quedan positivos: en esta lista nada se resta. */
function totalesNotasDeCredito(filas: readonly Fila[]): TotalMoneda[] {
  const acumulado = new Map<string, { centavos: number; cantidad: number }>();
  for (const fila of filas) {
    if (fila.datos.importe === null) continue;
    const previo = acumulado.get(fila.datos.moneda) ?? { centavos: 0, cantidad: 0 };
    acumulado.set(fila.datos.moneda, { centavos: previo.centavos + Math.round(fila.datos.importe * 100), cantidad: previo.cantidad + 1 });
  }
  return [...acumulado.entries()]
    .map(([moneda, { centavos, cantidad }]) => ({ moneda, nombre: nombreMoneda(moneda), total: centavos / 100, cantidad }))
    .sort((a, b) => pesosPrimero(a.moneda, b.moneda));
}

/**
 * Filas cuyo comprobante el sistema trae dos veces (o más): error del sistema, que se muestra en ámbar, no en verde. Entran las "ya cargadas"
 * (coinciden con alguna copia), las "otro importe" (no coinciden con ninguna) y las "otro emisor" cuyo otro CUIT figura repetido.
 * Las duplicadas de la planilla quedan afuera (ya tienen su sello).
 */
export function filasCargadasDosVeces(filas: readonly Fila[], conciliacion: Conciliacion, clavesRepetidas: readonly ClaveRepetida[]): Set<number> {
  const marcadas = new Set<number>();
  if (clavesRepetidas.length === 0) return marcadas;
  const repetidas = new Set(clavesRepetidas.map((c) => claveRegistro(c.registro)));
  for (const fila of filas) {
    const r = conciliacion.porFila.get(fila.id);
    if (r?.tipo !== "ya-cargada" && r?.tipo !== "otro-importe" && r?.tipo !== "otro-emisor") continue;
    // Con "otro emisor" la clave que el sistema repite es la de ese otro CUIT, no la de la fila.
    const clave = claveDuplicado(r.tipo === "otro-emisor" ? { ...fila.datos, cuit: r.cuitRegistro } : fila.datos);
    if (clave !== null && repetidas.has(clave)) marcadas.add(fila.id);
  }
  return marcadas;
}

export function resumenConciliacion(
  filas: readonly Fila[],
  conciliacion: Conciliacion,
  clavesRepetidas: readonly ClaveRepetida[] = [],
): ResumenConciliacion {
  const repetidas = duplicadas(filas);
  const cuenta: Record<TipoResultado, number> = { falta: 0, revisar: 0, "ya-cargada": 0, "otro-importe": 0, "otro-emisor": 0, "no-conciliable": 0, duplicada: 0 };
  const faltantes: Fila[] = [];
  const faltantesNotas: Fila[] = [];
  for (const fila of filas) {
    if (repetidas.has(fila.id)) continue;
    const r = conciliacion.porFila.get(fila.id);
    if (!r) continue;
    cuenta[r.tipo]++;
    if (r.tipo === "falta") (esNotaDeCredito(fila.datos.tipoCmp) ? faltantesNotas : faltantes).push(fila);
  }
  const repetidasEnElSistema = filasCargadasDosVeces(filas, conciliacion, clavesRepetidas);
  const yaCargadasRepetidas = [...repetidasEnElSistema].filter((id) => conciliacion.porFila.get(id)?.tipo === "ya-cargada").length;
  return {
    faltan: cuenta.falta,
    faltanNotasCredito: faltantesNotas.length,
    faltanNotasDebito: faltantes.filter((f) => esNotaDeDebito(f.datos.tipoCmp)).length,
    faltanOtrosTipos: faltantes.filter((f) => !esTipoConocido(f.datos.tipoCmp)).length,
    faltanPorMoneda: totalesPorMoneda(faltantes).sort((a, b) => pesosPrimero(a.moneda, b.moneda)),
    faltanNotasCreditoPorMoneda: totalesNotasDeCredito(faltantesNotas),
    revisar: cuenta.revisar,
    yaCargadas: cuenta["ya-cargada"],
    otroImporte: cuenta["otro-importe"],
    otroEmisor: cuenta["otro-emisor"],
    conDiferencias: cuenta["otro-importe"] + cuenta["otro-emisor"],
    noConciliables: cuenta["no-conciliable"],
    noRecibidas: conciliacion.soloEnRegistro.length,
    cargadasDosVeces: clavesRepetidas.length,
    cargadasMasDeDosVeces: clavesRepetidas.filter((c) => c.veces > 2).length,
    yaCargadasRepetidas,
    duplicadas: repetidas.size,
  };
}

/** Detalle del resultado ("planilla 45.200,00; sistema 45.020,00"). Vacío si no hay nada que agregar. `editada`: la fila tiene datos escritos a mano. */
export function detalleResultado(r: Resultado, editada = false): string {
  switch (r.tipo) {
    case "otro-importe":
      return `Planilla: ${r.importeFila === null ? "sin importe" : formatearImporte(r.importeFila)}. Sistema: ${formatearImporte(r.importeRegistro)}. ${accionDeMalCargada(editada)}`;
    case "otro-emisor":
      return `En el sistema figura con el CUIT ${formatearCuit(r.cuitRegistro)}. ${accionDeMalCargada(editada)}`;
    default:
      return "";
  }
}

/** Texto de una sola línea para el CSV: la etiqueta y, si corresponde, su detalle. */
export function textoResultado(r: Resultado, editada = false): string {
  const detalle = detalleResultado(r, editada);
  return detalle === "" ? ETIQUETA_RESULTADO[r.tipo] : `${ETIQUETA_RESULTADO[r.tipo]} (${detalle.replace(/\.$/, "")})`;
}

/** Une los trozos de un detalle en un texto plano. */
function textoDePartes(partes: readonly ParteDetalle[]): string {
  return partes.map((p) => p.texto).join("");
}

/**
 * Descripción de un registro por trozos, para las listas de la interfaz: el CUIT, el número y el importe van aparte (código, código y monto)
 * para que la interfaz no los corte entre renglones. El CSV del sistema no trae la moneda: quien llama pasa la de la factura con la que
 * coincide y, si no hay ninguna, se usan pesos.
 */
export function partesRegistro(r: Registro, moneda = "PES"): ParteDetalle[] {
  return [
    { tipo: "codigo", texto: formatearCuit(r.cuit) },
    { tipo: "texto", texto: ` · ${nombreTipo(r.tipoCmp)} ` },
    { tipo: "codigo", texto: formatearNumeroCmp(r.ptoVta, r.nroCmp) },
    { tipo: "texto", texto: " · " },
    { tipo: "monto", texto: formatearMonto(moneda, r.importe) },
  ];
}

/** La misma descripción como texto plano: "30-99000001-4 · Factura A 0003-00001260 · $ 52.000,00". */
export function describirRegistro(r: Registro, moneda = "PES"): string {
  return textoDePartes(partesRegistro(r, moneda));
}

/**
 * Cuánto difieren el importe de la planilla y el del sistema, en la unidad de la moneda y siempre positivo. Se calcula en
 * centavos y con la misma regla de signo que `mismoImporte` (en las notas de crédito se ignora). `null` sin importe en la planilla.
 */
export function diferenciaImporte(importeFila: number | null, importeRegistro: number, tipoCmp: number | null): number | null {
  if (importeFila === null) return null;
  const a = Math.round(importeFila * 100);
  const b = Math.round(importeRegistro * 100);
  const centavos = esNotaDeCredito(tipoCmp) ? Math.abs(Math.abs(a) - Math.abs(b)) : Math.abs(a - b);
  return centavos / 100;
}

/** "a, b y c"; con más de `tope`, los primeros y "y N más" ("a, b, c, d, e y 2.995 más"). */
function unir(items: readonly string[], tope = TOPE_COPIAS_EN_DETALLE): string {
  if (items.length > tope) return `${items.slice(0, tope).join(", ")} y ${conMiles(items.length - tope)} más`;
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Como `unir`, pero con trozos: "a, b y c" y, con más de `tope`, los primeros y "y N más". */
function unirPartes(items: readonly ParteDetalle[][], tope = TOPE_COPIAS_EN_DETALLE): ParteDetalle[] {
  const visibles = items.slice(0, tope);
  const resto = items.length - visibles.length;
  const partes = visibles.flatMap((item, i): ParteDetalle[] => [...(i === 0 ? [] : [parteTexto(i === visibles.length - 1 && resto === 0 ? " y " : ", ")]), ...item]);
  return resto === 0 ? partes : [...partes, parteTexto(` y ${conMiles(resto)} más`)];
}

/** "Cargada dos veces en el sistema"; con 3 o más, "Cargada 3 veces en el sistema". */
export function textoCargadaVeces(veces: number): string {
  return veces > 2 ? `Cargada ${veces} veces en el sistema` : TEXTO_CARGADA_DOS_VECES;
}

/**
 * Aviso de un comprobante que el archivo trae más de una vez, sin compararlo con ninguna factura. El sistema real no permite cargar dos
 * veces el mismo comprobante: es un error del sistema y la salida es dar de baja la copia que sobra. Lista cada copia con su línea e importe
 * (hasta `TOPE_COPIAS_EN_DETALLE`; el resto, "y N más"). `moneda` la pone quien llama (el CSV del sistema no la trae).
 */
export function partesClaveRepetida(c: ClaveRepetida, moneda: string): ParteDetalle[] {
  const r = c.registro;
  const dos = c.veces === 2;
  const importes = r.copias?.map((x) => x.importe) ?? [];
  // Dos copias con el mismo importe: no hay "la que sobra", son iguales y se da de baja una.
  const iguales = dos && importes.length === 2 && importes[0] === importes[1];
  const baja = iguales ? "Las dos copias tienen el mismo importe: dé de baja una." : `Dé de baja ${dos ? "la copia que sobra" : "las copias que sobran"}.`;
  const aviso = `Este comprobante figura cargado ${dos ? "dos veces" : `${c.veces} veces`}; el sistema no debería permitirlo. ${baja}`;
  const copias: ParteDetalle[] =
    r.copias === undefined
      ? [parteTexto(`Líneas ${unir(c.lineas.map(String))}.`)]
      : [
          parteTexto("Copias: "),
          ...unirPartes(r.copias.map((x): ParteDetalle[] => [parteTexto(`línea ${x.linea} (`), { tipo: "monto", texto: formatearMonto(moneda, x.importe) }, parteTexto(")")])),
          parteTexto("."),
        ];
  return [
    { tipo: "codigo", texto: formatearCuit(r.cuit) },
    parteTexto(` · ${nombreTipo(r.tipoCmp)} `),
    { tipo: "codigo", texto: formatearNumeroCmp(r.ptoVta, r.nroCmp) },
    parteTexto(`. ${aviso} `),
    ...copias,
  ];
}

/** El mismo aviso como texto plano. */
export function describirClaveRepetida(c: ClaveRepetida, moneda: string): string {
  return textoDePartes(partesClaveRepetida(c, moneda));
}

const parteTexto = (t: string): ParteDetalle => ({ tipo: "texto", texto: t });

/** "$ a, $ b y $ c"; con más de `TOPE_COPIAS_EN_DETALLE` importes, los primeros y "y N más". Cada monto va en su parte (no se corta). */
function listaDeMontos(importes: readonly number[], formato: (n: number) => string): ParteDetalle[] {
  const visibles = importes.slice(0, TOPE_COPIAS_EN_DETALLE);
  const resto = importes.length - visibles.length;
  const partes = visibles.flatMap((n, i): ParteDetalle[] => [
    ...(i === 0 ? [] : [parteTexto(i === visibles.length - 1 && resto === 0 ? " y " : ", ")]),
    { tipo: "monto", texto: formato(n) },
  ]);
  return resto === 0 ? partes : [...partes, parteTexto(` y ${conMiles(resto)} más`)];
}

/**
 * Qué decir de una fila cuyo comprobante el sistema tiene cargado más de una vez, comparándolo con TODAS las copias:
 * - sin importe en la planilla: no se puede comparar, y no se acusa a ninguna copia;
 * - coincide con alguna: cuál coincide y cuál(es) sobra(n);
 * - no coincide con ninguna: se dan de baja todas y se carga una sola vez con los datos correctos (si la fila tiene datos escritos a mano,
 *   primero se revisa lo escrito: `editada`).
 * `formato` da el texto de un importe (con su moneda). Las listas de importes se acotan (`TOPE_COPIAS_EN_DETALLE`).
 */
export function detalleCopias(
  importeFila: number | null,
  copias: readonly number[],
  tipoCmp: number | null,
  formato: (n: number) => string,
  editada = false,
): ParteDetalle[] {
  const coinciden = copias.filter((c) => mismoImporte(importeFila, c, tipoCmp));
  const sobran = copias.filter((c) => !mismoImporte(importeFila, c, tipoCmp));
  const encabezado = [parteTexto(`En el sistema figura ${conMiles(copias.length)} veces: `), ...listaDeMontos(copias, formato), parteTexto(". ")];
  if (importeFila === null) {
    return [...encabezado, parteTexto("Esta fila no tiene importe, así que no se puede decir cuál de las copias coincide: complete el importe para compararlas.")];
  }
  if (coinciden.length === 0) {
    return [
      ...encabezado,
      parteTexto(
        editada
          ? "Ninguna copia coincide con esta fila, que tiene datos escritos a mano: revise que la diferencia no esté en lo que escribió antes de tocar el sistema."
          : "Ninguna copia coincide con el comprobante: dé de baja todas y cárguelo una sola vez con los datos correctos.",
      ),
    ];
  }
  if (sobran.length === 0) {
    // Con exactamente dos copias el plural no va ("Todas… las que sobran"): son dos y se da de baja una.
    return [
      ...encabezado,
      parteTexto(copias.length === 2 ? "Las dos coinciden: dé de baja una." : "Todas coinciden con el comprobante: dé de baja las que sobran y deje una sola."),
    ];
  }
  const darDeBaja = [parteTexto(sobran.length === 1 ? "Dé de baja la copia de " : "Dé de baja las copias de "), ...listaDeMontos(sobran, formato)];
  if (coinciden.length === 1) {
    return [...encabezado, parteTexto("Coincide con la copia de "), ...listaDeMontos(coinciden, formato), parteTexto(". "), ...darDeBaja, parteTexto(sobran.length === 1 ? " que sobra." : " que sobran.")];
  }
  return [...encabezado, parteTexto(`Coinciden ${conMiles(coinciden.length)} copias con el comprobante. `), ...darDeBaja, parteTexto(" y deje una sola de las que coinciden.")];
}

/** Los importes de todas las copias que el sistema tiene del comprobante de esta fila, si lo repite. `undefined` si no hay repetición. */
export function copiasDe(r: Resultado): readonly number[] | undefined {
  return r.tipo === "ya-cargada" || r.tipo === "otro-importe" || r.tipo === "otro-emisor" ? r.copias : undefined;
}

/**
 * Cuántas veces figura y qué decir de una fila cuyo comprobante el sistema trae más de una vez (con el comprobante de la fila o con el de
 * otro emisor), o `null` si no hay repetición. Lo usan la planilla y el CSV, para que digan lo mismo.
 */
export function detalleCargadaVariasVeces(
  r: Resultado,
  importeFila: number | null,
  tipoCmp: number | null,
  formato: (n: number) => string,
  editada: boolean,
): { veces: number; partes: ParteDetalle[] } | null {
  const copias = copiasDe(r);
  if (copias === undefined) return null;
  const veces = copias.length;
  if (r.tipo !== "otro-emisor") return { veces, partes: detalleCopias(importeFila, copias, tipoCmp, formato, editada) };
  const partes: ParteDetalle[] = [
    parteTexto(`En el sistema figura ${conMiles(copias.length)} veces con el CUIT `),
    { tipo: "codigo", texto: formatearCuit(r.cuitRegistro) },
    parteTexto(": "),
    ...listaDeMontos(copias, formato),
    parteTexto(". "),
    parteTexto(editada ? ACCION_MAL_CARGADA_EDITADA : `Dé de baja las ${conMiles(veces)} cargas y cárguelo una sola vez con los datos correctos.`),
  ];
  return { veces, partes };
}

export interface ItemAtencion {
  /** Para enlazar cada ítem con su detalle (un filtro de la tabla o una lista). */
  clave: "revisar" | "diferencias" | "duplicadas" | "dosVeces" | "sinComprobante";
  cifra: number;
  /** El texto que sigue a la cifra: "para revisar". */
  texto: string;
}

/** "cargada dos veces en el sistema"; con alguna que figura 3 o más veces, "cargada más de una vez" (QA B3). */
function textoCargadas(r: ResumenConciliacion): string {
  const cargada = r.cargadasDosVeces === 1 ? "cargada" : "cargadas";
  return r.cargadasMasDeDosVeces > 0 ? `${cargada} más de una vez en el sistema` : `${cargada} dos veces en el sistema`;
}

/** Lo que requiere atención, en orden de importancia, sin los que valen cero. Vacío si no hay nada. */
export function itemsAtencion(r: ResumenConciliacion): ItemAtencion[] {
  const items: ItemAtencion[] = [
    { clave: "revisar", cifra: r.revisar, texto: "para revisar" },
    { clave: "diferencias", cifra: r.conDiferencias, texto: r.conDiferencias === 1 ? "mal cargada" : "mal cargadas" },
    { clave: "duplicadas", cifra: r.duplicadas, texto: r.duplicadas === 1 ? "duplicada en la planilla" : "duplicadas en la planilla" },
    { clave: "dosVeces", cifra: r.cargadasDosVeces, texto: textoCargadas(r) },
    { clave: "sinComprobante", cifra: r.noRecibidas, texto: r.noRecibidas === 1 ? "cargada en el sistema y no recibida" : "cargadas en el sistema y no recibidas" },
  ];
  return items.filter((i) => i.cifra > 0);
}

/**
 * Línea chica y gris del resumen. Si alguna fila que cuenta como "ya cargada" se ve como "Cargada dos veces" (el sistema trae el comprobante
 * repetido), lo dice entre paréntesis: si no, "Ya cargadas: 5" no coincide con las etiquetas "Ya cargada" que se ven en la planilla.
 */
export function lineaMenor(r: ResumenConciliacion): string {
  const n = r.yaCargadasRepetidas;
  const aclaracion =
    n === 0 ? "" : ` (${n} de ellas ${n === 1 ? "figura repetida" : "figuran repetidas"} en el sistema y se ${n === 1 ? "ve" : "ven"} como “${TEXTO_CARGADA_DOS_VECES}”)`;
  return `Ya cargadas: ${r.yaCargadas}${aclaracion} · No se pueden conciliar: ${r.noConciliables}`;
}
