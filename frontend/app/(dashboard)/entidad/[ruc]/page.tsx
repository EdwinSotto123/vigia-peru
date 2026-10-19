import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Building2, Flag, MapPin } from "lucide-react";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { ejecucionPct, sinAnioRepetido, type MefBudgetRow } from "@/lib/mef";
import { REGIONES } from "@/lib/peru-data";
import { normalizar } from "@/lib/partidos";
import {
  ORDENES,
  TIPOS,
  contratosParametros,
  getContratos,
  getResumenContratos,
  parseContratosQuery,
  type ContratosPagina,
  type ContratosQuery,
  type ResumenContratos,
} from "@/lib/contratos";
import { EjecucionPresupuestal, EjecucionPresupuestalSkeleton } from "@/components/EjecucionPresupuestal";
import { getEntidad, getFraccionamientoEntidad } from "@/lib/api-client";
import { getProcesosEntidad, type ProcesosEntidad } from "@/lib/partidosApi";
import { TablaProcesos } from "@/components/procesos/TablaProcesos";
import { FraccionamientoEntidadTabla } from "@/components/contratos/FraccionamientoEntidad";
import { TablaContratos, TablaContratosSkeleton } from "@/components/contratos/TablaContratos";
import { filtroEtapa, filtroMes, filtroOperativo, filtroTipo, filtrosMonto, filtrosVisibles } from "@/components/contratos/filtros";
import { TiposCruce } from "@/components/cruces/TiposCruce";
import { SeguirEntidadBoton } from "@/components/mapa/SeguirEntidadBoton";
import { Ayuda, CabeceraPestana, EncabezadoPagina, EstadoError, Pagina, Pestanas, Volver } from "@/components/patrones";
import { BarraFiltros, Indicadores, Listado, ZonaResultados, type FiltroSecundario, type Indicador, type Parametros } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";

/**
 * /entidad/[ruc] — la ficha de una entidad, con el mismo esqueleto que la de un contrato:
 *   volver → identidad (nombre; tipo, RUC y zona; seguir, denunciar, financiar) → cuatro cifras (contratos, leídos,
 *   antecedentes de los ganadores, presupuesto; cada una abre su pestaña) → pestañas (`?seccion=`):
 *     · Contratos: TODOS los suyos, con los filtros de /app/contratos y la misma tabla; la URL guarda el filtro.
 *     · Cuánto gasta: presupuesto del MEF de su unidad ejecutora (migración 62), en qué lo gasta (63) y sus compras
 *       por orden que juntas pasan 8 UIT (CONOSCE), paginadas.
 *     · Denuncias: cómo denunciarla y qué pasa con la denuncia (no se publica).
 *
 * Historia: la primera versión listaba sólo los contratos con dictamen (4 de 271) y tenía una pestaña con los mismos
 * contratos para los antecedentes (hoy columna y filtro). La segunda fue una página larga con un índice que sólo
 * desplazaba, y "Órdenes del mismo día" como sección aparte: el usuario pidió pestañas de verdad.
 */

const TAM = 20;

export async function generateMetadata({ params }: { params: { ruc: string } }): Promise<Metadata> {
  const r = await getEntidad(params.ruc).catch(() => null);
  const nombre = r?.entidad?.nombre as string | undefined;
  return { title: nombre ? tituloNatural(nombre) : `Entidad ${params.ruc}` };
}

