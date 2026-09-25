"use client";

/**
 * La lista de contratos EMBEBIDA en el panel de zona del mapa (20 por página, estado
 * propio + fetch al API). La lista de /app/contratos es otra: `TablaContratos`, sobre
 * la plantilla Listado del kit, con los filtros en la URL.
 *
 * La fila es de la misma familia que la de la tabla (DESIGN_SYSTEM.md §14.1), con las
 * mismas piezas —el chip de estado, `CeldaPrincipal` (objeto + entidad y zona) y
 * `CeldaNumero` (valor referencial a la derecha, la fecha debajo)—, apiladas para la
 * columna angosta del panel. Elegir una fila marca su distrito en el mapa y pasar por
 * encima lo resalta; el dossier se abre con el ↗ de la derecha.
 *
 * Los cinco estados de §10.5: cargando (esqueleto con la forma de la fila), vacío y
 * error (patrones con la llamita), parcial (el paginador dice "1–20 de 1,204") y lleno.
 *
 * Conexión con el mapa: `MapaContratosContext` (lo provee MapaWrapper) trae el
 * distrito elegido, el contrato seleccionado y los handlers de hover/selección.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { Paginacion } from "@/components/ui/Paginacion";
import { Skeleton } from "@/components/ui/Skeleton";
import { EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal } from "@/components/listado";
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
import { EstadoContratoPill as PildoraEstadoContrato, EstadoContratoChip } from "./estadoLectura";
import { recortar } from "./recortar";
import { cn } from "@/lib/utils";

/**
 * Compatibilidad: el dossier (`ContratoDetalle`, un server component) importa
 * `EstadoContratoPill` desde este módulo desde siempre. La implementación vive en
 * `estadoLectura.tsx` junto con el resto del eje de estado; acá queda un componente
 * real —no un `export … from`— para que el límite servidor→cliente sea el de este
 * archivo, que ya lo era.
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
  size?: number;
  /** Único modo: estado propio y fetch al API (la lista vive dentro del mapa, no en la URL). */
  navegacion?: "interna";
  /** Filas apiladas para la columna angosta del panel (el único formato de esta lista). */
  compacto?: boolean;
  selectedOcid?: string | null;
  onSelect?: (c: ContratoResumen | null) => void;
  onHover?: (c: ContratoResumen | null) => void;
  /** Avisa cada vez que llega una página del API. */
  onCargada?: (p: ContratosPagina) => void;
}

