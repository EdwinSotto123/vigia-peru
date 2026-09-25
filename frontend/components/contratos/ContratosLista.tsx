"use client";

/**
 * Lista paginada de contratos (50 por página en /app/contratos; 20 embebida en el
 * panel de zona del mapa). Dos modos de navegación:
 *  - "url":     la página vive en `?page=`; el server component trae `initial` y
 *               los cambios de página son enlaces (funcionan sin JS).
 *  - "interna": estado propio + fetch al API (para embeber dentro del mapa).
 *
 * Dos presentaciones, la misma fuente de datos:
 *  - TABLA densa (default, /app/contratos): columnas alineadas, una fila por
 *    contrato, ~40 px de alto. Antes eran tarjetas de ~135 px: en un viewport de
 *    900 px entraban TRES contratos.
 *  - COMPACTA (`compacto`), para la columna angosta del panel del mapa, donde la
 *    fila está atada a la selección del punto en el mapa.
 *
 * Los cinco estados de DESIGN_SYSTEM.md §10.5: cargando (esqueleto con la forma de
 * la fila), vacío y error (patrones con la llamita), parcial (el paginador dice
 * "1–50 de 18,393") y lleno.
 *
 * Conexión con el mapa: `MapaContratosContext` (lo provee MapaWrapper) trae el
 * distrito elegido, el contrato seleccionado y los handlers de hover/selección.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { Paginacion } from "@/components/ui/Paginacion";
import { Skeleton } from "@/components/ui/Skeleton";
import { EstadoError, EstadoVacio } from "@/components/patrones";
import { numero, plural } from "@/lib/formato";
import {
  contratosQueryString,
  etapaLabel,
  formatFecha,
  formatMonto,
  tipoLabel,
  type ContratoResumen,
  type ContratosPagina,
  type ContratosQuery,
} from "@/lib/contratos";
import {
  ALTO_FILA,
  ANCHO_IR,
  CELDA_MD,
  CELDA_XL,
  FILA_SELECCIONADA,
  FilaContrato,
  PAD_FILA,
  REJILLA,
} from "./FilaContrato";
import {
  EstadoContratoPill as PildoraEstadoContrato,
  EstadoLecturaCelda,
  LeyendaLectura,
  estadoLecturaDe,
} from "./estadoLectura";
import { LeyendaPeso, PesoRiesgo } from "./PesoRiesgo";
import { cn } from "@/lib/utils";

/**
 * Compatibilidad: el dossier (`ContratoDetalle`, un server component) importa
 * `EstadoContratoPill` desde este módulo desde siempre. La implementación se mudó
 * a `estadoLectura.tsx` junto con el resto del eje de estado; acá queda un
 * componente real —no un `export … from`— para que el límite servidor→cliente sea
 * el de este archivo, que ya lo era.
 */
export function EstadoContratoPill(props: React.ComponentProps<typeof PildoraEstadoContrato>) {
  return <PildoraEstadoContrato {...props} />;
}

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

  /** ?page=999 con 368 páginas: el contador diría "49 901–18 394 de 18 394". Se oculta y el aviso lo explica. */
  const fueraDeRango = !rows.length && !cargando && total > 0 && actual > paginas;

  return (
    <div className="space-y-2">
      {!fueraDeRango && !(fallo && !rows.length) && pag}
      {fallo && !rows.length ? (
        <EstadoError
          titulo="No pudimos cargar la lista de contratos"
          accion={
            navegacion === "interna" ? (
              <button type="button" onClick={() => setRetry((n) => n + 1)} className={ACCION_CLS}>Reintentar</button>
            ) : (
              <a href={hrefActual} className={ACCION_CLS}>Reintentar</a>
            )
          }
        >
          Suele ser momentáneo. No te mostramos una copia vieja ni datos de relleno: vuelve a intentarlo en unos segundos.
        </EstadoError>
      ) : fueraDeRango ? (
        // Página fuera de rango (?page=999): hay contratos, solo que no tantos. Decir
        // "no hay contratos" acá era falso: se ofrece volver a la última página real.
        <EstadoVacio
          compacto={compacto}
          titulo={`Esta página no existe: la lista llega hasta la página ${numero(paginas)}`}
          accion={
            navegacion === "url" ? (
              <Link href={hrefPagina(paginas)} className={ACCION_CLS}>Ir a la última página</Link>
            ) : (
              <button type="button" onClick={() => setPage(paginas)} className={ACCION_CLS}>Ir a la última página</button>
            )
          }
        >
          Hay {plural(total, "contrato", "contratos")}
          {hayFiltros ? " con estos filtros" : ""}, {tam} por página.
        </EstadoVacio>
      ) : !rows.length && !cargando ? (
        <EstadoVacio
          compacto={compacto}
          titulo={hayFiltros ? "Ningún contrato cumple todos los filtros a la vez" : "No hay contratos para esta consulta"}
          accion={navegacion === "url" && hayFiltros ? <Link href={pathname} className={ACCION_CLS}>Quitar todos los filtros</Link> : undefined}
        >
          {hayFiltros
            ? "Los filtros se suman: cada uno recorta más la lista. Quita el más restrictivo (arriba, cada uno se quita por separado) y la lista se vuelve a llenar."
            : "Esta zona no tiene convocatorias publicadas en el SEACE para el rango pedido."}
        </EstadoVacio>
      ) : compacto ? (
        <ListaCompacta rows={rows} selectedOcid={selectedOcid} onSelect={onSelect} onHover={onHover} cargando={cargando} />
      ) : (
        <TablaContratos rows={rows} selectedOcid={selectedOcid} onSelect={onSelect} onHover={onHover} cargando={cargando} />
      )}
      {rows.length > 10 && pag}
    </div>
  );
}

