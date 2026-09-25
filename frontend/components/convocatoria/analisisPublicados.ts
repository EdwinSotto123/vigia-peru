/**
 * Los análisis publicados como listado (DESIGN_SYSTEM.md §14.1): qué pide la URL, cómo se
 * filtra, cómo se ordena y cuánto queda en cada opción. Módulo puro: lo usan la página
 * pública (server component, lee `searchParams`) y el panel del equipo (cliente, lee
 * `useSearchParams`), así los dos listados filtran y cuentan exactamente igual.
 *
 * Antes el filtro vivía en `useState` dentro de la tabla: un enlace no llevaba el filtro,
 * el botón atrás no lo deshacía y el servidor pintaba siempre la lista entera.
 *
 * El nivel sale de `nivelDeAnalisis` (./sections/conteoRiesgo): el chip de cada fila, el
 * conteo de cada opción y el filtro usan la misma función, así que siempre suman lo mismo.
 */

import { API_BASE } from "@/lib/api-client";
import { esAlertaDemo } from "@/lib/semillas";
import type { CatFilter, SortKey } from "./types";
import { codigoCorto, inferCategoria } from "./utils";
import { nivelDeAnalisis, NIVELES, type NivelAnalisis } from "./sections/conteoRiesgo";

/** Una fila de `GET /alertas/analizadas` (backend/api/src/routes/alertas.ts). */
export interface AnalisisPublicado {
  codigo?: string | null;
  ocid: string;
  codigo_convocatoria?: string | null;
  score?: number | null;
  objeto?: string | null;
  monto?: number | null;
  region?: string | null;
  fecha_buena_pro?: string | null;
  analizado_en: string;
  entidad?: string | null;
  entidad_ruc?: string | null;
  proveedor_ruc?: string | null;
  n_banderas?: number | null;
  n_alta?: number | null;
  n_media?: number | null;
  n_baja?: number | null;
}

/** Sólo análisis reales: nunca las alertas de demo sembradas ni filas sin OCID o sin fecha de análisis. */
export const esAnalisisPublicado = (it: any): it is AnalisisPublicado => !!it && !esAlertaDemo(it) && !!it.ocid && !!it.analizado_en;

export const codigoDe = (it: Pick<AnalisisPublicado, "codigo_convocatoria" | "ocid">) => codigoCorto(it.codigo_convocatoria || it.ocid);

export const hrefAnalisis = (it: Pick<AnalisisPublicado, "codigo_convocatoria" | "ocid">) =>
  `/app/convocatoria/${encodeURIComponent(codigoDe(it))}`;

// ─── Lo que pide la URL ─────────────────────────────────────────────────────

/** Tipo deducido del objeto; `sin_tipo` = el objeto no dejó deducir uno. */
export type TipoAnalisis = Exclude<CatFilter, "todas"> | "sin_tipo";

export const TIPOS: TipoAnalisis[] = ["bienes", "servicios", "obras", "consultoria", "sin_tipo"];
// Aquí y no desde ./constants: ese módulo es "use client" y en el servidor sus objetos llegan
// como referencias de cliente, no como datos.
export const ETIQUETA_TIPO: Record<TipoAnalisis, string> = {
  bienes: "Bienes",
  servicios: "Servicios",
  obras: "Obras",
  consultoria: "Consultoría",
  sin_tipo: "Sin tipo",
};

export const tipoDe = (it: Pick<AnalisisPublicado, "objeto">): TipoAnalisis => {
  const c = inferCategoria(it.objeto);
  return c === "todas" ? "sin_tipo" : c;
};

/** En la URL, las mismas palabras que /app/contratos (`?riesgo=alto`): un enlace sirve en las dos. */
export const RIESGO_URL: Record<NivelAnalisis, string> = { alta: "alto", media: "medio", baja: "bajo", sin_senales: "sin_senales" };
const NIVEL_DE_URL = Object.fromEntries(NIVELES.map((n) => [RIESGO_URL[n], n])) as Record<string, NivelAnalisis>;

export const ORDENES: { valor: SortKey; etiqueta: string }[] = [
  { valor: "reciente", etiqueta: "Más recientes" },
  { valor: "score", etiqueta: "Mayor riesgo" },
  { valor: "monto", etiqueta: "Mayor monto" },
];
export const ORDEN_POR_DEFECTO: SortKey = "reciente";

export interface AnalisisQuery {
  q?: string;
  riesgo?: NivelAnalisis;
  tipo?: TipoAnalisis;
  zona?: string;
  orden: SortKey;
  pagina: number;
}

type SearchParams = Record<string, string | string[] | undefined> | { get(k: string): string | null } | null | undefined;

