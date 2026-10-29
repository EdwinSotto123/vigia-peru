import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import {
  Ban,
  Briefcase,
  Building2,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  FileSearch,
  HandCoins,
  HardHat,
  Hash,
  History,
  LayoutDashboard,
  MapPin,
  Package,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Ayuda, AyudaTermino, BanderasFicha, CabeceraPestana, EncabezadoPagina, FichaNoLeida, Migas, Pagina, Pestanas, Seccion, TarjetaDatos, type BanderaFicha, type DatoClave } from "@/components/patrones";
import { migasConDesde, leerDesde } from "@/lib/desde";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { Indicadores, Listado, TablaSkeleton, ZonaResultados, type Indicador, type Parametros } from "@/components/listado";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { AniosEmpresa } from "@/components/empresas/AniosEmpresa";
import { HistoriaFicha } from "@/components/historia/HistoriaFicha";
import { SeguirBoton } from "@/components/cuenta/SeguirBoton";
import { Cargando } from "@/components/patrones";
import { ResumenAntecedentes } from "@/components/empresas/ResumenAntecedentes";
import { ClientesPrincipales, ComoGana, DondeVende, QuienLeGana, SusDatos } from "@/components/empresas/InicioEmpresa";
import { AntecedentesEmpresa, BANDERAS_CONTRATO, BarraContratos, BarraContratosConConteos, BarraOrdenes, BarraOrdenesConConteos, BarraPostulaciones, BarraPostulacionesConConteos, P_ANTECEDENTES, ClientesEmpresa, ContratosEmpresa, OrdenesEmpresa, P_CONTRATOS, P_ORDENES, P_POSTULACIONES, PostulacionesEmpresa, SociosEmpresa, VisitasEmpresa } from "@/components/empresas/SeccionesEmpresa";
import { conAnio } from "@/components/empresas/secciones/comun";
import { fechaCorta, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  OBJETOS,
  OBJETO_TEXTO,
  PESTANAS_EMPRESA,
  P_VISTA,
  SECCIONES_VIEJAS,
  VISTAS_GENTE,
  VISTAS_VENTAS,
  destinoEmpresa,
  esRucEmpresa,
  getAntecedentesEmpresa,
  getClientesEmpresa,
  getContratosEmpresa,
  getFichaEmpresa,
  getOrdenesEmpresa,
  getPostulacionesEmpresa,
  getSociosEmpresa,
  getVisitasEmpresa,
  nombreCortoEmpresa,
  parametrosSeccion,
  rutaEmpresa,
  type FichaEmpresa,
  type PestanaEmpresa,
  type SeccionEmpresa,
} from "@/lib/empresas";
import { getMenores, parseMenoresQuery, P_MEN } from "@/lib/menores";
import { ListaMenores, BarraMenoresGeneral } from "@/components/menores/ListaMenores";
import { ObrasEmpresa, obrasDeEmpresa } from "@/components/obras/ObrasEmpresa";
import { uno } from "@/lib/utils";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { ruc: string } }): Promise<Metadata> {
  const f = await getFichaEmpresa(params.ruc);
  return { title: f ? `${f.empresa.nombre}, empresa` : "Empresa" };
}

type Busqueda = Record<string, string | string[] | undefined> | undefined;

const TAM = 20;
const texto = (v: string | string[] | undefined) => {
  const t = uno(v)?.slice(0, 80);
  return t && t.length >= 2 ? t : undefined;
};
const anio = (v: string | string[] | undefined) => {
  const n = Number(uno(v));
  return n >= 2015 && n <= 2100 ? n : undefined;
};
const pagina = (v: string | string[] | undefined) => Math.max(1, Number(uno(v)) || 1);
/** Las listas llevan su pestaña y su vista en `parametros`: no hace falta leerlas de la URL viva al filtrar. */
const SIN_CONSERVAR: string[] = [];
/** El nombre de cada pestaña en la ruta de navegación (la primera, Inicio, no se agrega). */
const ETIQUETAS_PESTANA: Record<string, string> = { historia: "Historia", ventas: "Ventas al Estado", clientes: "Clientes", postulaciones: "Postulaciones", antecedentes: "Antecedentes", gente: "Su gente", obras: "Obras" };
/** Los parámetros de la URL menos la pestaña y la vista (para llevar un enlace viejo a la pestaña nueva sin perder filtros). */
const sinSeccion = (sp: Busqueda): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(sp ?? {}).filter(([k]) => k !== "seccion" && k !== P_VISTA).map(([k, v]) => [k, uno(v)]));

/**
 * /empresa/[RUC] — una empresa que le vende al Estado (migración 109). Seis pestañas (?seccion=), las listas largas
 * agrupadas en vistas (?vista=) desde 2026-10-26 (eran nueve pestañas y a 1366 px «Visitas» quedaba fuera):
 *   · Inicio: sus cifras, lo que dicen de ella otros registros (por tipo), sus ventas al Estado año por año, cómo y
 *     dónde gana, sus clientes y quién le gana; en la columna lateral, sus datos (SUNAT y RNP).
 *   · Ventas al Estado: Contratos (los procesos que ganó, sola o en consorcio, con banderas por fila), Órdenes (de compra
 *     y de servicio) y Contratos menores (≤8 UIT).
 *   · Clientes: las entidades que le adjudicaron o le compraron.
 *   · Postulaciones: los procesos en que fue postor y quién ganó.
 *   · Antecedentes: cada cruce con su fuente (sanciones, penalidades, campañas, autoridades, visitas…), numerados.
 *   · Su gente: Socios y vínculos (su gente en el RNP y las empresas vinculadas) y Visitas (de su gente a entidades
 *     públicas, y si después la entidad le dio algo).
 * Los enlaces de antes (`?seccion=contratos`, `ordenes`, `menores`, `socios`, `visitas`) se redirigen a su pestaña y vista.
 */
