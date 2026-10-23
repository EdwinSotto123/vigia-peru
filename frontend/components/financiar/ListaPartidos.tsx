import Link from "next/link";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { PaginacionNumerada } from "@/components/ui/PaginacionNumerada";
import { PERIODOS_GOBIERNO, type AnioGobierno, type FilaPartido, type OrdenPartidos, type RankingPartidos } from "@/lib/partidosApi";
import { alcanceCorto, type AlcanceProcesamiento } from "@/lib/financiamiento";
import { numero, plural, soles } from "@/lib/formato";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";

/**
 * La vista "Por partido" de /app/financiar: los partidos de un período con contratos esperando lectura, de 25
 * en 25, con filtro de región, búsqueda y orden en la URL. Cada fila lleva a /app/financiar/partido/[clave]?anio=,
 * donde se financia.
 *
 * Una fila, una línea:
 *   Partido y tipo, contratos y gobiernos | barra | en cola | leídos | costo | Financiar
 *
 * Server-safe: todo llega como datos planos desde page.tsx.
 */

/** Partidos por página. */
export const TAM_PARTIDOS = 25;

const ACCION = CLASE_ACCION_LISTA;

/** Los filtros de la vista, en el orden en que viajan por la URL. */
export interface FiltrosPartidosUrl {
  anio: AnioGobierno;
  region?: string;
  q?: string;
  orden?: OrdenPartidos;
  pagina?: number;
}

/** Orden por defecto: lo que más espera lectura. */
export const ORDEN_PARTIDOS_DEFECTO: OrdenPartidos = "cola";

export const queryPartidos = (f: FiltrosPartidosUrl): Record<string, string | undefined> => ({
  por: "partido",
  anio: String(f.anio),
  region: f.region || undefined,
  q: f.q || undefined,
  orden: f.orden && f.orden !== ORDEN_PARTIDOS_DEFECTO ? f.orden : undefined,
});

export const hrefVistaPartido = (f: FiltrosPartidosUrl) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(queryPartidos(f))) if (v) p.set(k, v);
  if (f.pagina && f.pagina > 1) p.set("pagina", String(f.pagina));
  return `/app/financiar?${p.toString()}`;
};

