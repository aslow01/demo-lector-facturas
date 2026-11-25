// Guía "¿Cómo funciona?": comportamiento. El contenido de los pasos y de las preguntas
// está escrito en `index.html`; aquí solo se abre, se cierra, se cambia de paso y se resalta la ventana que explica cada
// paso. Qué paso sigue, qué ventana resalta y cómo se guarda el globo lo decide `guia-estado.ts` (puro, con tests).
//
// Reglas que no se negocian: la guía NUNCA se abre sola; el foco vuelve al botón de apertura al cerrar; la hoja modal
// deja inerte el resto de la página (lo hace `showModal()`: no se programa una trampa de foco a mano); en escritorio la
// guía no es modal; el almacenamiento puede estar bloqueado y nunca rompe nada.

import {
  PASOS,
  TOTAL_PASOS,
  anterior,
  destinoDelPaso,
  estaALaVista,
  guardarGloboCerrado,
  indiceDePestana,
  leerGloboCerrado,
  modoAlAbrir,
  modoAlCambiarAncho,
  modoAlMinimizar,
  modoAlMostrar,
  modoAlRestaurar,
  normalizarPaso,
  siguiente,
  textoAnuncioPaso,
  textoIndicador,
  textoSiguiente,
  type Almacen,
  type ModoGuia,
  type NumeroPaso,
} from "./guia-estado.ts";
import { desplazarA, irA, irAVentana } from "./navegacion.ts";

const CORTE_ANCHO = "(min-width: 68.75rem)"; // 1100 px

let globo: HTMLElement | null = null;

function almacenamiento(): Almacen | null {
  try {
    return window.localStorage;
  } catch {
    return null; // modo privado o almacenamiento bloqueado
  }
}

/** Marca la primera visita como vista y oculta el globo. Sirve también a quien abre el ejemplo (7.4). */
export function cerrarGlobo(): void {
  guardarGloboCerrado(almacenamiento());
  if (globo) globo.hidden = true;
}

function hayDatos(): boolean {
  return document.body.hasAttribute("data-hay-datos");
}

/** El texto de un botón sin ícono. */
function ponerTexto(boton: HTMLElement, texto: string): void {
  boton.textContent = texto;
}

