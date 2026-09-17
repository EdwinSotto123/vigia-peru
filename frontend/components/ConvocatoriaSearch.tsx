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
import { CAT_LABEL, CAT_TONE, NODE_META, PHASE_HEX, AGENT_IDS, G_COLOR, G_DONE, G_FLOW, TYPE_LABEL, TRACE_ROLE, VERB_HEX, AGENT_VISUAL, TOOL_INFO, VEREDICTO_VISUAL, AGENTE_VISUAL, FUENTE_GROUPS } from "./convocatoria/constants";
import { oeceProcesoUrl, countFindings, humanizeError, inferCategoria, extractFindings, traceNodeForAgent, rucArg, buildTrace, inferAgente, wrapText } from "./convocatoria/utils";
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

// STEPS del pipeline real — 13 nodos del BPMN.
// `eta_s` es el tiempo estimado en segundos para AVANZAR al siguiente paso
// (basado en timing observado en runs reales, ≈ 9-10 min total).
const STEPS = [
  { key: "fetch",       label: "Trayendo OCDS del OECE",                      icon: <Search size={14} />,         eta_s: 3,    lane: "ingesta" },
  { key: "pdfs",        label: "Descargando PDFs / DOCXs publicados",         icon: <Download size={14} />,       eta_s: 12,   lane: "ingesta" },
  { key: "db",          label: "Guardando en base de datos",                  icon: <ScanSearch size={14} />,     eta_s: 5,    lane: "ingesta" },
  { key: "compliance",  label: "Compliance · 3 reglas duras + RAG",           icon: <AlertTriangle size={14} />,  eta_s: 35,   lane: "auditoría" },
  { key: "parser",      label: "Document Parser · OCR Vision",                icon: <FileText size={14} />,       eta_s: 110,  lane: "auditoría" },
  { key: "legal",       label: "Legal Analyst · banderas + opinión OECE",     icon: <Scale size={14} />,          eta_s: 40,   lane: "auditoría" },
  { key: "market",      label: "Market Price · google_search por sub-ítem",   icon: <Receipt size={14} />,        eta_s: 130,  lane: "investigación" },
  { key: "sunat",       label: "SUNAT · validación de RUC",                   icon: <Building2 size={14} />,      eta_s: 8,    lane: "investigación" },
  { key: "web",         label: "Web Research · 13 fuentes oficiales",         icon: <Globe size={14} />,          eta_s: 60,   lane: "investigación" },
  { key: "news",        label: "News Research · prensa peruana",              icon: <Newspaper size={14} />,      eta_s: 60,   lane: "investigación" },
  { key: "rnp",         label: "RNP · red empresarial + cruce firmantes",     icon: <Network size={14} />,        eta_s: 80,   lane: "investigación" },
  { key: "extended",    label: "Compliance extendido · 7 reglas + RAG",       icon: <ListChecks size={14} />,     eta_s: 35,   lane: "auditoría" },
  { key: "writer",      label: "Report Writer · dictamen · Gemini 2.5 Pro",   icon: <Pen size={14} />,            eta_s: 60,   lane: "dictamen" },
];

// Total estimado: 638s ≈ 10.6 min. Si el run termina antes, el frontend salta
// al último paso. Si tarda más, el último paso queda "active" hasta llegar.

// Mapea tool/transfer/phase a la key de STEP. Usa el último evento "fuerte"
// del stream para inferir en qué paso del BPMN estamos realmente.
const STEP_KEY_BY_TOOL: Array<{ rx: RegExp; key: string }> = [
  { rx: /fetch_ocds|get_ocds_record|fetch_documents|archive_docs/i,           key: "fetch" },
  { rx: /parse_document_pdf|extract_doc|ocr/i,                                 key: "parser" },
  { rx: /ingest_to_db|insert_(convocatoria|postores|documentos)/i,             key: "db" },
  { rx: /evaluate_normative_compliance|run_hard_rules|persist_alert/i,         key: "compliance" },
  { rx: /query_legal_rag|lookup_opinion_oece|legal_analyst/i,                  key: "legal" },
  { rx: /query_sunat|sunat_decolecta/i,                                        key: "sunat" },
  { rx: /query_rnp|rnp_conformacion|cruce_firmantes/i,                         key: "rnp" },
  { rx: /market_price|build_market_input|web_search_market/i,                  key: "market" },
  { rx: /web_research|google_search_oficial/i,                                 key: "web" },
  { rx: /news_research|prensa/i,                                               key: "news" },
  { rx: /report_writer|get_dictamen_context|persist_analysis/i,                key: "writer" },
];
const STEP_KEY_BY_AGENT: Array<{ rx: RegExp; key: string }> = [
  { rx: /document_parser/i,         key: "parser" },
  { rx: /document_legal_analyst/i,  key: "legal" },
  { rx: /compliance/i,              key: "compliance" },
  { rx: /market_price/i,            key: "market" },
  { rx: /web_research/i,            key: "web" },
  { rx: /news_research/i,           key: "news" },
  { rx: /person_network/i,          key: "rnp" },
  { rx: /report_writer/i,           key: "writer" },
];
function inferStepFromEvents(events: any[]): number {
  if (!events?.length) return -1;
  // Recorrer de atrás hacia adelante; el primero que matche define el step.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    let candidate: string | null = null;

    if (ev.kind === "phase") {
      if (ev.name === "writer_forced" || ev.name === "persist") candidate = "writer";
      else if (ev.name === "safety_net") candidate = "writer";
    } else if (ev.kind === "tool_call" || ev.kind === "tool_result") {
      const name = ev.name || "";
      const m = STEP_KEY_BY_TOOL.find(s => s.rx.test(name));
      if (m) candidate = m.key;
      else {
        const am = STEP_KEY_BY_AGENT.find(s => s.rx.test(ev.agent || ""));
        if (am) candidate = am.key;
      }
    } else if (ev.kind === "transfer") {
      const am = STEP_KEY_BY_AGENT.find(s => s.rx.test(ev.to || ""));
      if (am) candidate = am.key;
    }

    if (candidate) {
      const idx = STEPS.findIndex(s => s.key === candidate);
      if (idx >= 0) return idx;
    }
  }
  return -1;
}

// Cuenta banderas/señales en VIVO desde el stream. Combina dos señales reales:
//  · cada tool_call `add_contextual_flag` = 1 señal contextual del orquestador.
//  · el máximo conteo numérico que reporten los persist_* en su result_preview
//    (banderas duras de compliance, documentales, de mercado).
// Toma el máximo de ambas → nunca sobre-declara, y sube a medida que avanza.



/**
 * Convierte un error técnico del backend en un mensaje legible para el usuario.
 * Mapea casos conocidos (cuota agotada, tool not found, stream interrumpido) a
 * texto en español neutro con sugerencia de acción.
 */

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

