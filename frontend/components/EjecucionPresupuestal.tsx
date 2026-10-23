import { ejecucionPct, sinAnioRepetido, type MefBudgetSummary, type MefBudgetRow } from "@/lib/mef";
import { getEntityBudget } from "@/lib/mef-cache";
import { getGastoEntidad } from "@/lib/api-client";
import type { GastoEntidad } from "@/lib/mef";
import { EnQueGasta } from "@/components/EnQueGasta";
import { AlertCircle, Database, ExternalLink, WifiOff } from "lucide-react";
import { Ayuda, FuenteDato } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, IndicadoresSkeleton, Tabla, TablaSkeleton, type Columna, type Fila } from "@/components/listado";
import { numero, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";

const CONSULTA_AMIGABLE = "https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx";
const DATASET_MEF = "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto";

/**
 * Server component. Muestra el presupuesto del MEF de una entidad: el que Vigía carga cada semana desde
 * el archivo oficial de Datos Abiertos (presupuesto y ejecución de gasto) y sirve su API, cruzando la
 * entidad con sus unidades ejecutoras (por ubigeo, pliego regional o nombre).
 *
 * Vive en la sección "Cuánto gasta" de la ficha de una entidad, que ya le pone nombre y
 * bajada: aquí va el dato, sin repetir el encabezado. Primero, de dónde salen las cifras (su
 * unidad ejecutora, o todo el gobierno regional si no se identificó: migración 62). Después, el año en curso en una
 * sola barra (el presupuesto vigente, con lo pagado, lo gastado sin pagar, lo que falta y la marca del inicial):
 * antes eran cuatro cifras del mismo peso que no decían que son una misma cuenta. Luego en qué gasta, y al final
 * cada año en la `Tabla` del kit, con la ejecución como chip. Los avisos van en una línea + ⓘ. Sus estados (caído,
 * sin registros) van alineados a la izquierda y sin la llamita: la llamita no
 * acompaña a nadie señalado (§2.3). Una ejecución baja o por encima del PIM es una
 * observación del presupuesto, no una señal de Vigía: va en ámbar con ícono y palabra,
 * nunca en el rojo de las señales.
 */
export async function EjecucionPresupuestal({
  query,
  ruc,
}: {
  query: string;
  /** La entidad se busca por RUC en la API (GET /entidades/:ruc → `mef`); sin RUC no hay dato. */
  ruc?: string;
}) {
  // El desglose (en qué gasta) se pide a la vez: si falla, la sección sigue sin él.
  const [result, gasto] = await Promise.all([getEntityBudget(query, ruc), ruc ? getGastoEntidad(ruc) : Promise.resolve(null)]);

  if (result.kind === "error") {
    return (
      <EstadoMef icono={<WifiOff size={16} className="text-crimsonTexto" aria-hidden />} alerta>
        <strong className="font-semibold text-crimsonTexto">No pudimos cargar el presupuesto.</strong>{" "}
        Vuelve a intentarlo en unos segundos.
        <Ayuda titulo="¿Qué pasó?">
          El presupuesto de la entidad lo sirve Vigía (copia semanal del archivo oficial del MEF) y esta vez no
          respondió. El dato también se puede consultar directamente en el MEF.
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
        <strong className="font-semibold text-ink">Sin presupuesto del MEF</strong> para esta entidad.
        <Ayuda titulo="¿Por qué no hay registros?">
          No la encontramos entre las unidades ejecutoras del presupuesto público: el nombre puede figurar distinto en
          el MEF, o la entidad no ejecuta presupuesto propio. Las empresas del Estado (FONAFE) no están en este
          presupuesto.
        </Ayuda>
      </EstadoMef>
    );
  }

  return <EjecucionView data={result.data} gasto={gasto} />;
}

/**
 * Mientras carga: lo que se está haciendo, en palabras, y el esqueleto con la forma de las
 * cifras y la tabla. Sin la llamita a propósito: es la ficha de una entidad (§2.3).
 */
export function EjecucionPresupuestalSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <p className="text-dato leading-5 text-mute">Cargando el presupuesto del MEF…</p>
      <IndicadoresSkeleton n={4} />
      <TablaSkeleton columnas={COLUMNAS} filas={5} />
    </div>
  );
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
    <div role={alerta ? "alert" : undefined} className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-dato leading-5 text-inkSoft">
        {icono}
        {children}
      </p>
      {query && (
        <p className="text-rotulo leading-4 text-mute">
          Buscado: <code className="font-mono text-ink">«{query}»</code>
        </p>
      )}
    </div>
  );
}

