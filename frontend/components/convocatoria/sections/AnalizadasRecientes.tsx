"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, ChevronRight, CircleAlert, Search, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAnalyzedList } from "@/lib/dossier-cache";
import { esAlertaDemo } from "@/lib/semillas";
import { numero, relativo, solesCompacto } from "@/lib/formato";
import { EstadoError, EstadoVacio } from "@/components/patrones";
import { Skeleton } from "@/components/ui/Skeleton";
import { inferCategoria } from "../utils";
import type { CatFilter, SortKey } from "../types";
import { CAT_LABEL, CAT_TONE } from "../constants";
import { contarPorNivel, FRANJA_NIVEL, NIVEL_ANALISIS, NIVELES, nivelDeAnalisis, TONO_NIVEL, type NivelAnalisis } from "./conteoRiesgo";

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

  // Tarjetas: montos compactos, un solo formato (lib/formato). Sin monto se dice.
  const fmtMoney = (n: number) => (n ? solesCompacto(n) : "Sin monto");

  if (err) {
    return (
      <EstadoError titulo="No pudimos cargar los análisis publicados" detalle={err}>
        Suele ser momentáneo. Recarga la página en unos segundos.
      </EstadoError>
    );
  }
  if (!items) {
    return (
      <section aria-busy="true" aria-label="Cargando los análisis publicados…">
        <Skeleton className="mb-3 h-5 w-64" />
        <div className="divide-y divide-line rounded-2xl border border-line bg-paper">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
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
      <section aria-labelledby="publicados-titulo">
        <h2 id="publicados-titulo" className="mb-3 font-display text-[22px] font-bold text-ink">Análisis publicados</h2>
        <EstadoVacio titulo="Todavía no hay análisis publicados">
          Vigía lee los contratos en orden de cola, a medida que alguien financia la lectura de su zona.
        </EstadoVacio>
      </section>
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
        "inline-flex min-h-[28px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors",
        sev === key
          ? "border-transparent bg-ink text-paper shadow-sm"
          : "border-line bg-paper text-ink hover:bg-paperDeep",
      )}
    >
      {punto && <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", punto)} />}
      <span>{label}</span>
      <span className={cn(
        "rounded-full px-1.5 py-0 text-[10px] tabular-nums",
        sev === key ? "bg-paper/20 text-paper" : "bg-paperDeep text-mute",
      )}>{numero(count)}</span>
    </button>
  );

  return (
    <section aria-labelledby="publicados-titulo">
      {/* HEADER + BARRA DE FILTROS · todo en una sola hilera compacta */}
      <div className="mb-3 space-y-2 rounded-2xl border border-line bg-paper p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 id="publicados-titulo" className="font-display text-lg font-bold text-ink">Análisis publicados</h2>
              <span className="rounded-full bg-paperDeep px-2 py-0 font-mono text-[12px] font-semibold tabular-nums text-ink">{numero(items.length)}</span>
            </div>
          </div>

          {/* Search inline */}
          <div className="relative ml-auto flex-1 sm:min-w-[260px] sm:max-w-[360px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Filtrar los análisis publicados"
              placeholder="Filtrar por código, objeto o RUC…"
              className="w-full rounded-xl border border-line bg-paper py-2 pl-8 pr-8 text-[13px] placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/20"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Borrar el filtro"
                className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[14px] text-mute hover:bg-paperDeep"
              ><span aria-hidden>×</span></button>
            )}
          </div>

          {/* Botón sortear inline a la derecha */}
          <button
            type="button"
            onClick={handleShuffle}
            disabled={sorted.length === 0}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
            title={`Abrir uno al azar de los ${sorted.length} filtrados`}
            aria-label={`Abrir uno al azar de los ${sorted.length} filtrados`}
          >
            <Shuffle size={12} aria-hidden />
            <span className="hidden sm:inline">Sortear</span>
          </button>
        </div>

        {/* Chips: severidad · categoría · sort · región — UNA SOLA FILA scrolleable */}
        <div className="-mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
          {/* Sin señales · peso del riesgo (por puntaje, cortes de lib/severidad), §10.1 */}
          {sevChip("todos", "Todos", conteo.total, null)}
          {NIVELES.map((k) => sevChip(k, NIVEL_ANALISIS[k].etiqueta, conteo[k], TONO_NIVEL[k].punto, NIVEL_ANALISIS[k].rango))}

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
                  "inline-flex min-h-[28px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold transition-colors",
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
                  "rounded-full px-1.5 text-[11px] tabular-nums",
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
                "min-h-[28px] shrink-0 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold transition-colors",
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
              className="ml-1 min-h-[28px] shrink-0 rounded-full border border-line bg-paper px-2.5 py-0.5 text-[12px] font-semibold text-ink focus:border-granate focus:outline-none"
              aria-label="Filtrar por región"
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
          <div className="text-[12px] text-mute" aria-live="polite">
            <strong className="text-ink">{numero(sorted.length)}</strong> de {numero(items.length)} coinciden con los filtros.
            {(q || sev !== "todos" || region !== "todas" || cat !== "todas") && (
              <button
                onClick={() => { setQ(""); setSev("todos"); setRegion("todas"); setCat("todas"); }}
                type="button"
                className="ml-2 underline hover:text-granate"
              >Limpiar filtros</button>
            )}
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <EstadoVacio compacto titulo="Ningún análisis coincide con los filtros">
          Quita alguno de los filtros de arriba para ver más.
        </EstadoVacio>
      ) : (
        <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
          {pageItems.map((it: any, i: number) => (
            <li key={it.codigo_convocatoria || it.ocid || `${pageStart}-${i}`} className="group relative overflow-hidden rounded-2xl border border-line bg-paper transition-shadow duration-rapido hover:shadow-card">
              <button
                type="button"
                onClick={() => onSelect(it.codigo_convocatoria || it.ocid)}
                className="flex w-full items-stretch text-left"
              >
                {/* FRANJA DE NIVEL: "sin señales" con su check; con señales, el puntaje que pesa. */}
                <FranjaNivel it={it} />

                {/* MAIN BODY */}
                <div className="min-w-0 flex-1 px-3 py-2.5">
                  {/* Top: código + categoría + región + fecha */}
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-[12px] font-semibold text-ink">{it.codigo_convocatoria}</span>
                    {it._cat !== "todas" && CAT_LABEL[it._cat as CatFilter] && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-mute">
                        <span aria-hidden className={cn("inline-block h-1.5 w-1.5 rounded-full", CAT_TONE[it._cat as CatFilter])} />
                        {CAT_LABEL[it._cat as CatFilter]}
                      </span>
                    )}
                    {it.region && (
                      <span className="text-[11px] text-mute">{it.region}</span>
                    )}
                    <span className="ml-auto text-[11px] text-mute">{it.analizado_en ? `leído ${relativo(it.analizado_en)}` : "Sin fecha"}</span>
                  </div>

                  {/* Objeto */}
                  <div className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug text-ink">{it.objeto}</div>

                  {/* Bottom: entidad + monto + banderas */}
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex min-w-0 items-center gap-1.5 text-mute">
                      <Building2 size={12} className="shrink-0" aria-hidden />
                      <span className="line-clamp-1">{it.entidad || "Entidad sin dato"}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {it.n_alta > 0 && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-rust">
                          <AlertTriangle size={11} aria-hidden />
                          {it.n_alta} {it.n_alta === 1 ? "señal alta" : "señales altas"}
                        </span>
                      )}
                      {it.n_media > 0 && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-amberTexto">
                          <CircleAlert size={11} aria-hidden />
                          {it.n_media} {it.n_media === 1 ? "señal media" : "señales medias"}
                        </span>
                      )}
                      <span className="font-mono text-[12px] font-semibold tabular-nums text-ink">{fmtMoney(it.monto)}</span>
                    </div>
                  </div>
                </div>

                <ChevronRight size={14} aria-hidden className="mr-2 mt-3 shrink-0 self-start text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate" />
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
            className="min-h-[32px] rounded-full border border-line bg-paper px-3 py-1 text-[12px] font-semibold text-ink hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
          >Anterior</button>
          {totalPages <= 9 ? (
            Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={cn(
                  "min-h-[32px] min-w-[32px] rounded-full border px-2 py-1 font-mono text-[12px] font-semibold transition-colors",
                  p === safePage ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:bg-paperDeep",
                )}
              >{p}</button>
            ))
          ) : (
            <span className="px-2 text-[12px] font-semibold text-ink">Página {safePage} de {totalPages}</span>
          )}
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="min-h-[32px] rounded-full border border-line bg-paper px-3 py-1 text-[12px] font-semibold text-ink hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
          >Siguiente</button>
        </div>
      )}
      {sorted.length > 0 && (
        <div className="mt-2 text-center text-[12px] text-mute">
          Mostrando <strong className="text-ink">{numero(pageStart + 1)}–{numero(Math.min(pageStart + PAGE_SIZE, sorted.length))}</strong> de {numero(sorted.length)}
          {sorted.length !== items.length && ` (filtrados de ${numero(items.length)})`}
        </div>
      )}
    </section>
  );
}