/** Lee los parámetros (de `searchParams` o de `useSearchParams`) y deja sólo lo válido. */
export function parseAnalisisQuery(sp: SearchParams): AnalisisQuery {
  const leer = (k: string): string | undefined => {
    if (!sp) return undefined;
    if (typeof sp.get === "function") return (sp as { get(k: string): string | null }).get(k) ?? undefined;
    const v = (sp as Record<string, string | string[] | undefined>)[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  const q = leer("q")?.trim().slice(0, 120) || undefined;
  const tipo = leer("tipo");
  const zona = leer("zona")?.trim().slice(0, 80) || undefined;
  const orden = leer("orden");
  return {
    q,
    riesgo: NIVEL_DE_URL[leer("riesgo") ?? ""],
    tipo: (TIPOS as string[]).includes(tipo ?? "") ? (tipo as TipoAnalisis) : undefined,
    zona,
    orden: ORDENES.some((o) => o.valor === orden) ? (orden as SortKey) : ORDEN_POR_DEFECTO,
    pagina: Math.max(1, Math.floor(Number(leer("pagina"))) || 1),
  };
}

/** Los parámetros actuales como datos planos (sin la página): para `Listado` y `Paginacion`. */
export function analisisQueryParams(query: AnalisisQuery): Record<string, string | undefined> {
  return {
    q: query.q,
    riesgo: query.riesgo ? RIESGO_URL[query.riesgo] : undefined,
    tipo: query.tipo,
    zona: query.zona,
    orden: query.orden === ORDEN_POR_DEFECTO ? undefined : query.orden,
  };
}

export const hayFiltros = (query: AnalisisQuery) => !!(query.q || query.riesgo || query.tipo || query.zona);

// ─── Filtrar, ordenar, contar ───────────────────────────────────────────────

type Faceta = "riesgo" | "tipo" | "zona";

/** Filtra por todo lo que pide la URL, salvo `omitir` (para contar las opciones de esa faceta). */
export function filtrarAnalisis(items: AnalisisPublicado[], query: AnalisisQuery, omitir?: Faceta): AnalisisPublicado[] {
  const q = query.q?.toLowerCase();
  return items.filter((it) => {
    if (q) {
      const texto = [it.codigo_convocatoria, it.ocid, it.objeto, it.entidad, it.entidad_ruc, it.proveedor_ruc].filter(Boolean).join(" ").toLowerCase();
      if (!texto.includes(q)) return false;
    }
    if (omitir !== "zona" && query.zona && it.region !== query.zona) return false;
    if (omitir !== "tipo" && query.tipo && tipoDe(it) !== query.tipo) return false;
    if (omitir !== "riesgo" && query.riesgo && nivelDeAnalisis(it) !== query.riesgo) return false;
    return true;
  });
}

/**
 * Ordena. Si la búsqueda es exactamente el código de un análisis, ese va primero: es lo que
 * buscaba quien pegó el código (antes, Enter lo abría directo).
 */
export function ordenarAnalisis(items: AnalisisPublicado[], query: AnalisisQuery): AnalisisPublicado[] {
  const out = [...items].sort((a, b) => {
    if (query.orden === "score") return (b.score || 0) - (a.score || 0);
    if (query.orden === "monto") return (b.monto || 0) - (a.monto || 0);
    return String(b.analizado_en || "").localeCompare(String(a.analizado_en || ""));
  });
  const exacto = codigoExacto(items, query.q);
  if (!exacto) return out;
  return [exacto, ...out.filter((it) => it !== exacto)];
}

/** El análisis cuyo código (u OCID) es exactamente lo que se buscó, si lo hay. */
export function codigoExacto(items: AnalisisPublicado[], q: string | undefined): AnalisisPublicado | null {
  if (!q) return null;
  const c = codigoCorto(q).toLowerCase();
  return items.find((it) => [it.codigo_convocatoria, it.ocid].some((v) => v && String(v).toLowerCase() === c)) ?? null;
}

export interface Opcion {
  valor: string;
  etiqueta: string;
  n: number;
}

/** Conteos de cada opción sobre los OTROS filtros activos: ninguna opción lleva a una lista vacía. */
export function facetasAnalisis(items: AnalisisPublicado[], query: AnalisisQuery) {
  const porRiesgo = filtrarAnalisis(items, query, "riesgo");
  const nivel: Record<NivelAnalisis, number> = { alta: 0, media: 0, baja: 0, sin_senales: 0 };
  for (const it of porRiesgo) {
    const n = nivelDeAnalisis(it);
    if (n) nivel[n]++;
  }

  const porTipo = new Map<TipoAnalisis, number>();
  for (const it of filtrarAnalisis(items, query, "tipo")) porTipo.set(tipoDe(it), (porTipo.get(tipoDe(it)) ?? 0) + 1);

  const porZona = new Map<string, number>();
  for (const it of filtrarAnalisis(items, query, "zona")) if (it.region) porZona.set(it.region, (porZona.get(it.region) ?? 0) + 1);

  return {
    riesgoTodas: porRiesgo.length,
    riesgo: nivel,
    tipo: TIPOS.filter((t) => porTipo.get(t)).map<Opcion>((t) => ({ valor: t, etiqueta: ETIQUETA_TIPO[t], n: porTipo.get(t)! })),
    zona: [...porZona.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "es"))
      .map<Opcion>(([z, n]) => ({ valor: z, etiqueta: z, n })),
  };
}

// ─── Datos ─────────────────────────────────────────────────────────────────

/** Tope de filas que devuelve el API (LIMIT de /alertas/analizadas): si llega a él, la lista es parcial. */
export const TOPE_API = 100;

export interface ListaAnalisis {
  items: AnalisisPublicado[];
  /** El API devolvió su tope de filas: puede haber más análisis que los listados. */
  parcial: boolean;
  /** El API no respondió: la página lo dice en vez de mostrar 0. */
  fallo: string | null;
}

/**
 * La lista del servidor (misma fuente que /api/agent/history). Se cachea 30 s como antes
 * en el navegador: un análisis recién publicado aparece en menos de un minuto.
 */
export async function getAnalisisPublicados(): Promise<ListaAnalisis> {
  try {
    const r = await fetch(`${API_BASE}/alertas/analizadas?limit=500`, { next: { revalidate: 30 } } as RequestInit);
    if (!r.ok) return { items: [], parcial: false, fallo: `El API respondió ${r.status}` };
    const d = (await r.json()) as { items?: unknown[] };
    const crudos = Array.isArray(d?.items) ? d.items : [];
    return { items: crudos.filter(esAnalisisPublicado), parcial: crudos.length >= TOPE_API, fallo: null };
  } catch (e) {
    return { items: [], parcial: false, fallo: (e as Error)?.message || "sin conexión" };
  }
}
