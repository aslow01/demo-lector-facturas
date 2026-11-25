// Maqueta de la factura de ejemplo: una página A4 sencilla, a propósito distinta de cualquier comprobante oficial
// (sin logos, sin recuadro de letra con código, sin encabezados de organismos). Solo usa Helvetica estándar y figuras vectoriales.

import { formatearFecha, formatearImporte } from "../../src/comprobante.ts";
import { formatearCuit } from "../../src/cuit.ts";
import { LEYENDA_FICTICIA, totalesDe, urlQrDe, type FacturaEjemplo } from "./datos.ts";
import { Pagina, armarPdf, rectasDeMatriz } from "./pdf-minimo.ts";
import { crearQr } from "./qr-minimo.ts";

const MARGEN = 45;
const ANCHO_UTIL = 505;
const DERECHA = MARGEN + ANCHO_UTIL;
const MODULO_QR = 2.5; // 5 px por módulo al mostrarlo al doble: sin bordes borrosos
const ZONA_SILENCIO = 4; // módulos en blanco alrededor del QR

/** Ancho de un texto formado solo por dígitos, punto, coma, espacio, guion y «$» en Helvetica (todos los dígitos miden lo mismo). */
function anchoNumerico(texto: string, tamano: number): number {
  const milesimas = [...texto].reduce((suma, c) => suma + (/\d|\$/.test(c) ? 556 : c === "-" ? 333 : 278), 0);
  return (milesimas * tamano) / 1000;
}

function numeroDerecha(p: Pagina, xDerecha: number, y: number, texto: string, tamano: number, negrita = false): void {
  p.texto(xDerecha - anchoNumerico(texto, tamano), y, texto, { tamano, negrita });
}

function relleno(n: number, largo: number): string {
  return String(n).padStart(largo, "0");
}

/** Parte un texto en líneas de hasta `maximo` caracteres, cortando en espacios. */
function envolver(texto: string, maximo: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(" ")) {
    if (actual !== "" && actual.length + 1 + palabra.length > maximo) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = actual === "" ? palabra : `${actual} ${palabra}`;
    }
  }
  if (actual !== "") lineas.push(actual);
  return lineas;
}

