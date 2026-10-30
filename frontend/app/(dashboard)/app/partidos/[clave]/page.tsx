import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { CalendarRange, MapPin } from "lucide-react";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { GobiernosPartido, P_GOB, filtrosGobiernos } from "@/components/partidos/GobiernosPartido";
import { GraficoMeses } from "@/components/partidos/GraficoMeses";
import { TablaProcesos } from "@/components/procesos/TablaProcesos";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda, CabeceraPestana, Cargando, EncabezadoPagina, EstadoVacio, FichaNoLeida, Migas, Pagina, Pestanas } from "@/components/patrones";
import { HistoriaFicha } from "@/components/historia/HistoriaFicha";
import { SeguirBoton } from "@/components/cuenta/SeguirBoton";
import {
  BarraFiltros,
  Indicadores,
  Listado,
  TablaSkeleton,
  ZonaResultados,
  type Columna,
  type FiltroSecundario,
  type Indicador,
  type Parametros,
} from "@/components/listado";
import { filtrosVisibles } from "@/components/contratos/filtros";
import { InicioPartido } from "@/components/inicio/InicioPartido";
import { ListaPersonas } from "@/components/personas/ListaPersonas";
import { PARAMS_EN_FICHA } from "@/lib/personas";
import { Skeleton } from "@/components/ui/Skeleton";
import { LECTURAS } from "@/lib/contratos";
import { listaY, numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import {
  AVISO_PARTIDO,
  PERIODOS_GOBIERNO,
  anioDeUrl,
  getDetallePartido,
  getGastoPartido,
  getProcesosPartido,
  periodoTexto,
  type AnioGobierno,
  type DetallePartido,
  type ProcesosPartido,
} from "@/lib/partidosApi";
import { uno } from "@/lib/utils";

export const revalidate = 120;

export async function generateMetadata({ params, searchParams }: { params: { clave: string }; searchParams?: { anio?: string } }) {
  const d = await getDetallePartido(params.clave, anioDeUrl(searchParams?.anio));
  return { title: d ? `${d.partido.nombre}, contratos de sus gobiernos` : "Partido" };
}

const NIVEL: Record<string, string> = { regional: "Gobierno regional", provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" };
const TAM = 20;
/** Las vistas de la pestaña Contratos (`?vista=`). «Por mes» y «Lo que leyó Vigía» eran pestañas aparte. */
const VISTAS_CONTRATOS = ["lista", "meses", "vigia"] as const;

/**
 * /app/partidos/[clave]?anio=2018 — un partido en un período, con el esqueleto de las demás fichas (entidad, contrato):
 *   volver → nombre, período (con los otros a un clic) y cuántos gobiernos ganó → cuatro cifras → pestañas (?seccion=):
 *     · Inicio: qué se encontró (banderas) → dinero (MEF y contratos) → control (Contraloría).
 *     · Contratos: TODOS los procesos adjudicados de sus gobiernos (OECE, desde 2015), con búsqueda, nivel, región,
 *       objeto, gobierno y orden, de a 20; y en la misma pestaña (`?vista=`) los procesos mes a mes y lo que leyó Vigía.
 *       Los enlaces viejos `?seccion=meses` y `?seccion=vigia` llevan ahí (redirección).
 *     · Personas contratadas.
 *     · Gobiernos: UNA tabla con todos los que ganó (presupuesto MEF, contratos, lo leído y con señal), filtrable en la
 *       URL; cada fila abre sus entidades en un panel. Con el detalle del MEF, también «En qué gastan» (`?gvista=gasto`).
 * Se asocia al GANADOR de la elección: una vacancia o un reemplazo dentro del período no está registrado (el aviso, una
 * vez, al pie).
 */
export default async function PartidoPage({ params, searchParams }: { params: { clave: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const anio = anioDeUrl(searchParams?.anio);
  const ruta = `/app/partidos/${params.clave}`;
  const seccionUrl = uno(searchParams?.seccion);
  // «Por mes» y «Lo que leyó Vigía» eran pestañas: sus enlaces siguen funcionando, a su vista dentro de Contratos.
  if (seccionUrl === "meses" || seccionUrl === "vigia") {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams ?? {})) if (typeof v === "string" && k !== "seccion" && k !== "vista") q.set(k, v);
    q.set("seccion", "procesos");
    q.set("vista", seccionUrl);
    redirect(`${ruta}?${q.toString()}`);
  }
  const page = Math.max(1, Number(uno(searchParams?.page)) || 1);
  const filtros = {
    q: uno(searchParams?.q)?.slice(0, 80),
    nivel: ["regional", "provincial", "distrital"].includes(uno(searchParams?.nivel) ?? "") ? uno(searchParams?.nivel) : undefined,
    region: /^\d{2}$/.test(uno(searchParams?.region) ?? "") ? uno(searchParams?.region) : undefined,
    // Un gobierno (desde el panel de la pestaña Gobiernos): su ubigeo de 2, 4 o 6 dígitos.
    ubigeo: /^\d{2}(\d{2}(\d{2})?)?$/.test(uno(searchParams?.ubigeo) ?? "") ? uno(searchParams?.ubigeo) : undefined,
    objeto: uno(searchParams?.objeto)?.slice(0, 40),
    // Las preguntas de la lista de contratos: ¿lo leyó Vigía?, riesgo y antecedentes del ganador.
    lectura: LECTURAS.some((l) => l.value === uno(searchParams?.lectura)) ? uno(searchParams?.lectura) : undefined,
    riesgo: ["alto", "medio", "bajo"].includes(uno(searchParams?.riesgo) ?? "") ? uno(searchParams?.riesgo) : undefined,
    cruces: /^[a-z_]{1,40}$/.test(uno(searchParams?.cruces) ?? "") ? uno(searchParams?.cruces) : undefined,
    orden: uno(searchParams?.orden) === "monto" ? ("monto" as const) : undefined,
  };
  // La búsqueda pide 3 letras (como la API): con menos, no filtra.
  if (filtros.q && filtros.q.length < 3) filtros.q = undefined;
  // "Inicio" es la primera pestaña (sin `seccion`): la lista de procesos lleva la suya en sus enlaces (paginación).
  const parametros: Parametros = { anio: String(anio), ...filtros, seccion: "procesos" };
  const fg = filtrosGobiernos(searchParams);

  const procesosP = getProcesosPartido(params.clave, anio, { ...filtros, page, size: TAM });
  // El MEF lo usan el Inicio y la pestaña Gobiernos: un solo pedido (Next junta los dos `fetch` iguales).
  const gastoP = getGastoPartido(params.clave, anio);
  const d = await getDetallePartido(params.clave, anio);
  // Sin respuesta: puede ser un partido que no gobernó nada ese período o un servidor caído. Desde el cliente no
  // se distinguen (ambos son `null`), así que se dice con esas dos palabras y no se muestra nada inventado.
  if (!d) return <NoDisponible clave={params.clave} anio={anio} />;
  if (!d.partido) notFound();

  const { partido, totales: t } = d;
  const h = d.historia;
  const gobiernos = d.gobiernos ?? [];
  const totalGobiernos = partido.gobiernos.regional + partido.gobiernos.provincial + partido.gobiernos.distrital;
  // Con filtros de una lista y sin pestaña (enlaces de otras páginas), se abre esa lista, no el Inicio.
  const con = (nombres: readonly string[]) => nombres.some((k) => typeof searchParams?.[k] === "string");
  const seccion =
    seccionUrl ??
    (con(Object.values(PARAMS_EN_FICHA)) ? "personas" : con(Object.values(P_GOB)) ? "gobiernos" : Object.values(filtros).some(Boolean) || page > 1 ? "procesos" : undefined);
  const vista = VISTAS_CONTRATOS.find((v) => v === uno(searchParams?.vista));

  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Partidos y gobiernos", href: `/app/partidos?anio=${anio}` },
          { etiqueta: d.partido.nombre, href: `${ruta}?anio=${anio}` },
        ]}
        pestanas={{ primera: "inicio", activa: seccion ?? "inicio", etiquetas: { historia: "Historia", procesos: "Contratos", personas: "Personas contratadas", gobiernos: "Gobiernos" } }}
      />

      <EncabezadoPagina
        titulo={partido.nombre}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange size={14} className="shrink-0 text-mute" aria-hidden /> Gobiernos de {periodoTexto(anio)}
            </span>
            {/* Sólo los niveles donde gobierna: «0 regiones, 2 provincias…» era ruido. */}
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} className="shrink-0 text-mute" aria-hidden />
              {listaY([
                ...(partido.gobiernos.regional > 0 ? [plural(partido.gobiernos.regional, "región", "regiones")] : []),
                ...(partido.gobiernos.provincial > 0 ? [plural(partido.gobiernos.provincial, "provincia", "provincias")] : []),
                ...(partido.gobiernos.distrital > 0 ? [plural(partido.gobiernos.distrital, "distrito", "distritos")] : []),
              ]) || "Sin gobiernos en este período"}
            </span>
          </span>
        }
        acciones={
          <>
            {/* Sólo con contratos en la cola (como en la ficha de una entidad): los de períodos anteriores a la ventana de
                la cola están en la base pero no se financian, y el aporte no tendría qué asignar. */}
            <EnlaceAccion href="/app/apoyar" flecha>
              Ayúdanos a vigilar
            </EnlaceAccion>
            {/* Lo nuevo de sus gobiernos (los del período vigente), en Mi impacto. */}
            <SeguirBoton tipo="partido" id={partido.clave} nombre={partido.nombre} />
          </>
        }
      />

      {/* Los otros períodos del mismo partido, a un clic: ¿qué gobernó antes? */}
      <nav aria-label="Período de gobierno" className="flex flex-wrap items-center gap-2">
        {PERIODOS_GOBIERNO.map((p) => (
          <Link
            key={p.anio}
            href={`${ruta}?anio=${p.anio}`}
            aria-current={p.anio === anio ? "page" : undefined}
            className={
              "inline-flex min-h-[36px] items-center rounded-full border px-3.5 text-dato font-semibold transition-colors " +
              (p.anio === anio ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink")
            }
          >
            {p.texto}
          </Link>
        ))}
      </nav>

      <Indicadores items={indicadores(d, anio, totalGobiernos, ruta)} />

      <Pestanas
        fija
        key={seccion ?? "inicio"}
        etiqueta="Secciones del partido"
        activa={seccion}
        pestanas={[
          {
            clave: "inicio",
            etiqueta: "Inicio",
            contenido: (
              <Suspense fallback={<EsqueletoInicio />}>
                <InicioPartido clave={params.clave} anio={anio} ruta={ruta} d={d} gasto={gastoP} />
              </Suspense>
            ),
          },
          {
            // Todos sus periodos en una línea (fase 3 del plan del 2026-10-27): dónde gobernó tras cada elección, los
            // procesos de sus gobiernos y los que tienen banderas, los aportes que recibió y lo que gastó en campaña.
            clave: "historia",
            etiqueta: "Historia",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Cómo se lee su historia?">
                      Todos sus periodos, no sólo el elegido arriba: cuántos gobiernos ganó en cada elección (JNE), los procesos que
                      convocaron esos gobiernos y los que tienen banderas (OECE y Vigía), y los aportes y gastos de campaña que declaró
                      a la ONPE. Las líneas punteadas son las elecciones.
                    </Ayuda>
                  }
                >
                  Desde 2015: dónde gobernó, cuánto contrataron sus gobiernos y cuánto recibió y gastó en sus campañas.
                </CabeceraPestana>
                <Suspense fallback={<Cargando texto="Armando su historia…" />}>
                  <HistoriaFicha tipo="partido" id={params.clave} nombre={partido.nombre} vista={uno(searchParams?.hv)} />
                </Suspense>
              </div>
            ),
          },
          {
            clave: "procesos",
            // "Contratos", como en la ficha de una entidad: son los adjudicados por sus gobiernos.
            etiqueta: "Contratos",
            conteo: h?.procesos ?? null,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿De dónde salen estos contratos?">
                      <span className="block">
                        Del OECE: los contratos adjudicados por las entidades de los gobiernos que este partido ganó, cada
                        uno en el día en que se convocó. Desde 2018 salen de CONOSCE; de 2015 a 2017, de Contrataciones
                        Abiertas, la API pública del mismo OECE.
                      </span>
                      <span className="mt-2 block">
                        «¿Lo leyó Vigía?», «Riesgo» y «Antecedentes» sólo responden por los procesos que también están en
                        la base de Vigía (más o menos la mitad): el resto no se leyó ni se cruzó con otras fuentes.
                      </span>
                    </Ayuda>
                  }
                >
                  Todos los contratos adjudicados de sus gobiernos en {periodoTexto(anio)}, con su ganador y su monto.
                </CabeceraPestana>
                {/* Tres vistas de los mismos contratos: la lista, mes a mes y lo que leyó Vigía (antes, dos pestañas más
                    al final de la barra, una de ellas con un solo gráfico). */}
                <Pestanas
                  variante="segunda"
                  // Un enlace a otra vista (la cuarta cifra: «leídos por Vigía») la abre aunque la pestaña ya esté montada.
                  key={vista ?? "lista"}
                  param="vista"
                  etiqueta="Vistas de sus contratos"
                  activa={vista}
                  pestanas={[
                    {
                      clave: "lista",
                      etiqueta: "Todos",
                      conteo: h?.procesos ?? null,
                      contenido: (
                        <Listado ruta={ruta} parametros={parametros} paramPagina="page">
                          {/* Los conteos de lectura, riesgo y antecedentes llegan con la página: mientras, la barra sin números. */}
                          <Suspense fallback={<BarraDeProcesos d={d} facetas={null} ubigeo={filtros.ubigeo} />}>
                            <BarraProcesos pagina={procesosP} d={d} ubigeo={filtros.ubigeo} />
                          </Suspense>
                          <ZonaResultados>
                            <Suspense fallback={<TablaSkeleton columnas={COLUMNAS_SKELETON} filas={10} />}>
                              <Procesos pagina={procesosP} parametros={parametros} ruta={ruta} actual={page} />
                            </Suspense>
                          </ZonaResultados>
                        </Listado>
                      ),
                    },
                    {
                      clave: "meses",
                      etiqueta: "Por mes",
                      contenido: (
                        <div className="space-y-4">
                          <CabeceraPestana>Cada proceso cuenta en el mes en que se convocó, con el partido que gobernaba la entidad ese día.</CabeceraPestana>
                          <GraficoMeses
                            porMes={(h?.porMes ?? []).map((m) => ({ mes: m.mes, contratos: m.procesos, leidos: 0, conSenales: 0 }))}
                            etiqueta={`Procesos de los gobiernos de ${partido.nombre} por mes, ${periodoTexto(anio)}`}
                            unidad={{ singular: "proceso", plural: "procesos" }}
                            conLectura={false}
                          />
                        </div>
                      ),
                    },
                    ...(t.contratos > 0
                      ? [{ clave: "vigia", etiqueta: "Lo que leyó Vigía", conteo: t.leidos, contenido: <LecturaVigia d={d} anio={anio} ruta={ruta} /> }]
                      : []),
                  ]}
                />
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
                        Las personas a las que sus gobiernos pagaron por órdenes de servicio (OECE, CONOSCE) mientras este
                        partido gobernaba. «Candidato del que gobierna» y «Aportó al que gobierna» marcan a quienes postularon
                        o aportaron a este mismo partido.
                      </span>
                      <span className="mt-2 block">
                        Por privacidad no se muestra su DNI ni su RUC y se tapa un apellido. Una señal no prueba nada.
                      </span>
                    </Ayuda>
                  }
                >
                  A quién contrataron sus gobiernos por órdenes de servicio en {periodoTexto(anio)}, y qué dicen de cada uno otros registros.
                </CabeceraPestana>
                <ListaPersonas
                  alcance={{ partido: params.clave, periodo: anio }}
                  sp={searchParams}
                  P={PARAMS_EN_FICHA}
                  ruta={ruta}
                  base={{ anio: String(anio), seccion: "personas" }}
                  conIndicadores
                />
              </div>
            ),
          },
          {
            clave: "gobiernos",
            etiqueta: "Gobiernos",
            conteo: gobiernos.length || totalGobiernos,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Qué hay en cada fila?">
                      <span className="block">
                        Cada gobierno que ganó: su presupuesto y lo gastado (MEF, sólo en el mandato que incluye el año cargado),
                        sus contratos adjudicados (OECE) y lo que Vigía leyó de ellos, con cuántos tienen una señal para revisar.
                      </span>
                      <span className="mt-2 block">La fila abre sus entidades en la base de Vigía, sus proyectos y sus contratos.</span>
                    </Ayuda>
                  }
                >
                  {gobiernos.length || totalGobiernos ? `Los ${numero(gobiernos.length || totalGobiernos)} gobiernos` : "Los gobiernos"} que ganó para{" "}
                  {periodoTexto(anio)}, con su dinero, sus contratos y lo que leyó Vigía.
                </CabeceraPestana>
                {gobiernos.length > 0 ? (
                  <Suspense fallback={<TablaSkeleton columnas={COLUMNAS_GOBIERNOS} filas={10} />}>
                    <GobiernosPartido d={d} gasto={gastoP} filtros={fg} ruta={ruta} anio={anio} />
                  </Suspense>
                ) : totalGobiernos === 0 ? (
                  // Un período sin gobiernos no es un error: no ganó ninguno (antes decía «No pudimos leer sus gobiernos»).
                  <EstadoVacio compacto titulo={`No ganó gobiernos para ${periodoTexto(anio)}`}>
                    En esas elecciones no ganó ningún gobierno regional, provincial ni distrital.
                  </EstadoVacio>
                ) : (
                  <p className="text-dato leading-5 text-inkSoft">No pudimos leer sus gobiernos en este momento.</p>
                )}
              </div>
            ),
          },
        ]}
      />
      <Aviso tono="neutro">{AVISO_PARTIDO}</Aviso>
    </Pagina>
  );
}

