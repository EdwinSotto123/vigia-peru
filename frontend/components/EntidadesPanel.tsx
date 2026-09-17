"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  Building2,
  AlertTriangle,
  Coins,
  Activity,
  ChevronRight,
  Flag,
  FileText,
  Loader2,
} from "lucide-react";
import { TIPO_SHORT, type TipoEntidad } from "@/lib/mock-entities";
import {
  entidadesQueryString,
  type ApiEntidad,
  type EntidadesPagina,
  type EntidadesQuery,
  type EntidadesResumen,
} from "@/lib/api-client";
import { formatSoles } from "@/lib/mock-data";
import { Paginacion } from "@/components/ui/Paginacion";
import { cn } from "@/lib/utils";

type SortKey = "alertas" | "monto" | "score";

const TIPO_FILTERS: { id: TipoEntidad | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "municipal_distrital", label: "Mun. Distrital" },
  { id: "municipal_provincial", label: "Mun. Provincial" },
  { id: "gobierno_regional", label: "Gob. Regional" },
  { id: "ministerio", label: "Ministerio" },
  { id: "empresa_publica", label: "Empresa Pública" },
];

interface Props {
  /** Filtros activos, leídos de la URL por el server component (page.tsx). */
  query: EntidadesQuery;
  /** Página ya traída server-side (real u origen mock si el API falló). */
  initial: EntidadesPagina | null;
  /** KPIs globales (no respetan `query`): universo completo de entidades vigiladas. */
  resumen: EntidadesResumen | null;
}

/**
 * Antes: recibía un batch fijo de hasta 100 entidades y hacía búsqueda + tipo + orden
 * enteramente en el cliente, mostrando solo las primeras 20 sin forma de ver el resto.
 * Ahora: búsqueda y tipo viajan en la URL (`?q=&tipo=&page=`) y el server component
 * vuelve a pedir la página exacta al API — el orden (`sort`) es la única cosa que sigue
 * siendo puramente cosmético: solo reordena las filas de la página actual, no cambia
 * cuáles filas existen.
 */
