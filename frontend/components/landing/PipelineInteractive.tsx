"use client";

import { useState } from "react";
import {
  ChevronRight,
  Database,
  ShieldCheck,
  FileText,
  TrendingUp,
  Newspaper,
  Network,
  Scale,
  PenTool,
  Clock,
  Wrench,
  Info,
} from "lucide-react";

type ToolRef = {
  name: string;
  desc: string;
};

type Paso = {
  num: string;
  agent: string;
  icon: React.ReactNode;
  short: string;
  what: string;
  tools: ToolRef[];
  inputs: string[];
  outputs: string[];
  duration: string;
  model: string;
  color: "rust" | "clay" | "amber" | "moss" | "ink";
};

const PASOS: Paso[] = [
  {
    num: "01",
    agent: "Orchestrator",
    icon: <Database size={15} />,
    short: "Descarga la convocatoria del SEACE",
    what: "El agente raíz arranca todo. Descarga el OCDS oficial del portal OECE, lo normaliza y guarda la convocatoria, los ítems y los postores en la base de datos. Es quien decide qué sub-agente delegar en cada paso siguiente.",
    tools: [
      { name: "fetch_ocds_record", desc: "Baja el registro OCDS 1.1 del portal Contrataciones Abiertas OECE para el OCID dado." },
      { name: "register_convocatoria_in_db", desc: "Inserta convocatoria, ítems y postores en Cloud SQL, normalizando el OCID al formato corto." },
    ],
    inputs: ["Código OCID de SEACE"],
    outputs: ["Convocatoria + ítems + postores en BD"],
    duration: "5-10 s",
    model: "Gemini 2.5 Pro",
    color: "ink",
  },
  {
    num: "02",
    agent: "Compliance",
    icon: <ShieldCheck size={15} />,
    short: "Aplica las 5 reglas duras iniciales",
    what: "Corre comprobaciones deterministas en SQL: detecta postores únicos al 99%+ del valor referencial, ganadores con sanción OSCE vigente, procesos no competitivos y patrones de adjudicación sospechosos. Cada bandera cita el artículo de ley específico.",
    tools: [
      { name: "check_unique_bidder_rule", desc: "Detecta procesos con un único postor cuya oferta está al 95-100% del valor referencial." },
      { name: "check_sanctioned_provider_rule", desc: "Cruza el RUC ganador contra el registro OSCE de inhabilitados vigentes." },
      { name: "check_non_competitive_process_rule", desc: "Identifica contrataciones directas que deberían haber sido procesos competitivos." },
      { name: "detect_estado_real", desc: "Determina si la convocatoria sigue activa, quedó desierta, fue anulada o tiene contrato firmado." },
      { name: "analyze_postores_pattern", desc: "Analiza el patrón histórico de postores: concentración, recurrencia, vínculos entre RUCs." },
    ],
    inputs: ["Datos de convocatoria + postores"],
    outputs: ["Banderas iniciales con norma citada"],
    duration: "10-20 s",
    model: "Gemini 2.5 Flash",
    color: "rust",
  },
  {
    num: "03",
    agent: "Document Parser",
    icon: <FileText size={15} />,
    short: "Lee bases, actas y resoluciones del expediente",
    what: "Un modelo multimodal lee los PDFs del expediente SEACE. Extrae los ítems con sus requerimientos técnicos, los firmantes con DNI, el comité de evaluación, los motivos de adjudicación y el fundamento legal. Aplica un filtro anti-alucinación que descarta firmantes inventados.",
    tools: [
      { name: "parse_document_pdf", desc: "Procesa un PDF del expediente con Gemini multimodal y extrae datos estructurados." },
      { name: "persist_doc_flags_as_banderas", desc: "Guarda como banderas las irregularidades documentales encontradas (firmas faltantes, fechas incongruentes, etc)." },
    ],
    inputs: ["PDFs del expediente SEACE"],
    outputs: ["Ítems + firmantes + comité + fundamento legal"],
    duration: "30-60 s",
    model: "Gemini 2.5 Pro multimodal",
    color: "clay",
  },
  {
    num: "04",
    agent: "Market Price",
    icon: <TrendingUp size={15} />,
    short: "Compara precios contra el mercado real",
    what: "Por cada ítem extraído del expediente busca el precio en 8+ portales (mercado peruano, internacional, sitios oficiales del fabricante). Aplica factor mayorista por volumen y detecta especificaciones restrictivas que excluyen competencia.",
    tools: [
      { name: "build_market_input", desc: "Arma el JSON estructurado de ítems con specs para que el sub-agente de precios lo procese." },
      { name: "read_market_input", desc: "Pre-carga los ítems al state para el sub-agente que solo tiene google_search." },
      { name: "market_price_agent (sub)", desc: "Sub-agente con google_search dedicado: compara precio referencial vs mercado para cada ítem." },
    ],
    inputs: ["Ítems con requerimiento técnico"],
    outputs: ["Sobrecosto · spec restrictiva · ratio mercado"],
    duration: "60-180 s",
    model: "Gemini 2.5 Pro",
    color: "amber",
  },
  {
    num: "05",
    agent: "Web + News",
    icon: <Newspaper size={15} />,
    short: "Cruza al ganador contra prensa peruana",
    what: "Dispara búsquedas dirigidas a sitios de periodismo de investigación (OjoPúblico, IDL Reporteros, Convoca, La República, El Comercio). Construye una timeline de cobertura del proveedor y la entidad contratante.",
    tools: [
      { name: "web_research_agent (sub)", desc: "Busca antecedentes del ganador: gerentes, sanciones, otros contratos." },
      { name: "news_research_agent (sub)", desc: "Indexa cobertura periodística sobre el caso, el RUC y la entidad." },
    ],
    inputs: ["RUC ganador + entidad + monto"],
    outputs: ["Antecedentes mediáticos con URLs"],
    duration: "45-90 s",
    model: "Gemini 2.5 Flash",
    color: "moss",
  },
  {
    num: "06",
    agent: "Person Network",
    icon: <Network size={15} />,
    short: "Mapea 5 capas de red por cada persona",
    what: "Por CADA persona del caso (titular, socios, firmantes, alcalde, gobernador, gerente municipal, designados de confianza) cruza en paralelo: aportes ONPE, candidaturas JNE, PEPs, visitas a entidades públicas y otras empresas en RNP. Detecta puerta giratoria y aportes al partido del firmante.",
    tools: [
      { name: "query_rnp_persona", desc: "Lista todas las empresas donde una persona figura como socio, representante u órgano admin (1.44M filas RNP)." },
      { name: "query_rnp_empresa", desc: "Lista los socios, representantes y órgano administrativo de un RUC dado." },
      { name: "query_onpe_aportantes", desc: "Aportes registrados a partidos políticos por persona/empresa (Portal Claridad ONPE)." },
      { name: "query_jne_candidaturas", desc: "Candidaturas electorales 2014-2022 por DNI (319K registros JNE)." },
      { name: "query_pep", desc: "Verifica si la persona figura como Políticamente Expuesta (PEP heurístico)." },
      { name: "query_visitas_de_persona", desc: "Visitas a entidades públicas registradas bajo Ley 28024 (Registro Único de Visitas)." },
      { name: "query_autoridades_entidad", desc: "Alcalde, gobernador, regidores vigentes de la entidad contratante (JNE período 2022-2026)." },
      { name: "detect_puerta_giratoria", desc: "Cruza al gerente actual con cargos públicos pasados en la misma entidad." },
      { name: "detect_aporte_a_partido_del_alcalde", desc: "Detecta si el ganador aportó al partido del alcalde firmante del contrato." },
      { name: "person_network_agent (sub)", desc: "Sub-agente OSINT que enriquece con búsquedas web los vínculos detectados." },
    ],
    inputs: ["DNIs y RUCs detectados en el caso"],
    outputs: ["Red empresarial + política + familiar"],
    duration: "120-300 s",
    model: "Gemini 2.5 Pro · paralelizado",
    color: "rust",
  },
  {
    num: "07",
    agent: "Compliance Extended",
    icon: <Scale size={15} />,
    short: "12 reglas + cruce con opiniones OECE",
    what: "Aplica las reglas que dependen de los datos enriquecidos: edad del RUC vs monto, congruencia rubro CIIU vs objeto, plazo mínimo legal de la convocatoria, lobby pre-buena-pro (Ley 28024), testaferros multi-RUC. Cada bandera se cruza contra 333 opiniones normativas OECE para citar la norma específica.",
    tools: [
      { name: "check_edad_ruc_ganador_rule", desc: "Alerta si el RUC se creó menos de 90 días antes de ganar un contrato significativo." },
      { name: "check_ciiu_vs_objeto_rule", desc: "Detecta incongruencia entre el rubro SUNAT del ganador y el objeto del contrato." },
      { name: "check_plazo_convocatoria_rule", desc: "Verifica que el plazo entre convocatoria y presentación cumpla el mínimo legal." },
      { name: "check_lobby_visits_rule", desc: "Detecta visitas del ganador a la entidad antes de la buena pro." },
      { name: "check_testaferro_multi_ruc_rule", desc: "Identifica titulares con múltiples RUCs activos creados en ráfaga." },
      { name: "evaluate_normative_compliance", desc: "Cruza todas las banderas contra el RAG de opiniones OECE para citar la norma exacta." },
    ],
    inputs: ["Todas las banderas acumuladas"],
    outputs: ["Score 0-100 + opinión OECE por bandera"],
    duration: "30-60 s",
    model: "Gemini 2.5 Flash",
    color: "clay",
  },
  {
    num: "08",
    agent: "Report Writer",
    icon: <PenTool size={15} />,
    short: "Redacta el dictamen periodístico final",
    what: "Toma el estado completo del análisis (mercado, documentos, web, prensa, red de personas, compliance) y produce un dictamen markdown de 3,000-6,000 palabras con 9 secciones: resumen ejecutivo, hechos, banderas con norma citada, precios, antecedentes, personas clave, prensa, lecturas alternativas y próximos pasos.",
    tools: [
      { name: "get_dictamen_context", desc: "Recupera todo el snapshot del análisis (state completo) para que el redactor lo ensamble." },
      { name: "query_legal_rag", desc: "Busca opiniones normativas OECE relevantes para citar como fundamento en el dictamen." },
      { name: "persist_analysis_outputs", desc: "Guarda el dictamen markdown + el JSON completo del análisis en alertas.analisis_full." },
    ],
    inputs: ["Estado completo del análisis"],
    outputs: ["Dictamen markdown + recomendación de derivación"],
    duration: "60-120 s",
    model: "Gemini 2.5 Pro",
    color: "amber",
  },
];