function EsqueletoInicio() {
  return (
    <div className="space-y-10" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4">
          <Skeleton className="h-7 w-48" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function Procesos({ pagina, parametros, ruta, actual }: { pagina: Promise<ProcesosPartido | null>; parametros: Parametros; ruta: string; actual: number }) {
  return <TablaProcesos pagina={await pagina} parametros={parametros} ruta={ruta} actual={actual} />;
}

async function BarraProcesos({ pagina, d, ubigeo }: { pagina: Promise<ProcesosPartido | null>; d: DetallePartido; ubigeo?: string }) {
  return <BarraDeProcesos d={d} facetas={(await pagina)?.facetas ?? null} ubigeo={ubigeo} />;
}

/** Búsqueda, las tres preguntas de Vigía (como en /app/contratos) y nivel, región y objeto; el gobierno, si viene. */
function BarraDeProcesos({ d, facetas, ubigeo }: { d: DetallePartido; facetas: ProcesosPartido["facetas"] | null; ubigeo?: string }) {
  const gobierno = filtroGobierno(d, ubigeo);
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: "Buscar qué se compró, entidad o ganador…", etiqueta: "Buscar en sus contratos", min: 3 }}
      visibles={[...filtrosVisibles(facetas ?? null), ...visibles(d)]}
      filtros={gobierno ? [gobierno] : []}
      orden={{ param: "orden", porDefecto: "fecha", opciones: [{ valor: "fecha", etiqueta: "Más recientes" }, { valor: "monto", etiqueta: "Mayor monto" }] }}
    />
  );
}

