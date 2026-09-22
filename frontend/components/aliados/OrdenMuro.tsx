import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Control de orden del muro. Son `<Link>`, no botones con `onClick`: el orden
 * vive en la URL (`?orden=`), así que funciona sin JS, se puede compartir, y
 * este componente se queda del lado del servidor — no hay ninguna función
 * cruzando el límite server→client, que es el error que ya rompió producción
 * dos veces en este repo.
 *
 * Aparece sólo cuando hay más de un aliado: con n=1 un control de orden es
 * ruido que sugiere una competencia que no existe.
 */

export interface OpcionOrden {
  clave: string;
  etiqueta: string;
  /** Href completo, ya armado por la página. Dato serializable, nunca una función. */
  href: string;
}

export function OrdenMuro({ opciones, valor }: { opciones: OpcionOrden[]; valor: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[12px] text-mute" id="orden-muro">
        Ordenar por
      </span>
      <div role="group" aria-labelledby="orden-muro" className="flex flex-wrap gap-1.5">
        {opciones.map((o) => {
          const activa = o.clave === valor;
          return (
            <Link
              key={o.clave}
              href={o.href}
              aria-current={activa ? "true" : undefined}
              className={cn(
                "rounded-xl border px-3 py-1.5 text-[13px] font-medium transition-colors duration-rapido",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50",
                activa
                  ? "border-heroViolet bg-heroViolet-soft text-heroViolet"
                  : "border-line bg-paper text-inkSoft hover:bg-paperDeep hover:text-ink",
              )}
            >
              {o.etiqueta}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
