// Reordenar las filas de la planilla sin que la persona que edita con teclado pierda el foco.
// Mover con `insertBefore` una fila que contiene el elemento enfocado lo desenfoca (el foco pasa a `body`): `acomodarNodos`
// lo devuelve. Las dos interfaces son estructurales para poder probarlo sin DOM.

export interface ContenedorOrdenable<N> {
  readonly children: ArrayLike<N>;
  insertBefore(nodo: N, antes: N | null): unknown;
}

export interface ControlDeFoco<E = string> {
  /** El elemento enfocado ahora (`null` si ninguno). */
  actual(): E | null;
  enfocar(elemento: E): void;
  /** `false` si el elemento ya no está en la página (no tiene sentido enfocarlo). */
  sigueEnLaPagina(elemento: E): boolean;
  /** Si el elemento quedó fuera de la pantalla, lo trae (sin cambiar el foco). Opcional. */
  traerALaVista?(elemento: E): void;
}

/** Pone los nodos en el orden dado, moviendo solo los que no están en su lugar, conserva el foco y lo trae a la vista. */
export function acomodarNodos<N, E = string>(padre: ContenedorOrdenable<N>, deseados: readonly N[], foco: ControlDeFoco<E>): void {
  const antes = foco.actual();
  let movido = false;
  deseados.forEach((nodo, i) => {
    if (padre.children[i] === nodo) return;
    padre.insertBefore(nodo, padre.children[i] ?? null);
    movido = true;
  });
  if (!movido || antes === null || !foco.sigueEnLaPagina(antes)) return;
  if (foco.actual() !== antes) foco.enfocar(antes);
  // Con la fila en otro lugar, el campo puede haber quedado fuera de pantalla: quien edita con teclado sigue escribiendo a ciegas.
  foco.traerALaVista?.(antes);
}
