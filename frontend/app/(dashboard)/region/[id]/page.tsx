import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Ayuda, CabeceraPestana, EncabezadoPagina, EnlaceFuente, Migas, Pagina, Pestanas } from "@/components/patrones";
import { BarraFiltros, Listado, TablaSkeleton, ZonaResultados, type FiltroSecundario, type Parametros } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { TablaContratos, TablaContratosSkeleton } from "@/components/contratos/TablaContratos";
import { filtroEtapa, filtroMes, filtroObra, filtroOperativo, filtroTipo, filtrosMonto, filtrosVisibles } from "@/components/contratos/filtros";
import { HistoriaGobiernos, ResumenRegion } from "@/components/regiones/GobiernosRegion";
import { TerritorioRegion } from "@/components/regiones/ArbolTerritorio";
import { InicioRegionEsqueleto, InicioRegionFicha } from "@/components/regiones/InicioRegionFicha";
import { municipalidadesDe, zonasDe, type ZonaRegion } from "@/components/regiones/datos";
import { ORDENES, contratosParametros, getContratos, getResumenContratos, parseContratosQuery, type ContratosPagina, type ContratosQuery, type ResumenContratos } from "@/lib/contratos";
import { BUSCADOR_CONTRALORIA, CONOSCE_BUSCADOR, CONSULTA_AMIGABLE, CONTRATACIONES_ABIERTAS, INFOGOB_JNE } from "@/lib/fuentes";
import { regionDe, rutaRegion, type Region } from "@/lib/regiones";
import { uno } from "@/lib/utils";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const r = regionDe(params.id);
  return { title: r ? `Región ${r.nombre}` : "Región" };
}

const TAM = 20;

/**
 * /region/[ubigeo o nombre corto] — la ficha de una región (pedido del usuario, 2026-10-22: «las regiones deberían poder
 * clickearse: su historial, cuántos distritos tiene, quiénes gobernaron, casos de corrupción»), con el esqueleto de las
 * demás fichas (entidad, partido). Pestañas (?seccion=):
 *   · Inicio: qué se encontró (banderas de sus contratos y de las personas contratadas), dinero (en qué gasta según el
 *     MEF y sus contratos) y control (Procuraduría y Contraloría). Se arma en el servidor (antes, cuatro pedidos desde
 *     el navegador con «Cargando…» pintado igual que «sin dato»).
 *   · Contratos: la misma lista y los mismos filtros que la ficha de una entidad, con la región fija (la ruta) y, si
 *     viene en ?ubigeo=, una provincia o un distrito suyo. Antes «Ver los contratos» sacaba a /app/contratos?ubigeo=.
 *   · Gobiernos: quién la gobernó en cada período y qué partidos ganaron sus provincias y distritos.
 *   · Provincias y distritos: un árbol (provincia → sus distritos) con su alcalde y su partido en cada período; cada
 *     fila abre su panel con la ficha de su municipalidad y sus contratos (?tq= lo trae ya buscado).
 */
