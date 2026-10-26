import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BadgeCheck, Ban, CalendarRange, MapPin, Package } from "lucide-react";
import { Ayuda, AyudaTermino, CabeceraPestana, DatosClave, EncabezadoPagina, FichaNoLeida, Migas, Pagina, Pestanas, type DatoClave } from "@/components/patrones";
import { migasConDesde, leerDesde } from "@/lib/desde";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { Indicadores, Listado, TablaSkeleton, ZonaResultados, type Indicador, type Parametros } from "@/components/listado";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { AniosEmpresa } from "@/components/empresas/AniosEmpresa";
import { ResumenAntecedentes } from "@/components/empresas/ResumenAntecedentes";
import { ClientesPrincipales, ComoGana, DondeVende, QuienLeGana } from "@/components/empresas/InicioEmpresa";
import { AntecedentesEmpresa, BarraContratos, BarraContratosConConteos, BarraOrdenes, BarraOrdenesConConteos, BarraPostulaciones, BarraPostulacionesConConteos, P_ANTECEDENTES, ClientesEmpresa, ContratosEmpresa, OrdenesEmpresa, P_CONTRATOS, P_ORDENES, P_POSTULACIONES, PostulacionesEmpresa, SociosEmpresa, VisitasEmpresa } from "@/components/empresas/SeccionesEmpresa";
import { fecha, fechaCorta, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { OBJETOS, OBJETO_TEXTO, esRucEmpresa, getAntecedentesEmpresa, getClientesEmpresa, getContratosEmpresa, getFichaEmpresa, getOrdenesEmpresa, getPostulacionesEmpresa, getSociosEmpresa, getVisitasEmpresa, rutaEmpresa, type FichaEmpresa } from "@/lib/empresas";
import { getMenores, parseMenoresQuery, P_MEN } from "@/lib/menores";
import { ListaMenores, BarraMenoresGeneral } from "@/components/menores/ListaMenores";
import { uno } from "@/lib/utils";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { ruc: string } }): Promise<Metadata> {
  const f = await getFichaEmpresa(params.ruc);
  return { title: f ? `${f.empresa.nombre}, empresa` : "Empresa" };
}

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

/**
 * /empresa/[RUC] — una empresa que le vende al Estado (migración 109). Pestañas (?seccion=):
 *   · Inicio: lo que dicen de ella otros registros (por tipo), lo que recibió año por año, cómo gana, sus clientes, quién le
 *     gana, dónde gana y sus datos.
 *   · Contratos: los procesos que ganó, sola o en consorcio, con banderas por fila (CONOSCE).
 *   · Órdenes: sus órdenes de compra y de servicio (CONOSCE).
 *   · Clientes: las entidades que le adjudicaron o le compraron.
 *   · Postulaciones: los procesos en que fue postor y quién ganó.
 *   · Antecedentes: cada cruce con su fuente (sanciones, penalidades, campañas, autoridades, visitas…), numerados.
 *   · Socios: su gente en el RNP y las empresas vinculadas.
 *   · Visitas: las visitas registradas de su gente a entidades públicas, y si después la entidad le dio algo.
 */
