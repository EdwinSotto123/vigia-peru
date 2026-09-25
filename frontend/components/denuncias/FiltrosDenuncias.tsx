"use client";

/**
 * Filtros de /app/denuncias: región, categoría y estado (confirmada / sin
 * confirmar). Viven en la URL (`?region=&categoria=&estado=`), mismo patrón
 * que FiltroRegion.tsx / FiltrosHistorico.tsx (auditoría): cada cambio hace
 * `router.push`, cae al valor de la URL sin JS, vuelve a la página 1.
 *
 * El estado de moderación (pendiente/aprobado/rechazado) del backend NO se usa
 * como filtro público a propósito: la página existe para mostrar TODAS las
 * denuncias ciudadanas ("son públicas y verificables"), no solo las aprobadas.
 */

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, MapPin, Tag, ShieldCheck, X } from "lucide-react";
import { REGIONES } from "@/lib/peru-data";
import { CATEGORIA_META, TODAS_CATEGORIAS } from "@/lib/denuncias-meta";
import { denunciasQueryString, type DenunciasQuery } from "@/lib/denuncias-query";

const REGIONES_ORDENADAS = [...REGIONES].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

interface Props {
  query: DenunciasQuery;
}

export function FiltrosDenuncias({ query }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, start] = useTransition();

  const navegar = (patch: Partial<DenunciasQuery>) => {
    const qs = denunciasQueryString({ ...query, ...patch, page: 1 });
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const hayFiltros = !!(query.region || query.categoria || query.estado);
  const sel = "min-w-0 bg-transparent pr-1 text-sm text-ink";
  const caja =
    "inline-flex min-h-[40px] max-w-full items-center gap-2 rounded-xl border border-line bg-paper px-3 py-1.5 text-sm text-ink transition-colors duration-rapido focus-within:border-granate hover:border-paperEdge";

  return (
    // Sin caja propia: vive dentro de la barra de herramientas de la lista (DenunciasGrid).
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar denuncias">
      <label className={caja}>
        <MapPin size={14} className="text-mute" aria-hidden />
        <span className="sr-only">Filtrar por región</span>
        <select value={query.region ?? ""} onChange={(e) => navegar({ region: e.target.value || undefined })} className={sel}>
          <option value="">Todas las regiones</option>
          {REGIONES_ORDENADAS.map((r) => (
            <option key={r.id} value={r.nombre}>{r.nombre}</option>
          ))}
        </select>
      </label>

      <label className={caja}>
        <Tag size={14} className="text-mute" aria-hidden />
        <span className="sr-only">Filtrar por categoría</span>
        <select
          value={query.categoria ?? ""}
          onChange={(e) => navegar({ categoria: (e.target.value || undefined) as DenunciasQuery["categoria"] })}
          className={sel}
        >
          <option value="">Toda categoría</option>
          {TODAS_CATEGORIAS.map((c) => (
            <option key={c} value={c}>{CATEGORIA_META[c].label}</option>
          ))}
        </select>
      </label>

      <label className={caja}>
        <ShieldCheck size={14} className="text-mute" aria-hidden />
        <span className="sr-only">Filtrar por estado</span>
        <select
          value={query.estado ?? ""}
          onChange={(e) => navegar({ estado: (e.target.value || undefined) as DenunciasQuery["estado"] })}
          className={sel}
        >
          <option value="">Confirmadas y sin confirmar</option>
          <option value="verificados">Confirmadas</option>
          <option value="en_validacion">Sin confirmar</option>
        </select>
      </label>

      {hayFiltros && (
        <button
          type="button"
          onClick={() => start(() => router.push(pathname, { scroll: false }))}
          className="inline-flex min-h-[40px] items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium text-inkSoft underline-offset-2 transition-colors duration-rapido hover:bg-paperDeep hover:text-ink hover:underline"
        >
          <X size={13} aria-hidden /> Quitar filtros
        </button>
      )}
      {pendiente && <Loader2 size={14} className="animate-spin text-mute" aria-label="Cargando…" />}
    </div>
  );
}
