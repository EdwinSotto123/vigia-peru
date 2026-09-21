"use client";

/**
 * Filtros de /app/alertas. Mismo patrón que FiltroRegion/FiltrosHistorico/FiltrosContratos:
 * viven en la URL (`?region=&estado=&scoreMin=&pagina=`), cada cambio hace `router.push`
 * y vuelve a la página 1. Los tipos y el parseo/armado de la query están en
 * lib/alertas-query.ts (no acá): ese módulo lo necesita llamar directamente page.tsx
 * (Server Component), y un export de un archivo "use client" como este se vuelve, del
 * lado del servidor, un proxy de referencia solo válido como <Componente/> — invocarlo
 * como función normal revienta el build ("x is not a function") aunque tsc no lo vea.
 *
 * `region` es texto libre (provincia o departamento, p.ej. "Lima", "San Ignacio") porque
 * el backend hace match exacto (`a.region = $1`) contra un valor Title Case (ver
 * backend/scrapers/oece_ocds/pipeline.py:slug_region) — no es un enum chico como `estado`,
 * así que un <select> con una lista fija quedaría incompleto. Se normaliza a Title Case acá
 * para no exigirle al usuario que adivine mayúsculas exactas.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { alertasQueryString, ESTADOS_ALERTA, type AlertasQuery, type EstadoAlerta } from "@/lib/alertas-query";

const SCORE_PRESETS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: "Cualquiera" },
  { value: 50, label: "≥ 50" },
  { value: 75, label: "≥ 75" },
];

/** 'SAN IGNACIO' → 'San Ignacio'; 'lima' → 'Lima' (misma convención que slug_region en el scraper). */
function tituloCaso(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\p{L}+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

export function FiltrosAlertas({ query }: { query: AlertasQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, start] = useTransition();
  const [region, setRegion] = useState(query.region ?? "");
  const timer = useRef<number | null>(null);

  useEffect(() => setRegion(query.region ?? ""), [query.region]);

  const navegar = (patch: Partial<AlertasQuery>) => {
    const qs = alertasQueryString({ ...query, ...patch });
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const onRegion = (v: string) => {
    setRegion(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => navegar({ region: tituloCaso(v) || undefined }), 400);
  };

  const limpiarTodo = () => {
    setRegion("");
    start(() => router.push(pathname, { scroll: false }));
  };

  const hayFiltros = !!(query.region || query.estado || query.scoreMin != null);
  // heroViolet es el color de foco/acción del sitio (ver tailwind.config.ts); "clay" es
  // semántica de advertencia real (EstadoPill, Bitacora) y no debe usarse en un input de
  // texto sin motivo de estado — antes ambos campos usaban focus:border-clay decorativo.
  const campo = "h-9 rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none transition-colors focus:border-heroViolet";

  return (
    // Pegajosa: con hasta 24 alertas por página, cambiar de región/estado obligaba a volver
    // a scrollear hasta arriba — mismo problema de "mucho scroll" que la paginación ya
    // resuelve para navegar entre páginas, pero para el filtro no había ningún atajo.
    // `top-0`, no `top-16`: a diferencia del sitio público (components/Header.tsx, sticky
    // top-0 h-16), el layout de /app/* no tiene barra superior — DashboardSidebar es una
    // columna IZQUIERDA (`md:sticky md:top-0`), no una franja horizontal — así que acá no
    // hay ningún header debajo del cual "esconderse". Mismo recipe (sticky + blur + bg-paper
    // + border-b) que ya usa el header de AdminShell.tsx en un layout con sidebar igual de
    // angosto.
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line/70 bg-paper/95 py-2.5 backdrop-blur">
      <label className="relative flex items-center">
        <Search size={13} className="pointer-events-none absolute left-3 text-mute" aria-hidden />
        <span className="sr-only">Filtrar por región o provincia</span>
        <input
          value={region}
          onChange={(e) => onRegion(e.target.value)}
          placeholder="Región o provincia…"
          className={cn(campo, "w-48 pl-8")}
        />
      </label>

      <select
        value={query.estado ?? ""}
        onChange={(e) => navegar({ estado: (e.target.value || undefined) as EstadoAlerta | undefined })}
        className={campo}
        aria-label="Filtrar por estado"
      >
        <option value="">Todo estado</option>
        {(Object.keys(ESTADOS_ALERTA) as EstadoAlerta[]).map((v) => (
          <option key={v} value={v}>{ESTADOS_ALERTA[v].label}</option>
        ))}
      </select>

      <span className="inline-flex items-center gap-0.5 rounded-xl border border-line bg-paper p-1" role="group" aria-label="Score mínimo">
        {SCORE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => navegar({ scoreMin: p.value })}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
              query.scoreMin === p.value ? "bg-ink text-paper" : "text-ink hover:bg-paperDeep",
            )}
            aria-pressed={query.scoreMin === p.value}
          >
            {p.label}
          </button>
        ))}
      </span>

      {hayFiltros && (
        <button
          type="button"
          onClick={limpiarTodo}
          className="inline-flex items-center gap-1 rounded-xl border border-dashed border-line px-2.5 py-2 text-[12px] text-mute transition-colors hover:bg-paperDeep hover:text-ink"
        >
          <X size={12} aria-hidden /> Limpiar
        </button>
      )}
      {pendiente && <Loader2 size={14} className="animate-spin text-mute" aria-label="Cargando" />}
    </div>
  );
}
