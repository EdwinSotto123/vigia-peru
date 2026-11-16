"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Scale, Tag } from "lucide-react";
import { FiltrosSenales, type GravedadFiltro } from "@/components/agentes/FiltrosSenales";
import { evidenciaRecortada, resumenSinDatosPersonales } from "@/components/agentes/ListaSenales";
import { Nota } from "@/components/patrones";
import { Severidad } from "@/components/ui/Severidad";
import { listaY, plural } from "@/lib/formato";
import { normaLegible } from "@/lib/modelos";
import { cn } from "@/lib/utils";
import type { NombreConocido } from "../../Redact";
import type { Bandera } from "../types";
import type { EstadoCorrida } from "../dossier";
import { AvisoSeccion } from "../sections/AvisoSeccion";
import type { ContextoSenal } from "../senal/directorio";
import { senalDeBandera } from "../senal/normalizar";
import { VerSenal } from "../senal/PanelSenal";
import { TITULO_TEMA, temaDeRegla, type ClaveTema, type SenalRelato } from "./historia";

export const ENLACE_RELATO =
  "inline-flex min-h-[32px] items-center gap-1 rounded-full text-meta font-semibold text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate";

/** Lo que entra en la fila de la evidencia: hasta el final de una oración, nunca a media frase. El resto, en su panel. */
const MAX_EVIDENCIA = 230;

const FILETE: Record<SenalRelato["severidad"], string> = { alta: "bg-crimson", media: "bg-amber", baja: "bg-paperEdge" };

/**
 * «Por qué llama la atención»: las señales en UNA lista con filtros (pedido del usuario del 2026-11-16: «capaz ordenarlo
 * por lista y filtro»). Antes eran tarjetas apiladas bajo un título por tema, cada una con su párrafo: con seis señales,
 * seis bloques de texto. Ahora:
 *
 *   · arriba, los filtros por gravedad y por tema, cada uno con cuántas hay;
 *   · una fila por señal, de la más grave a la más leve: su gravedad, su nombre y su tema, la evidencia hasta el final de
 *     una oración, la norma que la sostiene y «Ver la evidencia»;
 *   · la fila entera abre el panel lateral de la señal (sobre quién es, lo que se encontró, la norma, quién la encontró),
 *     sin cambiar de pestaña ni moverse de la lista.
 */
export function PorQueLlama({
  senales,
  contexto,
  noVerificables,
  corrida,
  verEvidencia,
  ctx,
  perfil,
  nombresPrivados,
}: {
  senales: SenalRelato[];
  contexto: Bandera[];
  noVerificables: Bandera[];
  corrida: EstadoCorrida;
  verEvidencia: () => void;
  /** De quién habla cada señal (para su panel). */
  ctx?: ContextoSenal | null;
  perfil?: string | null;
  /** Personas privadas del dossier: su apellido va tapado en la línea de evidencia de cada fila. */
  nombresPrivados?: NombreConocido[];
}) {
  const [gravedad, setGravedad] = useState<GravedadFiltro | null>(null);
  const [tema, setTema] = useState<string | null>(null);
  const conTema = useMemo(() => senales.map((s) => ({ ...s, tema: temaDeRegla(s.regla) as string })), [senales]);
  // Los temas en el orden de su señal más grave (las señales ya vienen ordenadas por gravedad).
  const temas = useMemo(() => {
    const vistos: ClaveTema[] = [];
    for (const s of conTema) if (!vistos.includes(s.tema as ClaveTema)) vistos.push(s.tema as ClaveTema);
    return vistos.map((t) => ({ clave: t as string, titulo: TITULO_TEMA[t] }));
  }, [conTema]);
  const vistas = conTema.filter((s) => (!gravedad || s.severidad === gravedad) && (!tema || s.tema === tema));

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

  if (senales.length === 0) {
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
    <div className="space-y-3">
      <FiltrosSenales
        senales={conTema}
        temas={temas}
        gravedad={gravedad}
        tema={tema}
        alCambiar={(f) => {
          setGravedad(f.gravedad);
          setTema(f.tema);
        }}
      />

      {vistas.length > 0 ? (
        <ul aria-label="Señales del contrato" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {vistas.map((s, i) => (
            <li key={`${s.regla}-${i}`}>
              <FilaSenal s={s} tema={TITULO_TEMA[s.tema as ClaveTema]} ctx={ctx ?? null} perfil={perfil} nombresPrivados={nombresPrivados} />
            </li>
          ))}
        </ul>
      ) : (
        <AvisoSeccion titulo="Ninguna señal con esos filtros">Quita un filtro para volver a ver la lista entera.</AvisoSeccion>
      )}
      {notaAparte}
    </div>
  );
}

/**
 * Una señal en su fila: el filete de su gravedad, el chip, su nombre y su tema; debajo la evidencia (hasta el final de una
 * oración) y la norma; a la derecha, «Ver la evidencia». Toda la fila es el botón que abre su panel.
 */
function FilaSenal({
  s,
  tema,
  ctx,
  perfil,
  nombresPrivados,
}: {
  s: SenalRelato;
  tema: string;
  ctx: ContextoSenal | null;
  perfil?: string | null;
  nombresPrivados?: NombreConocido[];
}) {
  // «Heurística — …» no es una norma: es un criterio de Vigía (alguien de afuera lo buscaba en la ley).
  const norma = normaLegible(s.norma);
  const senal = useMemo(() => senalDeBandera(s.origen), [s.origen]);
  const sigue = !!s.evidencia && evidenciaRecortada(s.evidencia, MAX_EVIDENCIA);
  return (
    <VerSenal
      senales={[senal]}
      ctx={ctx}
      perfil={perfil}
      className="relative flex w-full flex-col gap-x-4 gap-y-2 py-3 pl-5 pr-4 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:flex-row sm:items-start"
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", FILETE[s.severidad])} aria-hidden />
      <span className="shrink-0 sm:w-[7.5rem] sm:pt-0.5">
        <Severidad bandera={s.severidad} />
      </span>
      <span className="block min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-dato font-semibold leading-snug text-ink">{s.etiqueta}</span>
          <span className="inline-flex items-center gap-1 text-rotulo text-mute">
            <Tag size={11} className="shrink-0" aria-hidden />
            {tema}
          </span>
          {s.item && <span className="font-mono text-rotulo text-mute">ítem {s.item}</span>}
        </span>
        {s.evidencia ? (
          <span className="mt-1 block max-w-prose break-words text-meta leading-relaxed text-inkSoft text-pretty">
            {resumenSinDatosPersonales(s.evidencia, nombresPrivados, MAX_EVIDENCIA)}
          </span>
        ) : (
          <span className="mt-1 block text-meta text-mute">El análisis no guardó el texto de esta señal.</span>
        )}
        {s.tambien && <span className="mt-1 block text-rotulo text-mute">También la marca la regla «{s.tambien}», con el mismo hecho.</span>}
        <span className="mt-1.5 flex min-w-0 items-start gap-1.5 text-rotulo leading-snug text-mute">
          <Scale size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {norma ? (norma.criterio ? <>Criterio de Vigía: {norma.texto}</> : <>Norma: {norma.texto}</>) : "No cita una norma: se sostiene en la evidencia."}
          </span>
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 self-start text-meta font-semibold text-granate group-hover:underline sm:pt-0.5">
        {sigue ? "Ver la evidencia completa" : "Ver la evidencia"} <ChevronRight size={14} aria-hidden />
      </span>
    </VerSenal>
  );
}
