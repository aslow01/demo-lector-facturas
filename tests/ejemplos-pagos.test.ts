// Ejemplo ficticio de pagos: un extracto coherente con las facturas de ejemplo de la demo, con un caso sembrado por cada resultado.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FECHA_REFERENCIA_EJEMPLO } from "../src/antiguedad.ts";
import { cuitValido } from "../src/cuit.ts";
import { conciliarPagos, facturasDeFilas, type ConciliacionPagos } from "../src/cuentas-a-pagar.ts";
import { CUIT_FICTICIOS, generarEjemplosCompletos } from "../src/ejemplos.ts";
import { CUIT_SIN_FACTURAS_FICTICIO, USUARIOS_FICTICIOS, extractoEjemplo } from "../src/ejemplos-pagos.ts";
import { leerExtracto, type LecturaExtracto } from "../src/extracto.ts";
import { crearFila, type Fila } from "../src/planilla.ts";
import { leerUrlQr } from "../src/qr-arca.ts";

const HOY = new Date(2026, 10, 17, 12);

function filasDelEjemplo(): Fila[] {
  return generarEjemplosCompletos(HOY).map((e, i) => {
    if (e.url === null) return crearFila(i + 1, e.origen, null);
    const c = leerUrlQr(e.url);
    if (c instanceof Error) throw c;
    return crearFila(i + 1, e.origen, c);
  });
}

function extracto(): LecturaExtracto {
  const r = leerExtracto(extractoEjemplo());
  if (r instanceof Error) throw r;
  return r;
}

function conciliacion(): ConciliacionPagos {
  const { facturas } = facturasDeFilas(filasDelEjemplo());
  return conciliarPagos(facturas, extracto().pagos, { hoy: FECHA_REFERENCIA_EJEMPLO });
}

/** `línea → estado/regla` de cada pago. */
function porLinea(c: ConciliacionPagos): Record<number, string> {
  return Object.fromEntries(c.pagos.map((r) => [r.pago.linea, `${r.estado}/${r.regla ?? "-"}`]));
}

describe("extracto de ejemplo", () => {
  it("se lee entero: diez pagos, con CUIT y con los dos usuarios, sin líneas ilegibles", () => {
    const e = extracto();
    expect(e.lineasInvalidas).toEqual([]);
    expect(e.tieneUsuarios).toBe(true);
    expect(e.pagos).toHaveLength(10);
    for (const p of e.pagos) expect(cuitValido(p.cuit)).toBe(true);
  });

  it("solo nombra proveedores inventados de la demo y usuarios ficticios", () => {
    const proveedores = new Set<string>([...Object.values(CUIT_FICTICIOS), CUIT_SIN_FACTURAS_FICTICIO]);
    const usuarios = new Set<string>(USUARIOS_FICTICIOS);
    for (const p of extracto().pagos) {
      expect(proveedores.has(p.cuit)).toBe(true);
      expect(usuarios.has(p.cargo)).toBe(true);
      expect(usuarios.has(p.autorizo)).toBe(true);
    }
    expect(extractoEjemplo()).not.toMatch(/@/);
  });

  it("el archivo ejemplos/extracto-pagos.csv es el que genera `npm run ejemplos`", () => {
    const enDisco = new TextDecoder().decode(readFileSync(new URL("../ejemplos/extracto-pagos.csv", import.meta.url))).replace(/^\uFEFF/, "");
    // Los fines de línea dependen de cómo git haya bajado el archivo: se comparan sin ellos.
    expect(enDisco.replace(/\r\n/g, "\n")).toBe(extractoEjemplo().replace(/\r\n/g, "\n"));
  });

  it("el CUIT de la empresa sin facturas no está en ninguna factura de ejemplo", () => {
    const { facturas } = facturasDeFilas(filasDelEjemplo());
    expect(facturas.some((f) => f.cuit === CUIT_SIN_FACTURAS_FICTICIO)).toBe(false);
  });
});

