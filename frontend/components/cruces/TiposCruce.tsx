"use client";

import { Check } from "lucide-react";
import { useListado } from "@/components/listado";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";
import { GRUPOS_CRUCE, TIPO_CRUCE } from "@/lib/cruces";

/**
 * "Qué se cruzó": todos los tipos de cruce a la vista, agrupados, cada uno con cuántos casos quedarían al elegirlo.
 * Es el filtro que la página existe para responder, así que no va escondido detrás de "Filtros". Se pueden marcar
 * varios (casos con cualquiera de ellos); `todos=1` pide los que tienen todos a la vez.
 */
export function TiposCruce({ conteos }: { conteos: Record<string, number> | null }) {
  const { parametros, navegar } = useListado();
  const activos = (parametros.tipo ?? "").split(",").filter(Boolean);
  const alternar = (tipo: string) => {
    const nuevos = activos.includes(tipo) ? activos.filter((t) => t !== tipo) : [...activos, tipo];
    navegar({ tipo: nuevos.join(",") || undefined, todos: nuevos.length > 1 ? parametros.todos : undefined });
  };

  return (
    <section aria-labelledby="tipos-cruce" className="rounded-2xl border border-line bg-paper px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tipos-cruce" className="text-[14px] font-semibold text-ink">
          Qué se cruzó
        </h2>
        <div className="flex items-center gap-3 text-[12.5px]">
          {activos.length > 1 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-inkSoft">
              <input
                type="checkbox"
                className="accent-granate"
                checked={parametros.todos === "1"}
                onChange={(e) => navegar({ todos: e.target.checked ? "1" : undefined })}
              />
              Que tengan todos a la vez
            </label>
          )}
          {activos.length > 0 && (
            <button type="button" className="text-granate underline-offset-2 hover:underline" onClick={() => navegar({ tipo: undefined, todos: undefined })}>
              Ver todos los tipos
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        {GRUPOS_CRUCE.map((g) => (
          <div key={g.titulo}>
            <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-mute">{g.titulo}</p>
            <ul className="flex flex-wrap gap-1.5">
              {g.tipos.map((t) => {
                const n = conteos ? conteos[t.tipo] ?? 0 : null;
                const activo = activos.includes(t.tipo);
                return (
                  <li key={t.tipo}>
                    <button
                      type="button"
                      onClick={() => alternar(t.tipo)}
                      aria-pressed={activo}
                      title={t.explica}
                      disabled={!activo && n === 0}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] transition-colors duration-rapido",
                        activo ? "border-granate bg-granate text-paper" : "border-line text-ink hover:border-paperEdge",
                        !activo && n === 0 && "cursor-default opacity-40",
                      )}
                    >
                      {activo && <Check size={12} aria-hidden />}
                      {t.corto}
                      {n != null && <span className={cn("tabular-nums", activo ? "text-paper/80" : "text-mute")}>{numero(n)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {activos.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-2.5 text-[12.5px] text-inkSoft">
          {activos.map((t) => (
            <li key={t}>
              <span className="font-medium text-ink">{TIPO_CRUCE[t]?.corto ?? t}:</span> {TIPO_CRUCE[t]?.explica ?? ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