export function ContratosLista({ query, size = 20, selectedOcid = null, onSelect, onHover, onCargada }: Props) {
  const [pagina, setPagina] = useState<ContratosPagina | null>(null);
  const [page, setPage] = useState<number>(query.page ?? 1);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(false);
  /** "Reintentar": incrementarlo vuelve a disparar el efecto de fetch. */
  const [retry, setRetry] = useState(0);
  const qsFiltros = useMemo(() => contratosQueryString({ ...query, page: undefined, size: undefined }), [query]);
  const hayFiltros = !!(
    query.q || query.tipo || query.etapa || query.ubigeo || query.entidad ||
    query.riesgo || query.operativo || query.desde || query.monto_min != null || query.monto_max != null
  );

  // Al cambiar filtros se vuelve a la página 1.
  useEffect(() => {
    setPage(1);
  }, [qsFiltros]);

  useEffect(() => {
    const ctrl = new AbortController();
    setCargando(true);
    fetch(`${PUBLIC_API_BASE}/contratos?${contratosQueryString({ ...query, page, size })}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: ContratosPagina) => { setPagina(j); setFallo(false); onCargada?.(j); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setFallo(true); })
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [qsFiltros, page, size, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = pagina?.total ?? 0;
  const tam = pagina?.size ?? size;
  const paginas = Math.max(1, Math.ceil(total / tam));
  const actual = pagina?.page ?? page;
  const rows = pagina?.data ?? [];

  const pag = (
    <Paginacion actual={actual} paginas={paginas} total={total} tam={tam} navegacion="interna" onChange={setPage} cargando={cargando} nombre="contratos" />
  );

  /** Página fuera de rango: el contador diría "401–380 de 380". Se oculta y el aviso lo explica. */
  const fueraDeRango = !rows.length && !cargando && total > 0 && actual > paginas;

  return (
    <div className="space-y-2">
      {!fueraDeRango && !(fallo && !rows.length) && pag}
      {fallo && !rows.length ? (
        <EstadoError
          titulo="No pudimos cargar la lista de contratos"
          accion={<button type="button" onClick={() => setRetry((n) => n + 1)} className={ACCION}>Reintentar</button>}
        >
          Suele ser momentáneo: vuelve a intentarlo en unos segundos.
        </EstadoError>
      ) : fueraDeRango ? (
        // Hay contratos, sólo que no tantos: decir "no hay contratos" sería falso.
        <EstadoVacio
          compacto
          titulo={`Esta página no existe: la lista llega hasta la página ${numero(paginas)}`}
          accion={<button type="button" onClick={() => setPage(paginas)} className={ACCION}>Ir a la última página</button>}
        >
          Hay {plural(total, "contrato", "contratos")}
          {hayFiltros ? " con estos filtros" : ""}, {tam} por página.
        </EstadoVacio>
      ) : !rows.length && !cargando ? (
        <EstadoVacio compacto titulo={hayFiltros ? "Ningún contrato cumple todos los filtros a la vez" : "No hay contratos para esta consulta"}>
          {hayFiltros
            ? "Los filtros se suman: quita el más restrictivo y la lista se vuelve a llenar."
            : "Esta zona no tiene convocatorias publicadas en el SEACE para el rango pedido."}
        </EstadoVacio>
      ) : (
        <ListaCompacta rows={rows} selectedOcid={selectedOcid} onSelect={onSelect} onHover={onHover} cargando={cargando} />
      )}
      {rows.length > 10 && pag}
    </div>
  );
}

// ─── Filas ───────────────────────────────────────────────────────────────────

interface FilasProps {
  rows: ContratoResumen[];
  selectedOcid: string | null;
  onSelect?: (c: ContratoResumen | null) => void;
  onHover?: (c: ContratoResumen | null) => void;
  cargando: boolean;
}

/** Misma caja que la `Tabla` del kit: borde, radio y separadores. */
const CAJA = "divide-y divide-line/70 overflow-hidden rounded-2xl border border-line bg-paper";
/** La marca de "elegida" de la `Tabla` (`resaltada`): selección = marca granate, nunca riesgo. */
const SELECCIONADA = "bg-granate-50 shadow-[inset_3px_0_0_0_theme(colors.granate.DEFAULT)]";

function ListaCompacta({ rows, selectedOcid, onSelect, onHover, cargando }: FilasProps) {
  if (!rows.length && cargando) {
    return (
      <ul className={CAJA} aria-hidden>
        {Array.from({ length: 6 }, (_, i) => <SkeletonFila key={i} />)}
      </ul>
    );
  }
  return (
    <ul role="list" aria-label="Contratos de la zona" aria-busy={cargando} className={cn(CAJA, "transition-opacity duration-rapido", cargando && "opacity-60")}>
      {rows.map((c) => (
        <FilaCompacta key={c.ocid} c={c} selected={selectedOcid === c.ocid} onSelect={onSelect} onHover={onHover} />
      ))}
    </ul>
  );
}

/** La forma de la fila real (título, meta, chip; número a la derecha): el panel no salta al cargar. */
function SkeletonFila() {
  return (
    <li className="grid min-h-[84px] grid-cols-[minmax(0,1fr)_72px] gap-x-3 px-3 py-2.5" aria-hidden>
      <span className="block space-y-1.5">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </span>
      <Skeleton className="ml-auto h-3.5 w-16" />
    </li>
  );
}

function FilaCompacta({ c, selected, onSelect, onHover }: { c: ContratoResumen; selected: boolean; onSelect?: FilasProps["onSelect"]; onHover?: FilasProps["onHover"] }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const titulo = c.titulo ?? "Sin objeto registrado";
  const tipoEtapa = [tipoLabel(c.tipo), etapaLabel(c.etapa)].filter(Boolean).join(", ") || "Sin clasificar";
  // El peso del riesgo nunca va sin las señales que lo explican (§10.4).
  const nSenales = c.enRevision ? 0 : c.banderas ?? 0;
  const meta = [nSenales > 0 ? plural(nSenales, "señal", "señales") : null, c.entidad ?? "Entidad no identificada", c.zona]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      ref={ref}
      className={cn("group transition-colors duration-rapido", selected ? SELECCIONADA : "hover:bg-paperSoft")}
      onMouseEnter={() => onHover?.(c)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onSelect?.(selected ? null : c)}
          aria-pressed={selected}
          className="grid min-h-[84px] min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
        >
          <span className="block min-w-0">
            {/* Recortado en una palabra: el objeto entero va en el dossier. */}
            <CeldaPrincipal titulo={recortar(titulo, 140)} meta={meta} />
            <span className="mt-1.5 flex min-w-0 items-center gap-2">
              <EstadoContratoChip c={c} />
              <span className="truncate text-[12px] text-mute">{tipoEtapa}</span>
            </span>
          </span>
          <CeldaNumero sub={formatFecha(c.fecha)}>
            {c.montoPen ? formatMonto(c.montoPen, c.moneda) : <span className="font-sans text-mute">Sin dato</span>}
          </CeldaNumero>
        </button>
        <Link
          href={`/app/contratos/${encodeURIComponent(c.ocid)}`}
          className="flex w-9 shrink-0 items-center justify-center border-l border-line/70 text-mute transition-colors duration-rapido hover:bg-paperSoft hover:text-granate"
          aria-label={`Abrir el dossier completo de ${c.codigo}`}
        >
          <ArrowUpRight size={14} aria-hidden />
        </Link>
      </div>
    </li>
  );
}

/** La acción de un estado vacío o de error: la píldora secundaria de los listados. */
const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";
