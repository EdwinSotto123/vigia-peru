import { Suspense } from "react";
import { BarraFiltros, Indicadores, IndicadoresSkeleton, Listado, ZonaResultados, type FiltroSecundario, type Indicador, type Parametros } from "@/components/listado";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { esAnioGobierno, periodoTexto } from "@/lib/partidosApi";
import {
  ORDENES_PERSONAS,
  SENAL,
  TRAMOS_PERSONA,
  etiquetasUnicas,
  filtrosDeUrl,
  getPersonas,
  parametrosDe,
  type FacetasPersonas,
  type FiltrosPersonas,
  type PaginaPersonas,
  type ParamsPersonas,
  type ResumenPersonas,
} from "@/lib/personas";
import { TablaPersonas, TablaPersonasSkeleton } from "./TablaPersonas";

const TAM = 20;
/** Desplegables a la vista, como mucho (BarraFiltros v2): los que sobran van dentro de «Filtros». */
const MAX_VISIBLES = 3;

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/**
 * La lista de personas contratadas de un alcance (todo el país, una región, una entidad o los gobiernos de un partido),
 * con su barra de filtros y su tabla. Los filtros van en la URL con los nombres de `P` (dentro de una ficha, con `p`
 * delante: no chocan con los de sus contratos). `base`: lo que la lista conserva en sus enlaces (la pestaña, el período).
 * Server component: la barra y la tabla esperan cada una la misma página (`Suspense`).
 *
 * QUÉ CUENTA CADA CIFRA (GET /personas, persona_resumen de la migración 91): `personas` son personas distintas (por su
 * RUC); `filas`, `conSenales`, `alta` y `media` son CONTRATACIONES (una persona en una entidad), lo mismo que lista la
 * tabla. En el país una persona que trabajó para dos entidades cuenta dos veces; en una entidad, una fila es una
 * persona. Por eso cada cifra nombra su unidad y nunca divide contrataciones entre personas.
 */
export function ListaPersonas({
  alcance,
  sp,
  P,
  ruta,
  base,
  deEntidad = false,
  visiblesExtra = [],
  filtrosExtra = [],
  conIndicadores = false,
}: {
  alcance: Pick<FiltrosPersonas, "entidad" | "dep" | "partido" | "periodo">;
  sp: Busqueda;
  P: ParamsPersonas;
  ruta: string;
  base: Parametros;
  deEntidad?: boolean;
  /** Filtros a la vista, antes de los propios (la región en /app/personas). Sus valores ya vienen en `base`. */
  visiblesExtra?: FiltroSecundario[];
  /** Filtros detrás de «Filtros». Sus valores ya vienen en `base`. */
  filtrosExtra?: FiltroSecundario[];
  conIndicadores?: boolean;
}) {
  const f = filtrosDeUrl(sp, P);
  const paginaP = getPersonas({ ...alcance, ...f, page: f.page, size: TAM });
  const parametros: Parametros = { ...base, ...parametrosDe(f, P) };
  const extras = [...visiblesExtra, ...filtrosExtra];
  const filtrada = !!(f.senal || f.severidad || f.servicio || f.anio || f.gobierno || f.monto || f.meses || f.q) || extras.some((x) => !!base[x.param]);
  // La entidad que llega de su ficha (/app/personas?entidad=<RUC>): se nombra en su chip y se quita con su ×. En la ficha
  // de la propia entidad no (es el alcance, no un filtro).
  const entidad = !deEntidad && alcance.entidad ? alcance.entidad : undefined;
  // En la ficha de un partido, el partido que gobernaba es el alcance: su filtro no va.
  const conGobierno = !alcance.partido;
  return (
    <div className="space-y-4">
      {conIndicadores && (
        <Suspense fallback={<IndicadoresSkeleton n={4} />}>
          <CifrasPersonas pagina={paginaP} ruta={ruta} base={base} P={P} deEntidad={deEntidad} />
        </Suspense>
      )}
      <Listado ruta={ruta} parametros={parametros} paramPagina={P.page}>
        <Suspense
          fallback={
            <Barra resumen={null} facetas={null} P={P} visiblesExtra={visiblesExtra} filtrosExtra={filtrosExtra} entidad={entidad ? { ruc: entidad, nombre: null } : null} conGobierno={conGobierno} gobierno={f.gobierno} />
          }
        >
          <BarraConConteos pagina={paginaP} P={P} visiblesExtra={visiblesExtra} filtrosExtra={filtrosExtra} entidad={entidad} conGobierno={conGobierno} gobierno={f.gobierno} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaPersonasSkeleton deEntidad={deEntidad} />}>
            <Resultados pagina={paginaP} parametros={parametros} ruta={ruta} actual={f.page ?? 1} P={P} deEntidad={deEntidad} filtrada={filtrada} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </div>
  );
}

