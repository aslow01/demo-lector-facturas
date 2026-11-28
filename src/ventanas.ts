// Ventanas de la página: plegar y desplegar. Es un "disclosure" de ARIA: un botón con
// `aria-expanded` y `aria-controls` que oculta con `hidden` lo que controla (así el contenido plegado sale del árbol de
// accesibilidad y del orden de tabulación). La barra de título y la de estado no se pliegan: la de estado tiene las
// regiones que anuncian los mensajes. No se recuerda entre visitas y la página nunca pliega nada por su cuenta.

import { activarPanelDe } from "./pestanas.ts";

/** Los ids de un `aria-controls` (separados por espacios), sin vacíos ni repetidos. */
export function idsControlados(valor: string | null): string[] {
  return [...new Set((valor ?? "").split(/\s+/).filter((id) => id !== ""))];
}

function botonPlegar(ventana: Element): HTMLElement | null {
  return ventana.querySelector<HTMLElement>(".ventana-plegar");
}

export function estaPlegada(ventana: Element): boolean {
  return ventana.hasAttribute("data-plegada");
}

/** Pliega o despliega una ventana: `hidden` en cada id de `aria-controls`, `data-plegada` y `aria-expanded`. */
export function plegarVentana(ventana: HTMLElement, plegada: boolean): void {
  const boton = botonPlegar(ventana);
  if (boton) {
    for (const id of idsControlados(boton.getAttribute("aria-controls"))) {
      const controlado = document.getElementById(id);
      if (controlado) controlado.hidden = plegada;
    }
    boton.setAttribute("aria-expanded", String(!plegada));
  }
  ventana.toggleAttribute("data-plegada", plegada);
}

/**
 * Regla única de la navegación interna: si el destino está en una pestaña que no se ve, se la abre; y si está dentro de una ventana
 * plegada, se la despliega primero. Devuelve `true` si abrió o desplegó algo. El foco no se toca aquí: lo mueve quien navega.
 */
export function desplegarSiHaceFalta(destino: Element): boolean {
  const cambioDePestana = activarPanelDe(destino);
  const ventana = destino.closest<HTMLElement>(".ventana");
  if (!ventana || !estaPlegada(ventana)) return cambioDePestana;
  plegarVentana(ventana, false);
  return true;
}

/** Deja cada ventana con el estado que dice su botón y conecta los clics (delegados: sirve aunque cambie el contenido). */
export function iniciarVentanas(): void {
  for (const boton of document.querySelectorAll<HTMLElement>(".ventana-plegar")) {
    const ventana = boton.closest<HTMLElement>(".ventana");
    if (ventana) plegarVentana(ventana, boton.getAttribute("aria-expanded") === "false");
  }
  document.addEventListener("click", (e) => {
    const boton = e.target instanceof Element ? e.target.closest<HTMLElement>(".ventana-plegar") : null;
    const ventana = boton?.closest<HTMLElement>(".ventana");
    if (!boton || !ventana) return;
    plegarVentana(ventana, !estaPlegada(ventana));
    boton.focus(); // el foco queda en el botón (también en Safari, que no enfoca los botones al hacer clic)
  });
}