export default async function EntidadProfile({
  params,
  searchParams,
}: {
  params: { ruc: string };
  /** Los filtros de su lista de contratos (los mismos parámetros que /app/contratos). */
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ruc = params.ruc;
  const ruta = `/entidad/${ruc}`;
  // La entidad la fija la ruta: de la URL sólo se leen los demás filtros (zona y partido no aplican).
  const query: ContratosQuery = { ...parseContratosQuery(searchParams), entidad: ruc, ubigeo: undefined, partido: undefined };
  const parametros = contratosParametros({ ...query, entidad: undefined });
  const filtrada = Object.entries(parametros).some(([k, v]) => k !== "orden" && !!v);

  // Todo arranca a la vez; la lista y su barra esperan cada una lo suyo (`Suspense`).
  const pagina = getContratos({ ...query, size: TAM });
  const resumenFiltrado = getResumenContratos(query);
  const resumenEntidadP = filtrada ? getResumenContratos({ entidad: ruc }) : resumenFiltrado;
  const fraccP = getFraccionamientoEntidad(ruc);
  // Sus procesos desde 2015 (CONOSCE desde 2018; antes, la API OCDS del OECE). En la URL con prefijo `p` (pq, panio,
  // pobjeto, porden, ppage): las dos listas conviven en la misma página y sus filtros no deben pisarse.
  const uno = (k: string) => {
    const v = searchParams?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const pq = uno("pq");
  const fProc = {
    q: pq && pq.length >= 3 ? pq.slice(0, 80) : undefined,
    objeto: uno("pobjeto")?.slice(0, 40),
    anio: /^\d{4}$/.test(uno("panio") ?? "") ? Number(uno("panio")) : undefined,
    orden: uno("porden") === "monto" ? ("monto" as const) : undefined,
  };
  const pagProc = Math.max(1, Number(uno("ppage")) || 1);
  const procesosP = getProcesosEntidad(ruc, { ...fProc, page: pagProc, size: TAM });
  const parametrosProc: Parametros = {
    seccion: "procesos",
    pq: fProc.q,
    pobjeto: fProc.objeto,
    panio: fProc.anio ? String(fProc.anio) : undefined,
    porden: fProc.orden,
  };

  // Antes, si el API fallaba o no conocía el RUC, la ficha se armaba con datos inventados. Ahora: sin respuesta, se
  // dice; RUC desconocido, 404.
  let apiResp: Awaited<ReturnType<typeof getEntidad>> = null;
  try {
    apiResp = await getEntidad(ruc);
  } catch (e) {
    console.error("[entidad] el API no respondió:", (e as Error).message);
    return <NoSePudoLeer ruc={ruc} />;
  }
  if (!apiResp?.entidad) notFound();

  const [resumenEntidad, fracc, procesos] = await Promise.all([resumenEntidadP, fraccP, procesosP]);
  const e = apiResp.entidad;
  const nombre = tituloNatural(String(e.nombre ?? ""));
  const region: string | null = e.region || null;
  const enCola = Number(e.contratosEnCola || 0);
  const totalContratos = resumenEntidad?.total ?? Number(e.contratos || 0);
  const regionDenuncias = region ? REGIONES.find((r) => normalizar(r.nombre) === normalizar(region))?.nombre : undefined;

  const seccion = typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined;
  const ordenes = fracc && fracc.total > 0 ? fracc : null;

  return (
    <Pagina>
      <Volver href="/app/entidades">Entidades</Volver>

      {/* 1. Identidad: nombre; tipo, RUC y zona en una línea; lo que se puede hacer con ella. */}
      <EncabezadoPagina
        titulo={nombre}
        bajada={
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> {etiquetaTipoEntidad(e.tipo ?? null, e.nombre)}
            </span>
            <span>
              RUC{" "}
              <span className="font-mono text-ink" translate="no">
                {e.ruc}
              </span>
            </span>
            {region && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} className="shrink-0 text-mute" aria-hidden /> {[region, e.provincia, e.distrito].filter(Boolean).join(", ")}
              </span>
            )}
          </span>
        }
        acciones={
          <>
            <SeguirEntidadBoton ruc={e.ruc} nombre={nombre} />
            <EnlaceAccion href={`/reporte/nuevo?modo=entidad&ruc=${e.ruc}`} variante="secundario">
              <Flag size={14} aria-hidden /> Denunciar
            </EnlaceAccion>
            {/* La única acción sobre su cola: financiar la lectura de ESTA entidad (sin cola, no hay botón). */}
            {enCola > 0 && (
              <EnlaceAccion href={`/app/financiar/entidad/${e.ruc}`} flecha>
                Financiar su auditoría
              </EnlaceAccion>
            )}
          </>
        }
      />

      {/* 2. Lo que se sabe de ella, en cuatro cifras; cada una abre su pestaña. */}
      <Indicadores items={indicadores({ resumen: resumenEntidad, totalContratos, enCola, mef: apiResp.mef, ruta, historia: procesos?.resumen ?? null })} />

      {/* 3. Pestañas, como la ficha de un contrato (?seccion=): Contratos | Cuánto gasta | Denuncias. `key`: un enlace
          de las cifras de arriba a otra pestaña la abre (sin la clave, la pestaña ya montada no cambiaba). */}
      <Pestanas
        key={seccion ?? "contratos"}
        etiqueta="Secciones de la entidad"
        activa={seccion}
        pestanas={[
          {
            clave: "contratos",
            // El mismo nombre que en la ficha de un partido: los contratos que Vigía tiene para leer.
            etiqueta: "Contratos en Vigía",
            conteo: totalContratos,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Qué contratos hay aquí?">
                      <span className="block">
                        Cada convocatoria de esta entidad que Vigía tiene en su base, leída o no. Cada fila abre su resumen;
                        el dossier completo, con el dictamen si ya se leyó, está en el pie del resumen.
                      </span>
                      <span className="mt-2 block">
                        Vigía no acusa a nadie: las señales y los antecedentes salen del cruce automático de datos
                        públicos y son motivos para revisar, no pruebas.
                      </span>
                    </Ayuda>
                  }
                >
                  Sus convocatorias en la base de Vigía (las que puede leer), con lo leído y los antecedentes de quien ganó.
                  Su historia completa, desde 2015, está en «Procesos desde 2015».
                </CabeceraPestana>
                <Listado ruta={ruta} parametros={parametros} paramPagina="page">
                  {(parametros.cruces || parametros.cruce) && <TiposCruce conteos={null} />}
                  <Suspense fallback={<BarraEntidad resumen={null} parametros={parametros} />}>
                    <BarraConConteos resumen={resumenFiltrado} parametros={parametros} />
                  </Suspense>
                  <ZonaResultados>
                    <Suspense fallback={<TablaContratosSkeleton />}>
                      <Resultados pagina={pagina} parametros={parametros} query={query} ruta={ruta} />
                    </Suspense>
                  </ZonaResultados>
                </Listado>
              </div>
            ),
          },
          {
            clave: "procesos",
            etiqueta: "Procesos desde 2015",
            conteo: procesos?.resumen.procesos ?? null,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿De dónde salen estos procesos?">
                      Los procesos que esta entidad adjudicó, con su ganador y su monto: desde 2018, de CONOSCE (OECE);
                      de 2015 a 2017, de Contrataciones Abiertas, la API pública del mismo OECE. Son más que los contratos
                      de la pestaña anterior, que son los que Vigía tiene en su base para leer (casi todos de 2026). Si un
                      proceso también está ahí, su resumen lleva a su ficha.
                    </Ayuda>
                  }
                >
                  Todos sus procesos adjudicados desde 2015, con su ganador y su monto, según el OECE.
                </CabeceraPestana>
                <Listado ruta={ruta} parametros={parametrosProc} paramPagina="ppage">
                  <BarraFiltros
                    busqueda={{ param: "pq", placeholder: "Buscar qué se compró o el ganador…", etiqueta: "Buscar en sus procesos", min: 3 }}
                    visibles={visiblesProcesos(procesos?.resumen ?? null)}
                    filtros={[]}
                    orden={{ param: "porden", porDefecto: "fecha", opciones: [{ valor: "fecha", etiqueta: "Más recientes" }, { valor: "monto", etiqueta: "Mayor monto" }] }}
                  />
                  <ZonaResultados>
                    <TablaProcesos pagina={procesos} parametros={parametrosProc} ruta={ruta} actual={pagProc} paramPagina="ppage" deEntidad />
                  </ZonaResultados>
                </Listado>
              </div>
            ),
          },
          {
            clave: "presupuesto",
            etiqueta: "Cuánto gasta",
            contenido: (
              <div className="space-y-8">
                <div>
                  <CabeceraPestana>Su presupuesto de cada año, en qué lo gasta y cuánto ya gastó, según el MEF.</CabeceraPestana>
                  {/* El MEF llega por streaming: la pestaña muestra su esqueleto hasta que responde. */}
                  <Suspense fallback={<EjecucionPresupuestalSkeleton />}>
                    <EjecucionPresupuestal query={mefSearchKeywordFor(String(e.nombre ?? ""))} ruc={e.ruc} />
                  </Suspense>
                </div>
                {ordenes && (
                  <section aria-labelledby="ordenes-titulo" className="space-y-3">
                    <div>
                      <h3 id="ordenes-titulo" className="flex items-center gap-1.5 text-[16px] font-semibold text-ink">
                        Compras por orden que juntas pasan 8 UIT
                        <Ayuda titulo="¿Qué es esto?">
                          Las compras de hasta 8 UIT se hacen con una orden, sin procedimiento de selección. La ley prohíbe
                          partir una contratación para quedar bajo ese tope. Aquí van los días en que esta entidad le emitió
                          a una misma empresa varias de esas órdenes que juntas lo pasan (registro de órdenes de CONOSCE).
                          Es un patrón en los datos oficiales, no la prueba de un fraccionamiento. Cuando esa empresa además
                          ganó un proceso, el contrato lo muestra en sus antecedentes.
                        </Ayuda>
                      </h3>
                      <p className="text-sm text-inkSoft">
                        {ordenes.total === 1 ? "Un día" : `${numero(ordenes.total)} días`} con varias órdenes a una misma
                        empresa: {plural(ordenes.empresas, "empresa", "empresas")}, {solesCompacto(ordenes.montoTotal)} en
                        total.
                      </p>
                    </div>
                    <FraccionamientoEntidadTabla casos={ordenes.casos} nombre={nombre} />
                  </section>
                )}
              </div>
            ),
          },
          {
            clave: "denuncias",
            etiqueta: "Denuncias",
            contenido: (
              <div>
                <CabeceraPestana>¿Viste algo irregular en esta entidad? Cuéntalo.</CabeceraPestana>
                <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paperSoft p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="max-w-prose space-y-1.5 text-sm text-inkSoft">
                    <p>
                      Una denuncia sobre una entidad <strong className="font-semibold text-ink">no se publica</strong>: queda
                      en reserva y la revisa el equipo de Vigía. Si los datos la respaldan, lo que se publica es un dictamen
                      en esta ficha, nunca la denuncia ni quién la hizo.
                    </p>
                    <p>Si es una obra que se puede ver y fotografiar, denúnciala como obra: esa sí aparece en el mapa.</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <EnlaceAccion href={`/reporte/nuevo?modo=entidad&ruc=${e.ruc}`}>
                      <Flag size={14} aria-hidden /> Denunciar a esta entidad
                    </EnlaceAccion>
                    {regionDenuncias && (
                      <EnlaceAccion href={`/app/denuncias?region=${encodeURIComponent(regionDenuncias)}`} variante="secundario" flecha>
                        Obras denunciadas en {regionDenuncias}
                      </EnlaceAccion>
                    )}
                  </div>
                </div>
              </div>
            ),
          },
        ]}
      />
    </Pagina>
  );
}

