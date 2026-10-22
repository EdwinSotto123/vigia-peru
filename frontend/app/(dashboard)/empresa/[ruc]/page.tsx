import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BadgeCheck, Ban, CalendarRange, MapPin, Package } from "lucide-react";
import { Ayuda, CabeceraPestana, DatosClave, EncabezadoPagina, EstadoError, EstadoVacio, Migas, Pagina, Pestanas } from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { Indicadores, Listado, TablaSkeleton, ZonaResultados, type Indicador, type Parametros } from "@/components/listado";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { AniosEmpresa } from "@/components/empresas/AniosEmpresa";
import { DesglosePuntaje, MedidorPuntaje, TablaReglas } from "@/components/empresas/PuntajeEmpresa";
import {
  AntecedentesEmpresa,
  BarraContratos,
  BarraOrdenes,
  BarraPostulaciones,
  ClientesEmpresa,
  ContratosEmpresa,
  OrdenesEmpresa,
  P_CONTRATOS,
  P_ORDENES,
  P_POSTULACIONES,
  PostulacionesEmpresa,
  SociosEmpresa,
  VisitasEmpresa,
} from "@/components/empresas/SeccionesEmpresa";
import { fecha, fechaCorta, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  OBJETO_TEXTO,
  esRucEmpresa,
  getAntecedentesEmpresa,
  getClientesEmpresa,
  getContratosEmpresa,
  getFichaEmpresa,
  getOrdenesEmpresa,
  getPostulacionesEmpresa,
  getReglasPuntaje,
  getSociosEmpresa,
  getVisitasEmpresa,
  rutaEmpresa,
  type FichaEmpresa,
} from "@/lib/empresas";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { ruc: string } }): Promise<Metadata> {
  const f = await getFichaEmpresa(params.ruc);
  return { title: f ? `${f.empresa.nombre}, empresa` : "Empresa" };
}

