// Lo único de `node:fs` que usan los tests, declarado a mano: no se suma @types/node como dependencia solo para esto.
declare module "node:fs" {
  export function readFileSync(ruta: URL | string): Uint8Array;
}
