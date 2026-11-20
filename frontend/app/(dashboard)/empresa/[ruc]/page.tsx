import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { EnObservacionFicha } from "@/components/investigar/EnObservacionFicha";
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
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Ayuda, AyudaTermino, BanderasFicha, CabeceraPestana, EncabezadoPagina, FichaNoLeida, Migas, Nota, Pagina, PestanaAPedido, Pestanas, Seccion, TarjetaDatos, type BanderaFicha, type DatoClave } from "@/components/patrones";
import { EsqueletoPestana } from "@/components/entidad/PestanasEntidad";
import { migasConDesde, leerDesde } from "@/lib/desde";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { Listado, TablaSkeleton, ZonaResultados, type Parametros } from "@/components/listado";
import { FUENTE_DUDOSO, MOTIVO_DUDOSO, QUIEN_CARGA } from "@/lib/datoDudoso";
import { PanelVentas } from "@/components/empresas/PanelVentas";
import { HistoriaFicha } from "@/components/historia/HistoriaFicha";
import { SeguirBoton } from "@/components/cuenta/SeguirBoton";
import { Cargando, EstadoVacio } from "@/components/patrones";
import { ClientesPrincipales, ComoGana, DondeVende, QuienLeGana, SusDatos } from "@/components/empresas/InicioEmpresa";
import { AntecedentesEmpresa, BANDERAS_CONTRATO, BarraPostulaciones, BarraPostulacionesConConteos, P_ANTECEDENTES, ClientesEmpresa, P_CONTRATOS, P_ORDENES, P_POSTULACIONES, PostulacionesEmpresa, SociosEmpresa, VisitasEmpresa } from "@/components/empresas/SeccionesEmpresa";
import { conAnio } from "@/components/empresas/secciones/comun";
import { RedEmpresa } from "@/components/empresas/secciones/red";
import { TribunalEmpresa } from "@/components/empresas/TribunalEmpresa";
import { fechaCorta, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { absoluta, canonica, descripcion } from "@/lib/seo";
import { DatosEstructurados } from "@/components/seo/DatosEstructurados";
import { tituloNatural } from "@/lib/landing";
import {
  OBJETOS,
  OBJETO_TEXTO,
  PESTANAS_EMPRESA,
  P_VISTA,
  SECCIONES_VIEJAS,
  VISTAS_GENTE,
  destinoEmpresa,
  esRucEmpresa,
  getAntecedentesEmpresa,
  getClientesEmpresa,
  getContratosEmpresa,
  getFichaEmpresa,
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
import { parseCatalogoQuery, P_CAT } from "@/lib/catalogo";
import { P_COMPRAS, getCompras, parametrosCompras, parseCompras } from "@/lib/compras";
import { BarraCompras, ListaCompras, ListaComprasCargando } from "@/components/compras/ListaCompras";
import { ObrasEmpresa, obrasDeEmpresa } from "@/components/obras/ObrasEmpresa";
import { uno } from "@/lib/utils";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { ruc: string } }): Promise<Metadata> {
  const f = await getFichaEmpresa(params.ruc);
  if (!f) return { title: "Empresa" };
  const e = f.empresa;
  return {
    title: `${e.nombre}, empresa`,
    description: descripcion([
      `${e.nombre} (RUC ${e.ruc}):`,
      e.adjProcesos > 0 ? `${plural(e.adjProcesos, "proceso ganado", "procesos ganados")} con el Estado peruano.` : null,
      // `entidades`: las distintas que le adjudicaron o le compraron (migración 109), no sólo las de esos procesos.
      e.entidades > 0 ? `${plural(e.entidades, "entidad le adjudicó o le compró", "entidades le adjudicaron o le compraron")}.` : null,
      "Sus contratos, órdenes de compra, socios y antecedentes, con la fuente oficial de cada dato.",
    ]),
    alternates: canonica(`/empresa/${e.ruc}`),
  };
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

/** Sin ninguna venta al Estado (y sin filtros): lo dice la ficha. */
const SIN_VENTAS = (
  <EstadoVacio compacto conLlamita={false} titulo="No registra ventas al Estado">
    Ni procesos ganados, ni órdenes del SEACE, ni ventas por catálogo o contratos menores con este RUC.
  </EstadoVacio>
);
/** El nombre de cada pestaña en la ruta de navegación (la primera, Inicio, no se agrega). */
const ETIQUETAS_PESTANA: Record<string, string> = { historia: "Historia", ventas: "Ventas al Estado", clientes: "Clientes", postulaciones: "Postulaciones", antecedentes: "Antecedentes y patrones", gente: "Su gente", obras: "Obras" };
/** Los parámetros de la URL menos la pestaña y la vista (para llevar un enlace viejo a la pestaña nueva sin perder filtros). */
const sinSeccion = (sp: Busqueda): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(sp ?? {}).filter(([k]) => k !== "seccion" && k !== P_VISTA).map(([k, v]) => [k, uno(v)]));

