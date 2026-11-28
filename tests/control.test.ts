import { describe, expect, it } from "vitest";
import { comprobanteVacio, type Comprobante } from "../src/comprobante.ts";
import {
  TOLERANCIA_REDONDEO_CENTAVOS,
  controlarComprobante,
  letraDe,
  type CodigoObservacion,
  type Desglose,
} from "../src/control.ts";
import { armarCuit } from "../src/cuit.ts";

const HOY = new Date("2026-11-17T15:00:00Z"); // 12:00 del 17/11/2026 en Argentina (UTC-3), el mismo instante en cualquier huso
const EMISOR = "30990000014"; // ficticio, dígito verificador válido
const RECEPTOR = armarCuit("20", "12345678") as string; // ficticio, dígito verificador válido

function factura(cambios: Partial<Comprobante> = {}): Comprobante {
  return {
    ...comprobanteVacio(),
    ver: 1,
    fecha: "2026-10-05",
    cuit: EMISOR,
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1245,
    importe: 1210,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: 80,
    nroDocRec: RECEPTOR,
    tipoCodAut: "E",
    codAut: "70000000007919",
    ...cambios,
  };
}

function desglose(cambios: Partial<Desglose> = {}): Desglose {
  return { neto: 1000, iva: 210, otros: 0, vencimientoCae: "2026-10-15", ...cambios };
}

function codigos(c: Comprobante, d?: Desglose): CodigoObservacion[] {
  return controlarComprobante(c, d, HOY).map((o) => o.codigo);
}

describe("comprobante sano", () => {
  it("no tiene observaciones", () => {
    expect(controlarComprobante(factura(), desglose(), HOY)).toEqual([]);
  });
  it("sin desglose solo se controlan los datos que trae el QR", () => {
    expect(controlarComprobante(factura(), undefined, HOY)).toEqual([]);
  });
});

describe("cuadre del total", () => {
  it("la tolerancia de redondeo es de un centavo y está a la vista", () => {
    expect(TOLERANCIA_REDONDEO_CENTAVOS).toBe(1);
  });
  it("neto + IVA + otros conceptos = total no da observaciones", () => {
    const d = desglose({ neto: 1000, iva: 150, otros: 60 });
    expect(codigos(factura(), d)).toEqual([]);
  });
  it("detecta que el total no cierra y dice la diferencia al centavo", () => {
    const obs = controlarComprobante(factura({ importe: 1210.03 }), desglose(), HOY);
    expect(obs).toHaveLength(1);
    expect(obs[0]?.codigo).toBe("total-no-cierra");
    expect(obs[0]?.severidad).toBe("error");
    expect(obs[0]?.mensaje).toContain("$ 1.210,00");
    expect(obs[0]?.mensaje).toContain("$ 1.210,03");
    expect(obs[0]?.mensaje).toContain("$ 0,03");
  });
  it("una diferencia de un centavo es redondeo y se tolera, de dos no", () => {
    expect(codigos(factura({ importe: 1210.01 }), desglose())).toEqual([]);
    expect(codigos(factura({ importe: 1209.99 }), desglose())).toEqual([]);
    expect(codigos(factura({ importe: 1210.02 }), desglose())).toEqual(["total-no-cierra"]);
  });
  it("no se confunde con la coma flotante (0,1 + 0,2 = 0,3)", () => {
    const d = desglose({ neto: 0.1, iva: 0.2, otros: 0 });
    expect(codigos(factura({ importe: 0.3, tipoCmp: 6, tipoDocRec: 99, nroDocRec: "0" }), d)).toEqual([]);
  });
  it("lo que el desglose no informa vale cero (factura C: solo neto)", () => {
    const c = factura({ tipoCmp: 11, importe: 500 });
    expect(codigos(c, desglose({ neto: 500, iva: null, otros: null }))).toEqual([]);
    expect(codigos(c, desglose({ neto: 400, iva: null, otros: null }))).toEqual(["total-no-cierra"]);
  });
  it("en una A, B o M con solo el neto cargado no hay error falso: falta el IVA y el cuadre no se puede juzgar", () => {
    for (const tipoCmp of [1, 6, 51]) {
      const c = factura({ tipoCmp, importe: 1210, tipoDocRec: tipoCmp === 6 ? 99 : 80, nroDocRec: tipoCmp === 6 ? "0" : RECEPTOR });
      expect(codigos(c, desglose({ neto: 1000, iva: null, otros: null })), `tipo ${tipoCmp}`).not.toContain("total-no-cierra");
    }
  });
  it("en una A con el IVA informado en cero y otro total sigue siendo error (un cero es un dato)", () => {
    expect(codigos(factura({ importe: 1210 }), desglose({ neto: 1000, iva: 0, otros: null }))).toEqual(["total-no-cierra"]);
  });
  it("sin neto o sin total no hay cuadre que controlar", () => {
    expect(codigos(factura(), desglose({ neto: null }))).toEqual([]);
    expect(codigos(factura({ importe: null }), desglose())).not.toContain("total-no-cierra");
  });
  it("la nota de crédito se compara con los mismos signos que trae", () => {
    const c = factura({ tipoCmp: 3, importe: 1210 });
    expect(codigos(c, desglose())).toEqual([]);
    expect(codigos(c, desglose({ neto: -1000, iva: -210 }))).toEqual(["total-no-cierra"]);
  });
  it("en dólares usa el símbolo de la moneda", () => {
    const obs = controlarComprobante(factura({ moneda: "DOL", importe: 1215 }), desglose(), HOY);
    expect(obs[0]?.mensaje).toContain("US$ 1.215,00");
  });
});

