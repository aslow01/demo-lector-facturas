// Datos de las facturas de ejemplo en PDF. Todo es ficticio: empresas, CUIT (de la serie inventada 30-990…), domicilios, importes y CAE.
// Los comprobantes coinciden con filas de `generarEjemplos` y de `registroEjemplo` (src/ejemplos.ts): al cargar estos PDF junto con el
// registro de ejemplo se ve la conciliación (ya cargada / falta cargar).

import { armarCuit } from "../../src/cuit.ts";
import { CUIT_FICTICIOS } from "../../src/ejemplos.ts";
import { armarUrlQr } from "../../src/qr-arca.ts";

export const LEYENDA_FICTICIA = "EJEMPLO — COMPROBANTE FICTICIO, SIN VALIDEZ FISCAL";

export interface ItemEjemplo {
  descripcion: string;
  cantidad: number;
  /** Precio unitario en centavos (en la Factura B ya incluye el IVA). */
  precioCentavos: number;
}

export interface FacturaEjemplo {
  /** Nombre del archivo en `public/ejemplos/`. */
  archivo: string;
  emisor: { nombre: string; cuit: string; domicilio: string };
  receptor: { nombre: string; cuit: string };
  tipo: { codigo: number; letra: "A" | "B" };
  ptoVta: number;
  numero: number;
  /** AAAA-MM-DD */
  fecha: string;
  moneda: "PES" | "DOL";
  cotizacion: number;
  items: ItemEjemplo[];
  /** CAE inventado, 14 dígitos. */
  cae: string;
  /** AAAA-MM-DD */
  vencimientoCae: string;
}

/** Primer CUIT válido de la serie inventada que empieza en `desde` (ocho dígitos de base). */
function cuitFicticio(prefijo: string, desde: number): string {
  for (let base = desde; base < desde + 50; base++) {
    const cuit = armarCuit(prefijo, String(base));
    if (cuit !== null) return cuit;
  }
  throw new Error("No se pudo generar un CUIT ficticio.");
}

const RECEPTOR = { nombre: "Comprador de Ejemplo S.R.L.", cuit: cuitFicticio("30", 99000301) };

export const FACTURAS: readonly FacturaEjemplo[] = [
  {
    archivo: "factura-ejemplo-a-1245.pdf",
    emisor: { nombre: "Insumos del Valle Demo S.A.", cuit: CUIT_FICTICIOS.valle, domicilio: "Calle Inventada 100, Ciudad de Ejemplo" },
    receptor: RECEPTOR,
    tipo: { codigo: 1, letra: "A" },
    ptoVta: 3,
    numero: 1245,
    fecha: "2026-10-05",
    moneda: "PES",
    cotizacion: 1,
    items: [
      { descripcion: "Papel de embalar, rollo de 50 m", cantidad: 40, precioCentavos: 125000 },
      { descripcion: "Cinta de embalar transparente", cantidad: 100, precioCentavos: 24950 },
      { descripcion: "Bolsas de residuos, paquete de 10", cantidad: 50, precioCentavos: 45919 },
    ],
    cae: "70990000124501",
    vencimientoCae: "2026-10-15",
  },
  {
    archivo: "factura-ejemplo-b-77.pdf",
    emisor: { nombre: "Ferretería Andina Demo S.A.", cuit: CUIT_FICTICIOS.ferreteria, domicilio: "Avenida Falsa 2500, Ciudad de Ejemplo" },
    receptor: RECEPTOR,
    tipo: { codigo: 6, letra: "B" },
    ptoVta: 2,
    numero: 77,
    fecha: "2026-10-15",
    moneda: "PES",
    cotizacion: 1,
    items: [
      { descripcion: "Candado de bronce, 40 mm", cantidad: 3, precioCentavos: 120000 },
      { descripcion: "Juego de destornilladores, 6 piezas", cantidad: 2, precioCentavos: 126000 },
    ],
    cae: "70990000007702",
    vencimientoCae: "2026-10-25",
  },
  {
    archivo: "factura-ejemplo-a-usd-1251.pdf",
    emisor: { nombre: "Insumos del Valle Demo S.A.", cuit: CUIT_FICTICIOS.valle, domicilio: "Calle Inventada 100, Ciudad de Ejemplo" },
    receptor: RECEPTOR,
    tipo: { codigo: 1, letra: "A" },
    ptoVta: 3,
    numero: 1251,
    fecha: "2026-10-12",
    moneda: "DOL",
    cotizacion: 1050,
    items: [{ descripcion: "Lote de cartón corrugado (muestra de exportación)", cantidad: 2, precioCentavos: 51653 }],
    cae: "70990000125103",
    vencimientoCae: "2026-10-22",
  },
];

/** Redondeo al centavo, hacia arriba en la mitad, con enteros (sin errores de coma flotante). */
function dividirRedondeando(numerador: number, denominador: number): number {
  return Math.floor((numerador * 2 + denominador) / (denominador * 2));
}

/** Importes en la moneda de la factura. En la A el IVA (21 %) se suma al neto; en la B el precio ya lo incluye y se informa el contenido. */
export function totalesDe(f: FacturaEjemplo): { neto: number; iva: number; total: number } {
  const suma = f.items.reduce((s, i) => s + i.cantidad * i.precioCentavos, 0);
  if (f.tipo.letra === "A") {
    const iva = dividirRedondeando(suma * 21, 100);
    return { neto: suma / 100, iva: iva / 100, total: (suma + iva) / 100 };
  }
  const ivaContenido = dividirRedondeando(suma * 21, 121);
  return { neto: (suma - ivaContenido) / 100, iva: ivaContenido / 100, total: suma / 100 };
}

/** La dirección del QR, con el formato público de ARCA: `https://www.afip.gob.ar/fe/qr/?p=` + base64 de un JSON. */
export function urlQrDe(f: FacturaEjemplo): string {
  return armarUrlQr({
    ver: 1,
    fecha: f.fecha,
    cuit: Number(f.emisor.cuit),
    ptoVta: f.ptoVta,
    tipoCmp: f.tipo.codigo,
    nroCmp: f.numero,
    importe: totalesDe(f).total,
    moneda: f.moneda,
    ctz: f.cotizacion,
    tipoDocRec: 80,
    nroDocRec: Number(f.receptor.cuit),
    tipoCodAut: "E",
    codAut: Number(f.cae),
  });
}
