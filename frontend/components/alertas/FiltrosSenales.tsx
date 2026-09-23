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
import { senalesQueryString, type FacetasSenales, type NivelBandera, type SenalesQuery } from "@/lib/revision";

const campo =
  "h-9 max-w-[16rem] rounded-xl border border-line bg-paper px-2.5 text-[13px] text-ink outline-none transition-colors duration-rapido hover:border-paperEdge focus:border-heroViolet disabled:cursor-not-allowed disabled:bg-paperSoft disabled:text-mute";

/**
 * Publicadas ↔ en revisión humana. Es un cambio de modo, no un filtro más: son dos
 * poblaciones distintas (la segunda ni siquiera sale de `GET /alertas`). Van como
 * enlaces, así que funcionan sin JS y se pueden abrir en otra pestaña.
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
      "inline-flex items-baseline gap-1.5 rounded-xl px-3 py-1.5 text-[13.5px] font-medium transition-colors duration-rapido",
      activa ? "bg-ink text-paper" : "text-inkSoft hover:bg-paperDeep hover:text-ink",
      inerte && "pointer-events-none",
    );
  const conteo = (n: number | null) =>
    n == null ? (
      <span className="inline-block h-2.5 w-5 animate-shimmerSweep rounded bg-gradient-to-r from-paperDeep via-paper to-paperDeep bg-[length:200%_100%]" aria-hidden />
    ) : (
      <span className="font-mono text-[12px] tabular-nums opacity-70">{n.toLocaleString("es-PE")}</span>
    );
  return (
    <div
      className="inline-flex items-center gap-1 rounded-2xl border border-line bg-paper p-1"
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
        En revisión humana
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
      <span
        className="inline-flex items-center gap-0.5 rounded-xl border border-line bg-paper p-1"
        role="group"
        aria-label="Filtrar por severidad"
      >
        <BotonSeveridad activo={!query.severidad} onClick={() => navegar({ severidad: undefined })}>
          Toda severidad
        </BotonSeveridad>
        {facetas.severidad.map((f) => (
          <BotonSeveridad
            key={f.valor}
            activo={query.severidad === f.valor}
            onClick={() => navegar({ severidad: f.valor as NivelBandera })}
          >
            {ETIQUETA_SEV[f.valor as NivelBandera]}
            <span className="ml-1 font-mono text-[11.5px] tabular-nums opacity-70">{f.n}</span>
          </BotonSeveridad>
        ))}
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
          className="inline-flex items-center gap-1 rounded-xl border border-dashed border-line px-2.5 py-2 text-[12px] text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
        >
          <X size={12} aria-hidden /> Limpiar
        </button>
      )}
      {pendiente && <Loader2 size={14} className="animate-spin text-mute" aria-label="Aplicando filtros" />}
    </div>
  );
}

const ETIQUETA_SEV: Record<NivelBandera, string> = { alta: "Alta", media: "Media", baja: "Baja" };

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
        "rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-rapido",
        activo ? "bg-ink text-paper" : "text-ink hover:bg-paperDeep",
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
      className={cn(campo, valor && "border-heroViolet/60 font-medium")}
    >
      <option value="">{placeholder}</option>
      {lista.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.etiqueta} ({o.n})
        </option>
      ))}
    </select>
  );
}
