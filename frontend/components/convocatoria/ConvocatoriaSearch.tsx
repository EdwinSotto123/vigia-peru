"use client";

/**
 * /app/convocatoria (y /admin/analisis): los análisis publicados y, sólo para el equipo,
 * despachar uno nuevo.
 *
 * Antes cualquier visitante podía disparar una corrida pagada de los agentes:
 * con el botón "Despachar agentes", con "Sortear nueva del SEACE" o con sólo
 * abrir `/app/convocatoria?run=<código>`, que arrancaba el análisis solo. Ahora:
 *  - el `?run=` ya no dispara nada;
 *  - despachar y sortear aparecen sólo con sesión de equipo (`useEsAdmin`), y
 *    las rutas /api/agent/analyze*, /upload-doc y /random exigen la cookie de
 *    admin verificada contra el API (401 si no);
 *  - el público busca en la lista de lo ya analizado (un solo campo, el de la
 *    tabla) y, si el contrato no está, la lista le dice cómo se lee uno.
 *
 * Dato primero (DESIGN_SYSTEM.md §10.7): encabezado con una línea y su ⓘ, y la
 * tabla. Lo que antes eran dos párrafos, un desplegable y una columna lateral con
 * un recuento que repetía los chips quedó en la ⓘ, en "Cómo se lee un contrato"
 * (panel lateral) y en las acciones del encabezado.
 *
 * `enPanel` (sólo /admin/analisis): el modo equipo se pinta desde el primer
 * render, sin esperar a que el ping de sesión responda (el middleware ya exigió
 * la sesión para entrar al panel, y las rutas de análisis la vuelven a
 * verificar), y no lleva el encabezado de página: el panel ya tiene su h1.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, ChevronRight, Info, Search } from "lucide-react";
import { getAnalyzedList } from "@/lib/dossier-cache";
import { getResumenVivo } from "@/lib/contratos";
import { useEsAdmin } from "@/lib/useEsAdmin";
import { Ayuda, EncabezadoPagina } from "@/components/patrones";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { resolveOcid, fetchOcdsFromBrowserDetailed, fetchAllDocsFromOcds } from "@/lib/oece-bridge";
import { STEPS } from "./constants";
import { codigoCorto, oeceProcesoUrl, humanizeError } from "./utils";
import { AgentsPipeline } from "./sections/AgentsPipeline";
import { SortearSeace } from "./sections/SortearSeace";
import { AnalizadasRecientes, ChipNivel, esAnalisisPublicado } from "./sections/AnalizadasRecientes";
import { duracionEnPalabras } from "./sections/conteoRiesgo";
import { LoadingView } from "./sections/LoadingView";

/** El API respondió 401: la sesión de equipo no está o venció. */
class SesionVencida extends Error {}

const MSG_SESION = "Tu sesión de equipo venció o no está activa. Vuelve a entrar desde /admin/login y reintenta.";

/** ¿El análisis coincide con lo que se escribió? (código, OCID, objeto, entidad o RUC). */
const coincide = (it: any, qLower: string) =>
  [it.codigo_convocatoria, it.ocid, it.objeto, it.entidad, it.entidad_ruc, it.proveedor_ruc]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(qLower);

