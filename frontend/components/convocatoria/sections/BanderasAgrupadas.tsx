"use client";

/**
 * Las señales del análisis a demanda, mostradas como lo que son: el resultado de una auditoría
 * de agentes. Este archivo ya no dibuja nada por su cuenta — traduce la `Bandera` del payload
 * del buscador a la señal normalizada y delega en <AuditoriaDeAgentes>, que es la misma pieza
 * que usa el dossier. Antes había dos lecturas distintas del mismo hecho en dos páginas que el
 * usuario visita seguidas.
 *
 * La tabla (kit de listados), los carriles de agentes y la matriz de reglas los arma
 * AuditoriaDeAgentes; aquí se agregan, aparte y fuera de los conteos, las señales de precio
 * que el mercado no pudo sostener.
 */

import { useMemo } from "react";
import { CircleSlash, Info } from "lucide-react";
import { reglaLabel } from "@/lib/auditoria";
import { redactDnis, type NombreConocido } from "../../Redact";
import { evidenciaComoTexto } from "./Evidencia";
import type { FasesMap } from "@/lib/auditoria";
import { AuditoriaDeAgentes } from "@/components/agentes/AuditoriaDeAgentes";
import type { SenalAgente } from "@/components/agentes/senales";
import type { Bandera } from "../types";
import { TITULO_TEMA, temaDeRegla } from "../relato/historia";
import type { ContextoSenal } from "../senal/directorio";
import { senalDeBandera } from "../senal/normalizar";
import { SobreQuien } from "../senal/SobreQuien";

/** El tema de una regla (la competencia, el precio, el proveedor…), para filtrar la tabla y decirlo en cada fila. */
const temaDe = (regla: string) => {
  const clave = temaDeRegla(regla);
  return { clave, titulo: TITULO_TEMA[clave] };
};

export function BanderasAgrupadas({
  banderas,
  reglas_evaluadas,
  perfil,
  reglasDisparadas,
  fases,
  noVerificables = [],
  contexto = [],
  nombresPrivados,
  ctxSenales,
}: {
  banderas: Bandera[];
  /** Solo si el análisis lo trae: no se supone un número. */
  reglas_evaluadas?: number | null;
  /** Perfil del pipeline (bienes · servicios · obras · otros): destraba el catálogo de reglas. */
  perfil?: string | null;
  reglasDisparadas?: string[] | null;
  /** Ventanas reales por agente, si el análisis las trae: habilita el eje de tiempo. */
  fases?: FasesMap | null;
  /**
   * Señales de sobreprecio de un dossier donde el agente de precios no pudo medir el
   * sobreprecio (`sobreprecio_pct` null): se muestran aparte, marcadas como no
   * verificables, y no cuentan en los totales.
   */
  noVerificables?: Bandera[];
  /** Hechos de contexto (`puntua: false`): se muestran debajo, aparte y fuera de los conteos. */
  contexto?: Bandera[];
  /** Personas privadas del dossier: su apellido va tapado también en la línea de cada señal. */
  nombresPrivados?: NombreConocido[];
  /** De quién habla cada señal (el ganador, la entidad y las empresas del dictamen): va en el panel de cada una. */
  ctxSenales?: ContextoSenal | null;
}) {
  const senales = useMemo(() => (banderas ?? []).map(senalDeBandera), [banderas]);
  const contextoDeSenal = useMemo(
    () =>
      ctxSenales
        ? (s: SenalAgente) => <SobreQuien regla={s.regla} evidencias={[s.evidencia]} ctx={ctxSenales} otrasEmpresas={s.otrasEmpresas ?? []} />
        : undefined,
    [ctxSenales],
  );
  const apartadas = (noVerificables.length > 0 || contexto.length > 0) && (
    <>
      {contexto.length > 0 && <HechosDeContexto banderas={contexto} />}
      {noVerificables.length > 0 && <NoVerificables banderas={noVerificables} />}
    </>
  );
  // Sin `nota` al pie: "una señal no es una acusación" lo dice una sola vez el informe, al final.
  if (senales.length === 0) return apartadas || null;
  return (
    <AuditoriaDeAgentes
      senales={senales}
      fases={fases}
      perfil={perfil}
      reglasDisparadas={reglasDisparadas}
      reglasEvaluadas={reglas_evaluadas ?? undefined}
      nombresPrivados={nombresPrivados}
      anexo={apartadas}
      temaDe={temaDe}
      contextoDeSenal={contextoDeSenal}
    />
  );
}

/** Hechos que el análisis registra pero que no suman al puntaje: a la vista, con su evidencia, fuera de los conteos. */
function HechosDeContexto({ banderas }: { banderas: Bandera[] }) {
  return (
    <details className="rounded-2xl border border-line bg-paperSoft px-4 py-3 text-meta">
      <summary className="flex min-h-[24px] cursor-pointer items-center gap-2 text-ink">
        <Info size={15} className="shrink-0 text-mute" aria-hidden />
        <strong className="font-semibold">
          {banderas.length} {banderas.length === 1 ? "hecho de contexto" : "hechos de contexto"}
        </strong>
        <span className="text-rotulo text-mute">no suman al puntaje</span>
      </summary>
      <p className="mt-2 text-rotulo leading-snug text-mute">
        Datos ciertos que ayudan a leer el caso pero que, solos, no indican un riesgo: por eso no cuentan como señal.
      </p>
      <ul className="mt-3 space-y-2 border-t border-line pt-3">
        {banderas.map((b, i) => (
          <li key={`${b.regla}-${i}`} className="text-rotulo leading-relaxed text-inkSoft">
            <span className="font-semibold text-ink">{reglaLabel(String(b.regla || "contexto"))}</span>
            {evidenciaComoTexto(b.evidencia) && <span className="mt-0.5 block">{redactDnis(evidenciaComoTexto(b.evidencia))}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Las señales de sobreprecio que el mercado no sostiene: a la vista, plegadas y fuera de los conteos. */
function NoVerificables({ banderas }: { banderas: Bandera[] }) {
  return (
    <details className="rounded-2xl border border-line bg-paperSoft px-4 py-3 text-meta">
      <summary className="flex min-h-[24px] cursor-pointer items-center gap-2 text-ink">
        <CircleSlash size={15} className="shrink-0 text-mute" aria-hidden />
        <strong className="font-semibold">
          {banderas.length} {banderas.length === 1 ? "señal de precio no verificable" : "señales de precio no verificables"}
        </strong>
        <span className="text-rotulo text-mute">fuera de los conteos</span>
      </summary>
      <p className="mt-2 text-rotulo leading-snug text-mute">
        El agente de precios no pudo medir el sobreprecio con fuentes suficientes: estas señales no se cuentan ni se usan en
        el resumen, y se dejan a la vista para revisarlas.
      </p>
      <ul className="mt-3 space-y-2 border-t border-line pt-3">
        {banderas.map((b, i) => (
          <li key={`${b.regla}-${i}`} className="text-rotulo leading-relaxed text-inkSoft">
            <span className="font-semibold text-ink">{reglaLabel(String(b.regla || "sobreprecio"))}</span>
            <span className="ml-1.5 rounded-full border border-line bg-paper px-1.5 py-0 text-micro text-inkSoft">no verificable</span>
            {evidenciaComoTexto(b.evidencia) && <span className="mt-0.5 block">{redactDnis(evidenciaComoTexto(b.evidencia))}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
