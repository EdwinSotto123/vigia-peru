/**
 * Cliente HTTP para el API Vigía Perú (Cloud Run).
 *
 * Pensado para llamarse desde **server components** de Next 14. Si se usa
 * desde un client component, prefija el env var con NEXT_PUBLIC_.
 *
 * El API ya devuelve los nombres camelCase que el frontend espera (ej. `montoSoles`,
 * `fechaBuenaPro`, `banderas[].opinionOece`) — no hace falta transformar.
 */

import type { Alerta, ReporteCiudadano } from "@/types";

export const API_BASE =
  process.env.VIGIA_API_URL ??
  process.env.NEXT_PUBLIC_VIGIA_API_URL ??
  "https://vigia-peru-api-36169102688.us-central1.run.app";

const DEFAULT_INIT: RequestInit = {
  // En server components: cachea 60s por URL+query. Ajustable si se necesita real-time.
  next: { revalidate: 60 } as any,
};

async function get<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...DEFAULT_INIT, ...init });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new ApiError(res.status, path, txt.slice(0, 200));
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, public path: string, public detail: string) {
    super(`[API ${status}] ${path}: ${detail}`);
  }
}

// ─── Tipos extendidos (lo que devuelve el API) ─────────────────

/** Alerta tal cual la lista del API la devuelve (con joins ya hechos). */
export type ApiAlerta = Alerta & {
  /** UUID interno de Postgres */
  codigo?: string;
  estado?: "activa" | "descartada" | "confirmada" | "en_revision";
};

export interface ApiEntidad {
  ruc: string;
  nombre: string;
  tipo:
    | "municipal_distrital" | "municipal_provincial"
    | "gobierno_regional" | "ministerio"
    | "empresa_publica" | "organismo_autonomo";
  region: string;
  provincia: string | null;
  distrito: string | null;
  pliegoNombreMef: string | null;
  alertas: number;
  monto: number;
  scorePromedio: number;
  reportes: number | null;
  contratos: number | null;
  contratosVigilados: number | null;
  serie: number[] | null;
}

export interface ApiReporte extends ReporteCiudadano {
  confirmaciones: number;
  convergenciaId: string | null;
}

export interface ApiConvergencia {
  id: string;
  alertaId: string;
  reporteIds: string[];
  lat: number;
  lon: number;
  resumen: string;
}

// ─── Endpoints ──────────────────────────────────────────────────

export async function getAlertas(params: {
  region?: string;
  estado?: string;
  scoreMin?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<ApiAlerta[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const r = await get<{ data: ApiAlerta[] }>(`/alertas?${qs}`);
  return r.data;
}

export async function getAlerta(id: string): Promise<ApiAlerta | null> {
  try {
    return await get<ApiAlerta>(`/alertas/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function getEntidades(params: {
  q?: string;
  region?: string;
  tipo?: string;
  limit?: number;
} = {}): Promise<ApiEntidad[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  const r = await get<{ data: ApiEntidad[] }>(`/entidades?${qs}`);
  return r.data;
}

export async function getEntidad(ruc: string) {
  try {
    return await get<{ entidad: any; mef: any; alertas: any[] }>(
      `/entidades/${ruc}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export interface MediaItem {
  url: string;
  tipo: "foto" | "video" | "documento" | "audio";
  filename?: string | null;
  size_bytes?: number | null;
  content_type?: string | null;
}

export async function createReporte(payload: {
  modo: "obra" | "entidad";
  categoria: string;
  descripcion: string;
  fotoUrl?: string | null;
  media?: MediaItem[];
  lat?: number | null;
  lon?: number | null;
  direccionTexto?: string | null;
  region?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  rucEntidad?: string | null;
  montoEstimado?: number | null;
  periodoDesde?: string | null;
  periodoHasta?: string | null;
  personasInvolucradas?: string | null;
  enlacesExternos?: string[];
  contactoEmail?: string | null;
  contactoNombre?: string | null;
  contactoTelefono?: string | null;
  anonimo?: boolean;
}): Promise<{ id: string; ok: true }> {
  const r = await fetch(`${API_BASE}/reportes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) throw new ApiError(r.status, "/reportes", JSON.stringify(data).slice(0, 200));
  return data;
}

export async function getReportes(params: {
  region?: string;
  categoria?: string;
  bbox?: string;
  limit?: number;
} = {}): Promise<ApiReporte[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const r = await get<{ data: ApiReporte[] }>(`/reportes?${qs}`);
  return r.data;
}

export async function getConvergencias(): Promise<ApiConvergencia[]> {
  const r = await get<{ data: ApiConvergencia[] }>(`/reportes/convergencias`);
  return r.data;
}
