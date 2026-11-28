// Estado de la planilla: funciones puras sobre una lista de filas (no modifican la lista que reciben).

import {
  aCodigoMoneda,
  aDigitos,
  aEnteroNoNegativo,
  claveDuplicado,
  comprobanteVacio,
  esNotaDeCredito,
  estadoDe,
  mensajeProblemaImporte,
  nombreMoneda,
  normalizarFecha,
  parsearImporteTexto,
  problemaDeImporte,
  type Campo,
  type Comprobante,
  type Estado,
} from "./comprobante.ts";
import { controlarComprobante, type CodigoObservacion, type Desglose, type Observacion } from "./control.ts";

export interface Fila {
  id: number;
  /** Nombre del archivo, "URL pegada" o el rótulo del ejemplo. */
  origen: string;
  /** `true` si los datos salieron de un QR de ARCA. */
  conQr: boolean;
  /** Aviso opcional sobre la lectura (por ejemplo, "QR sin datos de ARCA"). */
  nota: string;
  /** Aclaración que se muestra como `title` del origen (en los ejemplos, el caso de prueba que ilustra la fila). */
  detalle: string;
  datos: Comprobante;
  /** Campos que el usuario corrigió a mano. */
  editados: Campo[];
  /**
   * Neto, IVA, otros conceptos y vencimiento del CAE, si quien cargó el comprobante los informó (el QR no los trae).
   * Sin esto el control del comprobante no puede comprobar el cuadre del total ni el vencimiento del CAE.
   */
  desglose?: Desglose;
}

export interface TotalMoneda {
  moneda: string;
  nombre: string;
  /** Facturas y notas de débito suman; notas de crédito restan. Los duplicados no entran. */
  total: number;
  cantidad: number;
}

export interface Resumen {
  total: number;
  leidas: number;
  revisar: number;
  sinQr: number;
  duplicadas: number;
  editadas: number;
}

export function crearFila(id: number, origen: string, comprobante: Comprobante | null, nota = "", detalle = "", desglose?: Desglose): Fila {
  return {
    id,
    origen,
    conQr: comprobante !== null,
    nota,
    detalle,
    datos: comprobante ?? comprobanteVacio(),
    editados: [],
    ...(desglose === undefined ? {} : { desglose }),
  };
}

export function siguienteId(filas: readonly Fila[]): number {
  return filas.reduce((max, f) => Math.max(max, f.id), 0) + 1;
}

export function agregarFila(filas: readonly Fila[], fila: Fila): Fila[] {
  return [...filas, fila];
}

export function quitarFila(filas: readonly Fila[], id: number): Fila[] {
  return filas.filter((f) => f.id !== id);
}

/** Lo que `motivosRevisar` ya dice: el control del comprobante lo repite, pero en el estado no se muestra dos veces. */
const YA_DICHAS_POR_EL_ESTADO: ReadonlySet<CodigoObservacion> = new Set(["cuit-emisor", "fecha", "fecha-futura"]);

/** Observaciones del control del comprobante que el estado todavía no decía (cuadre, letra, CUIT del receptor, CAE). Vacío sin QR. */
export function controlesDeFila(fila: Fila, hoy: Date = new Date()): Observacion[] {
  if (!fila.conQr) return [];
  return controlarComprobante(fila.datos, fila.desglose, hoy).filter((o) => !YA_DICHAS_POR_EL_ESTADO.has(o.codigo));
}

export function estadoFila(fila: Fila, hoy: Date = new Date()): { estado: Estado; motivos: string[] } {
  // Una fila sin QR sigue "sin QR" aunque se complete a mano: la lectura automática no la validó.
  if (!fila.conQr) return estadoDe(null, hoy);
  const base = estadoDe(fila.datos, hoy);
  const motivos = [...base.motivos, ...controlesDeFila(fila, hoy).map((o) => o.mensaje)];
  return { estado: motivos.length > 0 ? "revisar" : "leida", motivos };
}

/** Mapa `id de la fila duplicada → id de la primera fila con la misma clave`. La primera queda como original. */
export function duplicadas(filas: readonly Fila[]): Map<number, number> {
  const primeras = new Map<string, number>();
  const resultado = new Map<number, number>();
  for (const fila of filas) {
    const clave = claveDuplicado(fila.datos);
    if (clave === null) continue;
    const original = primeras.get(clave);
    if (original === undefined) primeras.set(clave, fila.id);
    else resultado.set(fila.id, original);
  }
  return resultado;
}

