import { Suspense } from "react";
import { Ayuda, EncabezadoPagina, Migas, Pagina } from "@/components/patrones";
import { Vistas } from "@/components/listado/Vistas";
import {
  BarraFiltros,
  Indicadores,
  IndicadoresSkeleton,
  Listado,
  ZonaResultados,
  type FiltroSecundario,
  type Indicador,
  type Parametros,
} from "@/components/listado";
import { TablaContratos, TablaContratosCargando } from "@/components/contratos/TablaContratos";
import { PROVINCIA_NOMBRE } from "@/components/mapa/provincias";
import {
  SECCIONES_FILTRO,
  enSeccion,
  filtroEtapa,
  filtroMesVisible,
  filtroOperativo,
  filtroTipo,
  filtrosMonto,
  filtrosVisibles,
} from "@/components/contratos/filtros";
import { getEntidad, getRegionesEntidades } from "@/lib/api-client";
import {
  ORDENES,
  contratosParametros,
  getContratos,
  getResumenContratos,
  parseContratosQuery,
  type ContratoResumen,
  type ContratosPagina,
  type ContratosQuery,
  type ResumenContratos,
} from "@/lib/contratos";
import { getOrdenes, parseOrdenesQuery, ordenesParametros, P_ORD } from "@/lib/ordenes";
import { ListaOrdenes, ListaOrdenesCargando, BarraOrdenesGeneral } from "@/components/ordenes/ListaOrdenes";
import { getMenores, parseMenoresQuery, menoresParametros, P_MEN } from "@/lib/menores";
import { ListaMenores, ListaMenoresCargando, BarraMenoresGeneral } from "@/components/menores/ListaMenores";
import { getZonas } from "@/lib/financiamiento";
import { ANIO_GOBIERNO_VIGENTE, getRankingPartidos } from "@/lib/partidosApi";
import { numero } from "@/lib/formato";

export const metadata = {
  // Solo la parte de la página: el layout raíz agrega " | Vigía Perú".
  title: "Contratos",
  description: "Todos los contratos públicos del SEACE que tiene Vigía, con su tipo, etapa, zona y estado de lectura.",
};

// Las tres vistas de la página paginan igual. Con 50 contratos, la lista era 10 pantallas en el celular (cada fila apila
// su monto y su fecha con el rótulo); con 25, la mitad, y nada se pierde: el paginador de abajo sube al inicio.
const SIZE = 25;
const SIZE_ORD = 25;
const SIZE_MEN = 25;
const RUTA = "/app/contratos";

/**
 * /app/contratos — plantilla Listado (DESIGN_SYSTEM.md §14.1):
 *   EncabezadoPagina → Vistas → Indicadores → Listado { BarraFiltros, ZonaResultados { TablaContratos } }
 *
 * Todo el estado (búsqueda, faceta, filtros, orden, página) vive en la URL. El API pagina
 * por cursor (`?cursor=` / `?antes=`, tokens opacos) y la lista dice "Anterior / Siguiente";
 * con la API vieja, por número de página (`?page=`). Cada fila abre el resumen del contrato
 * en el panel lateral; el dossier (/app/contratos/[ocid]) está en su pie. El mapa
 * (/app/mapa) muestra los mismos contratos por zona.
 *
 * Los conteos no frenan la tabla: las consultas arrancan juntas y cada pieza entra cuando
 * llega la suya (`Suspense`). Mientras cuentan, la barra de filtros se ve igual pero sin
 * números en los chips (sin conteo no hay número, nunca un 0 provisional) y las cifras de
 * cabecera van en esqueleto. Al filtrar, la navegación es una transición: lo anterior
 * queda atenuado hasta que llega lo nuevo, sin volver a los esqueletos.
 */
