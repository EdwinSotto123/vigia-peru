import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Building2, CloudOff, Flag, Hash, MapPin } from "lucide-react";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import { migasConDesde, leerDesde } from "@/lib/desde";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { ejecucionPct, sinAnioRepetido, type MefBudgetRow } from "@/lib/mef";
import { REGIONES } from "@/lib/peru-data";
import { normalizar } from "@/lib/partidos";
import { TIPO_CRUCE } from "@/lib/cruces";
import { getCorrupcionEntidad, rutaCorrupcion } from "@/lib/corrupcion";
import { ORDENES, contratosParametros, getContratos, getResumenContratos, parseContratosQuery, type ContratosPagina, type ContratosQuery, type ResumenContratos } from "@/lib/contratos";
import { EjecucionPresupuestal, EjecucionPresupuestalSkeleton } from "@/components/EjecucionPresupuestal";
import { getEntidad } from "@/lib/api-client";
import { TablaContratos, TablaContratosSkeleton } from "@/components/contratos/TablaContratos";
import { filtroEtapa, filtroMes, filtroOperativo, filtroTipo, filtrosMonto, filtrosVisibles } from "@/components/contratos/filtros";
import { SeguirEntidadBoton } from "@/components/mapa/SeguirEntidadBoton";
import { Ayuda, CabeceraPestana, EncabezadoPagina, FichaNoLeida, Migas, Pagina, Pestanas } from "@/components/patrones";
import { BarraFiltros, Indicadores, IndicadoresSkeleton, Listado, TablaSkeleton, ZonaResultados, type FiltroSecundario, type Indicador, type Parametros } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { EstadoVacio as AvisoEnLinea } from "@/components/ui/EstadoVacio";
import { InicioEntidad } from "@/components/inicio/InicioEntidad";
import { InformesContraloria } from "@/components/inicio/CasosCorrupcion";
import { CRUCE_CAPTURA } from "@/components/entidad/CapturaEntidad";
import { ListaPersonas } from "@/components/personas/ListaPersonas";
import { ListaPlanilla, P_PLANILLA } from "@/components/personas/ListaPlanilla";
import { ListaPlazas, P_PLAZAS } from "@/components/personas/ListaPlazas";
import { getMenores, parseMenoresQuery, P_MEN } from "@/lib/menores";
import { ListaMenores, BarraMenoresGeneral } from "@/components/menores/ListaMenores";
import { PARAMS_EN_FICHA } from "@/lib/personas";

/**
 * /entidad/[ruc] — la ficha de una entidad, con el mismo esqueleto que la de un contrato:
 *   volver → identidad (nombre; tipo, RUC y zona; financiar, denunciar, seguir) → tres cifras (contratos y lo leído,
 *   antecedentes de los ganadores, presupuesto; cada una abre su pestaña o su filtro) → pestañas (`?seccion=`):
 *     · Inicio: qué se encontró (banderas, con la captura política), dinero y control, con la columna lateral de quién
 *       la gobierna y quién aprueba sus contratos (components/inicio/InicioEntidad.tsx).
 *     · Contratos: TODOS los suyos desde 2015 (con su ganador), con los filtros de /app/contratos ("¿Lo leyó Vigía?",
 *       antecedentes, riesgo, año…) y la misma tabla; la URL guarda el filtro.
 *     · Cuánto gasta: presupuesto del MEF de su unidad ejecutora (migración 62) y en qué lo gasta (63).
 *     · Control: todos los informes de la Contraloría sobre ella (en el Inicio van las cifras y los tres últimos).
 *
 * Historia: la primera versión listaba sólo los contratos con dictamen (4 de 271) y tenía una pestaña con los mismos
 * contratos para los antecedentes (hoy columna y filtro). La segunda fue una página larga con un índice que sólo
 * desplazaba, y "Órdenes del mismo día" como sección aparte: el usuario pidió pestañas de verdad. La tercera tuvo
 * "Contratos en Vigía" y "Procesos desde 2015" (CONOSCE) por separado y las órdenes fraccionadas bajo "Cuánto gasta":
 * con la historia del OECE en la base son una sola lista, y el fraccionamiento es un antecedente de cada contrato
 * (filtro Antecedentes y la ficha del contrato), no un gasto. Hubo una pestaña "Denuncias" cuyo único contenido era el
 * mismo botón "Denunciar" de la cabecera (el formulario ya explica que la denuncia queda en reserva): se quitó.
 */