// ─── Tabla densa (página /app/contratos) ─────────────────────────────────────

interface FilasProps {
  rows: ContratoResumen[];
  selectedOcid: string | null;
  onSelect?: (c: ContratoResumen | null) => void;
  onHover?: (c: ContratoResumen | null) => void;
  cargando: boolean;
}

function TablaContratos({ rows, selectedOcid, onHover, cargando }: FilasProps) {
  const vacia = !rows.length && cargando;
  return (
    <div>
      {/* role="table" con filas y celdas ARIA (la rejilla es CSS grid, no un <table>, para que
          cabecera, fila y skeleton compartan literalmente la misma plantilla de columnas). */}
      {/* `isolate`: el z-10 de la celda del enlace (para quedar sobre el ::after de la fila) no
          debe escaparse de la tabla y pintarse encima de la barra de filtros pegajosa. */}
      <div role="table" aria-label="Contratos" aria-busy={cargando} className="isolate overflow-hidden rounded-2xl border border-line bg-paper">
        <Cabecera />
        <div role="rowgroup" className={cn(cargando && !vacia && "opacity-60")}>
          {vacia
            ? Array.from({ length: 12 }, (_, i) => <SkeletonFilaTabla key={i} />)
            : rows.map((c) => (
                <FilaContrato key={c.ocid} c={c} selected={selectedOcid === c.ocid} onHover={onHover} />
              ))}
        </div>
      </div>
      <PieDeTabla />
    </div>
  );
}

/** Cabecera de columnas. Usa la MISMA rejilla que la fila: si se tocan por separado, se desalinean. */
function Cabecera() {
  return (
    <div role="rowgroup">
      <div role="row" className="flex items-stretch border-b border-line bg-paperSoft text-[11px] font-semibold leading-tight text-mute">
        <div className={cn(REJILLA, PAD_FILA, "min-w-0 flex-1")}>
          <span role="columnheader" className="truncate" title="Peso del riesgo">
            {/* Debajo de xl la columna es sólo el ícono (16–40 px): cualquier rótulo quedaba en "R…". */}
            <span aria-hidden className="hidden xl:inline">Peso del riesgo</span>
            <span className="sr-only">Peso del riesgo</span>
          </span>
          <span role="columnheader" className="truncate">
            {/* En móvil la columna mide ~110 px: el rótulo largo se cortaría a la mitad. */}
            <span className="md:hidden">Contrato</span>
            <span className="hidden md:inline">Objeto de la contratación</span>
          </span>
          <span role="columnheader" className={cn(CELDA_MD, "truncate")}>Entidad y zona</span>
          <span role="columnheader" className={cn(CELDA_XL, "truncate")}>Tipo y etapa</span>
          <span role="columnheader" className={cn(CELDA_MD, "truncate")}>Estado de lectura</span>
          <span role="columnheader" className="truncate text-right">Valor referencial</span>
          <span role="columnheader" className={cn(CELDA_MD, "truncate text-right")}>Convocada</span>
        </div>
        <div role="columnheader" className={cn(ANCHO_IR, "shrink-0 border-l border-line")}>
          <span className="sr-only">Dossier</span>
        </div>
      </div>
    </div>
  );
}

/** Mismo alto y misma rejilla que la fila real: la tabla no debe saltar al terminar de cargar. */
function SkeletonFilaTabla() {
  return (
    <div className="border-b border-line last:border-b-0" aria-hidden>
      <div className="flex items-stretch">
        <div className={cn(REJILLA, ALTO_FILA, PAD_FILA, "min-w-0 flex-1")}>
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-3 w-[72%]" />
          <Skeleton className={cn(CELDA_MD, "h-3 w-[64%]")} />
          <Skeleton className={cn(CELDA_XL, "h-3 w-[70%]")} />
          <Skeleton className={cn(CELDA_MD, "h-3 w-[60%]")} />
          <Skeleton className="h-3 w-full" />
          <Skeleton className={cn(CELDA_MD, "h-3 w-full")} />
        </div>
        <div className={cn(ANCHO_IR, "shrink-0 border-l border-line")} />
      </div>
    </div>
  );
}

