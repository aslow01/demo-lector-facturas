// Facturas de ejemplo 100 % ficticias. Las empresas, los CUIT, los importes y los CAE son inventados.
// Se cargan como direcciones de QR (no hay imágenes): el flujo de ejemplo no depende de archivos.

import { formatearImporte } from "./comprobante.ts";
import { armarCuit } from "./cuit.ts";
import type { Fila } from "./planilla.ts";
import { armarUrlQr } from "./qr-arca.ts";

export interface Ejemplo {
  /** Nombre de archivo ficticio que se muestra en la columna "Archivo" (`ejemplo-01.png`…). El QR no trae razón social. */
  origen: string;
  /** Qué caso de prueba ilustra (se muestra como aclaración, no como parte del nombre). */
  caso: string;
  /** Dirección del QR; `null` representa una imagen sin QR legible. */
  url: string | null;
}

const EMPRESAS = {
  valle: { nombre: "Insumos del Valle Demo S.A.", prefijo: "30", desde: 99000001 },
  transportes: { nombre: "Transportes Cuyanos Demo S.R.L.", prefijo: "30", desde: 99000101 },
  ferreteria: { nombre: "Ferretería Andina Demo S.A.", prefijo: "33", desde: 99000201 },
} as const;

/** Primer CUIT válido de la serie inventada que empieza en `desde`. */
export function cuitFicticio(prefijo: string, desde: number): string {
  for (let base = desde; base < desde + 50; base++) {
    const cuit = armarCuit(prefijo, String(base));
    if (cuit !== null) return cuit;
  }
  throw new Error("No se pudo generar un CUIT ficticio.");
}

/** CUIT ficticio del receptor de las facturas del ejemplo del control (la empresa que las recibe). No emite nada. */
export const CUIT_RECEPTOR_FICTICIO = cuitFicticio("30", 99000301);

export const CUIT_FICTICIOS = {
  valle: cuitFicticio(EMPRESAS.valle.prefijo, EMPRESAS.valle.desde),
  transportes: cuitFicticio(EMPRESAS.transportes.prefijo, EMPRESAS.transportes.desde),
  ferreteria: cuitFicticio(EMPRESAS.ferreteria.prefijo, EMPRESAS.ferreteria.desde),
} as const;

/** Cambia el último dígito para que el verificador deje de ser válido. */
function conVerificadorRoto(cuit: string): string {
  const ultimo = (Number(cuit.slice(-1)) + 1) % 10;
  return cuit.slice(0, 10) + String(ultimo);
}

