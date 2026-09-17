"use client";

/**
 * Filtros del histórico de procesados (debajo del tablero en vivo): rango de fechas +
 * patrocinador. Mismo patrón que FiltroRegion.tsx — navega con query params, cae al
 * valor de la URL sin JS. Cambiar cualquier filtro vuelve a la página 1 del histórico.
 */

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import type { FinanciadorProcesamientos } from "@/lib/auditoria";

interface Props {
  desde?: string;
  hasta?: string;
  financiador?: string;
  financiadores: FinanciadorProcesamientos[];
}

export function FiltrosHistorico({ desde, hasta, financiador, financiadores }: Props) {
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

  const hayFiltros = !!(desde || hasta || financiador);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink">
        <span className="text-[11px] text-mute">Desde</span>
        <input
          type="date"
          value={desde ?? ""}
          max={hasta || undefined}
          onChange={(e) => navegar({ desde: e.target.value || undefined })}
          className="bg-transparent text-sm outline-none [color-scheme:light] dark:[color-scheme:dark]"
        />
      </label>
      <label className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink">
        <span className="text-[11px] text-mute">Hasta</span>
        <input
          type="date"
          value={hasta ?? ""}
          min={desde || undefined}
          onChange={(e) => navegar({ hasta: e.target.value || undefined })}
          className="bg-transparent text-sm outline-none [color-scheme:light] dark:[color-scheme:dark]"
        />
      </label>
      <label className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink">
        <Search size={14} className="text-mute" aria-hidden />
        <span className="sr-only">Filtrar por patrocinador</span>
        <select
          value={financiador ?? ""}
          onChange={(e) => navegar({ financiador: e.target.value || undefined })}
          className="max-w-[14rem] bg-transparent pr-1 text-sm outline-none"
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
          className="inline-flex items-center gap-1 rounded-xl border border-dashed border-line px-2.5 py-2 text-[12px] text-mute hover:text-ink"
        >
          <X size={12} aria-hidden /> Limpiar
        </button>
      )}
      {pendiente && <Loader2 size={14} className="animate-spin text-mute" aria-label="Cargando" />}
    </div>
  );
}
