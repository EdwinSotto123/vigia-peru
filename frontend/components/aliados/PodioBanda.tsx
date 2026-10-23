import Link from "next/link";
import { FranjaTextil, Medalla } from "@/components/marca";
import { TIPO_FINANCIADOR_LABEL } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { AliadoAbrir } from "./AliadoAbrir";
import { AvatarAliado, esFundador } from "./TarjetaAliado";
import { pctProporcion } from "./proporcion";
import { hrefPerfil, type FilaRanking } from "./ranking";

/**
 * El podio de /app/aliados en versión de BANDA (DESIGN_SYSTEM.md §14.6): los tres primeros en una sola
 * fila baja, cada uno con su medalla, su nombre, cuántos contratos financió y su parte del total. Es el
 * mismo ranking que el podio de escalones de la portada (`PodioRanking`), pero sin tres columnas de 800 px
 * con el aire que pedía la escena: en la app, el ranking es una lista y el podio, su cabeza.
 *
 * Cada puesto con nombre abre el panel de ese aliado (`AliadoAbrir`), sin salir de la página. Un puesto
 * sin nombre se dibuja libre: decirlo es más honesto que estirar el podio, y es la invitación a subirse.
 * Se cuenta en contratos, nunca en soles.
 *
 * Server-safe: todo llega ya calculado.
 */

type Lugar = 1 | 2 | 3;

const CIFRA: Record<Lugar, string> = { 1: "text-maiz", 2: "text-paper", 3: "text-paper" };
const BORDE: Record<Lugar, string> = {
  1: "border-maiz/50 bg-maiz/[0.08]",
  2: "border-paper/20 bg-paper/[0.05]",
  3: "border-paper/20 bg-paper/[0.05]",
};

export function PodioBanda({
  filas,
  financiadosAmbito,
  lugarLibre,
  titulo = "Los tres que más contratos hicieron leer",
}: {
  /** Los primeros del ranking (hasta tres), ya con su puesto. */
  filas: FilaRanking[];
  /** Total financiado del ámbito: sin él no se dice qué parte es de cada uno. */
  financiadosAmbito?: number;
  /** Lo que se dice en un puesto sin nombre. */
  lugarLibre: string;
  titulo?: string;
}) {
  const lugares: Lugar[] = [1, 2, 3];
  return (
    <section aria-labelledby="podio-banda-titulo" className="sobre-oscuro relative overflow-hidden rounded-2xl bg-granate-deep text-paper">
      <FranjaTextil alto={4} />
      <div className="px-3.5 pb-3.5 pt-3 sm:px-4">
        <h2 id="podio-banda-titulo" className="font-display text-bloque font-bold leading-tight">
          {titulo}
        </h2>
        <ol className="mt-2.5 grid gap-2 md:grid-cols-3">
          {lugares.map((lugar) => {
            const fila = filas.find((f) => f.puesto === lugar);
            return fila ? (
              <Puesto key={fila.id} lugar={lugar} fila={fila} financiadosAmbito={financiadosAmbito} />
            ) : (
              <PuestoLibre key={`libre-${lugar}`} lugar={lugar} texto={lugarLibre} />
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function Puesto({ lugar, fila: f, financiadosAmbito }: { lugar: Lugar; fila: FilaRanking; financiadosAmbito?: number }) {
  const href = hrefPerfil(f.slug);
  const tipo = esFundador(f) ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[f.tipo];
  const pct = financiadosAmbito ? pctProporcion(f.contratosFinanciados, financiadosAmbito) : null;
  const clase = cn(
    "group/aliado flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
    BORDE[lugar],
    href && "hover:border-maiz/70 hover:bg-paper/[0.1]",
  );
  const cuerpo = (
    <>
      <Medalla puesto={lugar} tamano={40} corona={false} />
      <span aria-hidden className="hidden shrink-0 sm:flex">
        <AvatarAliado tipo={f.tipo} logoUrl={f.logoUrl} nombre={f.nombre} size="sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn("block truncate text-dato font-semibold leading-snug text-paper", href && "group-hover/aliado:underline")}
          title={f.nombre}
        >
          {f.nombre}
        </span>
        <span className="block truncate text-rotulo leading-snug text-paper/75">
          {tipo}
          {href && <span className="text-maiz"> Ver quién es →</span>}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cn("block font-display text-cifra font-extrabold leading-none tabular-nums", CIFRA[lugar])}>
          {numero(f.contratosFinanciados)}
        </span>
        <span className="mt-0.5 block text-rotulo leading-tight text-paper/75">
          {f.contratosFinanciados === 1 ? "contrato" : "contratos"}
          {pct && <span>, {pct}</span>}
        </span>
      </span>
    </>
  );
  return (
    <li className="min-w-0">
      {href ? (
        <AliadoAbrir fila={f} className={clase}>
          {cuerpo}
        </AliadoAbrir>
      ) : (
        <div className={clase}>{cuerpo}</div>
      )}
    </li>
  );
}

function PuestoLibre({ lugar, texto }: { lugar: Lugar; texto: string }) {
  return (
    <li className="min-w-0">
      <Link
        href="/app/financiar"
        className="group/libre flex w-full items-center gap-3 rounded-xl border border-dashed border-paper/30 p-2.5 text-left transition-colors hover:border-maiz/70"
      >
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-paper/35 font-display text-destacado leading-6 font-bold text-paper/65"
        >
          {lugar}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-dato font-semibold leading-snug text-paper/85">
            Puesto<span className="sr-only"> {lugar}</span> libre
          </span>
          <span className="block truncate text-rotulo leading-snug text-paper/70">{texto}</span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-meta font-semibold text-paper/85 group-hover/libre:text-maiz">
          Ocupa este lugar <span aria-hidden>→</span>
        </span>
      </Link>
    </li>
  );
}
