import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BadgeCheck, Ban, CalendarRange, MapPin, Package } from "lucide-react";
import { Ayuda, AyudaTermino, CabeceraPestana, DatosClave, EncabezadoPagina, FichaNoLeida, Migas, Pagina, Pestanas } from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { Indicadores, Listado, TablaSkeleton, ZonaResultados, type Indicador, type Parametros } from "@/components/listado";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { AniosEmpresa } from "@/components/empresas/AniosEmpresa";
import { ResumenAntecedentes } from "@/components/empresas/ResumenAntecedentes";
import { ClientesPrincipales, ComoGana, DondeVende, QuienLeGana } from "@/components/empresas/InicioEmpresa";
import { AntecedentesEmpresa, BarraContratos, BarraContratosConConteos, BarraOrdenes, BarraOrdenesConConteos, BarraPostulaciones, BarraPostulacionesConConteos, P_ANTECEDENTES, ClientesEmpresa, ContratosEmpresa, OrdenesEmpresa, P_CONTRATOS, P_ORDENES, P_POSTULACIONES, PostulacionesEmpresa, SociosEmpresa, VisitasEmpresa } from "@/components/empresas/SeccionesEmpresa";
import { fecha, fechaCorta, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { OBJETOS, OBJETO_TEXTO, esRucEmpresa, getAntecedentesEmpresa, getClientesEmpresa, getContratosEmpresa, getFichaEmpresa, getOrdenesEmpresa, getPostulacionesEmpresa, getSociosEmpresa, getVisitasEmpresa, rutaEmpresa, type FichaEmpresa } from "@/lib/empresas";
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
  const ruta = rutaEmpresa(e.ruc);

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
  const pc = conservar("contratos", P_CONTRATOS, fc);
  const po = conservar("ordenes", P_ORDENES, fo);
  const pp = conservar("postulaciones", P_POSTULACIONES, fp);
  const pa = conservar("antecedentes", P_ANTECEDENTES, fa);
  const algo = (p: Parametros, pag: number) => Object.keys(p).length > 1 || pag > 1;
  const seccion =
    uno(sp?.seccion) ??
    (algo(pc, fc.page) ? "contratos" : algo(po, fo.page) ? "ordenes" : algo(pp, fp.page) ? "postulaciones" : algo(pa, 1) ? "antecedentes" : undefined);

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
  return (
    <div className="space-y-5">
      <CabeceraPestana>Lo que dicen de ella otros registros públicos, lo que recibió del Estado cada año y sus datos.</CabeceraPestana>
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
      <AniosEmpresa anual={f.anual} nombre={e.nombre} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<BloqueCargando titulo="Cómo gana" />}><ComoGana pagina={contratos} ruta={ruta} /></Suspense>
        <Suspense fallback={<BloqueCargando titulo="Sus principales clientes" />}><ClientesPrincipales datos={clientes} ruta={ruta} /></Suspense>
        <Suspense fallback={<BloqueCargando titulo="Quién le gana" />}><QuienLeGana pagina={postulaciones} ruta={ruta} /></Suspense>
        <Suspense fallback={<BloqueCargando titulo="Dónde gana" />}><DondeVende pagina={contratos} ruta={ruta} /></Suspense>
      </div>
      <section className="space-y-2">
        <h3 className="font-display text-bloque font-bold text-ink">Sus datos</h3>
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