// ─── Lista de contratos ──────────────────────────────────────────────────────

async function BarraConConteos({ resumen, parametros }: { resumen: Promise<ResumenContratos | null>; parametros: Parametros }) {
  return <BarraEntidad resumen={await resumen} parametros={parametros} />;
}

/** La barra de /app/contratos sin zona, partido ni entidad (los fija la ficha). Sin resumen, sin números. */
function BarraEntidad({ resumen, parametros }: { resumen: ResumenContratos | null; parametros: Parametros }) {
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: "Buscar en sus contratos…", etiqueta: "Buscar en sus contratos por objeto o código", min: 3 }}
      visibles={filtrosVisibles(resumen)}
      filtros={[filtroOperativo(resumen), filtroTipo(resumen), filtroEtapa(), filtroMes(parametros), ...filtrosMonto(parametros)]}
      orden={{ param: "orden", porDefecto: "fecha", opciones: ORDENES.map((o) => ({ valor: o.value, etiqueta: o.label })) }}
    />
  );
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

// ─── Las cuatro cifras ───────────────────────────────────────────────────────

/** Los tipos con más contratos, de mayor a menor: "Bienes 221 · Servicios 37 · Consultoría 12". */
function porTipoTexto(resumen: ResumenContratos | null): string | undefined {
  const t = resumen?.porTipo;
  if (!t) return undefined;
  const filas = TIPOS.map((x) => [x.label, t[x.value] ?? 0] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return filas.length > 0 ? filas.slice(0, 3).map(([l, n]) => `${l} ${numero(n)}`).join(" · ") : undefined;
}

/** El último año del MEF con datos propios (sin el que repite al anterior). */
function ultimoAnio(mef: { by_year?: MefBudgetRow[] | null; kind?: string } | null | undefined): MefBudgetRow | null {
  if (!mef || mef.kind !== "ok" || !mef.by_year?.length) return null;
  const { years } = sinAnioRepetido(mef.by_year.map((r) => ({ ...r, pia: Number(r.pia), pim: Number(r.pim), devengado: Number(r.devengado), girado: Number(r.girado) })));
  return years[years.length - 1] ?? null;
}

/** Año y objeto de sus procesos, con cuántos tiene cada uno (del resumen sin filtros). */
function visiblesProcesos(r: ProcesosEntidad["resumen"] | null): FiltroSecundario[] {
  return [
    {
      param: "panio",
      etiqueta: "Año de convocatoria",
      corta: "Año",
      todas: "Todos",
      opciones: [...(r?.porAnio ?? [])].reverse().map((a) => ({ valor: String(a.anio), etiqueta: String(a.anio), conteo: a.procesos })),
    },
    {
      param: "pobjeto",
      etiqueta: "Objeto",
      corta: "Objeto",
      todas: "Todos",
      opciones: (r?.porObjeto ?? []).map((o) => ({ valor: o.objeto, etiqueta: o.objeto, conteo: o.procesos })),
    },
  ];
}

/**
 * Cuatro cifras, cada una con su fuente dicha en su nombre: sus procesos desde 2015 (OECE), sus contratos en la
 * base de Vigía (los que se pueden leer: leídos y riesgo, del mismo resumen que la lista), los antecedentes de los
 * ganadores y su presupuesto. Antes la primera decía "contratos en el SEACE" y eran sólo los de la base de Vigía.
 */
function indicadores({
  resumen,
  totalContratos,
  enCola,
  mef,
  ruta,
  historia,
}: {
  resumen: ResumenContratos | null;
  totalContratos: number;
  enCola: number;
  mef: { by_year?: MefBudgetRow[] | null; kind?: string; keyword?: string | null } | null;
  ruta: string;
  historia: ProcesosEntidad["resumen"] | null;
}): Indicador[] {
  const lect = resumen?.porLectura;
  const publicados = lect?.publicado ?? 0;
  const leidos = publicados + (lect?.revision ?? 0);
  const altos = resumen?.porRiesgo?.alto ?? 0;
  const cruces = resumen?.porCruces;
  const anio = ultimoAnio(mef);
  const deTodoElGobierno = (mef?.keyword ?? "").startsWith("pliego ");

  return [
    {
      valor: historia ? numero(historia.procesos) : null,
      etiqueta: "procesos adjudicados desde 2015",
      contexto: historia ? `${solesCompacto(historia.montoAdjudicadoPen)} en soles, según el OECE` : undefined,
      href: `${ruta}?seccion=procesos`,
    },
    {
      valor: numero(totalContratos),
      etiqueta: "contratos en la base de Vigía",
      contexto: resumen
        ? leidos === 0
          ? enCola > 0
            ? `ninguno leído, ${numero(enCola)} esperan quien financie su lectura`
            : "ninguno leído todavía"
          : // La misma medida que la lista de entidades ("Con dictamen 13 de 331"): con dictamen publicado.
            `${plural(publicados, "con dictamen publicado", "con dictamen publicado")}${altos > 0 ? `, ${numero(altos)} de riesgo alto` : ""}`
        : porTipoTexto(resumen),
      href: leidos > 0 ? `${ruta}?lectura=publicado` : ruta,
      ayuda: (
        <Ayuda titulo="¿Qué contratos puede leer Vigía?">
          <span className="block">
            Los de su base, casi todos convocados en 2026: los que se leen con sus documentos y pueden tener dictamen.
            {leidos > publicados ? ` Leídos: ${numero(leidos)}; ${numero(leidos - publicados)} siguen en revisión humana.` : ""}
          </span>
          {enCola > 0 && (
            <span className="mt-2 block">
              {plural(enCola, "contrato espera", "contratos esperan")} que alguien financie su lectura: eliges la entidad,
              no el contrato, que se asigna al azar entre los suyos.
            </span>
          )}
        </Ayuda>
      ),
    },
    {
      valor: cruces ? numero(cruces.con) : null,
      etiqueta: "con antecedentes del ganador",
      contexto: cruces
        ? cruces.alta > 0
          ? plural(cruces.alta, "con un antecedente grave", "con antecedentes graves")
          : `de ${numero(totalContratos)}, ninguno grave`
        : undefined,
      href: cruces && cruces.con > 0 ? `${ruta}?cruces=con` : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué son los antecedentes del ganador?">
          Datos oficiales donde aparece quien ganó (o sus socios y representantes): aportes de campaña, candidaturas,
          sanciones, penalidades, visitas a entidades, socios comunes con otros postores. No prueban por sí solos una
          irregularidad.
        </Ayuda>
      ),
    },
    {
      valor: anio ? solesCompacto(anio.pim) : null,
      etiqueta: anio ? `presupuesto ${anio.year}${deTodoElGobierno ? " del gobierno regional" : ""}` : "presupuesto",
      contexto: anio
        ? anio.pim > 0
          ? `${porcentaje(ejecucionPct(anio), { decimales: 0 })} ya gastado (devengado)`
          : undefined
        : "sin dato del MEF",
      href: `${ruta}?seccion=presupuesto`,
    },
  ];
}

