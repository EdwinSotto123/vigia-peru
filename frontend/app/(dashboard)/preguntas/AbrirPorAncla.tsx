"use client";

import { useEffect } from "react";

/**
 * Abre la pregunta a la que apunta el ancla (/preguntas#cuentas) y la vuelve a
 * ubicar ya abierta. Cada pregunta es un `<details>` nativo que guarda su propio
 * estado: el ancla sólo ABRE, al montar y en cada `hashchange`, y después manda
 * quien lee (se puede cerrar aunque el ancla siga en la URL).
 *
 * No pinta nada: las preguntas se arman en el servidor y funcionan sin JS.
 */
export function AbrirPorAncla() {
  useEffect(() => {
    const abrir = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const pregunta = document.getElementById(id);
      if (!(pregunta instanceof HTMLDetailsElement)) return;
      pregunta.open = true;
      // Abrir cambia el alto de lo de arriba: se vuelve a ubicar la pregunta ya abierta.
      requestAnimationFrame(() => pregunta.scrollIntoView({ block: "start" }));
    };
    abrir();
    window.addEventListener("hashchange", abrir);
    return () => window.removeEventListener("hashchange", abrir);
  }, []);
  return null;
}
