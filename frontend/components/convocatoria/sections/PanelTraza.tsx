"use client";

/**
 * Pestaña "Cómo se hizo": aquí sí va el vocabulario técnico (agentes, trazas, evaluadores).
 * Cargada con `next/dynamic` al abrirla (PanelesDossier), junto con el grafo del recorrido.
 *
 * El informe público llega SIN la traza (`traza_perezosa`, lib/dossier-servidor.ts): se pide
 * recién acá, una vez por sesión (`getTraza`, lib/dossier-cache.ts). El panel admin y la API
 * vieja la traen entera en el informe: entonces se usa la que vino y no se pide nada.
 */

import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { setRedactNames } from "../../Redact";
import { Skeleton } from "@/components/ui/Skeleton";
import { getTraza, peekTraza, type DatosTraza } from "@/lib/dossier-cache";
import { resumenTrazaValido } from "../dossier";
import type { ApiResult } from "../types";
import { TrazaAnalisis } from "../traza/TrazaAnalisis";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { SeccionSegura } from "./SeccionSegura";

export function PanelTraza({ result, nombresPrivados, ocidContrato }: PanelDossierProps) {
  setRedactNames(nombresPrivados);
  const enMano = (result.agent_trace?.length ?? 0) > 0;
  const codigo: string | null = typeof result.compliance?.alerta_codigo === "string" ? result.compliance.alerta_codigo : null;
  const idDossier = String(result.convocatoria?.codigo || ocidContrato || result.ocid || codigo || "");
  const resumen = resumenTrazaValido(result.traza_resumen);
  // Se pide sólo si el servidor la dejó afuera y no sabemos que esté vacía.
  const hayQuePedir = !enMano && result.traza_perezosa === true && (resumen == null || resumen.eventos > 0);

  const [datos, setDatos] = useState<DatosTraza | null>(() => (hayQuePedir ? peekTraza(codigo, idDossier) : null));
  const [fallo, setFallo] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!hayQuePedir || datos) return;
    let vivo = true;
    setFallo(null);
    getTraza(codigo, idDossier)
      .then((d) => {
        if (vivo) setDatos(d);
      })
      .catch((e) => {
        if (vivo) setFallo((e as Error)?.message || "Error");
      });
    return () => {
      vivo = false;
    };
    // `datos` no va: sólo decide si hace falta pedir la primera vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayQuePedir, codigo, idDossier, intento]);

  // El informe con su traza: lo que TrazaAnalisis siempre recibió.
  const completo = useMemo<ApiResult | null>(
    () => (datos ? { ...result, agent_trace: datos.agent_trace, llm_metrics: datos.llm_metrics, self_evals: datos.self_evals } : null),
    [result, datos],
  );

  const sinTraza = (
    <AvisoSeccion titulo="Este análisis no guardó su traza paso a paso">
      Fue procesado antes de que la traza se guardara con el dossier. Las señales y el dictamen sí quedaron.
    </AvisoSeccion>
  );

  if (enMano) {
    return (
      <SeccionSegura nombre="la traza del análisis">
        <TrazaAnalisis result={result} />
      </SeccionSegura>
    );
  }
  if (!hayQuePedir) return sinTraza;
  if (fallo && !datos) {
    return (
      <AvisoSeccion titulo="No pudimos traer el registro de este análisis">
        <span className="block">La conexión falló antes de terminar. Las señales y el dictamen de arriba no cambian.</span>
        <button
          type="button"
          onClick={() => setIntento((n) => n + 1)}
          className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-paperDeep"
        >
          <RotateCcw size={14} aria-hidden /> Reintentar
        </button>
      </AvisoSeccion>
    );
  }
  if (!completo) {
    return (
      <div role="status" aria-busy className="space-y-3">
        <span className="sr-only">Cargando cómo se hizo el análisis…</span>
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if ((completo.agent_trace?.length ?? 0) === 0) return sinTraza;
  return (
    <SeccionSegura nombre="la traza del análisis">
      <TrazaAnalisis result={completo} />
    </SeccionSegura>
  );
}
