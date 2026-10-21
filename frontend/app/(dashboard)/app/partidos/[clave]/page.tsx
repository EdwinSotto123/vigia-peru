import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarRange } from "lucide-react";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { GobiernosPartido } from "@/components/partidos/GobiernosPartido";
import { GraficoMeses } from "@/components/partidos/GraficoMeses";
import { TablaProcesos } from "@/components/procesos/TablaProcesos";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda, CabeceraPestana, EncabezadoPagina, EstadoError, Migas, Pagina, Pestanas, Volver } from "@/components/patrones";
import {
  BarraFiltros,
  CeldaNumero,
  CeldaPrincipal,
  Indicadores,
  Listado,
  Tabla,
  TablaSkeleton,
  ZonaResultados,
  type Columna,
  type FiltroSecundario,
  type Fila,
  type Indicador,
  type Parametros,
} from "@/components/listado";
import { filtrosVisibles } from "@/components/contratos/filtros";
import { InicioPartido } from "@/components/inicio/InicioPartido";
import { Skeleton } from "@/components/ui/Skeleton";
import { LECTURAS } from "@/lib/contratos";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import {
  AVISO_PARTIDO,
  PERIODOS_GOBIERNO,
  anioDeUrl,
  getDetallePartido,
  getProcesosPartido,
  periodoTexto,
  type AnioGobierno,
  type DetallePartido,
  type ProcesosPartido,
} from "@/lib/partidosApi";

export const revalidate = 120;

export async function generateMetadata({ params, searchParams }: { params: { clave: string }; searchParams?: { anio?: string } }) {
  const d = await getDetallePartido(params.clave, anioDeUrl(searchParams?.anio));
  return { title: d ? `${d.partido.nombre}, contratos de sus gobiernos` : "Partido" };
}

