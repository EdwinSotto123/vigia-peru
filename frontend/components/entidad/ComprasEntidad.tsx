import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Ayuda, CabeceraPestana, EstadoVacio, Pestanas, type Pestana } from "@/components/patrones";
import { BarraFiltros, Listado, TablaSkeleton, ZonaResultados, type FiltroSecundario, type Parametros } from "@/components/listado";
import { TablaContratos, TablaContratosSkeleton } from "@/components/contratos/TablaContratos";
import { chipsDeEnlace, filtroEtapa, filtroMes, filtroObra, filtroOperativo, filtroTipo, filtrosMonto, filtrosVisibles } from "@/components/contratos/filtros";
import { BarraMenoresGeneral, ListaMenores } from "@/components/menores/ListaMenores";
import { BarraOrdenesGeneral, ListaOrdenes } from "@/components/ordenes/ListaOrdenes";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";
import { CRUCE_CAPTURA } from "./CapturaEntidad";
import { Diferida } from "./PestanasEntidad";
import { TIPO_CRUCE } from "@/lib/cruces";
import { ORDENES, getContratos, type ContratosPagina, type ContratosQuery, type ResumenContratos } from "@/lib/contratos";
import { getMenores, P_MEN, type FiltrosMenores } from "@/lib/menores";
import { getOrdenes, P_ORD, type FiltrosOrdenes } from "@/lib/ordenes";

/**
 * La pestaña Contratos de la ficha de una entidad: lo que compró, en tres vistas (`?vista=`, pestañas de segundo nivel,
 * como «Ventas al Estado» en la ficha de una empresa), cada una con su número:
 *   · Contratos: sus convocatorias desde 2015 (con su ganador), con los filtros de /app/contratos y la misma tabla.
 *   · Órdenes: sus órdenes de compra y de servicio desde 2018 (CONOSCE), la lista de /app/contratos?vista=ordenes.
 *   · Menores: sus contratos de hasta 8 UIT del SEACE, con el requerimiento descargable.
 * Antes las órdenes no estaban en la ficha (UNA Chupaca: «1 contrato desde 2015» y 124 órdenes en 2026 por S/ 940 mil) y
 * los contratos menores eran una pestaña aparte, vacía en casi todas las entidades. Las vistas vacías van al final y dicen
 * por qué no hay y dónde mirar; la abierta se arma primero y las otras después (`Diferida`).
 *
 * Nunca se suman: una compra chica puede estar en Órdenes (el pago) y en Menores (el expediente), y una orden puede venir
 * de un proceso de selección.
 */

/** Filas por página en las tres vistas. */
export const TAM = 20;
export const VISTAS = ["contratos", "ordenes", "menores"] as const;
export type VistaCompras = (typeof VISTAS)[number];
const ETIQUETA: Record<VistaCompras, string> = { contratos: "Contratos", ordenes: "Órdenes", menores: "Menores" };

interface Props {
  ruc: string;
  ruta: string;
  /** Las tres vistas en su orden (las vacías al final) y la abierta. */
  orden: VistaCompras[];
  activa: VistaCompras;
  /** Cuántas filas tiene cada una; null = sin dato (la vista va sin número y muestra su lista). */
  conteo: Record<VistaCompras, number | null>;
  /** El primer año con contratos menores en la base (el módulo del SEACE es reciente). */
  menoresDesde: number | null;
  /** Los filtros de cada lista, ya leídos de la URL (sin la entidad: la fija la ficha). */
  contratos: { query: ContratosQuery; parametros: Parametros; resumen: Promise<ResumenContratos | null> };
  ordenes: FiltrosOrdenes;
  menores: FiltrosMenores;
}

export function ComprasEntidad(props: Props) {
  const { orden, activa, conteo } = props;
  const pestanas: Pestana[] = orden.map((v) => {
    const cuerpo = <Vista v={v} {...props} />;
    return {
      clave: v,
      etiqueta: ETIQUETA[v],
      conteo: conteo[v],
      contenido: v === activa ? cuerpo : (
        <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: ETIQUETA[v], ancho: "1fr" }]} filas={8} />}>
          <Diferida>{cuerpo}</Diferida>
        </Suspense>
      ),
    };
  });
  return (
    <div>
      {/* Sólo el título y su ⓘ: en el celular, con la barra de filtros, el primer contrato quedaba a 1.6 pantallas. */}
      <CabeceraPestana ayuda={<AyudaCompras />} />
      <Pestanas variante="segunda" key={activa} param="vista" activa={activa} etiqueta="Contratos, órdenes y contratos menores de la entidad" pestanas={pestanas} />
    </div>
  );
}

