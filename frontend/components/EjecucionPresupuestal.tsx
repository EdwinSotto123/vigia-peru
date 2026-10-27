import { ejecucionPct, palabraGasto, sinAnioRepetido, ultimoConPim, type MefBudgetSummary, type MefBudgetRow, type OrigenMef } from "@/lib/mef";
import { getEntityBudget } from "@/lib/mef-cache";
import { getGastoEntidad } from "@/lib/api-client";
import type { GastoEntidad } from "@/lib/mef";
import { EnQueGasta } from "@/components/EnQueGasta";
import { AlertCircle, Database, ExternalLink, WifiOff } from "lucide-react";
import { Ayuda, AyudaTermino, FuenteDato, Nota } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, IndicadoresSkeleton, Tabla, TablaSkeleton, type Columna, type Fila } from "@/components/listado";
import { listaY, numero, porcentaje, soles, solesCompacto } from "@/lib/formato";
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
      <TablaSkeleton columnas={columnas(false)} filas={5} />
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

/** De dónde salen las cifras, en la línea de la fuente: el archivo del MEF de cada tipo de entidad (migración 152). */
const FUENTE_MEF: Record<OrigenMef, string> = {
  siaf: "MEF, Datos Abiertos (presupuesto y ejecución de gasto)",
  opds: "MEF, Datos Abiertos (gasto de los organismos públicos descentralizados)",
  etes: "MEF, Datos Abiertos (gasto de las empresas municipales)",
};

/**
 * Un año por fila: la ejecución (chip) · el año · los montos, completos y a la derecha (§10.3). En las empresas
 * municipales (`etes`) el gasto es «Ejecutado» y no hay girado: el MEF publica un solo monto ejecutado.
 */
function columnas(etes: boolean): Columna[] {
  return [
    {
      clave: "ejecucion",
      titulo: "Ejecución",
      ancho: "100px",
      ayuda: (
        <Ayuda titulo="¿Qué es la ejecución?">
          {etes ? "Ejecutado" : "Devengado"} ÷ PIM del año. Por debajo del {EJECUCION_BAJA} % en un año ya cerrado se marca como
          ejecución baja.
        </Ayuda>
      ),
    },
    { clave: "anio", titulo: "Año", ancho: "minmax(0,1fr)" },
    { clave: "pia", titulo: "PIA", ancho: "140px", alinear: "der", desde: "lg" },
    { clave: "pim", titulo: "PIM", ancho: "140px", alinear: "der" },
    { clave: "devengado", titulo: etes ? "Ejecutado" : "Devengado", ancho: "140px", alinear: "der", desde: "md" },
    ...(etes ? [] : [{ clave: "girado", titulo: "Girado", ancho: "140px", alinear: "der" as const, desde: "lg" as const }]),
  ];
}

