"use client";

import { Star } from "lucide-react";
import { ETAPAS, type Etapa } from "@/lib/licitaciones-app/almacen";
import { getAlmacen, useEstadoUsuario } from "@/lib/licitaciones-app/usarAlmacen";
import { cn } from "@/lib/utils";

interface Datos {
  id: string;
  codigo: string | null;
  titulo: string | null;
}

/** La estrella de una fila: sigue o deja de seguir el proceso. */
export function EstrellaSeguir({ id, codigo, titulo }: Datos) {
  const { seguidos } = useEstadoUsuario();
  const sigue = !!seguidos[id];
  return (
    <button
      type="button"
      onClick={() => (sigue ? getAlmacen().dejarDeSeguir(id) : getAlmacen().seguir(id, { codigo, titulo }))}
      aria-pressed={sigue}
      aria-label={sigue ? `Dejar de seguir ${codigo ?? "este proceso"}` : `Seguir ${codigo ?? "este proceso"}`}
      title={sigue ? "Lo sigues: quitar del seguimiento" : "Seguir este proceso"}
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors duration-rapido",
        sigue ? "text-granate hover:bg-granate-50" : "text-mute hover:bg-ink/[0.06] hover:text-ink",
      )}
    >
      <Star size={18} aria-hidden fill={sigue ? "currentColor" : "none"} />
    </button>
  );
}

/** En el detalle: «Seguir» y, si ya lo sigues, la etapa en la que está. */
export function SeguirConEtapa({ id, codigo, titulo }: Datos) {
  const { seguidos } = useEstadoUsuario();
  const s = seguidos[id];
  if (!s) {
    return (
      <button
        type="button"
        onClick={() => getAlmacen().seguir(id, { codigo, titulo })}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-granate px-4 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
      >
        <Star size={16} aria-hidden /> Seguir
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 rounded-lg border border-granate/40 bg-granate-50 p-1">
      <button
        type="button"
        onClick={() => getAlmacen().dejarDeSeguir(id)}
        aria-label="Dejar de seguir"
        title="Dejar de seguir"
        className="grid h-8 w-8 place-items-center rounded-md text-granate hover:bg-caja"
      >
        <Star size={16} aria-hidden fill="currentColor" />
      </button>
      <label className="sr-only" htmlFor={`etapa-${id}`}>
        Etapa
      </label>
      <select
        id={`etapa-${id}`}
        value={s.etapa}
        onChange={(e) => getAlmacen().cambiarEtapa(id, e.target.value as Etapa)}
        className="h-8 rounded-md border border-line bg-caja px-2 text-dato font-semibold text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
      >
        {ETAPAS.map((e) => (
          <option key={e.clave} value={e.clave}>
            {e.etiqueta}
          </option>
        ))}
      </select>
    </div>
  );
}