const NIVEL: Record<string, string> = { regional: "Gobierno regional", provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" };
const TAM = 20;

/** Un parámetro de texto de la URL, o nada. */
const uno = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * /app/partidos/[clave]?anio=2018 — un partido en un período, con el esqueleto de las demás fichas (entidad, contrato):
 *   volver → nombre, período (con los otros a un clic) y cuántos gobiernos ganó → cuatro cifras → pestañas (?seccion=):
 *     · Procesos: TODOS los procesos adjudicados de sus gobiernos (OECE, desde 2015), con búsqueda, nivel, región,
 *       objeto y orden, de a 20. Antes la ficha listaba las 15 entidades con más contratos de la base de Vigía (2026).
 *     · Gobiernos: TODOS los que ganó, con sus procesos y sus contratos en Vigía, filtrables.
 *     · Por mes: los procesos convocados mes a mes.
 *     · Lectura de Vigía: los contratos de la base de Vigía (leídos, señales, cola), si los hay.
 * Se asocia al GANADOR de la elección: una vacancia o un reemplazo dentro del período no está registrado.
 */
export default async function PartidoPage({ params, searchParams }: { params: { clave: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const anio = anioDeUrl(searchParams?.anio);
  const ruta = `/app/partidos/${params.clave}`;
  const page = Math.max(1, Number(uno(searchParams?.page)) || 1);
  const filtros = {
    q: uno(searchParams?.q)?.slice(0, 80),
    nivel: ["regional", "provincial", "distrital"].includes(uno(searchParams?.nivel) ?? "") ? uno(searchParams?.nivel) : undefined,
    region: /^\d{2}$/.test(uno(searchParams?.region) ?? "") ? uno(searchParams?.region) : undefined,
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

  const procesosP = getProcesosPartido(params.clave, anio, { ...filtros, page, size: TAM });
  const d = await getDetallePartido(params.clave, anio);
  // Sin respuesta: puede ser un partido que no gobernó nada ese período o un servidor caído. Desde el cliente no
  // se distinguen (ambos son `null`), así que se dice con esas dos palabras y no se muestra nada inventado.
  if (!d) return <NoDisponible clave={params.clave} anio={anio} />;
  if (!d.partido) notFound();

  const { partido, totales: t } = d;
  const h = d.historia;
  const gobiernos = d.gobiernos ?? [];
  const totalGobiernos = partido.gobiernos.regional + partido.gobiernos.provincial + partido.gobiernos.distrital;
  // Con filtros de la lista y sin pestaña (enlaces de otras páginas), se abren sus contratos, no el Inicio.
  const seccion = uno(searchParams?.seccion) ?? (Object.values(filtros).some(Boolean) || page > 1 ? "procesos" : undefined);

  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Partidos y gobiernos", href: `/app/partidos?anio=${anio}` },
          { etiqueta: d.partido.nombre, href: `${ruta}?anio=${anio}` },
        ]}
        pestanas={{ primera: "inicio", activa: seccion ?? "inicio", etiquetas: { procesos: "Contratos", gobiernos: "Gobiernos", meses: "Por mes", vigia: "Lo que leyó Vigía" } }}
      />

      <EncabezadoPagina
        titulo={partido.nombre}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange size={14} className="shrink-0 text-mute" aria-hidden /> Gobiernos de {periodoTexto(anio)}
            </span>
            <span>
              {plural(partido.gobiernos.regional, "región", "regiones")}, {plural(partido.gobiernos.provincial, "provincia", "provincias")},{" "}
              {plural(partido.gobiernos.distrital, "distrito", "distritos")}
            </span>
          </span>
        }
        acciones={
          // Sólo con contratos en la cola (como en la ficha de una entidad): los de períodos anteriores a la ventana de
          // la cola están en la base pero no se financian, y el aporte no tendría qué asignar.
          t.enCola > 0 ? (
            <EnlaceAccion href={`/app/financiar/partido/${partido.clave}?anio=${anio}`} flecha>
              Financiar la lectura de sus contratos
            </EnlaceAccion>
          ) : undefined
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
              "inline-flex min-h-[36px] items-center rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors " +
              (p.anio === anio ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink")
            }
          >
            {p.texto}
          </Link>
        ))}
      </nav>

      <Indicadores items={indicadores(d, anio, totalGobiernos, ruta)} />

      <Pestanas
        key={seccion ?? "inicio"}
        etiqueta="Secciones del partido"
        activa={seccion}
        pestanas={[
          {
            clave: "inicio",
            etiqueta: "Inicio",
            contenido: (
              <Suspense fallback={<div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}</div>}>
                <InicioPartido clave={params.clave} anio={anio} ruta={ruta} d={d} />
              </Suspense>
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
                      <span className="mt-2 block">{AVISO_PARTIDO}</span>
                    </Ayuda>
                  }
                >
                  Todos los contratos adjudicados de sus gobiernos en {periodoTexto(anio)}, con su ganador y su monto.
                </CabeceraPestana>
                <Listado ruta={ruta} parametros={parametros} paramPagina="page">
                  {/* Los conteos de lectura, riesgo y antecedentes llegan con la página: mientras, la barra sin números. */}
                  <Suspense fallback={<BarraDeProcesos d={d} facetas={null} />}>
                    <BarraProcesos pagina={procesosP} d={d} />
                  </Suspense>
                  <ZonaResultados>
                    <Suspense fallback={<TablaSkeleton columnas={COLUMNAS_SKELETON} filas={10} />}>
                      <Procesos pagina={procesosP} parametros={parametros} ruta={ruta} actual={page} />
                    </Suspense>
                  </ZonaResultados>
                </Listado>
              </div>
            ),
          },
          {
            clave: "gobiernos",
            etiqueta: "Gobiernos",
            conteo: gobiernos.length || totalGobiernos,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>
                  Los {numero(gobiernos.length || totalGobiernos)} gobiernos que ganó para {periodoTexto(anio)}, con sus procesos y sus contratos en Vigía.
                </CabeceraPestana>
                {gobiernos.length > 0 ? (
                  <GobiernosPartido gobiernos={gobiernos} partido={partido.nombre} />
                ) : (
                  <p className="text-sm text-inkSoft">No pudimos leer sus gobiernos en este momento.</p>
                )}
              </div>
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
          ...(t.contratos > 0 ? [{ clave: "vigia", etiqueta: "Lo que leyó Vigía", conteo: t.leidos, contenido: <LecturaVigia d={d} anio={anio} /> }] : []),
        ]}
      />
      <Aviso tono="neutro">{AVISO_PARTIDO}</Aviso>
    </Pagina>
  );
}

async function Procesos({ pagina, parametros, ruta, actual }: { pagina: Promise<ProcesosPartido | null>; parametros: Parametros; ruta: string; actual: number }) {
  return <TablaProcesos pagina={await pagina} parametros={parametros} ruta={ruta} actual={actual} />;
}

async function BarraProcesos({ pagina, d }: { pagina: Promise<ProcesosPartido | null>; d: DetallePartido }) {
  return <BarraDeProcesos d={d} facetas={(await pagina)?.facetas ?? null} />;
}

/** Búsqueda, las tres preguntas de Vigía (como en /app/contratos) y nivel, región y objeto. */
function BarraDeProcesos({ d, facetas }: { d: DetallePartido; facetas: ProcesosPartido["facetas"] | null }) {
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: "Buscar qué se compró, entidad o ganador…", etiqueta: "Buscar en sus contratos", min: 3 }}
      visibles={[...filtrosVisibles(facetas ?? null), ...visibles(d)]}
      filtros={[]}
      orden={{ param: "orden", porDefecto: "fecha", opciones: [{ valor: "fecha", etiqueta: "Más recientes" }, { valor: "monto", etiqueta: "Mayor monto" }] }}
    />
  );
}