/**
 * Uno de sus gobiernos, en «Filtros»: con muchos (un partido grande tiene cientos) se escribe y se elige. También es el
 * que llega del panel de la pestaña Gobiernos («Ver sus contratos»), para que la lista diga por qué es la que es y se
 * quite con su ×. Los homónimos (hay muchos distritos «San Juan») llevan su provincia (o su región) y, si aún se repiten,
 * su ubigeo: la opción se elige por su nombre y dos iguales filtrarían el equivocado.
 */
function filtroGobierno(d: DetallePartido, ubigeo?: string): FiltroSecundario | null {
  const gobiernos = (d.gobiernos ?? []).filter((x) => x.procesos > 0 || x.ubigeo === ubigeo);
  const base = (g: (typeof gobiernos)[number]) => `${NIVEL[g.nivel]} de ${g.lugar ?? g.ubigeo}`;
  const repetidos = (nombres: string[]) => {
    const veces = new Map<string, number>();
    for (const n of nombres) veces.set(n, (veces.get(n) ?? 0) + 1);
    return (n: string) => (veces.get(n) ?? 0) > 1;
  };
  const conLugar = (g: (typeof gobiernos)[number]) => `${base(g)} (${(g.nivel === "distrital" ? g.provincia : null) ?? g.region ?? g.ubigeo})`;
  const r1 = repetidos(gobiernos.map(base));
  const r2 = repetidos(gobiernos.map((g) => (r1(base(g)) ? conLugar(g) : base(g))));
  const opciones: FiltroSecundario["opciones"] = gobiernos
    .map((g) => {
      const nombre = r1(base(g)) ? conLugar(g) : base(g);
      return { valor: g.ubigeo, etiqueta: r2(nombre) ? `${base(g)} (${[g.provincia ?? g.region, g.ubigeo].filter(Boolean).join(", ")})` : nombre, conteo: g.procesos };
    })
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
  if (ubigeo && !opciones.some((o) => o.valor === ubigeo)) opciones.unshift({ valor: ubigeo, etiqueta: `Ubigeo ${ubigeo}`, conteo: null });
  if (opciones.length < 2 && !ubigeo) return null;
  return { param: "ubigeo", etiqueta: "Gobierno", todas: "Todos sus gobiernos", buscable: opciones.length > 12, opciones };
}

