"use client";

/**
 * Lista paginada de contratos (50 por página en /app/contratos; 20 embebida en el
 * panel de zona del mapa). Dos modos de navegación:
 *  - "url":     la página vive en `?page=`; el server component trae `initial` y
 *               los cambios de página son enlaces (funcionan sin JS).
 *  - "interna": estado propio + fetch al API (para embeber dentro del mapa).
 *
 * Conexión con el mapa: `MapaContratosContext` (lo provee MapaWrapper) trae el
 * distrito elegido, el contrato seleccionado y los handlers de hover/selección.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight, Inbox, WifiOff } from "lucide-react";
import { ESTADO_PROC, PUBLIC_API_BASE, type EstadoProc } from "@/lib/auditoria";
import {
  ESTADO_CONTRATO_EXTRA,
  RIESGO_CLS,
  contratosQueryString,
  etapaLabel,
  formatFecha,
  formatMonto,
  riesgoDe,
  tipoLabel,
  type ContratoResumen,
  type ContratosPagina,
  type ContratosQuery,
  type EstadoContrato,
} from "@/lib/contratos";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { cn } from "@/lib/utils";

// ─── Contexto lista ↔ mapa ───────────────────────────────────────────────────

export interface MapaContratos {
  /** Capa "Contratos" encendida en el mapa. */
  activa: boolean;
  /** Distrito elegido con clic en un punto (6 dígitos) y su nombre. */
  distritoUbigeo: string | null;
  distritoNombre: string | null;
  ocidSeleccionado: string | null;
  seleccionar: (c: ContratoResumen | null) => void;
  hover: (c: ContratoResumen | null) => void;
  limpiarDistrito: () => void;
}

export const MapaContratosContext = createContext<MapaContratos | null>(null);
export const useMapaContratos = () => useContext(MapaContratosContext);

// ─── Píldora de estado (reusa EstadoPill para todo estado que lib/auditoria conozca) ──

export function EstadoContratoPill({ estado }: { estado: EstadoContrato }) {
  if (estado in ESTADO_PROC) return <EstadoPill estado={estado as EstadoProc} />;
  const e = ESTADO_CONTRATO_EXTRA[estado as keyof typeof ESTADO_CONTRATO_EXTRA] ?? ESTADO_CONTRATO_EXTRA.sin_analizar;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", e.cls)} role="status">
      {e.label}
    </span>
  );
}

// ─── Lista ───────────────────────────────────────────────────────────────────

interface Props {
  query: ContratosQuery;
  initial?: ContratosPagina | null;
  size?: number;
  navegacion?: "url" | "interna";
  /** Para columnas angostas (panel del mapa): filas apiladas en vez de tabla. */
  compacto?: boolean;
  selectedOcid?: string | null;
  onSelect?: (c: ContratoResumen | null) => void;
  onHover?: (c: ContratoResumen | null) => void;
  /** Ruta base para el enlace de página (modo url). */
  pathname?: string;
  /** Modo interno: avisa cada vez que llega una página del API. */
  onCargada?: (p: ContratosPagina) => void;
}

