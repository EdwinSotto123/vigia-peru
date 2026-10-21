/**
 * Casos de corrupción (GET /corrupcion/*, migración 90, docs/CORRUPCION.md): informes de control de la Contraloría
 * (responsabilidad PRESUNTA) y casos de la Procuraduría Anticorrupción (sentencia firme y en trámite), por entidad,
 * región y partido. Lo comprobado y lo presunto nunca se suman.
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

export interface InformesControl {
  total: number;
  penal: number;
  civil: number;
  administrativa: number;
  funcionarios: number;
  entidades?: number;
  desde: string | null;
  hasta: string | null;
  ultimos: InformeControl[];
}

export interface CasosProcuraduria {
  corte: string;
  en_tramite: number;
  en_ejecucion: number;
  sentencias: number | null;
  reparacion_civil: number | null;
  casos_nuevos: number | null;
  url_fuente: string | null;
  sedes: { sede: string; en_tramite: number; en_ejecucion: number }[];
}

export interface Corrupcion {
  informes: InformesControl;
  departamento?: string | null;
  procuraduria?: CasosProcuraduria | null;
  /** Sólo en la de un partido: el mandato. */
  desde?: string;
  hasta?: string;
}

async function leer(ruta: string, base = API_BASE): Promise<Corrupcion | null> {
  try {
    const r = await fetch(`${base}${ruta}`, { next: { revalidate: 3600 } } as RequestInit);
    return r.ok ? ((await r.json()) as Corrupcion) : null;
  } catch {
    return null;
  }
}

export const getCorrupcionEntidad = (ruc: string) => leer(`/corrupcion/entidad/${ruc}`);
export const getCorrupcionPartido = (clave: string, anio: number) => leer(`/corrupcion/partido/${encodeURIComponent(clave)}?anio=${anio}`);
/** Desde el navegador (el panel de la región es de cliente). */
export const getCorrupcionRegion = (ubigeo: string) => leer(`/corrupcion/region/${ubigeo}`, baseApiNavegador());

/** "penal" → "Penal", etc. (los tipos del buscador de la Contraloría). */
export const TIPO_RESPONSABILIDAD: Record<string, string> = {
  penal: "Penal",
  civil: "Civil",
  administrativa_entidad: "Administrativa",
  administrativa_pas: "Sanción administrativa",
};
