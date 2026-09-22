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
import { ArrowUpRight, Inbox, WifiOff } from "lucide-react";
import { ESTADO_PROC, PUBLIC_API_BASE, type EstadoProc } from "@/lib/auditoria";
import { Paginacion } from "@/components/ui/Paginacion";
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
  type RiesgoContrato,
} from "@/lib/contratos";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { Skeleton } from "@/components/ui/Skeleton";
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

export function EstadoContratoPill({ estado, operativo }: { estado: EstadoContrato; operativo?: string | null }) {
  // Migración 19: sin analizar pero fuera del alcance activo → decir qué hay (documentos listos o no).
  if (estado === "sin_analizar" && operativo && operativo !== "en_cola") {
    const listo = operativo === "documentos_listos";
    return (
      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", listo ? "border border-inkSoft/40 text-inkSoft" : "bg-paperDeep text-mute")} role="status"
            title={listo ? "Documentos descargados; el análisis de este tipo de contratación aún no está activo" : "Este tipo de contratación aún no está activo y sus documentos no se han descargado"}>
        {listo ? "Docs listos" : "Sin documentos"}
      </span>
    );
  }
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
  /** "Reintentar" en modo interno: incrementarlo vuelve a disparar el efecto de fetch. */
  const [retry, setRetry] = useState(0);
  const qsFiltros = useMemo(() => contratosQueryString({ ...query, page: undefined, size: undefined }), [query]);
  const hayFiltros = !!(
    query.q || query.tipo || query.etapa || query.ubigeo || query.entidad ||
    query.riesgo || query.operativo || query.desde || query.monto_min != null || query.monto_max != null
  );

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
  }, [navegacion, qsFiltros, page, size, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = pagina?.total ?? 0;
  const tam = pagina?.size ?? size;
  const paginas = Math.max(1, Math.ceil(total / tam));
  const actual = pagina?.page ?? page;
  const rows = pagina?.data ?? [];

  const hrefPagina = (n: number) => {
    const qs = contratosQueryString({ ...query, page: n, size: undefined });
    return qs ? `${pathname}?${qs}` : pathname;
  };
  /** El mismo URL actual (con filtros y página) — para "Reintentar" sin perder lo que el usuario ya eligió. */
  const hrefActual = hrefPagina(query.page ?? 1);

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
      nombre="contratos"
    />
  );

  return (
    <div className="space-y-2">
      {pag}
      {fallo && !rows.length ? (
        <Aviso
          icon={<WifiOff size={16} />}
          text="No se pudo cargar la lista de contratos."
          action={
            navegacion === "interna" ? (
              <button type="button" onClick={() => setRetry((n) => n + 1)} className={ACCION_CLS}>Reintentar</button>
            ) : (
              <a href={hrefActual} className={ACCION_CLS}>Reintentar</a>
            )
          }
        />
      ) : !rows.length && !cargando ? (
        <Aviso
          icon={<Inbox size={16} />}
          text="Ningún contrato coincide con estos filtros."
          action={navegacion === "url" && hayFiltros ? <Link href={pathname} className={ACCION_CLS}>Quitar todos los filtros</Link> : undefined}
        />
      ) : compacto ? (
        <ListaCompacta rows={rows} selectedOcid={selectedOcid} onSelect={onSelect} onHover={onHover} cargando={cargando} />
      ) : (
        <Tarjetas rows={rows} selectedOcid={selectedOcid} onSelect={onSelect} onHover={onHover} cargando={cargando} />
      )}
      {rows.length > 10 && pag}
    </div>
  );
}

// ─── Tarjetas (página /app/contratos): una por contrato, mismo diseño en móvil y escritorio ──
// Título completo (2 líneas) y entidad completa (sin cortar a 180px): el problema real de la
// tabla densa anterior era el truncado agresivo ("CONTR...", "ORGANISMO DE EVALUA...") que
// volvía ilegibles justo las convocatorias parecidas que más hace falta distinguir. La fila
// se mantiene liviana cuando no hay nada que reportar (sin documentos, sin score) y solo se
// carga de color/peso visual cuando SÍ hay una señal real, para que esas destaquen del resto.


