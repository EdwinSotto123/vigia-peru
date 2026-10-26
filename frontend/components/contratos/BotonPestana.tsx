"use client";

import type { ReactNode } from "react";
import { irAPestana } from "@/components/patrones/Pestanas";

/**
 * Un botón que abre otra pestaña de la misma ficha (`irAPestana` del kit) sin recargar y, con `ancla`, baja hasta esa
 * parte: del Resumen del contrato a un grupo de antecedentes («Penalidades 2») con su evidencia. Isla de cliente: el
 * servidor arma lo de adentro (sólo datos y JSX).
 */
export function BotonPestana({
  clave,
  ancla,
  etiqueta,
  className,
  children,
}: {
  clave: string;
  /** El id del elemento de la pestaña al que bajar (con `scroll-mt-*` para quedar bajo la barra fija). */
  ancla?: string;
  /** Lo que anuncia el lector de pantalla, si el contenido no lo dice solo. */
  etiqueta?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      className={className}
      onClick={() => {
        irAPestana(clave);
        if (!ancla) return;
        // La pestaña se monta al abrirse: se espera a que esté en la página.
        const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.setTimeout(() => document.getElementById(ancla)?.scrollIntoView({ block: "start", behavior: suave ? "smooth" : "auto" }), 80);
      }}
    >
      {children}
    </button>
  );
}
