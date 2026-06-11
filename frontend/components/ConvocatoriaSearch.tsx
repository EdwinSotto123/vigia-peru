"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
function countFindings(events: any[]): number {
  if (!events?.length) return 0;
  let contextual = 0, persisted = 0;
  for (const ev of events) {
    if (ev.kind === "tool_call" && ev.name === "add_contextual_flag") contextual++;
    const rp = ev.result_preview;
    if (ev.kind === "tool_result" && rp && typeof rp === "object") {
      for (const k of ["banderas_persistidas", "n_pending_total", "banderas", "n_banderas", "persistidas"]) {
        const v = (rp as any)[k];
        if (typeof v === "number" && v > persisted) persisted = v;
      }
    }
  }
  return Math.max(contextual, persisted);
}

interface AgentTraceEvent {
  agent?: string;
  kind?: "tool_call" | "tool_result" | "transfer" | "thought" | "error";
  name?: string;
  args?: Record<string, any>;
  result_preview?: any;
  to?: string;
  text?: string;
  detail?: string;
}

interface ApiResult {
  ocid?: string;
  convocatoria?: any;
  postores?: any[];
  items?: any[];
  documentos?: any[];
  compliance?: any;
  document_analysis?: any;     // JSON estructurado
  market_analysis?: any;       // JSON estructurado
  web_research?: any;          // JSON estructurado
  news_research?: any;         // JSON del news_research_agent (prensa peruana)
  person_network?: any;        // JSON del person_network_agent (gerente + red)
  normative_compliance?: any;  // JSON de evaluate_normative_compliance (RAG cruzado)
  estado_real?: any;           // detect_estado_real (Fase 1)
  analisis_postores?: any;     // analyze_postores_pattern (Fase 2)
  doc_parser_raw?: string;     // texto crudo fallback
  market_analysis_raw?: string;
  web_research_raw?: string;
  news_research_raw?: string;
  person_network_raw?: string;
  dictamen?: {
    dictamen_markdown?: string;
    dictamen_estructura?: any;
    gen_meta?: any;
  };
  agent_trace?: AgentTraceEvent[];
  agent_session?: string;
  agent_final_response?: string;
  llm_metrics?: {
    tokens_total?: number;
    tokens_prompt?: number;
    tokens_output?: number;
    n_llm_calls?: number;
    cost_usd?: number;
    phoenix_trace_id?: string | null;
  };
  self_evals?: any;
  timing?: Record<string, number>;
  _bridge_meta?: Record<string, any>;
  error?: string;
  hint?: string;
}

/**
 * Convierte un error técnico del backend en un mensaje legible para el usuario.
 * Mapea casos conocidos (cuota agotada, tool not found, stream interrumpido) a
 * texto en español neutro con sugerencia de acción.
 */
