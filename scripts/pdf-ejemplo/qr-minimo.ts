// Generador de código QR mínimo (modo byte, niveles de corrección L y M, versiones 1 a 40), sin dependencias.
// Sirve solo para dibujar el QR de las facturas de ejemplo en PDF; la demo no lo usa en el navegador.
// Se escribió siguiendo ISO/IEC 18004 (las mismas tablas y fórmulas que publica cualquier implementación de referencia) y se
// comprueba en `tests/qr-minimo.test.ts` contra jsQR, un decodificador real: si algo estuviera mal, esos tests no lo leen.

export type NivelQr = "L" | "M";

export interface MatrizQr {
  version: number;
  /** Lado en módulos (17 + 4 × versión). */
  tamano: number;
  /** `modulos[fila][columna]`: `true` es un módulo oscuro. Sin zona de silencio. */
  modulos: boolean[][];
}

// Índice = versión (la posición 0 no se usa).
const ECC_POR_BLOQUE: Record<NivelQr, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
};
const BLOQUES: Record<NivelQr, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
};
const BITS_FORMATO: Record<NivelQr, number> = { L: 1, M: 0 };

const en = (tabla: number[], indice: number): number => tabla[indice] ?? 0;

function bit(valor: number, posicion: number): boolean {
  return ((valor >>> posicion) & 1) !== 0;
}

/** Cantidad de módulos que llevan datos o corrección (todo menos patrones fijos, temporización y bloques de formato/versión). */
function modulosDeDatos(version: number): number {
  let r = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (version >= 7) r -= 36;
  }
  return r;
}

function palabrasDeDatos(version: number, nivel: NivelQr): number {
  return Math.floor(modulosDeDatos(version) / 8) - en(ECC_POR_BLOQUE[nivel], version) * en(BLOQUES[nivel], version);
}

// ---------------------------------------------------------------- Reed-Solomon sobre GF(256), polinomio 0x11D

function multiplicarGf(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisorRs(grado: number): number[] {
  const resultado = new Array<number>(grado).fill(0);
  resultado[grado - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < grado; j++) {
      resultado[j] = multiplicarGf(resultado[j] ?? 0, raiz);
      if (j + 1 < grado) resultado[j] = (resultado[j] ?? 0) ^ (resultado[j + 1] ?? 0);
    }
    raiz = multiplicarGf(raiz, 0x02);
  }
  return resultado;
}

function restoRs(datos: number[], divisor: number[]): number[] {
  const resultado = new Array<number>(divisor.length).fill(0);
  for (const b of datos) {
    const factor = b ^ (resultado.shift() ?? 0);
    resultado.push(0);
    divisor.forEach((coef, i) => {
      resultado[i] = (resultado[i] ?? 0) ^ multiplicarGf(coef, factor);
    });
  }
  return resultado;
}

// ---------------------------------------------------------------- Datos

function bytesUtf8(texto: string): number[] {
  return Array.from(new TextEncoder().encode(texto));
}

