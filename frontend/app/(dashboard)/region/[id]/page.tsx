import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowLeft,
  MapPin,
  Building2,
  ExternalLink,
  AlertTriangle,
  Coins,
  GitMerge,
  Users,
  LineChart,
} from "lucide-react";
import { REGIONES, REGION_TO_MEF_DEPT } from "@/lib/peru-data";
import { ALERTAS_MOCK, formatSoles, severidadColor } from "@/lib/mock-data";
import { ENTIDADES } from "@/lib/mock-entities";
import { formatPEN, ejecucionPct } from "@/lib/mef";
import { getRegionBudget } from "@/lib/mef-cache";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { PresupuestoRegional } from "@/components/PresupuestoRegional";
import { Badge } from "@/components/ui/Badge";
import { RegionEvolutionChart } from "@/components/region/RegionEvolutionChart";
import { RegionRankingCard } from "@/components/region/RegionRankingCard";
import { AlertasSeverityCard } from "@/components/region/AlertasSeverityCard";
import { ProvinciasBars } from "@/components/region/ProvinciasBars";
import { cn } from "@/lib/utils";

export const revalidate = 3600;

export default async function RegionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const region = REGIONES.find((r) => r.id === params.id);
  if (!region) notFound();

  const mefDept = REGION_TO_MEF_DEPT[region.id] ?? null;
  const mefData = mefDept ? await getRegionBudget(mefDept) : null;

  const alertasRegion = ALERTAS_MOCK.filter(
    (a) => a.region.toLowerCase() === region.nombre.toLowerCase(),
  );
  const entidadesRegion = ENTIDADES.filter(
    (e) => e.region.toLowerCase() === region.nombre.toLowerCase(),
  );

  const TODAY = new Date();
  const CURRENT_YEAR = TODAY.getFullYear();
  const current = mefData?.byYear.find((y) => y.year === CURRENT_YEAR);
  const prev = mefData?.byYear.find((y) => y.year === CURRENT_YEAR - 1);
  const ejPct = current ? ejecucionPct(current) : 0;
  const growthPct =
    current && prev && prev.pim > 0
      ? ((current.pim - prev.pim) / prev.pim) * 100
      : 0;
  const montoVigilado = region.monto;

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/app/mapa"
        className="inline-flex items-center gap-2 text-xs font-medium text-mute hover:text-ink"
      >
        <ArrowLeft size={13} /> Volver al mapa
      </Link>

      {/* HERO */}
      <header className="surface relative isolate overflow-hidden p-6">
        <div
          aria-hidden
          className="absolute -right-32 -top-32 -z-10 h-80 w-80 rounded-full bg-amber/8 blur-3xl"
        />
        <div className="grid items-end gap-6 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-paperDeep px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-clay">
              <MapPin size={11} /> Departamento del Perú
            </div>
            <h1 className="font-serif text-4xl font-bold leading-[1.02] text-ink sm:text-5xl">
              {region.nombre}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-mute">
              <span>
                <Users size={11} className="mr-1 inline" />
                {region.poblacion.toLocaleString("es-PE")} habitantes
              </span>
              <span>·</span>
              <span>{region.provincias.length} provincias</span>
              {mefData && mefData.totalRows > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {mefData.totalRows.toLocaleString("es-PE")} registros MEF
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Link
              href={`/reporte/nuevo?region=${encodeURIComponent(region.nombre)}`}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-rust px-4 py-2 text-sm font-medium text-paper hover:bg-rust/90"
            >
              Reportar algo aquí
            </Link>
            <a
              href="https://datosabiertos.mef.gob.pe/dataset/comparativo-gastos-2022-2026"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-line bg-paperSoft px-3 py-1.5 text-xs text-clay hover:bg-paperDeep"
            >
              <ExternalLink size={11} /> Dataset MEF
            </a>
          </div>
        </div>

        {/* KPI row */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            icon={<Coins size={14} />}
            label="PIM 2026"
            value={current ? formatPEN(current.pim) : "—"}
            sub={
              growthPct !== 0
                ? `${growthPct > 0 ? "+" : ""}${growthPct.toFixed(0)}% vs ${CURRENT_YEAR - 1}`
                : "presupuesto"
            }
            tone={growthPct > 0 ? "moss" : growthPct < 0 ? "rust" : "ink"}
          />
          <KpiCard
            icon={<LineChart size={14} />}
            label="Ejecución YTD"
            value={current ? `${ejPct.toFixed(0)}%` : "—"}
            sub={
              current
                ? `${formatPEN(current.devengado)} devengado`
                : "sin datos"
            }
            tone={ejPct < 40 ? "rust" : ejPct > 80 ? "moss" : "amber"}
          />
          <KpiCard
            icon={<AlertTriangle size={14} />}
            label="Alertas activas"
            value={region.alertas.toString()}
            sub={`${region.convergentes} converg. · ${region.reportes} reportes`}
            tone={region.alertas > 7 ? "rust" : "amber"}
          />
          <KpiCard
            icon={<Building2 size={14} />}
            label="Monto vigilado"
            value={formatSoles(montoVigilado)}
            sub={`${entidadesRegion.length} entidades`}
            tone="ink"
          />
        </div>
      </header>

      <DisclaimerBanner />

      {/* GRID PRINCIPAL — 2 columnas */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* COL IZQUIERDA — main (2/3) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Evolución presupuestal */}
          <section className="surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
                  Evolución presupuestal
                </div>
                <h2 className="font-serif text-lg font-bold text-ink">
                  PIM vs ejecutado · últimos 5 años
                </h2>
              </div>
              <span className="rounded-full border border-line bg-paperSoft px-2.5 py-1 text-[10px] text-mute">
                Fuente: MEF
              </span>
            </div>
            {mefData && mefData.byYear.length > 0 ? (
              <RegionEvolutionChart
                data={mefData.byYear}
                currentYear={CURRENT_YEAR}
              />
            ) : (
              <div className="flex h-40 items-center justify-center text-xs text-mute">
                Sin datos MEF para gráfico
              </div>
            )}
          </section>

          {/* Composición del gasto · sectores · pliegos · programas */}
          <section className="surface p-5">
            <Suspense
              fallback={
                <div className="flex h-40 items-center justify-center text-sm text-mute">
                  Cargando MEF…
                </div>
              }
            >
              <PresupuestoRegional mefDept={mefDept} />
            </Suspense>
          </section>
        </div>

        {/* COL DERECHA — sidebar (1/3) */}
        <aside className="space-y-4">
          <RegionRankingCard region={region} />
          <AlertasSeverityCard alertas={alertasRegion} />
          <ProvinciasBars provincias={region.provincias} />
        </aside>
      </div>

      {/* SECCIÓN INFERIOR — entidades + alertas en 2 cols */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Entidades vigiladas */}
        <section className="surface overflow-hidden p-0">
          <header className="flex items-center justify-between border-b border-line bg-paperDeep px-5 py-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-clay">
                Entidades vigiladas
              </div>
              <h3 className="font-serif text-lg font-bold text-ink">
                {entidadesRegion.length} con presencia
              </h3>
            </div>
            <span className="text-[10px] font-mono text-mute">
              top alertas →
            </span>
          </header>
          {entidadesRegion.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-mute">
              No hay entidades vigiladas en {region.nombre} aún.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {entidadesRegion.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/entidad/${e.ruc}`}
                    className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-paperDeep"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-clay group-hover:bg-paper">
                      <Building2 size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-mono text-mute">
                        RUC {e.ruc}
                      </div>
                      <div className="truncate text-sm font-semibold text-ink">
                        {e.nombre}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-ink">
                        {e.alertas}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider text-mute">
                        alertas
                      </div>
                    </div>
                    <div className="hidden text-right md:block">
                      <div className="font-mono text-xs font-semibold text-clay">
                        {formatSoles(e.monto)}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Casos detectados */}
        <section className="surface overflow-hidden p-0">
          <header className="flex items-center justify-between border-b border-line bg-paperDeep px-5 py-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-clay">
                Casos detectados
              </div>
              <h3 className="font-serif text-lg font-bold text-ink">
                {alertasRegion.length} alerta
                {alertasRegion.length === 1 ? "" : "s"} activa
                {alertasRegion.length === 1 ? "" : "s"}
              </h3>
            </div>
            <span className="text-[10px] font-mono text-mute">
              por score →
            </span>
          </header>
          {alertasRegion.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-mute">
              Sin alertas activas en {region.nombre}.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {[...alertasRegion]
                .sort((a, b) => b.score - a.score)
                .map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/alerta/${a.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-paperDeep"
                    >
                      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-ink text-paper">
                        <span className="text-base font-bold leading-none">
                          {a.score}
                        </span>
                        <span className="text-[8px] uppercase opacity-70">
                          score
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-mono text-mute">
                          {a.codigoconvocatoria} · {a.fechaBuenaPro}
                        </div>
                        <div className="line-clamp-2 text-xs font-medium text-ink">
                          {a.objeto}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.banderas.slice(0, 2).map((b) => (
                            <span
                              key={b.regla}
                              className={
                                "pill border " + severidadColor(b.severidad)
                              }
                            >
                              {b.regla.replaceAll("_", " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="hidden text-right md:block">
                        <div className="font-mono text-xs font-bold text-clay">
                          {formatSoles(a.montoSoles)}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone = "ink",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "rust" | "moss" | "amber";
}) {
  const toneCls = {
    ink: "border-line bg-paperSoft",
    rust: "border-rust/30 bg-crimson-soft",
    moss: "border-moss/30 bg-paperSoft",
    amber: "border-amber/40 bg-amber-soft",
  }[tone];
  const accent = {
    ink: "text-ink",
    rust: "text-rust",
    moss: "text-moss",
    amber: "text-amber",
  }[tone];
  return (
    <div className={cn("rounded-2xl border p-3", toneCls)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-mute">
          {label}
        </span>
        <span className={accent}>{icon}</span>
      </div>
      <div
        className={cn("mt-1 font-mono text-xl font-bold tabular-nums", accent)}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-mute">{sub}</div>}
    </div>
  );
}
