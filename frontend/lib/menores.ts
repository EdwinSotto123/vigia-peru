import { API_BASE } from "./api-client";

/**
 * Contratos menores (≤8 UIT) del SEACE. Fuente: GET /menores (prod4 contrato + prod6 requerimiento, unidos por código CM).
 * Params prefijados con «m» para convivir en la misma URL con los toggles de Contratos/Órdenes (?vista=menores).
 */
export interface ContratoMenor {
  id: number;
  codigo: string | null;
  numero: string | null;
  objeto: string | null;              // BIEN | SERVICIO
  descripcion: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  proveedor: string | null;
  proveedorRuc: string | null;
  monto: number | null;
  moneda: string | null;
  estado: string | null;              // estado del contrato (prod4)
  fecha: string | null;               // fecha de suscripción
  anio: number | null;
  tieneContrato: boolean;             // hay PDF del contrato (prod4)
  tieneRequerimiento: boolean;        // hay PDF del requerimiento/TDR (prod6)
  requerimientoNombre: string | null;
  estadoProceso: string | null;       // Vigente | En Evaluación | Culminado (prod6)
  fecPublica: string | null;
  cotizaDesde: string | null;
  cotizaHasta: string | null;
  // Identidad SUNAT del proveedor (seace_proveedor_sunat): giro, estado y antigüedad al ganar.
  provActividad: string | null;       // actividad económica (CIIU)
  provEstado: string | null;          // ACTIVO | BAJA… | SUSPENSION… (en SUNAT)
  provCondicion: string | null;       // HABIDO | NO HABIDO | NO HALLADO
  provDesde: string | null;           // fecha de inicio de actividades
  provTipo: string | null;            // tipo de contribuyente SUNAT
  provDiasAlGanar: number | null;     // días entre inicio de actividades y la firma del contrato
}

export interface MenoresPagina {
  page: number;
  size: number;
  hayMas: boolean;
  anclado: boolean;
  anio: number | null;
  anios: number[];
  data: ContratoMenor[];
}

export type FiltrosMenores = {
  q?: string; anio?: number; entidad?: string; proveedor?: string;
  objeto?: string; estado?: string; conReq?: string; orden?: string; page?: number; size?: number;
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

export const getMenores = (f: FiltrosMenores) => leer<MenoresPagina>(`/menores?${consulta(f)}`);

/** URL del PDF (proxy por nuestra API, que añade las cabeceras que el WAF del SEACE exige). */
export const urlRequerimiento = (id: number) => `${API_BASE}/menores/${id}/requerimiento`;
export const urlContratoMenor = (id: number) => `${API_BASE}/menores/${id}/contrato`;

/** Claves en la URL (prefijo «m»), para no pisar los filtros de Contratos/Órdenes. */
export const P_MEN = {
  q: "mq", anio: "manio", entidad: "ment", proveedor: "mprov",
  objeto: "mobj", estado: "mest", conReq: "mreq", orden: "mord", page: "mpag",
} as const;

export function parseMenoresQuery(sp?: Record<string, string | string[] | undefined>): FiltrosMenores {
  const g = (k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };
  const num = (k: string) => { const v = g(k); const x = v ? parseInt(v, 10) : NaN; return Number.isFinite(x) ? x : undefined; };
  return {
    q: g(P_MEN.q) || undefined,
    anio: num(P_MEN.anio),
    entidad: g(P_MEN.entidad) || undefined,
    proveedor: g(P_MEN.proveedor) || undefined,
    objeto: g(P_MEN.objeto) || undefined,
    estado: g(P_MEN.estado) || undefined,
    conReq: g(P_MEN.conReq) || undefined,
    orden: g(P_MEN.orden) || undefined,
    page: num(P_MEN.page),
  };
}

/** Filtros (prefijados) para el estado del Listado: sin la página, con la vista fija. */
export function menoresParametros(q: FiltrosMenores): Record<string, string> {
  const out: Record<string, string> = { vista: "menores" };
  const set = (k: string, v: unknown) => { if (v != null && v !== "") out[k] = String(v); };
  set(P_MEN.q, q.q); set(P_MEN.anio, q.anio); set(P_MEN.entidad, q.entidad); set(P_MEN.proveedor, q.proveedor);
  set(P_MEN.objeto, q.objeto); set(P_MEN.estado, q.estado); set(P_MEN.conReq, q.conReq); set(P_MEN.orden, q.orden);
  return out;
}
