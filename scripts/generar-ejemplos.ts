// Genera las direcciones de QR de las facturas ficticias de ejemplo y las guarda en ejemplos/urls-qr.txt.
// No usa ningún generador de QR ni agrega dependencias: la interfaz carga estas mismas direcciones
// con el botón "Probar con facturas de ejemplo". Quien quiera probar con imágenes puede pegar una
// dirección en cualquier generador de QR y arrastrar la imagen a la página.
//
// Uso: npm run ejemplos   (Node 24 ejecuta TypeScript directamente)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generarEjemplosCompletos } from "../src/ejemplos.ts";
import { extractoEjemplo } from "../src/ejemplos-pagos.ts";
import { leerUrlQr } from "../src/qr-arca.ts";
import { formatearCuit } from "../src/cuit.ts";
import { formatearImporte, nombreTipo } from "../src/comprobante.ts";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hoy = new Date();
const ejemplos = generarEjemplosCompletos(hoy);

const lineas: string[] = [
  "# Direcciones de QR de facturas ficticias (empresas, CUIT, importes y CAE inventados).",
  `# Generado el ${hoy.toISOString().slice(0, 10)} con \`npm run ejemplos\`. Una dirección por línea; las que empiezan con # son comentarios.`,
  "",
];

for (const e of ejemplos) {
  lineas.push(`# ${e.origen}: ${e.caso}`);
  if (e.url === null) {
    lineas.push("# (sin dirección: representa una imagen sin QR legible)", "");
    continue;
  }
  const c = leerUrlQr(e.url);
  if (c instanceof Error) throw c;
  lineas.push(
    `# ${nombreTipo(c.tipoCmp)} ${c.ptoVta}-${c.nroCmp}, CUIT ${formatearCuit(c.cuit)}, ${c.moneda} ${formatearImporte(c.importe)}`,
    e.url,
    "",
  );
}

const destino = resolve(raiz, "ejemplos", "urls-qr.txt");
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, lineas.join("\n"), "utf8");
console.log(`Escribí ${ejemplos.filter((e) => e.url !== null).length} direcciones en ${destino}`);

// El extracto de pagos ficticio que acompaña a esas facturas (con la marca de orden de bytes, para que Excel lo abra con tildes).
const destinoExtracto = resolve(raiz, "ejemplos", "extracto-pagos.csv");
writeFileSync(destinoExtracto, `\uFEFF${extractoEjemplo()}`, "utf8");
console.log(`Escribí el extracto de pagos de ejemplo en ${destinoExtracto}`);
