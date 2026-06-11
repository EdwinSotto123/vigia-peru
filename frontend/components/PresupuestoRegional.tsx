"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ENTIDADES } from "@/lib/mock-entities";
import {
  Database,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Building2,
  Layers,
  Briefcase,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
} from "lucide-react";
import {
  ejecucionPct,
  formatPEN,
  type RegionBudgetSummary,
  type BreakdownRow,
  type MefBudgetRow,
} from "@/lib/mef";
import { cn } from "@/lib/utils";

export function PresupuestoRegional({
  mefDept,
  compact = false,
  regionId,
}: {
  mefDept: string | null;
  /** Si true, oculta secciones avanzadas (sectores/pliegos/programas) y muestra botón "Ver más" */
  compact?: boolean;
  /** id interno de región para link a /region/[id]; requerido si compact=true */
  regionId?: string;
}) {
  const [data, setData] = useState<RegionBudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mefDept) {
      setLoading(false);
      setError("Departamento no mapeado a MEF");
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/mef/region/${encodeURIComponent(mefDept)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d: RegionBudgetSummary) => setData(d))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [mefDept]);

  if (loading) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-mute">
        <Loader2 size={20} className="animate-spin text-clay" />
        <span>Cargando datos MEF…</span>
        <span className="text-[10px] text-mute">
          Si no está cacheado, MEF puede tardar 1-2 min en responder
        </span>
      </div>
    );
  }

  if (error || !data || data.totalRows === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-paperDeep p-6 text-center">
        <Database size={20} className="mx-auto mb-2 text-mute" />
        <p className="text-sm text-mute">
          {error ? `MEF: ${error}` : `Sin datos para "${mefDept}".`}
        </p>
        <p className="mt-2 text-xs text-mute">
          El cache local de MEF no incluye este departamento. Para precachear corré:
        </p>
        <pre className="mx-auto mt-2 inline-block rounded-lg border border-line bg-paper px-3 py-1.5 text-left font-mono text-[10px] text-ink">
          python scripts/fetch_mef_budget.py --only "{mefDept}"
        </pre>
      </div>
    );
  }

  const TODAY = new Date();
  const CURRENT_YEAR = TODAY.getFullYear();
  // % del año transcurrido (cal. de ejecución natural)
  const yearStart = new Date(CURRENT_YEAR, 0, 1).getTime();
  const yearEnd = new Date(CURRENT_YEAR + 1, 0, 1).getTime();
  const yearProgressPct = ((TODAY.getTime() - yearStart) / (yearEnd - yearStart)) * 100;
  const todayLabel = TODAY.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const current = data.byYear[data.byYear.length - 1];
  const prev = data.byYear[data.byYear.length - 2];
  const ejPct = ejecucionPct(current);
  const isCurrentOpen = current.year === CURRENT_YEAR;
  const noEjec = Math.max(0, current.pim - current.devengado);
  const noEjecPct = current.pim > 0 ? (noEjec / current.pim) * 100 : 0;
  const growth = prev && prev.pim > 0 ? ((current.pim - prev.pim) / prev.pim) * 100 : 0;

  // Sub-ejecución solo aplica a años CERRADOS
  const isUnder = !isCurrentOpen && current.pim > 0 && ejPct < 40;
  // Para año en curso: avance del calendario vs ejecución
  const currentPaceVsCal = isCurrentOpen ? ejPct - yearProgressPct : 0;

  const yearsWithData = data.byYear.filter((y) => y.pim > 0);
  const closedYearsWithData = yearsWithData.filter((y) => y.year < CURRENT_YEAR);

  // Worst year SOLO entre cerrados (no compares año abierto)
  const worstYear = closedYearsWithData.reduce(
    (min, y) => {
      const pct = y.pim > 0 ? (y.devengado / y.pim) * 100 : 100;
      const minPct = min ? (min.devengado / min.pim) * 100 : 100;
      return pct < minPct ? y : min;
    },
    closedYearsWithData[0] as MefBudgetRow | undefined,
  );
  // No ejecutado acumulado SOLO de años cerrados
  const totalNoEjecutadoCerrados = closedYearsWithData.reduce(
    (s, y) => s + Math.max(0, y.pim - y.devengado),
    0,
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-line bg-paperDeep px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-clay">
          <Database size={11} /> MEF · Datos Abiertos
        </div>
        <h3 className="font-serif text-base font-bold text-ink">
          ¿Cuánto se gastó en {capitalize(data.department.toLowerCase())}?
        </h3>
        <p className="text-[11px] text-mute">
          {data.totalRows.toLocaleString("es-PE")} registros sumados desde MEF
        </p>
      </div>

      {/* Badge "EJERCICIO EN CURSO" */}
      {isCurrentOpen && (
        <div className="flex items-center gap-2 rounded-xl border border-amber/30 bg-amber-soft px-3 py-1.5 text-[11px]">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber" />
          <span className="font-semibold text-amber">EJERCICIO {current.year} EN CURSO</span>
          <span className="text-mute">·</span>
          <span className="text-mute">Datos al {todayLabel}</span>
          <span className="ml-auto text-mute">
            {yearProgressPct.toFixed(0)}% del año transcurrido
          </span>
        </div>
      )}

      {/* HERO STATS — los 3 datos clave */}
      <div className="grid grid-cols-3 gap-1.5">
        <HeroStat
          label={isCurrentOpen ? `Presupuesto ${current.year}` : `Presupuesto ${current.year} (cerrado)`}
          value={formatPEN(current.pim)}
          sub={
            growth !== 0
              ? `${growth > 0 ? "▲" : "▼"} ${Math.abs(growth).toFixed(0)}% vs ${current.year - 1}`
              : "modificado"
          }
        />
        <HeroStat
          label={isCurrentOpen ? "Devengado a la fecha" : "Ejecutado"}
          value={formatPEN(current.devengado)}
          sub={`${ejPct.toFixed(0)}% del PIM${isCurrentOpen ? " · YTD" : ""}`}
          tone={isUnder ? "rust" : ejPct > 80 ? "moss" : "amber"}
        />
        <HeroStat
          label={isCurrentOpen ? "Por ejecutar" : "Sin gastar"}
          value={formatPEN(noEjec)}
          sub={
            isCurrentOpen
              ? `${noEjecPct.toFixed(0)}% disponible`
              : `${noEjecPct.toFixed(0)}% no ejecutado`
          }
          tone={isCurrentOpen ? "ink" : noEjecPct > 50 ? "rust" : "ink"}
        />
      </div>

      {/* Pace indicator solo para año actual */}
      {isCurrentOpen && current.pim > 0 && (
        <div className="rounded-xl border border-line bg-paperSoft px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            {currentPaceVsCal > 15 ? (
              <>
                <TrendingUp size={14} className="text-moss" />
                <span className="text-ink">
                  <strong>Adelantado al calendario.</strong> Devengado {ejPct.toFixed(0)}% contra{" "}
                  {yearProgressPct.toFixed(0)}% del año transcurrido.
                </span>
              </>
            ) : currentPaceVsCal < -15 ? (
              <>
                <TrendingDown size={14} className="text-rust" />
                <span className="text-ink">
                  <strong className="text-rust">Atrás del calendario.</strong> Devengado{" "}
                  {ejPct.toFixed(0)}% pero ya transcurrió{" "}
                  {yearProgressPct.toFixed(0)}% del año.
                </span>
              </>
            ) : (
              <>
                <Minus size={14} className="text-mute" />
                <span className="text-ink">
                  Ejecución en línea con el calendario ({ejPct.toFixed(0)}% vs {yearProgressPct.toFixed(0)}% transcurrido).
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {isUnder && (
        <div className="flex items-start gap-2 rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2 text-xs text-rust">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>Sub-ejecución del cierre {current.year}</strong> — sólo {ejPct.toFixed(1)}% del PIM devengado al final del año.
          </span>
        </div>
      )}

      {/* Year-by-year breakdown bars */}
      <YearBreakdownBars years={data.byYear} currentYear={CURRENT_YEAR} />

      {/* Insights summary — solo cuenta años cerrados para "no ejecutado" */}
      {(closedYearsWithData.length > 0 || yearsWithData.length > 1) && (
        <div className="rounded-xl border border-line bg-paperSoft p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mute">
            Lectura rápida
          </div>
          <ul className="space-y-1 text-[11px] text-ink">
            {closedYearsWithData.length > 0 && (
              <li>
                <strong className="font-mono text-rust">{formatPEN(totalNoEjecutadoCerrados)}</strong>{" "}
                no se llegó a gastar en ejercicios cerrados ({closedYearsWithData[0].year}–{closedYearsWithData[closedYearsWithData.length - 1].year})
              </li>
            )}
            {worstYear && (
              <li>
                Año con menor ejecución (cerrados):{" "}
                <strong className="font-mono">{worstYear.year}</strong> con{" "}
                <strong className="font-mono">
                  {((worstYear.devengado / worstYear.pim) * 100).toFixed(0)}%
                </strong>{" "}
                · S/. {((worstYear.pim - worstYear.devengado) / 1_000_000).toFixed(0)}M quedaron sin gastar
              </li>
            )}
            {isCurrentOpen && (
              <li>
                Presupuesto vigente para <strong>{current.year}</strong>:{" "}
                <strong className="font-mono">{formatPEN(current.pim)}</strong>
                {growth !== 0 && (
                  <span className="text-mute">
                    {" "}
                    ({growth > 0 ? "+" : ""}{growth.toFixed(0)}% vs {current.year - 1})
                  </span>
                )}
              </li>
            )}
            {yearsWithData[0] && current.pim > 0 && yearsWithData[0].pim > 0 && (
              <li>
                Crecimiento PIM {yearsWithData[0].year}→{current.year}:{" "}
                <strong className="font-mono">
                  {(((current.pim - yearsWithData[0].pim) / yearsWithData[0].pim) * 100).toFixed(0)}%
                </strong>
              </li>
            )}
          </ul>
        </div>
      )}

      {compact ? (
        // ─── Modo sidebar: solo gastoria + CTA "Ver más" ───
        <>
          {data.topGenericas && data.topGenericas.length > 0 && (
            <TiposDeGasto items={data.topGenericas} compact />
          )}
          {regionId && (
            <Link
              href={`/region/${regionId}`}
              className="group flex items-center justify-between rounded-xl border-2 border-clay bg-amber-soft px-4 py-3 transition-colors hover:bg-clay hover:text-paper"
            >
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-clay group-hover:text-paper">
                  Análisis a fondo
                </div>
                <div className="text-sm font-bold text-ink group-hover:text-paper">
                  Ver detalle completo →
                </div>
                <div className="text-[10px] text-mute group-hover:text-paper/80">
                  sectores, pliegos, programas, entidades, casos…
                </div>
              </div>
              <ArrowRight size={20} className="text-clay group-hover:text-paper" />
            </Link>
          )}
        </>
      ) : (
        // ─── Modo página completa: 2x2 grid ───
        <div className="grid gap-4 lg:grid-cols-2">
          {data.topGenericas && data.topGenericas.length > 0 && (
            <TiposDeGasto items={data.topGenericas} />
          )}
          <BreakdownBlock
            title="¿En qué sectores?"
            subtitle="Top sectores · 2026"
            icon={<Layers size={12} />}
            items={data.topSectores}
            color="#A0512D"
          />
          <BreakdownBlock
            title="¿Quién lo ejecuta?"
            subtitle="Top entidades (pliegos) · clic en las vigiladas"
            icon={<Building2 size={12} />}
            items={data.topPliegos}
            color="#8B2A1E"
            linkPliego
          />
          <BreakdownBlock
            title="¿En qué programas?"
            subtitle="Top programas presupuestales · 2026"
            icon={<Briefcase size={12} />}
            items={data.topProgramas}
            color="#B5752C"
          />
        </div>
      )}

      <a
        href="https://datosabiertos.mef.gob.pe/dataset/comparativo-gastos-2022-2026"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[10px] text-clay hover:underline"
      >
        <ExternalLink size={10} />
        Fuente: MEF — comparativo_gastos_2022_2026
      </a>
    </div>
  );
}

function HeroStat({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "rust" | "moss" | "amber";
}) {
  const styles = {
    ink: "bg-paperSoft border-line text-ink",
    rust: "bg-crimson-soft border-rust/30 text-rust",
    moss: "border-moss/30 text-moss bg-paperSoft",
    amber: "bg-amber-soft border-amber/30 text-amber",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-2.5", styles)}>
      <div className="text-[9px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[15px] font-bold leading-tight tabular-nums">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[9px] opacity-75">{sub}</div>}
    </div>
  );
}

function YearBreakdownBars({
  years,
  currentYear,
}: {
  years: MefBudgetRow[];
  currentYear: number;
}) {
  const validYears = years.filter((y) => y.pim > 0);
  if (validYears.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mute">
            Año por año · ejecutado vs presupuesto
          </div>
          <div className="text-[10px] text-mute">
            {currentYear} aparece marcado como ejercicio en curso.
          </div>
        </div>
        <div className="flex items-center gap-2 text-[9px]">
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-clay" /> ejecutado
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-paperEdge" /> sin ejecutar
          </span>
        </div>
      </div>
      <ul className="space-y-2.5 rounded-xl border border-line bg-paperSoft p-3">
        {years.map((y) => {
          const ejPct = y.pim > 0 ? (y.devengado / y.pim) * 100 : 0;
          const noEj = Math.max(0, y.pim - y.devengado);
          const hasData = y.pim > 0;
          const isCurrent = y.year === currentYear;
          const isClosed = y.year < currentYear;
          return (
            <li key={y.year}>
              <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-ink">{y.year}</span>
                  {isCurrent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-1.5 py-0 text-[8.5px] font-bold uppercase tracking-wider text-amber">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
                      en curso
                    </span>
                  )}
                  {isClosed && (
                    <span className="rounded-full bg-paperDeep px-1.5 py-0 text-[8.5px] uppercase tracking-wider text-mute">
                      cerrado
                    </span>
                  )}
                </span>
                {hasData ? (
                  <span className="font-mono text-mute">
                    <span className="font-semibold text-ink">{formatPEN(y.devengado)}</span>
                    <span className="mx-1">/</span>
                    {formatPEN(y.pim)}
                  </span>
                ) : (
                  <span className="text-[10px] text-mute italic">sin datos</span>
                )}
              </div>
              {hasData && (
                <>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-paperEdge">
                    <div
                      className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-out"
                      style={{
                        width: `${ejPct}%`,
                        background: isCurrent
                          ? "repeating-linear-gradient(45deg, #A0512D 0 6px, #B86137 6px 12px)"
                          : ejPct < 40
                            ? "#7A2E18"
                            : ejPct < 70
                              ? "#B5752C"
                              : "#A0512D",
                      }}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9.5px]">
                    <span
                      className={cn(
                        "font-semibold",
                        isClosed && ejPct < 40 ? "text-rust" : "text-mute",
                      )}
                    >
                      {ejPct.toFixed(1)}% {isCurrent ? "devengado a la fecha" : "ejecutado"}
                    </span>
                    {noEj > 0 && (
                      <span className={isCurrent ? "text-mute" : "text-rust"}>
                        {formatPEN(noEj)} {isCurrent ? "por ejecutar" : "sin gastar"}
                      </span>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Tipos de gasto (GENERICA_NOMBRE) ──────────────────────

const GENERICA_LABELS: Record<
  string,
  { short: string; icon: string; color: string }
> = {
  "PERSONAL Y OBLIGACIONES SOCIALES": { short: "Planillas", icon: "💼", color: "#3B3127" },
  "PENSIONES Y OTRAS PRESTACIONES SOCIALES": { short: "Pensiones", icon: "👴", color: "#76695A" },
  "BIENES Y SERVICIOS": { short: "Bienes y servicios", icon: "🛒", color: "#B5752C" },
  "DONACIONES Y TRANSFERENCIAS": { short: "Transferencias", icon: "📤", color: "#A89887" },
  "OTROS GASTOS": { short: "Otros gastos", icon: "❓", color: "#D9CFB7" },
  "ADQUISICION DE ACTIVOS NO FINANCIEROS": { short: "Inversión (obras y activos)", icon: "🏗️", color: "#8B2A1E" },
  "ADQUISICION DE ACTIVOS FINANCIEROS": { short: "Activos financieros", icon: "💰", color: "#5C4F40" },
  "SERVICIO DE LA DEUDA PUBLICA": { short: "Deuda pública", icon: "📊", color: "#1B1611" },
};

function labelFor(nombre: string): { short: string; icon: string; color: string } {
  return (
    GENERICA_LABELS[nombre.toUpperCase()] ?? {
      short: capitalize(nombre.toLowerCase()),
      icon: "📂",
      color: "#76695A",
    }
  );
}

function TiposDeGasto({
  items,
  compact = false,
}: {
  items: BreakdownRow[];
  compact?: boolean;
}) {
  const total = items.reduce((s, i) => s + i.pim, 0);
  if (total === 0) return null;
  const visible = compact ? items.slice(0, 4) : items;

  return (
    <div>
      <div className="mb-1.5">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-mute">
          <Briefcase size={12} /> ¿En qué se gasta? · por tipo
        </div>
        <div className="text-[10px] text-mute">
          Genéricas de gasto · planillas, obras, bienes, etc.
        </div>
      </div>

      {/* Stacked bar */}
      <div className="rounded-xl border border-line bg-paperSoft p-3">
        <div className="flex h-4 w-full overflow-hidden rounded-full">
          {items.map((it, i) => {
            const meta = labelFor(it.nombre);
            const pct = (it.pim / total) * 100;
            if (pct < 0.5) return null;
            return (
              <div
                key={i}
                className="h-full transition-[width] duration-700"
                style={{ width: `${pct}%`, background: meta.color }}
                title={`${meta.short}: ${formatPEN(it.pim)} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>

        {/* Legend lista */}
        <ul className="mt-3 space-y-1.5">
          {visible.map((it, i) => {
            const meta = labelFor(it.nombre);
            const pct = (it.pim / total) * 100;
            const ejBad = it.ejecPct > 0 && it.ejecPct < 40;
            return (
              <li key={i}>
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className="text-sm">{meta.icon}</span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ background: meta.color }}
                    />
                    <span className="font-medium text-ink">{meta.short}</span>
                  </span>
                  <span className="font-mono text-[10px] text-mute">
                    {pct.toFixed(1)}%
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="font-mono text-[10.5px] text-ink">
                      {formatPEN(it.pim)}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0 text-[9px] font-bold",
                        ejBad
                          ? "bg-rust text-paper"
                          : it.ejecPct > 90
                            ? "bg-moss text-paper"
                            : "bg-paperDeep text-mute",
                      )}
                    >
                      {it.ejecPct.toFixed(0)}% ej.
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Hint sobre obras */}
        {items.find(
          (i) =>
            i.nombre.toUpperCase() === "ADQUISICION DE ACTIVOS NO FINANCIEROS",
        ) && (
          <div className="mt-3 rounded-lg border border-rust/20 bg-crimson-soft px-3 py-1.5 text-[10px] text-rust">
            <strong>Obras y activos</strong> (en rust) es la genérica donde
            típicamente se concentran las irregularidades. Compará % ejecutado
            con avance físico real de INFOBRAS.
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'"-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Busca una entidad en nuestro mock por nombre aproximado. */
function findEntidadByName(name: string) {
  const n = normalizeForMatch(name);
  return ENTIDADES.find((e) => {
    const en = normalizeForMatch(e.nombre);
    return en === n || en.includes(n.slice(0, 20)) || n.includes(en.slice(0, 20));
  });
}

function BreakdownBlock({
  title,
  subtitle,
  icon,
  items,
  color,
  linkPliego = false,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: BreakdownRow[];
  color: string;
  /** Si true, intenta linkear cada fila a /entidad/[ruc] cuando matchea */
  linkPliego?: boolean;
}) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.pim), 1);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-mute">
            {icon} {title}
          </div>
          <div className="text-[10px] text-mute">{subtitle}</div>
        </div>
      </div>
      <ul className="space-y-2 rounded-xl border border-line bg-paperSoft p-3">
        {items.map((it, i) => {
          const pct = (it.pim / max) * 100;
          const ejIsUnder = it.ejecPct > 0 && it.ejecPct < 40;
          const matchedEnt = linkPliego ? findEntidadByName(it.nombre) : null;

          const content = (
            <>
              <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px]">
                <span className="line-clamp-1 font-medium text-ink">
                  {it.nombre}
                  {matchedEnt && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-soft px-1.5 py-0 text-[8.5px] font-bold uppercase tracking-wider text-clay">
                      vigilada →
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-mute">{formatPEN(it.pim)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paperDeep">
                  <div
                    className="h-full transition-[width] duration-700 ease-out"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0 text-[9px] font-bold",
                    ejIsUnder ? "bg-rust text-paper" : it.ejecPct > 90 ? "bg-moss text-paper" : "bg-paperDeep text-mute",
                  )}
                >
                  {it.ejecPct.toFixed(0)}%
                </span>
              </div>
            </>
          );

          if (matchedEnt) {
            return (
              <li key={i}>
                <Link
                  href={`/entidad/${matchedEnt.ruc}`}
                  className="block rounded-lg p-1 -m-1 transition-colors hover:bg-paperDeep"
                >
                  {content}
                </Link>
              </li>
            );
          }

          return <li key={i}>{content}</li>;
        })}
      </ul>
    </div>
  );
}
