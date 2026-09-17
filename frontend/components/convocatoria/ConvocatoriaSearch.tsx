"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAnalyzedList } from "@/lib/dossier-cache";
import {
  Search,
  Loader2,
  ArrowRight,
  Sparkles,
  ScanSearch,
  Network,
  Globe2,
  FileText,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Coins,
  Download,
  Cloud,
  ExternalLink,
  Users,
  Package,
  Award,
  ChevronRight,
  Scale,
  RotateCcw,
  MapPin,
  Calendar,
  ShieldAlert,
  Eye,
  Newspaper,
  ListChecks,
  Pen,
  Globe,
  Brain,
  Shuffle,
  Hammer,
  HardHat,
  Boxes,
  Compass,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  resolveOcid,
  fetchOcdsFromBrowser,
  fetchOcdsFromBrowserDetailed,
  fetchAllDocsFromOcds,
} from "@/lib/oece-bridge";
import type { AgentTraceEvent, ApiResult, SortKey, SevFilter, CatFilter, GNode, TraceStep, Bandera, GraphNode, GraphEdge } from "./types";
import { CAT_LABEL, CAT_TONE, NODE_META, PHASE_HEX, AGENT_IDS, G_COLOR, G_DONE, G_FLOW, TYPE_LABEL, TRACE_ROLE, VERB_HEX, AGENT_VISUAL, TOOL_INFO, VEREDICTO_VISUAL, AGENTE_VISUAL, FUENTE_GROUPS, STEPS } from "./constants";
import { oeceProcesoUrl, countFindings, humanizeError, inferCategoria, extractFindings, traceNodeForAgent, rucArg, buildTrace, inferAgente, wrapText, inferStepFromEvents } from "./utils";
import { AgentsPipeline } from "./sections/AgentsPipeline";
import { QuickAccessPanel } from "./sections/QuickAccessPanel";
import { AgentTraceRow } from "./sections/AgentTraceRow";
import { AnalizadasRecientes } from "./sections/AnalizadasRecientes";
import { LoadingView } from "./sections/LoadingView";
import { ShareableHeader } from "./sections/ShareableHeader";
import { ResumenHumano } from "./sections/ResumenHumano";
import { ResultadoView } from "./ResultadoView";

const SAMPLES = [
  { id: "1203694", label: "Mun. Callao · herramientas S/. 93K" },
  { id: "1202858", label: "Chira Piura · maquinaria S/. 7.1M" },
];

