// Genera las facturas de ejemplo en PDF (public/ejemplos/*.pdf): 100 % ficticias, con su QR en el formato de ARCA.
// Sin dependencias: el PDF y el código QR los escriben los módulos de scripts/pdf-ejemplo/. El resultado es determinístico,
// así que volver a correrlo no cambia los archivos si nada cambió (un test lo comprueba).
//
// Uso: npm run ejemplos-pdf   (Node 24 ejecuta TypeScript directamente)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FACTURAS } from "./pdf-ejemplo/datos.ts";
import { pdfDeFactura } from "./pdf-ejemplo/maqueta.ts";

const destino = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "ejemplos");
mkdirSync(destino, { recursive: true });

for (const factura of FACTURAS) {
  const bytes = pdfDeFactura(factura);
  writeFileSync(resolve(destino, factura.archivo), bytes);
  console.log(`Escribí ${factura.archivo} (${bytes.length} bytes)`);
}
