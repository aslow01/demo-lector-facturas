// Extracto de pagos de ejemplo, 100 % ficticio, coherente con las facturas de `ejemplos.ts` (las 21 filas del ejemplo completo).
// Las empresas, los CUIT, los importes, los números de operación y los usuarios son inventados. No hay ningún banco real detrás.
// Cada pago está sembrado para mostrar un resultado distinto del conciliador de pagos (ver `cuentas-a-pagar.ts`).

import { formatearImporte } from "./comprobante.ts";
import { CUIT_FICTICIOS, cuitFicticio } from "./ejemplos.ts";

/** Proveedor inventado al que se le paga sin que haya ninguna factura suya en la planilla. */
export const CUIT_SIN_FACTURAS_FICTICIO = cuitFicticio("30", 99000401);

/** Quienes cargan y autorizan los pagos del ejemplo. Nombres de usuario de mentira, sin personas detrás. */
export const USUARIOS_FICTICIOS = ["ana.demo", "bruno.demo", "carla.demo"] as const;

const ENCABEZADO = ["Fecha", "Importe", "CUIT", "Referencia", "Concepto", "Cargó", "Autorizó", "Operación"];

const guiones = (cuit: string): string => `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;

interface PagoDeEjemplo {
  fecha: string;
  importe: number;
  cuit: string;
  referencia: string;
  concepto: string;
  cargo: string;
  autorizo: string;
  operacion: string;
}

const { valle, transportes, ferreteria } = CUIT_FICTICIOS;
const [ANA, BRUNO, CARLA] = USUARIOS_FICTICIOS;

/** Línea 2 en adelante del archivo, en este orden. */
const PAGOS: readonly PagoDeEjemplo[] = [
  // Línea 2: la primera cuota de una factura de 61.750,00 (ejemplo-13). Un pago parcial con referencia.
  { fecha: "28/10/2026", importe: 30000, cuit: guiones(transportes), referencia: "0005-00002101 cuota 1", concepto: "Factura", cargo: ANA, autorizo: BRUNO, operacion: "10000001" },
  // Línea 3: referencia, CUIT e importe exactos (ejemplo-01).
  { fecha: "30/10/2026", importe: 118470.5, cuit: guiones(valle), referencia: "FA 0003-00001245", concepto: "Factura", cargo: ANA, autorizo: BRUNO, operacion: "10000002" },
  // Línea 4: sin referencia ("Varios"): se empareja por CUIT e importe (ejemplo-02). Lo cargó y lo autorizó la misma persona.
  { fecha: "31/10/2026", importe: 45200, cuit: transportes, referencia: "", concepto: "Varios", cargo: CARLA, autorizo: CARLA, operacion: "10000003" },
  // Línea 5: la referencia tiene un dígito cambiado (dice 70 y la factura es la 77): se avisa y se empareja por CUIT e importe (ejemplo-07).
  { fecha: "02/11/2026", importe: 6120, cuit: guiones(ferreteria), referencia: "0002-00000070", concepto: "Factura", cargo: BRUNO, autorizo: ANA, operacion: "10000004" },
  // Línea 6: una referencia que nombra dos facturas y un importe que es la suma de las dos (ejemplo-12 y ejemplo-15).
  { fecha: "03/11/2026", importe: 124200.03, cuit: guiones(valle), referencia: "0003-00001270 y 0003-00001275", concepto: "Facturas", cargo: ANA, autorizo: CARLA, operacion: "10000005" },
  // Línea 7: sin referencia, pero una sola combinación de dos facturas del proveedor suma el importe (ejemplo-14 y ejemplo-17).
  { fecha: "04/11/2026", importe: 27500.01, cuit: ferreteria, referencia: "", concepto: "Varios", cargo: BRUNO, autorizo: CARLA, operacion: "10000006" },
  // Línea 8: la segunda cuota de la misma factura (ejemplo-13): 30.000 + 10.000 de 61.750 la deja en pago parcial, con 21.750 por pagar.
  { fecha: "06/11/2026", importe: 10000, cuit: guiones(transportes), referencia: "0005-00002101 cuota 2", concepto: "Factura", cargo: ANA, autorizo: BRUNO, operacion: "10000007" },
  // Línea 9: un importe que no coincide con ninguna factura abierta del proveedor ni con una suma: no se sabe a cuál va.
  { fecha: "09/11/2026", importe: 25000, cuit: transportes, referencia: "", concepto: "Varios", cargo: ANA, autorizo: BRUNO, operacion: "10000008" },
  // Línea 10: un proveedor al que no se le debe nada en la planilla: pago sin factura.
  { fecha: "10/11/2026", importe: 18000, cuit: guiones(CUIT_SIN_FACTURAS_FICTICIO), referencia: "", concepto: "Honorarios mensuales", cargo: CARLA, autorizo: BRUNO, operacion: "10000009" },
  // Línea 11: el pago de la línea 3 otra vez (el mismo número de operación, como si viniera de un segundo archivo): duplicado.
  { fecha: "30/10/2026", importe: 118470.5, cuit: guiones(valle), referencia: "FA 0003-00001245", concepto: "Factura", cargo: ANA, autorizo: BRUNO, operacion: "10000002" },
];

/**
 * El CSV del extracto de ejemplo, como lo exportaría un banco ficticio: punto y coma, importes con coma decimal, fechas DD/MM/AAAA.
 * Diez pagos para las facturas de `generarEjemplosCompletos`: al cruzarlos dan los cuatro resultados de un pago (emparejado, sin factura,
 * duplicado y para revisar) y las tres situaciones de una factura (pagada, parcial e impaga, con una antigua).
 */
export function extractoEjemplo(): string {
  const filas = PAGOS.map((p) => [p.fecha, formatearImporte(p.importe), p.cuit, p.referencia, p.concepto, p.cargo, p.autorizo, p.operacion]);
  return [ENCABEZADO, ...filas].map((f) => f.join(";")).join("\r\n") + "\r\n";
}