export default async function EmpresaPage({ params, searchParams: sp }: { params: { ruc: string }; searchParams?: Busqueda }) {
  if (!esRucEmpresa(params.ruc)) notFound();
  const pedida = uno(sp?.seccion);
  const vieja = SECCIONES_VIEJAS.find((s) => s === pedida);
  if (vieja) redirect(rutaEmpresa(params.ruc, vieja, sinSeccion(sp)));
  // Sus obras de INFOBRAS (migración 160): se piden ya, a la vez que la ficha; la pestaña va sólo si tiene alguna.
  const obras = obrasDeEmpresa(params.ruc, sp);
  const f = await getFichaEmpresa(params.ruc);
  if (!f) return <NoSePudoLeer ruc={params.ruc} />;
  const e = f.empresa;
  if (e.soloMenores) return <FichaSoloMenores ruc={params.ruc} e={e} sp={sp} />;
  const ruta = rutaEmpresa(e.ruc);
  const desde = leerDesde(sp);
  // «RAZÓN SOCIAL - NOMBRE CORTO»: el corto de título y la razón social completa en la línea de identidad.
  const corto = nombreCortoEmpresa(e.nombre);
  const nombre = corto?.corto ?? e.nombre;

  // Los filtros de cada lista, validados como la API (lo que no vale, se ignora).
  const de = <T extends string>(v: string | string[] | undefined, validos: readonly T[]) => (validos.includes(uno(v) as T) ? (uno(v) as T) : undefined);
  const ruc11 = (v: string | string[] | undefined) => (/^\d{11}$/.test(uno(v) ?? "") ? uno(v) : undefined);
  const corta = (v: string | string[] | undefined) => uno(v)?.slice(0, 60);
  const fc = {
    q: texto(sp?.[P_CONTRATOS.q]), anio: anio(sp?.[P_CONTRATOS.anio]), como: de(sp?.[P_CONTRATOS.como], ["sola", "consorcio"] as const),
    entidad: ruc11(sp?.[P_CONTRATOS.entidad]), objeto: de(sp?.[P_CONTRATOS.objeto], OBJETOS), familia: corta(sp?.[P_CONTRATOS.familia]),
    departamento: corta(sp?.[P_CONTRATOS.departamento]),
    bandera: de(sp?.[P_CONTRATOS.bandera], BANDERAS_CONTRATO),
    dudoso: uno(sp?.[P_CONTRATOS.dudoso]) === "si" ? "si" : undefined,
    cruce: uno(sp?.[P_CONTRATOS.cruce])?.match(/^[a-z_]{2,40}$/)?.[0],
    orden: de(sp?.[P_CONTRATOS.orden], ["reciente", "antiguo", "monto", "monto_asc"] as const),
    page: pagina(sp?.[P_CONTRATOS.page]),
  };
  const fo = {
    q: texto(sp?.[P_ORDENES.q]), anio: anio(sp?.[P_ORDENES.anio]), tipo: de(sp?.[P_ORDENES.tipo], ["compra", "servicio"] as const),
    dudosa: uno(sp?.[P_ORDENES.dudosa]) === "si" ? "si" : undefined, entidad: ruc11(sp?.[P_ORDENES.entidad]),
    departamento: corta(sp?.[P_ORDENES.departamento]), estado: de(sp?.[P_ORDENES.estado], ["Emitida", "Comprometida", "Devengada"] as const),
    orden: de(sp?.[P_ORDENES.orden], ["reciente", "antiguo", "monto", "monto_asc"] as const),
    page: pagina(sp?.[P_ORDENES.page]),
  };
  const fp = {
    q: texto(sp?.[P_POSTULACIONES.q]), resultado: de(sp?.[P_POSTULACIONES.resultado], ["gano", "perdio", "sin"] as const),
    anio: anio(sp?.[P_POSTULACIONES.anio]), objeto: de(sp?.[P_POSTULACIONES.objeto], OBJETOS), entidad: ruc11(sp?.[P_POSTULACIONES.entidad]),
    ganador: /^20\d{9}$/.test(uno(sp?.[P_POSTULACIONES.ganador]) ?? "") ? uno(sp?.[P_POSTULACIONES.ganador]) : undefined,
    orden: de(sp?.[P_POSTULACIONES.orden], ["reciente", "antiguo", "monto"] as const),
    page: pagina(sp?.[P_POSTULACIONES.page]),
  };
  const fa = { tipo: uno(sp?.[P_ANTECEDENTES.tipo])?.match(/^[a-z_]{2,40}$/)?.[0], gravedad: de(sp?.[P_ANTECEDENTES.gravedad], ["alta", "media", "baja"] as const) };
  // Contratos menores (≤8 UIT) que ganó: se filtran por su RUC de proveedor (no por URL), con los filtros «m» propios.
  const fm = { ...parseMenoresQuery(sp), entidad: undefined, proveedor: undefined };
  // Los filtros puestos de cada lista, con los nombres de P_* (sin la página).
  const filtros = <K extends string>(P: Record<K, string>, v: Partial<Record<K, string | number | undefined>>): Parametros => {
    const out: Parametros = {};
    for (const k of Object.keys(P) as K[]) if (k !== ("page" as K) && v[k] != null) out[P[k]] = String(v[k]);
    return out;
  };
  const fC = filtros(P_CONTRATOS, fc);
  const fO = filtros(P_ORDENES, fo);
  const fP = filtros(P_POSTULACIONES, fp);
  const fA = filtros(P_ANTECEDENTES, fa);
  const fM = filtros(P_MEN, fm as Partial<Record<keyof typeof P_MEN, string | number | undefined>>);
  // Lo que conserva cada lista en sus enlaces (filtrar, paginar): su pestaña y su vista, sus filtros y de dónde vino.
  const lista = (s: SeccionEmpresa, propios: Parametros): Parametros => ({ ...(desde ? { desde } : {}), ...parametrosSeccion(s), ...propios });
  const pc = lista("contratos", fC);
  const po = lista("ordenes", fO);
  const pp = lista("postulaciones", fP);
  const pa = lista("antecedentes", fA);
  const pm = lista("menores", fM);

  // La pestaña y la vista abiertas: las de la URL; sin `seccion`, la lista que traiga filtros (un enlace armado a mano).
  const hay = (p: Parametros, pag: number) => Object.keys(p).length > 0 || pag > 1;
  const inferida: SeccionEmpresa | undefined =
    hay(fC, fc.page) ? "contratos" : hay(fO, fo.page) ? "ordenes" : hay(fP, fp.page) ? "postulaciones"
      : hay(fM, fm.page ?? 1) ? "menores" : hay(fA, 1) ? "antecedentes" : undefined;
  const valida = PESTANAS_EMPRESA.find((s) => s === pedida);
  const destino: { seccion: PestanaEmpresa; vista?: string } = valida
    ? { seccion: valida, vista: uno(sp?.[P_VISTA]) }
    : inferida ? destinoEmpresa(inferida) : { seccion: "inicio" };
  const seccion = destino.seccion;
  const vistaVentas = (seccion === "ventas" && VISTAS_VENTAS.find((v) => v === destino.vista)) || "contratos";
  const vistaGente = (seccion === "gente" && VISTAS_GENTE.find((v) => v === destino.vista)) || "socios";

  const contratosP = getContratosEmpresa(e.ruc, { ...fc, size: TAM });
  const ordenesP = getOrdenesEmpresa(e.ruc, { ...fo, size: TAM });
  const menoresP = getMenores({ ...fm, proveedor: e.ruc, size: TAM });
  const postulacionesP = getPostulacionesEmpresa(e.ruc, { ...fp, size: TAM });
  const clientesP = getClientesEmpresa(e.ruc);
  const antecedentesP = getAntecedentesEmpresa(e.ruc);
  const sociosP = getSociosEmpresa(e.ruc);
  const visitasP = getVisitasEmpresa(e.ruc);

  const contratos = e.adjProcesos + e.consProcesos;
  const nAntecedentes = e.nAlta + e.nMedia + e.nBaja;
  const personas = e.socios + e.representantes + e.directivos;
  // Sus banderas, fijas bajo el nombre en todas las pestañas: cada antecedente por tipo (lo grave primero) hacia su lista
  // filtrada, y las visitas de su gente a entidades que le pagaron, hacia la lista de visitas (antes sólo una línea al pie
  // de «Sus datos»: «la visita nunca aparece»).
  const banderas: BanderaFicha[] = [
    ...f.antecedentes.map((a) => ({
      tipo: a.tipo, severidad: a.severidad, nombre: a.etiqueta, n: a.n > 1 ? a.n : null,
      href: `${ruta}?seccion=antecedentes&${P_ANTECEDENTES.tipo}=${encodeURIComponent(a.tipo)}`,
    })),
    // Órdenes al borde del tope (migración 207): con alguna entidad, la mitad o más de sus órdenes justo debajo de 8 UIT.
    ...((e.bordeEntidades ?? 0) > 0
      ? [{
          tipo: "al_borde_del_tope", severidad: "media" as const, nombre: "Órdenes al borde del tope", n: e.bordeOrdenes ?? null,
          explica: `Con ${plural(e.bordeEntidades!, "entidad", "entidades")}, la mitad o más de sus órdenes quedaron entre el 95 % y el 100 % del tope de 8 UIT, el monto desde el cual se debe hacer un proceso de selección`,
          href: `${ruta}?seccion=ventas&${P_VISTA}=ordenes&oant=al_borde_del_tope`,
        }]
      : []),
    ...(e.visitasClientes > 0
      ? [{
          tipo: "visitas_clientes", severidad: "media" as const, nombre: "Visitó a sus clientes", n: e.visitasClientes,
          explica: `Su gente registra ${plural(e.visitasClientes, "visita", "visitas")} a entidades que le pagaron (registro de visitas a entidades públicas)`,
          href: `${ruta}?seccion=gente&${P_VISTA}=visitas`,
        }]
      : []),
  ];
  const nObras = await obras.total;

  return (
    <Pagina>
      <Migas
        items={migasConDesde(desde, [
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Empresas", href: "/app/empresas" },
          { etiqueta: nombre, href: ruta },
        ])}
        pestanas={{ primera: "inicio", activa: seccion, etiquetas: ETIQUETAS_PESTANA }}
      />
      <EncabezadoPagina
        titulo={nombre}
        bajada={<Identidad f={f} razonSocial={corto?.razonSocial ?? null} />}
        banderas={banderas.length ? <BanderasFicha etiqueta="Banderas de esta empresa" banderas={banderas} todas={`${ruta}?seccion=antecedentes`} /> : undefined}
        acciones={<SeguirBoton tipo="empresa" id={e.ruc} nombre={nombre} />}
      />

      <Pestanas
        fija
        key={seccion}
        etiqueta={`Secciones de ${nombre}`}
        activa={seccion}
        pestanas={[
          {
            clave: "inicio",
            etiqueta: "Inicio",
            icono: <LayoutDashboard size={15} aria-hidden />,
            contenido: <Inicio f={f} contratos={contratosP} clientes={clientesP} postulaciones={postulacionesP} />,
          },
          {
            // Todo en una línea de tiempo (fase 3 del plan del 2026-10-27): su fundación y su gente, lo que ganó y le
            // ordenaron, sus visitas, la política, las sanciones; y lo que encadenan sus cruces (visitó y ganó…).
            clave: "historia",
            etiqueta: "Historia",
            icono: <History size={15} aria-hidden />,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Cómo se lee su historia?">
                      <span className="block">
                        Cada renglón es una fuente oficial sobre el mismo eje de meses: su fundación (SUNAT) y la gente que entró (RNP,
                        por su papel, sin nombres), lo que ganó y le ordenaron (OECE), sus visitas a entidades, los aportes y campañas
                        de su gente (ONPE, JNE) y las sanciones y penalidades. Las líneas punteadas son las elecciones.
                      </span>
                      <span className="mt-2 block">
                        «Lo que encadenan sus datos» une hechos que ya prueban sus cruces, como una visita a una entidad y la buena pro
                        que ganó allí días después. No prueba un delito: es para revisar.
                      </span>
                    </Ayuda>
                  }
                >
                  Lo que pasó con la empresa mes a mes: lo que ganó, a quién visitó su gente, sus aportes y sus sanciones.
                </CabeceraPestana>
                <Suspense fallback={<Cargando texto="Armando su historia…" />}>
                  <HistoriaFicha tipo="empresa" id={e.ruc} nombre={nombre} vista={uno(sp?.hv)} />
                </Suspense>
              </div>
            ),
          },
          {
            // Contratos, órdenes y contratos menores: tres listas de lo mismo (lo que le pagó el Estado), en vistas.
            clave: "ventas",
            etiqueta: "Ventas al Estado",
            icono: <HandCoins size={15} aria-hidden />,
            contenido: (
              <div>
                <CabeceraPestana>
                  Lo que ganó en procesos de selección <AyudaTermino clave="proceso-seleccion" />, sus órdenes de compra y de servicio y sus
                  contratos menores <AyudaTermino clave="contrato-menor" />.
                </CabeceraPestana>
                <Pestanas
                  variante="segunda"
                  key={vistaVentas}
                  param={P_VISTA}
                  activa={vistaVentas}
                  etiqueta={`Ventas de ${nombre} al Estado`}
                  pestanas={[
                    {
                      clave: "contratos",
                      etiqueta: "Contratos",
                      conteo: contratos,
                      contenido: (
                        <div className="space-y-4">
                          <Listado ruta={ruta} parametros={pc} paramPagina={P_CONTRATOS.page} conservar={SIN_CONSERVAR}>
                            <Suspense fallback={<BarraContratos facetas={null} />}>
                              <BarraContratosConConteos pagina={contratosP} />
                            </Suspense>
                            <ZonaResultados>
                              <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Proceso", ancho: "1fr" }]} filas={8} />}>
                                <ContratosEmpresa pagina={contratosP} ruta={ruta} parametros={pc} actual={fc.page} />
                              </Suspense>
                            </ZonaResultados>
                          </Listado>
                        </div>
                      ),
                    },
                    {
                      clave: "ordenes",
                      etiqueta: "Órdenes",
                      conteo: e.ordN,
                      contenido: (
                        <div className="space-y-4">
                          <Listado ruta={ruta} parametros={po} paramPagina={P_ORDENES.page} conservar={SIN_CONSERVAR}>
                            <Suspense fallback={<BarraOrdenes facetas={null} />}>
                              <BarraOrdenesConConteos pagina={ordenesP} />
                            </Suspense>
                            <ZonaResultados>
                              <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Orden", ancho: "1fr" }]} filas={8} />}>
                                <OrdenesEmpresa pagina={ordenesP} ruta={ruta} parametros={po} actual={fo.page} />
                              </Suspense>
                            </ZonaResultados>
                          </Listado>
                        </div>
                      ),
                    },
                    {
                      clave: "menores",
                      etiqueta: "Contratos menores",
                      contenido: (
                        <div className="space-y-4">
                          <Listado ruta={ruta} parametros={pm} paramPagina={P_MEN.page} conservar={SIN_CONSERVAR}>
                            <Suspense fallback={<div className="min-h-[52px]" />}>
                              <BarraMenoresGeneral pagina={menoresP} />
                            </Suspense>
                            <ZonaResultados>
                              <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Contrato menor", ancho: "1fr" }]} filas={8} />}>
                                <ListaMenores pagina={menoresP} ruta={ruta} parametros={pm} actual={fm.page ?? 1} />
                              </Suspense>
                            </ZonaResultados>
                          </Listado>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            clave: "clientes",
            etiqueta: "Clientes",
            icono: <Building2 size={15} aria-hidden />,
            conteo: e.entidades,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Las entidades que le adjudicaron un proceso o le compraron por órdenes.</CabeceraPestana>
                <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Entidad", ancho: "1fr" }]} filas={8} />}>
                  <ClientesEmpresa datos={clientesP} />
                </Suspense>
              </div>
            ),
          },
          {
            clave: "postulaciones",
            etiqueta: "Postulaciones",
            icono: <ClipboardList size={15} aria-hidden />,
            conteo: e.postulaciones,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Los procesos en que fue postor, sola o en consorcio, y quién ganó cada uno.</CabeceraPestana>
                <Listado ruta={ruta} parametros={pp} paramPagina={P_POSTULACIONES.page} conservar={SIN_CONSERVAR}>
                  <Suspense fallback={<BarraPostulaciones facetas={null} />}>
                    <BarraPostulacionesConConteos pagina={postulacionesP} />
                  </Suspense>
                  <ZonaResultados>
                    <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Proceso", ancho: "1fr" }]} filas={8} />}>
                      <PostulacionesEmpresa pagina={postulacionesP} ruta={ruta} parametros={pp} actual={fp.page} ruc={e.ruc} />
                    </Suspense>
                  </ZonaResultados>
                </Listado>
              </div>
            ),
          },
          {
            clave: "antecedentes",
            etiqueta: "Antecedentes",
            icono: <FileSearch size={15} aria-hidden />,
            conteo: nAntecedentes,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Lo que dicen de la empresa otros registros públicos, de la señal más alta a la más baja, cada uno con su fuente.</CabeceraPestana>
                <Listado ruta={ruta} parametros={pa} paramPagina="apag" conservar={SIN_CONSERVAR}>
                  <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Antecedente", ancho: "1fr" }]} filas={6} />}>
                    <AntecedentesEmpresa datos={antecedentesP} clientes={clientesP} ruc={e.ruc} tipo={fa.tipo} gravedad={fa.gravedad} />
                  </Suspense>
                </Listado>
              </div>
            ),
          },
          {
            // Socios y visitas: las dos listas de la gente de la empresa, en vistas.
            clave: "gente",
            etiqueta: "Su gente",
            icono: <Users size={15} aria-hidden />,
            conteo: personas || null,
            contenido: (
              <div>
                <CabeceraPestana>
                  Quiénes están detrás de la empresa según el RNP <AyudaTermino clave="rnp" />, qué otras empresas comparten a alguno y
                  sus visitas a entidades públicas.
                </CabeceraPestana>
                <Pestanas
                  variante="segunda"
                  key={vistaGente}
                  param={P_VISTA}
                  activa={vistaGente}
                  etiqueta={`La gente de ${nombre}`}
                  pestanas={[
                    {
                      clave: "socios",
                      etiqueta: "Socios y vínculos",
                      conteo: personas || null,
                      contenido: (
                        <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Persona", ancho: "1fr" }]} filas={6} />}>
                          <SociosEmpresa datos={sociosP} ruc={e.ruc} />
                        </Suspense>
                      ),
                    },
                    {
                      clave: "visitas",
                      etiqueta: "Visitas",
                      conteo: e.visitas,
                      contenido: (
                        <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Visita", ancho: "1fr" }]} filas={6} />}>
                          <VisitasEmpresa ruc={params.ruc} datos={visitasP} />
                        </Suspense>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          },
          // Las obras públicas que construye o supervisa (INFOBRAS): hechos, sin puntaje. Sólo si tiene alguna.
          ...(nObras
            ? [{
                clave: "obras",
                etiqueta: "Obras",
                icono: <HardHat size={15} aria-hidden />,
                conteo: nObras,
                contenido: <ObrasEmpresa ruc={e.ruc} ruta={ruta} sp={sp} pagina={obras.pagina} base={lista("obras", {})} />,
              }]
            : []),
        ]}
      />
      <Aviso tono="neutro">
        Los antecedentes no son una acusación ni prueban una falta: dicen qué registros públicos coinciden con la empresa,
        para que alguien lo revise. Un dato con posible error de carga se muestra tal como lo publicó el Estado.
      </Aviso>
    </Pagina>
  );
}

/** Un dato de la línea de identidad con su ícono (como en la ficha de una entidad); `nombre` es lo que oye el lector de pantalla. */
function DatoCabecera({ icono: Icono, nombre, title, children }: { icono: LucideIcon; nombre?: string; title?: string; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={title}>
      <Icono size={14} className="shrink-0 text-mute" {...(nombre ? { role: "img", "aria-label": `${nombre}:` } : { "aria-hidden": true })} />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/**
 * La línea de identidad bajo el nombre (§14.2): su estado ante el Tribunal en un chip, el RUC, la razón social completa
 * (si el título es su nombre corto), dónde y qué vende, y desde cuándo; la ⓘ pegada al último dato (antes quedaba sola en
 * un renglón).
 */
function Identidad({ f, razonSocial }: { f: FichaEmpresa; razonSocial: string | null }) {
  const e = f.empresa;
  const datos: ReactNode[] = [
    <DatoCabecera key="ruc" icono={Hash}>
      RUC <span className="font-mono tabular-nums text-ink" translate="no">{e.ruc}</span>
    </DatoCabecera>,
    // El nombre tal como lo publica el registro, en el `title`: para copiarlo exacto.
    razonSocial && <DatoCabecera key="razon" icono={Briefcase} nombre="Razón social" title={e.nombre}>{razonSocial}</DatoCabecera>,
    e.departamento && <DatoCabecera key="lugar" icono={MapPin}>Vende sobre todo en {tituloNatural(e.departamento)}</DatoCabecera>,
    e.objeto && <DatoCabecera key="objeto" icono={Package} nombre="Lo que más vende">{OBJETO_TEXTO[e.objeto] ?? e.objeto}</DatoCabecera>,
    e.primera && e.ultima && (
      <DatoCabecera key="anios" icono={CalendarRange} nombre="Le vende al Estado">
        {e.primera.slice(0, 4) === e.ultima.slice(0, 4) ? `En ${e.primera.slice(0, 4)}` : `De ${e.primera.slice(0, 4)} a ${e.ultima.slice(0, 4)}`}
      </DatoCabecera>
    ),
  ].filter(Boolean);
  const ultimo = datos.pop();
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {e.inhabilitada && <ChipInhabilitada f={f} />}
      {datos}
      <span className="inline-flex min-w-0 items-center gap-1">
        {ultimo}
        <Ayuda titulo="¿De dónde sale esto?">
          <span className="block">
            Los contratos, las órdenes y las postulaciones, de CONOSCE (OECE) desde 2018. Su gente, del Registro Nacional de
            Proveedores. Los antecedentes, de cruzar su RUC y el documento de su gente con el Tribunal de Contrataciones, las
            penalidades, la ONPE, el JNE y el registro de visitas.
          </span>
          {e.actualizado && <span className="mt-2 block">Actualizado el {fechaCorta(e.actualizado)}.</span>}
        </Ayuda>
      </span>
    </span>
  );
}

/**
 * Su inhabilitación vigente como chip de estado en la línea de identidad, que abre su antecedente (la sanción con su
 * fuente). Antes era un cartel rojo aparte entre el título y las cifras, y la sanción ya figuraba en sus antecedentes y
 * en cada contrato.
 */
function ChipInhabilitada({ f }: { f: FichaEmpresa }) {
  const e = f.empresa;
  const hasta = e.inhabilitada === "temporal" && e.inhabilitadaHasta ? conAnio(e.inhabilitadaHasta) : null;
  const texto = e.inhabilitada === "definitiva" ? "Inhabilitada de forma definitiva" : hasta ? `Inhabilitada hasta el ${hasta}` : "Inhabilitada por el Tribunal";
  const frase =
    e.inhabilitada === "definitiva"
      ? "El Tribunal de Contrataciones del Estado la inhabilitó de forma definitiva: no puede contratar con el Estado."
      : `El Tribunal de Contrataciones del Estado la inhabilitó para contratar con el Estado${hasta ? ` hasta el ${hasta}` : ""}.`;
  // El antecedente de la sanción, si está entre los suyos; si no, la pestaña entera.
  const propio = e.inhabilitada === "definitiva" ? "sancion_definitiva" : "sancion_temporal";
  const tipo = f.antecedentes.find((a) => a.tipo === propio)?.tipo ?? f.antecedentes.find((a) => a.tipo.startsWith("sancion"))?.tipo;
  return (
    <Link
      href={rutaEmpresa(e.ruc, "antecedentes", { [P_ANTECEDENTES.tipo]: tipo })}
      title={frase}
      className="inline-flex min-h-[28px] items-center gap-1.5 rounded-full border border-crimson/30 bg-crimson-soft px-3 text-meta font-semibold text-crimsonTexto transition-colors duration-rapido hover:border-crimson/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2"
    >
      <Ban size={14} className="shrink-0" aria-hidden />
      {texto}
      <span className="sr-only">: ver la sanción con su fuente</span>
      <ChevronRight size={14} className="shrink-0" aria-hidden />
    </Link>
  );
}

function indicadores(f: FichaEmpresa): Indicador[] {
  const e = f.empresa;
  const tasa = e.postulaciones >= 5 ? Math.round((e.ganadas / e.postulaciones) * 100) : null;
  return [
    {
      valor: solesCompacto(e.adjMonto),
      etiqueta: "en contratos que ganó sola",
      contexto: e.consProcesos
        ? `${plural(e.adjProcesos, "proceso", "procesos")}; y ${plural(e.consProcesos, "proceso", "procesos")} en consorcio por ${solesCompacto(e.consMonto)}`
        : plural(e.adjProcesos, "proceso", "procesos"),
      href: rutaEmpresa(e.ruc, "contratos"),
    },
    {
      valor: solesCompacto(e.ordMonto),
      etiqueta: "en órdenes de compra y servicio",
      contexto: plural(e.ordN, "orden", "órdenes"),
      href: rutaEmpresa(e.ruc, "ordenes"),
    },
    { valor: numero(e.entidades), etiqueta: e.entidades === 1 ? "entidad le pagó" : "entidades le pagaron", contexto: "por contratos u órdenes", href: rutaEmpresa(e.ruc, "clientes") },
    {
      valor: e.postulaciones ? numero(e.postulaciones) : "Ninguna",
      etiqueta: "postulaciones",
      contexto: e.postulaciones ? `ganó ${numero(e.ganadas)}${tasa != null ? `, el ${tasa} %` : ""}` : "como postor desde 2018",
      href: rutaEmpresa(e.ruc, "postulaciones"),
    },
  ];
}

/** El "Ver …  ›" de la cabecera de una subsección del Inicio: lleva a la pestaña con el detalle. */
function EnlaceSeccion({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="inline-flex min-h-8 shrink-0 items-center gap-0.5 text-meta font-semibold text-granate underline-offset-4 hover:underline">
      {children} <ChevronRight size={14} aria-hidden />
    </Link>
  );
}

/**
 * La pestaña Inicio (§14.2 y §14.3): las cifras arriba y, debajo, subsecciones en el orden en que se lee una empresa:
 * lo que dicen de ella otros registros → sus ventas al Estado (año por año, cómo y dónde gana, sus clientes, quién le
 * gana); sus datos (SUNAT y RNP) van en la columna lateral desde xl y, más angosto, justo después de los antecedentes.
 * Antes «Sus datos» era una tarjeta con su caja adentro en el centro de la primera pantalla, y las cifras repetían en la
 * cabecera los conteos de las pestañas.
 */
async function Inicio({
  f,
  contratos,
  clientes,
  postulaciones,
}: {
  f: FichaEmpresa;
  contratos: ReturnType<typeof getContratosEmpresa>;
  clientes: ReturnType<typeof getClientesEmpresa>;
  postulaciones: ReturnType<typeof getPostulacionesEmpresa>;
}) {
  const e = f.empresa;
  const registros = f.antecedentes.reduce((t, a) => t + a.n, 0);
  return (
    <div className="space-y-6">
      <Indicadores items={indicadores(f)} />
      {(e.adjDudosos > 0 || e.ordDudosas > 0) && (
        <AvisoDato motivo={e.adjDudosos > 0 ? "adjudicado_20x" : "mayor_100m"} fuente="conosce_ordenes">
          {[
            e.adjDudosos > 0 ? `${plural(e.adjDudosos, "proceso trae", "procesos traen")} ${soles(e.adjMontoDudoso)} adjudicados` : null,
            e.ordDudosas > 0 ? `${plural(e.ordDudosas, "orden trae", "órdenes traen")} ${soles(e.ordMontoDudoso)}` : null,
          ].filter(Boolean).join(", y ")}
          {". No entran en las sumas: están en sus listas, con su bandera."}
        </AvisoDato>
      )}

      {/* Dos columnas desde xl (con la barra lateral del sitio, antes no hay ancho para las dos). En una, el orden del DOM:
          antecedentes → sus datos → sus ventas. */}
      <div className="grid items-start gap-x-6 gap-y-8 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Seccion
          id="registros"
          titulo="Lo que dicen otros registros"
          descripcion={
            f.antecedentes.length
              ? `${plural(f.antecedentes.length, "tipo de registro la nombra", "tipos de registros la nombran")}, ${plural(registros, "vez", "veces")} en total.`
              : undefined
          }
          ayuda={
            <Ayuda titulo="¿Qué es un antecedente?">
              <span className="block">
                Un registro público donde aparece la empresa o su gente: el Tribunal de Contrataciones, las penalidades, la ONPE,
                el JNE, la SUNAT, CONOSCE. No es una acusación ni prueba una falta: dice qué revisar.
              </span>
              <span className="mt-2 block">La severidad (señal alta, media o baja) dice qué tan urgente es mirarlo.</span>
            </Ayuda>
          }
          className="min-w-0 xl:col-start-1 xl:row-start-1"
        >
          <ResumenAntecedentes antecedentes={f.antecedentes} ruc={e.ruc} />
        </Seccion>

        <Seccion id="datos" titulo="Sus datos" className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <SusDatos e={e} />
        </Seccion>

        <Seccion
          id="ventas-resumen"
          titulo="Sus ventas al Estado"
          acciones={<EnlaceSeccion href={rutaEmpresa(e.ruc, "ventas")}>Ver contratos y órdenes</EnlaceSeccion>}
          className="min-w-0 xl:col-start-1 xl:row-start-2"
        >
          <div className="space-y-4">
            <AniosEmpresa anual={f.anual} nombre={e.nombre} />
            {/* Dos columnas que miden lo suyo (cómo y dónde gana; quién le paga y quién le gana): en una rejilla 2×2 de
                alturas iguales, «Dónde gana» con dos filas dejaba 150-200 px vacíos. Por el ancho de la columna, no de la
                pantalla: al lado de «Sus datos» es más angosta. */}
            <div className="[container-type:inline-size]">
              <div className="grid items-start gap-4 [@container(min-width:36rem)]:grid-cols-2">
                <div className="grid min-w-0 gap-4">
                  <Suspense fallback={<BloqueCargando titulo="Cómo gana" />}><ComoGana pagina={contratos} ruc={e.ruc} /></Suspense>
                  <Suspense fallback={<BloqueCargando titulo="Dónde gana" />}><DondeVende pagina={contratos} ruc={e.ruc} /></Suspense>
                </div>
                <div className="grid min-w-0 gap-4">
                  <Suspense fallback={<BloqueCargando titulo="Sus principales clientes" />}><ClientesPrincipales datos={clientes} ruc={e.ruc} /></Suspense>
                  <Suspense fallback={<BloqueCargando titulo="Quién le gana" />}><QuienLeGana pagina={postulaciones} ruc={e.ruc} /></Suspense>
                </div>
              </div>
            </div>
          </div>
        </Seccion>
      </div>
    </div>
  );
}

function BloqueCargando({ titulo }: { titulo: string }) {
  return (
    <section className="space-y-2 rounded-2xl border border-line bg-paper p-4" aria-busy="true">
      <h3 className="font-display text-bloque font-bold text-ink">{titulo}</h3>
      <div className="h-24 animate-pulse rounded-xl bg-paperDeep" />
    </section>
  );
}

function NoSePudoLeer({ ruc }: { ruc: string }) {
  return (
    <FichaNoLeida
      migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Empresas", href: "/app/empresas" }]}
      titulo={`RUC ${ruc}`}
      error="No encontramos esta empresa"
      reintentar={{ href: `/app/empresas?q=${ruc}`, texto: "Buscarla en Empresas" }}
    >
      Puede que no le haya vendido al Estado desde 2018, que no haya postulado a ningún proceso, o que el servidor no
      respondiera. No mostramos nada en su lugar.
    </FichaNoLeida>
  );
}

// Ficha REDUCIDA: empresa jurídica que solo aparece en contratos menores (no está en empresa_resumen). Muestra su
// identidad SUNAT y sus menores; las demás secciones no existen para ella.
async function FichaSoloMenores({ ruc, e, sp }: { ruc: string; e: FichaEmpresa["empresa"]; sp?: Busqueda }) {
  const ruta = rutaEmpresa(ruc);
  const desde = leerDesde(sp);
  const nombre = tituloNatural(e.nombre ?? `RUC ${ruc}`);
  const fm = { ...parseMenoresQuery(sp), entidad: undefined, proveedor: undefined };
  const pm: Parametros = {};
  for (const [k, key] of Object.entries(P_MEN)) {
    if (k === "page") continue;
    const v = (fm as Record<string, unknown>)[k];
    if (v != null) pm[key] = String(v);
  }
  const menoresP = getMenores({ ...fm, proveedor: ruc, size: 25 });
  const noActivo = e.estadoSunat && e.estadoSunat !== "ACTIVO";
  const identidad: (DatoClave | null)[] = [
    { etiqueta: "RUC", valor: ruc, mono: true },
    e.estadoSunat ? { etiqueta: "Estado", valor: oracion(e.estadoSunat) } : null,
    e.condicionSunat && e.condicionSunat !== "HABIDO" ? { etiqueta: "Condición", valor: oracion(e.condicionSunat) } : null,
    e.actividad ? { etiqueta: "Giro", valor: oracion(e.actividad) } : null,
    e.departamento ? { etiqueta: "Departamento", valor: tituloNatural(e.departamento) } : null,
    e.fechaAlta ? { etiqueta: "Activa desde", valor: fechaCorta(e.fechaAlta), mono: true } : null,
  ];
  const conElEstado: (DatoClave | null)[] = [
    { etiqueta: "Contratos menores", valor: `${numero(e.menores ?? 0)} en ${numero(e.menoresEntidades ?? 0)} entidades` },
    e.menoresMonto != null ? { etiqueta: "Monto en menores", valor: soles(e.menoresMonto), mono: true } : null,
  ];
  return (
    <Pagina className="space-y-5">
      <Migas items={migasConDesde(desde, [{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Empresas", href: "/app/empresas" }, { etiqueta: nombre, href: ruta }])} />
      <EncabezadoPagina
        titulo={nombre}
        acciones={<SeguirBoton tipo="empresa" id={ruc} nombre={nombre} />}
        bajada="Esta empresa solo figura en contratos menores (≤8 UIT); no tiene otra actividad registrada con el Estado en la base de Vigía."
        ayuda={
          <Ayuda titulo="¿Por qué una ficha reducida?">
            <span className="block">Solo aparece ganando compras menores, que no pasan por un proceso de selección. Mostramos su identidad (SUNAT) y sus menores, sin las demás secciones.</span>
          </Ayuda>
        }
      />
      {noActivo && <Aviso tono="neutro">En SUNAT figura con estado {oracion(e.estadoSunat as string)}. Es un indicio para revisión humana, no una acusación.</Aviso>}
      <section className="space-y-3" aria-labelledby="datos-min-titulo">
        <h2 id="datos-min-titulo" className="font-display text-bloque font-bold text-ink">Sus datos</h2>
        {/* Dos tarjetas con su subtítulo (h3) y sus filas sin marco: antes, rótulos en mayúsculas sobre una caja adentro. */}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <TarjetaDatos titulo="En la SUNAT" items={identidad.filter(Boolean) as DatoClave[]} />
          <TarjetaDatos titulo="Con el Estado (compras menores)" items={conElEstado.filter(Boolean) as DatoClave[]} />
        </div>
      </section>
      <Listado ruta={ruta} parametros={pm} paramPagina={P_MEN.page}>
        <Suspense fallback={<div className="min-h-[52px]" />}>
          <BarraMenoresGeneral pagina={menoresP} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Contrato menor", ancho: "1fr" }]} filas={8} />}>
            <ListaMenores pagina={menoresP} ruta={ruta} parametros={pm} actual={fm.page ?? 1} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </Pagina>
  );
}