export function ConvocatoriaSearch({ enPanel = false }: { enPanel?: boolean } = {}) {
  const sesionAdmin = useEsAdmin();
  const esAdmin = enPanel || sesionAdmin;
  const [id, setId] = useState("");
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState<any[] | null>(null);
  const [showSugg, setShowSugg] = useState(false);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [mediana, setMediana] = useState<{ seg: number | null; n: number | null }>({ seg: null, n: null });
  const startTime = useRef(0);
  const router = useRouter();

  // Lista de análisis publicados para el autocompletado del equipo (abrir uno ya
  // analizado en vez de volver a pagarlo). getAnalyzedList deduplica con la tabla
  // de abajo → 1 sola request (mismo límite, 500).
  useEffect(() => {
    getAnalyzedList(500)
      .then((d) => setCached(!d?.error && Array.isArray(d?.items) ? d.items.filter(esAnalisisPublicado) : []))
      .catch(() => setCached([]));
  }, []);

  // Duración real de una lectura (mediana medida en producción). Sin dato, no se promete ninguna.
  useEffect(() => {
    let vivo = true;
    getResumenVivo()
      .then((r) => {
        if (vivo && r?.estimado?.medianaSeg) setMediana({ seg: r.estimado.medianaSeg, n: r.estimado.n ?? null });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  // `?run=<código>` ya NO arranca un análisis: cualquiera podía compartir un
  // enlace que disparaba una corrida pagada con sólo abrirlo.
  // `?ocid=<código>` sólo PRELLENA el buscador (lo usa "Procesar ahora" del
  // dossier para mandar al equipo a /admin/analisis): nunca despacha nada solo.
  useEffect(() => {
    try {
      const pre = new URLSearchParams(window.location.search).get("ocid");
      if (pre) setId(pre.trim().slice(0, 120));
    } catch {
      /* sin window.location: nada que prellenar */
    }
  }, []);

  useEffect(() => {
    if (!loading) return;
    const elapsedTimer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 500);
    // Breakpoints = suma acumulada de eta_s de cada STEP: cuando elapsed los
    // pasa, el paso i queda "activo" (el stream real lo corrige si llega antes).
    const breakpoints: number[] = [];
    let acc = 0;
    for (const s of STEPS) {
      acc += s.eta_s;
      breakpoints.push(acc);
    }
    const timers = breakpoints.map((sec, i) => setTimeout(() => setStepIdx(i + 1), sec * 1000));
    return () => {
      clearInterval(elapsedTimer);
      timers.forEach(clearTimeout);
    };
  }, [loading]);

  const loadFromCache = (ocidOrCodigo: string) => {
    // Navegar a /app/convocatoria/{id} para que la URL sea compartible.
    router.push(`/app/convocatoria/${encodeURIComponent(codigoCorto(ocidOrCodigo))}`);
  };

  const matchesDe = (q: string) => {
    const qLower = q.trim().toLowerCase();
    if (!qLower || !cached) return [];
    return cached.filter((it) => coincide(it, qLower));
  };

  /** Equipo: despachar los agentes (corrida pagada). Las rutas exigen la cookie de admin. */
  const despachar = async (e: React.FormEvent | null, overrideCode?: string) => {
    if (e) e.preventDefault();
    if (!esAdmin) return;
    const rawCode = overrideCode != null ? overrideCode : id;
    // Tres formatos: código numérico ("1212841"), OCID completo
    // ("ocds-dgv273-seacev3-1212841") o cualquier código con guiones.
    const trimmed = rawCode.trim();
    const clean = trimmed.toLowerCase().startsWith("ocds-") ? trimmed : trimmed.replace(/[^0-9a-zA-Z-]/g, "");
    if (!clean) return;
    setLoading(true);
    setError(null);
    setStepIdx(0);
    setLiveEvents([]);
    startTime.current = Date.now();
    try {
      // 1) OCDS desde el browser vía el relay. Si OECE bloquea (403), seguimos
      //    con ocds=null: el orquestador lo trae por el downloader local.
      const ocid = resolveOcid(clean);
      const ocdsRes = await fetchOcdsFromBrowserDetailed(ocid);
      const ocds: any = ocdsRes.cr;
      if (!ocds && ocdsRes.reason !== "blocked") {
        const url = oeceProcesoUrl(ocid);
        setError(
          ocdsRes.reason === "not_found"
            ? `La convocatoria ${ocid} no existe o ya no es accesible en el portal del OECE. Verifícala en ${url}`
            : `No se pudo obtener la convocatoria ${ocid} desde el OECE (error de red). Revisa tu conexión y reintenta. Enlace oficial: ${url}`,
        );
        return;
      }

      // 2) Descargar los documentos del expediente desde el browser y subir cada
      //    uno a GCS por separado (cada request < 32 MB).
      const { docs: fetchedDocs } = await fetchAllDocsFromOcds(ocds);
      const doc_urls: Record<string, string> = {};
      const docs_b64: Record<string, string> = {};
      const uploadResults = await Promise.allSettled(
        fetchedDocs.map(async (d) => {
          const r = await fetch("/api/agent/upload-doc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ocid, url: d.url, base64: d.base64, filename: d.filename, contentType: d.contentType }),
          });
          if (r.status === 401) throw new SesionVencida(MSG_SESION);
          const text = await r.text();
          let data: any = null;
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error(`upload ${d.filename}: respuesta no-JSON (${r.status}) ${text.slice(0, 150)}`);
          }
          if (!r.ok || !data?.ok) throw new Error(`upload ${d.filename}: ${data?.error || r.status} ${data?.detail || ""}`);
          return { ...d, gcs_url: data.gcs_url };
        }),
      );
      if (uploadResults.some((res) => res.status === "rejected" && res.reason instanceof SesionVencida)) {
        throw new SesionVencida(MSG_SESION);
      }
      const failed: string[] = [];
      uploadResults.forEach((res, i) => {
        if (res.status === "fulfilled") doc_urls[res.value.url] = res.value.gcs_url;
        else failed.push(`${fetchedDocs[i].filename}: ${(res.reason as Error).message}`);
      });
      console.log(
        `[Vigía] OCID ${ocid}: ${fetchedDocs.length - failed.length}/${fetchedDocs.length} documentos subidos` +
          (failed.length > 0 ? `, ${failed.length} fallos: ${failed.join("; ")}` : ""),
      );

      // 3) Stream NDJSON del orquestador.
      const r = await fetch("/api/agent/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: clean, ocds, docs_b64, doc_urls }),
      });
      if (r.status === 401) throw new SesionVencida(MSG_SESION);
      if (!r.ok || !r.body) {
        const txt = await r.text().catch(() => "");
        throw new Error(txt.slice(0, 300) || `stream_failed (${r.status})`);
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalEvent: any = null;
      let lastErrorEvent: any = null; // para un mejor mensaje si el stream colapsa
      const procesarLinea = (line: string) => {
        try {
          const ev = JSON.parse(line);
          if (ev.kind === "final") finalEvent = ev;
          else {
            if (ev.kind === "error") lastErrorEvent = ev;
            setLiveEvents((prev) => [...prev, ev]);
          }
        } catch {
          /* línea malformada: se ignora */
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buf += decoder.decode();
          const tail = buf.trim();
          if (tail) procesarLinea(tail);
          break;
        }
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) procesarLinea(line);
        }
      }
      if (!finalEvent) {
        throw new Error(
          humanizeError(
            lastErrorEvent
              ? `${lastErrorEvent.error_kind || "runner_exception"}: ${lastErrorEvent.detail || ""}`
              : "stream_interrupted",
          ),
        );
      }
      // El backend emite `runner_error` en el evento final cuando el runner
      // explotó pero se pudo persistir un análisis parcial: se muestra.
      if (finalEvent.runner_error) {
        const re = finalEvent.runner_error;
        throw new Error(humanizeError(`${re.kind || "runner_exception"}: ${re.msg || ""}`, re.class));
      }

      // 4) Análisis persistido: navegar al dossier compartible.
      router.push(`/app/convocatoria/${encodeURIComponent(codigoCorto(clean))}`);
    } catch (err) {
      if (err instanceof SesionVencida) {
        setError(err.message);
      } else {
        const msg = (err as Error).message || "";
        // Si ya pasó por humanizeError no se re-formatea.
        const yaHumano = /^(No se pudo procesar|El análisis|El OCID|El servicio)/.test(msg);
        setError(yaHumano ? msg : humanizeError(msg));
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingView stepIdx={stepIdx} elapsed={elapsed} codigo={id} liveEvents={liveEvents} />;

  const sugerencias = esAdmin && showSugg ? matchesDe(id).slice(0, 6) : [];
  const duracion = duracionEnPalabras(mediana.seg);

  return (
    <div className="space-y-6">
      {!enPanel && (
        <EncabezadoPagina
          titulo="Análisis publicados"
          bajada="Contratos que Vigía ya leyó, con su peso de riesgo, sus señales y el dictamen."
          ayuda={
            <Ayuda titulo="¿Cómo llega un contrato aquí?">
              Vigía no analiza contratos a pedido: los lee en orden de cola, zona por zona, cuando alguien financia la
              lectura de esa zona. {TOTAL_AGENTES} agentes revisan cada expediente
              {duracion ? ` y una lectura tarda ${duracion}${mediana.n ? ` (mediana de ${mediana.n} lecturas recientes)` : ""}` : ""}.
            </Ayuda>
          }
          acciones={
            <>
              <AgentsPipeline medianaSeg={mediana.seg} nLecturas={mediana.n} />
              <EnlaceAccion href="/app/auditoria" variante="secundario">
                Ver la cola en vivo
              </EnlaceAccion>
              <EnlaceAccion href="/app/financiar" flecha>
                Financiar la lectura de tu zona
              </EnlaceAccion>
            </>
          }
        />
      )}

      {/* ─── EQUIPO: despachar un análisis (corrida pagada) ─── */}
      {esAdmin && (
        <section aria-labelledby="despacho-titulo" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="flex items-center gap-1.5">
              <h2 id="despacho-titulo" className="font-display text-[20px] font-bold leading-tight text-ink">
                Analiza un contrato del SEACE
              </h2>
              <Ayuda titulo="¿Qué hace despachar?">
                Pega el código de la convocatoria o su OCID: los {TOTAL_AGENTES} agentes leen el expediente y el dossier
                queda público al terminar. Si ya está analizado, elígelo en la lista que aparece al escribir y se abre sin
                volver a procesarlo.
              </Ayuda>
            </div>
            {/* En el panel, el aviso de costo ya está arriba de la página. */}
            {!enPanel && (
              <span className="pill border-amber/40 bg-amber-soft text-amberTexto">
                <Info size={12} aria-hidden /> Modo equipo: despachar inicia un análisis pagado
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-start gap-3">
            <form onSubmit={(e) => despachar(e)} className="relative min-w-0 flex-1 basis-[420px]" role="search">
              <label htmlFor="despachar-convocatoria" className="sr-only">
                Código u OCID de la convocatoria
              </label>
              <Search size={17} aria-hidden className="absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
              <input
                id="despachar-convocatoria"
                type="text"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setShowSugg(true);
                }}
                onFocus={() => setShowSugg(true)}
                onBlur={() => setTimeout(() => setShowSugg(false), 180)}
                placeholder="Código de convocatoria u OCID"
                autoComplete="off"
                inputMode="search"
                className="h-12 w-full rounded-xl border border-line bg-paperSoft pl-11 pr-44 font-mono text-[15px] placeholder:font-sans placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
              />
              <button
                type="submit"
                disabled={!id.trim()}
                className="absolute right-1.5 top-1/2 inline-flex min-h-[40px] -translate-y-1/2 items-center gap-2 rounded-full bg-granate px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-granate-deep disabled:opacity-50"
              >
                Despachar agentes <ArrowRight size={15} aria-hidden />
              </button>

              {/* Autocompletado con los análisis ya publicados: abrir en vez de volver a pagar. */}
              {sugerencias.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-line bg-paper shadow-dialog">
                  <p className="border-b border-line bg-paperSoft px-4 py-2 text-[12px] font-semibold text-inkSoft">
                    {sugerencias.length === 1
                      ? "1 ya analizado: ábrelo sin volver a procesarlo"
                      : `${sugerencias.length} ya analizados: ábrelos sin volver a procesarlos`}
                  </p>
                  <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                    {sugerencias.map((it: any) => (
                      <li key={it.codigo_convocatoria || it.ocid}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            loadFromCache(it.codigo_convocatoria || it.ocid);
                          }}
                          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-paperDeep"
                        >
                          <ChipNivel it={it} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium text-ink">{it.objeto}</span>
                            <span className="block truncate text-[12px] text-mute">
                              <span className="font-mono">{it.codigo_convocatoria}</span> {it.entidad || "Entidad sin dato"}
                            </span>
                          </span>
                          <ChevronRight size={13} aria-hidden className="text-mute" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </form>

            <SortearSeace
              onRunNew={(codigo) => {
                setId(codigo);
                despachar(null, codigo);
              }}
            />
          </div>

          {error && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-crimson/25 bg-crimson-soft/60 p-3 text-[13px] text-crimsonTexto">
              <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </section>
      )}

      {/* ANÁLISIS PUBLICADOS: la tabla, con el único campo de búsqueda de la página. */}
      <AnalizadasRecientes onSelect={loadFromCache} conTitulo={enPanel} />
    </div>
  );
}
