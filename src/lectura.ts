// Lectura de archivos en el navegador: imagen o PDF -> canvas -> jsQR. Nada se envía a ningún servidor.

import type { Pixeles } from "./buscar-qr.ts";
import { BYTES_DE_ENCABEZADO, LADO_MAXIMO_PX, evaluarImagen, motivoDeRechazoPorTamano } from "./imagen.ts";
import type { PedidoQr, RespuestaQr } from "./qr-worker.ts";

export const TAMANO_MAXIMO_BYTES = 15 * 1024 * 1024;
export const PAGINAS_MAXIMAS = 3;
/** Si la búsqueda del QR tarda más que esto, se corta el trabajador y el archivo queda como "no se pudo leer". */
const TIEMPO_MAXIMO_QR_MS = 30_000;
const ESCALA_PDF = 2;
const PIXELES_MAXIMOS_IMAGEN_PDF = 50_000_000;

export class ErrorLectura extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorLectura";
  }
}

type TipoArchivo = "pdf" | "imagen" | "otro";

async function tipoDeArchivo(archivo: File): Promise<TipoArchivo> {
  const inicio = new TextDecoder("latin1").decode(await archivo.slice(0, 1024).arrayBuffer());
  if (inicio.includes("%PDF-")) return "pdf";
  if (archivo.type.startsWith("image/")) return "imagen";
  return "otro";
}

// ---------------------------------------------------------------- Búsqueda del QR en un Web Worker

interface Pendiente {
  resolver: (texto: string | null) => void;
  rechazar: (error: ErrorLectura) => void;
  temporizador: number;
}

let trabajador: Worker | null = null;
let proximoPedido = 0;
const pendientes = new Map<number, Pendiente>();

/** Corta el trabajador (si hay uno) y rechaza lo que tenía en curso. El próximo pedido arranca uno nuevo. */
function terminarTrabajador(motivo: string): void {
  trabajador?.terminate();
  trabajador = null;
  const enCurso = [...pendientes.values()];
  pendientes.clear();
  for (const p of enCurso) {
    window.clearTimeout(p.temporizador);
    p.rechazar(new ErrorLectura(motivo));
  }
}

/** Corta cualquier búsqueda de QR en curso (por ejemplo, porque se vació la planilla). */
export function cancelarLecturas(): void {
  terminarTrabajador("Lectura cancelada.");
}

function obtenerTrabajador(): Worker {
  if (trabajador) return trabajador;
  // El código del trabajador sale del propio sitio (Vite lo empaqueta en /assets); la CSP lo permite con `worker-src 'self'`.
  const nuevo = new Worker(new URL("./qr-worker.ts", import.meta.url), { type: "module" });
  nuevo.onmessage = (e: MessageEvent<RespuestaQr>): void => {
    const p = pendientes.get(e.data.id);
    if (!p) return;
    pendientes.delete(e.data.id);
    window.clearTimeout(p.temporizador);
    if (e.data.error !== undefined) p.rechazar(new ErrorLectura(e.data.error));
    else p.resolver(e.data.texto);
  };
  nuevo.onerror = (): void => terminarTrabajador("No se pudo analizar la imagen.");
  trabajador = nuevo;
  return nuevo;
}

function enviarAlTrabajador(intentos: Pixeles[]): Promise<string | null> {
  return new Promise((resolver, rechazar) => {
    const id = ++proximoPedido;
    const temporizador = window.setTimeout(
      () => terminarTrabajador(`La imagen tardó demasiado en analizarse (más de ${TIEMPO_MAXIMO_QR_MS / 1000} segundos).`),
      TIEMPO_MAXIMO_QR_MS,
    );
    pendientes.set(id, { resolver, rechazar, temporizador });
    try {
      const pedido: PedidoQr = { id, intentos };
      // Los píxeles se transfieren (no se copian): después de enviarlos este hilo ya no los tiene.
      obtenerTrabajador().postMessage(pedido, intentos.map((i) => i.data.buffer as ArrayBuffer));
    } catch {
      pendientes.delete(id);
      window.clearTimeout(temporizador);
      rechazar(new ErrorLectura("El navegador no permite analizar la imagen."));
    }
  });
}

/** Busca un QR en el lienzo; prueba el tamaño original y uno reducido a la mitad. La búsqueda pesada corre en el trabajador. */
async function buscarQr(lienzo: HTMLCanvasElement): Promise<string | null> {
  const intentos: Pixeles[] = [];
  for (const factor of [1, 0.5]) {
    const ancho = Math.max(1, Math.round(lienzo.width * factor));
    const alto = Math.max(1, Math.round(lienzo.height * factor));
    let origen = lienzo;
    if (factor !== 1) {
      origen = document.createElement("canvas");
      origen.width = ancho;
      origen.height = alto;
      origen.getContext("2d")?.drawImage(lienzo, 0, 0, ancho, alto);
    }
    const ctx = origen.getContext("2d", { willReadFrequently: true });
    if (!ctx) continue;
    intentos.push({ data: ctx.getImageData(0, 0, ancho, alto).data, ancho, alto });
  }
  return enviarAlTrabajador(intentos);
}

