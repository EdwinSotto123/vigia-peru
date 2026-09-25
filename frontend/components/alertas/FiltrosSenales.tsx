"use client";

/**
 * Filtros del índice de señales. Viven en la URL (`?severidad=&regla=&entidad=&agente=`)
 * para que un filtro sea compartible: el periodista manda el link de "todo lo que
 * encontró el agente de precios en esta municipalidad", no un pantallazo.
 *
 * Deliberadamente NO hay filtro por región, y no es un olvido: 84 de las 94 alertas
 * publicadas tienen `lat`/`lon` nulos, y el campo `region` mezcla departamentos con
 * provincias —"Huamanga", "Espinar", "Carabaya", "Cañete" conviven con "Lima"—, así
 * que un desplegable de departamentos daría resultados falsos por omisión. La
 * geografía se filtra donde sí es fiable: el ubigeo de /app/mapa y /app/contratos.
 *
 * Todos los conteos son cruzados: cada lista cuenta sobre el conjunto que dejan los
 * OTROS filtros, así que ninguna opción lleva a cero. Se calculan en el servidor y
 * llegan como datos planos — nunca una función cruza este límite (rompe solo en
 * producción; ya pasó dos veces en este repo).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";
import { senalesQueryString, type FacetasSenales, type NivelBandera, type SenalesQuery } from "@/lib/revision";
import { NivelSenal } from "./NivelSenal";

const campo =
  "h-9 max-w-[16rem] rounded-xl border border-line bg-paper px-2.5 text-[13px] text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate disabled:cursor-not-allowed disabled:bg-paperSoft disabled:text-mute";

/**
 * Publicadas ↔ en revisión. Es un cambio de modo, no un filtro más: son dos
 * poblaciones distintas (la segunda ni siquiera sale de `GET /alertas`). Van como
 * enlaces, así que funcionan sin JS y se pueden abrir en otra pestaña.
 *
 * La segunda sale de los procesamientos, que sólo conocen lo FINANCIADO: por eso
 * dice "Financiados en revisión" (DESIGN_SYSTEM.md §10.1), no "En revisión", que
 * es el total de alertas frenadas (incluye los análisis a demanda).
 */
export function SelectorVista({
  vista,
  publicadas,
  enRevision,
  inerte = false,
}: {
  vista: SenalesQuery["vista"];
  /** `null` mientras el servidor todavía cuenta: se muestra un hueco, nunca un 0 provisional. */
  publicadas: number | null;
  enRevision: number | null;
  /** Estado de carga: conserva el sitio y la forma, sin ofrecer un destino todavía. */
  inerte?: boolean;
}) {
  const tab = (activa: boolean) =>
    cn(
      "inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-colors duration-rapido",
      // Granate = la vista elegida (la marca), nunca un nivel de riesgo.
      activa ? "bg-granate text-paper" : "text-inkSoft hover:bg-granate-50 hover:text-ink",
      inerte && "pointer-events-none",
    );
  const conteo = (n: number | null) =>
    n == null ? (
      <span className="inline-block h-2.5 w-5 animate-shimmerSweep rounded bg-gradient-to-r from-paperDeep via-paper to-paperDeep bg-[length:200%_100%]" aria-hidden />
    ) : (
      <span className="text-[12px] font-semibold tabular-nums">{numero(n)}</span>
    );
  return (
    <div
      className="inline-flex flex-wrap items-center gap-1 rounded-full border border-line bg-paper p-1"
      role="group"
      aria-label="Qué señales ver"
      aria-busy={publicadas == null || undefined}
    >
      <Link href="/app/hallazgos" className={tab(vista === "publicadas")} aria-current={vista === "publicadas" ? "page" : undefined}>
        Publicadas
        {conteo(publicadas)}
      </Link>
      <Link
        href="/app/hallazgos?vista=revision"
        className={tab(vista === "revision")}
        aria-current={vista === "revision" ? "page" : undefined}
      >
        Financiados en revisión
        {conteo(enRevision)}
      </Link>
    </div>
  );
}