/** Lo que la ficha usa de la entidad (`GET /entidades/:ruc`). Sin respuesta del API, se arma con lo que sí llegó. */
interface EntidadFicha {
  ruc: string;
  nombre: string | null;
  tipo?: string | null;
  region?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  ubigeo?: string | null;
  contratos?: number | null;
  contratosEnCola?: number | null;
}

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
  const desde = leerDesde(searchParams);
  // La entidad la fija la ruta: de la URL sólo se leen los demás filtros (zona y partido no aplican).
  const query: ContratosQuery = { ...parseContratosQuery(searchParams), entidad: ruc, ubigeo: undefined, partido: undefined };
  const parametros = contratosParametros({ ...query, entidad: undefined });
  const filtrada = Object.entries(parametros).some(([k, v]) => k !== "orden" && !!v);

  // Todo arranca a la vez; la lista y su barra esperan cada una lo suyo (`Suspense`).
  const pagina = getContratos({ ...query, size: TAM });
  const resumenFiltrado = getResumenContratos(query);
  const resumenEntidadP = filtrada ? getResumenContratos({ entidad: ruc }) : resumenFiltrado;
  // Antes, si el API fallaba o no conocía el RUC, la ficha se armaba con datos inventados; después, si `GET /entidades`
  // fallaba no se mostraba NADA, aunque sus contratos, la captura o la Contraloría sí respondían. Ahora: RUC
  // desconocido, 404; sin respuesta de la entidad pero con contratos suyos en la base (existe), la ficha se arma con lo
  // que llegó y un aviso arriba (falta su nombre, ubicación y presupuesto; el nombre sale de sus contratos); sin nada, se
  // dice que no se pudo leer.
  let apiResp: Awaited<ReturnType<typeof getEntidad>> = null;
  let falloEntidad = false;
  try {
    apiResp = await getEntidad(ruc);
  } catch (err) {
    console.error("[entidad] el API no respondió:", (err as Error).message);
    falloEntidad = true;
  }
  if (!falloEntidad && !apiResp?.entidad) notFound();

  const resumenEntidad = await resumenEntidadP;
  let e: EntidadFicha | undefined = apiResp?.entidad;
  if (!e) {
    if (!resumenEntidad?.total) return <NoSePudoLeer ruc={ruc} />;
    const primera = await pagina;
    e = { ruc, nombre: primera?.data.find((c) => c.entidadRuc === ruc && c.entidad)?.entidad ?? null, contratos: resumenEntidad.total };
  }
  const nombre = e.nombre ? tituloNatural(String(e.nombre)) : `Entidad con RUC ${ruc}`;
  const region: string | null = e.region || null;
  const enCola = Number(e.contratosEnCola || 0);
  const totalContratos = resumenEntidad?.total ?? Number(e.contratos || 0);
  const regionDenuncias = region ? REGIONES.find((r) => normalizar(r.nombre) === normalizar(region))?.nombre : undefined;

  // Un enlace con filtros de la lista y sin pestaña (`?mes=2016`, `?cruces=con` desde otras páginas) abre los contratos,
  // no el Inicio.
  const con = (nombres: readonly string[]) => nombres.some((k) => typeof searchParams?.[k] === "string");
  const seccion =
    (typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined) ??
    (con(Object.values(PARAMS_EN_FICHA)) ? "personas" : con(Object.values(P_PLANILLA)) ? "planilla" : con(Object.values(P_PLAZAS)) ? "plazas" : filtrada ? "contratos" : undefined);
  // "Inicio" es la primera pestaña (sin `seccion` en la URL): la lista de contratos lleva la suya en sus enlaces
  // (paginación, filtros), o volverían a Inicio.
  const parametrosLista: Parametros = { ...parametros, seccion: "contratos" };
  // Contratos menores (≤8 UIT) de esta entidad: por su RUC, con los filtros «m» propios.
  const fm = { ...parseMenoresQuery(searchParams), entidad: undefined, proveedor: undefined };
  const pmMenores: Parametros = { seccion: "menores" };
  for (const [k, key] of Object.entries(P_MEN)) {
    if (k === "page") continue;
    const v = (fm as Record<string, unknown>)[k];
    if (v != null) pmMenores[key] = String(v);
  }
  const menoresP = getMenores({ ...fm, entidad: e.ruc, size: 25 });

  return (
    <Pagina>
      <Migas
        items={migasConDesde(desde, [{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Entidades", href: "/app/entidades" }, { etiqueta: nombre, href: ruta }])}
        pestanas={{ primera: "inicio", activa: seccion ?? "inicio", etiquetas: { contratos: "Contratos", menores: "Menores", personas: "Personas contratadas", planilla: "Planilla", plazas: "Plazas CAS", presupuesto: "Cuánto gasta", control: "Control" } }}
      />

      {/* 1. Identidad: nombre; tipo, RUC y zona en una línea; lo que se puede hacer con ella. Una acción primaria
          (financiar su lectura, si tiene cola) y el resto compacto: antes eran cuatro botones del mismo peso, uno por
          renglón en el celular. "Sus proveedores" pasó a "Sus contratos" y a "Ver también" del Inicio. */}
      <EncabezadoPagina
        titulo={nombre}
        bajada={
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> {etiquetaTipoEntidad(e.tipo ?? null, e.nombre)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Hash size={14} className="shrink-0 text-mute" aria-hidden /> RUC{" "}
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
            {/* La única acción sobre su cola: financiar la lectura de ESTA entidad (sin cola, no hay botón). */}
            {enCola > 0 && (
              <EnlaceAccion href={`/app/financiar/entidad/${e.ruc}`} flecha>
                Financiar su auditoría
              </EnlaceAccion>
            )}
            <EnlaceAccion href={`/reporte/nuevo?modo=entidad&ruc=${e.ruc}`} variante="secundario" className="px-4">
              <Flag size={14} aria-hidden /> Denunciar
            </EnlaceAccion>
            <SeguirEntidadBoton ruc={e.ruc} nombre={nombre} />
          </>
        }
      />

      {/* La entidad no respondió pero sus contratos sí: se dice qué falta, una vez, y se sigue con lo que llegó. */}
      {falloEntidad && (
        <AvisoEnLinea variante="compacta" tono="error" icono={<CloudOff size={16} />} accion={{ href: ruta, etiqueta: "Reintentar" }}>
          No pudimos leer la ficha de la entidad: faltan su ubicación y su presupuesto. Lo de abajo sí llegó.
        </AvisoEnLinea>
      )}

      {/* 2. Lo que se sabe de ella, en tres cifras; cada una abre su pestaña o su filtro. */}
      <Indicadores items={indicadores({ resumen: resumenEntidad, totalContratos, enCola, mef: apiResp?.mef ?? null, ruta })} />

      {/* 3. Pestañas, como la ficha de un contrato (?seccion=). `key`: un enlace de las cifras de arriba a otra pestaña
          la abre (sin la clave, la pestaña ya montada no cambiaba). */}
      <Pestanas
        fija
        key={seccion ?? "inicio"}
        etiqueta="Secciones de la entidad"
        activa={seccion}
        pestanas={[
          {
            clave: "inicio",
            etiqueta: "Inicio",
            // Qué se encontró → dinero → control, con la columna lateral de quién la gobierna y quién decide. Cada parte
            // espera lo suyo (Suspense adentro).
            contenido: (
              <InicioEntidad
                ruc={e.ruc}
                ruta={ruta}
                resumen={resumenEntidad}
                enCola={enCola}
                region={region}
                ubigeo={e.ubigeo ?? null}
                regionDenuncias={regionDenuncias}
                nepotismo={apiResp?.nepotismo ?? null}
              />
            ),
          },
          {
            clave: "contratos",
            etiqueta: "Contratos",
            conteo: totalContratos,
            contenido: (
              <div className="space-y-4">
                {/* Sólo el título y su ⓘ: la bajada repetía la pestaña y, con la barra de filtros, el primer contrato
                    quedaba a 1.6 pantallas en el celular. */}
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Qué contratos hay aquí?">
                      <span className="block">
                        Todas sus convocatorias desde 2015, con su ganador y lo que se le adjudicó (registro OCDS del OECE),
                        lo que leyó Vigía y los antecedentes de quien ganó. Las de 2026 entran a la cola de lectura; «¿Lo
                        leyó Vigía?» filtra las que ya se leyeron.
                      </span>
                      <span className="mt-2 block">
                        Cada fila abre su resumen; el dossier completo, con el dictamen si ya se leyó, está en su ficha.
                        Los antecedentes salen del cruce automático de datos públicos: son motivos para revisar, no pruebas.
                      </span>
                    </Ayuda>
                  }
                />
                <Listado ruta={ruta} parametros={parametrosLista} paramPagina="page">
                  <Suspense fallback={<BarraEntidad resumen={null} parametros={parametrosLista} />}>
                    <BarraConConteos resumen={resumenFiltrado} parametros={parametrosLista} />
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
            clave: "menores",
            etiqueta: "Menores",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Qué son los contratos menores?">
                      <span className="block">
                        Compras de esta entidad por montos pequeños (hasta 8 UIT, unos S/ 42,800). Por ley se contratan de
                        forma directa, sin concurso; aquí sí suele publicarse el requerimiento (las especificaciones) y una
                        ventana de cotización (SEACE). El módulo es facultativo, así que no están todas.
                      </span>
                    </Ayuda>
                  }
                >
                  Sus contratos menores (≤8 UIT), con el proveedor que ganó y el requerimiento descargable.
                </CabeceraPestana>
                <Listado ruta={ruta} parametros={pmMenores} paramPagina={P_MEN.page}>
                  <Suspense fallback={<div className="min-h-[52px]" />}>
                    <BarraMenoresGeneral pagina={menoresP} />
                  </Suspense>
                  <ZonaResultados>
                    <Suspense fallback={<TablaContratosSkeleton />}>
                      <ListaMenores pagina={menoresP} ruta={ruta} parametros={pmMenores} actual={fm.page ?? 1} />
                    </Suspense>
                  </ZonaResultados>
                </Listado>
              </div>
            ),
          },
          {
            clave: "personas",
            etiqueta: "Personas contratadas",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Quiénes son?">
                      <span className="block">
                        Las personas a las que esta entidad pagó por órdenes de servicio de hasta 8 UIT, sin concurso:
                        asistentes, asesores, choferes, profesionales (OECE, CONOSCE). Por privacidad no se muestra su DNI
                        ni su RUC y se tapa un apellido.
                      </span>
                      <span className="mt-2 block">
                        Las señales dicen qué otro registro público coincide con cada una. No prueban un delito ni un
                        parentesco: son motivos para revisar.
                      </span>
                    </Ayuda>
                  }
                >
                  A quién le dio órdenes de servicio como persona, cuánto le pagó y qué dicen de cada una otros registros.
                </CabeceraPestana>
                <ListaPersonas alcance={{ entidad: e.ruc }} sp={searchParams} P={PARAMS_EN_FICHA} ruta={ruta} base={{ seccion: "personas" }} deEntidad conIndicadores />
              </div>
            ),
          },
          {
            clave: "planilla",
            etiqueta: "Planilla",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿De dónde sale la planilla?">
                      <span className="block">
                        Del Portal de Transparencia Estándar de la entidad, rubro Personal: cada mes publica a quienes trabajan
                        en ella (CAS, 276, 728, funcionarios), con su cargo, su oficina y lo que cobran. No trae DNI: los cruces
                        son por nombre completo. Se tapa un apellido.
                      </span>
                      <span className="mt-2 block">Las señales no prueban un delito ni un parentesco: son motivos para revisar.</span>
                    </Ayuda>
                  }
                >
                  Quiénes trabajan en la entidad, cuánto cobran y qué dicen de cada uno otros registros.
                </CabeceraPestana>
                <ListaPlanilla alcance={{ entidad: e.ruc }} sp={searchParams} ruta={ruta} base={{ seccion: "planilla" }} deEntidad />
              </div>
            ),
          },
          {
            clave: "plazas",
            etiqueta: "Plazas CAS",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿De dónde salen las plazas?">
                      De SERVIR Talento Perú: las convocatorias CAS que la entidad publicó, con sus requisitos y su sueldo. Las
                      señales marcan rasgos de una plaza hecha a la medida de alguien; no prueban un direccionamiento.
                    </Ayuda>
                  }
                >
                  Las plazas CAS que convocó, con lo que pedían y lo que pagaban.
                </CabeceraPestana>
                <ListaPlazas alcance={{ entidad: e.ruc }} sp={searchParams} ruta={ruta} base={{ seccion: "plazas" }} deEntidad />
              </div>
            ),
          },
          {
            clave: "presupuesto",
            etiqueta: "Cuánto gasta",
            contenido: (
              <div>
                <CabeceraPestana>Su presupuesto de cada año, en qué lo gasta y cuánto ya gastó, según el MEF.</CabeceraPestana>
                {/* El MEF llega por streaming: la pestaña muestra su esqueleto hasta que responde. */}
                <Suspense fallback={<EjecucionPresupuestalSkeleton />}>
                  <EjecucionPresupuestal query={mefSearchKeywordFor(String(e.nombre ?? ""))} ruc={e.ruc} />
                </Suspense>
              </div>
            ),
          },
          {
            // La tabla entera de la Contraloría (en el Inicio van sus cifras y los tres últimos informes). Ocupaba ~1,850
            // px del Inicio.
            clave: "control",
            etiqueta: "Control",
            titulo: "Informes de la Contraloría",
            contenido: (
              <div>
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Qué es un informe de control?">
                      La Contraloría revisa a las entidades y, cuando encuentra algo, señala una responsabilidad presunta
                      (penal, civil o administrativa) de sus funcionarios y la deriva a quien corresponde. No es una
                      condena. El informe nombra a los funcionarios: aquí se enlaza, no se copia.
                    </Ayuda>
                  }
                >
                  Todos sus informes de control, con la responsabilidad presunta que señalan. Cada fila abre el informe oficial.
                </CabeceraPestana>
                <Suspense
                  fallback={
                    <div className="space-y-4">
                      <IndicadoresSkeleton n={4} />
                      <TablaSkeleton columnas={[{ clave: "a", titulo: "Informe", ancho: "1fr" }]} filas={6} />
                    </div>
                  }
                >
                  <InformesEntidad ruc={e.ruc} />
                </Suspense>
              </div>
            ),
          },
        ]}
      />
    </Pagina>
  );
}