function isoDeFecha(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

let semillaCae = 0;
/** CAE inventado de 14 dígitos. */
function caeFicticio(): string {
  semillaCae += 1;
  return `7000${String(semillaCae * 7919).padStart(10, "0")}`;
}

function qr(datos: {
  fecha: string;
  cuit: string;
  ptoVta: number | string;
  tipoCmp: number | string;
  nroCmp: number | string;
  importe: number | string;
  moneda?: string;
  ctz?: number;
  tipoDocRec?: number;
  nroDocRec?: number;
}, numerosComoTexto = false): string {
  return armarUrlQr({
    ver: 1,
    moneda: "PES",
    ctz: 1,
    tipoCodAut: "E",
    codAut: Number(caeFicticio()),
    ...datos,
    // El formato de ARCA trae el CUIT como número; en el caso "como texto" se deja el texto.
    cuit: numerosComoTexto ? datos.cuit : Number(datos.cuit),
  });
}

/** Misma dirección, con el base64 en variante URL (`-`/`_`) y sin relleno. */
function sinRelleno(url: string): string {
  const [base, p = ""] = url.split("?p=");
  return `${base}?p=${p.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** `true` si el nombre de archivo es uno de los ejemplos ficticios. */
export function esOrigenDeEjemplo(origen: string): boolean {
  return /^ejemplo-\d{2}\.png$/.test(origen);
}

/**
 * `true` si la fila salió de los ejemplos del programa y no de un archivo de la persona: además del nombre trae el caso que ilustra
 * (`Fila.detalle`), que solo ponen los ejemplos. Un archivo propio llamado `ejemplo-01.png` no cuenta (QA B4 de la etapa 3).
 */
export function esFilaDeEjemplo(fila: Pick<Fila, "origen" | "detalle">): boolean {
  return fila.detalle !== "" && esOrigenDeEjemplo(fila.origen);
}

/** Genera los ejemplos. `hoy` sirve para armar la fecha futura del caso "revisar". */
export function generarEjemplos(hoy: Date = new Date()): Ejemplo[] {
  semillaCae = 0;
  const { valle, transportes, ferreteria } = CUIT_FICTICIOS;
  const futura = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 30);
  // Cada ejemplo es un archivo ficticio numerado; el caso de prueba va aparte (en la interfaz, como `title`).
  // Los nombres de EMPRESAS solo sirven para generar CUIT distintos: el QR de ARCA no trae razón social, así que no se muestran.
  let numero = 0;
  const ej = (caso: string, url: string | null): Ejemplo => ({
    origen: `ejemplo-${String(++numero).padStart(2, "0")}.png`,
    caso,
    url,
  });

  const facturaValle = qr({ fecha: "2026-10-05", cuit: valle, ptoVta: 3, tipoCmp: 1, nroCmp: 1245, importe: 118470.5 });

  return [
    ej("Factura A normal: ya cargada en el sistema.", facturaValle),
    ej("Importe distinto al del sistema (45.200,00 contra 45.020,00).", qr({ fecha: "2026-10-07", cuit: transportes, ptoVta: 1, tipoCmp: 6, nroCmp: 876, importe: 45200 })),
    ej("Factura B que el sistema tiene cargada dos veces, con el mismo importe.", qr({ fecha: "2026-10-09", cuit: ferreteria, ptoVta: 2, tipoCmp: 6, nroCmp: 31, importe: 9350.25 })),
    ej("Factura en dólares que falta cargar.", qr({ fecha: "2026-10-12", cuit: valle, ptoVta: 3, tipoCmp: 1, nroCmp: 1251, importe: 1250, moneda: "DOL", ctz: 1050 })),
    // Misma factura que la primera: debe marcarse como duplicada.
    ej("Misma factura que la fila 1, recibida dos veces: duplicado de la planilla.", facturaValle),
    ej("QR con los números como texto. En el sistema está cargada con el CUIT de otro proveedor.",
      qr({ fecha: "2026-10-14", cuit: transportes, ptoVta: "1", tipoCmp: "11", nroCmp: "902", importe: "30875.40" }, true),
    ),
    ej("QR con base64 sin relleno. Falta cargar.",
      sinRelleno(qr({ fecha: "2026-10-15", cuit: ferreteria, ptoVta: 2, tipoCmp: 6, nroCmp: 77, importe: 6120 })),
    ),
    // Casos para revisar.
    ej("CUIT con dígito verificador inválido.", qr({ fecha: "2026-10-16", cuit: conVerificadorRoto(valle), ptoVta: 4, tipoCmp: 11, nroCmp: 12, importe: 15000 })),
    ej("Total en cero.", qr({ fecha: "2026-10-17", cuit: transportes, ptoVta: 1, tipoCmp: 6, nroCmp: 880, importe: 0 })),
    ej("Fecha futura.", qr({ fecha: isoDeFecha(futura), cuit: ferreteria, ptoVta: 2, tipoCmp: 1, nroCmp: 95, importe: 22800 })),
    // Imagen sin QR legible.
    ej("Imagen sin QR legible: se puede completar a mano.", null),
  ];
}

/**
 * Registro de ejemplo (ficticio) de lo "ya cargado en el sistema", como CSV de punto y coma.
 * Coherente con `generarEjemplos`: al cruzarlo con esas facturas da todos los resultados (ya cargada, otro importe,
 * otro emisor, falta cargar, revisar antes de cargar, no se puede conciliar), deja dos registros que nunca se recibieron
 * y trae un comprobante cargado dos veces en el sistema (una factura, con las dos copias iguales).
 * Mezcla a propósito formatos de CUIT, de tipo (código y nombre) y de importe, como haría un sistema real.
 */
export function registroEjemplo(): string {
  const { valle, transportes, ferreteria } = CUIT_FICTICIOS;
  const guiones = (cuit: string): string => `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
  const filas: string[][] = [
    ["CUIT", "Tipo", "Punto de venta", "Número", "Importe"],
    // Ya cargadas (coinciden con la factura de Insumos del Valle y también con su repetida).
    [guiones(valle), "1", "3", "1245", "118.470,50"],
    // Cargada con otro importe: la factura dice 45.200,00 y en el sistema quedó 45.020,00 (dos dígitos cambiados).
    [transportes, "6", "1", "876", "45.020,00"],
    // Cargada con otro emisor: la factura es de Transportes Cuyanos pero se cargó a nombre de Insumos del Valle.
    [guiones(valle), "Factura C", "1", "902", "30875.40"],
    // Cargadas en el sistema que nunca llegaron a la planilla.
    [guiones(valle), "Factura A", "3", "1260", "52.000,00"],
    [guiones(transportes), "6", "1", "870", "18.300,50"],
    // Cargada dos veces en el sistema: la misma factura B figura en dos líneas, con el mismo importe (el sistema no debería permitirlo).
    [guiones(ferreteria), "Factura B", "2", "31", "9.350,25"],
    [guiones(ferreteria), "6", "2", "31", "9350,25"],
  ];
  return filas.map((f) => f.join(";")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- Ejemplo del control del comprobante

/** Una factura del ejemplo del control y el desglose que el sistema de gestión tiene cargado para ella. */
interface CasoControl {
  caso: string;
  emisor: "valle" | "transportes" | "ferreteria";
  tipoCmp: number;
  ptoVta: number;
  nroCmp: number;
  fecha: string;
  importe: number;
  /** `[neto, IVA, otros, vencimiento del CAE como DD/MM/AAAA]`, tal como figura en el CSV del sistema. */
  desglose: readonly [string, string, string, string];
  receptor?: { tipoDoc: number; nro: string };
}

const RECEPTOR_CUIT = (): { tipoDoc: number; nro: string } => ({ tipoDoc: 80, nro: CUIT_RECEPTOR_FICTICIO });

/**
 * Diez facturas más, para que el control del comprobante tenga algo que mostrar. El QR trae el total y el receptor; el neto, el IVA,
 * los otros conceptos y el vencimiento del CAE vienen del registro (`registroEjemploCompleto`). Ningún importe sale de una cuenta:
 * son datos inventados a mano, con la diferencia que cada caso quiere mostrar.
 */
const CASOS_CONTROL: readonly CasoControl[] = [
  {
    caso: "En orden: el neto y el IVA suman el total, el CAE vence después de la emisión y el receptor tiene CUIT válido.",
    emisor: "valle", tipoCmp: 1, ptoVta: 3, nroCmp: 1270, fecha: "2026-10-19", importe: 100000,
    desglose: ["82.644,63", "17.355,37", "0,00", "29/10/2026"], receptor: RECEPTOR_CUIT(),
  },
  {
    caso: "En orden, con otros conceptos: neto, IVA y otros suman el total.",
    emisor: "transportes", tipoCmp: 1, ptoVta: 5, nroCmp: 2101, fecha: "2026-10-20", importe: 61750,
    desglose: ["50.000,00", "10.500,00", "1.250,00", "30/10/2026"], receptor: RECEPTOR_CUIT(),
  },
  {
    caso: "Un centavo de diferencia por redondeo: se perdona, la fila queda sin observaciones.",
    emisor: "ferreteria", tipoCmp: 1, ptoVta: 7, nroCmp: 410, fecha: "2026-10-21", importe: 15000.01,
    desglose: ["12.396,69", "2.603,31", "0,00", "31/10/2026"], receptor: RECEPTOR_CUIT(),
  },
  {
    caso: "El total no cierra: el neto y el IVA suman 24.200,00 y la factura dice 24.200,03.",
    emisor: "valle", tipoCmp: 1, ptoVta: 3, nroCmp: 1275, fecha: "2026-10-22", importe: 24200.03,
    desglose: ["20.000,00", "4.200,00", "0,00", "01/11/2026"], receptor: RECEPTOR_CUIT(),
  },
  {
    caso: "Factura C con IVA discriminado: una C no lo discrimina, así que está mal la letra o el importe.",
    emisor: "transportes", tipoCmp: 11, ptoVta: 2, nroCmp: 330, fecha: "2026-10-22", importe: 21780,
    desglose: ["18.000,00", "3.780,00", "0,00", "01/11/2026"],
  },
  {
    caso: "Factura C en orden: sin IVA discriminado, el neto es el total.",
    emisor: "ferreteria", tipoCmp: 11, ptoVta: 1, nroCmp: 58, fecha: "2026-10-23", importe: 12500,
    desglose: ["12.500,00", "0,00", "0,00", "02/11/2026"],
  },
  {
    caso: "CAE vencido antes de la emisión: la factura es del 24/10/2026 y el CAE vence el 14/10/2026.",
    emisor: "valle", tipoCmp: 1, ptoVta: 3, nroCmp: 1281, fecha: "2026-10-24", importe: 36300,
    desglose: ["30.000,00", "6.300,00", "0,00", "14/10/2026"], receptor: RECEPTOR_CUIT(),
  },
  {
    caso: "CUIT del receptor con dígito verificador inválido (el resto de la factura está en orden).",
    emisor: "transportes", tipoCmp: 1, ptoVta: 5, nroCmp: 2110, fecha: "2026-10-26", importe: 48400,
    desglose: ["40.000,00", "8.400,00", "0,00", "05/11/2026"], receptor: { tipoDoc: 80, nro: conVerificadorRoto(CUIT_RECEPTOR_FICTICIO) },
  },
  {
    caso: "Factura A a un receptor identificado con DNI: conviene revisar la letra o el receptor.",
    emisor: "ferreteria", tipoCmp: 1, ptoVta: 7, nroCmp: 415, fecha: "2026-10-27", importe: 9680,
    desglose: ["8.000,00", "1.680,00", "0,00", "06/11/2026"], receptor: { tipoDoc: 96, nro: "20000001" },
  },
];

function urlDeCaso(c: CasoControl): string {
  return qr({
    fecha: c.fecha,
    cuit: CUIT_FICTICIOS[c.emisor],
    ptoVta: c.ptoVta,
    tipoCmp: c.tipoCmp,
    nroCmp: c.nroCmp,
    importe: c.importe,
    ...(c.receptor === undefined ? {} : { tipoDocRec: c.receptor.tipoDoc, nroDocRec: Number(c.receptor.nro) }),
  });
}

/**
 * Las diez facturas del ejemplo del control, numeradas a continuación de `generarEjemplos` (`ejemplo-12.png` en adelante). La última
 * es la primera recibida dos veces. Independiente del resto: da lo mismo en cualquier orden de llamada.
 */
export function generarEjemplosControl(hoy: Date = new Date()): Ejemplo[] {
  const primero = generarEjemplos(hoy).length + 1;
  semillaCae = 100;
  const urls = CASOS_CONTROL.map(urlDeCaso);
  const casos = CASOS_CONTROL.map((c, i) => ({ caso: c.caso, url: urls[i] as string }));
  const repetida = { caso: "Misma factura que la fila 12, recibida dos veces: duplicado de la planilla.", url: urls[0] as string };
  return [...casos, repetida].map((e, i) => ({ origen: `ejemplo-${String(primero + i).padStart(2, "0")}.png`, ...e }));
}

/** Las facturas del ejemplo base y las del control, juntas: lo que cargan los botones de ejemplo de la página. */
export function generarEjemplosCompletos(hoy: Date = new Date()): Ejemplo[] {
  return [...generarEjemplos(hoy), ...generarEjemplosControl(hoy)];
}

/**
 * El registro de ejemplo con las columnas opcionales del desglose (Neto, IVA, Otros, Vencimiento CAE). Las líneas del ejemplo base van
 * con esas celdas vacías, como un sistema que no siempre las completa; las nueve del control las traen completas. El de cinco columnas
 * (`registroEjemplo`) sigue existiendo: un registro sin desglose se lee igual que siempre.
 */
export function registroEjemploCompleto(): string {
  const guiones = (cuit: string): string => `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
  const [encabezado = "", ...baseLineas] = registroEjemplo().trimEnd().split("\r\n");
  const nuevas = CASOS_CONTROL.map((c) =>
    [guiones(CUIT_FICTICIOS[c.emisor]), String(c.tipoCmp), String(c.ptoVta), String(c.nroCmp), formatearImporte(c.importe), ...c.desglose].join(";"),
  );
  return [`${encabezado};Neto;IVA;Otros;Vencimiento CAE`, ...baseLineas.map((l) => `${l};;;;`), ...nuevas].join("\r\n") + "\r\n";
}
