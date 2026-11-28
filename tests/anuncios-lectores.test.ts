// Anuncios para lectores de pantalla (accesibilidad M1, M2 y M5): cada cambio que no se ve en el foco se dice en voz alta.

import { describe, expect, it } from "vitest";
import { contarAntiguas } from "../src/antiguedad.ts";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import { conciliar, resumenConciliacion } from "../src/conciliacion.ts";
import { textoAnuncioPaso } from "../src/guia-estado.ts";
import { agregarFila, crearFila, siguienteId, type Fila } from "../src/planilla.ts";
import { anuncioConciliacion, anuncioOrden, anuncioReferencia, anuncioUmbral, textoMarcadas } from "../src/vista.ts";

const HOY = new Date(2026, 10, 17, 12);
const CUIT = "30990000014";

function planilla(...datos: Array<Partial<Comprobante>>): Fila[] {
  let filas: Fila[] = [];
  for (const d of datos) {
    const dato: Comprobante = { ...comprobanteVacio(), ver: 1, cuit: CUIT, ptoVta: 1, tipoCmp: 1, nroCmp: filas.length + 1, importe: 100, moneda: "PES", fecha: "2026-10-01", ...d };
    filas = agregarFila(filas, crearFila(siguienteId(filas), `a-${filas.length + 1}.pdf`, dato));
  }
  return filas;
}

describe("M5: el anuncio de lo que falta no confunde montos con grupos", () => {
  it("las notas de crédito van después de un punto y coma con 'además', no unidas por 'y' a los montos", () => {
    const filas = planilla({ importe: 82195.4 }, { moneda: "DOL", importe: 1250 }, { tipoCmp: 3, importe: 9350.25 });
    const r = resumenConciliacion(filas, conciliar(filas, [], HOY));
    expect(anuncioConciliacion(r)).toBe(
      "Conciliación terminada. Falta cargar 2 facturas por $ 82.195,40 y US$ 1.250,00; además, 1 nota de crédito por $ 9.350,25. Nada requiere atención.",
    );
  });
});

describe("M2: ordenar y cambiar la antigüedad se anuncia", () => {
  it("anuncia el orden elegido", () => {
    expect(anuncioOrden("antiguedad")).toBe("Planilla ordenada: lo que falta cargar, de la más antigua a la más nueva.");
    expect(anuncioOrden("numero")).toBe("Planilla en el orden en que se cargaron los comprobantes.");
  });

  it("dice cuántos comprobantes quedan marcados, con singular, plural y cero", () => {
    expect(textoMarcadas(3, 30)).toBe("3 comprobantes por cargar tienen 30 días o más.");
    expect(textoMarcadas(1, 30)).toBe("1 comprobante por cargar tiene 30 días o más.");
    expect(textoMarcadas(0, 30)).toBe("Ningún comprobante por cargar tiene 30 días o más.");
    expect(textoMarcadas(2, 1)).toBe("2 comprobantes por cargar tienen 1 día o más.");
  });

  it("al cambiar el umbral se anuncia la cantidad; al cambiar la fecha, la fecha y la cantidad", () => {
    expect(anuncioUmbral(15, 2)).toBe("2 comprobantes por cargar tienen 15 días o más.");
    expect(anuncioReferencia({ fecha: "2026-11-30", origen: "manual" }, 30, 1)).toBe(
      "Fecha de referencia: 30/11/2026 (elegida por usted). 1 comprobante por cargar tiene 30 días o más.",
    );
  });

  it("contarAntiguas cuenta solo lo que falta cargar y llega al umbral (inclusive); las duplicadas no", () => {
    const filas = planilla(
      { nroCmp: 1, fecha: "2026-10-12" }, // 31 días: marcada
      { nroCmp: 2, fecha: "2026-10-13" }, // 30 días: marcada (inclusive)
      { nroCmp: 3, fecha: "2026-10-14" }, // 29 días: no
      { nroCmp: 1, fecha: "2026-10-12" }, // duplicada de la primera
      { nroCmp: 5, fecha: "" }, // sin fecha: queda "revisar"
    );
    const c = conciliar(filas, [], HOY);
    expect(contarAntiguas(filas, c.porFila, "2026-11-12", 30)).toBe(2);
    expect(contarAntiguas(filas, c.porFila, "2026-11-12", 31)).toBe(1);
    expect(contarAntiguas(filas, c.porFila, "2026-11-12", 1)).toBe(3);
  });
});

describe("M1: cambiar de paso en la guía se anuncia", () => {
  it("dice el número y el título del paso", () => {
    expect(textoAnuncioPaso(2)).toBe("Paso 2 de 4: Sume lo ya cargado");
    expect(textoAnuncioPaso(4)).toBe("Paso 4 de 4: Revise, corrija y exporte");
  });
});
