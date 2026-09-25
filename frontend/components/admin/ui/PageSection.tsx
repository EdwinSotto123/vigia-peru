"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sección de página: título serif, una línea de descripción, un dato al lado del
 * título (`meta`, p. ej. "19 pendientes") y acciones a la derecha. Con `plegable`
 * el título se vuelve un botón que abre y cierra el cuerpo (`abierto` = estado
 * inicial); el cuerpo cerrado queda en el DOM con `hidden`, no se desmonta.
 *
 * La descripción va en inkSoft y no en mute: la sección se apoya sobre el fondo
 * paperDeep del panel, donde mute no llega a 4.5:1.
 */
export function PageSection({
  titulo,
  descripcion,
  meta,
  acciones,
  plegable,
  abierto: abiertoInicial = true,
  id,
  className,
  children,
}: {
  titulo: React.ReactNode;
  descripcion?: React.ReactNode;
  meta?: React.ReactNode;
  acciones?: React.ReactNode;
  plegable?: boolean;
  abierto?: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const idCuerpo = useId();
  const visible = !plegable || abierto;

  const cabecera = (
    <>
      <span className="font-display text-lg font-bold text-ink">{titulo}</span>
      {meta != null && <span className="text-[12px] font-medium text-inkSoft">{meta}</span>}
      {plegable && <ChevronDown size={16} className={cn("shrink-0 self-center text-inkSoft transition-transform duration-rapido", abierto && "rotate-180")} aria-hidden />}
    </>
  );

  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2>
            {plegable ? (
              <button
                type="button"
                onClick={() => setAbierto((v) => !v)}
                aria-expanded={abierto}
                aria-controls={idCuerpo}
                className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg text-left"
              >
                {cabecera}
              </button>
            ) : (
              <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">{cabecera}</span>
            )}
          </h2>
          {descripcion && <p className="mt-0.5 max-w-3xl text-[13px] leading-snug text-inkSoft">{descripcion}</p>}
        </div>
        {acciones && visible && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      <div id={idCuerpo} hidden={!visible} className="mt-3">
        {children}
      </div>
    </section>
  );
}