/** Interpreta lo que el usuario escribió en una celda. `Error` si no es válido (la celda debe volver al valor anterior). */
export function interpretarCampo(campo: Campo, texto: string): { valor: Comprobante[Campo] } | Error {
  const t = texto.trim();
  switch (campo) {
    case "cuit": {
      if (t === "") return { valor: "" };
      const d = aDigitos(t);
      return d === null ? new Error("El CUIT solo puede tener dígitos y guiones.") : { valor: d };
    }
    case "codAut": {
      if (t === "") return { valor: "" };
      const d = aDigitos(t);
      return d === null ? new Error("El CAE solo puede tener dígitos.") : { valor: d };
    }
    case "tipoCmp":
    case "ptoVta":
    case "nroCmp": {
      if (t === "") return { valor: null };
      const n = aEnteroNoNegativo(t);
      return n === null ? new Error("Debe ser un número entero, sin signo.") : { valor: n };
    }
    case "fecha": {
      if (t === "") return { valor: "" };
      const f = normalizarFecha(t);
      return f === null ? new Error("La fecha debe ser válida, con formato DD/MM/AAAA.") : { valor: f };
    }
    case "moneda": {
      const m = aCodigoMoneda(t);
      return /^[A-Z0-9]{0,3}$/.test(m) ? { valor: m } : new Error("La moneda es un código de hasta 3 caracteres (por ejemplo, PES).");
    }
    case "importe": {
      if (t === "") return { valor: null };
      const n = parsearImporteTexto(t);
      if (n === null) return new Error("El importe debe ser un número, por ejemplo 1.234,56.");
      const problema = problemaDeImporte(n);
      return problema === null ? { valor: n } : new Error(mensajeProblemaImporte(problema));
    }
  }
}

/** Aplica una corrección a mano. Si el valor no cambia, devuelve la misma lista. `Error` si el texto no es válido. */
export function editarFila(filas: readonly Fila[], id: number, campo: Campo, texto: string): Fila[] | Error {
  const actual = filas.find((f) => f.id === id);
  if (!actual) return new Error("La fila ya no existe.");
  const interpretado = interpretarCampo(campo, texto);
  if (interpretado instanceof Error) return interpretado;
  if (actual.datos[campo] === interpretado.valor) return [...filas];
  return filas.map((f) =>
    f.id !== id
      ? f
      : {
          ...f,
          datos: { ...f.datos, [campo]: interpretado.valor },
          editados: f.editados.includes(campo) ? f.editados : [...f.editados, campo],
        },
  );
}

/** Totales por moneda, en centavos para evitar errores de coma flotante. */
export function totalesPorMoneda(filas: readonly Fila[]): TotalMoneda[] {
  const repetidas = duplicadas(filas);
  const acumulado = new Map<string, { centavos: number; cantidad: number }>();
  for (const fila of filas) {
    if (repetidas.has(fila.id) || fila.datos.importe === null) continue;
    const signo = esNotaDeCredito(fila.datos.tipoCmp) ? -1 : 1;
    const centavos = signo * Math.round(fila.datos.importe * 100);
    const previo = acumulado.get(fila.datos.moneda) ?? { centavos: 0, cantidad: 0 };
    acumulado.set(fila.datos.moneda, { centavos: previo.centavos + centavos, cantidad: previo.cantidad + 1 });
  }
  return [...acumulado.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([moneda, { centavos, cantidad }]) => ({
      moneda,
      nombre: nombreMoneda(moneda),
      total: centavos / 100,
      cantidad,
    }));
}

export function resumen(filas: readonly Fila[], hoy: Date = new Date()): Resumen {
  const r: Resumen = { total: filas.length, leidas: 0, revisar: 0, sinQr: 0, duplicadas: duplicadas(filas).size, editadas: 0 };
  for (const fila of filas) {
    const { estado } = estadoFila(fila, hoy);
    if (estado === "leida") r.leidas++;
    else if (estado === "revisar") r.revisar++;
    else r.sinQr++;
    if (fila.editados.length > 0) r.editadas++;
  }
  return r;
}
