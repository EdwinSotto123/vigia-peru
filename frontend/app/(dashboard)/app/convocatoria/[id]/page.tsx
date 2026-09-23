/**
 * /app/convocatoria/[id]
 *
 * Vista compartible del análisis. Carga el resultado guardado vía
 * /api/agent/history/[id] y renderiza el ResultadoView completo. Soporta código
 * corto (1203694), OCID completo (ocds-...-1203694) o código de alerta
 * (OECE-1203694). El <title> lo pone layout.tsx (servidor).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertTriangle, RotateCcw, FileSearch } from "lucide-react";
import { ResultadoView } from "@/components/convocatoria/ResultadoView";
import { DossierError, getDossier, peekDossier } from "@/lib/dossier-cache";
import { esAlertaDemo } from "@/lib/semillas";
import { useEsAdmin } from "@/lib/useEsAdmin";

type Fallo = { tipo: "not_found" | "error"; mensaje: string };

export default function ConvocatoriaSharePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = decodeURIComponent(params.id || "");
  const esAdmin = useEsAdmin();

  // Arranca en null para que el HTML del servidor y el del cliente coincidan; el
  // efecto mira el cache en memoria apenas monta.
  const [result, setResult] = useState<any | null>(null);
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!id) return;
    // Las alertas de demo sembradas en la base (ALT-2026-00xx) no son un dossier.
    if (esAlertaDemo({ codigo: id })) {
      setFallo({ tipo: "not_found", mensaje: "demo" });
      return;
    }
    const cached = peekDossier(id);
    if (cached) {
      setResult(cached);
      setFallo(null);
      return;
    }
    setFallo(null);
    setResult(null);
    let cancelled = false;
    getDossier(id)
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((e) => {
        if (cancelled) return;
        const tipo = e instanceof DossierError ? e.tipo : "error";
        setFallo({ tipo, mensaje: (e as Error)?.message || "Error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  if (fallo) {
    const noExiste = fallo.tipo === "not_found";
    return (
      <div className="px-4 py-12 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            onClick={() => router.push("/app/convocatoria")}
            className="mb-4 inline-flex items-center gap-2 text-sm text-mute hover:text-ink"
          >
            <ArrowLeft size={16} aria-hidden /> Volver al buscador
          </button>
          <div className="surface p-6 text-center sm:p-8">
            {noExiste ? (
              <FileSearch size={32} className="mx-auto text-mute" aria-hidden />
            ) : (
              <AlertTriangle size={32} className="mx-auto text-amberTexto" aria-hidden />
            )}
            <h1 className="mt-3 font-serif text-xl font-bold text-ink">
              {noExiste ? "Este contrato todavía no tiene un análisis publicado" : "No pudimos cargar este análisis"}
            </h1>
            {noExiste ? (
              <div className="mx-auto mt-2 max-w-prose space-y-2 text-sm text-inkSoft">
                <p>
                  No hay un dossier para <code className="font-mono text-ink">{id}</code>. Vigía lee los contratos en el orden de la
                  cola, a medida que alguien financia su lectura.
                </p>
                <p>Puedes ver los datos públicos del contrato mientras tanto, o financiar la lectura de los contratos de tu zona.</p>
              </div>
            ) : (
              <p className="mx-auto mt-2 max-w-prose text-sm text-inkSoft">
                La conexión con el servidor falló antes de traer el análisis de <code className="font-mono text-ink">{id}</code>. Suele ser
                momentáneo: vuelve a intentarlo en unos segundos.
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {!noExiste && (
                <button
                  type="button"
                  onClick={reintentar}
                  className="inline-flex items-center gap-2 rounded-lg bg-heroViolet px-4 py-2 text-sm font-bold text-paper hover:bg-heroViolet/90"
                >
                  <RotateCcw size={14} aria-hidden /> Reintentar
                </button>
              )}
              {noExiste && fallo.mensaje !== "demo" && (
                <Link
                  href={`/app/contratos/${encodeURIComponent(id.replace(/^OECE-/i, ""))}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink hover:bg-paperDeep"
                >
                  Ver los datos del contrato
                </Link>
              )}
              {noExiste && (
                <Link
                  href="/app/financiar"
                  className="inline-flex items-center gap-2 rounded-lg bg-heroViolet px-4 py-2 text-sm font-bold text-paper hover:bg-heroViolet/90"
                >
                  Financiar una auditoría
                </Link>
              )}
              {/* Procesar a demanda cuesta dinero: solo lo ve el equipo (cookie de admin). */}
              {noExiste && esAdmin && fallo.mensaje !== "demo" && (
                <Link
                  href={`/admin/analisis?ocid=${encodeURIComponent(id)}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-heroViolet/40 bg-heroViolet-soft px-4 py-2 text-sm font-semibold text-heroViolet hover:bg-heroViolet/15"
                >
                  Procesar {id} ahora (equipo)
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="px-4 py-20 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-md flex-col items-center text-center" role="status" aria-live="polite">
          <Loader2 size={32} className="animate-spin text-heroViolet motion-reduce:animate-none" aria-hidden />
          <p className="mt-3 text-sm text-mute">
            Cargando el análisis de <span className="font-mono text-ink">{id}</span>…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <ResultadoView result={result} onReset={() => router.push("/app/convocatoria")} />
    </div>
  );
}
