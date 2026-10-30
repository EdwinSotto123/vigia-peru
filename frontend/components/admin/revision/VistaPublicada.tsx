"use client";

/**
 * Pestaña «Así se verá publicado»: el informe real de la alerta, pintado con el mismo <ResultadoView> de la página
 * pública /app/convocatoria/[id], a partir de GET /admin/revision/:id/informe (el dossier entero aunque la alerta no
 * esté publicada) y la misma adaptación (lib/dossier-adaptar). Arriba, una línea: si ya es público, su dirección y el
 * enlace. El informe va suelto, sin otra caja alrededor: trae las suyas.
 */

import { rutaContrato } from "@/lib/rutas";
import { ExternalLink, RotateCcw } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ApiResult } from "@/components/convocatoria/types";
import { NivelTituloDossier } from "@/components/convocatoria/sections/nivelTitulo";
import { EsqueletoInforme } from "./Esqueleto";
import { Aviso, Badge, claseBoton } from "@/components/admin/ui";

// El informe público pesa ~120 KB de JS y va en su propio pedazo: se baja recién al abrir esta pestaña (sólo se
// pinta la pestaña activa), así no retrasa la decisión ni «Por qué se bloqueó», que es lo primero que se lee.
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
  return (
    <div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge tono={publicada ? "ok" : "neutral"}>{publicada ? "Ya es público" : "Por ahora sólo lo ve el equipo"}</Badge>
        {ruta && <span className="min-w-0 flex-1 truncate font-mono text-micro text-mute" title={ruta}>{ruta}</span>}
        {ruta && publicada && (
          <Link href={ruta} target="_blank" className={claseBoton("secundario", "xs")}>
            <ExternalLink size={11} aria-hidden /> Abrir la página pública
          </Link>
        )}
      </div>

      <div className="mt-3">
        {error ? (
          <Aviso
            tono="danger"
            titulo="No se pudo cargar el informe"
            acciones={
              <button type="button" onClick={onReintentar} className={claseBoton("secundario", "sm")}>
                <RotateCcw size={12} aria-hidden /> Reintentar
              </button>
            }
          >
            {error.charAt(0).toUpperCase() + error.slice(1)}. El juicio del evaluador sigue en «Por qué se bloqueó».
          </Aviso>
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
  );
}