export function FiltrosSenales({ query, facetas }: { query: SenalesQuery; facetas: FacetasSenales }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, start] = useTransition();

  const navegar = (patch: Partial<SenalesQuery>) => {
    // Cualquier cambio de filtro vuelve a la página 1: mantenerla llevaba a un
    // "página 7 de 2" vacío, que se lee como "no hay nada" y no lo es.
    const qs = senalesQueryString({ ...query, ...patch, pagina: 1 });
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const hayFiltros = !!(query.regla || query.severidad || query.entidad || query.agente);

  return (
    // Pegajosa sólo desde md: en un teléfono de 390 px la barra envuelve en cuatro
    // renglones (~195 px) y, fija arriba, se comía un cuarto de la pantalla mientras
    // se leía la lista. Ahí se queda en su sitio y se vuelve a ella subiendo.
    <div className="z-barra flex flex-wrap items-center gap-2 border-b border-line/70 bg-paper/95 py-2.5 backdrop-blur md:sticky md:top-0">
      {/* Chips con conteo. La severidad la dicen el ícono y la palabra de cada chip
          (NivelSenal); el chip elegido se marca con granate, el color de "elegido". */}
      <span className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar por severidad">
        <BotonSeveridad activo={!query.severidad} onClick={() => navegar({ severidad: undefined })}>
          Toda severidad
        </BotonSeveridad>
        {facetas.severidad.map((f) => {
          const activo = query.severidad === f.valor;
          return (
            <BotonSeveridad key={f.valor} activo={activo} onClick={() => navegar({ severidad: f.valor as NivelBandera })}>
              <NivelSenal nivel={f.valor as NivelBandera} className={cn("text-[13px]", activo && "text-paper")} />
              <span className="font-semibold tabular-nums">{numero(f.n)}</span>
            </BotonSeveridad>
          );
        })}
      </span>

      <Desplegable
        etiqueta="Regla"
        valor={query.regla ?? ""}
        placeholder={`Toda regla (${facetas.regla.length})`}
        opciones={facetas.regla}
        onChange={(v) => navegar({ regla: v || undefined })}
      />

      <Desplegable
        etiqueta="Entidad"
        valor={query.entidad ?? ""}
        placeholder={`Toda entidad (${facetas.entidad.length})`}
        opciones={facetas.entidad}
        onChange={(v) => navegar({ entidad: v || undefined })}
      />

      <Desplegable
        etiqueta="Agente que la encontró"
        valor={query.agente ?? ""}
        placeholder={`Todo agente (${facetas.agente.length})`}
        opciones={facetas.agente}
        onChange={(v) => navegar({ agente: v || undefined })}
      />

      {hayFiltros && (
        <button
          type="button"
          onClick={() => start(() => router.push(pathname, { scroll: false }))}
          className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12px] text-inkSoft transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
        >
          <X size={12} aria-hidden /> Quitar filtros
        </button>
      )}
      {pendiente && (
        <span role="status" className="inline-flex items-center">
          <Loader2 size={14} className="animate-spin text-mute" aria-hidden />
          <span className="sr-only">Aplicando filtros…</span>
        </span>
      )}
    </div>
  );
}

function BotonSeveridad({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors duration-rapido",
        activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
      )}
    >
      {children}
    </button>
  );
}

function Desplegable({
  etiqueta,
  valor,
  placeholder,
  opciones,
  onChange,
}: {
  etiqueta: string;
  valor: string;
  placeholder: string;
  opciones: { valor: string; etiqueta: string; n: number }[];
  onChange: (v: string) => void;
}) {
  // El valor activo puede no estar en las facetas cruzadas (es el único de su
  // grupo): se agrega a mano para que el <select> no se vacíe solo.
  const lista = valor && !opciones.some((o) => o.valor === valor) ? [{ valor, etiqueta: valor, n: 0 }, ...opciones] : opciones;
  return (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      aria-label={etiqueta}
      disabled={opciones.length === 0}
      className={cn(campo, valor && "border-granate/60 font-medium")}
    >
      <option value="">{placeholder}</option>
      {lista.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.etiqueta} ({numero(o.n)})
        </option>
      ))}
    </select>
  );
}
