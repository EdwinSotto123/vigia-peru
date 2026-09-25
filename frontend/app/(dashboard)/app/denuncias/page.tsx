import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Map as MapIcon, MessageSquareWarning } from "lucide-react";
import { Ayuda, EncabezadoPagina, EstadoVacio, Pagina } from "@/components/patrones";
import { BarraFiltros, Indicadores, Listado, ZonaResultados, type FiltroSecundario, type Indicador, type OpcionFaceta } from "@/components/listado";
import { ListaDenuncias, hrefDenuncias } from "@/components/denuncias/ListaDenuncias";
import { getReportesPagina, type ApiReporte, type ReportesPagina } from "@/lib/api-client";
import { CATEGORIA_META, TODAS_CATEGORIAS, estaConfirmada, tieneUbicacion, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { confirmadosDe, parseDenunciasQuery, type EstadoDenunciaFiltro } from "@/lib/denuncias-query";
import { REGIONES } from "@/lib/peru-data";
import { maskDnis } from "@/lib/privacidad";
import { numero, porcentaje } from "@/lib/formato";

export const metadata: Metadata = {
  title: "Denuncias ciudadanas",
  description:
    "Obras paralizadas, obras fantasma e irregularidades que reportan los vecinos, con su foto y el lugar donde las vieron.",
};

// Tamaño de página de la tabla.
const SIZE = 24;
// Muestra para las cifras de arriba, los conteos de los filtros y la búsqueda: las 200 más recientes.
const MUESTRA = 200;

/** Las categorías del formulario de obra (/reporte/nuevo): las únicas que se publican hoy. */
const CATEGORIAS_OBRA = new Set<string>(["obra_paralizada", "obra_fantasma", "funcionario_sospechoso", "irregularidad_general"]);
const REGIONES_ORDENADAS = [...REGIONES].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

const BOTON_DENUNCIAR =
  "inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-granate px-4 py-2 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep";
const BOTON_SECUNDARIO =
  "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";

const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
// Sin tildes: NFD separa la letra de su marca diacrítica y la marca se quita.
const normalizar = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

interface Filtro {
  region?: string;
  categoria?: string;
  estado?: EstadoDenunciaFiltro;
}

/** Lo mismo que filtra el API: región y categoría exactas; el estado mira la columna `confirmado` (`confirmados=`). */
function cumple(r: ApiReporte, f: Filtro): boolean {
  if (f.region && r.region !== f.region) return false;
  if (f.categoria && r.categoria !== f.categoria) return false;
  if (f.estado === "verificados" && r.confirmado !== true) return false;
  if (f.estado === "en_validacion" && r.confirmado !== false) return false;
  return true;
}

/** La búsqueda mira el relato YA enmascarado: buscar un DNI no debe encontrar la denuncia que lo nombra. */
function coincideTexto(r: ApiReporte, buscado: string): boolean {
  const etiqueta = CATEGORIA_META[r.categoria as CategoriaDenuncia]?.label ?? "";
  return normalizar([maskDnis(r.descripcion), r.region, r.id, etiqueta].join(" ")).includes(buscado);
}

/**
 * /app/denuncias — plantilla Listado (DESIGN_SYSTEM.md §14.1): encabezado → indicadores
 * → barra (búsqueda · categoría · filtros) → resultados. Todo el estado en la URL
 * (`?q=&categoria=&region=&estado=&pagina=`); antes la búsqueda era estado local y sólo
 * miraba la página a la vista.
 *
 * Región, categoría y estado los resuelve el API. El API no busca texto: con `q`, la
 * lista sale de la muestra de las 200 más recientes, filtrada aquí igual que el API, y
 * se avisa si hay más. Si la muestra es TODO el universo, cada opción lleva su conteo
 * cruzado; si no, ninguna (un conteo parcial se leería como total).
 *
 * Si el API falla, se dice y se ofrece reintentar: nunca denuncias de relleno.
 */
export default async function DenunciasPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const sp = searchParams ?? {};
  // `pagina` es el parámetro de todos los listados; `page` queda por los enlaces viejos.
  const query = parseDenunciasQuery({ ...sp, page: texto(sp.pagina) ?? texto(sp.page) });
  const q = texto(sp.q)?.trim().slice(0, 120) || undefined;
  const confirmados = confirmadosDe(query.estado);

  let pagina: ReportesPagina | null = null;
  let muestra: ReportesPagina | null = null;
  try {
    [pagina, muestra] = await Promise.all([
      getReportesPagina({
        region: query.region,
        categoria: query.categoria,
        confirmados,
        limit: SIZE,
        offset: (query.page - 1) * SIZE,
      }),
      getReportesPagina({ limit: MUESTRA }),
    ]);
  } catch (e) {
    console.error("[denuncias] el API de reportes no respondió:", (e as Error).message);
  }

  const fallo = !pagina || !muestra;
  const sinNinguna = !!muestra && muestra.total === 0 && muestra.data.length === 0;
  // ¿La muestra es todo el universo? Entonces sus conteos son exactos.
  const completa = !!muestra && muestra.total <= muestra.data.length;
  const recortada = !!muestra && !completa;

  const filtro: Filtro = { region: query.region, categoria: query.categoria, estado: query.estado };
  // El universo de los conteos: la muestra, ya con la búsqueda aplicada.
  const buscado = q ? normalizar(q) : null;
  const universo = muestra ? (buscado ? muestra.data.filter((r) => coincideTexto(r, buscado)) : muestra.data) : [];
  const contar = (f: Filtro): number | null => (completa ? universo.filter((r) => cumple(r, f)).length : null);

  let filas: ApiReporte[] = [];
  let total = 0;
  if (q) {
    const hallados = universo.filter((r) => cumple(r, filtro));
    total = hallados.length;
    filas = hallados.slice((query.page - 1) * SIZE, query.page * SIZE);
  } else if (pagina) {
    total = pagina.total;
    filas = pagina.data;
  }

  // Datos planos (nunca funciones) hacia los componentes cliente del Listado.
  const parametros = { q, categoria: query.categoria, region: query.region, estado: query.estado };
  const aqui = hrefDenuncias({ ...parametros, pagina: query.page > 1 ? String(query.page) : undefined });
  const regionId = query.region ? REGIONES.find((r) => r.nombre === query.region)?.id : undefined;
  const hrefMapa = `/app/mapa?${regionId ? `region=${regionId}&` : ""}tab=denuncias`;

  // Faceta principal: la categoría. Con conteo exacto, sólo las que tienen alguna
  // denuncia (ninguna opción lleva a cero); sin él, las del formulario y las vistas.
  const enMuestra = new Set((muestra?.data ?? []).map((r) => r.categoria as string));
  const opcionesCategoria: OpcionFaceta[] = TODAS_CATEGORIAS.map((c) => ({ c, n: contar({ ...filtro, categoria: c }) }))
    .filter(({ c, n }) => c === query.categoria || (n != null ? n > 0 : CATEGORIAS_OBRA.has(c) || enMuestra.has(c)))
    .map(({ c, n }) => ({ valor: c, etiqueta: CATEGORIA_META[c].label, conteo: n }));

  const filtros: FiltroSecundario[] = [
    {
      param: "region",
      etiqueta: "Región",
      todas: "Todo el Perú",
      opciones: REGIONES_ORDENADAS.map((r) => ({ r, n: contar({ ...filtro, region: r.nombre }) }))
        .filter(({ r, n }) => n == null || n > 0 || r.nombre === query.region)
        .map(({ r, n }) => ({ valor: r.nombre, etiqueta: r.nombre, conteo: n })),
    },
    {
      param: "estado",
      etiqueta: "Estado",
      todas: "Confirmadas y sin confirmar",
      opciones: (
        [
          { valor: "verificados", etiqueta: "Confirmadas" },
          { valor: "en_validacion", etiqueta: "Sin confirmar" },
        ] as const
      )
        .map((o) => ({ ...o, conteo: contar({ ...filtro, estado: o.valor }) }))
        .filter((o) => o.conteo == null || o.conteo > 0 || o.valor === query.estado),
    },
  ];

  // Sin conteo exacto, "Todas" lleva el total del API sólo si es el mismo universo.
  const conteoTodas = completa ? contar({ ...filtro, categoria: undefined }) : !q && !query.categoria && pagina ? pagina.total : null;

  const aviso =
    q && recortada && muestra ? (
      <>
        La búsqueda mira las {numero(muestra.data.length)} denuncias más recientes
        <Ayuda titulo="¿Por qué sólo las más recientes?">
          El servidor todavía no busca por texto: la búsqueda se hace sobre las {numero(muestra.data.length)} más
          recientes de las {numero(muestra.total)} publicadas. Región, categoría y estado sí filtran todas.
        </Ayuda>
      </>
    ) : undefined;

  return (
    <Pagina className="space-y-5">
      <EncabezadoPagina
        titulo="Denuncias ciudadanas"
        bajada="Testimonios de vecinos, no hallazgos de Vigía: obras paralizadas, obras fantasma e irregularidades, con foto y lugar."
        ayuda={
          <Ayuda titulo="¿Qué pasa con cada denuncia?">
            <span className="block">
              Se publica al instante, tal como llegó: en esta lista y en el mapa de Vigía, con su foto y el lugar que se
              marcó. Nadie la revisa antes.
            </span>
            <span className="mt-2 block">
              Figura como confirmada sólo cuando la respaldan dos o más reportes independientes del mismo lugar.
            </span>
            <span className="mt-2 block">
              Es el testimonio de un vecino, no un hallazgo de Vigía: los agentes que leen contratos no la analizan.
            </span>
          </Ayuda>
        }
        acciones={
          // Sin ninguna denuncia, el llamado a denunciar lo lleva el propio estado vacío.
          sinNinguna ? undefined : (
            <>
              {!fallo && (
                <Link href={hrefMapa} className={BOTON_SECUNDARIO}>
                  <MapIcon size={14} aria-hidden /> Verlas en el mapa
                  <ArrowRight size={13} aria-hidden />
                </Link>
              )}
              <Link href="/reporte/nuevo" className={BOTON_DENUNCIAR}>
                <MessageSquareWarning size={16} aria-hidden />
                Denunciar una obra
              </Link>
            </>
          )
        }
      />

      {sinNinguna ? (
        <EstadoVacio
          compacto
          titulo="Todavía no hay denuncias de vecinos publicadas"
          accion={
            <Link href="/reporte/nuevo" className={BOTON_DENUNCIAR}>
              <MessageSquareWarning size={16} aria-hidden />
              Denunciar una obra
            </Link>
          }
        >
          Cuando alguien reporte una obra, aparece aquí con su foto y el lugar donde la vio.
        </EstadoVacio>
      ) : (
        <>
          {muestra && <Indicadores items={indicadores(muestra)} />}

          <Listado ruta="/app/denuncias" parametros={parametros}>
            <BarraFiltros
              busqueda={{ param: "q", placeholder: "Buscar por relato, región o código…", etiqueta: "Buscar denuncias por relato, región o código" }}
              faceta={{ param: "categoria", etiqueta: "Categoría", todas: "Todas", conteoTodas, opciones: opcionesCategoria }}
              filtros={filtros}
            />
            <ZonaResultados>
              <ListaDenuncias
                reportes={filas}
                total={total}
                pagina={query.page}
                tam={SIZE}
                parametros={parametros}
                q={q}
                fallo={fallo}
                aqui={aqui}
                aviso={aviso}
              />
            </ZonaResultados>
          </Listado>
        </>
      )}
    </Pagina>
  );
}