describe("letra coherente con lo que trae el comprobante", () => {
  it("letraDe sale del código del tipo", () => {
    expect(letraDe(1)).toBe("A");
    expect(letraDe(3)).toBe("A");
    expect(letraDe(6)).toBe("B");
    expect(letraDe(8)).toBe("B");
    expect(letraDe(11)).toBe("C");
    expect(letraDe(13)).toBe("C");
    expect(letraDe(51)).toBe("M");
    expect(letraDe(211)).toBe("C");
    expect(letraDe(20)).toBeNull();
    expect(letraDe(null)).toBeNull();
    expect(letraDe(999)).toBeNull();
  });
  it("una factura C con IVA discriminado es incoherente", () => {
    const c = factura({ tipoCmp: 11 });
    const obs = controlarComprobante(c, desglose(), HOY);
    expect(obs.map((o) => o.codigo)).toEqual(["letra-c-con-iva"]);
    expect(obs[0]?.severidad).toBe("error");
  });
  it("una factura C sin IVA discriminado está bien, con IVA en cero también", () => {
    const c = factura({ tipoCmp: 11, importe: 1000 });
    expect(codigos(c, desglose({ iva: null }))).toEqual([]);
    expect(codigos(c, desglose({ iva: 0 }))).toEqual([]);
  });
  it("lo dice igual en una nota de crédito C", () => {
    expect(codigos(factura({ tipoCmp: 13 }), desglose())).toEqual(["letra-c-con-iva"]);
  });
  it("una A o una M a un receptor que no se identifica con CUIT es un aviso", () => {
    const obs = controlarComprobante(factura({ tipoDocRec: 99, nroDocRec: "0" }), desglose(), HOY);
    expect(obs.map((o) => o.codigo)).toEqual(["letra-a-sin-cuit-receptor"]);
    expect(obs[0]?.severidad).toBe("aviso");
    expect(codigos(factura({ tipoCmp: 51, tipoDocRec: 96, nroDocRec: "12345678" }), desglose())).toEqual(["letra-a-sin-cuit-receptor"]);
  });
  it("una B a consumidor final no tiene nada que decir", () => {
    expect(codigos(factura({ tipoCmp: 6, tipoDocRec: 99, nroDocRec: "0" }), desglose({ neto: 1210, iva: 0 }))).toEqual([]);
  });
  it("si el comprobante no trae el tipo de documento del receptor no se juzga la A", () => {
    expect(codigos(factura({ tipoDocRec: null, nroDocRec: "" }), desglose())).toEqual([]);
  });
});

