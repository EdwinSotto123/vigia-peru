import { getRankingPaginado, type RankingPagina, type RankingQuery, type RankingRow } from "@/lib/financiamiento";

/**
 * El ranking de aliados en un solo lugar: el puesto (#1, #2…) que muestra /app/aliados,
 * el que dice el perfil ("#3 de 12 aliados") y el de su imagen para compartir salen de
 * estas funciones, así que no se pueden contradecir.
 *
 * Se ordena por contratos financiados —nunca por soles— y, a igualdad, quien aportó
 * primero: el mismo orden del API (`ORDER BY contratosFinanciados DESC, desde ASC`).
 * Los aportes sin nombre cuentan en las cifras pero no ocupan puesto.
 *
 * Sin JSX: lo usa también la imagen Open Graph (edge).
 */

export type Periodo = NonNullable<RankingQuery["periodo"]>;

/** Muestra que se trae entera (tope del API). Hasta acá el orden y las sumas son exactos en la página. */
export const MUESTRA_RANKING = 60;
/** Filas por página cuando hay más aliados que la muestra. */
export const TAM_PAGINA = 24;

export const PERIODO_LABEL: Record<Periodo, string> = {
  todo: "Desde el inicio",
  anio: "Este año",
  mes: "Este mes",
};

export function parsePeriodo(v: string | string[] | undefined): Periodo {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "mes" || s === "anio" ? s : "todo";
}

/** "regiones" es la clave histórica en la URL; cuenta zonas (ubigeos distintos), y así se nombra. */
export type ClaveOrden = "financiados" | "senales" | "regiones";

export const ORDEN_LABEL: Record<ClaveOrden, string> = {
  financiados: "Más contratos financiados",
  senales: "Más contratos con señales",
  regiones: "Más zonas alcanzadas",
};

export function parseOrden(v: string | string[] | undefined): ClaveOrden {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "senales" || s === "regiones" ? s : "financiados";
}

/** Href del perfil; un aporte sin slug no tiene perfil. */
export const hrefPerfil = (slug: string | null) => (slug ? `/aliado/${slug}` : undefined);

const esAnonimo = (r: RankingRow) => r.tipo === "persona" && (r.nombre === "Anónimo" || !r.nombre);

export interface FilaRanking extends RankingRow {
  /** Puesto por contratos financiados entre los aliados con nombre. */
  puesto: number;
}

const tiempo = (iso: string | null) => (iso ? Date.parse(iso) || 0 : Number.POSITIVE_INFINITY);

function porFinanciados(a: RankingRow, b: RankingRow): number {
  return b.contratosFinanciados - a.contratosFinanciados || tiempo(a.desde) - tiempo(b.desde) || a.nombre.localeCompare(b.nombre, "es");
}

/** Los aliados con nombre, con su puesto. */
export function clasificar(rows: RankingRow[]): FilaRanking[] {
  return rows
    .filter((r) => !esAnonimo(r))
    .sort(porFinanciados)
    .map((r, i) => ({ ...r, puesto: i + 1 }));
}

const VALOR: Record<ClaveOrden, (r: RankingRow) => number> = {
  financiados: (r) => r.contratosFinanciados,
  senales: (r) => r.senalesHalladas,
  regiones: (r) => r.zonas,
};

/**
 * Reordena la tabla por otra columna sin tocar el puesto: como en toda tabla de
 * posiciones, el "#" sigue siendo el de contratos financiados.
 */
function ordenar(filas: FilaRanking[], orden: ClaveOrden): FilaRanking[] {
  if (orden === "financiados") return filas;
  const v = VALOR[orden];
  return [...filas].sort((a, b) => v(b) - v(a) || a.puesto - b.puesto);
}

export interface Ranking {
  /**
   * Los tres primeros, destacados. Sólo por contratos financiados y en la primera página;
   * con uno o dos nombres también (el podio dibuja libres los puestos que faltan).
   */
  podio: FilaRanking[];
  /** El resto, en el orden elegido. */
  tabla: FilaRanking[];
  anonimos: { cantidad: number; contratos: number };
  /** Aliados con nombre en el ámbito. */
  totalNombres: number;
  /** La muestra trae a todos (≤ 60): las sumas y el orden de la página son exactos. */
  completa: boolean;
  paginas: number;
  /** Lo financiado por la muestra entera, con y sin nombre (exacto si `completa`). */
  sumas: { financiados: number; leidos: number; conSenal: number; enRevision: number };
}

/**
 * Arma lo que se dibuja a partir de la muestra (y, pasados los 60, de la página del API).
 */
export function armarRanking({
  muestra,
  pagina,
  orden,
  paginaActual,
}: {
  muestra: RankingPagina;
  pagina: RankingPagina | null;
  orden: ClaveOrden;
  paginaActual: number;
}): Ranking {
  const completa = (muestra.total ?? 0) <= MUESTRA_RANKING;
  const filas = muestra.data ?? [];
  const anon = filas.filter(esAnonimo);
  const clasificados = clasificar(filas);
  const conPodio = orden === "financiados" && paginaActual === 1 && clasificados.length > 0;
  const podio = conPodio ? clasificados.slice(0, 3) : [];
  const enPodio = new Set(podio.map((f) => f.id));

  // Pasados los 60 el orden lo pone el API y el puesto es su `posicion` (cuenta también
  // los aportes sin nombre: puede saltar un número).
  const tabla = completa
    ? ordenar(clasificados, orden).filter((f) => !enPodio.has(f.id))
    : (pagina?.data ?? []).filter((r) => !esAnonimo(r) && !enPodio.has(r.id)).map((r) => ({ ...r, puesto: r.posicion }));

  const suma = (f: (r: RankingRow) => number) => filas.reduce((n, r) => n + f(r), 0);
  return {
    podio,
    tabla,
    anonimos: { cantidad: anon.length, contratos: anon.reduce((n, r) => n + r.contratosFinanciados, 0) },
    totalNombres: completa ? clasificados.length : Math.max(clasificados.length, muestra.total - anon.length),
    completa,
    paginas: completa ? 1 : Math.max(1, Math.ceil((pagina?.total ?? muestra.total) / TAM_PAGINA)),
    sumas: {
      financiados: suma((r) => r.contratosFinanciados),
      leidos: suma((r) => r.contratosProcesados),
      conSenal: suma((r) => r.senalesHalladas),
      enRevision: suma((r) => r.enRevision ?? 0),
    },
  };
}

/**
 * El puesto de un aliado en el ranking de todo el Perú, desde el inicio: "#3 de 12".
 * `null` si no se puede saber (el API no responde, o el aliado queda fuera de la muestra).
 */
export async function puestoDe(slug: string): Promise<{ puesto: number; de: number } | null> {
  const muestra = await getRankingPaginado({ periodo: "todo", limit: MUESTRA_RANKING });
  if (!muestra) return null;
  const completa = muestra.total <= MUESTRA_RANKING;
  const filas = muestra.data ?? [];
  const clasificados = clasificar(filas);
  const fila = clasificados.find((f) => f.slug === slug);
  if (!fila) return null;
  const anonimos = filas.filter(esAnonimo).length;
  return { puesto: fila.puesto, de: completa ? clasificados.length : Math.max(clasificados.length, muestra.total - anonimos) };
}
