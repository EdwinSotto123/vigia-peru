"use client";

/**
 * "Así se verá publicado": el informe real de la alerta, pintado con el mismo <ResultadoView> de la
 * página pública /app/convocatoria/[id], a partir de GET /admin/revision/:id/informe (el dossier
 * entero aunque la alerta no esté publicada) y la misma adaptación (lib/dossier-adaptar).
 */

import { AlertTriangle, ExternalLink, Eye, RotateCcw } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ApiResult } from "@/components/convocatoria/types";
import { NivelTituloDossier } from "@/components/convocatoria/sections/nivelTitulo";
import { EsqueletoInforme } from "./Esqueleto";

// El informe público pesa ~120 KB de JS y va en su propio pedazo, así no retrasa la barra de
// decisión, que es lo primero que se lee. Por sí solo recién se pediría al montarse con los datos
// ya llegados; la página de revisión lo empieza a bajar al abrirse (import() en un efecto), así
// se descarga a la par de los datos y no después.
const ResultadoView = dynamic(() => import("@/components/convocatoria/ResultadoView").then((m) => m.ResultadoView), {
  ssr: false,
  loading: () => <EsqueletoInforme />,
});

export function VistaPublicada({
  ui,
  publicada,
  ocid,
  error,
  onReintentar,
}: {
  /** El dossier ya adaptado; null mientras carga. */
  ui: ApiResult | null;
  publicada: boolean;
  /** Código corto de la convocatoria: es la dirección pública del informe. */
  ocid: string | null;
  error: string | null;
  onReintentar: () => void;
}) {
  const ruta = ocid ? `/app/convocatoria/${encodeURIComponent(ocid)}` : null;
  return (
    <section aria-labelledby="vista-publicada">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id="vista-publicada" className="text-[11px] font-semibold uppercase tracking-wide text-inkSoft">Así se verá publicado</h2>
          <p className="text-[12px] text-inkSoft">
            El informe completo, tal como aparece en la página pública del contrato.
            {publicada ? " Ya es público." : " Por ahora sólo lo ve el equipo."}
          </p>
        </div>
        {ruta && publicada && (
          <Link href={ruta} target="_blank" className="inline-flex items-center gap-1 text-[12px] font-medium text-ink hover:underline">
            <ExternalLink size={12} aria-hidden /> Abrir la página pública
          </Link>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-paper shadow-card">
        <div className="flex min-w-0 items-center gap-2 border-b border-line bg-paperSoft px-3 py-2 text-[11px] text-mute sm:px-4">
          <Eye size={13} className="shrink-0" aria-hidden />
          <span className="shrink-0 font-semibold uppercase tracking-wide">Vista previa</span>
          {ruta && <span className="min-w-0 truncate font-mono">{ruta}</span>}
        </div>

        <div className="px-3 py-4 sm:px-6 sm:py-6">
          {error ? (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-crimson/30 bg-crimson-soft p-4 text-sm text-crimsonTexto sm:flex-row sm:items-center">
              <AlertTriangle size={18} className="shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">No se pudo cargar el informe: {error}. La decisión y el juicio del evaluador siguen disponibles más abajo.</p>
              <button type="button" onClick={onReintentar} className="inline-flex items-center gap-1.5 rounded-lg border border-crimson/30 bg-paper px-3 py-1.5 text-xs font-semibold text-crimsonTexto hover:bg-paperSoft">
                <RotateCcw size={12} aria-hidden /> Reintentar
              </button>
            </div>
          ) : ui ? (
            // La página del panel ya tiene su <h1>: el título del dossier baja a <h2> acá adentro.
            <NivelTituloDossier.Provider value="h2">
              <ResultadoView result={ui} vistaPrevia />
            </NivelTituloDossier.Provider>
          ) : (
            <EsqueletoInforme />
          )}
        </div>
      </div>
    </section>
  );
}