/**
 * La franja izquierda de cada tarjeta. Con señales: el puntaje que pesa (0–100) en el tono de su
 * tramo. Sin señales: el check verde, sin un "0/100" suelto (el puntaje nunca va sin las señales
 * que lo explican, §10.4). Sin dato: se dice.
 */
function FranjaNivel({ it }: { it: any }) {
  const nivel: NivelAnalisis | null = nivelDeAnalisis(it);
  return (
    <div
      className={cn("flex w-14 shrink-0 flex-col items-center justify-center px-1 py-3 text-center", FRANJA_NIVEL[nivel ?? "sin"])}
      title={nivel ? `${NIVEL_ANALISIS[nivel].etiqueta}: ${NIVEL_ANALISIS[nivel].rango}` : undefined}
    >
      {nivel === "sin_senales" ? (
        <>
          <CheckCircle2 size={18} aria-hidden />
          <span className="mt-1 text-[11px] font-medium leading-tight">Sin señales</span>
        </>
      ) : typeof it.score === "number" ? (
        <>
          <span className="font-mono text-lg font-semibold leading-none tabular-nums">{Math.round(it.score)}</span>
          <span className="mt-0.5 text-[11px] leading-none">/100</span>
          {nivel && <span className="sr-only">{NIVEL_ANALISIS[nivel].etiqueta}</span>}
        </>
      ) : (
        <span className="text-[11px] leading-tight">Sin dato</span>
      )}
    </div>
  );
}
