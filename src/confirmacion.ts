// Confirmación en dos pasos: cuánto debe pasar entre el primer clic (que pide confirmar) y el segundo (que ejecuta).
// Sin esta espera, un doble clic o un doble Enter confirma sin que la persona haya leído nada. Función pura, sin DOM.

/** Margen, en milisegundos, durante el cual el segundo clic se ignora. Más largo que un doble clic, más corto que una decisión. */
export const MS_ANTES_DE_CONFIRMAR = 500;

/** `true` si ya pasó el margen desde que se pidió confirmar (`desde`, en ms). Un reloj que retrocede no confirma. */
export function confirmacionPermitida(desde: number, ahora: number): boolean {
  return ahora - desde >= MS_ANTES_DE_CONFIRMAR;
}
