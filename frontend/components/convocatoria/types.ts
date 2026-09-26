// Tipos compartidos por los componentes de convocatoria/ (extraído de ConvocatoriaSearch.tsx).

export interface AgentTraceEvent {
  agent?: string;
  kind?: "tool_call" | "tool_result" | "transfer" | "thought" | "error";
  name?: string;
  args?: Record<string, any>;
  result_preview?: any;
  to?: string;
  text?: string;
  detail?: string;
}

export interface ApiResult {
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
    /** Desde 2026-09-26: tokens de entrada que salieron de caché (cobrados al 10 %). */
    tokens_cached?: number;
    /**
     * Desde 2026-09-26: TODAS las llamadas al modelo por etapa (agentes y llamadas directas como
     * extractor, mercado y jueces). `etapa` es el nombre del agente ADK o la etapa directa.
     */
    por_etapa?: { etapa: string; llamadas: number; entrada: number; cache: number; salida: number; razonamiento: number; costo_usd: number }[];
  };
  self_evals?: any;
  timing?: Record<string, number>;
  /**
   * La traza resumida (eventos, agentes, herramientas): el informe público llega SIN
   * `agent_trace`, `llm_metrics` ni `self_evals`, que se piden al abrir "Cómo se hizo".
   * Forma en `ResumenTraza` (./dossier); acá va sin tipo para no importar ese módulo.
   */
  traza_resumen?: { eventos: number; agentes: string[]; herramientas: string[] } | null;
  /**
   * El servidor dejó la traza afuera a propósito (lib/dossier-servidor.ts): "Cómo se hizo" la
   * pide al abrirse. Sin esta marca, una traza vacía quiere decir que el análisis no la guardó.
   */
  traza_perezosa?: boolean;
  _bridge_meta?: Record<string, any>;
  /**
   * Estado de publicación de la alerta (GET /alertas/:id/full). Una alerta frenada para
   * revisión humana llega sin score, señales ni dictamen: el dossier muestra "En revisión" y
   * nada más (ver dossierEnRevision en ./dossier).
   */
  estado?: string | null;
  enRevision?: boolean;
  publicada?: boolean;
  error?: string;
  hint?: string;
}

export type SortKey = "reciente" | "score" | "monto";

export type CatFilter = "todas" | "bienes" | "servicios" | "obras" | "consultoria";

// Qué hace cada nodo (para el click).
export interface GNode {
  id: string; label: string; sub?: string; name: string;
  type: "orch" | "agent" | "src" | "store"; r: number; desc: string;
  sources?: string[]; stores?: string[];
}

export interface TraceStep { f: string; t: string; v: string; m: string }

export type Bandera = {
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

export type GraphNode = {
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

export type GraphEdge = {
  from: string;
  to: string;
  kind: "titular" | "domicilio" | "candidato" | "aporte" | "cargo" | "contrato"
      | "pareja" | "autoridad" | "firma_conflicto"
      | "adjudicacion" | "preside_entidad" | "designado_por" | "conflicto_funcionario"
      | "trabaja_en" | "mismo_partido_que" | "partido_de"
      | "compitio" | "socio_de" | "visito" | "doble_vinculacion";
  label?: string;
};