export function ContratosLista({
  query,
  initial,
  size = 50,
  navegacion = "url",
  compacto = false,
  selectedOcid = null,
  onSelect,
  onHover,
  pathname = "/app/contratos",
  onCargada,
}: Props) {
  const [pagina, setPagina] = useState<ContratosPagina | null>(initial ?? null);
  const [page, setPage] = useState<number>(query.page ?? 1);
  const [cargando, setCargando] = useState<boolean>(navegacion === "interna" && initial == null);
  const [fallo, setFallo] = useState<boolean>(navegacion === "url" && initial == null);
  const qsFiltros = useMemo(() => contratosQueryString({ ...query, page: undefined, size: undefined }), [query]);

  // Modo url: cada navegación trae `initial` nuevo desde el servidor.
  useEffect(() => {
    if (navegacion !== "url") return;
    setPagina(initial ?? null);
    setFallo(initial == null);
    setPage(query.page ?? 1);
  }, [navegacion, initial, query.page]);

  // Al cambiar filtros en modo interno volvemos a la página 1.
  useEffect(() => {
    if (navegacion === "interna") setPage(1);
  }, [navegacion, qsFiltros]);

  useEffect(() => {
    if (navegacion !== "interna") return;
    const ctrl = new AbortController();
    setCargando(true);
    fetch(`${PUBLIC_API_BASE}/contratos?${contratosQueryString({ ...query, page, size })}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: ContratosPagina) => { setPagina(j); setFallo(false); onCargada?.(j); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setFallo(true); })
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [navegacion, qsFiltros, page, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = pagina?.total ?? 0;
  const tam = pagina?.size ?? size;
  const paginas = Math.max(1, Math.ceil(total / tam));
  const actual = pagina?.page ?? page;
  const rows = pagina?.data ?? [];

  const hrefPagina = (n: number) => {
    const qs = contratosQueryString({ ...query, page: n, size: undefined });
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const pag = (
    <Paginacion
      actual={actual}
      paginas={paginas}
      total={total}
      tam={tam}
      navegacion={navegacion}
      href={hrefPagina}
      onChange={setPage}
      cargando={cargando}
    />
  );

  return (
    <div className="space-y-2">
      {pag}
      {fallo && !rows.length ? (
        <Aviso icon={<WifiOff size={16} />} text="No se pudo cargar la lista de contratos. Reintenta en unos segundos." />
      ) : !rows.length && !cargando ? (
        <Aviso icon={<Inbox size={16} />} text="Ningún contrato coincide con estos filtros." />
      ) : compacto ? (
        <ListaCompacta rows={rows} selectedOcid={selectedOcid} onSelect={onSelect} onHover={onHover} cargando={cargando} />
      ) : (
        <Tabla rows={rows} selectedOcid={selectedOcid} onSelect={onSelect} onHover={onHover} cargando={cargando} />
      )}
      {rows.length > 10 && pag}
    </div>
  );
}

// ─── Paginación ──────────────────────────────────────────────────────────────

function Paginacion({ actual, paginas, total, tam, navegacion, href, onChange, cargando }: {
  actual: number; paginas: number; total: number; tam: number; navegacion: "url" | "interna";
  href: (n: number) => string; onChange: (n: number) => void; cargando: boolean;
}) {
  const desde = total === 0 ? 0 : (actual - 1) * tam + 1;
  const hasta = Math.min(total, actual * tam);
  const btn = "inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-paper text-ink transition-colors hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";
  const prev = Math.max(1, actual - 1);
  const next = Math.min(paginas, actual + 1);
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-mute">
      <span className="font-mono tabular-nums" aria-live="polite">
        {cargando ? "cargando…" : total === 0 ? "0 contratos" : `${desde.toLocaleString("es-PE")}–${hasta.toLocaleString("es-PE")} de ${total.toLocaleString("es-PE")}`}
      </span>
      <span className="inline-flex items-center gap-1.5">
        {navegacion === "url" ? (
          <Link href={href(prev)} aria-disabled={actual <= 1} className={btn} aria-label="Página anterior" scroll={false}><ChevronLeft size={13} /></Link>
        ) : (
          <button type="button" disabled={actual <= 1} onClick={() => onChange(prev)} className={btn} aria-label="Página anterior"><ChevronLeft size={13} /></button>
        )}
        <span className="font-mono tabular-nums text-ink">{actual}<span className="text-mute"> / {paginas}</span></span>
        {navegacion === "url" ? (
          <Link href={href(next)} aria-disabled={actual >= paginas} className={btn} aria-label="Página siguiente" scroll={false}><ChevronRight size={13} /></Link>
        ) : (
          <button type="button" disabled={actual >= paginas} onClick={() => onChange(next)} className={btn} aria-label="Página siguiente"><ChevronRight size={13} /></button>
        )}
      </span>
    </div>
  );
}

// ─── Tabla densa (página /app/contratos) ─────────────────────────────────────

function Tabla({ rows, selectedOcid, onSelect, onHover, cargando }: FilasProps) {
  return (
    <div className={cn("overflow-x-auto rounded-2xl border border-line bg-paper", cargando && "opacity-60")} aria-busy={cargando}>
      <table className="w-full min-w-[960px] table-fixed text-left text-xs">
        <thead className="bg-paperDeep text-[10px] uppercase tracking-wider text-mute">
          <tr>
            <th className="w-[88px] px-3 py-2 font-semibold">Código</th>
            <th className="px-3 py-2 font-semibold">Contrato</th>
            <th className="w-[180px] px-3 py-2 font-semibold">Entidad</th>
            <th className="w-[110px] px-3 py-2 font-semibold">Zona</th>
            <th className="w-[150px] px-3 py-2 font-semibold">Tipo · etapa</th>
            <th className="w-[96px] px-3 py-2 text-right font-semibold">Monto</th>
            <th className="w-[72px] px-3 py-2 font-semibold">Fecha</th>
            <th className="w-[124px] px-3 py-2 font-semibold">Análisis</th>
            <th className="w-[56px] px-3 py-2 text-right font-semibold">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c) => (
            <FilaTabla key={c.ocid} c={c} selected={selectedOcid === c.ocid} onSelect={onSelect} onHover={onHover} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilaTabla({ c, selected, onSelect, onHover }: { c: ContratoResumen; selected: boolean; onSelect?: FilasProps["onSelect"]; onHover?: FilasProps["onHover"] }) {
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const riesgo = riesgoDe(c.score);
  return (
    <tr
      ref={ref}
      className={cn("group transition-colors hover:bg-paperSoft", selected && "bg-amber-soft/40")}
      onMouseEnter={() => onHover?.(c)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onSelect?.(c)}
    >
      <td className="px-3 py-2 font-mono text-[11px] text-mute">
        <Link href={`/app/contratos/${encodeURIComponent(c.ocid)}`} className="hover:text-ink hover:underline">{c.codigo}</Link>
      </td>
      <td className="px-3 py-2">
        <Link href={`/app/contratos/${encodeURIComponent(c.ocid)}`} className="block truncate text-ink hover:underline" title={c.titulo ?? undefined}>
          {c.titulo ?? "(sin objeto)"}
        </Link>
      </td>
      <td className="truncate px-3 py-2 text-mute" title={c.entidad ?? undefined}>{c.entidad ?? "—"}</td>
      <td className="truncate px-3 py-2 text-mute" title={c.zona ?? undefined}>{c.zona ?? "—"}</td>
      <td className="px-3 py-2"><Badges tipo={c.tipo} etapa={c.etapa} /></td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{formatMonto(c.montoPen, c.moneda)}</td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-mute">{formatFecha(c.fecha)}</td>
      <td className="px-3 py-2"><EstadoContratoPill estado={c.estadoProcesamiento} /></td>
      <td className={cn("px-3 py-2 text-right font-mono tabular-nums", RIESGO_CLS[riesgo])}>
        {c.score ?? "—"}
        {c.banderas > 0 && <span className="ml-1 text-[9px] text-mute">·{c.banderas}</span>}
      </td>
    </tr>
  );
}

// ─── Lista compacta (panel del mapa) ─────────────────────────────────────────

interface FilasProps {
  rows: ContratoResumen[];
  selectedOcid: string | null;
  onSelect?: (c: ContratoResumen | null) => void;
  onHover?: (c: ContratoResumen | null) => void;
  cargando: boolean;
}

function ListaCompacta({ rows, selectedOcid, onSelect, onHover, cargando }: FilasProps) {
  return (
    <ul className={cn("space-y-1", cargando && "opacity-60")} aria-busy={cargando}>
      {rows.map((c) => (
        <FilaCompacta key={c.ocid} c={c} selected={selectedOcid === c.ocid} onSelect={onSelect} onHover={onHover} />
      ))}
    </ul>
  );
}

function FilaCompacta({ c, selected, onSelect, onHover }: { c: ContratoResumen; selected: boolean; onSelect?: FilasProps["onSelect"]; onHover?: FilasProps["onHover"] }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const riesgo = riesgoDe(c.score);
  return (
    <li
      ref={ref}
      className={cn(
        "group rounded-xl border bg-paper px-2.5 py-2 transition-colors",
        selected ? "border-amber bg-amber-soft/40" : "border-line hover:border-clay/50 hover:bg-paperDeep",
      )}
      onMouseEnter={() => onHover?.(c)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onSelect?.(selected ? null : c)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-pressed={selected}
        >
          <span className="font-mono text-[10px] text-mute">{c.codigo}</span>
          <Badges tipo={c.tipo} etapa={c.etapa} />
        </button>
        <span className="flex shrink-0 items-center gap-1.5">
          <EstadoContratoPill estado={c.estadoProcesamiento} />
          {c.score != null && <span className={cn("font-mono text-[11px] tabular-nums", RIESGO_CLS[riesgo])}>{c.score}</span>}
          <Link
            href={`/app/contratos/${encodeURIComponent(c.ocid)}`}
            className="text-mute opacity-60 transition-opacity hover:text-ink group-hover:opacity-100"
            aria-label={`Ver contrato ${c.codigo}`}
          >
            <ArrowUpRight size={13} />
          </Link>
        </span>
      </div>
      <button type="button" onClick={() => onSelect?.(selected ? null : c)} className="mt-0.5 block w-full truncate text-left text-[12px] leading-snug text-ink" title={c.titulo ?? undefined}>
        {c.titulo ?? "(sin objeto)"}
      </button>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-mute">
        <span className="truncate">{c.entidad ?? "—"}{c.zona ? ` · ${c.zona}` : ""}</span>
        <span className="shrink-0 font-mono tabular-nums">{formatMonto(c.montoPen, c.moneda)} · {formatFecha(c.fecha)}</span>
      </div>
    </li>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Badges({ tipo, etapa }: { tipo: string | null; etapa: string | null }) {
  const t = tipoLabel(tipo);
  const e = etapaLabel(etapa);
  if (!t && !e) return <span className="text-[10px] text-mute">sin clasificar</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {t && <span className="rounded-md bg-paperDeep px-1.5 py-0.5 text-[10px] font-medium text-ink">{t}</span>}
      {e && <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-mute">{e}</span>}
    </span>
  );
}

function Aviso({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-line bg-paper px-4 py-6 text-sm text-mute">
      <span className="text-mute">{icon}</span>
      {text}
    </div>
  );
}
