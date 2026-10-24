/**
 * Mapa de poder (API /poder, migración 125): captura por partido y por entidad. Indicios agregados para revisión humana.
 */
import { API_BASE } from "./api-client";

export interface PoderPartido {
  partido: string;
  n_entidades: number;
  n_departamentos: number;
  n_entidades_con_captura: number;
  n_captura: number;
  monto_captura: number;
  n_financiaron: number;
  n_vendieron: number;
  n_socio: number;
  n_empresas: number;
}

export interface PoderEntidad {
  entidad_ruc: string;
  entidad: string;
  nivel: string;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  partido: string;
  cargo_gob: string | null;
  autoridad: string | null;
  periodoInicio: string | null;
  periodoFin: string | null;
  n_captura: number;
  monto_captura: number;
  n_financiaron: number;
  n_vendieron: number;
  n_socio: number;
  n_empresas: number;
}

async function leer<T>(ruta: string, revalidate = 600): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getPoderPartidos = () => leer<{ data: PoderPartido[] }>(`/poder/partidos`);
export const getPoderEntidades = (f: { nivel?: string; departamento?: string; q?: string } = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const qs = p.toString();
  return leer<{ data: PoderEntidad[] }>(`/poder/entidades${qs ? `?${qs}` : ""}`);
};
export const getPoderPartido = (partido: string) =>
  leer<{ partido: PoderPartido; entidades: PoderEntidad[] }>(`/poder/partido/${encodeURIComponent(partido)}`);
export const getPoderEntidad = (ruc: string) => (/^\d{11}$/.test(ruc) ? leer<PoderEntidad>(`/poder/entidad/${ruc}`) : Promise.resolve(null));

export interface GrafoCaptura {
  entidad: { ruc: string; nombre: string | null };
  partido: string;
  cargoGob: string | null;
  autoridad: string | null;
  empresas: { ruc: string; nombre: string | null; lazos: string[]; contratos: number; monto: number }[];
}
export const getPoderGrafoEntidad = (ruc: string) =>
  /^\d{11}$/.test(ruc) ? leer<GrafoCaptura>(`/poder/entidad/${ruc}/grafo`) : Promise.resolve(null);

export interface GrafoPartido {
  partido: PoderPartido;
  entidades: { ruc: string; nombre: string; nivel: string; departamento: string | null; n_captura: number; monto_captura: number }[];
  /** Empresas «puente»: ganaron con indicio en 2+ de las entidades que gobierna el partido. `entidades` = sus RUC. */
  empresas: { ruc: string; nombre: string | null; entidades: string[]; lazos: string[]; contratos: number; n_entidades: number; monto: number }[];
}
export const getPoderGrafoPartido = (partido: string) =>
  partido ? leer<GrafoPartido>(`/poder/partido/${encodeURIComponent(partido)}/grafo`) : Promise.resolve(null);

/** Clave URL-segura de un partido (para enlazar), y su inverso aproximado no hace falta: la página usa el nombre. */
export const clavePartido = (p: string) => encodeURIComponent(p);
