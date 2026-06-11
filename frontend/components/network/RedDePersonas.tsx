"use client";

import { useState } from "react";
import {
  Building2,
  User,
  ExternalLink,
  Newspaper,
  Network as NetIcon,
  Globe2,
  Sparkles,
  Clock,
  Database,
  Users,
  AlertCircle,
} from "lucide-react";
import {
  type EmpresaNetwork,
  type PersonaNetwork,
  type NetworkFlag,
  type AlertaContext,
  FLAG_META,
  fuentesConsultadasFor,
  eventosTimelineFor,
} from "@/lib/mock-network";
import { getExpedienteForAlerta } from "@/lib/mock-expedientes";
import { GrafoConexiones } from "./GrafoConexiones";
import { LineaTiempo } from "./LineaTiempo";
import { FuentesConsultadas } from "./FuentesConsultadas";
import { CasoExpediente } from "./CasoExpediente";
import { cn } from "@/lib/utils";

type TabId = "caso" | "cronologia" | "personas" | "fuentes";

export function RedDePersonas({
  data,
  alertaCtx,
  alertaId,
}: {
  data: EmpresaNetwork | null;
  alertaCtx: AlertaContext;
  alertaId?: string;
}) {
  const [tab, setTab] = useState<TabId>("caso");

  const fuentes = fuentesConsultadasFor(data);
  const eventos = eventosTimelineFor(data, alertaCtx);
  const expediente = getExpedienteForAlerta(alertaId ?? "");

  const totalFlags = data
    ? data.flagsEmpresa.length + data.socios.reduce((s, p) => s + p.flags.length, 0)
    : 0;
  const personasCount = data ? data.socios.length + 1 : 1;
  const fuentesConHallazgo = fuentes.filter((f) => f.estado === "coincidencia").length;

  const tabs: {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    badge?: { value: number; tone: "rust" | "ink" };
  }[] = [
    { id: "caso", label: "Caso", icon: <NetIcon size={14} /> },
    { id: "cronologia", label: "Cronología", icon: <Clock size={14} />, badge: { value: eventos.length, tone: "ink" } },
    { id: "personas", label: "Personas", icon: <Users size={14} />, badge: { value: personasCount, tone: "ink" } },
    { id: "fuentes", label: "Fuentes", icon: <Database size={14} />, badge: fuentesConHallazgo > 0 ? { value: fuentesConHallazgo, tone: "rust" } : undefined },
  ];

  return (
    <section className="space-y-5">
      {/* ─── Header narrativo ─── */}
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-paperDeep px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
          <NetIcon size={11} /> Dossier de la red
        </div>
        <h2 className="font-serif text-3xl font-bold leading-tight text-ink">
          {data
            ? `${totalFlags} señal${totalFlags === 1 ? "" : "es"} encontrada${totalFlags === 1 ? "" : "s"}`
            : "Pendiente de enriquecimiento por agente"}
        </h2>
        <p className="mt-1.5 max-w-3xl text-sm text-mute">
          {data
            ? <>Los agentes <Code>network_agent</Code> + <Code>web_research_agent</Code> expandieron el RUC ganador y cruzaron a cada persona contra <strong className="text-ink">{fuentes.length} fuentes oficiales</strong>.</>
            : <>Aún no se ha corrido la expansión. Cuando el agente lo haga, esta sección se rellena automáticamente con socios, banderas, cronología y prensa.</>
          }
        </p>
      </div>

      {/* ─── KPI strip (siempre visible) ─── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KPI label="Personas analizadas" value={personasCount} hint={data ? `1 empresa + ${data.socios.length} socios` : "pendiente"} />
        <KPI label="Fuentes oficiales" value={fuentes.length} hint={`${fuentesConHallazgo} con hallazgos`} tone={fuentesConHallazgo > 0 ? "rust" : "ink"} />
        <KPI label="Señales detectadas" value={totalFlags} hint="cruces vs fuentes" tone={totalFlags > 0 ? "rust" : "ink"} />
        <KPI label="Eventos cronología" value={eventos.length} hint="ordenados por fecha" />
      </div>

      {/* ─── Tabs ─── */}
      <div className="surface overflow-hidden p-0">
        <div role="tablist" className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-line bg-paperDeep px-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative flex shrink-0 items-center gap-2 px-3 py-3 text-sm font-medium transition-colors",
                tab === t.id ? "text-ink" : "text-mute hover:text-ink",
              )}
            >
              <span className={tab === t.id ? "text-clay" : ""}>{t.icon}</span>
              {t.label}
              {t.badge && (
                <span
                  className={cn(
                    "ml-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                    t.badge.tone === "rust"
                      ? "bg-rust text-paper"
                      : "bg-paper text-mute",
                  )}
                >
                  {t.badge.value}
                </span>
              )}
              {tab === t.id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-clay" />
              )}
            </button>
          ))}
        </div>

        <div className="p-5 animate-fadeIn" key={tab}>
          {tab === "caso" && <CasoExpediente data={expediente} />}
          {tab === "cronologia" && <CronologiaTab eventos={eventos} />}
          {tab === "personas" && (
            <PersonasTab data={data} alertaCtx={alertaCtx} />
          )}
          {tab === "fuentes" && <FuentesTab fuentes={fuentes} data={data} />}
        </div>
      </div>

      {/* ─── Footer atribución ─── */}
      <div className="rounded-2xl border border-dashed border-line bg-paperDeep px-5 py-3 text-xs text-mute">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-ink">Cómo se armó este dossier:</span>
          <AgentChip name="compliance_agent" />
          <AgentChip name="network_agent" />
          <AgentChip name="market_price_agent" />
          <AgentChip name="document_parser_agent" />
          <AgentChip name="web_research_agent" />
          <span className="ml-auto text-[11px]">
            Cada bandera lleva fuente oficial verificable. Ningún hallazgo es opinión del modelo.
          </span>
        </div>
      </div>
    </section>
  );
}