export function ConvocatoriaSearch() {
  const [id, setId] = useState("");
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState<any[] | null>(null);
  const [showSugg, setShowSugg] = useState(false);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  // Fallback manual: cuando el proxy OECE bloquea, pedir al usuario que pegue
  // el JSON del OCDS. Guarda el ocid pendiente + el textarea content.
  const [blockedOcid, setBlockedOcid] = useState<string | null>(null);
  const [manualOcdsText, setManualOcdsText] = useState("");
  const [manualOcdsError, setManualOcdsError] = useState<string | null>(null);
  const startTime = useRef(0);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Prefetch del cache para alimentar el autocomplete del input principal.
  // getAnalyzedList deduplica con la lista "Análisis previos" → 1 sola request.
  // Mismo límite (500) que la lista: el dedup es por vuelo en curso, NO por límite,
  // así que ambos callers deben pedir lo mismo o el primero define cuántos llegan.
  useEffect(() => {
    getAnalyzedList(500)
      .then(d => setCached(d?.items || []))
      .catch(() => setCached([]));
  }, []);

  // Si la URL tiene ?run=<codigo>, autopopulá el input y disparalo automático.
  // Usamos un ref con el código ya disparado (no boolean) para permitir
  // que `?run=A` → falla → `?run=B` dispare correctamente.
  const lastRunRef = useRef<string | null>(null);
  useEffect(() => {
    const runCode = searchParams?.get("run");
    if (runCode && lastRunRef.current !== runCode && !loading && !result) {
      lastRunRef.current = runCode;
      setId(runCode);
      submit(null, runCode);
    }
  }, [searchParams, loading, result]);

  useEffect(() => {
    if (!loading) return;
    const elapsedTimer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 500);
    // Breakpoints calculados como suma acumulada de eta_s de cada STEP.
    // Cuando elapsed >= breakpoint[i], el step i pasa a "active".
    const breakpoints: number[] = [];
    let acc = 0;
    for (const s of STEPS) {
      acc += s.eta_s;
      breakpoints.push(acc);
    }
    const timers = breakpoints.map((sec, i) =>
      setTimeout(() => setStepIdx(i + 1), sec * 1000),
    );
    return () => {
      clearInterval(elapsedTimer);
      timers.forEach(clearTimeout);
    };
  }, [loading]);

  const submit = async (e: React.FormEvent | null, overrideCode?: string, overrideOcds?: any) => {
    if (e) e.preventDefault();
    const rawCode = overrideCode != null ? overrideCode : id;
    // Permitir tres formatos: código numérico ("1212841"), OCID completo
    // ("ocds-dgv273-seacev3-1212841"), o cualquier substring con guiones.
    // Si trae prefijo "ocds-" lo conservamos tal cual; si no, removemos chars
    // no alfanuméricos pero MANTENEMOS letras (alguna nomenclatura nueva del
    // OECE puede tenerlas).
    const trimmed = rawCode.trim();
    const clean = trimmed.toLowerCase().startsWith("ocds-")
      ? trimmed
      : trimmed.replace(/[^0-9a-zA-Z-]/g, "");
    if (!clean) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setBlockedOcid(null);
    setManualOcdsError(null);
    setStepIdx(0);
    setLiveEvents([]);
    startTime.current = Date.now();
    try {
      // 1) Fetch OCDS desde el browser vía Cloudflare Worker.
      //    Si nos pasaron un OCDS manual (override), saltamos el proxy.
      const ocid = resolveOcid(clean);
      let ocds: any = overrideOcds || null;
      if (!ocds) {
        const ocdsRes = await fetchOcdsFromBrowserDetailed(ocid);
        ocds = ocdsRes.cr;
        if (!ocds && ocdsRes.reason === "blocked") {
          // OECE bloquea el relay (403). NO pedimos pegar JSON: el orquestador
          // trae el OCDS + los documentos por el downloader local (IP peruana).
          // Seguimos con ocds=null → el backend hace el fetch.
          console.log(`[Vigía] relay bloqueado para ${ocid} — el backend lo traerá por el downloader local`);
        } else if (!ocds) {
          // Convocatoria inexistente (404) vs error de red.
          const url = oeceProcesoUrl(ocid);
          const msg =
            ocdsRes.reason === "not_found"
              ? `La convocatoria ${ocid} no existe o ya no es accesible en el portal OECE (404). ` +
                `Verifica manualmente en ${url}`
              : `No se pudo obtener la convocatoria ${ocid} desde OECE ` +
                `(error de red al llamar al proxy). Verifica tu conexión y reintenta. URL oficial: ${url}`;
          setError(msg);
          // Si veníamos del autoSubmit (?run=), limpiar el query param para no loop.
          if (searchParams?.get("run")) {
            router.replace("/app/convocatoria");
          }
          return;
        }
      }

      // 2) Descargar PDFs del tender desde el browser.
      const { docs: fetchedDocs } = await fetchAllDocsFromOcds(ocds);

      // 2b) Subir CADA PDF a GCS individualmente (request <32MB cada uno).
      //     Esto procesa TODOS los PDFs — ninguno se omite.
      const docs_meta: Array<{ url: string; filename: string; contentType: string; size_bytes: number }> = [];
      const doc_urls: Record<string, string> = {};   // originalUrl → gcs_url
      const docs_b64: Record<string, string> = {};   // se queda vacío: usamos doc_urls

      const uploadResults = await Promise.allSettled(
        fetchedDocs.map(async (d) => {
          const r = await fetch("/api/agent/upload-doc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ocid,
              url: d.url,
              base64: d.base64,
              filename: d.filename,
              contentType: d.contentType,
            }),
          });
          const text = await r.text();
          let data: any = null;
          try { data = JSON.parse(text); } catch {
            throw new Error(`upload ${d.filename}: respuesta no-JSON (${r.status}) ${text.slice(0, 150)}`);
          }
          if (!r.ok || !data?.ok) {
            throw new Error(`upload ${d.filename}: ${data?.error || r.status} ${data?.detail || ""}`);
          }
          return { ...d, gcs_url: data.gcs_url };
        })
      );

      let nUploaded = 0;
      const failed: string[] = [];
      uploadResults.forEach((res, i) => {
        const d = fetchedDocs[i];
        if (res.status === "fulfilled") {
          doc_urls[res.value.url] = res.value.gcs_url;
          docs_meta.push({
            url: d.url, filename: d.filename, contentType: d.contentType, size_bytes: d.size_bytes,
          });
          nUploaded++;
        } else {
          failed.push(`${d.filename}: ${(res.reason as Error).message}`);
        }
      });

      const totalSize = fetchedDocs.reduce((s, d) => s + d.size_bytes, 0);
      console.log(
        `[Vigía] OCID ${ocid} · ${nUploaded}/${fetchedDocs.length} PDFs subidos a GCS · ` +
        `${(totalSize/1e6).toFixed(2)}MB total` +
        (failed.length > 0 ? ` · ${failed.length} fallos: ${failed.join("; ")}` : "")
      );

      const useStream = true;

      if (useStream) {
        // ── STREAMING PATH ─────────────────────────────────────────
        const r = await fetch("/api/agent/analyze/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: clean, ocds, docs_b64, docs_meta, doc_urls }),
        });
        if (!r.ok || !r.body) {
          const txt = await r.text().catch(() => "");
          throw new Error(txt.slice(0, 300) || `stream_failed (${r.status})`);
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalEvent: any = null;
        let lastErrorEvent: any = null; // tracked para mostrar mejor mensaje si stream colapsa
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            buf += decoder.decode();
            const tail = buf.trim();
            if (tail) {
              try {
                const ev = JSON.parse(tail);
                if (ev.kind === "final") finalEvent = ev;
                else {
                  if (ev.kind === "error") lastErrorEvent = ev;
                  setLiveEvents(prev => [...prev, ev]);
                }
              } catch { /* línea final malformada — ignoramos */ }
            }
            break;
          }
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const ev = JSON.parse(line);
              if (ev.kind === "final") {
                finalEvent = ev;
              } else {
                if (ev.kind === "error") lastErrorEvent = ev;
                setLiveEvents(prev => [...prev, ev]);
              }
            } catch {/* línea malformada — ignoramos */}
          }
        }
        if (!finalEvent) {
          throw new Error(humanizeError(
            lastErrorEvent ? `${lastErrorEvent.error_kind || "runner_exception"}: ${lastErrorEvent.detail || ""}` : "stream_interrupted"
          ));
        }
        // El backend ahora emite `runner_error` en el evento final cuando el
        // runner explotó pero la safety_net pudo persistir un análisis parcial.
        // Si hay error, mostrarlo al usuario en lugar de seguir como si nada.
        if (finalEvent.runner_error) {
          const re = finalEvent.runner_error;
          throw new Error(humanizeError(
            `${re.kind || "runner_exception"}: ${re.msg || ""}`,
            re.class,
          ));
        }

        // 4) Análisis persistido en Cloud SQL — navegar a la URL shareable.
        const codigoCorto = clean.replace(/^ocds-[a-z0-9]+-seacev3-/i, "");
        router.push(`/app/convocatoria/${encodeURIComponent(codigoCorto)}`);
        return;
      } else {
        // ── FALLBACK NON-STREAMING ─────────────────────────────────
        const r = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: clean, ocds, docs_b64, docs_meta }),
        });
        // Defensive parsing: si el server devuelve HTML (502/timeout) el json() rompe
        const text = await r.text();
        let data: any = null;
        try { data = JSON.parse(text); } catch {
          setError(humanizeError(`timeout: el servidor devolvió ${r.status} sin JSON`));
          return;
        }
        if (!r.ok) {
          const raw = data?.hint ? `${data.error}: ${data.hint}` : data?.error || `Error ${r.status}`;
          setError(humanizeError(raw));
        } else {
          // Navegar a la URL shareable
          const codigoCorto = clean.replace(/^ocds-[a-z0-9]+-seacev3-/i, "");
          router.push(`/app/convocatoria/${encodeURIComponent(codigoCorto)}`);
          return;
        }
      }
    } catch (err) {
      const msg = (err as Error).message || "";
      // Si ya pasó por humanizeError (mensaje empieza con "No se pudo procesar"
      // o "El análisis..."), no re-formatear. Si es un error crudo, humanizar.
      const alreadyHumanized = /^(No se pudo procesar|El análisis|El OCID|El servicio)/.test(msg);
      setError(alreadyHumanized ? msg : humanizeError(msg));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setStepIdx(-1);
    setElapsed(0);
    setId("");
  };

  const loadFromCache = (ocidOrCodigo: string) => {
    // Navegar a /app/convocatoria/{id} para que la URL sea shareable.
    const codigoCorto = ocidOrCodigo.replace(/^ocds-[a-z0-9]+-seacev3-/i, "").replace(/^OECE-/, "");
    router.push(`/app/convocatoria/${encodeURIComponent(codigoCorto)}`);
  };

  if (result) return <ResultadoView result={result} onReset={reset} />;
  if (loading) return <LoadingView stepIdx={stepIdx} elapsed={elapsed} codigo={id} liveEvents={liveEvents} />;

  return (
    <div className="space-y-8">
      {/* HERO — split 2 columnas: buscador izquierda · quick access derecha */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),360px]">
        {/* ─── COLUMNA IZQUIERDA · BUSCADOR ─── */}
        <div className="surface relative isolate overflow-hidden p-5 sm:p-6">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 opacity-[0.04]"
            style={{
              backgroundImage: `radial-gradient(circle, #1B1611 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }}
          />
          <div
            aria-hidden
            className="absolute -right-20 -top-20 -z-10 h-60 w-60 rounded-full bg-amber/10 blur-3xl"
          />

          <span className="inline-flex items-center gap-1.5 rounded-full border border-rust/30 bg-crimson-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rust">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-rust opacity-75" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-rust" />
            </span>
            Núcleo · análisis a demanda
          </span>
          <h1 className="mt-2 font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">
            Analiza cualquier contrato del Estado
          </h1>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-mute sm:text-sm">
            Pega el código (o OCID/RUC) de cualquier convocatoria del SEACE y los
            11 agentes la procesan a demanda — o abre uno de los análisis ya hechos.
          </p>

        <form onSubmit={submit} className="mt-4">
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
            <input
              type="text"
              value={id}
              onChange={(e) => { setId(e.target.value); setShowSugg(true); }}
              onFocus={() => setShowSugg(true)}
              onBlur={() => setTimeout(() => setShowSugg(false), 180)}
              placeholder="Código de convocatoria, OCID o RUC"
              autoFocus
              className="w-full rounded-2xl border border-line bg-paper py-4 pl-12 pr-44 text-base font-mono placeholder:text-mute focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
            />
            <button
              type="submit"
              disabled={!id.trim()}
              className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-coal disabled:opacity-50"
            >
              Despachar agentes <ArrowRight size={15} />
            </button>

            {/* Autocomplete dropdown con matches del cache */}
            {showSugg && id.trim() && cached && cached.length > 0 && (() => {
              const qLower = id.trim().toLowerCase();
              const matches = cached.filter((it: any) => {
                const hay = [it.codigo_convocatoria, it.ocid, it.objeto, it.entidad, it.entidad_ruc, it.proveedor_ruc]
                  .filter(Boolean).join(" ").toLowerCase();
                return hay.includes(qLower);
              }).slice(0, 6);
              if (matches.length === 0) return null;
              return (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-line bg-paper shadow-xl">
                  <div className="flex items-center justify-between border-b border-line bg-paperSoft px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-clay">
                    <span>{matches.length} ya analizada{matches.length === 1 ? "" : "s"} · click para ver sin re-procesar</span>
                    <span className="rounded-full bg-moss/15 px-2 py-0 font-mono normal-case text-moss">Cloud SQL</span>
                  </div>
                  <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                    {matches.map((it: any, i: number) => (
                      <li key={i}>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); loadFromCache(it.codigo_convocatoria || it.ocid); }}
                          className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paperDeep"
                        >
                          <div className={cn(
                            "flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-md text-paper",
                            (it.score || 0) >= 85 ? "bg-rust" :
                            (it.score || 0) >= 70 ? "bg-clay" :
                            (it.score || 0) >= 40 ? "bg-amber" : "bg-moss",
                          )}>
                            <span className="font-mono text-[11px] font-bold leading-none">{it.score || 0}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-1.5">
                              <span className="rounded bg-paperDeep px-1 py-0 font-mono text-[10px] font-bold text-ink">
                                {it.codigo_convocatoria}
                              </span>
                              {it.region && (
                                <span className="rounded-full bg-paperSoft px-1.5 py-0 text-[9px] font-medium text-clay">{it.region}</span>
                              )}
                              {(it.n_alta || 0) > 0 && (
                                <span className="rounded-full bg-rust px-1.5 py-0 text-[9px] font-bold text-paper">{it.n_alta} alta</span>
                              )}
                              {(it.n_banderas || 0) === 0 && (
                                <span className="rounded-full bg-moss/20 px-1.5 py-0 text-[9px] font-bold text-moss">✓ sin banderas</span>
                              )}
                            </div>
                            <div className="line-clamp-1 text-xs font-medium text-ink">{it.objeto}</div>
                            <div className="line-clamp-1 text-[10px] text-mute">{it.entidad || "—"}</div>
                          </div>
                          <ChevronRight size={12} className="mt-2 shrink-0 text-mute" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {SAMPLES.slice(0, 3).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setId(s.id)}
                className="rounded-md border border-line bg-paper px-2 py-0.5 text-[10px] font-mono text-mute transition-colors hover:bg-paperDeep hover:text-ink"
                title={s.label}
              >
                {s.id}
              </button>
            ))}
          </div>
          {error && (
            <div className="mt-3 rounded-xl border border-rust/30 bg-crimson-soft p-3 text-xs text-rust">
              <AlertTriangle size={12} className="mr-1 inline" />
              {error}
            </div>
          )}

          {/* Fallback manual: pegar OCDS cuando el proxy está bloqueado */}
          {blockedOcid && (
            <div className="mt-3 rounded-xl border-2 border-amber bg-amber/10 p-4 text-sm">
              <div className="mb-2 flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-clay" />
                <div>
                  <div className="font-semibold text-ink">
                    El proxy OECE está bloqueado para tu ruta — pegá el OCDS manualmente
                  </div>
                  <div className="mt-1 text-[12px] text-mute">
                    1. Abre esta URL en otra pestaña:{" "}
                    <a
                      href={`https://contratacionesabiertas.oece.gob.pe/api/v1/record/${blockedOcid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-rust underline"
                    >
                      contratacionesabiertas.oece.gob.pe/api/v1/record/{blockedOcid}
                    </a>
                    <br />
                    2. Copia TODO el JSON que aparece (Ctrl+A → Ctrl+C)
                    <br />
                    3. Pegalo aquí abajo y dale &quot;Procesar con OCDS pegado&quot;
                  </div>
                </div>
              </div>
              <textarea
                value={manualOcdsText}
                onChange={(e) => {
                  setManualOcdsText(e.target.value);
                  setManualOcdsError(null);
                }}
                placeholder='Pega aquí el JSON completo que devuelve la URL (debe empezar con {"version":"1.1",...})'
                className="mt-2 w-full rounded-md border border-line bg-paper p-2 font-mono text-[11px]"
                rows={6}
              />
              {manualOcdsError && (
                <div className="mt-1.5 text-[11px] text-rust">{manualOcdsError}</div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setManualOcdsError(null);
                    try {
                      const parsed = JSON.parse(manualOcdsText);
                      const cr =
                        parsed?.records?.[0]?.compiledRelease ??
                        parsed?.compiledRelease ??
                        (parsed?.ocid && parsed?.tender ? parsed : null);
                      if (!cr) {
                        setManualOcdsError(
                          "JSON pegado no parece un OCDS válido. Esperaba un objeto con 'records[0].compiledRelease' o 'compiledRelease'.",
                        );
                        return;
                      }
                      // Preferir el OCID que viene del JSON pegado — es la fuente
                      // más confiable, no depende del input del usuario ni del
                      // sanitizer. Si el JSON no trae ocid, caemos al input.
                      const ocidFromJson = cr?.ocid as string | undefined;
                      const pendingOcid = ocidFromJson || blockedOcid || id;
                      setBlockedOcid(null);
                      setManualOcdsText("");
                      submit(null, pendingOcid, cr);
                    } catch (err: any) {
                      setManualOcdsError(`JSON inválido: ${err?.message || String(err)}`);
                    }
                  }}
                  disabled={!manualOcdsText.trim()}
                  className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-paper hover:bg-coal disabled:opacity-40"
                >
                  Procesar con OCDS pegado →
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBlockedOcid(null);
                    setManualOcdsText("");
                    setManualOcdsError(null);
                  }}
                  className="rounded-full border border-line bg-paper px-3 py-1.5 text-[11px] text-mute hover:text-ink"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </form>

        {/* PIPELINE compacto dentro del hero — colapsable */}
        <div className="mt-4">
          <AgentsPipeline />
        </div>
        </div>

        {/* ─── COLUMNA DERECHA · QUICK ACCESS DEL CACHE ─── */}
        <QuickAccessPanel
          cached={cached}
          onSelect={loadFromCache}
          onRunNew={(codigo) => {
            setId(codigo);
            submit(null, codigo);
          }}
        />
      </div>

      {/* ANALIZADAS RECIENTEMENTE */}
      <AnalizadasRecientes onSelect={loadFromCache} />
    </div>
  );
}


