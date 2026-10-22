/**
 * Casos de corrupción (GET /corrupcion/*, migración 90, docs/CORRUPCION.md): informes de control de la Contraloría
 * (responsabilidad PRESUNTA) y casos de la Procuraduría Anticorrupción (sentencia firme y en trámite), por entidad,
 * región y partido. Lo comprobado y lo presunto nunca se suman.
 *
 * Cada respuesta trae los conteos de TODOS los informes y una página de la lista (filtrable por tipo): la web muestra
 * la lista entera, paginada.
 */
import { API_BASE, baseApiNavegador } from "./api-client";

export interface InformeControl {
  numero: string;
  titulo: string | null;
  fecha: string | null;
  responsabilidades: string[];
  funcionarios: number | null;
  urlPdf: string | null;
  entidad: string | null;
  entidadRuc: string | null;
}

export type TipoInforme = "penal" | "civil" | "administrativa";

export interface PaginaInformes {
  page: number;
  size: number;
  tipo: TipoInforme | null;
  /** Cuántos cumplen el filtro (todas las páginas). */
  total: number;
  filas: InformeControl[];
}

export interface InformesControl {
  total: number;
  penal: number;
  civil: number;
  administrativa: number;
  funcionarios: number;
  entidades: number;
  desde: string | null;
  hasta: string | null;
  pagina: PaginaInformes;
}

export interface CasosProcuraduria {
  corte: string;
  en_tramite: number;
  en_ejecucion: number;
  sentencias: number | null;
  reparacion_civil: number | null;
  casos_nuevos: number | null;
  url_fuente: string | null;
  sedes: { sede: string; en_tramite: number; en_ejecucion: number; sentencias?: number | null; reparacion_civil?: number | null }[];
}

export interface Corrupcion {
  informes: InformesControl;
  departamento?: string | null;
  procuraduria?: CasosProcuraduria | null;
  /** Sólo en la de un partido: el mandato. */
  desde?: string;
  hasta?: string;
}

/** Filas por página de la tabla de informes. */
export const TAM_INFORMES = 10;

/** La ruta de la API (sin la página ni el tipo): la usa la tabla para pedir las páginas siguientes. */
export const rutaCorrupcion = {
  entidad: (ruc: string) => `/corrupcion/entidad/${ruc}`,
  region: (ubigeo: string) => `/corrupcion/region/${ubigeo}`,
  partido: (clave: string, anio: number) => `/corrupcion/partido/${encodeURIComponent(clave)}?anio=${anio}`,
};

/** Una página: `ruta` de rutaCorrupcion, más la página y el tipo. */
export function urlCorrupcion(ruta: string, page = 1, tipo: TipoInforme | null = null, q: string | null = null): string {
  const [base, qs] = ruta.split("?");
  const p = new URLSearchParams(qs);
  p.set("page", String(page));
  p.set("size", String(TAM_INFORMES));
  if (tipo) p.set("tipo", tipo);
  if (q && q.trim().length >= 2) p.set("q", q.trim());
  return `${base}?${p.toString()}`;
}

async function leer(ruta: string, base = API_BASE): Promise<Corrupcion | null> {
  try {
    const r = await fetch(`${base}${urlCorrupcion(ruta)}`, { next: { revalidate: 3600 } } as RequestInit);
    return r.ok ? ((await r.json()) as Corrupcion) : null;
  } catch {
    return null;
  }
}

export const getCorrupcionEntidad = (ruc: string) => leer(rutaCorrupcion.entidad(ruc));
export const getCorrupcionPartido = (clave: string, anio: number) => leer(rutaCorrupcion.partido(clave, anio));
/** Desde el navegador (el panel de la región es de cliente). */
export const getCorrupcionRegion = (ubigeo: string) => leer(rutaCorrupcion.region(ubigeo), baseApiNavegador());

/** Otra página, otro filtro u otra búsqueda (asunto, número o entidad), desde el navegador. */
export async function paginaCorrupcion(ruta: string, page: number, tipo: TipoInforme | null, q: string | null = null): Promise<PaginaInformes | null> {
  try {
    const r = await fetch(`${baseApiNavegador()}${urlCorrupcion(ruta, page, tipo, q)}`);
    return r.ok ? ((await r.json()) as Corrupcion).informes.pagina : null;
  } catch {
    return null;
  }
}

/** "penal" → "Penal", etc. (los tipos del buscador de la Contraloría). */
export const TIPO_RESPONSABILIDAD: Record<string, string> = {
  penal: "Penal",
  civil: "Civil",
  administrativa_entidad: "Administrativa",
  administrativa_pas: "Sanción administrativa",
};