/** Modo byte, terminador y relleno 0xEC / 0x11, hasta completar las palabras de datos de la versión. */
function armarDatos(bytes: number[], version: number, nivel: NivelQr): number[] {
  const bits: number[] = [];
  const poner = (valor: number, cantidad: number): void => {
    for (let i = cantidad - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  poner(0b0100, 4);
  poner(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) poner(b, 8);
  const capacidadBits = palabrasDeDatos(version, nivel) * 8;
  poner(0, Math.min(4, capacidadBits - bits.length));
  poner(0, (8 - (bits.length % 8)) % 8);
  const palabras: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    palabras.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  for (let relleno = 0xec; palabras.length < capacidadBits / 8; relleno ^= 0xec ^ 0x11) palabras.push(relleno);
  return palabras;
}

/** Parte los datos en bloques, les agrega la corrección de errores y los intercala. */
function conCorreccion(datos: number[], version: number, nivel: NivelQr): number[] {
  const nBloques = en(BLOQUES[nivel], version);
  const largoEcc = en(ECC_POR_BLOQUE[nivel], version);
  const totalPalabras = Math.floor(modulosDeDatos(version) / 8);
  const nCortos = nBloques - (totalPalabras % nBloques);
  const largoCorto = Math.floor(totalPalabras / nBloques);
  const divisor = divisorRs(largoEcc);
  const bloques: number[][] = [];
  for (let i = 0, k = 0; i < nBloques; i++) {
    const largo = largoCorto - largoEcc + (i < nCortos ? 0 : 1);
    const dat = datos.slice(k, k + largo);
    k += largo;
    const ecc = restoRs(dat, divisor);
    if (i < nCortos) dat.push(0); // marcador de posición: ese hueco se salta al intercalar
    bloques.push([...dat, ...ecc]);
  }
  const resultado: number[] = [];
  for (let i = 0; i < (bloques[0]?.length ?? 0); i++) {
    bloques.forEach((bloque, j) => {
      if (i !== largoCorto - largoEcc || j >= nCortos) resultado.push(bloque[i] ?? 0);
    });
  }
  return resultado;
}

// ---------------------------------------------------------------- Dibujo

class Lienzo {
  readonly tamano: number;
  readonly modulos: boolean[][];
  readonly fijo: boolean[][];
  readonly version: number;

  // Sin propiedades de parámetro (`readonly version` en el constructor): Node ejecuta este archivo quitando solo los tipos.
  constructor(version: number) {
    this.version = version;
    this.tamano = version * 4 + 17;
    this.modulos = Array.from({ length: this.tamano }, () => new Array<boolean>(this.tamano).fill(false));
    this.fijo = Array.from({ length: this.tamano }, () => new Array<boolean>(this.tamano).fill(false));
  }

  poner(x: number, y: number, oscuro: boolean): void {
    const fila = this.modulos[y];
    const filaFija = this.fijo[y];
    if (!fila || !filaFija || x < 0 || x >= this.tamano) return;
    fila[x] = oscuro;
    filaFija[x] = true;
  }

  private buscador(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        this.poner(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }

  private alineacion(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.poner(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  private posicionesDeAlineacion(): number[] {
    if (this.version === 1) return [];
    const n = Math.floor(this.version / 7) + 2;
    const paso = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6];
    for (let pos = this.tamano - 7; r.length < n; pos -= paso) r.splice(1, 0, pos);
    return r;
  }

  /** Patrones fijos y reserva de los bloques de formato y de versión (los bits de formato se escriben después, con la máscara). */
  dibujarFunciones(): void {
    for (let i = 0; i < this.tamano; i++) {
      this.poner(6, i, i % 2 === 0);
      this.poner(i, 6, i % 2 === 0);
    }
    this.buscador(3, 3);
    this.buscador(this.tamano - 4, 3);
    this.buscador(3, this.tamano - 4);
    const pos = this.posicionesDeAlineacion();
    const ultimo = pos.length - 1;
    pos.forEach((y, i) => {
      pos.forEach((x, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === ultimo) || (i === ultimo && j === 0)) return;
        this.alineacion(x, y);
      });
    });
    this.dibujarFormato(0, 0);
    this.dibujarVersion();
  }

  dibujarFormato(nivelBits: number, mascara: number): void {
    const datos = (nivelBits << 3) | mascara;
    let resto = datos;
    for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
    const bits = ((datos << 10) | resto) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.poner(8, i, bit(bits, i));
    this.poner(8, 7, bit(bits, 6));
    this.poner(8, 8, bit(bits, 7));
    this.poner(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.poner(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.poner(this.tamano - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.poner(8, this.tamano - 15 + i, bit(bits, i));
    this.poner(8, this.tamano - 8, true); // el módulo oscuro fijo
  }

  private dibujarVersion(): void {
    if (this.version < 7) return;
    let resto = this.version;
    for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
    const bits = (this.version << 12) | resto;
    for (let i = 0; i < 18; i++) {
      const a = this.tamano - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.poner(a, b, bit(bits, i));
      this.poner(b, a, bit(bits, i));
    }
  }

  /** Coloca las palabras en zigzag, de abajo hacia arriba y de a dos columnas, saltando los módulos fijos. */
  colocar(palabras: number[]): void {
    let i = 0;
    for (let derecha = this.tamano - 1; derecha >= 1; derecha -= 2) {
      if (derecha === 6) derecha = 5;
      for (let v = 0; v < this.tamano; v++) {
        for (let j = 0; j < 2; j++) {
          const x = derecha - j;
          const y = ((derecha + 1) & 2) === 0 ? this.tamano - 1 - v : v;
          if (!this.fijo[y]?.[x] && i < palabras.length * 8) {
            const fila = this.modulos[y];
            if (fila) fila[x] = bit(palabras[i >>> 3] ?? 0, 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  aplicarMascara(mascara: number): void {
    for (let y = 0; y < this.tamano; y++) {
      for (let x = 0; x < this.tamano; x++) {
        let invertir: boolean;
        switch (mascara) {
          case 0: invertir = (x + y) % 2 === 0; break;
          case 1: invertir = y % 2 === 0; break;
          case 2: invertir = x % 3 === 0; break;
          case 3: invertir = (x + y) % 3 === 0; break;
          case 4: invertir = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invertir = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invertir = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invertir = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        const fila = this.modulos[y];
        if (fila && !this.fijo[y]?.[x] && invertir) fila[x] = !fila[x];
      }
    }
  }

  /** Penalización de la norma (rachas, bloques de 2 × 2, patrones tipo buscador y desequilibrio de colores). */
  penalizacion(): number {
    const n = this.tamano;
    const m = (x: number, y: number): boolean => this.modulos[y]?.[x] ?? false;
    let total = 0;
    for (const porFilas of [true, false]) {
      for (let a = 0; a < n; a++) {
        let racha = 1;
        let historia = "";
        for (let b = 0; b < n; b++) {
          const actual = porFilas ? m(b, a) : m(a, b);
          historia += actual ? "1" : "0";
          if (b > 0 && actual === (porFilas ? m(b - 1, a) : m(a, b - 1))) {
            racha++;
            if (racha === 5) total += 3;
            else if (racha > 5) total++;
          } else racha = 1;
        }
        const patron = /(?:0000)?1011101(?:0000)?/g;
        for (const hallazgo of historia.matchAll(patron)) {
          if (hallazgo[0].length > 7) total += 40;
        }
      }
    }
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m(x, y);
        if (c === m(x + 1, y) && c === m(x, y + 1) && c === m(x + 1, y + 1)) total += 3;
      }
    }
    let oscuros = 0;
    for (const fila of this.modulos) for (const c of fila) if (c) oscuros++;
    total += (Math.ceil(Math.abs(oscuros * 20 - n * n * 10) / (n * n)) - 1) * 10;
    return total;
  }
}

/**
 * Codifica `texto` (UTF-8) como QR en modo byte. Elige la versión más chica que alcanza y la máscara de menor penalización.
 * @throws Error si el texto no entra ni en la versión 40.
 */
export function crearQr(texto: string, nivel: NivelQr = "M"): MatrizQr {
  const bytes = bytesUtf8(texto);
  let version = 1;
  for (; version <= 40; version++) {
    const bitsDeLargo = version >= 10 ? 16 : 8;
    if (4 + bitsDeLargo + bytes.length * 8 <= palabrasDeDatos(version, nivel) * 8) break;
  }
  if (version > 40) throw new Error("El texto es demasiado largo para un código QR.");

  const palabras = conCorreccion(armarDatos(bytes, version, nivel), version, nivel);
  let mejor: Lienzo | null = null;
  let menor = Infinity;
  for (let mascara = 0; mascara < 8; mascara++) {
    const lienzo = new Lienzo(version);
    lienzo.dibujarFunciones();
    lienzo.colocar(palabras);
    lienzo.aplicarMascara(mascara);
    lienzo.dibujarFormato(BITS_FORMATO[nivel], mascara);
    const p = lienzo.penalizacion();
    if (p < menor) {
      menor = p;
      mejor = lienzo;
    }
  }
  if (!mejor) throw new Error("No se pudo armar el código QR.");
  return { version, tamano: mejor.tamano, modulos: mejor.modulos };
}
