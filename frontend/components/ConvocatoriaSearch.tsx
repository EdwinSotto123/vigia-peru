"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getAnalyzedList } from "@/lib/dossier-cache";
import { Glass, Dni, PersonName, redactDnis, redactChildren, maskDnis, maskApellido, setRedactNames } from "./Redact";
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
import type { AgentTraceEvent, ApiResult, SortKey, SevFilter, CatFilter, GNode, TraceStep, Bandera, GraphNode, GraphEdge } from "./convocatoria/types";
import { CAT_LABEL, CAT_TONE, NODE_META, PHASE_HEX, AGENT_IDS, G_COLOR, G_DONE, G_FLOW, TYPE_LABEL, TRACE_ROLE, VERB_HEX, AGENT_VISUAL, TOOL_INFO, VEREDICTO_VISUAL, AGENTE_VISUAL, FUENTE_GROUPS, STEPS } from "./convocatoria/constants";
import { oeceProcesoUrl, countFindings, humanizeError, inferCategoria, extractFindings, traceNodeForAgent, rucArg, buildTrace, inferAgente, wrapText, inferStepFromEvents } from "./convocatoria/utils";
import { ItemsConMarketPrice } from "./convocatoria/sections/ItemsConMarketPrice";
import { BanderasAgrupadas } from "./convocatoria/sections/BanderasAgrupadas";
import { MarketVerdictCard } from "./convocatoria/sections/MarketVerdictCard";
import { PostoresSection } from "./convocatoria/sections/PostoresSection";
import { DocumentosSection } from "./convocatoria/sections/DocumentosSection";
import { EmpresaAdjudicaCard } from "./convocatoria/sections/EmpresaAdjudicaCard";
import { FuentesConsultadasSection } from "./convocatoria/sections/FuentesConsultadasSection";
import { OtrosContratosSection } from "./convocatoria/sections/OtrosContratosSection";
import { RedFlagsDocumentalesSection } from "./convocatoria/sections/RedFlagsDocumentalesSection";
import { CronologiaSection } from "./convocatoria/sections/CronologiaSection";
import { CumplimientoNormativoSection } from "./convocatoria/sections/CumplimientoNormativoSection";
import { AportesPoliticosSection } from "./convocatoria/sections/AportesPoliticosSection";
import { PersonaVinculacionesPanel } from "./convocatoria/sections/PersonaVinculacionesPanel";
import { EstructuraEntidadSection } from "./convocatoria/sections/EstructuraEntidadSection";
import { CausalDirectaSection } from "./convocatoria/sections/CausalDirectaSection";
import { NoticiasSection } from "./convocatoria/sections/NoticiasSection";
import { AnalisisPostoresSection } from "./convocatoria/sections/AnalisisPostoresSection";
import { CollapsibleSection } from "./convocatoria/sections/CollapsibleSection";
import { AgentsPipeline } from "./convocatoria/sections/AgentsPipeline";
import { QuickAccessPanel } from "./convocatoria/sections/QuickAccessPanel";
import { DocumentoCard } from "./convocatoria/sections/DocumentoCard";
import { ObservabilidadPanel } from "./convocatoria/sections/ObservabilidadPanel";
import { AgentTraceSection } from "./convocatoria/sections/AgentTraceSection";
import { TracePhaseGroup } from "./convocatoria/sections/TracePhaseGroup";
import { AgentTraceRow } from "./convocatoria/sections/AgentTraceRow";
import { FirmantesYAdjudicacionSection } from "./convocatoria/sections/FirmantesYAdjudicacionSection";
import { RelationshipGraph } from "./convocatoria/sections/RelationshipGraph";
import { NodeDetailPanel } from "./convocatoria/sections/NodeDetailPanel";
import { PersonNetworkSection } from "./convocatoria/sections/PersonNetworkSection";
import { AnalizadasRecientes } from "./convocatoria/sections/AnalizadasRecientes";
import { LiveEventsPanel } from "./convocatoria/sections/LiveEventsPanel";
import { FlowGraph } from "./convocatoria/sections/FlowGraph";
import { LiveTracePanel } from "./convocatoria/sections/LiveTracePanel";
import { LoadingView } from "./convocatoria/sections/LoadingView";
import { ShareableHeader } from "./convocatoria/sections/ShareableHeader";
import { ResumenHumano } from "./convocatoria/sections/ResumenHumano";

// El portal OECE resuelve /proceso/<OCID COMPLETO>. El código de alerta / conv.ocid a
// veces es el sufijo corto ("1212446" o "2026-10404-12") → /proceso/1212446 da 404.
// Reconstruimos el OCID del esquema SEACE v3 (verificado: record/1212446=404,
// record/ocds-dgv273-seacev3-1212446=200). Soporta sufijo plano, año-secuencia,
// "OECE-..." y OCID ya completo.

