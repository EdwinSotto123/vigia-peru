import type { ReactNode } from "react";
import Link from "next/link";
import { CORTE_ALTA, CORTE_MEDIA } from "@/lib/severidad";
import { Ayuda } from "./Ayuda";

/**
 * El ⓘ del puntaje, el mismo en todos lados: qué suma, que no es una probabilidad, los dos cortes (de lib/severidad.ts,
 * nunca escritos a mano) y el enlace a la metodología. Antes cada vista lo explicaba a su manera y la mayoría no lo
 * explicaba (auditoría de producto del 2026-11-12, hallazgo 5). `children`: una frase más, propia de la vista.
 */
export function AyudaPuntaje({ children }: { children?: ReactNode }) {
  return (
    <Ayuda titulo="¿Qué significa el puntaje?">
      <span className="block">
        Suma el peso de cada señal del contrato, con tope de 100. No es una probabilidad: {CORTE_ALTA} o más es riesgo
        alto y de {CORTE_MEDIA} a {CORTE_ALTA - 1}, medio.
      </span>
      {children ? <span className="mt-1.5 block">{children}</span> : null}
      <span className="mt-1.5 block">
        <Link href="/metodologia?seccion=puntaje" className="font-medium text-ink underline underline-offset-2 hover:text-granate">
          Cómo se calcula
        </Link>
      </span>
    </Ayuda>
  );
}
