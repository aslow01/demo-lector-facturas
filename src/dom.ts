// Ayudas mínimas para armar elementos. Lo que viene de un archivo o de la persona entra siempre con `textContent` (nunca como HTML).

import { icono } from "./iconos.ts";
import type { EtiquetaVista } from "./vista.ts";

export type TonoMensaje = "info" | "ok" | "aviso" | "error";

/** Escribe un mensaje de estado y le pone el tono (que la maquetación dibuja con ícono y color). Vacío borra el tono. */
export function pintarMensaje(destino: HTMLElement, texto: string, tono: TonoMensaje): void {
  destino.textContent = texto;
  if (texto === "") delete destino.dataset.tono;
  else destino.dataset.tono = tono;
}

/** Crea un elemento, le pone clase y texto, y lo agrega al final de `padre`. */
export function hijo<K extends keyof HTMLElementTagNameMap>(
  padre: HTMLElement,
  etiqueta: K,
  clase?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  padre.appendChild(e);
  return e;
}

/**
 * El texto de una acción de "Requieren atención". Lo que sigue a la primera palabra ("detalle", en "Ver detalle") va en
 * su propio `span.accion-extra`: en interiores angostos la maquetación lo oculta y queda "Ver" (E8). El nombre
 * accesible completo va en `aria-label`.
 */
export function textoDeAccion(destino: HTMLElement, texto: string): void {
  const [base = "", ...resto] = texto.split(" ");
  const visible = hijo(destino, "span", "accion-texto", base);
  if (resto.length > 0) hijo(visible, "span", "accion-extra", ` ${resto.join(" ")}`);
  destino.appendChild(icono("flecha-der"));
}

/** Un único marcador de "sin dato" en las celdas (E11): el guion se ve, el lector de pantalla oye "Sin dato". */
export function marcaSinDato(): HTMLSpanElement {
  const marca = document.createElement("span");
  marca.className = "sin-dato";
  hijo(marca, "span", undefined, "—").setAttribute("aria-hidden", "true");
  hijo(marca, "span", "solo-lectores", "Sin dato");
  return marca;
}

/** La etiqueta de estado: ícono de forma propia y texto (el color nunca va solo). */
export function crearEtiqueta(e: EtiquetaVista, claseExtra = ""): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = `etiqueta-estado${claseExtra === "" ? "" : ` ${claseExtra}`}`;
  s.dataset.tono = e.tono;
  s.append(icono(e.icono), document.createTextNode(e.texto));
  return s;
}