describe("CUIT", () => {
  it("emisor con dígito verificador inválido", () => {
    expect(codigos(factura({ cuit: "30990000015" }), desglose())).toEqual(["cuit-emisor"]);
  });
  it("emisor vacío o con menos de 11 dígitos", () => {
    expect(codigos(factura({ cuit: "" }), desglose())).toEqual(["cuit-emisor"]);
    expect(codigos(factura({ cuit: "3099000001" }), desglose())).toEqual(["cuit-emisor"]);
  });
  it("receptor con CUIT de dígito verificador inválido", () => {
    const malo = `${RECEPTOR.slice(0, 10)}${(Number(RECEPTOR[10]) + 1) % 10}`;
    const obs = controlarComprobante(factura({ nroDocRec: malo }), desglose(), HOY);
    expect(obs.map((o) => o.codigo)).toEqual(["cuit-receptor"]);
    expect(obs[0]?.severidad).toBe("error");
  });
  it("receptor con CUIT que no tiene 11 dígitos", () => {
    expect(codigos(factura({ nroDocRec: "2012345678" }), desglose())).toEqual(["cuit-receptor"]);
  });
  it("receptor con letras o símbolos entre los números no es un CUIT, aunque tenga 11 dígitos sueltos", () => {
    const conLetras = `${RECEPTOR.slice(0, 2)}abc${RECEPTOR.slice(2)}`;
    const obs = controlarComprobante(factura({ nroDocRec: conLetras }), desglose(), HOY);
    expect(obs.map((o) => o.codigo)).toEqual(["cuit-receptor"]);
    expect(obs[0]?.mensaje).toBe("El CUIT del receptor tiene caracteres que no son números.");
    expect(codigos(factura({ nroDocRec: `${RECEPTOR}x` }), desglose())).toEqual(["cuit-receptor"]);
  });
  it("receptor con CUIT escrito con guiones, puntos o espacios sigue siendo válido", () => {
    const con = `${RECEPTOR.slice(0, 2)}-${RECEPTOR.slice(2, 10)}-${RECEPTOR[10]}`;
    expect(codigos(factura({ nroDocRec: con }), desglose())).toEqual([]);
    expect(codigos(factura({ nroDocRec: ` ${RECEPTOR.slice(0, 2)} ${RECEPTOR.slice(2, 10)} ${RECEPTOR[10]} ` }), desglose())).toEqual([]);
  });
  it("el CUIL (tipo 86) se controla igual; el DNI no", () => {
    expect(codigos(factura({ tipoCmp: 6, tipoDocRec: 86, nroDocRec: "20123456780" }), desglose({ neto: 1210, iva: 0 }))).toEqual(["cuit-receptor"]);
    expect(codigos(factura({ tipoCmp: 6, tipoDocRec: 96, nroDocRec: "12345678" }), desglose({ neto: 1210, iva: 0 }))).toEqual([]);
  });
});

describe("importes que no son números", () => {
  it("un importe infinito o NaN en el desglose no pasa en silencio: se dice", () => {
    for (const malo of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const campo of ["neto", "iva", "otros"] as const) {
        const obs = controlarComprobante(factura(), desglose({ [campo]: malo }), HOY);
        expect(obs.map((o) => [o.codigo, o.severidad, o.mensaje]), `${campo}=${malo}`).toEqual([
          ["total-no-cierra", "error", "El neto, el IVA o los otros conceptos no son un número válido: no se puede controlar el total."],
        ]);
      }
    }
  });
  it("un total infinito o NaN con el desglose informado también", () => {
    expect(codigos(factura({ importe: Number.NaN }), desglose())).toEqual(["total-no-cierra"]);
    expect(codigos(factura({ importe: Number.POSITIVE_INFINITY }), desglose())).toEqual(["total-no-cierra"]);
  });
});