// ---------------------------------------------------------------- Imagen

async function textosDeImagen(archivo: File): Promise<string[]> {
  // Se miden las dimensiones del encabezado ANTES de decodificar: una imagen chica en bytes puede ser enorme en píxeles.
  const inicio = new Uint8Array(await archivo.slice(0, BYTES_DE_ENCABEZADO).arrayBuffer());
  const evaluada = evaluarImagen(inicio);
  if (evaluada.tipo === "error") throw new ErrorLectura(evaluada.mensaje);

  // Si hay que reducirla, se le pide al navegador que la decodifique ya reducida (nunca se materializa a tamaño completo).
  // Sin rotar según EXIF: el QR se encuentra igual girado y las medidas del encabezado siguen valiendo.
  const reducir = evaluada.destino.ancho !== evaluada.ancho || evaluada.destino.alto !== evaluada.alto;
  let mapa: ImageBitmap;
  try {
    mapa = await createImageBitmap(archivo, {
      imageOrientation: "none",
      ...(reducir ? { resizeWidth: evaluada.destino.ancho, resizeHeight: evaluada.destino.alto, resizeQuality: "high" as const } : {}),
    });
  } catch {
    throw new ErrorLectura("No se pudo abrir la imagen.");
  }
  try {
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.min(mapa.width, LADO_MAXIMO_PX);
    lienzo.height = Math.min(mapa.height, LADO_MAXIMO_PX);
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new ErrorLectura("El navegador no permite procesar imágenes.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
    const texto = await buscarQr(lienzo);
    return texto === null ? [] : [texto];
  } finally {
    mapa.close();
  }
}

// ---------------------------------------------------------------- PDF

async function textosDePdf(archivo: File): Promise<string[]> {
  const [pdfjs, trabajador] = await Promise.all([
    import("pdfjs-dist"),
    // El trabajador se sirve desde el propio sitio (Vite lo copia a /assets); no hay CDN.
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = trabajador.default;

  // Los PDF son entrada hostil: sin evaluación de código, sin scripts, sin WebAssembly (compatible con la CSP) y con
  // un tope de píxeles por imagen. `isEvalSupported` se pasa por seguridad; pdf.js 6 ya no evalúa código.
  const opciones = {
    data: new Uint8Array(await archivo.arrayBuffer()),
    isEvalSupported: false,
    useWasm: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    maxImageSize: PIXELES_MAXIMOS_IMAGEN_PDF,
  };
  const tarea = pdfjs.getDocument(opciones);

  let documento;
  try {
    documento = await tarea.promise;
  } catch (e) {
    await tarea.destroy();
    if (e instanceof Error && e.name === "PasswordException") {
      throw new ErrorLectura("El PDF tiene contraseña.");
    }
    throw new ErrorLectura("No se pudo abrir el PDF.");
  }

  const textos: string[] = [];
  try {
    const paginas = Math.min(documento.numPages, PAGINAS_MAXIMAS);
    for (let n = 1; n <= paginas; n++) {
      const pagina = await documento.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const escala = Math.min(ESCALA_PDF, LADO_MAXIMO_PX / Math.max(base.width, base.height));
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.max(1, Math.floor(vista.width));
      lienzo.height = Math.max(1, Math.floor(vista.height));
      await pagina.render({ canvas: lienzo, viewport: vista, background: "#ffffff" }).promise;
      const texto = await buscarQr(lienzo);
      if (texto !== null && !textos.includes(texto)) textos.push(texto);
      pagina.cleanup();
    }
  } catch (e) {
    if (e instanceof ErrorLectura) throw e;
    throw new ErrorLectura("No se pudo leer el contenido del PDF.");
  } finally {
    await tarea.destroy();
  }
  return textos;
}

/**
 * Devuelve los textos de QR distintos que se encuentran en el archivo (hasta 3 páginas si es PDF).
 * Lanza `ErrorLectura` con un mensaje para el usuario si el archivo no se puede leer.
 */
export async function textosQrDeArchivo(archivo: File): Promise<string[]> {
  const rechazo = motivoDeRechazoPorTamano(archivo.size, TAMANO_MAXIMO_BYTES);
  if (rechazo !== null) throw new ErrorLectura(rechazo);
  const tipo = await tipoDeArchivo(archivo);
  if (tipo === "pdf") return textosDePdf(archivo);
  if (tipo === "imagen") return textosDeImagen(archivo);
  throw new ErrorLectura("Formato no admitido: solo PDF e imágenes.");
}
