"use client";

import type { ReactNode } from "react";
import { irAPestana } from "@/components/patrones/Pestanas";

/**
 * Un enlace de texto que cambia de pestaña en la misma ficha (`irAPestana` del kit): del Resumen a la evidencia de las
 * señales sin recargar. Se ve como un enlace, pero no navega: es un botón.
 */
export function IrAPestana({ clave, children }: { clave: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => irAPestana(clave)}
      className="inline-flex items-center gap-1 rounded text-meta font-medium text-granate underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
    >
      {children} <span aria-hidden>→</span>
    </button>
  );
}
