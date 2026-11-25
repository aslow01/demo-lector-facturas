// Escritor de PDF mínimo, a mano, sin dependencias: una página A4 con texto (Helvetica estándar), rectángulos, líneas y el QR
// dibujado como figuras vectoriales. Es lo justo para las facturas de ejemplo; no es una biblioteca general.
// El resultado es determinístico (sin fechas ni identificadores al azar): el mismo contenido da siempre los mismos bytes.

export const ANCHO_A4 = 595;
export const ALTO_A4 = 842;

interface OpcionesTexto {
  tamano: number;
  negrita?: boolean;
  /** 0 = negro, 1 = blanco. */
  gris?: number;
}

interface OpcionesRectangulo {
  /** Gris de relleno (0 negro, 1 blanco). Sin valor, no se rellena. */
  relleno?: number;
  /** Grosor del borde; sin valor, no se dibuja borde. */
  borde?: number;
}

const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Un carácter como byte de la codificación WinAnsi; lo que no existe en ella queda como `?`. */
function byteWinAnsi(caracter: string): number {
  const codigo = caracter.codePointAt(0) ?? 0x3f;
  if (codigo < 0x80 || (codigo >= 0xa0 && codigo <= 0xff)) return codigo;
  return WIN_ANSI_EXTRA[codigo] ?? 0x3f;
}

/** Cadena literal de PDF: los bytes WinAnsi como caracteres latin1, con `(`, `)` y `\` escapados y sin saltos de línea crudos. */
function cadenaPdf(texto: string): string {
  let salida = "(";
  for (const c of texto) {
    const b = byteWinAnsi(c);
    if (b === 0x28 || b === 0x29 || b === 0x5c) salida += "\\" + String.fromCharCode(b);
    else if (b < 0x20) salida += " ";
    else salida += String.fromCharCode(b);
  }
  return salida + ")";
}

const numero = (n: number): string => String(Math.round(n * 1000) / 1000);

/** El contenido de una página A4. Las coordenadas van en puntos, con el origen abajo a la izquierda. */
export class Pagina {
  private readonly operaciones: string[] = [];

  texto(x: number, y: number, contenido: string, o: OpcionesTexto): this {
    const gris = o.gris ?? 0;
    this.operaciones.push(
      `BT /${o.negrita ? "F2" : "F1"} ${numero(o.tamano)} Tf ${numero(gris)} g ${numero(x)} ${numero(y)} Td ${cadenaPdf(contenido)} Tj ET`,
    );
    return this;
  }

  rectangulo(x: number, y: number, ancho: number, alto: number, o: OpcionesRectangulo): this {
    const partes = ["q"];
    if (o.relleno !== undefined) partes.push(`${numero(o.relleno)} g`);
    if (o.borde !== undefined) partes.push(`0 G ${numero(o.borde)} w`);
    partes.push(`${numero(x)} ${numero(y)} ${numero(ancho)} ${numero(alto)} re`);
    partes.push(o.relleno !== undefined && o.borde !== undefined ? "B" : o.relleno !== undefined ? "f" : "S", "Q");
    this.operaciones.push(partes.join(" "));
    return this;
  }

  linea(x1: number, y1: number, x2: number, y2: number, grosor = 0.5): this {
    this.operaciones.push(`q 0 G ${numero(grosor)} w ${numero(x1)} ${numero(y1)} m ${numero(x2)} ${numero(y2)} l S Q`);
    return this;
  }

  /**
   * Dibuja cuadrados negros. Cada recta es `[columna, fila, ancho, alto]` en módulos, con la fila 0 arriba. `x` e `y` son la
   * esquina inferior izquierda de la cuadrícula, que tiene `filas` filas de `modulo` puntos. Todo va en un solo trazado
   * para que no queden costuras entre los vecinos.
   */
  cuadrados(rectas: ReadonlyArray<readonly [number, number, number, number]>, x: number, y: number, modulo: number, filas = 0): this {
    const partes = ["q 0 g"];
    for (const [c, f, an, al] of rectas) {
      partes.push(`${numero(x + c * modulo)} ${numero(y + (filas - f - al) * modulo)} ${numero(an * modulo)} ${numero(al * modulo)} re`);
    }
    partes.push("f Q");
    this.operaciones.push(partes.join("\n"));
    return this;
  }

  contenido(): string {
    return this.operaciones.join("\n");
  }
}

/** Agrupa los módulos oscuros de una matriz en rectas horizontales (una por racha) para `Pagina.cuadrados`. */
export function rectasDeMatriz(modulos: readonly (readonly boolean[])[]): Array<[number, number, number, number]> {
  const rectas: Array<[number, number, number, number]> = [];
  modulos.forEach((fila, f) => {
    let inicio = -1;
    for (let c = 0; c <= fila.length; c++) {
      const oscuro = c < fila.length && fila[c] === true;
      if (oscuro && inicio < 0) inicio = c;
      if (!oscuro && inicio >= 0) {
        rectas.push([inicio, f, c - inicio, 1]);
        inicio = -1;
      }
    }
  });
  return rectas;
}

/** Arma el archivo PDF completo (1.4) con una sola página. */
export function armarPdf(pagina: Pagina, meta: { titulo: string }): Uint8Array {
  const flujo = pagina.contenido();
  const objetos: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO_A4} ${ALTO_A4}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`,
    `<< /Title ${cadenaPdf(meta.titulo)} /Producer (scripts/generar-pdfs.ts, sin bibliotecas) >>`,
  ];

  let archivo = "%PDF-1.4\n%âãÏÓ\n";
  const desplazamientos: number[] = [];
  objetos.forEach((cuerpo, i) => {
    desplazamientos.push(archivo.length);
    archivo += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
  });
  const inicioXref = archivo.length;
  archivo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const d of desplazamientos) archivo += `${String(d).padStart(10, "0")} 00000 n \n`;
  archivo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;

  // Cada carácter del texto armado vale un byte (latin1): así los desplazamientos de arriba son los del archivo real.
  return Uint8Array.from(archivo, (c) => c.charCodeAt(0) & 0xff);
}