export default async function EmpresaPage({ params, searchParams: sp }: { params: { ruc: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  if (!esRucEmpresa(params.ruc)) notFound();
  const f = await getFichaEmpresa(params.ruc);
  if (!f) return <NoSePudoLeer ruc={params.ruc} />;
  const e = f.empresa;
  if (e.soloMenores) return <FichaSoloMenores ruc={params.ruc} e={e} sp={sp} />;
  const ruta = rutaEmpresa(e.ruc);
  const desde = leerDesde(sp);

  // Los filtros de cada pestaña, validados como la API (lo que no vale, se ignora).
  const de = <T extends string>(v: string | string[] | undefined, validos: readonly T[]) => (validos.includes(uno(v) as T) ? (uno(v) as T) : undefined);
  const ruc11 = (v: string | string[] | undefined) => (/^\d{11}$/.test(uno(v) ?? "") ? uno(v) : undefined);
  const corto = (v: string | string[] | undefined) => uno(v)?.slice(0, 60);
  const fc = {
    q: texto(sp?.[P_CONTRATOS.q]), anio: anio(sp?.[P_CONTRATOS.anio]), como: de(sp?.[P_CONTRATOS.como], ["sola", "consorcio"] as const),
    entidad: ruc11(sp?.[P_CONTRATOS.entidad]), objeto: de(sp?.[P_CONTRATOS.objeto], OBJETOS), familia: corto(sp?.[P_CONTRATOS.familia]),
    departamento: corto(sp?.[P_CONTRATOS.departamento]),
    bandera: de(sp?.[P_CONTRATOS.bandera], ["inhabilitada", "sancionada_antes", "sancionada_despues", "antecedentes", "dudoso", "sin"] as const),
    cruce: uno(sp?.[P_CONTRATOS.cruce])?.match(/^[a-z_]{2,40}$/)?.[0],
    orden: de(sp?.[P_CONTRATOS.orden], ["reciente", "antiguo", "monto", "monto_asc"] as const),
    page: pagina(sp?.[P_CONTRATOS.page]),
  };
  const fo = {
    q: texto(sp?.[P_ORDENES.q]), anio: anio(sp?.[P_ORDENES.anio]), tipo: de(sp?.[P_ORDENES.tipo], ["compra", "servicio"] as const),
    dudosa: uno(sp?.[P_ORDENES.dudosa]) === "si" ? "si" : undefined, entidad: ruc11(sp?.[P_ORDENES.entidad]),
    departamento: corto(sp?.[P_ORDENES.departamento]), estado: de(sp?.[P_ORDENES.estado], ["Emitida", "Comprometida", "Devengada"] as const),
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
  // Los parámetros que conserva cada lista en sus enlaces (los suyos y la pestaña), con los nombres de P_*.
  const conservar = <K extends string>(seccion: string, P: Record<K, string>, f: Partial<Record<K, string | number | undefined>>): Parametros => {
    const out: Parametros = { seccion };
    for (const k of Object.keys(P) as K[]) if (k !== ("page" as K) && f[k] != null) out[P[k]] = String(f[k]);
    return out;
  };
  // Contratos menores (≤8 UIT) que ganó: se filtran por su RUC de proveedor (no por URL), con los filtros «m» propios.
  const fm = { ...parseMenoresQuery(sp), entidad: undefined, proveedor: undefined };
  const pc = conservar("contratos", P_CONTRATOS, fc);
  const po = conservar("ordenes", P_ORDENES, fo);
  const pp = conservar("postulaciones", P_POSTULACIONES, fp);
  const pa = conservar("antecedentes", P_ANTECEDENTES, fa);
  const pm = conservar("menores", P_MEN, fm as Partial<Record<keyof typeof P_MEN, string | number | undefined>>);
  const algo = (p: Parametros, pag: number) => Object.keys(p).length > 1 || pag > 1;
  const seccion =
    uno(sp?.seccion) ??
    (algo(pc, fc.page) ? "contratos" : algo(po, fo.page) ? "ordenes" : algo(pp, fp.page) ? "postulaciones"
      : algo(pm, fm.page ?? 1) ? "menores" : algo(pa, 1) ? "antecedentes" : undefined);

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

  return (
    <Pagina>
      <Migas
        items={migasConDesde(desde, [
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Empresas", href: "/app/empresas" },
          { etiqueta: e.nombre, href: ruta },
        ])}
        pestanas={{
          primera: "inicio",
          activa: seccion ?? "inicio",
          etiquetas: { contratos: "Contratos", ordenes: "Órdenes", menores: "Menores", clientes: "Clientes", postulaciones: "Postulaciones", antecedentes: "Antecedentes", socios: "Socios", visitas: "Visitas" },
        }}
      />
      <EncabezadoPagina
        titulo={e.nombre}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-mono text-meta tabular-nums">
              <BadgeCheck size={14} className="shrink-0 text-mute" aria-hidden /> RUC {e.ruc}
            </span>
            {e.departamento && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} className="shrink-0 text-mute" aria-hidden /> Vende sobre todo en {tituloNatural(e.departamento)}
              </span>
            )}
            {e.objeto && (
              <span className="inline-flex items-center gap-1.5">
                <Package size={14} className="shrink-0 text-mute" aria-hidden /> {OBJETO_TEXTO[e.objeto] ?? e.objeto}
              </span>
            )}
            {e.primera && e.ultima && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange size={14} className="shrink-0 text-mute" aria-hidden />
                {e.primera.slice(0, 4) === e.ultima.slice(0, 4) ? `En ${e.primera.slice(0, 4)}` : `De ${e.primera.slice(0, 4)} a ${e.ultima.slice(0, 4)}`}
              </span>
            )}
          </span>
        }
        ayuda={
          <Ayuda titulo="¿De dónde sale esto?">
            <span className="block">
              Los contratos, las órdenes y las postulaciones, de CONOSCE (OECE) desde 2018. Su gente, del Registro Nacional de
              Proveedores. Los antecedentes, de cruzar su RUC y el documento de su gente con el Tribunal de Contrataciones, las
              penalidades, la ONPE, el JNE y el registro de visitas.
            </span>
            {f.empresa.actualizado && <span className="mt-2 block">Actualizado el {fechaCorta(f.empresa.actualizado)}.</span>}
          </Ayuda>
        }
      />
      {e.inhabilitada && (
        <p role="note" className="flex items-start gap-2 rounded-xl border border-crimson/25 bg-crimson-soft/60 p-3 text-dato text-crimsonTexto">
          <Ban size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
          {e.inhabilitada === "definitiva"
            ? "El Tribunal de Contrataciones del Estado la inhabilitó de forma definitiva: no puede contratar con el Estado."
            : `El Tribunal de Contrataciones del Estado la inhabilitó para contratar con el Estado${e.inhabilitadaHasta ? ` hasta el ${fechaCorta(e.inhabilitadaHasta)}` : ""}.`}{" "}
          <Link href={`${ruta}?seccion=antecedentes`} className="font-semibold underline-offset-2 hover:underline">Ver la sanción</Link>
          </span>
        </p>
      )}
      <Indicadores items={indicadores(f, ruta)} />
      {(e.adjDudosos > 0 || e.ordDudosas > 0) && (
        <AvisoDato motivo={e.adjDudosos > 0 ? "adjudicado_20x" : "mayor_100m"} fuente="conosce_ordenes">
          {[
            e.adjDudosos > 0 ? `${plural(e.adjDudosos, "proceso trae", "procesos traen")} ${soles(e.adjMontoDudoso)} adjudicados` : null,
            e.ordDudosas > 0 ? `${plural(e.ordDudosas, "orden trae", "órdenes traen")} ${soles(e.ordMontoDudoso)}` : null,
          ].filter(Boolean).join(", y ")}
          {". No entran en las sumas: están en sus listas, con su bandera."}
        </AvisoDato>
      )}

      <Pestanas
        key={seccion ?? "inicio"}
        etiqueta={`Secciones de ${e.nombre}`}
        activa={seccion}
        pestanas={[
          {
            clave: "inicio",
            etiqueta: "Inicio",
            contenido: <Inicio f={f} ruta={ruta} contratos={contratosP} clientes={clientesP} postulaciones={postulacionesP} />,
          },
          {
            clave: "contratos",
            etiqueta: "Contratos",
            conteo: contratos,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Los procesos que ganó, sola o en consorcio, del más reciente al más antiguo.</CabeceraPestana>
                <Listado ruta={ruta} parametros={pc} paramPagina={P_CONTRATOS.page}>
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
                <CabeceraPestana>Sus órdenes de compra y de servicio, sin proceso de selección <AyudaTermino clave="proceso-seleccion" />, de la más reciente a la más antigua.</CabeceraPestana>
                <Listado ruta={ruta} parametros={po} paramPagina={P_ORDENES.page}>
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
            etiqueta: "Menores",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Los contratos menores (≤8 UIT) que ganó, con su requerimiento descargable, del más reciente al más antiguo. <AyudaTermino clave="contrato-menor" /></CabeceraPestana>
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
              </div>
            ),
          },
          {
            clave: "clientes",
            etiqueta: "Clientes",
            conteo: e.entidades,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Las entidades que le adjudicaron o le compraron, de la que más le pagó a la que menos.</CabeceraPestana>
                <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Entidad", ancho: "1fr" }]} filas={8} />}>
                  <ClientesEmpresa datos={clientesP} />
                </Suspense>
              </div>
            ),
          },
          {
            clave: "postulaciones",
            etiqueta: "Postulaciones",
            conteo: e.postulaciones,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Los procesos en que fue postor, sola o en consorcio, y quién ganó cada uno.</CabeceraPestana>
                <Listado ruta={ruta} parametros={pp} paramPagina={P_POSTULACIONES.page}>
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
            conteo: nAntecedentes,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Lo que dicen de la empresa otros registros públicos, de lo más grave a lo más leve, cada uno con su fuente.</CabeceraPestana>
                <Listado ruta={ruta} parametros={pa} paramPagina="apag">
                  <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Antecedente", ancho: "1fr" }]} filas={6} />}>
                    <AntecedentesEmpresa datos={antecedentesP} tipo={fa.tipo} gravedad={fa.gravedad} />
                  </Suspense>
                </Listado>
              </div>
            ),
          },
          {
            clave: "socios",
            etiqueta: "Socios",
            conteo: personas || null,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Quiénes están detrás de la empresa según el RNP y qué otras empresas comparten a alguno.</CabeceraPestana>
                <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Persona", ancho: "1fr" }]} filas={6} />}>
                  <SociosEmpresa datos={sociosP} />
                </Suspense>
              </div>
            ),
          },
          {
            clave: "visitas",
            etiqueta: "Visitas",
            conteo: e.visitas,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Las visitas registradas de su gente a entidades públicas, y si después esa entidad le dio un contrato o una orden.</CabeceraPestana>
                <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Visita", ancho: "1fr" }]} filas={6} />}>
                  <VisitasEmpresa datos={visitasP} />
                </Suspense>
              </div>
            ),
          },
        ]}
      />
      <Aviso tono="neutro">
        Los antecedentes no son una acusación ni prueban una falta: dicen qué registros públicos coinciden con la empresa,
        para que alguien lo revise. Un dato con posible error de carga se muestra tal como lo publicó el Estado.
      </Aviso>
    </Pagina>
  );
}