/**
 * /empresa/[RUC] — una empresa que le vende al Estado (migración 109). Seis pestañas (?seccion=), las listas largas
 * agrupadas en vistas (?vista=) desde 2026-10-26 (eran nueve pestañas y a 1366 px «Visitas» quedaba fuera):
 *   · Inicio: sus ventas al Estado año por año, cómo y dónde gana, sus clientes y quién le gana; en la columna lateral,
 *     sus datos (SUNAT y RNP). Lo que dicen de ella otros registros va en las banderas de la cabecera (en todas las
 *     pestañas), no repetido aquí.
 *   · Ventas al Estado: Contratos (los procesos que ganó, sola o en consorcio, con banderas por fila), Órdenes (de compra
 *     y de servicio) y Contratos menores (≤8 UIT).
 *   · Clientes: las entidades que le adjudicaron o le compraron.
 *   · Postulaciones: los procesos en que fue postor y quién ganó.
 *   · Antecedentes: cada cruce con su fuente (sanciones, penalidades, campañas, autoridades, visitas…), en lista y
 *     detalle: el índice de tipos a un lado y los casos del elegido (`?atipo=`) al otro.
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
  // Contratos menores (≤8 UIT) que ganó y lo que vendió por los Catálogos (sólo para saber qué pestaña abre un enlace viejo).
  const fm = { ...parseMenoresQuery(sp), entidad: undefined, proveedor: undefined };
  const fcat = parseCatalogoQuery(sp);
  // Sus ventas en una lista (procesos, catálogo, menores y órdenes, cada venta una vez), con los filtros de las cuatro
  // vistas de antes traducidos (lib/compras.ts).
  const fv = parseCompras(sp, "proveedor");
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
  const fK = filtros(P_CAT, fcat as Partial<Record<keyof typeof P_CAT, string | number | undefined>>);
  // Lo que conserva cada lista en sus enlaces (filtrar, paginar): su pestaña y su vista, sus filtros y de dónde vino.
  const lista = (s: SeccionEmpresa, propios: Parametros): Parametros => ({ ...(desde ? { desde } : {}), ...parametrosSeccion(s), ...propios });
  const pp = lista("postulaciones", fP);
  const fV = parametrosCompras(fv);
  const pv = lista("contratos", fV);

  // La pestaña y la vista abiertas: las de la URL; sin `seccion`, la lista que traiga filtros (un enlace armado a mano).
  const hay = (p: Parametros, pag: number) => Object.keys(p).length > 0 || pag > 1;
  const inferida: SeccionEmpresa | undefined =
    hay(fC, fc.page) ? "contratos" : hay(fO, fo.page) ? "ordenes" : hay(fP, fp.page) ? "postulaciones"
      : hay(fM, fm.page ?? 1) ? "menores" : hay(fK, fcat.page ?? 1) ? "catalogo" : hay(fV, fv.page ?? 1) ? "contratos" : hay(fA, 1) ? "antecedentes" : undefined;
  const valida = PESTANAS_EMPRESA.find((s) => s === pedida);
  const destino: { seccion: PestanaEmpresa; vista?: string } = valida
    ? { seccion: valida, vista: uno(sp?.[P_VISTA]) }
    : inferida ? destinoEmpresa(inferida) : { seccion: "inicio" };
  const seccion = destino.seccion;
  const vistaGente = (seccion === "gente" && VISTAS_GENTE.find((v) => v === destino.vista)) || "socios";

  // Sólo lo que pide la pestaña abierta (las demás viajan a pedido, abajo): antes se pedían las cinco listas siempre.
  const abierta = (...s: PestanaEmpresa[]) => s.includes(seccion);
  const contratosP = abierta("inicio") ? getContratosEmpresa(e.ruc, { ...fc, size: TAM }) : Promise.resolve(null);
  const ventasP = abierta("ventas") ? getCompras({ proveedor: e.ruc }, fv, TAM) : Promise.resolve(null);
  const postulacionesP = abierta("inicio", "postulaciones") ? getPostulacionesEmpresa(e.ruc, { ...fp, size: TAM }) : Promise.resolve(null);
  const clientesP = abierta("inicio", "clientes", "antecedentes") ? getClientesEmpresa(e.ruc) : Promise.resolve(null);
  const antecedentesP = abierta("antecedentes") ? getAntecedentesEmpresa(e.ruc) : Promise.resolve(null);
  // Sólo los pide «Su gente»: abierta en otra pestaña, viaja a pedido (abajo) y no hace falta leerlos.
  const sociosP = seccion === "gente" ? getSociosEmpresa(e.ruc) : Promise.resolve(null);
  const visitasP = seccion === "gente" ? getVisitasEmpresa(e.ruc) : Promise.resolve(null);

  const contratos = e.adjProcesos + e.consProcesos;
  // Las pestañas pesadas no viajan si no están abiertas: se piden al abrirlas (PestanaAPedido). En Cardio Equipos, abierta
  // en Antecedentes, su historia eran 2,5 MB y sus visitas 0,8 MB de los 6 MB de la ficha. Desde el 2026-11-20 TODAS van
  // así: con ventas, clientes, postulaciones y antecedentes a la vez, una empresa con 1 445 antecedentes pasaba los 2,2 MB y
  // el flujo se cortaba («Connection closed»): lo de abajo de la pestaña abierta no llegaba.
  const aPedido = (clave: PestanaEmpresa, columna: string) => (
    <PestanaAPedido clave={clave}>
      <EsqueletoPestana columna={columna} />
    </PestanaAPedido>
  );
  const nAntecedentes = e.nAlta + e.nMedia + e.nBaja;
  // Personas distintas (una con tres papeles cuenta una); sin el dato, la suma de papeles de antes.
  const personas = e.personas ?? e.socios + e.representantes + e.directivos;
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
          // La lista general de órdenes (la de la ficha no tiene ese filtro), de esta empresa y con la bandera en cada fila.
          href: `/app/contratos?vista=ordenes&oprov=${e.ruc}&oant=al_borde_del_tope`,
        }]
      : []),
    // Cobró por catálogo el doble o más de la mediana de la misma ficha ese año (migración 237).
    ...((e.catalogo?.sobreprecio ?? 0) > 0
      ? [{
          tipo: "sobreprecio_catalogo", severidad: "media" as const, nombre: "Cobró el doble en el catálogo", n: e.catalogo!.sobreprecio,
          explica: `En ${plural(e.catalogo!.sobreprecio, "orden", "órdenes")} de los Catálogos de Perú Compras cobró el doble o más de lo que pagaron las demás entidades por el mismo producto ese año: ${soles(e.catalogo!.exceso)} por encima de la mediana. El precio incluye la entrega en el lugar: es un dato para revisar`,
          href: `${ruta}?seccion=ventas&${P_COMPRAS.como}=catalogo&${P_COMPRAS.bandera}=sobreprecio`,
        }]
      : []),
    // En observación (migraciones 364-369): un familiar de quien tiene un puesto de compras en una entidad cliente figura en
    // la empresa, y le vendió a esa entidad con esa persona en el puesto.
    ...((e.comprasFamilia?.casos ?? 0) > 0
      ? [{
          tipo: "compras_familiar", severidad: (e.comprasFamilia!.graves > 0 ? "alta" : "media") as "alta" | "media", observacion: true,
          nombre: "En observación: un familiar de quien trabaja en compras de un cliente figura en la empresa", n: e.comprasFamilia!.casos > 1 ? e.comprasFamilia!.casos : null,
          explica: "Quien tiene un puesto de compras en una entidad que le compra declaró como familiar a un socio, representante o directivo suyo. Cada caso, con sus órdenes, está en «Su gente»",
          href: `${ruta}?seccion=gente#en-observacion`,
        }]
      : []),
    // En observación (migración 367): una autoridad electa dejó de figurar en la empresa y ésta le vendió a su entidad.
    ...((e.exAutoridad?.casos ?? 0) > 0
      ? [{
          tipo: "autoridad_exsocio", severidad: (e.exAutoridad!.graves > 0 ? "alta" : "media") as "alta" | "media", observacion: true,
          nombre: "En observación: una autoridad dejó la empresa y ésta le vendió a su entidad", n: e.exAutoridad!.casos > 1 ? e.exAutoridad!.casos : null,
          explica: "Una autoridad electa dejó de figurar entre sus socios o representantes y la empresa le vendió, durante su periodo, a la entidad que esa autoridad gobierna o fiscaliza. El detalle está en la tarjeta de esa persona",
          href: `${ruta}?seccion=gente`,
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
      <DatosEstructurados
        datos={{ "@context": "https://schema.org", "@type": "Organization", name: e.nombre, taxID: e.ruc, url: absoluta(`/empresa/${e.ruc}`) }}
      />
      <EncabezadoPagina
        titulo={nombre}
        bajada={<Identidad f={f} razonSocial={corto?.razonSocial ?? null} />}
        banderas={banderas.length ? <BanderasFicha etiqueta="Banderas de esta empresa" banderas={banderas} /> : undefined}
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
            contenido: seccion !== "inicio" ? aPedido("inicio", "Dato") : <Inicio f={f} contratos={contratosP} clientes={clientesP} postulaciones={postulacionesP} />,
          },
          {
            // Todo en una línea de tiempo (fase 3 del plan del 2026-10-27): su fundación y su gente, lo que ganó y le
            // ordenaron, sus visitas, la política, las sanciones; y lo que encadenan sus cruces (visitó y ganó…).
            clave: "historia",
            etiqueta: "Historia",
            icono: <History size={15} aria-hidden />,
            contenido: seccion !== "historia" ? aPedido("historia", "Hecho") : (
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
                  Primero lo más grave; después, todo mes a mes: lo que ganó, a quién visitó su gente, sus aportes y sus sanciones.
                </CabeceraPestana>
                <Suspense fallback={<Cargando texto="Armando su historia…" />}>
                  <HistoriaFicha tipo="empresa" id={e.ruc} nombre={nombre} vista={uno(sp?.hv)} />
                </Suspense>
              </div>
            ),
          },
          {
            // Lo que le vendió al Estado en UNA lista, cada venta una vez (GET /compras?proveedor=, migración 240).
            clave: "ventas",
            etiqueta: "Ventas al Estado",
            icono: <HandCoins size={15} aria-hidden />,
            contenido: seccion !== "ventas" ? aPedido("ventas", "Venta") : (
              <div>
                {/* Una línea y una sola ⓘ (pedido del usuario del 2026-11-05): antes, un párrafo suelto con tres ⓘ de glosario
                    que contaba qué entra en la lista; eso va ahora en la ⓘ, con el enlace al glosario. */}
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Qué entra en esta lista?">
                      <span className="block">
                        Lo que ganó en procesos de selección, lo que vendió por los Catálogos Electrónicos de Perú Compras, sus
                        contratos menores (hasta 8 UIT) y sus órdenes de compra o de servicio sin concurso.
                      </span>
                      <span className="mt-2 block">
                        Una venta por catálogo o un contrato menor también tiene su orden en el SEACE: va dentro de esa venta, no aparte.
                      </span>
                      {/* Los términos del tema «Compras del Estado» (proceso de selección, catálogo, contrato menor…). */}
                      <Link
                        href="/glosario?q=compras%20del%20estado"
                        className="mt-2 block text-rotulo font-medium text-ink underline underline-offset-2 hover:text-granate"
                      >
                        Ver el glosario
                      </Link>
                    </Ayuda>
                  }
                >
                  Todo lo que le vendió al Estado, una fila por venta.
                </CabeceraPestana>
                <Listado ruta={ruta} parametros={pv} paramPagina={P_COMPRAS.page} conservar={SIN_CONSERVAR}>
                  <Suspense fallback={<div className="min-h-[52px]" />}>
                    <BarraCompras pagina={ventasP} ancla="proveedor" con={fv.con} />
                  </Suspense>
                  <ZonaResultados>
                    <Suspense fallback={<ListaComprasCargando />}>
                      <ListaCompras pagina={ventasP} ruta={ruta} parametros={pv} actual={fv.page ?? 1} ancla="proveedor" vacia={SIN_VENTAS} />
                    </Suspense>
                  </ZonaResultados>
                </Listado>
              </div>
            ),
          },
          {
            clave: "clientes",
            etiqueta: "Clientes",
            icono: <Building2 size={15} aria-hidden />,
            conteo: e.entidades,
            contenido: seccion !== "clientes" ? aPedido("clientes", "Entidad") : (
              <div className="space-y-4">
                <CabeceraPestana>Las entidades que le adjudicaron un proceso o le compraron por órdenes.</CabeceraPestana>
                <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Entidad", ancho: "1fr" }]} filas={8} />}>
                  <ClientesEmpresa datos={clientesP} ruc={e.ruc} />
                </Suspense>
              </div>
            ),
          },
          {
            clave: "postulaciones",
            etiqueta: "Postulaciones",
            icono: <ClipboardList size={15} aria-hidden />,
            conteo: e.postulaciones,
            contenido: seccion !== "postulaciones" ? aPedido("postulaciones", "Proceso") : (
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
            etiqueta: "Antecedentes y patrones",
            icono: <FileSearch size={15} aria-hidden />,
            conteo: nAntecedentes,
            contenido: seccion !== "antecedentes" ? aPedido("antecedentes", "Antecedente") : (
              <div className="space-y-4">
                <CabeceraPestana>Antecedentes: lo que dicen de la empresa otros registros públicos, caso por caso. Patrones: lo que se repite entre varios de sus contratos.</CabeceraPestana>
                {/* Lista y detalle (pedido del usuario del 2026-11-05): el índice de tipos elige en el navegador y lo deja en
                    `?atipo=` (lo lee de la URL, como las banderas de la cabecera); ya no hay barra de filtros ni `Listado`. */}
                {/* Las apelaciones en que tenía la buena pro y los sancionadores que el Tribunal le ordenó (migración 424). Antes
                    de la lista: con 1 445 antecedentes la página pasa los 2 MB y el flujo se cortaba antes de llegar a lo de abajo. */}
                <Suspense fallback={null}>
                  <TribunalEmpresa ruc={e.ruc} />
                </Suspense>
                <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Antecedente", ancho: "1fr" }]} filas={6} />}>
                  <AntecedentesEmpresa datos={antecedentesP} clientes={clientesP} ruc={e.ruc} tipoAbierto={fa.tipo} />
                </Suspense>
              </div>
            ),
          },
          {
            // Socios y visitas: las dos listas de la gente de la empresa, en vistas.
            clave: "gente",
            etiqueta: "Su gente",
            icono: <Users size={15} aria-hidden />,
            conteo: personas || null,
            contenido: seccion !== "gente" ? aPedido("gente", "Persona") : (
              <div>
                <CabeceraPestana>
                  Sus socios, representantes y directivos según el RNP <AyudaTermino clave="rnp" />, lo que cada uno es en el Estado, las
                  otras empresas que comparten y sus visitas a entidades públicas.
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
                        <div className="space-y-8">
                          <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Persona", ancho: "1fr" }]} filas={6} />}>
                            <SociosEmpresa datos={sociosP} ruc={e.ruc} tipos={f.antecedentes.map((x) => x.tipo)} />
                          </Suspense>
                          {/* En observación (migraciones 364-370): los casos de sus banderas, cada uno con su panel. */}
                          {(e.comprasFamilia?.casos ?? 0) > 0 || (e.exAutoridad?.casos ?? 0) > 0 ? (
                            <Suspense fallback={null}>
                              <EnObservacionFicha
                                ruc={e.ruc}
                                de="empresa"
                                compras={(e.comprasFamilia?.casos ?? 0) > 0}
                                autoridad={(e.exAutoridad?.casos ?? 0) > 0}
                              />
                            </Suspense>
                          ) : null}
                        </div>
                      ),
                    },
                    {
                      // Su gente, las otras empresas de esa gente y sus clientes, en un grafo (2026-11-18).
                      clave: "red",
                      etiqueta: "Red",
                      contenido: (
                        <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Red", ancho: "1fr" }]} filas={6} />}>
                          <RedEmpresa empresa={{ ruc: e.ruc, nombre }} socios={sociosP} clientes={clientesP} />
                        </Suspense>
                      ),
                    },
                    {
                      clave: "visitas",
                      etiqueta: "Visitas",
                      conteo: e.visitas,
                      contenido: (
                        <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Visita", ancho: "1fr" }]} filas={6} />}>
                          <VisitasEmpresa ruc={params.ruc} datos={visitasP} buscar={uno(sp?.vq)} />
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
                contenido: seccion !== "obras" ? aPedido("obras", "Obra") : <ObrasEmpresa ruc={e.ruc} ruta={ruta} sp={sp} pagina={obras.pagina} base={lista("obras", {})} />,
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
    // El lugar lleva a lo que le vendió ahí: sus contratos filtrados por ese departamento o, si sólo tiene órdenes, sus órdenes.
    e.departamento && (
      <DatoCabecera key="lugar" icono={MapPin}>
        Vende sobre todo en{" "}
        <Link
          href={
            e.adjProcesos + e.consProcesos > 0 || !e.ordN
              ? rutaEmpresa(e.ruc, "contratos", { [P_CONTRATOS.departamento]: e.departamento })
              : rutaEmpresa(e.ruc, "ordenes", { [P_ORDENES.departamento]: e.departamento })
          }
          prefetch={false}
          className="text-granate underline-offset-2 hover:underline"
        >
          {tituloNatural(e.departamento)}
        </Link>
      </DatoCabecera>
    ),
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


/** El "Ver …  ›" de la cabecera de una subsección del Inicio: lleva a la pestaña con el detalle. */
function EnlaceSeccion({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="inline-flex min-h-8 shrink-0 items-center gap-0.5 text-meta font-semibold text-granate underline-offset-4 hover:underline">
      {children} <ChevronRight size={14} aria-hidden />
    </Link>
  );
}

/**
 * La pestaña Inicio (§14.2 y §14.3): lo que vendió (cifras y año por año) arriba y, debajo, sus ventas al Estado (cómo y
 * dónde gana, sus clientes, quién le gana) con sus datos (SUNAT y RNP) en la columna lateral desde xl.
 *
 * Sin «Lo que dicen otros registros» (pedido del usuario del 2026-11-05: «ocupan mucho espacio para la información que
 * dan»): repetía, con los mismos tipos y números, las banderas de la cabecera, que ya están en todas las pestañas y
 * llevan a cada antecedente. Antes, además, «Sus datos» era una tarjeta con su caja adentro en el centro de la primera
 * pantalla, y las cifras repetían en la cabecera los conteos de las pestañas.
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
  const dudosos = [
    e.adjDudosos > 0 ? `${plural(e.adjDudosos, "proceso trae", "procesos traen")} ${soles(e.adjMontoDudoso)} adjudicados` : null,
    e.ordDudosas > 0 ? `${plural(e.ordDudosas, "orden trae", "órdenes traen")} ${soles(e.ordMontoDudoso)}` : null,
  ].filter((x): x is string => !!x);
  return (
    <div className="space-y-6">
      <PanelVentas f={f} />
      {dudosos.length > 0 && (
        // Una línea y no la caja amarilla de antes (pedido del usuario del 2026-11-05): repetía el ▲ de la leyenda del
        // gráfico. Aquí sólo lo que la leyenda no dice: cuánto queda fuera y dónde está; el porqué, en su ⓘ.
        <Nota icono={<TriangleAlert size={15} className="text-amberTexto" aria-hidden />}>
          {`Puede ser un error ${QUIEN_CARGA.conosce_ordenes}: ${dudosos.join(" y ")}. No entran en las sumas ni en el gráfico (▲); están en sus listas, con su bandera.`}{" "}
          <Ayuda titulo="¿Por qué quedan fuera?">
            {e.adjDudosos > 0 && <span className="block">{MOTIVO_DUDOSO.adjudicado_20x.explica}</span>}
            {e.ordDudosas > 0 && <span className="mt-1 block">{MOTIVO_DUDOSO.mayor_100m.explica}</span>}
            <span className="mt-2 block">
              Vigía no borra ni cambia el dato: lo muestra tal como lo publicó {FUENTE_DUDOSO.conosce_ordenes}, aparte de los
              totales y de las comparaciones, para que un posible error no infle las cifras.
            </span>
          </Ayuda>
        </Nota>
      )}

      {/* Dos columnas desde xl (con la barra lateral del sitio, antes no hay ancho para las dos): sus ventas y, al lado, sus
          datos. En una, el orden del DOM: sus ventas (siguen al panel de arriba) → sus datos. */}
      <div className="grid items-start gap-x-6 gap-y-8 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Seccion
          id="ventas-resumen"
          titulo="Sus ventas al Estado"
          acciones={<EnlaceSeccion href={rutaEmpresa(e.ruc, "ventas")}>Ver contratos y órdenes</EnlaceSeccion>}
          className="min-w-0 xl:col-start-1 xl:row-start-1"
        >
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
        </Seccion>

        <Seccion id="datos" titulo="Sus datos" className="min-w-0 xl:col-start-2 xl:row-start-1">
          <SusDatos e={e} />
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
