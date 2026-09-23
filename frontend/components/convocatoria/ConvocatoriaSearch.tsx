"use client";

/**
 * /app/convocatoria (y /admin/analisis): buscar un análisis publicado o, sólo
 * para el equipo, despachar uno nuevo.
 *
 * Antes cualquier visitante podía disparar una corrida pagada de los agentes:
 * con el botón "Despachar agentes", con "Sortear nueva del SEACE" o con sólo
 * abrir `/app/convocatoria?run=<código>`, que arrancaba el análisis solo. Ahora:
 *  - el `?run=` ya no dispara nada;
 *  - despachar y sortear aparecen sólo con sesión de equipo (`useEsAdmin`), y
 *    las rutas /api/agent/analyze*, /upload-doc y /random exigen la cookie de
 *    admin verificada contra el API (401 si no);
 *  - el público busca entre lo ya analizado y, si el contrato no está, se le
 *    explica que Vigía lee los contratos en orden de cola cuando alguien
 *    financia la auditoría de su zona.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, ChevronRight, Info, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAnalyzedList } from "@/lib/dossier-cache";
import { getResumenVivo } from "@/lib/contratos";
import { useEsAdmin } from "@/lib/useEsAdmin";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { resolveOcid, fetchOcdsFromBrowserDetailed, fetchAllDocsFromOcds } from "@/lib/oece-bridge";
import { STEPS } from "./constants";
import { oeceProcesoUrl, humanizeError } from "./utils";
import { AgentsPipeline } from "./sections/AgentsPipeline";
import { QuickAccessPanel } from "./sections/QuickAccessPanel";
import { AnalizadasRecientes, esAnalisisPublicado } from "./sections/AnalizadasRecientes";
import { FRANJA_NIVEL, NIVEL_ANALISIS, nivelDeAnalisis } from "./sections/conteoRiesgo";
import { LoadingView } from "./sections/LoadingView";

/** El API respondió 401: la sesión de equipo no está o venció. */
class SesionVencida extends Error {}

const MSG_SESION = "Tu sesión de equipo venció o no está activa. Vuelve a entrar desde /admin/login y reintenta.";

/** "ocds-dgv273-seacev3-1212841" / "OECE-1212841" / " 1212841 " → "1212841". */
const codigoCorto = (raw: string) =>
  raw.trim().replace(/^ocds-[a-z0-9]+-seacev3-/i, "").replace(/^OECE-/i, "");

/** ¿El análisis coincide con lo que se escribió? (código, OCID, objeto, entidad o RUC). */
const coincide = (it: any, qLower: string) =>
  [it.codigo_convocatoria, it.ocid, it.objeto, it.entidad, it.entidad_ruc, it.proveedor_ruc]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(qLower);

type Aviso = { tipo: "sin_analisis"; codigo: string } | { tipo: "varias"; n: number };