function NoSePudoLeer({ ruc }: { ruc: string }) {
  return (
    <Pagina>
      <Volver href="/app/entidades">Entidades</Volver>
      <EncabezadoPagina titulo={`Entidad con RUC ${ruc}`} />
      <EstadoError
        titulo="No pudimos leer la ficha de esta entidad"
        accion={<EnlaceAccion href={`/entidad/${encodeURIComponent(ruc)}`}>Reintentar</EnlaceAccion>}
      >
        El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
      </EstadoError>
    </Pagina>
  );
}

/** Convierte el nombre de la entidad en un keyword que MEF entiende. */
function mefSearchKeywordFor(nombre: string): string {
  if (!nombre) return "";
  const n = nombre.toUpperCase();
  // Gobiernos regionales: "Gob. Reg. de Cusco" → "REGIONAL DEL DEPARTAMENTO DE CUSCO"
  if (n.includes("GOBIERNO REGIONAL") || n.includes("GOB. REG")) {
    const m = nombre.match(/de ([A-Za-záéíóúñÁÉÍÓÚÑ ]+)$/);
    if (m) return `REGIONAL DEL DEPARTAMENTO DE ${m[1].trim().toUpperCase()}`;
  }
  // Municipalidades distritales/provinciales: usar el distrito/provincia clave
  if (n.includes("MUNICIPALIDAD") || n.includes("MUN.")) {
    const m = nombre.match(/de ([A-Za-záéíóúñÁÉÍÓÚÑ]+)\s*$/);
    if (m)
      return `MUNICIPALIDAD ${n.includes("DISTRITAL") || n.includes("DIST") ? "DISTRITAL" : n.includes("PROVINCIAL") || n.includes("PROV") ? "PROVINCIAL" : ""} DE ${m[1].trim().toUpperCase()}`
        .replace(/\s+/g, " ")
        .trim();
  }
  // Ministerios: dejar tal cual en mayúsculas
  return n;
}
