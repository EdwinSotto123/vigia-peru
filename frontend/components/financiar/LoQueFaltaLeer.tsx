import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { HeartHandshake, ShieldCheck } from "lucide-react";
import { Ayuda, CabeceraPestana, EstadoError, EstadoVacio, Franja, FuenteDato } from "@/components/patrones";
import { BarraFiltros, Listado, Vistas, ZonaResultados } from "@/components/listado";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { EnlaceAccion, CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";
import { Paginacion } from "@/components/ui/Paginacion";
import { ListaZonas, type ZonaListada } from "./ListaZonas";
import { ResultadosEntidades, TAM_ENTIDADES } from "./ListaEntidades";
import { ORDEN_PARTIDOS_DEFECTO, ResultadosPartidos, TAM_PARTIDOS, hrefVistaPartido } from "./ListaPartidos";
import { FiltrosFinanciar, ResultadosConEspera } from "./FiltrosFinanciar";
import { PARAM_BUSCAR, PARAM_PAG, RUTA_FALTA, hrefFalta, queryFalta } from "./rutaFalta";
import { HREF_APOYO } from "@/components/sitio/VistasSeccion";
import { EXPLICACION_PARTIDO, ORDENES_PARTIDOS, PERIODOS_GOBIERNO, anioDeUrl, esOrdenPartidos, getRankingPartidos, periodoTexto } from "@/lib/partidosApi";
import { numero, plural } from "@/lib/formato";
import { CONTRATACIONES_ABIERTAS, INFOGOB_JNE } from "@/lib/fuentes";
import { alcanceCorto, getEntidadesFinanciables, getEstadoGlobal, getZonas, type EstadoGlobal, type Zona } from "@/lib/financiamiento";
import { desdeLectura, getResumenContratos } from "@/lib/contratos";
import { cifrasDeResumen, pctDe, type CifrasAnio } from "@/lib/cifras";

/** Zonas por página: las 25 regiones caben en una; una búsqueda amplia ("san") pagina. */
const TAM = 25;

/** Comparación sin tildes ni mayúsculas: "cañete" encuentra "Cañete", "apurimac" encuentra "Apurímac". */
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

const porCola = (a: Pick<Zona, "pendientes" | "nombre">, b: Pick<Zona, "pendientes" | "nombre">) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, "es");

export interface FiltrosFalta {
  por?: string;
  buscar?: string;
  pag?: string;
  anio?: string;
  region?: string;
  orden?: string;
}

/**
 * «Lo que falta leer», la pestaña `falta` de Auditoría en vivo (antes la página /app/financiar, con su propia entrada
 * del menú; auditoría visual del 2026-11-13: «Financiar dentro de Auditoría en vivo»). Cuántos contratos esperan su
 * lectura a fondo por región, por entidad o por los gobiernos de cada partido: el control segmentado elige cuál
 * (`?por=`), y cada fila abre su ficha (/app/financiar/[ubigeo], /entidad/[ruc], /partido/[clave]).
 *
 * Arriba, sólo las dos cifras que la pestaña suma a las de la auditoría (leídos del año y cola); lo de quien aporta (las
 * reglas de independencia, los últimos aportes) vive en Apoyar y aquí queda en una franja con su enlace: antes era una
 * columna oscura que repetía la de /app/apoyar.
 *
 * Los filtros van en la URL con nombre propio (`buscar`, `pag`: components/financiar/rutaFalta.ts). Server-safe.
 */