/** Ejecución de un año cerrado por debajo de este porcentaje del PIM: se marca como observación. */
const EJECUCION_BAJA = 40;

/** Un año por fila: la ejecución (chip) · el año · los montos, completos y a la derecha (§10.3). */
const COLUMNAS: Columna[] = [
  {
    clave: "ejecucion",
    titulo: "Ejecución",
    ancho: "100px",
    ayuda: (
      <Ayuda titulo="¿Qué es la ejecución?">
        Devengado ÷ PIM del año. Por debajo del {EJECUCION_BAJA} % en un año ya cerrado se marca como ejecución baja.
      </Ayuda>
    ),
  },
  { clave: "anio", titulo: "Año", ancho: "minmax(0,1fr)" },
  { clave: "pia", titulo: "PIA", ancho: "140px", alinear: "der", desde: "lg" },
  { clave: "pim", titulo: "PIM", ancho: "140px", alinear: "der" },
  { clave: "devengado", titulo: "Devengado", ancho: "140px", alinear: "der", desde: "md" },
  { clave: "girado", titulo: "Girado", ancho: "140px", alinear: "der", desde: "lg" },
];

function EjecucionView({ data, gasto }: { data: MefBudgetSummary; gasto: GastoEntidad | null }) {
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
  // El año más reciente arriba: la primera fila es la de las cifras de cabecera.
  const filas: Fila[] = [...last5].reverse().map((row) => filaAnio(row, anioActual));

  return (
    <div className="space-y-4">
      <OrigenCifras data={data} />
      <BarraAnio row={current} growth={growth} alerta={isUnderExecuted || isOverExecuted} />

      {/* Avisos: una línea + ⓘ cada uno. Las observaciones del presupuesto van en ámbar: no son señales de Vigía. */}
      {(repetido || isUnderExecuted || isOverExecuted) && (
        <div className="space-y-1.5">
          {repetido && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-rotulo text-inkSoft">
              Las cifras de {repetido} todavía no están cargadas.
              <Ayuda titulo={`¿Por qué no se muestra ${repetido}?`}>
                En la copia descargada, {repetido} repite al centavo los valores de {repetido - 1}, así que no se muestran.
              </Ayuda>
            </p>
          )}
          {isUnderExecuted && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-meta text-ink">
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
            <p className="flex flex-wrap items-center gap-x-1.5 text-meta text-ink">
              <AlertCircle size={14} className="shrink-0 text-amberTexto" aria-hidden />
              <strong className="font-semibold text-amberTexto">Devengado por encima del PIM.</strong>
              <Ayuda titulo="¿Qué puede explicarlo?">
                Modificaciones presupuestales todavía no registradas o un error en la copia de datos.
              </Ayuda>
            </p>
          )}
        </div>
      )}

      {/* En qué gasta: lo que la gente pregunta después de "cuánto". */}
      <EnQueGasta gasto={gasto} />

      <section aria-labelledby="mef-por-anio" className="space-y-2">
        <h3 id="mef-por-anio" className="text-cuerpo font-semibold text-ink">
          Año por año
        </h3>
        <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Presupuesto y ejecución por año, en soles" />
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-mute">
        <FuenteDato fuente="MEF, Datos Abiertos (presupuesto y ejecución de gasto)" fecha={data.fechaDescarga} href={DATASET_MEF} />
        {!data.fechaDescarga && <span>La copia no registró su fecha de descarga.</span>}
      </div>
    </div>
  );
}

/**
 * De dónde salen las cifras, antes de las cifras. El MEF registra el presupuesto por unidad ejecutora y sin RUC: si la
 * entidad cruzó con la suya, se nombra; si es un gobierno regional que no se identificó, las cifras son las de TODO el
 * gobierno regional y se dice en ámbar, para que nadie las lea como el presupuesto de esta oficina.
 */
