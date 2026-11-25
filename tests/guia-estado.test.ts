import { describe, expect, it } from "vitest";
import {
  CLAVE_ALMACEN,
  PASOS,
  TOTAL_PASOS,
  anterior,
  destinoDelPaso,
  guardarGloboCerrado,
  indiceDePestana,
  leerGloboCerrado,
  modoAlCambiarAncho,
  modoAlMinimizar,
  modoAlMostrar,
  modoAlRestaurar,
  modoAlAbrir,
  normalizarPaso,
  siguiente,
  textoIndicador,
  textoSiguiente,
  type Almacen,
  estaALaVista,
} from "../src/guia-estado.ts";

/** Almacenamiento en memoria. */
function almacenEnMemoria(inicial: Record<string, string> = {}): Almacen & { datos: Map<string, string> } {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
  };
}

/** Un almacenamiento bloqueado (modo privado, permisos): todo lanza. */
const almacenQueLanza: Almacen = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("pasos", () => {
  it("son cuatro, con título y con la ventana que resaltan (13.9.4)", () => {
    expect(TOTAL_PASOS).toBe(4);
    expect(PASOS.map((p) => [p.numero, p.titulo, p.destino])).toEqual([
      [1, "Cargue las facturas", "fuente-comprobantes"],
      [2, "Sume lo ya cargado", "fuente-registro"],
      [3, "Lea el resultado", "resultado"],
      [4, "Revise, corrija y exporte", "planilla"],
    ]);
  });

  it("siguiente y anterior no pasan de los límites", () => {
    expect(siguiente(1)).toBe(2);
    expect(siguiente(3)).toBe(4);
    expect(siguiente(4)).toBe(4);
    expect(anterior(4)).toBe(3);
    expect(anterior(2)).toBe(1);
    expect(anterior(1)).toBe(1);
  });

  it("normaliza cualquier valor raro a un paso válido", () => {
    expect(normalizarPaso(3)).toBe(3);
    expect(normalizarPaso(0)).toBe(1);
    expect(normalizarPaso(9)).toBe(4);
    expect(normalizarPaso(2.7)).toBe(2);
    expect(normalizarPaso(Number.NaN)).toBe(1);
    expect(normalizarPaso(-5)).toBe(1);
  });

  it("textos: indicador y botón de avance ('Terminar' en el último)", () => {
    expect(textoIndicador(2)).toBe("Paso 2 de 4");
    expect(textoSiguiente(1)).toBe("Siguiente");
    expect(textoSiguiente(3)).toBe("Siguiente");
    expect(textoSiguiente(4)).toBe("Terminar");
  });

  it("sin datos, los pasos 3 y 4 apuntan al resultado (su estado vacío); con datos, a su ventana", () => {
    expect(destinoDelPaso(1, false)).toBe("fuente-comprobantes");
    expect(destinoDelPaso(2, false)).toBe("fuente-registro");
    expect(destinoDelPaso(3, false)).toBe("resultado");
    expect(destinoDelPaso(4, false)).toBe("resultado");
    expect(destinoDelPaso(3, true)).toBe("resultado");
    expect(destinoDelPaso(4, true)).toBe("planilla");
  });
});

describe("modos del panel (13.9.3)", () => {
  it("al abrir: acoplado en pantalla ancha, hoja modal en pantalla angosta", () => {
    expect(modoAlAbrir(true)).toBe("acoplado");
    expect(modoAlAbrir(false)).toBe("hoja");
  });

  it("al cruzar 1100 px: acoplada que se angosta pasa a barra (no a modal: no se roba el foco)", () => {
    expect(modoAlCambiarAncho("acoplado", false)).toBe("barra");
    expect(modoAlCambiarAncho("acoplado", true)).toBe("acoplado");
  });

  it("al ensancharse, la hoja y la barra pasan a acopladas", () => {
    expect(modoAlCambiarAncho("hoja", true)).toBe("acoplado");
    expect(modoAlCambiarAncho("barra", true)).toBe("acoplado");
    expect(modoAlCambiarAncho("hoja", false)).toBe("hoja");
    expect(modoAlCambiarAncho("barra", false)).toBe("barra");
  });

  it("minimizar y 'Mostrar en la página' pasan la hoja a barra; el resto no cambia", () => {
    expect(modoAlMinimizar("hoja")).toBe("barra");
    expect(modoAlMinimizar("barra")).toBe("barra");
    expect(modoAlMinimizar("acoplado")).toBe("acoplado");
    expect(modoAlMostrar("hoja")).toBe("barra");
    expect(modoAlMostrar("barra")).toBe("barra");
    expect(modoAlMostrar("acoplado")).toBe("acoplado");
  });

  it("restaurar la barra devuelve la hoja (o el acoplado si ahora cabe)", () => {
    expect(modoAlRestaurar("barra", false)).toBe("hoja");
    expect(modoAlRestaurar("barra", true)).toBe("acoplado");
  });
});

