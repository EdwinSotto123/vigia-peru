"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Search,
  Building2,
  AlertTriangle,
  Coins,
  Activity,
  ChevronRight,
  Flag,
  FileText,
} from "lucide-react";
import {
  TIPO_LABELS,
  TIPO_SHORT,
  type Entidad,
  type TipoEntidad,
} from "@/lib/mock-entities";
import { formatSoles } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

type SortKey = "alertas" | "monto" | "score";

/** Shape mínimo que necesita el panel. Funciona con el mock o con ApiEntidad. */
interface PanelEntidad extends Omit<Entidad, "id" | "serie" | "reportes" | "contratos" | "contratosVigilados"> {
  id?: string;
  serie?: number[] | null;
  reportes?: number | null;
  contratos?: number | null;
  contratosVigilados?: number | null;
}

const TIPO_FILTERS: { id: TipoEntidad | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "municipal_distrital", label: "Mun. Distrital" },
  { id: "municipal_provincial", label: "Mun. Provincial" },
  { id: "gobierno_regional", label: "Gob. Regional" },
  { id: "ministerio", label: "Ministerio" },
  { id: "empresa_publica", label: "Empresa Pública" },
];

export function EntidadesPanel({
  entidades,
}: {
  entidades: PanelEntidad[];
}) {
  const [query, setQuery] = useState("");
  const [tipo, setTipo] = useState<TipoEntidad | "todos">("todos");
  const [sort, setSort] = useState<SortKey>("alertas");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = entidades.filter((e) => {
      if (tipo !== "todos" && e.tipo !== tipo) return false;
      if (!q) return true;
      return (
        e.nombre.toLowerCase().includes(q) ||
        e.ruc.includes(q) ||
        e.region.toLowerCase().includes(q) ||
        (e.provincia ?? "").toLowerCase().includes(q)
      );
    });
    return list.sort((a, b) => {
      if (sort === "alertas") return b.alertas - a.alertas;
      if (sort === "monto") return b.monto - a.monto;
      return b.scorePromedio - a.scorePromedio;
    });
  }, [query, tipo, sort, entidades]);

  const totals = useMemo(
    () => ({
      entidades: entidades.length,
      conAlertas: entidades.filter((e) => e.alertas > 0).length,
      monto: entidades.reduce((s, e) => s + e.monto, 0),
    }),
    [entidades],
  );

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
              {totals.entidades} entidades · {totals.conAlertas} con alertas activas ·{" "}
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, RUC, región o provincia…"
            className="w-full rounded-full border border-line bg-paper px-9 py-2 text-sm placeholder:text-mute focus:border-clay focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Tipo filters */}
          <div className="flex flex-wrap gap-1">
            {TIPO_FILTERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTipo(t.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  tipo === t.id
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-paper text-mute hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Sort */}
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
        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center text-sm text-mute">
            Sin resultados para esa búsqueda.
          </div>
        )}
        {filtered.slice(0, 20).map((e, i) => (
          <EntidadRow key={e.ruc} ent={e} rank={i + 1} sortKey={sort} />
        ))}
      </div>

      {filtered.length > 20 && (
        <div className="border-t border-line bg-paperSoft px-5 py-3 text-center text-xs text-mute">
          Mostrando 20 de {filtered.length}. Refiná la búsqueda para ver más.
        </div>
      )}
    </section>
  );
}

function EntidadRow({
  ent,
  rank,
  sortKey,
}: {
  ent: PanelEntidad;
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
            {ent.contratos} contratos · {ent.contratosVigilados} vigilados
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
