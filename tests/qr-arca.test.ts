import { describe, expect, it } from "vitest";
import type { Comprobante } from "../src/comprobante.ts";
import { ErrorQr, armarUrlQr, decodificarBase64, leerUrlQr } from "../src/qr-arca.ts";
import { b64, b64Bytes } from "./ayuda.ts";

const BASE = {
  ver: 1,
  fecha: "2026-10-05",
  cuit: 30990000014,
  ptoVta: 3,
  tipoCmp: 1,
  nroCmp: 1245,
  importe: 118470.5,
  moneda: "PES",
  ctz: 1,
  tipoDocRec: 80,
  nroDocRec: 20123456786,
  tipoCodAut: "E",
  codAut: 70000000007919,
};

const URL_QR = "https://www.afip.gob.ar/fe/qr/?p=";

function ok(texto: string): Comprobante {
  const r = leerUrlQr(texto);
  if (r instanceof Error) throw r;
  return r;
}

function error(texto: string): ErrorQr {
  const r = leerUrlQr(texto);
  if (!(r instanceof ErrorQr)) throw new Error("Se esperaba un ErrorQr");
  return r;
}

describe("leerUrlQr: URL válida", () => {
  it("lee todos los campos del formato versión 1", () => {
    const c = ok(armarUrlQr(BASE));
    expect(c).toEqual({
      ver: 1,
      fecha: "2026-10-05",
      cuit: "30990000014",
      ptoVta: 3,
      tipoCmp: 1,
      nroCmp: 1245,
      importe: 118470.5,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: "20123456786",
      tipoCodAut: "E",
      codAut: "70000000007919",
    });
  });

  it("acepta el dominio arca.gob.ar y los hosts sin www", () => {
    const p = b64(JSON.stringify(BASE));
    expect(ok(`https://www.arca.gob.ar/fe/qr/?p=${p}`).nroCmp).toBe(1245);
    expect(ok(`https://arca.gob.ar/fe/qr/?p=${p}`).nroCmp).toBe(1245);
    expect(ok(`https://afip.gob.ar/fe/qr?p=${p}`).nroCmp).toBe(1245);
  });

  it("tolera espacios alrededor del texto", () => {
    expect(ok(`  ${armarUrlQr(BASE)}\n`).cuit).toBe("30990000014");
  });
});

describe("leerUrlQr: variantes del base64", () => {
  // Un JSON cuyo base64 contiene "+" y "/" para forzar los caracteres especiales.
  const especial = { ...BASE, extra: "???>>>~~~" };
  const estandar = b64(JSON.stringify(especial));

  it("el caso de prueba realmente usa + y /", () => {
    expect(estandar).toMatch(/\+/);
    expect(estandar).toMatch(/\//);
  });

  it("acepta la variante URL (- y _) sin relleno =", () => {
    const urlSafe = estandar.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(ok(URL_QR + urlSafe).nroCmp).toBe(1245);
  });

  it("acepta el base64 estándar sin relleno", () => {
    expect(ok(URL_QR + estandar.replace(/=+$/, "")).nroCmp).toBe(1245);
  });

  it("acepta el relleno codificado como %3D", () => {
    expect(ok(URL_QR + estandar.replace(/=/g, "%3D")).nroCmp).toBe(1245);
  });

  it("acepta el + que llegó como espacio o como %2B", () => {
    expect(ok(URL_QR + estandar.replace(/\+/g, " ")).nroCmp).toBe(1245);
    expect(ok(URL_QR + estandar.replace(/\+/g, "%2B")).nroCmp).toBe(1245);
  });

  it("acepta parámetros extra antes y después de p", () => {
    expect(ok(`https://www.afip.gob.ar/fe/qr/?x=1&p=${b64(JSON.stringify(BASE))}&y=2`).nroCmp).toBe(1245);
  });

  it("decodifica UTF-8 (tildes y eñes)", () => {
    expect(decodificarBase64(b64("Ormeño"))).toBe("Ormeño");
  });
});

describe("leerUrlQr: rechazos", () => {
  const p = b64(JSON.stringify(BASE));

  it("rechaza un host ajeno", () => {
    expect(error(`https://www.ejemplo.com/fe/qr/?p=${p}`).codigo).toBe("host");
    expect(error(`https://afip.gob.ar.malicioso.com/fe/qr/?p=${p}`).codigo).toBe("host");
    expect(error(`https://www.afip.gob.ar@malicioso.com/fe/qr/?p=${p}`).codigo).toBe("host");
    expect(error(`https://malicioso.com/www.afip.gob.ar/fe/qr/?p=${p}`).codigo).toBe("host");
  });

  it("rechaza http y otras rutas del mismo dominio", () => {
    expect(error(`http://www.afip.gob.ar/fe/qr/?p=${p}`).codigo).toBe("host");
    expect(error(`https://www.afip.gob.ar/otra/ruta/?p=${p}`).codigo).toBe("host");
  });

  it("rechaza texto vacío, texto que no es URL y URL sin parámetro p", () => {
    expect(error("").codigo).toBe("vacio");
    expect(error("   ").codigo).toBe("vacio");
    expect(error("hola mundo").codigo).toBe("url");
    expect(error("https://www.afip.gob.ar/fe/qr/").codigo).toBe("parametro");
    expect(error("https://www.afip.gob.ar/fe/qr/?p=").codigo).toBe("parametro");
    expect(error("https://www.afip.gob.ar/fe/qr/?q=abc").codigo).toBe("parametro");
  });

  it("rechaza un texto demasiado largo", () => {
    expect(error(URL_QR + "A".repeat(5000)).codigo).toBe("url");
  });

  it("rechaza base64 inválido", () => {
    expect(error(URL_QR + "@@@@").codigo).toBe("base64");
    expect(error(URL_QR + "A").codigo).toBe("base64");
  });

  it("rechaza JSON roto o con otra forma", () => {
    expect(error(URL_QR + b64('{"ver":1,"cuit":')).codigo).toBe("json");
    expect(error(URL_QR + b64("[1,2,3]")).codigo).toBe("json");
    expect(error(URL_QR + b64("null")).codigo).toBe("json");
    expect(error(URL_QR + b64('"hola"')).codigo).toBe("json");
  });

  it("rechaza bytes que no son UTF-8", () => {
    expect(error(URL_QR + b64Bytes(new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]))).codigo).toBe("base64");
  });
});