export default async function ContratosPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const vistaParam = Array.isArray(searchParams?.vista) ? searchParams.vista[0] : searchParams?.vista;
  if (vistaParam === "ordenes") return <OrdenesVista searchParams={searchParams} />;
  if (vistaParam === "menores") return <MenoresVista searchParams={searchParams} />;
  const query = parseContratosQuery(searchParams);
  const parametros = contratosParametros(query);
  // El total del universo sólo hace falta si algo (fuera de la faceta) recorta la base.
  const recortada = Object.entries(parametros).some(([k, v]) => k !== "riesgo" && k !== "orden" && !!v);
  // Arrancan ya, en paralelo; cada pieza espera sólo la suya.
  const pagina = getContratos({ ...query, size: SIZE });
  const resumen = getResumenContratos(query);
  // El resumen sin filtros: el denominador de las cifras y el conteo de la vista «Contratos». Sin filtros (ni riesgo, que
  // también recorta el total) es el mismo `resumen`; si no, una consulta más, la más cacheada del API.
  const resumenGlobal = recortada || parametros.riesgo ? getResumenContratos({}) : null;
  const universo = (resumenGlobal ?? resumen).then((r) => r?.total ?? null);
  // Nombres de zona y de entidad para la barra: consultas cacheadas que casi nunca tardan;
  // se esperan acá para que la barra, aun sin conteos, nombre bien lo filtrado.
  const [zonas, entidad, ranking] = await Promise.all([
    getZonas("departamento"),
    query.entidad ? getEntidad(query.entidad).catch(() => null) : Promise.resolve(null),
    // Partidos que gobiernan hoy (período 2023–2026), por número de contratos: el filtro "Partido que gobierna".
    getRankingPartidos(ANIO_GOBIERNO_VIGENTE, { limit: 100 }).catch(() => null),
  ]);
  const regiones = (zonas ?? []).map((z) => ({ ubigeo: z.ubigeo, nombre: z.nombre }));
  const partidos = (ranking?.data ?? []).map((p) => ({ clave: p.clave, nombre: p.nombre, contratos: p.contratos }));
  const entidadNombre = entidad?.entidad?.nombre ?? null;

  return (
    <Pagina className="space-y-5">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Contratos", href: "/app/contratos" }]} />
      <EncabezadoPagina
        titulo="Todos los contratos"
        bajada="Convocatorias del SEACE en la base de Vigía, con su tipo, etapa y estado de lectura."
        ayuda={
          <Ayuda titulo="¿Qué contratos hay aquí?">
            Cada convocatoria del SEACE que Vigía tiene en su base. Las que aún no tienen dictamen esperan que alguien
            financie su lectura; se leen por orden de llegada y nadie elige cuál.
          </Ayuda>
        }
      />
      <VistaConConteo vista="contratos" universo={universo} />

      <Suspense fallback={<IndicadoresSkeleton n={4} />}>
        <IndicadoresContratos resumen={resumen} global={resumenGlobal ?? Promise.resolve(null)} recortada={recortada} parametros={parametros} />
      </Suspense>

      <Listado ruta={RUTA} parametros={parametros} paramPagina="page">
        <Suspense fallback={<Barra resumen={null} parametros={parametros} regiones={regiones} partidos={partidos} entidadNombre={entidadNombre} filas={[]} />}>
          <BarraConConteos
            resumen={resumen}
            pagina={parametros.ubigeo?.length === 6 ? pagina : null}
            parametros={parametros}
            regiones={regiones}
            partidos={partidos}
            entidadNombre={entidadNombre}
          />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaContratosCargando />}>
            <Resultados pagina={pagina} parametros={parametros} query={query} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </Pagina>
  );
}

// ─── Piezas que esperan su propia consulta ───────────────────────────────────

async function IndicadoresContratos({
  resumen,
  global,
  recortada,
  parametros,
}: {
  resumen: Promise<ResumenContratos | null>;
  global: Promise<ResumenContratos | null>;
  recortada: boolean;
  parametros: Parametros;
}) {
  const [r, g] = await Promise.all([resumen, global]);
  if (!r) {
    return (
      <p className="text-meta text-mute" role="status">
        No pudimos contar los contratos en este momento.
      </p>
    );
  }
  return <Indicadores items={indicadores(r, recortada, g?.total ?? null, parametros)} />;
}

interface Region {
  ubigeo: string;
  nombre: string;
}

interface DatosBarra {
  parametros: Parametros;
  regiones: Region[];
  partidos: { clave: string; nombre: string; contratos: number }[];
  entidadNombre: string | null;
}

/** La barra con los conteos del resumen (y, si el filtro es un distrito, su nombre desde las filas). */
async function BarraConConteos({
  resumen,
  pagina,
  ...datos
}: DatosBarra & { resumen: Promise<ResumenContratos | null>; pagina: Promise<ContratosPagina | null> | null }) {
  const [r, p] = await Promise.all([resumen, pagina ?? Promise.resolve(null)]);
  return <Barra resumen={r} filas={p?.data ?? []} {...datos} />;
}

/**
 * Con `resumen = null` es la misma barra sin números: lo que se ve mientras cuentan (o si no respondió).
 *
 * A la vista, el alcance (región y periodo, como en Órdenes) y las tres preguntas de siempre; en el celular el kit las
 * pasa solas a «Filtros». Detrás de «Filtros», el resto agrupado: qué, quién compra, cuánto y la cola de lectura.
 */
