import { API_BASE } from "./api-client";
import type { OrdenEmpresa } from "./empresas";

/**
 * Lista GENERAL de órdenes de compra y de servicio (subsección de Contratos). Fuente: GET /ordenes (no atada a un RUC).
 * Params prefijados con «o» para no chocar con los de la lista de contratos en la misma URL (es un toggle `?vista=ordenes`).
 * La API acota por año (defecto: el último) y pagina por fecha con `hayMas` (sin total exacto, para no contar millones).
 */
export type OrdenGeneral = OrdenEmpresa & {
  contratista: string | null;
  rucContratista: string | null;
  /** Campos que CONOSCE trae en el reporte de órdenes y que el panel muestra cuando vienen (suelen faltar en órdenes viejas). */
  objeto: string | null;            // BIENES | SERVICIOS | CONSULTORÍAS | OBRAS…
  fechaNotificacion: string | null; // cuándo se le notificó al proveedor
  fechaCompromiso: string | null;   // compromiso presupuestal (cuando la entidad separó la plata)
};

export interface OrdenesPagina {
  page: number;
  size: number;
  hayMas: boolean;
  anio: number | null;
  anios: number[];
  data: OrdenGeneral[];
}

export type FiltrosOrdenes = {
  q?: string; anio?: number; entidad?: string; proveedor?: string;
  tipo?: string; estado?: string; dudosa?: string; orden?: string; page?: number; size?: number;
};

async function leer<T>(ruta: string, revalidate = 300): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const consulta = (f: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return p.toString();
};

export const getOrdenes = (f: FiltrosOrdenes) => leer<OrdenesPagina>(`/ordenes?${consulta(f)}`);

/** Claves en la URL (prefijo «o»), para no pisar los filtros de la vista Contratos. */
export const P_ORD = {
  q: "oq", anio: "oanio", entidad: "oent", proveedor: "oprov",
  tipo: "otipo", estado: "oest", dudosa: "odud", orden: "oord", page: "opag",
} as const;

export function parseOrdenesQuery(sp?: Record<string, string | string[] | undefined>): FiltrosOrdenes {
  const g = (k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };
  const num = (k: string) => { const v = g(k); const x = v ? parseInt(v, 10) : NaN; return Number.isFinite(x) ? x : undefined; };
  return {
    q: g(P_ORD.q) || undefined,
    anio: num(P_ORD.anio),
    entidad: g(P_ORD.entidad) || undefined,
    proveedor: g(P_ORD.proveedor) || undefined,
    tipo: g(P_ORD.tipo) || undefined,
    estado: g(P_ORD.estado) || undefined,
    dudosa: g(P_ORD.dudosa) || undefined,
    orden: g(P_ORD.orden) || undefined,
    page: num(P_ORD.page),
  };
}

/** Los filtros (prefijados) para el estado del Listado: sin la página, con la vista fija. */
export function ordenesParametros(q: FiltrosOrdenes): Record<string, string> {
  const out: Record<string, string> = { vista: "ordenes" };
  const set = (k: string, v: unknown) => { if (v != null && v !== "") out[k] = String(v); };
  set(P_ORD.q, q.q); set(P_ORD.anio, q.anio); set(P_ORD.entidad, q.entidad); set(P_ORD.proveedor, q.proveedor);
  set(P_ORD.tipo, q.tipo); set(P_ORD.estado, q.estado); set(P_ORD.dudosa, q.dudosa); set(P_ORD.orden, q.orden);
  return out;
}
