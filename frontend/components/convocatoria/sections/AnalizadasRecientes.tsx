"use client";

import { useEffect, useState } from "react";
import { Building2, ChevronRight, Search, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAnalyzedList } from "@/lib/dossier-cache";
import { esAlertaDemo } from "@/lib/semillas";
import { SEVERIDAD } from "@/lib/severidad";
import { formatSoles } from "@/lib/formato";
import { inferCategoria } from "../utils";
import type { CatFilter, SortKey } from "../types";
import { CAT_LABEL, CAT_TONE } from "../constants";
import { contarPorNivel, FRANJA_NIVEL, NIVEL_ANALISIS, nivelDeAnalisis, type NivelAnalisis } from "./conteoRiesgo";

type FiltroNivel = "todos" | NivelAnalisis;

/** Solo análisis reales: nunca las alertas de demo sembradas ni filas sin OCID o sin fecha de análisis. */
export const esAnalisisPublicado = (it: any) => !!it && !esAlertaDemo(it) && !!it.ocid && !!it.analizado_en;

export function AnalizadasRecientes({ onSelect }: { onSelect: (ocidOrCodigo: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<FiltroNivel>("todos");
  const [region, setRegion] = useState<string>("todas");
  const [cat, setCat] = useState<CatFilter>("todas");
  const [sort, setSort] = useState<SortKey>("reciente");
  const [shuffleKey, setShuffleKey] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 24; // 12 filas en el grid de 2 columnas → poco scroll por página

  useEffect(() => {
    getAnalyzedList(500)
      .then((d) => {
        if (d?.error) setErr(d.error);
        else setItems((d.items || []).filter(esAnalisisPublicado));
      })
      .catch((e) => setErr(e.message));
  }, []);
  // Volver a la página 1 cuando cambian filtros/orden/búsqueda (no quedar en una página vacía).
  useEffect(() => { setPage(1); }, [q, sev, region, cat, sort]);

  const fmtMoney = (n: number) => (n ? formatSoles(n) : "—");
  const fmtFecha = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diff < 1) return "hace instantes";
    if (diff < 60) return `hace ${diff}m`;
    if (diff < 1440) return `hace ${Math.floor(diff/60)}h`;
    return d.toLocaleDateString("es-PE");
  };

  // Skeleton loader
  if (err) return null;
  if (!items) {
    return (
      <section>
        <div className="mb-3 h-5 w-64 animate-pulse rounded bg-paperDeep" />
        <div className="surface space-y-0 divide-y divide-line p-0">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
              <div className="h-11 w-11 shrink-0 rounded-lg bg-paperDeep" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 rounded bg-paperDeep" />
                <div className="h-3 w-1/2 rounded bg-paperDeep" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // Filtrado en cliente — todos los datos ya vinieron en una sola query SQL
  const regionesUnicas = Array.from(new Set(items.map((it: any) => it.region).filter(Boolean))).sort() as string[];
  const qLower = q.trim().toLowerCase();

  // Anotar cada item con su categoría inferida (heurística por keywords)
  const itemsWithCat = items.map((it: any) => ({ ...it, _cat: inferCategoria(it.objeto) }));

  const filtered = itemsWithCat.filter((it: any) => {
    if (qLower) {
      const haystack = [
        it.codigo_convocatoria, it.ocid, it.objeto, it.entidad,
        it.entidad_ruc, it.proveedor_ruc,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(qLower)) return false;
    }
    if (region !== "todas" && it.region !== region) return false;
    if (cat    !== "todas" && it._cat !== cat) return false;
    // Mismo criterio que los contadores (conteoRiesgo): el nivel sale del puntaje.
    if (sev !== "todos" && nivelDeAnalisis(it) !== sev) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "score") return (b.score || 0) - (a.score || 0);
    if (sort === "monto") return (b.monto || 0) - (a.monto || 0);
    return String(b.analizado_en || "").localeCompare(String(a.analizado_en || ""));
  });

  // Paginación en cliente: se renderiza SOLO una página (PAGE_SIZE) a la vez — evita
  // saturar el DOM con todos los análisis y reduce el scroll. Los filtros/orden ya
  // corrieron sobre el total, así que paginar es puramente de presentación.
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  const handleShuffle = () => {
    if (sorted.length === 0) return;
    const pick = sorted[Math.floor(Math.random() * sorted.length)];
    setShuffleKey(k => k + 1);
    onSelect(pick.codigo_convocatoria || pick.ocid);
  };

  if (items.length === 0) {
    return (
      <div className="surface p-6 text-center">
        <h2 className="font-serif text-base font-bold text-ink">Análisis publicados</h2>
        <p className="mt-2 text-sm text-mute">
          Todavía no hay contratos analizados publicados.
        </p>
      </div>
    );
  }

  // Conteo por nivel de riesgo: la MISMA función que usa el panel lateral.
  const conteo = contarPorNivel(items);

  const sevChip = (key: FiltroNivel, label: string, count: number, punto: string | null, title?: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setSev(key)}
      aria-pressed={sev === key}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
        sev === key
          ? "border-transparent bg-ink text-paper shadow-sm"
          : "border-line bg-paper text-ink hover:bg-paperDeep",
      )}
    >
      {punto && <span aria-hidden className={cn("inline-block h-1.5 w-1.5 rounded-full", punto)} />}
      <span>{label}</span>
      <span className={cn(
        "rounded-full px-1.5 py-0 text-[10px] tabular-nums",
        sev === key ? "bg-paper/20 text-paper" : "bg-paperDeep text-mute",
      )}>{count}</span>
    </button>
  );

  return (
    <section>
      {/* HEADER + BARRA DE FILTROS · todo en una sola hilera compacta */}
      <div className="surface mb-3 space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="font-serif text-base font-bold text-ink">Análisis publicados</h2>
              <span className="rounded-full bg-paperDeep px-1.5 py-0 font-mono text-[10px] font-bold text-ink">{items.length}</span>
            </div>
          </div>

          {/* Search inline */}
          <div className="relative ml-auto flex-1 sm:min-w-[260px] sm:max-w-[360px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Filtrar los análisis publicados"
              placeholder="Filtrar por código, objeto o RUC…"
              className="w-full rounded-lg border border-line bg-paper py-1.5 pl-7 pr-7 text-xs placeholder:text-mute focus:border-heroViolet focus:outline-none focus:ring-1 focus:ring-heroViolet/30"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Borrar el filtro"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-1 py-0 text-[10px] text-mute hover:bg-paperDeep"
              >×</button>
            )}
          </div>

          {/* Botón sortear inline a la derecha */}
          <button
            type="button"
            onClick={handleShuffle}
            disabled={sorted.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[11px] font-semibold text-ink shadow-sm transition-colors hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
            title={`Abrir uno al azar de los ${sorted.length} filtrados`}
            aria-label={`Abrir uno al azar de los ${sorted.length} filtrados`}
          >
            <Shuffle size={12} aria-hidden />
            <span className="hidden sm:inline">Sortear</span>
          </button>
        </div>

        {/* Chips: severidad · categoría · sort · región — UNA SOLA FILA scrolleable */}
        <div className="-mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
          {/* Nivel de riesgo (por puntaje, cortes de lib/severidad) */}
          {sevChip("todos", "Todos", conteo.total, null)}
          {(["alta", "media", "baja"] as NivelAnalisis[]).map((k) =>
            sevChip(k, NIVEL_ANALISIS[k].etiqueta, conteo[k], SEVERIDAD[k].punto, NIVEL_ANALISIS[k].rango),
          )}

          <span className="mx-1 h-4 w-px shrink-0 bg-line" />

          {/* Categoría */}
          {(["todas", "bienes", "servicios", "obras", "consultoria"] as CatFilter[]).map(k => {
            const n = k === "todas" ? items.length : itemsWithCat.filter((it: any) => it._cat === k).length;
            if (k !== "todas" && n === 0) return null;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCat(k)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                  cat === k
                    ? "border-transparent bg-ink text-paper shadow-sm"
                    : "border-line bg-paper text-ink hover:bg-paperDeep",
                )}
              >
                {k !== "todas" && (
                  <span className={cn("inline-block h-1.5 w-1.5 rounded-full", CAT_TONE[k])} />
                )}
                <span>{CAT_LABEL[k]}</span>
                <span className={cn(
                  "rounded-full px-1 text-[9px] tabular-nums",
                  cat === k ? "bg-paper/20 text-paper" : "bg-paperDeep text-mute",
                )}>{n}</span>
              </button>
            );
          })}

          <span className="mx-1 h-4 w-px shrink-0 bg-line" />

          {/* Sort */}
          {(["reciente", "score", "monto"] as SortKey[]).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                sort === k
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper text-ink hover:bg-paperDeep",
              )}
            >
              {k === "reciente" ? "Más recientes" : k === "score" ? "Mayor puntaje" : "Mayor monto"}
            </button>
          ))}

          {/* Región */}
          {regionesUnicas.length > 0 && (
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="ml-1 shrink-0 rounded-full border border-line bg-paper px-2 py-0.5 text-[10px] font-semibold text-ink focus:border-heroViolet focus:outline-none"
              title="Filtrar por región"
            >
              <option value="todas">Todas las regiones</option>
              {regionesUnicas.map(r => {
                const n = items.filter((it: any) => it.region === r).length;
                return <option key={r} value={r}>{r} ({n})</option>;
              })}
            </select>
          )}
        </div>

        {sorted.length !== items.length && (
          <div className="text-[11px] text-mute">
            <strong className="text-ink">{sorted.length}</strong> de {items.length} coinciden con los filtros.
            {(q || sev !== "todos" || region !== "todas" || cat !== "todas") && (
              <button
                onClick={() => { setQ(""); setSev("todos"); setRegion("todas"); setCat("todas"); }}
                className="ml-2 underline hover:text-heroViolet"
              >limpiar filtros</button>
            )}
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="surface p-6 text-center text-sm text-mute">
          Ningún análisis coincide con los filtros.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
          {pageItems.map((it: any, i: number) => (
            <li key={it.codigo_convocatoria || it.ocid || `${pageStart}-${i}`} className="surface group relative overflow-hidden p-0 transition-all hover:shadow-md hover:border-heroViolet/40">
              <button
                type="button"
                onClick={() => onSelect(it.codigo_convocatoria || it.ocid)}
                className="flex w-full items-stretch text-left"
              >
                {/* FRANJA DE PUNTAJE: nivel por lib/severidad, texto oscuro sobre fondo suave */}
                <div
                  className={cn(
                    "flex w-12 shrink-0 flex-col items-center justify-center px-1 py-3",
                    FRANJA_NIVEL[nivelDeAnalisis(it) ?? "sin"],
                  )}
                  title={nivelDeAnalisis(it) ? NIVEL_ANALISIS[nivelDeAnalisis(it)!].etiqueta : undefined}
                >
                  <span className="font-mono text-lg font-bold leading-none">{it.score ?? "—"}</span>
                  <span className="mt-0.5 text-[8px] uppercase tracking-wider">/100</span>
                </div>

                {/* MAIN BODY */}
                <div className="min-w-0 flex-1 px-3 py-2.5">
                  {/* Top: código + categoría + región + fecha */}
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-[11px] font-bold text-ink">#{it.codigo_convocatoria}</span>
                    {it._cat !== "todas" && CAT_LABEL[it._cat as CatFilter] && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-mute">
                        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", CAT_TONE[it._cat as CatFilter])} />
                        {CAT_LABEL[it._cat as CatFilter]}
                      </span>
                    )}
                    {it.region && (
                      <span className="text-[10px] text-mute">{it.region}</span>
                    )}
                    <span className="ml-auto text-[10px] text-mute">{fmtFecha(it.analizado_en)}</span>
                  </div>

                  {/* Objeto */}
                  <div className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug text-ink">{it.objeto}</div>

                  {/* Bottom: entidad + monto + banderas */}
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                    <div className="flex min-w-0 items-center gap-1.5 text-mute">
                      <Building2 size={10} className="shrink-0" />
                      <span className="line-clamp-1">{it.entidad || "—"}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {it.n_alta > 0 && (
                        <span className="rounded bg-crimson-soft px-1 py-0 text-[10px] font-bold text-crimsonTexto">
                          {it.n_alta} {it.n_alta === 1 ? "señal alta" : "señales altas"}
                        </span>
                      )}
                      {it.n_media > 0 && (
                        <span className="rounded bg-amber-soft px-1 py-0 text-[10px] font-bold text-amberTexto">
                          {it.n_media} {it.n_media === 1 ? "media" : "medias"}
                        </span>
                      )}
                      {it.n_banderas === 0 && (
                        <span className="rounded bg-paperDeep px-1 py-0 text-[10px] font-semibold text-mute">sin señales</span>
                      )}
                      <span className="font-mono text-[11px] font-bold text-ink">{fmtMoney(it.monto)}</span>
                    </div>
                  </div>
                </div>

                <ChevronRight size={14} className="mr-2 mt-3 shrink-0 self-start text-mute transition-transform group-hover:translate-x-1 group-hover:text-heroViolet" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* PAGINACIÓN — solo se renderiza una página a la vez (PAGE_SIZE). Si hay ≤9
          páginas mostramos todos los números; si hay más, prev/next + indicador. */}
      {sorted.length > 0 && totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-semibold text-ink hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
          >← Anterior</button>
          {totalPages <= 9 ? (
            Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={cn(
                  "min-w-[30px] rounded-full border px-2 py-1 text-[11px] font-mono font-semibold transition-colors",
                  p === safePage ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:bg-paperDeep",
                )}
              >{p}</button>
            ))
          ) : (
            <span className="px-2 font-mono text-[11px] font-bold text-ink">página {safePage} de {totalPages}</span>
          )}
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-semibold text-ink hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
          >Siguiente →</button>
        </div>
      )}
      {sorted.length > 0 && (
        <div className="mt-2 text-center text-[11px] text-mute">
          Mostrando <strong className="text-ink">{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, sorted.length)}</strong> de {sorted.length}
          {sorted.length !== items.length && ` (filtrados de ${items.length})`}
        </div>
      )}
    </section>
  );
}