export async function LoQueFaltaLeer({ filtros }: { filtros: FiltrosFalta }) {
  const porPartido = filtros.por === "partido";
  const porEntidad = filtros.por === "entidad";
  const anioPartido = anioDeUrl(filtros.anio);
  const q = (filtros.buscar ?? "").trim().slice(0, 60);
  const paginaPedida = Math.max(1, Number.parseInt(filtros.pag ?? "1", 10) || 1);
  // Con dos letras o más la búsqueda también mira las provincias (una sola lista, cacheada).
  const buscaProvincias = !porEntidad && !porPartido && q.length >= 2;
  // Por entidad y por partido, el API busca desde 2 letras: una sola letra no filtra (y no se dice que filtra).
  const qEntidad = porEntidad && q.length >= 2 ? q : "";
  const qPartido = porPartido && q.length >= 2 ? q : "";
  const region = /^\d{2}$/.test(filtros.region ?? "") ? filtros.region : undefined;
  const ordenPartido = esOrdenPartidos(filtros.orden) ? filtros.orden : ORDEN_PARTIDOS_DEFECTO;

  const [zonas, estado, resumenContratos, provincias, entidades, entidadesSinBusqueda, partidos] = await Promise.all([
    getZonas("departamento"),
    getEstadoGlobal(),
    // Los publicados del año en curso (lo que se lee); la base trae además la historia desde 2015.
    getResumenContratos({ desde: desdeLectura() }),
    buscaProvincias ? getZonas("provincia") : Promise.resolve(null),
    porEntidad ? getEntidadesFinanciables({ q: qEntidad || undefined, region, limit: TAM_ENTIDADES, offset: (paginaPedida - 1) * TAM_ENTIDADES }) : Promise.resolve(null),
    // El conteo de la vista "Por entidad" (entidades con contratos en cola), si la lista de arriba no lo trae.
    porEntidad && !qEntidad && !region ? Promise.resolve(null) : getEntidadesFinanciables({ limit: 1 }),
    // Los partidos del período elegido, de 25 en 25. Sin búsqueda, sólo los que tienen contratos esperando lectura.
    porPartido
      ? getRankingPartidos(anioPartido, { region, q: qPartido || undefined, conCola: !qPartido, orden: ordenPartido, limit: TAM_PARTIDOS, offset: (paginaPedida - 1) * TAM_PARTIDOS })
      : Promise.resolve(null),
  ]);
  // Una lectura que falló no se guarda en caché como la pestaña.
  if (!zonas || !estado || (porEntidad && !entidades) || (porPartido && !partidos)) noStore();

  const totalEntidades = porEntidad && !qEntidad && !region ? entidades?.total : entidadesSinBusqueda?.total;
  const opcionesRegion = (zonas ?? []).map((z) => ({ valor: z.ubigeo, etiqueta: z.nombre })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
  const nombreRegionElegida = opcionesRegion.find((r) => r.valor === region)?.etiqueta;
  const cifrasAnio = cifrasDeResumen(resumenContratos);

  // ─── Por zona: regiones con cola, o lo que coincide con la búsqueda ───
  const deptos = (zonas ?? []).filter((z) => z.totalCola > 0);
  const nombreRegion = new Map((zonas ?? []).map((z) => [z.ubigeo, z.nombre]));
  let lista: ZonaListada[] = [];
  if (!porEntidad && !porPartido) {
    if (q) {
      const t = norm(q);
      const pool: ZonaListada[] = [
        ...deptos.map((z) => ({ ...z, lugar: "Región" })),
        ...(provincias ?? []).filter((p) => p.totalCola > 0).map((p) => ({ ...p, lugar: `Provincia en ${nombreRegion.get(p.padreUbigeo ?? "") ?? "el Perú"}` })),
      ];
      lista = pool.filter((z) => norm(z.nombre).includes(t)).sort(porCola);
    } else {
      lista = [...deptos].sort(porCola);
    }
  }
  const paginas = Math.max(1, Math.ceil(lista.length / TAM));
  const pagina = Math.min(paginas, paginaPedida);
  const fallaronProvincias = buscaProvincias && provincias === null;

  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Qué es leer a fondo?">
            <span className="block">
              El Estado publica todos sus contratos, pero nadie tiene capacidad de leerlos. Vigía cruza cada día todos con
              registros públicos y lee completos los más graves, con la norma que respalda cada señal.
            </span>
            <span className="mt-2 block">Hoy entran a la cola solo {alcanceCorto(estado?.alcance)}.</span>
            <span className="mt-2 block text-mute">Esa lectura se paga con el fondo común: un aporte no compra la lectura de una región, una entidad ni un resultado.</span>
          </Ayuda>
        }
      >
        Los contratos que esperan su lectura a fondo, por región, por entidad o por los gobiernos de cada partido.
      </CabeceraPestana>

      <CifrasFalta anio={cifrasAnio} estado={estado} regionesConCola={estado?.regionesConCola ?? deptos.length} />

      {/* Qué mirar: la población (zona, entidad o partido), en control segmentado; con partido, el período al lado. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <ConRotulo rotulo="Por">
          <Vistas
            etiqueta="Cómo mirar lo que falta leer"
            variante="secundaria"
            vistas={[
              { href: hrefFalta(), etiqueta: "Región", conteo: zonas ? deptos.length : undefined, activa: !porEntidad && !porPartido },
              { href: hrefFalta({ por: "entidad" }), etiqueta: "Entidad", conteo: totalEntidades, activa: porEntidad },
              { href: hrefFalta({ por: "partido" }), etiqueta: "Partido", activa: porPartido },
            ]}
          />
        </ConRotulo>
        {porPartido && (
          <ConRotulo rotulo="Gobiernos de">
            <Vistas
              etiqueta="Período de gobierno"
              variante="secundaria"
              vistas={PERIODOS_GOBIERNO.map((p) => ({
                href: hrefVistaPartido({ anio: p.anio, region, q: qPartido || undefined, orden: ordenPartido }),
                etiqueta: p.texto,
                activa: p.anio === anioPartido,
              }))}
            />
          </ConRotulo>
        )}
      </div>

      {porPartido ? (
        <Listado
          ruta={RUTA_FALTA}
          paramPagina={PARAM_PAG}
          parametros={queryFalta({ por: "partido", anio: String(anioPartido), [PARAM_BUSCAR]: qPartido || undefined, region, orden: esOrdenPartidos(filtros.orden) ? filtros.orden : undefined })}
        >
          <div className="space-y-3">
            <FiltrosFinanciar
              paramBusqueda={PARAM_BUSCAR}
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
            <p className="text-meta leading-snug text-mute">
              {EXPLICACION_PARTIDO} Cada contrato queda con el partido que gobernaba la entidad el mes en que se convocó ({periodoTexto(anioPartido)}).
            </p>
            <FuenteDato
              fuente="JNE y OECE, API OCDS"
              enlaces={[
                { texto: "Infogob (JNE)", href: INFOGOB_JNE },
                { texto: "Contrataciones Abiertas (OECE)", href: CONTRATACIONES_ABIERTAS },
              ]}
            />
          </div>
        </Listado>
      ) : porEntidad ? (
        <Listado ruta={RUTA_FALTA} paramPagina={PARAM_PAG} parametros={queryFalta({ por: "entidad", [PARAM_BUSCAR]: qEntidad || undefined, region })}>
          <div className="space-y-3">
            <FiltrosFinanciar
              paramBusqueda={PARAM_BUSCAR}
              placeholder="Buscar una entidad, por ejemplo Procesos Electorales, Puno o un RUC"
              etiquetaBusqueda="Buscar una entidad por su nombre o su RUC"
              regiones={opcionesRegion}
            />
            <ResultadosConEspera filas={entidades?.items.length}>
              <ResultadosEntidades datos={entidades} q={qEntidad} region={region} nombreRegion={nombreRegionElegida} pagina={paginaPedida} alcance={estado?.alcance} />
            </ResultadosConEspera>
            <FuenteDato fuente="OECE, API OCDS" href={CONTRATACIONES_ABIERTAS} />
          </div>
        </Listado>
      ) : (
        <Listado ruta={RUTA_FALTA} paramPagina={PARAM_PAG} parametros={queryFalta({ [PARAM_BUSCAR]: q || undefined })}>
          <div className="space-y-3">
            <BarraFiltros busqueda={{ param: PARAM_BUSCAR, placeholder: "Ej. Huamanga, Cañete, Cusco", etiqueta: "Buscar una región o provincia" }} />
            <ZonaResultados>
              <ResultadosZonas hayZonas={!!zonas} lista={lista} q={q} pagina={pagina} paginas={paginas} fallaronProvincias={fallaronProvincias} />
            </ZonaResultados>
            <FuenteDato fuente="OECE, API OCDS" href={CONTRATACIONES_ABIERTAS} />
          </div>
        </Listado>
      )}

      {/* Lo de quien aporta, una vez y con su enlace: las reglas y los aportes viven en Apoyar. */}
      <Franja
        icono={<ShieldCheck size={18} />}
        titulo="Ningún aporte elige qué se lee"
        accion={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <EnlaceAccion href={HREF_APOYO.aportar} variante="secundario">
              <HeartHandshake size={16} aria-hidden /> Ayúdanos a seguir vigilando
            </EnlaceAccion>
            <Link href="/app/apoyar#independencia" prefetch={false} className="text-dato font-semibold text-granate underline-offset-4 hover:underline">
              Reglas de independencia
            </Link>
          </span>
        }
      >
        La cola se lee con el fondo común, de lo más grave a lo menos grave. Lo que mirabas queda como destino sugerido en tu
        constancia, nada más, y cada aporte tiene su recibo público.
      </Franja>
    </div>
  );
}