export function ConvocatoriaSearch() {
  const esAdmin = useEsAdmin();
  const [id, setId] = useState("");
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [cached, setCached] = useState<any[] | null>(null);
  const [listaOk, setListaOk] = useState(false);
  const [showSugg, setShowSugg] = useState(false);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [mediana, setMediana] = useState<{ seg: number | null; n: number | null }>({ seg: null, n: null });
  const startTime = useRef(0);
  const router = useRouter();

  // Lista de análisis publicados para el autocompletado y la búsqueda del público.
  // getAnalyzedList deduplica con la lista de abajo → 1 sola request (mismo límite, 500).
  useEffect(() => {
    getAnalyzedList(500)
      .then((d) => {
        if (d?.error || !Array.isArray(d?.items)) {
          setCached([]);
          return;
        }
        setCached(d.items.filter(esAnalisisPublicado));
        setListaOk(true);
      })
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

  /** Público: abrir un análisis ya publicado. Nunca dispara agentes. */
  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    const q = id.trim();
    if (!q) return;
    setAviso(null);
    const codigo = codigoCorto(q);
    // Sin la lista (no cargó), no podemos saber si existe: que decida el dossier.
    if (!listaOk || !cached) {
      loadFromCache(codigo);
      return;
    }
    const cLower = codigo.toLowerCase();
    const exacta = cached.find((it) =>
      [it.codigo_convocatoria, it.ocid].some((v) => v && String(v).toLowerCase() === cLower),
    );
    if (exacta) {
      loadFromCache(exacta.codigo_convocatoria || exacta.ocid);
      return;
    }
    const parciales = matchesDe(q);
    if (parciales.length === 1) {
      loadFromCache(parciales[0].codigo_convocatoria || parciales[0].ocid);
      return;
    }
    if (parciales.length > 1) {
      setShowSugg(true);
      setAviso({ tipo: "varias", n: parciales.length });
      return;
    }
    setAviso({ tipo: "sin_analisis", codigo });
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
    setAviso(null);
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

  const sugerencias = showSugg ? matchesDe(id).slice(0, 6) : [];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),360px]">
        {/* ─── COLUMNA IZQUIERDA: BUSCADOR ─── */}
        <div className="surface relative isolate p-5 sm:p-6">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 overflow-hidden rounded-[inherit] opacity-[0.04]"
            style={{
              backgroundImage: `radial-gradient(circle, #1B1611 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }}
          />

          {esAdmin ? (
            <>
              <h1 className="font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">
                Analiza un contrato del SEACE
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-mute sm:text-sm">
                Pega el código de la convocatoria o su OCID. Los {TOTAL_AGENTES} agentes leen el expediente y el
                dossier queda público al terminar. Si el contrato ya está analizado, elígelo en la lista que
                aparece al escribir y se abre sin volver a procesarlo.
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-soft px-2 py-1 text-[11px] font-medium text-amberTexto">
                <Info size={12} aria-hidden /> Modo equipo: despachar inicia un análisis pagado.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">
                Busca un contrato analizado
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-mute sm:text-sm">
                Escribe el código de la convocatoria del SEACE, su OCID o el RUC de la entidad o del proveedor.
                Si Vigía ya lo leyó, abres su dossier con las señales, la evidencia y el dictamen.
              </p>
            </>
          )}

          <form onSubmit={esAdmin ? (e) => despachar(e) : buscar} className="mt-4" role="search">
            <div className="relative">
              <label htmlFor="buscar-convocatoria" className="sr-only">
                {esAdmin ? "Código u OCID de la convocatoria" : "Código, OCID o RUC"}
              </label>
              <Search size={18} aria-hidden className="absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
              <input
                id="buscar-convocatoria"
                type="text"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setShowSugg(true);
                  setAviso(null);
                }}
                onFocus={() => setShowSugg(true)}
                onBlur={() => setTimeout(() => setShowSugg(false), 180)}
                placeholder={esAdmin ? "Código de convocatoria u OCID" : "Código de convocatoria, OCID o RUC"}
                autoComplete="off"
                className="w-full rounded-2xl border border-line bg-paper py-4 pl-12 pr-36 text-base font-mono placeholder:text-mute focus:border-heroViolet focus:outline-none focus:ring-2 focus:ring-heroViolet/20 sm:pr-44"
              />
              <button
                type="submit"
                disabled={!id.trim()}
                className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink/90 disabled:opacity-50 sm:px-5"
              >
                {esAdmin ? "Despachar agentes" : "Buscar"} <ArrowRight size={15} aria-hidden />
              </button>

              {/* Autocompletado con los análisis ya publicados */}
              {sugerencias.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-line bg-paper shadow-xl">
                  <div className="border-b border-line bg-paperSoft px-4 py-2 text-[11px] font-semibold text-inkSoft">
                    {sugerencias.length === 1
                      ? "1 contrato ya analizado: elígelo para abrir su dossier"
                      : `${sugerencias.length} contratos ya analizados: elige uno para abrir su dossier`}
                  </div>
                  <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                    {sugerencias.map((it: any) => {
                      const nivel = nivelDeAnalisis(it);
                      return (
                        <li key={it.codigo_convocatoria || it.ocid}>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              loadFromCache(it.codigo_convocatoria || it.ocid);
                            }}
                            className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paperDeep"
                          >
                            <div
                              className={cn(
                                "flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-md",
                                FRANJA_NIVEL[nivel ?? "sin"],
                              )}
                              title={nivel ? NIVEL_ANALISIS[nivel].etiqueta : undefined}
                            >
                              <span className="font-mono text-[11px] font-bold leading-none">{it.score ?? "—"}</span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-1.5">
                                <span className="rounded bg-paperDeep px-1 py-0 font-mono text-[10px] font-bold text-ink">
                                  {it.codigo_convocatoria}
                                </span>
                                {it.region && (
                                  <span className="rounded-full bg-paperSoft px-1.5 py-0 text-[10px] font-medium text-heroViolet">
                                    {it.region}
                                  </span>
                                )}
                                {(it.n_alta || 0) > 0 && (
                                  <span className="rounded-full bg-crimson-soft px-1.5 py-0 text-[10px] font-bold text-crimsonTexto">
                                    {it.n_alta} {it.n_alta === 1 ? "señal alta" : "señales altas"}
                                  </span>
                                )}
                                {(it.n_banderas || 0) === 0 && (
                                  <span className="rounded-full bg-paperDeep px-1.5 py-0 text-[10px] font-semibold text-mute">
                                    sin señales
                                  </span>
                                )}
                              </div>
                              <div className="line-clamp-1 text-xs font-medium text-ink">{it.objeto}</div>
                              <div className="line-clamp-1 text-[11px] text-mute">{it.entidad || "—"}</div>
                            </div>
                            <ChevronRight size={12} aria-hidden className="mt-2 shrink-0 text-mute" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            {error && (
              <div role="alert" className="mt-3 rounded-xl border border-rust/30 bg-crimson-soft p-3 text-xs text-crimsonTexto">
                <AlertTriangle size={12} aria-hidden className="mr-1 inline" />
                {error}
              </div>
            )}

            {aviso?.tipo === "varias" && (
              <p role="status" className="mt-3 text-xs text-mute">
                Hay {aviso.n} análisis que coinciden. Elige uno de la lista o escribe el código completo.
              </p>
            )}

            {aviso?.tipo === "sin_analisis" && (
              <div role="status" className="mt-3 rounded-xl border border-line bg-paperSoft p-4 text-sm">
                <p className="font-semibold text-ink">
                  Vigía todavía no publicó un análisis de <span className="font-mono">{aviso.codigo}</span>.
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-inkSoft">
                  No analizamos contratos a pedido: los leemos en orden de cola, zona por zona, cuando alguien
                  financia la auditoría de esa zona.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/app/contratos?q=${encodeURIComponent(aviso.codigo)}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-paperDeep"
                  >
                    Buscarlo entre los contratos del SEACE
                  </Link>
                  <Link
                    href="/app/financiar"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-ink/90"
                  >
                    Financiar la auditoría de su zona <ArrowRight size={12} aria-hidden />
                  </Link>
                </div>
              </div>
            )}
          </form>

          {/* Cómo se lee un contrato: compacto y colapsable */}
          <div className="mt-4">
            <AgentsPipeline medianaSeg={mediana.seg} nLecturas={mediana.n} />
          </div>
        </div>

        {/* ─── COLUMNA DERECHA: cómo llega un contrato (público) o acción de equipo ─── */}
        <QuickAccessPanel
          cached={cached}
          esAdmin={esAdmin}
          medianaSeg={mediana.seg}
          nLecturas={mediana.n}
          onRunNew={
            esAdmin
              ? (codigo) => {
                  setId(codigo);
                  despachar(null, codigo);
                }
              : undefined
          }
        />
      </div>

      {/* ANÁLISIS PUBLICADOS */}
      <AnalizadasRecientes onSelect={loadFromCache} />
    </div>
  );
}