function indicadores(f: FichaEmpresa, ruta: string): Indicador[] {
  const e = f.empresa;
  const tasa = e.postulaciones >= 5 ? Math.round((e.ganadas / e.postulaciones) * 100) : null;
  return [
    {
      valor: solesCompacto(e.adjMonto),
      etiqueta: "en contratos que ganó sola",
      contexto: e.consProcesos
        ? `${plural(e.adjProcesos, "proceso", "procesos")}; y ${plural(e.consProcesos, "proceso", "procesos")} en consorcio por ${solesCompacto(e.consMonto)}`
        : plural(e.adjProcesos, "proceso", "procesos"),
      href: `${ruta}?seccion=contratos`,
    },
    {
      valor: solesCompacto(e.ordMonto),
      etiqueta: "en órdenes de compra y servicio",
      contexto: plural(e.ordN, "orden", "órdenes"),
      href: `${ruta}?seccion=ordenes`,
    },
    { valor: numero(e.entidades), etiqueta: e.entidades === 1 ? "entidad le pagó" : "entidades le pagaron", contexto: "por contratos u órdenes", href: `${ruta}?seccion=clientes` },
    {
      valor: e.postulaciones ? numero(e.postulaciones) : "Ninguna",
      etiqueta: "postulaciones",
      contexto: e.postulaciones ? `ganó ${numero(e.ganadas)}${tasa != null ? `, el ${tasa} %` : ""}` : "como postor desde 2018",
      href: `${ruta}?seccion=postulaciones`,
    },
  ];
}

