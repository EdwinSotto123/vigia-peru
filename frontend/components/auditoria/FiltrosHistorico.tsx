"use client";

/**
 * Filtros del histórico de procesados: rango de fechas + patrocinador — las columnas 2 y 3
 * del filtro consolidado de /app/auditoria (la 1ª es FiltroRegion.tsx). Mismo patrón: navega
 * con query params, cae al valor de la URL sin JS. Cambiar cualquier filtro vuelve a la
 * página 1 del histórico.
 */

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar, Loader2, Search, X } from "lucide-react";
import type { FinanciadorProcesamientos } from "@/lib/auditoria";

function useNavegarFiltro() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendiente, start] = useTransition();

  const navegar = (cambios: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams?.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete("pagina"); // cualquier cambio de filtro vuelve a la página 1
    const qs = params.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return { navegar, pendiente };
}

export function FiltroFechas({ desde, hasta }: { desde?: string; hasta?: string }) {
  const { navegar, pendiente } = useNavegarFiltro();
  // Un solo cuadro con las dos fechas (no dos cajas con borde propio): dos <input type="date">
  // completos ya no entran uno junto al otro en el ancho de una sola columna de 3.
  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink">
      <Calendar size={14} className="shrink-0 text-mute" aria-hidden />
      <input
        type="date"
        aria-label="Desde"
        value={desde ?? ""}
        max={hasta || undefined}
        onChange={(e) => navegar({ desde: e.target.value || undefined })}
        className="w-full min-w-0 bg-transparent text-sm outline-none [color-scheme:light] dark:[color-scheme:dark]"
      />
      <span className="shrink-0 text-mute">–</span>
      <input
        type="date"
        aria-label="Hasta"
        value={hasta ?? ""}
        min={desde || undefined}
        onChange={(e) => navegar({ hasta: e.target.value || undefined })}
        className="w-full min-w-0 bg-transparent text-sm outline-none [color-scheme:light] dark:[color-scheme:dark]"
      />
      {pendiente && <Loader2 size={14} className="shrink-0 animate-spin text-mute" aria-label="Cargando" />}
    </div>
  );
}

export function FiltroPatrocinador({ financiador, financiadores, hayOtrosFiltros }: {
  financiador?: string;
  financiadores: FinanciadorProcesamientos[];
  /** Si desde/hasta también tienen valor, "Limpiar" los borra junto con el patrocinador. */
  hayOtrosFiltros?: boolean;
}) {
  const { navegar, pendiente } = useNavegarFiltro();
  const hayFiltros = !!financiador || hayOtrosFiltros;
  return (
    <div className="flex items-center gap-2">
      <label className="inline-flex flex-1 items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink">
        <Search size={14} className="shrink-0 text-mute" aria-hidden />
        <span className="sr-only">Filtrar por patrocinador</span>
        <select
          value={financiador ?? ""}
          onChange={(e) => navegar({ financiador: e.target.value || undefined })}
          className="w-full min-w-0 bg-transparent pr-1 text-sm outline-none"
        >
          <option value="">Todos los patrocinadores</option>
          {financiadores.map((f) => (
            <option key={f.nombre} value={f.nombre}>{f.nombre} · {f.n.toLocaleString("es-PE")}</option>
          ))}
        </select>
      </label>
      {hayFiltros && (
        <button
          type="button"
          onClick={() => navegar({ desde: undefined, hasta: undefined, financiador: undefined })}
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-dashed border-line px-2.5 py-2 text-[12px] text-mute hover:text-ink"
        >
          <X size={12} aria-hidden /> Limpiar
        </button>
      )}
      {pendiente && <Loader2 size={14} className="shrink-0 animate-spin text-mute" aria-label="Cargando" />}
    </div>
  );
}