const TAM = 20;
const uno = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
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
 *   · Inicio: su puntaje de antecedentes con el desglose, lo que recibió año por año, sus datos y sus clientes principales.
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
  const [f, reglas] = await Promise.all([getFichaEmpresa(params.ruc), getReglasPuntaje()]);
  if (!f) return <NoSePudoLeer ruc={params.ruc} />;
  const e = f.empresa;
  const ruta = rutaEmpresa(e.ruc);

  const fc = { q: texto(sp?.[P_CONTRATOS.q]), anio: anio(sp?.[P_CONTRATOS.anio]), como: ["sola", "consorcio"].includes(uno(sp?.[P_CONTRATOS.como]) ?? "") ? uno(sp?.[P_CONTRATOS.como]) : undefined, page: pagina(sp?.[P_CONTRATOS.page]) };
  const fo = { q: texto(sp?.[P_ORDENES.q]), anio: anio(sp?.[P_ORDENES.anio]), tipo: ["compra", "servicio"].includes(uno(sp?.[P_ORDENES.tipo]) ?? "") ? uno(sp?.[P_ORDENES.tipo]) : undefined, dudosa: uno(sp?.[P_ORDENES.dudosa]) === "si" ? "si" : undefined, page: pagina(sp?.[P_ORDENES.page]) };
  const fp = { q: texto(sp?.[P_POSTULACIONES.q]), resultado: ["gano", "perdio"].includes(uno(sp?.[P_POSTULACIONES.resultado]) ?? "") ? uno(sp?.[P_POSTULACIONES.resultado]) : undefined, page: pagina(sp?.[P_POSTULACIONES.page]) };
  const pc: Parametros = { seccion: "contratos", [P_CONTRATOS.q]: fc.q, [P_CONTRATOS.anio]: fc.anio ? String(fc.anio) : undefined, [P_CONTRATOS.como]: fc.como };
  const po: Parametros = { seccion: "ordenes", [P_ORDENES.q]: fo.q, [P_ORDENES.anio]: fo.anio ? String(fo.anio) : undefined, [P_ORDENES.tipo]: fo.tipo, [P_ORDENES.dudosa]: fo.dudosa };
  const pp: Parametros = { seccion: "postulaciones", [P_POSTULACIONES.q]: fp.q, [P_POSTULACIONES.resultado]: fp.resultado };
  const enContratos = !!(fc.q || fc.anio || fc.como || fc.page > 1);
  const enOrdenes = !!(fo.q || fo.anio || fo.tipo || fo.dudosa || fo.page > 1);
  const enPostulaciones = !!(fp.q || fp.resultado || fp.page > 1);
  const seccion = uno(sp?.seccion) ?? (enContratos ? "contratos" : enOrdenes ? "ordenes" : enPostulaciones ? "postulaciones" : undefined);

  const contratosP = getContratosEmpresa(e.ruc, { ...fc, size: TAM });
  const ordenesP = getOrdenesEmpresa(e.ruc, { ...fo, size: TAM });
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
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Empresas", href: "/app/empresas" },
          { etiqueta: e.nombre, href: ruta },
        ]}
        pestanas={{
          primera: "inicio",
          activa: seccion ?? "inicio",
          etiquetas: { contratos: "Contratos", ordenes: "Órdenes", clientes: "Clientes", postulaciones: "Postulaciones", antecedentes: "Antecedentes", socios: "Socios", visitas: "Visitas" },
        }}
      />
      <EncabezadoPagina
        titulo={e.nombre}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-mono text-[13px] tabular-nums">
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
        <p role="note" className="flex items-start gap-2 rounded-xl border border-crimson/25 bg-crimson-soft/60 p-3 text-[14px] text-crimsonTexto">
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
            contenido: <Inicio f={f} ruta={ruta} reglas={reglas} />,
          },
          {
            clave: "contratos",
            etiqueta: "Contratos",
            conteo: contratos,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Los procesos que ganó, sola o en consorcio, del más reciente al más antiguo.</CabeceraPestana>
                <Listado ruta={ruta} parametros={pc} paramPagina={P_CONTRATOS.page}>
                  <BarraContratos desde={e.primera} hasta={e.ultima} />
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
                <CabeceraPestana>Sus órdenes de compra y de servicio, sin proceso de selección, de la más reciente a la más antigua.</CabeceraPestana>
                <Listado ruta={ruta} parametros={po} paramPagina={P_ORDENES.page}>
                  <BarraOrdenes desde={e.primera} hasta={e.ultima} dudosas={e.ordDudosas} />
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
                  <BarraPostulaciones />
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
                <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Antecedente", ancho: "1fr" }]} filas={6} />}>
                  <AntecedentesEmpresa datos={antecedentesP} />
                </Suspense>
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
        El puntaje y los antecedentes no son una acusación ni prueban una falta: dicen qué registros públicos coinciden con la
        empresa, para que alguien lo revise. Un dato con posible error de carga se muestra tal como lo publicó el Estado.
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

async function Inicio({ f, ruta, reglas }: { f: FichaEmpresa; ruta: string; reglas: Awaited<ReturnType<typeof getReglasPuntaje>> }) {
  const e = f.empresa;
  return (
    <div className="space-y-5">
      <CabeceraPestana>Su puntaje de antecedentes, lo que recibió del Estado cada año y sus datos.</CabeceraPestana>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <MedidorPuntaje puntaje={e.puntaje} nivel={e.nivel} reglas={reglas} />
        <section className="min-w-0 space-y-3" aria-labelledby="desglose-titulo">
          <h3 id="desglose-titulo" className="font-display text-[15px] font-bold text-ink">De dónde salen sus puntos</h3>
          {f.antecedentes.length ? (
            <DesglosePuntaje grupos={f.antecedentes} verTodo={`${ruta}?seccion=antecedentes`} />
          ) : (
            <EstadoVacio compacto titulo="Ningún otro registro la nombra">
              No figura en las sanciones del Tribunal, las penalidades, los aportes y gastos de campaña, las autoridades y
              candidatos, ni en los demás cruces de Vigía.
            </EstadoVacio>
          )}
        </section>
      </div>
      <TablaReglas reglas={reglas} />
      <AniosEmpresa anual={f.anual} nombre={e.nombre} />
      <section className="space-y-2">
        <h3 className="font-display text-[15px] font-bold text-ink">Sus datos</h3>
        <DatosClave
          items={[
            { etiqueta: "RUC", valor: e.ruc, mono: true },
            // Lo de la SUNAT sólo está para algunas empresas: sin ello, una sola fila que lo dice (no cuatro «Sin dato»).
            ...(e.estadoSunat || e.fechaAlta || e.domicilio || e.actividad
              ? [
                  { etiqueta: "Estado en la SUNAT", valor: e.estadoSunat },
                  { etiqueta: "Inscrita en la SUNAT", valor: e.fechaAlta ? fecha(e.fechaAlta) : null },
                  { etiqueta: "Domicilio fiscal", valor: e.domicilio },
                  { etiqueta: "Actividad", valor: e.actividad },
                ]
              : [{ etiqueta: "Datos de la SUNAT", valor: "Todavía no cargados para esta empresa" }]),
            { etiqueta: "Primera y última venta al Estado", valor: e.primera && e.ultima ? `${fecha(e.primera)} y ${fecha(e.ultima)}` : null },
            {
              etiqueta: "Su gente en el RNP",
              valor: e.socios + e.representantes + e.directivos
                ? [plural(e.socios, "socio", "socios"), plural(e.representantes, "representante", "representantes"), plural(e.directivos, "directivo", "directivos")].join(", ")
                : null,
            },
            { etiqueta: "Empresas vinculadas", valor: e.vinculadas ? `${plural(e.vinculadas, "empresa comparte", "empresas comparten")} socio, representante o directivo` : "Ninguna" },
            { etiqueta: "Visitas de su gente", valor: e.visitas ? `${plural(e.visitas, "visita", "visitas")}, ${numero(e.visitasClientes)} a entidades que le pagaron` : "Ninguna registrada" },
          ]}
        />
      </section>
    </div>
  );
}

function NoSePudoLeer({ ruc }: { ruc: string }) {
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Empresas", href: "/app/empresas" }]} />
      <EncabezadoPagina titulo={`RUC ${ruc}`} />
      <EstadoError titulo="No encontramos esta empresa" accion={<Link href={`/app/empresas?q=${ruc}`} className="text-granate hover:underline">Buscarla en Empresas</Link>}>
        Puede que no le haya vendido al Estado desde 2018, que no haya postulado a ningún proceso, o que el servidor no
        respondiera. No mostramos nada en su lugar.
      </EstadoError>
    </Pagina>
  );
}
