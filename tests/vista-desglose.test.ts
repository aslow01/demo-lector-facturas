// Lo que la interfaz dice del desglose: en el aviso de registro cargado y en el resumen del control.

import { describe, expect, it } from "vitest";
import { leerRegistro, type LecturaRegistro } from "../src/conciliacion.ts";
import { resumenControl, textoDetalleResumenControl, type ObservacionVista } from "../src/vista-control.ts";
import { textoRegistroCargado } from "../src/vista.ts";

const CUIT = "30990000014";

function leer(...lineas: string[]): LecturaRegistro {
  const r = leerRegistro(`CUIT;Tipo;Punto de venta;Número;Importe;Neto;IVA\n${lineas.join("\n")}\n`);
  if (r instanceof Error) throw r;
  return r;
}

const error: ObservacionVista = { severidad: "error", mensaje: "x" };

describe("aviso de registro cargado", () => {
  it("sin desglose queda igual que siempre", () => {
    expect(textoRegistroCargado("registro.csv", leer(`${CUIT};1;5;1;1,00;;`))).toBe("Registro cargado (registro.csv): 1 comprobante.");
  });

  it("con desglose, lo dice al final", () => {
    expect(textoRegistroCargado("registro.csv", leer(`${CUIT};1;5;1;1,00;1;0`, `${CUIT};1;5;2;2,00;;`))).toBe(
      "Registro cargado (registro.csv): 2 comprobantes. El desglose (neto, IVA, otros o vencimiento del CAE) viene en 1 comprobante.",
    );
    expect(textoRegistroCargado("ejemplo", leer(`${CUIT};1;5;1;1,00;1;0`, `${CUIT};1;5;2;2,00;1;0`))).toBe(
      "Registro de ejemplo cargado: 2 comprobantes. El desglose (neto, IVA, otros o vencimiento del CAE) viene en 2 comprobantes.",
    );
  });

  it("con claves repetidas también va al final", () => {
    expect(textoRegistroCargado("r.csv", leer(`${CUIT};1;5;1;1,00;1;0`, `${CUIT};1;5;1;1,00;1;0`))).toBe(
      "Registro cargado (r.csv): 1 comprobante distinto en 2 líneas; 1 figura más de una vez. El desglose (neto, IVA, otros o vencimiento del CAE) viene en 1 comprobante.",
    );
  });
});

describe("resumen del control con desglose", () => {
  it("cuenta las filas que tienen desglose y lo dice en la segunda línea", () => {
    const filas = [
      { controlada: true, conDesglose: true, observaciones: [error] },
      { controlada: true, conDesglose: true, observaciones: [] },
      { controlada: true, observaciones: [] },
    ];
    expect(resumenControl(filas)).toMatchObject({ controladas: 3, conDesglose: 2 });
    expect(textoDetalleResumenControl(resumenControl(filas))).toBe("1 con error · 2 con desglose informado");
  });

  it("una fila sin QR no cuenta como con desglose", () => {
    expect(resumenControl([{ controlada: false, conDesglose: true, observaciones: [] }]).conDesglose).toBe(0);
  });

  it("sin desglose en ninguna fila, el texto no cambia", () => {
    expect(textoDetalleResumenControl(resumenControl([{ controlada: true, observaciones: [] }]))).toBe("");
  });
});