const SAMPLES = [
  { id: "1203694", label: "Mun. Callao · herramientas S/. 93K" },
  { id: "1202858", label: "Chira Piura · maquinaria S/. 7.1M" },
];

const AGENTS = [
  { icon: <ScanSearch size={16} />, name: "compliance_agent",      action: "8 reglas duras SQL",        detail: "Edad RUC · único postor · adendas > 25% · plazo legal · SICAN", tone: "bg-amber-soft text-amber" },
  { icon: <FileText size={16} />,   name: "document_parser_agent", action: "Bases · actas · contratos", detail: "Gemini 2.5 Flash lee PDFs nativos · extrae items, postores, especs", tone: "bg-paperDeep text-clay" },
  { icon: <Receipt size={16} />,    name: "market_price_agent",    action: "Valida vs mercado",         detail: "Google Search en vivo · precios mediana · detecta sobreprecio", tone: "bg-crimson-soft text-rust" },
  { icon: <Globe2 size={16} />,     name: "web_research_agent",    action: "Perfil empresa · 15+ búsquedas",       detail: "SUNAT vía decolecta · OSCE · sanciones · historial contratos", tone: "bg-paperDeep text-clay" },
  { icon: <Eye size={16} />,        name: "news_research_agent",   action: "Cobertura periodística",    detail: "Timeline en prensa · OjoPúblico · IDL · Convoca · La República", tone: "bg-crimson-soft text-clay" },
  { icon: <Network size={16} />,    name: "person_network_agent",  action: "Gerente + red empresarial", detail: "Cargos pasados · candidaturas · aportes ONPE · empresas vinculadas", tone: "bg-amber-soft text-clay" },
  { icon: <FileText size={16} />,   name: "report_writer_agent",   action: "Dictamen final",            detail: "Cita artículo de ley · lecturas alternativas · próximos pasos", tone: "bg-paperSoft text-ink" },
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


export function ResultadoView({ result, onReset }: { result: ApiResult; onReset: () => void }) {
  const conv = result.convocatoria || {};
  const compl = result.compliance || {};
  const dict = result.dictamen?.dictamen_markdown || "";
  const bridge = result._bridge_meta || {};
  const banderasAltas = (compl.banderas || []).filter((b: any) => b.severidad === "alta").length;
  const ganador = (result.postores || []).find((p: any) => p.es_ganador);
  const [activeTab, setActiveTab] = useState<
    "resumen" | "items" | "documentos" | "proveedor" | "prensa" | "trace" | "dictamen"
  >("resumen");

  // Contadores para badges en tabs
  const nBanderas = (compl.banderas || []).length;
  const nItems = Math.max(
    (result.items || []).length,
    (result.market_analysis?.findings || []).length,
    (result.document_analysis?.items_consolidados || []).length,
  );
  const nDocs = (result.documentos || []).length;
  const nNoticias = (result.news_research?.noticias || []).length;
  const nEvents = (result.agent_trace || []).length;
  const _traceArr = (result.agent_trace || []) as any[];
  const nToolCalls = _traceArr.filter((e) => e.kind === "tool_call").length;
  const nAgentes = new Set(_traceArr.map((e) => e.agent).filter(Boolean)).size;
  const _lm = (result.llm_metrics || {}) as any;

  // Badge "Proveedor + Red": empresas vinculadas + partidos + contratos
  const _pn = result.person_network || {};
  const _red = _pn.red_empresarial || {};
  const _persona = _pn.persona_principal || {};
  const nRed =
    (_red.empresas_mismo_titular || []).length +
    (_red.empresas_misma_direccion || []).length +
    (_persona.candidaturas || []).length +
    (_persona.aportes_campañas || _persona.aportes_campanas || []).length +
    ((result.web_research?.otros_contratos_con_estado) || []).length;

  // Diccionario de nombres de personas PRIVADAS conocidas (gerente, firmantes, comité,
  // socios, funcionarios designados, familia) → para censurar su apellido también en la
  // PROSA (síntesis, dictamen, evidencia), no solo en las tarjetas. Los funcionarios
  // ELECTOS (alcalde, regidores) NO se incluyen: son públicos y el sujeto del escrutinio.
  // setRedactNames puebla el diccionario que lee redactDnis; corre en el body del dossier
  // (antes que los hijos con la prosa rendericen).
  const _da_red = result.document_analysis || {};
  setRedactNames([
    _persona.nombre_completo,
    ...((_da_red.firmantes || []) as any[]).map((f) => f?.nombre_completo),
    ...((_da_red.comite_evaluacion || []) as any[]).map((m) => m?.nombre_completo || m?.nombre),
    ...((_pn.cruce_firmantes_ganador || []) as any[]).map((c) => c?.firmante),
    ...(((result as any).entity_personnel?.funcionarios_designados || []) as any[]).map((f) => f?.nombre_completo || f?.nombre),
    ...((_pn.pareja_o_familia || []) as any[]).map((f) => f?.nombre),
    ...((result.web_research?.empresa?.socios || []) as any[]).map((s) => s?.nombre),
    ...(((result as any).proveedor?.socios || []) as any[]).map((s) => s?.nombre),
    ...((_red.socios || []) as any[]).map((s) => s?.nombre),
  ]);

  // Badge dictamen: presencia (1 = ✓)
  const _dictamenText = result.dictamen?.dictamen_markdown || "";
  const nDictamen = _dictamenText.length > 100 ? 1 : 0;

  // Conteos por severidad para el banner crítico
  const banderasArr = (compl.banderas || []) as any[];
  const nAlta = banderasArr.filter(b => (b.severidad || "").toLowerCase() === "alta").length;
  const nMedia = banderasArr.filter(b => (b.severidad || "").toLowerCase() === "media").length;

  // Orden secuencial: VEREDICTO (resumen portada + dictamen) → EVIDENCIA → MÉTODO (auditoría al final).
  const TABS = [
    { key: "resumen",    label: "Resumen",         icon: <ShieldAlert size={13}/>, badge: nBanderas || null, badgeColor: "bg-rust" },
    { key: "dictamen",   label: "Dictamen",        icon: <Pen size={13}/>,         badge: nDictamen ? "✓" : null, badgeColor: "bg-moss" },
    { key: "items",      label: "Items + Mercado", icon: <Package size={13}/>,     badge: nItems || null,    badgeColor: "bg-clay" },
    { key: "proveedor",  label: "Proveedor + Red", icon: <Building2 size={13}/>,   badge: nRed || null,      badgeColor: "bg-amber" },
    { key: "documentos", label: "Documentos",      icon: <FileText size={13}/>,    badge: nDocs || null,     badgeColor: "bg-clay" },
    { key: "prensa",     label: "Prensa",          icon: <Newspaper size={13}/>,   badge: nNoticias || null, badgeColor: "bg-moss" },
    { key: "trace",      label: "Auditoría",       icon: <Sparkles size={13}/>,    badge: nEvents || null,   badgeColor: "bg-mute" },
  ] as Array<{ key: string; label: string; icon: any; badge: number | string | null; badgeColor: string }>;

  // Resumen ejecutivo extraído del dictamen → portada con CTA "leer dictamen completo".
  const _resumenEjecutivo = (() => {
    const m = _dictamenText.match(/#{2,3}\s*Resumen ejecutivo\s*\n+([\s\S]*?)(?:\n#{2,3}\s|$)/i);
    const raw = (m ? m[1] : _dictamenText) || "";
    return raw.replace(/[#*`>\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 400);
  })();

  const fmtMoney = (n: number | string | undefined) => {
    const v = Number(n) || 0;
    if (v === 0) return "—";
    if (v >= 1e9) return `S/. ${(v / 1e9).toFixed(2)} B`;
    if (v >= 1e6) return `S/. ${(v / 1e6).toFixed(2)} M`;
    if (v >= 1e3) return `S/. ${(v / 1e3).toFixed(0)} K`;
    return `S/. ${v.toLocaleString("es-PE")}`;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),360px]">
      {/* ─── MAIN COLUMN ─── */}
      <main className="space-y-3 min-w-0">
        {/* HEADER */}
        <ShareableHeader
          conv={conv}
          codigo={conv.codigo}
          nAlta={nAlta}
          totalSec={result.timing?.total_s}
          eventsADK={bridge.agent_events ?? 0}
          onReset={onReset}
        />

        {/* OVERVIEW EJECUTIVO */}
        <ResumenHumano
          conv={conv}
          ganador={ganador}
          nAlta={nAlta}
          nMedia={nMedia}
          nBaja={(compl.banderas || []).filter((b: any) => (b.severidad || "").toLowerCase() === "baja").length}
          banderasArr={banderasArr}
          fmtMoney={fmtMoney}
          onClickResumen={() => setActiveTab("resumen")}
        />

        {/* PORTADA: resumen ejecutivo del dictamen + CTA — solo en el tab Resumen */}
        {activeTab === "resumen" && _resumenEjecutivo && (
          <div className="surface p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-clay">
              <Pen size={11} /> Resumen ejecutivo
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-inkSoft line-clamp-4">{_resumenEjecutivo}…</p>
            <button
              type="button"
              onClick={() => setActiveTab("dictamen")}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-clay px-3 py-1.5 text-xs font-bold text-paper transition-colors hover:bg-rust"
            >
              Leer dictamen completo <ChevronRight size={13} />
            </button>
          </div>
        )}

        {/* BANNER INCONSISTENCIA — si docs sugieren adjudicación pero OCDS aún no */}
        {result.estado_real?.estado_inconsistente && (
          <div className="surface flex items-start gap-3 border-2 border-rust/40 p-4">
            <AlertTriangle size={20} className="shrink-0 animate-pulse text-rust" />
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-sm font-bold text-rust">
                Inconsistencia detectada: documentos vs portal oficial
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-inkSoft">
                El OCDS publicado por OECE muestra estado{" "}
                <strong>{result.estado_real.estado_ocds}</strong>, pero el expediente
                ya tiene documentos de <strong>{result.estado_real.estado_documentos}</strong>{" "}
                ({result.estado_real.documentos_clave?.length || 0} documentos clave).
                Esto sugiere que el portal oficial está desactualizado o que la
                publicación oficial de la adjudicación está pendiente.
              </p>
              {(result.estado_real.documentos_clave || []).slice(0, 3).map((d: any, i: number) => (
                <div key={i} className="mt-1.5 flex items-start gap-2 text-[11px]">
                  <span className="rounded bg-rust/15 px-1.5 py-0 font-mono text-[10px] font-bold text-rust">
                    {d.tipo}
                  </span>
                  <span className="line-clamp-1 text-mute">{d.titulo}</span>
                  {d.fecha && <span className="font-mono text-[10px] text-mute">{d.fecha}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TABS NAVIGATION — sticky */}
        <nav className="sticky top-2 z-30 -mx-1 overflow-x-auto rounded-2xl border border-line bg-paper/95 px-1 py-1.5 shadow-sm backdrop-blur">
          <div className="flex gap-1">
            {TABS.map(t => {
              const isActive = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key as typeof activeTab)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-all",
                    isActive
                      ? "bg-clay text-paper shadow-card scale-[1.02]"
                      : "bg-paperSoft text-mute hover:bg-paperDeep hover:text-ink",
                  )}
                >
                  {t.icon}
                  <span>{t.label}</span>
                  {t.badge && (
                    <span className={cn(
                      "ml-0.5 rounded-full px-1.5 py-0 text-[9px] font-bold leading-tight",
                      isActive ? "bg-paper/30 text-paper" : cn(t.badgeColor, "text-paper"),
                    )}>
                      {t.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* ─── TAB: RESUMEN ─── */}
        {activeTab === "resumen" && (compl.banderas || []).length > 0 && (
          <BanderasAgrupadas banderas={compl.banderas} reglas_evaluadas={compl.reglas_evaluadas ?? 3} />
        )}

      {/* ─── TAB: ITEMS + MERCADO ─── */}
      {activeTab === "items" && ((result.items || []).length > 0 || (result.market_analysis?.findings || []).length > 0) && (
        <section className="surface overflow-hidden p-0">
          <div className="border-b border-line bg-paperDeep px-5 py-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
              <Package size={11} className="mr-1 inline" />
              Items convocados · {Math.max(
                (result.items || []).length,
                (result.market_analysis?.findings || []).length,
                (result.document_analysis?.items_consolidados || []).length,
              )}
              {(result.market_analysis?.findings || []).length > (result.items || []).length && (
                <span className="ml-2 rounded-full bg-amber-soft px-2 py-0 text-[9px] font-bold uppercase tracking-wider text-amber">
                  desglosado por agentes
                </span>
              )}
            </div>
            <h2 className="mt-1 font-serif text-xl font-bold text-ink">
              Qué se está comprando
            </h2>
            {(result.document_analysis?.items_consolidados || []).length > (result.items || []).length && (
              <p className="mt-1 text-xs text-mute">
                El OCDS reporta {(result.items || []).length} ítem(s) globales pero los agentes
                desglosaron en {(result.document_analysis?.items_consolidados || []).length} productos
                físicos según el REQUERIMIENTO técnico.
              </p>
            )}
          </div>
          <ItemsConMarketPrice items={result.items || []} allItems={result.document_analysis?.items_consolidados || []} market={result.market_analysis} fmtMoney={fmtMoney} />
        </section>
      )}

      {/* VEREDICTO GLOBAL MARKET_PRICE */}
      {activeTab === "items" && result.market_analysis?.veredicto_global && (
        <MarketVerdictCard market={result.market_analysis} fmtMoney={fmtMoney} />
      )}

      {/* POSTORES + sus banderas individuales */}
      {activeTab === "items" && (result.postores || []).length > 0 && (
        <PostoresSection postores={result.postores || []} fmtMoney={fmtMoney} />
      )}

      {/* ─── TAB: DOCUMENTOS ─── */}
      {activeTab === "documentos" && (result.documentos || []).length > 0 && (
        <DocumentosSection
          documentos={result.documentos || []}
          parserDocs={result.document_analysis?.documentos || []}
          fundamento={result.document_analysis?.fundamento_legal || []}
          modalidad={result.document_analysis?.modalidad}
        />
      )}

      {/* ─── TAB: PROVEEDOR + RED ─── orden lógico: empresa, red, contratos, política, fuentes */}
      {activeTab === "proveedor" && result.web_research?.empresa && (
        <EmpresaAdjudicaCard
          empresa={result.web_research.empresa}
          banderasSugeridas={result.web_research.banderas_sugeridas || []}
        />
      )}

      {activeTab === "documentos" && ((result.document_analysis?.firmantes || []).length > 0 ||
        (result.document_analysis?.motivos_adjudicacion || []).length > 0 ||
        (result.document_analysis?.comite_evaluacion || []).length > 0) && (
        <FirmantesYAdjudicacionSection
          firmantes={result.document_analysis?.firmantes || []}
          comite={result.document_analysis?.comite_evaluacion || []}
          motivos={result.document_analysis?.motivos_adjudicacion || []}
          lugarFecha={result.document_analysis?.lugar_fecha_acta}
          cruceFirmantes={result.person_network?.cruce_firmantes_ganador || []}
        />
      )}

      {activeTab === "documentos" && (result.document_analysis?.red_flags_documentales || []).length > 0 && (
        <RedFlagsDocumentalesSection
          flags={result.document_analysis.red_flags_documentales}
        />
      )}

      {activeTab === "proveedor" && result.person_network && (
        <PersonNetworkSection
          person={result.person_network}
          web={result.web_research}
          proveedor={result.postores?.find((p: any) => p.es_ganador)}
          ctx={(result as any).person_network_context}
        />
      )}

      {/* ESTRUCTURA DE LA ENTIDAD CONTRATANTE — autoridades + funcionarios designados */}
      {activeTab === "proveedor" && (
        (((result as any).person_network_context?.autoridades_entidad?.n_autoridades_encontradas || 0) > 0 ||
         ((result as any).entity_personnel?.funcionarios_designados?.length || 0) > 0) && (
        <EstructuraEntidadSection
          autoridades={(result as any).person_network_context?.autoridades_entidad}
          entityPersonnel={(result as any).entity_personnel}
          entidad={(result as any).entidad}
        />)
      )}

      {/* CAUSAL DE CONTRATACIÓN DIRECTA — si aplica */}
      {activeTab === "resumen" && (result as any).causal_directa_invocada?.match && (
        <CausalDirectaSection
          causal={(result as any).causal_directa_invocada}
          acto={(result as any).acto_resolutivo_directa}
        />
      )}

      {/* Secciones secundarias del proveedor — masonry 2-col (competencia · contratos · política · fuentes) */}
      {activeTab === "proveedor" && (
        <div className="columns-1 gap-3 md:columns-2 [&>*]:mb-3 [&>*]:break-inside-avoid">
          {result.analisis_postores?.postores?.length > 0 && (
            <CollapsibleSection
              title="Análisis de competencia"
              subtitle={result.analisis_postores.evidencia}
              icon={<Users size={13} />}
              defaultOpen={!(result.postores || []).some((p: any) => p.es_ganador)}
            >
              <AnalisisPostoresSection data={result.analisis_postores} />
            </CollapsibleSection>
          )}
          {(result.web_research?.otros_contratos_con_estado || []).length > 0 && (
            <CollapsibleSection
              title="Otros contratos con el Estado"
              subtitle={`${(result.web_research?.otros_contratos_con_estado || []).length} contratos públicos del proveedor`}
              icon={<Receipt size={13} />}
            >
              <OtrosContratosSection
                otros={result.web_research.otros_contratos_con_estado || []}
                relacion={result.web_research.relacion_proveedor_entidad}
                fmtMoney={fmtMoney}
              />
            </CollapsibleSection>
          )}
          <CollapsibleSection
            title="Vinculaciones políticas"
            subtitle="Aportes ONPE · candidaturas JNE"
            icon={<ShieldAlert size={13} />}
          >
            <AportesPoliticosSection
              web={result.web_research}
              person={result.person_network}
              ctx={(result as any).person_network_context}
            />
          </CollapsibleSection>
          {(result.web_research?.hallazgos_por_fuente || []).length > 0 && (
            <CollapsibleSection
              title="Fuentes consultadas"
              subtitle={`${(result.web_research?.hallazgos_por_fuente || []).length} portales públicos verificados`}
              icon={<Globe size={13} />}
            >
              <FuentesConsultadasSection hallazgos={result.web_research.hallazgos_por_fuente} />
            </CollapsibleSection>
          )}
        </div>
      )}

      {activeTab === "documentos" && result.convocatoria && (
        <CronologiaSection convocatoria={result.convocatoria} />
      )}

      {activeTab === "documentos" && result.normative_compliance && (
        <CumplimientoNormativoSection nc={result.normative_compliance} />
      )}

      {/* ─── TAB: PRENSA ─── */}
      {activeTab === "prensa" && result.news_research && (
        <NoticiasSection news={result.news_research} />
      )}

      {/* FALLBACKS texto crudo (si parseo falló) */}
      {!result.market_analysis && result.market_analysis_raw && (
        <FallbackText title="market_price_agent (texto crudo)" text={result.market_analysis_raw} icon={<Receipt size={11}/>} />
      )}
      {!result.document_analysis && result.doc_parser_raw && (
        <FallbackText title="document_parser_agent (texto crudo)" text={result.doc_parser_raw} icon={<FileText size={11}/>} />
      )}
      {!result.web_research && result.web_research_raw && (
        <FallbackText title="web_research_agent (texto crudo)" text={result.web_research_raw} icon={<Globe2 size={11}/>} />
      )}
      {!result.news_research && result.news_research_raw && (
        <FallbackText title="news_research_agent (texto crudo)" text={result.news_research_raw} icon={<Eye size={11}/>} />
      )}
      {!result.person_network && result.person_network_raw && (
        <FallbackText title="person_network_agent (texto crudo)" text={result.person_network_raw} icon={<Network size={11}/>} />
      )}

      {/* ─── TAB: TRACE ADK + OBSERVABILIDAD ─── */}
      {activeTab === "trace" && (
        <div className="space-y-5">
          <ObservabilidadPanel liveEvents={result.agent_trace || []} metrics={result.llm_metrics} />
          {(result.agent_trace || []).length > 0 && <AgentTraceSection trace={result.agent_trace!} />}
        </div>
      )}

      {/* ─── TAB: DICTAMEN ─── */}
      {activeTab === "dictamen" && dict && (
        <section className="surface overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line bg-paperDeep px-5 py-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
                <FileText size={11} className="mr-1 inline" />
                report_writer_agent · {result.dictamen?.gen_meta?.model ?? "Gemini"}
              </div>
              <h2 className="mt-1 font-serif text-xl font-bold text-ink">
                Dictamen periodístico
              </h2>
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(dict)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-paperDeep"
            >
              <Download size={11} /> Copiar
            </button>
          </div>
          <article
            className={cn(
              "max-w-none px-6 py-6",
              // Headings
              "prose prose-sm lg:prose-base",
              "prose-headings:font-serif prose-headings:text-ink prose-headings:font-bold prose-headings:tracking-tight",
              "prose-h1:text-2xl prose-h1:mt-0 prose-h1:mb-4 prose-h1:pb-2 prose-h1:border-b-2 prose-h1:border-clay",
              "prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-3 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-line",
              "prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-clay prose-h3:uppercase prose-h3:tracking-wider prose-h3:font-bold",
              "prose-h4:text-sm prose-h4:mt-4 prose-h4:mb-1.5 prose-h4:font-bold prose-h4:text-ink",
              // Body
              "prose-p:text-ink prose-p:leading-relaxed prose-p:my-2",
              "prose-strong:text-ink prose-strong:font-bold",
              "prose-em:text-inkSoft prose-em:italic",
              // Lists
              "prose-ul:my-2 prose-ul:list-disc prose-ul:pl-5 prose-ul:space-y-1",
              "prose-ol:my-2 prose-ol:list-decimal prose-ol:pl-5 prose-ol:space-y-1",
              "prose-li:text-ink prose-li:leading-relaxed prose-li:marker:text-clay",
              // Links — break long URLs
              "prose-a:text-clay prose-a:font-medium prose-a:underline prose-a:decoration-clay/40 hover:prose-a:decoration-clay",
              "prose-a:break-all", // permite quebrar URLs largas
              // Code & blockquote
              "prose-code:bg-paperDeep prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-clay prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
              "prose-blockquote:border-l-4 prose-blockquote:border-clay prose-blockquote:bg-paperSoft prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:my-3 prose-blockquote:rounded-r prose-blockquote:text-inkSoft prose-blockquote:not-italic",
              // Tables
              "prose-table:text-xs prose-table:w-full prose-table:border-collapse",
              "prose-th:bg-paperDeep prose-th:text-ink prose-th:font-bold prose-th:uppercase prose-th:tracking-wider prose-th:text-[10px] prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-line",
              "prose-td:text-ink prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-line prose-td:align-top",
              // HR
              "prose-hr:my-6 prose-hr:border-line",
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Censura DNIs embebidos en la prosa del dictamen (vidrio revelable).
                p: ({ node, children, ...props }) => <p {...props}>{redactChildren(children)}</p>,
                li: ({ node, children, ...props }) => <li {...props}>{redactChildren(children)}</li>,
                strong: ({ node, children, ...props }) => <strong {...props}>{redactChildren(children)}</strong>,
                em: ({ node, children, ...props }) => <em {...props}>{redactChildren(children)}</em>,
                td: ({ node, children, ...props }) => <td {...props}>{redactChildren(children)}</td>,
                a: ({ node, href, children, ...props }) => {
                  const isLongUrl = typeof href === "string" && href.length > 80;
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      {...props}
                      className={cn(
                        "text-clay font-medium hover:text-rust transition-colors",
                        isLongUrl ? "inline-flex items-center gap-1 max-w-full" : "underline decoration-clay/40 hover:decoration-clay",
                      )}
                      title={typeof href === "string" ? href : undefined}
                    >
                      {isLongUrl ? (
                        <>
                          <span className="truncate max-w-[36ch] underline decoration-clay/40">
                            {String(children)}
                          </span>
                          <ExternalLink size={10} className="shrink-0" />
                        </>
                      ) : (
                        children
                      )}
                    </a>
                  );
                },
              }}
            >
              {dict}
            </ReactMarkdown>
          </article>
        </section>
      )}

        {/* DIAGNÓSTICO TÉCNICO — solo en el tab Auditoría (antes aparecía al pie de CADA tab) */}
        {activeTab === "trace" && (
        <details className="surface p-4 text-xs">
          <summary className="cursor-pointer font-semibold text-ink">
            🔧 Diagnóstico técnico
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-mute">Timing (segundos)</div>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-ink">
                {Object.entries(result.timing || {}).map(([k, v]) => (
                  <li key={k}>{k}: <strong>{v}</strong></li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-mute">Bridge Next → GCP</div>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-ink">
                {Object.entries(bridge).map(([k, v]) => (
                  <li key={k}>{k}: <strong>{String(v)}</strong></li>
                ))}
              </ul>
            </div>
          </div>
        </details>
        )}

        {/* DISCLAIMER FOOTER */}
        <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-mute">
          <ShieldAlert size={10} className="mr-1 inline text-amber" />
          Vigía detecta señales cruzando datos públicos (OECE, SUNAT, OSCE, ONPE, prensa). No constituye acusación. La denuncia formal corresponde a Contraloría, Fiscalía o periodismo.
        </p>
      </main>

      {/* ─── SIDEBAR — score + hechos clave + acciones ─── */}
      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        {/* SCORE CARD — único contenido del sidebar que no está duplicado en otro lado */}
        <div className="surface flex items-center gap-3 p-4">
          <div className={cn(
            "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl text-paper",
            (compl.score ?? 0) >= 85 ? "bg-rust" :
            (compl.score ?? 0) >= 70 ? "bg-clay" :
            (compl.score ?? 0) >= 40 ? "bg-amber" : "bg-mute",
          )}>
            <span className="font-serif text-2xl font-bold leading-none">{compl.score ?? 0}</span>
            <span className="mt-0.5 text-[9px] uppercase tracking-widest opacity-80">/ 100</span>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium text-mute">Score de riesgo</div>
            <div className="mt-0.5 text-sm font-bold leading-tight text-ink">
              {(compl.score ?? 0) >= 85 ? "Crítico" :
               (compl.score ?? 0) >= 70 ? "Alto" :
               (compl.score ?? 0) >= 40 ? "Medio" :
                                          "Bajo"}
            </div>
            <div className="mt-0.5 text-[10px] text-mute">
              {(compl.score ?? 0) >= 85 ? "Atención inmediata" :
               (compl.score ?? 0) >= 70 ? "Patrones múltiples" :
               (compl.score ?? 0) >= 40 ? "Señales aisladas" :
                                          "Pocas señales"}
            </div>
          </div>
        </div>

        {/* DATOS DEL PROCESO — info única, layout numérico tipo dashboard */}
        <div className="surface p-3">
          {conv.tipo_proceso && (
            <div className="mb-2 border-b border-line pb-2">
              <div className="text-[10px] text-mute">Tipo de proceso</div>
              <div className="mt-0.5 text-[12px] font-semibold leading-tight text-ink">
                {conv.tipo_proceso}
              </div>
            </div>
          )}
          <dl className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-md bg-paperDeep p-1.5">
              <dd className={cn(
                "font-mono text-base font-bold tabular-nums leading-none",
                (conv.n_postores ?? 0) === 1 ? "text-rust" : "text-ink",
              )}>
                {conv.n_postores ?? 0}
              </dd>
              <dt className="mt-0.5 text-[9px] text-mute">
                Postores
                {(conv.n_postores ?? 0) === 1 && <span className="ml-0.5 text-rust">⚠</span>}
              </dt>
            </div>
            <div className="rounded-md bg-paperDeep p-1.5">
              <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink">
                {conv.n_items ?? 0}
              </dd>
              <dt className="mt-0.5 text-[9px] text-mute">Ítems</dt>
            </div>
            <div className="rounded-md bg-paperDeep p-1.5">
              <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink">
                {conv.n_docs ?? 0}
              </dd>
              <dt className="mt-0.5 text-[9px] text-mute">Docs</dt>
            </div>
          </dl>
        </div>

        {/* AUDITORÍA TÉCNICA — resumen del pipeline (no solo un enlace vacío) */}
        {nEvents > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab("trace")}
            className="surface w-full p-3 text-left transition-colors hover:bg-paperDeep"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                <Sparkles size={12} className="text-clay" /> Auditoría técnica
              </div>
              <ChevronRight size={14} className="shrink-0 text-mute" />
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-md bg-paperDeep p-1.5">
                <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink">{nEvents}</dd>
                <dt className="mt-0.5 text-[9px] text-mute">pasos</dt>
              </div>
              <div className="rounded-md bg-paperDeep p-1.5">
                <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink">{nAgentes}</dd>
                <dt className="mt-0.5 text-[9px] text-mute">agentes</dt>
              </div>
              <div className="rounded-md bg-paperDeep p-1.5">
                <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink">{nToolCalls}</dd>
                <dt className="mt-0.5 text-[9px] text-mute">tools</dt>
              </div>
            </dl>
            {(_lm.tokens_total || _lm.cost_usd != null) && (
              <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 text-[10px] text-mute">
                <span className="font-mono">{_lm.tokens_total ? `${(_lm.tokens_total / 1000).toFixed(0)}K tokens` : "Gemini + grounding"}</span>
                {_lm.cost_usd != null && <span className="font-mono text-clay">${Number(_lm.cost_usd).toFixed(3)}</span>}
              </div>
            )}
            <div className="mt-1.5 text-[10px] font-medium text-clay">Ver los {nEvents} pasos del pipeline →</div>
          </button>
        )}
      </aside>
    </div>
  );
}

// ─── sub-components ───────────────────────────────────────────

// Surfacing de la capa de observabilidad (track Arize): trazabilidad en Phoenix,
// evaluadores LLM-as-judge y guardrails anti-alucinación. `compact` = tira para
// el proceso en curso; full = tarjeta para el resultado (tab Auditoría).
// Dashboard de Arize: muestra TODO lo que la capa de observabilidad hace —
// trazas a Phoenix Cloud, métricas (tokens/costo/llamadas) en vivo, los 4
// evaluadores LLM-as-judge y los guardrails anti-alucinación. Con `liveEvents`
// muestra las métricas en vivo; sin ellos (resultado), la versión cualitativa.

// Convierte URLs sueltas dentro de un texto en enlaces clicables.




// ─── Nuevos componentes para JSON estructurado ───────────────



// ─── BANDERAS agrupadas + filtros + clickeables ───────────────────────












function FallbackText({ title, text, icon }: { title: string; text: string; icon: React.ReactNode }) {
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-amber-soft px-5 py-3">
        <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber">
          {icon} {title}
        </div>
        <p className="mt-1 text-xs text-mute">El JSON estructurado no pudo parsearse — mostramos el texto crudo del agente.</p>
      </div>
      <article className="prose prose-sm max-w-none px-6 py-4 prose-headings:font-serif prose-headings:text-ink prose-p:text-ink prose-strong:text-ink prose-a:text-clay prose-li:text-ink prose-table:text-xs prose-th:bg-paperDeep prose-th:text-ink prose-td:text-ink">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          p: ({ node, children, ...props }) => <p {...props}>{redactChildren(children)}</p>,
          li: ({ node, children, ...props }) => <li {...props}>{redactChildren(children)}</li>,
          strong: ({ node, children, ...props }) => <strong {...props}>{redactChildren(children)}</strong>,
        }}>{text}</ReactMarkdown>
      </article>
    </section>
  );
}


// ════════════════════════════════════════════════════════════════════
// RelationshipGraph — grafo SVG persona → empresas → contratos
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// NodeDetailPanel — panel expandible al click en un nodo del grafo
// ════════════════════════════════════════════════════════════════════