// Heurística por keywords sobre el `objeto` para clasificar la convocatoria
// (el OECE no expone `mainProcurementCategory` estándar en este dataset).


// ─── LOADING ───────────────────────────────────────────────────



// ── Grafo agéntico en CANVAS ──────────────────────────────────────────────
// Nodos por tipo + aristas curvas + PARTÍCULAS que fluyen. El nodo activo
// (paso real en vivo) se enciende con halo pulsante; al terminar queda VERDE.
// Las fuentes se "encienden" cuando el agente activo las consulta. Clickeable:
// muestra qué hace cada nodo. Abajo, panel de HALLAZGOS reales del stream.

// Extrae entidades reales (empresa, RUC, estado, socios, señales) del stream.

// Grafo force-directed. Sin posiciones fijas: la física las acomoda.
// `name` = nombre completo (panel de descubrimiento); `label`/`sub` = dentro del nodo.

// Tracking RICO en vivo: mismos pasos detallados (TOOL_CALL/TOOL_RESULT con
// args + JSON de salida expandible) que el resultado final, pero durante el
// proceso. Reusa AgentTraceRow sobre el stream liveEvents y auto-scrollea.


// ─── RESULTADO ───────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════
// ShareableHeader — header con código + monto + botones compartir/volver
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// ResumenHumano — overview ejecutivo con score, monto, ganador y top flags
// ════════════════════════════════════════════════════════════════════


