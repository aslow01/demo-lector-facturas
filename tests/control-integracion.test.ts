import { describe, expect, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import { conciliar } from "../src/conciliacion.ts";
import { ENCABEZADOS, aCsv } from "../src/csv.ts";
import type { Desglose } from "../src/control.ts";
import { agregarFila, crearFila, editarFila, estadoFila, resumen, type Fila } from "../src/planilla.ts";

const HOY = new Date(2026, 10, 17, 12);

function comprobante(cambios: Partial<Comprobante> = {}): Comprobante {
  return {
    ...comprobanteVacio(),
    ver: 1,
    fecha: "2026-10-05",
    cuit: "30990000014",
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1245,
    importe: 1210,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: 80,
    nroDocRec: "20123456786",
    tipoCodAut: "E",
    codAut: "70000000007919",
    ...cambios,
  };
}

const CUADRA: Desglose = { neto: 1000, iva: 210, otros: 0, vencimientoCae: "2026-10-15" };

function fila(id: number, cambios: Partial<Comprobante> = {}, desglose?: Desglose): Fila {
  const f = crearFila(id, `factura-${id}.pdf`, comprobante(cambios), "", "", desglose);
  return f;
}

describe("estado de la fila con el control del comprobante", () => {
  it("una fila sin desglose y con datos coherentes sigue leída, y no gana ninguna propiedad", () => {
    const f = fila(1);
    expect(f).not.toHaveProperty("desglose");
    expect(estadoFila(f, HOY)).toEqual({ estado: "leida", motivos: [] });
  });

  it("una fila con desglose que cuadra queda leída", () => {
    expect(estadoFila(fila(1, {}, CUADRA), HOY)).toEqual({ estado: "leida", motivos: [] });
  });

  it("el total que no cierra deja la fila en Revisar y dice la diferencia", () => {
    const { estado, motivos } = estadoFila(fila(1, { importe: 1210.05 }, CUADRA), HOY);
    expect(estado).toBe("revisar");
    expect(motivos).toHaveLength(1);
    expect(motivos[0]).toContain("$ 0,05");
  });

  it("un CAE de otro largo deja la fila en Revisar aunque no haya desglose", () => {
    const { estado, motivos } = estadoFila(fila(1, { codAut: "123" }), HOY);
    expect(estado).toBe("revisar");
    expect(motivos).toEqual(["El CAE debe tener 14 dígitos."]);
  });

  it("el CUIT del receptor inválido deja la fila en Revisar", () => {
    const { estado, motivos } = estadoFila(fila(1, { nroDocRec: "20123456787" }), HOY);
    expect(estado).toBe("revisar");
    expect(motivos).toEqual(["El CUIT del receptor tiene el dígito verificador inválido."]);
  });

  it("no repite lo que ya decía el estado: CUIT del emisor y fecha futura salen una sola vez", () => {
    const { motivos } = estadoFila(fila(1, { cuit: "30990000015", fecha: "2026-12-01" }), HOY);
    expect(motivos).toEqual(["El CUIT del emisor tiene el dígito verificador inválido.", "La fecha de emisión es futura."]);
  });

  it("los motivos de siempre van primero y los del control después", () => {
    const { motivos } = estadoFila(fila(1, { importe: 0, codAut: "123" }), HOY);
    expect(motivos).toEqual(["El total es cero.", "El CAE debe tener 14 dígitos."]);
  });

  it("una fila sin QR sigue sin QR aunque tenga desglose", () => {
    const sinQr = crearFila(1, "foto.jpg", null, "", "", { neto: 5, iva: 0, otros: 0, vencimientoCae: "" });
    expect(estadoFila(sinQr, HOY).estado).toBe("sin-qr");
  });

  it("un duplicado sigue leído: se marca con su sello, no como Revisar", () => {
    const filas = agregarFila([fila(1)], fila(2));
    expect(estadoFila(filas[1] as Fila, HOY).estado).toBe("leida");
    expect(resumen(filas, HOY)).toMatchObject({ leidas: 2, revisar: 0, duplicadas: 1 });
  });

  it("editar un campo conserva el desglose", () => {
    const editadas = editarFila([fila(1, {}, CUADRA)], 1, "importe", "1.210,07");
    expect(editadas).not.toBeInstanceOf(Error);
    const f = (editadas as Fila[])[0] as Fila;
    expect(f.desglose).toEqual(CUADRA);
    expect(estadoFila(f, HOY).estado).toBe("revisar");
  });

  it("corregir el total a mano hace que cuadre otra vez", () => {
    const editadas = editarFila([fila(1, { importe: 1210.5 }, CUADRA)], 1, "importe", "1.210,00") as Fila[];
    expect(estadoFila(editadas[0] as Fila, HOY)).toEqual({ estado: "leida", motivos: [] });
  });
});

describe("exportación a CSV", () => {
  it("el control sale en la columna Avisos y las columnas no cambian", () => {
    expect(ENCABEZADOS).toHaveLength(15);
    const csv = aCsv([fila(1, { importe: 1210.05 }, CUADRA)], HOY);
    const [encabezado, linea] = csv.replace(/^﻿/, "").split("\r\n");
    const columnas = (encabezado as string).split(";");
    const celdas = (linea as string).split(";");
    expect(celdas).toHaveLength(columnas.length);
    expect(celdas[columnas.indexOf("Estado")]).toBe("Revisar");
    expect(celdas[columnas.indexOf("Avisos")]).toContain("difieren en $ 0,05");
  });

  it("una fila sana no tiene avisos", () => {
    const csv = aCsv([fila(1, {}, CUADRA)], HOY);
    const linea = csv.replace(/^﻿/, "").split("\r\n")[1] as string;
    expect(linea.split(";")[2]).toBe("");
  });
});

describe("conciliación", () => {
  it("un comprobante que no cuadra y no está en el sistema se revisa antes de cargarlo", () => {
    const registro = { registros: [], lineasInvalidas: [], lineasImporteExcesivo: [], clavesRepetidas: [], encabezadosDuplicados: [] };
    const c = conciliar([fila(1, { importe: 1300 }, CUADRA), fila(2, { nroCmp: 2 }, CUADRA)], registro.registros, HOY);
    expect(c.porFila.get(1)?.tipo).toBe("revisar");
    expect(c.porFila.get(2)?.tipo).toBe("falta");
  });
});
