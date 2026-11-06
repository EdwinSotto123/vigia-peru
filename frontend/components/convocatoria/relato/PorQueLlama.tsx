"use client";

import { ChevronRight, Scale } from "lucide-react";
import { Nota } from "@/components/patrones";
import { Severidad } from "@/components/ui/Severidad";
import { listaY, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import type { Bandera } from "../types";
import type { EstadoCorrida } from "../dossier";
import { AvisoSeccion } from "../sections/AvisoSeccion";
import { agruparPorTema, type SenalRelato } from "./historia";
import { normaLegible } from "@/lib/modelos";

const BORDE: Record<SenalRelato["severidad"], string> = { alta: "border-crimson/30", media: "border-amber/30", baja: "border-line" };
export const ENLACE_RELATO =
  "inline-flex min-h-[32px] items-center gap-1 rounded-full text-meta font-semibold text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate";

/**
 * «Por qué llama la atención»: las señales de la más grave a la más leve, agrupadas por tema (la competencia, el precio,
 * el proveedor…), cada una en su tarjeta con la evidencia en una oración, la norma que la sostiene y el acceso a su
 * evidencia completa (la tabla de la pestaña Señales, con el cotejo, el agente y las citas). Sin tabla aquí: se lee como
 * un argumento, no como un listado (pedido del usuario del 2026-11-05).
 *
 * La primera tarjeta de cada regla lleva su ancla (`relato-senal-<regla>`): los chips de la cronología llevan aquí.
 */
export function PorQueLlama({
  senales,
  contexto,
  noVerificables,
  corrida,
  verEvidencia,
}: {
  senales: SenalRelato[];
  contexto: Bandera[];
  noVerificables: Bandera[];
  corrida: EstadoCorrida;
  verEvidencia: () => void;
}) {
  const grupos = agruparPorTema(senales);
  // Lo que se muestra aparte en la pestaña Señales y no cuenta: se nombra para que no parezca que se perdió.
  const aparte = [
    contexto.length > 0 && plural(contexto.length, "hecho de contexto", "hechos de contexto"),
    noVerificables.length > 0 && plural(noVerificables.length, "señal de precio no verificable", "señales de precio no verificables"),
  ].filter((x): x is string => Boolean(x));
  const notaAparte = aparte.length > 0 && (
    <Nota>
      Aparte y fuera de los conteos, el análisis registra {listaY(aparte)}.{" "}
      <button type="button" onClick={verEvidencia} className="font-semibold text-granate hover:underline">
        Verlos en Señales
      </button>
    </Nota>
  );

  if (grupos.length === 0) {
    return (
      <div className="space-y-3">
        {corrida.completa ? (
          <AvisoSeccion titulo="El análisis terminó sin señales">Ninguna regla de contratación disparó una señal.</AvisoSeccion>
        ) : (
          <AvisoSeccion titulo="Análisis incompleto: sin señales registradas">
            {corrida.faltan.length > 0 && `Faltó ${corrida.faltan.join(" y ")}. `}
            Que no aparezcan señales no quiere decir que el contrato no las tenga.
          </AvisoSeccion>
        )}
        {notaAparte}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {grupos.map((g) => (
        <section key={g.tema} aria-labelledby={`relato-tema-${g.tema}`} className="space-y-2">
          <h3 id={`relato-tema-${g.tema}`} className="flex flex-wrap items-baseline gap-x-2 font-display text-cuerpo font-bold leading-tight text-ink">
            {g.titulo}
            <span className="font-sans text-rotulo font-normal text-mute">{plural(g.senales.length, "señal", "señales")}</span>
          </h3>
          <ul className="space-y-2">
            {g.senales.map((s, i) => (
              <li key={`${s.regla}-${i}`}>
                <TarjetaSenal s={s} verEvidencia={verEvidencia} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {notaAparte}
    </div>
  );
}

/** Una señal del relato: su gravedad, su nombre, lo que se encontró en una oración y la norma; la evidencia entera, en Señales. */
function TarjetaSenal({ s, verEvidencia }: { s: SenalRelato; verEvidencia: () => void }) {
  // «Heurística — …» no es una norma: es un criterio de Vigía (alguien de afuera lo buscaba en la ley).
  const norma = normaLegible(s.norma);
  return (
    <article
      id={s.ancla ?? undefined}
      className={cn(
        // Bajo la barra de pestañas fija; resaltada cuando se llega desde un chip de la cronología.
        "scroll-mt-[calc(var(--alto-barra-fija,0px)+1rem)] rounded-2xl border bg-paper px-4 py-3 [&:target]:ring-2 [&:target]:ring-granate/40",
        BORDE[s.severidad],
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Severidad bandera={s.severidad} />
        <h4 className="min-w-0 text-dato font-semibold leading-snug text-ink">{s.etiqueta}</h4>
        {s.item && <span className="font-mono text-rotulo text-mute">ítem {s.item}</span>}
      </div>
      {s.evidencia ? (
        <p className="mt-1.5 max-w-prose break-words text-meta leading-relaxed text-inkSoft text-pretty">{redactDnis(s.evidencia)}</p>
      ) : (
        <p className="mt-1.5 text-meta text-mute">El análisis no guardó el texto de esta señal.</p>
      )}
      {s.tambien && <p className="mt-1 text-rotulo text-mute">También la marca la regla «{s.tambien}», con el mismo hecho.</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line/70 pt-2">
        <p className="flex min-w-0 items-start gap-1.5 text-rotulo leading-snug text-mute">
          <Scale size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {norma ? (norma.criterio ? <>Criterio de Vigía: {norma.texto}</> : <>Norma: {norma.texto}</>) : "No cita una norma: se sostiene en la evidencia."}
          </span>
        </p>
        <button type="button" onClick={verEvidencia} className={ENLACE_RELATO}>
          Ver la evidencia completa <ChevronRight size={14} aria-hidden />
        </button>
      </div>
    </article>
  );
}