const COLUMNAS_SKELETON: Columna[] = [
  { clave: "fecha", titulo: "Convocado", ancho: "96px" },
  { clave: "proceso", titulo: "Proceso", ancho: "minmax(0,1.6fr)" },
  { clave: "monto", titulo: "Adjudicado", ancho: "128px", alinear: "der" },
];

const COLUMNAS_GOBIERNOS: Columna[] = [
  { clave: "gobierno", titulo: "Gobierno", ancho: "minmax(0,1.5fr)" },
  { clave: "procesos", titulo: "Contratos", ancho: "92px", alinear: "der", desde: "md" },
  { clave: "adjudicado", titulo: "Adjudicado", ancho: "112px", alinear: "der" },
];

/** Nivel, región y objeto, con cuántos procesos tiene cada opción (de la ficha del partido). */
function visibles(d: DetallePartido): FiltroSecundario[] {
  const g = d.gobiernos ?? [];
  const porNivel = (n: string) => g.filter((x) => x.nivel === n).reduce((s, x) => s + x.procesos, 0);
  const regiones = new Map<string, { nombre: string; procesos: number }>();
  for (const x of g) {
    const u = x.ubigeo.slice(0, 2);
    const r = regiones.get(u) ?? { nombre: x.region ?? u, procesos: 0 };
    r.procesos += x.procesos;
    regiones.set(u, r);
  }
  return [
    {
      param: "nivel",
      etiqueta: "Nivel de gobierno",
      corta: "Nivel",
      todas: "Todos",
      opciones: (["regional", "provincial", "distrital"] as const)
        .filter((n) => g.some((x) => x.nivel === n))
        .map((n) => ({ valor: n, etiqueta: NIVEL[n], conteo: porNivel(n) })),
    },
    {
      param: "region",
      etiqueta: "Región",
      corta: "Región",
      todas: "Todas",
      opciones: [...regiones.entries()]
        .filter(([, r]) => r.procesos > 0)
        .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, "es"))
        .map(([u, r]) => ({ valor: u, etiqueta: r.nombre, conteo: r.procesos })),
    },
    {
      param: "objeto",
      etiqueta: "Objeto",
      corta: "Objeto",
      todas: "Todos",
      opciones: (d.historia?.porObjeto ?? []).map((o) => ({ valor: o.objeto, etiqueta: o.objeto, conteo: o.procesos })),
    },
  ];
}