const COLUMNAS_SKELETON: Columna[] = [
  { clave: "fecha", titulo: "Convocado", ancho: "96px" },
  { clave: "proceso", titulo: "Proceso", ancho: "minmax(0,1.6fr)" },
  { clave: "monto", titulo: "Adjudicado", ancho: "128px", alinear: "der" },
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

/** Procesos y monto (OECE: CONOSCE desde 2018, la API OCDS antes), gobiernos con procesos y lo que leyó Vigía. */
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
      contexto: t.contratos > 0 ? `de ${plural(t.contratos, "contrato", "contratos")} en su base (${porcentaje((t.leidos / t.contratos) * 100, { decimales: 1 })})` : "ninguno en su base para este período",
      href: t.contratos > 0 ? `${ruta}?anio=${anio}&seccion=vigia` : undefined,
    },
  ];
}

/** Lo de la base de Vigía (lo que se puede leer): leídos, señales, cola y las entidades con más contratos. */
function LecturaVigia({ d, anio }: { d: DetallePartido; anio: AnioGobierno }) {
  const t = d.totales;
  const esperando = t.enCola + t.documentosListos;
  const items: Indicador[] = [
    { valor: numero(t.contratos), etiqueta: "contratos en su base", contexto: `${solesCompacto(t.montoPen)} de valor referencial` },
    { valor: numero(t.leidos), etiqueta: "ya leídos", contexto: t.contratos > 0 ? `${porcentaje((t.leidos / t.contratos) * 100, { decimales: 1 })} del total` : "ninguno" },
    { valor: numero(t.conSenales), etiqueta: "con señal para revisar", contexto: "una señal no es una acusación" },
    { valor: numero(esperando), etiqueta: "esperando lectura", contexto: `${numero(t.documentosListos)} ya con sus documentos` },
  ];
  const columnas: Columna[] = [
    { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)" },
    { clave: "contratos", titulo: "Contratos", ancho: "92px", alinear: "der" },
    { clave: "leidos", titulo: "Leídos", ancho: "84px", alinear: "der", desde: "md" },
    { clave: "senales", titulo: "Con señal", ancho: "92px", alinear: "der", desde: "lg" },
    { clave: "cola", titulo: "En cola", ancho: "84px", alinear: "der", desde: "lg" },
  ];
  const filas: Fila[] = d.entidades.map((e) => ({
    id: e.ruc,
    href: `/entidad/${e.ruc}`,
    celdas: {
      entidad: <CeldaPrincipal titulo={e.nombre} textoCompleto={e.nombre} meta={[NIVEL[e.nivel] ?? null, e.lugar, e.autoridad ? `Autoridad: ${e.autoridad}` : null]} />,
      contratos: <CeldaNumero>{numero(e.contratos)}</CeldaNumero>,
      leidos: <CeldaNumero>{numero(e.leidos)}</CeldaNumero>,
      senales: <CeldaNumero>{numero(e.conSenales)}</CeldaNumero>,
      cola: <CeldaNumero>{numero(e.enCola)}</CeldaNumero>,
    },
  }));
  return (
    <div className="space-y-5">
      <CabeceraPestana>Los contratos de sus gobiernos que Vigía tiene para leer en {periodoTexto(anio)}, y lo que ya leyó.</CabeceraPestana>
      <Indicadores items={items} />
      <GraficoMeses porMes={d.porMes} etiqueta={`Contratos de la base de Vigía por mes, ${periodoTexto(anio)}`} />
      {filas.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[16px] font-semibold text-ink">Sus entidades con más contratos en la base</h3>
          <Tabla columnas={columnas} filas={filas} etiqueta="Entidades con más contratos en la base de Vigía" />
        </div>
      )}
    </div>
  );
}

function NoDisponible({ clave, anio }: { clave: string; anio: AnioGobierno }) {
  return (
    <Pagina>
      <Volver href="/app/partidos">Partidos y gobiernos</Volver>
      <EncabezadoPagina titulo="Contratos de un partido" />
      <EstadoError
        titulo="No pudimos leer este partido"
        accion={<EnlaceAccion href={`/app/partidos/${encodeURIComponent(clave)}?anio=${anio}`}>Reintentar</EnlaceAccion>}
      >
        Puede que no haya gobernado nada en {periodoTexto(anio)} o que el servidor no respondiera. No mostramos nada en su lugar.
      </EstadoError>
    </Pagina>
  );
}
