/**
 * Capa C — la cadena de captura (API /cadena, combina Capa A + Capa B). Indicios para revisión humana, no acusación.
 */
import { API_BASE } from "./api-client";

export interface CadenaEmpresa {
  ruc: string;
  nombre: string | null;
  lazos: string[];
  contratos: number;
  monto: number;
}
export interface CadenaFuncionario {
  persona: string;
  cargo: string;
  organo: string;
}
export interface Cadena {
  disponible: boolean;
  entidad?: { ruc: string; nombre: string | null };
  partido?: string | null;
  autoridad?: string | null;
  cargo?: string | null;
  nivel?: string | null;
  captura?: { n_captura: number; n_financiaron: number; n_vendieron: number; n_socio: number } | null;
  empresas?: CadenaEmpresa[];
  decision?: { apruebaContratos: string; funcionarios: CadenaFuncionario[]; delGrafo: boolean };
}

async function leer<T>(ruta: string, revalidate = 600): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getCadenaEntidad = (ruc: string) =>
  /^\d{11}$/.test(ruc) ? leer<Cadena>(`/cadena/entidad/${ruc}`) : Promise.resolve(null);