/** Los informes de la Contraloría de la entidad, para su pestaña (las páginas siguientes las pide la tabla). */
async function InformesEntidad({ ruc }: { ruc: string }) {
  const datos = await getCorrupcionEntidad(ruc);
  return <InformesContraloria datos={datos} ruta={rutaCorrupcion.entidad(ruc)} ambito="entidad" conTitulo={false} />;
}

// ─── Lista de contratos ──────────────────────────────────────────────────────

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
  const vistas = filtrosVisibles(resumen);
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: "Buscar en sus contratos…", etiqueta: "Buscar en sus contratos por objeto o código", min: 3 }}
      visibles={vistas.filter((f) => f.param !== "riesgo")}
      filtros={[
        ...vistas.filter((f) => f.param === "riesgo"),
        filtroOperativo(resumen),
        filtroTipo(resumen),
        filtroEtapa(),
        filtroMes(parametros),
        ...filtrosMonto(parametros),
        ...(parametros.cruce ? [filtroCaptura(parametros.cruce, resumen)] : []),
      ]}
      orden={{ param: "orden", porDefecto: "fecha", opciones: ORDENES.map((o) => ({ valor: o.value, etiqueta: o.label })) }}
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

// ─── Las cuatro cifras ───────────────────────────────────────────────────────

