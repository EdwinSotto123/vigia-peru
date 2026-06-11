"use client";

import { useEffect, useState } from "react";
import {
  Database,
  ShieldCheck,
  FileText,
  Scale,
  TrendingUp,
  Globe2,
  Newspaper,
  Building2,
  Network,
  ListChecks,
  PenTool,
  ScanSearch,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Agent {
  id: string;
  nombre: string;
  rol: string;
  icon: LucideIcon;
  model: "pro" | "flash";
}

// Agentes reales del backend en producción (functions/agent-orchestrator-adk/agents.py)
const AGENTS: Agent[] = [
  {
    id: "orchestrator",
    nombre: "vigia_orchestrator",
    rol: "Coordina 10 sub-agentes y decide qué delegar en cada paso",
    icon: Database,
    model: "pro",
  },
  {
    id: "compliance",
    nombre: "compliance_agent",
    rol: "5 reglas duras iniciales con norma citada",
    icon: ShieldCheck,
    model: "flash",
  },
  {
    id: "doc_parser",
    nombre: "document_parser_agent",
    rol: "Gemini multimodal lee bases, actas y resoluciones",
    icon: FileText,
    model: "pro",
  },
  {
    id: "legal_analyst",
    nombre: "document_legal_analyst_agent",
    rol: "Analiza el documento contra Ley 32069 y opiniones OECE",
    icon: Scale,
    model: "pro",
  },
  {
    id: "market",
    nombre: "market_price_agent",
    rol: "Compara precio referencial vs mercado real con factor mayorista",
    icon: TrendingUp,
    model: "pro",
  },
  {
    id: "web",
    nombre: "web_research_agent",
    rol: "OSINT del ganador: gerentes, otros contratos, sanciones",
    icon: Globe2,
    model: "flash",
  },
  {
    id: "news",
    nombre: "news_research_agent",
    rol: "Cobertura periodística: OjoPúblico · IDL · Convoca · La República",
    icon: Newspaper,
    model: "flash",
  },
  {
    id: "personnel",
    nombre: "entity_personnel_agent",
    rol: "Capa 3: gerente municipal, procurador, jefe OCI vía El Peruano",
    icon: Building2,
    model: "flash",
  },
  {
    id: "network",
    nombre: "person_network_agent",
    rol: "5 capas de red: RNP · ONPE · JNE · PEPs · visitas",
    icon: Network,
    model: "pro",
  },
  {
    id: "compliance_ext",
    nombre: "compliance_extended_agent",
    rol: "12 reglas adicionales + cruce con 333 opiniones OECE (RAG)",
    icon: ListChecks,
    model: "flash",
  },
  {
    id: "report",
    nombre: "report_writer_agent",
    rol: "Redacta el dictamen markdown final con norma citada",
    icon: PenTool,
    model: "pro",
  },
];

const ACTIVITIES = [
  "vigia_orchestrator → fetch_ocds_record(1212841)…",
  "compliance_agent → check_unique_bidder_rule sobre OCID 1212841…",
  "document_parser_agent → parse_document_pdf bases técnicas…",
  "document_legal_analyst_agent → consultando art. 27 Ley 30225…",
  "market_price_agent → buscando 'camas plegables compactas' en mercado peruano…",
  "web_research_agent → SUNAT RUC 10439608809 vía apis.net.pe…",
  "news_research_agent → OjoPúblico 'CONSTRUCTORA ANDINA EXPRESS'…",
  "entity_personnel_agent → designados Municipalidad Tumbes…",
  "person_network_agent → query_rnp_persona DNI 43960880…",
  "person_network_agent → cruzando aportes ONPE 2022 con socios…",
  "compliance_extended_agent → check_edad_ruc_ganador_rule…",
  "report_writer_agent → ensamblando dictamen 9 secciones…",
];

export function AgentsRibbon() {
  const [activityIdx, setActivityIdx] = useState(0);
  const [activeAgent, setActiveAgent] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setActivityIdx((i) => (i + 1) % ACTIVITIES.length);
      setActiveAgent((i) => (i + 1) % AGENTS.length);
    }, 2400);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="surface relative overflow-hidden rounded-2xl">
      <div className="flex flex-col gap-3 px-5 py-3 md:flex-row md:items-center">
        {/* Label */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-paper">
            <ScanSearch size={16} />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-clay">
              11 agentes · Google ADK · Gemini 2.5
            </div>
            <div className="text-sm font-semibold text-ink">
              Procesando contrataciones en vivo
            </div>
          </div>
        </div>

        <div className="hidden h-8 w-px bg-line md:block" />

        {/* Live activity */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-moss opacity-75" />
              <span className="relative h-2 w-2 rounded-full bg-moss" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-moss">
              {AGENTS[activeAgent].nombre}
            </span>
          </div>
          <div
            key={activityIdx}
            className="animate-fadeIn truncate font-mono text-sm text-ink"
          >
            {ACTIVITIES[activityIdx]}
          </div>
        </div>

        {/* Agents pills */}
        <div className="flex flex-wrap items-center gap-1">
          {AGENTS.map((a, i) => {
            const Icon = a.icon;
            const isActive = i === activeAgent;
            return (
              <div
                key={a.id}
                title={`${a.nombre} — ${a.rol}`}
                className={
                  "flex h-7 w-7 items-center justify-center rounded-md border transition-all " +
                  (isActive
                    ? "scale-110 border-clay bg-amber-soft text-clay"
                    : "border-line bg-paperSoft text-mute")
                }
              >
                <Icon size={12} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AgentsStrip() {
  const orchestrator = AGENTS[0];
  const subAgents = AGENTS.slice(1);
  const proCount = AGENTS.filter((a) => a.model === "pro").length;

  // Pulso rotativo sobre los sub-agentes → sensación de pipeline en marcha.
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % subAgents.length), 1700);
    return () => clearInterval(t);
  }, [subAgents.length]);

  const OrchIcon = orchestrator.icon;

  return (
    <div className="space-y-3">
      {/* Director — orquestador, ancho completo */}
      <div className="relative overflow-hidden rounded-xl border border-ink/15 bg-ink p-4 text-paper">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-amber/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper/10 text-amber">
            <OrchIcon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{orchestrator.nombre}</span>
              <span className="rounded-sm bg-amber/20 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-amber">
                Pro · director
              </span>
            </div>
            <p className="mt-0.5 text-xs text-paper/70">{orchestrator.rol}</p>
          </div>
          <div className="hidden shrink-0 items-center gap-3 text-right sm:flex">
            <Workflow size={20} className="text-paper/40" />
          </div>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-[11px] text-mute">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-ink" /> <b className="font-semibold text-rust">{proCount} Pro</b> · razonamiento profundo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-paperDeep" /> <b className="font-semibold text-moss">{AGENTS.length - proCount} Flash</b> · búsqueda veloz
        </span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-mute/70">
          delega ↓ a {subAgents.length} sub-agentes
        </span>
      </div>

      {/* Sub-agentes — grilla con pulso de actividad */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {subAgents.map((a, i) => {
          const Icon = a.icon;
          const isPro = a.model === "pro";
          const isActive = i === active;
          return (
            <div
              key={a.id}
              title={a.rol}
              className={cn(
                "relative overflow-hidden rounded-xl border p-3 transition-all duration-300",
                isActive
                  ? "border-clay bg-amber-soft shadow-card"
                  : "border-line bg-paperSoft hover:-translate-y-0.5 hover:shadow-paper",
              )}
            >
              {isActive && (
                <span className="absolute right-2.5 top-2.5 flex h-2 w-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-moss opacity-75" />
                  <span className="relative h-2 w-2 rounded-full bg-moss" />
                </span>
              )}
              <div className="flex items-start gap-2.5">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    isPro ? "bg-ink text-paper" : "bg-paperDeep text-ink",
                  )}
                >
                  <Icon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[9px] uppercase tracking-widest text-mute">
                      {String(i + 2).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "rounded-sm px-1 py-px text-[8px] font-bold uppercase tracking-wider",
                        isPro ? "bg-rust/15 text-rust" : "bg-moss/15 text-moss",
                      )}
                    >
                      {isPro ? "Pro" : "Flash"}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-ink">
                    {a.nombre}
                  </div>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-mute">
                {a.rol}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
