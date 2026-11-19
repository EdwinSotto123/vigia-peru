"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un bloque que en el celular va plegado detrás de un botón de una línea y desde md se ve siempre (el botón no está).
 * Para lo que acompaña a una lista sin ser la lista (el gráfico de cada año, el reparto por servicio): en 390 px empujaba
 * la primera fila más de una pantalla hacia abajo. Se dibuja UNA vez (no una copia por ancho, como `Repartos`): el
 * gráfico de columnas pone ids por año y dos copias los repetían. Empieza plegado: en el celular no hay salto al cargar;
 * en escritorio el CSS lo muestra desde el servidor.
 */
export function PlegadoEnCelular({
  titulo,
  icono,
  children,
  className,
  claseContenido,
}: {
  titulo: string;
  icono?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Clases del contenido desde md (p. ej. `lg:contents`, para que sus hijos se acomoden en la rejilla de afuera). */
  claseContenido?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((x) => !x)}
        className="flex min-h-[44px] w-full items-center gap-2 text-left text-dato font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate md:hidden"
      >
        {icono && <span className="shrink-0 text-granate" aria-hidden>{icono}</span>}
        <span className="min-w-0 flex-1">{titulo}</span>
        <ChevronDown size={16} className={cn("shrink-0 text-mute transition-transform duration-rapido", abierto && "rotate-180")} aria-hidden />
      </button>
      <div id={id} className={cn(abierto ? "block" : "hidden", "md:block", claseContenido)}>
        {children}
      </div>
    </div>
  );
}
