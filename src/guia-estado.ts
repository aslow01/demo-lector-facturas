// Estado de la guía "¿Cómo funciona?", sin DOM: pasos, destinos, modos del panel y persistencia del globo de primera visita.
// `guia.ts` solo conecta esto con los elementos.

export const TOTAL_PASOS = 4;

export type NumeroPaso = 1 | 2 | 3 | 4;

/** Las ventanas de la página que la guía puede resaltar (son los `id` de las `section.ventana`). */
export type DestinoGuia = "fuente-comprobantes" | "fuente-registro" | "resultado" | "planilla";

export interface PasoGuia {
  numero: NumeroPaso;
  titulo: string;
  destino: DestinoGuia;
}

export const PASOS: readonly PasoGuia[] = [
  { numero: 1, titulo: "Cargue las facturas", destino: "fuente-comprobantes" },
  { numero: 2, titulo: "Sume lo ya cargado", destino: "fuente-registro" },
  { numero: 3, titulo: "Lea el resultado", destino: "resultado" },
  { numero: 4, titulo: "Revise, corrija y exporte", destino: "planilla" },
];

/** Cualquier valor raro (NaN, fuera de rango, decimal) pasa a un paso válido. */
export function normalizarPaso(n: number): NumeroPaso {
  if (!Number.isFinite(n)) return 1;
  return Math.min(TOTAL_PASOS, Math.max(1, Math.trunc(n))) as NumeroPaso;
}

export function siguiente(paso: NumeroPaso): NumeroPaso {
  return normalizarPaso(paso + 1);
}

export function anterior(paso: NumeroPaso): NumeroPaso {
  return normalizarPaso(paso - 1);
}

export function textoIndicador(paso: NumeroPaso): string {
  return `Paso ${paso} de ${TOTAL_PASOS}`;
}

/** "Terminar" en el último paso: cierra la guía. */
export function textoSiguiente(paso: NumeroPaso): string {
  return paso === TOTAL_PASOS ? "Terminar" : "Siguiente";
}

/** Sin datos no existe la planilla: los pasos 3 y 4 resaltan el resultado, que muestra su estado vacío. */
export function destinoDelPaso(paso: NumeroPaso, hayDatos: boolean): DestinoGuia {
  const destino = (PASOS.find((p) => p.numero === paso) ?? (PASOS[0] as PasoGuia)).destino;
  return !hayDatos && destino === "planilla" ? "resultado" : destino;
}

// ---------------------------------------------------------------- Modos del panel (13.9.3)

/** `acoplado`: ventana no modal junto a la página (≥ 1100 px). `hoja`: modal desde abajo. `barra`: minimizada, no modal. */
export type ModoGuia = "acoplado" | "hoja" | "barra";

export function modoAlAbrir(pantallaAncha: boolean): ModoGuia {
  return pantallaAncha ? "acoplado" : "hoja";
}

/**
 * Al cruzar el corte de 1100 px con la guía abierta. Una acoplada que se angosta pasa a barra (no a hoja modal:
 * no se le roba el foco a quien está usando la página); la hoja y la barra, al ensancharse, pasan a acopladas.
 */
export function modoAlCambiarAncho(modo: ModoGuia, pantallaAncha: boolean): ModoGuia {
  if (pantallaAncha) return "acoplado";
  return modo === "acoplado" ? "barra" : modo;
}

export function modoAlMinimizar(modo: ModoGuia): ModoGuia {
  return modo === "hoja" ? "barra" : modo;
}

/** "Mostrar en la página" hace lo mismo que minimizar: deja ver la página sin cerrar la guía. */
export function modoAlMostrar(modo: ModoGuia): ModoGuia {
  return modoAlMinimizar(modo);
}

export function modoAlRestaurar(modo: ModoGuia, pantallaAncha: boolean): ModoGuia {
  if (modo !== "barra") return modo;
  return pantallaAncha ? "acoplado" : "hoja";
}

// ---------------------------------------------------------------- Pestañas (patrón APG, activación automática)

/** Pestaña a la que lleva una tecla, o `null` si la tecla no navega. */
export function indiceDePestana(actual: number, tecla: string, cantidad: number): number | null {
  switch (tecla) {
    case "ArrowRight":
      return (actual + 1) % cantidad;
    case "ArrowLeft":
      return (actual - 1 + cantidad) % cantidad;
    case "Home":
      return 0;
    case "End":
      return cantidad - 1;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- Globo de primera visita

export const CLAVE_ALMACEN = "lector-facturas.guia";

/** Lo mínimo que se usa de `localStorage`; así se prueba con un doble (también uno que lanza). */
export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
}

/** `true` si ya se cerró el globo. Cualquier falla (bloqueado, vacío, roto, otra versión) se trata como primera visita. */
export function leerGloboCerrado(almacen: Almacen | null): boolean {
  try {
    const crudo = almacen?.getItem(CLAVE_ALMACEN);
    if (!crudo) return false;
    const dato: unknown = JSON.parse(crudo);
    if (typeof dato !== "object" || dato === null) return false;
    const { v, globoCerrado } = dato as { v?: unknown; globoCerrado?: unknown };
    return v === 1 && globoCerrado === true;
  } catch {
    return false;
  }
}

/** Si no se puede escribir, se ignora: el globo podrá volver a verse en otra visita. */
export function guardarGloboCerrado(almacen: Almacen | null): void {
  try {
    almacen?.setItem(CLAVE_ALMACEN, JSON.stringify({ v: 1, globoCerrado: true }));
  } catch {
    /* almacenamiento bloqueado o lleno */
  }
}

/** `true` si el elemento (su rectángulo respecto de la ventana) se ve entero: así el anillo de foco no queda cortado ni fuera. */
export function estaALaVista(rect: { top: number; bottom: number }, altoVentana: number): boolean {
  return rect.top >= 0 && rect.bottom <= altoVentana;
}

/** Lo que se anuncia a un lector de pantalla al cambiar de paso: "Paso 2 de 4: Sume lo ya cargado". */
export function textoAnuncioPaso(paso: NumeroPaso): string {
  return `${textoIndicador(paso)}: ${PASOS[paso - 1]?.titulo ?? ""}`;
}
