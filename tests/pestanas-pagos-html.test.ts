// Pestañas y contrato entre `index.html` y la pestaña «Pagos»: cada id que pide `pagos-pantalla.ts` existe, y no hay ids repetidos.

import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import mainFuente from "../src/main.ts?raw";
import pantalla from "../src/pagos-pantalla.ts?raw";
import { indiceSegunTecla } from "../src/pestanas.ts";
import { ID_BLOQUE } from "../src/vista-pagos.ts";

describe("indiceSegunTecla (pestañas con teclado)", () => {
  it("las flechas avanzan y retroceden con vuelta", () => {
    expect(indiceSegunTecla("ArrowRight", 0, 2)).toBe(1);
    expect(indiceSegunTecla("ArrowRight", 1, 2)).toBe(0);
    expect(indiceSegunTecla("ArrowLeft", 0, 2)).toBe(1);
    expect(indiceSegunTecla("ArrowLeft", 1, 2)).toBe(0);
  });

  it("Inicio y Fin van a los extremos; cualquier otra tecla no hace nada", () => {
    expect(indiceSegunTecla("Home", 1, 3)).toBe(0);
    expect(indiceSegunTecla("End", 0, 3)).toBe(2);
    expect(indiceSegunTecla("Enter", 0, 3)).toBeNull();
    expect(indiceSegunTecla("a", 0, 3)).toBeNull();
    expect(indiceSegunTecla("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("index.html y la pestaña «Pagos»", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);

  it("no repite ningún id", () => {
    const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(repetidos).toEqual([]);
  });

  it("existen todos los ids que `pagos-pantalla.ts` busca con el(...)", () => {
    const pedidos = [...pantalla.matchAll(/\bel(?:<[^>]+>)?\("([^"]+)"\)/g)].map((m) => m[1] as string);
    expect(pedidos.length).toBeGreaterThan(25);
    for (const id of pedidos) expect(ids, `falta id="${id}" en index.html`).toContain(id);
  });

  it("existen los ids de las listas de excepciones y de los filtros", () => {
    for (const bloque of [...Object.values(ID_BLOQUE), "exc-omitidas"]) {
      expect(ids).toContain(bloque);
      expect(ids).toContain(`lista-${bloque}`);
    }
    for (const id of ["filtro-fp-todas", "filtro-fp-falta", "filtro-fp-pagadas", "filtro-lp-todos", "filtro-lp-emparejados", "filtro-lp-excepciones"]) {
      expect(ids).toContain(id);
    }
  });

  it("los tres botones de ejemplo de pagos que cablea main.ts existen", () => {
    expect(mainFuente).toContain('["pagos-ejemplo", "pagos-ejemplo-2", "pagos-ejemplo-3"]');
    for (const id of ["pagos-ejemplo", "pagos-ejemplo-2", "pagos-ejemplo-3"]) expect(ids).toContain(id);
  });

  it("cada pestaña apunta a un panel que existe, y solo una arranca seleccionada y visible", () => {
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*id="pestana-[^"]+"[^>]*>/g)].map((m) => m[0]);
    expect(tabs).toHaveLength(2);
    for (const t of tabs) {
      const panel = /aria-controls="([^"]+)"/.exec(t)?.[1];
      expect(ids).toContain(panel);
    }
    expect(tabs.filter((t) => t.includes('aria-selected="true"'))).toHaveLength(1);
    expect(html).toMatch(/id="panel-pagos"[^>]*hidden/);
    expect(html).not.toMatch(/id="panel-facturas"[^>]*hidden/);
  });

  it("cada ventana plegable de Pagos controla ids que existen", () => {
    const desde = html.indexOf('id="panel-pagos"');
    const controles = [...html.slice(desde).matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1] as string);
    expect(controles.length).toBeGreaterThanOrEqual(5);
    for (const lista of controles) for (const id of lista.split(/\s+/)) expect(ids).toContain(id);
  });

  it("el nombre de cada tabla de pagos y cada encabezado de columna están declarados (th con scope y caption)", () => {
    const desde = html.indexOf('id="tabla-facturas-pagos"');
    const tablas = html.slice(desde);
    expect((tablas.match(/<caption/g) ?? []).length).toBe(2);
    expect((tablas.match(/<th scope="col"/g) ?? []).length).toBe(12);
  });
});