function Barra({ resumen, parametros, regiones, partidos, entidadNombre, filas }: DatosBarra & { resumen: ResumenContratos | null; filas: ContratoResumen[] }) {
  return (
    <BarraFiltros
      // 1 o 2 caracteres no buscan: cada búsqueda es un render completo en el servidor y una consulta al API.
      busqueda={{ param: "q", placeholder: "Buscar por objeto, código o entidad…", etiqueta: "Buscar contratos", min: 3 }}
      // A la vista, las preguntas de casi todos (región, cuándo, si lo leyó Vigía, antecedentes del ganador). El riesgo
      // sólo existe en los contratos ya leídos (unos cientos de 800 mil): va en «Filtros», como en la ficha de una entidad.
      visibles={[filtroRegion(parametros, regiones, filas), filtroMesVisible(parametros), ...filtrosVisibles(resumen).filter((f) => f.param !== "riesgo")]}
      filtros={[...filtrosVisibles(resumen).filter((f) => f.param === "riesgo"), ...filtros({ resumen, parametros, partidos, entidadNombre })]}
      orden={{ param: "orden", porDefecto: "fecha", opciones: ORDENES.map((o) => ({ valor: o.value, etiqueta: o.label })) }}
    />
  );
}

async function Resultados({ pagina, parametros, query }: { pagina: Promise<ContratosPagina | null>; parametros: Parametros; query: ContratosQuery }) {
  const p = await pagina;
  return <TablaContratos pagina={p} parametros={parametros} actual={query.page ?? 1} cursor={query.cursor} antes={query.antes} tam={SIZE} />;
}

// ─── Indicadores ─────────────────────────────────────────────────────────────

/**
 * Las cifras de cabecera, con las palabras de §10.1, sobre la base que reparte la faceta:
 * todo lo que cumple los demás filtros (el resumen cuenta cada faceta sin su propio
 * filtro). Así "leídos" y los chips de la faceta hablan de los mismos contratos.
 *   · leídos = el análisis terminó por cualquier vía (publicado, en revisión o descartado);
 *   · con dictamen publicado = leídos cuya alerta está publicada (alto + medio + bajo).
 * "En cola" no va aquí: el balde `en_cola` del resumen también cuenta a los ya leídos.
 */
function indicadores(resumen: ResumenContratos, recortada: boolean, universo: number | null, parametros: Parametros): Indicador[] {
  // porRiesgo es una faceta: cuenta SIN el filtro de riesgo. Con un riesgo elegido, las cifras sólo cuentan ese, y el
  // total es el del resumen (todos los filtros): el mismo número que la lista. Antes, "500 contratos" con 30 en la lista.
  const r = resumen.porRiesgo;
  const elegido = parametros.riesgo;
  const n = (k: keyof typeof r) => (!elegido || elegido === k ? r[k] ?? 0 : 0);
  const base = resumen.total;
  const conDictamen = n("alto") + n("medio") + n("bajo");
  const leidos = conDictamen + n("en_revision") + n("descartado");
  return [
    {
      valor: numero(base),
      etiqueta: "contratos publicados",
      contexto: !recortada ? "convocatorias del SEACE" : universo != null ? `con estos filtros, de ${numero(universo)}` : "con estos filtros",
    },
    { valor: numero(leidos), etiqueta: "leídos", contexto: `de ${numero(base)} publicados` },
    {
      valor: numero(conDictamen),
      etiqueta: "con dictamen publicado",
      contexto: `de ${numero(leidos)} leídos`,
      ayuda: (
        <Ayuda titulo="¿Leído o con dictamen?">
          Leído: el análisis terminó, por cualquier vía. Con dictamen publicado: leídos cuyo resultado ya es público; el
          resto está en revisión humana o se descartó.
        </Ayuda>
      ),
    },
    {
      valor: numero(n("alto")),
      etiqueta: "con riesgo alto",
      tono: "alta",
      contexto: `de ${numero(conDictamen)} con dictamen`,
      href: hrefCon(parametros, { lectura: "publicado", riesgo: "alto" }),
    },
  ];
}

