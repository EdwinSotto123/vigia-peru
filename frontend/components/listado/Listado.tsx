"use client";

import { createContext, useCallback, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * El estado de un listado vive en la URL (§14.1): un filtro se comparte con un
 * enlace ("todo lo que encontró el agente de precios en esta municipalidad"), el
 * botón atrás lo deshace y el servidor pinta la página ya filtrada.
 *
 * `Listado` guarda los parámetros actuales y la navegación; `BarraFiltros` la usa
 * y `ZonaResultados` muestra el feedback mientras llega la página nueva (atenúa la
 * tabla y dibuja una barra de progreso arriba). Antes cambiar un filtro no daba
 * ninguna señal durante 1–6 s: parecía que el clic no había hecho nada.
 *
 * Todo lo que llega del servidor son datos planos: `parametros` es un objeto de
 * strings. Nunca una función (rompe sólo en producción).
 */

export type Parametros = Record<string, string | undefined>;

interface Contexto {
  ruta: string;
  parametros: Parametros;
  pendiente: boolean;
  /** Aplica un cambio de parámetros. Todo cambio de filtro vuelve a la página 1. */
  navegar: (cambio: Parametros) => void;
}

const Ctx = createContext<Contexto | null>(null);

export function useListado(): Contexto {
  const c = useContext(Ctx);
  if (!c) throw new Error("useListado fuera de <Listado>");
  return c;
}

/** Estable entre renders (un array literal en el default rehacía `navegar` cada vez). */
const CONSERVAR = ["seccion"];

export function Listado({
  ruta,
  parametros,
  paramPagina = "pagina",
  conservar = CONSERVAR,
  children,
}: {
  ruta: string;
  parametros: Parametros;
  /** Nombre del parámetro de página de esta vista (`pagina`, `page`…). Se borra al filtrar. */
  paramPagina?: string;
  /**
   * Parámetros que se leen de la URL VIVA al filtrar: la pestaña (`seccion`) la cambia
   * `Pestanas` sin pasar por el router, así que `parametros` (del último render del
   * servidor) no la conoce; sin esto, filtrar devolvía a la primera pestaña.
   */
  conservar?: string[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const navegar = useCallback(
    (cambio: Parametros) => {
      const q = new URLSearchParams();
      const vivos: Parametros = {};
      try {
        const actual = new URLSearchParams(window.location.search);
        for (const k of conservar) vivos[k] = actual.get(k) ?? undefined;
      } catch {
        /* sin URL: se conserva lo que vino del servidor */
      }
      const todo: Parametros = { ...parametros, ...vivos, ...cambio, [paramPagina]: undefined };
      for (const [k, v] of Object.entries(todo)) if (v != null && v !== "") q.set(k, v);
      const qs = q.toString();
      empezar(() => router.push(qs ? `${ruta}?${qs}` : ruta, { scroll: false }));
    },
    [parametros, paramPagina, ruta, router, conservar],
  );
  return <Ctx.Provider value={{ ruta, parametros, pendiente, navegar }}>{children}</Ctx.Provider>;
}

/** La zona que cambia al filtrar: se atenúa y muestra progreso mientras llega la página nueva. */
export function ZonaResultados({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pendiente } = useListado();
  return (
    <div className={cn("relative", className)} aria-busy={pendiente || undefined}>
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 -top-2 h-0.5 overflow-hidden rounded-full transition-opacity duration-rapido",
          pendiente ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="h-full w-1/3 animate-[progresoListado_1.1s_ease-in-out_infinite] rounded-full bg-granate" />
      </div>
      {pendiente && (
        <span role="status" className="sr-only">
          Actualizando resultados…
        </span>
      )}
      <div className={cn("transition-opacity duration-rapido", pendiente && "pointer-events-none opacity-50")}>{children}</div>
    </div>
  );
}