export default async function RegionPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const r = regionDe(params.id);
  if (!r) notFound();
  const ruta = rutaRegion(r.ubigeo);

  // La región la fija la ruta; de la URL sólo cuenta una zona suya más chica (una provincia o un distrito).
  const base = parseContratosQuery(searchParams);
  const sub = base.ubigeo && base.ubigeo.length > 2 && base.ubigeo.startsWith(r.ubigeo) ? base.ubigeo : undefined;
  const query: ContratosQuery = { ...base, ubigeo: sub ?? r.ubigeo, entidad: undefined, partido: undefined };
  const parametros = contratosParametros({ ...query, ubigeo: sub });
  const filtrada = Object.entries(parametros).some(([k, v]) => k !== "orden" && !!v);
  // "Inicio" es la primera pestaña (sin `seccion` en la URL): la lista de contratos lleva la suya en sus enlaces.
  const parametrosLista: Parametros = { ...parametros, seccion: "contratos" };

  // Todo arranca a la vez; cada pestaña espera lo suyo (`Suspense`).
  const pagina = getContratos({ ...query, size: TAM });
  const resumenFiltrado = getResumenContratos(query);
  const resumenRegionP = filtrada ? getResumenContratos({ ubigeo: r.ubigeo }) : resumenFiltrado;
  const municipalidades = municipalidadesDe(r.nombre);
  const zonas = zonasDe(r.ubigeo);
  // Las provincias del filtro «Dónde», contadas con los demás filtros de la lista que el mapa sabe contar (no con la
  // zona elegida: así se ven las otras opciones).
  const { tipo, etapa, riesgo, q, desde, hasta, lectura, cruces } = query;
  const zonasFiltradas = filtrada ? zonasDe(r.ubigeo, { tipo, etapa, riesgo, q, desde, hasta, lectura, cruces }) : zonas;
  const resumenRegion = await resumenRegionP;

  // Un enlace con filtros de la lista y sin pestaña (desde el panel de un distrito) abre los contratos.
  const seccion = uno(searchParams?.seccion) ?? (uno(searchParams?.tq) ? "territorio" : filtrada ? "contratos" : undefined);

  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Partidos y gobiernos", href: "/app/partidos" },
          { etiqueta: r.nombre, href: ruta },
        ]}
        pestanas={{ primera: "inicio", activa: seccion ?? "inicio", etiquetas: { contratos: "Contratos", gobiernos: "Gobiernos", territorio: "Provincias y distritos" } }}
      />
      {/* Sin bajada: la de antes enumeraba las pestañas. Qué es cada cosa y de dónde sale, en el ⓘ. */}
      <EncabezadoPagina
        titulo={`Región ${r.nombre}`}
        ayuda={
          <Ayuda titulo="¿De dónde sale esto?">
            <span className="block">
              Los gobiernos, del <EnlaceFuente href={INFOGOB_JNE}>JNE</EnlaceFuente> (elecciones de 2014, 2018 y 2022). El gasto, del{" "}
              <EnlaceFuente href={CONSULTA_AMIGABLE}>MEF</EnlaceFuente>. Los contratos, del <EnlaceFuente href={CONTRATACIONES_ABIERTAS}>SEACE</EnlaceFuente> y{" "}
              <EnlaceFuente href={CONOSCE_BUSCADOR}>CONOSCE</EnlaceFuente> (OECE). Los casos de corrupción, de la Procuraduría Anticorrupción y la{" "}
              <EnlaceFuente href={BUSCADOR_CONTRALORIA}>Contraloría</EnlaceFuente>.
            </span>
          </Ayuda>
        }
        acciones={
          <span className="flex flex-wrap gap-2">
            <EnlaceAccion href={`/app/mapa?region=${r.id}`} variante="secundario">Ver en el mapa</EnlaceAccion>
            <EnlaceAccion href={`/app/financiar/${r.ubigeo}`} flecha>Financiar sus lecturas</EnlaceAccion>
          </span>
        }
      />
      <ResumenRegion ubigeo={r.ubigeo} />
      <Pestanas
        fija
        key={seccion ?? "inicio"}
        etiqueta={`Secciones de la región ${r.nombre}`}
        activa={seccion}
        pestanas={[
          {
            clave: "inicio",
            etiqueta: "Inicio",
            contenido: (
              <Suspense fallback={<InicioRegionEsqueleto />}>
                <InicioRegionFicha r={r} ruta={ruta} />
              </Suspense>
            ),
          },
          {
            clave: "contratos",
            etiqueta: "Contratos",
            conteo: resumenRegion?.total ?? null,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Qué contratos hay aquí?">
                      <span className="block">
                        Las convocatorias desde 2015 de las entidades con sede en {r.nombre} (municipalidades, el gobierno regional y
                        también las oficinas del Estado que están ahí), con su ganador y lo que se le adjudicó (registro OCDS del
                        OECE), lo que leyó Vigía y los antecedentes de quien ganó.
                      </span>
                      <span className="mt-2 block">
                        Cada fila abre su resumen; el dossier completo está en su ficha. «Dónde» acota la lista a una provincia
                        o a un distrito. Los antecedentes son motivos para revisar, no pruebas.
                      </span>
                    </Ayuda>
                  }
                />
                <Listado ruta={ruta} parametros={parametrosLista} paramPagina="page">
                  <Suspense fallback={<BarraRegion region={r} resumen={null} parametros={parametrosLista} zonas={null} sub={sub} />}>
                    <BarraConConteos region={r} resumen={resumenFiltrado} parametros={parametrosLista} zonas={zonasFiltradas} todas={zonas} sub={sub} />
                  </Suspense>
                  <ZonaResultados>
                    <Suspense fallback={<TablaContratosSkeleton />}>
                      <Resultados pagina={pagina} parametros={parametrosLista} query={query} ruta={ruta} />
                    </Suspense>
                  </ZonaResultados>
                </Listado>
              </div>
            ),
          },
          {
            clave: "gobiernos",
            etiqueta: "Gobiernos",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana />
                <HistoriaGobiernos ubigeo={r.ubigeo} nombre={r.nombre} />
              </div>
            ),
          },
          {
            clave: "territorio",
            etiqueta: "Provincias y distritos",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Cómo se lee?">
                      Cada provincia se abre en sus distritos con la flecha. Cada fila abre su detalle: quién la gobernó en cada
                      período, la ficha de su municipalidad y sus contratos.
                    </Ayuda>
                  }
                />
                <Suspense fallback={<TerritorioEsqueleto />}>
                  <Territorio region={r} ruta={ruta} buscar={uno(searchParams?.tq)} municipalidades={municipalidades} zonas={zonas} />
                </Suspense>
              </div>
            ),
          },
        ]}
      />
    </Pagina>
  );
}

// ─── Provincias y distritos ──────────────────────────────────────────────────

async function Territorio({
  region,
  ruta,
  buscar,
  municipalidades,
  zonas,
}: {
  region: Region;
  ruta: string;
  buscar?: string;
  municipalidades: ReturnType<typeof municipalidadesDe>;
  zonas: Promise<ZonaRegion[] | null>;
}) {
  const [m, z] = await Promise.all([municipalidades, zonas]);
  return <TerritorioRegion ubigeo={region.ubigeo} nombre={region.nombre} buscar={buscar} municipalidades={m} zonas={z} rutaContratos={`${ruta}?seccion=contratos`} />;
}

