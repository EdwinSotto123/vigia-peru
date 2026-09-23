"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  Info,
} from "lucide-react";
import {
  ejecucionPct,
  fechaCorta,
  formatPEN,
  sinAnioRepetido,
  type RegionBudgetSummary,
  type BreakdownRow,
  type MefBudgetRow,
} from "@/lib/mef";
import { cn } from "@/lib/utils";

const CONSULTA_AMIGABLE = "https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx";

/**
 * Presupuesto y ejecución de un departamento (MEF, Datos Abiertos), en la
 * pestaña Presupuesto del panel del mapa.
 *
 * Dos reglas que antes no se cumplían:
 * - Un año que repite al anterior al centavo no se presenta como dato
 *   (`sinAnioRepetido`): en la copia de hoy, 2026 es 2025 copiado, y el panel
 *   anunciaba "EJERCICIO 2026 EN CURSO" con el cierre de 2025.
 * - La fecha es la de la descarga, no la de hoy. Si la copia no la registró,
 *   se dice así.
 */
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
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!mefDept) {
      setLoading(false);
      setError(true);
      return;
    }
    let vivo = true;
    setLoading(true);
    setError(false);
    fetch(`/api/mef/region/${encodeURIComponent(mefDept)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((d: RegionBudgetSummary) => vivo && setData(d))
      .catch(() => vivo && setError(true))
      .finally(() => vivo && setLoading(false));
    return () => {
      vivo = false;
    };
  }, [mefDept]);

  const nombreDepto = mefDept ? capitalize(mefDept.toLowerCase()) : "este departamento";

  if (loading) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-mute" aria-busy>
        <Loader2 size={20} className="animate-spin text-heroViolet" aria-hidden />
        <span>Cargando el presupuesto del MEF…</span>
        <span className="text-[11px] text-mute">Si es la primera consulta, el MEF puede tardar uno o dos minutos.</span>
      </div>
    );
  }

  if (error || !data || data.totalRows === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-paperDeep p-6 text-center">
        <Database size={20} className="mx-auto mb-2 text-mute" aria-hidden />
        <p className="text-sm font-medium text-ink">Todavía no tenemos el presupuesto de {nombreDepto}</p>
        <p className="mx-auto mt-1 max-w-[40ch] text-[12px] leading-relaxed text-mute">
          El portal del MEF no respondió o no tiene registros para este departamento. Mientras tanto, puedes consultarlo
          directo en la Consulta Amigable del MEF.
        </p>
        <a
          href={CONSULTA_AMIGABLE}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-heroViolet hover:underline"
        >
          <ExternalLink size={12} aria-hidden /> Abrir la Consulta Amigable del MEF
        </a>
      </div>
    );
  }

  const TODAY = new Date();
  const CURRENT_YEAR = TODAY.getFullYear();
  // % del año transcurrido (calendario de ejecución natural)
  const yearStart = new Date(CURRENT_YEAR, 0, 1).getTime();
  const yearEnd = new Date(CURRENT_YEAR + 1, 0, 1).getTime();
  const yearProgressPct = ((TODAY.getTime() - yearStart) / (yearEnd - yearStart)) * 100;

  const { years, repetido } = sinAnioRepetido(data.byYear);
  const fecha = fechaCorta(data.fechaDescarga);

  const current = years[years.length - 1];
  const prev = years[years.length - 2];
  const ejPct = ejecucionPct(current);
  const isCurrentOpen = current.year === CURRENT_YEAR;
  const noEjec = Math.max(0, current.pim - current.devengado);
  const noEjecPct = current.pim > 0 ? (noEjec / current.pim) * 100 : 0;
  const growth = prev && prev.pim > 0 ? ((current.pim - prev.pim) / prev.pim) * 100 : 0;

  // Sub-ejecución solo aplica a años CERRADOS
  const isUnder = !isCurrentOpen && current.pim > 0 && ejPct < 40;
  // Para año en curso: avance del calendario vs ejecución
  const currentPaceVsCal = isCurrentOpen ? ejPct - yearProgressPct : 0;

  const yearsWithData = years.filter((y) => y.pim > 0);
  const closedYearsWithData = yearsWithData.filter((y) => y.year < CURRENT_YEAR);

  // Peor año SOLO entre cerrados (no se compara el año abierto)
  const worstYear = closedYearsWithData.reduce(
    (min, y) => {
      const pct = y.pim > 0 ? (y.devengado / y.pim) * 100 : 100;
      const minPct = min ? (min.devengado / min.pim) * 100 : 100;
      return pct < minPct ? y : min;
    },
    closedYearsWithData[0] as MefBudgetRow | undefined,
  );
  // No ejecutado acumulado SOLO de años cerrados
  const totalNoEjecutadoCerrados = closedYearsWithData.reduce((s, y) => s + Math.max(0, y.pim - y.devengado), 0);

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div>
        <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-line bg-paperDeep px-2.5 py-0.5 text-[11px] font-semibold text-heroViolet">
          <Database size={11} aria-hidden /> MEF, Datos Abiertos
        </div>
        <h3 className="font-serif text-base font-bold text-ink">¿Cuánto se gastó en {capitalize(data.department.toLowerCase())}?</h3>
        <p className="text-[12px] text-mute">
          {data.totalRows.toLocaleString("es-PE")} registros sumados del MEF.{" "}
          {fecha ? `Descargados el ${fecha}.` : "La copia no registró su fecha de descarga."}
        </p>
      </div>

      {/* El año que el MEF todavía no publica: se dice, no se disfraza de dato. */}
      {repetido && (
        <div className="flex items-start gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2 text-[12px] leading-relaxed text-inkSoft">
          <Info size={14} className="mt-0.5 shrink-0 text-heroViolet" aria-hidden />
          <span>
            Las cifras de <strong className="text-ink">{repetido}</strong> todavía no están cargadas: en la copia
            descargada, {repetido} repite al centavo los valores de {repetido - 1}, así que no se muestran. Lo último
            cargado es el cierre de {current.year}.
          </span>
        </div>
      )}

      {/* Ejercicio en curso: sólo con cifras propias del año. */}
      {isCurrentOpen && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber/30 bg-amber-soft px-3 py-1.5 text-[12px]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-amberTexto">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber motion-safe:animate-pulse" aria-hidden />
            Ejercicio {current.year} en curso
          </span>
          <span className="text-inkSoft sm:ml-auto">{yearProgressPct.toFixed(0)}% del año transcurrido</span>
        </div>
      )}

      {/* Los tres datos clave */}
      <div className="grid grid-cols-3 gap-1.5">
        <HeroStat
          label={isCurrentOpen ? `Presupuesto ${current.year}` : `Presupuesto ${current.year} (cerrado)`}
          value={formatPEN(current.pim)}
          sub={growth !== 0 ? `${growth > 0 ? "▲" : "▼"} ${Math.abs(growth).toFixed(0)}% frente a ${current.year - 1}` : "modificado"}
        />
        <HeroStat
          label={isCurrentOpen ? "Devengado a la fecha" : "Ejecutado"}
          value={formatPEN(current.devengado)}
          sub={`${ejPct.toFixed(0)}% del PIM${isCurrentOpen ? " a la fecha" : ""}`}
          tone={isUnder ? "rust" : ejPct > 80 ? "moss" : "amber"}
        />
        <HeroStat
          label={isCurrentOpen ? "Por ejecutar" : "Sin gastar"}
          value={formatPEN(noEjec)}
          sub={isCurrentOpen ? `${noEjecPct.toFixed(0)}% disponible` : `${noEjecPct.toFixed(0)}% no ejecutado`}
          tone={isCurrentOpen ? "ink" : noEjecPct > 50 ? "rust" : "ink"}
        />
      </div>

      {/* Ritmo contra el calendario: sólo para un año en curso con cifras propias */}
      {isCurrentOpen && current.pim > 0 && (
        <div className="rounded-xl border border-line bg-paperSoft px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            {currentPaceVsCal > 15 ? (
              <>
                <TrendingUp size={14} className="text-moss" aria-hidden />
                <span className="text-ink">
                  <strong>Adelantado al calendario.</strong> Devengado {ejPct.toFixed(0)}% contra{" "}
                  {yearProgressPct.toFixed(0)}% del año transcurrido.
                </span>
              </>
            ) : currentPaceVsCal < -15 ? (
              <>
                <TrendingDown size={14} className="text-rust" aria-hidden />
                <span className="text-ink">
                  <strong className="text-rust">Atrás del calendario.</strong> Devengado {ejPct.toFixed(0)}% pero ya
                  transcurrió {yearProgressPct.toFixed(0)}% del año.
                </span>
              </>
            ) : (
              <>
                <Minus size={14} className="text-mute" aria-hidden />
                <span className="text-ink">
                  Ejecución en línea con el calendario ({ejPct.toFixed(0)}% contra {yearProgressPct.toFixed(0)}%
                  transcurrido).
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {isUnder && (
        <div className="flex items-start gap-2 rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2 text-xs text-crimsonTexto">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <strong>Sub-ejecución del cierre {current.year}:</strong> sólo {ejPct.toFixed(1)}% del PIM devengado al final
            del año.
          </span>
        </div>
      )}

      {/* Año por año */}
      <YearBreakdownBars years={years} currentYear={CURRENT_YEAR} />

      {/* Lectura rápida: sólo cuenta años cerrados para "no ejecutado" */}
      {(closedYearsWithData.length > 0 || yearsWithData.length > 1) && (
        <div className="rounded-xl border border-line bg-paperSoft p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-mute">Lectura rápida</div>
          <ul className="space-y-1 text-[12px] text-ink">
            {closedYearsWithData.length > 0 && (
              <li>
                <strong className="font-mono text-crimsonTexto">{formatPEN(totalNoEjecutadoCerrados)}</strong> no se llegó
                a gastar en ejercicios cerrados ({closedYearsWithData[0].year} a{" "}
                {closedYearsWithData[closedYearsWithData.length - 1].year})
              </li>
            )}
            {worstYear && (
              <li>
                Año con menor ejecución (cerrados): <strong className="font-mono">{worstYear.year}</strong> con{" "}
                <strong className="font-mono">{((worstYear.devengado / worstYear.pim) * 100).toFixed(0)}%</strong>, y{" "}
                {formatPEN(worstYear.pim - worstYear.devengado)} quedaron sin gastar
              </li>
            )}
            {isCurrentOpen && (
              <li>
                Presupuesto vigente para <strong>{current.year}</strong>:{" "}
                <strong className="font-mono">{formatPEN(current.pim)}</strong>
                {growth !== 0 && (
                  <span className="text-mute">
                    {" "}
                    ({growth > 0 ? "+" : ""}
                    {growth.toFixed(0)}% frente a {current.year - 1})
                  </span>
                )}
              </li>
            )}
            {yearsWithData[0] && current.pim > 0 && yearsWithData[0].pim > 0 && yearsWithData[0].year !== current.year && (
              <li>
                Crecimiento del PIM de {yearsWithData[0].year} a {current.year}:{" "}
                <strong className="font-mono">
                  {(((current.pim - yearsWithData[0].pim) / yearsWithData[0].pim) * 100).toFixed(0)}%
                </strong>
              </li>
            )}
          </ul>
        </div>
      )}

      {compact ? (
        // Modo compacto: sólo tipos de gasto + enlace "Ver más"
        <>
          {data.topGenericas && data.topGenericas.length > 0 && <TiposDeGasto items={data.topGenericas} anio={current.year} compact />}
          {regionId && (
            <Link
              href={`/region/${regionId}`}
              className="group flex items-center justify-between rounded-xl border-2 border-heroViolet bg-heroViolet-soft px-4 py-3 transition-colors hover:bg-heroViolet hover:text-paper"
            >
              <div>
                <div className="text-[11px] font-semibold text-heroViolet group-hover:text-paper">Análisis a fondo</div>
                <div className="text-sm font-bold text-ink group-hover:text-paper">Ver el detalle completo</div>
                <div className="text-[11px] text-mute group-hover:text-paper/80">sectores, pliegos, programas y entidades</div>
              </div>
              <ArrowRight size={20} className="text-heroViolet group-hover:text-paper" aria-hidden />
            </Link>
          )}
        </>
      ) : (
        // Una columna: vive en un panel de 460 px, donde dos columnas no entran.
        <div className="grid gap-4">
          {data.topGenericas && data.topGenericas.length > 0 && <TiposDeGasto items={data.topGenericas} anio={current.year} />}
          <BreakdownBlock
            title="¿En qué sectores?"
            subtitle={`Los de más presupuesto en ${current.year}`}
            icon={<Layers size={12} aria-hidden />}
            items={data.topSectores}
            color="#A0512D"
          />
          <BreakdownBlock
            title="¿Quién lo ejecuta?"
            subtitle={`Las entidades (pliegos) con más presupuesto en ${current.year}`}
            icon={<Building2 size={12} aria-hidden />}
            items={data.topPliegos}
            color="#8B2A1E"
          />
          <BreakdownBlock
            title="¿En qué programas?"
            subtitle={`Los programas presupuestales más grandes en ${current.year}`}
            icon={<Briefcase size={12} aria-hidden />}
            items={data.topProgramas}
            color="#B5752C"
          />
        </div>
      )}

      <a
        href="https://datosabiertos.mef.gob.pe/dataset/comparativo-gastos-2022-2026"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-heroViolet hover:underline"
      >
        <ExternalLink size={10} aria-hidden />
        Fuente: MEF, comparativo de gastos 2022-2026
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
    rust: "bg-crimson-soft border-rust/30 text-crimsonTexto",
    moss: "border-moss/30 text-mossTexto bg-paperSoft",
    amber: "bg-amber-soft border-amber/30 text-amberTexto",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-2.5", styles)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider">{label}</div>
      <div className="mt-0.5 font-mono text-[15px] font-bold leading-tight tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[10px]">{sub}</div>}
    </div>
  );
}

function YearBreakdownBars({ years, currentYear }: { years: MefBudgetRow[]; currentYear: number }) {
  const validYears = years.filter((y) => y.pim > 0);
  if (validYears.length === 0) return null;
  const hayEnCurso = years.some((y) => y.year === currentYear && y.pim > 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-mute">Año por año: ejecutado contra presupuesto</div>
          <div className="text-[11px] text-mute">
            {hayEnCurso ? `${currentYear} aparece marcado como ejercicio en curso.` : "Todos los años que se muestran están cerrados."}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-mute">
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-clay" aria-hidden /> ejecutado
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-paperEdge" aria-hidden /> sin ejecutar
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
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-1.5 py-0 text-[10px] font-bold text-amberTexto">
                      en curso
                    </span>
                  )}
                  {isClosed && <span className="rounded-full bg-paperDeep px-1.5 py-0 text-[10px] text-inkSoft">cerrado</span>}
                </span>
                {hasData ? (
                  <span className="font-mono text-mute">
                    <span className="font-semibold text-ink">{formatPEN(y.devengado)}</span>
                    <span className="mx-1">de</span>
                    {formatPEN(y.pim)}
                  </span>
                ) : (
                  <span className="text-[11px] italic text-mute">sin datos</span>
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
                  <div className="mt-0.5 flex justify-between text-[10px]">
                    <span className={cn("font-semibold", isClosed && ejPct < 40 ? "text-crimsonTexto" : "text-mute")}>
                      {ejPct.toFixed(1)}% {isCurrent ? "devengado a la fecha" : "ejecutado"}
                    </span>
                    {noEj > 0 && (
                      <span className={isCurrent ? "text-mute" : "text-crimsonTexto"}>
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
  return s.replace(/(^|\s)(\p{L})/gu, (_m, esp: string, c: string) => esp + c.toUpperCase());
}

// ─── Tipos de gasto (GENERICA_NOMBRE) ──────────────────────

const GENERICA_LABELS: Record<string, { short: string; icon: string; color: string }> = {
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

function TiposDeGasto({ items, anio, compact = false }: { items: BreakdownRow[]; anio: number; compact?: boolean }) {
  const total = items.reduce((s, i) => s + i.pim, 0);
  if (total === 0) return null;
  const visible = compact ? items.slice(0, 4) : items;

  return (
    <div>
      <div className="mb-1.5">
        <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-mute">
          <Briefcase size={12} aria-hidden /> ¿En qué se gasta? Por tipo
        </div>
        <div className="text-[11px] text-mute">Genéricas de gasto en {anio}: planillas, obras, bienes y otras.</div>
      </div>

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

        <ul className="mt-3 space-y-1.5">
          {visible.map((it, i) => {
            const meta = labelFor(it.nombre);
            const pct = (it.pim / total) * 100;
            const ejBad = it.ejecPct > 0 && it.ejecPct < 40;
            return (
              <li key={i}>
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className="text-sm" aria-hidden>
                    {meta.icon}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: meta.color }} aria-hidden />
                    <span className="font-medium text-ink">{meta.short}</span>
                  </span>
                  <span className="font-mono text-[10px] text-mute">{pct.toFixed(1)}%</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="font-mono text-[11px] text-ink">{formatPEN(it.pim)}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0 text-[10px] font-bold",
                        ejBad ? "bg-rust text-paper" : it.ejecPct > 90 ? "bg-moss text-paper" : "bg-paperDeep text-inkSoft",
                      )}
                    >
                      {it.ejecPct.toFixed(0)}% ejecutado
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {items.find((i) => i.nombre.toUpperCase() === "ADQUISICION DE ACTIVOS NO FINANCIEROS") && (
          <div className="mt-3 rounded-lg border border-rust/20 bg-crimson-soft px-3 py-1.5 text-[11px] text-crimsonTexto">
            <strong>Obras y activos</strong> es la genérica donde se concentran las obras públicas. Compara el % ejecutado
            con el avance físico real que publica INFOBRAS.
          </div>
        )}
      </div>
    </div>
  );
}

function BreakdownBlock({
  title,
  subtitle,
  icon,
  items,
  color,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: BreakdownRow[];
  color: string;
}) {
  // El MEF deja el nombre en blanco para parte del gasto: se nombra, no se imprime vacío.
  const filas = items.map((it) => ({ ...it, nombre: it.nombre.trim() || "Sin nombre en el MEF" }));
  if (filas.length === 0) return null;
  const max = Math.max(...filas.map((i) => i.pim), 1);

  return (
    <div>
      <div className="mb-1.5">
        <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-mute">
          {icon} {title}
        </div>
        <div className="text-[11px] text-mute">{subtitle}</div>
      </div>
      <ul className="space-y-2 rounded-xl border border-line bg-paperSoft p-3">
        {filas.map((it, i) => {
          const pct = (it.pim / max) * 100;
          const ejIsUnder = it.ejecPct > 0 && it.ejecPct < 40;
          return (
            <li key={i}>
              <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px]">
                <span className="line-clamp-1 font-medium text-ink">{it.nombre}</span>
                <span className="shrink-0 font-mono text-mute">{formatPEN(it.pim)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paperDeep">
                  <div className="h-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: color }} />
                </div>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0 text-[10px] font-bold",
                    ejIsUnder ? "bg-rust text-paper" : it.ejecPct > 90 ? "bg-moss text-paper" : "bg-paperDeep text-inkSoft",
                  )}
                >
                  {it.ejecPct.toFixed(0)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
