"use client";

import { useEffect } from "react";

/**
 * Abre el `<details>` al que apunta el ancla de la URL (`#ant-visitas`): los grupos de antecedentes van plegados y un
 * enlace de la cabecera o del Resumen lleva a uno. Al montar (la pestaña se monta la primera vez que se abre) y en cada
 * cambio de ancla. No dibuja nada.
 */
export function AbrirConAncla() {
  useEffect(() => {
    const abrir = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement && !el.open) {
        el.open = true;
        requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
      }
    };
    abrir();
    window.addEventListener("hashchange", abrir);
    return () => window.removeEventListener("hashchange", abrir);
  }, []);
  return null;
}
