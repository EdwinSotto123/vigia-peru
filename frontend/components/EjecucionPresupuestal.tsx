import { ejecucionPct, sinAnioRepetido, type MefBudgetSummary, type MefBudgetRow } from "@/lib/mef";
import { getEntityBudget } from "@/lib/mef-cache";
import { getGastoEntidad } from "@/lib/api-client";
import type { GastoEntidad } from "@/lib/mef";
import { EnQueGasta } from "@/components/EnQueGasta";
import { AlertCircle, Database, ExternalLink, WifiOff } from "lucide-react";
import { Ayuda, FuenteDato } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Indicadores, IndicadoresSkeleton, Tabla, TablaSkeleton, type Columna, type Fila, type Indicador } from "@/components/listado";
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
 * unidad ejecutora, o todo el gobierno regional si no se identificó: migración 62). Plantilla Ficha (§14.2):
 * el último año como `Indicadores` (número → qué es → contexto), los avisos en una línea
 * + ⓘ, y cada año en la `Tabla` del kit, con la ejecución como chip. Sus estados (caído,
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
      <p className="text-sm text-mute">Cargando el presupuesto del MEF…</p>
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
  const tonoDevengado: Indicador["tono"] = isUnderExecuted || isOverExecuted ? "media" : ejPct >= 90 ? "positivo" : "neutro";
  const sinPim = "sin PIM con qué comparar";

  // El último año con datos propios, cifra por cifra; la tabla de abajo trae todos.
  const indicadores: Indicador[] = [
    {
      valor: solesCompacto(current.pia),
      etiqueta: `PIA ${current.year}`,
      contexto: "presupuesto inicial",
      ayuda: (
        <Ayuda titulo="¿Qué son PIA, PIM, devengado y girado?">
          PIA: el presupuesto aprobado al inicio del año. PIM: el presupuesto modificado durante el año. Devengado: el gasto
          que la entidad ya reconoció como obligación de pago. Girado: lo que ya pagó.
        </Ayuda>
      ),
    },
    {
      valor: solesCompacto(current.pim),
      etiqueta: `PIM ${current.year}`,
      contexto:
        growth != null && Math.round(growth * 10) !== 0
          ? `${growth > 0 ? "+" : "−"}${porcentaje(Math.abs(growth), { decimales: 1 })} frente a ${current.year - 1}`
          : "presupuesto modificado",
    },
    {
      valor: solesCompacto(current.devengado),
      etiqueta: `devengado en ${current.year}`,
      contexto: current.pim > 0 ? `${porcentaje(ejPct, { decimales: 1 })} del PIM` : sinPim,
      tono: tonoDevengado,
    },
    {
      valor: solesCompacto(current.girado),
      etiqueta: `girado en ${current.year}`,
      contexto: current.pim > 0 ? `${porcentaje((current.girado / current.pim) * 100, { decimales: 1 })} del PIM` : sinPim,
    },
  ];

  // El año más reciente arriba: la primera fila es la de las cifras de cabecera.
  const filas: Fila[] = [...last5].reverse().map((row) => filaAnio(row, anioActual));

  return (
    <div className="space-y-4">
      <OrigenCifras data={data} />
      <Indicadores items={indicadores} />

      {/* Avisos: una línea + ⓘ cada uno. Las observaciones del presupuesto van en ámbar: no son señales de Vigía. */}
      {(repetido || isUnderExecuted || isOverExecuted) && (
        <div className="space-y-1.5">
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
      )}

      {/* En qué gasta: lo que la gente pregunta después de "cuánto". */}
      <EnQueGasta gasto={gasto} />

      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Presupuesto y ejecución por año, en soles" />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-mute">
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
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl border border-amber/40 bg-amber-soft px-3 py-2 text-[13px] text-ink">
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
    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
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
  if (sinPim) return <span className="text-[12px] text-mute">Sin dato</span>;
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