function AnalizadasRecientes({ onSelect }: { onSelect: (ocidOrCodigo: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<SevFilter>("todos");
  const [region, setRegion] = useState<string>("todas");
  const [cat, setCat] = useState<CatFilter>("todas");
  const [sort, setSort] = useState<SortKey>("reciente");
  const [shuffleKey, setShuffleKey] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 24; // 12 filas en el grid de 2 columnas → poco scroll por página

  useEffect(() => {
    getAnalyzedList(500)
      .then((d) => {
        if (d?.error) setErr(d.error);
        else setItems(d.items || []);
      })
      .catch((e) => setErr(e.message));
  }, []);
  // Volver a la página 1 cuando cambian filtros/orden/búsqueda (no quedar en una página vacía).
  useEffect(() => { setPage(1); }, [q, sev, region, cat, sort]);

  const fmtMoney = (n: number) => {
    if (!n) return "—";
    if (n >= 1e6) return `S/. ${(n/1e6).toFixed(2)} M`;
    if (n >= 1e3) return `S/. ${(n/1e3).toFixed(0)} K`;
    return `S/. ${n.toLocaleString("es-PE")}`;
  };
  const fmtFecha = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diff < 1) return "hace instantes";
    if (diff < 60) return `hace ${diff}m`;
    if (diff < 1440) return `hace ${Math.floor(diff/60)}h`;
    return d.toLocaleDateString("es-PE");
  };

  // Skeleton loader
  if (err) return null;
  if (!items) {
    return (
      <section>
        <div className="mb-3 h-5 w-64 animate-pulse rounded bg-paperDeep" />
        <div className="surface space-y-0 divide-y divide-line p-0">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
              <div className="h-11 w-11 shrink-0 rounded-lg bg-paperDeep" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 rounded bg-paperDeep" />
                <div className="h-3 w-1/2 rounded bg-paperDeep" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // Filtrado en cliente — todos los datos ya vinieron en una sola query SQL
  const regionesUnicas = Array.from(new Set(items.map((it: any) => it.region).filter(Boolean))).sort() as string[];
  const qLower = q.trim().toLowerCase();

  // Anotar cada item con su categoría inferida (heurística por keywords)
  const itemsWithCat = items.map((it: any) => ({ ...it, _cat: inferCategoria(it.objeto) }));

  const filtered = itemsWithCat.filter((it: any) => {
    if (qLower) {
      const haystack = [
        it.codigo_convocatoria, it.ocid, it.objeto, it.entidad,
        it.entidad_ruc, it.proveedor_ruc,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(qLower)) return false;
    }
    if (region !== "todas" && it.region !== region) return false;
    if (cat    !== "todas" && it._cat !== cat) return false;
    if (sev === "alta"  && (it.n_alta  || 0) === 0) return false;
    if (sev === "media" && (it.n_media || 0) + (it.n_alta || 0) === 0) return false;
    if (sev === "sin"   && (it.n_banderas || 0) > 0) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "score") return (b.score || 0) - (a.score || 0);
    if (sort === "monto") return (b.monto || 0) - (a.monto || 0);
    return String(b.analizado_en || "").localeCompare(String(a.analizado_en || ""));
  });

  // Paginación en cliente: se renderiza SOLO una página (PAGE_SIZE) a la vez — evita
  // saturar el DOM con todos los análisis y reduce el scroll. Los filtros/orden ya
  // corrieron sobre el total, así que paginar es puramente de presentación.
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  const handleShuffle = () => {
    if (sorted.length === 0) return;
    const pick = sorted[Math.floor(Math.random() * sorted.length)];
    setShuffleKey(k => k + 1);
    onSelect(pick.codigo_convocatoria || pick.ocid);
  };

  if (items.length === 0) {
    return (
      <div className="surface p-6 text-center">
        <div className="text-[10px] font-bold uppercase tracking-widest text-mute">
          Análisis previos
        </div>
        <p className="mt-2 text-sm text-mute">
          Aún no hay convocatorias analizadas. Despacha los agentes con un código arriba.
        </p>
      </div>
    );
  }

  // Conteo agregado para los chips de severidad
  const countAlta  = items.filter((it: any) => (it.n_alta || 0) > 0).length;
  const countMedia = items.filter((it: any) => (it.n_media || 0) + (it.n_alta || 0) > 0).length;
  const countSin   = items.filter((it: any) => (it.n_banderas || 0) === 0).length;

  const sevChip = (key: SevFilter, label: string, count: number, tone: string) => (
    <button
      type="button"
      onClick={() => setSev(key)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
        sev === key
          ? `${tone} text-paper border-transparent shadow-sm`
          : "border-line bg-paper text-ink hover:bg-paperDeep",
      )}
    >
      <span>{label}</span>
      <span className={cn(
        "rounded-full px-1.5 py-0 text-[10px] tabular-nums",
        sev === key ? "bg-paper/20 text-paper" : "bg-paperDeep text-mute",
      )}>{count}</span>
    </button>
  );

  return (
    <section>
      {/* HEADER + BARRA DE FILTROS · todo en una sola hilera compacta */}
      <div className="surface mb-3 space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="font-serif text-base font-bold text-ink">Análisis previos</h2>
              <span className="rounded-full bg-paperDeep px-1.5 py-0 font-mono text-[10px] font-bold text-ink">{items.length}</span>
            </div>
          </div>

          {/* Search inline */}
          <div className="relative ml-auto flex-1 sm:min-w-[260px] sm:max-w-[360px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar código / objeto / RUC…"
              className="w-full rounded-lg border border-line bg-paper py-1.5 pl-7 pr-7 text-xs placeholder:text-mute focus:border-clay focus:outline-none focus:ring-1 focus:ring-clay/30"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-1 py-0 text-[10px] text-mute hover:bg-paperDeep"
              >×</button>
            )}
          </div>

          {/* Botón sortear inline a la derecha */}
          <button
            type="button"
            onClick={handleShuffle}
            disabled={sorted.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[11px] font-semibold text-ink shadow-sm transition-colors hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
            title={`Elegir uno al azar de los ${sorted.length} filtrados`}
          >
            <Shuffle size={12} />
            <span className="hidden sm:inline">Sortear</span>
          </button>
        </div>

        {/* Chips: severidad · categoría · sort · región — UNA SOLA FILA scrolleable */}
        <div className="-mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
          {/* Severidad */}
          {sevChip("todos", "Todas", items.length, "bg-ink")}
          {sevChip("alta",  "● Alta",  countAlta,  "bg-rust")}
          {sevChip("media", "● Media", countMedia, "bg-amber")}
          {sevChip("sin",   "Limpio", countSin,   "bg-moss")}

          <span className="mx-1 h-4 w-px shrink-0 bg-line" />

          {/* Categoría */}
          {(["todas", "bienes", "servicios", "obras", "consultoria"] as CatFilter[]).map(k => {
            const n = k === "todas" ? items.length : itemsWithCat.filter((it: any) => it._cat === k).length;
            if (k !== "todas" && n === 0) return null;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCat(k)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                  cat === k
                    ? "border-transparent bg-ink text-paper shadow-sm"
                    : "border-line bg-paper text-ink hover:bg-paperDeep",
                )}
              >
                {k !== "todas" && (
                  <span className={cn("inline-block h-1.5 w-1.5 rounded-full", CAT_TONE[k])} />
                )}
                <span>{CAT_LABEL[k]}</span>
                <span className={cn(
                  "rounded-full px-1 text-[9px] tabular-nums",
                  cat === k ? "bg-paper/20 text-paper" : "bg-paperDeep text-mute",
                )}>{n}</span>
              </button>
            );
          })}

          <span className="mx-1 h-4 w-px shrink-0 bg-line" />

          {/* Sort */}
          {(["reciente", "score", "monto"] as SortKey[]).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                sort === k
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper text-ink hover:bg-paperDeep",
              )}
            >
              {k === "reciente" ? "↓ Reciente" : k === "score" ? "↓ Score" : "↓ Monto"}
            </button>
          ))}

          {/* Región */}
          {regionesUnicas.length > 0 && (
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="ml-1 shrink-0 rounded-full border border-line bg-paper px-2 py-0.5 text-[10px] font-semibold text-ink focus:border-clay focus:outline-none"
              title="Filtrar por región"
            >
              <option value="todas">Todas las regiones</option>
              {regionesUnicas.map(r => {
                const n = items.filter((it: any) => it.region === r).length;
                return <option key={r} value={r}>{r} ({n})</option>;
              })}
            </select>
          )}
        </div>

        {sorted.length !== items.length && (
          <div className="text-[11px] text-mute">
            <strong className="text-ink">{sorted.length}</strong> de {items.length} coinciden con los filtros.
            {(q || sev !== "todos" || region !== "todas" || cat !== "todas") && (
              <button
                onClick={() => { setQ(""); setSev("todos"); setRegion("todas"); setCat("todas"); }}
                className="ml-2 underline hover:text-clay"
              >limpiar filtros</button>
            )}
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="surface p-6 text-center text-sm text-mute">
          Ningún análisis coincide con los filtros.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
          {pageItems.map((it: any, i: number) => (
            <li key={it.codigo_convocatoria || it.ocid || `${pageStart}-${i}`} className="surface group relative overflow-hidden p-0 transition-all hover:shadow-md hover:border-clay/40">
              <button
                type="button"
                onClick={() => onSelect(it.codigo_convocatoria || it.ocid)}
                className="flex w-full items-stretch text-left"
              >
                {/* SCORE STRIPE — solo número, sin emoji */}
                <div className={cn(
                  "flex w-12 shrink-0 flex-col items-center justify-center px-1 py-3 text-paper",
                  it.score >= 85 ? "bg-rust" :
                  it.score >= 70 ? "bg-clay" :
                  it.score >= 40 ? "bg-amber" : "bg-moss",
                )}>
                  <span className="font-mono text-lg font-bold leading-none">{it.score}</span>
                  <span className="mt-0.5 text-[8px] uppercase tracking-wider opacity-80">/100</span>
                </div>

                {/* MAIN BODY */}
                <div className="min-w-0 flex-1 px-3 py-2.5">
                  {/* Top: código + categoría + región + fecha */}
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-[11px] font-bold text-ink">#{it.codigo_convocatoria}</span>
                    {it._cat !== "todas" && CAT_LABEL[it._cat as CatFilter] && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-mute">
                        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", CAT_TONE[it._cat as CatFilter])} />
                        {CAT_LABEL[it._cat as CatFilter]}
                      </span>
                    )}
                    {it.region && (
                      <span className="text-[10px] text-mute">· {it.region}</span>
                    )}
                    <span className="ml-auto text-[10px] text-mute">{fmtFecha(it.analizado_en)}</span>
                  </div>

                  {/* Objeto */}
                  <div className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug text-ink">{it.objeto}</div>

                  {/* Bottom: entidad + monto + banderas */}
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                    <div className="flex min-w-0 items-center gap-1.5 text-mute">
                      <Building2 size={10} className="shrink-0" />
                      <span className="line-clamp-1">{it.entidad || "—"}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {it.n_alta > 0 && (
                        <span className="rounded bg-rust px-1 py-0 text-[10px] font-bold text-paper">{it.n_alta} alta</span>
                      )}
                      {it.n_media > 0 && (
                        <span className="rounded bg-amber px-1 py-0 text-[10px] font-bold text-paper">{it.n_media}</span>
                      )}
                      {it.n_banderas === 0 && (
                        <span className="rounded bg-moss/20 px-1 py-0 text-[10px] font-bold text-moss">limpio</span>
                      )}
                      <span className="font-mono text-[11px] font-bold text-ink">{fmtMoney(it.monto)}</span>
                    </div>
                  </div>
                </div>

                <ChevronRight size={14} className="mr-2 mt-3 shrink-0 self-start text-mute transition-transform group-hover:translate-x-1 group-hover:text-clay" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* PAGINACIÓN — solo se renderiza una página a la vez (PAGE_SIZE). Si hay ≤9
          páginas mostramos todos los números; si hay más, prev/next + indicador. */}
      {sorted.length > 0 && totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-semibold text-ink hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
          >← Anterior</button>
          {totalPages <= 9 ? (
            Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={cn(
                  "min-w-[30px] rounded-full border px-2 py-1 text-[11px] font-mono font-semibold transition-colors",
                  p === safePage ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:bg-paperDeep",
                )}
              >{p}</button>
            ))
          ) : (
            <span className="px-2 font-mono text-[11px] font-bold text-ink">página {safePage} de {totalPages}</span>
          )}
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-semibold text-ink hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
          >Siguiente →</button>
        </div>
      )}
      {sorted.length > 0 && (
        <div className="mt-2 text-center text-[11px] text-mute">
          Mostrando <strong className="text-ink">{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, sorted.length)}</strong> de {sorted.length}
          {sorted.length !== items.length && ` (filtrados de ${items.length})`}
        </div>
      )}
    </section>
  );
}