/**
 * Procesos y monto (OECE: CONOSCE desde 2018, la API OCDS antes), gobiernos con procesos y lo que leyó Vigía. Lo de la
 * base de Vigía se nombra «convocatorias en la base de Vigía»: antes era «contratos en su base», un número MAYOR que el
 * total de «contratos adjudicados» de la primera cifra (§10.1: la misma palabra contando dos cosas).
 */
function indicadores(d: DetallePartido, anio: AnioGobierno, totalGobiernos: number, ruta: string): Indicador[] {
  const h = d.historia;
  const t = d.totales;
  return [
    {
      valor: h ? numero(h.procesos) : null,
      etiqueta: "contratos adjudicados",
      contexto: h ? `de ${plural(h.entidades, "entidad", "entidades")}` : undefined,
      href: ruta + `?anio=${anio}&seccion=procesos`,
    },
    {
      valor: h ? solesCompacto(h.montoAdjudicadoPen) : null,
      etiqueta: "adjudicados en soles",
      contexto: h ? `a ${plural(h.proveedores, "proveedor", "proveedores")}` : undefined,
      href: `${ruta}?anio=${anio}&seccion=procesos&orden=monto`,
    },
    {
      valor: numero(totalGobiernos),
      etiqueta: "gobiernos ganados",
      contexto: h ? `${numero(h.gobiernosConProcesos)} con contratos` : undefined,
      href: `${ruta}?anio=${anio}&seccion=gobiernos`,
    },
    {
      valor: numero(t.leidos),
      etiqueta: "leídos por Vigía",
      contexto:
        t.contratos > 0
          ? `de ${plural(t.contratos, "convocatoria", "convocatorias")} en la base de Vigía (${porcentaje((t.leidos / t.contratos) * 100, { decimales: 1 })})`
          : "ninguna convocatoria en la base de Vigía para este período",
      href: t.contratos > 0 ? `${ruta}?anio=${anio}&seccion=procesos&vista=vigia` : undefined,
    },
  ];
}