function hrefCon(parametros: Parametros, cambio: Parametros): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...parametros, ...cambio })) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${RUTA}?${qs}` : RUTA;
}

// ─── Filtros ─────────────────────────────────────────────────────────────────
// Las preguntas a la vista y los filtros comunes viven en components/contratos/filtros.ts (los usa también la ficha
// de la entidad); aquí, lo propio de la lista de todo el Perú: región, partido y entidad.

/** Nombre de la zona elegida: departamento de la lista, provincia por su ubigeo, distrito por la fila. */
function nombreZona(ubigeo: string, filas: ContratoResumen[]): string {
  if (ubigeo.length === 4 && PROVINCIA_NOMBRE[ubigeo]) return `Provincia de ${PROVINCIA_NOMBRE[ubigeo]}`;
  const fila = filas.find((f) => f.ubigeo === ubigeo && f.zona);
  return fila?.zona ?? `Zona ${ubigeo}`;
}

/**
 * La región (departamento), a la vista y con el mismo nombre que en Órdenes y Menores. Una provincia o un distrito
 * llegan por enlace (el mapa): se agregan con su nombre para que el desplegable diga qué zona filtra.
 */
function filtroRegion(parametros: Parametros, regiones: Region[], filas: ContratoResumen[]): FiltroSecundario {
  const opciones = [...regiones].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((z) => ({ valor: z.ubigeo, etiqueta: z.nombre }));
  const ubigeo = parametros.ubigeo;
  if (ubigeo && !opciones.some((z) => z.valor === ubigeo)) opciones.unshift({ valor: ubigeo, etiqueta: nombreZona(ubigeo, filas) });
  return { param: "ubigeo", etiqueta: "Región", corta: "Región", todas: "Todo el Perú", opciones };
}

function filtros({
  resumen,
  parametros,
  partidos,
  entidadNombre,
}: {
  resumen: ResumenContratos | null;
  parametros: Parametros;
  partidos: { clave: string; nombre: string; contratos: number }[];
  entidadNombre: string | null;
}): FiltroSecundario[] {
  return [
    ...enSeccion(SECCIONES_FILTRO.que, filtroTipo(resumen), filtroEtapa()),
    ...enSeccion(
      SECCIONES_FILTRO.quien,
      // La entidad se elige desde el panel de un contrato («Ver sólo los contratos de esta entidad»), su ficha o un
      // dictamen: aquí aparece puesta, con su nombre, para poder quitarla. Un desplegable con todas no cabe (son miles).
      ...(parametros.entidad
        ? [{ param: "entidad", etiqueta: "Entidad", todas: "Toda entidad", opciones: [{ valor: parametros.entidad, etiqueta: entidadNombre ?? `RUC ${parametros.entidad}` }] }]
        : []),
      {
        param: "partido",
        etiqueta: "Partido que gobierna la entidad",
        // ~100 partidos: se escribe y se elige, no se recorre a ojo.
        buscable: true,
        todas: "Cualquiera",
        // Conteo: contratos de sus gobiernos en el período (no cruzado con los demás filtros).
        // El conteo entre paréntesis, como en todo desplegable de la barra.
        opciones: partidos.map((p) => ({ valor: p.clave, etiqueta: p.nombre, conteo: p.contratos })),
      },
    ),
    ...enSeccion(SECCIONES_FILTRO.cuanto, ...filtrosMonto(parametros)),
    ...enSeccion(SECCIONES_FILTRO.lectura, filtroOperativo(resumen)),
  ];
}

// ─── Vistas: Contratos, Órdenes y Menores (subsecciones del mismo índice) ──────
// Tres poblaciones del mismo lugar (§14.1 Vistas): un toggle, no un filtro. Las órdenes de compra y de servicio son
// compras directas del Estado; hasta ahora solo se veían dentro de una persona o empresa.

type VistaIndice = "contratos" | "ordenes" | "menores";

/**
 * Tres ángulos del mismo universo: «Contratos» (con concurso) y, como compra directa, «Órdenes» (el pago) y «Menores»
 * (el expediente ≤8 UIT). Órdenes y Menores se solapan (misma compra, dos registros) pero no se suman; el ⓘ lo explica.
 *
 * Sólo «Contratos» lleva conteo: sale del resumen sin filtros, que ya está (o es la consulta más cacheada del API). Órdenes
 * y Menores no se cuentan: su API pagina por «hay más» para no contar millones de filas, y un número inventado no va.
 * `conteo: null` = contando (hueco, nunca un 0); `undefined` = sin número.
 */
function VistaToggle({ vista, conteo }: { vista: VistaIndice; conteo?: number | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Vistas
        etiqueta="Vista del índice"
        vistas={[
          { etiqueta: "Contratos", href: RUTA, activa: vista === "contratos", conteo },
          { etiqueta: "Órdenes", href: `${RUTA}?vista=ordenes`, activa: vista === "ordenes" },
          { etiqueta: "Menores", href: `${RUTA}?vista=menores`, activa: vista === "menores" },
        ]}
      />
      <Ayuda titulo="¿Contratos, Órdenes o Menores?">
        <span className="block">Son tres ángulos del mismo universo de compras del Estado, no tres sumas distintas.</span>
        <span className="mt-2 block">Contratos: los procesos con concurso (bases y postores compitiendo).</span>
        <span className="block">Órdenes: lo que el Estado pagó directo, el registro completo e histórico (28 millones).</span>
        <span className="block">Menores: las compras chicas (hasta 8 UIT) con su requerimiento y ventana de cotización.</span>
        <span className="mt-2 block">Una misma compra chica puede aparecer en Órdenes (el pago) y en Menores (el expediente): son la misma, vista distinta, no se suman.</span>
      </Ayuda>
    </div>
  );
}

/** Las vistas con el conteo de «Contratos» en cuanto llega; mientras, las mismas vistas con el hueco del número. */
function VistaConConteo({ vista, universo }: { vista: VistaIndice; universo: Promise<number | null> }) {
  return (
    <Suspense fallback={<VistaToggle vista={vista} conteo={null} />}>
      <VistaContada vista={vista} universo={universo} />
    </Suspense>
  );
}

async function VistaContada({ vista, universo }: { vista: VistaIndice; universo: Promise<number | null> }) {
  // Si el resumen no respondió, la vista va sin número (no con el hueco de "contando" para siempre).
  const n = await universo.catch(() => null);
  return <VistaToggle vista={vista} conteo={n ?? undefined} />;
}

/** El total de contratos de la base, para la vista «Contratos» desde Órdenes y Menores. */
const totalContratos = () => getResumenContratos({}).then((r) => r?.total ?? null);

async function OrdenesVista({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const oq = parseOrdenesQuery(searchParams);
  const parametros = ordenesParametros(oq);
  const pagina = getOrdenes({ ...oq, size: SIZE_ORD });
  const universo = totalContratos();
  const regiones = await getRegionesEntidades().catch(() => []);
  return (
    <Pagina className="space-y-5">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Contratos", href: "/app/contratos" }]} />
      <EncabezadoPagina
        titulo="Órdenes de compra y de servicio"
        bajada="Las compras directas del Estado (CONOSCE), por lo general sin concurso ni otros postores."
        ayuda={
          <Ayuda titulo="¿Qué hay aquí?">
            Las órdenes de compra y de servicio que Vigía tiene en su base (CONOSCE), que son compras directas, por lo
            general sin concurso. Para las convocatorias con proceso, usa la pestaña Contratos.
          </Ayuda>
        }
      />
      <VistaConConteo vista="ordenes" universo={universo} />
      <Listado ruta={RUTA} parametros={parametros} paramPagina={P_ORD.page}>
        <Suspense fallback={<div className="min-h-[52px]" />}>
          <BarraOrdenesGeneral pagina={pagina} regiones={regiones} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<ListaOrdenesCargando />}>
            <ListaOrdenes pagina={pagina} ruta={RUTA} parametros={parametros} actual={oq.page ?? 1} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </Pagina>
  );
}

// ─── Vista Contratos Menores (≤8 UIT) ──────────────────────────────────────────
// La contratación directa por montos pequeños (SEACE, módulo de menores): es la fase que NO aparece en las órdenes de
// CONOSCE ni en los datos abiertos. Trae el requerimiento/TDR y el contrato en PDF. Fuente: prod4 + prod6 (ver /menores).

async function MenoresVista({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const mq = parseMenoresQuery(searchParams);
  const parametros = menoresParametros(mq);
  const pagina = getMenores({ ...mq, size: SIZE_MEN });
  const universo = totalContratos();
  const regiones = await getRegionesEntidades().catch(() => []);
  return (
    <Pagina className="space-y-5">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Contratos", href: "/app/contratos" }]} />
      <EncabezadoPagina
        titulo="Contratos menores (≤8 UIT)"
        bajada="Las compras chicas del Estado (hasta 8 UIT) con su requerimiento y ventana de cotización (SEACE)."
        ayuda={
          <Ayuda titulo="¿Qué son los contratos menores?">
            Compras del Estado por montos pequeños (hasta 8 UIT, unos S/ 42,800). Por ley se contratan de forma directa,
            sin concurso. A diferencia de una orden, aquí sí suele publicarse el requerimiento (las especificaciones) y
            una ventana de cotización. El módulo es facultativo, así que no están todas las del país.
          </Ayuda>
        }
      />
      <VistaConConteo vista="menores" universo={universo} />
      <Listado ruta={RUTA} parametros={parametros} paramPagina={P_MEN.page}>
        <Suspense fallback={<div className="min-h-[52px]" />}>
          <BarraMenoresGeneral pagina={pagina} regiones={regiones} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<ListaMenoresCargando />}>
            <ListaMenores pagina={pagina} ruta={RUTA} parametros={parametros} actual={mq.page ?? 1} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </Pagina>
  );
}
