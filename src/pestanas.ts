// Pestañas de los módulos de la página («Facturas» y «Pagos»): patrón de tabs de ARIA con activación automática. Cada panel es
// un `role="tabpanel"` que se oculta con `hidden`, así lo que no se ve sale del árbol de accesibilidad y del orden de tabulación.
// El estado de cada panel (lo cargado, los filtros) se conserva al cambiar: solo se oculta, nunca se destruye.

/**
 * A qué pestaña lleva una tecla, o `null` si la tecla no mueve nada. Flechas con vuelta (de la última a la primera), Inicio y Fin.
 * Función pura: la prueba no necesita el navegador.
 */
export function indiceSegunTecla(tecla: string, actual: number, total: number): number | null {
  if (total <= 0) return null;
  switch (tecla) {
    case "ArrowRight":
    case "ArrowDown":
      return (actual + 1) % total;
    case "ArrowLeft":
    case "ArrowUp":
      return (actual - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}

// Solo las pestañas de los módulos: la guía «¿Cómo funciona?» tiene las suyas (Pasos y Preguntas frecuentes) y las maneja guia.ts.
function pestanas(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.pestanas[role="tablist"] > [role="tab"]'));
}

function panelDe(tab: HTMLElement): HTMLElement | null {
  const id = tab.getAttribute("aria-controls");
  return id === null ? null : document.getElementById(id);
}

type AlCambiar = (tab: HTMLElement, panel: HTMLElement) => void;
let alCambiar: AlCambiar | null = null;

/** Deja `tab` como la única seleccionada. Con `foco`, además le lleva el foco (al navegar con el teclado). */
export function activarPestana(tab: HTMLElement, foco = false, actualizarEnlace = true): void {
  const todas = pestanas();
  for (const otra of todas) {
    const activa = otra === tab;
    otra.setAttribute("aria-selected", String(activa));
    otra.tabIndex = activa ? 0 : -1;
    const panel = panelDe(otra);
    if (panel) panel.hidden = !activa;
  }
  if (foco) tab.focus();
  const panel = panelDe(tab);
  if (actualizarEnlace) {
    // El enlace de la página queda en el panel que se está viendo: «#pagos» se puede compartir y abre esa pestaña.
    const destino = tab.dataset.hash ?? "";
    history.replaceState(null, "", `${location.pathname}${location.search}${destino === "" ? "" : `#${destino}`}`);
  }
  if (panel && alCambiar) alCambiar(tab, panel);
}

/**
 * Si `destino` está dentro de un panel oculto, abre su pestaña. Devuelve `true` si cambió de pestaña. Lo usa toda la navegación
 * interna (la guía, «Ver» de los resultados, «Ir al resultado»): así nunca se intenta llevar el foco a algo que no se ve.
 */
export function activarPanelDe(destino: Element): boolean {
  const panel = destino.closest<HTMLElement>('[role="tabpanel"]');
  if (!panel || !panel.hidden) return false;
  const tab = pestanas().find((t) => t.getAttribute("aria-controls") === panel.id);
  if (!tab) return false;
  activarPestana(tab);
  return true;
}

/** Conecta clics y teclado, y abre la pestaña que dice el enlace (`#pagos`). `cambio` se llama cada vez que cambia la pestaña activa. */
export function iniciarPestanas(cambio?: AlCambiar): void {
  alCambiar = cambio ?? null;
  const todas = pestanas();
  for (const tab of todas) {
    tab.addEventListener("click", () => activarPestana(tab));
    tab.addEventListener("keydown", (e) => {
      const i = indiceSegunTecla(e.key, todas.indexOf(tab), todas.length);
      const siguiente = i === null ? undefined : todas[i];
      if (!siguiente) return;
      e.preventDefault();
      activarPestana(siguiente, true);
    });
  }
  const segunEnlace = (): void => {
    const hash = location.hash.replace(/^#/, "");
    const tab = todas.find((t) => (t.dataset.hash ?? "") === hash && hash !== "");
    if (tab && tab.getAttribute("aria-selected") !== "true") activarPestana(tab);
  };
  window.addEventListener("hashchange", segunEnlace);
  // Primero se ordena el estado inicial sin tocar la dirección (si no, se perdería el «#pagos» con el que se llegó).
  const inicial = todas.find((t) => t.getAttribute("aria-selected") === "true") ?? todas[0];
  if (inicial) activarPestana(inicial, false, false);
  segunEnlace();
}