function EjecucionView({ data, gasto }: { data: MefBudgetSummary; gasto: GastoEntidad | null }) {
  // El año que el MEF todavía no publica (repite al anterior al centavo) no se muestra como dato.
  const { years, repetido } = sinAnioRepetido(data.byYear);
  // Las cifras de cabecera son las de su último año con presupuesto vigente; los años de después que sólo traen el
  // inicial (PIA) con el PIM en cero, los de una unidad que se cierra, van en la nota y en la tabla.
  const iActual = ultimoConPim(years);
  const current = years[iActual];
  const prevYear = years[iActual - 1];
  const sinPim = years.slice(iActual + 1);
  const ultimo = years[years.length - 1];
  const anioActual = new Date().getFullYear();
  const etes = data.origen === "etes";
  const gastado = palabraGasto(data.origen);
  // Su último año es anterior al último que el MEF publica de ese archivo: su unidad ejecutora ya no tiene presupuesto.
  const ultimoMef = data.ultimoAnioMef ?? null;
  const yaNoGasta = ultimoMef != null && current.year < ultimoMef;
  const piaSinPim = sinPim.reduce((s, r) => s + r.pia, 0);

  const ejPct = ejecucionPct(current);
  const isUnderExecuted = current.pim > 0 && ejPct < EJECUCION_BAJA && current.year < anioActual;
  const isOverExecuted = current.pim > 0 && current.devengado > current.pim;

  // Crecimiento del PIM frente al año anterior (null si no hay con qué comparar).
  const growth = prevYear && prevYear.pim > 0 ? ((current.pim - prevYear.pim) / prevYear.pim) * 100 : null;
  // El año más reciente arriba: la primera fila es la de las cifras de cabecera. Todos los años, sin recorte.
  const filas: Fila[] = [...years].reverse().map((row) => filaAnio(row, anioActual, etes));

  return (
    <div className="space-y-4">
      <OrigenCifras data={data} />
      {yaNoGasta && (
        <Nota>
          <strong className="font-semibold text-ink">Su último presupuesto en el MEF es de {current.year}.</strong>{" "}
          {sinPim.length > 0 &&
            (piaSinPim > 0
              ? `En ${listaY(sinPim.map((r) => String(r.year)))} abrió con un presupuesto inicial (PIA) de ${solesCompacto(piaSinPim)}, que durante el año se redujo a cero (PIM S/ 0). `
              : `En ${listaY(sinPim.map((r) => String(r.year)))} su presupuesto vigente (PIM) fue S/ 0. `)}
          {ultimo.year < (ultimoMef ?? ultimo.year)
            ? `Desde ${ultimo.year + 1} su unidad ejecutora ya no aparece en el MEF: pasa cuando se fusiona con otra o se cierra.`
            : "Pasa cuando una unidad ejecutora se fusiona con otra o se cierra."}{" "}
          <Ayuda titulo="¿Por qué no hay años más recientes?">
            El MEF publica el presupuesto por unidad ejecutora. Cuando una unidad deja de existir (una red de salud que se junta
            con otra, un proyecto que terminó) o pasa a gastar con otro código, sus años siguientes ya no aparecen. Aquí está su
            historia hasta el último año con presupuesto; el MEF ya publica {ultimoMef}.
          </Ayuda>
        </Nota>
      )}
      <BarraAnio row={current} growth={growth} alerta={isUnderExecuted || isOverExecuted} etes={etes} />

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
              <strong className="font-semibold text-amberTexto">Ejecución baja en {current.year}:</strong> se{" "}
              {etes ? "ejecutó" : "devengó"} el {porcentaje(ejPct, { decimales: 1 })} del PIM en un año ya cerrado.
              <Ayuda titulo="¿Qué puede explicar una ejecución baja?">
                Obras paralizadas, presupuesto que no se usó o registros incompletos. Es una pista para mirar, no una
                conclusión.
              </Ayuda>
            </p>
          )}
          {isOverExecuted && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-meta text-ink">
              <AlertCircle size={14} className="shrink-0 text-amberTexto" aria-hidden />
              <strong className="font-semibold text-amberTexto">{etes ? "Ejecutado" : "Devengado"} por encima del PIM.</strong>
              <Ayuda titulo="¿Qué puede explicarlo?">
                Modificaciones presupuestales todavía no registradas o un error en la copia de datos.
              </Ayuda>
            </p>
          )}
        </div>
      )}

      {/* En qué gasta: lo que la gente pregunta después de "cuánto". */}
      <EnQueGasta gasto={gasto} />

      <section aria-labelledby="mef-por-anio" className="space-y-3">
        <h3 id="mef-por-anio" className="text-cuerpo font-semibold text-ink">
          Año por año
        </h3>
        {/* Con tres años o más, la serie a la vista; la tabla de abajo tiene cada cifra. */}
        {years.length >= 3 && <SerieAnios years={years} anioActual={anioActual} gastado={gastado} />}
        <Tabla columnas={columnas(etes)} filas={filas} etiqueta="Presupuesto y ejecución por año, en soles" />
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-mute">
        <FuenteDato fuente={FUENTE_MEF[data.origen ?? "siaf"]} fecha={data.fechaDescarga} href={DATASET_MEF} />
        {!data.fechaDescarga && <span>La copia no registró su fecha de descarga.</span>}
      </div>
    </div>
  );
}

