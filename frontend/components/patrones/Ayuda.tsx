import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { cn } from "@/lib/utils";

/**
 * La explicación a un clic (DESIGN_SYSTEM.md §10.7). Todo "qué significa", "por qué
 * se muestra" o "cómo se calcula" vive aquí, detrás de un ⓘ junto al título, la
 * columna o la cifra que explica — nunca como párrafo abierto encima del dato.
 *
 * Server-safe: no tiene estado propio; el `Popover` (cliente) recibe el texto ya
 * armado como ReactNode.
 */
export function Ayuda({
  titulo,
  children,
  etiqueta,
  className,
  ancho = "w-80",
}: {
  /** Pregunta que responde: "¿Qué es una señal?", "¿Por qué en revisión?". */
  titulo: string;
  /**
   * Dos o tres oraciones. Si hace falta más, es una página (Preguntas frecuentes).
   * Texto o `<span className="block">` — nunca `<p>`/`<div>`: el ⓘ puede ir dentro de
   * una oración y un `<p>` adentro de otro rompe la hidratación.
   */
  children: ReactNode;
  /** Nombre accesible del botón. Por defecto, el título. */
  etiqueta?: string;
  className?: string;
  ancho?: string;
}) {
  return (
    <Popover
      titulo={titulo}
      anchoClase={ancho}
      className={cn(
        "h-6 w-6 shrink-0 justify-center rounded-full align-middle text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-granate",
        className,
      )}
      trigger={
        <>
          <Info size={15} aria-hidden />
          <span className="sr-only">{etiqueta ?? titulo}</span>
        </>
      }
    >
      {children}
    </Popover>
  );
}
