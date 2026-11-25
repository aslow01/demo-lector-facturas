// Desplazamiento y foco de la navegación interna (la usan `main.ts` y `guia.ts`). Toda navegación hacia el interior de una
// ventana la despliega antes si estaba plegada.

import { desplegarSiHaceFalta } from "./ventanas.ts";

export function sinMovimiento(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Se consulta en el momento de desplazar, no al cargar: el usuario puede cambiar la preferencia con la página abierta. */
export function desplazarA(destino: HTMLElement, bloque: ScrollLogicalPosition = "start"): void {
  destino.scrollIntoView({ behavior: sinMovimiento() ? "auto" : "smooth", block: bloque });
}

/** Despliega la ventana del destino si hace falta, lleva el foco a un título (llevan `tabindex="-1"`) y desplaza hasta él. */
export function irA(destino: HTMLElement | null): void {
  if (!destino) return;
  desplegarSiHaceFalta(destino);
  if (!destino.hasAttribute("tabindex")) destino.setAttribute("tabindex", "-1");
  destino.focus({ preventScroll: true });
  desplazarA(destino);
}

/**
 * Lleva a una ventana entera: la despliega, mueve el foco a su título (salvo `moverFoco: false`) y la desplaza (centrada si
 * cabe en la pantalla; si es más alta, desde arriba). Devuelve el título, o `null` si la ventana no tiene.
 */
export function irAVentana(ventana: HTMLElement, moverFoco = true): HTMLElement | null {
  desplegarSiHaceFalta(ventana);
  const titulo = ventana.querySelector<HTMLElement>(".ventana-barra h2");
  if (titulo && moverFoco) {
    if (!titulo.hasAttribute("tabindex")) titulo.setAttribute("tabindex", "-1");
    titulo.focus({ preventScroll: true });
  }
  desplazarA(ventana, ventana.getBoundingClientRect().height < window.innerHeight ? "center" : "start");
  return titulo;
}
