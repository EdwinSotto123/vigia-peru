"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, AlertTriangle, Coins, Activity, ChevronRight, Flag, FileText, Loader2 } from "lucide-react";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import {
  entidadesQueryString,
  type ApiEntidad,
  type EntidadesPagina,
  type EntidadesQuery,
  type EntidadesResumen,
} from "@/lib/api-client";
import { formatSoles } from "@/lib/formato";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { Paginacion } from "@/components/ui/Paginacion";
import { cn } from "@/lib/utils";

type SortKey = "alertas" | "monto" | "score";

interface Props {
  /** Filtros activos, leídos de la URL por el server component (page.tsx). */
  query: EntidadesQuery;
  /** Página ya traída server-side. */
  initial: EntidadesPagina | null;
  /** KPIs globales (no respetan `query`): universo completo de entidades vigiladas. */
  resumen: EntidadesResumen | null;
}

/**
 * Ranking de entidades. La búsqueda viaja en la URL (`?q=&page=`) y el server
 * component vuelve a pedir la página exacta al API. El orden (`sort`) sólo
 * reordena las filas de la página actual.
 *
 * El número de puesto (#N) es el del ranking por contratos con señales, que es
 * como ordena el backend: se calcula sobre toda la lista ((página-1)×tamaño+i+1),
 * no sobre la página (antes cada página volvía a empezar en #1).
 *
 * No hay filtro por tipo: el backend tiene el tipo en nulo para casi todas las
 * entidades, y filtrar por "Gobierno regional" escondía a la mayoría de ellos.
 * El tipo se muestra igual, inferido del nombre oficial (lib/entidad-tipo.ts).
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

  const total = initial?.total ?? 0;
  const tam = initial?.size ?? 20;
  const actual = initial?.page ?? query.page ?? 1;
  const paginas = Math.max(1, Math.ceil(total / tam));

  // Puesto en el ranking: por contratos con señales (el orden del backend, con
  // el orden del servidor como desempate), contando las páginas anteriores.
  const conPuesto = useMemo(() => {
    const filas = initial?.data ?? [];
    const base = filas.map((e, i) => ({ e, i })).sort((a, b) => b.e.alertas - a.e.alertas || a.i - b.i);
    return base.map(({ e }, k) => ({ e, puesto: (actual - 1) * tam + k + 1 }));
  }, [initial, actual, tam]);

  const sorted = useMemo(() => {
    return [...conPuesto].sort((a, b) => {
      if (sort === "alertas") return a.puesto - b.puesto;
      if (sort === "monto") return b.e.monto - a.e.monto;
      return b.e.scorePromedio - a.e.scorePromedio;
    });
  }, [conPuesto, sort]);

  const hrefPagina = (n: number) => {
    const qs = entidadesQueryString({ ...query, page: n });
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const totals = resumen ?? { totalEntidades: 0, conAlertas: 0, monto: 0 };
  const qRuc = /^\d{11}$/.test((query.q ?? "").trim()) ? (query.q ?? "").trim() : null;

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-bold text-ink">Ranking de entidades</h2>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-mute">Entidades vigiladas</dt>
                <dd className="font-mono text-lg font-bold text-ink">
                  <NumberTicker value={totals.totalEntidades} />
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-mute">Con contratos con señales</dt>
                <dd className={cn("font-mono text-lg font-bold", totals.conAlertas > 0 ? "text-amberTexto" : "text-ink")}>
                  <NumberTicker value={totals.conAlertas} />
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-mute">Monto de esos contratos</dt>
                <dd className="font-mono text-lg font-bold text-ink">{formatSoles(totals.monto)}</dd>
              </div>
            </dl>
          </div>
          <Link
            href="/reporte/nuevo?modo=entidad"
            className="inline-flex items-center gap-1.5 rounded-full bg-rust px-3.5 py-2 text-xs font-medium text-paper hover:bg-rust/90"
          >
            <Flag size={13} aria-hidden /> Denunciar una entidad
          </Link>
        </div>
      </div>

      <div className="space-y-3 border-b border-line bg-paperSoft px-4 py-4 sm:px-5">
        <div className="relative">
          <label htmlFor="buscar-entidad" className="sr-only">
            Buscar una entidad por su nombre
          </label>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
          <input
            id="buscar-entidad"
            type="search"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Buscar por nombre de la entidad…"
            className="w-full rounded-full border border-line bg-paper px-9 py-2 text-sm placeholder:text-mute focus:border-heroViolet focus:outline-none"
          />
          {pendiente && (
            <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-mute" aria-label="Cargando" />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[60ch] text-[12px] leading-snug text-mute">
            <strong className="font-semibold text-inkSoft">Puntaje de riesgo:</strong> el promedio, de 0 a 100, del
            puntaje de sus contratos con señales. Cada contrato suma el peso de sus señales según su severidad.
          </p>
          <div className="flex items-center gap-1 rounded-full border border-line bg-paper p-0.5 text-[11px]" role="group" aria-label="Ordenar esta página">
            <span className="px-2 text-mute">Ordenar:</span>
            {(
              [
                { id: "alertas", label: "Contratos con señales", icon: AlertTriangle },
                { id: "monto", label: "Monto", icon: Coins },
                { id: "score", label: "Puntaje", icon: Activity },
              ] as const
            ).map((s) => {
              const I = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={sort === s.id}
                  onClick={() => setSort(s.id)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors",
                    sort === s.id ? "bg-paperDeep text-ink" : "text-mute hover:text-ink",
                  )}
                >
                  <I size={11} aria-hidden />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="divide-y divide-line">
        {sorted.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-paperDeep text-mute" aria-hidden>
              <Search size={18} />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">Ninguna entidad se llama así</p>
              <p className="mt-0.5 text-xs text-mute">Prueba con otra palabra del nombre oficial.</p>
            </div>
            {qRuc && (
              <Link href={`/entidad/${qRuc}`} className="text-xs font-medium text-heroViolet hover:underline">
                Abrir la ficha del RUC {qRuc}
              </Link>
            )}
            {query.q && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  navegar({ q: undefined });
                }}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-paperDeep"
              >
                Borrar la búsqueda
              </button>
            )}
          </div>
        )}
        {sorted.map(({ e, puesto }) => (
          <EntidadRow key={e.ruc} ent={e} rank={puesto} sortKey={sort} />
        ))}
      </div>

      <div className="border-t border-line bg-paperSoft px-4 py-3 sm:px-5">
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

function EntidadRow({ ent, rank, sortKey }: { ent: ApiEntidad; rank: number; sortKey: SortKey }) {
  // Un chip neutro para todos los tipos: el tipo de entidad no es un nivel de
  // riesgo. Se infiere del nombre oficial cuando el backend no lo declara, y si
  // no se puede, dice "Sin clasificar".
  const tipoLabel = etiquetaTipoEntidad(ent.tipo, ent.nombre, "corto");
  // Las entidades sembradas para la demo traen `metadata` inventada, y el backend
  // cae a `metadata.contratos` cuando no hay convocatorias reales: en esas filas
  // (se reconocen porque traen `reportes`/`serie` de la misma metadata) el total
  // de contratos no es confiable y no se muestra.
  const contratosConfiables = ent.reportes == null && ent.serie == null;
  return (
    <Link href={`/entidad/${ent.ruc}`} className="group flex items-center gap-3 px-4 py-4 transition-colors hover:bg-paperDeep sm:gap-4 sm:px-5">
      <div className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg bg-paperDeep px-1.5 font-mono text-xs font-bold text-inkSoft">
        #{rank}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono text-[11px] text-mute">RUC {ent.ruc}</span>
          <span className="rounded-full bg-paperDeep px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-inkSoft">{tipoLabel}</span>
          {ent.region && <span className="text-[11px] text-mute">{ent.region}</span>}
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-ink">{ent.nombre}</div>
        <div className="mt-1 text-[11px] text-mute">
          <FileText size={10} className="mr-1 inline" aria-hidden />
          {ent.alertas.toLocaleString("es-PE")} {ent.alertas === 1 ? "contrato con señales" : "contratos con señales"}
          {contratosConfiables && ent.contratos != null && ` de ${ent.contratos.toLocaleString("es-PE")} ${ent.contratos === 1 ? "registrado" : "registrados"}`}
        </div>
      </div>

      <div className="hidden text-right md:block">
        <KPIBlock label="Monto" value={formatSoles(ent.monto)} highlight={sortKey === "monto"} />
      </div>
      <div className="text-right">
        <KPIBlock label="Con señales" value={ent.alertas.toString()} highlight={sortKey === "alertas"} big />
      </div>
      <div className="hidden text-right sm:block">
        <KPIBlock label="Puntaje" value={ent.alertas > 0 ? ent.scorePromedio.toString() : "—"} highlight={sortKey === "score"} />
      </div>
      <ChevronRight size={16} className="shrink-0 text-mute transition-colors group-hover:text-heroViolet" aria-hidden />
    </Link>
  );
}

function KPIBlock({ label, value, highlight, big }: { label: string; value: string; highlight?: boolean; big?: boolean }) {
  return (
    <div>
      <div className={cn("font-mono font-bold tabular-nums", big ? "text-lg" : "text-sm", highlight ? "text-heroViolet" : "text-ink")}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-mute">{label}</div>
    </div>
  );
}