const COLOR_MAP = {
  rust: { bg: "bg-rust", text: "text-rust" },
  clay: { bg: "bg-clay", text: "text-clay" },
  amber: { bg: "bg-amber", text: "text-amber" },
  moss: { bg: "bg-moss", text: "text-moss" },
  ink: { bg: "bg-ink", text: "text-paper" },
};

export function PipelineInteractive() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [openTool, setOpenTool] = useState<string | null>(null);
  const active = PASOS[activeIdx];
  const color = COLOR_MAP[active.color];

  const selectPaso = (i: number) => {
    setActiveIdx(i);
    setOpenTool(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[240px,1fr]">
      {/* LISTA — izquierda */}
      <nav
        aria-label="Pasos del pipeline"
        className="space-y-1 lg:max-h-[440px] lg:overflow-y-auto lg:pr-1"
      >
        {PASOS.map((paso, i) => {
          const isActive = i === activeIdx;
          const c = COLOR_MAP[paso.color];
          return (
            <button
              key={paso.num}
              type="button"
              onClick={() => selectPaso(i)}
              className={
                "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all " +
                (isActive
                  ? "border border-paper/25 bg-paper/[0.08]"
                  : "border border-transparent hover:border-paper/15 hover:bg-paper/[0.04]")
              }
            >
              <span
                className={
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-paper transition-all " +
                  (isActive ? c.bg : "bg-paper/10 text-paper/65 group-hover:bg-paper/15")
                }
              >
                {paso.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={
                      "font-mono text-[9px] font-bold tracking-widest " +
                      (isActive ? "text-amber" : "text-paper/40")
                    }
                  >
                    {paso.num}
                  </span>
                  <span
                    className={
                      "font-serif text-[13px] font-bold leading-tight " +
                      (isActive ? "text-paper" : "text-paper/75")
                    }
                  >
                    {paso.agent}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-paper/50">
                  {paso.short}
                </div>
              </div>
              <ChevronRight
                size={12}
                className={
                  "shrink-0 transition-all " +
                  (isActive ? "text-amber translate-x-0.5" : "text-paper/25")
                }
              />
            </button>
          );
        })}
      </nav>

      {/* DETALLE — derecha (compacto) */}
      <article
        key={activeIdx}
        className="relative animate-fadeInUp rounded-xl border border-paper/15 bg-paper/[0.04] backdrop-blur-sm"
      >
        <div className={"absolute inset-x-0 top-0 h-0.5 rounded-t-xl " + color.bg} />

        <div className="p-5 sm:p-6">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className={
                  "flex h-9 w-9 items-center justify-center rounded-lg text-paper " +
                  color.bg
                }
              >
                {active.icon}
              </span>
              <div>
                <div className="font-mono text-[9px] font-bold tracking-[0.2em] text-amber">
                  PASO {active.num}
                </div>
                <h3 className="font-serif text-xl font-bold leading-tight text-paper">
                  {active.agent}
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Pill icon={<Clock size={10} />}>{active.duration}</Pill>
              <Pill icon={<Wrench size={10} />}>{active.model}</Pill>
            </div>
          </div>

          {/* Descripción */}
          <p className="mt-3 text-[13px] leading-relaxed text-paper/75">
            {active.what}
          </p>

          {/* Grid: entradas / salidas */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber/80">
                Entrada
              </h4>
              <ul className="mt-1.5 space-y-0.5">
                {active.inputs.map((it, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-paper/75">
                    <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-amber" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber/80">
                Salida
              </h4>
              <ul className="mt-1.5 space-y-0.5">
                {active.outputs.map((it, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-paper/75">
                    <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-amber" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Tools con tooltip */}
          <div className="mt-4">
            <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber/80">
              Tools usadas · click para ver qué hace
            </h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.tools.map((t) => {
                const isOpen = openTool === t.name;
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => setOpenTool(isOpen ? null : t.name)}
                    className={
                      "group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] transition-colors " +
                      (isOpen
                        ? "border-amber/60 bg-amber/15 text-amber"
                        : "border-paper/15 bg-paper/[0.05] text-paper/70 hover:border-paper/30 hover:text-paper")
                    }
                  >
                    <Info size={10} className={isOpen ? "text-amber" : "text-paper/40"} />
                    {t.name}
                  </button>
                );
              })}
            </div>
            {openTool && (
              <div className="mt-2 animate-fadeInUp rounded-lg border border-amber/20 bg-amber/[0.06] p-3 text-[12px] leading-snug text-paper/85">
                <span className="font-mono text-[10px] font-bold text-amber">
                  {openTool}
                </span>
                <span className="ml-2 text-paper/80">
                  {active.tools.find((t) => t.name === openTool)?.desc}
                </span>
              </div>
            )}
          </div>

          {/* Nav inferior */}
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-paper/10 pt-3">
            <button
              type="button"
              disabled={activeIdx === 0}
              onClick={() => selectPaso(Math.max(0, activeIdx - 1))}
              className="inline-flex items-center gap-1 text-[11px] text-paper/60 transition-colors hover:text-paper disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={12} className="rotate-180" /> Anterior
            </button>
            <span className="font-mono text-[10px] text-paper/35">
              {String(activeIdx + 1).padStart(2, "0")} / {String(PASOS.length).padStart(2, "0")}
            </span>
            <button
              type="button"
              disabled={activeIdx === PASOS.length - 1}
              onClick={() => selectPaso(Math.min(PASOS.length - 1, activeIdx + 1))}
              className="inline-flex items-center gap-1 text-[11px] text-paper/60 transition-colors hover:text-paper disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Siguiente <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function Pill({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-paper/15 bg-paper/5 px-1.5 py-0.5 text-[9px] font-medium text-paper/65">
      {icon}
      {children}
    </span>
  );
}