function OrigenCifras({ data }: { data: MefBudgetSummary }) {
  const unidades = data.matchedPliegos;
  if (data.cruce === "pliego") {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl border border-amber/40 bg-amber-soft px-3 py-2 text-meta text-ink">
        <AlertCircle size={14} className="shrink-0 text-amberTexto" aria-hidden />
        <strong className="font-semibold text-amberTexto">
          Son las cifras de todo el {data.pliego ? tituloNatural(data.pliego) : "gobierno regional"}
        </strong>
        ({numero(unidades.length)} unidades ejecutoras juntas): no identificamos cuál de ellas es esta entidad.
        <Ayuda titulo="¿Por qué no se ve el presupuesto de esta entidad?">
          El MEF publica el presupuesto por unidad ejecutora y sin RUC. Cada entidad regional se cruza con la suya por el
          código que trae su nombre, por ser la sede central o por un nombre casi igual; esta no coincidió con seguridad con
          ninguna, así que se muestra el total del gobierno regional como referencia.
        </Ayuda>
      </p>
    );
  }
  if (unidades.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-rotulo text-mute">
      <span>{unidades.length === 1 ? "Unidad ejecutora del MEF:" : `${numero(unidades.length)} unidades ejecutoras del MEF, sumadas:`}</span>
      {unidades.slice(0, 6).map((u) => (
        // Como lo escribe el MEF: es el nombre con que se la encuentra en su consulta.
        <span key={u} className="pill border-line bg-paperSoft text-ink">
          {u}
        </span>
      ))}
      {unidades.length > 6 && <span>y {numero(unidades.length - 6)} más</span>}
    </div>
  );
}

function filaAnio(row: MefBudgetRow, anioActual: number): Fila {
  const pct = ejecucionPct(row);
  const baja = row.pim > 0 && pct < EJECUCION_BAJA && row.year < anioActual;
  return {
    id: String(row.year),
    celdas: {
      ejecucion: <PildoraEjecucion pct={pct} sinPim={row.pim === 0} baja={baja} />,
      anio: <CeldaPrincipal titulo={String(row.year)} meta={row.year >= anioActual ? "en curso" : undefined} />,
      pia: <CeldaNumero>{soles(row.pia)}</CeldaNumero>,
      pim: <CeldaNumero>{soles(row.pim)}</CeldaNumero>,
      devengado: <CeldaNumero>{soles(row.devengado)}</CeldaNumero>,
      girado: <CeldaNumero>{soles(row.girado)}</CeldaNumero>,
    },
  };
}

/** Porcentaje de ejecución de un año. La baja lleva ícono y tono ámbar; alta, moss; sin PIM, "Sin dato". */
function PildoraEjecucion({ pct, sinPim, baja }: { pct: number; sinPim: boolean; baja: boolean }) {
  if (sinPim) return <span className="text-rotulo text-mute">Sin dato</span>;
  const estilo = baja
    ? "border-amber/40 bg-amber-soft text-amberTexto"
    : pct >= 90
      ? "border-moss/30 bg-moss/10 text-mossTexto"
      : "border-line bg-paperDeep text-inkSoft";
  return (
    <span className={cn("pill font-mono font-semibold tabular-nums", estilo)}>
      {baja && <AlertCircle size={11} aria-hidden />}
      {porcentaje(pct)}
      {baja && <span className="sr-only"> (ejecución baja)</span>}
    </span>
  );
}

/**
 * El año en una barra: es el presupuesto vigente (PIM). Lo pagado (girado) en el tono más fuerte, lo gastado que falta
 * pagar (devengado − girado) en uno medio y lo que queda por gastar en la pista; la marca vertical es el presupuesto
 * inicial (PIA), que el PIM suele pasar. Debajo, las cuatro cifras de la cuenta, cada una con su parte del PIM. Si la
 * ejecución es baja en un año cerrado o pasa el PIM, el porcentaje va en ámbar (observación, no señal).
 */
