import { ejecucionPct, sinAnioRepetido, type MefBudgetSummary, type MefBudgetRow } from "@/lib/mef";
import { getEntityBudget } from "@/lib/mef-cache";
import { AlertCircle, Clock, Database, ExternalLink, Info, WifiOff } from "lucide-react";
import { FuenteDato } from "@/components/patrones";
import { numero, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";

const CONSULTA_AMIGABLE = "https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx";
const DATASET_MEF = "https://datosabiertos.mef.gob.pe/dataset/comparativo-gastos-2022-2026";

/**
 * Server component. Recibe un keyword (parte del nombre del pliego o ejecutora)
 * y muestra el presupuesto real consultado a MEF — Datos Abiertos.
 *
 * Vive en la ficha de una entidad, así que sus estados (lento, caído, sin
 * registros) van sin la llamita: la llamita no acompaña a nadie señalado
 * (DESIGN_SYSTEM.md §2.3). Una ejecución baja o por encima del PIM es una
 * observación del presupuesto, no una señal de Vigía: va en ámbar con ícono y
 * palabra, nunca en el rojo de las señales.
 */
export async function EjecucionPresupuestal({
  query,
  ruc,
  title,
  subtitle,
}: {
  query: string;
  /** Si pasas el RUC, primero buscamos en public/mef-entities.json */
  ruc?: string;
  title?: string;
  subtitle?: string;
}) {
  const result = await getEntityBudget(query, ruc);
  const titulo = title ?? "Ejecución presupuestal";

  // MEF API tardó demasiado → timeout (LIKE sin índice sobre 8M filas)
  if (result.kind === "timeout") {
    return (
      <section className="overflow-hidden rounded-2xl border border-line bg-paper">
        <Encabezado titulo={titulo} bajada="El MEF respondió lento y los datos no cargaron" />
        <div className="space-y-3 px-5 py-5">
          <div className="flex items-start gap-3 rounded-xl border border-line bg-paperSoft px-4 py-3">
            <Clock size={18} className="mt-0.5 shrink-0 text-inkSoft" aria-hidden />
            <p className="text-sm text-ink">
              <strong className="font-semibold">El portal de Datos Abiertos del MEF está respondiendo lento</strong> (más de
              28 segundos). Para encontrar a una entidad tiene que recorrer millones de filas, y a veces no termina a
              tiempo. Recarga la página en un minuto: cuando la consulta termina una vez, queda guardada por una hora.
            </p>
          </div>
          <details className="rounded-xl border border-line bg-paperSoft px-4 py-3 text-xs text-mute">
            <summary className="cursor-pointer font-semibold text-ink">¿Por qué pasa esto?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>El MEF no tiene un índice por nombre de entidad: con las entidades grandes, la búsqueda recorre millones de filas.</li>
              <li>El presupuesto por departamento ya está guardado y carga al instante en la pestaña Presupuesto del mapa.</li>
            </ul>
          </details>
          <p className="text-center text-xs text-mute">
            Buscado: <code className="font-mono text-ink">«{query}»</code>
          </p>
        </div>
      </section>
    );
  }

  if (result.kind === "error") {
    return (
      <section className="overflow-hidden rounded-2xl border border-line bg-paper">
        <Encabezado titulo={titulo} bajada="El MEF no está disponible ahora" />
        <div role="alert" className="m-5 rounded-xl border border-crimson/25 bg-crimson-soft/60 px-4 py-5 text-center text-sm">
          <WifiOff size={20} className="mx-auto mb-2 text-crimsonTexto" aria-hidden />
          <p className="font-semibold text-crimsonTexto">El portal de Datos Abiertos del MEF no respondió.</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-inkSoft">
            El portal del MEF se satura al consultar su conjunto de 8 millones de filas y por momentos devuelve error.
            Vuelve a intentarlo en unos segundos o consulta el dato directo en el MEF.
          </p>
          <a
            href={CONSULTA_AMIGABLE}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-[24px] items-center gap-1 text-xs font-semibold text-granate underline-offset-2 hover:underline"
          >
            Abrir la Consulta Amigable del MEF <ExternalLink size={11} aria-hidden />
          </a>
        </div>
      </section>
    );
  }

  if (result.kind === "empty") {
    return (
      <section className="overflow-hidden rounded-2xl border border-line bg-paper">
        <Encabezado titulo={titulo} bajada="Sin registros en los datos del MEF" />
        <div className="px-5 py-6 text-center text-sm text-mute">
          <Database size={20} className="mx-auto mb-2 text-mute" aria-hidden />
          <p>
            El MEF respondió, pero no hay coincidencias para <code className="font-mono text-ink">«{query}»</code>.
          </p>
          <p className="mt-1 text-xs">
            El nombre puede figurar distinto en el MEF (abreviaturas, mayúsculas), o el pliego no registra actividad
            presupuestal entre 2022 y 2026.
          </p>
        </div>
      </section>
    );
  }

  return <EjecucionView data={result.data} titulo={titulo} subtitle={subtitle} />;
}

/** Ejecución de un año cerrado por debajo de este porcentaje del PIM: se marca como observación. */
const EJECUCION_BAJA = 40;

function EjecucionView({ data, titulo, subtitle }: { data: MefBudgetSummary; titulo: string; subtitle?: string }) {
  // El año que el MEF todavía no publica (repite al anterior al centavo) no se muestra como dato.
  const { years: last5, repetido } = sinAnioRepetido(data.byYear);
  const current = last5[last5.length - 1];
  const prevYear = last5[last5.length - 2];
  const anioActual = new Date().getFullYear();

  const ejPct = ejecucionPct(current);
  const isUnderExecuted = current.pim > 0 && ejPct < EJECUCION_BAJA && current.year < anioActual;
  const isOverExecuted = current.pim > 0 && current.devengado > current.pim;

  // Crecimiento del PIM frente al año anterior (null si no hay con qué comparar).
  const growth = prevYear && prevYear.pim > 0 ? ((current.pim - prevYear.pim) / prevYear.pim) * 100 : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <Encabezado
        titulo={titulo}
        bajada={subtitle ?? `Pliego «${data.query}», ${numero(data.totalRows)} registros sumados del MEF`}
      />

      {/* Pliegos que coincidieron con la búsqueda */}
      {data.matchedPliegos.length > 0 && (
        <div className="border-b border-line bg-paperSoft px-5 py-3 text-xs">
          <p className="mb-1.5 font-semibold text-mute">Pliegos detectados: {numero(data.matchedPliegos.length)}</p>
          <div className="flex flex-wrap gap-1.5">
            {data.matchedPliegos.slice(0, 6).map((p, i) => (
              <span key={i} className="rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-ink">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {repetido && (
        <div className="flex items-start gap-2 border-b border-line bg-paperSoft px-5 py-2.5 text-xs leading-relaxed text-inkSoft">
          <Info size={14} className="mt-0.5 shrink-0 text-inkSoft" aria-hidden />
          <span>
            Las cifras de <strong className="text-ink">{repetido}</strong> todavía no están cargadas: en la copia
            descargada, {repetido} repite al centavo los valores de {repetido - 1}, así que no se muestran.
          </span>
        </div>
      )}

      {/* Cifras del último año con datos propios: compactas, son tarjetas. */}
      <dl className="grid grid-cols-2 gap-3 px-5 py-5 sm:grid-cols-4">
        <Dato etiqueta={`PIA ${current.year}`} valor={solesCompacto(current.pia)} contexto="Presupuesto aprobado al inicio del año" />
        <Dato
          etiqueta={`PIM ${current.year}`}
          valor={solesCompacto(current.pim)}
          contexto={
            growth != null && Math.round(growth * 10) !== 0
              ? `${growth > 0 ? "+" : "−"}${porcentaje(Math.abs(growth), { decimales: 1 })} frente a ${current.year - 1}`
              : "Presupuesto modificado"
          }
        />
        <Dato
          etiqueta="Devengado"
          valor={solesCompacto(current.devengado)}
          contexto={current.pim > 0 ? `${porcentaje(ejPct, { decimales: 1 })} del PIM` : "Sin PIM con qué comparar"}
          tono={isUnderExecuted || isOverExecuted ? "atencion" : ejPct >= 90 ? "positivo" : "neutro"}
        />
        <Dato
          etiqueta="Girado"
          valor={solesCompacto(current.girado)}
          contexto={current.pim > 0 ? `${porcentaje((current.girado / current.pim) * 100, { decimales: 1 })} del PIM` : "Sin PIM con qué comparar"}
        />
      </dl>

      {/* Observaciones del presupuesto: ámbar con ícono y palabra. No son señales de Vigía. */}
      {(isUnderExecuted || isOverExecuted) && (
        <div className="space-y-2 border-y border-amber/30 bg-amber-soft px-5 py-3 text-sm text-ink">
          {isUnderExecuted && (
            <p className="flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
              <span>
                <strong className="font-semibold text-amberTexto">Ejecución baja en {current.year}.</strong> Sólo se
                devengó el {porcentaje(ejPct, { decimales: 1 })} del PIM en un año ya cerrado. Puede deberse a obras
                paralizadas, a presupuesto que no se usó o a registros incompletos: es una pista para mirar, no una
                conclusión.
              </span>
            </p>
          )}
          {isOverExecuted && (
            <p className="flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
              <span>
                <strong className="font-semibold text-amberTexto">Devengado por encima del PIM.</strong> Puede reflejar
                modificaciones presupuestales todavía no registradas o un error en la copia de datos.
              </span>
            </p>
          )}
        </div>
      )}

      {/* Tabla por año: soles completos, una sola forma por columna (§10.3). */}
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <caption className="sr-only">Presupuesto y ejecución por año, en soles</caption>
          <thead className="bg-paperSoft text-left text-[12px] text-mute">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-semibold">Año</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">PIA</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">PIM</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Devengado</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Girado</th>
              <th scope="col" className="px-5 py-2.5 text-right font-semibold">Ejecución</th>
            </tr>
          </thead>
          <tbody>
            {last5.map((row) => (
              <FilaAnio key={row.year} row={row} anioActual={anioActual} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-paperSoft px-5 py-2.5 text-[12px] text-mute">
        <FuenteDato fuente="MEF, Datos Abiertos (comparativo de gastos 2022–2026)" fecha={data.fechaDescarga} href={DATASET_MEF} />
        <span>
          Suma de PIA, PIM, devengado y girado.
          {data.fechaDescarga ? "" : " La copia no registró su fecha de descarga."}
        </span>
      </div>
    </section>
  );
}

function FilaAnio({ row, anioActual }: { row: MefBudgetRow; anioActual: number }) {
  const pct = ejecucionPct(row);
  const baja = row.pim > 0 && pct < EJECUCION_BAJA && row.year < anioActual;
  return (
    <tr className="border-t border-line">
      <th scope="row" className="px-5 py-2 text-left font-mono font-semibold tabular-nums text-ink">
        {row.year}
      </th>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-inkSoft">{soles(row.pia)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{soles(row.pim)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{soles(row.devengado)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-inkSoft">{soles(row.girado)}</td>
      <td className="px-5 py-2 text-right">
        <PildoraEjecucion pct={pct} sinPim={row.pim === 0} baja={baja} />
      </td>
    </tr>
  );
}

function Encabezado({ titulo, bajada }: { titulo: string; bajada: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-line bg-paperSoft px-5 py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-granate text-paper" aria-hidden>
        <Database size={16} />
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-lg font-bold leading-tight text-ink">{titulo}</h3>
        <p className="mt-0.5 text-xs text-mute">{bajada}</p>
      </div>
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  contexto,
  tono = "neutro",
}: {
  etiqueta: string;
  valor: string;
  contexto: string;
  tono?: "neutro" | "atencion" | "positivo";
}) {
  const color = tono === "atencion" ? "text-amberTexto" : tono === "positivo" ? "text-mossTexto" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paperSoft p-3">
      <dt className="text-[12px] font-semibold text-mute">{etiqueta}</dt>
      <dd className={cn("mt-1 font-mono text-lg font-bold tabular-nums", color)}>{valor}</dd>
      <dd className="mt-0.5 text-[11px] leading-snug text-mute">{contexto}</dd>
    </div>
  );
}

/** Porcentaje de ejecución de un año. La baja lleva ícono y tono ámbar; alta, moss; sin PIM, "Sin dato". */
function PildoraEjecucion({ pct, sinPim, baja }: { pct: number; sinPim: boolean; baja: boolean }) {
  if (sinPim) return <span className="text-[11px] text-mute">Sin dato</span>;
  const estilo = baja
    ? "border-amber/40 bg-amber-soft text-amberTexto"
    : pct >= 90
      ? "border-moss/30 bg-moss/10 text-mossTexto"
      : "border-line bg-paperDeep text-inkSoft";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums", estilo)}>
      {baja && <AlertCircle size={10} aria-hidden />}
      {porcentaje(pct)}
      {baja && <span className="sr-only"> (ejecución baja)</span>}
    </span>
  );
}