describe("leerUrlQr: campos faltantes", () => {
  it("nombra los campos obligatorios que faltan", () => {
    const { cuit: _cuit, importe: _importe, ...incompleto } = BASE;
    const e = error(armarUrlQr(incompleto));
    expect(e.codigo).toBe("campos");
    expect(e.message).toContain("cuit");
    expect(e.message).toContain("importe");
  });

  it("un campo en null cuenta como faltante", () => {
    expect(error(armarUrlQr({ ...BASE, nroCmp: null })).codigo).toBe("campos");
  });

  it("los campos opcionales pueden faltar", () => {
    const minimo = { fecha: "2026-10-05", cuit: 30990000014, ptoVta: 1, tipoCmp: 6, nroCmp: 5, importe: 10 };
    const c = ok(armarUrlQr(minimo));
    expect(c.moneda).toBe("");
    expect(c.codAut).toBe("");
    expect(c.ctz).toBeNull();
    expect(c.ver).toBeNull();
    expect(c.tipoCodAut).toBe("");
  });
});

describe("leerUrlQr: números como texto y valores inválidos", () => {
  it("normaliza números que vienen como texto", () => {
    const c = ok(
      armarUrlQr({
        ...BASE,
        ver: "1",
        cuit: "30990000014",
        ptoVta: "3",
        tipoCmp: "6",
        nroCmp: "00001245",
        importe: "1234.50",
        ctz: "1.00",
        codAut: "70000000007919",
      }),
    );
    expect(c.ver).toBe(1);
    expect(c.cuit).toBe("30990000014");
    expect(c.ptoVta).toBe(3);
    expect(c.tipoCmp).toBe(6);
    expect(c.nroCmp).toBe(1245);
    expect(c.importe).toBe(1234.5);
    expect(c.ctz).toBe(1);
    expect(c.codAut).toBe("70000000007919");
  });

  it("un campo inválido no rompe: queda vacío para que la fila se marque revisar", () => {
    const c = ok(armarUrlQr({ ...BASE, importe: "abc", nroCmp: -4, ptoVta: 1.5, fecha: "2026-13-45", cuit: "no es un cuit" }));
    expect(c.importe).toBeNull();
    expect(c.nroCmp).toBeNull();
    expect(c.ptoVta).toBeNull();
    expect(c.fecha).toBe("2026-13-45");
    expect(c.cuit).toBe("");
  });

  it("normaliza la moneda y descarta un tipo de código de autorización desconocido", () => {
    const c = ok(armarUrlQr({ ...BASE, moneda: " dol ", tipoCodAut: "X" }));
    expect(c.moneda).toBe("DOL");
    expect(c.tipoCodAut).toBe("");
    expect(ok(armarUrlQr({ ...BASE, tipoCodAut: "a" })).tipoCodAut).toBe("A");
  });

  it("no se deja engañar por claves heredadas del prototipo", () => {
    expect(error(URL_QR + b64('{"__proto__":{"cuit":1},"constructor":{}}')).codigo).toBe("campos");
  });
});