/**
 * Pie: las dos escalas de la tabla, dichas con palabras. La columna de riesgo es
 * un ícono en pantallas medianas; acá abajo se explica una vez qué significa cada
 * uno, y el estado de lectura repite su catálogo de cinco. Son ejes distintos y
 * se leen como distintos.
 */
function PieDeTabla() {
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-[11px] leading-tight text-mute lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-5">
      <LeyendaPeso />
      <LeyendaLectura className="hidden lg:inline-flex" />
    </div>
  );
}

// ─── Lista compacta (panel del mapa) ─────────────────────────────────────────

function ListaCompacta({ rows, selectedOcid, onSelect, onHover, cargando }: FilasProps) {
  if (!rows.length && cargando) {
    return (
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => <SkeletonFilaCompacta key={i} />)}
      </ul>
    );
  }
  return (
    <ul
      role="list"
      className={cn("divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper", cargando && "opacity-60")}
      aria-busy={cargando}
    >
      {rows.map((c) => (
        <FilaCompacta key={c.ocid} c={c} selected={selectedOcid === c.ocid} onSelect={onSelect} onHover={onHover} />
      ))}
    </ul>
  );
}

/** Tres líneas y el mismo alto mínimo que la fila real: el panel del mapa no debe saltar al cargar. */
function SkeletonFilaCompacta() {
  return (
    <li className={cn(ALTO_COMPACTA, "px-2.5 py-2")} aria-hidden>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="mt-1 h-2.5 w-11/12" />
      <Skeleton className="mt-1 h-2.5 w-1/2" />
    </li>
  );
}

const ALTO_COMPACTA = "min-h-[60px]";

function FilaCompacta({ c, selected, onSelect, onHover }: { c: ContratoResumen; selected: boolean; onSelect?: FilasProps["onSelect"]; onHover?: FilasProps["onHover"] }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const lectura = estadoLecturaDe(c);
  const tipoEtapa = [tipoLabel(c.tipo), etapaLabel(c.etapa)].filter(Boolean).join(", ") || "Sin clasificar";
  // El puntaje nunca va sin las señales que lo explican (§10.4): la fila dice cuántas hay.
  const nSenales = c.enRevision ? 0 : c.banderas ?? 0;
  return (
    <li
      ref={ref}
      className={cn(
        "group transition-colors duration-rapido",
        ALTO_COMPACTA,
        selected ? FILA_SELECCIONADA : "hover:bg-paperSoft",
      )}
      onMouseEnter={() => onHover?.(c)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onSelect?.(selected ? null : c)}
          aria-pressed={selected}
          className="min-w-0 flex-1 px-2.5 py-2 text-left"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <PesoRiesgo score={c.score} banderas={c.banderas} enRevision={c.enRevision} formato="punto" />
            <span className="truncate text-[12px] font-medium leading-tight text-ink" title={c.titulo ?? undefined}>
              {c.titulo ?? "(sin objeto registrado)"}
            </span>
            {nSenales > 0 && (
              <span className="shrink-0 text-[10.5px] tabular-nums text-mute">{plural(nSenales, "señal", "señales")}</span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2 text-[10.5px] leading-tight text-mute">
            <span className="flex min-w-0 items-baseline gap-x-2">
              <span className="truncate">{c.entidad ?? "Entidad no identificada"}</span>
              {c.zona && <span className="shrink-0">{c.zona}</span>}
            </span>
            <span className="flex shrink-0 items-baseline gap-x-2.5 tabular-nums">
              <span className={c.montoPen ? "font-mono text-inkSoft" : undefined}>{formatMonto(c.montoPen, c.moneda)}</span>
              <span>{formatFecha(c.fecha)}</span>
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[10.5px] leading-tight">
            <EstadoLecturaCelda info={lectura} className="shrink-0 text-[10.5px]" />
            <span className="truncate text-mute">{tipoEtapa}</span>
            <span className="ml-auto shrink-0 font-mono text-mute">{c.codigo}</span>
          </div>
        </button>
        <Link
          href={`/app/contratos/${encodeURIComponent(c.ocid)}`}
          className="flex w-8 shrink-0 items-center justify-center border-l border-line text-mute transition-colors duration-rapido hover:bg-paperSoft hover:text-granate"
          aria-label={`Abrir el dossier completo de ${c.codigo}`}
        >
          <ArrowUpRight size={13} aria-hidden />
        </Link>
      </div>
    </li>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

/** Estilo compartido de la acción de un estado vacío ("Reintentar" · "Quitar todos los filtros"). */
const ACCION_CLS =
  "inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line bg-paper px-3.5 py-1.5 text-[12px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";
