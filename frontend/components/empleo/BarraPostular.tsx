"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Timer } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { cn } from "@/lib/utils";

/**
 * La barra de abajo de la ficha en el celular: lo que paga, cuándo cierra y el botón para postular, a mano del pulgar
 * mientras se leen los requisitos. Aparece cuando los botones de la ficha (el elemento `observar`) salen de la pantalla y
 * se va cuando vuelven: nunca hay dos «Postular» a la vista. Va pegada (sticky) al final del contenido, así nunca tapa el
 * pie. En la computadora no hace falta: la columna de la derecha ya va pegada. Recibe sólo textos (la arma el servidor).
 */
export function BarraPostular({
  observar,
  sueldo,
  cierre,
  urgente,
  href,
  etiqueta,
  externo,
}: {
  observar: string;
  /** Ya formateado («S/ 5,300») o null si el aviso no lo dice. */
  sueldo: string | null;
  /** «Hoy, 2 nov.» */
  cierre: string;
  urgente: boolean;
  href: string;
  etiqueta: string;
  /** Un enlace a la entidad o a SERVIR: se abre en otra pestaña. */
  externo: boolean;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = document.getElementById(observar);
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setVisible(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [observar]);

  return (
    <div
      className={cn(
        "sticky bottom-0 z-barra -mx-4 mt-10 border-t border-line bg-paper/95 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-10px_30px_-18px_rgb(0_0_0/0.45)] backdrop-blur-md transition-[transform,opacity,visibility] duration-normal ease-salida motion-reduce:transition-none sm:-mx-6 sm:px-6 lg:hidden",
        visible ? "visible translate-y-0 opacity-100" : "invisible translate-y-full opacity-0",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {sueldo ? (
            <p className="font-display text-bloque font-bold leading-none tabular-nums text-ink">
              {sueldo}
              <span className="ml-1 font-sans text-rotulo font-normal text-mute">al mes</span>
            </p>
          ) : (
            <p className="text-dato font-semibold text-inkSoft">Sueldo sin dato</p>
          )}
          <p className={cn("mt-1 flex items-center gap-1 text-rotulo font-medium", urgente ? "text-crimsonTexto" : "text-inkSoft")}>
            <Timer size={12} aria-hidden className="shrink-0" />
            <span className="truncate">{cierre}</span>
          </p>
        </div>
        <a href={href} {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={claseAccion("primario", "min-h-11 shrink-0")}>
          {etiqueta}
          {externo && (
            <>
              <ArrowUpRight size={16} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </>
          )}
        </a>
      </div>
    </div>
  );
}
