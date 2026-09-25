/**
 * /app/convocatoria/[id]
 *
 * Vista compartible del análisis. Carga el resultado guardado vía
 * /api/agent/history/[id] y renderiza el ResultadoView completo. Soporta código
 * corto (1203694), OCID completo (ocds-...-1203694) o código de alerta
 * (OECE-1203694). El <title> lo pone layout.tsx (servidor).
 *
 * Los estados de la PÁGINA (cargando, no encontrado, error) son los patrones con la
 * llamita (DESIGN_SYSTEM.md §10.5). Dentro del informe no hay llamita: es evidencia.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { ResultadoView } from "@/components/convocatoria/ResultadoView";
import { Cargando, EstadoError, EstadoVacio, Pagina } from "@/components/patrones";
import { DossierError, getDossier, peekDossier } from "@/lib/dossier-cache";
import { esAlertaDemo } from "@/lib/semillas";
import { useEsAdmin } from "@/lib/useEsAdmin";

type Fallo = { tipo: "not_found" | "error"; mensaje: string };

const BOTON_PRIMARIO =
  "inline-flex min-h-[40px] items-center gap-2 rounded-full bg-granate px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-granate-deep";
const BOTON_SECUNDARIO =
  "inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-paperDeep";

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
    const esDemo = fallo.mensaje === "demo";
    // No encontrado / error: estados de sistema, los únicos que van centrados (§10.7).
    return (
      <Pagina>
        <div className="mx-auto max-w-2xl">
          <Link href="/app/convocatoria" className="mb-4 inline-flex min-h-[32px] items-center gap-1.5 text-sm text-mute hover:text-ink">
            <ArrowLeft size={16} aria-hidden /> Volver a los análisis publicados
          </Link>
          {noExiste ? (
            <>
              {/* Página sin informe: el título es el h1 de la página. */}
              <h1 className="sr-only">Contrato {id} sin análisis publicado</h1>
              <EstadoVacio
                titulo="Este contrato todavía no tiene un análisis publicado"
                accion={
                  <div className="flex flex-wrap justify-center gap-2">
                    {!esDemo && (
                      <Link href={`/app/contratos/${encodeURIComponent(id.replace(/^OECE-/i, ""))}`} className={BOTON_SECUNDARIO}>
                        Ver los datos del contrato
                      </Link>
                    )}
                    <Link href="/app/financiar" className={BOTON_PRIMARIO}>
                      Financiar la lectura de tu zona
                    </Link>
                    {/* Procesar a demanda cuesta dinero: solo lo ve el equipo (cookie de admin). */}
                    {esAdmin && !esDemo && (
                      <Link
                        href={`/admin/analisis?ocid=${encodeURIComponent(id)}`}
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-granate/30 bg-granate-soft px-4 py-2 text-sm font-semibold text-granate hover:bg-granate/15"
                      >
                        Procesar {id} ahora (equipo)
                      </Link>
                    )}
                  </div>
                }
              >
                {/* Las dos salidas ya las dicen los botones: aquí sólo el porqué. */}
                <p>
                  No hay un análisis publicado para <code className="font-mono text-ink">{id}</code>. Vigía lee los contratos en
                  el orden de la cola, a medida que alguien financia su lectura.
                </p>
              </EstadoVacio>
            </>
          ) : (
            <>
              <h1 className="sr-only">No pudimos cargar el análisis de {id}</h1>
              <EstadoError
                titulo="No pudimos cargar este análisis"
                detalle={fallo.mensaje}
                accion={
                  <button type="button" onClick={reintentar} className={BOTON_PRIMARIO}>
                    <RotateCcw size={14} aria-hidden /> Reintentar
                  </button>
                }
              >
                La conexión con el servidor falló antes de traer el análisis de <code className="font-mono text-ink">{id}</code>. Suele
                ser momentáneo: vuelve a intentarlo en unos segundos.
              </EstadoError>
            </>
          )}
        </div>
      </Pagina>
    );
  }

  if (!result) {
    return (
      <Pagina>
        <Cargando texto={`Cargando el análisis de ${id}…`} lineas={5} />
      </Pagina>
    );
  }

  return (
    <Pagina>
      <ResultadoView result={result} onReset={() => router.push("/app/convocatoria")} />
    </Pagina>
  );
}
