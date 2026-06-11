/**
 * /app/convocatoria/[id]
 *
 * Vista shareable del análisis Vigía Perú. Carga el resultado cacheado desde
 * Cloud SQL vía /api/agent/history/[id] y renderiza el ResultadoView completo.
 * Soporta código corto (1203694), OCID completo (ocds-...-1203694) o codigo
 * de alerta (OECE-1203694).
 */

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { ResultadoView } from "@/components/ConvocatoriaSearch";
import { getDossier, peekDossier } from "@/lib/dossier-cache";

export default function ConvocatoriaSharePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = decodeURIComponent(params.id || "");

  // Arranca en null para que el HTML del server y el del cliente coincidan
  // (peekDossier lee sessionStorage, que no existe en el server → evitamos
  // hydration mismatch). El useEffect hace el peek apenas monta en el cliente:
  // si está en cache, render casi inmediato sin fetch ni re-parsear 473 KB.
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const cached = peekDossier(id);
    if (cached) { setResult(cached); setError(null); return; }

    setError(null);
    setResult(null);
    let cancelled = false;
    getDossier(id)
      .then((data) => { if (!cancelled) setResult(data); })
      .catch((e) => { if (!cancelled) setError((e as Error)?.message || "Error"); });
    return () => { cancelled = true; };
  }, [id]);

  if (error) {
    return (
      <div className="px-6 py-12 lg:px-10">
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => router.push("/app/convocatoria")}
            className="mb-4 inline-flex items-center gap-2 text-sm text-mute hover:text-ink"
          >
            <ArrowLeft size={16} /> Volver al buscador
          </button>
          <div className="surface p-8 text-center">
            <AlertTriangle size={32} className="mx-auto text-amber" />
            <h1 className="mt-3 font-serif text-xl font-bold text-ink">
              Esta convocatoria no se ha analizado todavía
            </h1>
            <p className="mt-2 text-sm text-mute">
              No hay análisis cacheado para <code className="font-mono text-ink">{id}</code>. Despacha los agentes para procesarla.
            </p>
            <button
              onClick={() => router.push(`/app/convocatoria?run=${encodeURIComponent(id)}`)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-rust px-4 py-2 text-sm font-bold text-paper hover:bg-rust/90"
            >
              Procesar {id} ahora
            </button>
            <button
              onClick={() => router.push("/app/convocatoria")}
              className="ml-2 mt-4 inline-flex items-center gap-2 rounded-lg border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink hover:bg-paperDeep"
            >
              Volver al buscador
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="px-6 py-20 lg:px-10">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <Loader2 size={32} className="animate-spin text-clay" />
          <p className="mt-3 font-mono text-sm text-mute">
            Cargando análisis de <span className="text-ink">{id}</span> desde Cloud SQL…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 lg:px-10">
      <ResultadoView result={result} onReset={() => router.push("/app/convocatoria")} />
    </div>
  );
}