export function dibujarFactura(f: FacturaEjemplo): Pagina {
  const p = new Pagina();
  const t = totalesDe(f);
  const enDolares = f.moneda === "DOL";

  // Leyenda arriba, bien visible.
  p.rectangulo(MARGEN, 790, ANCHO_UTIL, 30, { relleno: 0.88, borde: 1 });
  p.texto(MARGEN + 10, 800, LEYENDA_FICTICIA, { tamano: 12, negrita: true });

  // Emisor (izquierda) y datos del comprobante (derecha).
  p.texto(MARGEN, 752, f.emisor.nombre, { tamano: 16, negrita: true });
  p.texto(MARGEN, 735, `CUIT ${formatearCuit(f.emisor.cuit)} (CUIT de ejemplo, ficticio)`, { tamano: 9.5 });
  p.texto(MARGEN, 721, f.emisor.domicilio, { tamano: 9.5 });
  p.texto(MARGEN, 707, "Condición frente al IVA: responsable inscripto (ejemplo)", { tamano: 9.5 });

  p.texto(340, 752, `Factura ${f.tipo.letra} (ejemplo)`, { tamano: 14, negrita: true });
  p.texto(340, 735, `Punto de venta: ${relleno(f.ptoVta, 4)}`, { tamano: 9.5 });
  p.texto(340, 721, `Comprobante N.º: ${relleno(f.numero, 8)}`, { tamano: 9.5 });
  p.texto(340, 707, `Fecha de emisión: ${formatearFecha(f.fecha)}`, { tamano: 9.5 });
  p.linea(MARGEN, 694, DERECHA, 694);

  // Cliente y moneda.
  p.texto(MARGEN, 677, "Cliente", { tamano: 10, negrita: true });
  p.texto(MARGEN, 663, f.receptor.nombre, { tamano: 9.5 });
  p.texto(MARGEN, 649, `CUIT ${formatearCuit(f.receptor.cuit)} (CUIT de ejemplo, ficticio)`, { tamano: 9.5 });
  p.texto(340, 677, "Moneda", { tamano: 10, negrita: true });
  p.texto(340, 663, enDolares ? "Dólares estadounidenses" : "Pesos argentinos", { tamano: 9.5 });
  if (enDolares) p.texto(340, 649, `Cotización: $ ${formatearImporte(f.cotizacion)}`, { tamano: 9.5 });

  // Detalle.
  const xCantidad = 330;
  const xUnitario = 435;
  p.rectangulo(MARGEN, 600, ANCHO_UTIL, 20, { relleno: 0.9 });
  p.texto(MARGEN + 5, 606, "Descripción", { tamano: 9.5, negrita: true });
  p.texto(xCantidad - 28, 606, "Cant.", { tamano: 9.5, negrita: true });
  p.texto(xUnitario - 62, 606, f.tipo.letra === "A" ? "Precio unitario" : "Precio unit. (con IVA)", { tamano: 9.5, negrita: true });
  p.texto(DERECHA - 42, 606, "Subtotal", { tamano: 9.5, negrita: true });
  let y = 583;
  for (const item of f.items) {
    p.texto(MARGEN + 5, y, item.descripcion, { tamano: 10 });
    numeroDerecha(p, xCantidad, y, String(item.cantidad), 10);
    numeroDerecha(p, xUnitario, y, formatearImporte(item.precioCentavos / 100), 10);
    numeroDerecha(p, DERECHA - 5, y, formatearImporte((item.cantidad * item.precioCentavos) / 100), 10);
    y -= 20;
  }
  p.linea(MARGEN, y + 10, DERECHA, y + 10);

  // Totales.
  const moneda = enDolares ? "en dólares" : "en pesos";
  y -= 14;
  const lineasTotales: Array<[string, number, boolean]> =
    f.tipo.letra === "A"
      ? [["Importe neto gravado", t.neto, false], ["IVA 21 %", t.iva, false], [`TOTAL ${moneda}`, t.total, true]]
      : [["IVA contenido (21 %)", t.iva, false], [`TOTAL ${moneda}`, t.total, true]];
  for (const [rotulo, importe, fuerte] of lineasTotales) {
    p.texto(340, y, rotulo, { tamano: fuerte ? 11 : 10, negrita: fuerte });
    numeroDerecha(p, DERECHA - 5, y, formatearImporte(importe), fuerte ? 11 : 10, fuerte);
    y -= 18;
  }

  // QR con el formato de ARCA (datos ficticios), a la izquierda; a su lado, el CAE ficticio.
  const qr = crearQr(urlQrDe(f), "M");
  const ladoQr = qr.tamano * MODULO_QR;
  const ladoCaja = ladoQr + ZONA_SILENCIO * 2 * MODULO_QR;
  const baseCaja = 150;
  p.rectangulo(MARGEN, baseCaja, ladoCaja, ladoCaja, { relleno: 1, borde: 0.5 });
  p.cuadrados(rectasDeMatriz(qr.modulos), MARGEN + ZONA_SILENCIO * MODULO_QR, baseCaja + ZONA_SILENCIO * MODULO_QR, MODULO_QR, qr.tamano);
  p.texto(MARGEN, baseCaja - 14, "Código QR con datos ficticios", { tamano: 8.5 });

  const xTexto = MARGEN + ladoCaja + 25;
  let yTexto = baseCaja + ladoCaja - 12;
  p.texto(xTexto, yTexto, `CAE (ficticio): ${f.cae}`, { tamano: 10, negrita: true });
  yTexto -= 16;
  p.texto(xTexto, yTexto, `Vencimiento del CAE: ${formatearFecha(f.vencimientoCae)}`, { tamano: 10 });
  yTexto -= 26;
  const aviso = "Este comprobante no existe en ningún registro oficial. El QR, el CAE, los CUIT, los importes y las empresas fueron inventados para probar la demo de lectura de facturas.";
  for (const linea of envolver(aviso, 52)) {
    p.texto(xTexto, yTexto, linea, { tamano: 9 });
    yTexto -= 12;
  }

  // Pie.
  p.linea(MARGEN, 78, DERECHA, 78);
  p.texto(MARGEN, 62, "Generado con scripts/generar-pdfs.ts (código abierto, sin bibliotecas). No es un comprobante real.", { tamano: 8.5, gris: 0.3 });
  p.texto(MARGEN, 46, LEYENDA_FICTICIA, { tamano: 10, negrita: true });
  return p;
}

export function pdfDeFactura(f: FacturaEjemplo): Uint8Array {
  return armarPdf(dibujarFactura(f), {
    titulo: `Factura ${f.tipo.letra} de ejemplo ${relleno(f.ptoVta, 4)}-${relleno(f.numero, 8)} (ficticia)`,
  });
}