function humanizeError(raw: string, errClass?: string): string {
  const s = String(raw || "").toLowerCase();
  const cls = String(errClass || "").toLowerCase();

  if (s.includes("quota_exhausted") || s.includes("resource_exhausted")
      || s.includes("429") || s.includes("quota")
      || cls.includes("resourceexhausted")) {
    return "No se pudo procesar el OCID porque se agotó la cuota de Gemini Vertex AI (HTTP 429 RESOURCE_EXHAUSTED). Espera 1–2 minutos y reintenta, o procesa los OCIDs de uno en uno.";
  }
  if (s.includes("tool 'run' not found") || s.includes("tool not found")) {
    return "No se pudo procesar el OCID debido a una desconfiguración del agente (tool inexistente). El equipo ya fue notificado. Reintenta en unos minutos.";
  }
  if (s.includes("stream_interrupted") || s.includes("stream cerró")
      || s.includes("stream cerro")) {
    return "El análisis se interrumpió antes de completarse. Esto suele ocurrir por timeout del backend o cuota de Gemini. Reintenta o intenta con otro OCID.";
  }
  if (s.includes("runner_exception") || cls.includes("clienterror")
      || cls.includes("apierror")) {
    const cleanMsg = String(raw || "").replace(/^.*?:\s*/, "").slice(0, 240);
    return `No se pudo procesar el OCID debido a un error interno del agente: ${cleanMsg || "fallo desconocido"}.`;
  }
  if (s.includes("ocds") && s.includes("404")) {
    return "El OCID no existe en SEACE o aún no tiene datos publicados. Verifica el código.";
  }
  if (s.includes("timeout") || s.includes("502") || s.includes("503")) {
    return "El servicio de análisis no respondió a tiempo. Es probablemente un timeout de Cloud Run. Reintenta en unos segundos.";
  }
  // Fallback: limpiar y devolver el mensaje original con un prefijo claro
  const cleaned = String(raw || "").slice(0, 300).trim();
  return `No se pudo procesar el OCID: ${cleaned || "error desconocido"}`;
}

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
  useEffect(() => {
    getAnalyzedList(50)
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
          const url = `https://contratacionesabiertas.oece.gob.pe/proceso/${ocid}`;
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

// ════════════════════════════════════════════════════════════════════
// AnalisisPostoresSection — sospechas por postor + patrones de cartel
// ════════════════════════════════════════════════════════════════════

function AnalisisPostoresSection({ data }: { data: any }) {
  const postores: any[] = Array.isArray(data?.postores) ? data.postores : [];
  const patrones = (data?.patrones_red && typeof data.patrones_red === "object") ? data.patrones_red : {};

  const sospechaLabel: Record<string, string> = {
    direccion_compartida_con_otro_postor: "Misma dirección que otro postor",
  };

  if (postores.length === 0) {
    return <p className="px-4 py-3 text-[12px] text-mute">No se identificaron postores en el OCDS.</p>;
  }

  return (
    <div className="p-4">
      {/* Stats agregados */}
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-paperDeep px-3 py-2">
          <div className="font-mono text-lg font-bold text-ink">{patrones.n_postores_total || postores.length}</div>
          <div className="text-[10px] text-mute">postores totales</div>
        </div>
        <div className={cn(
          "rounded-md px-3 py-2",
          (patrones.n_con_co_ocurrencia || 0) > 0 ? "bg-amber-soft" : "bg-paperDeep",
        )}>
          <div className={cn("font-mono text-lg font-bold", (patrones.n_con_co_ocurrencia || 0) > 0 ? "text-amber" : "text-ink")}>
            {patrones.n_con_co_ocurrencia || 0}
          </div>
          <div className="text-[10px] text-mute">con co-ocurrencia (base Vigía)</div>
        </div>
        <div className={cn(
          "rounded-md px-3 py-2",
          (patrones.n_con_direccion_compartida || 0) > 0 ? "bg-rust/10" : "bg-paperDeep",
        )}>
          <div className={cn("font-mono text-lg font-bold", (patrones.n_con_direccion_compartida || 0) > 0 ? "text-rust" : "text-ink")}>
            {patrones.n_con_direccion_compartida || 0}
          </div>
          <div className="text-[10px] text-mute">comparten domicilio</div>
        </div>
      </div>

      {/* Tabla de postores */}
      <ul className="divide-y divide-line">
        {postores.map((p: any, i: number) => {
          const score = p.score_sospecha || 0;
          const tone = score >= 50 ? "rust" : score >= 25 ? "amber" : "moss";
          return (
            <li key={i} className="flex items-start gap-3 py-2.5">
              <div className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-md text-paper",
                tone === "rust" && "bg-rust",
                tone === "amber" && "bg-amber",
                tone === "moss" && "bg-moss",
              )}>
                <span className="font-mono text-[11px] font-bold">{score}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] font-bold text-clay">RUC {p.ruc}</span>
                  <span className="line-clamp-1 text-sm font-semibold text-ink">{p.razon_social || "—"}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {(p.sospechas || []).map((s: string, j: number) => {
                    const label = sospechaLabel[s] || (s.startsWith("co_ocurrencia") ? `${s.split(":")[1]} co-ocurrencias` : s);
                    return (
                      <span key={j} className={cn(
                        "rounded-full px-1.5 py-0 text-[9px] font-bold",
                        s.includes("direccion") ? "bg-rust text-paper" : "bg-amber text-paper",
                      )}>
                        {label}
                      </span>
                    );
                  })}
                  {(p.sospechas || []).length === 0 && (
                    <span className="text-[10px] text-mute">— sin señales</span>
                  )}
                </div>
                {p.direccion && (
                  <div className="mt-0.5 line-clamp-1 text-[10px] text-mute">📍 {p.direccion}</div>
                )}
                <div className="mt-0.5 text-[10px] text-mute">
                  {p.n_apariciones_base_vigia || 0} aparició{(p.n_apariciones_base_vigia || 0) === 1 ? "n" : "nes"} en la base de Vigía
                  <span className="text-mute/60"> · no es su historial completo en SEACE</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Pares co-ocurrentes (señal de cartel) */}
      {Object.keys(patrones.pares_co_ocurrentes || {}).length > 0 && (
        <div className="mt-3 rounded-md border border-amber/30 bg-amber-soft/40 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber">
            <AlertTriangle size={10} className="mr-1 inline" />
            Co-ocurrencias en la base de Vigía
          </div>
          <p className="mt-1 text-[11px] text-inkSoft">
            Estos pares de postores aparecen juntos en otros procesos <strong>ya analizados por Vigía</strong>
            {" "}(no el universo completo del SEACE). Señal a investigar, no prueba de cartel.
          </p>
          <ul className="mt-1.5 space-y-1">
            {Object.entries(patrones.pares_co_ocurrentes).slice(0, 5).map(([par, ocids]: [string, any], i: number) => {
              const list: string[] = Array.isArray(ocids) ? ocids : [];
              return (
                <li key={i} className="font-mono text-[10px] text-ink">
                  <span className="text-amber">●</span> {par} · <strong>{list.length}</strong> proceso{list.length === 1 ? "" : "s"} compartido{list.length === 1 ? "" : "s"}
                  {list.length > 0 && (
                    <div className="ml-3 mt-0.5 flex flex-wrap gap-1">
                      {list.slice(0, 8).map((oc, j) => (
                        <a key={j} href={`https://contratacionesabiertas.oece.gob.pe/proceso/${oc}`}
                           target="_blank" rel="noreferrer"
                           className="rounded bg-paperDeep px-1.5 py-0 text-[9px] text-clay hover:bg-paperSoft">
                          {oc.replace(/^ocds-[a-z0-9]+-seacev3-/i, "")}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CollapsibleSection — wrapper para secciones secundarias colapsables
// ════════════════════════════════════════════════════════════════════

function CollapsibleSection({
  title,
  subtitle,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="surface overflow-hidden p-0"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 hover:bg-paperDeep">
        {icon && <span className="shrink-0 text-clay">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{title}</div>
          {subtitle && <div className="text-[11px] text-mute">{subtitle}</div>}
        </div>
        <ChevronRight
          size={14}
          className={cn("shrink-0 text-mute transition-transform", open && "rotate-90")}
        />
      </summary>
      <div className="border-t border-line">
        {children}
      </div>
    </details>
  );
}

// ════════════════════════════════════════════════════════════════════
// AgentsPipeline — pipeline compacto, expandible
// ════════════════════════════════════════════════════════════════════

function AgentsPipeline() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="surface overflow-hidden p-0"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-paperDeep">
        <div className="flex -space-x-1.5">
          {AGENTS.map((a, i) => (
            <span key={i} className={cn(
              "grid h-6 w-6 place-items-center rounded-full border-2 border-paper",
              a.tone,
            )}>
              <span className="scale-75">{a.icon}</span>
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-mute">
            Pipeline de {AGENTS.length} agentes · ~60–180 s
          </div>
          <div className="truncate text-sm font-semibold text-ink">
            {open ? "Cómo se compone la cadena" : AGENTS.map(a => a.name.replace(/_agent$/, "")).join(" → ")}
          </div>
        </div>
        <ChevronRight
          size={16}
          className={cn("shrink-0 text-mute transition-transform", open && "rotate-90")}
        />
      </summary>
      <ol className="grid gap-2 border-t border-line bg-paperSoft p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {AGENTS.map((a, i) => (
          <li key={a.name} className="relative rounded-lg bg-paper p-3">
            <div className="absolute right-2 top-2 font-mono text-[9px] font-bold text-mute">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("grid h-7 w-7 place-items-center rounded-md", a.tone)}>
                <span className="scale-90">{a.icon}</span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[9px] font-semibold text-clay">{a.name.replace(/_agent$/, "")}</div>
                <div className="truncate text-xs font-semibold text-ink">{a.action}</div>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-mute">{a.detail}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

// ════════════════════════════════════════════════════════════════════
// QuickAccessPanel — sidebar del HERO con stats + sortear + top 3
// ════════════════════════════════════════════════════════════════════

function QuickAccessPanel({
  cached,
  onSelect,
  onRunNew,
}: { cached: any[] | null; onSelect: (ocidOrCodigo: string) => void; onRunNew?: (codigo: string) => void }) {
  const loading = cached === null;
  const items = cached || [];
  const total = items.length;
  const conAlta = items.filter((it: any) => (it.n_alta || 0) > 0).length;
  const conMedia = items.filter((it: any) => (it.n_media || 0) > 0).length;
  const sinBanderas = items.filter((it: any) => (it.n_banderas || 0) === 0).length;
  const [randomLoading, setRandomLoading] = useState(false);

  // top 3 más recientes
  const top3 = [...items]
    .sort((a, b) => String(b.analizado_en || "").localeCompare(String(a.analizado_en || "")))
    .slice(0, 3);

  // Sortear convocatoria NUEVA del SEACE (no analizada) → dispara análisis
  const handleShuffleSeace = async () => {
    if (!onRunNew) return;
    setRandomLoading(true);
    try {
      const r = await fetch("/api/agent/random", { cache: "no-store" });
      const text = await r.text();
      let d: any = null;
      try { d = JSON.parse(text); } catch { /* respuesta no-JSON */ }
      if (d?.found && d.codigo_convocatoria) {
        onRunNew(d.codigo_convocatoria);
      }
    } catch { /* ignore */ }
    finally { setRandomLoading(false); }
  };

  // Sortear de analizadas (rápido, sin re-procesar)
  const handleShuffleCached = () => {
    if (items.length === 0) return;
    const pick = items[Math.floor(Math.random() * items.length)];
    onSelect(pick.codigo_convocatoria || pick.ocid);
  };

  const fmtMoney = (n: number) => {
    if (!n) return "—";
    if (n >= 1e6) return `S/. ${(n/1e6).toFixed(2)} M`;
    if (n >= 1e3) return `S/. ${(n/1e3).toFixed(0)} K`;
    return `S/. ${n.toLocaleString("es-PE")}`;
  };

  return (
    <aside className="surface flex flex-col gap-3 p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="font-serif text-base font-bold text-ink">Análisis recientes</h2>
        {!loading && (
          <span className="rounded-full bg-paperDeep px-1.5 py-0 font-mono text-[10px] font-bold text-ink">
            {total}
          </span>
        )}
      </div>

      {/* Stats compactos */}
      {!loading && total > 0 && (
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-md bg-rust/10 px-1 py-1.5">
            <div className="font-mono text-lg font-bold tabular-nums text-rust">{conAlta}</div>
            <div className="text-[9px] uppercase tracking-wider text-rust">alta</div>
          </div>
          <div className="rounded-md bg-amber/10 px-1 py-1.5">
            <div className="font-mono text-lg font-bold tabular-nums text-amber">{conMedia}</div>
            <div className="text-[9px] uppercase tracking-wider text-amber">media</div>
          </div>
          <div className="rounded-md bg-moss/10 px-1 py-1.5">
            <div className="font-mono text-lg font-bold tabular-nums text-moss">{sinBanderas}</div>
            <div className="text-[9px] uppercase tracking-wider text-moss">limpio</div>
          </div>
        </div>
      )}

      {/* Botones de sorteo */}
      {!loading && (
        <div className="space-y-1.5">
          {onRunNew && (
            <button
              type="button"
              onClick={handleShuffleSeace}
              disabled={randomLoading}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-rust px-2 py-2 text-[11px] font-bold text-paper transition-colors hover:bg-rust/90 disabled:opacity-50"
              title="Pickea una convocatoria del SEACE que aún no se analizó y dispara los agentes"
            >
              <Shuffle size={12} className={randomLoading ? "animate-spin" : ""} />
              <span>{randomLoading ? "Buscando…" : "Sortear nueva del SEACE"}</span>
            </button>
          )}
          {total > 0 && (
            <button
              type="button"
              onClick={handleShuffleCached}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-paper px-2 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-paperDeep"
              title="Abrir una de las ya analizadas, al azar (sin re-procesar)"
            >
              <Shuffle size={11} />
              <span>Sortear ya analizada</span>
            </button>
          )}
        </div>
      )}

      {/* Top 3 más recientes */}
      {!loading && top3.length > 0 && (
        <div className="border-t border-line pt-3">
          <ul className="space-y-1">
            {top3.map((it: any, i: number) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onSelect(it.codigo_convocatoria || it.ocid)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-paperDeep"
                >
                  <span className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-md text-paper",
                    (it.score || 0) >= 85 ? "bg-rust" :
                    (it.score || 0) >= 70 ? "bg-clay" :
                    (it.score || 0) >= 40 ? "bg-amber" : "bg-moss",
                  )}>
                    <span className="font-mono text-[10px] font-bold leading-none">{it.score || 0}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-[10px] font-bold text-ink">{it.codigo_convocatoria}</span>
                      {(it.n_alta || 0) > 0 && (
                        <span className="rounded-full bg-rust px-1 text-[8px] font-bold text-paper">{it.n_alta}A</span>
                      )}
                    </div>
                    <div className="line-clamp-1 text-[10px] text-mute">{it.objeto || "—"}</div>
                  </div>
                  <span className="font-mono text-[9px] text-mute">{fmtMoney(it.monto)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-7 animate-pulse rounded bg-paperDeep" />
          ))}
        </div>
      )}

      {!loading && total === 0 && (
        <p className="text-[11px] text-mute">Sin análisis previos.</p>
      )}
    </aside>
  );
}


type SortKey = "reciente" | "score" | "monto";
type SevFilter = "todos" | "alta" | "media" | "sin";
type CatFilter = "todas" | "bienes" | "servicios" | "obras" | "consultoria";

// Heurística por keywords sobre el `objeto` para clasificar la convocatoria
// (el OECE no expone `mainProcurementCategory` estándar en este dataset).
function inferCategoria(objeto: string | null | undefined): CatFilter {
  const o = (objeto || "").toLowerCase();
  if (/\b(obra|construcc|edif|carrete|pavimen|puente|infraestruc|reparaci[oó]n de|mejoramient)/i.test(o)) return "obras";
  if (/\b(consultor[ií]a|estudio|formulaci[oó]n|expediente t[eé]cnico)/i.test(o)) return "consultoria";
  if (/\b(servicio|mantenim|conservaci[oó]n|alquil|limpieza|seguridad|asesor|transporte|capacit)/i.test(o)) return "servicios";
  if (/\b(adquisici[oó]n|compra|suministr|provisi[oó]n|equip|veh[ií]culo|aliment|medicam|kit|tablet|laptop|insumo|repuest|bienes)/i.test(o)) return "bienes";
  return "todas";
}
const CAT_LABEL: Record<CatFilter, string> = {
  todas: "Todas",
  bienes: "Bienes",
  servicios: "Servicios",
  obras: "Obras",
  consultoria: "Consultoría",
};
// Color de acento por categoría (tipo etiqueta sólida, no emoji)
const CAT_TONE: Record<CatFilter, string> = {
  todas:       "bg-ink",
  bienes:      "bg-clay",
  servicios:   "bg-amber",
  obras:       "bg-rust",
  consultoria: "bg-moss",
};

function AnalizadasRecientes({ onSelect }: { onSelect: (ocidOrCodigo: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<SevFilter>("todos");
  const [region, setRegion] = useState<string>("todas");
  const [cat, setCat] = useState<CatFilter>("todas");
  const [sort, setSort] = useState<SortKey>("reciente");
  const [shuffleKey, setShuffleKey] = useState(0);

  useEffect(() => {
    getAnalyzedList(50)
      .then((d) => {
        if (d?.error) setErr(d.error);
        else setItems(d.items || []);
      })
      .catch((e) => setErr(e.message));
  }, []);

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
            Mostrando <strong className="text-ink">{sorted.length}</strong> de {items.length}.
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
          {sorted.map((it: any, i: number) => (
            <li key={i} className="surface group relative overflow-hidden p-0 transition-all hover:shadow-md hover:border-clay/40">
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
  useEffect(() => { tail.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [events.length]);

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

// Metadata por nodo del grafo: etiqueta corta, emoji, frase pública en vivo y fase.
const NODE_META: Record<string, { short: string; emoji: string; phrase: string }> = {
  fetch:      { short: "OCDS",       emoji: "🏷️", phrase: "Consultando Contrataciones Abiertas del OECE…" },
  pdfs:       { short: "Expediente", emoji: "⬇️", phrase: "Descargando el expediente publicado en el SEACE…" },
  db:         { short: "Registro",   emoji: "🗄️", phrase: "Estructurando el proceso en la base de datos…" },
  compliance: { short: "Compliance", emoji: "⚖️", phrase: "Aplicando las reglas de la Ley de Contrataciones del Estado…" },
  parser:     { short: "Parser",     emoji: "📑", phrase: "Leyendo las bases administrativas y el acta de buena pro…" },
  legal:      { short: "Legal",      emoji: "📜", phrase: "Cruzando contra las opiniones normativas del OECE…" },
  market:     { short: "Mercado",    emoji: "💰", phrase: "Tasando los precios ofertados contra el mercado real…" },
  sunat:      { short: "SUNAT",      emoji: "🪪", phrase: "Verificando RUC, sanciones e inhabilitaciones del proveedor…" },
  web:        { short: "Empresa",    emoji: "🏢", phrase: "Investigando a la empresa adjudicataria…" },
  news:       { short: "Prensa",     emoji: "📰", phrase: "Buscando prensa peruana relacionada…" },
  rnp:        { short: "Red",        emoji: "🕸️", phrase: "Cruzando la red de socios y la base pública de visitas a funcionarios…" },
  extended:   { short: "Patrones",   emoji: "🔁", phrase: "Detectando puerta giratoria y aportes de campaña…" },
  writer:     { short: "Dictamen",   emoji: "✍️", phrase: "Redactando el dictamen final con la evidencia…" },
};
const PHASE_HEX: Record<string, string> = {
  "ingesta": "#b9770c", "auditoría": "#a8442a", "investigación": "#8a6d3b", "dictamen": "#4f7d3a",
};

// ── Grafo agéntico en CANVAS ──────────────────────────────────────────────
// Nodos por tipo + aristas curvas + PARTÍCULAS que fluyen. El nodo activo
// (paso real en vivo) se enciende con halo pulsante; al terminar queda VERDE.
// Las fuentes se "encienden" cuando el agente activo las consulta. Clickeable:
// muestra qué hace cada nodo. Abajo, panel de HALLAZGOS reales del stream.

// Extrae entidades reales (empresa, RUC, estado, socios, señales) del stream.
function extractFindings(events: any[]) {
  const f: any = { empresa: null, ruc: null, estado: null, condicion: null, apto: null,
                   entidad: null, monto: null, socios: [] as string[], senales: [] as string[],
                   n_sanciones: null, n_items: null };
  if (!events?.length) return f;
  const addSocio = (nm: any) => { const s = String(nm || "").trim(); if (s && !f.socios.includes(s) && f.socios.length < 12) f.socios.push(s); };
  const addSenal = (r: any) => { const s = String(r || "").trim(); if (s && !f.senales.includes(s) && f.senales.length < 12) f.senales.push(s); };
  for (const ev of events) {
    if (ev.kind === "tool_call" && ev.name === "add_contextual_flag" && ev.args?.regla) addSenal(ev.args.regla);
    if (ev.kind !== "tool_result") continue;
    const rp = ev.result_preview;
    if (!rp || typeof rp !== "object") continue;
    if (typeof rp.razon_social === "string" && rp.razon_social) f.empresa = rp.razon_social;
    if (typeof rp.ruc === "string" && rp.ruc.replace(/\D/g, "").length === 11) f.ruc = rp.ruc;
    if (typeof rp.estado === "string") f.estado = rp.estado;
    if (typeof rp.condicion === "string") f.condicion = rp.condicion;
    if (typeof rp.es_apto_contratar === "boolean") f.apto = rp.es_apto_contratar;
    if (typeof rp.n_sanciones === "number") f.n_sanciones = rp.n_sanciones;
    if (typeof rp.n_items === "number") f.n_items = rp.n_items;
    if (typeof rp.buyer_nombre === "string") f.entidad = rp.buyer_nombre;
    if (rp.ganador && typeof rp.ganador === "object") {
      if (rp.ganador.razon_social) f.empresa = rp.ganador.razon_social;
      if (rp.ganador.ruc) f.ruc = rp.ganador.ruc;
      if (rp.ganador.monto_ganado != null) f.monto = rp.ganador.monto_ganado;
    }
    if (rp.entidad && typeof rp.entidad === "object" && rp.entidad.nombre) f.entidad = rp.entidad.nombre;
    for (const key of ["socios", "representantes_legales"]) {
      if (Array.isArray(rp[key])) for (const s of rp[key]) addSocio(s?.nombre || s?.numero_documento);
    }
    if (Array.isArray(rp.senales)) for (const s of rp.senales) addSenal(s?.regla);
  }
  return f;
}

// Qué hace cada nodo (para el click).
interface GNode {
  id: string; label: string; sub?: string; name: string;
  type: "orch" | "agent" | "src" | "store"; r: number; desc: string;
  sources?: string[]; stores?: string[];
}
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
const AGENT_IDS = ["compliance", "parser", "legal", "market", "web", "news", "person", "entity", "extended", "writer"];
const G_EDGES: Array<{ from: string; to: string }> = [];
G_NODES.forEach((n) => {
  (n.sources || []).forEach((s) => G_EDGES.push({ from: s, to: n.id }));
  (n.stores || []).forEach((s) => G_EDGES.push({ from: n.id, to: s }));
});
AGENT_IDS.forEach((a) => G_EDGES.push({ from: "orch", to: a }));
const G_COLOR: Record<string, { fill: string; stroke: string; text: string }> = {
  orch:  { fill: "#fffdf7", stroke: "#6d4ec9", text: "#4a3a8c" },
  agent: { fill: "#fffdf7", stroke: "#3f7a3a", text: "#2f5e2c" },
  src:   { fill: "#fffdf7", stroke: "#b07a12", text: "#7a530b" },
  store: { fill: "#fffdf7", stroke: "#b03b6e", text: "#7e2a4d" },
};
const G_DONE = { fill: "#e9f3e6", stroke: "#3f7a3a", text: "#2f5e2c" }; // verde "completado"
const G_FLOW = "#16b85a"; // verde vivo: arista con intercambio de info ACTIVO
const TYPE_LABEL: Record<string, string> = { orch: "Núcleo", agent: "Agente", src: "Fuente", store: "Persistencia" };

// ── TRACE AGÉNTICO ──────────────────────────────────────────────────────────
// Deriva del stream REAL los pasos "agente → (verbo) → destino · qué hace".
// Cada `transfer` del orquestador y cada `tool_call` de un agente se vuelve un
// paso narrado. Es lo que se anima en el grafo y se escribe en la narración.
function traceNodeForAgent(name?: string): string | null {
  const n = String(name || "").toLowerCase();
  if (/document_parser/.test(n)) return "parser";
  if (/legal_analyst/.test(n)) return "legal";
  if (/compliance_extended/.test(n)) return "extended";
  if (/compliance/.test(n)) return "compliance";
  if (/market_price/.test(n)) return "market";
  if (/web_research/.test(n)) return "web";
  if (/news_research/.test(n)) return "news";
  if (/person_network/.test(n)) return "person";
  if (/entity_personnel/.test(n)) return "entity";
  if (/report_writer/.test(n)) return "writer";
  return null; // orquestador / root → se trata como "orch"
}
const TRACE_ROLE: Record<string, string> = {
  compliance: "auditar el cumplimiento normativo",
  parser: "leer el expediente (bases, actas, contrato)",
  legal: "el análisis legal contra las opiniones del OECE",
  extended: "los cruces avanzados (puerta giratoria, aportes)",
  market: "tasar los precios contra el mercado",
  web: "investigar a la empresa adjudicataria",
  news: "buscar prensa peruana relacionada",
  rnp: "mapear la red de personas del proveedor",
  entity: "identificar a los funcionarios de la entidad",
  writer: "redactar el dictamen con la evidencia",
};
function rucArg(a: any): string {
  const r = String(a?.ruc || a?.ruc_proveedor || a?.ruc_postor || "").replace(/\D/g, "");
  return r.length === 11 ? ` RUC ${r}` : "";
}
const TRACE_TOOLS: Array<{ rx: RegExp; node: string; verb: string; msg: (a: any) => string }> = [
  { rx: /fetch_ocds|get_ocds_record/i,                 node: "oece_ocds",   verb: "consulta", msg: (a) => `trae la metadata OCDS del proceso${a?.ocid ? ` ${String(a.ocid).slice(0, 28)}` : ""}` },
  { rx: /fetch_documents|archive_docs|download/i,       node: "seace",       verb: "consulta", msg: () => "descarga los documentos del expediente (SEACE)" },
  { rx: /parse_document_pdf|extract_doc|ocr/i,          node: "seace",       verb: "consulta", msg: () => "lee los PDFs del expediente (OCR / Vision)" },
  { rx: /ingest_to_db|insert_|^persist_alert/i,         node: "sql",         verb: "persiste", msg: () => "estructura y guarda el proceso en la base de datos" },
  { rx: /persist_analysis|persist_market|persist_/i,    node: "sql",         verb: "persiste", msg: () => "guarda las banderas y el análisis en Cloud SQL" },
  { rx: /query_legal_rag|lookup_opinion_oece/i,         node: "pgvec",       verb: "consulta", msg: (a) => a?.question ? `busca opiniones OECE: "${String(a.question).slice(0, 46)}…"` : "busca las opiniones OECE relevantes (RAG)" },
  { rx: /evaluate_normative_compliance|run_hard_rules/i, node: "sql",        verb: "invoca",   msg: () => "aplica las reglas duras de la Ley de Contrataciones" },
  { rx: /query_oece_perfil/i,                           node: "oece_perfil", verb: "consulta", msg: (a) => `obtiene el perfil del proveedor${rucArg(a)} (estado, sanciones, aptitud)` },
  { rx: /query_edad_ciiu/i,                             node: "uniperu",     verb: "consulta", msg: () => "obtiene la edad del RUC y el CIIU (universidadperu)" },
  { rx: /query_sunat|sunat_decolecta/i,                 node: "sunat",       verb: "consulta", msg: (a) => `valida${rucArg(a) || " el RUC del proveedor"} en SUNAT` },
  { rx: /query_rnp|rnp_conformacion/i,                  node: "rnp",         verb: "consulta", msg: () => "obtiene los socios y representantes legales (RNP)" },
  { rx: /cruce_firmantes/i,                             node: "sql",         verb: "invoca",   msg: () => "cruza los firmantes del acta con la red de personas" },
  { rx: /batch_person_lookup/i,                         node: "onpe",        verb: "invoca",   msg: (a) => `cruza ${(a?.personas?.length || a?.dnis?.length || a?.docs?.length) ?? "varias"} personas en paralelo (ONPE, JNE, PEPs, visitas)` },
  { rx: /analyze_market_sharded|build_market_input|web_search_market|market_price/i, node: "google", verb: "consulta", msg: () => "tasa los ítems contra el mercado real (Google · fan-out)" },
  { rx: /query_onpe/i,                                  node: "onpe",        verb: "consulta", msg: () => "busca aportes de campaña (ONPE)" },
  { rx: /query_jne/i,                                   node: "jne",         verb: "consulta", msg: () => "busca candidaturas y hojas de vida (JNE)" },
  { rx: /query_pep/i,                                   node: "pep",         verb: "consulta", msg: () => "verifica personas expuestas políticamente (PEPs)" },
  { rx: /visitas/i,                                     node: "visitas",     verb: "consulta", msg: () => "busca visitas a funcionarios" },
  { rx: /web_research|google_search_oficial|google_search/i, node: "google", verb: "consulta", msg: () => "perfila a la empresa en fuentes oficiales" },
  { rx: /news_research|prensa/i,                        node: "google",      verb: "consulta", msg: () => "busca prensa peruana relacionada" },
  { rx: /add_contextual_flag/i,                         node: "sql",    verb: "invoca",   msg: (a) => a?.regla ? `marca la señal "${String(a.regla).replace(/_/g, " ")}"` : "marca una señal de riesgo" },
  { rx: /detect_estado_real/i,                          node: "sql",    verb: "invoca",   msg: () => "determina el estado real del proceso" },
  { rx: /analyze_postores_pattern/i,                    node: "sql",    verb: "invoca",   msg: () => "analiza el patrón de postores y co-ocurrencias" },
  { rx: /get_dictamen_context/i,                        node: "sql",    verb: "invoca",   msg: () => "reúne todo el contexto para el dictamen" },
];
interface TraceStep { f: string; t: string; v: string; m: string }
function buildTrace(events: any[]): TraceStep[] {
  const out: TraceStep[] = [];
  for (const ev of events || []) {
    let step: TraceStep | null = null;
    if (ev.kind === "transfer") {
      const t = traceNodeForAgent(ev.to);
      if (t) step = { f: "orch", t, v: "delega", m: TRACE_ROLE[t] || "ejecutar su tarea" };
    } else if (ev.kind === "tool_call") {
      const name = String(ev.name || "");
      // El orquestador invoca a los sub-agentes como AgentTool: el `name` del
      // tool_call ES el nombre del agente (p.ej. "market_price_agent"). Eso es
      // una DELEGACIÓN → ilumina ese agente (no es una tool normal).
      const asAgent = /_agent\b/i.test(name) ? traceNodeForAgent(name) : null;
      if (asAgent) {
        step = { f: "orch", t: asAgent, v: "delega", m: TRACE_ROLE[asAgent] || "ejecutar su tarea" };
      } else {
        const from = traceNodeForAgent(ev.agent) || "orch";
        const hit = TRACE_TOOLS.find((x) => x.rx.test(name));
        if (hit) step = { f: from, t: hit.node, v: hit.verb, m: hit.msg(ev.args || {}) };
        else if (name) step = { f: from, t: "sql", v: "invoca", m: name.replace(/_/g, " ") };
      }
    } else if (ev.kind === "phase") {
      if (ev.name === "writer_forced" || ev.name === "persist" || ev.name === "safety_net")
        step = { f: "writer", t: "sql", v: "persiste", m: "guarda el dictamen y las banderas en Cloud SQL" };
    }
    if (!step) continue;
    const last = out[out.length - 1];
    if (last && last.f === step.f && last.t === step.t && last.m === step.m) continue; // colapsa repetidos
    out.push(step);
  }
  return out;
}
const VERB_HEX: Record<string, string> = { delega: "#5b51c9", invoca: "#2f8f86", consulta: "#3b8bd4", persiste: "#ba7517" };

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
  useEffect(() => { tail.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [steps.length]);
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

function BPMNNode({ step, status }: { step: typeof STEPS[number]; status: "done" | "active" | "pending" }) {
  return (
    <div
      title={step.label}
      className={cn(
        "group relative flex flex-col items-center gap-1 transition-all duration-300",
        status === "active" && "scale-110",
      )}
    >
      <div className={cn(
        "relative flex h-11 w-11 items-center justify-center rounded-xl border-2 transition-all",
        status === "done"    && "border-moss bg-moss text-paper shadow-md",
        status === "active"  && "border-clay bg-clay text-paper shadow-paper",
        status === "pending" && "border-line bg-paperDeep text-mute",
      )}>
        {/* Anillo pulsante en active */}
        {status === "active" && (
          <span className="absolute inset-0 -m-1 animate-ping rounded-xl border-2 border-clay/60" />
        )}
        {status === "done" ? <CheckCircle2 size={16} /> :
         status === "active" ? <Loader2 size={16} className="animate-spin" /> :
         step.icon}
      </div>
      <div className={cn(
        "max-w-[88px] text-center text-[9px] leading-tight font-mono uppercase tracking-tight transition-colors",
        status === "done"    && "text-moss",
        status === "active"  && "font-bold text-ink",
        status === "pending" && "text-mute",
      )}>
        {step.key}
      </div>
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

  const oeceUrl = `https://contratacionesabiertas.oece.gob.pe/proceso/${conv.ocid || codigo}`;

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
    medio:   { label: "Requiere revisión", color: "text-amber", bg: "bg-amber", border: "border-amber/40" },
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
                <span className="line-clamp-2">{b.evidencia || b.regla}</span>
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

  // Badge dictamen: presencia (1 = ✓)
  const _dictamenText = result.dictamen?.dictamen_markdown || "";
  const nDictamen = _dictamenText.length > 100 ? 1 : 0;

  // Conteos por severidad para el banner crítico
  const banderasArr = (compl.banderas || []) as any[];
  const nAlta = banderasArr.filter(b => (b.severidad || "").toLowerCase() === "alta").length;
  const nMedia = banderasArr.filter(b => (b.severidad || "").toLowerCase() === "media").length;

  const TABS = [
    { key: "resumen",    label: "Resumen",         icon: <ShieldAlert size={13}/>, badge: nBanderas || null, badgeColor: "bg-rust" },
    { key: "items",      label: "Items + Mercado", icon: <Package size={13}/>,     badge: nItems || null,    badgeColor: "bg-clay" },
    { key: "proveedor",  label: "Proveedor + Red", icon: <Building2 size={13}/>,   badge: nRed || null,      badgeColor: "bg-amber" },
    { key: "documentos", label: "Documentos",      icon: <FileText size={13}/>,    badge: nDocs || null,     badgeColor: "bg-clay" },
    { key: "prensa",     label: "Prensa",          icon: <Newspaper size={13}/>,   badge: nNoticias || null, badgeColor: "bg-moss" },
    { key: "trace",      label: "Auditoría",       icon: <Sparkles size={13}/>,    badge: nEvents || null,   badgeColor: "bg-mute" },
    { key: "dictamen",   label: "Dictamen",        icon: <Pen size={13}/>,         badge: nDictamen ? "✓" : null, badgeColor: "bg-moss" },
  ] as Array<{ key: string; label: string; icon: any; badge: number | string | null; badgeColor: string }>;

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
          <ItemsConMarketPrice items={result.items || []} market={result.market_analysis} fmtMoney={fmtMoney} />
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

      {/* Análisis de competencia (TODOS los postores) — colapsable */}
      {activeTab === "proveedor" && result.analisis_postores?.postores?.length > 0 && (
        <CollapsibleSection
          title="Análisis de competencia"
          subtitle={result.analisis_postores.evidencia}
          icon={<Users size={13} />}
          defaultOpen={!(result.postores || []).some((p: any) => p.es_ganador)}
        >
          <AnalisisPostoresSection data={result.analisis_postores} />
        </CollapsibleSection>
      )}

      {/* Secciones secundarias colapsables — orden: contratos · política · fuentes */}
      {activeTab === "proveedor" && (result.web_research?.otros_contratos_con_estado || []).length > 0 && (
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

      {activeTab === "proveedor" && (
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
      )}

      {activeTab === "proveedor" && (result.web_research?.hallazgos_por_fuente || []).length > 0 && (
        <CollapsibleSection
          title="Fuentes consultadas"
          subtitle={`${(result.web_research?.hallazgos_por_fuente || []).length} portales públicos verificados`}
          icon={<Globe size={13} />}
        >
          <FuentesConsultadasSection hallazgos={result.web_research.hallazgos_por_fuente} />
        </CollapsibleSection>
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

        {/* DIAGNOSTIC */}
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

        {/* ENLACE A AUDITORÍA TÉCNICA */}
        <button
          type="button"
          onClick={() => setActiveTab("trace")}
          className="surface flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-paperDeep"
        >
          <div>
            <div className="text-[11px] font-semibold text-ink">Auditoría técnica</div>
            <div className="text-[10px] text-mute">Pasos del análisis, pipeline ejecutado</div>
          </div>
          <ChevronRight size={14} className="shrink-0 text-mute" />
        </button>
      </aside>
    </div>
  );
}

function FactRow({
  icon, label, value, sub, mono, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  accent?: "rust" | "clay";
}) {
  const accentColor =
    accent === "rust" ? "text-rust" : accent === "clay" ? "text-clay" : "text-ink";
  return (
    <div className="flex gap-2.5 px-4 py-2.5">
      <div className="mt-0.5 text-mute">{icon}</div>
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] uppercase tracking-wider text-mute">{label}</dt>
        <dd className={cn("text-sm font-medium break-words", accentColor, mono && "font-mono")}>
          {value}
        </dd>
        {sub && <div className={cn("text-[10px] mt-0.5", accent === "rust" ? "text-rust/80" : "text-mute")}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── sub-components ───────────────────────────────────────────

// Mapeo visual de cada agente
const AGENT_VISUAL: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  vigia_orchestrator:    { color: "bg-ink text-paper",          icon: <Sparkles size={11} />,      label: "Orquestador" },
  compliance_agent:      { color: "bg-amber text-paper",        icon: <ScanSearch size={11} />,    label: "Compliance" },
  document_parser_agent: { color: "bg-clay text-paper",         icon: <FileText size={11} />,      label: "Doc Parser" },
  market_price_agent:    { color: "bg-rust text-paper",         icon: <Receipt size={11} />,       label: "Market Price" },
  web_research_agent:    { color: "bg-amber-soft text-amber",   icon: <Globe2 size={11} />,        label: "Web Research" },
  report_writer_agent:   { color: "bg-moss text-paper",         icon: <FileText size={11} />,      label: "Report Writer" },
};

// Surfacing de la capa de observabilidad (track Arize): trazabilidad en Phoenix,
// evaluadores LLM-as-judge y guardrails anti-alucinación. `compact` = tira para
// el proceso en curso; full = tarjeta para el resultado (tab Auditoría).
// Dashboard de Arize: muestra TODO lo que la capa de observabilidad hace —
// trazas a Phoenix Cloud, métricas (tokens/costo/llamadas) en vivo, los 4
// evaluadores LLM-as-judge y los guardrails anti-alucinación. Con `liveEvents`
// muestra las métricas en vivo; sin ellos (resultado), la versión cualitativa.
function ObservabilidadPanel({ liveEvents = [], metrics }: { liveEvents?: any[]; metrics?: any }) {
  let liveM: any = null;
  for (let i = liveEvents.length - 1; i >= 0; i--) { if (liveEvents[i]?.kind === "metrics") { liveM = liveEvents[i]; break; } }
  const live = !!liveM;
  const m = liveM || metrics || null;          // resultado: usa métricas persistidas (llm_metrics)
  const hasM = !!m;
  // Scores del self-eval inline (eventos kind="eval"), por evaluador.
  const evalsByName: Record<string, any> = {};
  for (const e of liveEvents) { if (e?.kind === "eval" && e.evaluador) evalsByName[e.evaluador] = e; }
  const hasEvals = Object.keys(evalsByName).length > 0;
  const fmt = (n: any) => (typeof n === "number" ? n.toLocaleString() : (n ?? "—"));
  const EVALS: { n: string; label: string; d: string }[] = [
    { n: "respaldo_de_bandera", label: "Respaldo de bandera", d: "¿la bandera está respaldada por datos verificables (RUC, monto, fecha, artículo)?" },
    { n: "cita_evidencia", label: "Cita de evidencia", d: "¿cada bandera cita norma + fuente oficial (SEACE/OECE)?" },
    { n: "plausibilidad_precio", label: "Plausibilidad de precio", d: "¿el sobreprecio se sostiene con la mediana de mercado?" },
    { n: "coherencia_objeto_items", label: "Coherencia objeto ↔ ítems", d: "¿los ítems analizados pertenecen al objeto de la convocatoria?" },
    { n: "tono_no_acusatorio", label: "Tono no acusatorio", d: "¿el dictamen usa 'señal de riesgo' y nunca acusa de delito?" },
    { n: "completitud_analisis", label: "Completitud del análisis", d: "¿corrieron todas las etapas (docs, mercado, red, dictamen, banderas)?" },
  ];
  const STATS = [
    { v: fmt(m?.n_llm_calls), l: "llamadas IA" },
    { v: fmt(m?.tokens_total), l: "tokens" },
    { v: hasM ? `≈ $${Number(m.cost_usd ?? 0).toFixed(4)}` : "—", l: "costo estim." },
    { v: hasM ? `${m.tokens_prompt?.toLocaleString?.() ?? "—"} / ${m.tokens_output?.toLocaleString?.() ?? "—"}` : "in / out", l: "prompt / out" },
  ];
  const chipFor = (ev: any): React.ReactNode => {
    if (!ev) return <span className="rounded bg-line px-1.5 py-0.5 text-[8px] font-bold text-mute">pendiente</span>;
    if (ev.label != null && ev.pct == null) {
      const ok = ev.label === "ok" || ev.label === "coherente";
      return <span className={cn("rounded px-1.5 py-0.5 text-[8px] font-bold", ok ? "bg-moss/15 text-moss" : "bg-crimson-soft text-rust")}>{ev.label}</span>;
    }
    if (ev.pct != null) {
      const cls = ev.pct >= 80 ? "bg-moss/15 text-moss" : ev.pct >= 50 ? "bg-amber-soft text-amber" : "bg-crimson-soft text-rust";
      return <span className={cn("rounded px-1.5 py-0.5 text-[8px] font-bold", cls)}>{ev.pct}%{ev.n ? ` · ${ev.ok}/${ev.n}` : ""}</span>;
    }
    return null;
  };
  return (
    <section className="surface overflow-hidden p-0">
      {/* header oscuro estilo dashboard */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ink px-5 py-3 text-paper">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-amber" />
          <span className="font-serif text-sm font-bold">Arize · Observabilidad de la IA</span>
          {live ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-moss/20 px-2 py-0.5 text-[9px] font-bold text-moss">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss" /> EN VIVO
            </span>
          ) : hasM ? (
            <span className="rounded-full bg-paper/15 px-2 py-0.5 text-[9px] font-bold text-paper/80">ANÁLISIS CERRADO</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {m?.phoenix_trace_id ? (
            <a
              href="https://app.phoenix.arize.com/s/edwin-soto-c"
              target="_blank"
              rel="noreferrer"
              title={`Trace ID: ${m.phoenix_trace_id} — abre el proyecto vigia-peru en Phoenix y busca este ID para ver la orquestación ADK completa`}
              className="inline-flex items-center gap-1 rounded-full bg-amber/20 px-2 py-0.5 text-[9px] font-bold text-amber hover:bg-amber/30"
            >
              Ver traza ADK en Phoenix ↗
            </a>
          ) : null}
          <span className="font-mono text-[10px] text-paper/70">Phoenix Cloud · <b className="text-paper">vigia-peru</b></span>
        </div>
      </div>

      {/* tarjetas de métricas */}
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.l} className="bg-paper px-3 py-3 text-center">
            <div className="font-mono text-base font-bold tabular-nums text-ink">{s.v}</div>
            <div className="text-[9px] uppercase tracking-widest text-mute">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="border-b border-line bg-paperSoft px-5 py-1.5 text-center text-[10px] text-mute">
        cada llamada (tokens · costo · latencia · prompt/respuesta) queda como span en <b className="text-ink">Phoenix Cloud</b> — árbol completo por OCID
      </div>

      {/* evaluadores — 6 evaluadores ricos a todo el ancho */}
      <div className="border-b border-line bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink">
            <CheckCircle2 size={13} className="text-moss" /> Evaluadores · LLM-as-judge + código (6)
            {hasEvals && <span className="rounded-full bg-moss/15 px-1.5 py-0.5 text-[8px] font-bold text-moss">auto-evaluado</span>}
          </div>
          <span className="text-[9px] text-mute">
            {hasEvals ? "evaluado al cierre del análisis" : "se ejecuta al cierre del análisis"} · 4 vía LLM-as-judge · 2 deterministas
          </span>
        </div>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {EVALS.map((e) => {
            const ev = evalsByName[e.n];
            return (
              <li key={e.n} className="rounded border border-line/70 bg-paperSoft/40 px-2.5 py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-semibold text-ink">{e.label}</span>
                  {chipFor(ev)}
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-mute">{ev?.pregunta || e.d}</div>
                {ev?.metodo && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="rounded bg-ink/5 px-1 py-0.5 text-[8px] font-medium text-clay">{ev.metodo}</span>
                    {ev.objetivo && <span className="rounded bg-ink/5 px-1 py-0.5 text-[8px] text-mute">sobre: {ev.objetivo}</span>}
                  </div>
                )}
                {ev?.reason && <div className="mt-1 border-l-2 border-line pl-2 text-[9px] italic leading-snug text-mute/90">“{ev.reason}”</div>}
                {Array.isArray(ev?.faltantes) && ev.faltantes.length > 0 && (
                  <div className="mt-1 text-[9px] font-medium text-rust">faltó: {ev.faltantes.join(" · ")}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* trazas + guardrails */}
      <div className="bg-paper p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink"><AlertTriangle size={13} className="text-rust" /> Trazas + guardrails</div>
        <ul className="mt-1.5 grid gap-1 text-[10px] leading-snug text-mute sm:grid-cols-2">
          <li>· OpenInference instrumenta el <b className="text-ink">Runner ADK</b> (ciclo + cada <code className="text-ink">transfer_to_agent</code> entre los 11 agentes) <b className="text-ink">y</b> cada call a Gemini → árbol completo en Phoenix.</li>
          <li>· Anti-alucinación: «señal de riesgo», nunca acusación; evidencia oficial obligatoria.</li>
          <li>· Sin corroboración oficial no se emite bandera de delito (guardrail determinista).</li>
          <li>· RAG con grounding: Vertex AI Search sobre 721 opiniones OECE.</li>
        </ul>
      </div>
    </section>
  );
}

function AgentTraceSection({ trace }: { trace: AgentTraceEvent[] }) {
  // Agrupar por bloques de agente activo
  const agentes = Array.from(new Set(trace.map((e) => e.agent).filter(Boolean))) as string[];

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Sparkles size={11} className="mr-1 inline" />
          Auditoría técnica · {trace.length} pasos
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Pasos del análisis
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-mute">
          El orquestador (Gemini 2.5 Pro) razonó qué tools llamar en cada
          paso. Cada sub-agente (Doc Parser, Web Research, Report Writer)
          corrió su propio agent loop con sus tools. Acá ves la secuencia real.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {agentes.map((a) => {
            const v = AGENT_VISUAL[a] || { color: "bg-mute text-paper", icon: null, label: a };
            return (
              <span key={a} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", v.color)}>
                {v.icon} {v.label}
              </span>
            );
          })}
        </div>
      </div>

      <ol className="divide-y divide-line">
        {trace.map((e, i) => <AgentTraceRow key={i} idx={i} ev={e} />)}
      </ol>
    </section>
  );
}

function AgentTraceRow({ idx, ev }: { idx: number; ev: AgentTraceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const agent = ev.agent || "?";
  const visual = AGENT_VISUAL[agent] || { color: "bg-mute text-paper", icon: null, label: agent };

  let kindLabel: string = ev.kind || "?";
  let preview: React.ReactNode = null;
  let fullPayload: string | null = null;
  let hasMore = false;

  const safeJson = (v: any) => {
    try { return JSON.stringify(v, null, 2); }
    catch { return String(v); }
  };

  if (ev.kind === "tool_call") {
    kindLabel = "TOOL_CALL";
    const argsStr = safeJson(ev.args || {});
    hasMore = argsStr.length > 100;
    fullPayload = argsStr;
    preview = (
      <>
        <span className="font-mono text-sm font-bold text-ink">{ev.name}</span>
        <span className="text-[10px] text-mute"> ( </span>
        {Object.entries(ev.args || {}).map(([k, v], i) => (
          <span key={k} className="text-[10px]">
            {i > 0 && <span className="text-mute">, </span>}
            <span className="text-mute">{k}=</span>
            <span className="font-mono text-clay">{(() => { const s = JSON.stringify(v); return s.length > 140 ? s.slice(0, 140) + "…" : s; })()}</span>
          </span>
        ))}
        <span className="text-[10px] text-mute"> )</span>
      </>
    );
  } else if (ev.kind === "tool_result") {
    kindLabel = "TOOL_RESULT";
    const result = ev.result_preview;
    const fullStr = safeJson(result);
    hasMore = fullStr.length > 100;
    fullPayload = fullStr;
    const keys = result && typeof result === "object" ? Object.keys(result).slice(0, 5) : [];
    preview = (
      <>
        <span className="font-mono text-sm text-mute">{ev.name}</span>
        <span className="text-[10px] text-mute"> → </span>
        <span className="font-mono text-[11px] text-ink">
          {keys.length > 0 ? `{ ${keys.join(", ")} }` : JSON.stringify(result).slice(0, 100)}
        </span>
      </>
    );
  } else if (ev.kind === "transfer") {
    kindLabel = "TRANSFER";
    preview = (
      <>
        <span className="text-[11px] text-mute">→</span>
        <span className="font-mono text-sm font-bold text-clay">{ev.to}</span>
      </>
    );
  } else if (ev.kind === "thought") {
    kindLabel = "THOUGHT";
    const t = ev.text || "";
    hasMore = t.length > 200;
    fullPayload = t;
    preview = <span className="text-xs italic text-inkSoft">&quot;{t.slice(0, 200)}{hasMore ? "…" : ""}&quot;</span>;
  } else if (ev.kind === "error") {
    kindLabel = "ERROR";
    fullPayload = ev.detail || "";
    hasMore = (ev.detail || "").length > 200;
    preview = <span className="text-xs text-rust">{(ev.detail || "").slice(0, 200)}{hasMore ? "…" : ""}</span>;
  }

  const canExpand = hasMore && !!fullPayload;
  return (
    <li className={cn("px-5 py-2.5 transition-colors", canExpand ? "cursor-pointer hover:bg-paperSoft" : "hover:bg-paperSoft/40")}>
      <div className="flex items-start gap-3" onClick={() => canExpand && setExpanded(v => !v)}>
        <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[10px] text-mute">{String(idx).padStart(2, "0")}</span>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", visual.color)}>
          {visual.icon}{visual.label}
        </span>
        <span className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider",
          ev.kind === "tool_call"   && "bg-amber-soft text-amber",
          ev.kind === "tool_result" && "bg-moss/10 text-moss",
          ev.kind === "transfer"    && "bg-crimson-soft text-rust",
          ev.kind === "thought"     && "bg-paperDeep text-mute",
          ev.kind === "error"       && "bg-rust text-paper",
        )}>{kindLabel}</span>
        <div className="flex flex-wrap items-baseline gap-1 min-w-0 flex-1">{preview}</div>
        {canExpand && (
          <span className="mt-0.5 shrink-0 text-[10px] font-mono text-clay">
            {expanded ? "▼ ocultar" : "▶ ver"}
          </span>
        )}
      </div>
      {expanded && fullPayload && (
        <div className="mt-2 ml-9 rounded-md border border-line bg-paperSoft p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-widest text-mute">
              {ev.kind === "tool_call" ? "Entrada" :
               ev.kind === "tool_result" ? "Salida" :
               ev.kind === "thought" ? "Razonamiento" :
               ev.kind === "error" ? "ERROR COMPLETO" : "PAYLOAD"}
            </span>
            <button
              type="button"
              className="text-[9px] font-mono text-clay hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(fullPayload || "");
              }}
            >
              copiar
            </button>
          </div>
          <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-ink">
            {fullPayload}
          </pre>
        </div>
      )}
    </li>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 85 ? "rust" : score >= 70 ? "clay" : score >= 40 ? "amber" : "moss";
  const label = score >= 85 ? "CRÍTICO" : score >= 70 ? "ALTO" : score >= 40 ? "MEDIO" : "BAJO";
  const bg = {
    rust:  "bg-rust",
    clay:  "bg-clay",
    amber: "bg-amber",
    moss:  "bg-moss",
  }[tone];
  return (
    <div className="flex items-center gap-3">
      <div className={cn("flex h-16 w-16 flex-col items-center justify-center rounded-2xl text-paper shadow-card", bg)}>
        <span className="font-mono text-2xl font-bold leading-none">{score}</span>
        <span className="mt-0.5 text-[8px] uppercase tracking-widest opacity-90">/ 100</span>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-bold uppercase tracking-widest text-mute">Riesgo</div>
        <div className={cn(
          "font-mono text-sm font-bold",
          tone === "rust"  && "text-rust",
          tone === "clay"  && "text-clay",
          tone === "amber" && "text-amber",
          tone === "moss"  && "text-moss",
        )}>{label}</div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "ink" | "rust" | "amber" | "moss" }) {
  const cls = {
    ink:   "border-line bg-paperSoft text-ink",
    rust:  "border-rust/30 bg-crimson-soft text-rust",
    amber: "border-amber/40 bg-amber-soft text-amber",
    moss:  "border-moss/30 bg-paperSoft text-moss",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-2.5", cls)}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-mute">{label}</span>
        {icon}
      </div>
      <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function DocumentoCard({ doc, fmtMoney }: { doc: any; fmtMoney: (n: any) => string }) {
  const meta = doc.__doc_meta || {};
  const ext  = doc.extraccion || {};
  const items: any[]      = ext.items || [];
  const postores: any[]   = ext.postores_admitidos || ext.postores || [];
  const ganadores: any[]  = ext.ganadores || [];
  const redFlags: any[]   = ext.red_flags_observadas || ext.especs_restrictivas || [];
  const fundamento: any[] = ext.fundamento_legal || [];
  const hasError = !!doc.error;

  return (
    <article className={cn("surface overflow-hidden p-0", hasError && "border-rust/30")}>
      <div className="flex items-start justify-between gap-3 border-b border-line bg-paperDeep px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
            {doc.tipo || meta.documentType || "documento"}
          </div>
          <div className="truncate text-sm font-semibold text-ink">
            {meta.titulo || "(sin título)"}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mute">
            {meta.format && <span className="font-mono">{meta.format.toUpperCase()}</span>}
            {doc.size_bytes && <span>· {(doc.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}
            {meta.datePublished && <span>· {meta.datePublished.slice(0, 10)}</span>}
            {doc.format_detectado && <span>· detectado: {doc.format_detectado}</span>}
          </div>
        </div>
        {meta.url_oece && (
          <a href={meta.url_oece} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paperSoft px-2 py-1 text-[10px] font-medium text-clay hover:bg-paper">
            <ExternalLink size={10} /> PDF
          </a>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        {hasError && (
          <div className="rounded-lg border border-rust/30 bg-crimson-soft px-2.5 py-2 text-[11px] text-rust">
            <AlertTriangle size={11} className="mr-1 inline" />
            No se pudo procesar: <strong>{doc.error}</strong> · {doc.detail?.slice(0, 80)}
          </div>
        )}

        {ext.cuantia_total != null && ext.cuantia_total > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-paperSoft px-2.5 py-1.5 text-xs">
            <Coins size={13} className="text-clay" />
            <span className="text-mute">Cuantía total:</span>
            <span className="font-mono font-bold text-ink">{fmtMoney(ext.cuantia_total)}</span>
            {ext.fuente_financiamiento && (
              <span className="ml-auto rounded-full bg-paperDeep px-1.5 py-0 text-[10px] font-medium text-mute">
                {ext.fuente_financiamiento}
              </span>
            )}
          </div>
        )}

        {items.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-mute">
              <Package size={11} /> Items extraídos ({items.length})
            </div>
            <ul className="space-y-1">
              {items.slice(0, 4).map((it: any, i: number) => (
                <li key={i} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[11px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">
                      {it.numero || i + 1}. {(it.descripcion_corta || it.descripcion || "—").slice(0, 60)}
                    </span>
                    <span className="font-mono text-mute">{it.cantidad ?? "—"} {it.unidad ?? ""}</span>
                  </div>
                  {it.precio_unitario_referencial != null && (
                    <div className="mt-0.5 font-mono text-[10px] text-clay">
                      unit. {fmtMoney(it.precio_unitario_referencial)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(postores.length > 0 || ganadores.length > 0) && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-mute">
              <Users size={11} /> Postores y ganadores
            </div>
            <ul className="space-y-1">
              {(ganadores.length > 0 ? ganadores : postores).slice(0, 4).map((p: any, i: number) => (
                <li key={i} className="rounded-lg bg-amber-soft/50 px-2.5 py-1 text-[11px]">
                  <div className="flex items-center gap-2">
                    <Award size={10} className="text-amber" />
                    <span className="font-medium text-ink truncate flex-1">{p.razon_social || p.nombre || p.empresa || "—"}</span>
                    {(p.monto_oferta != null || p.monto != null) && (
                      <span className="font-mono text-mute">{fmtMoney(p.monto_oferta ?? p.monto)}</span>
                    )}
                  </div>
                  {p.ruc && <div className="ml-4 font-mono text-[10px] text-mute">RUC {p.ruc}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {redFlags.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-rust">
              <AlertTriangle size={11} /> Red flags observados por el agente
            </div>
            <ul className="space-y-0.5">
              {redFlags.slice(0, 4).map((f: any, i: number) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-ink">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rust" />
                  <span>{typeof f === "string" ? f : (f.detalle || JSON.stringify(f).slice(0, 80))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {fundamento.length > 0 && (
          <div className="text-[10px] text-mute">
            <Scale size={10} className="mr-1 inline" />
            Fundamento: {fundamento.slice(0, 2).join(" · ")}
          </div>
        )}

        {doc.resumen && (
          <p className="border-t border-line pt-2 text-[11px] italic leading-relaxed text-mute">
            "{doc.resumen}"
          </p>
        )}
      </div>
    </article>
  );
}

// ─── Nuevos componentes para JSON estructurado ───────────────

const VEREDICTO_VISUAL: Record<string, { color: string; bg: string; emoji: string; label: string }> = {
  alineado:      { color: "text-moss",  bg: "bg-moss/10 border-moss/30",   emoji: "🟢", label: "ALINEADO" },
  elevado:       { color: "text-amber", bg: "bg-amber-soft border-amber/40", emoji: "🟠", label: "ELEVADO" },
  muy_elevado:   { color: "text-rust",  bg: "bg-crimson-soft border-rust/40", emoji: "🔴", label: "MUY ELEVADO" },
  barato:        { color: "text-clay",  bg: "bg-paperSoft border-line",     emoji: "🔵", label: "BARATO" },
  estimacion:    { color: "text-mute",  bg: "bg-paperDeep border-line",     emoji: "⚪", label: "ESTIMACIÓN" },
  sin_ofertado:  { color: "text-mute",  bg: "bg-paperSoft border-line",     emoji: "🔍", label: "S/ OFERTADO" },
};

function ItemsConMarketPrice({ items, market, fmtMoney }: { items: any[]; market: any; fmtMoney: (n: any) => string }) {
  // State para expandir filas (mostrar todas las características de un ítem)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const findingsRaw = market?.findings || [];
  // Deduplicar findings: a) por item_numero normalizado (sin ceros), b) por descripción
  // exacta — el LLM a veces emite "1" y "01.1" para el mismo producto.
  const normalizeNum = (n: any) => String(n ?? "").trim().replace(/^0+(?=\d)/, "");
  const seenKey = new Set<string>();
  const findings = findingsRaw.filter((f: any) => {
    const k1 = normalizeNum(f.item_numero);
    const k2 = String(f.item_descripcion || "").trim().toLowerCase().slice(0, 60);
    const compoundKey = `${k1}|${k2}`;
    if (!k1 && !k2) return true;
    if (seenKey.has(compoundKey)) return false;
    seenKey.add(compoundKey);
    return true;
  });
  const findingByNumero = new Map(findings.map((f: any) => [normalizeNum(f.item_numero), f]));
  // Padre del LOTE (cuando OCDS tiene 1 ítem global y parser desglosa N sub-items).
  // Viene de market_analysis.padre_lote. El padre NO se renderiza como fila
  // normal — se muestra arriba como banner del lote.
  const padreLote = market?.padre_lote || null;
  const itemsExpandidos: Array<{ ocdsItem: any; finding: any; key: string; esLote?: boolean }> = [];
  if (padreLote) {
    itemsExpandidos.push({
      ocdsItem: {
        numero: padreLote.numero,
        descripcion: padreLote.descripcion,
        cantidad: padreLote.cantidad,
        unidad: padreLote.unidad,
        cuantia_referencial: padreLote.cuantia_total,
      },
      finding: null,
      key: "lote-padre",
      esLote: true,
    });
  }
  // Sub-items: vienen de findings (con item_numero "1.1", "2", "3"…)
  const padreNum = padreLote ? normalizeNum(padreLote.numero) : null;
  for (const f of findings) {
    const k = normalizeNum(f.item_numero);
    if (padreNum && k === padreNum) continue; // skip findings que apunten al padre
    itemsExpandidos.push({ ocdsItem: null, finding: f, key: k || String(itemsExpandidos.length) });
  }
  // Si no hay padre detectado, usar los items OCDS originales como antes
  if (!padreLote) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const f: any = findingByNumero.get(normalizeNum(it.numero)) || findings[i];
      if (itemsExpandidos.some(x => x.finding === f)) continue;
      itemsExpandidos.unshift({ ocdsItem: it, finding: f, key: String(it.numero || i + 1) });
    }
  }
  return (
    <>
      {/* TABLA RESUMEN — comparación a primera vista */}
      {findings.length > 0 && (
        <div className="overflow-x-auto border-b border-line bg-paperSoft">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-line text-left text-mute">
                <th className="px-3 py-2 font-bold uppercase tracking-wider">#</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Producto</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Características clave</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Cant</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Precio ref.</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Mediana mercado</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Δ%</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Veredicto</th>
              </tr>
            </thead>
            <tbody>
              {itemsExpandidos.filter(x => x.esLote).map(({ ocdsItem, key }) => (
                <tr key={key} className="border-b-2 border-clay/30 bg-clay/5 align-top">
                  <td colSpan={8} className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-clay/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-clay">
                          🧺 LOTE OCDS · {ocdsItem?.cantidad ?? 1} {ocdsItem?.unidad || "Unidad"}
                        </span>
                        <div className="mt-0.5 text-[12px] font-semibold text-ink">
                          {String(ocdsItem?.descripcion || "").slice(0, 140)}
                        </div>
                        <div className="text-[10px] italic text-mute">
                          Los precios se desglosan abajo por sub-ítem. Se compara la suma estimada de mercado contra este monto.
                        </div>
                      </div>
                      <div className="text-right font-mono font-bold text-ink">
                        <div className="text-[9px] uppercase tracking-wider text-mute">cuantía lote</div>
                        <div className="text-base">{fmtMoney(ocdsItem?.cuantia_referencial)}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {itemsExpandidos.filter(x => !x.esLote).map(({ ocdsItem, finding, key }) => {
                const v = (finding?.veredicto && VEREDICTO_VISUAL[finding.veredicto]) || null;
                const desc = finding?.item_descripcion || ocdsItem?.descripcion || "—";
                const cantidad = finding?.cantidad ?? ocdsItem?.cantidad;
                const unidad = finding?.unidad || ocdsItem?.unidad || "UND";
                // Sub-items NO tienen precio referencial (no se distribuye desde el lote padre)
                const precioRef = finding?.precio_unitario_referencial;
                const caracs = finding?.caracteristicas_solicitadas_clave || [];
                return (
                  <tr key={key} className="border-b border-line/50 align-top hover:bg-paper">
                    <td className="px-3 py-2 font-mono font-bold text-clay">{key}</td>
                    <td className="px-3 py-2 text-ink">
                      <div className="font-semibold leading-tight">{String(desc).slice(0, 80)}{String(desc).length > 80 ? "…" : ""}</div>
                    </td>
                    <td className="px-3 py-2 text-mute">
                      {caracs.length > 0 ? (
                        (() => {
                          const isOpen = expandedRows.has(key);
                          const shown = isOpen ? caracs : caracs.slice(0, 3);
                          return (
                            <ul className="space-y-0.5">
                              {shown.map((c: string, j: number) => (
                                <li key={j} className="flex items-start gap-1">
                                  <CheckCircle2 size={9} className="mt-0.5 shrink-0 text-clay" />
                                  <span>{c}</span>
                                </li>
                              ))}
                              {caracs.length > 3 && (
                                <li>
                                  <button
                                    type="button"
                                    onClick={() => toggleRow(key)}
                                    className="mt-1 inline-flex items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-clay hover:bg-clay/20"
                                  >
                                    {isOpen
                                      ? `▲ ocultar (${caracs.length - 3} ocultas)`
                                      : `▼ ver +${caracs.length - 3} más`}
                                  </button>
                                </li>
                              )}
                            </ul>
                          );
                        })()
                      ) : (
                        <span className="italic text-mute">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink">
                      {cantidad ?? "—"}
                      <div className="text-[9px] text-mute">{unidad}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-ink">
                      {typeof precioRef === "number" && precioRef > 0 ? fmtMoney(precioRef) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-ink">
                      {typeof finding?.precio_mediana_mercado === "number"
                        ? fmtMoney(finding.precio_mediana_mercado)
                        : "—"}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-mono font-bold",
                      typeof finding?.diff_pct === "number"
                        ? finding.diff_pct > 15 ? "text-rust" : finding.diff_pct < -15 ? "text-clay" : "text-moss"
                        : "text-mute")}>
                      {typeof finding?.diff_pct === "number"
                        ? `${finding.diff_pct > 0 ? "+" : ""}${finding.diff_pct.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {v ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", v.color)}>
                          {v.emoji} {v.label}
                        </span>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* FILA DE TOTALES — comparación triple del lote */}
              {(() => {
                const subItems = itemsExpandidos.filter(x => !x.esLote);
                let totalMercado = 0;
                let nConPrecio = 0;
                for (const x of subItems) {
                  const med = x.finding?.precio_mediana_mercado;
                  const cant = x.finding?.cantidad ?? x.ocdsItem?.cantidad;
                  if (typeof med === "number" && typeof cant === "number") {
                    totalMercado += med * cant;
                    nConPrecio++;
                  }
                }
                const totalReferencial = padreLote
                  ? padreLote.cuantia_total
                  : items.filter(it => (it.cuantia_referencial ?? 0) > 0)
                      .reduce((s, it) => s + (it.cuantia_referencial || 0), 0);
                if (nConPrecio === 0 && !totalReferencial) return null;
                // Cobertura: fracción de sub-ítems con mediana de mercado. Comparar
                // la cuantía TOTAL del lote (todos los ítems) contra una suma de
                // mercado PARCIAL (pocos ítems con precio) es apples-vs-oranges y
                // produce falsos "LOTE MUY ELEVADO". Solo damos veredicto de lote
                // con cobertura alta (≥70% de los sub-ítems tienen mediana).
                const cobertura = subItems.length > 0 ? nConPrecio / subItems.length : 0;
                const comparable = cobertura >= 0.7 && totalReferencial > 0 && totalMercado > 0;
                const diffMercado = comparable
                  ? ((totalReferencial - totalMercado) / totalMercado) * 100 : null;
                return (
                  <tr className="border-t-2 border-clay/40 bg-clay/5 font-bold">
                    <td colSpan={4} className="px-3 py-3 text-right text-[10px] uppercase tracking-widest text-mute">
                      Total estimado de mercado<br/>(Σ cantidad × mediana de sub-ítems)
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-ink">
                      {totalReferencial > 0 ? fmtMoney(totalReferencial) : "—"}
                      <div className="text-[9px] font-normal text-mute">cuantía OCDS</div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-ink">
                      {totalMercado > 0 ? fmtMoney(totalMercado) : "—"}
                      <div className="text-[9px] font-normal text-mute">{nConPrecio}/{subItems.length} sub-ítems con mercado</div>
                    </td>
                    <td className={cn("px-3 py-3 text-right font-mono",
                      diffMercado != null
                        ? diffMercado > 15 ? "text-rust" : diffMercado < -15 ? "text-clay" : "text-moss"
                        : "text-mute")}>
                      {diffMercado != null ? `${diffMercado > 0 ? "+" : ""}${diffMercado.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-3 text-left">
                      {diffMercado != null ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider",
                          diffMercado > 50 ? "bg-crimson-soft text-rust" :
                          diffMercado > 15 ? "bg-amber-soft text-amber" :
                          diffMercado < -15 ? "bg-paperSoft text-clay" : "bg-moss/10 text-moss")}>
                          {diffMercado > 50 ? "🔴 LOTE MUY ELEVADO" :
                            diffMercado > 15 ? "🟠 LOTE ELEVADO" :
                            diffMercado < -15 ? "🔵 LOTE BARATO" : "🟢 LOTE ALINEADO"}
                        </span>
                      ) : (
                        <span className="text-[9px] normal-case text-mute">
                          cobertura parcial ({nConPrecio}/{subItems.length}) — no comparable con la cuantía del lote
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* CARDS DESPLEGABLES — detalle por sub-ítem (no por items OCDS, que solo
          tiene 1 entrada cuando es un lote) */}
      <ul className="divide-y divide-line">
      {itemsExpandidos.filter(x => !x.esLote).map(({ ocdsItem, finding: f, key }, i) => {
        const v = (f?.veredicto && VEREDICTO_VISUAL[f.veredicto]) || null;
        const desc = f?.item_descripcion || ocdsItem?.descripcion || "—";
        const cantidad = f?.cantidad ?? ocdsItem?.cantidad;
        const unidad = f?.unidad || ocdsItem?.unidad || "UND";
        const costoLinea = (typeof f?.precio_mediana_mercado === "number" && typeof cantidad === "number")
          ? f.precio_mediana_mercado * cantidad : null;
        return (
          <li key={key || i} className="px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paperDeep font-mono text-[10px] font-bold text-clay">
                {key || i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{desc}</div>
                {ocdsItem?.cubso_descripcion && ocdsItem.cubso_descripcion !== desc && (
                  <div className="mt-0.5 text-[11px] text-mute">
                    <span className="font-mono">CUBSO {ocdsItem.cubso}</span> · {ocdsItem.cubso_descripcion}
                  </div>
                )}
              </div>
              <div className="text-right">
                {typeof costoLinea === "number" && (
                  <>
                    <div className="font-mono text-sm font-bold text-ink">{fmtMoney(costoLinea)}</div>
                    <div className="font-mono text-[10px] text-mute">estimado mercado</div>
                  </>
                )}
                <div className="font-mono text-[10px] text-mute">{cantidad ?? "—"} {unidad}</div>
                {typeof f?.precio_mediana_mercado === "number" && (
                  <div className="font-mono text-[10px] text-mute">unit. {fmtMoney(f.precio_mediana_mercado)}</div>
                )}
              </div>
            </div>

            {/* MARKET PRICE — análisis del agente por ítem */}
            {f && v && (
              <div className={cn("mt-3 ml-10 rounded-xl border p-3 text-xs", v.bg)}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={cn("inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest", v.color)}>
                    <Receipt size={10} /> market_price_agent · {v.label}
                  </span>
                  {typeof f.diff_pct === "number" && (
                    <span className={cn("font-mono text-[11px] font-bold", v.color)}>
                      {f.diff_pct > 0 ? "+" : ""}{f.diff_pct.toFixed(1)}% vs mediana
                    </span>
                  )}
                  {f.es_estimacion && (
                    <span className="rounded-full bg-paperDeep px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-mute">estim.</span>
                  )}
                </div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <div>
                    <span className="text-mute">Mediana mercado:</span>{" "}
                    <span className="font-mono font-bold text-ink">{fmtMoney(f.precio_mediana_mercado)}</span>
                  </div>
                  {f.rango_min != null && f.rango_max != null && (
                    <div>
                      <span className="text-mute">Rango:</span>{" "}
                      <span className="font-mono text-ink">{fmtMoney(f.rango_min)} – {fmtMoney(f.rango_max)}</span>
                    </div>
                  )}
                </div>
                {f.comentario && <p className="mt-2 leading-relaxed text-ink">{f.comentario}</p>}
                {(f.fuentes || []).length > 0 && (
                  <div className="mt-2 text-[10px] text-mute">
                    <strong className="text-ink">Fuentes:</strong> {(f.fuentes as string[]).join(" · ")}
                  </div>
                )}
                {f.spec_restrictiva && (
                  <div className="mt-2 rounded-md bg-rust/10 px-2 py-1 text-[10px] text-rust">
                    <AlertTriangle size={10} className="mr-1 inline" />
                    <strong>Spec restrictiva:</strong> {f.spec_restrictiva}
                  </div>
                )}

                {/* Características clave solicitadas (de v2.0 prompt) */}
                {Array.isArray(f.caracteristicas_solicitadas_clave) && f.caracteristicas_solicitadas_clave.length > 0 && (
                  <div className="mt-3 rounded-md border border-line bg-paperSoft px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
                      Características solicitadas en el REQUERIMIENTO
                    </div>
                    <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
                      {f.caracteristicas_solicitadas_clave.map((c: string, j: number) => (
                        <li key={j} className="flex items-start gap-1.5 text-[11px] text-ink">
                          <CheckCircle2 size={10} className="mt-0.5 shrink-0 text-clay" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Precios observados con URL + proveedor + cumplimiento */}
                {Array.isArray(f.precios_observados) && f.precios_observados.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-mute">
                      Precios observados en mercado · {f.precios_observados.length} referencia(s)
                    </div>
                    <div className="mt-1 overflow-x-auto">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="border-b border-line text-left text-mute">
                            <th className="py-1.5 pr-2 font-semibold">Producto / Proveedor</th>
                            <th className="py-1.5 pr-2 font-semibold">Tipo</th>
                            <th className="py-1.5 pr-2 text-right font-semibold">Precio</th>
                            <th className="py-1.5 font-semibold">Cumple</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.precios_observados.map((p: any, j: number) => (
                            <tr key={j} className="border-b border-line/50 align-top">
                              <td className="py-1.5 pr-2 text-ink">
                                <div className="font-semibold">{p.producto_titulo || "—"}</div>
                                <div className="text-mute">
                                  {p.proveedor || "—"}
                                  {p.url && (
                                    <a href={p.url} target="_blank" rel="noreferrer"
                                       className="ml-2 inline-flex items-center gap-0.5 text-clay hover:underline">
                                      ver <ExternalLink size={8} />
                                    </a>
                                  )}
                                </div>
                                {Array.isArray(p.caracteristicas_no_cumplidas) && p.caracteristicas_no_cumplidas.length > 0 && (
                                  <div className="mt-0.5 text-[10px] italic text-rust">
                                    no cumple: {p.caracteristicas_no_cumplidas.join(", ")}
                                  </div>
                                )}
                              </td>
                              <td className="py-1.5 pr-2 text-mute">
                                <span className="rounded bg-paperDeep px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                                  {p.tipo || "—"}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 text-right font-mono font-bold text-ink">
                                {typeof p.valor === "number" ? fmtMoney(p.valor) : "—"}
                              </td>
                              <td className="py-1.5">
                                {p.cumple_caracteristicas === true && (
                                  <span className="inline-flex items-center gap-0.5 text-moss">
                                    <CheckCircle2 size={11} /> sí
                                  </span>
                                )}
                                {p.cumple_caracteristicas === false && (
                                  <span className="inline-flex items-center gap-0.5 text-rust">
                                    <AlertTriangle size={11} /> no
                                  </span>
                                )}
                                {p.cumple_caracteristicas == null && (
                                  <span className="text-mute">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Proveedores potenciales en Perú */}
                {Array.isArray(f.proveedores_potenciales) && f.proveedores_potenciales.length > 0 && (
                  <div className="mt-3 rounded-md bg-paperSoft px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-mute">
                      Proveedores potenciales (donde la entidad podría haber cotizado)
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {f.proveedores_potenciales.map((p: any, j: number) => (
                        <li key={j} className="text-[11px] text-ink">
                          <strong>{p.nombre || "—"}</strong>
                          {p.linea && <span className="text-mute"> · línea {p.linea}</span>}
                          {p.url && (
                            <a href={p.url} target="_blank" rel="noreferrer"
                               className="ml-2 inline-flex items-center gap-0.5 text-clay hover:underline">
                              <ExternalLink size={9} />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Queries que ejecutó el agente (mostradas como debug útil) */}
                {Array.isArray(f.queries_realizadas) && f.queries_realizadas.length > 0 && (
                  <details className="mt-2 text-[10px] text-mute">
                    <summary className="cursor-pointer hover:text-ink">
                      Queries realizadas ({f.queries_realizadas.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {f.queries_realizadas.map((q: string, j: number) => (
                        <li key={j} className="font-mono italic">→ {q}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </li>
        );
      })}
      </ul>
    </>
  );
}

// ─── BANDERAS agrupadas + filtros + clickeables ───────────────────────
type Bandera = {
  regla?: string;
  severidad?: "alta" | "media" | "baja";
  evidencia?: string;
  norma?: string;
  fuente_url?: string;
  agente_origen?: string;
  vector?: string;
  item_afectado?: string;
  opinion_oece_relacionada?: { num_opinion?: string; snippet?: string; url?: string };
  evidencia_textual?: string;
};

const AGENTE_VISUAL: Record<string, { label: string; chipClass: string; iconClass: string }> = {
  compliance_agent:               { label: "Compliance",        chipClass: "bg-rust/15 text-rust",      iconClass: "text-rust" },
  compliance_extended_agent:      { label: "Compliance ext.",   chipClass: "bg-rust/10 text-rust",      iconClass: "text-rust" },
  document_legal_analyst_agent:   { label: "Legal analyst",     chipClass: "bg-clay/15 text-clay",      iconClass: "text-clay" },
  document_parser_agent:          { label: "Doc parser",        chipClass: "bg-amber/15 text-amber",    iconClass: "text-amber" },
  market_price_agent:             { label: "Market price",      chipClass: "bg-moss/15 text-moss",      iconClass: "text-moss" },
  person_network_agent:           { label: "Person network",    chipClass: "bg-mute/15 text-mute",      iconClass: "text-mute" },
  news_research_agent:            { label: "News research",     chipClass: "bg-paperDeep text-inkSoft", iconClass: "text-inkSoft" },
  web_research_agent:             { label: "Web research",      chipClass: "bg-paperDeep text-inkSoft", iconClass: "text-inkSoft" },
  "?":                            { label: "Sistema",           chipClass: "bg-line text-ink",          iconClass: "text-mute" },
};

function inferAgente(b: Bandera): string {
  if (b.agente_origen && AGENTE_VISUAL[b.agente_origen]) return b.agente_origen;
  const r = (b.regla || "").toLowerCase();
  if (r === "unico_postor_alto" || r === "procedimiento_no_competitivo" || r === "proveedor_sancionado_osce") return "compliance_agent";
  if (r === "red_flag_documental") return "document_legal_analyst_agent";
  if (r.startsWith("sobreprecio") || r === "spec_restrictiva") return "market_price_agent";
  if (r === "concentracion_entidad" || r === "edad_ruc_ganador" || r === "ciiu_vs_objeto" ||
      r === "tipo_proceso_vs_monto" || r === "directa_sin_fundamento" || r === "plazo_convocatoria_minimo" ||
      r === "firmante_vinculado") return "compliance_extended_agent";
  return "?";
}

function BanderasAgrupadas({ banderas, reglas_evaluadas }: { banderas: Bandera[]; reglas_evaluadas: number }) {
  const [filtroSev, setFiltroSev] = useState<"todas" | "alta" | "media" | "baja">("todas");
  const [filtroAgente, setFiltroAgente] = useState<string>("todos");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const banderasFiltradas = banderas.filter(b => {
    if (filtroSev !== "todas" && b.severidad !== filtroSev) return false;
    if (filtroAgente !== "todos" && inferAgente(b) !== filtroAgente) return false;
    return true;
  });

  const conteoSev = {
    alta:  banderas.filter(b => b.severidad === "alta").length,
    media: banderas.filter(b => b.severidad === "media").length,
    baja:  banderas.filter(b => b.severidad === "baja").length,
  };
  const agentesUnicos = Array.from(new Set(banderas.map(inferAgente)));
  const conteoAgente: Record<string, number> = {};
  for (const a of agentesUnicos) conteoAgente[a] = banderas.filter(b => inferAgente(b) === a).length;

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-clay">
              <ShieldAlert size={11} /> Banderas detectadas · {reglas_evaluadas} reglas evaluadas
            </div>
            <h2 className="mt-1 font-serif text-xl font-bold text-ink">
              {banderas.length} bandera{banderas.length === 1 ? "" : "s"} en total
            </h2>
          </div>
          {/* CONTADORES POR SEVERIDAD */}
          <div className="flex gap-2">
            {(["alta", "media", "baja"] as const).map(s => (
              conteoSev[s] > 0 && (
                <span key={s} className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                  s === "alta"  && "bg-rust/15 text-rust",
                  s === "media" && "bg-amber/15 text-amber",
                  s === "baja"  && "bg-line text-ink",
                )}>
                  ● {conteoSev[s]} {s}
                </span>
              )
            ))}
          </div>
        </div>

        {/* FILTROS */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setFiltroSev("todas"); setFiltroAgente("todos"); }}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
              filtroSev === "todas" && filtroAgente === "todos"
                ? "border-clay bg-clay text-paper"
                : "border-line bg-paperSoft text-mute hover:text-ink",
            )}
          >Todas ({banderas.length})</button>
          {(["alta", "media", "baja"] as const).map(s => (
            conteoSev[s] > 0 && (
              <button
                key={s}
                type="button"
                onClick={() => setFiltroSev(filtroSev === s ? "todas" : s)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                  filtroSev === s
                    ? (s === "alta" ? "border-rust bg-rust text-paper" :
                       s === "media" ? "border-amber bg-amber text-paper" :
                                       "border-mute bg-mute text-paper")
                    : "border-line bg-paperSoft text-mute hover:text-ink",
                )}
              >● {s} ({conteoSev[s]})</button>
            )
          ))}
          {agentesUnicos.length > 1 && (
            <div className="ml-1 flex gap-1.5 border-l border-line pl-2">
              {agentesUnicos.map(a => {
                const v = AGENTE_VISUAL[a] || AGENTE_VISUAL["?"];
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setFiltroAgente(filtroAgente === a ? "todos" : a)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                      filtroAgente === a
                        ? cn("border-transparent", v.chipClass.replace("/15", "/30"), "font-bold")
                        : cn("border-line bg-paperSoft hover:text-ink", v.iconClass),
                    )}
                  >{v.label} ({conteoAgente[a]})</button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* LISTA DE BANDERAS */}
      <ul className="divide-y divide-line">
        {banderasFiltradas.map((b, i) => {
          const agt = inferAgente(b);
          const av = AGENTE_VISUAL[agt] || AGENTE_VISUAL["?"];
          const isOpen = expandedIdx === i;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => setExpandedIdx(isOpen ? null : i)}
                className={cn(
                  "block w-full px-5 py-3 text-left transition-colors hover:bg-paperSoft",
                  b.severidad === "alta"  && "border-l-4 border-l-rust",
                  b.severidad === "media" && "border-l-4 border-l-amber",
                  b.severidad === "baja"  && "border-l-4 border-l-line",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className={cn(
                    "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    b.severidad === "alta"  ? "bg-rust text-paper" :
                    b.severidad === "media" ? "bg-amber text-paper" :
                                              "bg-line text-ink",
                  )}>!</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                        av.chipClass,
                      )}>{av.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-mute">{b.regla}</span>
                      {b.vector && (
                        <span className="rounded bg-paperDeep px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-mute">
                          vector: {b.vector}
                        </span>
                      )}
                      {b.item_afectado && (
                        <span className="text-[9px] font-mono text-mute">ítem #{b.item_afectado}</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink line-clamp-2">{b.evidencia}</p>
                  </div>
                  <span className="mt-0.5 shrink-0 text-[10px] font-mono text-clay">
                    {isOpen ? "▼" : "▶"}
                  </span>
                </div>
              </button>

              {/* EXPANDED — detalle completo */}
              {isOpen && (
                <div className="border-t border-line bg-paperSoft px-5 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-mute">Evidencia completa</div>
                      <p className="mt-1 text-sm leading-relaxed text-ink">{b.evidencia}</p>
                    </div>
                    {b.evidencia_textual && (
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-mute">Texto del documento</div>
                        <blockquote className="mt-1 border-l-2 border-clay/40 pl-2 text-xs italic text-inkSoft">
                          &quot;{b.evidencia_textual}&quot;
                        </blockquote>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-paper p-2.5">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-clay">Norma citada</div>
                      <div className="mt-0.5 text-xs text-ink">{b.norma || "—"}</div>
                    </div>
                    {b.opinion_oece_relacionada?.num_opinion && (
                      <div className="rounded-lg bg-paper p-2.5">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-clay">Opinión OECE</div>
                        <div className="mt-0.5 text-xs text-ink">
                          <strong className="font-mono">{b.opinion_oece_relacionada.num_opinion}</strong>
                          {b.opinion_oece_relacionada.url && (
                            <a href={b.opinion_oece_relacionada.url} target="_blank" rel="noreferrer"
                               className="ml-2 inline-flex items-center gap-1 text-clay hover:underline">
                              abrir <ExternalLink size={9} />
                            </a>
                          )}
                        </div>
                        {b.opinion_oece_relacionada.snippet && (
                          <p className="mt-1 text-[11px] italic text-inkSoft line-clamp-3">
                            &quot;{b.opinion_oece_relacionada.snippet}&quot;
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {b.fuente_url && (
                    <div className="mt-2 flex justify-end">
                      <a href={b.fuente_url} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-clay hover:underline">
                        Ver fuente <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {banderasFiltradas.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-mute">
          Ninguna bandera coincide con los filtros aplicados.
        </div>
      )}
    </section>
  );
}

function MarketVerdictCard({ market, fmtMoney }: { market: any; fmtMoney: (n: any) => string }) {
  const v = VEREDICTO_VISUAL[market.veredicto_global] || VEREDICTO_VISUAL.estimacion;
  // Fallback: si el LLM no llenó total_estimado_mercado, lo calculamos desde
  // los findings sumando mediana × cantidad por sub-item.
  const computedTotalMercado = (() => {
    if (typeof market.total_estimado_mercado === "number" && market.total_estimado_mercado > 0)
      return market.total_estimado_mercado;
    const findings = market?.findings || [];
    let total = 0;
    let hits = 0;
    for (const f of findings) {
      if (typeof f.costo_total_mercado_estimado === "number") {
        total += f.costo_total_mercado_estimado;
        hits++;
      } else if (typeof f.precio_mediana_mercado === "number" && typeof f.cantidad === "number") {
        total += f.precio_mediana_mercado * f.cantidad;
        hits++;
      }
    }
    return hits > 0 ? total : null;
  })();
  return (
    <section className={cn("rounded-2xl border p-5", v.bg)}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className={cn("inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest", v.color)}>
            <Receipt size={11} /> Veredicto global · tasación vs mercado
          </div>
          <h2 className="mt-1 font-serif text-2xl font-bold text-ink">{v.emoji} {v.label}</h2>
          {typeof market.n_items === "number" && market.n_items > 0 && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-paper/70 px-2.5 py-0.5 text-[11px] text-ink">
              <span className="font-mono font-bold">{market.n_con_mediana ?? 0}/{market.n_items}</span>
              <span className="text-mute">ítems con precio de mercado</span>
              {typeof market.cobertura_mercado === "number" && (
                <span className={cn("font-mono font-bold",
                  market.cobertura_mercado >= 0.7 ? "text-moss" :
                  market.cobertura_mercado >= 0.5 ? "text-clay" : "text-rust")}>
                  · {Math.round(market.cobertura_mercado * 100)}%
                </span>
              )}
            </div>
          )}
        </div>
        {typeof market.sobreprecio_abs === "number" && market.sobreprecio_abs > 0 && (
          <div className="text-right">
            <div className={cn("font-mono text-2xl font-bold", v.color)}>
              +{fmtMoney(market.sobreprecio_abs)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-mute">
              sobreprecio detectado ({(market.sobreprecio_pct ?? 0).toFixed(1)}%)
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Kpi
          icon={<Coins size={14} />}
          label="Total ofertado"
          value={fmtMoney(market.total_ofertado ?? market?.padre_lote?.cuantia_total)}
          tone="ink"
        />
        <Kpi
          icon={<Coins size={14} />}
          label={typeof market.total_estimado_mercado === "number" && market.total_estimado_mercado > 0
            ? "Estimado de mercado"
            : "Estimado de mercado (suma de sub-ítems)"}
          value={fmtMoney(computedTotalMercado)}
          tone="ink"
        />
      </div>
      {(() => {
        const totalOfertado = market.total_ofertado ?? market?.padre_lote?.cuantia_total;
        if (typeof computedTotalMercado !== "number" || typeof totalOfertado !== "number" || totalOfertado <= 0)
          return null;
        const diff = totalOfertado - computedTotalMercado;
        const diffPct = (diff / computedTotalMercado) * 100;
        return (
          <div className="mt-2 rounded-lg bg-paper/70 px-3 py-2 text-[11px] text-ink">
            <span className="text-mute">Diferencia ofertado vs mercado: </span>
            <span className={cn("font-mono font-bold",
              totalOfertado > computedTotalMercado * 1.15 ? "text-rust" :
              totalOfertado < computedTotalMercado * 0.85 ? "text-clay" : "text-moss")}>
              {diff > 0 ? "+" : ""}{fmtMoney(diff)} ({diffPct.toFixed(1)}%)
            </span>
          </div>
        );
      })()}
      {(market.observaciones_clave || []).length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink">
          {market.observaciones_clave.map((o: string, i: number) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-clay" />
              <span>{o}</span>
            </li>
          ))}
        </ul>
      )}
      {market.recomendacion && (
        <div className="mt-3 rounded-lg bg-paper/60 p-3 text-xs italic text-ink">
          <Sparkles size={11} className="mr-1 inline text-clay" />
          {market.recomendacion}
        </div>
      )}
    </section>
  );
}

function PostoresSection({ postores, fmtMoney }: { postores: any[]; fmtMoney: (n: any) => string }) {
  const ganadores = postores.filter(p => p.es_ganador);
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Users size={11} className="mr-1 inline" />
          Postores · {postores.length} · {ganadores.length} ganador{ganadores.length === 1 ? "" : "es"}
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Quién ofertó · Quién ganó
        </h2>
      </div>
      <ul className="divide-y divide-line">
        {postores.map((p, i) => (
          <li key={i} className="px-5 py-3">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                p.es_ganador ? "bg-clay text-paper" : "bg-paperDeep text-mute",
              )}>
                {p.es_ganador ? <Award size={15} /> : <Building2 size={15} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-ink">{p.nombre}</span>
                  {p.es_ganador && (
                    <span className="rounded-full bg-clay px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-paper">GANADOR</span>
                  )}
                  {p.es_consorcio && (
                    <span className="rounded-full bg-amber-soft px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-amber">CONSORCIO</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mute">
                  <span className="font-mono">RUC {p.ruc}</span>
                  <span>·</span>
                  <span>{(p.roles || []).join(" + ")}</span>
                </div>
              </div>
              {p.monto_ganado != null && p.monto_ganado > 0 && (
                <div className="text-right">
                  <div className="font-mono text-sm font-bold text-clay">{fmtMoney(p.monto_ganado)}</div>
                  <div className="text-[9px] uppercase tracking-wider text-mute">adjudicado</div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DocumentosSection({
  documentos, parserDocs, fundamento, modalidad,
}: { documentos: any[]; parserDocs: any[]; fundamento: string[]; modalidad?: string }) {
  const [normasOpen, setNormasOpen] = useState(false);
  const parserByUrl = new Map(parserDocs.map((d: any) => [d.url, d]));
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <FileText size={11} className="mr-1 inline" />
          Documentos del expediente · {documentos.length}
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Expediente del proceso
        </h2>
        {(modalidad || fundamento.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {modalidad && (
              <span className="rounded-full bg-paperSoft px-2 py-0.5 text-[10px] font-medium text-ink">Modalidad: {modalidad}</span>
            )}
            {(normasOpen ? fundamento : fundamento.slice(0, 3)).map((f, i) => (
              <span key={i} className="rounded-full bg-paperSoft px-2 py-0.5 text-[10px] font-medium text-ink">
                <Scale size={9} className="mr-0.5 inline text-clay" />{f}
              </span>
            ))}
            {fundamento.length > 3 && (
              <button
                type="button"
                onClick={() => setNormasOpen((p) => !p)}
                className="rounded-full bg-clay/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-clay hover:bg-clay/20"
              >
                {normasOpen
                  ? `▲ ocultar ${fundamento.length - 3} normas`
                  : `▼ ver +${fundamento.length - 3} normas`}
              </button>
            )}
          </div>
        )}
      </div>
      <ul className="divide-y divide-line">
        {documentos.map((d, i) => {
          const parsed: any = parserByUrl.get(d.url);
          return (
            <li key={i} className="px-5 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-clay">
                  <FileText size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{d.titulo}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-mute">
                    <span className="font-mono uppercase">{d.tipo_ocds}</span>
                    {d.formato && <span>· {d.formato.toUpperCase()}</span>}
                    {d.fecha && <span>· {d.fecha}</span>}
                    {parsed?.n_pdfs_internos && parsed.n_pdfs_internos > 1 && (
                      <span className="rounded-full bg-amber-soft px-1.5 py-0 text-[9px] font-bold uppercase text-amber">{parsed.n_pdfs_internos} PDFs adentro</span>
                    )}
                  </div>
                  {parsed?.resumen && !parsed?.error && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-inkSoft">
                      <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-clay">doc_parser:</span> {parsed.resumen}
                    </p>
                  )}
                  {parsed?.error && (
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-crimson-soft px-2 py-0.5 text-[10px] text-rust">
                      <AlertTriangle size={9} /> {parsed.error}
                    </div>
                  )}
                </div>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paperSoft px-2.5 py-1 text-[11px] font-medium text-clay hover:bg-paperDeep">
                    <ExternalLink size={11} /> Descargar
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmpresaAdjudicaCard({ empresa, banderasSugeridas }: { empresa: any; banderasSugeridas: any[] }) {
  return (
    <section className="surface p-5">
      <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
        <Building2 size={11} className="mr-1 inline" />
        Empresa adjudicataria · perfil completo (web_research_agent)
      </div>
      <h2 className="mt-1 font-serif text-xl font-bold text-ink">{empresa.razon_social}</h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
        <span className="font-mono">RUC {empresa.ruc}</span>
        {empresa.tipo && <span>· {empresa.tipo}</span>}
        {empresa.condicion && (
          <span className={cn("rounded-full px-1.5 py-0 text-[9px] font-bold uppercase",
            empresa.condicion?.toLowerCase() === "activo" ? "bg-moss/10 text-moss" : "bg-rust/10 text-rust")}>
            {empresa.condicion}
          </span>
        )}
        {empresa.edad_dias_al_contrato != null && (
          <span className={cn(empresa.edad_dias_al_contrato < 90 ? "text-rust font-bold" : "")}>
            · {empresa.edad_dias_al_contrato} días desde alta
          </span>
        )}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        {empresa.fecha_inicio_actividades && (
          <div><dt className="text-[10px] uppercase tracking-wider text-mute">Inicio actividades</dt><dd className="font-mono text-ink">{empresa.fecha_inicio_actividades}</dd></div>
        )}
        {empresa.ciiu && (
          <div><dt className="text-[10px] uppercase tracking-wider text-mute">CIIU</dt><dd className="font-mono text-ink">{empresa.ciiu}</dd></div>
        )}
        {(empresa.actividades_comerciales || []).length > 0 && (
          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-mute">Actividad comercial</dt>
            <dd className="text-ink">{(empresa.actividades_comerciales as string[]).join(" · ")}</dd></div>
        )}
        {empresa.direccion_legal && (
          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-mute">Dirección legal</dt>
            <dd className="text-ink">📍 {empresa.direccion_legal}</dd></div>
        )}
        {empresa.gerente_general?.nombre && (
          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-mute">Gerente general</dt>
            <dd className="text-ink"><strong>{empresa.gerente_general.nombre}</strong>{empresa.gerente_general.desde && <span className="text-mute"> · desde {empresa.gerente_general.desde}</span>}</dd></div>
        )}
      </dl>
      {(empresa.socios || []).length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
            Socios y representantes · {empresa.socios.length}
          </div>
          <ul className="mt-1.5 space-y-1">
            {empresa.socios.map((s: any, i: number) => (
              <li key={i} className="rounded-lg bg-paperSoft px-2.5 py-1.5 text-xs">
                <strong className="text-ink">{s.nombre}</strong>
                {s.dni && <span className="ml-1.5 font-mono text-mute">DNI {s.dni}</span>}
                {s.participacion && <span className="ml-1.5 text-mute">· {s.participacion}</span>}
                {s.cargo && <span className="ml-1.5 text-clay">· {s.cargo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(banderasSugeridas || []).length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber">
            <AlertTriangle size={10} className="mr-1 inline" />
            Banderas sugeridas a investigar
          </div>
          <ul className="mt-1.5 space-y-1">
            {banderasSugeridas.map((b, i) => (
              <li key={i} className="rounded-lg bg-amber-soft px-2.5 py-1.5 text-xs">
                <strong className="text-ink">{b.titulo}.</strong>{" "}
                <span className="text-mute">{b.descripcion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const FUENTE_GROUPS = [
  { label: "Empresas",     keys: ["empresas"] },
  { label: "Sanciones",    keys: ["sanciones"] },
  { label: "Prensa",       keys: ["prensa"] },
  { label: "Política",     keys: ["politica"] },
  { label: "Justicia",     keys: ["justicia"] },
  { label: "Funcionarios", keys: ["funcionarios"] },
  { label: "Obras",        keys: ["obras"] },
  { label: "Contratos",    keys: ["contratos"] },
];

function FuentesConsultadasSection({ hallazgos }: { hallazgos: any[] }) {
  const conHallazgos = hallazgos.filter(h => h.estado === "alerta" || h.estado === "ok").length;
  const sinMenciones = hallazgos.filter(h => h.estado === "sin_menciones").length;
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <ScanSearch size={11} className="mr-1 inline" />
          Fuentes consultadas · {hallazgos.length} cruzadas · {conHallazgos} con hallazgos · {sinMenciones} sin coincidencia
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Cruce contra fuentes oficiales
        </h2>
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-2">
        {FUENTE_GROUPS.map(g => {
          const sources = hallazgos.filter((h: any) => g.keys.includes(h.categoria));
          if (sources.length === 0) return null;
          return (
            <div key={g.label}>
              <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-mute">{g.label}</div>
              <ul className="space-y-0.5">
                {sources.map((h: any, i: number) => {
                  const ICON = h.estado === "alerta" ? "🔴" : h.estado === "ok" ? "🟢" : h.estado === "error" ? "⚠️" : "⚪";
                  return (
                    <li key={i} className="flex items-start gap-2 rounded-md bg-paperSoft px-2 py-1 text-[11px]">
                      <span className="shrink-0">{ICON}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink">{h.fuente}</div>
                        <div className="text-[10px] leading-snug text-mute">{h.mensaje}</div>
                      </div>
                      {h.url && (
                        <a href={h.url} target="_blank" rel="noreferrer" className="shrink-0 text-clay hover:underline">
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OtrosContratosSection({ otros, relacion, fmtMoney }: { otros: any[]; relacion: any; fmtMoney: (n: any) => string }) {
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Building2 size={11} className="mr-1 inline" />
          Historial de contratos con el Estado
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Otros contratos detectados · {otros.length}
        </h2>
        {relacion && (
          <p className="mt-1 text-xs leading-relaxed text-mute">
            Relación previa con esta entidad: <strong className={cn(relacion.contratos_previos > 0 ? "text-rust" : "text-ink")}>
              {relacion.contratos_previos} contratos previos</strong>. {relacion.detalle}
          </p>
        )}
      </div>
      <ul className="divide-y divide-line">
        {otros.map((c, i) => (
          <li key={i} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{c.entidad}</div>
                <div className="mt-0.5 text-xs text-inkSoft">{c.objeto}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mute">
                  {c.fecha && <span className="font-mono">{c.fecha}</span>}
                  {c.ocid_o_contrato && <span>· contrato {c.ocid_o_contrato}</span>}
                </div>
              </div>
              <div className="text-right">
                {c.monto && (
                  <div className="font-mono text-sm font-bold text-clay">{fmtMoney(c.monto)}</div>
                )}
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                    <ExternalLink size={9} /> link
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RedFlagsDocumentalesSection({ flags }: { flags: any[] }) {
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-rust">
          <AlertTriangle size={11} className="mr-1 inline" />
          Red flags documentales · {flags.length}
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Hallazgos del document_parser_agent en los PDFs
        </h2>
      </div>
      <ul className="divide-y divide-line">
        {flags.map((f, i) => (
          <li key={i} className="px-5 py-3">
            <div className="flex items-baseline gap-2">
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                f.severidad === "alta"  ? "bg-rust text-paper" :
                f.severidad === "media" ? "bg-amber text-paper" :
                                          "bg-paperDeep text-mute",
              )}>● {f.severidad || "media"}</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{f.descripcion}</p>
            {f.norma_citada && (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-paperDeep px-2 py-0.5 text-[11px] text-mute">
                <Scale size={11} className="text-clay" />
                <strong className="text-ink">Norma:</strong> {f.norma_citada}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </article>
    </section>
  );
}


// ════════════════════════════════════════════════════════════════════
// PersonNetworkSection — perfil del gerente + red empresarial
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// CronologiaSection — timeline horizontal de fechas clave
// ════════════════════════════════════════════════════════════════════

function CronologiaSection({ convocatoria }: { convocatoria: any }) {
  const c = convocatoria || {};
  const steps = [
    { key: "pub", label: "Publicación", fecha: c.fecha_publicacion, icon: <FileText size={12} /> },
    { key: "ini", label: "Inicio convocatoria", fecha: c.fecha_inicio, icon: <Calendar size={12} /> },
    { key: "fin", label: "Cierre presentación", fecha: c.fecha_fin, icon: <Calendar size={12} /> },
    { key: "bp",  label: "Buena pro", fecha: c.fecha_buena_pro, icon: <Award size={12} /> },
  ].filter(s => s.fecha);

  if (steps.length === 0) return null;

  // Verificación de plazo entre inicio y buena pro
  let plazo_dias: number | null = null;
  let plazo_ok: boolean | null = null;
  let plazo_minimo_legal: number | null = null;
  if (c.fecha_inicio && c.fecha_buena_pro) {
    const d1 = new Date(c.fecha_inicio);
    const d2 = new Date(c.fecha_buena_pro);
    plazo_dias = Math.round((d2.getTime() - d1.getTime()) / 86400000);
    const tp = (c.tipo_proceso || "").toUpperCase();
    if (tp.includes("LICITACION") || tp.includes("CONCURSO")) plazo_minimo_legal = 22;
    else if (tp.includes("SUBASTA")) plazo_minimo_legal = 12;
    else if (tp.includes("ADJUDICACION SIMPLIFICADA") || tp.includes("AS-")) plazo_minimo_legal = 8;
    else if (tp.includes("COMPARACION")) plazo_minimo_legal = 5;
    if (plazo_minimo_legal != null && plazo_dias != null) {
      plazo_ok = plazo_dias >= plazo_minimo_legal;
    }
  }

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Calendar size={11} className="mr-1 inline" />
          Cronología del expediente
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Línea de tiempo del proceso
        </h2>
        {c.tipo_proceso && (
          <p className="mt-1 text-xs text-mute">Tipo de proceso: <strong className="text-ink">{c.tipo_proceso}</strong></p>
        )}
      </div>
      <div className="overflow-x-auto px-5 py-6">
        <ol className="relative flex min-w-max items-start gap-4 pl-2">
          {/* línea horizontal */}
          <div className="absolute left-2 right-2 top-5 h-px bg-line" />
          {steps.map((s, i) => (
            <li key={s.key} className="relative z-10 flex w-40 flex-col items-start">
              <div className={cn(
                "grid h-10 w-10 place-items-center rounded-full ring-4 ring-paper text-paper",
                i === steps.length - 1 ? "bg-clay" : "bg-amber",
              )}>
                {s.icon}
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-clay">
                {s.label}
              </div>
              <div className="mt-0.5 font-mono text-xs text-ink">{s.fecha}</div>
            </li>
          ))}
        </ol>
      </div>
      {plazo_dias != null && (
        <div className={cn(
          "border-t border-line px-5 py-3 text-xs",
          plazo_ok === false ? "bg-crimson-soft" : "bg-paperSoft",
        )}>
          <div className="flex flex-wrap items-baseline gap-2">
            <strong className="text-ink">Plazo entre inicio y buena pro:</strong>
            <span className="font-mono font-bold text-ink">{plazo_dias} días</span>
            {plazo_minimo_legal != null && (
              <>
                <span className="text-mute">·</span>
                <span className="text-mute">Mínimo legal {c.tipo_proceso}:</span>
                <span className="font-mono text-ink">{plazo_minimo_legal} días</span>
                {plazo_ok === false && (
                  <span className="ml-2 rounded-full bg-rust px-2 py-0.5 text-[10px] font-bold text-paper">
                    <AlertTriangle size={9} className="mr-1 inline" />
                    INCUMPLE PLAZO LEGAL
                  </span>
                )}
                {plazo_ok === true && (
                  <span className="ml-2 rounded-full bg-moss/30 px-2 py-0.5 text-[10px] font-bold text-moss">
                    <CheckCircle2 size={9} className="mr-1 inline" />
                    cumple plazo
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}


// ════════════════════════════════════════════════════════════════════
// CumplimientoNormativoSection — cruce banderas ↔ opiniones OECE
// ════════════════════════════════════════════════════════════════════

function CumplimientoNormativoSection({ nc }: { nc: any }) {
  const evals: any[] = nc?.evaluaciones || [];
  const conOpinion = evals.filter((e: any) => e.opinion_oece);
  const sinOpinion = evals.filter((e: any) => !e.opinion_oece);
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
              <Scale size={11} className="mr-1 inline" />
              evaluate_normative_compliance · RAG sobre 723 opiniones OECE
            </div>
            <h2 className="mt-1 font-serif text-xl font-bold text-ink">
              Cumplimiento normativo
            </h2>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-2xl font-bold text-clay">{evals.length}</div>
            <div className="text-[10px] uppercase tracking-wider text-mute">hallazgos evaluados</div>
          </div>
        </div>
        <p className="mt-1 text-xs text-mute">
          Cada hallazgo se cruza contra el corpus de opiniones jurídicas del OECE para
          encontrar la opinión más relevante (similaridad semántica). Esto permite citar
          jurisprudencia administrativa específica para cada bandera detectada.
        </p>
      </div>

      {evals.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-mute">
          Sin hallazgos a evaluar.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-line bg-paperSoft text-left text-mute">
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Fuente</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Hallazgo / bandera</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Severidad</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Opinión OECE relacionada</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Score</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((e: any, i: number) => {
                const h = e.hallazgo || {};
                const op = e.opinion_oece;
                return (
                  <tr key={i} className="border-b border-line/50 align-top hover:bg-paper">
                    <td className="px-3 py-2 text-mute">
                      <span className="rounded bg-paperDeep px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-clay">
                        {(h.fuente || "").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      <div className="font-semibold leading-tight">{h.titulo}</div>
                      <div className="mt-0.5 text-[11px] text-mute">{h.descripcion}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                        h.severidad === "alta"  ? "bg-rust text-paper" :
                        h.severidad === "media" ? "bg-amber text-paper" :
                                                  "bg-paperDeep text-mute",
                      )}>● {h.severidad || "media"}</span>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {op ? (
                        <>
                          <div className="font-semibold">
                            {op.norma ? `${op.norma} ` : ""}
                            {op.num_opinion && <span className="font-mono">{op.num_opinion}</span>}
                          </div>
                          {(op.art_ley || op.art_reglamento) && (
                            <div className="text-[10px] text-mute">
                              {op.art_ley && <>Ley {op.art_ley}{op.art_reglamento ? " · " : ""}</>}
                              {op.art_reglamento && <>Reglamento {op.art_reglamento}</>}
                            </div>
                          )}
                          {op.interpretacion_snippet && (
                            <div className="mt-1 line-clamp-3 text-[11px] italic text-inkSoft">
                              "{op.interpretacion_snippet}"
                            </div>
                          )}
                          {op.link && (
                            <a href={op.link} target="_blank" rel="noreferrer"
                               className="mt-1 inline-flex items-center gap-1 rounded-md bg-clay px-2 py-0.5 text-[10px] font-bold text-paper hover:bg-clay/80">
                              Abrir opinión <ExternalLink size={9} />
                            </a>
                          )}
                        </>
                      ) : (
                        <span className="italic text-mute">No se encontró opinión relacionada.</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {op?.score != null ? (
                        <span className="font-mono text-[11px] font-bold text-clay">
                          {(op.score * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sinOpinion.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-5 py-2 text-[10px] text-mute">
          {conOpinion.length} de {evals.length} hallazgos tienen opinión OECE relacionada (matching ≥ umbral).
        </div>
      )}
    </section>
  );
}


// ════════════════════════════════════════════════════════════════════
// AportesPoliticosSection — vinculaciones políticas (ONPE + JNE)
// ════════════════════════════════════════════════════════════════════

function AportesPoliticosSection({ web, person, ctx }: { web: any; person: any; ctx?: any }) {
  // Extrae datos de ONPE/JNE de web_research + person_network
  const hallazgos = (web?.hallazgos_por_fuente || []).filter((h: any) =>
    String(h.fuente || "").match(/ONPE|JNE/i)
  );
  const persona = person?.persona_principal || {};
  const aportes = persona.aportes_campañas || persona.aportes_campanas || [];
  const candidaturas = persona.candidaturas || [];
  // Determinar si hay alguna actividad política detectada
  const hayActividad =
    aportes.length > 0 || candidaturas.length > 0 ||
    hallazgos.some((h: any) => h.estado === "alerta" || h.estado === "ok");

  if (!hayActividad && hallazgos.length === 0) return null;

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <ShieldAlert size={11} className="mr-1 inline" />
          Aportes políticos y candidaturas · ONPE + JNE
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Vinculaciones políticas
        </h2>
        <p className="mt-1 text-xs text-mute">
          Aportes a campañas registrados en ONPE Claridad y postulaciones en el
          JNE asociados al proveedor o su gerente. Una vinculación política no
          implica delito — pero amerita verificación si coincide con el partido
          que gobierna la entidad contratante.
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* APORTES */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            Aportes ONPE Claridad ({aportes.length})
          </h3>
          {aportes.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              Sin aportes registrados a partidos políticos.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {aportes.map((a: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-bold text-ink">{a.año}</span>
                    <strong className="text-sm text-ink">{a.partido}</strong>
                    {a.monto != null && (
                      <span className="ml-auto font-mono text-xs font-bold text-clay">
                        S/. {Number(a.monto).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {a.fuente_url && (
                    <a href={a.fuente_url} target="_blank" rel="noreferrer"
                       className="mt-1 inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                      Fuente <ExternalLink size={9} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>

        {/* CANDIDATURAS */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            Candidaturas JNE ({candidaturas.length})
          </h3>
          {candidaturas.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              Sin candidaturas registradas.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {candidaturas.map((c: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-bold text-ink">{c.año}</span>
                    <strong className="text-sm text-ink">{c.cargo}</strong>
                    {c.resultado && (
                      <span className="ml-auto rounded-full bg-paperDeep px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-mute">
                        {c.resultado}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-inkSoft">{c.partido}</div>
                  {c.fuente_url && (
                    <a href={c.fuente_url} target="_blank" rel="noreferrer"
                       className="mt-1 inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                      Fuente <ExternalLink size={9} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {/* HALLAZGOS de las fuentes ONPE/JNE */}
      {hallazgos.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-5 py-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">
            Hallazgos en las fuentes consultadas
          </h3>
          <ul className="mt-1 space-y-1">
            {hallazgos.map((h: any, i: number) => (
              <li key={i} className="text-[11px] text-ink">
                <strong>{h.fuente}:</strong>{" "}
                <span className={h.estado === "alerta" ? "text-rust" : h.estado === "ok" ? "text-moss" : "text-mute"}>
                  {h.mensaje}
                </span>
                {h.url && (
                  <a href={h.url} target="_blank" rel="noreferrer"
                     className="ml-2 inline-flex items-center gap-0.5 text-clay hover:underline">
                    <ExternalLink size={9} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* VINCULACIONES POR PERSONA — incluye socios, familia, firmantes, comité */}
      {ctx?.datos_peru_por_persona && Object.keys(ctx.datos_peru_por_persona).length > 0 && (
        <PersonaVinculacionesPanel ctx={ctx} />
      )}
    </section>
  );
}

// Panel por-persona: muestra aportes ONPE / candidaturas JNE / PEP / visitas
// de TODAS las personas investigadas (no solo persona_principal).
function PersonaVinculacionesPanel({ ctx }: { ctx: any }) {
  const datos = ctx?.datos_peru_por_persona || {};
  const ganadorRuc = ctx?.ganador?.ruc;
  const ganadorRazon = ctx?.ganador?.razon_social;
  const ganadorDni = ctx?.ganador?.dni_persona_natural;
  const comite: any[] = ctx?.comite_evaluacion || [];
  const firmantes: any[] = ctx?.firmantes_consolidados || [];

  // Categorizar cada key como titular / socio / firmante / comité
  const categoryFor = (key: string): { rol: string; color: string } => {
    if (key === ganadorRazon || key === ganadorDni) return { rol: "Titular del proveedor", color: "bg-rust/15 text-rust" };
    if (firmantes.some((f) => (f.nombre_completo === key) || (f.dni === key))) return { rol: "Firmante del acta", color: "bg-amber/15 text-amber" };
    if (comite.some((m) => (m.nombre_completo === key) || (m.nombre === key) || (m.dni === key))) return { rol: "Comité de selección", color: "bg-clay/15 text-clay" };
    return { rol: "Socio o vínculo del proveedor", color: "bg-moss/15 text-moss" };
  };

  // Solo mostrar personas con AL MENOS un hallazgo
  const personasConHallazgo = Object.entries(datos).filter(([, d]: any) => {
    return (d.onpe?.n_aportes || 0) > 0 ||
           (d.jne?.n_candidaturas || 0) > 0 ||
           (d.pep?.found) ||
           (d.visitas?.n_visitas || 0) > 0;
  });

  if (personasConHallazgo.length === 0) {
    // Mostrar al menos el conteo de personas investigadas con "0 hallazgos"
    const total = Object.keys(datos).length;
    return (
      <div className="border-t border-line bg-paperSoft px-5 py-3">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">
          Vinculaciones por persona ({total} investigadas)
        </h3>
        <p className="mt-1 text-[11px] text-mute italic">
          Se cruzaron ONPE Claridad, JNE candidaturas, PEPs y registro de visitas para
          {" "}{total} personas (titular + socios + firmantes + comité) — ninguna registra hallazgos.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-line bg-paperSoft px-5 py-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
        ⚡ Vinculaciones por persona · {personasConHallazgo.length} con hallazgos · {Object.keys(datos).length} investigadas
      </h3>
      <p className="mt-0.5 text-[10px] text-mute italic">
        Cruces de ONPE / JNE / PEPs / visitas para titular, socios, firmantes del acta y miembros del comité de selección.
      </p>
      <ul className="mt-2 space-y-2">
        {personasConHallazgo.map(([key, d]: any, i: number) => {
          const cat = categoryFor(key);
          const onpe = d.onpe || {};
          const jne = d.jne || {};
          const pep = d.pep || {};
          const visitas = d.visitas || {};
          return (
            <li key={i} className="rounded-md border border-line bg-paper px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest", cat.color)}>
                  {cat.rol}
                </span>
                <strong className="text-[12px] text-ink">{key}</strong>
              </div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {onpe.n_aportes > 0 && (
                  <div className="text-[11px]">
                    <span className="font-bold text-rust">ONPE:</span>{" "}
                    {onpe.n_aportes} aporte{onpe.n_aportes !== 1 ? "s" : ""} a partido
                    {onpe.aportes?.[0]?.partido && <span className="text-inkSoft"> ({onpe.aportes[0].partido}{onpe.aportes[0].año ? `, ${onpe.aportes[0].año}` : ""})</span>}
                  </div>
                )}
                {jne.n_candidaturas > 0 && (
                  <div className="text-[11px]">
                    <span className="font-bold text-amber">JNE:</span>{" "}
                    {jne.n_candidaturas} candidatura{jne.n_candidaturas !== 1 ? "s" : ""}
                    {jne.candidaturas?.[0]?.cargo && <span className="text-inkSoft"> ({jne.candidaturas[0].cargo}, {jne.candidaturas[0].año})</span>}
                  </div>
                )}
                {pep.found && (
                  <div className="text-[11px]">
                    <span className="font-bold text-clay">PEP:</span>{" "}
                    Persona expuesta políticamente activa
                  </div>
                )}
                {visitas.n_visitas > 0 && (
                  <div className="text-[11px]">
                    <span className="font-bold text-moss">Visitas Ley 28024:</span>{" "}
                    {visitas.n_visitas} a entidades públicas
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// FirmantesYAdjudicacionSection — quién firmó + por qué ganó + comité
// ════════════════════════════════════════════════════════════════════

function FirmantesYAdjudicacionSection({
  firmantes,
  comite,
  motivos,
  lugarFecha,
  cruceFirmantes,
}: {
  firmantes: any[];
  comite: any[];
  motivos: any[];
  lugarFecha?: { lugar?: string; fecha?: string; hora?: string } | null;
  cruceFirmantes?: any[];
}) {
  const rolBadge = (r: string) => {
    const s = (r || "").toLowerCase();
    if (s.includes("aprob")) return "bg-amber-soft text-amber";
    if (s.includes("presid") || s.includes("comite")) return "bg-paperDeep text-clay";
    if (s.includes("represent")) return "bg-crimson-soft text-rust";
    if (s.includes("evalu")) return "bg-paperSoft text-clay";
    return "bg-paperDeep text-mute";
  };
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Users size={11} className="mr-1 inline" />
          Quién firmó · Por qué ganó · Comité evaluador
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Firmantes y motivos de adjudicación
        </h2>
        {lugarFecha?.lugar && (
          <p className="mt-1 text-xs text-mute">
            <MapPin size={10} className="mr-1 inline" />
            {lugarFecha.lugar}
            {lugarFecha.fecha && <span className="ml-2"><Calendar size={10} className="mr-1 inline" />{lugarFecha.fecha}</span>}
            {lugarFecha.hora && <span className="ml-2">· {lugarFecha.hora}</span>}
          </p>
        )}
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* FIRMANTES */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            Firmantes del documento ({firmantes.length})
          </h3>
          {firmantes.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              No se identificaron firmantes en los PDFs procesados.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {firmantes.map((f: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <strong className="text-sm text-ink">{f.nombre_completo}</strong>
                    {f.rol_en_documento && (
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                        rolBadge(f.rol_en_documento),
                      )}>
                        {String(f.rol_en_documento).replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  {f.cargo && (
                    <div className="mt-0.5 text-[11px] text-inkSoft">{f.cargo}</div>
                  )}
                  {f.entidad && (
                    <div className="text-[10px] text-mute">{f.entidad}</div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-mute">
                    {f.dni && <span className="font-mono">DNI {f.dni}</span>}
                    {f.fecha_firma && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={9} /> {f.fecha_firma}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        {/* COMITÉ DE EVALUACIÓN */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            Comité de selección ({comite.length})
          </h3>
          {comite.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              No se detalla composición del comité (común en contrataciones directas).
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {comite.map((m: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <strong className="text-sm text-ink">{m.nombre_completo}</strong>
                    {m.rol && (
                      <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber">
                        {String(m.rol).replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  {m.cargo && <div className="mt-0.5 text-[11px] text-inkSoft">{m.cargo}</div>}
                  {m.certificacion_sican && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-paperDeep px-2 py-0.5 text-[10px] text-clay">
                      <Award size={9} /> SICAN {m.certificacion_sican}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {/* MOTIVOS DE ADJUDICACIÓN */}
      {motivos.length > 0 && (
        <div className="border-t border-line px-5 py-5">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay mb-3">
            <Award size={11} className="mr-1 inline" />
            Por qué ganó cada postor ({motivos.length})
          </h3>
          <ul className="space-y-3">
            {motivos.map((m: any, i: number) => (
              <li key={i} className="rounded-lg border border-line bg-paperSoft p-3">
                <div className="flex items-baseline gap-2">
                  <strong className="text-sm font-bold text-ink">{m.ganador_razon_social}</strong>
                  {m.ganador_ruc && (
                    <span className="font-mono text-[10px] text-mute">RUC {m.ganador_ruc}</span>
                  )}
                  {m.item_adjudicado && (
                    <span className="rounded-md bg-paperDeep px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-clay">
                      ítem {m.item_adjudicado}
                    </span>
                  )}
                  {m.posicion_ranking && (
                    <span className="ml-auto rounded-full bg-amber-soft px-2 py-0.5 text-[10px] font-bold text-amber">
                      #{m.posicion_ranking}
                    </span>
                  )}
                </div>
                {m.criterio_decisivo && (
                  <p className="mt-1.5 text-xs text-ink">
                    <strong>Criterio decisivo:</strong>{" "}
                    <span className="italic">{m.criterio_decisivo}</span>
                  </p>
                )}
                {m.observaciones_evaluacion && (
                  <p className="mt-1 text-xs leading-relaxed text-inkSoft">
                    {m.observaciones_evaluacion}
                  </p>
                )}
                {(m.competidores_descalificados || []).length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-mute hover:text-ink">
                      Competidores descalificados ({m.competidores_descalificados.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {m.competidores_descalificados.map((c: string, j: number) => (
                        <li key={j} className="text-[11px] text-mute">— {c}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CRUCE FIRMANTES vs GANADOR — banderas críticas */}
      {(cruceFirmantes || []).length > 0 && (
        <div className="border-t border-line bg-crimson-soft px-5 py-5">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-rust">
            <ShieldAlert size={11} className="mr-1 inline" />
            Cruce firmantes ↔ ganador ({cruceFirmantes!.length})
          </h3>
          <p className="mt-1 text-[11px] text-mute">
            Coincidencias entre quienes firmaron por la entidad y personas vinculadas al proveedor adjudicado.
          </p>
          <ul className="mt-3 space-y-2">
            {cruceFirmantes!.map((c: any, i: number) => (
              <li key={i} className="rounded-md bg-paper px-3 py-2">
                <div className="flex items-baseline gap-2 text-xs">
                  <strong className="text-ink">{c.firmante}</strong>
                  <span className="text-mute">({c.cargo_firmante})</span>
                  <span className="text-clay">↔</span>
                  <strong className="text-ink">{c.persona_proveedor}</strong>
                </div>
                {c.tipo_relacion && c.tipo_relacion !== "sin_relacion" && (
                  <div className="mt-1">
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                      c.severidad === "alta"  ? "bg-rust text-paper" :
                      c.severidad === "media" ? "bg-amber text-paper" :
                                                "bg-paperDeep text-mute",
                    )}>
                      {String(c.tipo_relacion).replace(/_/g, " ")}
                    </span>
                  </div>
                )}
                {c.evidencia && (
                  <p className="mt-1 text-[11px] text-inkSoft">{c.evidencia}</p>
                )}
                {c.fuente_url && (
                  <a href={c.fuente_url} target="_blank" rel="noreferrer"
                     className="mt-1 inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                    Fuente <ExternalLink size={9} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}


// ════════════════════════════════════════════════════════════════════
// RelationshipGraph — grafo SVG persona → empresas → contratos
// ════════════════════════════════════════════════════════════════════

/**
 * Divide un texto largo en líneas balanceadas por palabras.
 * No corta palabras (a menos que una sola palabra exceda maxChars).
 * Garantiza máx `maxLines` líneas; el resto se trunca con "…".
 */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (lines.length >= maxLines) break;
    // Si la palabra sola excede maxChars, cortar hard
    if (w.length > maxChars) {
      if (current) { lines.push(current); current = ""; }
      if (lines.length < maxLines) {
        lines.push(w.slice(0, maxChars - 1) + "…");
      }
      continue;
    }
    const candidate = current ? current + " " + w : w;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  // Si quedaron palabras pendientes y ya alcanzamos maxLines, marcar elipsis
  const allConsumed = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (allConsumed < words.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last.length + 1 < maxChars) {
      lines[lines.length - 1] = last + "…";
    } else {
      lines[lines.length - 1] = last.slice(0, maxChars - 1) + "…";
    }
  }
  return lines.length > 0 ? lines : [text.slice(0, maxChars)];
}


type GraphNode = {
  id: string;
  kind: "person" | "pareja" | "company_main" | "company_titular" | "company_domicilio"
      | "party" | "contract" | "cargo_pasado" | "autoridad" | "firmante_conflicto"
      | "entidad" | "alcalde" | "funcionario_designado"
      | "municipio_familiar" | "partido_compartido"
      | "postor_rival" | "socio_postor_conflicto" | "entidad_secundaria";
  label: string;
  sublabel?: string;
  tooltip?: string;
  // Datos para el panel de detalle al hacer click
  meta?: {
    ruc?: string;
    dni?: string;
    direccion?: string;
    observacion?: string;
    rol?: string;
    monto?: number;
    año?: any;
    fuente_url?: string;
    razon_social?: string;
    cargo?: string;
    institucion?: string;
    periodo?: string;
    partido?: string;
    resultado?: string;
    entidad?: string;
    objeto?: string;
  };
};
type GraphEdge = {
  from: string;
  to: string;
  kind: "titular" | "domicilio" | "candidato" | "aporte" | "cargo" | "contrato"
      | "pareja" | "autoridad" | "firma_conflicto"
      | "adjudicacion" | "preside_entidad" | "designado_por" | "conflicto_funcionario"
      | "trabaja_en" | "mismo_partido_que" | "partido_de"
      | "compitio" | "socio_de" | "visito" | "doble_vinculacion";
  label?: string;
};

function RelationshipGraph({
  person,
  web,
  proveedor,
  ctx,
}: { person: any; web: any; proveedor: any; ctx?: any }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Posiciones override por drag — { [nodeId]: {x,y} }; vacío usa layout polar
  const [posOverride, setPosOverride] = useState<Record<string, { x: number; y: number }>>({});
  // ViewBox state — para zoom y pan del SVG (no de nodos individuales)
  // Default amplio (1440×940 sobre canvas base 920×600) para que entren todos
  // los clusters (entidad + postores rivales + visitas) sin necesidad de pan.
  const [viewBox, setViewBox] = useState({ x: -260, y: -170, w: 1440, h: 940 });
  const draggedRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ mx: number; my: number; nx: number; ny: number } | null>(null);
  const wasDraggedRef = useRef(false);
  // Pan refs: cuando el user arrastra el FONDO (no un nodo)
  const panningRef = useRef<{ mx: number; my: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const p = person?.persona_principal || {};
  const red = person?.red_empresarial || {};
  // Empresas vinculadas: priorizar `red_empresarial_derivada` del context
  // (datos DUROS desde RNP) sobre el array del sub-agente (que a veces
  // viene incompleto). Si no hay ctx, caer al campo del sub-agente.
  const empresasTitularCtx = (ctx?.red_empresarial_derivada?.empresas_mismo_titular || []) as any[];
  const empresasTitularAgent = (red.empresas_mismo_titular || []) as any[];
  // Merge ambos por RUC (sin duplicar)
  const _seenRucs = new Set<string>();
  const empresasTitular: any[] = [];
  for (const e of [...empresasTitularCtx, ...empresasTitularAgent]) {
    const ruc = String(e?.ruc || "");
    if (ruc && !_seenRucs.has(ruc)) {
      _seenRucs.add(ruc);
      empresasTitular.push(e);
    } else if (!ruc) {
      empresasTitular.push(e);
    }
  }
  const empresasDomicilio = (red.empresas_misma_direccion || []) as any[];
  const candidaturas = (p.candidaturas || []) as any[];
  const aportes = (p.aportes_campañas || p.aportes_campanas || []) as any[];
  const cargosPasados = (p.cargos_pasados || []) as any[];
  // Nuevos vectores: pareja/familia, autoridades, cruce firmantes con conflicto
  const familia = (person?.pareja_o_familia || []) as any[];
  const autoridades = (person?.vinculo_autoridades || []) as any[];
  const cruceFirmantes = (person?.cruce_firmantes_ganador || [])
    .filter((c: any) => (c?.severidad || "").toLowerCase() === "alta"
                       || (c?.tipo_relacion || "").toLowerCase() !== "sin_relacion") as any[];
  const otrosContratos = (web?.otros_contratos_con_estado || []) as any[];

  const personLabel = p.nombre_completo || "Persona no identificada";
  const proveedorRuc = proveedor?.ruc;
  const proveedorNombre = proveedor?.nombre || web?.empresa?.razon_social || "Proveedor";

  // Datos del cluster Entidad Contratante — hoisted para usar también en familia
  const entidadContratante = ctx?.entidad_contratante || null;
  const autoridadesEntidad = ctx?.autoridades_entidad || null;
  const funcionariosDesignados = (ctx?.funcionarios_designados || []) as any[];
  const alcaldeData = autoridadesEntidad?.alcalde_distrital_actual
                   || autoridadesEntidad?.alcalde_provincial_actual
                   || autoridadesEntidad?.gobernador_regional_actual
                   || null;
  const partidoMunicipioContratante = (
    alcaldeData?.partido || ""
  ).trim().toUpperCase();

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const idPerson = "person";
  const idCompanyMain = "co_main";
  const idEntidad = "entidad";

  nodes.push({
    id: idPerson, kind: "person", label: personLabel,
    sublabel: p.cargo_actual || (p.dni ? `DNI ${p.dni}` : undefined),
    meta: { dni: p.dni, cargo: p.cargo_actual, fuente_url: p.datosperu_url || p.linkedin },
  });

  // Empresa principal (proveedor de la convocatoria actual)
  nodes.push({
    id: idCompanyMain, kind: "company_main",
    label: proveedorNombre.length > 36 ? proveedorNombre.slice(0, 33) + "…" : proveedorNombre,
    sublabel: proveedorRuc ? `RUC ${proveedorRuc}` : undefined,
    tooltip: proveedorNombre,
    meta: { ruc: proveedorRuc, razon_social: proveedorNombre, rol: "Proveedor de la convocatoria actual" },
  });
  edges.push({ from: idPerson, to: idCompanyMain, kind: "titular", label: "rep. legal" });

  // Otras empresas con mismo titular
  empresasTitular.forEach((e: any, i: number) => {
    const id = `co_t_${i}`;
    const lbl = (e.razon_social || `RUC ${e.ruc}`) as string;
    nodes.push({
      id, kind: "company_titular",
      label: lbl.length > 34 ? lbl.slice(0, 31) + "…" : lbl,
      sublabel: e.ruc ? `RUC ${e.ruc}` : undefined,
      tooltip: `${lbl}${e.rol_del_gerente ? " · " + e.rol_del_gerente : ""}`,
      meta: { ruc: e.ruc, razon_social: e.razon_social, rol: e.rol_del_gerente || "Titular o socio" },
    });
    edges.push({ from: idPerson, to: id, kind: "titular", label: e.rol_del_gerente || "titular" });
  });

  // Empresas mismo domicilio
  empresasDomicilio.forEach((e: any, i: number) => {
    const id = `co_d_${i}`;
    const lbl = (e.razon_social || `RUC ${e.ruc}`) as string;
    nodes.push({
      id, kind: "company_domicilio",
      label: lbl.length > 34 ? lbl.slice(0, 31) + "…" : lbl,
      sublabel: e.direccion ? "📍 mismo domicilio" : undefined,
      tooltip: `${lbl} — ${e.direccion || "mismo domicilio fiscal"}`,
      meta: { ruc: e.ruc, razon_social: e.razon_social, direccion: e.direccion, observacion: e.observacion, rol: "Mismo domicilio fiscal" },
    });
    edges.push({ from: idCompanyMain, to: id, kind: "domicilio", label: "mismo domicilio" });
  });

  // Partidos políticos (candidaturas + aportes)
  const partidosMap = new Map<string, { id: string; kind: "candidato" | "aporte"; monto?: number; año?: any }>();
  candidaturas.forEach((c: any, i: number) => {
    const key = (c.partido || "").trim().toUpperCase();
    if (!key) return;
    if (!partidosMap.has(key)) partidosMap.set(key, { id: `pt_${i}`, kind: "candidato", año: c.año });
  });
  aportes.forEach((a: any, i: number) => {
    const key = (a.partido || "").trim().toUpperCase();
    if (!key) return;
    const existing = partidosMap.get(key);
    if (existing) {
      existing.monto = (existing.monto || 0) + Number(a.monto || 0);
    } else {
      partidosMap.set(key, { id: `pt_a_${i}`, kind: "aporte", monto: Number(a.monto || 0), año: a.año });
    }
  });
  partidosMap.forEach((m, key) => {
    nodes.push({
      id: m.id, kind: "party",
      label: key.length > 28 ? key.slice(0, 25) + "…" : key,
      sublabel: m.monto ? `S/. ${m.monto.toLocaleString("es-PE")}` : (m.año ? `${m.año}` : undefined),
      tooltip: m.kind === "aporte" ? "Aportante a campaña" : "Candidato/a",
      meta: { partido: key, monto: m.monto, año: m.año, rol: m.kind === "aporte" ? "Aportante ONPE" : "Candidatura" },
    });
    edges.push({
      from: idPerson, to: m.id,
      kind: m.kind === "aporte" ? "aporte" : "candidato",
      label: m.kind === "aporte" ? "aporte ONPE" : `candidato ${m.año || ""}`,
    });
  });

  // Cargos públicos pasados (hasta 3 más relevantes)
  cargosPasados.slice(0, 3).forEach((c: any, i: number) => {
    const id = `cg_${i}`;
    const inst = (c.institucion || c.cargo || "Cargo público") as string;
    nodes.push({
      id, kind: "cargo_pasado",
      label: inst.length > 28 ? inst.slice(0, 25) + "…" : inst,
      sublabel: c.periodo || c.cargo,
      tooltip: `${c.cargo || ""} · ${inst}${c.periodo ? " (" + c.periodo + ")" : ""}`,
      meta: { cargo: c.cargo, institucion: inst, periodo: c.periodo, fuente_url: c.fuente_url },
    });
    edges.push({ from: idPerson, to: id, kind: "cargo", label: c.periodo || "cargo público" });
  });

  // ─── Familiares + Municipios donde trabajan + Partido compartido ───
  // Cada familiar que es funcionario público se conecta con su municipio
  // como nodo distinto (kind=municipio_familiar). Si el partido del alcalde
  // de ESE municipio coincide con el partido del alcalde del municipio que
  // CONTRATA → edge especial "mismo_partido_que" en rojo grueso.
  // (partidoMunicipioContratante ya está hoisted arriba)
  familia.slice(0, 8).forEach((f: any, i: number) => {
    const id = `fa_${i}`;
    const nombre = (f.nombre || "Familiar") as string;
    nodes.push({
      id, kind: "pareja",
      label: nombre,
      sublabel: f.parentesco || "vínculo familiar",
      tooltip: `${nombre} · ${f.parentesco || ""} · ${f.detalles || ""}`,
      meta: { rol: f.parentesco, observacion: f.detalles, fuente_url: f.fuente_url },
    });
    edges.push({ from: idPerson, to: id, kind: "pareja", label: f.parentesco || "familiar" });

    // Cargos públicos del familiar → nodo MUNICIPIO con partido
    const cargosFam = (f.cargos_publicos || f.cargos || []) as any[];
    cargosFam.slice(0, 2).forEach((c: any, j: number) => {
      if (!c) return;
      const subId = `fa_${i}_mun_${j}`;
      const entidad = (c.entidad || c.institucion || c.municipalidad || "Entidad pública") as string;
      const partido = (c.partido_municipio || c.partido_alcalde || c.partido || "").trim();
      const partidoUpper = partido.toUpperCase();
      const esMismoMunicipio = entidadContratante?.nombre
        && entidad.toUpperCase().includes(
          (entidadContratante.nombre as string).toUpperCase().slice(0, 25)
        );
      const compartePartido =
        partidoUpper && partidoMunicipioContratante &&
        partidoUpper === partidoMunicipioContratante;

      nodes.push({
        id: subId, kind: "municipio_familiar",
        label: entidad,
        sublabel: c.cargo
          ? `${c.cargo}${c.periodo ? " · " + c.periodo : ""}`
          : (c.periodo || "cargo público"),
        tooltip: `${nombre} es ${c.cargo || "funcionario"} en ${entidad}${
          partido ? " · alcalde del partido " + partido : ""
        }${esMismoMunicipio ? " · ⚠ mismo municipio que contrata" : ""}`,
        meta: {
          cargo: c.cargo,
          institucion: entidad,
          periodo: c.periodo,
          partido,
          fuente_url: c.fuente_url,
          observacion: c.observacion
            || `${f.parentesco || "Familiar"} del titular del proveedor${
              esMismoMunicipio ? " · MISMO municipio contratante" : ""
            }${compartePartido ? " · MISMO partido del alcalde contratante" : ""}`,
          rol: esMismoMunicipio ? "⚠ Conflicto directo" : "Vínculo cruzado",
        },
      });
      edges.push({
        from: id, to: subId, kind: "trabaja_en",
        label: c.cargo ? `es ${c.cargo}` : "trabaja en",
      });

      // Si comparte partido con el municipio contratante → edge especial al alcalde
      // (el render skip-ea edges sin positions definidas, así que es seguro)
      if (compartePartido && alcaldeData) {
        edges.push({
          from: subId, to: "alcalde_actual", kind: "mismo_partido_que",
          label: `mismo partido (${partido})`,
        });
      }

      // Si el partido es distinto, lo mostramos como sub-nodo PARTIDO para
      // contextualizar la red política (el partido es propio del municipio
      // donde trabaja el familiar).
      if (partido && !compartePartido) {
        const ptId = `fa_${i}_mun_${j}_pt`;
        nodes.push({
          id: ptId, kind: "partido_compartido",
          label: partido,
          sublabel: "partido del municipio",
          tooltip: `Partido del alcalde de ${entidad}: ${partido}`,
          meta: { partido, rol: "Partido del municipio donde trabaja el familiar" },
        });
        edges.push({ from: subId, to: ptId, kind: "partido_de", label: "alcalde de" });
      }
    });
  });

  // Vínculo con autoridades públicas (NUEVO)
  autoridades.slice(0, 5).forEach((a: any, i: number) => {
    const id = `au_${i}`;
    const nombre = (a.autoridad || "Autoridad") as string;
    nodes.push({
      id, kind: "autoridad",
      label: nombre,
      sublabel: a.cargo || a.entidad,
      tooltip: `${nombre} · ${a.cargo || ""} · ${a.entidad || ""} · ${a.evidencia || ""}`,
      meta: { cargo: a.cargo, institucion: a.entidad, observacion: a.evidencia, fuente_url: a.fuente_url, rol: a.vinculo_con_gerente },
    });
    edges.push({
      from: idPerson, to: id, kind: "autoridad",
      label: a.vinculo_con_gerente || "vínculo",
    });
  });

  // Firmantes con conflicto (NUEVO) — viñetazo rojo
  cruceFirmantes.slice(0, 3).forEach((c: any, i: number) => {
    const id = `fc_${i}`;
    const nombre = (c.firmante || "Firmante") as string;
    nodes.push({
      id, kind: "firmante_conflicto",
      label: nombre.length > 26 ? nombre.slice(0, 23) + "…" : nombre,
      sublabel: c.tipo_relacion || "relación detectada",
      tooltip: `${nombre} · ${c.cargo_firmante || ""} · ${c.entidad_firmante || ""} · ${c.evidencia || ""}`,
      meta: { cargo: c.cargo_firmante, institucion: c.entidad_firmante, observacion: c.evidencia, fuente_url: c.fuente_url, rol: c.tipo_relacion },
    });
    edges.push({
      from: idPerson, to: id, kind: "firma_conflicto",
      label: c.tipo_relacion || "conflicto",
    });
  });

  // Contratos con otras entidades (de web_research) — cuelgan de la empresa principal
  const contratosFiltrados = otrosContratos.slice(0, 5);
  contratosFiltrados.forEach((c: any, i: number) => {
    const id = `ct_${i}`;
    const ent = (c.entidad || c.entidad_contratante || "Entidad") as string;
    const monto = Number(c.monto || c.valor || 0);
    nodes.push({
      id, kind: "contract",
      label: ent.length > 30 ? ent.slice(0, 27) + "…" : ent,
      sublabel: monto ? `S/. ${monto.toLocaleString("es-PE")}` : (c.año || c.fecha || undefined),
      tooltip: `${ent}${c.objeto ? " — " + c.objeto : ""}`,
      meta: { entidad: ent, monto, año: c.año || c.fecha, objeto: c.objeto, fuente_url: c.fuente_url || c.url },
    });
    edges.push({ from: idCompanyMain, to: id, kind: "contrato", label: c.año || "contrato" });
  });

  // ─── CLUSTER ENTIDAD CONTRATANTE ───
  // Nodo central nuevo con el alcalde, autoridades electas y funcionarios designados
  // (las constantes están hoisted arriba para que el bloque familia las use)
  // Para detectar conflictos: lista de DNIs/nombres del proveedor para cross-match
  const dniProveedor = new Set<string>();
  if (p.dni) dniProveedor.add(String(p.dni));
  (proveedor?.socios || []).forEach((s: any) => {
    if (s?.numero_documento) dniProveedor.add(String(s.numero_documento));
  });

  if (entidadContratante) {
    const nombreEnt = entidadContratante.nombre || "Entidad Contratante";
    nodes.push({
      id: idEntidad, kind: "entidad",
      label: nombreEnt,
      sublabel: entidadContratante.ruc ? `RUC ${entidadContratante.ruc}` : entidadContratante.region,
      tooltip: nombreEnt,
      meta: { ruc: entidadContratante.ruc, entidad: nombreEnt, rol: "Entidad contratante" },
    });
    // F5: Edge proveedor → entidad con detalle de sobreprecio si existe.
    // Buscamos en banderas_red o banderas de mercado el % sobreprecio del lote.
    const banderasContexto: any[] = (person as any)?.banderas_red || [];
    const sobreprecioBandera = banderasContexto.find((b: any) =>
      /sobreprecio_lote|sobreprecio_muy_elevado/i.test(b?.regla || "")
    );
    let labelEdge = "adjudicación";
    if (sobreprecioBandera?.evidencia) {
      const m = String(sobreprecioBandera.evidencia).match(/\(\+([\d.]+)%\)|([\d.]+)% por encima/);
      const pct = m ? (m[1] || m[2]) : null;
      if (pct) labelEdge = `⚠ +${pct}% sobreprecio`;
    }
    edges.push({
      from: idCompanyMain, to: idEntidad, kind: "adjudicacion",
      label: labelEdge,
    });
  }

  // Alcalde / autoridad electa principal (alcaldeData ya está hoisted arriba)
  if (alcaldeData && entidadContratante) {
    const idAlc = "alcalde_actual";
    const nombre = alcaldeData.nombre || "Alcalde";
    nodes.push({
      id: idAlc, kind: "alcalde",
      label: nombre.length > 30 ? nombre.slice(0, 27) + "…" : nombre,
      sublabel: alcaldeData.partido || alcaldeData.cargo || "Alcalde electo",
      tooltip: `${nombre} · ${alcaldeData.partido || ""} · ${alcaldeData.periodo || ""}`,
      meta: {
        cargo: alcaldeData.cargo || "Alcalde distrital",
        partido: alcaldeData.partido,
        periodo: alcaldeData.periodo,
        fuente_url: alcaldeData.fuente_url,
        rol: "Autoridad electa vigente",
      },
    });
    edges.push({
      from: idEntidad, to: idAlc, kind: "preside_entidad",
      label: "preside",
    });
  }

  // Funcionarios designados (Gerente Municipal, Logística, OCI, etc.)
  // Ahora con indicador de confianza_match para distinguir matches firmes
  // (DNI verificado) de matches fuzzy débiles que pueden ser homónimos.
  const designadosMostrados = funcionariosDesignados.slice(0, 5);
  designadosMostrados.forEach((f: any, i: number) => {
    if (!entidadContratante) return;
    const id = `fd_${i}`;
    const nombre = (f.nombre_completo || f.nombre || "Funcionario") as string;
    const cargo = (f.cargo || f.area || "Designado") as string;
    const dniFunc = String(f.dni || "");
    const isConflict = dniFunc && dniProveedor.has(dniFunc);
    // F4: confianza_match — viene del backend cruzando con batch_person_lookup
    const conf = (f.confianza_match || "sin_lookup") as string;
    const hallazgosCount = Array.isArray(f.hallazgos_summary) ? f.hallazgos_summary.length : 0;
    const sublabelExtra = hallazgosCount > 0 && (conf === "alta" || conf === "media")
      ? ` · ${hallazgosCount} hallazgos`
      : "";
    nodes.push({
      id, kind: "funcionario_designado",
      label: nombre,
      sublabel: cargo + sublabelExtra,
      tooltip: `${nombre} · ${cargo}${f.fecha_designacion ? " (desde " + f.fecha_designacion + ")" : ""}${
        conf === "muy_baja" || conf === "sin_lookup" ? " · ⚠ sin DNI verificado" : ""
      }`,
      meta: {
        cargo, institucion: f.area, dni: f.dni,
        fuente_url: f.fuente_url,
        observacion: conf === "muy_baja" || conf === "sin_lookup"
          ? "Sin DNI verificado — los hallazgos por nombre son fuzzy match"
          : (Array.isArray(f.hallazgos_summary) ? f.hallazgos_summary.join(" · ") : ""),
        rol: isConflict
          ? "⚠ Conflicto detectado"
          : (conf === "muy_baja" || conf === "sin_lookup"
              ? "Funcionario designado (sin DNI)"
              : "Funcionario designado"),
      },
    });
    edges.push({
      from: idEntidad, to: id,
      kind: isConflict ? "conflicto_funcionario" : "designado_por",
      label: isConflict ? "⚠ vinculado al proveedor" : (cargo.split(" ")[0] || "designado"),
    });
  });

  // ─── F1 · POSTORES RIVALES + SOCIOS CON CONFLICTO ───
  // Los postores no ganadores también deben graficarse. Si algún socio de un
  // postor es funcionario público o tiene cargo electo, eso es bandera ALTA.
  const sociosPostoresRivales = (ctx?.socios_postores_rivales || []) as any[];
  // También cruzamos contra autoridades electas para detectar conflicto auto.
  const autoridadesActivasNombres = new Set<string>();
  if (autoridadesEntidad?.alcalde_distrital_actual?.nombre) {
    autoridadesActivasNombres.add(
      String(autoridadesEntidad.alcalde_distrital_actual.nombre).toUpperCase()
    );
  }
  sociosPostoresRivales.slice(0, 4).forEach((pr: any, i: number) => {
    const id = `pr_${i}`;
    const razon = (pr.razon_social || "Postor rival") as string;
    nodes.push({
      id, kind: "postor_rival",
      label: razon,
      sublabel: pr.ruc_postor ? `RUC ${pr.ruc_postor}` : "postor no ganador",
      tooltip: `${razon} · postor no ganador · ${pr.n_socios || 0} socios`,
      meta: { ruc: pr.ruc_postor, razon_social: razon, rol: "Postor no ganador" },
    });
    // Edge desde la entidad: todos compitieron por el mismo contrato
    edges.push({
      from: idEntidad, to: id, kind: "compitio",
      label: "postuló",
    });

    // Socios del postor rival — máximo 2 por postor para no saturar
    (pr.socios || []).slice(0, 2).forEach((s: any, j: number) => {
      if (!s) return;
      const socId = `pr_${i}_s_${j}`;
      const nombre = (s.nombre || "Socio") as string;
      // Detectar si es funcionario público activo (cruce con autoridades)
      const esFuncionarioActivo = autoridadesActivasNombres.has(nombre.toUpperCase());
      nodes.push({
        id: socId,
        kind: esFuncionarioActivo ? "socio_postor_conflicto" : "company_titular",
        label: nombre,
        sublabel: s.dni ? `DNI ${s.dni}` : (s.rol_en_postor || "socio"),
        tooltip: `${nombre}${s.dni ? " · DNI " + s.dni : ""} · ${s.rol_en_postor || "socio"}${
          esFuncionarioActivo ? " · ⚠ FUNCIONARIO PÚBLICO ACTIVO" : ""
        }`,
        meta: {
          dni: s.dni, rol: s.rol_en_postor,
          observacion: esFuncionarioActivo
            ? "⚠ Socio de postor rival es funcionario público activo en la región"
            : `Socio de postor no ganador (${razon})`,
        },
      });
      edges.push({
        from: id, to: socId,
        kind: esFuncionarioActivo ? "conflicto_funcionario" : "socio_de",
        label: esFuncionarioActivo ? "⚠ socio + funcionario" : "socio",
      });
    });
  });

  // ─── F2 · VISITAS INTER-MUNICIPALES ───
  // Funcionario de la entidad contratante figura representando otra
  // municipalidad en visitas oficiales → doble vinculación.
  const visitasInterMun = (ctx?.visitas_inter_municipales || []) as any[];
  // Deduplicar por entidad_representada
  const entidadesSecundariasYaCreadas = new Set<string>();
  visitasInterMun.slice(0, 4).forEach((v: any, i: number) => {
    const entRep = (v.entidad_representada || "").trim();
    if (!entRep || entidadesSecundariasYaCreadas.has(entRep.toUpperCase())) return;
    entidadesSecundariasYaCreadas.add(entRep.toUpperCase());
    const id = `es_${i}`;
    nodes.push({
      id, kind: "entidad_secundaria",
      label: entRep,
      sublabel: "doble vinculación",
      tooltip: `${v.persona || "Un funcionario"} representó a ${entRep} en visita a ${
        v.entidad_visitada || "entidad pública"
      }${v.fecha ? " (" + v.fecha + ")" : ""}`,
      meta: {
        entidad: entRep,
        observacion: `${v.persona} (funcionario de ${entidadContratante?.nombre || "la entidad"}) representó a esta otra entidad`,
        rol: "Entidad secundaria · doble vinculación detectada",
      },
    });
    edges.push({
      from: idEntidad, to: id, kind: "doble_vinculacion",
      label: "doble vinculación",
    });
  });

  // No renderizar si solo hay persona + empresa principal sin nada más
  if (nodes.length <= 2) return null;

  // ─── Layout polar: persona al centro, empresas en anillo externo ───
  const W = 920, H = 600;
  const cx = W / 2, cy = H / 2;
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(idPerson, { x: cx, y: cy });

  // Radios más amplios para evitar overlap
  const R1 = 220;     // anillo 1 (empresas / partidos / cargos)
  const R2_co = 150;  // sub-anillo (contratos cuelgan de la empresa principal)
  const R2_dom = 130; // sub-anillo (domicilio cuelga de empresa principal)

  // Empresa principal: arriba-derecha
  const mainAng = -Math.PI / 4; // -45°
  positions.set(idCompanyMain, { x: cx + R1 * Math.cos(mainAng), y: cy + R1 * Math.sin(mainAng) });
  const mp = positions.get(idCompanyMain)!;

  // Otras empresas mismo titular → arco superior (de -135° a -50°), evita el slot principal
  const titularSlots = empresasTitular.length;
  empresasTitular.forEach((_e: any, i: number) => {
    const id = `co_t_${i}`;
    const t = titularSlots <= 1 ? 0.5 : i / (titularSlots - 1);
    const ang = -Math.PI + (Math.PI * 0.55) * t; // de 180° a 81°
    positions.set(id, { x: cx + R1 * Math.cos(ang), y: cy + R1 * Math.sin(ang) });
  });

  // Partidos → arco izquierdo (de 110° a 200°)
  const partidos = Array.from(partidosMap.values());
  partidos.forEach((meta, i) => {
    const t = partidos.length <= 1 ? 0.5 : i / (partidos.length - 1);
    const ang = (Math.PI * 0.6) + (Math.PI * 0.5) * t; // de 108° a 198°
    positions.set(meta.id, { x: cx + R1 * Math.cos(ang), y: cy + R1 * Math.sin(ang) });
  });

  // Cargos públicos → arco inferior izquierdo
  cargosPasados.slice(0, 3).forEach((_c: any, i: number) => {
    const id = `cg_${i}`;
    const slots = Math.min(cargosPasados.length, 3);
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (Math.PI * 1.1) + (Math.PI * 0.25) * t;
    positions.set(id, { x: cx + R1 * Math.cos(ang), y: cy + R1 * Math.sin(ang) });
  });

  // Empresas mismo domicilio → cuelgan de la empresa principal hacia la derecha-abajo
  empresasDomicilio.forEach((_e: any, i: number) => {
    const id = `co_d_${i}`;
    const slots = empresasDomicilio.length;
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (Math.PI * 0.05) + (Math.PI * 0.45) * t; // de 9° a 90°
    positions.set(id, { x: mp.x + R2_dom * Math.cos(ang), y: mp.y + R2_dom * Math.sin(ang) });
  });

  // Contratos → cuelgan a la derecha de la empresa principal
  contratosFiltrados.forEach((_c: any, i: number) => {
    const id = `ct_${i}`;
    const slots = contratosFiltrados.length;
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (-Math.PI * 0.4) + (Math.PI * 0.6) * t; // arco derecho-superior
    positions.set(id, { x: mp.x + R2_co * Math.cos(ang), y: mp.y + R2_co * Math.sin(ang) });
  });

  // Pareja / familia → arco inferior (cerca de la persona). Hasta 8.
  familia.slice(0, 8).forEach((f: any, i: number) => {
    const id = `fa_${i}`;
    const slots = Math.min(familia.length, 8);
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    // Arco inferior ampliado (de 30° a 150°)
    const ang = (Math.PI * 0.2) + (Math.PI * 0.6) * t;
    const radio = R1 - 10;
    const fx = cx + radio * Math.cos(ang);
    const fy = cy + radio * Math.sin(ang);
    positions.set(id, { x: fx, y: fy });
    // Sub-nodos: municipios donde trabaja el familiar (cargos públicos)
    const cargosFam = (f.cargos_publicos || f.cargos || []) as any[];
    cargosFam.slice(0, 2).forEach((_c: any, j: number) => {
      const subId = `fa_${i}_mun_${j}`;
      // Si hay 1, debajo; si hay 2, abrir en abanico
      const offsetAng = cargosFam.length === 1 ? Math.PI * 0.5 : (Math.PI * 0.3 + Math.PI * 0.4 * j);
      const subR = 110;
      const munX = fx + subR * Math.cos(offsetAng);
      const munY = fy + subR * Math.sin(offsetAng);
      positions.set(subId, { x: munX, y: munY });
      // Si tiene partido derivado, lo posicionamos al lado del municipio
      const partidoVal = (_c?.partido_municipio || _c?.partido_alcalde || _c?.partido || "").trim();
      const partidoUpper = partidoVal.toUpperCase();
      const partidoIgual = partidoUpper && partidoMunicipioContratante &&
        partidoUpper === partidoMunicipioContratante;
      if (partidoVal && !partidoIgual) {
        const ptId = `fa_${i}_mun_${j}_pt`;
        // Posicionar el nodo partido justo debajo del municipio
        positions.set(ptId, { x: munX, y: munY + 75 });
      }
    });
  });

  // Autoridades públicas → arco derecho (cerca pero por fuera del proveedor)
  autoridades.slice(0, 5).forEach((_a: any, i: number) => {
    const id = `au_${i}`;
    const slots = Math.min(autoridades.length, 5);
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (-Math.PI * 0.15) + (Math.PI * 0.3) * t; // sector derecho ampliado
    positions.set(id, { x: cx + (R1 + 50) * Math.cos(ang), y: cy + (R1 + 50) * Math.sin(ang) });
  });

  // Firmantes con conflicto → arco inferior izquierdo (lugar visible y alerta)
  cruceFirmantes.slice(0, 3).forEach((_c: any, i: number) => {
    const id = `fc_${i}`;
    const slots = Math.min(cruceFirmantes.length, 3);
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (Math.PI * 0.75) + (Math.PI * 0.2) * t;
    positions.set(id, { x: cx + (R1 + 20) * Math.cos(ang), y: cy + (R1 + 20) * Math.sin(ang) });
  });

  // ─── CLUSTER ENTIDAD CONTRATANTE: a la derecha ───
  // Entidad: arriba-derecha pero más cerca del centro para que entre en viewport
  const entAng = -Math.PI / 6; // -30°
  const entR = 260;
  if (positions.has(idCompanyMain) && entidadContratante) {
    positions.set(idEntidad, {
      x: cx + entR * Math.cos(entAng),
      y: cy + entR * Math.sin(entAng),
    });
    const ep = positions.get(idEntidad)!;
    // Alcalde: justo arriba de la entidad
    if (alcaldeData) {
      positions.set("alcalde_actual", { x: ep.x, y: ep.y - 90 });
    }
    // Funcionarios designados: alrededor de la entidad en arco derecho amplio
    designadosMostrados.forEach((_f: any, i: number) => {
      const slots = designadosMostrados.length;
      const t = slots <= 1 ? 0.5 : i / (slots - 1);
      const a = -Math.PI * 0.5 + Math.PI * 1.0 * t; // -90° a +90°
      positions.set(`fd_${i}`, { x: ep.x + 130 * Math.cos(a), y: ep.y + 130 * Math.sin(a) });
    });

    // F1: Postores rivales — arco izquierdo del cluster entidad
    sociosPostoresRivales.slice(0, 4).forEach((pr: any, i: number) => {
      const slots = Math.min(sociosPostoresRivales.length, 4);
      const t = slots <= 1 ? 0.5 : i / (slots - 1);
      const a = Math.PI * 0.8 + Math.PI * 0.4 * t; // arco a la izquierda de la entidad
      const prX = ep.x + 180 * Math.cos(a);
      const prY = ep.y + 180 * Math.sin(a);
      positions.set(`pr_${i}`, { x: prX, y: prY });
      // Socios del postor rival: cuelgan más lejos
      (pr.socios || []).slice(0, 2).forEach((_s: any, j: number) => {
        const sAng = j === 0 ? Math.PI * 0.85 : Math.PI * 1.15;
        positions.set(`pr_${i}_s_${j}`, {
          x: prX + 90 * Math.cos(sAng),
          y: prY + 90 * Math.sin(sAng),
        });
      });
    });

    // F2: Entidades secundarias por visita inter-municipal — debajo de la entidad
    visitasInterMun.slice(0, 4).forEach((_v: any, i: number) => {
      const entRep = (_v.entidad_representada || "").trim().toUpperCase();
      if (!entRep) return;
      // posición debajo-derecha
      positions.set(`es_${i}`, { x: ep.x + 30 + i * 60, y: ep.y + 200 });
    });
  }

  // ─── Spread anti-overlap: separar nodos colisionados (max 50 iter) ───
  // Radio efectivo más generoso porque los rects ahora pueden tener wrap
  // de 2-3 líneas (≈70-100 px ancho × 50 alto).
  const nodeRadius = (kind: GraphNode["kind"]): number => {
    if (kind === "person") return 60;
    if (kind === "entidad") return 60;
    if (kind === "company_main") return 55;
    if (kind === "contract") return 48;
    if (kind === "alcalde" || kind === "funcionario_designado") return 50;
    return 52;
  };
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const ni = nodes[i], nj = nodes[j];
        const a = positions.get(ni.id);
        const b = positions.get(nj.id);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = nodeRadius(ni.kind) + nodeRadius(nj.kind) + 12;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          // El nodo persona no se mueve (centro)
          if (ni.kind !== "person") { a.x -= ux * push; a.y -= uy * push; }
          if (nj.kind !== "person") { b.x += ux * push; b.y += uy * push; }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  // El viewBox base es 920×600 pero al haber zoom + pan, los nodos pueden
  // ir más allá. Solo evitamos que se solapen con la persona (centro).
  // No clampeamos — el user puede arrastrar el grafo con pan.
  // Aplicar overrides por drag (el user arrastró esos nodos)
  Object.entries(posOverride).forEach(([id, p]) => {
    if (positions.has(id)) positions.set(id, p);
  });

  // Estilos por tipo
  const styleNode = (kind: GraphNode["kind"]) => {
    switch (kind) {
      case "person":              return { fill: "#7a3b2e", stroke: "#7a3b2e", text: "#fff", r: 38 };
      case "pareja":              return { fill: "#faf5ff", stroke: "#7c3aed", text: "#4c1d95", r: 24 };
      case "company_main":        return { fill: "#fff", stroke: "#c2410c", text: "#1a1a1a", r: 30 };
      case "company_titular":     return { fill: "#fff7ed", stroke: "#d97706", text: "#92400e", r: 24 };
      case "company_domicilio":   return { fill: "#fef2f2", stroke: "#b91c1c", text: "#7f1d1d", r: 22 };
      case "party":               return { fill: "#fef2f2", stroke: "#991b1b", text: "#7f1d1d", r: 22 };
      case "cargo_pasado":        return { fill: "#f5f5f4", stroke: "#525252", text: "#262626", r: 20 };
      case "autoridad":           return { fill: "#fefce8", stroke: "#ca8a04", text: "#713f12", r: 22 };
      case "firmante_conflicto":  return { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d", r: 22 };
      case "contract":            return { fill: "#fffbeb", stroke: "#a16207", text: "#713f12", r: 18 };
      // Nuevos: cluster entidad contratante
      case "entidad":             return { fill: "#1e3a8a", stroke: "#1e3a8a", text: "#fff",    r: 34 };
      case "alcalde":             return { fill: "#dbeafe", stroke: "#1e3a8a", text: "#1e3a8a", r: 26 };
      case "funcionario_designado":return { fill: "#eff6ff", stroke: "#3b82f6", text: "#1e40af", r: 22 };
      // Cargo público de un familiar → municipio donde trabaja
      case "municipio_familiar":  return { fill: "#f3e8ff", stroke: "#6b21a8", text: "#581c87", r: 24 };
      // Partido político derivado (del municipio del familiar)
      case "partido_compartido":  return { fill: "#fef2f2", stroke: "#991b1b", text: "#7f1d1d", r: 20 };
      // Postor rival (no ganador)
      case "postor_rival":        return { fill: "#fff7ed", stroke: "#9a3412", text: "#7c2d12", r: 24 };
      // Socio del postor rival que es funcionario público — bandera ALTA
      case "socio_postor_conflicto": return { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d", r: 26 };
      // Entidad secundaria por doble vinculación de un funcionario
      case "entidad_secundaria":  return { fill: "#ecfeff", stroke: "#0e7490", text: "#155e75", r: 22 };
    }
  };
  const styleEdge = (kind: GraphEdge["kind"]) => {
    switch (kind) {
      case "titular":              return { color: "#d97706", width: 2,   dash: "" };
      case "domicilio":            return { color: "#b91c1c", width: 2,   dash: "4 4" };
      case "candidato":            return { color: "#991b1b", width: 1.5, dash: "6 3" };
      case "aporte":               return { color: "#dc2626", width: 2,   dash: "" };
      case "cargo":                return { color: "#525252", width: 1.5, dash: "2 3" };
      case "contrato":             return { color: "#a16207", width: 1.2, dash: "" };
      case "pareja":               return { color: "#7c3aed", width: 2.5, dash: "" };
      case "autoridad":            return { color: "#ca8a04", width: 2,   dash: "5 2" };
      case "firma_conflicto":      return { color: "#dc2626", width: 3,   dash: "" };
      // Nuevos
      case "adjudicacion":         return { color: "#1e3a8a", width: 3,   dash: "" };
      case "preside_entidad":      return { color: "#1e3a8a", width: 2,   dash: "" };
      case "designado_por":        return { color: "#3b82f6", width: 1.5, dash: "3 3" };
      case "conflicto_funcionario":return { color: "#dc2626", width: 3,   dash: "" };
      // Familiar trabaja en municipio
      case "trabaja_en":           return { color: "#6b21a8", width: 1.5, dash: "" };
      // Partido del municipio (cuando NO coincide con el contratante)
      case "partido_de":           return { color: "#991b1b", width: 1.2, dash: "4 4" };
      // ⚠ MISMO PARTIDO que el municipio que contrata — alerta cruzada
      case "mismo_partido_que":    return { color: "#dc2626", width: 3.5, dash: "2 4" };
      // Postor rival compitió por el contrato
      case "compitio":             return { color: "#9a3412", width: 1.2, dash: "5 3" };
      // Socio de postor rival
      case "socio_de":             return { color: "#9a3412", width: 1.5, dash: "" };
      // Funcionario visitó otra entidad
      case "visito":               return { color: "#0e7490", width: 1.2, dash: "3 3" };
      // Doble vinculación inter-municipal
      case "doble_vinculacion":    return { color: "#0e7490", width: 2,   dash: "5 2" };
    }
  };

  // ─── Convertir coord de mouse a SVG ───
  const mouseToSvg = (clientX: number, clientY: number) => {
    if (!svgRef.current) return null;
    const pt = svgRef.current.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const handleNodeMouseDown = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const pos = positions.get(id);
    if (!pos) return;
    draggedRef.current = id;
    dragStartRef.current = { mx: e.clientX, my: e.clientY, nx: pos.x, ny: pos.y };
    wasDraggedRef.current = false;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Si se está arrastrando un nodo
      if (draggedRef.current && dragStartRef.current) {
        const start = dragStartRef.current;
        const moved = Math.hypot(e.clientX - start.mx, e.clientY - start.my);
        if (moved > 4) wasDraggedRef.current = true;
        const startSvg = mouseToSvg(start.mx, start.my);
        const nowSvg = mouseToSvg(e.clientX, e.clientY);
        if (!startSvg || !nowSvg) return;
        const dx = nowSvg.x - startSvg.x;
        const dy = nowSvg.y - startSvg.y;
        const newPos = { x: start.nx + dx, y: start.ny + dy };
        setPosOverride(prev => ({ ...prev, [draggedRef.current!]: newPos }));
        return;
      }
      // Si se está paneando el fondo
      if (panningRef.current) {
        const start = panningRef.current;
        // Movimiento del mouse en px → traducir a unidades SVG según escala actual
        const scaleX = viewBox.w / (svgRef.current?.clientWidth || viewBox.w);
        const scaleY = viewBox.h / (svgRef.current?.clientHeight || viewBox.h);
        const dx = (e.clientX - start.mx) * scaleX;
        const dy = (e.clientY - start.my) * scaleY;
        setViewBox(v => ({ ...v, x: start.vx - dx, y: start.vy - dy }));
      }
    };
    const onUp = () => {
      draggedRef.current = null;
      dragStartRef.current = null;
      panningRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [viewBox.w, viewBox.h]);

  // Pan: drag del fondo del SVG (no de un nodo)
  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    panningRef.current = {
      mx: e.clientX, my: e.clientY,
      vx: viewBox.x, vy: viewBox.y,
    };
  };

  // Zoom con wheel: factor depende del scroll, centrado en el cursor
  // Base = 1440 (viewBox default amplio) → "100%" en el indicador
  const VBASE_W = 1440;
  const VBASE_H = 940;
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    const minW = VBASE_W * 0.25, maxW = VBASE_W * 3;
    const newW = Math.max(minW, Math.min(maxW, viewBox.w * factor));
    const newH = newW * (VBASE_H / VBASE_W);
    const svgPt = mouseToSvg(e.clientX, e.clientY);
    if (!svgPt) return;
    const dx = (svgPt.x - viewBox.x) * (newW / viewBox.w - 1);
    const dy = (svgPt.y - viewBox.y) * (newH / viewBox.h - 1);
    setViewBox({ x: viewBox.x - dx, y: viewBox.y - dy, w: newW, h: newH });
  };

  const handleZoom = (factor: number) => {
    const minW = VBASE_W * 0.25, maxW = VBASE_W * 3;
    const newW = Math.max(minW, Math.min(maxW, viewBox.w * factor));
    const newH = newW * (VBASE_H / VBASE_W);
    const cxv = viewBox.x + viewBox.w / 2;
    const cyv = viewBox.y + viewBox.h / 2;
    setViewBox({ x: cxv - newW / 2, y: cyv - newH / 2, w: newW, h: newH });
  };

  const resetViewBox = () => setViewBox({ x: -260, y: -170, w: 1440, h: 940 });

  const handleNodeClick = (id: string) => () => {
    // Si el user arrastró el nodo, no abrir panel de detalle
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }
    setSelectedId(prev => prev === id ? null : id);
  };

  // Reset de overrides cuando cambia la data subyacente
  const dataSignature = `${nodes.length}-${edges.length}`;
  useEffect(() => {
    setPosOverride({});
  }, [dataSignature]);

  // Panel resumen: contar nodos por tipo y banderas red
  const nodesByKind = nodes.reduce((acc: Record<string, number>, n) => {
    acc[n.kind] = (acc[n.kind] || 0) + 1;
    return acc;
  }, {});
  const edgesByKind = edges.reduce((acc: Record<string, number>, e) => {
    acc[e.kind] = (acc[e.kind] || 0) + 1;
    return acc;
  }, {});
  const banderasRed: any[] = person?.banderas_red || [];
  const banderasAlta = banderasRed.filter((b) => b.severidad === "alta");
  const banderasMedia = banderasRed.filter((b) => b.severidad === "media");

  const summaryCards = [
    {
      key: "personas",
      label: "Personas mapeadas",
      count: (nodesByKind.person || 0) + (nodesByKind.pareja || 0) + (nodesByKind.autoridad || 0)
           + (nodesByKind.alcalde || 0) + (nodesByKind.funcionario_designado || 0),
      hint: "proveedor + autoridades + designados",
      color: "bg-clay/10 text-clay border-clay/30",
    },
    {
      key: "empresas",
      label: "Empresas vinculadas",
      count: (nodesByKind.company_main || 0) + (nodesByKind.company_titular || 0) + (nodesByKind.company_domicilio || 0),
      hint: "con mismo titular o domicilio",
      color: "bg-amber/10 text-amber border-amber/30",
    },
    {
      key: "vinculos",
      label: "Vínculos detectados",
      count: edges.length,
      hint: edgesByKind.titular ? `${edgesByKind.titular} de titularidad` : "relaciones formales",
      color: "bg-moss/10 text-moss border-moss/30",
    },
    {
      key: "banderas_red",
      label: "Banderas de red",
      count: banderasRed.length,
      hint: banderasAlta.length > 0 ? `${banderasAlta.length} alta · ${banderasMedia.length} media` : "sin riesgo detectado",
      color: banderasAlta.length > 0 ? "bg-rust/15 text-rust border-rust/40" : "bg-paperSoft text-mute border-line",
    },
  ];

  return (
    <div className="border-t border-line bg-paperSoft px-5 py-5">
      {/* PANEL RESUMEN — primero, antes del grafo */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summaryCards.map((c) => (
          <div key={c.key} className={cn("rounded-lg border px-3 py-2", c.color)}>
            <div className="text-[9px] font-bold uppercase tracking-widest opacity-80">{c.label}</div>
            <div className="mt-0.5 font-mono text-2xl font-bold leading-none">{c.count}</div>
            <div className="mt-1 text-[10px] italic opacity-70">{c.hint}</div>
          </div>
        ))}
      </div>

      {/* HALLAZGOS DE RED — bullets clave */}
      {banderasRed.length > 0 && (
        <div className="mb-4 rounded-lg border border-line bg-paper px-3 py-2.5">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-clay">
            ⚡ Hallazgos clave de la red empresarial
          </div>
          <ul className="space-y-1">
            {banderasRed.slice(0, 6).map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span className={cn(
                  "mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                  b.severidad === "alta" ? "bg-rust text-paper" :
                  b.severidad === "media" ? "bg-amber text-paper" :
                  "bg-paperDeep text-mute",
                )}>
                  {b.severidad || "info"}
                </span>
                <div>
                  <span className="font-semibold text-ink">{b.titulo || b.tipo || "Hallazgo"}</span>
                  {b.descripcion && (
                    <span className="ml-1.5 text-inkSoft">— {String(b.descripcion).slice(0, 220)}{String(b.descripcion).length > 220 ? "…" : ""}</span>
                  )}
                  {b.requiere_verificacion && (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-soft px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-amber">⏳ requiere verificación</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Network size={11} className="mr-1 inline" />
          Grafo de relaciones · arrastrá los nodos para reorganizar
        </h3>
        {Object.keys(posOverride).length > 0 && (
          <button
            type="button"
            onClick={() => setPosOverride({})}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-0.5 text-[10px] font-semibold text-ink hover:bg-paperDeep"
            title="Volver al layout automático"
          >
            <RotateCcw size={10} /> Resetear posiciones
          </button>
        )}
        <div className="flex flex-wrap gap-2 text-[9px] text-mute">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#d97706" }} />
            titular
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#b91c1c", backgroundImage: "repeating-linear-gradient(90deg,#b91c1c 0 2px,transparent 2px 4px)" }} />
            mismo domicilio
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#dc2626" }} />
            aporte ONPE
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#525252", backgroundImage: "repeating-linear-gradient(90deg,#525252 0 1px,transparent 1px 3px)" }} />
            cargo público
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#a16207" }} />
            contrato
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#7c3aed" }} />
            pareja / familia
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#ca8a04", backgroundImage: "repeating-linear-gradient(90deg,#ca8a04 0 3px,transparent 3px 5px)" }} />
            autoridad pública
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#dc2626", height: 4 }} />
            firmante en conflicto
          </span>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-md border border-line bg-paper">
        {/* Controles de zoom flotantes */}
        <div className="absolute right-2 top-2 z-10 flex flex-col gap-1 rounded-lg border border-line bg-paper/95 p-1 shadow-card backdrop-blur-sm">
          <button
            type="button"
            onClick={() => handleZoom(0.85)}
            className="flex h-7 w-7 items-center justify-center rounded text-ink hover:bg-paperDeep"
            title="Acercar"
          >
            <span className="text-base font-bold leading-none">+</span>
          </button>
          <button
            type="button"
            onClick={() => handleZoom(1.18)}
            className="flex h-7 w-7 items-center justify-center rounded text-ink hover:bg-paperDeep"
            title="Alejar"
          >
            <span className="text-base font-bold leading-none">−</span>
          </button>
          <button
            type="button"
            onClick={resetViewBox}
            className="flex h-7 w-7 items-center justify-center rounded text-ink hover:bg-paperDeep"
            title="Resetear zoom"
          >
            <RotateCcw size={12} />
          </button>
          <div className="text-center text-[8px] font-mono text-mute">
            {Math.round(1440 / viewBox.w * 100)}%
          </div>
        </div>

        {/* Hint sutil */}
        <div className="absolute left-2 top-2 z-10 rounded-md bg-paperDeep/80 px-2 py-0.5 text-[9px] text-mute backdrop-blur-sm">
          rueda = zoom · arrastrá fondo = mover · click nodo = detalle
        </div>

        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="block h-[600px] w-full select-none"
          preserveAspectRatio="xMidYMid meet"
          style={{ cursor: panningRef.current ? "grabbing" : "default" }}
          onWheel={handleWheel}
          onMouseDown={handleBackgroundMouseDown}
        >
          {/* Fondo invisible para capturar pan en zonas sin nodos */}
          <rect
            x={viewBox.x - 1000} y={viewBox.y - 1000}
            width={viewBox.w + 2000} height={viewBox.h + 2000}
            fill="transparent"
          />

          {/* Aristas */}
          {edges.map((e, i) => {
            const a = positions.get(e.from);
            const b = positions.get(e.to);
            if (!a || !b) return null;
            const st = styleEdge(e.kind);
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            return (
              <g key={`e_${i}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={st.color} strokeWidth={st.width} strokeDasharray={st.dash}
                      opacity={0.7} />
                {e.label && (
                  <text x={mx} y={my - 4} fontSize="9" fill={st.color}
                        textAnchor="middle" style={{ paintOrder: "stroke", stroke: "#fafafa", strokeWidth: 3 }}>
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodos */}
          {nodes.map((n) => {
            const pos = positions.get(n.id);
            if (!pos) return null;
            const s = styleNode(n.kind);
            const isSelected = selectedId === n.id;
            // Wrap inteligente: dividir el label en líneas de ~16 chars
            const lines = wrapText(n.label, 16, 3);
            const longestLine = lines.reduce((m, l) => Math.max(m, l.length), 0);
            // Ancho del rect = max línea × ancho promedio de char + padding
            const wRect = Math.max(80, Math.min(220, longestLine * 6.2 + 16));
            // Alto del rect = base + extra por cada línea adicional
            const baseH = n.sublabel ? 22 : 14;
            const lineH = 12;
            const hRect = baseH + lines.length * lineH;

            if (n.kind === "person") {
              const initials = (n.label || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
              return (
                <g key={n.id} onClick={handleNodeClick(n.id)} onMouseDown={handleNodeMouseDown(n.id)} style={{ cursor: "grab" }}>
                  <title>{(n.tooltip || n.label) + " · arrastrá para mover · click para detalle"}</title>
                  {isSelected && (
                    <circle cx={pos.x} cy={pos.y} r={s.r + 6} fill="none" stroke={s.stroke} strokeWidth={2} opacity={0.4}>
                      <animate attributeName="r" values={`${s.r + 6};${s.r + 10};${s.r + 6}`} dur="1.5s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={pos.x} cy={pos.y} r={s.r} fill={s.fill} stroke={s.stroke} strokeWidth={isSelected ? 3 : 2} />
                  <text x={pos.x} y={pos.y + 5} fontSize="20" fontWeight="700" fill={s.text} textAnchor="middle" style={{ pointerEvents: "none" }}>
                    {initials || "?"}
                  </text>
                  {/* Label multilinea */}
                  <text x={pos.x} y={pos.y + s.r + 13} fontSize="11" fontWeight="700" fill="#1a1a1a" textAnchor="middle"
                        style={{ paintOrder: "stroke", stroke: "#fafafa", strokeWidth: 3, pointerEvents: "none" }}>
                    {lines.map((l, idx) => (
                      <tspan key={idx} x={pos.x} dy={idx === 0 ? 0 : 13}>{l}</tspan>
                    ))}
                  </text>
                  {n.sublabel && (
                    <text x={pos.x} y={pos.y + s.r + 13 + lines.length * 13 + 2} fontSize="9" fill="#525252" textAnchor="middle"
                          style={{ paintOrder: "stroke", stroke: "#fafafa", strokeWidth: 3, pointerEvents: "none" }}>
                      {n.sublabel}
                    </text>
                  )}
                </g>
              );
            }
            return (
              <g key={n.id} onClick={handleNodeClick(n.id)} onMouseDown={handleNodeMouseDown(n.id)} style={{ cursor: "grab" }}>
                <title>{(n.tooltip || n.label) + " · arrastrá para mover · click para detalle"}</title>
                {isSelected && (
                  <rect x={pos.x - wRect / 2 - 4} y={pos.y - hRect / 2 - 4} width={wRect + 8} height={hRect + 8} rx={10}
                        fill="none" stroke={s.stroke} strokeWidth={2} opacity={0.5}>
                    <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.5s" repeatCount="indefinite" />
                  </rect>
                )}
                <rect x={pos.x - wRect / 2} y={pos.y - hRect / 2} width={wRect} height={hRect} rx={8}
                      fill={s.fill} stroke={s.stroke} strokeWidth={isSelected ? 2.5 : 1.5} />
                {/* Texto principal con wrap multilinea */}
                <text
                  x={pos.x}
                  y={pos.y - hRect / 2 + 12}
                  fontSize="10"
                  fontWeight="700"
                  fill={s.text}
                  textAnchor="middle"
                  style={{ pointerEvents: "none" }}
                >
                  {lines.map((l, idx) => (
                    <tspan key={idx} x={pos.x} dy={idx === 0 ? 0 : 11}>{l}</tspan>
                  ))}
                </text>
                {n.sublabel && (
                  <text
                    x={pos.x}
                    y={pos.y - hRect / 2 + 12 + lines.length * 11 + 4}
                    fontSize="8.5"
                    fill={s.text}
                    opacity={0.75}
                    textAnchor="middle"
                    style={{ pointerEvents: "none" }}
                  >
                    {n.sublabel.length > 28 ? n.sublabel.slice(0, 26) + "…" : n.sublabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Panel de detalle del nodo seleccionado */}
      {selectedId && (() => {
        const node = nodes.find(n => n.id === selectedId);
        if (!node) return null;
        return (
          <NodeDetailPanel
            node={node}
            onClose={() => setSelectedId(null)}
            onVigiaSearch={(ruc) => router.push(`/app/convocatoria?q=${encodeURIComponent(ruc)}`)}
          />
        );
      })()}

    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// NodeDetailPanel — panel expandible al click en un nodo del grafo
// ════════════════════════════════════════════════════════════════════

function NodeDetailPanel({
  node,
  onClose,
  onVigiaSearch,
}: { node: GraphNode; onClose: () => void; onVigiaSearch: (ruc: string) => void }) {
  const m = node.meta || {};
  const kindLabel: Record<GraphNode["kind"], string> = {
    person: "Persona",
    pareja: "Pareja o familia",
    company_main: "Empresa adjudicada",
    company_titular: "Empresa con mismo titular",
    company_domicilio: "Empresa con mismo domicilio",
    party: "Partido político",
    contract: "Otro contrato",
    cargo_pasado: "Cargo público pasado",
    autoridad: "Autoridad pública vinculada",
    firmante_conflicto: "Firmante con conflicto",
    entidad: "Entidad contratante",
    alcalde: "Alcalde / autoridad electa",
    funcionario_designado: "Funcionario designado",
    municipio_familiar: "Municipio donde trabaja un familiar",
    partido_compartido: "Partido político del municipio",
    postor_rival: "Postor rival (no ganador)",
    socio_postor_conflicto: "⚠ Socio de postor rival = Funcionario público",
    entidad_secundaria: "Entidad secundaria (doble vinculación)",
  };
  const kindColor: Record<GraphNode["kind"], string> = {
    person: "bg-clay text-paper",
    pareja: "bg-[#7c3aed] text-paper",
    company_main: "bg-rust text-paper",
    company_titular: "bg-amber text-paper",
    company_domicilio: "bg-rust text-paper",
    party: "bg-rust text-paper",
    contract: "bg-clay text-paper",
    cargo_pasado: "bg-ink text-paper",
    autoridad: "bg-amber text-paper",
    firmante_conflicto: "bg-rust text-paper",
    entidad: "bg-[#1e3a8a] text-paper",
    alcalde: "bg-[#1e3a8a] text-paper",
    funcionario_designado: "bg-[#3b82f6] text-paper",
    municipio_familiar: "bg-[#6b21a8] text-paper",
    partido_compartido: "bg-rust text-paper",
    postor_rival: "bg-[#9a3412] text-paper",
    socio_postor_conflicto: "bg-rust text-paper",
    entidad_secundaria: "bg-[#0e7490] text-paper",
  };

  const links: Array<{ label: string; href: string; icon?: string }> = [];
  if (m.ruc) {
    links.push({ label: "SUNAT (consulta RUC)", href: `https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc=${m.ruc}` });
    links.push({ label: "DatosPerú (perfil)", href: `https://www.datosperu.org/ruc-${m.ruc}.php` });
    links.push({ label: "OECE (búsqueda proveedor)", href: `https://contratacionesabiertas.oece.gob.pe/perfilProveedor/#!/transactions/${m.ruc}` });
  }
  if (m.dni) {
    links.push({ label: "RENIEC (PerúConsulta)", href: `https://eldni.com/pe/buscar-por-dni?dni=${m.dni}` });
  }
  if (m.fuente_url) {
    links.push({ label: "Fuente del dato", href: m.fuente_url });
  }
  if (m.partido) {
    links.push({ label: "ONPE (financiamiento político)", href: `https://www.onpe.gob.pe/modAportantes/aportantes/` });
  }

  return (
    <div className="mt-3 overflow-hidden rounded-lg border-2 border-clay bg-paper shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-paperDeep px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest", kindColor[node.kind])}>
            {kindLabel[node.kind]}
          </span>
          {m.rol && (
            <span className="text-[10px] font-semibold text-mute">{m.rol}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-0.5 text-xs text-mute hover:bg-paperDeep hover:text-ink"
          title="Cerrar"
        >
          ✕
        </button>
      </div>

      <div className="p-4">
        <h4 className="font-serif text-lg font-bold leading-tight text-ink">
          {m.razon_social || m.partido || m.institucion || m.entidad || node.label}
        </h4>

        {/* Detalles según tipo */}
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          {m.ruc && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">RUC</dt>
              <dd className="font-mono font-bold text-ink">{m.ruc}</dd>
            </div>
          )}
          {m.dni && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">DNI</dt>
              <dd className="font-mono font-bold text-ink">{m.dni}</dd>
            </div>
          )}
          {m.cargo && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Cargo</dt>
              <dd className="text-ink">{m.cargo}</dd>
            </div>
          )}
          {m.periodo && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Período</dt>
              <dd className="font-mono text-ink">{m.periodo}</dd>
            </div>
          )}
          {m.año != null && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Año</dt>
              <dd className="font-mono text-ink">{m.año}</dd>
            </div>
          )}
          {m.monto != null && m.monto > 0 && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Monto</dt>
              <dd className="font-mono font-bold text-clay">S/. {m.monto.toLocaleString("es-PE")}</dd>
            </div>
          )}
          {m.direccion && (
            <div className="col-span-full rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">📍 Dirección</dt>
              <dd className="text-ink">{m.direccion}</dd>
            </div>
          )}
          {m.observacion && (
            <div className="col-span-full rounded-md bg-crimson-soft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-rust">Observación</dt>
              <dd className="italic text-rust">{m.observacion}</dd>
            </div>
          )}
          {m.objeto && (
            <div className="col-span-full rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Objeto del contrato</dt>
              <dd className="text-ink">{m.objeto}</dd>
            </div>
          )}
        </dl>

        {/* Acciones */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.ruc && (
            <button
              type="button"
              onClick={() => onVigiaSearch(m.ruc!)}
              className="inline-flex items-center gap-1 rounded-lg bg-rust px-3 py-1.5 text-[11px] font-bold text-paper shadow-sm hover:bg-rust/90"
              title="Buscar este RUC en otros análisis de Vigía"
            >
              <Search size={11} /> Buscar en Vigía
            </button>
          )}
          {links.map((l, i) => (
            <a
              key={i}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-3 py-1.5 text-[11px] font-semibold text-ink hover:bg-paperDeep"
            >
              <ExternalLink size={10} /> {l.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function PersonNetworkSection({ person, web, proveedor, ctx }: { person: any; web?: any; proveedor?: any; ctx?: any }) {
  const p = person?.persona_principal || {};
  const red = person?.red_empresarial || {};
  const banderas = person?.banderas_red || [];
  const sintesis = person?.sintesis || "";

  const hasGerente = !!p.nombre_completo;
  const empresasMismaDir = red.empresas_misma_direccion || [];
  const empresasMismoTitular = red.empresas_mismo_titular || [];
  const cargosPasados = p.cargos_pasados || [];
  const otrosCargos = p.otros_cargos_actuales || [];
  const candidaturas = p.candidaturas || [];
  const aportes = p.aportes_campañas || p.aportes_campanas || [];
  const menciones = p.menciones_prensa || [];

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Network size={11} className="mr-1 inline" />
          person_network_agent · gerente + red empresarial
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Personas clave y red empresarial
        </h2>
        {sintesis && (
          <p className="mt-2 text-sm leading-relaxed text-inkSoft">{sintesis}</p>
        )}
      </div>

      <RelationshipGraph person={person} web={web} proveedor={proveedor} ctx={ctx} />

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* PERSONA PRINCIPAL */}
        <article className="space-y-3 rounded-md border border-line bg-paperSoft p-4">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-clay text-paper">
              <Users size={18} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
                Persona principal
              </div>
              <h3 className="font-serif text-base font-bold text-ink">
                {hasGerente ? p.nombre_completo : "Gerente no identificado"}
              </h3>
              {p.cargo_actual && (
                <p className="text-xs text-inkSoft">{p.cargo_actual}</p>
              )}
            </div>
          </div>

          {!hasGerente && (
            <p className="rounded-md bg-amber-soft px-3 py-2 text-[11px] text-amber">
              {p.sintesis_personal || "El agente no pudo identificar al gerente / representante legal en las búsquedas realizadas."}
            </p>
          )}

          {p.sintesis_personal && hasGerente && (
            <p className="text-xs leading-relaxed text-inkSoft">{p.sintesis_personal}</p>
          )}

          {/* Identificadores */}
          {(p.dni || p.linkedin || p.datosperu_url) && (
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {p.dni && (
                <span className="rounded-md bg-paperDeep px-2 py-0.5 font-mono text-mute">DNI {p.dni}</span>
              )}
              {p.linkedin && (
                <a href={p.linkedin} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 rounded-md bg-paperDeep px-2 py-0.5 text-clay hover:underline">
                  LinkedIn <ExternalLink size={9} />
                </a>
              )}
              {p.datosperu_url && (
                <a href={p.datosperu_url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 rounded-md bg-paperDeep px-2 py-0.5 text-clay hover:underline">
                  DatosPerú <ExternalLink size={9} />
                </a>
              )}
            </div>
          )}

          {/* Otros cargos actuales */}
          {otrosCargos.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
                Otros cargos actuales
              </h4>
              <ul className="mt-1 space-y-1">
                {otrosCargos.map((c: any, i: number) => (
                  <li key={i} className="text-xs text-ink">
                    <strong>{c.cargo}</strong> · {c.empresa}
                    {c.ruc && <span className="ml-1 font-mono text-[10px] text-mute">RUC {c.ruc}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cargos pasados */}
          {cargosPasados.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
                Cargos pasados (públicos)
              </h4>
              <ul className="mt-1 space-y-1.5">
                {cargosPasados.map((c: any, i: number) => (
                  <li key={i} className="rounded-md bg-paperDeep px-2 py-1.5 text-xs">
                    <div className="font-semibold text-ink">{c.cargo}</div>
                    <div className="text-mute">
                      {c.institucion}
                      {c.periodo && <span className="ml-1">· {c.periodo}</span>}
                    </div>
                    {c.fuente_url && (
                      <a href={c.fuente_url} target="_blank" rel="noreferrer"
                         className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                        Fuente <ExternalLink size={9} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Candidaturas */}
          {candidaturas.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-rust">
                Candidaturas políticas
              </h4>
              <ul className="mt-1 space-y-1.5">
                {candidaturas.map((c: any, i: number) => (
                  <li key={i} className="rounded-md border border-crimson-soft bg-paper px-2 py-1.5 text-xs">
                    <div className="font-semibold text-ink">{c.año} — {c.cargo}</div>
                    <div className="text-mute">{c.partido} · {c.resultado || "—"}</div>
                    {c.fuente_url && (
                      <a href={c.fuente_url} target="_blank" rel="noreferrer"
                         className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                        Fuente <ExternalLink size={9} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Aportes ONPE */}
          {aportes.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-rust">
                Aportes a campañas (ONPE)
              </h4>
              <ul className="mt-1 space-y-1">
                {aportes.map((a: any, i: number) => (
                  <li key={i} className="text-xs text-ink">
                    <strong>{a.año}</strong> · {a.partido} · <span className="font-mono">S/. {a.monto}</span>
                    {a.fuente_url && (
                      <a href={a.fuente_url} target="_blank" rel="noreferrer"
                         className="ml-2 inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                        <ExternalLink size={9} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Menciones prensa */}
          {menciones.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
                Menciones en prensa
              </h4>
              <ul className="mt-1 space-y-1">
                {menciones.map((m: any, i: number) => (
                  <li key={i} className="text-xs text-ink">
                    <a href={m.url} target="_blank" rel="noreferrer"
                       className="text-clay hover:underline">
                      {m.medio} {m.fecha && `· ${m.fecha}`}
                    </a>
                    {m.titulo && <span className="ml-1 text-mute">— {m.titulo}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>

        {/* RED EMPRESARIAL */}
        <article className="space-y-3 rounded-md border border-line bg-paperSoft p-4">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-amber text-paper">
              <Network size={18} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
                Red empresarial
              </div>
              <h3 className="font-serif text-base font-bold text-ink">
                Empresas vinculadas
              </h3>
              {red.observaciones && (
                <p className="mt-0.5 text-[11px] text-inkSoft">{red.observaciones}</p>
              )}
            </div>
          </div>

          {/* Empresas mismo titular */}
          {empresasMismoTitular.length > 0 ? (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
                Mismo titular ({empresasMismoTitular.length})
              </h4>
              <ul className="mt-1 space-y-1.5">
                {empresasMismoTitular.map((e: any, i: number) => (
                  <li key={i} className="rounded-md bg-paperDeep px-2 py-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] text-mute">RUC {e.ruc}</span>
                      {e.rol_del_gerente && (
                        <span className="rounded-full bg-amber-soft px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber">
                          {e.rol_del_gerente}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-ink">{e.razon_social}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-mute">— Sin empresas con mismo titular detectadas.</p>
          )}

          {/* Empresas misma dirección */}
          {empresasMismaDir.length > 0 ? (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-rust">
                Mismo domicilio fiscal ({empresasMismaDir.length})
              </h4>
              <ul className="mt-1 space-y-1.5">
                {empresasMismaDir.map((e: any, i: number) => (
                  <li key={i} className="rounded-md border border-crimson-soft bg-paper px-2 py-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] text-mute">RUC {e.ruc}</span>
                    </div>
                    <div className="text-xs font-semibold text-ink">{e.razon_social}</div>
                    {e.direccion && <div className="text-[10px] text-mute">📍 {e.direccion}</div>}
                    {e.observacion && <div className="mt-0.5 text-[10px] italic text-rust">{e.observacion}</div>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-mute">— Sin empresas en el mismo domicilio detectadas.</p>
          )}
        </article>
      </div>

      {/* BANDERAS DE RED */}
      {banderas.length > 0 && (
        <div className="border-t border-line bg-crimson-soft px-5 py-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-rust">
            <ShieldAlert size={11} className="mr-1 inline" />
            Banderas detectadas en la red ({banderas.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {banderas.map((b: any, i: number) => (
              <li key={i} className="rounded-md bg-paper px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                    b.severidad === "alta"  ? "bg-rust text-paper" :
                    b.severidad === "media" ? "bg-amber text-paper" :
                                              "bg-paperDeep text-mute",
                  )}>● {b.severidad || "media"}</span>
                  <strong className="text-sm text-ink">{b.titulo}</strong>
                </div>
                <p className="mt-1 text-xs text-inkSoft">{b.descripcion}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}


// ════════════════════════════════════════════════════════════════════
// EstructuraEntidadSection — autoridades electas + funcionarios designados
// (Capa 2 + Capa 3 de la red).
// ════════════════════════════════════════════════════════════════════

function EstructuraEntidadSection({
  autoridades, entityPersonnel, entidad,
}: { autoridades?: any; entityPersonnel?: any; entidad?: any }) {
  const a = autoridades || {};
  const ep = entityPersonnel || {};
  const funcionarios: any[] = ep.funcionarios_designados || [];
  const resoluciones: any[] = ep.resoluciones_designacion || [];

  const alcaldeP = a.alcalde_provincial_actual;
  const alcaldeD = a.alcalde_distrital_actual;
  const gobernador = a.gobernador_regional_actual;
  const regidores: any[] = a.regidores_provinciales || [];

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Network size={11} className="mr-1 inline" />
          Estructura de la entidad contratante
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          ¿Quién dirige y firma en {entidad?.nombre || a.entidad_consultada || "esta entidad"}?
        </h2>
        <p className="mt-1 text-xs text-mute">
          Capa 2 (autoridades electas vía JNE) + Capa 3 (gerentes designados de
          confianza) — quienes toman las decisiones de contratación pública en
          el período actual.
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* AUTORIDADES ELECTAS — Capa 2 */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            🗳️ Autoridades electas (período 2023-2026)
          </h3>
          {!alcaldeP && !alcaldeD && !gobernador && regidores.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              No se identificaron autoridades electas para esta región en el JNE.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-[12px]">
              {alcaldeP && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-rust/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-rust">
                      Alcalde Provincial
                    </span>
                    <strong className="text-ink">{alcaldeP.nombre}</strong>
                  </div>
                  <div className="mt-0.5 text-[11px] text-inkSoft">
                    {alcaldeP.partido} · electo {alcaldeP.año_eleccion} · {alcaldeP.provincia}
                  </div>
                  {alcaldeP.fuente_url && (
                    <a href={alcaldeP.fuente_url} target="_blank" rel="noreferrer"
                       className="mt-1 inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                      <ExternalLink size={9} /> Fuente JNE
                    </a>
                  )}
                </li>
              )}
              {alcaldeD && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-amber/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber">
                      Alcalde Distrital
                    </span>
                    <strong className="text-ink">{alcaldeD.nombre}</strong>
                  </div>
                  <div className="mt-0.5 text-[11px] text-inkSoft">
                    {alcaldeD.partido} · electo {alcaldeD.año_eleccion} · {alcaldeD.distrito}
                  </div>
                </li>
              )}
              {gobernador && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-clay/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-clay">
                      Gobernador Regional
                    </span>
                    <strong className="text-ink">{gobernador.nombre}</strong>
                  </div>
                  <div className="mt-0.5 text-[11px] text-inkSoft">
                    {gobernador.partido} · electo {gobernador.año_eleccion} · {gobernador.region}
                  </div>
                </li>
              )}
              {regidores.length > 0 && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-mute">
                    Regidores ({regidores.length})
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {regidores.map((r, i) => (
                      <li key={i} className="text-[11px] text-ink">
                        <strong>{r.nombre}</strong>
                        {r.partido && <span className="ml-1 text-inkSoft italic">— {r.partido}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          )}
        </article>

        {/* FUNCIONARIOS DESIGNADOS — Capa 3 */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            👔 Funcionarios designados de confianza
          </h3>
          {funcionarios.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              {ep.sin_data_publica
                ? "La entidad no publica su directorio en portal de transparencia."
                : "Aún no se identificaron gerentes designados. El sub-agente entity_personnel_agent investiga vía El Peruano + portal transparencia."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-[12px]">
              {funcionarios.map((f, i) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-moss/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-moss">
                      {f.cargo || "Funcionario"}
                    </span>
                    {f.vigente && (
                      <span className="rounded-full bg-clay/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-clay">
                        vigente
                      </span>
                    )}
                  </div>
                  <strong className="mt-0.5 block text-ink">{f.nombre_completo}</strong>
                  {f.area && (
                    <div className="text-[11px] text-inkSoft">{f.area}</div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-mute">
                    {f.fecha_designacion && (
                      <span>📅 designado {f.fecha_designacion}</span>
                    )}
                    {f.acto_resolutivo && (
                      <span>📄 {f.acto_resolutivo}</span>
                    )}
                    {f.fuente_url && (
                      <a href={f.fuente_url} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-0.5 text-clay hover:underline">
                        <ExternalLink size={9} /> Fuente
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {resoluciones.length > 0 && (
            <details className="mt-3 border-t border-line pt-2">
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-mute hover:text-ink">
                Resoluciones de designación ({resoluciones.length})
              </summary>
              <ul className="mt-2 space-y-1 text-[11px]">
                {resoluciones.map((r, i) => (
                  <li key={i} className="text-ink">
                    <strong className="font-mono">{r.numero}</strong>
                    {r.fecha && <span className="ml-1 text-mute">({r.fecha})</span>}
                    {r.objeto && <span className="ml-1 italic text-inkSoft">— {r.objeto}</span>}
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer"
                         className="ml-1 text-clay hover:underline">
                        <ExternalLink size={9} className="inline" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {ep.observaciones && (
            <p className="mt-2 border-t border-line pt-2 text-[11px] italic text-mute">
              {ep.observaciones}
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// CausalDirectaSection — detalle de causal Art. 27 + acto resolutivo
// ════════════════════════════════════════════════════════════════════

function CausalDirectaSection({
  causal, acto,
}: { causal?: any; acto?: any }) {
  if (!causal?.match) return null;
  const tieneActo = acto?.encontrado === true;
  const sevColor = tieneActo
    ? "bg-moss/10 text-moss border-moss/30"
    : "bg-rust/15 text-rust border-rust/40";

  return (
    <section className="surface overflow-hidden p-0">
      <div className={cn("border-b border-line px-5 py-3", "bg-paperDeep")}>
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Scale size={11} className="mr-1 inline" />
          Causal de Contratación Directa · Art. 27 TUO Ley 30225
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Lit. {causal.causal_letra?.toUpperCase()} — {causal.descripcion}
        </h2>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            Causal invocada
          </h3>
          <div className="mt-2 space-y-1.5 text-[12px]">
            <div className="rounded-md bg-paper px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Letra / Inciso</dt>
              <dd className="font-mono font-bold text-ink">Art. 27.1 lit. {causal.causal_letra}</dd>
            </div>
            <div className="rounded-md bg-paper px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Descripción</dt>
              <dd className="text-ink">{causal.descripcion}</dd>
            </div>
            {causal.evidencia_text && (
              <div className="rounded-md bg-paper px-2 py-1.5">
                <dt className="text-[9px] uppercase tracking-widest text-mute">Evidencia en el documento</dt>
                <dd className="italic text-inkSoft">"{causal.evidencia_text}"</dd>
              </div>
            )}
            <div className="rounded-md bg-paper px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">¿Requiere acto resolutivo?</dt>
              <dd className="font-bold text-ink">
                {causal.requiere_acto_resolutivo ? "SÍ (D.S./D.U./Resolución/Acuerdo Regional)" : "No"}
              </dd>
            </div>
          </div>
        </article>

        <article className={cn("rounded-md border p-4", sevColor)}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest">
            Acto resolutivo que la sustenta
          </h3>
          {tieneActo ? (
            <div className="mt-2 space-y-1.5 text-[12px]">
              <div className="rounded-md bg-paper px-2 py-1.5">
                <dt className="text-[9px] uppercase tracking-widest text-mute">Tipo</dt>
                <dd className="font-bold text-ink">{acto.tipo}</dd>
              </div>
              <div className="rounded-md bg-paper px-2 py-1.5">
                <dt className="text-[9px] uppercase tracking-widest text-mute">Número</dt>
                <dd className="font-mono font-bold text-ink">{acto.numero}</dd>
              </div>
              {acto.fecha_proxima && (
                <div className="rounded-md bg-paper px-2 py-1.5">
                  <dt className="text-[9px] uppercase tracking-widest text-mute">Fecha aproximada</dt>
                  <dd className="font-mono text-ink">{acto.fecha_proxima}</dd>
                </div>
              )}
              {acto.fragmento && (
                <div className="rounded-md bg-paper px-2 py-1.5">
                  <dt className="text-[9px] uppercase tracking-widest text-mute">Fragmento del documento</dt>
                  <dd className="italic text-inkSoft text-[11px]">"{acto.fragmento}"</dd>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[12px] font-bold">
                ⚠ No se ubicó el acto resolutivo que declara la situación.
              </p>
              <p className="text-[11px] italic">
                {acto?.motivo || "Los documentos publicados no mencionan número de D.S./D.U./Resolución/Acuerdo Regional/Ordenanza que sustente esta causal."}
              </p>
              <p className="border-t border-line pt-2 text-[10px]">
                <strong>Norma:</strong> Art. 27.1 lit. a TUO Ley 30225 — la situación de
                emergencia debe estar acreditada por declaratoria oficial.
              </p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// NoticiasSection — timeline de cobertura periodística
// ════════════════════════════════════════════════════════════════════

function NoticiasSection({ news }: { news: any }) {
  const noticias: any[] = news?.noticias || [];
  const banderasPrensa: any[] = news?.banderas_prensa || [];
  const sintesis = news?.resumen_ejecutivo || "";
  const sinMenciones = !!news?.sin_menciones_relevantes;
  const porSeveridad = news?.noticias_por_severidad || {};
  const porActor = news?.noticias_por_actor || {};

  // Ordenar por fecha desc
  const ordenadas = [...noticias].sort((a, b) => {
    const fa = String(a?.fecha || "0000-00-00");
    const fb = String(b?.fecha || "0000-00-00");
    return fb.localeCompare(fa);
  });

  const sevColor = (s: string) =>
    s === "alta"  ? "bg-rust text-paper" :
    s === "media" ? "bg-amber text-paper" :
    s === "baja"  ? "bg-paperDeep text-mute" :
                    "bg-paperSoft text-mute";

  const catLabel: Record<string, string> = {
    corrupcion: "Corrupción",
    sancion: "Sanción",
    denuncia: "Denuncia",
    investigacion: "Investigación",
    contraloria: "Contraloría",
    proyecto_publico: "Proyecto público",
    menciones_sin_riesgo: "Sin riesgo",
    prensa_general: "Prensa general",
  };

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
              <Eye size={11} className="mr-1 inline" />
              news_research_agent · cobertura periodística
            </div>
            <h2 className="mt-1 font-serif text-xl font-bold text-ink">
              Noticias y prensa
            </h2>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1 text-[10px]">
            {porSeveridad.alta > 0 && (
              <span className="rounded-full bg-rust px-2 py-0.5 font-bold text-paper">
                {porSeveridad.alta} alta
              </span>
            )}
            {porSeveridad.media > 0 && (
              <span className="rounded-full bg-amber px-2 py-0.5 font-bold text-paper">
                {porSeveridad.media} media
              </span>
            )}
            {porSeveridad.baja > 0 && (
              <span className="rounded-full bg-paperSoft px-2 py-0.5 font-bold text-mute">
                {porSeveridad.baja} baja
              </span>
            )}
            {porSeveridad.info > 0 && (
              <span className="rounded-full bg-paperSoft px-2 py-0.5 font-bold text-mute">
                {porSeveridad.info} info
              </span>
            )}
          </div>
        </div>
        {sintesis && (
          <p className="mt-2 text-sm leading-relaxed text-inkSoft">{sintesis}</p>
        )}
      </div>

      {/* Banderas de prensa */}
      {banderasPrensa.length > 0 && (
        <div className="border-b border-line bg-crimson-soft px-5 py-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-rust">
            <ShieldAlert size={11} className="mr-1 inline" />
            Banderas en prensa ({banderasPrensa.length})
          </h3>
          <ul className="mt-2 space-y-1.5">
            {banderasPrensa.map((b: any, i: number) => (
              <li key={i} className="rounded-md bg-paper px-3 py-2 text-xs">
                <div className="flex items-baseline gap-2">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                    sevColor(b.severidad),
                  )}>● {b.severidad || "media"}</span>
                  <strong className="text-ink">{b.titulo}</strong>
                </div>
                <p className="mt-1 text-inkSoft">{b.descripcion}</p>
                {b.url && (
                  <a href={b.url} target="_blank" rel="noreferrer"
                     className="mt-1 inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                    Abrir nota <ExternalLink size={9} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Timeline de noticias — vertical con dots y línea conectora */}
      {sinMenciones || ordenadas.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-mute">
          <Eye size={20} className="mx-auto mb-2 text-mute opacity-50" />
          {news?.resumen_ejecutivo
            ? news.resumen_ejecutivo
            : "Sin menciones relevantes en prensa peruana para los actores investigados."}
          <p className="mt-2 text-[11px] text-mute">
            La ausencia de cobertura no implica ausencia de riesgo — solo significa que no hubo notas
            indexadas sobre estos actores en el período consultado.
          </p>
        </div>
      ) : (
        <ol className="relative ml-5 py-4 before:absolute before:left-3 before:top-0 before:h-full before:w-px before:bg-line">
          {ordenadas.map((n, i) => {
            const dotColor =
              n.severidad === "alta"  ? "bg-rust" :
              n.severidad === "media" ? "bg-amber" :
              n.severidad === "baja"  ? "bg-paperDeep" : "bg-clay";
            return (
              <li key={i} className="relative pl-10 pr-5 pb-5">
                {/* dot del timeline */}
                <span className={cn(
                  "absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full ring-4 ring-paper",
                  dotColor,
                )}>
                  <Calendar size={10} className="text-paper" />
                </span>
                <div className="rounded-lg border border-line bg-paperSoft p-3 hover:border-clay transition-colors">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[10px] text-mute">
                      {n.fecha || "fecha N/D"}
                    </span>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                      sevColor(n.severidad),
                    )}>● {n.severidad || "info"}</span>
                    {n.categoria && (
                      <span className="rounded-md bg-paperDeep px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-mute">
                        {catLabel[n.categoria] || n.categoria}
                      </span>
                    )}
                    {n.fuente && (
                      <span className="ml-auto font-bold text-clay text-[11px]">{n.fuente}</span>
                    )}
                  </div>
                  {n.titulo && (
                    <h3 className="mt-2 text-sm font-bold leading-snug text-ink">
                      {n.titulo}
                    </h3>
                  )}
                  <p className="mt-1 text-xs leading-relaxed text-inkSoft">{n.resumen}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                    {n.actor_principal && (
                      <span className="rounded-md bg-paper px-2 py-0.5 text-mute">
                        sobre <strong className="text-ink">{n.actor_principal}</strong>
                      </span>
                    )}
                    {n.url && (
                      <a href={n.url} target="_blank" rel="noreferrer"
                         className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-clay px-3 py-1 text-[10px] font-bold text-paper hover:bg-clay/80">
                        Abrir nota <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Desglose por actor */}
      {Object.keys(porActor).length > 0 && (
        <div className="border-t border-line bg-paperSoft px-5 py-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">
            Cobertura por actor
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {Object.entries(porActor).map(([actor, n]: any) => (
              <span key={actor}
                    className="inline-flex items-center gap-1.5 rounded-md bg-paper px-2 py-0.5 text-[11px] text-ink">
                <strong>{actor}</strong>
                <span className="font-mono text-mute">×{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