async function Inicio({
  f,
  ruta,
  contratos,
  clientes,
  postulaciones,
}: {
  f: FichaEmpresa;
  ruta: string;
  contratos: ReturnType<typeof getContratosEmpresa>;
  clientes: ReturnType<typeof getClientesEmpresa>;
  postulaciones: ReturnType<typeof getPostulacionesEmpresa>;
}) {
  const e = f.empresa;
  const haySunat = !!(e.estadoSunat || e.fechaAlta || e.domicilio || e.actividad);
  const personas = e.socios + e.representantes + e.directivos;
  return (
    <div className="space-y-5">
      <CabeceraPestana>Quién es la empresa, lo que dicen de ella otros registros públicos y lo que recibió del Estado cada año.</CabeceraPestana>

      {/* 1. Sus datos, ARRIBA: la identidad (SUNAT) y quién está detrás (RNP), en dos columnas, cada vínculo navegable. */}
      <section className="space-y-3" aria-labelledby="datos-titulo">
        <h3 id="datos-titulo" className="font-display text-bloque font-bold text-ink">Sus datos</h3>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <article className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <h4 className="text-rotulo font-semibold uppercase tracking-wide text-mute">Identidad en la SUNAT</h4>
            <DatosClave
              items={
                haySunat
                  ? [
                      { etiqueta: "RUC", valor: e.ruc, mono: true },
                      { etiqueta: "Estado", valor: e.estadoSunat },
                      { etiqueta: "Inscrita", valor: e.fechaAlta ? fecha(e.fechaAlta) : null },
                      { etiqueta: "Domicilio fiscal", valor: e.domicilio },
                      { etiqueta: "Actividad", valor: e.actividad },
                    ]
                  : [
                      { etiqueta: "RUC", valor: e.ruc, mono: true },
                      { etiqueta: "Datos de la SUNAT", valor: "Todavía no cargados para esta empresa" },
                    ]
              }
            />
          </article>
          <article className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <h4 className="text-rotulo font-semibold uppercase tracking-wide text-mute">Su gente y sus vínculos</h4>
            <DatosClave
              items={[
                {
                  etiqueta: "Su gente en el RNP",
                  valor: personas ? (
                    <EnlaceDato href={`${ruta}?seccion=socios`}>
                      {[plural(e.socios, "socio", "socios"), plural(e.representantes, "representante", "representantes"), plural(e.directivos, "directivo", "directivos")].join(", ")}
                    </EnlaceDato>
                  ) : "Sin registro en el RNP",
                },
                {
                  etiqueta: "Empresas vinculadas",
                  valor: e.vinculadas ? (
                    <EnlaceDato href={`${ruta}?seccion=socios`}>{`${plural(e.vinculadas, "empresa comparte", "empresas comparten")} socio, representante o directivo`}</EnlaceDato>
                  ) : "Ninguna",
                },
                {
                  etiqueta: "Visitas de su gente",
                  valor: e.visitas ? (
                    <EnlaceDato href={`${ruta}?seccion=visitas`}>{`${plural(e.visitas, "visita", "visitas")}, ${numero(e.visitasClientes)} a entidades que le pagaron`}</EnlaceDato>
                  ) : "Ninguna registrada",
                },
                { etiqueta: "Primera y última venta al Estado", valor: e.primera && e.ultima ? `${fecha(e.primera)} y ${fecha(e.ultima)}` : null },
              ]}
            />
          </article>
        </div>
      </section>

      {/* 2. Lo que dicen otros registros (las banderas), con su enlace a cada fuente. */}
      <section className="space-y-2.5" aria-labelledby="antecedentes-titulo">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="antecedentes-titulo" className="font-display text-bloque font-bold text-ink">Lo que dicen otros registros</h3>
          {f.antecedentes.length > 0 && (
            <Link href={`${ruta}?seccion=antecedentes`} className="text-meta font-semibold text-granate underline-offset-2 hover:underline">
              Ver cada antecedente con su fuente
            </Link>
          )}
        </div>
        <ResumenAntecedentes antecedentes={f.antecedentes} ruta={ruta} />
      </section>

      {/* 3. Lo que recibió del Estado, año por año. */}
      <AniosEmpresa anual={f.anual} nombre={e.nombre} />

      {/* 4. Análisis: cómo gana, sus clientes, quién le gana y dónde. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<BloqueCargando titulo="Cómo gana" />}><ComoGana pagina={contratos} ruta={ruta} /></Suspense>
        <Suspense fallback={<BloqueCargando titulo="Sus principales clientes" />}><ClientesPrincipales datos={clientes} ruta={ruta} /></Suspense>
        <Suspense fallback={<BloqueCargando titulo="Quién le gana" />}><QuienLeGana pagina={postulaciones} ruta={ruta} /></Suspense>
        <Suspense fallback={<BloqueCargando titulo="Dónde gana" />}><DondeVende pagina={contratos} ruta={ruta} /></Suspense>
      </div>
    </div>
  );
}

/** Un valor de «Sus datos» que lleva a su pestaña (socios, visitas): la cifra es navegable, no texto muerto. */
function EnlaceDato({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="font-medium text-granate underline-offset-2 hover:underline">
      {children}
    </Link>
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
async function FichaSoloMenores({ ruc, e, sp }: { ruc: string; e: FichaEmpresa["empresa"]; sp?: Record<string, string | string[] | undefined> }) {
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
        bajada="Esta empresa solo figura en contratos menores (≤8 UIT); no tiene otra actividad registrada con el Estado en la base de Vigía."
        ayuda={
          <Ayuda titulo="¿Por qué una ficha reducida?">
            <span className="block">Solo aparece ganando compras menores, que no pasan por un proceso de selección. Mostramos su identidad (SUNAT) y sus menores, sin las demás secciones.</span>
          </Ayuda>
        }
      />
      {noActivo && <Aviso tono="neutro">En SUNAT figura con estado {oracion(e.estadoSunat as string)}. Es un indicio para revisión humana, no una acusación.</Aviso>}
      <section className="space-y-3" aria-labelledby="datos-min-titulo">
        <h3 id="datos-min-titulo" className="font-display text-bloque font-bold text-ink">Sus datos</h3>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <article className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <h4 className="text-rotulo font-semibold uppercase tracking-wide text-mute">Identidad en la SUNAT</h4>
            <DatosClave items={identidad.filter(Boolean) as DatoClave[]} />
          </article>
          <article className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <h4 className="text-rotulo font-semibold uppercase tracking-wide text-mute">Con el Estado (compras menores)</h4>
            <DatosClave items={conElEstado.filter(Boolean) as DatoClave[]} />
          </article>
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
