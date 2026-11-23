"use client";

import { useEffect } from "react";

/**
 * Un ancla que cae dentro de una pestaña cerrada (2026-11-22): la portada enlaza a /planes#mcp y /planes#comparar, y en
 * /planes esas secciones ahora van en <PestanasVivas>. Si el `#id` de la dirección está en un panel escondido, toca su
 * pestaña y baja hasta él; al cambiar el ancla (un enlace de la misma página), lo mismo. No pinta nada.
 */
export function AnclaEnPestana() {
  useEffect(() => {
    const abrir = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const panel = document.getElementById(id)?.closest<HTMLElement>('[role="tabpanel"]');
      if (!panel?.hidden) return;
      document.querySelector<HTMLButtonElement>(`[role="tab"][aria-controls="${panel.id}"]`)?.click();
      // El panel se vuelve a montar al abrirse: se busca otra vez el destino.
      window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 80);
    };
    abrir();
    window.addEventListener("hashchange", abrir);
    return () => window.removeEventListener("hashchange", abrir);
  }, []);
  return null;
}