/** La ⓘ de la pestaña: qué hay en cada vista y por qué no se suman. */
export function AyudaCompras() {
  return (
    <Ayuda titulo="¿Qué compras hay aquí?">
      <span className="block">
        Contratos: todas sus convocatorias desde 2015, con su ganador y lo que se le adjudicó (registro OCDS del OECE), lo que
        leyó Vigía y los antecedentes de quien ganó. Las de 2026 entran a la cola de lectura; cada fila abre su resumen y el
        dossier completo, con el dictamen si ya se leyó, está en su ficha.
      </span>
      <span className="mt-2 block">Órdenes: sus órdenes de compra y de servicio desde 2018 (CONOSCE), compras directas por lo general sin concurso.</span>
      <span className="mt-2 block">
        Menores: sus contratos de hasta 8 UIT en el módulo del SEACE, con el requerimiento descargable. El módulo es facultativo:
        no están todos.
      </span>
      <span className="mt-2 block">
        No se suman: una compra chica puede estar en Órdenes (el pago) y en Menores (el expediente). Los antecedentes salen del
        cruce automático de datos públicos: son motivos para revisar, no pruebas.
      </span>
    </Ayuda>
  );
}

/** Los parámetros que conserva cada lista en sus enlaces: la pestaña, la vista (si no es la primera) y sus filtros. */
function base(v: VistaCompras, orden: VistaCompras[]): Parametros {
  return { seccion: "contratos", ...(v === orden[0] ? {} : { vista: v }) };
}

/** Los filtros puestos de una lista (FiltrosOrdenes, FiltrosMenores), con los nombres de su URL (sin la página). */
function deFiltros(P: Readonly<Record<string, string>>, f: object): Parametros {
  const out: Parametros = {};
  for (const [k, param] of Object.entries(P)) {
    const v = (f as Record<string, unknown>)[k];
    if (k !== "page" && v != null && v !== "") out[param] = String(v);
  }
  return out;
}

/** El enlace a otra vista de esta pestaña (con sus filtros, si van). */
const aVista = (ruta: string, v: VistaCompras, extra: Record<string, string> = {}) =>
  `${ruta}?${new URLSearchParams({ seccion: "contratos", vista: v, ...extra })}`;

function Vista({ v, ...p }: Props & { v: VistaCompras }) {
  const hayOrdenes = p.conteo.ordenes !== 0;
  if (p.conteo[v] === 0) {
    if (v === "contratos") {
      return (
        <EstadoVacio
          compacto
          conLlamita={false}
          titulo="No registra convocatorias desde 2015"
          accion={hayOrdenes ? <Link href={aVista(p.ruta, "ordenes")} prefetch={false} className={CLASE_ACCION_LISTA}>Ver sus órdenes</Link> : undefined}
        >
          El registro de contrataciones del OECE (OCDS) no tiene procesos de selección con su RUC.
          {hayOrdenes ? " Lo que compró sin proceso está en Órdenes." : ""}
        </EstadoVacio>
      );
    }
    if (v === "ordenes") {
      return (
        <EstadoVacio
          compacto
          conLlamita={false}
          titulo="No registra órdenes de compra ni de servicio"
          accion={p.conteo.contratos ? <Link href={aVista(p.ruta, "contratos")} prefetch={false} className={CLASE_ACCION_LISTA}>Ver sus contratos</Link> : undefined}
        >
          CONOSCE (OECE) no tiene órdenes con su RUC desde 2018.
        </EstadoVacio>
      );
    }
    return (
      <EstadoVacio
        compacto
        conLlamita={false}
        titulo="No registra contratos menores"
        accion={
          hayOrdenes ? (
            <Link href={aVista(p.ruta, "ordenes", { [P_ORD.como]: "hasta_uit" })} prefetch={false} className={CLASE_ACCION_LISTA}>
              Ver sus órdenes de hasta 8 UIT
            </Link>
          ) : undefined
        }
      >
        El módulo de contratos menores del SEACE (hasta 8 UIT) es facultativo y se usa desde {p.menoresDesde ?? 2025}: no todas las
        entidades lo usan.{hayOrdenes ? " Sus compras de hasta 8 UIT también se registran como órdenes de compra o de servicio." : ""}
      </EstadoVacio>
    );
  }
  if (v === "contratos") return <VistaContratos {...p} />;
  if (v === "ordenes") return <VistaOrdenes {...p} />;
  return <VistaMenores {...p} />;
}

// ─── Contratos ───────────────────────────────────────────────────────────────

function VistaContratos({ ruta, orden, contratos: { query, parametros: filtros, resumen } }: Props) {
  const parametros: Parametros = { ...filtros, ...base("contratos", orden) };
  // Se pide aquí, cuando la vista se arma: si no es la abierta, después de lo de la abierta.
  const pagina = getContratos({ ...query, size: TAM });
  return (
    <Listado ruta={ruta} parametros={parametros} paramPagina="page">
      <Suspense fallback={<BarraEntidad resumen={null} parametros={parametros} />}>
        <BarraConConteos resumen={resumen} parametros={parametros} />
      </Suspense>
      <ZonaResultados>
        <Suspense fallback={<TablaContratosSkeleton />}>
          <Resultados pagina={pagina} parametros={parametros} query={query} ruta={ruta} />
        </Suspense>
      </ZonaResultados>
    </Listado>
  );
}

async function BarraConConteos({ resumen, parametros }: { resumen: Promise<ResumenContratos | null>; parametros: Parametros }) {
  return <BarraEntidad resumen={await resumen} parametros={parametros} />;
}