// ─── Tabs ────────────────────────────────────────────────

function CronologiaTab({ eventos }: { eventos: ReturnType<typeof eventosTimelineFor> }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-lg font-bold text-ink">
          Línea de tiempo del caso
        </h3>
        <p className="text-xs text-mute">
          {eventos.length} evento{eventos.length === 1 ? "" : "s"} · ordenados del más antiguo a la buena pro
        </p>
      </div>
      <LineaTiempo eventos={eventos} />
    </div>
  );
}

function PersonasTab({
  data,
  alertaCtx,
}: {
  data: EmpresaNetwork | null;
  alertaCtx: AlertaContext;
}) {
  if (!data) {
    return (
      <EmptyState
        icon={<Users size={20} />}
        title="Sin personas analizadas todavía"
        body={
          <>
            El detalle de empresa y socios aparece tras correr{" "}
            <Code>network_agent.expand_consortium_members(ruc)</Code> +{" "}
            <Code>network_agent.expand_company_people(ruc)</Code>. Cada socio
            llevará su DNI, % de participación y banderas individuales (sanción,
            inhabilitación, aporte político, familiar de funcionario).
          </>
        }
      />
    );
  }
  return (
    <div className="space-y-6">
      {/* Grafo arriba */}
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-serif text-lg font-bold text-ink">
            Grafo de conexiones
          </h3>
          <p className="text-xs text-mute">
            {alertaCtx.proveedor} · S/. {alertaCtx.monto.toLocaleString("es-PE")}
          </p>
        </div>
        <GrafoConexiones data={data} />
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-mute">
          <LegendDot color="rust" label="Conexión con señales" />
          <LegendDot color="warm" label="Conexión sin señales" />
          <span className="ml-auto">Generado por network_agent</span>
        </div>
      </div>

      {/* Empresa */}
      <div>
        <h3 className="mb-2 font-serif text-lg font-bold text-ink">
          Empresa adjudicataria
        </h3>
        <EmpresaCard data={data} />
      </div>

      {/* Socios */}
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-serif text-lg font-bold text-ink">
            Socios y representantes
          </h3>
          <span className="text-xs text-mute">
            {data.socios.length} persona{data.socios.length === 1 ? "" : "s"} expandida{data.socios.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {data.socios.map((p) => (
            <SocioCard key={p.dni} persona={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FuentesTab({
  fuentes,
  data,
}: {
  fuentes: ReturnType<typeof fuentesConsultadasFor>;
  data: EmpresaNetwork | null;
}) {
  return (
    <div className="space-y-6">
      {/* Catálogo oficial */}
      <div>
        <FuentesConsultadas fuentes={fuentes} />
      </div>

      {/* Hallazgos en prensa */}
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-clay">
              <Globe2 size={11} /> Hallazgos en prensa
            </div>
            <h3 className="mt-0.5 font-serif text-lg font-bold text-ink">
              {data && data.hallazgosWeb.length > 0
                ? `${data.hallazgosWeb.length} menciones cruzadas`
                : "Búsqueda pendiente"}
            </h3>
          </div>
          <span className="text-xs text-mute">
            por <Code>web_research_agent</Code>
          </span>
        </div>
        {data && data.hallazgosWeb.length > 0 ? (
          <ul className="surface divide-y divide-line p-0">
            {data.hallazgosWeb.map((h, i) => (
              <li key={i}>
                <a
                  href={h.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-3 px-5 py-4 transition-colors hover:bg-paperDeep"
                >
                  <Newspaper size={16} className="mt-0.5 shrink-0 text-clay" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-clay">
                        {h.fuente}
                      </span>
                      {h.fecha && (
                        <span className="font-mono text-[10px] text-mute">{h.fecha}</span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-ink">{h.titulo}</div>
                    <p className="mt-1 text-xs leading-relaxed text-mute">{h.snippet}</p>
                  </div>
                  <ExternalLink size={14} className="mt-0.5 shrink-0 text-mute group-hover:text-clay" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Globe2 size={20} />}
            title="Búsqueda web pendiente"
            body={
              <>
                <Code>web_research_agent</Code> va a consultar OjoPúblico,
                IDL-Reporteros, Convoca, El Peruano y archivos periodísticos para
                buscar menciones de los socios y la empresa adjudicataria.
              </>
            }
          />
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function KPI({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "ink" | "rust";
}) {
  const valueColor = tone === "rust" ? "text-rust" : "text-ink";
  return (
    <div className="surface p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-mute">
        {label}
      </div>
      <div className={cn("mt-1 font-mono text-2xl font-bold tabular-nums", valueColor)}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-mute">{hint}</div>}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-paperDeep px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-paperDeep px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-paper text-mute">
        {icon}
      </div>
      <h4 className="font-serif text-lg font-bold text-ink">{title}</h4>
      <p className="max-w-md text-sm leading-relaxed text-mute">{body}</p>
    </div>
  );
}

function LegendDot({
  color,
  label,
}: {
  color: "rust" | "warm";
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "inline-block h-px w-6",
          color === "rust" ? "bg-rust" : "bg-paperEdge",
        )}
        style={
          color === "warm"
            ? { borderTop: "1px dashed #BFB29B", background: "transparent", height: 0 }
            : undefined
        }
      />
      <span className="text-ink">{label}</span>
    </div>
  );
}

function EmpresaCard({ data }: { data: EmpresaNetwork }) {
  return (
    <div className="surface overflow-hidden p-0">
      <div className="flex items-start gap-4 border-b border-line bg-paperDeep px-5 py-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink text-paper">
          <Building2 size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg font-bold leading-tight text-ink">
            {data.razonSocial}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
            <span className="font-mono">RUC {data.ruc}</span>
            <span>· {data.edadRucDias} días desde alta</span>
            {data.capitalSocial != null && (
              <span>· Capital S/. {data.capitalSocial.toLocaleString("es-PE")}</span>
            )}
          </div>
          {data.domicilio && <div className="mt-1 text-xs text-mute">📍 {data.domicilio}</div>}
        </div>
      </div>
      {data.flagsEmpresa.length > 0 && (
        <div className="space-y-2 px-5 py-4">
          {data.flagsEmpresa.map((f, i) => (
            <FlagRow key={i} flag={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function SocioCard({ persona }: { persona: PersonaNetwork }) {
  const hasFlags = persona.flags.length > 0;
  return (
    <div className={cn("surface overflow-hidden p-0", hasFlags && "border-rust/30")}>
      <div className="flex items-start gap-3 border-b border-line bg-paperDeep px-4 py-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            hasFlags ? "bg-rust text-paper" : "bg-paper text-mute",
          )}
        >
          <User size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{persona.nombre}</div>
          <div className="text-[11px] text-mute">
            <span className="font-mono">DNI {persona.dni}</span>
            {persona.participacion != null && <> · {persona.participacion}% participación</>}
          </div>
          <div className="mt-0.5 text-[11px] text-ink">{persona.rol}</div>
        </div>
      </div>
      {hasFlags ? (
        <div className="space-y-2 px-4 py-3">
          {persona.flags.map((f, i) => (
            <FlagRow key={i} flag={f} />
          ))}
        </div>
      ) : (
        <div className="px-4 py-4 text-center text-xs text-mute">
          Sin señales encontradas para este socio.
        </div>
      )}
    </div>
  );
}

function FlagRow({ flag }: { flag: NetworkFlag }) {
  const meta = FLAG_META[flag.tipo];
  const sevStyles =
    flag.severidad === "alta"
      ? "border-rust/40 bg-crimson-soft"
      : flag.severidad === "media"
        ? "border-amber/40 bg-amber-soft"
        : "border-line bg-paperSoft";
  return (
    <div className={cn("rounded-xl border p-3", sevStyles)}>
      <div className="flex items-baseline gap-2">
        <span className="text-base leading-none">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-mute">
              {meta.label}
            </span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0 text-[9px] font-medium",
                flag.severidad === "alta"
                  ? "bg-rust text-paper"
                  : flag.severidad === "media"
                    ? "bg-amber text-paper"
                    : "bg-line text-ink",
              )}
            >
              {flag.severidad}
            </span>
          </div>
          <div className="mt-0.5 text-sm font-semibold text-ink">{flag.titulo}</div>
          <p className="mt-1 text-xs leading-relaxed text-inkSoft">{flag.detalle}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
            <a
              href={flag.fuente.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-clay hover:underline"
            >
              <ExternalLink size={10} />
              {flag.fuente.nombre}
              {flag.fuente.fecha && (
                <span className="ml-1 font-mono text-mute">· {flag.fuente.fecha}</span>
              )}
            </a>
            <span className="ml-auto rounded-full bg-paperDeep px-1.5 py-0.5 font-mono text-[9px] text-mute">
              {flag.agente}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paperSoft px-2 py-0.5 font-mono text-[10px] text-ink">
      <Sparkles size={10} className="text-clay" />
      {name}
    </span>
  );
}