export function EntidadesPanel({ query, initial, resumen }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, start] = useTransition();
  const [q, setQ] = useState(query.q ?? "");
  const [sort, setSort] = useState<SortKey>("alertas");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setQ(query.q ?? "");
  }, [query.q]);

  const navegar = (patch: Partial<EntidadesQuery>) => {
    const qs = entidadesQueryString({ ...query, ...patch, page: 1 });
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const onQ = (v: string) => {
    setQ(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => navegar({ q: v.trim() || undefined }), 350);
  };

  const rows = initial?.data ?? [];
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sort === "alertas") return b.alertas - a.alertas;
      if (sort === "monto") return b.monto - a.monto;
      return b.scorePromedio - a.scorePromedio;
    });
  }, [rows, sort]);

  const total = initial?.total ?? 0;
  const tam = initial?.size ?? 20;
  const actual = initial?.page ?? query.page ?? 1;
  const paginas = Math.max(1, Math.ceil(total / tam));
  const hrefPagina = (n: number) => {
    const qs = entidadesQueryString({ ...query, page: n });
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const totals = resumen ?? { totalEntidades: 0, conAlertas: 0, monto: 0 };
  const tipoActivo = query.tipo ?? "todos";

  return (
    <section className="surface overflow-hidden p-0">
      {/* Header */}
      <div className="border-b border-line bg-paperDeep px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-clay">
              <Building2 size={11} /> Ranking
            </div>
            <h3 className="font-serif text-2xl font-bold text-ink">
              Entidades del Estado vigiladas
            </h3>
            <p className="mt-1 text-sm text-mute">
              {totals.totalEntidades.toLocaleString("es-PE")} entidades ·{" "}
              {totals.conAlertas.toLocaleString("es-PE")} con alertas activas ·{" "}
              {formatSoles(totals.monto)} bajo seguimiento
            </p>
          </div>
          <Link
            href="/reporte/nuevo?modo=entidad"
            className="inline-flex items-center gap-1.5 rounded-full bg-rust px-3.5 py-2 text-xs font-medium text-paper hover:bg-rust/90"
          >
            <Flag size={13} /> Reportar entidad
          </Link>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-3 border-b border-line bg-paperSoft px-5 py-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Buscar por nombre, RUC, región o provincia…"
            className="w-full rounded-full border border-line bg-paper px-9 py-2 text-sm placeholder:text-mute focus:border-clay focus:outline-none"
          />
          {pendiente && (
            <Loader2
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-mute"
              aria-label="Cargando"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Tipo filters */}
          <div className="flex flex-wrap gap-1">
            {TIPO_FILTERS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navegar({ tipo: t.id === "todos" ? undefined : (t.id as TipoEntidad) })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  tipoActivo === t.id
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-paper text-mute hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Sort: cosmético, solo reordena las filas de la página actual */}
          <div className="flex items-center gap-1 rounded-full border border-line bg-paper p-0.5 text-[11px]">
            <span className="px-2 text-mute">Ordenar:</span>
            {(
              [
                { id: "alertas", label: "Alertas", icon: AlertTriangle },
                { id: "monto", label: "Monto", icon: Coins },
                { id: "score", label: "Score", icon: Activity },
              ] as const
            ).map((s) => {
              const I = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSort(s.id)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors",
                    sort === s.id
                      ? "bg-paperDeep text-ink"
                      : "text-mute hover:text-ink",
                  )}
                >
                  <I size={11} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="divide-y divide-line">
        {sorted.length === 0 && (
          <div className="px-5 py-12 text-center text-sm text-mute">
            Sin resultados para esa búsqueda.
          </div>
        )}
        {sorted.map((e, i) => (
          <EntidadRow key={e.ruc} ent={e} rank={i + 1} sortKey={sort} />
        ))}
      </div>

      <div className="border-t border-line bg-paperSoft px-5 py-3">
        <Paginacion
          actual={actual}
          paginas={paginas}
          total={total}
          tam={tam}
          navegacion="url"
          href={hrefPagina}
          onChange={() => {}}
          cargando={false}
          nombre="entidades"
        />
      </div>
    </section>
  );
}

function EntidadRow({
  ent,
  rank,
  sortKey,
}: {
  ent: ApiEntidad;
  rank: number;
  sortKey: SortKey;
}) {
  const tipoColor: Record<TipoEntidad, string> = {
    municipal_distrital: "bg-amber-soft text-amber",
    municipal_provincial: "bg-amber-soft text-amber",
    gobierno_regional: "bg-crimson-soft text-rust",
    ministerio: "bg-paperDeep text-ink",
    empresa_publica: "bg-amber-soft text-clay",
    organismo_autonomo: "bg-paperDeep text-mute",
  };
  return (
    <Link
      href={`/entidad/${ent.ruc}`}
      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paperDeep"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paperDeep font-mono text-xs font-bold text-mute">
        #{rank}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-mute">RUC {ent.ruc}</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
              tipoColor[ent.tipo],
            )}
          >
            {TIPO_SHORT[ent.tipo]}
          </span>
          <span className="text-[10px] text-mute">{ent.region}</span>
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-ink">
          {ent.nombre}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-mute">
          <span>
            <FileText size={10} className="mr-1 inline" />
            {(ent.contratos ?? 0).toLocaleString("es-PE")} contratos · {ent.contratosVigilados ?? 0} con alertas
          </span>
        </div>
      </div>

      <div className="hidden text-right md:block">
        <KPIBlock
          label="Alertas"
          value={ent.alertas.toString()}
          highlight={sortKey === "alertas"}
        />
      </div>
      <div className="hidden text-right md:block">
        <KPIBlock
          label="Monto"
          value={formatSoles(ent.monto)}
          highlight={sortKey === "monto"}
        />
      </div>
      <div className="text-right">
        <KPIBlock
          label="Score"
          value={ent.scorePromedio.toString()}
          highlight={sortKey === "score"}
          big
        />
      </div>
      <ChevronRight size={16} className="text-mute group-hover:text-clay" />
    </Link>
  );
}

function KPIBlock({
  label,
  value,
  highlight,
  big,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  big?: boolean;
}) {
  return (
    <div>
      <div
        className={cn(
          "font-mono font-bold tabular-nums",
          big ? "text-lg" : "text-sm",
          highlight ? "text-clay" : "text-ink",
        )}
      >
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-mute">{label}</div>
    </div>
  );
}