export function iniciarGuia(): void {
  const candidato = document.getElementById("guia");
  const abrirEl = document.getElementById("guia-abrir");
  if (!(candidato instanceof HTMLDialogElement) || !abrirEl) return; // la página no trae la guía
  const dialogo: HTMLDialogElement = candidato;
  const botonAbrir: HTMLElement = abrirEl;
  globo = document.getElementById("guia-globo");

  const tituloGuia = document.getElementById("guia-titulo");
  const meta = document.getElementById("guia-meta");
  const botonCerrar = document.getElementById("guia-cerrar");
  const botonMinimizar = document.getElementById("guia-minimizar");
  const botonAnterior = document.getElementById("guia-anterior");
  const botonSiguiente = document.getElementById("guia-siguiente");
  // En la barra minimizada, los mismos dos movimientos como íconos en la barra de título.
  const barraAnterior = document.getElementById("guia-barra-anterior");
  const barraSiguiente = document.getElementById("guia-barra-siguiente");
  const botonMostrar = document.getElementById("guia-mostrar");
  const pestanas = [document.getElementById("guia-tab-pasos"), document.getElementById("guia-tab-preguntas")];
  const paneles = [document.getElementById("guia-panel-pasos"), document.getElementById("guia-panel-preguntas")];
  const seccionesPaso = Array.from(dialogo.querySelectorAll<HTMLElement>(".guia-paso[data-paso]"));
  const puntos = Array.from(dialogo.querySelectorAll<HTMLElement>(".guia-punto[data-paso]"));
  const pie = botonAnterior?.closest<HTMLElement>(".ventana-estado") ?? null;
  const mq = window.matchMedia(CORTE_ANCHO);

  // Región de estado propia, DENTRO del diálogo: en la hoja modal el resto de la página es inerte y su región no se anunciaría
  // (accesibilidad M1: al cambiar de paso el foco queda en "Siguiente", cuyo texto cambia; sin esto no se oye el paso nuevo).
  const anuncios = document.createElement("p");
  anuncios.className = "solo-lectores";
  anuncios.setAttribute("role", "status");
  anuncios.setAttribute("aria-live", "polite");
  dialogo.appendChild(anuncios);
  const anunciarPaso = (): void => {
    anuncios.textContent = "";
    window.setTimeout(() => (anuncios.textContent = textoAnuncioPaso(paso)), 60);
  };

  let paso: NumeroPaso = 1;
  let modo: ModoGuia = "acoplado";
  let abierta = false;
  let esModal = false;
  let pestana = 0;
  let resaltado: HTMLElement | null = null;

  // ------------------------------------------------------------ Presentación

  function actualizar(): void {
    const info = PASOS[paso - 1] ?? PASOS[0] as (typeof PASOS)[number];
    for (const seccion of seccionesPaso) seccion.hidden = Number(seccion.dataset.paso) !== paso;
    for (const punto of puntos) {
      if (Number(punto.dataset.paso) === paso) punto.setAttribute("aria-current", "step");
      else punto.removeAttribute("aria-current");
    }
    if (meta) meta.textContent = pestana !== 0 ? "" : modo === "barra" ? `${textoIndicador(paso)} · ${info.titulo}` : textoIndicador(paso);

    if (botonAnterior instanceof HTMLButtonElement) botonAnterior.disabled = paso === 1;
    if (botonSiguiente) ponerTexto(botonSiguiente, textoSiguiente(paso));
    if (pie) pie.hidden = pestana !== 0;

    // Barra minimizada: el nombre de cada botón dice a qué paso lleva.
    const enBarra = modo === "barra" && pestana === 0;
    if (barraAnterior) {
      barraAnterior.hidden = !enBarra;
      if (barraAnterior instanceof HTMLButtonElement) barraAnterior.disabled = paso === 1;
      barraAnterior.setAttribute("aria-label", paso === 1 ? "Paso anterior" : `Paso anterior: ${PASOS[paso - 2]?.titulo ?? ""}`);
    }
    if (barraSiguiente) {
      barraSiguiente.hidden = !enBarra;
      barraSiguiente.setAttribute("aria-label", paso === TOTAL_PASOS ? "Terminar la guía" : `Paso siguiente: ${PASOS[paso]?.titulo ?? ""}`);
    }

    if (botonMinimizar) {
      botonMinimizar.hidden = modo === "acoplado";
      botonMinimizar.setAttribute("aria-label", modo === "barra" ? "Abrir la guía" : "Minimizar la guía");
    }
  }

  function seleccionarPestana(i: number, moverFoco: boolean): void {
    pestana = i;
    pestanas.forEach((tab, k) => {
      if (!tab) return;
      tab.setAttribute("aria-selected", String(k === i));
      tab.tabIndex = k === i ? 0 : -1;
    });
    paneles.forEach((panel, k) => {
      if (panel) panel.hidden = k !== i;
    });
    if (moverFoco) pestanas[i]?.focus();
    actualizar();
  }

  // ------------------------------------------------------------ Modos (acoplado / hoja / barra)

  /** Cambia de modo. Pasar de modal a no modal (o al revés) exige cerrar y volver a abrir el diálogo. */
  function aplicarModo(nuevo: ModoGuia): void {
    const foco = document.activeElement;
    const modal = nuevo === "hoja";
    if (dialogo.open && esModal !== modal) dialogo.close();
    // El modo se pone ANTES de abrir: al abrirse, el navegador enfoca un elemento del diálogo y, si todavía no fuera `fixed`
    // (su posición natural es el final de la página), desplazaría la página hasta el fondo.
    modo = nuevo;
    dialogo.dataset.modo = nuevo;
    document.body.classList.toggle("guia-acoplada", nuevo === "acoplado");
    if (!dialogo.open) {
      if (modal) dialogo.showModal();
      else dialogo.show();
      esModal = modal;
    }
    // Al cerrar un modal el navegador devuelve el foco a otro lado: si estaba dentro de la guía, vuelve allí.
    if (foco instanceof HTMLElement && dialogo.contains(foco)) foco.focus({ preventScroll: true });
    actualizar();
  }

  // ------------------------------------------------------------ Resaltado

  function quitarResaltado(): void {
    resaltado?.removeAttribute("data-guia-resaltado");
    resaltado = null;
  }

  /** Resalta la ventana del paso actual, la despliega si hace falta y se desplaza hasta ella. */
  function resaltarPaso(moverFoco: boolean): void {
    const ventana = document.getElementById(destinoDelPaso(paso, hayDatos()));
    if (!ventana) return;
    quitarResaltado();
    ventana.dataset.guiaResaltado = String(paso);
    resaltado = ventana;
    irAVentana(ventana, moverFoco);
  }

  // ------------------------------------------------------------ Abrir, cerrar, pasos

  /**
   * El foco vuelve al botón "¿Cómo funciona?" sin desplazar la página (quien lee a mitad no pierde su lugar)... salvo que el botón
   * esté fuera de la pantalla: entonces el anillo de foco no se vería y quien usa teclado no sabría dónde quedó (accesibilidad S2).
   * En ese caso se lo trae a la vista con el mínimo desplazamiento (suave, salvo movimiento reducido).
   */
  function devolverFocoAlBoton(): void {
    botonAbrir.focus({ preventScroll: true });
    if (!estaALaVista(botonAbrir.getBoundingClientRect(), window.innerHeight)) desplazarA(botonAbrir, "nearest");
  }

  function abrir(): void {
    if (abierta) {
      tituloGuia?.focus({ preventScroll: true });
      return;
    }
    cerrarGlobo();
    abierta = true;
    botonAbrir.hidden = true;
    botonAbrir.setAttribute("aria-expanded", "true");
    aplicarModo(modoAlAbrir(mq.matches));
    seleccionarPestana(0, false);
    tituloGuia?.focus({ preventScroll: true });
  }

  function cerrar(): void {
    if (!abierta) return;
    abierta = false;
    quitarResaltado();
    document.body.classList.remove("guia-acoplada");
    if (dialogo.open) dialogo.close();
    delete dialogo.dataset.modo;
    botonAbrir.hidden = false;
    botonAbrir.setAttribute("aria-expanded", "false");
    devolverFocoAlBoton(); // el foco vuelve a donde se abrió (el botón está en la barra superior)
  }

  function irAPaso(n: number): void {
    paso = normalizarPaso(n);
    actualizar();
    anunciarPaso();
    // Con un resaltado activo, seguir al paso (sin robar el foco: quien avanza con el teclado sigue donde estaba).
    // En la hoja modal la página no se ve: ahí el resaltado viejo se quita.
    if (resaltado) {
      if (modo === "hoja") quitarResaltado();
      else resaltarPaso(false);
    }
  }

  // ------------------------------------------------------------ Conexiones

  botonAbrir.addEventListener("click", abrir);
  document.getElementById("guia-globo-abrir")?.addEventListener("click", abrir);
  document.getElementById("guia-globo-cerrar")?.addEventListener("click", () => {
    cerrarGlobo();
    devolverFocoAlBoton();
  });
  globo?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    cerrarGlobo();
    devolverFocoAlBoton();
  });
  if (globo) globo.hidden = leerGloboCerrado(almacenamiento());

  botonCerrar?.addEventListener("click", cerrar);
  // Esc cierra con el foco dentro del panel: en la hoja modal lo da `cancel`; en el panel no modal, `keydown`.
  dialogo.addEventListener("cancel", (e) => {
    e.preventDefault();
    cerrar();
  });
  dialogo.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    cerrar();
  });
  // Si el diálogo se cerró por otra vía (no por un cambio de modo, en el que sigue abierto), se limpia todo.
  dialogo.addEventListener("close", () => {
    if (!dialogo.open && abierta) cerrar();
  });

  botonMinimizar?.addEventListener("click", () => {
    aplicarModo(modo === "barra" ? modoAlRestaurar(modo, mq.matches) : modoAlMinimizar(modo));
    botonMinimizar.focus();
  });
  const retroceder = (): void => irAPaso(anterior(paso));
  const avanzar = (): void => {
    if (paso === TOTAL_PASOS) cerrar();
    else irAPaso(siguiente(paso));
  };
  botonAnterior?.addEventListener("click", retroceder);
  barraAnterior?.addEventListener("click", retroceder);
  botonSiguiente?.addEventListener("click", avanzar);
  barraSiguiente?.addEventListener("click", avanzar);
  for (const punto of puntos) punto.addEventListener("click", () => irAPaso(Number(punto.dataset.paso)));
  botonMostrar?.addEventListener("click", () => {
    if (modo === "hoja") aplicarModo(modoAlMostrar(modo)); // deja ver la página: pasa a la barra
    resaltarPaso(true);
  });

  // Enlaces internos de la guía (por ejemplo, "Ver el detalle" del formato del CSV): abren lo plegado y llevan hasta allí.
  for (const enlace of dialogo.querySelectorAll<HTMLElement>("[data-ir]")) {
    enlace.addEventListener("click", (e) => {
      e.preventDefault();
      const destino = document.getElementById(enlace.dataset.ir ?? "");
      if (!destino) return;
      if (modo === "hoja") aplicarModo(modoAlMostrar(modo));
      if (destino instanceof HTMLDetailsElement) destino.open = true;
      const titulo = destino instanceof HTMLDetailsElement ? destino.querySelector<HTMLElement>("summary") : destino;
      irA(titulo ?? destino);
    });
  }

  pestanas.forEach((tab, i) => {
    tab?.addEventListener("click", () => seleccionarPestana(i, false));
    tab?.addEventListener("keydown", (e) => {
      const nueva = indiceDePestana(i, e.key, pestanas.length);
      if (nueva === null) return;
      e.preventDefault();
      seleccionarPestana(nueva, true);
    });
  });

  // Al cruzar 1100 px con la guía abierta: acoplada que se angosta pasa a barra; hoja o barra que se ensanchan, a acoplada.
  mq.addEventListener("change", (e) => {
    if (abierta) aplicarModo(modoAlCambiarAncho(modo, e.matches));
  });

  seleccionarPestana(0, false);
}
