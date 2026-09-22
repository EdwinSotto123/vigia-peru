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
 *    900 px entraban TRES contratos, y recorrer los 50 de una página costaba
 *    ~6 750 px de scroll para leer tres veces el mismo título.
 *  - COMPACTA (`compacto`), para la columna angosta del panel del mapa, donde la
 *    fila está atada a la selección del punto en el mapa.
 *
 * Conexión con el mapa: `MapaContratosContext` (lo provee MapaWrapper) trae el
 * distrito elegido, el contrato seleccionado y los handlers de hover/selección.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Inbox, WifiOff } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { Paginacion } from "@/components/ui/Paginacion";
import { Severidad } from "@/components/ui/Severidad";
import type { NivelSeveridad } from "@/lib/severidad";
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
import { Skeleton } from "@/components/ui/Skeleton";
import {
  ALTO_FILA,
  ANCHO_IR,
  CELDA_MD,
  CELDA_XL,
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

  return (
    <div className="space-y-2">
      {pag}
      {fallo && !rows.length ? (
        <Aviso
          icon={<WifiOff size={18} />}
          text="El API de Vigía no respondió: la lista de contratos no se pudo cargar."
          ayuda="No se muestra una copia vieja ni datos de relleno. Si la lista no carga, no hay lista."
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
          icon={<Inbox size={18} />}
          text={hayFiltros ? "Ningún contrato cumple todos los filtros a la vez." : "Esta consulta no devolvió ningún contrato."}
          ayuda={
            hayFiltros
              ? "Los filtros se combinan con «y», no con «o». Quita arriba el más restrictivo —cada uno se quita por separado— y la lista se vuelve a llenar."
              : "La cola de Vigía se rearma cada noche con lo que publica la API OCDS del OECE. Si acá no hay nada, es que esa zona no tiene convocatorias en el rango pedido."
          }
          action={navegacion === "url" && hayFiltros ? <Link href={pathname} className={ACCION_CLS}>Quitar todos los filtros</Link> : undefined}
        />
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
      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <Cabecera />
        <ul role="list" className={cn(cargando && !vacia && "opacity-60")} aria-busy={cargando}>
          {vacia
            ? Array.from({ length: 12 }, (_, i) => <SkeletonFilaTabla key={i} />)
            : rows.map((c) => (
                <FilaContrato key={c.ocid} c={c} selected={selectedOcid === c.ocid} onHover={onHover} />
              ))}
        </ul>
      </div>
      <PieDeTabla />
    </div>
  );
}

/** Cabecera de columnas. Usa la MISMA rejilla que la fila: si se tocan por separado, se desalinean. */
function Cabecera() {
  return (
    <div className="flex items-stretch border-b border-line bg-paperSoft text-[11px] leading-tight text-mute" aria-hidden>
      <div className={cn(REJILLA, PAD_FILA, "min-w-0 flex-1")}>
        <span className="truncate">Señal</span>
        <span className="truncate">
          {/* En móvil la columna mide ~110 px: el rótulo largo se cortaría a la mitad. */}
          <span className="md:hidden">Contrato</span>
          <span className="hidden md:inline">Objeto de la contratación</span>
        </span>
        <span className={cn(CELDA_MD, "truncate")}>Entidad y zona</span>
        <span className={cn(CELDA_XL, "truncate")}>Tipo y etapa</span>
        <span className={cn(CELDA_MD, "truncate")}>Estado de lectura</span>
        <span className="truncate text-right">Valor ref.</span>
        <span className={cn(CELDA_MD, "truncate text-right")}>Convocada</span>
      </div>
      <div className={cn(ANCHO_IR, "shrink-0 border-l border-line")} />
    </div>
  );
}

/** Mismo alto y misma rejilla que la fila real: la tabla no debe saltar al terminar de cargar. */
function SkeletonFilaTabla() {
  return (
    <li className="border-b border-line last:border-b-0" aria-hidden>
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
    </li>
  );
}

/**
 * Pie: las dos escalas de la tabla, dichas con palabras. La columna "Señal" es un
 * ícono (formato punto) porque 16 px es lo que cuesta una columna de escaneo; acá
 * abajo se explica una vez qué significa cada uno, y el estado de lectura repite
 * su catálogo canónico de cinco. Son ejes distintos y se leen como distintos.
 */
function PieDeTabla() {
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-[11px] leading-tight text-mute lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-5">
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Señal:</span>
        {(Object.keys(PUNTAJE_MUESTRA) as NivelSeveridad[]).map((n) => (
          <Severidad key={n} score={PUNTAJE_MUESTRA[n]} formato="linea" className="text-[11px]" />
        ))}
      </span>
      <LeyendaLectura className="hidden lg:inline-flex" />
    </div>
  );
}

/**
 * Un score de muestra por nivel, para rotular la leyenda con el MISMO componente
 * que usan las filas (nada de reimplementar los colores acá). Tipado como Record
 * completo a propósito: si algún día `lib/severidad` agrega un nivel, este archivo
 * deja de compilar en vez de omitirlo en silencio.
 */
const PUNTAJE_MUESTRA: Record<NivelSeveridad, number | null> = {
  alta: 85,
  media: 55,
  baja: 10,
  sin_analizar: null,
};

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
  return (
    <li
      ref={ref}
      className={cn(
        "group transition-colors duration-rapido",
        ALTO_COMPACTA,
        selected ? "bg-heroViolet/5 shadow-[inset_3px_0_0_0_#4F3D96]" : "hover:bg-paperSoft",
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
            <Severidad score={c.score} formato="punto" />
            <span className="truncate text-[12px] font-medium leading-tight text-ink" title={c.titulo ?? undefined}>
              {c.titulo ?? "(sin objeto)"}
            </span>
            {c.score != null && <span className="shrink-0 font-mono text-[10.5px] text-mute">{c.score}/100</span>}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2 text-[10.5px] leading-tight text-mute">
            <span className="flex min-w-0 items-baseline gap-x-2">
              <span className="truncate">{c.entidad ?? "—"}</span>
              {c.zona && <span className="shrink-0 text-mute/80">{c.zona}</span>}
            </span>
            <span className="flex shrink-0 items-baseline gap-x-2.5 font-mono">
              <span>{formatMonto(c.montoPen, c.moneda)}</span>
              <span className="text-mute/80">{formatFecha(c.fecha)}</span>
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
          className="flex w-8 shrink-0 items-center justify-center border-l border-line text-mute transition-colors duration-rapido hover:bg-paperSoft hover:text-ink"
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
const ACCION_CLS = "inline-flex items-center gap-1 rounded-full border border-line bg-paper px-3 py-1.5 text-[12px] font-medium text-ink transition-colors duration-rapido hover:border-heroViolet/40 hover:bg-paperSoft";

/**
 * Estado vacío / de error: dice qué pasó, enseña por qué y ofrece la siguiente
 * acción. Nunca un hueco en blanco y nunca un dato de relleno para taparlo.
 */
function Aviso({ icon, text, ayuda, action }: { icon: React.ReactNode; text: string; ayuda?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper px-5 py-8 text-center">
      <span className="inline-flex text-mute">{icon}</span>
      <p className="mt-2 text-sm font-medium text-ink">{text}</p>
      {ayuda && <p className="mx-auto mt-1 max-w-[52ch] text-[12.5px] leading-relaxed text-mute">{ayuda}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