/**
 * De dónde salen las cifras, antes de las cifras. El MEF registra el presupuesto por unidad ejecutora y sin RUC: si la
 * entidad cruzó con la suya, se nombra; si es un gobierno regional que no se identificó, las cifras son las de TODO el
 * gobierno regional y se dice en ámbar, para que nadie las lea como el presupuesto de esta oficina. Las OPD y las empresas
 * municipales (migración 152) salen de su propio archivo del MEF, y se dice; en las empresas, además, qué es lo ejecutado.
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
  const rotulo =
    data.origen === "opds"
      ? "En el MEF, como organismo público descentralizado:"
      : data.origen === "etes"
        ? "En el MEF, como empresa municipal:"
        : unidades.length === 1
          ? "Unidad ejecutora del MEF:"
          : `${numero(unidades.length)} unidades ejecutoras del MEF, sumadas:`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-rotulo text-mute">
        <span>{rotulo}</span>
        {data.origen === "opds" && <AyudaTermino clave="opd" />}
        {data.origen === "etes" && <AyudaTermino clave="ete" />}
        {unidades.slice(0, 6).map((u) => (
          // Como lo escribe el MEF: es el nombre con que se la encuentra en su consulta.
          <span key={u} className="pill border-line bg-paperSoft text-ink">
            {u}
          </span>
        ))}
        {unidades.length > 6 && <span>y {numero(unidades.length - 6)} más</span>}
      </div>
      {data.origen === "etes" && (
        <Nota>
          Las empresas municipales le reportan al MEF un solo monto <strong className="font-semibold text-ink">ejecutado</strong>,
          cada mes o cada trimestre: no lo separan en devengado (lo que ya deben pagar) y girado (lo que ya pagaron). Por eso aquí
          se lee «ejecutado» y no hay girado.
        </Nota>
      )}
    </div>
  );
}

function filaAnio(row: MefBudgetRow, anioActual: number, etes: boolean): Fila {
  const pct = ejecucionPct(row);
  const baja = row.pim > 0 && pct < EJECUCION_BAJA && row.year < anioActual;
  return {
    id: String(row.year),
    celdas: {
      ejecucion: <PildoraEjecucion pct={pct} sinPim={row.pim <= 0} baja={baja} />,
      anio: <CeldaPrincipal titulo={String(row.year)} meta={row.year >= anioActual ? "en curso" : undefined} />,
      pia: <CeldaNumero>{soles(row.pia)}</CeldaNumero>,
      pim: <CeldaNumero>{soles(row.pim)}</CeldaNumero>,
      devengado: <CeldaNumero>{soles(row.devengado)}</CeldaNumero>,
      ...(etes ? {} : { girado: <CeldaNumero>{soles(row.girado)}</CeldaNumero> }),
    },
  };
}

/** Porcentaje de ejecución de un año. La baja lleva ícono y tono ámbar; alta, moss; sin PIM (cero), "Sin PIM". */
function PildoraEjecucion({ pct, sinPim, baja }: { pct: number; sinPim: boolean; baja: boolean }) {
  if (sinPim) return <span className="text-rotulo text-mute">Sin PIM</span>;
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
 * Los años en columnas (migración 152: desde 2015, hasta 12): la altura es el presupuesto vigente (PIM) de cada año frente
 * al más alto de la serie y el tramo oscuro, lo gastado (devengado; en las empresas municipales, lo ejecutado). Columnas
 * en CSS, como la línea de meses (components/charts/LineaMeses.tsx): se adaptan al ancho sin estirar el texto y a 400 px
 * caben 12 años (el año va en dos cifras hasta sm). El año en curso va con borde punteado y su nombre lo dice: todavía no
 * cierra. Un año sin presupuesto entre dos que sí tienen (la unidad no gastó ese año) queda como un hueco. Cada columna
 * dice sus cifras al pasar el puntero; la tabla de abajo las tiene todas, también para el lector de pantalla.
 */
function SerieAnios({ years, anioActual, gastado }: { years: MefBudgetRow[]; anioActual: number; gastado: "devengado" | "ejecutado" }) {
  const desde = years[0].year;
  const hasta = years[years.length - 1].year;
  const porAnio = new Map(years.map((r) => [r.year, r]));
  const anios = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
  const max = Math.max(...years.map((r) => r.pim), 1);
  const mayor = years.reduce((a, b) => (b.pim > a.pim ? b : a), years[0]);
  const enCurso = hasta >= anioActual;
  const parte = gastado === "ejecutado" ? "ejecutada" : "gastada (devengado)";
  return (
    <figure className="space-y-2">
      <figcaption className="text-meta leading-snug text-inkSoft">
        Presupuesto vigente (PIM) de cada año, de {desde} a {hasta}, con la parte {parte} en el tono oscuro. El más alto fue el de{" "}
        <b className="font-semibold text-ink">{mayor.year}</b>: <b className="font-mono font-semibold tabular-nums text-ink">{solesCompacto(mayor.pim)}</b>.
        {enCurso && <> {hasta} sigue en curso.</>}
      </figcaption>
      <div
        role="img"
        aria-label={`Presupuesto por año de ${desde} a ${hasta}: el más alto, ${solesCompacto(mayor.pim)} en ${mayor.year}. Cada cifra está en la tabla de abajo.`}
      >
        <ol className="flex h-36 items-end gap-1 border-b border-line pt-5 sm:gap-2" data-lista="grafico">
          {anios.map((anio, i) => {
            const r = porAnio.get(anio);
            const vivo = anio >= anioActual;
            if (!r || r.pim <= 0) {
              const titulo = !r
                ? `${anio}: sin presupuesto en el MEF`
                : `${anio}: presupuesto vigente (PIM) S/ 0${r.pia > 0 ? `, con un inicial (PIA) de ${soles(r.pia)}` : ""}`;
              return (
                <li key={anio} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={titulo}>
                  <span className="block h-1.5 w-full max-w-6 rounded-sm border border-dashed border-mute/60" />
                </li>
              );
            }
            const alto = Math.max(2, (r.pim / max) * 100);
            const lleno = Math.min(100, (r.devengado / r.pim) * 100);
            const titulo = `${anio}${vivo ? " (en curso)" : ""}: PIM ${soles(r.pim)}, ${gastado} ${soles(r.devengado)} (${porcentaje(lleno, { decimales: 0 })})`;
            return (
              <li key={anio} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={titulo}>
                {/* La cifra del año más alto sobre su columna (la escala); desde la mitad, alineada a la derecha: no sale del gráfico. */}
                {anio === mayor.year && (
                  <span
                    className={cn("absolute whitespace-nowrap font-mono text-micro tabular-nums text-inkSoft", i < anios.length / 2 ? "left-0" : "right-0")}
                    style={{ bottom: `calc(${alto}% + 2px)` }}
                  >
                    {solesCompacto(r.pim)}
                  </span>
                )}
                <span
                  className={cn("relative block w-full max-w-6 overflow-hidden rounded-t bg-granate/25", vivo && "border border-b-0 border-dashed border-granate/70")}
                  style={{ height: `${alto}%` }}
                >
                  <span className="absolute inset-x-0 bottom-0 bg-granate" style={{ height: `${lleno}%` }} />
                </span>
              </li>
            );
          })}
        </ol>
        <ol className="mt-1 flex gap-1 sm:gap-2" aria-hidden>
          {anios.map((anio) => (
            <li key={anio} className={cn("min-w-0 flex-1 text-center font-mono text-micro tabular-nums", anio >= anioActual ? "font-semibold text-ink" : "text-mute")}>
              <span className="sm:hidden">{String(anio).slice(2)}</span>
              <span className="hidden sm:inline">{anio}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-rotulo text-mute" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-granate/25" /> Presupuesto vigente (PIM)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-granate" /> {gastado === "ejecutado" ? "Ejecutado" : "Gastado (devengado)"}
        </span>
        {enCurso && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-granate/70" /> Año en curso
          </span>
        )}
      </p>
    </figure>
  );
}

/**
 * El año en una barra: es el presupuesto vigente (PIM). Lo pagado (girado) en el tono más fuerte, lo gastado que falta
 * pagar (devengado − girado) en uno medio y lo que queda por gastar en la pista; la marca vertical es el presupuesto
 * inicial (PIA), que el PIM suele pasar. Debajo, las cifras de la cuenta, cada una con su parte del PIM. Si la ejecución es
 * baja en un año cerrado o pasa el PIM, el porcentaje va en ámbar (observación, no señal). En las empresas municipales
 * (`etes`) no hay girado: un solo tramo, lo ejecutado, y lo que falta ejecutar.
 */
function BarraAnio({ row, growth, alerta, etes }: { row: MefBudgetRow; growth: number | null; alerta: boolean; etes: boolean }) {
  const pim = row.pim;
  const parte = (v: number) => (pim > 0 ? Math.max(0, Math.min(100, (v / pim) * 100)) : 0);
  const pagado = etes ? 0 : parte(row.girado);
  const gastado = parte(row.devengado);
  const marcaPia = pim > 0 && row.pia > 0 && row.pia <= pim ? (row.pia / pim) * 100 : null;
  const porGastar = Math.max(0, pim - row.devengado);
  const sinPagar = Math.max(0, row.devengado - row.girado);
  const pctDe = (v: number) => (pim > 0 ? (v / pim) * 100 : null);
  // Los tramos de la barra suman el PIM, en el orden en que se ven; el inicial es la marca.
  const cifras: { clave: string; etiqueta: string; valor: number; pct: number | null; muestra: string }[] = etes
    ? [
        { clave: "ejecutado", etiqueta: "Ejecutado", valor: row.devengado, pct: pctDe(row.devengado), muestra: "bg-granate" },
        { clave: "falta", etiqueta: "Por ejecutar", valor: porGastar, pct: pctDe(porGastar), muestra: "bg-granate/15 border border-line" },
        { clave: "inicial", etiqueta: "Inicial (PIA)", valor: row.pia, pct: null, muestra: "w-0.5 h-3 bg-ink" },
      ]
    : [
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
          {etes ? (
            <Ayuda titulo="¿Qué son PIA, PIM y ejecutado?">
              PIA: el presupuesto aprobado al inicio del año. PIM: el presupuesto modificado durante el año, el que vale.
              Ejecutado: lo que la empresa le reporta al MEF como gastado, cada mes o cada trimestre; no lo separa en devengado
              (lo que ya debe pagar) y girado (lo que ya pagó).
            </Ayuda>
          ) : (
            <Ayuda titulo="¿Qué son PIA, PIM, devengado y girado?">
              PIA: el presupuesto aprobado al inicio del año. PIM: el presupuesto modificado durante el año, el que vale.
              Devengado: el gasto que la entidad ya reconoció como obligación de pago. Girado: lo que ya pagó.
            </Ayuda>
          )}
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
              , del que ya {etes ? "ejecutó" : "gastó (devengado)"} <span className="font-semibold text-ink">{solesCompacto(row.devengado)}</span>:{" "}
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
          aria-label={
            etes
              ? `De ${solesCompacto(pim)}: ${solesCompacto(row.devengado)} ejecutado, ${solesCompacto(porGastar)} por ejecutar; el inicial fue ${solesCompacto(row.pia)}`
              : `De ${solesCompacto(pim)}: ${solesCompacto(row.girado)} pagado, ${solesCompacto(row.devengado)} gastado, ${solesCompacto(porGastar)} por gastar; el inicial fue ${solesCompacto(row.pia)}`
          }
        >
          <span className={cn("absolute inset-y-0 left-0", etes ? "bg-granate" : "bg-granate/60")} style={{ width: `${gastado}%` }} />
          {!etes && <span className="absolute inset-y-0 left-0 bg-granate" style={{ width: `${pagado}%` }} />}
          {marcaPia != null && <span aria-hidden className="absolute inset-y-0 w-0.5 bg-ink/80" style={{ left: `calc(${marcaPia}% - 1px)` }} />}
        </div>
      )}
      <dl className={cn("mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5", etes ? "sm:grid-cols-3" : "sm:grid-cols-4")}>
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
