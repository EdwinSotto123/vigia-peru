"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Building2,
  Clock,
  ExternalLink,
  Info,
  Layers,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { ejecucionPct, sinAnioRepetido, type BreakdownRow, type MefBudgetRow, type RegionBudgetSummary } from "@/lib/mef";
import { fechaCorta, numero, porcentaje, solesCompacto } from "@/lib/formato";
import { Cargando, EstadoVacio, FuenteDato } from "@/components/patrones";
import { cn } from "@/lib/utils";

const CONSULTA_AMIGABLE = "https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx";
const DATASET_MEF = "https://datosabiertos.mef.gob.pe/dataset/comparativo-gastos-2022-2026";

/** Un año cerrado que devengó menos que esto del PIM se marca como observación (no es una señal de Vigía). */
const EJECUCION_BAJA = 40;

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
 *
 * Y una de color (DESIGN_SYSTEM.md §3): una ejecución baja es una observación
 * del presupuesto, no una señal de Vigía, así que va en ámbar con ícono y
 * palabra, nunca en el rojo de las señales; lo bien ejecutado, en moss. Las
 * series por tipo de gasto usan la paleta textil (decoración categórica), no
 * colores sueltos.
 *
 * Todos los montos van compactos ("S/ 1.3 M"): esto es un panel de tarjetas,
 * no una tabla (§10.3), y en cada bloque hay un solo formato.
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
      <div className="space-y-2">
        <Cargando texto="Cargando el presupuesto del MEF…" lineas={4} />
        <p className="px-1 text-[12px] text-mute">Si es la primera consulta, el MEF puede tardar uno o dos minutos.</p>
      </div>
    );
  }

  if (error || !data || data.totalRows === 0) {
    return (
      <EstadoVacio
        compacto
        titulo={`Todavía no tenemos el presupuesto de ${nombreDepto}`}
        accion={
          <a
            href={CONSULTA_AMIGABLE}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-150 hover:border-granate/40 hover:bg-granate-50"
          >
            <ExternalLink size={12} aria-hidden /> Abrir la Consulta Amigable del MEF
          </a>
        }
      >
        El portal del MEF no respondió o no tiene registros para este departamento. Mientras tanto, puedes consultarlo
        directo en el MEF.
      </EstadoVacio>
    );
  }

  const TODAY = new Date();
  const CURRENT_YEAR = TODAY.getFullYear();
  // % del año transcurrido (calendario de ejecución natural)
  const yearStart = new Date(CURRENT_YEAR, 0, 1).getTime();
  const yearEnd = new Date(CURRENT_YEAR + 1, 0, 1).getTime();
  const yearProgressPct = ((TODAY.getTime() - yearStart) / (yearEnd - yearStart)) * 100;

  const { years, repetido } = sinAnioRepetido(data.byYear);

  const current = years[years.length - 1];
  const prev = years[years.length - 2];
  const ejPct = ejecucionPct(current);
  const isCurrentOpen = current.year === CURRENT_YEAR;
  const noEjec = Math.max(0, current.pim - current.devengado);
  const noEjecPct = current.pim > 0 ? (noEjec / current.pim) * 100 : 0;
  const growth = prev && prev.pim > 0 ? ((current.pim - prev.pim) / prev.pim) * 100 : null;

  // Ejecución baja solo aplica a años CERRADOS
  const isUnder = !isCurrentOpen && current.pim > 0 && ejPct < EJECUCION_BAJA;
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
  const variacion = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${porcentaje(Math.abs(x))}`;

  return (
    <div className="space-y-4">
      {/* Encabezado: la pregunta, y de dónde y de cuándo es el dato. */}
      <div>
        <h3 className="font-display text-base font-bold text-ink">¿Cuánto se gastó en {capitalize(data.department.toLowerCase())}?</h3>
        <p className="mt-0.5 text-[12px] text-mute">
          MEF, Datos Abiertos: {numero(data.totalRows)} registros sumados.{" "}
          {data.fechaDescarga ? `Descargados el ${fechaCorta(data.fechaDescarga)}.` : "La copia no registró su fecha de descarga."}
        </p>
      </div>

      {/* El año que el MEF todavía no publica: se dice, no se disfraza de dato. */}
      {repetido && (
        <div className="flex items-start gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2 text-[12px] leading-relaxed text-inkSoft">
          <Info size={14} className="mt-0.5 shrink-0 text-inkSoft" aria-hidden />
          <span>
            Las cifras de <strong className="text-ink">{repetido}</strong> todavía no están cargadas: en la copia
            descargada, {repetido} repite al centavo los valores de {repetido - 1}, así que no se muestran. Lo último
            cargado es el cierre de {current.year}.
          </span>
        </div>
      )}

      {/* Ejercicio en curso: sólo con cifras propias del año. Un estado, no una advertencia: tono neutro. */}
      {isCurrentOpen && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-paperSoft px-3 py-1.5 text-[12px]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Clock size={13} className="text-inkSoft" aria-hidden />
            Ejercicio {current.year} en curso
          </span>
          <span className="tabular-nums text-inkSoft sm:ml-auto">{porcentaje(yearProgressPct)} del año transcurrido</span>
        </div>
      )}

      {/* Los tres datos clave */}
      <dl className="grid grid-cols-1 gap-1.5 min-[400px]:grid-cols-3">
        <DatoClave
          etiqueta={isCurrentOpen ? `Presupuesto ${current.year}` : `Presupuesto ${current.year} (cerrado)`}
          valor={solesCompacto(current.pim)}
          contexto={growth != null && Math.round(growth) !== 0 ? `${variacion(growth)} frente a ${current.year - 1}` : "PIM, presupuesto modificado"}
        />
        <DatoClave
          etiqueta={isCurrentOpen ? "Devengado a la fecha" : "Ejecutado"}
          valor={solesCompacto(current.devengado)}
          contexto={`${porcentaje(ejPct)} del PIM${isCurrentOpen ? " a la fecha" : ""}`}
          tono={isUnder ? "atencion" : ejPct > 80 ? "positivo" : "neutro"}
        />
        <DatoClave
          etiqueta={isCurrentOpen ? "Por ejecutar" : "Sin gastar"}
          valor={solesCompacto(noEjec)}
          contexto={isCurrentOpen ? `${porcentaje(noEjecPct)} disponible` : `${porcentaje(noEjecPct)} del PIM no se ejecutó`}
          tono={!isCurrentOpen && noEjecPct > 50 ? "atencion" : "neutro"}
        />
      </dl>

      {/* Ritmo contra el calendario: sólo para un año en curso con cifras propias */}
      {isCurrentOpen && current.pim > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2 text-xs text-ink">
          {currentPaceVsCal > 15 ? (
            <>
              <TrendingUp size={14} className="mt-0.5 shrink-0 text-mossTexto" aria-hidden />
              <span>
                <strong className="font-semibold text-mossTexto">Adelantado al calendario.</strong> Devengado{" "}
                {porcentaje(ejPct)} contra {porcentaje(yearProgressPct)} del año transcurrido.
              </span>
            </>
          ) : currentPaceVsCal < -15 ? (
            <>
              <TrendingDown size={14} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
              <span>
                <strong className="font-semibold text-amberTexto">Atrás del calendario.</strong> Devengado{" "}
                {porcentaje(ejPct)}, pero ya transcurrió {porcentaje(yearProgressPct)} del año.
              </span>
            </>
          ) : (
            <>
              <Minus size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
              <span>
                Ejecución en línea con el calendario ({porcentaje(ejPct)} contra {porcentaje(yearProgressPct)}{" "}
                transcurrido).
              </span>
            </>
          )}
        </p>
      )}

      {isUnder && (
        <p className="flex items-start gap-2 rounded-xl border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-ink">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
          <span>
            <strong className="font-semibold text-amberTexto">Ejecución baja en el cierre de {current.year}:</strong>{" "}
            sólo el {porcentaje(ejPct, { decimales: 1 })} del PIM se devengó al final del año.
          </span>
        </p>
      )}

      {/* Año por año */}
      <BarrasPorAnio years={years} currentYear={CURRENT_YEAR} />

      {/* Lectura rápida: sólo cuenta años cerrados para "no ejecutado" */}
      {(closedYearsWithData.length > 0 || yearsWithData.length > 1) && (
        <div className="rounded-xl border border-line bg-paperSoft p-3">
          <p className="mb-1 text-[12px] font-semibold text-mute">Lectura rápida</p>
          <ul className="space-y-1 text-[12px] text-ink">
            {closedYearsWithData.length > 0 && (
              <li>
                <strong className="font-mono font-semibold tabular-nums">{solesCompacto(totalNoEjecutadoCerrados)}</strong> no
                se llegaron a gastar en ejercicios cerrados ({closedYearsWithData[0].year} a{" "}
                {closedYearsWithData[closedYearsWithData.length - 1].year}).
              </li>
            )}
            {worstYear && (
              <li>
                Año con menor ejecución (cerrados): <strong className="font-mono">{worstYear.year}</strong>, con{" "}
                <strong className="font-mono tabular-nums">{porcentaje((worstYear.devengado / worstYear.pim) * 100)}</strong>;{" "}
                {solesCompacto(worstYear.pim - worstYear.devengado)} quedaron sin gastar.
              </li>
            )}
            {isCurrentOpen && (
              <li>
                Presupuesto vigente para <strong>{current.year}</strong>:{" "}
                <strong className="font-mono tabular-nums">{solesCompacto(current.pim)}</strong>
                {growth != null && Math.round(growth) !== 0 && (
                  <span className="text-mute">
                    {" "}
                    ({variacion(growth)} frente a {current.year - 1})
                  </span>
                )}
              </li>
            )}
            {yearsWithData[0] && current.pim > 0 && yearsWithData[0].pim > 0 && yearsWithData[0].year !== current.year && (
              <li>
                Variación del PIM de {yearsWithData[0].year} a {current.year}:{" "}
                <strong className="font-mono tabular-nums">
                  {variacion(((current.pim - yearsWithData[0].pim) / yearsWithData[0].pim) * 100)}
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
              className="group flex items-center justify-between gap-3 rounded-2xl border border-granate/40 bg-granate-50 px-4 py-3 transition-colors duration-150 hover:bg-granate-soft"
            >
              <span>
                <span className="block text-sm font-bold text-ink">Ver el detalle completo</span>
                <span className="block text-[12px] text-mute">Sectores, pliegos, programas y entidades</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-granate transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}
        </>
      ) : (
        // Una columna: vive en un panel de 460 px, donde dos columnas no entran.
        <div className="grid gap-4">
          {data.topGenericas && data.topGenericas.length > 0 && <TiposDeGasto items={data.topGenericas} anio={current.year} />}
          <Desglose
            titulo="¿En qué sectores?"
            bajada={`Los de más presupuesto en ${current.year}`}
            icono={<Layers size={12} aria-hidden />}
            items={data.topSectores}
          />
          <Desglose
            titulo="¿Quién lo ejecuta?"
            bajada={`Las entidades (pliegos) con más presupuesto en ${current.year}`}
            icono={<Building2 size={12} aria-hidden />}
            items={data.topPliegos}
          />
          <Desglose
            titulo="¿En qué programas?"
            bajada={`Los programas presupuestales más grandes en ${current.year}`}
            icono={<Briefcase size={12} aria-hidden />}
            items={data.topProgramas}
          />
        </div>
      )}

      <FuenteDato fuente="MEF, Datos Abiertos (comparativo de gastos 2022–2026)" fecha={data.fechaDescarga} href={DATASET_MEF} />
    </div>
  );
}

function DatoClave({
  etiqueta,
  valor,
  contexto,
  tono = "neutro",
}: {
  etiqueta: string;
  valor: string;
  contexto?: string;
  tono?: "neutro" | "atencion" | "positivo";
}) {
  const estilo = {
    neutro: "border-line bg-paperSoft text-ink",
    atencion: "border-amber/30 bg-amber-soft text-amberTexto",
    positivo: "border-moss/30 bg-paperSoft text-mossTexto",
  }[tono];
  return (
    <div className={cn("rounded-xl border p-2.5", estilo)}>
      <dt className="text-[11px] font-semibold leading-tight">{etiqueta}</dt>
      <dd className="mt-0.5 font-mono text-[15px] font-bold leading-tight tabular-nums">{valor}</dd>
      {contexto && <dd className="mt-0.5 text-[11px] leading-snug">{contexto}</dd>}
    </div>
  );
}

/** Píldora del % ejecutado: baja (ámbar, con ícono), alta (moss), el resto neutra. */
function PildoraEjecucion({ pct, sufijo }: { pct: number; sufijo?: string }) {
  const baja = pct > 0 && pct < EJECUCION_BAJA;
  const estilo = baja
    ? "border-amber/40 bg-amber-soft text-amberTexto"
    : pct > 90
      ? "border-moss/30 bg-moss/10 text-mossTexto"
      : "border-line bg-paperDeep text-inkSoft";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] font-semibold tabular-nums", estilo)}>
      {baja && <AlertCircle size={10} aria-hidden />}
      {porcentaje(pct)}
      {sufijo}
      {baja && <span className="sr-only"> (ejecución baja)</span>}
    </span>
  );
}

function BarrasPorAnio({ years, currentYear }: { years: MefBudgetRow[]; currentYear: number }) {
  const validYears = years.filter((y) => y.pim > 0);
  if (validYears.length === 0) return null;
  const hayEnCurso = years.some((y) => y.year === currentYear && y.pim > 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-mute">Año por año: ejecutado contra presupuesto</p>
          <p className="text-[11px] text-mute">
            {hayEnCurso ? `${currentYear} aparece marcado como ejercicio en curso.` : "Todos los años que se muestran están cerrados."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-mute" aria-hidden>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-textil-anil" /> ejecutado
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
          const baja = isClosed && ejPct < EJECUCION_BAJA;
          return (
            <li key={y.year}>
              <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-ink">{y.year}</span>
                  {isCurrent && <span className="rounded-full border border-line bg-paper px-1.5 text-[11px] text-inkSoft">en curso</span>}
                  {isClosed && <span className="rounded-full bg-paperDeep px-1.5 text-[11px] text-inkSoft">cerrado</span>}
                </span>
                {hasData ? (
                  <span className="font-mono tabular-nums text-mute">
                    <span className="font-semibold text-ink">{solesCompacto(y.devengado)}</span>
                    <span className="mx-1 font-sans">de</span>
                    {solesCompacto(y.pim)}
                  </span>
                ) : (
                  <span className="text-[11px] text-mute">Sin dato</span>
                )}
              </div>
              {hasData && (
                <>
                  {/* La barra es el dibujo; el porcentaje y los montos de la línea de arriba son el dato. */}
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-paperEdge" aria-hidden>
                    <div
                      className={cn("absolute inset-y-0 left-0", baja ? "bg-amber" : "bg-textil-anil", isCurrent && "opacity-70")}
                      style={{ width: `${Math.min(100, ejPct)}%` }}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between gap-2 text-[11px]">
                    <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", baja ? "text-amberTexto" : "text-mute")}>
                      {baja && <AlertCircle size={10} aria-hidden />}
                      {porcentaje(ejPct, { decimales: 1 })} {isCurrent ? "devengado a la fecha" : "ejecutado"}
                      {baja && <span className="sr-only"> (ejecución baja)</span>}
                    </span>
                    {noEj > 0 && (
                      <span className="tabular-nums text-inkSoft">
                        {solesCompacto(noEj)} {isCurrent ? "por ejecutar" : "sin gastar"}
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
// Serie categórica en la paleta textil, en el orden de DESIGN_SYSTEM.md §3.4
// (añil, achiote, verde, ocre, granate, tierra; máximo seis). Lo que no entra
// en las seis va en gris: son las genéricas chicas.

const GENERICA_LABELS: Record<string, { corto: string; color: string }> = {
  "PERSONAL Y OBLIGACIONES SOCIALES": { corto: "Planillas", color: "bg-textil-anil" },
  "BIENES Y SERVICIOS": { corto: "Bienes y servicios", color: "bg-textil-achiote" },
  "ADQUISICION DE ACTIVOS NO FINANCIEROS": { corto: "Inversión (obras y activos)", color: "bg-textil-verde" },
  "PENSIONES Y OTRAS PRESTACIONES SOCIALES": { corto: "Pensiones", color: "bg-textil-ocre" },
  "DONACIONES Y TRANSFERENCIAS": { corto: "Transferencias", color: "bg-granate" },
  "SERVICIO DE LA DEUDA PUBLICA": { corto: "Deuda pública", color: "bg-textil-tierra" },
  "OTROS GASTOS": { corto: "Otros gastos", color: "bg-mute" },
  "ADQUISICION DE ACTIVOS FINANCIEROS": { corto: "Activos financieros", color: "bg-mute" },
};

function etiquetaGenerica(nombre: string): { corto: string; color: string } {
  return GENERICA_LABELS[nombre.toUpperCase()] ?? { corto: capitalize(nombre.toLowerCase()), color: "bg-mute" };
}

function TiposDeGasto({ items, anio, compact = false }: { items: BreakdownRow[]; anio: number; compact?: boolean }) {
  const total = items.reduce((s, i) => s + i.pim, 0);
  if (total === 0) return null;
  const visible = compact ? items.slice(0, 4) : items;

  return (
    <div>
      <div className="mb-1.5">
        <p className="flex items-center gap-1 text-[12px] font-semibold text-mute">
          <Briefcase size={12} aria-hidden /> ¿En qué se gasta? Por tipo
        </p>
        <p className="text-[11px] text-mute">Genéricas de gasto en {anio}: planillas, obras, bienes y otras.</p>
      </div>

      <div className="rounded-xl border border-line bg-paperSoft p-3">
        {/* La barra apilada es el dibujo; la lista de abajo es el dato, con nombre, monto y porcentaje. */}
        <div className="flex h-4 w-full gap-px overflow-hidden rounded-full" aria-hidden>
          {items.map((it, i) => {
            const meta = etiquetaGenerica(it.nombre);
            const pct = (it.pim / total) * 100;
            if (pct < 0.5) return null;
            return <div key={i} className={cn("h-full", meta.color)} style={{ width: `${pct}%` }} title={`${meta.corto}: ${solesCompacto(it.pim)} (${porcentaje(pct, { decimales: 1 })})`} />;
          })}
        </div>

        <ul className="mt-3 space-y-1.5">
          {visible.map((it, i) => {
            const meta = etiquetaGenerica(it.nombre);
            const pct = (it.pim / total) * 100;
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", meta.color)} aria-hidden />
                  <span className="font-medium text-ink">{meta.corto}</span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-mute">{porcentaje(pct, { decimales: 1 })}</span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="font-mono text-[12px] tabular-nums text-ink">{solesCompacto(it.pim)}</span>
                  <PildoraEjecucion pct={it.ejecPct} sufijo=" ejecutado" />
                </span>
              </li>
            );
          })}
        </ul>

        {items.find((i) => i.nombre.toUpperCase() === "ADQUISICION DE ACTIVOS NO FINANCIEROS") && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] text-inkSoft">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold text-ink">Inversión (obras y activos)</strong> es la genérica donde se
              concentran las obras públicas. Compara el porcentaje ejecutado con el avance físico que publica INFOBRAS.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

function Desglose({
  titulo,
  bajada,
  icono,
  items,
}: {
  titulo: string;
  bajada: string;
  icono: React.ReactNode;
  items: BreakdownRow[];
}) {
  // El MEF deja el nombre en blanco para parte del gasto: se nombra, no se imprime vacío.
  const filas = items.map((it) => ({ ...it, nombre: it.nombre.trim() || "Sin nombre en el MEF" }));
  if (filas.length === 0) return null;
  const max = Math.max(...filas.map((i) => i.pim), 1);

  return (
    <div>
      <div className="mb-1.5">
        <p className="flex items-center gap-1 text-[12px] font-semibold text-mute">
          {icono} {titulo}
        </p>
        <p className="text-[11px] text-mute">{bajada}. La píldora dice cuánto de su presupuesto ejecutó.</p>
      </div>
      <ul className="space-y-2 rounded-xl border border-line bg-paperSoft p-3">
        {filas.map((it, i) => (
          <li key={i}>
            <div className="mb-0.5 flex items-center justify-between gap-2 text-[12px]">
              <span className="line-clamp-1 font-medium text-ink">{it.nombre}</span>
              <span className="shrink-0 font-mono tabular-nums text-inkSoft">{solesCompacto(it.pim)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                <div className="h-full bg-textil-anil" style={{ width: `${(it.pim / max) * 100}%` }} />
              </div>
              <PildoraEjecucion pct={it.ejecPct} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
