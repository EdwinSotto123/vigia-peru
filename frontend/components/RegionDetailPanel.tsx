"use client";

import { useState } from "react";
import Link from "next/link";
import {
  X,
  TrendingUp,
  AlertTriangle,
  Coins,
  Users,
  ArrowUpRight,
  Building2,
  ListFilter,
  LineChart,
  MapPin,
  Activity,
  ArrowRight,
  GitMerge,
} from "lucide-react";
import {
  MESES_SERIE,
  REGION_TO_MEF_DEPT,
  type RegionData,
  type ProvinciaData,
} from "@/lib/peru-data";
import { formatSoles, ALERTAS_MOCK } from "@/lib/mock-data";
import { Sparkline } from "./charts/Sparkline";
import { MiniBars } from "./charts/MiniBars";
import { PresupuestoRegional } from "./PresupuestoRegional";
import { cn } from "@/lib/utils";

type Tab = "resumen" | "presupuesto" | "casos" | "entidades";

export function RegionDetailPanel({
  region,
  provinciaActiva,
  onClose,
  onClearProvincia,
  alertasApi,
}: {
  region: RegionData | null;
  provinciaActiva: ProvinciaData | null;
  onClose: () => void;
  onClearProvincia: () => void;
  /**
   * Alertas reales desde la API (con prioridad sobre mock). Si está vacío,
   * fallback a ALERTAS_MOCK.
   */
  alertasApi?: any[];
}) {
  const [tab, setTab] = useState<Tab>("resumen");

  if (!region) return <EmptyPanel />;

  const tendencia =
    region.serie.length >= 2
      ? region.serie[region.serie.length - 1] - region.serie[region.serie.length - 2]
      : 0;

  // Prioridad: API real > mock. Match flexible por nombre o id.
  function _norm(s: string): string {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  }
  const regionKey = _norm(region.nombre);
  const fuente = (alertasApi && alertasApi.length > 0) ? alertasApi : ALERTAS_MOCK;
  const alertasRegion = (fuente as any[])
    .filter((a) => {
      const rn = _norm(a.region || "");
      return rn === regionKey || rn.includes(regionKey) || regionKey.includes(rn);
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  return (
    <div className="flex h-full flex-col overflow-hidden bg-paperSoft">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-line bg-paperDeep px-5 py-4">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-clay">
            Región seleccionada
          </div>
          <h3 className="mt-1 font-serif text-2xl font-bold leading-tight text-ink">
            {region.nombre}
          </h3>
          <div className="mt-0.5 text-xs text-mute">
            {region.poblacion.toLocaleString("es-PE")} habitantes
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-paperSoft text-mute hover:bg-paper hover:text-ink"
          aria-label="Cerrar"
        >
          <X size={16} />
        </button>
      </div>

      {/* Provincia activa */}
      {provinciaActiva && provinciaActiva.alertas > 0 && (
        <div className="animate-slideIn border-b border-line bg-crimson-soft px-5 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-rust">
                <MapPin size={11} /> Provincia
              </div>
              <div className="mt-0.5 font-serif text-base font-bold text-ink">
                {provinciaActiva.nombre}
              </div>
            </div>
            <button
              onClick={onClearProvincia}
              className="text-[10px] text-rust hover:underline"
            >
              limpiar
            </button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <MicroStat label="Alertas" value={provinciaActiva.alertas} />
            <MicroStat label="Score" value={provinciaActiva.scorePromedio} />
            <MicroStat label="Monto" value={formatSoles(provinciaActiva.monto)} small />
          </div>
        </div>
      )}

      {provinciaActiva && provinciaActiva.alertas === 0 && (
        <div className="animate-slideIn border-b border-line bg-paperDeep px-5 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-mute">
                <MapPin size={11} /> Provincia
              </div>
              <div className="mt-0.5 font-serif text-base font-bold text-ink">
                {provinciaActiva.nombre}
              </div>
              <div className="mt-0.5 text-[11px] text-mute">
                Sin alertas automáticas detectadas en esta provincia.
              </div>
            </div>
            <button
              onClick={onClearProvincia}
              className="text-[10px] text-mute hover:underline"
            >
              limpiar
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              href={`/reporte/nuevo?provincia=${encodeURIComponent(provinciaActiva.nombre)}&region=${encodeURIComponent(region.nombre)}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-clay px-3 py-1.5 text-[11px] font-medium text-paper hover:bg-clay/90"
            >
              Reportar algo en {provinciaActiva.nombre}
            </Link>
            <Link
              href="/#convocatoria"
              className="inline-flex items-center gap-1 rounded-full border border-line bg-paperSoft px-3 py-1.5 text-[11px] text-ink hover:bg-paper"
            >
              Buscar convocatorias OECE →
            </Link>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex shrink-0 items-stretch border-b border-line bg-paperSoft">
        <TabBtn active={tab === "resumen"} onClick={() => setTab("resumen")} icon={<LineChart size={12} />}>
          Resumen
        </TabBtn>
        <TabBtn active={tab === "presupuesto"} onClick={() => setTab("presupuesto")} icon={<Coins size={12} />}>
          MEF
        </TabBtn>
        <TabBtn
          active={tab === "casos"}
          onClick={() => setTab("casos")}
          icon={<AlertTriangle size={12} />}
          count={alertasRegion.length}
        >
          Casos
        </TabBtn>
        <TabBtn
          active={tab === "entidades"}
          onClick={() => setTab("entidades")}
          icon={<Building2 size={12} />}
          count={region.topEntidades.length}
        >
          Entidades
        </TabBtn>
      </div>

      {/* Tab content */}
      <div className="scrollbar-warm flex-1 overflow-y-auto px-5 py-4">
        {tab === "resumen" && (
          <ResumenTab region={region} tendencia={tendencia} alertasRegion={alertasRegion} />
        )}
        {tab === "presupuesto" && (
          <PresupuestoRegional
            mefDept={REGION_TO_MEF_DEPT[region.id] ?? null}
            compact
            regionId={region.id}
          />
        )}
        {tab === "casos" && <CasosTab alertas={alertasRegion} />}
        {tab === "entidades" && <EntidadesTab region={region} />}
      </div>

      {/* Footer CTA */}
      <div className="shrink-0 border-t border-line bg-paperDeep px-5 py-3">
        <Link
          href="/reporte/nuevo"
          className="block w-full rounded-full bg-clay px-4 py-2.5 text-center text-sm font-semibold text-paper shadow-card transition-transform hover:scale-[1.01]"
        >
          Reportar algo en {region.nombre} →
        </Link>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-1 items-center justify-center gap-1 px-2 py-2.5 text-[11px] font-medium transition-colors",
        active ? "text-ink" : "text-mute hover:text-ink",
      )}
    >
      <span className={active ? "text-clay" : ""}>{icon}</span>
      <span>{children}</span>
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0 text-[9px] font-bold",
            active ? "bg-clay text-paper" : "bg-paperDeep text-mute",
          )}
        >
          {count}
        </span>
      )}
      {active && (
        <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-clay" />
      )}
    </button>
  );
}

function MicroStat({
  label,
  value,
  small,
}: {
  label: string;
  value: number | string;
  small?: boolean;
}) {
  return (
    <div>
      <div className={cn("font-mono font-bold text-ink", small ? "text-sm" : "text-lg")}>
        {typeof value === "number" ? value.toLocaleString("es-PE") : value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-mute">{label}</div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────

function ResumenTab({
  region,
  tendencia,
  alertasRegion: alertasOverride,
}: {
  region: RegionData;
  tendencia: number;
  alertasRegion?: any[];
}) {
  const alertasRegion = alertasOverride && alertasOverride.length > 0
    ? alertasOverride
    : ALERTAS_MOCK.filter((a) => a.region.toLowerCase().includes(region.id)).sort((a, b) => b.score - a.score);

  const provinciasAfectadas = region.provincias.filter((p) => p.alertas > 0);

  // Status semáforo
  const nivel =
    region.scorePromedio >= 85
      ? { label: "Riesgo alto", tone: "bg-rust text-paper", dot: "bg-rust" }
      : region.scorePromedio >= 70
        ? { label: "Riesgo medio", tone: "bg-amber text-paper", dot: "bg-amber" }
        : region.scorePromedio >= 50
          ? { label: "Riesgo bajo", tone: "bg-clay text-paper", dot: "bg-clay" }
          : { label: "Sin riesgo activo", tone: "bg-mute text-paper", dot: "bg-mute" };

  return (
    <div className="space-y-4">
      {/* Estado general — chip + score */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-paper px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("h-2 w-2 animate-pulseSoft rounded-full", nivel.dot)} />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-mute">
              Estado del territorio
            </div>
            <div className="text-sm font-semibold text-ink">{nivel.label}</div>
          </div>
        </div>
        <div className="text-right">
          <div
            className={cn(
              "inline-flex items-baseline gap-0.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold",
              nivel.tone,
            )}
          >
            <Activity size={10} className="mr-0.5" />
            {region.scorePromedio}
            <span className="text-[9px] opacity-70">/100</span>
          </div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wider text-mute">
            score
          </div>
        </div>
      </div>

      {/* KPI strip horizontal — 4 mini-stats */}
      <div className="grid grid-cols-4 gap-1.5 rounded-2xl border border-line bg-paper p-2.5">
        <MiniKpi
          icon={<AlertTriangle size={11} />}
          value={region.alertas}
          label="Alertas"
          tone="amber"
        />
        <MiniKpi
          icon={<Users size={11} />}
          value={region.reportes}
          label="Reportes"
          tone="rust"
        />
        <MiniKpi
          icon={<GitMerge size={11} />}
          value={region.convergentes}
          label="Converg."
          tone="clay"
        />
        <MiniKpi
          icon={<Coins size={11} />}
          value={formatSoles(region.monto)}
          label="Monto"
          tone="ink"
          isText
        />
      </div>

      {/* Tendencia + sparkline */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <div className="flex items-center gap-1.5">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
              Tendencia · últimos 6 meses
            </h4>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold",
              tendencia > 0
                ? "bg-crimson-soft text-rust"
                : tendencia < 0
                  ? "bg-moss/15 text-moss"
                  : "bg-paperDeep text-mute",
            )}
          >
            {tendencia > 0 ? "▲" : tendencia < 0 ? "▼" : "—"} {Math.abs(tendencia)}
          </span>
        </div>
        <div className="rounded-xl border border-line bg-paper p-3">
          <Sparkline
            values={region.serie}
            labels={MESES_SERIE}
            color="#A0512D"
            width={300}
            height={58}
          />
        </div>
      </div>

      {/* Top caso destacado (1 inline si hay) */}
      {alertasRegion.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
              Caso prioritario
            </h4>
            {alertasRegion.length > 1 && (
              <span className="text-[10px] text-mute">
                +{alertasRegion.length - 1} más
              </span>
            )}
          </div>
          <Link
            href={`/alerta/${alertasRegion[0].id}`}
            className="group flex items-stretch gap-3 rounded-xl border border-line bg-paper p-3 transition-colors hover:border-clay/60 hover:bg-paperDeep"
          >
            <div
              className={cn(
                "flex w-12 shrink-0 flex-col items-center justify-center rounded-lg text-paper",
                alertasRegion[0].score >= 85
                  ? "bg-rust"
                  : alertasRegion[0].score >= 70
                    ? "bg-clay"
                    : "bg-amber",
              )}
            >
              <span className="text-xl font-bold leading-none">
                {alertasRegion[0].score}
              </span>
              <span className="mt-0.5 text-[8px] uppercase opacity-80">
                score
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] text-mute">
                {alertasRegion[0].codigoconvocatoria}
              </div>
              <div className="line-clamp-2 text-xs font-medium text-ink">
                {alertasRegion[0].objeto}
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-clay">
                {formatSoles(alertasRegion[0].montoSoles)}
                <ArrowRight
                  size={10}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* Provincias afectadas — denser */}
      {provinciasAfectadas.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
              Provincias con alertas
            </h4>
            <span className="text-[10px] text-mute">
              {provinciasAfectadas.length} de {region.provincias.length}
            </span>
          </div>
          <ul className="space-y-1.5">
            {provinciasAfectadas.slice(0, 5).map((p) => {
              const color =
                p.scorePromedio >= 85
                  ? "#7A2E18"
                  : p.scorePromedio >= 70
                    ? "#B5752C"
                    : "#76695A";
              const max = Math.max(...provinciasAfectadas.map((x) => x.monto));
              const pct = (p.monto / max) * 100;
              return (
                <li
                  key={p.id}
                  className="rounded-xl border border-line bg-paper p-2.5"
                >
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="rounded px-1 py-0 text-[9px] font-bold text-paper"
                        style={{ background: color }}
                      >
                        {p.scorePromedio}
                      </span>
                      <span className="font-medium text-ink">{p.nombre}</span>
                    </span>
                    <span className="font-mono text-[10px] text-mute">
                      {p.alertas} alerta{p.alertas === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-paperDeep">
                      <div
                        className="h-full transition-all duration-700 ease-out"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-mute">
                      {formatSoles(p.monto)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Link al detalle completo */}
      <Link
        href={`/region/${region.id}`}
        className="group flex items-center justify-between rounded-xl border border-dashed border-line bg-paperDeep px-3 py-2.5 text-xs transition-colors hover:border-clay hover:bg-paper"
      >
        <span className="text-mute">
          Análisis completo de <strong className="text-ink">{region.nombre}</strong>
        </span>
        <span className="inline-flex items-center gap-0.5 font-semibold text-clay">
          Ver dashboard
          <ArrowRight
            size={11}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </div>
  );
}

function MiniKpi({
  icon,
  value,
  label,
  tone,
  isText = false,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  tone: "amber" | "rust" | "clay" | "ink";
  isText?: boolean;
}) {
  const accent = {
    amber: "text-amber",
    rust: "text-rust",
    clay: "text-clay",
    ink: "text-ink",
  }[tone];
  return (
    <div className="rounded-lg bg-paperDeep px-2 py-1.5">
      <div
        className={cn(
          "flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider",
          accent,
        )}
      >
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono font-bold leading-tight tabular-nums",
          isText ? "text-[11px]" : "text-base",
          "text-ink",
        )}
      >
        {typeof value === "number" ? value.toLocaleString("es-PE") : value}
      </div>
    </div>
  );
}

function CasosTab({
  alertas,
}: {
  alertas: ReturnType<typeof Array<any>> | typeof ALERTAS_MOCK;
}) {
  if (alertas.length === 0) {
    return <EmptyTab text="Sin casos detectados en esta región." />;
  }
  return (
    <ul className="space-y-2">
      {alertas.slice(0, 8).map((a: any) => (
        <li key={a.id}>
          <Link
            href={`/alerta/${a.id}`}
            className="group block rounded-xl border border-line bg-paper p-3 transition-colors hover:border-clay/60 hover:bg-paperDeep"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] text-mute">
                  <span className="font-mono">{a.codigoconvocatoria}</span>
                  <span>·</span>
                  <span>{formatSoles(a.montoSoles)}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-sm font-medium text-ink">
                  {a.objeto}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {a.banderas.slice(0, 2).map((b: any) => (
                    <span
                      key={b.regla}
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                        b.severidad === "alta"
                          ? "bg-crimson-soft text-rust"
                          : "bg-amber-soft text-amber",
                      )}
                    >
                      {b.regla.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-bold leading-none text-ink">
                  {a.score}
                </div>
                <div className="text-[9px] uppercase tracking-wider text-mute">
                  score
                </div>
                <ArrowUpRight
                  size={14}
                  className="ml-auto mt-1 text-mute group-hover:text-clay"
                />
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EntidadesTab({ region }: { region: RegionData }) {
  if (region.topEntidades.length === 0) {
    return <EmptyTab text="Sin entidades con alertas en esta región." />;
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-paper p-4">
        <MiniBars
          color="#A0512D"
          items={region.topEntidades.map((e) => ({
            label: e.nombre,
            value: e.alertas,
            hint: formatSoles(e.monto),
          }))}
          formatValue={(v) => `${v}`}
        />
      </div>
      <p className="text-xs text-mute">
        Ranking de entidades contratantes con más banderas detectadas. Click en una
        provincia del mapa para filtrar a sus casos.
      </p>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-paper p-8 text-center">
      <ListFilter size={20} className="mx-auto text-mute" />
      <p className="mt-2 text-sm text-mute">{text}</p>
    </div>
  );
}

function KPI({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: "amber" | "crimson" | "ink" | "clay";
}) {
  const styles = {
    amber: "border-amber/30 bg-amber-soft text-amber",
    crimson: "border-crimson/30 bg-crimson-soft text-rust",
    ink: "border-line bg-paperDeep text-ink",
    clay: "border-clay/30 bg-amber-soft text-clay",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-3", styles)}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <div className="mt-1.5 font-mono text-xl font-bold text-ink">
        {typeof value === "number" ? value.toLocaleString("es-PE") : value}
      </div>
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-paperSoft p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-paperEdge bg-paperDeep text-clay">
        <MapPin size={26} />
      </div>
      <h3 className="font-serif text-xl font-bold text-ink">
        Toca una región
      </h3>
      <p className="max-w-xs text-sm text-mute">
        El mapa hace zoom al departamento, revela sus provincias y abre el
        desglose acá. Las provincias en rojo son clickeables.
      </p>
    </div>
  );
}
