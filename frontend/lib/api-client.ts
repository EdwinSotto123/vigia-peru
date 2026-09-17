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

/** Página completa (con `total`) para /app/alertas — a diferencia de `getAlertas`, que
 *  otros call sites (mapa, landing) usan como lote fijo y descartan el conteo. */
export interface ApiAlertasPagina {
  data: ApiAlerta[];
  total: number;
  limit: number;
  offset: number;
}

export async function getAlertasPagina(params: {
  region?: string;
  estado?: string;
  scoreMin?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<ApiAlertasPagina> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  return get<ApiAlertasPagina>(`/alertas?${qs}`);
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

// ─── Entidades: página filtrada+paginada (server-side) + resumen global ─────
// `getEntidades` (arriba) sigue devolviendo el arreglo plano tal cual — lo consume
// components/mapa/EntidadesDeZona.tsx — así que no se le toca la forma. /app/entidades
// usa `getEntidadesPagina`, que sí trae `total` real (antes truncaba un batch de 100).

const TIPOS_ENTIDAD: ApiEntidad["tipo"][] = [
  "municipal_distrital",
  "municipal_provincial",
  "gobierno_regional",
  "ministerio",
  "empresa_publica",
  "organismo_autonomo",
];

export interface EntidadesQuery {
  q?: string;
  tipo?: ApiEntidad["tipo"];
  page?: number;
}

export const ENTIDADES_PAGE_SIZE = 20;

export function entidadesQueryString(q: EntidadesQuery = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === "" || (k === "page" && Number(v) <= 1)) continue;
    params.set(k, String(v));
  }
  return params.toString();
}

/** Lee `searchParams` de Next (strings sueltos) y deja solo lo válido — mismo patrón que parseContratosQuery. */
export function parseEntidadesQuery(sp: Record<string, string | string[] | undefined> = {}): EntidadesQuery {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const page = Math.max(1, Number(s("page") ?? 1) || 1);
  const tipo = s("tipo");
  return {
    page,
    q: s("q")?.slice(0, 120) || undefined,
    tipo: tipo && (TIPOS_ENTIDAD as string[]).includes(tipo) ? (tipo as ApiEntidad["tipo"]) : undefined,
  };
}

export interface EntidadesPagina {
  data: ApiEntidad[];
  total: number;
  page: number;
  size: number;
}

/** Página real del ranking de entidades con filtros server-side: GET /entidades?...&limit=&offset=. */
export async function getEntidadesPagina(query: EntidadesQuery = {}): Promise<EntidadesPagina> {
  const page = Math.max(1, query.page ?? 1);
  const size = ENTIDADES_PAGE_SIZE;
  const qs = new URLSearchParams();
  if (query.q) qs.set("q", query.q);
  if (query.tipo) qs.set("tipo", query.tipo);
  qs.set("limit", String(size));
  qs.set("offset", String((page - 1) * size));
  const r = await get<{ data: ApiEntidad[]; total: number; limit: number; offset: number }>(`/entidades?${qs}`);
  return { data: r.data, total: r.total, page, size };
}

export interface EntidadesResumen {
  totalEntidades: number;
  conAlertas: number;
  monto: number;
}

/** KPIs globales de todo el universo de entidades (no respeta filtros de búsqueda): GET /entidades/summary. */
export async function getEntidadesResumen(): Promise<EntidadesResumen> {
  const r = await get<{ total_entidades: number; con_alertas: number; monto: number }>(`/entidades/summary`);
  return { totalEntidades: r.total_entidades, conAlertas: r.con_alertas, monto: r.monto };
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
  confirmados?: "true" | "false";
  bbox?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ApiReporte[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const r = await get<{ data: ApiReporte[] }>(`/reportes?${qs}`);
  return r.data;
}

export interface ReportesPagina {
  data: ApiReporte[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Igual que `getReportes` pero devuelve el sobre completo con `total` real
 * (COUNT del backend) para paginar de verdad — lo usa /app/denuncias para
 * "página N de M". `getReportes` se deja intacto devolviendo solo el array:
 * MapaWrapper.tsx y el propio mapa de /app/denuncias ya dependen de esa forma
 * para pedir un batch grande sin paginar.
 */
export async function getReportesPagina(params: {
  region?: string;
  categoria?: string;
  confirmados?: "true" | "false";
  bbox?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ReportesPagina> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  return get<ReportesPagina>(`/reportes?${qs}`);
}

export async function getConvergencias(): Promise<ApiConvergencia[]> {
  const r = await get<{ data: ApiConvergencia[] }>(`/reportes/convergencias`);
  return r.data;
}
