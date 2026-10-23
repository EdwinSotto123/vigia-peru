"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { EVENTO_ACTIVA } from "./Pestanas";

export interface Miga {
  etiqueta: string;
  href?: string;
}

/**
 * La ruta arriba de una página, para saber siempre dónde se está:
 *   Inicio › Partidos y gobiernos › Alianza para el Progreso › Contratos
 *
 * Con `pestanas`, el último paso es la pestaña abierta y cambia con ella (Pestanas avisa con un evento, sin recargar).
 * La primera pestaña ("Inicio" de la ficha) no se agrega: la ficha ya es el último paso y "Inicio" no se repite.
 */
export function Migas({
  items,
  pestanas,
}: {
  items: Miga[];
  pestanas?: { param?: string; etiquetas: Record<string, string>; primera: string; activa?: string };
}) {
  const param = pestanas?.param ?? "seccion";
  const [activa, setActiva] = useState(pestanas?.activa);

  useEffect(() => {
    if (!pestanas) return;
    const alCambiar = (e: Event) => {
      const d = (e as CustomEvent<{ param: string; clave: string }>).detail;
      if (d?.param === param) setActiva(d.clave);
    };
    window.addEventListener(EVENTO_ACTIVA, alCambiar);
    return () => window.removeEventListener(EVENTO_ACTIVA, alCambiar);
  }, [pestanas, param]);

  const pestana = pestanas && activa && activa !== pestanas.primera ? pestanas.etiquetas[activa] : undefined;
  const todas: Miga[] = [...items, ...(pestana ? [{ etiqueta: pestana }] : [])];

  return (
    <nav aria-label="Ruta de navegación">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-dato">
        {todas.map((m, i) => {
          const ultima = i === todas.length - 1;
          return (
            <li key={`${i}-${m.etiqueta}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
              {i > 0 && <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />}
              {m.href && !ultima ? (
                <Link href={m.href} prefetch={false} className="truncate text-inkSoft underline-offset-4 transition-colors hover:text-granate hover:underline">
                  {m.etiqueta}
                </Link>
              ) : (
                <span aria-current={ultima ? "page" : undefined} className={ultima ? "truncate font-semibold text-ink" : "truncate text-inkSoft"}>
                  {m.etiqueta}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
