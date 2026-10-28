import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Building2, CloudOff, ExternalLink, FileSearch, FileText, Flag, HardHat, Hash, IdCard, LayoutDashboard, MapPin, Network, Ruler, Users, Wallet } from "lucide-react";
import { etiquetaTipoVisible, tipoEntidad } from "@/lib/entidad-tipo";
import { migasConDesde, leerDesde } from "@/lib/desde";
import { fecha, numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { ejecucionPct, sinAnioRepetido, ultimoConPim, type MefBudgetRow } from "@/lib/mef";
import { REGIONES } from "@/lib/peru-data";
import { normalizar } from "@/lib/partidos";
import { getCorrupcionEntidad, rutaCorrupcion } from "@/lib/corrupcion";
import { contratosParametros, getContratos, getResumenContratos, parseContratosQuery, type ContratosQuery, type ResumenContratos } from "@/lib/contratos";
import { getConteosEntidad, getEntidad } from "@/lib/api-client";
import { parseMenoresQuery, P_MEN } from "@/lib/menores";
import { parseOrdenesQuery, P_ORD } from "@/lib/ordenes";
import { PARAMS_EN_FICHA } from "@/lib/personas";
import { rutaRegion } from "@/lib/regiones";
import { uno } from "@/lib/utils";
import { EjecucionPresupuestal, EjecucionPresupuestalSkeleton } from "@/components/EjecucionPresupuestal";
import { SeguirEntidadBoton } from "@/components/mapa/SeguirEntidadBoton";
import { Ayuda, BanderasFicha, CabeceraPestana, Cargando, EncabezadoPagina, FichaNoLeida, Migas, Pagina, Pestanas, type Pestana } from "@/components/patrones";
import { OrganizacionEntidad } from "@/components/entidad/OrganizacionEntidad";
import { banderasEntidad } from "@/lib/banderasEntidad";
import { IndicadoresSkeleton, TablaSkeleton, type Indicador } from "@/components/listado";
import { CLASE_ACCION_LISTA, EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { EstadoVacio as AvisoEnLinea } from "@/components/ui/EstadoVacio";
import { Skeleton } from "@/components/ui/Skeleton";
import { InicioEntidad } from "@/components/inicio/InicioEntidad";
import { InformesContraloria } from "@/components/inicio/CasosCorrupcion";
import { AyudaCompras, ComprasEntidad, TAM, VISTAS, type VistaCompras } from "@/components/entidad/ComprasEntidad";
import { MarcoFicha } from "@/components/entidad/MarcoFicha";
import { Acciones, Diferida, EsqueletoPestana, PestanaVacia } from "@/components/entidad/PestanasEntidad";
import { ListaPersonas } from "@/components/personas/ListaPersonas";
import { ListaPlanilla, P_PLANILLA } from "@/components/personas/ListaPlanilla";
import { EvolucionPlanilla } from "@/components/personas/EvolucionPlanilla";
import { ListaPlazas, P_PLAZAS } from "@/components/personas/ListaPlazas";
import { ObrasEntidad, ObrasVacia } from "@/components/obras/ObrasEntidad";

/**
 * /entidad/[ruc] — la ficha de una entidad, con el mismo esqueleto que la de un contrato:
 *   volver → identidad (nombre; tipo, RUC y zona; financiar, denunciar, seguir) → pestañas (`?seccion=`), cada una con su
 *   número y las vacías al final:
 *     · Inicio: sus cifras (contratos y lo leído, antecedentes de los ganadores, órdenes, presupuesto; cada una abre su
 *       pestaña o su filtro), qué se encontró (banderas, con la captura política), dinero y control, con la columna
 *       lateral de quién la gobierna y quién aprueba sus contratos (components/inicio/InicioEntidad.tsx).
 *     · Contratos: lo que compró, en tres vistas (`?vista=`): sus convocatorias desde 2015 (con los filtros de
 *       /app/contratos; la URL guarda el filtro), sus órdenes de compra y de servicio y sus contratos menores
 *       (components/entidad/ComprasEntidad.tsx).
 *     · Personas contratadas, Planilla y Plazas CAS: quiénes trabajan para ella, por órdenes, en planilla o por concurso.
 *     · Cuánto gasta: presupuesto del MEF de su unidad ejecutora (migración 62) y en qué lo gasta (63).
 *     · Control: todos los informes de la Contraloría sobre ella (en el Inicio van las cifras y los tres últimos).
 *   Una pestaña sin nada muestra su título y UN estado vacío que dice por qué y dónde mirar. La abierta se arma primero;
 *   las demás después, en la misma respuesta (`Diferida`), así que cambiar de pestaña sigue siendo instantáneo.
 *
 * Historia: la primera versión listaba sólo los contratos con dictamen (4 de 271) y tenía una pestaña con los mismos
 * contratos para los antecedentes (hoy columna y filtro). La segunda fue una página larga con un índice que sólo
 * desplazaba, y "Órdenes del mismo día" como sección aparte: el usuario pidió pestañas de verdad. La tercera tuvo
 * "Contratos en Vigía" y "Procesos desde 2015" (CONOSCE) por separado y las órdenes fraccionadas bajo "Cuánto gasta":
 * con la historia del OECE en la base son una sola lista, y el fraccionamiento es un antecedente de cada contrato
 * (filtro Antecedentes y la ficha del contrato), no un gasto. Hubo una pestaña "Denuncias" cuyo único contenido era el
 * mismo botón "Denunciar" de la cabecera (el formulario ya explica que la denuncia queda en reserva): se quitó. La
 * cuarta (auditoría del 2026-10-26) tenía siempre ocho pestañas, sólo Contratos con número: «Menores» estaba vacía en 14
 * de 14 fichas y las vacías mostraban tarjetas en 0 antes de decirlo; las órdenes no estaban, y las cifras de arriba se
 * repetían en todas las pestañas (en el celular, el primer contrato quedaba debajo de la primera pantalla).
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

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** El nombre de cada pestaña en la ruta de navegación (la primera, Inicio, no se agrega). */
const ETIQUETAS: Record<string, string> = { contratos: "Contratos", obras: "Obras", personas: "Personas contratadas", planilla: "Planilla", organizacion: "Organización", plazas: "Plazas CAS", presupuesto: "Cuánto gasta", control: "Control" };
/** Una sociedad anónima (S.A., S.A.C., S.A.A.): una empresa del Estado aunque su tipo declarado diga otra cosa (Petroperú). */
const SOCIEDAD = /\bS\.?\s?A\.?(?:\s?[AC]\.?)?\s*$/i;
const CONSULTA_AMIGABLE = "https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx";
const BUSCADOR_CONTRALORIA = "https://buscadorinformes.contraloria.gob.pe/";

export async function generateMetadata({ params }: { params: { ruc: string } }): Promise<Metadata> {
  const r = await getEntidad(params.ruc).catch(() => null);
  const nombre = r?.entidad?.nombre as string | undefined;
  return { title: nombre ? tituloNatural(nombre) : `Entidad ${params.ruc}` };
}

/** Las que cumplen `vacia`, al final, cada grupo en su orden. */
const alFinal = <T,>(xs: readonly T[], vacia: (x: T) => boolean): T[] => [...xs.filter((x) => !vacia(x)), ...xs.filter(vacia)];

export default async function EntidadProfile({
  params,
  searchParams,
}: {
  params: { ruc: string };
  /** Los filtros de sus listas (los de contratos, con los mismos parámetros que /app/contratos). */
  searchParams?: Busqueda;
}) {
  const ruc = params.ruc;
  const ruta = `/entidad/${ruc}`;
  // «Menores» era una pestaña; hoy es una vista de Contratos. El enlace viejo lleva a la vista, con sus filtros.
  if (uno(searchParams?.seccion) === "menores") redirect(conCambios(ruta, searchParams, { seccion: "contratos", vista: "menores" }));
  const desde = leerDesde(searchParams);
  // La entidad la fija la ruta: de la URL sólo se leen los demás filtros (zona y partido no aplican).
  const query: ContratosQuery = { ...parseContratosQuery(searchParams), entidad: ruc, ubigeo: undefined, partido: undefined };
  const parametros = contratosParametros({ ...query, entidad: undefined });
  const filtrada = Object.entries(parametros).some(([k, v]) => k !== "orden" && !!v);
  // Sus órdenes y sus contratos menores, también por la ruta: con sus filtros «o» y «m», sin la entidad ni la región.
  const fo = { ...parseOrdenesQuery(searchParams), entidad: undefined, region: undefined };
  const fm = { ...parseMenoresQuery(searchParams), entidad: undefined, proveedor: undefined };

  // Lo que esperan la cabecera y la barra de pestañas, todo a la vez: la entidad, el resumen de sus contratos (las cifras
  // y el Inicio) y cuántas filas tiene cada pestaña (su número y su orden). Lo demás lo pide cada pestaña.
  const resumenFiltrado = getResumenContratos(query);
  const resumenEntidadP = filtrada ? getResumenContratos({ entidad: ruc }) : resumenFiltrado;
  const conteosP = getConteosEntidad(ruc);
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

  const [resumenEntidad, conteos] = await Promise.all([resumenEntidadP, conteosP]);
  let e: EntidadFicha | undefined = apiResp?.entidad;
  if (!e) {
    if (!resumenEntidad?.total) return <NoSePudoLeer ruc={ruc} />;
    // El mismo pedido que la lista de contratos (Next lo hace una vez).
    const primera = await getContratos({ ...query, size: TAM });
    e = { ruc, nombre: primera?.data.find((c) => c.entidadRuc === ruc && c.entidad)?.entidad ?? null, contratos: resumenEntidad.total };
  }
  const nombre = e.nombre ? tituloNatural(String(e.nombre)) : `Entidad con RUC ${ruc}`;
  const region: string | null = e.region || null;
  const dep = e.ubigeo?.slice(0, 2) || null;
  const enCola = Number(e.contratosEnCola || 0);
  const totalContratos = resumenEntidad?.total ?? Number(e.contratos || 0);
  const regionDenuncias = region ? REGIONES.find((r) => normalizar(r.nombre) === normalizar(region))?.nombre : undefined;
  const mef = apiResp?.mef ?? null;
  const empresaDelEstado = tipoEntidad(e.tipo ?? null, e.nombre) === "empresa_publica" || SOCIEDAD.test(e.nombre ?? "");
  // La OECE la registra fuera del SIAF (FONAFE, EsSalud, EPS…): su presupuesto no está en los datos abiertos del MEF.
  const fueraSiaf = mef?.fueraSiaf === true;
  const tipoVisible = etiquetaTipoVisible(e.tipo ?? null, e.nombre);
  // Sus banderas, fijas bajo el nombre en todas las pestañas: las mismas que su fila en la lista, con cuántos casos y el
  // enlace a la evidencia (el nepotismo ya no se queda en el Inicio). Sin respuesta de la entidad, ninguna.
  const banderas = apiResp ? (banderasEntidad(ruc, apiResp.senales, apiResp.informes, apiResp.nepotismo?.total ?? 0) ?? []) : [];

  // Cuántas filas tiene cada pestaña. null = sin dato (la API no respondió): la pestaña va sin número y en su lugar,
  // nunca como vacía. Las órdenes, null también si las tiene pero aún no están contadas (migración 148).
  const n = {
    contratos: resumenEntidad ? resumenEntidad.total : e.contratos != null ? Number(e.contratos) : null,
    ordenes: conteos ? conteos.ordenes : null,
    menores: conteos?.menores ?? null,
    personas: conteos?.personas ?? null,
    planilla: conteos?.planilla ?? null,
    plazas: conteos?.plazas ?? null,
    informes: conteos?.informes ?? null,
  };
  // Sin presupuesto del MEF sólo si la entidad respondió (sin respuesta, no se sabe).
  const sinMef = !falloEntidad && !(mef?.kind === "ok" && mef.by_year?.length);
  const sinCompras = VISTAS.every((v) => n[v] === 0);
  // Sus obras de INFOBRAS y sus inversiones de Invierte.pe (migración 160): sin ninguna de las dos, la pestaña va al final.
  const sinObras = conteos?.obras === 0 && conteos?.inversiones === 0;
  const vacias = new Set<string>(
    [sinCompras && "contratos", sinObras && "obras", n.personas === 0 && "personas", n.planilla === 0 && "planilla", n.plazas === 0 && "plazas", sinMef && "presupuesto", n.informes === 0 && "control"].filter(
      (x): x is string => !!x,
    ),
  );

  // La pestaña abierta: la de la URL o, sin ella, la lista que traen sus filtros (`?mes=2016`, `?cruces=con` desde otras
  // páginas abren los contratos, no el Inicio). Y dentro de Contratos, la vista: la de la URL, la de sus filtros o la
  // primera (las vacías van al final).
  const con = (nombres: readonly string[]) => nombres.some((k) => typeof searchParams?.[k] === "string");
  const vistaPorFiltros: VistaCompras | undefined = con(Object.values(P_ORD))
    ? "ordenes"
    : con(Object.values(P_MEN))
      ? "menores"
      : filtrada || con(["page", "cursor", "antes"])
        ? "contratos"
        : undefined;
  const ordenVistas = alFinal(VISTAS, (v) => n[v] === 0);
  const vista = VISTAS.find((v) => v === uno(searchParams?.vista)) ?? vistaPorFiltros ?? ordenVistas[0];
  const seccion =
    uno(searchParams?.seccion) ??
    (con(Object.values(PARAMS_EN_FICHA)) ? "personas" : con(Object.values(P_PLANILLA)) ? "planilla" : con(Object.values(P_PLAZAS)) ? "plazas" : vistaPorFiltros ? "contratos" : "inicio");

  const enlace = (s: string, extra: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ seccion: s, ...extra })}`;
  const accion = (href: string, texto: string) => (
    <Link href={href} prefetch={false} className={CLASE_ACCION_LISTA}>
      {texto}
    </Link>
  );
  const externa = (href: string, texto: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${CLASE_ACCION_LISTA} gap-1.5`}>
      {texto} <ExternalLink size={13} aria-hidden />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );

  const todas: Pestana[] = [
    {
      clave: "inicio",
      icono: <LayoutDashboard size={15} aria-hidden />,
      etiqueta: "Inicio",
      // Las cifras → qué se encontró → dinero → control, con la columna lateral de quién la gobierna y quién decide.
      // Cada parte espera lo suyo (Suspense adentro).
      contenido: (
        <InicioEntidad
          ruc={e.ruc}
          ruta={ruta}
          cifras={indicadores({ resumen: resumenEntidad, totalContratos, enCola, mef, ordenes: n.ordenes, ordenesMonto: conteos?.ordenesMonto ?? null, ruta })}
          resumen={resumenEntidad}
          enCola={enCola}
          conteos={conteos}
          region={region}
          ubigeo={e.ubigeo ?? null}
          regionDenuncias={regionDenuncias}
          nepotismo={apiResp?.nepotismo ?? null}
          fueraDelMef={fueraSiaf || empresaDelEstado}
        />
      ),
    },
    {
      clave: "contratos",
      icono: <FileText size={15} aria-hidden />,
      etiqueta: "Contratos",
      // Sin número propio: son tres listas que no se suman (cada vista lleva el suyo). Sin ninguna, 0.
      conteo: sinCompras ? 0 : null,
      contenido: sinCompras ? (
        <PestanaVacia titulo="No registra compras" ayuda={<AyudaCompras />} accion={!sinMef ? accion(enlace("presupuesto"), "Ver cuánto gasta") : undefined}>
          Ni el OECE ni el SEACE tienen compras con su RUC: ni convocatorias desde 2015, ni órdenes de compra o de servicio desde
          2018, ni contratos menores.
        </PestanaVacia>
      ) : (
        <ComprasEntidad
          ruc={e.ruc}
          ruta={ruta}
          orden={ordenVistas}
          activa={vista}
          conteo={{ contratos: n.contratos, ordenes: n.ordenes, menores: n.menores }}
          menoresDesde={conteos?.menoresDesde ?? null}
          contratos={{ query, parametros, resumen: resumenFiltrado }}
          ordenes={fo}
          menores={fm}
        />
      ),
    },
    {
      // Sus obras públicas (INFOBRAS) y sus inversiones (Invierte.pe), en dos vistas con su número cada una (no se suman:
      // una obra es parte de una inversión). components/obras/ObrasEntidad.tsx.
      clave: "obras",
      icono: <HardHat size={15} aria-hidden />,
      etiqueta: "Obras",
      conteo: sinObras ? 0 : null,
      contenido: sinObras ? (
        <ObrasVacia />
      ) : (
        <ObrasEntidad ruc={e.ruc} ruta={ruta} sp={searchParams} conteo={{ obras: conteos?.obras ?? null, inversiones: conteos?.inversiones ?? null }} />
      ),
    },
    {
      clave: "personas",
      icono: <Users size={15} aria-hidden />,
      etiqueta: "Personas contratadas",
      conteo: n.personas,
      contenido: vacias.has("personas") ? (
        <PestanaVacia
          titulo="No registra órdenes de servicio a personas"
          ayuda={<AyudaPersonas />}
          accion={n.planilla ? accion(enlace("planilla"), "Ver su planilla") : n.ordenes !== 0 ? accion(enlace("contratos", { vista: "ordenes" }), "Ver sus órdenes") : undefined}
        >
          CONOSCE (OECE) no tiene órdenes de servicio de esta entidad a personas naturales (RUC 10) desde 2018.
        </PestanaVacia>
      ) : (
        <div className="space-y-4">
          <CabeceraPestana ayuda={<AyudaPersonas />}>A quién le dio órdenes de servicio como persona, cuánto le pagó y qué dicen de cada una otros registros.</CabeceraPestana>
          <ListaPersonas alcance={{ entidad: e.ruc }} sp={searchParams} P={PARAMS_EN_FICHA} ruta={ruta} base={{ seccion: "personas" }} deEntidad conIndicadores />
        </div>
      ),
    },
    {
      clave: "planilla",
      icono: <IdCard size={15} aria-hidden />,
      etiqueta: "Planilla",
      conteo: n.planilla,
      contenido: vacias.has("planilla") ? (
        <PestanaVacia titulo="Sin planilla publicada" ayuda={<AyudaPlanilla />} accion={n.personas ? accion(enlace("personas"), "Ver a las personas que contrató") : undefined}>
          La entidad no publicó su personal en el Portal de Transparencia en los meses cargados, o aún no lo encontramos.
        </PestanaVacia>
      ) : (
        <div className="space-y-4">
          <CabeceraPestana ayuda={<AyudaPlanilla />}>Quiénes trabajan en la entidad, cuánto cobran y qué dicen de cada uno otros registros.</CabeceraPestana>
          {/* Cuánta gente tuvo cada mes y cuántos entraron y salieron, con los cambios de gobierno (migración 182). */}
          <Suspense fallback={null}>
            <EvolucionPlanilla entidad={e.ruc} />
          </Suspense>
          <ListaPlanilla alcance={{ entidad: e.ruc }} sp={searchParams} ruta={ruta} base={{ seccion: "planilla" }} deEntidad />
        </div>
      ),
    },
    {
      clave: "organizacion",
      icono: <Network size={15} aria-hidden />,
      etiqueta: "Organización",
      contenido: vacias.has("planilla") ? (
        <PestanaVacia titulo="Sin planilla para armar su organización" ayuda={<AyudaPlanilla />} accion={n.personas ? accion(enlace("personas"), "Ver a las personas que contrató") : undefined}>
          Su organización sale de la planilla que publica en el Portal de Transparencia (en qué oficina trabaja cada persona), y
          no la publicó en los meses cargados.
        </PestanaVacia>
      ) : (
        <div className="space-y-4">
          <CabeceraPestana
            ayuda={
              <Ayuda titulo="¿De dónde sale su organización?">
                <span className="block">
                  De la planilla del último mes que la entidad publicó en el Portal de Transparencia: cada persona con su cargo y su
                  oficina. Se juntan las personas por oficina, se marca a quien tiene un cargo de jefatura y se le pone a cada oficina
                  su función por su nombre.
                </span>
                <span className="mt-2 block">
                  La planilla no dice de quién depende cada oficina: no hay un árbol oficial que dibujar.
                </span>
              </Ayuda>
            }
          >
            Sus oficinas, quién las encabeza, cuánta gente tienen y cuánto suman sus sueldos.
          </CabeceraPestana>
          <Suspense fallback={<Cargando texto="Armando su organización…" />}>
            <OrganizacionEntidad ruc={e.ruc} ruta={ruta} />
          </Suspense>
        </div>
      ),
    },
    {
      clave: "plazas",
      icono: <Ruler size={15} aria-hidden />,
      etiqueta: "Plazas CAS",
      conteo: n.plazas,
      contenido: vacias.has("plazas") ? (
        empresaDelEstado ? (
          <PestanaVacia titulo="Las empresas del Estado no convocan plazas CAS" ayuda={<AyudaPlazas />} accion={n.planilla ? accion(enlace("planilla"), "Ver su planilla") : undefined}>
            El régimen CAS (D. Leg. 1057) no se aplica a las empresas del Estado: su personal está en el régimen laboral privado.
          </PestanaVacia>
        ) : (
          <PestanaVacia titulo="Sin plazas CAS publicadas" ayuda={<AyudaPlazas />} accion={n.planilla ? accion(enlace("planilla"), "Ver su planilla") : undefined}>
            No encontramos convocatorias CAS de esta entidad en SERVIR Talento Perú
            {conteos?.plazasDesde ? ` desde el ${fecha(conteos.plazasDesde)}, cuando Vigía empezó a guardarlas` : " desde que Vigía empezó a guardarlas"}.
          </PestanaVacia>
        )
      ) : (
        <div className="space-y-4">
          <CabeceraPestana ayuda={<AyudaPlazas />}>Las plazas CAS que convocó, con lo que pedían y lo que pagaban.</CabeceraPestana>
          <ListaPlazas alcance={{ entidad: e.ruc }} sp={searchParams} ruta={ruta} base={{ seccion: "plazas" }} deEntidad />
        </div>
      ),
    },
    {
      clave: "presupuesto",
      icono: <Wallet size={15} aria-hidden />,
      etiqueta: "Cuánto gasta",
      contenido: sinMef ? (
        empresaDelEstado || fueraSiaf ? (
          <PestanaVacia titulo={empresaDelEstado ? "Las empresas del Estado no están en el presupuesto del MEF" : "Esta entidad no está en el presupuesto público del MEF"}>
            {fueraSiaf
              ? "El registro de entidades de la OECE la marca fuera del SIAF, el sistema con el que el MEF registra el gasto público (pasa con las empresas de FONAFE, EsSalud y las EPS de agua): su presupuesto no sale en los datos abiertos del MEF."
              : "Su presupuesto no es parte del presupuesto público que el MEF publica por unidad ejecutora."}
          </PestanaVacia>
        ) : (
          <PestanaVacia titulo="No encontramos su presupuesto en el MEF" accion={externa(CONSULTA_AMIGABLE, "Buscarla en la Consulta Amigable")}>
            No coincidió con ninguna unidad ejecutora del presupuesto público: puede figurar con otro nombre en el MEF o no
            ejecutar presupuesto propio.
          </PestanaVacia>
        )
      ) : (
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
      icono: <FileSearch size={15} aria-hidden />,
      etiqueta: "Control",
      titulo: "Informes de la Contraloría",
      conteo: n.informes,
      contenido: vacias.has("control") ? (
        <PestanaVacia
          titulo="Sin informes de control"
          ayuda={<AyudaControl />}
          accion={
            <Acciones>
              {dep && accion(rutaRegion(dep), `Ver los casos de ${region ?? "su región"}`)}
              {externa(BUSCADOR_CONTRALORIA, "Buscador de la Contraloría")}
            </Acciones>
          }
        >
          La Contraloría no tiene informes con responsabilidad sobre esta entidad en su buscador. Lo comprobado (casos con
          sentencia firme) lo publica la Procuraduría Anticorrupción por departamento.
        </PestanaVacia>
      ) : (
        <div>
          <CabeceraPestana ayuda={<AyudaControl />}>Todos sus informes de control, con la responsabilidad presunta que señalan. Cada fila abre el informe oficial.</CabeceraPestana>
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
  ];
  // La abierta se arma ya; las demás, después de lo suyo (Diferida) y con su esqueleto por si alguien las abre antes. Una
  // vacía no pide nada: va tal cual.
  const activa = todas.some((p) => p.clave === seccion) ? seccion : "inicio";
  const pestanas = alFinal(todas, (p) => vacias.has(p.clave)).map((p) =>
    p.clave === activa || vacias.has(p.clave)
      ? p
      : {
          ...p,
          contenido: (
            <Suspense fallback={<Espera clave={p.clave} />}>
              <Diferida>{p.contenido}</Diferida>
            </Suspense>
          ),
        },
  );

  return (
    <Pagina>
      <Migas
        items={migasConDesde(desde, [{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Entidades", href: "/app/entidades" }, { etiqueta: nombre, href: ruta }])}
        pestanas={{ primera: "inicio", activa, etiquetas: ETIQUETAS }}
      />

      {/* 1. Identidad: nombre; tipo, RUC y zona en una línea; lo que se puede hacer con ella. Una acción primaria
          (financiar su lectura, si tiene cola) y el resto compacto: antes eran cuatro botones del mismo peso, uno por
          renglón en el celular. "Sus proveedores" pasó a "Sus contratos" y a "Ver también" del Inicio. Fuera del Inicio,
          en el celular, sin la línea de tipo, RUC y zona (MarcoFicha): la lista empieza en la primera pantalla. */}
      <MarcoFicha activa={activa} primera="inicio">
        <EncabezadoPagina
          titulo={nombre}
          bajada={
            <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 max-sm:group-data-[compacta]/ficha:hidden">
              {/* Sin tipo que se pueda inferir del nombre, no se muestra (antes, «Entidad del Estado», que no dice nada). */}
              {tipoVisible && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> {tipoVisible}
                </span>
              )}
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
          banderas={
            banderas.length ? (
              <BanderasFicha
                etiqueta="Banderas de esta entidad"
                banderas={banderas.map((b) => ({ tipo: b.tipo, severidad: b.severidad, nombre: b.chip, n: b.n, explica: b.titulo, href: b.href }))}
              />
            ) : undefined
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
      </MarcoFicha>

      {/* La entidad no respondió pero sus contratos sí: se dice qué falta, una vez, y se sigue con lo que llegó. */}
      {falloEntidad && (
        <AvisoEnLinea variante="compacta" tono="error" icono={<CloudOff size={16} />} accion={{ href: ruta, etiqueta: "Reintentar" }}>
          No pudimos leer la ficha de la entidad: faltan su ubicación y su presupuesto. Lo de abajo sí llegó.
        </AvisoEnLinea>
      )}

      {/* 2. Pestañas, como la ficha de un contrato (?seccion=). `key`: un enlace de las cifras del Inicio a otra pestaña
          la abre (sin la clave, la pestaña ya montada no cambiaba). */}
      <Pestanas fija key={activa} etiqueta="Secciones de la entidad" activa={activa} pestanas={pestanas} />
    </Pagina>
  );
}

/** La URL de la ficha con la búsqueda de ahora y `cambios` encima (un enlace viejo llevado a su pestaña nueva). */
function conCambios(ruta: string, sp: Busqueda, cambios: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp ?? {})) {
    const valor = uno(v);
    if (valor) q.set(k, valor);
  }
  for (const [k, v] of Object.entries(cambios)) q.set(k, v);
  return `${ruta}?${q}`;
}

/** Mientras llega una pestaña que no se abrió al cargar, con la forma de lo suyo. */
function Espera({ clave }: { clave: string }) {
  if (clave === "inicio") {
    return (
      <div className="space-y-8" aria-busy="true">
        <IndicadoresSkeleton n={3} />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  if (clave === "presupuesto") {
    return (
      <div>
        <CabeceraPestana />
        <EjecucionPresupuestalSkeleton />
      </div>
    );
  }
  const forma: Record<string, { cifras?: number; columna: string }> = {
    contratos: { columna: "Contrato" },
    personas: { cifras: 4, columna: "Persona" },
    planilla: { cifras: 4, columna: "Persona" },
    plazas: { cifras: 4, columna: "Plaza" },
    control: { cifras: 4, columna: "Informe" },
  };
  return <EsqueletoPestana {...(forma[clave] ?? { columna: "Detalle" })} />;
}

/** Los informes de la Contraloría de la entidad, para su pestaña (las páginas siguientes las pide la tabla). */
async function InformesEntidad({ ruc }: { ruc: string }) {
  const datos = await getCorrupcionEntidad(ruc);
  return <InformesContraloria datos={datos} ruta={rutaCorrupcion.entidad(ruc)} ambito="entidad" conTitulo={false} />;
}

// ─── Las ⓘ de las pestañas (las usa también su versión vacía) ─────────────────

function AyudaPersonas() {
  return (
    <Ayuda titulo="¿Quiénes son?">
      <span className="block">
        Las personas a las que esta entidad pagó por órdenes de servicio de hasta 8 UIT, sin concurso: asistentes, asesores,
        choferes, profesionales (OECE, CONOSCE). Por privacidad no se muestra su DNI ni su RUC y se tapa un apellido.
      </span>
      <span className="mt-2 block">
        Las señales dicen qué otro registro público coincide con cada una. No prueban un delito ni un parentesco: son motivos
        para revisar.
      </span>
    </Ayuda>
  );
}

function AyudaPlanilla() {
  return (
    <Ayuda titulo="¿De dónde sale la planilla?">
      <span className="block">
        Del Portal de Transparencia Estándar de la entidad, rubro Personal: cada mes publica a quienes trabajan en ella (CAS,
        276, 728, funcionarios), con su cargo, su oficina y lo que cobran. No trae DNI: los cruces son por nombre completo. Se
        tapa un apellido.
      </span>
      <span className="mt-2 block">Las señales no prueban un delito ni un parentesco: son motivos para revisar.</span>
    </Ayuda>
  );
}

function AyudaPlazas() {
  return (
    <Ayuda titulo="¿De dónde salen las plazas?">
      De SERVIR Talento Perú: las convocatorias CAS que la entidad publicó, con sus requisitos y su sueldo. Las señales marcan
      rasgos de una plaza hecha a la medida de alguien; no prueban un direccionamiento.
    </Ayuda>
  );
}

function AyudaControl() {
  return (
    <Ayuda titulo="¿Qué es un informe de control?">
      La Contraloría revisa a las entidades y, cuando encuentra algo, señala una responsabilidad presunta (penal, civil o
      administrativa) de sus funcionarios y la deriva a quien corresponde. No es una condena. El informe nombra a los
      funcionarios: aquí se enlaza, no se copia.
    </Ayuda>
  );
}

// ─── Las cifras del Inicio ───────────────────────────────────────────────────

/** El último año del MEF con datos propios (sin el que repite al anterior). */
function ultimoAnio(mef: { by_year?: MefBudgetRow[] | null; kind?: string } | null | undefined): MefBudgetRow | null {
  if (!mef || mef.kind !== "ok" || !mef.by_year?.length) return null;
  const { years } = sinAnioRepetido(mef.by_year.map((r) => ({ ...r, pia: Number(r.pia), pim: Number(r.pim), devengado: Number(r.devengado), girado: Number(r.girado) })));
  // El último con presupuesto vigente: el año que una unidad que se cierra trae sólo con el PIA (PIM 0) no lo es.
  return years[ultimoConPim(years)] ?? null;
}

/**
 * Hasta cuatro cifras, cada una con su fuente dicha en su nombre: sus contratos desde 2015 (y lo leído y el riesgo, del
 * mismo resumen que la lista), los antecedentes de los ganadores, sus órdenes (cuando están contadas) y su presupuesto.
 */
function indicadores({
  resumen,
  totalContratos,
  enCola,
  mef,
  ordenes,
  ordenesMonto,
  ruta,
}: {
  resumen: ResumenContratos | null;
  totalContratos: number;
  enCola: number;
  mef: { by_year?: MefBudgetRow[] | null; kind?: string; keyword?: string | null; origen?: string | null } | null;
  ordenes: number | null;
  ordenesMonto: number | null;
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
      // Sin contratos no lleva a una lista vacía.
      href: totalContratos === 0 ? undefined : leidos > 0 ? `${ruta}?seccion=contratos&lectura=publicado` : `${ruta}?seccion=contratos&vista=contratos`,
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
    // Sus órdenes de compra y de servicio, sólo contadas (migración 148): «1 contrato desde 2015» decía poco de una
    // universidad con 124 órdenes en el año.
    ...(ordenes
      ? [
          {
            valor: numero(ordenes),
            etiqueta: ordenes === 1 ? "orden de compra o de servicio" : "órdenes de compra y de servicio",
            contexto: ordenesMonto ? `por ${solesCompacto(ordenesMonto)} desde 2018 (CONOSCE)` : "desde 2018 (CONOSCE)",
            href: `${ruta}?seccion=contratos&vista=ordenes`,
          },
        ]
      : []),
    // Sin presupuesto del MEF no hay tarjeta (una que sólo diga «Sin dato» no informa): lo dice la pestaña Cuánto gasta.
    ...(anio
      ? [
          {
            valor: solesCompacto(anio.pim),
            etiqueta: `presupuesto ${anio.year}${deTodoElGobierno ? " del gobierno regional" : ""}`,
            // Las empresas municipales (ETE, migración 152) reportan un solo monto ejecutado, no un devengado.
            contexto: anio.pim > 0 ? `${porcentaje(ejecucionPct(anio), { decimales: 0 })} ${mef?.origen === "etes" ? "ya ejecutado" : "ya gastado (devengado)"}` : undefined,
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
