// QA alto A1: al reordenar las filas con `insertBefore`, el navegador desenfoca el elemento que está dentro de la fila movida.
// `acomodarNodos` (src/orden-dom.ts) devuelve el foco a ese elemento. Se prueba con nodos de mentira: sin DOM.

import { describe, expect, it } from "vitest";
import { acomodarNodos, type ContenedorOrdenable, type ControlDeFoco } from "../src/orden-dom.ts";

interface Nodo {
  nombre: string;
  /** Elementos que contiene (por ejemplo, el campo que se está editando dentro de una fila). */
  dentro: string[];
}

/** Un contenedor que, como el navegador, pierde el foco cuando se mueve un nodo que lo contiene. */
function entorno(nodos: Nodo[], enfocado: string | null) {
  let foco = enfocado;
  const hijos = [...nodos];
  const contenedor: ContenedorOrdenable<Nodo> = {
    get children() {
      return hijos;
    },
    insertBefore(nodo, antes) {
      const desde = hijos.indexOf(nodo);
      hijos.splice(desde, 1);
      hijos.splice(antes === null ? hijos.length : hijos.indexOf(antes), 0, nodo);
      if (foco !== null && nodo.dentro.includes(foco)) foco = null; // el navegador desenfoca
    },
  };
  const control: ControlDeFoco = {
    actual: () => foco,
    enfocar: (id) => {
      foco = id;
    },
    sigueEnLaPagina: () => true,
  };
  return { contenedor, control, nombres: () => hijos.map((n) => n.nombre), foco: () => foco };
}

const A: Nodo = { nombre: "A", dentro: [] };
const B: Nodo = { nombre: "B", dentro: [] };
const C: Nodo = { nombre: "C", dentro: ["campo-fecha"] };

describe("acomodarNodos", () => {
  it("deja los nodos en el orden pedido", () => {
    const e = entorno([A, B, C], null);
    acomodarNodos(e.contenedor, [C, A, B], e.control);
    expect(e.nombres()).toEqual(["C", "A", "B"]);
  });

  it("devuelve el foco al campo que estaba dentro de la fila movida (QA A1)", () => {
    const e = entorno([A, B, C], "campo-fecha");
    acomodarNodos(e.contenedor, [C, A, B], e.control);
    expect(e.foco()).toBe("campo-fecha");
  });

  it("no toca el foco si no hubo movimientos", () => {
    const e = entorno([A, B, C], "campo-fecha");
    acomodarNodos(e.contenedor, [A, B, C], e.control);
    expect(e.foco()).toBe("campo-fecha");
  });

  it("no le roba el foco a nadie si no había ninguno", () => {
    const e = entorno([A, B, C], null);
    acomodarNodos(e.contenedor, [C, A, B], e.control);
    expect(e.foco()).toBeNull();
  });

  it("no devuelve el foco a un elemento que ya no está en la página", () => {
    const e = entorno([A, B, C], "campo-fecha");
    acomodarNodos(e.contenedor, [C, A, B], { ...e.control, sigueEnLaPagina: () => false });
    expect(e.foco()).toBeNull();
  });
});

describe("acomodarNodos: traer a la vista el campo con foco (QA M2 de la etapa 3)", () => {
  it("después de mover la fila, trae a la vista el campo que se está editando, con el foco en su lugar", () => {
    const e = entorno([A, B, C], "campo-fecha");
    const vistos: string[] = [];
    acomodarNodos(e.contenedor, [C, A, B], { ...e.control, traerALaVista: (id) => vistos.push(id) });
    expect(vistos).toEqual(["campo-fecha"]);
    expect(e.foco()).toBe("campo-fecha");
  });

  it("también cuando el foco sobrevivió a la mudanza (el campo igual pudo quedar fuera de pantalla)", () => {
    const e = entorno([A, B, C], "otro-campo"); // no está dentro de ningún nodo movido: el navegador no lo desenfoca
    const vistos: string[] = [];
    acomodarNodos(e.contenedor, [C, A, B], { ...e.control, traerALaVista: (id) => vistos.push(id) });
    expect(vistos).toEqual(["otro-campo"]);
  });

  it("sin movimientos no desplaza nada", () => {
    const e = entorno([A, B, C], "campo-fecha");
    const vistos: string[] = [];
    acomodarNodos(e.contenedor, [A, B, C], { ...e.control, traerALaVista: (id) => vistos.push(id) });
    expect(vistos).toEqual([]);
  });

  it("sin foco, o con un elemento que ya no está en la página, no desplaza nada", () => {
    const sinFoco = entorno([A, B, C], null);
    const vistos: string[] = [];
    acomodarNodos(sinFoco.contenedor, [C, A, B], { ...sinFoco.control, traerALaVista: (id) => vistos.push(id) });
    const ido = entorno([A, B, C], "campo-fecha");
    acomodarNodos(ido.contenedor, [C, A, B], { ...ido.control, sigueEnLaPagina: () => false, traerALaVista: (id) => vistos.push(id) });
    expect(vistos).toEqual([]);
  });
});
