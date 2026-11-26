# Lector y conciliador de facturas

## In English

An invoice reader and reconciler: it reads Argentine electronic invoices (PDF or image with the ARCA QR code) and matches them against a CSV exported from a management system, showing which invoices still need to be entered, which were entered wrongly and which were entered twice. It runs entirely in the browser and all data is fictional.
Stack: TypeScript and Vite, with only `pdfjs-dist` and `jsqr` in production; the matching is a deterministic rule, with no AI in the browser.
Live demo: <https://facturas.matiasormeno.com.ar>
Run it locally (Node 24, npm 11): `npm install`, `npm run dev`, `npm test`.
Conceived, designed and directed by Matías Ariel Ormeño; built with AI.
The rest of this README and the code identifiers are in Spanish.

Lee facturas electrónicas argentinas (PDF o imagen con el QR de ARCA) y las cruza con un CSV exportado del sistema de gestión.
Responde en segundos qué facturas recibidas **falta cargar**, cuáles están **mal cargadas** y cuáles figuran **cargadas dos veces**.
Para administración y cuentas a pagar. Todo corre en el navegador y todos los datos son ficticios.

**Demo en vivo:** <https://facturas.matiasormeno.com.ar>

## Capturas

Todas con datos ficticios (botón "Ver un ejemplo completo").

![Recorrido de 15 segundos: se carga el ejemplo, la página muestra cuántas facturas faltan cargar, se filtran las mal cargadas y las que faltan cargar.](docs/capturas/recorrido.gif)

![Resultado de la conciliación: faltan cargar 2 facturas por $ 6.120,00 y US$ 1.250,00, y una lista de lo que requiere atención: 3 para revisar, 2 mal cargadas, 1 duplicada en la planilla, 1 cargada dos veces en el sistema y 2 cargadas en el sistema y no recibidas.](docs/capturas/resultado.png)

![Planilla de 11 comprobantes con su estado: ya cargada, mal cargada por otro importe o por otro emisor, cargada dos veces en el sistema, falta cargar, duplicada, para revisar y sin QR. Cada fila tiene una franja de color y un texto que explica qué hacer.](docs/capturas/planilla.png)

![Vista en un teléfono de 360 píxeles de ancho: el resultado y la planilla, donde cada comprobante pasa a ser una tarjeta con su estado, importe y botón Editar.](docs/capturas/celular-360.png)

![El mismo resultado en modo oscuro, con los mismos estados, íconos y textos.](docs/capturas/modo-oscuro.png)

## Qué hace

- **Lee** facturas (PDF, imagen o dirección de QR pegada) y arma una planilla. Marca como **Revisar** los datos dudosos (CUIT inválido, total en cero, fecha futura).
- **Concilia** la planilla con el registro del sistema, comprobante por comprobante: **Falta cargar**, **Ya cargada**, **Mal cargada** (otro importe u otro emisor) o **Cargada dos veces**. También lista las **Cargadas en el sistema y no recibidas**.
- **Indica la antigüedad** de lo que falta cargar y permite ordenar por los más antiguos.
- **Permite corregir** filas a mano y **exportar la planilla a CSV** para Excel.

La regla del negocio: en el sistema real no se carga dos veces el mismo comprobante. Si una factura quedó mal cargada, se da de baja y se vuelve a cargar; por eso la herramienta nunca sugiere cargar encima de lo que ya está. La decisión siempre es de la persona: la herramienta no carga nada en otro sistema.

El botón **Ver un ejemplo completo** carga facturas y un registro ficticios, con casos difíciles a propósito. Incluye una Factura B (punto de venta 2, N.º 31, $ 9.350,25) que el sistema tiene cargada dos veces con el mismo importe. El ejemplo no incluye notas de crédito.

Reglas de cruce completas, qué no hace y casos que no resuelve: [docs/reglas.md](docs/reglas.md).

## Cómo se usa

1. **Cargue facturas:** arrastre PDF o imágenes con el QR de ARCA (hasta 15 MB cada una) o pegue sus direcciones. Si no tiene una factura a mano, use una de las **facturas de ejemplo en PDF**: están en [`public/ejemplos/`](public/ejemplos/) y se descargan desde el enlace «Descargar una factura de ejemplo (PDF ficticio)» de la página. Son ficticias: empresa, CUIT, importes y CAE inventados, con la leyenda «EJEMPLO — COMPROBANTE FICTICIO, SIN VALIDEZ FISCAL». Su QR tiene el formato real de ARCA (una dirección con un JSON en base64), pero apunta a datos inventados, así que sirven para ver la lectura de un PDF de punta a punta sin usar ningún comprobante real.
2. **Sume lo ya cargado (opcional):** suba el CSV que exporta su sistema. Con las tres facturas de ejemplo y el botón «Probar solo con un registro de ejemplo», una figura como «Ya cargada» y las otras dos como «Falta cargar».
3. **Lea el resultado, revise y exporte** a CSV.