/**
 * Las cifras de arriba: un resumen del sitio, no reaccionan a los filtros. El total es
 * el conteo del API; las otras tres se cuentan sobre la muestra, y cuando hay más que
 * eso lo dicen en su contexto (§10.2).
 */
function indicadores(muestra: ReportesPagina): Indicador[] {
  const filas = muestra.data;
  const total = Math.max(muestra.total, filas.length);
  const sobre = filas.length;
  const de = total > sobre ? `de las ${numero(sobre)} más recientes` : `de ${numero(sobre)}`;
  const pct = (n: number) => (sobre ? ` · ${porcentaje((n / sobre) * 100)}` : "");
  const confirmadas = filas.filter(estaConfirmada).length;
  const conFoto = filas.filter((r) => r.fotoUrl).length;
  const conUbicacion = filas.filter(tieneUbicacion).length;
  return [
    {
      valor: numero(total),
      etiqueta: "denuncias publicadas",
      contexto: "desde el inicio",
      ayuda: (
        <Ayuda titulo="¿Qué cuentan estas cifras?">
          <span className="block">
            {total > sobre
              ? `El total cuenta todas las denuncias publicadas; confirmadas, con foto y con punto en el mapa se cuentan sobre las ${numero(sobre)} más recientes.`
              : "Todas las denuncias publicadas desde el inicio, y cuántas de ellas están confirmadas, traen foto o marcaron un punto en el mapa."}
          </span>
          <span className="mt-2 block text-mute">Son cifras del sitio entero: no cambian con los filtros.</span>
        </Ayuda>
      ),
    },
    {
      valor: numero(confirmadas),
      etiqueta: "confirmadas",
      contexto: de + pct(confirmadas),
      ayuda: (
        <Ayuda titulo="¿Cuándo está confirmada?">
          Cuando la respaldan dos o más reportes independientes del mismo lugar.
        </Ayuda>
      ),
    },
    { valor: numero(conFoto), etiqueta: "con foto", contexto: de + pct(conFoto) },
    { valor: numero(conUbicacion), etiqueta: "con punto en el mapa", contexto: de + pct(conUbicacion) },
  ];
}