describe("el ejemplo contra las facturas de ejemplo", () => {
  it("toma 16 de las 21 filas: deja afuera los duplicados, la factura en dólares, la de total cero y la sin QR", () => {
    const { facturas, omitidas } = facturasDeFilas(filasDelEjemplo());
    expect(facturas).toHaveLength(16);
    expect(omitidas.map((o) => o.id)).toEqual([4, 5, 9, 11, 21]);
  });

  it("cada pago cae donde se sembró", () => {
    expect(porLinea(conciliacion())).toEqual({
      2: "emparejado/referencia", // cuota 1 de una factura de 61.750
      3: "emparejado/referencia", // referencia y importe exactos
      4: "emparejado/importe-exacto", // "Varios", por CUIT e importe (y con el mismo usuario en los dos pasos)
      5: "emparejado/importe-exacto", // la referencia tiene un dígito cambiado
      6: "emparejado/referencia", // una referencia a dos facturas
      7: "emparejado/suma-de-facturas", // sin referencia, suma de dos facturas
      8: "emparejado/referencia", // cuota 2
      9: "revisar/-", // ninguna factura coincide: no se sabe a cuál
      10: "sin-factura/-",
      11: "duplicado/-", // el mismo pago, otra vez
    });
  });

  it("el estado de las facturas: siete pagadas, una parcial y ocho impagas", () => {
    const c = conciliacion();
    const ids = (e: string): number[] => c.facturas.filter((s) => s.estado === e).map((s) => s.factura.id);
    expect(ids("pagada")).toEqual([1, 2, 7, 12, 14, 15, 17]);
    expect(ids("parcial")).toEqual([13]);
    expect(ids("impaga")).toEqual([3, 6, 8, 10, 16, 18, 19, 20]);
    expect(c.facturas.find((s) => s.factura.id === 13)).toMatchObject({ pagado: 40000, saldo: 21750, pagos: [2, 8] });
  });

  it("la impaga más antigua es la que pasa el umbral con la fecha de referencia del ejemplo", () => {
    const c = conciliacion();
    expect(c.impagas[0]).toMatchObject({ factura: { id: 3 }, dias: 34, antigua: true });
    expect(c.resumen.antiguas).toBe(1);
  });

  it("lo que queda para revisar nombra las cuatro facturas abiertas del proveedor", () => {
    const r = conciliacion().paraRevisar[0];
    expect(r?.pago.linea).toBe(9);
    expect(r?.candidatas).toEqual([6, 13, 16, 19]);
  });

  it("el duplicado apunta al pago original y no resta saldo dos veces", () => {
    const c = conciliacion();
    expect(c.duplicados[0]).toMatchObject({ duplicadoDe: 3, imputaciones: [] });
    expect(c.facturas.find((s) => s.factura.id === 1)).toMatchObject({ estado: "pagada", pagado: 118470.5, pagos: [3] });
  });

  it("el único aviso de control interno es el del pago de la línea 4", () => {
    const c = conciliacion();
    expect(c.avisos.map((a) => [a.linea, a.codigo])).toEqual([[4, "mismo-usuario"]]);
  });

  it("el resumen cierra", () => {
    const r = conciliacion().resumen;
    expect(r).toMatchObject({ facturas: 16, pagadas: 7, parciales: 1, impagas: 8, pagos: 10, emparejados: 7, sinFactura: 1, duplicados: 1, paraRevisar: 1, conAvisoDeControl: 1 });
    expect(r.importeFacturado - r.importePagado).toBeCloseTo(r.saldoPendiente + 0, 2);
    expect(r.importeSinFactura).toBe(18000);
  });

  it("cada emparejamiento se explica, sin hablar de impuestos", () => {
    const c = conciliacion();
    expect(c.emparejamientos.length).toBeGreaterThan(0);
    for (const e of c.emparejamientos) {
      expect(e.porQue.length).toBeGreaterThan(20);
      expect(e.porQue).not.toMatch(/retenci|percepci|al[ií]cuota|IVA/i);
    }
    for (const r of c.pagos) expect(r.porQue).not.toBe("");
  });
});
