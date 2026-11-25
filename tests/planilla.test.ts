import { describe, expect, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import {
  agregarFila,
  crearFila,
  duplicadas,
  editarFila,
  estadoFila,
  quitarFila,
  resumen,
  siguienteId,
  totalesPorMoneda,
  type Fila,
} from "../src/planilla.ts";

const HOY = new Date(2026, 10, 17);

function dato(cambios: Partial<Comprobante> = {}): Comprobante {
  return {
    ver: 1,
    fecha: "2026-10-05",
    cuit: "30990000014",
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1245,
    importe: 1000,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: null,
    nroDocRec: "",
    tipoCodAut: "E",
    codAut: "70000000007919",
    ...cambios,
  };
}

function planilla(...datos: Array<Partial<Comprobante> | null>): Fila[] {
  let filas: Fila[] = [];
  for (const d of datos) {
    filas = agregarFila(filas, crearFila(siguienteId(filas), `archivo-${filas.length + 1}.pdf`, d === null ? null : dato(d)));
  }
  return filas;
}

describe("agregar y quitar", () => {
  it("agrega filas con ids nuevos sin modificar la lista original", () => {
    const a = planilla({});
    const b = agregarFila(a, crearFila(siguienteId(a), "otra.pdf", dato({ nroCmp: 1 })));
    expect(a).toHaveLength(1);
    expect(b.map((f) => f.id)).toEqual([1, 2]);
  });
  it("quita por id", () => {
    const a = planilla({}, { nroCmp: 2 });
    expect(quitarFila(a, 1).map((f) => f.id)).toEqual([2]);
    expect(quitarFila(a, 99)).toHaveLength(2);
  });
  it("una fila sin QR arranca vacía y es 'sin-qr'", () => {
    const [f] = planilla(null);
    expect(f?.conQr).toBe(false);
    expect(f?.datos).toEqual(comprobanteVacio());
    expect(f && estadoFila(f, HOY).estado).toBe("sin-qr");
  });
});

describe("duplicados", () => {
  it("marca la segunda aparición y deja la primera como original", () => {
    const filas = planilla({}, { nroCmp: 2 }, {});
    expect([...duplicadas(filas)]).toEqual([[3, 1]]);
  });
  it("detecta duplicados aunque cambien el importe, la fecha o el CAE", () => {
    const filas = planilla({}, { importe: 5, fecha: "2026-01-01", codAut: "9" });
    expect(duplicadas(filas).size).toBe(1);
  });
  it("no marca como duplicadas las filas sin datos suficientes", () => {
    const filas = planilla(null, null, { nroCmp: null }, { nroCmp: null });
    expect(duplicadas(filas).size).toBe(0);
  });
  it("distingue emisores, tipos y puntos de venta", () => {
    const filas = planilla({}, { cuit: "33990002016" }, { tipoCmp: 6 }, { ptoVta: 4 });
    expect(duplicadas(filas).size).toBe(0);
  });
  it("recalcula al editar: corregir el número deshace el duplicado", () => {
    const filas = planilla({}, {});
    expect(duplicadas(filas).size).toBe(1);
    const editadas = editarFila(filas, 2, "nroCmp", "1246");
    expect(editadas).not.toBeInstanceOf(Error);
    expect(duplicadas(editadas as Fila[]).size).toBe(0);
  });
});

describe("editar a mano", () => {
  it("cambia el valor y marca el campo como editado por el usuario", () => {
    const filas = planilla({});
    const r = editarFila(filas, 1, "importe", "2.500,75") as Fila[];
    expect(r[0]?.datos.importe).toBe(2500.75);
    expect(r[0]?.editados).toEqual(["importe"]);
    expect(filas[0]?.datos.importe).toBe(1000);
    expect(filas[0]?.editados).toEqual([]);
  });
  it("no repite el campo en la lista de editados", () => {
    let filas = planilla({});
    filas = editarFila(filas, 1, "importe", "10") as Fila[];
    filas = editarFila(filas, 1, "importe", "20") as Fila[];
    expect(filas[0]?.editados).toEqual(["importe"]);
  });
  it("no marca como editado si el valor no cambia", () => {
    const filas = planilla({});
    const r = editarFila(filas, 1, "cuit", "30-99000001-4") as Fila[];
    expect(r[0]?.editados).toEqual([]);
  });
  it("interpreta cada campo", () => {
    let filas = planilla(null);
    filas = editarFila(filas, 1, "cuit", "30-99000001-4") as Fila[];
    filas = editarFila(filas, 1, "tipoCmp", "6") as Fila[];
    filas = editarFila(filas, 1, "ptoVta", "0002") as Fila[];
    filas = editarFila(filas, 1, "nroCmp", "00000031") as Fila[];
    filas = editarFila(filas, 1, "fecha", "05/10/2026") as Fila[];
    filas = editarFila(filas, 1, "moneda", "dol") as Fila[];
    filas = editarFila(filas, 1, "importe", "10,5") as Fila[];
    filas = editarFila(filas, 1, "codAut", "7000 0000 0079 19") as Fila[];
    const d = filas[0]?.datos;
    expect(d).toMatchObject({
      cuit: "30990000014",
      tipoCmp: 6,
      ptoVta: 2,
      nroCmp: 31,
      fecha: "2026-10-05",
      moneda: "DOL",
      importe: 10.5,
      codAut: "70000000007919",
    });
    expect(filas[0]?.editados).toHaveLength(8);
    // sigue 'sin QR' aunque se complete a mano
    expect(filas[0] && estadoFila(filas[0], HOY).estado).toBe("sin-qr");
  });
  it("permite vaciar una celda", () => {
    const r = editarFila(planilla({}), 1, "importe", "  ") as Fila[];
    expect(r[0]?.datos.importe).toBeNull();
  });
  it("rechaza valores inválidos con un Error y no cambia nada", () => {
    const filas = planilla({});
    for (const [campo, texto] of [
      ["cuit", "abc"],
      ["tipoCmp", "-1"],
      ["ptoVta", "1,5"],
      ["nroCmp", "x"],
      ["fecha", "31/02/2026"],
      ["moneda", "DÓLARES"],
      ["importe", "=1+1"],
      ["codAut", "12ab"],
    ] as const) {
      expect(editarFila(filas, 1, campo, texto)).toBeInstanceOf(Error);
    }
    expect(editarFila(filas, 99, "importe", "1")).toBeInstanceOf(Error);
  });
  it("una edición puede resolver un estado 'revisar'", () => {
    let filas = planilla({ cuit: "30990000015" });
    expect(estadoFila(filas[0] as Fila, HOY).estado).toBe("revisar");
    filas = editarFila(filas, 1, "cuit", "30990000014") as Fila[];
    expect(estadoFila(filas[0] as Fila, HOY).estado).toBe("leida");
  });
});

describe("totales por moneda", () => {
  it("suma por moneda y cuenta los comprobantes", () => {
    const filas = planilla({ importe: 100.1 }, { nroCmp: 2, importe: 200.2 }, { nroCmp: 3, moneda: "DOL", importe: 50 });
    expect(totalesPorMoneda(filas)).toEqual([
      { moneda: "DOL", nombre: "Dólares (DOL)", total: 50, cantidad: 1 },
      { moneda: "PES", nombre: "Pesos (PES)", total: 300.3, cantidad: 2 },
    ]);
  });
  it("no acumula errores de coma flotante", () => {
    const filas = planilla({ nroCmp: 1, importe: 0.1 }, { nroCmp: 2, importe: 0.2 });
    expect(totalesPorMoneda(filas)[0]?.total).toBe(0.3);
  });
  it("no suma dos veces los duplicados", () => {
    const filas = planilla({ importe: 100 }, { importe: 100 }, { nroCmp: 2, importe: 50 });
    expect(totalesPorMoneda(filas)).toEqual([{ moneda: "PES", nombre: "Pesos (PES)", total: 150, cantidad: 2 }]);
  });
  it("las notas de crédito restan y las de débito suman", () => {
    const filas = planilla(
      { nroCmp: 1, importe: 1000 },
      { nroCmp: 2, tipoCmp: 3, importe: 250 },
      { nroCmp: 3, tipoCmp: 8, importe: 50 },
      { nroCmp: 4, tipoCmp: 13, importe: 10 },
      { nroCmp: 5, tipoCmp: 2, importe: 5 },
    );
    expect(totalesPorMoneda(filas)[0]?.total).toBe(695);
  });
  it("ignora las filas sin importe y agrupa la moneda vacía al final", () => {
    const filas = planilla(null, { nroCmp: 1, importe: null }, { nroCmp: 2, moneda: "", importe: 7 }, { nroCmp: 3, importe: 1 });
    const t = totalesPorMoneda(filas);
    expect(t.map((x) => x.moneda)).toEqual(["PES", ""]);
    expect(t[1]?.nombre).toBe("Sin moneda");
  });
  it("es vacío sin filas", () => {
    expect(totalesPorMoneda([])).toEqual([]);
  });
});

describe("resumen", () => {
  it("cuenta cada estado, los duplicados y las editadas", () => {
    let filas = planilla({}, { nroCmp: 2 }, { cuit: "1" }, null, {});
    filas = editarFila(filas, 2, "importe", "5") as Fila[];
    expect(resumen(filas, HOY)).toEqual({ total: 5, leidas: 3, revisar: 1, sinQr: 1, duplicadas: 1, editadas: 1 });
  });
});
