"""Prueba de punta a punta de la lectura de un PDF real, en un navegador (Chromium).

Descarga la factura de ejemplo desde el enlace de la página y la sube por el mismo selector de archivos que usaría una persona;
después sube las otras dos. Comprueba que pdf.js dibuja la página, que jsQR encuentra el QR y que la planilla sale con los datos
esperados, también al cruzarla con el registro de ejemplo.

No forma parte de `npm test` (necesita un navegador y no se agrega ninguna dependencia al proyecto). Requisitos: Python 3 con
`pip install playwright` y `playwright install chromium`. Uso, con la demo corriendo (`npm run dev`, o `npm run preview` tras compilar):

    python scripts/e2e-pdf-ejemplo.py [--url http://localhost:5173/]

Termina con código 0 si todo está bien y con 1 si algo falla (y dice qué).
"""

import argparse
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
EJEMPLOS = RAIZ / "public" / "ejemplos"

# Lo que debe verse en la planilla (columnas: tipo y número, CUIT, fecha, importe), en el orden en que se suben.
ESPERADO = [
    ("factura-ejemplo-a-1245.pdf", ["Factura A", "0003-00001245", "30-99000001-4", "05/10/2026", "$ 118.470,50"]),
    ("factura-ejemplo-b-77.pdf", ["Factura B", "0002-00000077", "33-99000201-6", "15/10/2026", "$ 6.120,00"]),
    ("factura-ejemplo-a-usd-1251.pdf", ["Factura A", "0003-00001251", "30-99000001-4", "12/10/2026", "US$ 1.250,00"]),
]
# Con el registro de ejemplo cargado: la 1245 ya está en el sistema; las otras dos faltan cargar.
ESTADO_CON_REGISTRO = {"0003-00001245": "Ya cargada", "0002-00000077": "Falta cargar", "0003-00001251": "Falta cargar"}
# pdf.js avisa que no encuentra las tipografías estándar (Helvetica) para dibujar el texto: no afecta al QR, que es vectorial.
AVISOS_ACEPTADOS = ("standardFontDataUrl",)

fallas: list[str] = []


def comprobar(condicion: bool, mensaje: str) -> None:
    print(("  ok   " if condicion else "  FALLA ") + mensaje)
    if not condicion:
        fallas.append(mensaje)


def esperar(pagina, condicion, descripcion: str, segundos: float = 60) -> None:
    """Espera sin evaluar texto en la página (`wait_for_function` lo hace y la política de contenido de la demo lo bloquea)."""
    limite = time.monotonic() + segundos
    while not condicion():
        if time.monotonic() > limite:
            raise TimeoutError(f"se esperó más de {segundos:.0f} s: {descripcion}")
        pagina.wait_for_timeout(150)


def texto_de_filas(pagina) -> list[str]:
    return [" ".join(fila.inner_text().split()) for fila in pagina.query_selector_all("#cuerpo tr")]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:5173/")
    url = parser.parse_args().url

    problemas_de_consola: list[str] = []
    with sync_playwright() as p, tempfile.TemporaryDirectory() as temporal:
        navegador = p.chromium.launch()
        pagina = navegador.new_page()
        pagina.on("pageerror", lambda e: problemas_de_consola.append(f"error de la página: {e}"))

        def alerta_de_consola(m) -> None:
            if m.type == "error":
                problemas_de_consola.append(f"consola: {m.text}")
            elif m.type == "warning" and not any(a in m.text for a in AVISOS_ACEPTADOS):
                problemas_de_consola.append(f"aviso: {m.text}")

        pagina.on("console", alerta_de_consola)
        pagina.goto(url)

        print("Descarga desde la página")
        with pagina.expect_download() as descarga:
            pagina.click("#descargar-pdf")
        nombre = descarga.value.suggested_filename
        copia = Path(temporal) / nombre
        descarga.value.save_as(copia)
        comprobar(nombre == ESPERADO[0][0], f"el enlace descarga {nombre}")
        comprobar(copia.read_bytes() == (EJEMPLOS / nombre).read_bytes(), "el archivo descargado es idéntico al versionado")
        comprobar(copia.read_bytes().startswith(b"%PDF-"), "es un PDF")

        print("Lectura del PDF descargado, por el selector de archivos")
        pagina.set_input_files("#archivos", str(copia))
        esperar(pagina, lambda: pagina.locator("#cuerpo tr").count() >= 1, "la primera fila de la planilla")
        filas = texto_de_filas(pagina)
        comprobar(len(filas) == 1, f"una fila por factura ({len(filas)})")
        comprobar(all(d in filas[0] for d in ESPERADO[0][1]), f"la fila trae los datos de la factura: {filas[0] if filas else ''}")

        print("Las otras dos facturas")
        pagina.set_input_files("#archivos", [str(EJEMPLOS / n) for n, _ in ESPERADO[1:]])
        esperar(pagina, lambda: pagina.locator("#cuerpo tr").count() >= 3, "tres filas en la planilla")
        esperar(pagina, lambda: "Listo: 2 archivos" in pagina.inner_text("#mensajes"), "el aviso de que terminó la lectura")
        filas = texto_de_filas(pagina)
        comprobar(len(filas) == 3, f"tres filas ({len(filas)})")
        for (nombre_pdf, datos), fila in zip(ESPERADO, filas):
            comprobar(all(d in fila for d in datos), f"{nombre_pdf}: {' | '.join(datos)}")
        comprobar("sin QR" not in " ".join(filas).lower(), "ninguna fila quedó sin QR")
        resumen = pagina.inner_text("#mensajes")
        comprobar("2 archivos procesados, 2 filas agregadas" in resumen, f"mensaje de la zona: {resumen!r}")

        print("Cruce con el registro de ejemplo")
        pagina.click("#registro-ejemplo")
        esperar(pagina, lambda: "cargada" in pagina.inner_text("#cuerpo tr >> nth=0").lower(), "el cruce con el registro", 10)
        filas = texto_de_filas(pagina)
        for fila in filas:
            numero = next(n for n in ESTADO_CON_REGISTRO if n in fila)
            comprobar(ESTADO_CON_REGISTRO[numero] in fila, f"{numero}: {ESTADO_CON_REGISTRO[numero]}")

        navegador.close()

    print("Consola")
    comprobar(not problemas_de_consola, "sin errores ni avisos inesperados" + (f": {problemas_de_consola}" if problemas_de_consola else ""))

    if fallas:
        print(f"\n{len(fallas)} comprobación(es) fallaron.")
        return 1
    print("\nTodo bien.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
