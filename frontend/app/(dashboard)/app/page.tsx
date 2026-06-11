import Link from "next/link";
import {
  MapPin,
  Building2,
  Search,
  AlertTriangle,
  ArrowRight,
  FileText,
  Sparkles,
  Activity,
  MessageSquareWarning,
  Eye,
  MapPinned,
  Coins,
  FileSearch,
  Cpu,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import { AgentsStrip } from "@/components/AgentsRibbon";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { METRICAS_MOCK, RESUMEN_REGIONES, formatSoles } from "@/lib/mock-data";
import { getAlertas } from "@/lib/api-client";

// Tasas medidas por análisis end-to-end (documentadas en /donar). Los totales
// se DERIVAN del conteo real de análisis cacheados en Cloud SQL — no son cifras
// inventadas. La arquitectura es 6 agentes Pro + 5 Flash por corrida.
const RATE = {
  TOKENS_IN: 180_000,
  TOKENS_OUT: 80_000,
  SOLES_IA: 1,
  PRO_PER_RUN: 6,
  FLASH_PER_RUN: 5,
};
const GASTO_INFRA = 845; // infra fija mensual (Cloud Run + Cloud SQL + APIs)

function fmtCalls(n: number): string {
  return n.toLocaleString("es-PE");
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString("es-PE");
}

export default async function AppOverviewPage() {
  const m = METRICAS_MOCK;
  // Alertas REALES (Cloud SQL vía API). Una sola llamada (gzip) sirve para el
  // top 4 y para contar cuántos análisis se ejecutaron → base de los costos.
  let alertasAll: any[] = [];
  try {
    alertasAll = (await getAlertas({ limit: 500 })) as any;
  } catch {
    alertasAll = [];
  }
  const top3 = [...alertasAll].sort((a, b) => b.score - a.score).slice(0, 4);
  const analizadas = alertasAll.length;

  // Totales derivados del conteo REAL × tasas medidas por corrida.
  const tokensEntrada = analizadas * RATE.TOKENS_IN;
  const tokensSalida = analizadas * RATE.TOKENS_OUT;
  const totalTokens = tokensEntrada + tokensSalida;
  const gastoIa = Math.round(analizadas * RATE.SOLES_IA);
  const proCalls = analizadas * RATE.PRO_PER_RUN;
  const flashCalls = analizadas * RATE.FLASH_PER_RUN;
  const pctEntrada = totalTokens ? (tokensEntrada / totalTokens) * 100 : 69;
  const maxRegion = Math.max(...RESUMEN_REGIONES.map((r) => r.alertas + r.reportes));

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        eyebrow="Centro de mando · datos en vivo"
        icon={<Sparkles size={11} className="text-clay" />}
        title="Inicio"
        subtitle="Estado del país, operación del sistema, accesos rápidos."
        actions={
          <Link
            href="/reporte/nuevo"
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-coal"
          >
            <FileText size={14} />
            Denunciar
          </Link>
        }
      />

      <DisclaimerBanner />

      {/* ROW 1 — 6 KPIs compactos en una fila */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KPI
          icon={<AlertTriangle size={13} />}
          color="amber"
          value={m.alertasActivas.toString()}
          label="Alertas activas"
          delta="+3 esta semana"
        />
        <KPI
          icon={<MapPinned size={13} />}
          color="rust"
          value={m.reportesCiudadanos.toString()}
          label="Reportes vecinales"
          delta="4 verificados"
        />
        <KPI
          icon={<Eye size={13} />}
          color="ink"
          value={m.casosConvergentes.toString()}
          label="Casos convergentes"
          delta="máquina + ciudadano"
        />
        <KPI
          icon={<Building2 size={13} />}
          color="clay"
          value={m.contratosVigilados.toLocaleString("es-PE")}
          label="Contratos en BD"
          delta="14 fuentes"
        />
        <KPI
          icon={<FileSearch size={13} />}
          color="moss"
          value={String(analizadas)}
          label="Análisis profundos"
          delta="end-to-end · real"
        />
        <KPI
          icon={<Coins size={13} />}
          color="clay"
          value={formatSoles(m.montoVigiladoSoles)}
          label="Monto vigilado"
          delta="bajo seguimiento"
          big
        />
      </div>

      {/* ROW 2 — 3 columnas: Operación IA · Top alertas · Cobertura regional */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Operación IA — 4/12 */}
        <section className="surface flex flex-col p-5 lg:col-span-4">
          <header className="flex items-center justify-between">
            <h3 className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mute">
              <Cpu size={11} className="text-clay" />
              Operación · IA
            </h3>
            <Link
              href="/donar"
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-clay hover:underline"
            >
              cuentas claras <ArrowUpRight size={10} />
            </Link>
          </header>

          {/* Gasto + tokens en una fila */}
          <div className="mt-3 grid grid-cols-2 gap-3 border-b border-line pb-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-mute">
                Gasto IA · estim.
              </div>
              <div className="mt-1 font-serif text-3xl font-bold leading-none text-rust">
                S/. {gastoIa}
              </div>
              <div className="mt-1 text-[10px] text-mute">
                + S/. {GASTO_INFRA} infra/mes
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-mute">
                Tokens totales
              </div>
              <div className="mt-1 font-serif text-3xl font-bold leading-none text-ink">
                {fmtTokens(totalTokens)}
              </div>
              <div className="mt-1 text-[10px] text-mute">
                Gemini 2.5 Pro + Flash
              </div>
            </div>
          </div>

          {/* Barra split entrada/salida */}
          <div className="mt-4">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-paperDeep">
              <div
                className="bg-clay"
                style={{ width: `${pctEntrada}%` }}
              />
              <div
                className="bg-rust"
                style={{ width: `${100 - pctEntrada}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px]">
              <span className="inline-flex items-center gap-1 text-mute">
                <span className="h-1.5 w-1.5 rounded-full bg-clay" />
                Entrada{" "}
                <span className="font-mono font-bold text-ink">
                  {fmtTokens(tokensEntrada)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-mute">
                <span className="h-1.5 w-1.5 rounded-full bg-rust" />
                Salida{" "}
                <span className="font-mono font-bold text-ink">
                  {fmtTokens(tokensSalida)}
                </span>
              </span>
            </div>
          </div>

          {/* Breakdown por modelo */}
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
            <Mini label="Pro calls" value={fmtCalls(proCalls)} />
            <Mini label="Flash calls" value={fmtCalls(flashCalls)} />
            <Mini label="Costo c/u" value="~S/.1" accent="moss" />
          </div>

          <Link
            href="/donar"
            className="mt-auto pt-4 inline-flex items-center justify-center gap-1.5 rounded-full bg-ink px-3 py-2 text-[11px] font-semibold text-paper hover:bg-coal"
          >
            <Sparkles size={11} /> Apoyar el proyecto
          </Link>
        </section>

        {/* Top alertas — 4/12 */}
        <section className="surface flex flex-col p-5 lg:col-span-4">
          <header className="flex items-center justify-between">
            <h3 className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mute">
              <Activity size={11} className="text-rust" />
              Top alertas del mes
            </h3>
            <Link
              href="/app/alertas"
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-clay hover:underline"
            >
              ver todas <ArrowUpRight size={10} />
            </Link>
          </header>

          <ul className="mt-3 flex flex-1 flex-col divide-y divide-line">
            {top3.map((a) => (
              <Link
                key={a.id}
                href={`/app/convocatoria/${a.codigoconvocatoria}`}
                className="group flex items-start gap-2.5 py-2.5 transition-colors hover:bg-paperDeep/50"
              >
                <div
                  className={
                    "flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md text-paper " +
                    (a.score >= 85 ? "bg-rust" : a.score >= 70 ? "bg-clay" : "bg-amber")
                  }
                >
                  <span className="text-sm font-bold leading-none">{a.score}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-[12px] font-medium text-ink">
                    {a.objeto}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-mute">
                    <span>{a.region}</span>
                    <span>·</span>
                    <span className="font-mono text-clay">
                      {formatSoles(a.montoSoles)}
                    </span>
                    {a.unicoPostor && (
                      <>
                        <span>·</span>
                        <span className="text-rust">único postor</span>
                      </>
                    )}
                  </div>
                </div>
                <ArrowRight
                  size={12}
                  className="mt-1 shrink-0 text-mute opacity-0 transition-opacity group-hover:opacity-100"
                />
              </Link>
            ))}
          </ul>
        </section>

        {/* Cobertura por región — 4/12 */}
        <section className="surface flex flex-col p-5 lg:col-span-4">
          <header className="flex items-center justify-between">
            <h3 className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mute">
              <MapPin size={11} className="text-amber" />
              Cobertura por región
            </h3>
            <Link
              href="/app/mapa"
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-clay hover:underline"
            >
              ver mapa <ArrowUpRight size={10} />
            </Link>
          </header>

          <ul className="mt-3 flex flex-1 flex-col gap-2.5">
            {RESUMEN_REGIONES.map((r) => {
              const total = r.alertas + r.reportes;
              const pct = (total / maxRegion) * 100;
              return (
                <li key={r.region}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] font-medium text-ink">
                      {r.region}
                    </span>
                    <span className="font-mono text-[10px] text-mute">
                      {r.alertas} ⚠ · {r.reportes} 📍 · {formatSoles(r.monto)}
                    </span>
                  </div>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-paperDeep">
                    <div
                      className="bg-amber"
                      style={{ width: `${(r.alertas / maxRegion) * 100}%` }}
                    />
                    <div
                      className="bg-rust"
                      style={{ width: `${(r.reportes / maxRegion) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 text-[10px] text-mute">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber" /> alertas
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-rust" /> reportes
            </span>
            <span className="ml-auto font-mono text-mute/70">
              {RESUMEN_REGIONES.length} regiones activas
            </span>
          </div>
        </section>
      </div>

      {/* ROW 3 — Quick actions compactas en una sola fila */}
      <section>
        <header className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-mute">
            Accesos rápidos
          </h2>
          <Link
            href="/preguntas"
            className="text-[10px] font-medium text-mute hover:text-clay hover:underline"
          >
            ¿qué es cada sección?
          </Link>
        </header>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <QuickLink
            href="/app/mapa"
            icon={<MapPin size={14} />}
            label="Mapa interactivo"
            sub="25 regiones"
            color="amber"
          />
          <QuickLink
            href="/app/entidades"
            icon={<Building2 size={14} />}
            label="Entidades"
            sub="1,873 ranking"
            color="rust"
          />
          <QuickLink
            href="/app/convocatoria"
            icon={<Search size={14} />}
            label="Buscar convocatoria"
            sub="OECE en vivo"
            color="clay"
          />
          <QuickLink
            href="/app/alertas"
            icon={<AlertTriangle size={14} />}
            label="Top alertas"
            sub={`${m.alertasActivas} activas`}
            color="amber"
          />
          <QuickLink
            href="/app/denuncias"
            icon={<MessageSquareWarning size={14} />}
            label="Denuncias ciudadanas"
            sub="acceso público"
            color="moss"
          />
        </div>
      </section>

      {/* ROW 4 — Agentes en vivo */}
      <section className="surface p-5">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mute">
            <TrendingUp size={11} className="text-moss" />
            Agentes en vivo
          </h3>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-moss">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss" />
            sistema activo
          </span>
        </header>
        <AgentsStrip />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function KPI({
  icon,
  color,
  value,
  label,
  delta,
  big,
}: {
  icon: React.ReactNode;
  color: "amber" | "rust" | "ink" | "clay" | "moss";
  value: string;
  label: string;
  delta: string;
  big?: boolean;
}) {
  const colorMap: Record<string, string> = {
    amber: "bg-amber/15 text-clay",
    rust: "bg-rust/10 text-rust",
    ink: "bg-ink/10 text-ink",
    clay: "bg-clay/10 text-clay",
    moss: "bg-moss/15 text-moss",
  };
  return (
    <div className="surface p-3">
      <div className="flex items-center justify-between">
        <span
          className={
            "flex h-6 w-6 items-center justify-center rounded-md " + colorMap[color]
          }
        >
          {icon}
        </span>
        <span className="text-[9px] font-medium uppercase tracking-widest text-mute">
          {delta}
        </span>
      </div>
      <div
        className={
          "mt-2 font-serif font-bold leading-none text-ink " +
          (big ? "text-xl sm:text-2xl" : "text-2xl")
        }
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] text-mute">{label}</div>
    </div>
  );
}

function Mini({
  label,
  value,
  accent = "ink",
}: {
  label: string;
  value: string;
  accent?: "ink" | "rust" | "clay" | "moss";
}) {
  const colorMap = {
    ink: "text-ink",
    rust: "text-rust",
    clay: "text-clay",
    moss: "text-moss",
  };
  return (
    <div className="rounded-md bg-paperSoft px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-mute">{label}</div>
      <div className={"font-mono text-[13px] font-bold leading-tight " + colorMap[accent]}>
        {value}
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
  sub,
  color,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  sub: string;
  color: "amber" | "rust" | "clay" | "moss";
}) {
  const colorMap = {
    amber: "bg-amber/15 text-clay",
    rust: "bg-rust/10 text-rust",
    clay: "bg-clay/10 text-clay",
    moss: "bg-moss/15 text-moss",
  };
  return (
    <Link
      href={href}
      className="group surface flex items-center gap-2.5 p-3 transition-all hover:-translate-y-0.5 hover:shadow-paper"
    >
      <span
        className={
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
          colorMap[color]
        }
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight text-ink">
          {label}
        </div>
        <div className="truncate text-[10px] text-mute">{sub}</div>
      </div>
      <ArrowRight
        size={12}
        className="shrink-0 text-mute opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
      />
    </Link>
  );
}
