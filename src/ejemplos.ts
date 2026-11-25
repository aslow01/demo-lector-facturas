// Facturas de ejemplo 100 % ficticias. Las empresas, los CUIT, los importes y los CAE son inventados.
// Se cargan como direcciones de QR (no hay imágenes): el flujo de ejemplo no depende de archivos.

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
function cuitFicticio(prefijo: string, desde: number): string {
  for (let base = desde; base < desde + 50; base++) {
    const cuit = armarCuit(prefijo, String(base));
    if (cuit !== null) return cuit;
  }
  throw new Error("No se pudo generar un CUIT ficticio.");
}

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
