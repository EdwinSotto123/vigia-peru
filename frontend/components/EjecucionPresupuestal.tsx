import { ejecucionPct, sinAnioRepetido, type MefBudgetSummary, type MefBudgetRow } from "@/lib/mef";
import { getEntityBudget } from "@/lib/mef-cache";
import { AlertCircle, Clock, Database, ExternalLink, WifiOff } from "lucide-react";
import { Ayuda, FuenteDato } from "@/components/patrones";
import { numero, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";

const CONSULTA_AMIGABLE = "https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx";
const DATASET_MEF = "https://datosabiertos.mef.gob.pe/dataset/comparativo-gastos-2022-2026";

/**
 * Server component. Recibe un keyword (parte del nombre del pliego o ejecutora)
 * y muestra el presupuesto real consultado a MEF — Datos Abiertos.
 *
 * Vive plegado dentro de la ficha de una entidad, que ya le pone título ("Ejecución
 * presupuestal (MEF)"): aquí va el dato, sin repetir el encabezado. Dato primero
 * (DESIGN_SYSTEM.md §10.7): el último año en una línea, la tabla por año, y cada
 * explicación o aviso en una línea + ⓘ. Sus estados (lento, caído, sin registros)
 * van alineados a la izquierda y sin la llamita: la llamita no acompaña a nadie
 * señalado (§2.3). Una ejecución baja o por encima del PIM es una observación del
 * presupuesto, no una señal de Vigía: va en ámbar con ícono y palabra, nunca en el
 * rojo de las señales.
 */
export async function EjecucionPresupuestal({
  query,
  ruc,
}: {
  query: string;
  /** Si pasas el RUC, primero buscamos en public/mef-entities.json */
  ruc?: string;
}) {
  const result = await getEntityBudget(query, ruc);

  // MEF API tardó demasiado → timeout (LIKE sin índice sobre 8M filas)
  if (result.kind === "timeout") {
    return (
      <EstadoMef icono={<Clock size={16} className="text-inkSoft" aria-hidden />} query={query}>
        <strong className="font-semibold text-ink">El MEF respondió lento y los datos no cargaron.</strong> Recarga la
        página en un minuto.
        <Ayuda titulo="¿Por qué pasa esto?">
          <span className="block">
            El portal de Datos Abiertos del MEF no tiene un índice por nombre de entidad: con las entidades grandes, la
            búsqueda recorre millones de filas y a veces no termina a tiempo (más de 28 segundos). Cuando la consulta
            termina una vez, queda guardada por una hora.
          </span>
          <span className="mt-2 block text-mute">
            El presupuesto por departamento ya está guardado y carga al instante en la pestaña Presupuesto del mapa.
          </span>
        </Ayuda>
      </EstadoMef>
    );
  }

  if (result.kind === "error") {
    return (
      <EstadoMef icono={<WifiOff size={16} className="text-crimsonTexto" aria-hidden />} alerta>
        <strong className="font-semibold text-crimsonTexto">El portal de Datos Abiertos del MEF no respondió.</strong>{" "}
        Vuelve a intentarlo en unos segundos.
        <Ayuda titulo="¿Por qué no responde?">
          El portal del MEF se satura al consultar su conjunto de 8 millones de filas y por momentos devuelve error.
        </Ayuda>
        <a
          href={CONSULTA_AMIGABLE}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[24px] items-center gap-1 font-semibold text-granate underline-offset-2 hover:underline"
        >
          Consultar el dato en el MEF <ExternalLink size={11} aria-hidden />
        </a>
      </EstadoMef>
    );
  }

  if (result.kind === "empty") {
    return (
      <EstadoMef icono={<Database size={16} className="text-mute" aria-hidden />} query={query}>
        <strong className="font-semibold text-ink">Sin registros en los datos del MEF</strong> para este nombre.
        <Ayuda titulo="¿Por qué no hay registros?">
          El MEF respondió, pero sin coincidencias. El nombre puede figurar distinto en el MEF (abreviaturas,
          mayúsculas), o el pliego no registra actividad presupuestal entre 2022 y 2026.
        </Ayuda>
      </EstadoMef>
    );
  }

  return <EjecucionView data={result.data} />;
}

/** Un estado del MEF: una línea con ícono y ⓘ, alineada a la izquierda; qué se buscó, debajo. */
function EstadoMef({
  icono,
  query,
  alerta = false,
  children,
}: {
  icono: React.ReactNode;
  query?: string;
  alerta?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div role={alerta ? "alert" : undefined} className="space-y-1 px-4 py-3">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-inkSoft">
        {icono}
        {children}
      </p>
      {query && (
        <p className="text-xs text-mute">
          Buscado: <code className="font-mono text-ink">«{query}»</code>
        </p>
      )}
    </div>
  );
}

/** Ejecución de un año cerrado por debajo de este porcentaje del PIM: se marca como observación. */
const EJECUCION_BAJA = 40;

function EjecucionView({ data }: { data: MefBudgetSummary }) {
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
  const tonoDevengado = isUnderExecuted || isOverExecuted ? "text-amberTexto" : ejPct >= 90 ? "text-mossTexto" : "text-ink";

  return (
    <div>
      {/* El último año con datos propios, en UNA línea de datos (§10.7); la tabla de abajo trae todos. */}
      <div className="space-y-2 px-4 py-3">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] tabular-nums text-inkSoft">
          <span className="font-semibold text-ink">{current.year}</span>
          <span>
            PIA <strong className="font-semibold text-ink">{solesCompacto(current.pia)}</strong>
          </span>
          <span>
            PIM <strong className="font-semibold text-ink">{solesCompacto(current.pim)}</strong>
            {growth != null && Math.round(growth * 10) !== 0 && (
              <span className="text-mute">
                {" "}
                ({growth > 0 ? "+" : "−"}
                {porcentaje(Math.abs(growth), { decimales: 1 })} frente a {current.year - 1})
              </span>
            )}
          </span>
          <span>
            Devengado <strong className={cn("font-semibold", tonoDevengado)}>{solesCompacto(current.devengado)}</strong>
            <span className="text-mute">
              {current.pim > 0 ? ` (${porcentaje(ejPct, { decimales: 1 })} del PIM)` : " (sin PIM con qué comparar)"}
            </span>
          </span>
          <span>
            Girado <strong className="font-semibold text-ink">{solesCompacto(current.girado)}</strong>
            {current.pim > 0 && (
              <span className="text-mute"> ({porcentaje((current.girado / current.pim) * 100, { decimales: 1 })} del PIM)</span>
            )}
          </span>
          <Ayuda titulo="¿Qué son PIA, PIM, devengado y girado?">
            PIA: el presupuesto aprobado al inicio del año. PIM: el presupuesto modificado durante el año. Devengado: el gasto
            que la entidad ya reconoció como obligación de pago. Girado: lo que ya pagó.
          </Ayuda>
        </p>

        {/* Pliegos que coincidieron con la búsqueda, como chips. */}
        {data.matchedPliegos.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
            <span>
              {numero(data.matchedPliegos.length)} {data.matchedPliegos.length === 1 ? "pliego" : "pliegos"} ·{" "}
              {numero(data.totalRows)} registros sumados:
            </span>
            {data.matchedPliegos.slice(0, 6).map((p, i) => (
              <span key={i} className="rounded-full border border-line bg-paperSoft px-2 py-0.5 text-[11px] text-ink">
                {p}
              </span>
            ))}
          </div>
        )}

        {/* Avisos: una línea + ⓘ cada uno. Las observaciones del presupuesto van en ámbar: no son señales de Vigía. */}
        {repetido && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-inkSoft">
            Las cifras de {repetido} todavía no están cargadas.
            <Ayuda titulo={`¿Por qué no se muestra ${repetido}?`}>
              En la copia descargada, {repetido} repite al centavo los valores de {repetido - 1}, así que no se muestran.
            </Ayuda>
          </p>
        )}
        {isUnderExecuted && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink">
            <AlertCircle size={14} className="shrink-0 text-amberTexto" aria-hidden />
            <strong className="font-semibold text-amberTexto">Ejecución baja en {current.year}:</strong> se devengó el{" "}
            {porcentaje(ejPct, { decimales: 1 })} del PIM en un año ya cerrado.
            <Ayuda titulo="¿Qué puede explicar una ejecución baja?">
              Obras paralizadas, presupuesto que no se usó o registros incompletos. Es una pista para mirar, no una
              conclusión.
            </Ayuda>
          </p>
        )}
        {isOverExecuted && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink">
            <AlertCircle size={14} className="shrink-0 text-amberTexto" aria-hidden />
            <strong className="font-semibold text-amberTexto">Devengado por encima del PIM.</strong>
            <Ayuda titulo="¿Qué puede explicarlo?">
              Modificaciones presupuestales todavía no registradas o un error en la copia de datos.
            </Ayuda>
          </p>
        )}
      </div>

      {/* Tabla por año: soles completos, una sola forma por columna (§10.3). */}
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <caption className="sr-only">Presupuesto y ejecución por año, en soles</caption>
          <thead className="bg-paperSoft text-left text-[12px] text-mute">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Año</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">PIA</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">PIM</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Devengado</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Girado</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Ejecución</th>
            </tr>
          </thead>
          <tbody>
            {last5.map((row) => (
              <FilaAnio key={row.year} row={row} anioActual={anioActual} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-paperSoft px-4 py-2.5 text-[12px] text-mute">
        <FuenteDato fuente="MEF, Datos Abiertos (comparativo de gastos 2022–2026)" fecha={data.fechaDescarga} href={DATASET_MEF} />
        <span>
          Suma de PIA, PIM, devengado y girado.
          {data.fechaDescarga ? "" : " La copia no registró su fecha de descarga."}
        </span>
      </div>
    </div>
  );
}

function FilaAnio({ row, anioActual }: { row: MefBudgetRow; anioActual: number }) {
  const pct = ejecucionPct(row);
  const baja = row.pim > 0 && pct < EJECUCION_BAJA && row.year < anioActual;
  return (
    <tr className="border-t border-line">
      <th scope="row" className="px-4 py-2 text-left font-mono font-semibold tabular-nums text-ink">
        {row.year}
      </th>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-inkSoft">{soles(row.pia)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{soles(row.pim)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{soles(row.devengado)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-inkSoft">{soles(row.girado)}</td>
      <td className="px-4 py-2 text-right">
        <PildoraEjecucion pct={pct} sinPim={row.pim === 0} baja={baja} />
      </td>
    </tr>
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
