"use client";

/**
 * Modo de color de la página: "noche" (carbón y lima, la identidad Píxel) o "día" (fondo claro, verde profundo, sin
 * neón). Vive en `<html data-modo>`; las variables de color de globals.css cambian con él, así casi ningún componente
 * tiene que saber en qué modo está. Los que pintan con colores escritos en JS (el mapa, sus puntos) leen `useModo()`.
 *
 * Primera visita: el modo del sistema (`prefers-color-scheme`). Al elegir uno con el botón, queda guardado en este
 * navegador. `SCRIPT_MODO` (lib/modoScript.ts) lo aplica antes de pintar, desde el <head> de app/layout.tsx: sin él,
 * la página se vería un instante en el modo equivocado.
 */
import { useSyncExternalStore } from "react";
import { CLAVE_MODO as CLAVE } from "./modoScript";

export type Modo = "dia" | "noche";

const COLOR_BARRA: Record<Modo, string> = { dia: "#F6F8F7", noche: "#0B0F0F" };

function leer(): Modo {
  return document.documentElement.dataset.modo === "dia" ? "dia" : "noche";
}

function suscribir(avisar: () => void): () => void {
  const obs = new MutationObserver(avisar);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-modo"] });
  return () => obs.disconnect();
}

/** El modo actual; se actualiza al cambiarlo. En el servidor, "noche" (el cliente corrige al hidratar). */
export function useModo(): Modo {
  return useSyncExternalStore(suscribir, leer, () => "noche");
}

/** Cambia el modo y lo recuerda en este navegador. */
export function cambiarModo(m: Modo): void {
  document.documentElement.dataset.modo = m;
  try {
    localStorage.setItem(CLAVE, m);
  } catch {
    /* sin almacenamiento (modo privado): dura lo que dure la página */
  }
  document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.setAttribute("content", COLOR_BARRA[m]));
}