/** Lo de la base de Vigía (lo que se puede leer): leídos, señales y cola, y mes a mes. Sus entidades, en Gobiernos. */
function LecturaVigia({ d, anio, ruta }: { d: DetallePartido; anio: AnioGobierno; ruta: string }) {
  const t = d.totales;
  const esperando = t.enCola + t.documentosListos;
  const items: Indicador[] = [
    { valor: numero(t.contratos), etiqueta: "convocatorias en la base de Vigía", contexto: `${solesCompacto(t.montoPen)} de valor referencial` },
    { valor: numero(t.leidos), etiqueta: "leídos por Vigía", contexto: t.contratos > 0 ? `${porcentaje((t.leidos / t.contratos) * 100, { decimales: 1 })} de esas convocatorias` : "ninguno" },
    { valor: numero(t.conSenales), etiqueta: "con señal para revisar", contexto: "una señal no es una acusación" },
    { valor: numero(esperando), etiqueta: "esperando lectura", contexto: `${numero(t.documentosListos)} ya con sus documentos` },
  ];
  return (
    <div className="space-y-5">
      <CabeceraPestana>
        Las convocatorias de sus gobiernos que Vigía tiene para leer en {periodoTexto(anio)}, y lo que ya leyó.{" "}
        <Link href={`${ruta}?anio=${anio}&seccion=gobiernos`} className="font-medium text-granate underline-offset-2 hover:underline">
          Cada gobierno con lo leído de sus entidades
        </Link>
        .
      </CabeceraPestana>
      <Indicadores items={items} />
      <GraficoMeses porMes={d.porMes} etiqueta={`Contratos de la base de Vigía por mes, ${periodoTexto(anio)}`} />
    </div>
  );
}

function NoDisponible({ clave, anio }: { clave: string; anio: AnioGobierno }) {
  return (
    <FichaNoLeida
      migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Partidos y gobiernos", href: "/app/partidos" }]}
      titulo="Contratos de un partido"
      error="No pudimos leer este partido"
      reintentar={{ href: `/app/partidos/${encodeURIComponent(clave)}?anio=${anio}` }}
    >
      Puede que no haya gobernado nada en {periodoTexto(anio)} o que el servidor no respondiera. No mostramos nada en su lugar.
    </FichaNoLeida>
  );
}
