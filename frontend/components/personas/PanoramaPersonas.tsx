import type { ReactNode } from "react";
import Link from "next/link";
import { Banknote, CalendarRange, ChevronDown, PieChart, Users, type LucideIcon } from "lucide-react";
import { Indicadores, cuotaDe, paletaGravedad, type Indicador, type Parametros } from "@/components/listado";
import { BarraSegmentada, MuestraSerie, type ParteBarra } from "@/components/charts/BarraSegmentada";
import { ColumnasAnio } from "@/components/charts/ColumnasAnio";
import { ColumnasSerie } from "@/components/charts/ColumnasSerie";
import { EnUnaFrase } from "@/components/patrones";
import { BanderaAparte } from "@/components/ui/BanderaAparte";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { Skeleton } from "@/components/ui/Skeleton";
import { hoyLima, numero, plural, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { urlDesde } from "@/lib/desde";
import { CHIP_SENAL, SENAL, type AnioPersonas, type ParamsPersonas, type ResumenPersonas } from "@/lib/personas";
import { PlegadoEnCelular } from "./PlegadoEnCelular";

/**
 * Lo de arriba de la lista de personas contratadas (de una entidad, una región, un partido o el país), en este orden:
 *
 *   1. La conclusión, en una frase con sus datos (`EnUnaFrase`): «1 de cada 7 personas contratadas tiene alguna señal en
 *      otros registros; juntas recibieron el 27 % de lo pagado. La más común: …», con el reparto por la señal más grave
 *      (la barra que hace de leyenda a los chips de la barra de filtros) y las señales más comunes, cada una a su lista.
 *   2. Un panel: las cifras en la franja (personas y lo pagado), lo que se le pagó CADA AÑO (columnas: a quienes no tienen
 *      señales y a quienes tienen alguna) y el reparto por TIPO DE SERVICIO (barra segmentada y su tabla, cada servicio a
 *      su lista filtrada).
 *
 * Pedido del dueño del 2026-11-18: arriba había dos cajas grandes con un número cada una («49,560 personas contratadas»,
 * «S/ 2.2 mil M pagados»), sin cuándo ni en qué. En el celular el gráfico y el reparto van plegados (`PlegadoEnCelular`):
 * la primera fila de la lista no baja más de una pantalla.
 *
 * QUÉ CUENTA CADA CIFRA: en una entidad, una fila es una persona; en el país, una región o un partido, una contratación
 * (una persona en una entidad), y cada texto lo dice. La serie por año con montos (`resumen.anual`) sólo llega en una
 * entidad; fuera de ella, el gráfico cuenta contrataciones por año (`porAnio`, ya contado). Server-safe (los gráficos
 * de columnas son de cliente y reciben datos planos).
 */
export function PanoramaPersonas({
  r,
  deEntidad,
  P,
  ruta,
  base,
}: {
  r: ResumenPersonas;
  deEntidad: boolean;
  P: ParamsPersonas;
  ruta: string;
  /** Lo que la lista conserva en sus enlaces (la pestaña, la región, el período): los de aquí parten de ahí. */
  base: Parametros;
}) {
  if (!r.filas) return null;
  const porPersona = deEntidad || r.filas === r.personas;
  // Cada enlace es la lista del alcance con UN filtro (no suma los que ya estén puestos: es la entrada a esa parte).
  const href = (filtro: Record<string, string>) => urlDesde(ruta, { ...base, ...filtro });
  return (
    <div className="space-y-3">
      <Conclusion r={r} porPersona={porPersona} P={P} href={href} />
      {/* Dentro de la tarjeta de la pestaña, sin su propio marco: es parte de esa superficie, no otra caja adentro. */}
      <section
        aria-label="Cuánto les pagó, cada año y por tipo de servicio"
        className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5 [.tarjeta_&]:rounded-none [.tarjeta_&]:border-0 [.tarjeta_&]:bg-transparent [.tarjeta_&]:px-0 [.tarjeta_&]:pb-1"
      >
        {/* Desde lg, dos columnas: a la izquierda las cifras y el reparto por servicio; a la derecha, cada año. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-x-8 lg:gap-y-5">
          <Indicadores items={cifras(r, deEntidad)} className="lg:col-start-1 lg:row-start-1" />
          <PlegadoEnCelular titulo="Cada año y por tipo de servicio" icono={<PieChart size={16} />} className="lg:contents" claseContenido="space-y-6 pt-2 md:pt-0 lg:contents">
            <SerieAnual r={r} porPersona={porPersona} className="lg:col-start-2 lg:row-span-2 lg:row-start-1" />
            <RepartoServicios r={r} porPersona={porPersona} P={P} href={href} className="lg:col-start-1 lg:row-start-2" />
          </PlegadoEnCelular>
        </div>
      </section>
    </div>
  );
}

/** Mientras llega la página: la misma forma (la frase y el panel; en el celular, sin el gráfico plegado). */
export function PanoramaPersonasSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="space-y-3 rounded-2xl border border-line bg-paperSoft px-4 py-4 sm:px-5">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
      <div className="grid gap-4 rounded-2xl border border-line bg-paper p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-x-8">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="hidden h-60 w-full md:block lg:row-span-2" />
        <Skeleton className="hidden h-44 w-full md:block" />
      </div>
    </div>
  );
}

// ─── 1 · La conclusión ───────────────────────────────────────────────────────────────────────────

/**
 * «1 de cada 7» si es menos de 3 de cada 10 (el ejemplo del dueño: 7,550 de 49,560 es 1 de cada 7 y no «2 de cada 10»);
 * si no, «n de cada 10»; «casi todas» desde 95 %. `uno`: el verbo va en singular («1 de cada 7 … tiene»).
 */
export function proporcion(parte: number, total: number): { texto: string; uno: boolean } {
  const p = total > 0 ? parte / total : 0;
  if (parte >= total) return { texto: "Todas las", uno: false };
  if (p >= 0.95) return { texto: "Casi todas las", uno: false };
  if (p < 0.3) return { texto: `1 de cada ${numero(Math.max(2, Math.round(1 / p)))}`, uno: true };
  return { texto: `${Math.round(p * 10)} de cada 10`, uno: false };
}

function Conclusion({ r, porPersona, P, href }: { r: ResumenPersonas; porPersona: boolean; P: ParamsPersonas; href: (f: Record<string, string>) => string }) {
  const [uno, varios] = porPersona ? ["persona contratada", "personas contratadas"] : ["contratación", "contrataciones"];
  const comunes = [...(r.porSenal ?? [])].filter((s) => s.n > 0).sort((a, b) => b.n - a.n);
  // Lo pagado a quienes tienen alguna señal, frente a todo lo pagado: sólo con la serie de cada año (una entidad).
  const anual = r.anual ?? [];
  const pagado = anual.reduce((s, a) => s + a.monto, 0);
  const aSenal = anual.reduce((s, a) => s + a.montoConSenal, 0);
  const parteMonto = r.conSenales > 0 && pagado > 0 && aSenal > 0 ? aSenal / pagado : null;

  if (!r.conSenales) {
    return (
      <EnUnaFrase>
        {r.filas === 1 ? `La ${uno} no tiene` : `Ninguna de las ${plural(r.filas, uno, varios)} tiene`} señales en otros registros públicos.
      </EnUnaFrase>
    );
  }
  const { texto, uno: singular } = proporcion(r.conSenales, r.filas);
  // «1 de cada 7 personas contratadas tiene…», «3 de cada 10 contrataciones tienen…», «Casi todas las personas…».
  const sujeto = `${texto} ${varios}`;
  const comun = comunes[0];
  // recorte: las cuatro más comunes, como entrada rápida; todas, con su número, en el filtro «Señal» de la lista.
  const destacadas = comunes.slice(0, 4);
  return (
    <EnUnaFrase
      datos={
        <>
          <RepartoSenales r={r} porPersona={porPersona} />
          {comunes.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-rotulo font-medium text-mute">{comunes.length === 1 ? "La señal" : "Las más comunes"}</span>
              {/* En el celular, una sola fila que se desliza (como la faceta de la barra de filtros): en renglones eran tres. */}
              <ul
                className="flex items-center gap-1.5 max-sm:w-full max-sm:overflow-x-auto max-sm:[scrollbar-width:none] sm:flex-wrap"
                aria-label="Las señales más comunes, cada una a su lista"
              >
                {destacadas.map((s) => (
                  <li key={s.tipo} className="shrink-0">
                    <Link
                      href={href({ [P.senal]: s.tipo })}
                      prefetch={false}
                      scroll={false}
                      title={SENAL[s.tipo] ? `${SENAL[s.tipo].titulo}. Ver a quienes la tienen.` : undefined}
                      className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-2.5 text-rotulo font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:text-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                    >
                      <IconoBandera tipo={s.tipo} size={13} className="text-mute" />
                      {CHIP_SENAL[s.tipo] ?? s.tipo}
                      <span className="font-mono font-normal tabular-nums text-inkSoft">{numero(s.n)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      }
    >
      {sujeto} {singular ? "tiene" : "tienen"} alguna señal en otros registros
      {parteMonto != null ? `; juntas recibieron el ${porcentaje(parteMonto * 100)} de lo pagado` : ""}.
      {comun ? ` La más común: «${SENAL[comun.tipo]?.corto ?? comun.tipo}».` : ""}
    </EnUnaFrase>
  );
}

/**
 * Cómo se reparten las contrataciones por su señal más grave: una barra partida y su leyenda con la PARTE de cada una
 * (pedido del usuario del 2026-11-05: alta 25,183, media 182,552, baja 321,115 y sin 2,661,498 iban sólo como chips de
 * texto, y las mismas cifras se repetían en la franja, en los chips, en la pestaña y en el paginador). Los números van en
 * los chips de la barra de filtros, que también filtran y llevan el cuadrito de su parte; aquí, qué parte del todo es
 * cada uno. La paleta y la cuota, de `paletaSeveridad` (las mismas que los chips).
 */
function RepartoSenales({ r, porPersona }: { r: ResumenPersonas; porPersona: boolean }) {
  const unidad = (n: number) => (porPersona ? plural(n, "persona", "personas") : plural(n, "contratación", "contrataciones"));
  // Las mismas cuentas que los chips: la baja es lo que queda de «con señales» sin las altas ni las medias.
  const baja = Math.max(0, r.conSenales - (r.alta ?? 0) - (r.media ?? 0));
  const sin = Math.max(0, r.filas - r.conSenales);
  const partes: ParteBarra[] = [
    { clave: "alta", nombre: "Con señal alta", valor: r.alta ?? 0, texto: unidad(r.alta ?? 0) },
    { clave: "media", nombre: "Con señal media", valor: r.media ?? 0, texto: unidad(r.media ?? 0) },
    { clave: "baja", nombre: "Con señal baja", valor: baja, texto: unidad(baja) },
  ].filter((p) => p.valor > 0);
  const otros: ParteBarra = { clave: "sin", nombre: "Sin señales", valor: sin, texto: unidad(sin) };
  if (!r.filas) return null;
  return (
    <div className="w-full" style={paletaGravedad(partes)}>
      <BarraSegmentada partes={partes} otros={otros} etiqueta={porPersona ? "Personas por su señal más grave" : "Contrataciones por su señal más grave"} />
      {/* La leyenda (el nombre accesible de la barra ya dice lo mismo), en el orden y con el color de la barra. */}
      <ul aria-hidden className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-rotulo text-inkSoft">
        {[...partes.map((p, i) => ({ p, i: i as number | "otros" })), ...(sin > 0 ? [{ p: otros, i: "otros" as const }] : [])].map(({ p, i }) => (
          <li key={p.clave} className="inline-flex items-center gap-1.5">
            <MuestraSerie i={i} />
            {p.nombre}
            <span className="font-mono font-semibold tabular-nums text-ink">{cuotaDe(p.valor, r.filas)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── 2 · Las cifras ──────────────────────────────────────────────────────────────────────────────

/**
 * Personas y monto. Con señales y con una señal alta no van aquí (pedido del usuario del 2026-11-05): son los chips de
 * la barra de filtros, con su número, y el reparto por gravedad va en la conclusión. Cada cifra dice su unidad: las
 * personas son personas distintas y las señales se cuentan por contratación (como la lista y la faceta). En una entidad
 * las dos unidades son la misma.
 */
export function cifras(r: ResumenPersonas, deEntidad = false): Indicador[] {
  const porPersona = deEntidad || r.filas === r.personas;
  const anios = r.porAnio.map((a) => a.anio).sort((a, b) => a - b);
  const periodo = anios.length ? (anios[0] === anios[anios.length - 1] ? `en ${anios[0]}` : `de ${anios[0]} a ${anios[anios.length - 1]}`) : null;
  const pagos = [porPersona ? null : `en ${plural(r.ordenes, "orden", "órdenes")}`, periodo].filter(Boolean).join(", ");
  return [
    {
      valor: numero(r.personas),
      etiqueta: "personas contratadas",
      contexto: porPersona ? `con ${plural(r.ordenes, "orden de servicio", "órdenes de servicio")}` : `en ${plural(r.filas, "contratación", "contrataciones")}: una persona en una entidad`,
    },
    {
      valor: solesCompacto(r.monto),
      etiqueta: "pagados por órdenes",
      // Lo que CONOSCE publicó con posibles errores (el RUC escrito como monto…) no se borra: se nombra aparte, como
      // bandera chica debajo del primer dato y con su explicación al tocarla.
      contexto: r.dudosas?.ordenes ? (
        <>
          {pagos}
          <BanderaAparte monto={solesCompacto(r.dudosas.monto)} titulo="Posible error de CONOSCE" className={pagos ? "mt-1.5" : undefined}>
            {`${plural(r.dudosas.ordenes, "orden", "órdenes")} ${r.dudosas.ordenes === 1 ? "trae" : "traen"} ${soles(r.dudosas.monto)}${r.dudosas.ordenes === 1 ? "" : " en total"}. Puede ser un error de CONOSCE al subir el dato: Vigía no lo borra, pero lo deja fuera de este total para que no infle la cifra.`}
          </BanderaAparte>
        </>
      ) : (
        pagos || undefined
      ),
    },
  ];
}

// ─── 3 · Cada año ────────────────────────────────────────────────────────────────────────────────

/** Un par rótulo → valor con su ícono, para lo que se lee del gráfico («Su mayor año: 2025, S/ 436 M»). */
function Par({ icono: Icono, rotulo, children }: { icono: LucideIcon; rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-rotulo font-medium text-mute">
        <Icono size={13} strokeWidth={2} className="shrink-0" aria-hidden />
        {rotulo}
      </dt>
      <dd className="mt-0.5 text-meta font-semibold tabular-nums text-ink">{children}</dd>
    </div>
  );
}

/** El h3 de cada bloque del panel: no más chico que `text-cuerpo` (regla `tituloChico` de la guardia de estilo). */
const TITULO = "text-cuerpo font-semibold text-ink";

/**
 * Lo pagado cada año (en una entidad): columnas apiladas, abajo lo que fue a quienes no tienen señales y encima lo que
 * fue a quienes tienen alguna, con el detalle de cada año (cuánto y a cuántas personas) al pasar o con el teclado. Debajo,
 * la leyenda y lo que se lee de la serie en pares (su mayor año; el de más personas, si es otro; el año en curso).
 * Fuera de una entidad no hay montos por año: cuántas contrataciones tuvieron órdenes cada año.
 */
function SerieAnual({ r, porPersona, className }: { r: ResumenPersonas; porPersona: boolean; className?: string }) {
  const actual = Number(hoyLima().slice(0, 4));
  const anual = (r.anual ?? []).filter((a) => a.personas > 0);
  if (anual.length) return <SerieMontos anual={anual} actual={actual} className={className} />;
  const conteo = [...(r.porAnio ?? [])].filter((a) => a.n > 0).sort((a, b) => a.anio - b.anio);
  if (!conteo.length) return null;
  const [uno, varios] = porPersona ? ["persona", "personas"] : ["contratación", "contrataciones"];
  const mayor = conteo.reduce((m, a) => (a.n > m.n ? a : m), conteo[0]);
  return (
    <div className={className}>
      <h3 className={TITULO}>{porPersona ? "Personas con órdenes cada año" : "Contrataciones con órdenes cada año"}</h3>
      <ColumnasSerie
        className="mt-2"
        etiqueta={porPersona ? "Personas con al menos una orden cada año" : "Contrataciones con al menos una orden cada año"}
        puntos={conteo.map((a) => ({
          clave: String(a.anio),
          rotulo: String(a.anio),
          valor: a.n,
          texto: numero(a.n),
          detalle: `${a.anio}${a.anio === actual ? " (en curso)" : ""}: ${plural(a.n, uno, varios)} con órdenes`,
        }))}
      />
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
        <Par icono={CalendarRange} rotulo="Su mayor año">{`${mayor.anio}: ${plural(mayor.n, uno, varios)}`}</Par>
        {conteo[conteo.length - 1].anio === actual && conteo[conteo.length - 1].anio !== mayor.anio && <Par icono={CalendarRange} rotulo="Este año, en curso">{plural(conteo[conteo.length - 1].n, uno, varios)}</Par>}
      </dl>
    </div>
  );
}

function SerieMontos({ anual, actual, className }: { anual: AnioPersonas[]; actual: number; className?: string }) {
  const orden = [...anual].sort((a, b) => a.anio - b.anio);
  const mayor = orden.reduce((m, a) => (a.monto > m.monto ? a : m), orden[0]);
  const masGente = orden.reduce((m, a) => (a.personas > m.personas ? a : m), orden[0]);
  const ultimo = orden[orden.length - 1];
  const conSenal = orden.some((a) => a.montoConSenal > 0);
  return (
    <div className={className}>
      <h3 className={TITULO}>Cuánto pagó cada año</h3>
      <ColumnasAnio
        className="mt-5"
        etiqueta="Lo que pagó cada año a personas por órdenes de servicio"
        etiquetaA="A personas sin señales"
        etiquetaB="A personas con alguna señal"
        formato="soles"
        anios={orden.map((a) => ({
          anio: a.anio,
          a: Math.max(0, a.monto - a.montoConSenal),
          b: a.montoConSenal,
          detalleA: `${solesCompacto(Math.max(0, a.monto - a.montoConSenal))} a ${plural(a.personas - a.conSenal, "persona", "personas")}`,
          detalleB: `${solesCompacto(a.montoConSenal)} a ${plural(a.conSenal, "persona", "personas")}`,
        }))}
      />
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft" aria-label="Leyenda">
        <li className="inline-flex items-center gap-1.5"><MuestraSerie i={0} />A personas sin señales</li>
        {conSenal && <li className="inline-flex items-center gap-1.5"><MuestraSerie i={1} />A personas con alguna señal</li>}
      </ul>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
        <Par icono={Banknote} rotulo={masGente.anio === mayor.anio ? "Su mayor año" : "Año que más pagó"}>
          {`${mayor.anio}: ${solesCompacto(mayor.monto)} a ${plural(mayor.personas, "persona", "personas")}`}
        </Par>
        {masGente.anio !== mayor.anio && <Par icono={Users} rotulo="Año con más personas">{`${masGente.anio}: ${numero(masGente.personas)}`}</Par>}
        {/* El año en curso aparte (su columna es baja porque el año no terminó), salvo que ya sea el mayor. */}
        {ultimo.anio === actual && ultimo.anio !== mayor.anio && (
          <Par icono={CalendarRange} rotulo={`${ultimo.anio}, en curso`}>{`${solesCompacto(ultimo.monto)} a ${plural(ultimo.personas, "persona", "personas")}`}</Par>
        )}
      </dl>
    </div>
  );
}

// ─── 4 · Por tipo de servicio ────────────────────────────────────────────────────────────────────

/** Cuántos tipos de servicio con nombre van en la barra (con su color de serie); el resto, en el gris de «Otros». */
const SERVICIOS_A_LA_VISTA = 5;

/**
 * En qué servicios: la barra segmentada (los 5 con más personas, cada uno con su color de serie, y el resto en gris) y su
 * tabla, en el mismo orden: cuántas personas, qué parte y cuánto se les pagó, cada servicio a la lista filtrada por él.
 * «Otros» es lo que el clasificador (servicio_persona, migración 91) no supo leer: va con el resto, como «Sin clasificar».
 */
function RepartoServicios({
  r,
  porPersona,
  P,
  href,
  className,
}: {
  r: ResumenPersonas;
  porPersona: boolean;
  P: ParamsPersonas;
  href: (f: Record<string, string>) => string;
  className?: string;
}) {
  const lista = [...(r.porServicio ?? [])].filter((s) => s.n > 0).sort((a, b) => b.n - a.n);
  if (lista.length < 2) return null;
  const unidad = (n: number) => (porPersona ? plural(n, "persona", "personas") : plural(n, "contratación", "contrataciones"));
  const nombrados = lista.filter((s) => s.servicio !== "Otros").slice(0, SERVICIOS_A_LA_VISTA);
  const resto = lista.filter((s) => !nombrados.includes(s));
  const sinClasificar = resto.find((s) => s.servicio === "Otros");
  const demas = resto.length - (sinClasificar ? 1 : 0);
  const nombreResto = sinClasificar
    ? demas > 0 ? `Sin clasificar y ${plural(demas, "servicio más", "servicios más")}` : "Sin clasificar"
    : plural(demas, "servicio más", "servicios más");
  const restoN = resto.reduce((s, x) => s + x.n, 0);
  const restoMonto = resto.reduce((s, x) => s + (x.monto ?? 0), 0);
  const total = lista.reduce((s, x) => s + x.n, 0);
  const partes: ParteBarra[] = nombrados.map((s) => ({ clave: s.servicio, nombre: s.servicio, valor: s.n, texto: unidad(s.n) }));
  const otros: ParteBarra = { clave: "resto", nombre: nombreResto, valor: restoN, texto: unidad(restoN) };
  const enlace = (servicio: string) => href({ [P.servicio]: servicio });
  // Un solo servicio en el resto («Sin clasificar» solo): su fila es la suya, con su lista. Si mezcla varios, la fila no
  // tiene una lista propia y debajo se despliegan uno por uno (ninguno queda escondido).
  const restoUno = resto.length === 1 ? resto[0] : null;
  return (
    <div className={className}>
      <h3 className={TITULO}>Por tipo de servicio</h3>
      <BarraSegmentada className="mt-2.5" partes={partes} otros={otros} etiqueta={porPersona ? "Personas por tipo de servicio" : "Contrataciones por tipo de servicio"} />
      <table className="mt-2 w-full text-meta">
        <CabezaServicios porPersona={porPersona} />
        <tbody>
          {nombrados.map((s, i) => (
            <FilaServicio key={s.servicio} nombre={s.servicio} n={s.n} monto={s.monto} total={total} serie={i} href={enlace(s.servicio)} />
          ))}
          {restoN > 0 && (
            <FilaServicio nombre={nombreResto} n={restoN} monto={restoMonto} total={total} serie="otros" href={restoUno ? enlace(restoUno.servicio) : null} />
          )}
        </tbody>
      </table>
      {resto.length > 1 && (
        <details className="group/resto mt-1">
          <summary className="flex min-h-[32px] cursor-pointer list-none items-center gap-1.5 text-meta font-medium text-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
            <ChevronDown size={14} className="shrink-0 transition-transform duration-rapido group-open/resto:rotate-180" aria-hidden />
            Ver el resto, servicio por servicio
            <span className="rounded-full bg-paperDeep px-1.5 text-rotulo font-semibold tabular-nums text-ink">{numero(resto.length)}</span>
          </summary>
          <table className="mt-1 w-full text-meta">
            <CabezaServicios porPersona={porPersona} oculta />
            <tbody>
              {resto.map((s) => (
                <FilaServicio key={s.servicio} nombre={s.servicio === "Otros" ? "Sin clasificar" : s.servicio} n={s.n} monto={s.monto} total={total} href={enlace(s.servicio)} />
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

/** Los rótulos de la tabla de servicios (`oculta`: la del resto, que ya los tiene encima, sólo para el lector de pantalla). */
function CabezaServicios({ porPersona, oculta = false }: { porPersona: boolean; oculta?: boolean }) {
  return (
    <thead className={oculta ? "sr-only" : undefined}>
      <tr className="text-rotulo text-mute">
        <th scope="col" className="py-1 text-left font-medium">Servicio</th>
        <th scope="col" className="py-1 pl-3 text-right font-medium">{porPersona ? "Personas" : "Contrataciones"}</th>
        <th scope="col" className="py-1 pl-3 text-right font-medium">Parte</th>
        <th scope="col" className="py-1 pl-3 text-right font-medium">Pagado</th>
      </tr>
    </thead>
  );
}

/** Una fila de la tabla de servicios: su color en la barra (si lo tiene), su nombre (con su lista, si la tiene) y sus cifras. */
function FilaServicio({ nombre, n, monto, total, serie, href }: { nombre: string; n: number; monto: number; total: number; serie?: number | "otros"; href: string | null }) {
  const cuerpo = (
    <>
      {serie != null && <MuestraSerie i={serie} />}
      <span className="truncate">{nombre}</span>
    </>
  );
  return (
    <tr className="border-t border-line/60">
      {/* `max-w-0 w-full`: la celda del nombre toma lo que sobra y lo recorta con «…» (una tabla no recorta sola). */}
      <th scope="row" className="w-full max-w-0 py-1 text-left font-normal">
        {href ? (
          <Link
            href={href}
            prefetch={false}
            scroll={false}
            className="inline-flex min-h-7 max-w-full items-center gap-2 rounded text-inkSoft underline-offset-2 hover:text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
          >
            {cuerpo}
          </Link>
        ) : (
          <span className="inline-flex min-h-7 max-w-full items-center gap-2 text-inkSoft">{cuerpo}</span>
        )}
      </th>
      <td className="whitespace-nowrap py-1 pl-3 text-right font-mono tabular-nums text-ink">{numero(n)}</td>
      <td className="whitespace-nowrap py-1 pl-3 text-right font-mono tabular-nums text-inkSoft">{cuotaDe(n, total)}</td>
      <td className="whitespace-nowrap py-1 pl-3 text-right font-mono tabular-nums text-ink">{solesCompacto(monto)}</td>
    </tr>
  );
}
