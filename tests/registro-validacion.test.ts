// QA bajos de la etapa 3: B5 (el registro no acepta tipo 0, punto de venta 0 o de más de 5 dígitos, ni número 0),
// B2 (una clave repetida que nadie recibió va solo en "Cargadas dos veces") y B3 (qué cuenta "N comprobantes").

import { describe, expect, it } from "vitest";
import { esTipoConocido } from "../src/comprobante.ts";
import { conciliar, leerRegistro, lineasLeidas, resumenConciliacion, type LecturaRegistro } from "../src/conciliacion.ts";
import { textoRegistroCargado } from "../src/vista.ts";

const HOY = new Date(2026, 10, 17);
const CUIT = "30990000014";

function leer(...lineas: string[]): LecturaRegistro {
  const r = leerRegistro(`cuit;tipo;pv;nro;importe\n${lineas.join("\n")}\n`);
  if (r instanceof Error) throw r;
  return r;
}

describe("B5: el registro descarta claves imposibles", () => {
  it("tipo 0, punto de venta 0 y número 0 son líneas inválidas", () => {
    const r = leer(`${CUIT};0;5;7;700,00`, `${CUIT};1;0;7;700,00`, `${CUIT};1;5;0;700,00`);
    expect(r.registros).toEqual([]);
    expect(r.lineasInvalidas).toEqual([2, 3, 4]);
  });
  it("punto de venta de más de 5 dígitos es inválido; 99999 y 1 valen", () => {
    const r = leer(`${CUIT};1;100000;7;700,00`, `${CUIT};1;12345678901;7;700,00`, `${CUIT};1;99999;7;700,00`, `${CUIT};1;1;8;700,00`);
    expect(r.registros.map((x) => x.ptoVta)).toEqual([99999, 1]);
    expect(r.lineasInvalidas).toEqual([2, 3]);
  });
  it("una línea válida con ceros a la izquierda sigue valiendo", () => {
    expect(leer(`${CUIT};0001;0005;00000007;700,00`).registros).toHaveLength(1);
  });
});

describe("B2: la clave repetida que ninguna fila recibió va solo en la lista de 'cargadas dos veces'", () => {
  it("no figura también en 'cargadas en el sistema y no recibidas', ni suma al resumen", () => {
    const r = leer(`${CUIT};1;5;999;10,00`, `${CUIT};1;5;999;10,00`, `${CUIT};1;5;1000;20,00`);
    const c = conciliar([], r.registros, HOY);
    expect(c.soloEnRegistro.map((x) => x.nroCmp)).toEqual([1000]);
    const res = resumenConciliacion([], c, r.clavesRepetidas);
    expect(res.noRecibidas).toBe(1);
    expect(res.cargadasDosVeces).toBe(1);
  });
});

describe("B3: 'comprobantes' son claves distintas, no líneas", () => {
  it("lineasLeidas suma todas las copias", () => {
    expect(lineasLeidas(leer(`${CUIT};1;5;1;1,00`, `${CUIT};1;5;1;2,00`, `${CUIT};1;5;1;3,00`, `${CUIT};1;5;2;4,00`))).toBe(4);
  });
  it("sin claves repetidas, el aviso dice los comprobantes", () => {
    expect(textoRegistroCargado("registro.csv", leer(`${CUIT};1;5;1;1,00`, `${CUIT};1;5;2;2,00`))).toBe("Registro cargado (registro.csv): 2 comprobantes.");
    expect(textoRegistroCargado("ejemplo", leer(`${CUIT};1;5;1;1,00`))).toBe("Registro de ejemplo cargado: 1 comprobante.");
  });
  it("con claves repetidas, aclara cuántos son distintos, cuántas líneas hay y cuántos figuran de más", () => {
    const r = leer(`${CUIT};1;5;1;1,00`, `${CUIT};1;5;1;2,00`, `${CUIT};1;5;2;4,00`, `${CUIT};1;5;3;5,00`, `${CUIT};1;5;3;5,00`);
    expect(textoRegistroCargado("registro.csv", r)).toBe("Registro cargado (registro.csv): 3 comprobantes distintos en 5 líneas; 2 figuran más de una vez.");
    expect(textoRegistroCargado("registro.csv", leer(`${CUIT};1;5;1;1,00`, `${CUIT};1;5;1;2,00`))).toBe(
      "Registro cargado (registro.csv): 1 comprobante distinto en 2 líneas; 1 figura más de una vez.",
    );
  });
  it("las líneas grandes llevan separador de miles", () => {
    const lineas = Array.from({ length: 1500 }, (_, i) => `${CUIT};1;5;${i % 2 === 0 ? 1 : 2};${i + 1},00`);
    expect(textoRegistroCargado("grande.csv", leer(...lineas))).toBe("Registro cargado (grande.csv): 2 comprobantes distintos en 1.500 líneas; 2 figuran más de una vez.");
  });
});

describe("esTipoConocido", () => {
  it("solo los tipos con nombre; null y 0 no", () => {
    expect(esTipoConocido(1)).toBe(true);
    expect(esTipoConocido(213)).toBe(true);
    expect(esTipoConocido(99)).toBe(false);
    expect(esTipoConocido(0)).toBe(false);
    expect(esTipoConocido(null)).toBe(false);
  });
});