function BarraAnio({ row, growth, alerta }: { row: MefBudgetRow; growth: number | null; alerta: boolean }) {
  const pim = row.pim;
  const parte = (v: number) => (pim > 0 ? Math.max(0, Math.min(100, (v / pim) * 100)) : 0);
  const pagado = parte(row.girado);
  const gastado = parte(row.devengado);
  const marcaPia = pim > 0 && row.pia > 0 && row.pia <= pim ? (row.pia / pim) * 100 : null;
  const porGastar = Math.max(0, pim - row.devengado);
  const sinPagar = Math.max(0, row.devengado - row.girado);
  const pctDe = (v: number) => (pim > 0 ? (v / pim) * 100 : null);
  // Los tres tramos de la barra suman el PIM, en el orden en que se ven; el inicial es la marca.
  const cifras: { clave: string; etiqueta: string; valor: number; pct: number | null; muestra: string }[] = [
    { clave: "pagado", etiqueta: "Pagado (girado)", valor: row.girado, pct: pctDe(row.girado), muestra: "bg-granate" },
    { clave: "sinpagar", etiqueta: "Gastado, falta pagar", valor: sinPagar, pct: pctDe(sinPagar), muestra: "bg-granate/60" },
    { clave: "falta", etiqueta: "Por gastar", valor: porGastar, pct: pctDe(porGastar), muestra: "bg-granate/15 border border-line" },
    { clave: "inicial", etiqueta: "Inicial (PIA)", valor: row.pia, pct: null, muestra: "w-0.5 h-3 bg-ink" },
  ];
  return (
    <section aria-labelledby="mef-anio" className="rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="mef-anio" className="flex items-center gap-1.5 text-cuerpo font-semibold text-ink">
          Presupuesto {row.year}
          <Ayuda titulo="¿Qué son PIA, PIM, devengado y girado?">
            PIA: el presupuesto aprobado al inicio del año. PIM: el presupuesto modificado durante el año, el que vale. Devengado:
            el gasto que la entidad ya reconoció como obligación de pago. Girado: lo que ya pagó.
          </Ayuda>
        </h3>
        {growth != null && Math.round(growth * 10) !== 0 && (
          <span className="text-rotulo text-mute">
            {growth > 0 ? "+" : "−"}
            {porcentaje(Math.abs(growth), { decimales: 1 })} frente a {row.year - 1}
          </span>
        )}
      </div>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-cifra font-bold leading-tight tabular-nums text-ink sm:text-titulo">{solesCompacto(pim)}</span>
        <span className="text-meta text-inkSoft">
          de presupuesto vigente
          {pim > 0 ? (
            <>
              , del que ya gastó (devengado) <span className="font-semibold text-ink">{solesCompacto(row.devengado)}</span>:{" "}
              <span className={cn("font-semibold", alerta ? "text-amberTexto" : "text-ink")}>{porcentaje((row.devengado / pim) * 100, { decimales: 1 })}</span>
            </>
          ) : (
            ", sin PIM con qué comparar"
          )}
        </span>
      </p>
      {pim > 0 && (
        <div
          className="relative mt-3 h-3.5 w-full overflow-hidden rounded-full bg-granate/15"
          role="img"
          aria-label={`De ${solesCompacto(pim)}: ${solesCompacto(row.girado)} pagado, ${solesCompacto(row.devengado)} gastado, ${solesCompacto(porGastar)} por gastar; el inicial fue ${solesCompacto(row.pia)}`}
        >
          <span className="absolute inset-y-0 left-0 bg-granate/60" style={{ width: `${gastado}%` }} />
          <span className="absolute inset-y-0 left-0 bg-granate" style={{ width: `${pagado}%` }} />
          {marcaPia != null && <span aria-hidden className="absolute inset-y-0 w-0.5 bg-ink/80" style={{ left: `calc(${marcaPia}% - 1px)` }} />}
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
        {cifras.map((c) => (
          <div key={c.clave} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-rotulo text-mute">
              <span aria-hidden className={cn("inline-block shrink-0 rounded-sm", c.clave === "inicial" ? c.muestra : `h-2.5 w-2.5 ${c.muestra}`)} />
              {c.etiqueta}
            </dt>
            <dd className="mt-0.5 font-mono text-dato font-semibold tabular-nums text-ink">
              {solesCompacto(c.valor)}
              {c.pct != null && <span className="ml-1.5 font-sans text-rotulo font-normal text-mute">{porcentaje(c.pct, { decimales: 1 })}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
