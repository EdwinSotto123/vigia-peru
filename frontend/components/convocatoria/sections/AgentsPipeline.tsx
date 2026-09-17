"use client";

import { useState } from "react";
import { ChevronRight, ScanSearch, FileText, Receipt, Globe2, Eye, Network } from "lucide-react";
import { cn } from "@/lib/utils";

const AGENTS = [
  { icon: <ScanSearch size={16} />, name: "compliance_agent",      action: "8 reglas duras SQL",        detail: "Edad RUC · único postor · adendas > 25% · plazo legal · SICAN", tone: "bg-amber-soft text-amber" },
  { icon: <FileText size={16} />,   name: "document_parser_agent", action: "Bases · actas · contratos", detail: "Gemini 2.5 Flash lee PDFs nativos · extrae items, postores, especs", tone: "bg-paperDeep text-clay" },
  { icon: <Receipt size={16} />,    name: "market_price_agent",    action: "Valida vs mercado",         detail: "Google Search en vivo · precios mediana · detecta sobreprecio", tone: "bg-crimson-soft text-rust" },
  { icon: <Globe2 size={16} />,     name: "web_research_agent",    action: "Perfil empresa · 15+ búsquedas",       detail: "SUNAT vía decolecta · OSCE · sanciones · historial contratos", tone: "bg-paperDeep text-clay" },
  { icon: <Eye size={16} />,        name: "news_research_agent",   action: "Cobertura periodística",    detail: "Timeline en prensa · OjoPúblico · IDL · Convoca · La República", tone: "bg-crimson-soft text-clay" },
  { icon: <Network size={16} />,    name: "person_network_agent",  action: "Gerente + red empresarial", detail: "Cargos pasados · candidaturas · aportes ONPE · empresas vinculadas", tone: "bg-amber-soft text-clay" },
  { icon: <FileText size={16} />,   name: "report_writer_agent",   action: "Dictamen final",            detail: "Cita artículo de ley · lecturas alternativas · próximos pasos", tone: "bg-paperSoft text-ink" },
];

export function AgentsPipeline() {
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