function ConRotulo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
      <span className="shrink-0 text-meta font-medium text-mute">{rotulo}</span>
      {children}
    </div>
  );
}

/** Lo que va en la zona de resultados por zona: los cinco estados de §10.5, y la tabla a todo el ancho (con su barra). */
function ResultadosZonas({
  hayZonas,
  lista,
  q,
  pagina,
  paginas,
  fallaronProvincias,
}: {
  hayZonas: boolean;
  lista: ZonaListada[];
  q: string;
  pagina: number;
  paginas: number;
  fallaronProvincias: boolean;
}) {
  const accion = (texto: string) => (
    <Link href={hrefFalta()} className={CLASE_ACCION_LISTA}>
      {texto}
    </Link>
  );
  if (!hayZonas) {
    return (
      <EstadoError titulo="No pudimos leer las zonas" accion={accion("Reintentar")}>
        El servidor no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }
  if (lista.length === 0 && !q) {
    return <EstadoVacio titulo="Ninguna zona tiene contratos en cola">Aparecen aquí cuando el OECE publica contratos que entran a la cola.</EstadoVacio>;
  }
  if (lista.length === 0 && fallaronProvincias) {
    return (
      <EstadoError titulo="No pudimos buscar en las provincias" accion={accion("Ver todas las regiones")}>
        Prueba con el nombre de la región.
      </EstadoError>
    );
  }
  if (lista.length === 0) {
    return (
      <EstadoVacio compacto titulo={`Ninguna zona con contratos en cola coincide con “${q}”`} accion={accion("Quitar la búsqueda")}>
        Prueba con el nombre de la región o de la provincia.
      </EstadoVacio>
    );
  }
  const pag = (
    <Paginacion
      actual={pagina}
      paginas={paginas}
      total={lista.length}
      tam={TAM}
      navegacion="url"
      hrefBase={RUTA_FALTA}
      query={queryFalta({ [PARAM_BUSCAR]: q || undefined })}
      paramPagina={PARAM_PAG}
      cargando={false}
      nombre="zonas"
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {fallaronProvincias ? <p className="text-meta text-mute" role="note">No pudimos buscar en las provincias: sólo se muestran regiones.</p> : <span />}
        {pag}
      </div>
      <ListaZonas zonas={lista.slice((pagina - 1) * TAM, pagina * TAM)} etiqueta={q ? `Zonas que coinciden con “${q}”` : "Regiones con contratos en cola"} />
      {paginas > 1 && <div className="flex justify-end">{pag}</div>}
    </div>
  );
}

/**
 * Lo que esta pestaña suma a las cifras de la auditoría: cuánto se leyó del año y cuánto espera en la cola. Lo asignado
 * a lectura ya está arriba, en las cifras de la página. Lo que no se pudo leer dice «Sin dato», nunca un cero.
 */
function CifrasFalta({ anio, estado, regionesConCola }: { anio: CifrasAnio | null; estado: EstadoGlobal | null; regionesConCola: number }) {
  const pct = anio ? pctDe(anio.leidos, anio.publicados) : null;
  const items: Cifra[] = [
    {
      valor: anio ? numero(anio.leidos) : null,
      etiqueta: "contratos leídos",
      contexto: anio ? `de ${numero(anio.publicados)} publicados en ${anio.anio}${pct ? ` (${pct})` : ""}` : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué cuenta como leído?">
          Todo contrato cuyo análisis terminó, por cualquier vía, financiado o no. Es la misma cifra del Inicio, del mapa y de la portada.
        </Ayuda>
      ),
    },
    {
      valor: estado ? numero(estado.colaGlobal) : null,
      etiqueta: "en cola",
      contexto: estado ? `en ${plural(regionesConCola, "región", "regiones")}` : undefined,
      ayuda: <Ayuda titulo="¿Qué entra a la cola?">Contratos que esperan su lectura a fondo. Hoy entran solo {alcanceCorto(estado?.alcance)}.</Ayuda>,
    },
  ];
  return <CifrasEnFila items={items} />;
}
