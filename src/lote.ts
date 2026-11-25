// Procesa una lista de archivos de a uno, con cancelación: si el usuario vacía la planilla mientras se lee, el lote se corta y lo
// que estaba en vuelo se descarta (no repuebla la planilla). Sin DOM: quien llama dice cómo leer y qué hacer con cada resultado.

export type Lectura<R> = { ok: true; valor: R } | { ok: false; error: unknown };

export interface ResultadoLote {
  /** Archivos cuyo resultado se entregó. */
  procesados: number;
  /** Filas que `agregar` dijo haber sumado: se cuentan aquí, nunca como diferencia con el tamaño de la planilla. */
  agregadas: number;
  cancelado: boolean;
}

export interface OpcionesLote<A, R> {
  /** Se consulta antes de cada archivo y otra vez al terminar de leerlo. */
  cancelado: () => boolean;
  alIniciar: (archivo: A, numero: number, total: number) => void;
  leer: (archivo: A) => Promise<R>;
  /** Recibe el resultado (o el error) de la lectura y devuelve cuántas filas sumó. */
  agregar: (archivo: A, lectura: Lectura<R>) => number;
  /** Cede el hilo entre archivos para que el navegador pinte. */
  ceder: () => Promise<void>;
}

export async function procesarLote<A, R>(archivos: readonly A[], o: OpcionesLote<A, R>): Promise<ResultadoLote> {
  const resultado: ResultadoLote = { procesados: 0, agregadas: 0, cancelado: false };
  for (const [i, archivo] of archivos.entries()) {
    if (o.cancelado()) {
      resultado.cancelado = true;
      break;
    }
    o.alIniciar(archivo, i + 1, archivos.length);
    let lectura: Lectura<R>;
    try {
      lectura = { ok: true, valor: await o.leer(archivo) };
    } catch (error) {
      lectura = { ok: false, error };
    }
    if (o.cancelado()) {
      resultado.cancelado = true;
      break;
    }
    resultado.agregadas += o.agregar(archivo, lectura);
    resultado.procesados++;
    await o.ceder();
  }
  return resultado;
}