describe("pestañas con teclado (patrón APG)", () => {
  it("flechas, Inicio y Fin; las demás teclas no hacen nada", () => {
    expect(indiceDePestana(0, "ArrowRight", 2)).toBe(1);
    expect(indiceDePestana(1, "ArrowRight", 2)).toBe(0);
    expect(indiceDePestana(0, "ArrowLeft", 2)).toBe(1);
    expect(indiceDePestana(1, "ArrowLeft", 2)).toBe(0);
    expect(indiceDePestana(1, "Home", 2)).toBe(0);
    expect(indiceDePestana(0, "End", 2)).toBe(1);
    expect(indiceDePestana(0, "Enter", 2)).toBeNull();
    expect(indiceDePestana(0, "a", 2)).toBeNull();
  });
});

describe("globo de primera visita: almacenamiento con try/catch", () => {
  it("sin nada guardado, es la primera visita", () => {
    expect(leerGloboCerrado(almacenEnMemoria())).toBe(false);
  });

  it("guarda y lee el cierre del globo con la clave y la forma acordadas", () => {
    const almacen = almacenEnMemoria();
    guardarGloboCerrado(almacen);
    expect(almacen.datos.get(CLAVE_ALMACEN)).toBe('{"v":1,"globoCerrado":true}');
    expect(CLAVE_ALMACEN).toBe("lector-facturas.guia");
    expect(leerGloboCerrado(almacen)).toBe(true);
  });

  it("un almacenamiento que lanza no rompe nada: se lee como primera visita y escribir se ignora", () => {
    expect(leerGloboCerrado(almacenQueLanza)).toBe(false);
    expect(() => guardarGloboCerrado(almacenQueLanza)).not.toThrow();
  });

  it("sin almacenamiento disponible (null), igual", () => {
    expect(leerGloboCerrado(null)).toBe(false);
    expect(() => guardarGloboCerrado(null)).not.toThrow();
  });

  it("un valor guardado roto o de otra versión se ignora", () => {
    for (const valor of ["", "no es json", "null", "42", '{"v":2,"globoCerrado":true}', '{"v":1}', '{"v":1,"globoCerrado":"sí"}', "[]"]) {
      expect(leerGloboCerrado(almacenEnMemoria({ [CLAVE_ALMACEN]: valor }))).toBe(false);
    }
  });
});

describe("estaALaVista (accesibilidad S2: el foco que vuelve al botón no puede quedar fuera de la pantalla)", () => {
  it("un elemento dentro de la ventana está a la vista", () => {
    expect(estaALaVista({ top: 10, bottom: 54 }, 800)).toBe(true);
    expect(estaALaVista({ top: 0, bottom: 800 }, 800)).toBe(true);
  });
  it("arriba o abajo de la ventana no lo está", () => {
    expect(estaALaVista({ top: -2251, bottom: -2207 }, 800)).toBe(false);
    expect(estaALaVista({ top: 900, bottom: 944 }, 800)).toBe(false);
  });
  it("a medio entrar tampoco: el anillo de foco no se vería entero", () => {
    expect(estaALaVista({ top: -10, bottom: 34 }, 800)).toBe(false);
    expect(estaALaVista({ top: 780, bottom: 824 }, 800)).toBe(false);
  });
});