Las tres facturas de ejemplo las genera [`scripts/generar-pdfs.ts`](scripts/generar-pdfs.ts) sin ninguna biblioteca: el PDF y el código QR están escritos a mano en `scripts/pdf-ejemplo/` (el QR se comprueba en los tests contra jsQR). Para regenerarlas: `npm run ejemplos-pdf`. Un test comprueba que los archivos versionados coincidan con lo que produce el script.

## Cómo correrla

Requisitos: Node 24 y npm 11.

```powershell
npm install
npm run dev        # http://localhost:5173
npm test           # tests (vitest)
npm run build      # tipos y genera dist/
```

Prueba en el navegador de la lectura de un PDF real (no forma parte de `npm test`; necesita Python con Playwright y la demo corriendo): `python scripts/e2e-pdf-ejemplo.py`.

## Decisiones técnicas

- **Sin framework:** TypeScript y Vite; solo `pdfjs-dist` y `jsqr` en producción, con versión fija.
- **Lectura del QR en un Web Worker con límite de tiempo:** una imagen pesada no congela la interfaz; si un archivo tarda más de 30 segundos, se corta y la fila queda "Sin QR" con el motivo.
- **`pdf.js` sin `eval`:** los PDF se tratan como entrada hostil (tamaño máximo, sin evaluación de código).
- **Política de contenido sin conexiones externas** (`public/_headers`): los archivos no salen del navegador. No hay servidor, base de datos ni analítica.
- **Detección de codificación del CSV:** UTF-8, UTF-16 con marca (el "Texto Unicode" de Excel) o Windows-1252; separador `;`, `,` o tabulador.
- **CSV exportado protegido contra fórmulas:** las celdas que empiezan con `=`, `+`, `-` o `@` se neutralizan.
- **Cruce determinístico, sin IA:** comparar cuatro campos y un importe al centavo no la necesita, y una regla fija da siempre el mismo resultado y se prueba con tests.
- **542 tests** (33 archivos): QR, CUIT, duplicados, CSV, cada resultado de la conciliación, notas de crédito (cubiertas por tests, no por el ejemplo), importes y textos para lectores de pantalla.
- **Límite de la verificación del QR:** la lectura del QR se probó con códigos generados para esta demo (los PDF de ejemplo y los de las pruebas). La prueba con comprobantes reales de ARCA todavía está pendiente.

## Cómo se hizo (uso de IA)

- **Herramienta:** Claude (Anthropic), usado como programador bajo dirección.
- **Para qué:** escribió el código y los tests a partir del diseño que Matías aprobó.
- **Qué decidió y verificó Matías:**
  - El alcance y que la persona decide: la página nunca carga nada en otro sistema.
  - Comparar el importe al centavo exacto, sin tolerancia.
  - La regla del negocio de la conciliación: el sistema real no permite cargar dos veces el mismo comprobante, así que lo mal cargado se da de baja y se vuelve a cargar, y lo que figura dos veces es un error del sistema.
  - Que el cruce sea una regla determinística, sin IA en el navegador. Y que ante un "otro emisor" ambiguo no se acuse a una fila vecina sino que decida la persona.
  - Qué dejar fuera: lectura de texto de PDF sin QR, XLSX y consulta a ARCA.
  - Probó cada tanda y aprobó cada cambio de texto y de diseño.
- **Responsabilidad:** del autor. El código lo escribió una IA; Matías diseñó, decidió y verificó.

## Origen y licencia

Proyecto de Matías Ariel Ormeño, iniciado el 17/11/2026. Escrito desde cero, con datos 100 % ficticios (empresas, CUIT, importes y CAE inventados). El código de la aplicación es propio; las únicas bibliotecas de terceros que usa en producción son `pdfjs-dist` (lectura de PDF) y `jsqr` (lectura del QR). No usa datos ni documentos de terceros.

Licencia: MIT (ver LICENSE).
