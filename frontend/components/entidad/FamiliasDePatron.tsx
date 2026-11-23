"use client";

import type { ReactNode } from "react";
import { irAPestana } from "@/components/patrones/Pestanas";
import { cn } from "@/lib/utils";

/**
 * Elige una entrada de un índice (`IndiceAntecedentes`) desde fuera de él, sin ir al servidor: escribe su parámetro en la
 * URL (el índice lo lee con `useSearchParams`) y, si la entrada está en otra subpestaña, la abre antes. Antes las familias
 * eran enlaces: cada clic volvía a pedir la ficha entera de la entidad para cambiar una fila del índice.
 */
function elegirEnIndice(param: string, valor: string, pestana?: { param: string; clave: string }) {
  if (pestana) irAPestana(pestana.clave, pestana.param);
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(param, valor);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* sin URL no hay cómo avisarle al índice: no pasa nada */
  }
}

/** Un enlace de texto que abre una entrada de un índice (y su subpestaña), sin recargar. */
export function EnIndice({ param, valor, pestana, className, children }: { param: string; valor: string; pestana?: { param: string; clave: string }; className?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => elegirEnIndice(param, valor, pestana)} className={cn("inline text-left", className)}>
      {children}
    </button>
  );
}
