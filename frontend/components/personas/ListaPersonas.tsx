import { Suspense } from "react";
import { BarraFiltros, Indicadores, IndicadoresSkeleton, Listado, ZonaResultados, type FiltroSecundario, type Indicador, type Parametros } from "@/components/listado";
import { numero, plural, solesCompacto } from "@/lib/formato";
import {
  ORDENES_PERSONAS,
  SENAL,
  filtrosDeUrl,
  getPersonas,
  parametrosDe,
  type FiltrosPersonas,
  type PaginaPersonas,
  type ParamsPersonas,
  type ResumenPersonas,
} from "@/lib/personas";
import { TablaPersonas, TablaPersonasSkeleton } from "./TablaPersonas";

const TAM = 20;

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/**
 * La lista de personas contratadas de un alcance (todo el país, una región, una entidad o los gobiernos de un partido),
 * con su barra de filtros y su tabla. Los filtros van en la URL con los nombres de `P` (dentro de una ficha, con `p`
 * delante: no chocan con los de sus contratos). `base`: lo que la lista conserva en sus enlaces (la pestaña, el período).
 * Server component: la barra y la tabla esperan cada una la misma página (`Suspense`).
 */
export function ListaPersonas({
  alcance,
  sp,
  P,
  ruta,
  base,
  deEntidad = false,
  filtrosExtra = [],
  conIndicadores = false,
}: {
  alcance: Pick<FiltrosPersonas, "entidad" | "dep" | "partido" | "periodo">;
  sp: Busqueda;
  P: ParamsPersonas;
  ruta: string;
  base: Parametros;
  deEntidad?: boolean;
  /** Filtros detrás de "Filtros" (la región en /app/personas). Sus valores ya vienen en `base`. */
  filtrosExtra?: FiltroSecundario[];
  conIndicadores?: boolean;
}) {
  const f = filtrosDeUrl(sp, P);
  const paginaP = getPersonas({ ...alcance, ...f, page: f.page, size: TAM });
  const parametros: Parametros = { ...base, ...parametrosDe(f, P) };
  const filtrada = !!(f.senal || f.severidad || f.servicio || f.anio || f.q) || filtrosExtra.some((x) => !!base[x.param]);
  return (
    <div className="space-y-4">
      {conIndicadores && (
        <Suspense fallback={<IndicadoresSkeleton n={4} />}>
          <CifrasPersonas pagina={paginaP} ruta={ruta} base={base} P={P} />
        </Suspense>
      )}
      <Listado ruta={ruta} parametros={parametros} paramPagina={P.page}>
        <Suspense fallback={<Barra resumen={null} P={P} filtrosExtra={filtrosExtra} />}>
          <BarraConConteos pagina={paginaP} P={P} filtrosExtra={filtrosExtra} />
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

async function BarraConConteos({ pagina, P, filtrosExtra }: { pagina: Promise<PaginaPersonas | null>; P: ParamsPersonas; filtrosExtra: FiltroSecundario[] }) {
  return <Barra resumen={(await pagina)?.resumen ?? null} P={P} filtrosExtra={filtrosExtra} />;
}

/** Señales (faceta), qué señal, tipo de servicio y año (a la vista), y el orden. Sin resumen, sin números. */
function Barra({ resumen: r, P, filtrosExtra }: { resumen: ResumenPersonas | null; P: ParamsPersonas; filtrosExtra: FiltroSecundario[] }) {
  const visibles: FiltroSecundario[] = [
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
      opciones: [...(r?.porAnio ?? [])].sort((a, b) => b.anio - a.anio).map((a) => ({ valor: String(a.anio), etiqueta: String(a.anio), conteo: a.n })),
    },
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
        opciones: [
          { valor: "con", etiqueta: "Con señales", conteo: r?.conSenales ?? null },
          { valor: "alta", etiqueta: "Graves", conteo: r?.alta ?? null, tono: "alta", icono: "alerta" },
          { valor: "media", etiqueta: "Para revisar", conteo: r?.media ?? null, tono: "media", icono: "atencion" },
          { valor: "sin", etiqueta: "Sin señales", conteo: r ? r.filas - r.conSenales : null },
        ],
      }}
      visibles={visibles}
      filtros={filtrosExtra}
      orden={{ param: P.orden, porDefecto: "senales", opciones: ORDENES_PERSONAS.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
    />
  );
}

async function CifrasPersonas({ pagina, ruta, base, P }: { pagina: Promise<PaginaPersonas | null>; ruta: string; base: Parametros; P: ParamsPersonas }) {
  const r = (await pagina)?.resumen;
  if (!r) return null;
  return <Indicadores items={cifras(r, ruta, base, P)} />;
}

/** Personas, monto, con señales y graves; las dos últimas abren la lista filtrada. */
export function cifras(r: ResumenPersonas, ruta: string, base: Parametros, P: ParamsPersonas): Indicador[] {
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) q.set(k, v);
    return `${ruta}?${q.toString()}`;
  };
  const anios = r.porAnio.map((a) => a.anio).sort((a, b) => a - b);
  const periodo = anios.length ? (anios[0] === anios[anios.length - 1] ? `en ${anios[0]}` : `de ${anios[0]} a ${anios[anios.length - 1]}`) : undefined;
  return [
    { valor: numero(r.personas), etiqueta: "personas contratadas", contexto: `con ${numero(r.ordenes)} órdenes de servicio` },
    {
      valor: solesCompacto(r.monto),
      etiqueta: "pagados por órdenes",
      // Lo que CONOSCE publicó con posibles errores (el RUC escrito como monto…) no se borra: se nombra, aparte.
      contexto: r.dudosas?.ordenes
        ? `${periodo ? `${periodo}; ` : ""}aparte, ${solesCompacto(r.dudosas.monto)} en ${plural(r.dudosas.ordenes, "orden", "órdenes")} con posible error de CONOSCE`
        : periodo,
    },
    { valor: numero(r.conSenales), etiqueta: "con alguna señal", contexto: "lo que dicen otros registros", href: href({ [P.severidad]: "con" }) },
    { valor: numero(r.alta), etiqueta: "con una señal grave", contexto: "candidatos del que gobierna, autoridades, inhabilitados", tono: r.alta > 0 ? "alta" : "neutro", href: href({ [P.severidad]: "alta" }) },
  ];
}