/** Los tres períodos como un control segmentado: el partido se elige DENTRO de un período. Cambiar de período conserva región y búsqueda. */
export function SelectorPeriodo({ filtros }: { filtros: FiltrosPartidosUrl }) {
  return (
    <nav aria-label="Período de gobierno" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-meta font-medium text-inkSoft">Gobiernos de</span>
      <ul className="inline-flex rounded-full border border-line bg-paperSoft p-0.5">
        {PERIODOS_GOBIERNO.map((p) => {
          const activo = p.anio === filtros.anio;
          return (
            <li key={p.anio}>
              <Link
                href={hrefVistaPartido({ ...filtros, anio: p.anio, pagina: 1 })}
                aria-current={activo ? "page" : undefined}
                scroll={false}
                className={
                  "inline-flex min-h-10 items-center rounded-full px-3.5 text-dato font-semibold tabular-nums transition-colors sm:min-h-9 " +
                  (activo ? "bg-granate text-paper" : "text-inkSoft hover:text-ink")
                }
              >
                {p.texto}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function columnas(precioPen: number | null, alcance: AlcanceProcesamiento | null | undefined): Columna[] {
  return [
    { clave: "partido", titulo: "Partido", ancho: "minmax(0,1.9fr)" },
    { clave: "barra", titulo: "", ancho: "minmax(0,0.6fr)", desde: "xl" },
    {
      clave: "cola",
      titulo: "En cola",
      ancho: "76px",
      alinear: "der",
      ayuda: (
        <Ayuda titulo="¿Qué es “en cola”?">
          Contratos de las entidades que el partido gobernó en el período, convocados en esos años, que esperan financiamiento
          para leerse. Hoy entran solo {alcanceCorto(alcance)}.
        </Ayuda>
      ),
    },
    {
      clave: "leidos",
      titulo: "Leídos",
      ancho: "96px",
      alinear: "der",
      desde: "md",
      ayuda: <Ayuda titulo="¿Qué cuenta “leídos”?">Contratos del partido en ese período que Vigía ya leyó, sobre todos los que tiene.</Ayuda>,
    },
    {
      clave: "costo",
      titulo: "Costo",
      ancho: "84px",
      alinear: "der",
      desde: "lg",
      ayuda: (
        <Ayuda titulo="¿Qué es el costo?">
          Lo que cuesta leer todos sus contratos en cola{precioPen != null ? `, a ${soles(precioPen)} cada uno` : ""}.
        </Ayuda>
      ),
    },
    { clave: "accion", titulo: "", ancho: "92px", alinear: "der", desde: "lg" },
  ];
}

const TIPO: Record<string, string> = { partido: "Partido", movimiento: "Movimiento regional", alianza: "Alianza electoral" };

function fila(f: FilaPartido, anio: AnioGobierno, precioPen: number | null, mayor: number): Fila {
  return {
    id: f.clave,
    href: `/app/financiar/partido/${f.clave}?anio=${anio}`,
    celdas: {
      partido: (
        <CeldaPrincipal
          enLinea
          titulo={f.nombre}
          textoCompleto={f.nombre}
          meta={[
            TIPO[f.tipo ?? ""] && <Dato key="t" tipo="tipo">{TIPO[f.tipo ?? ""]}</Dato>,
            <Dato key="c" tipo="documento" nombre="Contratos">
              {numero(f.contratos)} {f.contratos === 1 ? "contrato" : "contratos"} en {plural(f.gobiernosConContratos, "gobierno", "gobiernos")}
            </Dato>,
          ]}
        />
      ),
      barra: <CeldaBarra parte={f.enCola / mayor} resumen={`${numero(f.enCola)} contratos en cola, de ${numero(mayor)} en el partido con más`} />,
      cola: <CeldaNumero>{numero(f.enCola)}</CeldaNumero>,
      leidos: <CeldaNumero>{`${numero(f.leidos)} de ${numero(f.contratos)}`}</CeldaNumero>,
      costo: <CeldaNumero>{soles(precioPen != null ? f.enCola * precioPen : null)}</CeldaNumero>,
      // La fila entera es el enlace: esto es solo la señal visual de adónde lleva (no es un segundo botón).
      accion: (
        <span aria-hidden className="inline-flex min-h-8 items-center rounded-full border border-granate/40 px-3 text-meta font-semibold text-granate group-hover:bg-granate-50">
          Financiar
        </span>
      ),
    },
  };
}

/** Lo que va en la zona de resultados: error, vacío o la tabla con su paginación. */
export function ResultadosPartidos({
  datos,
  filtros,
  nombreRegion,
  precioPen,
  alcance,
}: {
  /** La página del ranking; `null` = la API no respondió. */
  datos: RankingPartidos | null;
  filtros: FiltrosPartidosUrl;
  /** El nombre de la región filtrada, para decirlo en palabras. */
  nombreRegion?: string;
  precioPen: number | null;
  alcance: AlcanceProcesamiento | null | undefined;
}) {
  const { anio, q, region } = filtros;
  if (!datos) {
    return (
      <EstadoError titulo="No pudimos leer los partidos" accion={<Link href={hrefVistaPartido(filtros)} className={ACCION}>Reintentar</Link>}>
        El servidor no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }
  const total = datos.total ?? datos.data.length;
  const items = datos.data;
  const paginas = Math.max(1, Math.ceil(total / TAM_PARTIDOS));
  const lugar = region ? ` en ${nombreRegion ?? "esa región"}` : "";
  if (items.length === 0 && total > 0) {
    return (
      <EstadoVacio compacto titulo="Esta página no tiene partidos" accion={<Link href={hrefVistaPartido({ ...filtros, pagina: 1 })} className={ACCION}>Ir a la página 1</Link>}>
        La lista llega hasta la página {numero(paginas)}.
      </EstadoVacio>
    );
  }
  if (items.length === 0) {
    const quitar = <Link href={hrefVistaPartido({ anio })} className={ACCION}>Quitar los filtros</Link>;
    return q ? (
      <EstadoVacio compacto titulo={`Ningún partido coincide con “${q}”${lugar}`} accion={quitar}>
        Prueba con otra parte del nombre{region ? " o con todo el Perú" : ""}.
      </EstadoVacio>
    ) : region ? (
      <EstadoVacio compacto titulo={`Ningún partido tiene contratos en cola${lugar} en este período`} accion={quitar}>
        Prueba con otra región o con otro período.
      </EstadoVacio>
    ) : (
      <EstadoVacio titulo="Ningún partido tiene contratos en cola en este período">
        Aparecen aquí cuando entran contratos de sus gobiernos a la cola.
      </EstadoVacio>
    );
  }
  const mayorCola = Math.max(1, ...items.map((x) => x.enCola));
  const pag = (
    <PaginacionNumerada
      actual={filtros.pagina ?? 1}
      total={total}
      tam={TAM_PARTIDOS}
      nombre={q ? (total === 1 ? "partido que coincide" : "partidos que coinciden") : total === 1 ? "partido con contratos en cola" : "partidos con contratos en cola"}
      hrefBase="/app/financiar"
      query={queryPartidos(filtros)}
    />
  );
  return (
    <div className="space-y-3">
      {pag}
      <Tabla
        columnas={columnas(precioPen, alcance)}
        filas={items.map((f) => fila(f, anio, precioPen, mayorCola))}
        etiqueta={q ? `Partidos que coinciden con “${q}”${lugar}` : `Partidos con contratos en cola${lugar}`}
        medida="contenedor"
        densidad="compacta"
      />
      {paginas > 1 && pag}
    </div>
  );
}
