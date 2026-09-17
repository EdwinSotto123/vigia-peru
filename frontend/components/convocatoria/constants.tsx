"use client";

// Constantes visuales compartidas por los componentes de convocatoria/ (extraído de
// ConvocatoriaSearch.tsx): mapas de color/emoji/label por estado, ids de agentes, etc.
import {
  Sparkles, ScanSearch, FileText, Receipt, Globe2, Search, Download, AlertTriangle,
  Scale, Building2, Globe, Newspaper, Network, ListChecks, Pen,
} from "lucide-react";
import type { CatFilter } from "./types";

export const CAT_LABEL: Record<CatFilter, string> = {
  todas: "Todas",
  bienes: "Bienes",
  servicios: "Servicios",
  obras: "Obras",
  consultoria: "Consultoría",
};

// Color de acento por categoría (tipo etiqueta sólida, no emoji)
export const CAT_TONE: Record<CatFilter, string> = {
  todas:       "bg-ink",
  bienes:      "bg-clay",
  servicios:   "bg-amber",
  obras:       "bg-rust",
  consultoria: "bg-moss",
};

// Metadata por nodo del grafo: etiqueta corta, emoji, frase pública en vivo y fase.
export const NODE_META: Record<string, { short: string; emoji: string; phrase: string }> = {
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

export const PHASE_HEX: Record<string, string> = {
  "ingesta": "#b9770c", "auditoría": "#a8442a", "investigación": "#8a6d3b", "dictamen": "#4f7d3a",
};

export const AGENT_IDS = ["compliance", "parser", "legal", "market", "web", "news", "person", "entity", "extended", "writer"];

export const G_COLOR: Record<string, { fill: string; stroke: string; text: string }> = {
  orch:  { fill: "#fffdf7", stroke: "#6d4ec9", text: "#4a3a8c" },
  agent: { fill: "#fffdf7", stroke: "#3f7a3a", text: "#2f5e2c" },
  src:   { fill: "#fffdf7", stroke: "#b07a12", text: "#7a530b" },
  store: { fill: "#fffdf7", stroke: "#b03b6e", text: "#7e2a4d" },
};

export const G_DONE = { fill: "#e9f3e6", stroke: "#3f7a3a", text: "#2f5e2c" }; // verde "completado"

export const G_FLOW = "#16b85a"; // verde vivo: arista con intercambio de info ACTIVO

export const TYPE_LABEL: Record<string, string> = { orch: "Núcleo", agent: "Agente", src: "Fuente", store: "Persistencia" };

export const TRACE_ROLE: Record<string, string> = {
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

export const VERB_HEX: Record<string, string> = { delega: "#5b51c9", invoca: "#2f8f86", consulta: "#3b8bd4", persiste: "#ba7517" };

// Mapeo visual de cada agente
export const AGENT_VISUAL: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  vigia_orchestrator:    { color: "bg-ink text-paper",          icon: <Sparkles size={11} />,      label: "Orquestador" },
  pipeline:              { color: "bg-ink text-paper",          icon: <Sparkles size={11} />,      label: "Orquestador" },
  orquestador:           { color: "bg-ink text-paper",          icon: <Sparkles size={11} />,      label: "Orquestador" },
  compliance_agent:      { color: "bg-amber text-paper",        icon: <ScanSearch size={11} />,    label: "Compliance" },
  document_parser_agent: { color: "bg-clay text-paper",         icon: <FileText size={11} />,      label: "Doc Parser" },
  document_legal_analyst_agent: { color: "bg-clay text-paper",  icon: <ScanSearch size={11} />,    label: "Análisis Legal" },
  market_price_agent:    { color: "bg-rust text-paper",         icon: <Receipt size={11} />,       label: "Market Price" },
  web_research_agent:    { color: "bg-amber-soft text-amber",   icon: <Globe2 size={11} />,        label: "Web Research" },
  news_research_agent:   { color: "bg-amber-soft text-amber",   icon: <Globe2 size={11} />,        label: "Prensa" },
  entity_personnel_agent:{ color: "bg-amber text-paper",        icon: <ScanSearch size={11} />,    label: "Funcionarios" },
  person_network_agent:  { color: "bg-clay text-paper",         icon: <ScanSearch size={11} />,    label: "Red de Personas" },
  compliance_extended_agent: { color: "bg-amber text-paper",    icon: <ScanSearch size={11} />,    label: "Compliance+" },
  report_writer_agent:   { color: "bg-moss text-paper",         icon: <FileText size={11} />,      label: "Report Writer" },
};

// Qué hace cada tool / regla / agente — alimenta el botón de info (ⓘ) del tracking.
// Cubre TODAS las tools del pipeline (OCDS, documentos, mercado, proveedor, personas,
// reglas de compliance, RAG legal, persistencia) + los agentes (para los `transfer`).
export const TOOL_INFO: Record<string, string> = {
  // ── OCDS / registro ──
  fetch_ocds_record: "Trae el registro OCDS oficial del proceso desde el portal OECE (objeto, ítems, montos, postores, adjudicación).",
  register_convocatoria_in_db: "Registra la convocatoria y sus ítems del OCDS en la base de datos de Vigía.",
  // ── Documentos ──
  list_documents: "Lista los documentos publicados del expediente (Bases, Acta de Buena Pro, Contrato, Resumen Ejecutivo…).",
  parse_document_pdf: "Descarga el documento, hace OCR con Document AI y extrae los ítems con sus especificaciones técnicas del REQUERIMIENTO (la Bases).",
  read_document_analysis: "Lee la extracción estructurada del documento (ítems, firmantes, comité, motivos) para que otros agentes la usen.",
  persist_doc_flags_as_banderas: "Guarda como banderas las observaciones legales del documento (las emite el analista legal).",
  // ── Mercado ──
  build_market_input: "Arma la lista de ítems a tasar combinando los del OCDS (cantidad/precio) con las specs extraídas de la Bases.",
  list_items_for_pricing: "Lista los ítems de la convocatoria que necesitan validación de precio.",
  read_market_input: "Lee la lista de ítems ya preparada para el análisis de mercado.",
  analyze_market_sharded: "Tasa cada ítem contra el mercado real (Google Search en paralelo, por chunks) y detecta sobreprecios.",
  record_market_finding: "Registra el resultado de tasación de un ítem (mediana, rango, referencias, veredicto).",
  analyze_postores_pattern: "Analiza el patrón de postores: direcciones compartidas, co-ocurrencia y posibles consorcios coordinados.",
  persist_market_flags_as_banderas: "Guarda como banderas los sobreprecios detectados en el análisis de mercado.",
  // ── Proveedor / SUNAT / RNP ──
  get_ganador: "Identifica al proveedor ganador, los postores y la entidad contratante.",
  query_oece_perfil: "Consulta el perfil OECE del proveedor (historial de contratos con el Estado y señales).",
  query_sunat_decolecta: "Consulta SUNAT (vía decolecta): RUC, estado, antigüedad, CIIU y representante legal.",
  query_edad_ciiu_web: "Busca en web la edad del RUC y el CIIU cuando SUNAT no responde (fallback).",
  read_sunat_profile: "Lee el perfil SUNAT ya cargado en el análisis.",
  query_rnp_empresa: "Consulta el RNP: socios, representantes legales y órganos de administración de la empresa.",
  query_rnp_persona: "Consulta el RNP por persona: en qué empresas figura como socio o representante.",
  detect_estado_real: "Verifica el estado REAL de un RUC/persona (activo, baja, suspendido) frente a lo declarado.",
  // ── Personas / red ──
  batch_person_lookup: "Cruza un lote de personas (DNI/nombre) contra las bases de Vigía (PEP, aportes ONPE, cargos públicos, candidaturas).",
  query_pep: "Verifica si una persona es PEP (Persona Expuesta Políticamente).",
  query_onpe_aportantes: "Consulta ONPE: aportes de campaña de la persona/empresa a partidos políticos.",
  query_jne_candidaturas: "Consulta JNE: candidaturas y hojas de vida de la persona.",
  scrape_jne_hoja_vida: "Extrae la hoja de vida de un candidato desde el portal del JNE.",
  query_autoridades_entidad: "Consulta las autoridades electas y funcionarios designados de la entidad contratante.",
  query_visitas_de_persona: "Consulta el registro de visitas oficiales de una persona (gestión de intereses / lobby).",
  read_person_network_context: "Arma el contexto de la red de personas (socios, firmantes, autoridades) para el análisis.",
  detect_puerta_giratoria: "Detecta puerta giratoria: si el titular de la empresa ocupó un cargo público en la entidad que lo contrató.",
  detect_aporte_a_partido_del_alcalde: "Detecta si el proveedor aportó a la campaña del alcalde/partido que gobierna la entidad (cruce C3).",
  // ── Reglas de compliance (verifican una condición; si se cumple, emiten una señal de
  //    riesgo — NO una acusación). Redactadas como "Verifica si…", no como afirmación. ──
  check_unique_bidder_rule: "Verifica si el proceso tuvo UN solo postor donde la norma esperaría competencia (cruce C2).",
  check_postor_unico_mayoritario_rule: "Verifica si hubo un único postor que ganó al ≥95% del valor referencial (sin competencia efectiva).",
  check_edad_ruc_ganador_rule: "Verifica si la empresa ganadora tiene un RUC reciente en relación al monto del contrato.",
  check_ruc_ultra_nuevo_rule: "Verifica si el RUC del ganador tiene <90 días de antigüedad ganando un contrato grande (cruce C1, modelo Funes).",
  check_sanctioned_provider_rule: "Verifica si el ganador tiene una sanción o inhabilitación vigente para contratar con el Estado (Art. 50 TUO Ley 30225).",
  check_ciiu_vs_objeto_rule: "Verifica si el giro (CIIU) del proveedor corresponde al objeto de lo que se adquiere.",
  check_directa_fundamento_rule: "Verifica si la contratación directa tiene una causal/fundamento legal válido acreditado (Art. 27 Ley 30225).",
  check_plazo_convocatoria_rule: "Verifica si el plazo entre la convocatoria y la presentación de ofertas cumple el mínimo legal.",
  check_non_competitive_process_rule: "Verifica si el proceso fue adjudicado sin competencia real (directa / único postor).",
  check_tipo_proceso_vs_monto_rule: "Verifica si el tipo de proceso corresponde al monto (descarta fraccionamiento o elusión de un proceso mayor).",
  check_concentracion_entidad_rule: "Verifica si el proveedor concentra una proporción anómala de las adjudicaciones de la entidad.",
  check_recurrencia_firmante_rule: "Verifica si el mismo funcionario firma de forma recurrente las adjudicaciones al mismo proveedor.",
  check_inconsistencia_doc_vs_ocds_rule: "Verifica si hay incongruencia entre el documento parseado y el OCDS (objeto/ítems no coinciden o la extracción falló).",
  check_testaferro_multi_ruc_rule: "Verifica si una misma persona figura en múltiples RUCs/empresas postoras (posible testaferro o consorcio encubierto).",
  check_lobby_visits_rule: "Verifica si hubo visitas de gestión de intereses (lobby) del proveedor a la entidad antes de la adjudicación.",
  // ── Legal / RAG ──
  evaluate_normative_compliance: "Cruza cada hallazgo contra el corpus de opiniones jurídicas del OECE (RAG) para citar jurisprudencia administrativa.",
  query_legal_rag: "Busca en el corpus de opiniones jurídicas del OECE la doctrina relevante para un hallazgo.",
  lookup_opinion_oece: "Recupera el texto de una opinión jurídica específica del OECE por su número.",
  // ── Contexto / persistencia ──
  add_contextual_flag: "Registra una bandera de riesgo contextual detectada por un agente (capacidad, conflicto, señal OECE).",
  get_alerta_full_context: "Reúne todo el contexto persistido de la alerta para un agente.",
  get_dictamen_context: "Reúne todo el análisis (ítems, mercado, red, normativa) para que el redactor escriba el dictamen.",
  persist_alert_from_flags: "Consolida todas las banderas detectadas en la alerta final.",
  persist_analysis_outputs: "Guarda el análisis completo (todas las secciones + el dictamen) en la base de datos.",
  // ── Grounding ──
  google_search: "Búsqueda en vivo en Google (grounding de Gemini) sobre la empresa, funcionarios, prensa o precios de mercado.",
  // ── Agentes (eventos `transfer`) ──
  orch: "Orquestador: ejecuta la secuencia fija de agentes del pipeline desde el código (determinista, no se rinde).",
  compliance_agent: "Evalúa las reglas duras (sanción, único postor, edad RUC) y crea la alerta base.",
  document_parser_agent: "Procesa los documentos del expediente: OCR (Document AI) + extracción de ítems y specs de la Bases.",
  document_legal_analyst_agent: "Analiza legalmente el requerimiento y emite banderas documentales citando la norma/opinión OECE.",
  market_price_agent: "Tasa los ítems contra el mercado real (Google Search) y detecta sobreprecios.",
  web_research_agent: "Investiga en web a la empresa ganadora: prensa, sanciones, directivos, aportes ONPE e historial de contratos.",
  news_research_agent: "Busca cobertura de prensa peruana sobre el proveedor, la entidad y el objeto de la contratación.",
  entity_personnel_agent: "Descubre los funcionarios designados de la entidad contratante (con su acto resolutivo).",
  person_network_agent: "Mapea la red de personas: socios, representantes, firmantes, autoridades y los vínculos entre ellos.",
  compliance_extended_agent: "Corre los chequeos normativos extendidos (12 reglas) + las banderas de juicio y prepara el cruce RAG.",
  report_writer_agent: "Redacta el dictamen final con el análisis consolidado y las citas normativas del OECE.",
};

export const VEREDICTO_VISUAL: Record<string, { color: string; bg: string; emoji: string; label: string }> = {
  alineado:      { color: "text-moss",  bg: "bg-moss/10 border-moss/30",   emoji: "🟢", label: "ALINEADO" },
  elevado:       { color: "text-amber", bg: "bg-amber-soft border-amber/40", emoji: "🟠", label: "ELEVADO" },
  muy_elevado:   { color: "text-rust",  bg: "bg-crimson-soft border-rust/40", emoji: "🔴", label: "MUY ELEVADO" },
  barato:        { color: "text-clay",  bg: "bg-paperSoft border-line",     emoji: "🔵", label: "BARATO" },
  estimacion:    { color: "text-mute",  bg: "bg-paperDeep border-line",     emoji: "⚪", label: "ESTIMACIÓN" },
  sin_ofertado:  { color: "text-mute",  bg: "bg-paperSoft border-line",     emoji: "🔍", label: "S/ OFERTADO" },
  // El backend ya corrió el juez de plausibilidad y decidió que el lote NO es comparable
  // (cobertura insuficiente frente al total de ítems reales, o una comparación implausible);
  // antes caía en el "⚪ ESTIMACIÓN" genérico y se perdía esa distinción.
  no_verificable: { color: "text-clay", bg: "bg-paperSoft border-clay/30", emoji: "🚫", label: "NO VERIFICABLE" },
};

export const AGENTE_VISUAL: Record<string, { label: string; chipClass: string; iconClass: string }> = {
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

export const FUENTE_GROUPS = [
  { label: "Empresas",     keys: ["empresas"] },
  { label: "Sanciones",    keys: ["sanciones"] },
  { label: "Prensa",       keys: ["prensa"] },
  { label: "Política",     keys: ["politica"] },
  { label: "Justicia",     keys: ["justicia"] },
  { label: "Funcionarios", keys: ["funcionarios"] },
  { label: "Obras",        keys: ["obras"] },
  { label: "Contratos",    keys: ["contratos"] },
];

// STEPS del pipeline real — 13 nodos del BPMN.
// `eta_s` es el tiempo estimado en segundos para AVANZAR al siguiente paso
// (basado en timing observado en runs reales, ≈ 9-10 min total). Total
// estimado: 638s ≈ 10.6 min. Si el run termina antes, el frontend salta al
// último paso. Si tarda más, el último paso queda "active" hasta llegar.
export const STEPS = [
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

// Mapea tool/transfer/phase a la key de STEP. Usa el último evento "fuerte"
// del stream para inferir en qué paso del BPMN estamos realmente.
export const STEP_KEY_BY_TOOL: Array<{ rx: RegExp; key: string }> = [
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
export const STEP_KEY_BY_AGENT: Array<{ rx: RegExp; key: string }> = [
  { rx: /document_parser/i,         key: "parser" },
  { rx: /document_legal_analyst/i,  key: "legal" },
  { rx: /compliance/i,              key: "compliance" },
  { rx: /market_price/i,            key: "market" },
  { rx: /web_research/i,            key: "web" },
  { rx: /news_research/i,           key: "news" },
  { rx: /person_network/i,          key: "rnp" },
  { rx: /report_writer/i,           key: "writer" },
];