function TerritorioEsqueleto() {
  return (
    <TablaSkeleton
      filas={8}
      columnas={[
        { clave: "lugar", titulo: "Provincia o distrito", ancho: "minmax(0,1fr)" },
        { clave: "actual", titulo: "Alcalde", ancho: "minmax(0,1.25fr)", desde: "md" },
        { clave: "contratos", titulo: "Contratos", ancho: "96px", alinear: "der", desde: "md" },
      ]}
    />
  );
}

// ─── Lista de contratos ──────────────────────────────────────────────────────

async function BarraConConteos({
  region,
  resumen,
  parametros,
  zonas,
  todas,
  sub,
}: {
  region: Region;
  resumen: Promise<ResumenContratos | null>;
  parametros: Parametros;
  zonas: Promise<ZonaRegion[] | null>;
  todas: Promise<ZonaRegion[] | null>;
  sub?: string;
}) {
  const [r, z, t] = await Promise.all([resumen, zonas, todas]);
  return <BarraRegion region={region} resumen={r} parametros={parametros} zonas={z} todas={t} sub={sub} />;
}

/**
 * La barra de la ficha de una entidad (búsqueda, «¿Lo leyó Vigía?» y antecedentes a la vista; riesgo, cola, tipo,
 * etapa, mes y monto en «Filtros») y «Dónde»: una provincia de la región o el distrito que trae la URL. Sin resumen,
 * sin números (nunca un 0 inventado).
 */
function BarraRegion({
  region,
  resumen,
  parametros,
  zonas,
  todas,
  sub,
}: {
  region: Region;
  resumen: ResumenContratos | null;
  parametros: Parametros;
  zonas: ZonaRegion[] | null;
  todas?: ZonaRegion[] | null;
  sub?: string;
}) {
  const vistas = filtrosVisibles(resumen, true);
  const donde = filtroDonde(region, zonas, todas ?? zonas, sub, parametros);
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: `Buscar en los contratos de ${region.nombre}…`, etiqueta: `Buscar en los contratos de ${region.nombre} por objeto o código`, min: 3 }}
      visibles={vistas.filter((f) => f.param !== "riesgo")}
      filtros={[
        ...(donde.opciones.length ? [donde] : []),
        ...vistas.filter((f) => f.param === "riesgo"),
        filtroOperativo(resumen),
        filtroTipo(resumen),
        filtroEtapa(),
        filtroObra(resumen),
        filtroMes(parametros),
        ...filtrosMonto(parametros),
      ]}
      orden={{ param: "orden", porDefecto: "fecha", opciones: ORDENES.map((o) => ({ valor: o.value, etiqueta: o.label })) }}
    />
  );
}

/**
 * «Dónde»: las provincias de la región (con cuántos contratos tiene cada una con los demás filtros, del mismo conteo que el
 * mapa) y, si la URL trae un distrito (desde el árbol de provincias y distritos), ese distrito. El conteo de cada
 * provincia sale del mapa (/contratos/geo), que no sabe de la cola ni del monto: con esos filtros puestos, va sin número.
 */
function filtroDonde(region: Region, zonas: ZonaRegion[] | null, todas: ZonaRegion[] | null, sub: string | undefined, parametros: Parametros): FiltroSecundario {
  const sinConteo = !zonas || !!(parametros.operativo || parametros.monto_min || parametros.monto_max);
  const provincias = (todas ?? zonas ?? []).filter((z) => z.nivel === "provincia").sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const conteo = (u: string) => (sinConteo ? null : zonas?.find((z) => z.ubigeo === u)?.total ?? 0);
  const opciones: FiltroSecundario["opciones"] = provincias.map((p) => ({ valor: p.ubigeo, etiqueta: `Provincia de ${p.nombre}`, conteo: conteo(p.ubigeo), grupo: "Provincias" }));
  if (sub && !opciones.some((o) => o.valor === sub)) {
    const z = (todas ?? zonas ?? []).find((x) => x.ubigeo === sub);
    opciones.push({ valor: sub, etiqueta: z ? `${z.nivel === "distrito" ? "Distrito" : "Provincia"} de ${z.nombre}` : `Ubigeo ${sub}`, conteo: sinConteo ? null : z ? conteo(sub) : null, grupo: "El lugar elegido" });
  }
  return { param: "ubigeo", etiqueta: "Dónde", todas: `Toda la región ${region.nombre}`, opciones };
}

async function Resultados({ pagina, parametros, query, ruta }: { pagina: Promise<ContratosPagina | null>; parametros: Parametros; query: ContratosQuery; ruta: string }) {
  const p = await pagina;
  return <TablaContratos pagina={p} parametros={parametros} actual={query.page ?? 1} cursor={query.cursor} antes={query.antes} tam={TAM} ruta={ruta} />;
}
