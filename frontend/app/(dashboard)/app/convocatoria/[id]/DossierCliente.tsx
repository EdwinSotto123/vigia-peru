"use client";

/**
 * Los estados de la página del informe cuando el servidor no lo pudo armar (page.tsx):
 *
 *   - no encontrado: el contrato no tiene un análisis publicado (o es una alerta de demo). Se
 *     muestra de una vez, con la salida a sus datos, a financiar y (sólo el equipo) a procesarlo;
 *   - error: la API no respondió al servidor. Se reintenta una vez desde el navegador (por la
 *     ruta /api/agent/history, con su propio reintento) y, si tampoco, se dice qué pasó y se
 *     deja reintentar a mano.
 *
 * Son los patrones con la llamita (DESIGN_SYSTEM.md §10.5). Dentro del informe no hay llamita:
 * es evidencia.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { ResultadoView } from "@/components/convocatoria/ResultadoView";
import type { ApiResult } from "@/components/convocatoria/types";
import { Cargando, EstadoError, EstadoVacio, Pagina, Volver } from "@/components/patrones";
import { DossierError, getDossier, peekDossier } from "@/lib/dossier-cache";
import { useEsAdmin } from "@/lib/useEsAdmin";

type Fallo = { tipo: "not_found" | "error"; mensaje: string };

const BOTON_PRIMARIO =
  "inline-flex min-h-[40px] items-center gap-2 rounded-full bg-granate px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-granate-deep";
const BOTON_SECUNDARIO =
  "inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-paperDeep";

export function DossierCliente({
  id,
  inicial,
  mensaje,
  tabInicial,
}: {
  /** El id tal como vino en la URL (con su prefijo OECE- si lo traía). */
  id: string;
  /** Lo que dijo el servidor: `demo` y `not_found` se muestran tal cual; `error` se reintenta acá. */
  inicial: "not_found" | "demo" | "error";
  mensaje?: string;
  tabInicial: string | null;
}) {
  const esAdmin = useEsAdmin();
  const [result, setResult] = useState<ApiResult | null>(null);
  const [fallo, setFallo] = useState<Fallo | null>(
    inicial === "error" ? null : { tipo: "not_found", mensaje: inicial === "demo" ? "demo" : "not_found" },
  );
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    // Sólo el error del servidor se reintenta: un "no encontrado" ya lo confirmó la API.
    if (inicial !== "error" || !id) return;
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
        setFallo({ tipo, mensaje: (e as Error)?.message || mensaje || "Error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, inicial, mensaje, intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  if (fallo) {
    const noExiste = fallo.tipo === "not_found";
    const esDemo = fallo.mensaje === "demo";
    // No encontrado / error: estados de sistema, los únicos que van centrados (§10.7).
    return (
      <Pagina>
        <div className="mx-auto max-w-2xl">
          <Volver href="/app/convocatoria" className="mb-4">
            Análisis publicados
          </Volver>
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
      <ResultadoView result={result} tabInicial={tabInicial} />
    </Pagina>
  );
}