async function Resultados(props: {
  pagina: Promise<PaginaPersonas | null>;
  parametros: Parametros;
  ruta: string;
  actual: number;
  P: ParamsPersonas;
  deEntidad: boolean;
  filtrada: boolean;
}) {
  return (
    <TablaPersonas
      pagina={await props.pagina}
      parametros={props.parametros}
      ruta={props.ruta}
      actual={props.actual}
      paramPagina={props.P.page}
      deEntidad={props.deEntidad}
      filtrada={props.filtrada}
    />
  );
}

async function BarraConConteos({
  pagina,
  P,
  visiblesExtra,
  filtrosExtra,
  entidad,
  conGobierno,
  gobierno,
}: {
  pagina: Promise<PaginaPersonas | null>;
  P: ParamsPersonas;
  visiblesExtra: FiltroSecundario[];
  filtrosExtra: FiltroSecundario[];
  entidad?: string;
  conGobierno: boolean;
  gobierno?: string;
}) {
  const pg = await pagina;
  // Con la entidad elegida, todas las filas son de ella: su nombre sale de la primera.
  const nombre = entidad ? pg?.data.find((x) => x.entidadRuc === entidad)?.entidad ?? null : null;
  return (
    <Barra
      resumen={pg?.resumen ?? null}
      facetas={pg?.facetas ?? null}
      P={P}
      visiblesExtra={visiblesExtra}
      filtrosExtra={filtrosExtra}
      entidad={entidad ? { ruc: entidad, nombre } : null}
      conGobierno={conGobierno}
      gobierno={gobierno}
    />
  );
}

/**
 * Señales (faceta), y a la vista la región (si la hay), qué señal y el tipo de servicio; en «Filtros», cuándo (el año y
 * el partido que gobernaba la entidad), cuánto (lo que le pagó y en cuántos meses) y la entidad. Sin resumen, sin
 * números. Los conteos de la faceta son contrataciones, como la lista; los de gobierno y tramos, del alcance.
 */
