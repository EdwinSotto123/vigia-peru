import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Clock, Code2, HeartHandshake, ShieldCheck } from "lucide-react";
import { ListaZonas, type ZonaListada } from "@/components/financiar/ListaZonas";
import { ResultadosEntidades, TAM_ENTIDADES } from "@/components/financiar/ListaEntidades";
import { ORDEN_PARTIDOS_DEFECTO, ResultadosPartidos, SelectorPeriodo, TAM_PARTIDOS } from "@/components/financiar/ListaPartidos";
import { FiltrosFinanciar, ResultadosConEspera } from "@/components/financiar/FiltrosFinanciar";
import { EXPLICACION_PARTIDO, ORDENES_PARTIDOS, anioDeUrl, esOrdenPartidos, getRankingPartidos, periodoTexto } from "@/lib/partidosApi";
import { AportesPorAliado } from "@/components/financiar/RecientesFeed";
import { getAportesAgrupados } from "@/components/financiar/aportesAgrupados";
import { EnlaceAccion, claseAccion, CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";
import { Popover } from "@/components/ui/Flotante";
import { Paginacion } from "@/components/ui/Paginacion";
import { Ayuda, EncabezadoPagina, EstadoError, EstadoVacio, FuenteDato, Migas, Pagina, Seccion } from "@/components/patrones";
import { BarraFiltros, Listado, Vistas, ZonaResultados, type Indicador } from "@/components/listado";
import { FranjaTextil } from "@/components/marca";
import { numero, plural } from "@/lib/formato";
import { CONTRATACIONES_ABIERTAS, INFOGOB_JNE } from "@/lib/fuentes";
import {
  alcanceCorto,
  getEntidadesFinanciables,
  getEstadoGlobal,
  getPago,
  getZonas,
  type EstadoGlobal,
  type Zona,
} from "@/lib/financiamiento";
import { desdeLectura, getResumenContratos } from "@/lib/contratos";
import { cifrasDeResumen, pctDe, type CifrasAnio } from "@/lib/cifras";

const REPO = "https://github.com/EdwinSotto123/vigia-peru";

/** Zonas por página: las 25 regiones caben en una; una búsqueda amplia ("san") pagina. */
const TAM = 25;

export const metadata = {
  title: "Lo que falta leer",
  description:
    "Cada región del Perú tiene contratos públicos que nadie ha leído. Mira cuántos esperan su lectura a fondo en tu zona, en una entidad o en los gobiernos de un partido, y ayuda a vigilarlos con un aporte al fondo común.",
};

export const revalidate = 120;

/**
 * Las reglas que hacen que un aporte no compre nada: una frase visible por regla y el detalle a un clic
 * (DESIGN_SYSTEM.md §10.7). Desde el 2026-10-30 todo aporte va al fondo común (antes se pagaba la lectura de N
 * contratos de una zona o una entidad, «S/ X por contrato»).
 */
const REGLAS: { titulo: string; resumen: string; detalle: string }[] = [
  {
    titulo: "Sin selección",
    resumen: "Ningún aporte elige qué se lee.",
    detalle:
      "Tu aporte va al fondo común. La zona o la entidad que mirabas queda como destino sugerido en tu constancia, nada más: la cola se lee de lo más grave a lo menos grave, aporte quien aporte. Ninguna API acepta un contrato elegido por quien aporta.",
  },
  {
    titulo: "Sin edición",
    resumen: "Quien lee no sabe quién aportó.",
    detalle: "Quien lee los contratos no recibe el nombre de quien aportó: ese dato no entra en sus instrucciones.",
  },
  {
    titulo: "Conflicto automático",
    resumen: "Con sanción vigente, sin reconocimiento.",
    detalle:
      "Una empresa con sanción vigente del OECE o con alertas activas puede aportar, pero no recibe reconocimiento público.",
  },
  {
    titulo: "Publicación incondicional",
    resumen: "Se publica aunque te señale.",
    detalle: "Si una lectura termina señalando a quien aportó, se publica igual.",
  },
  {
    titulo: "Reconocimiento por constancia",
    resumen: "El podio cuenta meses, nunca soles.",
    detalle:
      "El podio de aliados ordena por los meses que sostienes la vigilancia: con S/ 5 al mes se llega igual que con S/ 500. Nadie es dueño de una zona ni de una entidad.",
  },
  {
    titulo: "Trazabilidad",
    resumen: "Cada aporte tiene su constancia pública.",
    detalle:
      "Cada aporte confirmado tiene una constancia pública con su código, y en «Cuánto cuesta Vigía» está en qué se gasta el fondo cada mes.",
  },
];

/** Comparación sin tildes ni mayúsculas: "cañete" encuentra "Cañete", "apurimac" encuentra "Apurímac". */
const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const porCola = (a: Pick<Zona, "pendientes" | "nombre">, b: Pick<Zona, "pendientes" | "nombre">) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, "es");

