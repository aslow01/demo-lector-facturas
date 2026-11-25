// Chequeos previos a decodificar una imagen: una imagen de pocos KB puede declarar 14.000 × 14.000 píxeles (casi 800 MB ya
// decodificada) y congelar la pestaña. Se leen las medidas del encabezado, sin decodificar, y se rechaza o se calcula a qué
// tamaño pedirle al navegador que la decodifique. Funciones puras, sin acceso al navegador.

/** Tope de píxeles de una imagen (ancho × alto): 50 megapíxeles. Una foto de celular de 48 MP todavía entra. */
export const PIXELES_MAXIMOS = 50_000_000;
/** Lado mayor con el que se busca el QR: más grande no mejora la lectura y cuesta mucho más. */
export const LADO_MAXIMO_PX = 3000;
/** Cuántos bytes del inicio del archivo alcanzan para encontrar las medidas (el JPEG puede traer varios segmentos antes). */
export const BYTES_DE_ENCABEZADO = 512 * 1024;

export interface Dimensiones {
  ancho: number;
  alto: number;
}

function be16(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
}
function be32(b: Uint8Array, i: number): number {
  return (be16(b, i) * 65536 + be16(b, i + 2)) >>> 0;
}
function le16(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}
function le24(b: Uint8Array, i: number): number {
  return le16(b, i) | ((b[i + 2] ?? 0) << 16);
}
function le32(b: Uint8Array, i: number): number {
  return (le16(b, i) | (le16(b, i + 2) << 16)) >>> 0;
}
function ascii(b: Uint8Array, desde: number, largo: number): string {
  let t = "";
  for (let i = desde; i < desde + largo; i++) t += String.fromCharCode(b[i] ?? 0);
  return t;
}

function medidas(ancho: number, alto: number): Dimensiones | null {
  return ancho > 0 && alto > 0 ? { ancho, alto } : null;
}

function dimensionesJpeg(b: Uint8Array): Dimensiones | null {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marcador = b[i + 1] ?? 0;
    if (marcador === 0xff) {
      i++; // relleno
      continue;
    }
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      i += 2; // marcadores sin contenido
      continue;
    }
    if (marcador === 0xd9 || marcador === 0xda) return null; // fin o inicio de los datos sin haber visto el cuadro
    const largo = be16(b, i + 2);
    const esCuadro = marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
    if (esCuadro) return i + 8 < b.length ? medidas(be16(b, i + 7), be16(b, i + 5)) : null;
    if (largo < 2) return null;
    i += 2 + largo;
  }
  return null;
}

function dimensionesWebp(b: Uint8Array): Dimensiones | null {
  const tipo = ascii(b, 12, 4);
  if (tipo === "VP8 ") {
    return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a ? medidas(le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff) : null;
  }
  if (tipo === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = [b[21], b[22], b[23], b[24]];
    const ancho = 1 + (b0 | ((b1 & 0x3f) << 8));
    const alto = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
    return b.length > 24 ? medidas(ancho, alto) : null;
  }
  if (tipo === "VP8X") return b.length > 29 ? medidas(le24(b, 24) + 1, le24(b, 27) + 1) : null;
  return null;
}

/**
 * Ancho y alto declarados en el encabezado de una imagen PNG, JPEG, GIF, BMP o WebP, sin decodificarla.
 * `null` si el formato no se reconoce, el encabezado está cortado o las medidas son cero.
 */
export function dimensionesDeImagen(b: Uint8Array): Dimensiones | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") return medidas(be32(b, 16), be32(b, 20));
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return dimensionesJpeg(b);
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return medidas(le16(b, 6), le16(b, 8));
  if (b.length >= 26 && ascii(b, 0, 2) === "BM") return medidas(le32(b, 18), Math.abs(le32(b, 22) | 0));
  if (b.length >= 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return dimensionesWebp(b);
  return null;
}

/** Tamaño al que se pide la imagen decodificada: el mismo si entra, o reducido sin deformar para que su lado mayor sea `ladoMaximo`. */
export function dimensionesDeDestino(ancho: number, alto: number, ladoMaximo: number = LADO_MAXIMO_PX): Dimensiones {
  const escala = Math.min(1, ladoMaximo / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

export type EvaluacionImagen = { tipo: "ok"; ancho: number; alto: number; destino: Dimensiones } | { tipo: "error"; mensaje: string };

/** Decide, con el inicio del archivo, si la imagen se puede decodificar y a qué tamaño. El mensaje es para el usuario. */
export function evaluarImagen(inicio: Uint8Array): EvaluacionImagen {
  const d = dimensionesDeImagen(inicio);
  if (d === null) {
    return { tipo: "error", mensaje: "No se pudo leer el tamaño de la imagen. Use una imagen PNG, JPG, WebP, GIF o BMP." };
  }
  if (d.ancho * d.alto > PIXELES_MAXIMOS) {
    const maximo = PIXELES_MAXIMOS / 1_000_000;
    return { tipo: "error", mensaje: `La imagen es demasiado grande: ${d.ancho} × ${d.alto} píxeles (el máximo es ${maximo} megapíxeles). Redúzcala e inténtelo de nuevo.` };
  }
  return { tipo: "ok", ancho: d.ancho, alto: d.alto, destino: dimensionesDeDestino(d.ancho, d.alto) };
}

/** Motivo por el que un archivo no se procesa según su peso (`null` si pasa). Un archivo de 0 bytes está vacío. */
export function motivoDeRechazoPorTamano(bytes: number, maximo: number): string | null {
  if (bytes === 0) return "El archivo está vacío.";
  if (bytes > maximo) return `El archivo supera los ${Math.round(maximo / (1024 * 1024))} MB.`;
  return null;
}