describe("CAE", () => {
  it("si no se informó, no hay contradicción que señalar", () => {
    expect(codigos(factura({ codAut: "" }), desglose())).toEqual([]);
  });
  it("debe tener 14 dígitos", () => {
    expect(codigos(factura({ codAut: "7000000000791" }), desglose())).toEqual(["cae-formato"]);
    expect(codigos(factura({ codAut: "700000000079190" }), desglose())).toEqual(["cae-formato"]);
    expect(codigos(factura({ codAut: "7000000000079A" }), desglose())).toEqual(["cae-formato"]);
  });
  it("el vencimiento puede coincidir con la emisión pero no ser anterior", () => {
    expect(codigos(factura(), desglose({ vencimientoCae: "2026-10-05" }))).toEqual([]);
    const obs = controlarComprobante(factura(), desglose({ vencimientoCae: "2026-10-04" }), HOY);
    expect(obs.map((o) => o.codigo)).toEqual(["cae-vencimiento"]);
    expect(obs[0]?.severidad).toBe("error");
    expect(obs[0]?.mensaje).toContain("04/10/2026");
    expect(obs[0]?.mensaje).toContain("05/10/2026");
  });
  it("acepta el vencimiento como DD/MM/AAAA o AAAAMMDD (así lo escribe ARCA)", () => {
    expect(codigos(factura(), desglose({ vencimientoCae: "15/10/2026" }))).toEqual([]);
    expect(codigos(factura(), desglose({ vencimientoCae: "20261015" }))).toEqual([]);
    expect(codigos(factura(), desglose({ vencimientoCae: "20261001" }))).toEqual(["cae-vencimiento"]);
  });
  it("un vencimiento que no es una fecha es una observación", () => {
    expect(codigos(factura(), desglose({ vencimientoCae: "pronto" }))).toEqual(["cae-vencimiento"]);
    expect(codigos(factura(), desglose({ vencimientoCae: "2026-02-31" }))).toEqual(["cae-vencimiento"]);
  });
  it("sin vencimiento informado no se controla", () => {
    expect(codigos(factura(), desglose({ vencimientoCae: "" }))).toEqual([]);
  });
  it("sin fecha de emisión válida no se compara el vencimiento", () => {
    expect(codigos(factura({ fecha: "" }), desglose())).toEqual(["fecha"]);
  });
});

describe("fecha de emisión", () => {
  it("futura", () => {
    const obs = controlarComprobante(factura({ fecha: "2026-11-18" }), desglose({ vencimientoCae: "2026-11-30" }), HOY);
    expect(obs.map((o) => o.codigo)).toEqual(["fecha-futura"]);
    expect(obs[0]?.severidad).toBe("error");
  });
  it("hoy no es futura", () => {
    expect(codigos(factura({ fecha: "2026-11-17" }), desglose({ vencimientoCae: "2026-11-27" }))).toEqual([]);
  });
  it("«hoy» es el día de Argentina: de noche allá, quien mira desde un huso más adelantado no ve un error falso", () => {
    // 22:30 del 17/11 en Buenos Aires = 01:30 UTC del 18/11 (en Tokio ya es 18/11, y el instante no depende del huso de la máquina).
    const nocheEnArgentina = new Date("2026-11-18T01:30:00Z");
    expect(controlarComprobante(factura({ fecha: "2026-11-17" }), undefined, nocheEnArgentina)).toEqual([]);
    const obs = controlarComprobante(factura({ fecha: "2026-11-18" }), undefined, nocheEnArgentina);
    expect(obs.map((o) => [o.codigo, o.mensaje])).toEqual([["fecha-futura", "La fecha de emisión es futura."]]);
  });
  it("falta o no es válida", () => {
    expect(codigos(factura({ fecha: "" }), undefined)).toEqual(["fecha"]);
    expect(codigos(factura({ fecha: "31/02/2026" }), undefined)).toEqual(["fecha"]);
  });
});

describe("varias observaciones a la vez", () => {
  it("se devuelven todas, errores primero", () => {
    const c = factura({ tipoCmp: 11, importe: 1300, tipoDocRec: 99, nroDocRec: "0", codAut: "123" });
    const obs = controlarComprobante(c, desglose(), HOY);
    expect(obs.map((o) => o.codigo).sort()).toEqual(["cae-formato", "letra-c-con-iva", "total-no-cierra"]);
    expect(obs.every((o) => o.mensaje.endsWith("."))).toBe(true);
  });
  it("no modifica lo que recibe", () => {
    const c = factura({ importe: 1 });
    const d = desglose();
    const copiaC = structuredClone(c);
    const copiaD = structuredClone(d);
    controlarComprobante(c, d, HOY);
    expect(c).toEqual(copiaC);
    expect(d).toEqual(copiaD);
  });
});
