import { describe, expect, it } from "vitest";
import type { Comprobante } from "../src/comprobante.ts";
import { BOM, ENCABEZADOS, aCsv, celdaNumero, celdaTexto } from "../src/csv.ts";
import type { Resultado } from "../src/conciliacion.ts";
import { nombreSeveridad, observacionesDeFila } from "../src/vista-control.ts";
import { agregarFila, crearFila, editarFila, siguienteId, type Fila } from "../src/planilla.ts";

const HOY = new Date(2026, 10, 17, 12);

function dato(cambios: Partial<Comprobante> = {}): Comprobante {
  return {
    ver: 1,
    fecha: "2026-10-05",
    cuit: "30990000014",
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1245,
    importe: 118470.5,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: null,
    nroDocRec: "",
    tipoCodAut: "E",
    codAut: "70000000007919",
    ...cambios,
  };
}

function una(origen: string, d: Partial<Comprobante> | null = {}): Fila[] {
  return [crearFila(1, origen, d === null ? null : dato(d))];
}

function lineas(csv: string): string[] {
  return csv.replace(BOM, "").split("\r\n").filter((l) => l !== "");
}

describe("celdaTexto: escape", () => {
  it("deja intacto el texto simple", () => {
    expect(celdaTexto("Factura A")).toBe("Factura A");
    expect(celdaTexto("")).toBe("");
  });
  it("entrecomilla si hay separador, comillas o saltos de línea, y duplica las comillas", () => {
    expect(celdaTexto("a;b")).toBe('"a;b"');
    expect(celdaTexto('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(celdaTexto("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
    expect(celdaTexto("a\r\nb")).toBe('"a\r\nb"');
  });
  it("no entrecomilla la coma, que no es separador", () => {
    expect(celdaTexto("1,5")).toBe("1,5");
  });
});

describe("celdaTexto: inyección de fórmulas", () => {
  it("antepone ' a lo que empieza con =, +, -, @, tabulación o retorno de carro", () => {
    expect(celdaTexto("=1+1")).toBe("'=1+1");
    expect(celdaTexto("+54911")).toBe("'+54911");
    expect(celdaTexto("-2+3")).toBe("'-2+3");
    expect(celdaTexto("@SUMA(A1)")).toBe("'@SUMA(A1)");
    expect(celdaTexto("\t=1")).toBe("'\t=1");
    expect(celdaTexto("\r=1")).toBe("\"'\r=1\"");
  });
  it("combina la protección con el escape", () => {
    expect(celdaTexto('=HYPERLINK("http://x";"y")')).toBe('"\'=HYPERLINK(""http://x"";""y"")"');
  });
  it("no toca un signo que no está al principio", () => {
    expect(celdaTexto("a=b")).toBe("a=b");
    expect(celdaTexto("30-99000001-4")).toBe("30-99000001-4");
  });
  it("protege el origen de la fila (el nombre del archivo lo controla el usuario)", () => {
    const csv = aCsv(una("=cmd|' /C calc'!A0.pdf"), HOY);
    const fila = lineas(csv)[1] as string;
    expect(fila.startsWith("'=cmd")).toBe(true);
  });
  it("protege los campos editados a mano", () => {
    let filas = una("a.pdf", null);
    filas = editarFila(filas, 1, "moneda", "PES") as Fila[];
    const csv = aCsv(filas, HOY);
    expect(csv).not.toMatch(/;=/);
  });
  it("ninguna celda de texto del CSV puede empezar con un carácter de fórmula", () => {
    const filas = una("+hostil.pdf");
    const csv = aCsv(filas, HOY);
    for (const celda of (lineas(csv)[1] as string).split(";")) {
      expect(celda).not.toMatch(/^[=+@]/);
    }
  });
});

describe("celdaNumero", () => {
  it("usa coma decimal, dos decimales y sin separador de miles", () => {
    expect(celdaNumero(118470.5)).toBe("118470,50");
    expect(celdaNumero(0)).toBe("0,00");
    expect(celdaNumero(-9350.25)).toBe("-9350,25");
  });
  it("deja vacío lo que no es un número", () => {
    expect(celdaNumero(null)).toBe("");
    expect(celdaNumero(Number.NaN)).toBe("");
  });
});

describe("aCsv", () => {
  it("empieza con BOM UTF-8 y usa ; como separador y CRLF como fin de línea", () => {
    const csv = aCsv(una("a.pdf"), HOY);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(lineas(csv)[0]).toBe(ENCABEZADOS.join(";"));
  });

  it("formatea la fila con CUIT con guiones, tipo en palabras, fecha DD/MM/AAAA e importe con coma", () => {
    const csv = aCsv(una("factura.pdf"), HOY);
    expect(lineas(csv)[1]).toBe(
      ["factura.pdf", "Leída", "", "No", "No", "30-99000001-4", "Factura A", "3", "1245", "05/10/2026", "PES", "118470,50", "118470,50", "70000000007919", ""].join(";"),
    );
  });

  it("termina con la columna 'Conciliación', vacía si no hay registro", () => {
    expect(ENCABEZADOS[ENCABEZADOS.length - 1]).toBe("Conciliación");
    const cols = (lineas(aCsv(una("a.pdf"), HOY))[1] as string).split(";");
    expect(cols).toHaveLength(ENCABEZADOS.length);
    expect(cols[ENCABEZADOS.length - 1]).toBe("");
  });

  it("con registro, escribe el resultado de cada fila y deja vacía la que no tiene resultado", () => {
    const filas = [...una("a.pdf"), crearFila(2, "b.pdf", dato({ nroCmp: 1246 }))];
    const porFila = new Map<number, Resultado>([
      [1, { tipo: "falta" }],
      [2, { tipo: "otro-importe", importeFila: 100, importeRegistro: 90.5 }],
    ]);
    const [, a, b] = lineas(aCsv(filas, HOY, porFila)) as [string, string, string];
    expect(a.split(";")[ENCABEZADOS.length - 1]).toBe("Falta cargar");
    expect(b.split(";")[ENCABEZADOS.length - 1]).toBe("Mal cargada: otro importe (Planilla: 100,00. Sistema: 90,50. Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos)");
    const sinResultado = lineas(aCsv(filas, HOY, new Map([[1, { tipo: "ya-cargada" } as Resultado]])))[2] as string;
    expect(sinResultado.endsWith(";")).toBe(true);
  });

  it("el resultado pasa por la misma protección de celdas (columnas parejas y sin fórmulas)", () => {
    const porFila = new Map<number, Resultado>([[1, { tipo: "otro-emisor", cuitRegistro: "30990000014" }]]);
    const fila = lineas(aCsv(una("a.pdf"), HOY, porFila))[1] as string;
    expect(fila.split(";")).toHaveLength(ENCABEZADOS.length);
    expect(fila.endsWith("Mal cargada: otro emisor (En el sistema figura con el CUIT 30-99000001-4. Dé de baja la carga en el sistema y vuelva a cargarla con los datos correctos)")).toBe(true);
  });

  it("tiene el mismo número de columnas en todas las filas, también con texto con ;", () => {
    const csv = aCsv([...una("a;b.pdf"), crearFila(2, "sin.pdf", null, "nota; con \"comillas\"")], HOY);
    for (const l of lineas(csv)) {
      // se cuentan los separadores fuera de comillas
      let dentro = false;
      let separadores = 0;
      for (const ch of l) {
        if (ch === '"') dentro = !dentro;
        else if (ch === ";" && !dentro) separadores++;
      }
      expect(separadores).toBe(ENCABEZADOS.length - 1);
    }
  });

  it("marca el estado 'Revisar' con sus avisos y 'Sin QR' con filas vacías", () => {
    const filas = [crearFila(1, "mala.pdf", dato({ importe: 0 })), crearFila(2, "nada.pdf", null)];
    const [, revisar, sinQr] = lineas(aCsv(filas, HOY)) as [string, string, string];
    expect(revisar).toContain("Revisar");
    expect(revisar).toContain("El total es cero.");
    expect(sinQr.startsWith("nada.pdf;Sin QR;")).toBe(true);
  });

  it("cada observación del control lleva su gravedad y dice lo mismo que la pantalla", () => {
    const filas = [crearFila(1, "mala.pdf", dato({ fecha: "2026-12-28", importe: 0, codAut: "123" }))];
    const [, fila] = lineas(aCsv(filas, HOY)) as [string, string];
    const avisos = fila.split(";")[2];
    expect(avisos).toBe("Error: La fecha de emisión es futura. Error: El CAE debe tener 14 dígitos. Aviso: El total es cero.");
    const enPantalla = observacionesDeFila(filas[0] as Fila, HOY).map((o) => `${nombreSeveridad(o.severidad)}: ${o.mensaje}`);
    expect(avisos).toBe(enPantalla.join(" "));
  });

  it("la nota de la fila va sin prefijo, antes de las observaciones", () => {
    const filas = [crearFila(1, "mala.pdf", dato({ importe: 0 }), "Nota de la lectura.")];
    expect(lineas(aCsv(filas, HOY))[1]?.split(";")[2]).toBe("Nota de la lectura. Aviso: El total es cero.");
  });

  it("marca los duplicados y deja vacío su importe en el total", () => {
    let filas: Fila[] = [];
    filas = agregarFila(filas, crearFila(siguienteId(filas), "a.pdf", dato()));
    filas = agregarFila(filas, crearFila(siguienteId(filas), "b.pdf", dato()));
    const [, primera, segunda] = lineas(aCsv(filas, HOY)) as [string, string, string];
    const p = primera.split(";");
    const s = segunda.split(";");
    expect(p[3]).toBe("No");
    expect(s[3]).toBe("Sí");
    expect(p[12]).toBe("118470,50");
    expect(s[11]).toBe("118470,50");
    expect(s[12]).toBe("");
  });

  it("las notas de crédito salen con signo negativo en el importe en el total", () => {
    const [, nc] = lineas(aCsv(una("nc.pdf", { tipoCmp: 3, importe: 9350.25 }), HOY)) as [string, string];
    const c = nc.split(";");
    expect(c[6]).toBe("Nota de crédito A");
    expect(c[11]).toBe("9350,25");
    expect(c[12]).toBe("-9350,25");
  });

  it("marca las filas editadas a mano", () => {
    const filas = editarFila(una("a.pdf"), 1, "importe", "10") as Fila[];
    const cols = (lineas(aCsv(filas, HOY))[1] as string).split(";");
    expect(cols[4]).toBe("Sí");
    expect(cols[11]).toBe("10,00");
  });

  it("sin filas devuelve solo el encabezado", () => {
    expect(lineas(aCsv([], HOY))).toEqual([ENCABEZADOS.join(";")]);
  });
});