function Barra({
  resumen: r,
  facetas,
  P,
  visiblesExtra,
  filtrosExtra,
  entidad,
  conGobierno,
  gobierno,
}: {
  resumen: ResumenPersonas | null;
  facetas: FacetasPersonas | null;
  P: ParamsPersonas;
  visiblesExtra: FiltroSecundario[];
  filtrosExtra: FiltroSecundario[];
  entidad: { ruc: string; nombre: string | null } | null;
  conGobierno: boolean;
  /** El gobierno elegido: su filtro se queda aunque no haya opciones (si no, su chip no se podría quitar). */
  gobierno?: string;
}) {
  const propios: FiltroSecundario[] = [
    {
      param: P.senal,
      etiqueta: "Señal",
      corta: "Señal",
      todas: "Toda señal",
      opciones: (r?.porSenal ?? []).map((s) => ({ valor: s.tipo, etiqueta: SENAL[s.tipo]?.corto ?? s.tipo, conteo: s.n })),
    },
    {
      param: P.servicio,
      etiqueta: "Tipo de servicio",
      corta: "Servicio",
      todas: "Todo servicio",
      opciones: (r?.porServicio ?? []).map((s) => ({ valor: s.servicio, etiqueta: s.servicio, conteo: s.n })),
    },
    {
      param: P.anio,
      etiqueta: "Año de la orden",
      corta: "Año",
      todas: "Todos los años",
      seccion: "Cuándo",
      opciones: [...(r?.porAnio ?? [])].sort((a, b) => b.anio - a.anio).map((a) => ({ valor: String(a.anio), etiqueta: String(a.anio), conteo: a.n })),
    },
  ];
  // La región va primero (es la pregunta de casi todos); si con ella pasan de tres, el año baja a «Filtros».
  const enFila = [...visiblesExtra, ...propios];
  const visibles = enFila.slice(0, MAX_VISIBLES);
  const tramo = (t: keyof typeof TRAMOS_PERSONA, param: string, etiqueta: string, todas: string): FiltroSecundario => ({
    param, etiqueta, todas, seccion: "Cuánto",
    opciones: TRAMOS_PERSONA[t].map((o) => ({ ...o, conteo: facetas?.tramos?.[t]?.[o.valor] ?? null })),
  });
  const filtros: FiltroSecundario[] = [
    ...enFila.slice(MAX_VISIBLES),
    // Sin partidos que la gobernaran (una entidad nacional), el filtro no va: no tendría nada que elegir.
    ...(conGobierno && (!facetas || facetas.gobiernos.length > 0 || gobierno)
      ? [{
          // Con el período: el mismo partido gobernó otras entidades (u otra vez la misma) en otros años.
          param: P.gobierno, etiqueta: "Partido que gobernaba la entidad", todas: "Cualquier partido", seccion: "Cuándo", buscable: true,
          opciones: etiquetasUnicas((facetas?.gobiernos ?? []).map((g) => ({
            valor: g.valor,
            etiqueta: `${g.nombre ?? g.valor.split(":")[0]} (${esAnioGobierno(g.anio) ? periodoTexto(g.anio) : g.anio})`,
            conteo: g.n,
          }))),
        }]
      : []),
    tramo("monto", P.monto, "Lo que le pagó la entidad", "Cualquier monto"),
    tramo("meses", P.meses, "Meses con órdenes", "Cualquier número de meses"),
    ...filtrosExtra,
    ...(entidad
      ? [{ param: "entidad", etiqueta: "Entidad", todas: "Toda entidad", seccion: "Dónde", opciones: [{ valor: entidad.ruc, etiqueta: entidad.nombre ? tituloNatural(entidad.nombre) : `RUC ${entidad.ruc}` }] }]
      : []),
  ];
  return (
    <BarraFiltros
      busqueda={{ param: P.q, placeholder: "Buscar por entidad o tipo de servicio…", etiqueta: "Buscar en las personas contratadas", min: 3 }}
      faceta={{
        param: P.severidad,
        etiqueta: "Señales",
        todas: "Todas",
        conteoTodas: r?.filas ?? null,
        nombreEnChip: false,
        // El mismo vocabulario de severidad que todo el producto (`Severidad`: «Señal alta», «Señal media»).
        opciones: [
          { valor: "con", etiqueta: "Con señales", conteo: r?.conSenales ?? null },
          { valor: "alta", etiqueta: "Con señal alta", conteo: r?.alta ?? null, tono: "alta", icono: "alerta" },
          { valor: "media", etiqueta: "Con señal media", conteo: r?.media ?? null, tono: "media", icono: "atencion" },
          { valor: "sin", etiqueta: "Sin señales", conteo: r ? r.filas - r.conSenales : null },
        ],
      }}
      visibles={visibles}
      filtros={filtros}
      orden={{ param: P.orden, porDefecto: "senales", opciones: ORDENES_PERSONAS.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
    />
  );
}

async function CifrasPersonas({ pagina, ruta, base, P, deEntidad }: { pagina: Promise<PaginaPersonas | null>; ruta: string; base: Parametros; P: ParamsPersonas; deEntidad: boolean }) {
  const r = (await pagina)?.resumen;
  if (!r) return null;
  return <Indicadores items={cifras(r, ruta, base, P, deEntidad)} />;
}

/**
 * Personas, monto, con señales y con una señal alta; las dos últimas abren la lista filtrada. Cada una dice su unidad:
 * las personas son personas distintas y las señales se cuentan por contratación (como la lista y la faceta). En una
 * entidad las dos unidades son la misma.
 */
export function cifras(r: ResumenPersonas, ruta: string, base: Parametros, P: ParamsPersonas, deEntidad = false): Indicador[] {
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) q.set(k, v);
    return `${ruta}?${q.toString()}`;
  };
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
      // Lo que CONOSCE publicó con posibles errores (el RUC escrito como monto…) no se borra: se nombra, aparte.
      contexto: r.dudosas?.ordenes
        ? `${pagos ? `${pagos}; ` : ""}aparte, ${solesCompacto(r.dudosas.monto)} en ${plural(r.dudosas.ordenes, "orden", "órdenes")} con posible error de CONOSCE`
        : pagos || undefined,
    },
    {
      valor: numero(r.conSenales),
      etiqueta: porPersona ? "con alguna señal" : "contrataciones con alguna señal",
      contexto: `de ${porPersona ? plural(r.filas, "persona", "personas") : numero(r.filas)}; lo que dicen otros registros`,
      href: href({ [P.severidad]: "con" }),
    },
    {
      valor: numero(r.alta),
      etiqueta: porPersona ? "con una señal alta" : "contrataciones con una señal alta",
      contexto: `de ${numero(r.filas)}; candidatos del que gobierna, autoridades, inhabilitados`,
      tono: r.alta > 0 ? "alta" : "neutro",
      href: href({ [P.severidad]: "alta" }),
    },
  ];
}