const ACCION = CLASE_ACCION_LISTA;

/**
 * /app/financiar — «Lo que falta leer»: una pregunta por pantalla (DESIGN_SYSTEM.md §14). Tres vistas (§14.1), en la
 * URL (`?por=entidad`, `?por=partido`): cuánto falta leer en tu zona, de cada entidad o de los gobiernos de cada
 * partido. Encabezado → Vistas → Indicadores (el déficit de lectura, cada cifra con su contexto) → la lista con la
 * anatomía de todo listado (§14.1) y, al costado, las reglas y los últimos aportes. La búsqueda vive en la URL (`?q=`):
 * se comparte y el botón atrás la deshace.
 *
 * Hasta el 2026-10-30 era «Financia una auditoría»: se pagaba la lectura de N contratos a «S/ X por contrato», la venta
 * de un servicio (auditoría legal). Ahora cada ficha lleva al aporte al fondo común con lo que se mira como destino
 * sugerido (ApoyarAlcance), y la cola se lee con ese fondo, lo más grave primero.
 */
export default async function FinanciarPage({
  searchParams,
}: {
  searchParams?: { ubigeo?: string; entidad?: string; por?: string; q?: string; pagina?: string; anio?: string; region?: string; orden?: string };
}) {
  // Llegada desde el mapa con la zona ya elegida (/app/financiar?ubigeo=21) → directo al paso de cantidad.
  const u = searchParams?.ubigeo;
  if (u && /^\d{2}(\d{2}(\d{2})?)?$/.test(u)) redirect(`/app/financiar/${u}`);
  // Lo mismo con una entidad ya elegida (?entidad=RUC).
  const ruc = searchParams?.entidad;
  if (ruc && /^\d{11}$/.test(ruc)) redirect(`/app/financiar/entidad/${ruc}`);

  const porPartido = searchParams?.por === "partido";
  const anioPartido = anioDeUrl(searchParams?.anio);
  const porEntidad = searchParams?.por === "entidad";
  const q = (searchParams?.q ?? "").trim().slice(0, 60);
  const paginaPedida = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  // Con dos letras o más la búsqueda también mira las provincias (una sola lista, cacheada).
  const buscaProvincias = !porEntidad && !porPartido && q.length >= 2;
  // Por entidad, el API busca desde 2 letras: una sola letra no filtra (y no se dice que filtra).
  const qEntidad = porEntidad && q.length >= 2 ? q : "";
  // Los filtros de las listas por entidad y por partido, en la URL: región (2 dígitos), búsqueda y orden.
  const region = /^\d{2}$/.test(searchParams?.region ?? "") ? searchParams!.region! : undefined;
  const qPartido = porPartido && q.length >= 2 ? q : "";
  const ordenPartido = esOrdenPartidos(searchParams?.orden) ? searchParams!.orden : ORDEN_PARTIDOS_DEFECTO;
  const [zonas, estado, aportes, resumenContratos, pago, provincias, entidades, entidadesSinBusqueda, partidos] = await Promise.all([
    getZonas("departamento"),
    getEstadoGlobal(),
    // Todos los aportes (de a 100, hasta 500), agrupados por quien los hizo: una línea por aliado y los tres últimos.
    getAportesAgrupados(),
    // Los publicados del año en curso (lo que se lee); la base trae además la historia desde 2015.
    getResumenContratos({ desde: desdeLectura() }),
    getPago(),
    buscaProvincias ? getZonas("provincia") : Promise.resolve(null),
    porEntidad
      ? getEntidadesFinanciables({ q: qEntidad || undefined, region, limit: TAM_ENTIDADES, offset: (paginaPedida - 1) * TAM_ENTIDADES })
      : Promise.resolve(null),
    // El conteo de la vista "Por entidad" (entidades con contratos en cola), si la lista de arriba no lo trae.
    porEntidad && !qEntidad && !region ? Promise.resolve(null) : getEntidadesFinanciables({ limit: 1 }),
    // Los partidos del período elegido, de 25 en 25: su cola, sus listos y lo que ya se leyó. Sin búsqueda,
    // solo los que tienen contratos esperando lectura.
    porPartido
      ? getRankingPartidos(anioPartido, {
          region,
          q: qPartido || undefined,
          conCola: !qPartido,
          orden: ordenPartido,
          limit: TAM_PARTIDOS,
          offset: (paginaPedida - 1) * TAM_PARTIDOS,
        })
      : Promise.resolve(null),
  ]);
  const totalEntidades = porEntidad && !qEntidad && !region ? entidades?.total : entidadesSinBusqueda?.total;
  // Las regiones elegibles en el filtro (las 25) y el nombre de la elegida.
  const opcionesRegion = (zonas ?? []).map((z) => ({ valor: z.ubigeo, etiqueta: z.nombre })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
  const nombreRegionElegida = opcionesRegion.find((r) => r.valor === region)?.etiqueta;
  const pagosAbiertos = !!pago?.configurado || !!pago?.tarjeta;

  // "Leídos" y "publicados" del año: la misma cifra del Inicio, el mapa y la portada (lib/cifras, DESIGN_SYSTEM.md
  // §10.1): todo contrato cuyo análisis terminó, por cualquier vía, sobre las convocatorias del año.
  const cifrasAnio = cifrasDeResumen(resumenContratos);

  // ─── La lista: regiones con cola, o lo que coincide con la búsqueda ───
  const deptos = (zonas ?? []).filter((z) => z.totalCola > 0);
  const nombreRegion = new Map((zonas ?? []).map((z) => [z.ubigeo, z.nombre]));
  let lista: ZonaListada[];
  if (q) {
    const t = norm(q);
    const pool: ZonaListada[] = [
      ...deptos.map((z) => ({ ...z, lugar: "Región" })),
      ...(provincias ?? [])
        .filter((p) => p.totalCola > 0)
        .map((p) => ({ ...p, lugar: `Provincia en ${nombreRegion.get(p.padreUbigeo ?? "") ?? "el Perú"}` })),
    ];
    lista = pool.filter((z) => norm(z.nombre).includes(t)).sort(porCola);
  } else {
    lista = [...deptos].sort(porCola);
  }
  const paginas = Math.max(1, Math.ceil(lista.length / TAM));
  const pagina = Math.min(paginas, paginaPedida);
  const fallaronProvincias = buscaProvincias && provincias === null;

  return (
    <Pagina className="space-y-8">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Lo que falta leer", href: "/app/financiar" }]} />
      <div className="space-y-4">
        {/* La pregunta de la pantalla va de título (plantilla de conversión, §14); el porqué, en el ⓘ. */}
        <EncabezadoPagina
          titulo={
            porPartido
              ? "¿Cuánto falta leer de los gobiernos de cada partido?"
              : porEntidad ? "¿Cuánto falta leer de cada entidad?" : "¿Cuánto falta leer en tu zona?"
          }
          bajada={
            porPartido
              ? `Los contratos de los gobiernos que ganó cada partido en ${periodoTexto(anioPartido)} que esperan su lectura a fondo. Se leen con el fondo común, lo más grave primero, y los resultados son públicos.`
              : porEntidad
                ? "Los contratos de cada entidad que esperan su lectura a fondo. Se leen con el fondo común, lo más grave primero, y los resultados son públicos."
                : "Los contratos de cada región que esperan su lectura a fondo. Se leen con el fondo común, lo más grave primero, y los resultados son públicos."
          }
          ayuda={
            porPartido ? (
              <Ayuda titulo="Cómo funciona">
                <span className="block">{EXPLICACION_PARTIDO}</span>
                <span className="mt-2 block">
                  El contrato se asocia por su fecha de convocatoria: queda con el partido que gobernaba la entidad ese mes (gobierno
                  regional, municipalidad provincial o distrital). Quién ganó sale del JNE.
                </span>
                <span className="mt-2 block">
                  “En cola” son los contratos que esperan su lectura a fondo; hoy entran solo {alcanceCorto(estado?.alcance)}.
                  “Leídos” son los que Vigía ya leyó.
                </span>
              </Ayuda>
            ) : (
              <Ayuda titulo="¿Qué es leer a fondo?">
                <span className="block">
                  El Estado publica todos sus contratos, pero nadie tiene capacidad de leerlos. Vigía cruza cada día todos
                  con registros públicos y lee completos los más graves, con la norma que respalda cada señal.
                </span>
                <span className="mt-2 block text-mute">
                  Esa lectura se paga con el fondo común: un aporte no compra la lectura de una región, una entidad ni un
                  resultado.
                </span>
              </Ayuda>
            )
          }
          acciones={
            <span className="flex flex-wrap items-center gap-2">
              <EnlaceAccion href="/app/apoyar">
                <HeartHandshake size={16} aria-hidden /> Ayúdanos a seguir vigilando
              </EnlaceAccion>
              <EnlaceAccion variante="fantasma" href="#independencia">
                <ShieldCheck size={16} className="text-granate" aria-hidden /> Reglas de independencia
              </EnlaceAccion>
            </span>
          }
        />
        {/* Dos poblaciones del mismo trámite (§14.1): se financia una zona o una entidad. */}
        <Vistas
          etiqueta="Cómo mirar lo que falta leer"
          vistas={[
            { href: "/app/financiar", etiqueta: "Por zona", conteo: zonas ? deptos.length : undefined, activa: !porEntidad },
            { href: "/app/financiar?por=entidad", etiqueta: "Por entidad", conteo: totalEntidades, activa: porEntidad },
            { href: "/app/financiar?por=partido", etiqueta: "Por partido", activa: porPartido },
          ]}
        />
        <CifrasFinanciar anio={cifrasAnio} estado={estado} regionesConCola={estado?.regionesConCola ?? deptos.length} />
        {!pagosAbiertos && (
          <p className="inline-flex flex-wrap items-center gap-1.5 text-meta text-inkSoft" role="note">
            <Clock size={14} className="shrink-0 text-granate" aria-hidden />
            <strong className="font-semibold text-ink">Los aportes todavía no están abiertos.</strong>
            <Ayuda titulo="¿Por qué no se puede aportar?">
              Aún no hay un medio de pago conectado. Hoy Vigía Perú se sostiene con su propio capital semilla. Puedes
              elegir una zona o una entidad para ver su cola, seguirla y mirar cómo avanza.
            </Ayuda>
          </p>
        )}
      </div>

      {/* La lista de zonas (o de entidades) y, al lado, lo que da confianza al aportar (las reglas de independencia) y los
          últimos aportes: la vista usa el ancho (§10.7). Por partido la lista usa TODO el ancho (cabe el costo, la barra
          y el botón) y la columna va debajo. */}
      <div className={porPartido ? "grid gap-8" : "grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]"}>
        {porPartido ? (
          /* ─── ELIGE EL PARTIDO (y el período) ─── */
          <Seccion
            id="partidos"
            titulo="Elige el partido"
            acciones={
              <FuenteDato
                fuente="JNE y OECE, API OCDS"
                enlaces={[
                  { texto: "Infogob (JNE)", href: INFOGOB_JNE },
                  { texto: "Contrataciones Abiertas (OECE)", href: CONTRATACIONES_ABIERTAS },
                ]}
              />
            }
          >
            <Listado
              ruta="/app/financiar"
              parametros={{ por: "partido", anio: String(anioPartido), q: qPartido || undefined, region, orden: searchParams?.orden && esOrdenPartidos(searchParams.orden) ? searchParams.orden : undefined }}
            >
              <div className="space-y-3">
                <SelectorPeriodo filtros={{ anio: anioPartido, region, q: qPartido || undefined, orden: ordenPartido }} />
                <FiltrosFinanciar
                  placeholder="Buscar un partido, por ejemplo Alianza para el Progreso"
                  etiquetaBusqueda="Buscar un partido por su nombre"
                  regiones={opcionesRegion}
                  ordenes={ORDENES_PARTIDOS}
                  ordenPorDefecto={ORDEN_PARTIDOS_DEFECTO}
                />
                <ResultadosConEspera filas={partidos?.data.length}>
                  <ResultadosPartidos
                    datos={partidos}
                    filtros={{ anio: anioPartido, region, q: qPartido || undefined, orden: ordenPartido, pagina: paginaPedida }}
                    nombreRegion={nombreRegionElegida}
                    alcance={estado?.alcance}
                  />
                </ResultadosConEspera>
              </div>
            </Listado>
          </Seccion>
        ) : porEntidad ? (
          /* ─── ELIGE LA ENTIDAD ─── */
          <Seccion
            id="entidades"
            titulo="Elige la entidad"
            descripcion="Sus contratos en cola y los que ya tienen sus documentos."
            ayuda={
              <Ayuda titulo="¿Qué entidades aparecen?">
                <span className="block">
                  Las que tienen contratos en cola, de más a menos. Buscando, aparecen todas las que coinciden, también las
                  que hoy no tienen nada en cola.
                </span>
                <span className="mt-2 block">Hoy entran a la cola solo {alcanceCorto(estado?.alcance)}.</span>
              </Ayuda>
            }
            acciones={<FuenteDato fuente="OECE, API OCDS" href={CONTRATACIONES_ABIERTAS} />}
          >
            <Listado ruta="/app/financiar" parametros={{ por: "entidad", q: qEntidad || undefined, region }}>
              <div className="space-y-3">
                <FiltrosFinanciar
                  placeholder="Buscar una entidad, por ejemplo Procesos Electorales, Puno o un RUC"
                  etiquetaBusqueda="Buscar una entidad por su nombre o su RUC"
                  regiones={opcionesRegion}
                />
                <ResultadosConEspera filas={entidades?.items.length}>
                  <ResultadosEntidades
                    datos={entidades}
                    q={qEntidad}
                    region={region}
                    nombreRegion={nombreRegionElegida}
                    pagina={paginaPedida}
                    alcance={estado?.alcance}
                  />
                </ResultadosConEspera>
              </div>
            </Listado>
          </Seccion>
        ) : (
          /* ─── ELIGE TU ZONA (sin mapa: el mapa vive en /app/mapa) ─── */
          <Seccion
            id="zonas"
            titulo="Elige la zona"
            descripcion={
              <>
                Contratos que esperan su lectura a fondo.{" "}
                <Link href="/app/mapa" className="font-medium text-granate underline underline-offset-2">Verlo en el mapa</Link>
              </>
            }
            ayuda={
              <Ayuda titulo="¿Qué zonas aparecen?">
                Las que tienen contratos en cola. Hoy entran solo {alcanceCorto(estado?.alcance)}. El punto de color es el
                estado de la zona, dicho también en palabras debajo de su nombre.
              </Ayuda>
            }
            acciones={<FuenteDato fuente="OECE, API OCDS" href={CONTRATACIONES_ABIERTAS} />}
          >
            <Listado ruta="/app/financiar" parametros={{ q: q || undefined }}>
              <div className="space-y-3">
                <BarraFiltros
                  busqueda={{ param: "q", placeholder: "Ej. Huamanga, Cañete, Cusco", etiqueta: "Buscar una región o provincia" }}
                />
                <ZonaResultados>
                  <ResultadosZonas
                    hayZonas={!!zonas}
                    lista={lista}
                    q={q}
                    pagina={pagina}
                    paginas={paginas}
                    fallaronProvincias={fallaronProvincias}
                  />
                </ZonaResultados>
              </div>
            </Listado>
          </Seccion>
        )}

        <div className="space-y-8">
          {/* ─── INDEPENDENCIA: lo que da confianza al aportar, a la vista junto a la lista (antes, al final de tres pantallas) ─── */}
          <ReglasIndependencia />

          {/* ─── ÚLTIMOS APORTES, por aliado (el orden por aliado vive en /app/aliados) ─── */}
          <Seccion
            titulo="Últimos aportes"
            descripcion="Nunca en soles: cada uno con su constancia pública."
            acciones={
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {/* La lista entera, con buscador: aquí van los más recientes. */}
                <Link href="/app/aliados/aportes" className="inline-flex min-h-[24px] items-center gap-1.5 text-dato leading-5 font-semibold text-granate underline-offset-2 hover:underline">
                  Todos los aportes <ArrowRight size={14} aria-hidden />
                </Link>
                <Link href="/app/aliados" className="inline-flex min-h-[24px] items-center gap-1.5 text-dato leading-5 font-semibold text-granate underline-offset-2 hover:underline">
                  Muro de aliados <ArrowRight size={14} aria-hidden />
                </Link>
              </span>
            }
          >
            {aportes ? (
              <AportesPorAliado datos={aportes} />
            ) : (
              <EstadoError titulo="No pudimos leer los últimos aportes">Vuelve a intentarlo en un momento.</EstadoError>
            )}
          </Seccion>
        </div>
      </div>
    </Pagina>
  );
}

/**
 * Las reglas que hacen que un aporte no compre nada, compactas en la columna de la derecha: una frase por regla y el
 * detalle a un clic (DESIGN_SYSTEM.md §10.7). Es lo que da confianza al aportar, así que va junto a la lista, no al
 * final de tres pantallas. El botón «Reglas de independencia» del encabezado baja hasta aquí.
 */
function ReglasIndependencia() {
  return (
    <section
      id="independencia"
      aria-labelledby="independencia-titulo"
      className="sobre-oscuro scroll-mt-20 overflow-hidden rounded-2xl bg-granate-deep text-paper"
    >
      <FranjaTextil alto={4} />
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div>
          <h2 id="independencia-titulo" className="inline-flex items-center gap-2 font-display text-bloque font-bold leading-tight text-balance">
            <ShieldCheck size={18} className="shrink-0 text-maiz" aria-hidden />
            Lo que tu aporte no compra
          </h2>
          <p className="mt-1 text-meta leading-snug text-paper/80">
            Va al fondo común de la vigilancia. Las reglas están en el código, no en una promesa.
          </p>
        </div>
        <ul className="divide-y divide-paper/15 border-y border-paper/15">
          {REGLAS.map((regla) => (
            <li key={regla.titulo} className="py-2 text-meta leading-snug">
              <span className="font-semibold text-paper">{regla.titulo}.</span> <span className="text-paper/75">{regla.resumen}</span>{" "}
              <Popover
                titulo={regla.titulo}
                anchoClase="w-80"
                className="min-h-[24px] align-baseline text-rotulo font-medium text-maiz underline underline-offset-2 hover:text-paper"
                trigger={<>cómo</>}
              >
                {regla.detalle}
              </Popover>
            </li>
          ))}
        </ul>
        <a href={REPO} target="_blank" rel="noopener noreferrer" className={claseAccion("contornoOscuro", "w-full")}>
          <Code2 size={15} aria-hidden /> Ver el código en GitHub
        </a>
      </div>
    </section>
  );
}

/** Lo que va en la zona de resultados: los cinco estados de §10.5, y la tabla. */
function ResultadosZonas({
  hayZonas,
  lista,
  q,
  pagina,
  paginas,
  fallaronProvincias,
}: {
  /** El API de zonas respondió. */
  hayZonas: boolean;
  lista: ZonaListada[];
  q: string;
  pagina: number;
  paginas: number;
  /** Se buscó en las provincias y esa lista no respondió. */
  fallaronProvincias: boolean;
}) {
  if (!hayZonas) {
    return (
      <EstadoError titulo="No pudimos leer las zonas" accion={<Link href="/app/financiar" className={ACCION}>Reintentar</Link>}>
        El servidor no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }
  if (lista.length === 0 && !q) {
    return (
      <EstadoVacio titulo="Ninguna zona tiene contratos en cola">
        Aparecen aquí cuando el OECE publica contratos que entran a la cola.
      </EstadoVacio>
    );
  }
  if (lista.length === 0 && fallaronProvincias) {
    return (
      <EstadoError titulo="No pudimos buscar en las provincias" accion={<Link href="/app/financiar" className={ACCION}>Ver todas las regiones</Link>}>
        Prueba con el nombre de la región.
      </EstadoError>
    );
  }
  if (lista.length === 0) {
    return (
      <EstadoVacio
        compacto
        titulo={`Ninguna zona con contratos en cola coincide con “${q}”`}
        accion={<Link href="/app/financiar" className={ACCION}>Quitar la búsqueda</Link>}
      >
        Prueba con el nombre de la región o de la provincia.
      </EstadoVacio>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Parcial (§10.5): se dice qué falta. */}
        {fallaronProvincias ? (
          <p className="text-meta text-mute" role="note">No pudimos buscar en las provincias: sólo se muestran regiones.</p>
        ) : (
          <span />
        )}
        <PaginacionZonas pagina={pagina} paginas={paginas} total={lista.length} q={q} />
      </div>
      <ListaZonas
        zonas={lista.slice((pagina - 1) * TAM, pagina * TAM)}
        etiqueta={q ? `Zonas que coinciden con “${q}”` : "Regiones con contratos en cola"}
      />
      {paginas > 1 && (
        <div className="flex justify-end">
          <PaginacionZonas pagina={pagina} paginas={paginas} total={lista.length} q={q} />
        </div>
      )}
    </div>
  );
}

function PaginacionZonas({ pagina, paginas, total, q }: { pagina: number; paginas: number; total: number; q: string }) {
  return (
    <Paginacion
      actual={pagina}
      paginas={paginas}
      total={total}
      tam={TAM}
      navegacion="url"
      hrefBase="/app/financiar"
      query={{ q: q || undefined }}
      cargando={false}
      nombre="zonas"
    />
  );
}

/**
 * El déficit de lectura, que es la razón de existir del producto, como `Indicadores` (§10.7): cada número grande con
 * lo que es y su contexto. Antes iban seis cifras dentro de una línea gris ("118 de 18,393 publicados leídos (0.64 %) ·
 * 100 financiados en 6 regiones…"): se perdía cuál número decía qué. El precio por contrato se quitó el 2026-10-30.
 *
 * Lo que no se pudo leer dice "Sin dato"; nunca un cero que parezca un dato.
 */
function CifrasFinanciar({
  anio,
  estado,
  regionesConCola,
}: {
  /** Publicados y leídos del año (lib/cifras); `null` si el resumen no respondió. */
  anio: CifrasAnio | null;
  estado: EstadoGlobal | null;
  /** Regiones con cola, con respaldo en la lista de zonas si el estado no lo trae. */
  regionesConCola: number;
}) {
  // Un formato por cifra (lib/cifras): «0.6 %» aquí, en el Inicio y en la portada (antes, «0.64 %» aquí y «0.7 %» allá).
  const pct = anio ? pctDe(anio.leidos, anio.publicados) : null;
  const items: Indicador[] = [
    {
      valor: anio ? numero(anio.leidos) : null,
      etiqueta: "contratos leídos",
      contexto: anio ? `de ${numero(anio.publicados)} publicados en ${anio.anio}${pct ? ` (${pct})` : ""}` : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué cuenta como leído?">
          Todo contrato cuyo análisis terminó, por cualquier vía, financiado o no. Es la misma cifra del Inicio, del mapa y
          de la portada.
        </Ayuda>
      ),
    },
  ];
  if (estado) {
    items.push(
      {
        valor: numero(estado.colaGlobal),
        etiqueta: "en cola",
        contexto: `en ${plural(regionesConCola, "región", "regiones")}`,
        ayuda: (
          <Ayuda titulo="¿Qué entra a la cola?">
            Contratos que esperan su lectura a fondo. Hoy entran solo {alcanceCorto(estado.alcance)}.
          </Ayuda>
        ),
      },
      {
        valor: numero(estado.contratosFinanciados),
        etiqueta: "asignados a lectura",
        contexto: `${numero(estado.contratosProcesados)} ya leídos, ${numero(estado.senalesHalladas)} con señales`,
        href: "/app/auditoria",
      },
    );
  }
  if (!estado) {
    return <p className="text-meta text-mute" role="note">No se pudo leer el estado del financiamiento. Vuelve a intentarlo en un momento.</p>;
  }
  return <CifrasEnFila items={items} />;
}
