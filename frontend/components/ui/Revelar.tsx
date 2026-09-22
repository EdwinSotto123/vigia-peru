"use client";

import { useState } from "react";
import { Panel, type PanelPosicion } from "@/components/ui/Panel";
import { cn } from "@/lib/utils";

/**
 * La primitiva de información progresiva del producto.
 *
 * El resumen (`children`) queda inline y clickeable; el detalle (`detalle`)
 * vive en un panel que se abre encima **sin navegar**, así que la página de
 * atrás no se pierde: el usuario sigue viendo dónde estaba y vuelve con
 * Escape.
 *
 * Por qué panel lateral y no modal por defecto: un modal interrumpe y tapa,
 * y casi nunca hace falta. Acá lo que se quiere es *mirar de cerca sin
 * soltar el contexto*, que es literalmente lo que hace un panel al costado.
 * `posicion="centro"` existe para lo que sí exige foco protegido (confirmar
 * un aporte, por ejemplo), no como default.
 *
 * `detalle` es un ReactNode: lo puede renderizar un Server Component con
 * todos los datos ya resueltos y pasarlo hacia acá. No se pasan funciones
 * por este límite — rompe solo en producción.
 */
export function Revelar({
  titulo,
  descripcion,
  detalle,
  pie,
  posicion = "lateral",
  ancho = "lg",
  children,
  className,
  etiqueta,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  detalle: React.ReactNode;
  pie?: React.ReactNode;
  posicion?: PanelPosicion;
  ancho?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
  className?: string;
  /** Qué se anuncia al lector de pantalla. Por defecto: "Ver detalle de {título}". */
  etiqueta?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-label={etiqueta ?? `Ver detalle de ${titulo}`}
        className={cn("group block w-full cursor-pointer text-left", className)}
      >
        {children}
      </button>
      <Panel
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={titulo}
        descripcion={descripcion}
        posicion={posicion}
        ancho={ancho}
        pie={pie}
      >
        {detalle}
      </Panel>
    </>
  );
}