/**
 * La barra de /app/contratos sin zona, partido ni entidad (los fija la ficha). Sin resumen, sin números.
 *
 * A la vista, las dos preguntas de una entidad («¿Lo leyó Vigía?» y los antecedentes del ganador); el riesgo, que sólo
 * existe para lo leído (unos pocos de sus contratos), va en «Filtros»: en el celular eran cinco controles en cinco
 * renglones antes del primer contrato.
 */
function BarraEntidad({ resumen, parametros }: { resumen: ResumenContratos | null; parametros: Parametros }) {
  const vistas = filtrosVisibles(resumen, true);
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: "Buscar en sus contratos…", etiqueta: "Buscar en sus contratos por objeto o código", min: 3 }}
      visibles={vistas.filter((f) => f.param !== "riesgo")}
      filtros={[
        ...vistas.filter((f) => f.param === "riesgo"),
        filtroOperativo(resumen),
        filtroTipo(resumen),
        filtroEtapa(),
        filtroObra(resumen),
        filtroMes(parametros),
        ...filtrosMonto(parametros),
        ...(parametros.cruce ? [filtroCaptura(parametros.cruce, resumen)] : []),
      ]}
      orden={{ param: "orden", porDefecto: "fecha", opciones: ORDENES.map((o) => ({ valor: o.value, etiqueta: o.label })) }}
      // El período del gobierno con que llega la bandera de captura (la captura ya tiene su filtro: sin chip de cruce).
      chips={chipsDeEnlace(parametros, false)}
    />
  );
}

/**
 * El filtro de varios tipos de cruce a la vez (`cruce=`): llega desde la fila «Ganó una empresa ligada a la gestión»
 * del Inicio (financió o le vendió a la campaña del partido que gobierna, o un socio trabaja en la entidad). Va sólo si
 * viene en la URL, para que la lista diga por qué es la que es y se pueda quitar con su ×.
 */
function filtroCaptura(valor: string, resumen: ResumenContratos | null): FiltroSecundario {
  const etiqueta = valor === CRUCE_CAPTURA ? "Con la gestión que la gobierna" : valor.split(",").map((t) => TIPO_CRUCE[t]?.corto ?? t).join(" o ");
  return { param: "cruce", etiqueta: "Lazo del ganador", todas: "Cualquiera", opciones: [{ valor, etiqueta, conteo: resumen ? resumen.total : null }] };
}

async function Resultados({
  pagina,
  parametros,
  query,
  ruta,
}: {
  pagina: Promise<ContratosPagina | null>;
  parametros: Parametros;
  query: ContratosQuery;
  ruta: string;
}) {
  const p = await pagina;
  return (
    <TablaContratos
      pagina={p}
      parametros={parametros}
      actual={query.page ?? 1}
      cursor={query.cursor}
      antes={query.antes}
      tam={TAM}
      ruta={ruta}
      deEntidad
    />
  );
}

// ─── Órdenes y contratos menores ─────────────────────────────────────────────

/** Sin órdenes ni filtros (la API de conteos no respondió y la lista salió vacía): lo mismo que dice la vista vacía. */
const SIN_ORDENES: ReactNode = (
  <EstadoVacio compacto conLlamita={false} titulo="No registra órdenes de compra ni de servicio">
    CONOSCE (OECE) no tiene órdenes con su RUC desde 2018.
  </EstadoVacio>
);

function VistaOrdenes({ ruc, ruta, orden, ordenes: f }: Props) {
  const parametros: Parametros = { ...deFiltros(P_ORD, f), ...base("ordenes", orden) };
  const pagina = getOrdenes({ ...f, entidad: ruc, size: TAM });
  return (
    <Listado ruta={ruta} parametros={parametros} paramPagina={P_ORD.page}>
      <Suspense fallback={<div className="min-h-[52px]" />}>
        <BarraOrdenesGeneral pagina={pagina} parametros={parametros} />
      </Suspense>
      <ZonaResultados>
        <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Orden", ancho: "1fr" }]} filas={8} />}>
          <ListaOrdenes pagina={pagina} ruta={ruta} parametros={parametros} actual={f.page ?? 1} vacia={SIN_ORDENES} />
        </Suspense>
      </ZonaResultados>
    </Listado>
  );
}

function VistaMenores({ ruc, ruta, orden, menores: f }: Props) {
  const parametros: Parametros = { ...deFiltros(P_MEN, f), ...base("menores", orden) };
  const pagina = getMenores({ ...f, entidad: ruc, size: TAM });
  return (
    <Listado ruta={ruta} parametros={parametros} paramPagina={P_MEN.page}>
      <Suspense fallback={<div className="min-h-[52px]" />}>
        <BarraMenoresGeneral pagina={pagina} />
      </Suspense>
      <ZonaResultados>
        <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Contrato menor", ancho: "1fr" }]} filas={8} />}>
          <ListaMenores pagina={pagina} ruta={ruta} parametros={parametros} actual={f.page ?? 1} />
        </Suspense>
      </ZonaResultados>
    </Listado>
  );
}
