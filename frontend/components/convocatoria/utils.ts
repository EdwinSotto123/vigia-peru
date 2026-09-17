// Funciones puras compartidas por los componentes de convocatoria/ (extraído de
// ConvocatoriaSearch.tsx): inferencias sobre el stream de eventos y la traza del agente.
import type { CatFilter, TraceStep, Bandera } from "./types";
import { TRACE_ROLE, AGENTE_VISUAL, STEPS, STEP_KEY_BY_TOOL, STEP_KEY_BY_AGENT } from "./constants";

export function inferStepFromEvents(events: any[]): number {
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

export function oeceProcesoUrl(ocidOrCodigo: string | null | undefined): string {
  const s = String(ocidOrCodigo || "").trim();
  if (!s) return "https://contratacionesabiertas.oece.gob.pe/";
  const full = s.startsWith("ocds-") ? s : `ocds-dgv273-seacev3-${s.replace(/^OECE-/i, "")}`;
  return `https://contratacionesabiertas.oece.gob.pe/proceso/${full}`;
}

export function countFindings(events: any[]): number {
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

export function humanizeError(raw: string, errClass?: string): string {
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

export function inferCategoria(objeto: string | null | undefined): CatFilter {
  const o = (objeto || "").toLowerCase();
  if (/\b(obra|construcc|edif|carrete|pavimen|puente|infraestruc|reparaci[oó]n de|mejoramient)/i.test(o)) return "obras";
  if (/\b(consultor[ií]a|estudio|formulaci[oó]n|expediente t[eé]cnico)/i.test(o)) return "consultoria";
  if (/\b(servicio|mantenim|conservaci[oó]n|alquil|limpieza|seguridad|asesor|transporte|capacit)/i.test(o)) return "servicios";
  if (/\b(adquisici[oó]n|compra|suministr|provisi[oó]n|equip|veh[ií]culo|aliment|medicam|kit|tablet|laptop|insumo|repuest|bienes)/i.test(o)) return "bienes";
  return "todas";
}

export function extractFindings(events: any[]) {
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

export function traceNodeForAgent(name?: string): string | null {
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

export function rucArg(a: any): string {
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

export function buildTrace(events: any[]): TraceStep[] {
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

export function inferAgente(b: Bandera): string {
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

export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
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