function Tarjetas({ rows, selectedOcid, onSelect, onHover, cargando }: FilasProps) {
  // Primera carga en modo "interna" (panel del mapa): sin esto, la lista es un <ul> vacío
  // mientras llega el fetch — un hueco en blanco, no un estado de carga real.
  if (!rows.length && cargando) {
    return (
      <ul className="space-y-2" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => <SkeletonTarjeta key={i} />)}
      </ul>
    );
  }
  return (
    <ul className={cn("space-y-2", cargando && "opacity-60")} aria-busy={cargando}>
      {rows.map((c) => (
        <Tarjeta
          key={c.ocid}
          c={c}
          selected={selectedOcid === c.ocid}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </ul>
  );
}

function SkeletonTarjeta() {
  return (
    <li className="rounded-2xl border border-line bg-paper p-4 sm:p-[18px]" aria-hidden>
      <Skeleton className="h-2.5 w-32" />
      <Skeleton className="mt-2 h-4 w-4/5" />
      <Skeleton className="mt-1.5 h-3 w-2/5" />
      <Skeleton className="mt-2.5 h-4 w-24 rounded-full" />
    </li>
  );
}

const RIESGO_TARJETA_CLS: Record<RiesgoContrato, string> = {
  alto: "border-rust/40 bg-crimson-soft text-rust",
  medio: "border-amber/40 bg-amber-soft text-clay",
  bajo: "border-moss/40 bg-moss/10 text-moss",
  sin_analizar: "border-line bg-paperDeep text-mute",
};

function Tarjeta({ c, selected, onSelect, onHover }: { c: ContratoResumen; selected: boolean; onSelect?: FilasProps["onSelect"]; onHover?: FilasProps["onHover"] }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const riesgo = riesgoDe(c.score);
  const tieneSenal = c.score != null;
  const enlace = (
      <Link
        href={`/app/contratos/${encodeURIComponent(c.ocid)}`}
        onClick={() => onSelect?.(c)}
        className={cn(
          "block rounded-2xl border bg-paper p-4 transition-all hover:-translate-y-0.5 hover:shadow-card sm:p-[18px]",
          // Violeta = "esto está sincronizado con el mapa", no una advertencia — mismo
          // idioma que HeroMapPanel (clickedCode === z.ubigeo) y el nav activo del sidebar.
          selected ? "border-heroViolet bg-heroViolet/5" : "border-line",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10.5px] tabular-nums text-mute">
              <span>{c.codigo}</span>
              <span aria-hidden>·</span>
              <span>{formatFecha(c.fecha)}</span>
              {c.zona && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-sans normal-case">{c.zona}</span>
                </>
              )}
            </div>
            <h3 className="mt-1 line-clamp-2 text-[14.5px] font-semibold leading-snug text-ink sm:text-[15px]" title={c.titulo ?? undefined}>
              {c.titulo ?? "(sin objeto registrado)"}
            </h3>
            <p className="mt-0.5 line-clamp-1 text-[12.5px] text-mute" title={c.entidad ?? undefined}>
              {c.entidad ?? "Entidad no identificada"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badges tipo={c.tipo} etapa={c.etapa} />
              <EstadoContratoPill estado={c.estadoProcesamiento} operativo={c.estadoOperativo} />
            </div>
          </div>
          <div className="flex shrink-0 flex-row items-center justify-between gap-2 sm:flex-col sm:items-end sm:gap-1.5 sm:text-right">
            <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">{formatMonto(c.montoPen, c.moneda)}</span>
            {tieneSenal && (
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums", RIESGO_TARJETA_CLS[riesgo])}>
                score {c.score}
                {c.banderas > 0 && <span className="font-normal opacity-80">· {c.banderas} señal{c.banderas === 1 ? "" : "es"}</span>}
              </span>
            )}
          </div>
        </div>
      </Link>
  );
  return (
    <li ref={ref} onMouseEnter={() => onHover?.(c)} onMouseLeave={() => onHover?.(null)}>
      {enlace}
    </li>
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
  if (!rows.length && cargando) {
    return (
      <ul className="space-y-1" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => <SkeletonFila key={i} />)}
      </ul>
    );
  }
  return (
    <ul className={cn("space-y-1", cargando && "opacity-60")} aria-busy={cargando}>
      {rows.map((c) => (
        <FilaCompacta key={c.ocid} c={c} selected={selectedOcid === c.ocid} onSelect={onSelect} onHover={onHover} />
      ))}
    </ul>
  );
}

function SkeletonFila() {
  return (
    <li className="rounded-xl border border-line bg-paper px-2.5 py-2" aria-hidden>
      <Skeleton className="h-2.5 w-2/3" />
      <Skeleton className="mt-1.5 h-2 w-1/2" />
    </li>
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
        // Antes solo cambiaba de fondo al pasar el mouse (hover:shadow-card sin lift) — mismo
        // patrón de FeatureHighlights.tsx/Metric de /app/financiar: transición real, no solo color.
        "group rounded-xl border bg-paper px-2.5 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card",
        selected ? "border-heroViolet bg-heroViolet/5" : "border-line hover:border-heroViolet/30 hover:bg-paperDeep",
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
          <EstadoContratoPill estado={c.estadoProcesamiento} operativo={c.estadoOperativo} />
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

/** Estilo compartido de la acción de un estado vacío ("Reintentar" · "Quitar todos los filtros"). */
const ACCION_CLS = "inline-flex items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-medium text-ink transition-colors hover:border-heroViolet/40 hover:bg-paperSoft";

/** Estado vacío con mensaje real y, cuando hay algo que hacer, su siguiente acción — nunca un hueco en blanco. */
function Aviso({ icon, text, action }: { icon: React.ReactNode; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-line bg-paper px-4 py-8 text-center text-sm text-mute">
      <span className="text-mute">{icon}</span>
      <span>{text}</span>
      {action}
    </div>
  );
}
