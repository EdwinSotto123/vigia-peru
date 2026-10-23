"use client";

/**
 * "Así se verá publicado": el informe real de la alerta, pintado con el mismo <ResultadoView> de la
 * página pública /app/convocatoria/[id], a partir de GET /admin/revision/:id/informe (el dossier
 * entero aunque la alerta no esté publicada) y la misma adaptación (lib/dossier-adaptar).
 */

import { rutaContrato } from "@/lib/rutas";
import { useState } from "react";
import { AlertTriangle, ChevronDown, ExternalLink, Eye, RotateCcw } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ApiResult } from "@/components/convocatoria/types";
import { NivelTituloDossier } from "@/components/convocatoria/sections/nivelTitulo";
import { EsqueletoInforme } from "./Esqueleto";
import { claseBoton } from "@/components/admin/ui/boton";

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
  const ruta = ocid ? rutaContrato(ocid, "dictamen") : null;
  // El informe es largo (varios miles de píxeles): queda plegado con su resumen de una línea, y recién
  // al abrirlo se monta (así tampoco se baja su JavaScript si no se mira).
  const [abierto, setAbierto] = useState(false);
  return (
    <details
      aria-labelledby="vista-publicada"
      onToggle={(e) => setAbierto(e.currentTarget.open)}
      className="group overflow-hidden rounded-2xl border border-line bg-paperSoft"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 hover:bg-paperDeep/50 sm:px-5 [&::-webkit-details-marker]:hidden">
        <Eye size={15} className="shrink-0 text-mute" aria-hidden />
        <span className="min-w-0 flex-1">
          <span id="vista-publicada" className="block text-dato leading-5 font-semibold text-ink">Así se verá publicado</span>
          <span className="block text-rotulo text-inkSoft">
            El informe completo, como en la página pública del contrato.{publicada ? " Ya es público." : " Por ahora sólo lo ve el equipo."}
          </span>
        </span>
        {ruta && publicada && (
          <Link href={ruta} target="_blank" onClick={(e) => e.stopPropagation()} className="hidden shrink-0 items-center gap-1 text-rotulo font-medium text-ink hover:underline sm:inline-flex">
            <ExternalLink size={12} aria-hidden /> Abrir la página pública
          </Link>
        )}
        <span className="shrink-0 text-rotulo text-mute group-open:hidden">Abrir</span>
        <ChevronDown size={16} className="shrink-0 text-mute transition-transform group-open:rotate-180" aria-hidden />
      </summary>

      <div className="border-t border-line">
        {ruta && (
          <div className="flex min-w-0 items-center gap-2 border-b border-line bg-paperSoft px-3 py-1.5 text-micro text-mute sm:px-4">
            <span className="shrink-0 font-semibold uppercase tracking-wide">Vista previa</span>
            <span className="min-w-0 truncate font-mono">{ruta}</span>
          </div>
        )}

        <div className="px-3 py-4 sm:px-6 sm:py-5">
          {!abierto ? null : error ? (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-crimson/30 bg-crimson-soft p-4 text-dato leading-5 text-crimsonTexto sm:flex-row sm:items-center">
              <AlertTriangle size={18} className="shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">No se pudo cargar el informe: {error}. La decisión y el juicio del evaluador siguen disponibles más abajo.</p>
              <button type="button" onClick={onReintentar} className={claseBoton("peligro", "sm")}>
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
    </details>
  );
}
