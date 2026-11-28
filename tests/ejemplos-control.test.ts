// Ejemplos ficticios del control del comprobante: diez facturas más y un registro con el desglose que el QR no trae.
// El ejemplo base (generarEjemplos y registroEjemplo) no cambia: estas piezas se suman encima.

import { describe, expect, it } from "vitest";
import { conciliar, contarConDesglose, leerRegistro, resumenConciliacion, type LecturaRegistro } from "../src/conciliacion.ts";
import { controlarComprobante, type CodigoObservacion } from "../src/control.ts";
import { cuitValido } from "../src/cuit.ts";
import { conDesgloseDelRegistro } from "../src/desglose.ts";
import {
  CUIT_FICTICIOS,
  CUIT_RECEPTOR_FICTICIO,
  esOrigenDeEjemplo,
  generarEjemplos,
  generarEjemplosCompletos,
  generarEjemplosControl,
  registroEjemplo,
  registroEjemploCompleto,
} from "../src/ejemplos.ts";
import { crearFila, duplicadas, estadoFila, type Fila } from "../src/planilla.ts";
import { leerUrlQr } from "../src/qr-arca.ts";

const HOY = new Date(2026, 10, 17, 12);

function filasCompletas(): Fila[] {
  return generarEjemplosCompletos(HOY).map((e, i) => {
    if (e.url === null) return crearFila(i + 1, e.origen, null);
    const c = leerUrlQr(e.url);
    if (c instanceof Error) throw c;
    return crearFila(i + 1, e.origen, c);
  });
}

function registroCompleto(): LecturaRegistro {
  const r = leerRegistro(registroEjemploCompleto());
  if (r instanceof Error) throw r;
  return r;
}

function codigos(f: Fila): CodigoObservacion[] {
  return controlarComprobante(f.datos, f.desglose, HOY).map((o) => o.codigo);
}

describe("ejemplos del control: las facturas", () => {
  it("son diez, y siguen la numeración del ejemplo base (ejemplo-12.png a ejemplo-21.png)", () => {
    const base = generarEjemplos(HOY);
    const control = generarEjemplosControl(HOY);
    expect(control).toHaveLength(10);
    expect(control.map((e) => e.origen)).toEqual(Array.from({ length: 10 }, (_, i) => `ejemplo-${String(base.length + 1 + i).padStart(2, "0")}.png`));
    for (const e of control) expect(esOrigenDeEjemplo(e.origen)).toBe(true);
  });

  it("el ejemplo completo es el base seguido de los diez, y el base no cambió", () => {
    const completos = generarEjemplosCompletos(HOY);
    expect(completos).toHaveLength(21);
    expect(completos.slice(0, 11)).toEqual(generarEjemplos(HOY));
    expect(completos.slice(11)).toEqual(generarEjemplosControl(HOY));
  });

  it("es determinista, aunque se llame en otro orden", () => {
    const a = generarEjemplosControl(HOY);
    generarEjemplos(HOY);
    expect(generarEjemplosControl(HOY)).toEqual(a);
  });

  it("todas son QR de ARCA legibles y cada caso se explica sin nombrar empresas", () => {
    for (const e of generarEjemplosControl(HOY)) {
      expect(e.url).not.toBeNull();
      expect(leerUrlQr(e.url as string)).not.toBeInstanceOf(Error);
      expect(e.caso.length).toBeGreaterThan(20);
      expect(e.caso).not.toMatch(/Demo|S\.A\.|S\.R\.L\.|@/);
    }
  });

  it("el receptor es un CUIT ficticio con verificador válido y distinto de los emisores", () => {
    expect(cuitValido(CUIT_RECEPTOR_FICTICIO)).toBe(true);
    expect(Object.values(CUIT_FICTICIOS)).not.toContain(CUIT_RECEPTOR_FICTICIO);
  });
});

describe("ejemplos del control: el registro con desglose", () => {
  it("se lee sin líneas inválidas ni datos ilegibles, y 9 de sus líneas traen desglose", () => {
    const r = registroCompleto();
    expect(r.lineasInvalidas).toEqual([]);
    expect(r.lineasDesgloseIlegible).toEqual([]);
    expect(r.encabezadosDuplicados).toEqual([]);
    expect(r.registros).toHaveLength(7 + 9 - 1); // las siete líneas del base (6 claves distintas) y nueve nuevas
    expect(contarConDesglose(r)).toBe(9);
    expect(r.clavesRepetidas).toHaveLength(1);
  });

  it("el registro base sigue siendo el de cinco columnas y se lee sin desglose", () => {
    const r = leerRegistro(registroEjemplo());
    if (r instanceof Error) throw r;
    expect(contarConDesglose(r)).toBe(0);
    expect(registroEjemplo().split("\r\n")[0]).toBe("CUIT;Tipo;Punto de venta;Número;Importe");
  });

  it("las líneas del base valen lo mismo en el completo", () => {
    const base = leerRegistro(registroEjemplo());
    if (base instanceof Error) throw base;
    const completo = registroCompleto();
    for (const b of base.registros) {
      const igual = completo.registros.find((c) => c.cuit === b.cuit && c.tipoCmp === b.tipoCmp && c.ptoVta === b.ptoVta && c.nroCmp === b.nroCmp);
      expect(igual?.importe).toBe(b.importe);
    }
  });

  it("solo usa CUIT ficticios de emisor, sin correos", () => {
    const permitidos = new Set(Object.values(CUIT_FICTICIOS));
    for (const r of registroCompleto().registros) expect(permitidos.has(r.cuit)).toBe(true);
    expect(registroEjemploCompleto()).not.toMatch(/@/);
  });

  it("es determinista", () => {
    expect(registroEjemploCompleto()).toBe(registroEjemploCompleto());
  });
});

