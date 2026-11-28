// Íconos de la interfaz. El dibujo vive en el sprite SVG de `index.html` (`<symbol id="i-…">`); aquí solo se los referencia.
// Los nombres son el contrato con la maquetación. Sin recursos externos.

export const ICONOS = [
  "marca",
  "check",
  "punto",
  "alerta",
  "error",
  "distinto",
  "guion",
  "copias",
  "sistema",
  "lapiz",
  "sin-qr",
  "subir",
  "csv",
  "candado",
  "ayuda",
  "cerrar",
  "chevron",
  "flecha-der",
  "flecha-izq",
  "ubicacion",
  "reloj",
  "pago",
  "bandeja",
] as const;

export type NombreIcono = (typeof ICONOS)[number];

const ESPACIO_SVG = "http://www.w3.org/2000/svg";

/** Un `<svg>` decorativo que usa el símbolo `#i-<nombre>` del sprite. El texto que lo acompaña es el que se anuncia. */
export function icono(nombre: NombreIcono, clase = "icono"): SVGSVGElement {
  const svg = document.createElementNS(ESPACIO_SVG, "svg");
  svg.setAttribute("class", clase);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const uso = document.createElementNS(ESPACIO_SVG, "use");
  uso.setAttribute("href", `#i-${nombre}`);
  svg.appendChild(uso);
  return svg;
}