/** El último año del MEF con datos propios (sin el que repite al anterior). */
function ultimoAnio(mef: { by_year?: MefBudgetRow[] | null; kind?: string } | null | undefined): MefBudgetRow | null {
  if (!mef || mef.kind !== "ok" || !mef.by_year?.length) return null;
  const { years } = sinAnioRepetido(mef.by_year.map((r) => ({ ...r, pia: Number(r.pia), pim: Number(r.pim), devengado: Number(r.devengado), girado: Number(r.girado) })));
  return years[years.length - 1] ?? null;
}

/**
 * Tres cifras, cada una con su fuente dicha en su nombre: sus contratos desde 2015 (y lo leído y el riesgo, del mismo
 * resumen que la lista), los antecedentes de los ganadores y su presupuesto.
 */
function indicadores({
  resumen,
  totalContratos,
  enCola,
  mef,
  ruta,
}: {
  resumen: ResumenContratos | null;
  totalContratos: number;
  enCola: number;
  mef: { by_year?: MefBudgetRow[] | null; kind?: string; keyword?: string | null } | null;
  ruta: string;
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
      valor: numero(totalContratos),
      etiqueta: "contratos desde 2015",
      contexto: resumen
        ? leidos === 0
          ? enCola > 0
            ? `ninguno leído, ${numero(enCola)} esperan quien financie su lectura`
            : "ninguno leído todavía"
          : // La misma medida que la lista de entidades ("Con dictamen 13 de 331"): con dictamen publicado.
            `${plural(publicados, "con dictamen publicado", "con dictamen publicado")}${altos > 0 ? `, ${numero(altos)} de riesgo alto` : ""}`
        : undefined,
      href: leidos > 0 ? `${ruta}?seccion=contratos&lectura=publicado` : `${ruta}?seccion=contratos`,
      ayuda: (
        <Ayuda titulo="¿Qué contratos puede leer Vigía?">
          <span className="block">
            Todas sus convocatorias desde 2015. Las de 2026 entran a la cola de lectura: se leen con sus documentos y
            pueden tener dictamen; las anteriores se ven con sus datos, sin lectura.
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
      href: cruces && cruces.con > 0 ? `${ruta}?seccion=contratos&cruces=con` : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué son los antecedentes del ganador?">
          Datos oficiales donde aparece quien ganó (o sus socios y representantes): aportes de campaña, candidaturas,
          sanciones, penalidades, visitas a entidades, socios comunes con otros postores. No prueban por sí solos una
          irregularidad.
        </Ayuda>
      ),
    },
    // Sin presupuesto del MEF no hay tarjeta (una que sólo diga «Sin dato» no informa): lo dice el bloque «En qué gasta».
    ...(anio
      ? [
          {
            valor: solesCompacto(anio.pim),
            etiqueta: `presupuesto ${anio.year}${deTodoElGobierno ? " del gobierno regional" : ""}`,
            contexto: anio.pim > 0 ? `${porcentaje(ejecucionPct(anio), { decimales: 0 })} ya gastado (devengado)` : undefined,
            href: `${ruta}?seccion=presupuesto`,
          },
        ]
      : []),
  ];
}

function NoSePudoLeer({ ruc }: { ruc: string }) {
  return (
    <FichaNoLeida
      migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Entidades", href: "/app/entidades" }]}
      titulo={`Entidad con RUC ${ruc}`}
      error="No pudimos leer la ficha de esta entidad"
      reintentar={{ href: `/entidad/${encodeURIComponent(ruc)}` }}
    />
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