describe("ejemplos del control: lo que se ve al cruzarlos", () => {
  const filas = filasCompletas();
  const lect = registroCompleto();
  const efectivas = conDesgloseDelRegistro(filas, lect.registros);
  const porOrigen = (n: number): Fila => efectivas.find((f) => f.origen === `ejemplo-${String(n).padStart(2, "0")}.png`) as Fila;

  it("cada observación del control aparece en una fila distinta, con su código", () => {
    expect(codigos(porOrigen(15))).toEqual(["total-no-cierra"]);
    expect(codigos(porOrigen(16))).toEqual(["letra-c-con-iva"]);
    expect(codigos(porOrigen(18))).toEqual(["cae-vencimiento"]);
    expect(codigos(porOrigen(19))).toEqual(["cuit-receptor"]);
    expect(codigos(porOrigen(20))).toEqual(["letra-a-sin-cuit-receptor"]);
  });

  it("las filas en orden no tienen ninguna observación, y una de ellas cierra por un centavo de redondeo", () => {
    for (const n of [12, 13, 14, 17, 21]) expect(codigos(porOrigen(n))).toEqual([]);
    expect(porOrigen(14).datos.importe).toBe(15000.01);
    expect(porOrigen(14).desglose?.iva).toBe(2603.31);
  });

  it("el total que no cierra es por centavos y lo dice", () => {
    const o = controlarComprobante(porOrigen(15).datos, porOrigen(15).desglose, HOY)[0];
    expect(o?.severidad).toBe("error");
    expect(o?.mensaje).toContain("$ 0,03");
  });

  it("el CUIT inválido del emisor del ejemplo base sigue ahí, y no hay ninguna observación nueva en las demás filas del base", () => {
    expect(codigos(porOrigen(8))).toEqual(["cuit-emisor"]);
    expect(codigos(porOrigen(10))).toEqual(["fecha-futura"]);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 9]) expect(codigos(porOrigen(n))).toEqual([]);
  });

  it("hay exactamente dos duplicados en la planilla: el del base y el nuevo, de la fila 12", () => {
    const d = duplicadas(filas);
    expect([...d.entries()]).toEqual([
      [5, 1],
      [21, 12],
    ]);
  });

  it("la conciliación del base no cambia y las filas nuevas figuran como ya cargadas (menos el duplicado)", () => {
    const sola = conciliar(filas.slice(0, 11), (leerRegistro(registroEjemplo()) as LecturaRegistro).registros, HOY);
    const c = conciliar(efectivas, lect.registros, HOY);
    for (const [id, r] of sola.porFila) expect(c.porFila.get(id)?.tipo).toBe(r.tipo);
    for (let id = 12; id <= 20; id++) expect(c.porFila.get(id)?.tipo).toBe("ya-cargada");
    expect(c.porFila.get(21)?.tipo).toBe("duplicada");
    expect(c.soloEnRegistro).toHaveLength(2);
    const r = resumenConciliacion(efectivas, c, lect.clavesRepetidas);
    expect(r.cargadasDosVeces).toBe(1);
    expect(r.duplicadas).toBe(2);
  });

  it("el estado de la fila: Revisar donde hay observaciones, Leída donde no", () => {
    for (const n of [15, 16, 18, 19, 20]) expect(estadoFila(porOrigen(n), HOY).estado).toBe("revisar");
    for (const n of [12, 13, 14, 17]) expect(estadoFila(porOrigen(n), HOY).estado).toBe("leida");
  });

  it("sin el registro, las filas nuevas muestran solo lo que el QR trae (receptor y letra)", () => {
    expect(codigos(filas[14] as Fila)).toEqual([]); // el total no se puede controlar sin desglose
    expect(codigos(filas[18] as Fila)).toEqual(["cuit-receptor"]);
    expect(codigos(filas[19] as Fila)).toEqual(["letra-a-sin-cuit-receptor"]);
  });
});
