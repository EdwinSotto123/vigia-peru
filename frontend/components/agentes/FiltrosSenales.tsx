"use client";

import type { ReactNode } from "react";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Los filtros de una lista de señales que llegó entera (pedido del usuario del 2026-11-16: «capaz ordenarlo por lista y
 * filtro»): por gravedad y por tema, cada opción con cuántas hay, como chips que se encienden. El conteo de cada opción
 * se calcula con el OTRO filtro puesto, así nunca promete una cifra que al tocarla no sale. Una opción en cero no se
 * dibuja. Los usan «Por qué llama la atención» (La historia) y «Las señales, una por una» (pestaña Señales).
 */

export type GravedadFiltro = "alta" | "media" | "baja";

export interface OpcionFiltro {
  valor: string;
  texto: string;
  n: number;
  /** La gravedad de la opción: pinta su ícono (las de tema no llevan). */
  gravedad?: GravedadFiltro;
}

const TONO_ACTIVO: Record<GravedadFiltro | "neutro", string> = {
  alta: "border-crimson bg-crimson-soft text-crimsonTexto",
  media: "border-amber bg-amber-soft text-amberTexto",
  baja: "border-inkSoft bg-paperDeep text-ink",
  neutro: "border-granate bg-granate-50 text-granate",
};

function Chip({ activo, onClick, gravedad, children }: { activo: boolean; onClick: () => void; gravedad?: GravedadFiltro; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-meta font-semibold transition-colors duration-rapido active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
        activo ? TONO_ACTIVO[gravedad ?? "neutro"] : "border-line bg-paper text-inkSoft hover:border-paperEdge hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Un grupo de chips («Gravedad», «Tema»): «Todas» más una por opción con señales. Tocar la elegida la quita. */
export function GrupoFiltro({
  nombre,
  todas,
  total,
  opciones,
  valor,
  alElegir,
}: {
  nombre: string;
  /** El rótulo del chip que quita el filtro: «Todas», «Todos». */
  todas: string;
  total: number;
  opciones: OpcionFiltro[];
  valor: string | null;
  alElegir: (v: string | null) => void;
}) {
  const conAlgo = opciones.filter((o) => o.n > 0 || o.valor === valor);
  // Con una sola opción no hay nada que filtrar.
  if (conAlgo.length < 2) return null;
  return (
    <div role="group" aria-label={`Filtrar por ${nombre.toLowerCase()}`} className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-rotulo font-semibold uppercase tracking-wide text-mute">{nombre}</span>
      <Chip activo={valor === null} onClick={() => alElegir(null)}>
        {todas}
        <span className="font-mono tabular-nums opacity-80">{numero(total)}</span>
      </Chip>
      {conAlgo.map((o) => {
        const Icono = o.gravedad ? ICONO_NIVEL[o.gravedad] : null;
        return (
          <Chip key={o.valor} activo={valor === o.valor} gravedad={o.gravedad} onClick={() => alElegir(valor === o.valor ? null : o.valor)}>
            {Icono && <Icono size={13} className="shrink-0" aria-hidden />}
            {o.texto}
            <span className="font-mono tabular-nums opacity-80">{numero(o.n)}</span>
          </Chip>
        );
      })}
    </div>
  );
}

const TEXTO_GRAVEDAD: Record<GravedadFiltro, string> = { alta: "Altas", media: "Medias", baja: "Bajas" };

/**
 * Los dos grupos juntos, sobre una lista de cosas con `severidad` y `tema`. Devuelve qué se ve con lo elegido (lo
 * calcula quien llama con `pasaFiltros`, para ordenar o agrupar a su manera).
 */
export function FiltrosSenales<T extends { severidad: GravedadFiltro; tema: string }>({
  senales,
  temas,
  gravedad,
  tema,
  alCambiar,
  className,
}: {
  senales: readonly T[];
  /** Los temas en el orden en que se muestran, con su nombre. */
  temas: readonly { clave: string; titulo: string }[];
  gravedad: GravedadFiltro | null;
  tema: string | null;
  alCambiar: (f: { gravedad: GravedadFiltro | null; tema: string | null }) => void;
  className?: string;
}) {
  const conTema = senales.filter((s) => !tema || s.tema === tema);
  const conGravedad = senales.filter((s) => !gravedad || s.severidad === gravedad);
  const vistas = senales.filter((s) => (!tema || s.tema === tema) && (!gravedad || s.severidad === gravedad));
  const hayFiltro = gravedad !== null || tema !== null;
  // Todas de la misma gravedad y del mismo tema: no hay nada que filtrar.
  if (!hayFiltro && new Set(senales.map((s) => s.severidad)).size < 2 && new Set(senales.map((s) => s.tema)).size < 2) return null;
  return (
    <div className={cn("space-y-2 rounded-2xl border border-line bg-paperSoft px-3.5 py-3", className)}>
      <GrupoFiltro
        nombre="Gravedad"
        todas="Todas"
        total={conTema.length}
        valor={gravedad}
        alElegir={(v) => alCambiar({ gravedad: v as GravedadFiltro | null, tema })}
        opciones={(["alta", "media", "baja"] as const).map((g) => ({ valor: g, texto: TEXTO_GRAVEDAD[g], n: conTema.filter((s) => s.severidad === g).length, gravedad: g }))}
      />
      <GrupoFiltro
        nombre="Tema"
        todas="Todos"
        total={conGravedad.length}
        valor={tema}
        alElegir={(v) => alCambiar({ gravedad, tema: v })}
        opciones={temas.map((t) => ({ valor: t.clave, texto: t.titulo, n: conGravedad.filter((s) => s.tema === t.clave).length }))}
      />
      {hayFiltro && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-inkSoft" aria-live="polite">
          <span>
            Se {vistas.length === 1 ? "ve" : "ven"} <strong className="font-semibold tabular-nums text-ink">{numero(vistas.length)}</strong> de {numero(senales.length)}.
          </span>
          <button type="button" onClick={() => alCambiar({ gravedad: null, tema: null })} className="font-semibold text-granate hover:underline">
            Quitar los filtros
          </button>
        </p>
      )}
    </div>
  );
}