// ─── LOADING ───────────────────────────────────────────────────

function ExpandableThought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const truncated = text.length > 180;
  return (
    <div
      className={cn(
        "italic text-mute cursor-pointer transition-colors hover:text-ink",
        !open && truncated && "line-clamp-2",
      )}
      onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      title={open ? "Click para colapsar" : "Click para ver el razonamiento completo"}
    >
      {text}
      {truncated && (
        <span className="ml-1 not-italic font-semibold text-clay">
          {open ? " · cerrar" : ""}
        </span>
      )}
    </div>
  );
}

function LiveEventsPanel({ events }: { events: any[] }) {
  const last = events.slice(-30);
  const tail = useRef<HTMLDivElement | null>(null);
  // Auto-scroll SOLO si el usuario ya está cerca del fondo: si subió a leer un nodo,
  // NO lo arrastramos hacia abajo cuando avanza un paso (era molesto). getBoundingClientRect
  // es relativo al viewport → funciona con el scroll de la página.
  useEffect(() => {
    const el = tail.current;
    if (el && el.getBoundingClientRect().top <= window.innerHeight + 300)
      el.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  // Conteos para mini-stats
  const byKind: Record<string, number> = {};
  for (const e of events) byKind[e.kind || "?"] = (byKind[e.kind || "?"] || 0) + 1;

  const kindIcon = (k: string) => {
    if (k === "tool_call")    return <Sparkles size={11} className="text-clay" />;
    if (k === "tool_result")  return <CheckCircle2 size={11} className="text-moss" />;
    if (k === "transfer")     return <ArrowRight size={11} className="text-amber" />;
    if (k === "thought")      return <Brain size={11} className="text-mute" />;
    if (k === "phase")        return <Sparkles size={11} className="text-rust" />;
    if (k === "session")      return <Sparkles size={11} className="text-ink" />;
    if (k === "error")        return <AlertTriangle size={11} className="text-rust" />;
    return <span className="inline-block h-2 w-2 rounded-full bg-mute" />;
  };

  const fmtAgent = (a: string) => (a || "").replace(/_agent$/, "");

  const totalEvents = events.length;
  return (
    <div className="surface overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h3 className="font-serif text-sm font-bold text-ink">Actividad del análisis</h3>
          <span className="font-mono text-[10px] text-mute">{totalEvents} eventos</span>
        </div>
      </div>
      <div className="max-h-[280px] overflow-y-auto bg-paper px-3 py-2 font-mono text-[11px]">
        {last.map((ev, i) => (
          <div key={i} className="flex items-start gap-2 border-b border-line/40 py-1.5 last:border-0">
            <span className="mt-0.5 shrink-0">{kindIcon(ev.kind)}</span>
            {ev.agent && (
              <span className="shrink-0 rounded bg-paperDeep px-1 py-0 text-[9px] font-bold text-clay">
                {fmtAgent(ev.agent)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              {ev.kind === "tool_call" && (
                <div className="truncate">
                  <span className="font-bold text-ink">{ev.name}</span>
                  <span className="text-mute">(</span>
                  <span className="text-mute">{Object.keys(ev.args || {}).slice(0, 2).join(", ")}</span>
                  <span className="text-mute">)</span>
                </div>
              )}
              {ev.kind === "tool_result" && (
                <div className="truncate">
                  <span className="font-semibold text-moss">↳ {ev.name}</span>
                  <span className="ml-2 text-mute">
                    {Object.keys(ev.result_preview || {}).slice(0, 3).join(" · ") || "ok"}
                  </span>
                </div>
              )}
              {ev.kind === "transfer" && (
                <div className="truncate">
                  <span className="font-bold text-amber">transfer →</span>
                  <span className="ml-1 text-ink">{fmtAgent(ev.to)}</span>
                </div>
              )}
              {ev.kind === "thought" && (
                <ExpandableThought text={ev.text || ""} />
              )}
              {ev.kind === "phase" && (
                <div className="truncate">
                  <span className="font-bold uppercase tracking-wider text-rust">[{ev.name}]</span>
                  <span className="ml-1 text-ink">{ev.msg}</span>
                </div>
              )}
              {ev.kind === "session" && (
                <div className="truncate text-mute">iniciando análisis…</div>
              )}
              {ev.kind === "error" && (
                <div className="line-clamp-2 text-rust">{ev.detail}</div>
              )}
            </div>
          </div>
        ))}
        <div ref={tail} />
      </div>
      {events.length > 30 && (
        <div className="border-t border-line bg-paperSoft px-5 py-1 text-center text-[10px] text-mute">
          mostrando últimos 30 de {events.length} eventos
        </div>
      )}
    </div>
  );
}

// ── Grafo agéntico en CANVAS ──────────────────────────────────────────────
// Nodos por tipo + aristas curvas + PARTÍCULAS que fluyen. El nodo activo
// (paso real en vivo) se enciende con halo pulsante; al terminar queda VERDE.
// Las fuentes se "encienden" cuando el agente activo las consulta. Clickeable:
// muestra qué hace cada nodo. Abajo, panel de HALLAZGOS reales del stream.

// Extrae entidades reales (empresa, RUC, estado, socios, señales) del stream.

// Grafo force-directed. Sin posiciones fijas: la física las acomoda.
// `name` = nombre completo (panel de descubrimiento); `label`/`sub` = dentro del nodo.
const G_NODES: GNode[] = [
  { id: "orch", label: "Orquestador", sub: "Vigía Core", name: "Orquestador · Vigía Core", type: "orch", r: 44,
    sources: ["oece_ocds", "seace"], stores: ["sql"],
    desc: "Recibe el código de la convocatoria, razona el plan global, decide a qué agente llamar y en qué orden, y consolida el veredicto final." },
  // AGENTES
  { id: "compliance", label: "Auditor", sub: "Ley Contrat.", name: "Auditor Normativo", type: "agent", r: 33,
    sources: ["pgvec"], stores: ["sql"],
    desc: "Aplica las reglas duras de la Ley de Contrataciones del Estado: único postor, plazos ilegales, adendas > 25%, contratación directa sin causal." },
  { id: "parser", label: "Lector", sub: "Expediente", name: "Lector de Expediente", type: "agent", r: 31,
    sources: ["seace"], stores: ["sql", "gcs"],
    desc: "Descarga y lee los PDFs del expediente (bases, acta de buena pro, contrato) y extrae ítems, firmantes y comité de selección." },
  { id: "legal", label: "Analista", sub: "Legal · OECE", name: "Analista Legal", type: "agent", r: 31,
    sources: ["pgvec"], stores: ["sql"],
    desc: "Cruza el caso contra 721 opiniones normativas del OECE mediante búsqueda semántica (pgvector) y cita la jurisprudencia aplicable." },
  { id: "market", label: "Tasador", sub: "de Precios", name: "Tasador de Precios", type: "agent", r: 32,
    sources: ["google", "mef"], stores: ["sql"],
    desc: "Tasa cada ítem contra el mercado real (Google Search, en paralelo) y lo compara contra el presupuesto del MEF para detectar sobreprecios." },
  { id: "web", label: "Perfil", sub: "de Empresa", name: "Investigador de Empresa", type: "agent", r: 32,
    sources: ["oece_perfil", "sunat", "uniperu", "google"], stores: ["sql"],
    desc: "Perfila a la empresa adjudicataria: estado y condición en SUNAT, aptitud para contratar, edad del RUC; detecta empresas de fachada." },
  { id: "news", label: "Prensa", sub: "Peruana", name: "Rastreador de Prensa", type: "agent", r: 29,
    sources: ["google"], stores: ["sql"],
    desc: "Rastrea cobertura en prensa peruana sobre la empresa, el funcionario o la obra (OjoPúblico, IDL, Convoca, La República)." },
  { id: "person", label: "Red de", sub: "Personas", name: "Mapa de Red de Personas", type: "agent", r: 34,
    sources: ["rnp", "onpe", "jne", "pep", "visitas"], stores: ["sql"],
    desc: "Mapea socios, representantes y familia; cruza aportes de campaña (ONPE), candidaturas (JNE), PEPs y la base pública de visitas a funcionarios." },
  { id: "entity", label: "Autoridades", sub: "de Entidad", name: "Identificador de Funcionarios", type: "agent", r: 29,
    sources: ["jne"], stores: ["sql"],
    desc: "Identifica a las autoridades y funcionarios vigentes de la entidad contratante a partir de las hojas de vida del JNE." },
  { id: "extended", label: "Cruces", sub: "Avanzados", name: "Cruces Avanzados", type: "agent", r: 30,
    sources: ["onpe", "infobras"], stores: ["sql"],
    desc: "Cruces avanzados: puerta giratoria (funcionario que rota y el proveedor lo sigue), aportes de campaña y sobrecostos vs INFOBRAS." },
  { id: "writer", label: "Redactor", sub: "Dictamen", name: "Redactor del Dictamen", type: "agent", r: 33,
    sources: [], stores: ["sql", "dictamen"],
    desc: "Redacta el dictamen final: cada bandera con su severidad, la norma que cita y su evidencia oficial (URL de SEACE, contrato, opinión OECE)." },
  // FUENTES
  { id: "oece_ocds", label: "OECE", sub: "OCDS", name: "OECE · Contrataciones Abiertas", type: "src", r: 20, desc: "Contrataciones Abiertas del OECE (estándar OCDS): metadata del proceso, ítems, montos y ganador." },
  { id: "oece_perfil", label: "OECE", sub: "Perfil", name: "OECE · Perfil de Proveedor", type: "src", r: 19, desc: "API de perfil de proveedor del OECE: estado, sanciones, inhabilitaciones y aptitud para contratar." },
  { id: "seace", label: "SEACE", name: "SEACE", type: "src", r: 20, desc: "SEACE: documentos del expediente — bases, acta de buena pro y contrato." },
  { id: "sunat", label: "SUNAT", name: "SUNAT", type: "src", r: 18, desc: "SUNAT: estado y condición del RUC de la empresa." },
  { id: "uniperu", label: "Univ.", sub: "Perú", name: "universidadperu.com", type: "src", r: 16, desc: "universidadperu.com: fecha de inicio de actividades y CIIU (actividad económica)." },
  { id: "rnp", label: "RNP", name: "RNP", type: "src", r: 18, desc: "RNP: socios, representantes legales y órganos de administración de la empresa." },
  { id: "onpe", label: "ONPE", name: "ONPE · Claridad", type: "src", r: 18, desc: "ONPE (Portal Claridad): aportes de campaña a los partidos." },
  { id: "jne", label: "JNE", name: "JNE", type: "src", r: 18, desc: "JNE: candidaturas y hojas de vida de autoridades." },
  { id: "pep", label: "PEPs", name: "PEPs", type: "src", r: 16, desc: "Registro de personas expuestas políticamente." },
  { id: "visitas", label: "Visitas", name: "Visitas a Funcionarios", type: "src", r: 17, desc: "Base pública de visitas a funcionarios del Estado." },
  { id: "google", label: "Google", name: "Google Search", type: "src", r: 21, desc: "Google Search: grounding en vivo para precios de mercado, prensa y perfil de empresa." },
  { id: "infobras", label: "INFO", sub: "BRAS", name: "INFOBRAS · Contraloría", type: "src", r: 18, desc: "INFOBRAS (Contraloría): avance físico y financiero de las obras." },
  { id: "mef", label: "MEF", name: "MEF · Consulta Amigable", type: "src", r: 18, desc: "MEF: presupuesto y devengado de la entidad (Consulta Amigable)." },
  // PERSISTENCIA
  { id: "sql", label: "Cloud", sub: "SQL", name: "Cloud SQL", type: "store", r: 24, desc: "Cloud SQL (PostgreSQL + PostGIS): ciclo de vida del proceso, alertas, banderas, RNP y datasets peruanos." },
  { id: "pgvec", label: "pg", sub: "vector", name: "pgvector · RAG legal", type: "store", r: 21, desc: "pgvector dentro de Cloud SQL: 721 opiniones del OECE indexadas para búsqueda semántica." },
  { id: "gcs", label: "Cloud", sub: "Storage", name: "Cloud Storage", type: "store", r: 19, desc: "Cloud Storage: documentos del expediente archivados." },
  { id: "dictamen", label: "Dictamen", name: "Dictamen final", type: "store", r: 25, desc: "Dictamen final con todas las banderas, sus normas y su evidencia oficial — listo para un periodista o fiscal." },
];
const G_EDGES: Array<{ from: string; to: string }> = [];
G_NODES.forEach((n) => {
  (n.sources || []).forEach((s) => G_EDGES.push({ from: s, to: n.id }));
  (n.stores || []).forEach((s) => G_EDGES.push({ from: n.id, to: s }));
});
AGENT_IDS.forEach((a) => G_EDGES.push({ from: "orch", to: a }));

// ── TRACE AGÉNTICO ──────────────────────────────────────────────────────────
// Deriva del stream REAL los pasos "agente → (verbo) → destino · qué hace".
// Cada `transfer` del orquestador y cada `tool_call` de un agente se vuelve un
// paso narrado. Es lo que se anima en el grafo y se escribe en la narración.

function FlowGraph({ liveEvents = [] }: { liveEvents?: any[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<string | null>(null);
  const selRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "orch" | "agent" | "src" | "store">("all");

  const findings = extractFindings(liveEvents);
  const trace = buildTrace(liveEvents);
  const curStep = trace.length ? trace[trace.length - 1] : null;
  // Estado del grafo derivado del TRACE REAL: qué agente trabaja ahora, cuáles terminaron.
  let activeId = "orch";
  if (curStep) {
    if (AGENT_IDS.includes(curStep.f)) activeId = curStep.f;
    else if (curStep.f === "orch" && AGENT_IDS.includes(curStep.t)) activeId = curStep.t;
  }
  const doneSet = new Set<string>();
  trace.forEach((s) => {
    if (AGENT_IDS.includes(s.f)) doneSet.add(s.f);
    if (s.f === "orch" && AGENT_IDS.includes(s.t)) doneSet.add(s.t);
  });
  doneSet.delete(activeId);

  // refs leídos por el rAF loop
  const findRef = useRef(findings); findRef.current = findings;
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const doneRef = useRef(doneSet); doneRef.current = doneSet;
  const curRef = useRef(curStep); curRef.current = curStep;
  const filterRef = useRef(filter); filterRef.current = filter;

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap) return;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const FONT = "'Syne', system-ui, sans-serif";
    let raf = 0, CW = 0, CH = 0, prevActive: string | null = null, frame = 0;
    type SN = GNode & { x: number; y: number; vx: number; vy: number };
    let sn: SN[] = [];
    let particles: Array<{ from: string; to: string; t: number; speed: number; color: string }> = [];
    const gn = (id: string) => sn.find((n) => n.id === id);
    const visible = (n: SN) => filterRef.current === "all" ? true
      : filterRef.current === "orch" ? (n.type === "orch" || n.type === "agent")
      : (n.type === filterRef.current || n.type === "orch");

    function resize() {
      CW = wrap!.clientWidth; CH = wrap!.clientHeight;
      canvas!.width = CW * dpr; canvas!.height = CH * dpr;
      canvas!.style.width = CW + "px"; canvas!.style.height = CH + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function initSim() {
      const cx = CW / 2 - 150, cy = CH / 2;
      const byType: Record<string, GNode[]> = {};
      G_NODES.forEach((n) => { (byType[n.type] = byType[n.type] || []).push(n); });
      const R = Math.min(CW, CH);
      const ringR: Record<string, number> = { orch: 0, agent: R * 0.24, store: R * 0.34, src: R * 0.46 };
      sn = G_NODES.map((n) => {
        const peers = byType[n.type]; const i = peers.indexOf(n); const total = peers.length;
        let angle = 0;
        if (n.type === "agent") angle = (i / total) * Math.PI * 2 - Math.PI / 2;
        else if (n.type === "src") angle = (i / total) * Math.PI * 2 - Math.PI / 4;
        else if (n.type === "store") angle = (i / total) * Math.PI * 2 + Math.PI / 6;
        const r = ringR[n.type] || 0; const jit = (Math.random() - 0.5) * 30;
        return { ...n, x: cx + Math.cos(angle) * r + jit, y: cy + Math.sin(angle) * r + jit, vx: 0, vy: 0 } as SN;
      });
    }
    function physics() {
      const cx = CW / 2 - 150, cy = CH / 2;
      const vis = sn.filter(visible);
      for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i], b = vis[j]; const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minD = (a.r + b.r) * 2.7 + 26;
        if (dist < minD) { const f = (minD - dist) / dist * 0.11; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f; }
      }
      G_EDGES.forEach((e) => {
        const a = gn(e.from), b = gn(e.to); if (!a || !b || !visible(a) || !visible(b)) return;
        const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.sqrt(dx * dx + dy * dy) || 0.01; const R = Math.min(CW, CH);
        let target = 190;
        if ((a.type === "orch" && b.type === "agent") || (a.type === "agent" && b.type === "orch")) target = R * 0.23;
        else if (a.type === "agent" && b.type === "store") target = R * 0.17;
        else if (a.type === "src" && b.type === "agent") target = R * 0.19;
        const f = (dist - target) / dist * 0.014; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      });
      vis.forEach((n) => { n.vx += (cx - n.x) * 0.0028; n.vy += (cy - n.y) * 0.0028; });
      sn.forEach((n) => {
        n.vx *= 0.78; n.vy *= 0.78; n.x += n.vx; n.y += n.vy;
        const maxX = CW - 318, pad = n.r + 18;
        if (n.x < pad) { n.x = pad; n.vx *= -0.3; } if (n.x > maxX - pad) { n.x = maxX - pad; n.vx *= -0.3; }
        if (n.y < pad + 8) { n.y = pad + 8; n.vy *= -0.3; } if (n.y > CH - pad - 44) { n.y = CH - pad - 44; n.vy *= -0.3; }
      });
    }
    function spawn(fromId: string, toId: string, color: string) {
      const a = gn(fromId), b = gn(toId); if (!a || !b) return;
      for (let k = 0; k < 2; k++) particles.push({ from: fromId, to: toId, t: k * 0.14, speed: 0.011 + Math.random() * 0.006, color });
    }
    function emitForActive() {
      const id = activeRef.current; const n = gn(id); if (!n) return;
      (n.sources || []).forEach((s) => spawn(s, id, G_COLOR.src.stroke));
      if (n.type === "agent") spawn("orch", id, G_COLOR.orch.stroke);
      (n.stores || []).forEach((s) => spawn(id, s, G_COLOR.store.stroke));
    }

    function draw() {
      ctx!.clearRect(0, 0, CW, CH);
      // grid sutil
      ctx!.save(); ctx!.strokeStyle = "rgba(70,56,30,0.04)"; ctx!.lineWidth = 1;
      for (let x = 0; x < CW; x += 36) { ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, CH); ctx!.stroke(); }
      for (let y = 0; y < CH; y += 36) { ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(CW, y); ctx!.stroke(); }
      ctx!.restore();

      const sel = selRef.current, active = activeRef.current, done = doneRef.current, f = findRef.current;
      let selEdges: Set<string> | null = null, selConns: Set<string> | null = null;
      if (sel) {
        selEdges = new Set(); selConns = new Set([sel]);
        G_EDGES.forEach((e) => { if (e.from === sel || e.to === sel) { selEdges!.add(e.from + ">" + e.to); selConns!.add(e.from); selConns!.add(e.to); } });
      }

      // aristas — VERDE animado cuando el nodo activo está intercambiando info
      const activeNode = gn(active);
      const exchSet = new Set<string>();
      if (activeNode) {
        (activeNode.sources || []).forEach((s) => exchSet.add(s));
        if (activeNode.type === "agent") exchSet.add("orch");
        (activeNode.stores || []).forEach((s) => exchSet.add(s));
      }
      const liveEdge = (e: { from: string; to: string }) =>
        !sel && ((e.from === active && exchSet.has(e.to)) || (e.to === active && exchSet.has(e.from)));
      const dashPhase = -(Date.now() / 38) % 1024;
      const flowPulse = 0.6 + 0.4 * Math.sin(Date.now() / 240);
      G_EDGES.forEach((e) => {
        const a = gn(e.from), b = gn(e.to); if (!a || !b || !visible(a) || !visible(b)) return;
        const isSel = selEdges && selEdges.has(e.from + ">" + e.to);
        const live = liveEdge(e);
        const dimmed = sel && !isSel;
        const ca = (G_COLOR[a.type] || G_COLOR.src).stroke, cb = (G_COLOR[b.type] || G_COLOR.src).stroke;
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
        ctx!.save();
        if (live) {
          // intercambio ACTIVO: verde vivo, marching-ants + glow pulsante
          ctx!.globalAlpha = 0.5 + 0.45 * flowPulse;
          ctx!.lineWidth = 2.6;
          ctx!.strokeStyle = G_FLOW;
          ctx!.shadowColor = G_FLOW; ctx!.shadowBlur = 11;
          ctx!.setLineDash([7, 8]); ctx!.lineDashOffset = dashPhase;
        } else if (isSel) {
          ctx!.globalAlpha = 0.85; ctx!.lineWidth = 1.8;
          const g = ctx!.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, ca); g.addColorStop(1, cb); ctx!.strokeStyle = g;
        } else {
          // idle: gradiente tenue POR TIPO (más color que el marrón uniforme)
          ctx!.globalAlpha = dimmed ? 0.05 : 0.3;
          ctx!.lineWidth = 0.9;
          const g = ctx!.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, ca + "99"); g.addColorStop(1, cb + "99"); ctx!.strokeStyle = g;
          ctx!.setLineDash([3, 5]);
        }
        ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.quadraticCurveTo(mx, my, b.x, b.y); ctx!.stroke();
        if (isSel) {
          ctx!.setLineDash([]); const t = 0.87;
          const qx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, qy = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
          const ang = Math.atan2(b.y - qy, b.x - qx); const tip = b.r;
          const ax = b.x - Math.cos(ang) * tip, ay = b.y - Math.sin(ang) * tip;
          ctx!.strokeStyle = cb; ctx!.lineWidth = 1.7;
          ctx!.beginPath();
          ctx!.moveTo(ax - Math.cos(ang - 0.42) * 8, ay - Math.sin(ang - 0.42) * 8); ctx!.lineTo(ax, ay); ctx!.lineTo(ax - Math.cos(ang + 0.42) * 8, ay - Math.sin(ang + 0.42) * 8);
          ctx!.stroke();
        }
        ctx!.restore();
      });

      // partículas
      particles.forEach((p) => {
        const a = gn(p.from), b = gn(p.to); if (!a || !b || !visible(a) || !visible(b)) return;
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08; const t = p.t;
        const px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
        ctx!.save(); ctx!.globalAlpha = 0.95 * (1 - t * 0.35); ctx!.shadowColor = p.color; ctx!.shadowBlur = 9; ctx!.fillStyle = p.color;
        ctx!.beginPath(); ctx!.arc(px, py, 3.4, 0, Math.PI * 2); ctx!.fill(); ctx!.restore();
      });

      // nodos
      sn.forEach((n) => {
        if (!visible(n)) return;
        const c = G_COLOR[n.type] || G_COLOR.src;
        const isActive = active === n.id, isDone = !isActive && done.has(n.id);
        const isSel = sel === n.id, isHov = hoverRef.current === n.id;
        const dimmed = sel && selConns && !selConns.has(n.id);
        const r = n.r + (isHov && !dimmed ? 2 : 0);
        ctx!.save(); ctx!.globalAlpha = dimmed ? 0.16 : 1;
        if (isActive || isSel) { ctx!.shadowColor = c.stroke; ctx!.shadowBlur = isSel ? 26 : 18; }
        ctx!.beginPath(); ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = isDone ? G_DONE.fill : "#fffdf7";
        ctx!.fill(); ctx!.shadowBlur = 0;
        ctx!.strokeStyle = isDone ? G_DONE.stroke : (isActive || isSel) ? c.stroke : c.stroke + "66";
        ctx!.lineWidth = (isActive || isSel) ? 2.4 : 1.2; ctx!.stroke();
        // spinner activo
        if (isActive && !isDone) {
          const ang = (Date.now() / 520) % (Math.PI * 2);
          ctx!.beginPath(); ctx!.arc(n.x, n.y, r + 6, ang, ang + Math.PI * 1.3); ctx!.strokeStyle = c.stroke; ctx!.lineWidth = 2.6; ctx!.stroke();
        }
        // etiqueta
        const baseSub = n.sub;
        let sub = baseSub;
        if (n.id === "web" && f.empresa) sub = String(f.empresa).split(" ").slice(0, 2).join(" ");
        else if (n.id === "sunat" && f.estado) sub = String(f.estado).toLowerCase();
        else if (n.id === "person" && f.socios.length) sub = `${f.socios.length} socios`;
        else if (n.id === "sql" && f.senales.length) sub = `${f.senales.length} señales`;
        const lines = [n.label]; if (sub) lines.push(sub);
        const fs = n.type === "orch" ? 13 : n.r > 30 ? 12 : n.r > 22 ? 11 : n.r > 17 ? 10 : 9;
        ctx!.textAlign = "center"; ctx!.textBaseline = "middle";
        ctx!.fillStyle = dimmed ? "#bcb3a0" : isDone ? G_DONE.text : (isActive || isSel) ? c.stroke : "#3a3324";
        ctx!.font = `${n.type === "orch" ? "800" : "700"} ${fs}px ${FONT}`;
        lines.forEach((line, i) => { const lh = fs + 2; const yOff = (i - (lines.length - 1) / 2) * lh; ctx!.fillText(line, n.x, n.y + yOff); });
        if (isDone) { ctx!.fillStyle = G_DONE.stroke; ctx!.font = `${Math.max(r * 0.5, 10)}px sans-serif`; ctx!.fillText("✓", n.x + r * 0.62, n.y - r * 0.62); }
        ctx!.restore();
      });
    }

    function loop() {
      frame++;
      if (activeRef.current !== prevActive) { prevActive = activeRef.current; emitForActive(); }
      if (frame % 64 === 0) emitForActive();
      particles = particles.filter((p) => { p.t += p.speed; return p.t < 1; });
      physics(); draw();
      raf = requestAnimationFrame(loop);
    }
    function pick(ev: MouseEvent): SN | null {
      const rect = canvas!.getBoundingClientRect(); const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      let hit: SN | null = null;
      sn.forEach((n) => { if (visible(n) && Math.hypot(mx - n.x, my - n.y) < n.r + 8) hit = n; });
      return hit;
    }
    const onMove = (ev: MouseEvent) => { const h = pick(ev); hoverRef.current = h ? h.id : null; canvas.style.cursor = h ? "pointer" : "default"; };
    const onClick = (ev: MouseEvent) => { const h = pick(ev); const id = h && h.id === selRef.current ? null : (h ? h.id : null); selRef.current = id; setSelected(id); };

    resize(); initSim(); emitForActive();
    raf = requestAnimationFrame(loop);
    const onResize = () => { resize(); initSim(); };
    window.addEventListener("resize", onResize);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); canvas.removeEventListener("mousemove", onMove); canvas.removeEventListener("click", onClick); };
  }, []);

  const fmtRegla = (r: string) => r.replace(/_/g, " ");
  const nm = (id: string) => G_NODES.find((n) => n.id === id)?.name || id;
  const stroke = (id: string) => (G_COLOR[G_NODES.find((n) => n.id === id)?.type || "src"] || G_COLOR.src).stroke;
  const selNode = selected ? G_NODES.find((n) => n.id === selected) : null;
  const conns = selNode ? [...(selNode.sources || []), ...(selNode.stores || [])].map(nm) : [];
  const recent = trace.slice(-6).reverse();
  const FILTERS: Array<{ k: typeof filter; label: string }> = [
    { k: "all", label: "Todo" }, { k: "orch", label: "Núcleo" }, { k: "agent", label: "Agentes" }, { k: "src", label: "Fuentes" }, { k: "store", label: "Datos" },
  ];

  return (
    <div ref={wrapRef} className="relative h-[560px] w-full overflow-hidden rounded-2xl border border-line sm:h-[640px]"
      style={{ background: "radial-gradient(900px 500px at 78% -10%, #fbf7ee, transparent), radial-gradient(800px 500px at 10% 110%, #efe6d4, transparent), #f3ede1" }}>
      <canvas ref={canvasRef} className="absolute inset-0 block" />

      {/* filtros */}
      <div className="absolute left-3 top-3 z-10 flex gap-1.5">
        {FILTERS.map((ff) => (
          <button key={ff.k} onClick={() => { setFilter(ff.k); setSelected(null); selRef.current = null; }}
            className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] backdrop-blur transition-colors ${filter === ff.k ? "border-line2 bg-paperSoft font-semibold text-ink" : "border-line bg-paperSoft/70 text-mute hover:text-ink"}`}>
            {ff.label}
          </button>
        ))}
      </div>

      {/* PANEL LATERAL DE DESCUBRIMIENTO */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex max-h-[calc(100%-90px)] w-[286px] flex-col gap-2.5 overflow-y-auto">
        {/* Descubrimiento */}
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3.5 shadow-lg backdrop-blur">
          <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-mute">Descubrimiento</div>
          {selNode ? (
            <>
              <div className="font-serif text-[17px] font-bold leading-tight" style={{ color: stroke(selNode.id) }}>{selNode.name}</div>
              <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold tracking-wider"
                style={{ background: stroke(selNode.id) + "1f", color: stroke(selNode.id), border: `1px solid ${stroke(selNode.id)}55` }}>{TYPE_LABEL[selNode.type]}</span>
              <p className="mt-2 text-[12px] leading-relaxed text-ink/75">{selNode.desc}</p>
              {conns.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {conns.map((c, i) => <span key={i} className="rounded-md border border-line bg-paperDeep/60 px-2 py-0.5 font-mono text-[9px] text-mute">{c}</span>)}
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] leading-relaxed text-dim">Haz clic en un nodo para ver qué es, qué hace y con qué se conecta.</p>
          )}
        </div>

        {/* Hallazgos en vivo */}
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3.5 shadow-lg backdrop-blur">
          <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-clay">Hallazgos en vivo</div>
          {(findings.empresa || findings.entidad || findings.socios.length > 0 || findings.senales.length > 0) ? (
            <div className="flex flex-col gap-2 text-[12px]">
              {findings.entidad && <div><span className="font-mono text-[9px] uppercase tracking-wide text-mute">entidad</span> <span className="font-semibold text-ink">{findings.entidad}</span></div>}
              {findings.empresa && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-mute">empresa</span>
                  <span className="font-semibold text-ink">{findings.empresa}</span>
                  {findings.ruc && <span className="rounded-full border border-line bg-paperDeep/60 px-2 py-0.5 font-mono text-[9px] text-mute">RUC {findings.ruc}</span>}
                  {findings.estado && <span className="rounded-full bg-moss/10 px-2 py-0.5 text-[9px] font-bold text-moss">{findings.estado}</span>}
                  {findings.apto === false && <span className="rounded-full bg-crimson-soft px-2 py-0.5 text-[9px] font-bold text-rust">NO APTO</span>}
                  {typeof findings.n_sanciones === "number" && findings.n_sanciones > 0 && <span className="rounded-full bg-crimson-soft px-2 py-0.5 text-[9px] font-bold text-rust">{findings.n_sanciones} sanciones</span>}
                </div>
              )}
              {findings.socios.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-mute">socios</span>
                  {findings.socios.slice(0, 6).map((s: string, i: number) => <span key={i} className="rounded-md border border-line bg-paperDeep/60 px-2 py-0.5 text-[11px] text-ink">{s}</span>)}
                </div>
              )}
              {findings.senales.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-mute">señales</span>
                  {findings.senales.slice(0, 6).map((s: string, i: number) => <span key={i} className="rounded-full bg-crimson-soft px-2 py-0.5 text-[10px] font-bold text-rust">{fmtRegla(s)}</span>)}
                </div>
              )}
            </div>
          ) : <p className="text-[12px] text-dim">Aún sin hallazgos…</p>}
        </div>

        {/* Traza de invocaciones (compacta: verbo + acción, sin prefijo redundante) */}
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3 shadow-lg backdrop-blur">
          <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-mute">Traza · últimos pasos</div>
          {recent.length ? (
            <div className="flex flex-col gap-1">
              {recent.slice(-6).map((s, i) => (
                <div key={i} className="flex items-baseline gap-1.5 text-[10px] leading-snug text-mute">
                  <span className="shrink-0 font-mono font-bold" style={{ color: VERB_HEX[s.v] }}>{s.v}</span>
                  <span className="truncate">{s.m}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[11px] text-dim">Esperando el primer paso…</p>}
        </div>

        {/* Leyenda */}
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3.5 shadow-lg backdrop-blur">
          <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-mute">Leyenda</div>
          <div className="flex flex-col gap-1.5 text-[12px] text-mute">
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.orch.stroke }} />Orquestador (núcleo)</div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.agent.stroke }} />Agente especializado</div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.src.stroke }} />Fuente de datos</div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.store.stroke }} />Persistencia</div>
          </div>
        </div>
      </div>

      {/* BARRA DE NARRACIÓN (paso actual) */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex max-w-[calc(100%-320px)] items-center gap-3 rounded-full border border-line bg-paperSoft/95 px-5 py-2.5 shadow-lg backdrop-blur">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: curStep ? VERB_HEX[curStep.v] : G_COLOR.orch.stroke }} />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: curStep ? VERB_HEX[curStep.v] : G_COLOR.orch.stroke }} />
        </span>
        {curStep ? (
          <span className="truncate font-serif text-[14px] font-semibold text-ink">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: VERB_HEX[curStep.v] }}>{curStep.v}</span>
            {" "}<span style={{ color: stroke(curStep.f) }}>{nm(curStep.f)}</span> {curStep.m}
          </span>
        ) : (
          <span className="font-serif text-[14px] font-semibold text-ink">Orquestador · armando el plan y despachando a los agentes…</span>
        )}
      </div>
    </div>
  );
}

// Tracking RICO en vivo: mismos pasos detallados (TOOL_CALL/TOOL_RESULT con
// args + JSON de salida expandible) que el resultado final, pero durante el
// proceso. Reusa AgentTraceRow sobre el stream liveEvents y auto-scrollea.
function LiveTracePanel({ events }: { events: any[] }) {
  const KINDS = ["tool_call", "tool_result", "transfer", "thought", "error"];
  const steps = events.filter((e) => e && KINDS.includes(e.kind));
  const last = steps.slice(-24);
  const tail = useRef<HTMLDivElement | null>(null);
  // Auto-scroll SOLO si el usuario ya está cerca del fondo (no lo arrastramos si subió a leer).
  useEffect(() => {
    const el = tail.current;
    if (el && el.getBoundingClientRect().top <= window.innerHeight + 300)
      el.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps.length]);
  let nTools = 0, nRes = 0;
  for (const e of events) { if (e.kind === "tool_call") nTools++; else if (e.kind === "tool_result") nRes++; }
  return (
    <section className="surface overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="h-1.5 w-1.5 animate-pulse self-center rounded-full bg-moss" />
          <h3 className="font-serif text-sm font-bold text-ink">Tracking del análisis · en vivo</h3>
          <span className="font-mono text-[10px] text-mute">{steps.length} pasos</span>
        </div>
        <div className="flex gap-1.5 font-mono text-[9px]">
          {nTools > 0 && <span className="rounded bg-amber-soft px-1.5 py-0.5 font-bold text-amber">{nTools} tool calls</span>}
          {nRes > 0 && <span className="rounded bg-moss/10 px-1.5 py-0.5 font-bold text-moss">{nRes} resultados</span>}
        </div>
      </div>
      <ol className="max-h-[440px] divide-y divide-line overflow-y-auto">
        {last.map((e, i) => <AgentTraceRow key={i} idx={steps.length - last.length + i} ev={e} />)}
        <div ref={tail} />
      </ol>
      {steps.length > 24 && (
        <div className="border-t border-line bg-paperSoft px-5 py-1 text-center text-[10px] text-mute">
          mostrando últimos 24 de {steps.length} pasos
        </div>
      )}
    </section>
  );
}

function LoadingView({ stepIdx, elapsed, codigo, liveEvents = [] }: { stepIdx: number; elapsed: number; codigo: string; liveEvents?: any[] }) {
  // Progreso global basado en elapsed vs total estimado
  const totalEta = STEPS.reduce((s, x) => s + x.eta_s, 0);
  // Inferir step real desde el stream; si no hay eventos, usar el del ETA.
  const inferredIdx = inferStepFromEvents(liveEvents);
  const effectiveStep = inferredIdx >= 0 ? Math.max(inferredIdx, stepIdx) : stepIdx;
  // Progreso: si hay eventos, usar el step real; sino mezclar con elapsed.
  const stepProgressPct = effectiveStep >= 0 ? Math.round(((effectiveStep + 1) / STEPS.length) * 100) : 0;
  const elapsedProgressPct = Math.round((elapsed / totalEta) * 100);
  const progressPct = Math.min(99, Math.max(stepProgressPct, elapsedProgressPct));
  // Agrupar pasos por "lane" (swimlane del BPMN)
  const lanes = Array.from(new Set(STEPS.map(s => s.lane))) as string[];
  const stepsByLane: Record<string, Array<{ step: typeof STEPS[number]; globalIdx: number }>> = {};
  for (const lane of lanes) stepsByLane[lane] = [];
  STEPS.forEach((s, i) => stepsByLane[s.lane].push({ step: s, globalIdx: i }));

  const LANE_VISUAL: Record<string, { color: string; label: string; bar: string }> = {
    ingesta:        { color: "text-amber",  label: "Ingesta",        bar: "bg-amber/30" },
    auditoría:      { color: "text-rust",   label: "Auditoría",      bar: "bg-rust/30" },
    investigación: { color: "text-clay",   label: "Investigación",  bar: "bg-clay/30" },
    dictamen:       { color: "text-moss",   label: "Dictamen",       bar: "bg-moss/30" },
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="surface relative isolate overflow-hidden p-6 sm:p-8">
        <div aria-hidden className="absolute -right-20 -top-20 -z-10 h-60 w-60 rounded-full bg-amber/15 blur-3xl" />
        <div aria-hidden className="absolute -left-32 -bottom-32 -z-10 h-80 w-80 rounded-full bg-clay/10 blur-3xl" />

        {/* HEADER */}
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-soft px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
              procesando · {elapsed}s / ≈{Math.round(totalEta/60)}min
            </div>
            <h2 className="mt-2 font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">
              Flujo agéntico Vigía
            </h2>
            <p className="mt-0.5 font-mono text-xs text-mute">convocatoria {codigo} · {STEPS.length} pasos</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-3xl font-bold tabular-nums text-clay">{progressPct}%</div>
            <div className="text-[10px] uppercase tracking-widest text-mute">progreso estimado</div>
          </div>
        </div>

        {/* PROGRESS BAR GLOBAL */}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-paperDeep">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber via-clay to-moss transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>


        {/* CONTADOR DE HALLAZGOS EN VIVO */}
        {(() => {
          const findings = countFindings(liveEvents);
          if (findings <= 0) return null;
          return (
            <div className="mt-3 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-rust/30 bg-crimson-soft/50 px-4 py-1.5 text-[12px] font-bold text-rust">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rust" />
                <span className="font-mono tabular-nums text-sm">{findings}</span>
                {findings === 1 ? "señal de riesgo detectada" : "señales de riesgo detectadas"}
              </span>
            </div>
          );
        })()}

        {/* GRAFO AGÉNTICO EN VIVO — force-directed, panel lateral de descubrimiento, narración en vivo */}
        <div className="mt-5">
          <FlowGraph liveEvents={liveEvents} />
        </div>

        <div className="mt-5">
          <ObservabilidadPanel liveEvents={liveEvents} />
        </div>

      </div>

      {/* HALLAZGOS EN VIVO (stream NDJSON desde el orquestador) */}
      {liveEvents.length > 0 && <LiveTracePanel events={liveEvents} />}
    </div>
  );
}

// ─── RESULTADO ───────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════
// ShareableHeader — header con código + monto + botones compartir/volver
// ════════════════════════════════════════════════════════════════════

function ShareableHeader({
  conv,
  codigo,
  nAlta,
  totalSec,
  eventsADK,
  onReset,
}: {
  conv: any;
  codigo: string;
  nAlta: number;
  totalSec?: number;
  eventsADK: number;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  const handleShare = async () => {
    try {
      const url = `${typeof window !== "undefined" ? window.location.origin : ""}/app/convocatoria/${codigo}`;
      if (navigator.share) {
        await navigator.share({
          title: `Vigía Perú · ${conv.objeto?.slice(0, 80) || "Análisis"}`,
          text: `Análisis automático de la convocatoria ${codigo}: ${nAlta} bandera${nAlta === 1 ? "" : "s"} de alta severidad. Verificalo:`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // user cancelled share dialog
    }
  };

  const oeceUrl = oeceProcesoUrl(conv.ocid || codigo);

  return (
    <header className="surface px-4 py-3">
      {/* TOP ROW: código + acciones */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-mute">#{codigo}</span>
        {conv.fecha_fin && (
          <span className="text-[11px] text-mute">· Buena pro {conv.fecha_fin}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[10px] font-semibold text-ink hover:bg-paperDeep"
            title="Nueva búsqueda"
          >
            <RotateCcw size={10} /> Nueva
          </button>
          <a
            href={oeceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[10px] font-semibold text-ink hover:bg-paperDeep"
            title="Ver en portal oficial OECE"
          >
            <ExternalLink size={10} /> OECE
          </a>
          <button
            type="button"
            onClick={handleShare}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold text-paper transition-colors",
              copied ? "bg-moss" : "bg-clay hover:bg-clay/90",
            )}
            title={copied ? "Link copiado" : "Copiar link compartible"}
          >
            {copied ? (
              <><CheckCircle2 size={11} /> Copiado</>
            ) : (
              <><Sparkles size={11} /> Compartir</>
            )}
          </button>
        </span>
      </div>

      {/* OBJETO — h2 más compacto */}
      <h1 className="mt-2 font-serif text-lg font-bold leading-snug text-ink sm:text-xl">
        {conv.objeto}
      </h1>
    </header>
  );
}

// ════════════════════════════════════════════════════════════════════
// ResumenHumano — overview ejecutivo con score, monto, ganador y top flags
// ════════════════════════════════════════════════════════════════════

function ResumenHumano({
  conv,
  ganador,
  nAlta,
  nMedia,
  nBaja,
  banderasArr,
  fmtMoney,
  onClickResumen,
}: {
  conv: any;
  ganador: any;
  nAlta: number;
  nMedia: number;
  nBaja: number;
  banderasArr: any[];
  fmtMoney: (n: any) => string;
  onClickResumen: () => void;
}) {
  const total = nAlta + nMedia + nBaja;
  const riesgo: "alto" | "medio" | "bajo" | "limpio" =
    nAlta > 0 ? "alto" : nMedia > 0 ? "medio" : total === 0 ? "limpio" : "bajo";

  const VIS: Record<typeof riesgo, { label: string; color: string; bg: string; border: string }> = {
    alto:    { label: "Riesgo alto",       color: "text-rust",  bg: "bg-rust",  border: "border-rust/40"  },
    // "Requiere revisión" chocaba con el estado formal `alertas.estado='revision'` (la
    // autoevaluación bloqueando la publicación, con su propia cola en /admin/revision) — esto
    // acá es solo "hay una bandera de severidad media", nada bloqueado ni pendiente de nadie.
    medio:   { label: "Señal media",       color: "text-amber", bg: "bg-amber", border: "border-amber/40" },
    bajo:    { label: "Observaciones menores", color: "text-clay",  bg: "bg-clay",  border: "border-clay/30"  },
    limpio:  { label: "Sin hallazgos",     color: "text-moss",  bg: "bg-moss",  border: "border-moss/30"  },
  };
  const vis = VIS[riesgo];

  // Montos: referencial (lo que el Estado presupuestó) vs adjudicado (lo que se pagará)
  const referencial = Number(conv.cuantia_total || 0);
  const adjudicado = Number(ganador?.monto_ganado || 0);
  const hayAdjudicado = adjudicado > 0;
  const variacion = hayAdjudicado && referencial > 0 ? ((adjudicado - referencial) / referencial) * 100 : null;

  // Top 2 banderas (priorizando alta/media)
  const top = [...banderasArr]
    .sort((a, b) => {
      const order: Record<string, number> = { alta: 0, media: 1, baja: 2 };
      return (order[(a.severidad || "media").toLowerCase()] ?? 1) -
             (order[(b.severidad || "media").toLowerCase()] ?? 1);
    })
    .slice(0, 2);

  // Caption con label + tooltip via title
  const Stat = ({ label, value, hint, valueClass, sublabel }: {
    label: string; value: React.ReactNode; hint: string; valueClass?: string; sublabel?: React.ReactNode;
  }) => (
    <div className="p-3" title={hint}>
      <div className="text-[10px] font-medium text-mute">{label}</div>
      <div className={cn("mt-0.5 font-mono text-lg font-bold tabular-nums leading-tight", valueClass || "text-ink")}>
        {value}
      </div>
      {sublabel && <div className="mt-0.5 text-[10px] text-mute">{sublabel}</div>}
    </div>
  );

  return (
    <section className={cn("surface overflow-hidden p-0", vis.border, "border-2")}>
      {/* HEADER: badge severidad inline · sin uppercase shouty */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paperDeep px-4 py-2">
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-paper",
          vis.bg,
        )}>
          {riesgo === "limpio" ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} className={riesgo === "alto" ? "animate-pulse" : ""} />}
          {vis.label}
        </span>
        {nAlta > 0 && (
          <span className="rounded-full bg-rust px-1.5 py-0 text-[10px] font-bold text-paper">{nAlta} alta</span>
        )}
        {nMedia > 0 && (
          <span className="rounded-full bg-amber px-1.5 py-0 text-[10px] font-bold text-paper">{nMedia} media</span>
        )}
        {nBaja > 0 && (
          <span className="rounded-full bg-paperSoft px-1.5 py-0 text-[10px] font-bold text-mute">{nBaja} baja</span>
        )}
        <button
          onClick={onClickResumen}
          className={cn("ml-auto inline-flex items-center gap-1 text-[10px] font-bold hover:underline", vis.color)}
        >
          Ver evidencia <ChevronRight size={11} />
        </button>
      </div>

      {/* MONTOS — 2 columnas con labels claros + variación */}
      <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
        <Stat
          label="Presupuesto del Estado"
          value={fmtMoney(referencial)}
          hint="Valor referencial publicado por la entidad (lo que planeaba gastar)."
          sublabel="referencial"
        />
        {hayAdjudicado ? (
          <Stat
            label="Monto adjudicado"
            value={fmtMoney(adjudicado)}
            hint="Lo que finalmente se pagará al ganador."
            valueClass={variacion != null && variacion > 5 ? "text-rust" : variacion != null && variacion < -5 ? "text-moss" : "text-ink"}
            sublabel={
              variacion == null || Math.abs(variacion) < 0.1 ? (
                <span className="text-mute">igual al presupuesto</span>
              ) : (
                <span className={cn(
                  "font-mono font-bold",
                  variacion > 0 ? "text-rust" : "text-moss",
                )}>
                  {variacion > 0 ? "+" : ""}{variacion.toFixed(1)}%
                  <span className="ml-1 font-sans font-normal text-mute">
                    {variacion > 0 ? "sobre presupuesto" : "de ahorro"}
                  </span>
                </span>
              )
            }
          />
        ) : (
          <Stat
            label="Monto adjudicado"
            value={<span className="text-base font-normal italic text-mute">pendiente</span>}
            hint="Aún no se publica la adjudicación."
          />
        )}
      </div>

      {/* QUIÉN — entidad → empresa, 2 columnas */}
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="p-3" title="Entidad pública que convoca y pagará el contrato.">
          <div className="text-[10px] font-medium text-mute">Entidad que contrata</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink">
            {conv.entidad || "—"}
          </div>
          {conv.region && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-mute">
              <MapPin size={9} /> {conv.region}
            </div>
          )}
        </div>
        <div className="p-3" title="Empresa privada que ganó la buena pro y ejecutará el contrato.">
          <div className="text-[10px] font-medium text-mute">Empresa ganadora</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink">
            {ganador?.nombre || <span className="italic text-mute">Sin adjudicación</span>}
          </div>
          {ganador?.ruc && (
            <div className="mt-0.5 font-mono text-[10px] text-clay">RUC {ganador.ruc}</div>
          )}
        </div>
      </div>

      {/* TOP HALLAZGOS */}
      {top.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-4 py-2.5">
          <div className="mb-1 text-[10px] font-medium text-mute">Hallazgos prioritarios</div>
          <ul className="space-y-1">
            {top.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-snug text-ink">
                <span className={cn(
                  "mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  (b.severidad || "").toLowerCase() === "alta"  && "bg-rust",
                  (b.severidad || "").toLowerCase() === "media" && "bg-amber",
                  (b.severidad || "").toLowerCase() === "baja"  && "bg-mute",
                )} />
                <span className="line-clamp-2">{redactDnis(b.evidencia || b.regla)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

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



