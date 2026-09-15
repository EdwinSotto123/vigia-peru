/**
 * Cliente y tipos de "Auditoría en vivo".
 * Backend: backend/api/src/routes/procesamientos.ts (lee la vista `procesamientos_publico`
 * que escribe el dispatcher, backend/dispatcher).
 * Plan:    docs/superpowers/plans/2026-09-14-vigia-utilizable.md · "Interfaces compartidas"
 *
 * Mismo contrato que lib/financiamiento.ts: los GET devuelven `null` si el API no
 * responde. Ningún tablero debe romper una página por un endpoint caído.
 */

import { API_BASE } from "./api-client";

export type EstadoProc = "encolado" | "procesando" | "procesado" | "error" | "pendiente_de_procesamiento";

export interface Procesamiento {
  ocid: string;
  estado: EstadoProc;
  faseActual: string | null;          // p.ej. "market"
  faseIndex: number | null;           // 0..9 (10 = final)
  iniciadoAt: string | null;
  finalizadoAt: string | null;
  intentos: number;
  contribucionCodigo: string;         // VIG-2026-00002
  financiador: string;                // nombre público o "Anónimo"
  financiadorVisible: boolean;
  ubigeo: string;                     // zona de la contribución
  zona: string;
  titulo: string | null;              // convocatorias.objeto
  entidad: string | null;
  montoPen: number | null;            // cuantia_referencial
  alertaCodigo: string | null;        // cuando procesado
  score: number | null;
  banderas: number;                   // cuando procesado
}

export interface EventoFase {
  ts: string;
  kind: "phase" | "warn" | "error" | "final";
  name: string;
  msg: string | null;
}

export type ProcesamientoDetalle = Procesamiento & { eventos: EventoFase[] };

export interface ResumenProcesamientos {
  porEstado: Record<string, number>;
  procesadosHoy: number;
}

/** Orden real del pipeline (backend/agent/deterministic.py · backend/dispatcher/events.py). */
export const FASES: { key: string; label: string; agente: string }[] = [
  { key: "compliance", label: "Reglas de contratación", agente: "compliance_agent" },
  { key: "document_parser", label: "Lectura del expediente", agente: "document_parser_agent" },
  { key: "document_legal_analyst", label: "Análisis legal de bases", agente: "document_legal_analyst_agent" },
  { key: "market", label: "Precios de mercado", agente: "market_price_agent" },
  { key: "web_research", label: "Investigación web", agente: "web_research_agent" },
  { key: "news_research", label: "Prensa", agente: "news_research_agent" },
  { key: "entity_personnel", label: "Funcionarios de la entidad", agente: "entity_personnel_agent" },
  { key: "person_network", label: "Red de personas", agente: "person_network_agent" },
  { key: "compliance_extended", label: "Cumplimiento extendido", agente: "compliance_extended_agent" },
  { key: "report_writer", label: "Dictamen", agente: "report_writer_agent" },
];

export const TOTAL_FASES = FASES.length;

export const ESTADO_PROC: Record<EstadoProc, { label: string; cls: string }> = {
  encolado: { label: "En cola", cls: "bg-paperDeep text-mute" },
  procesando: { label: "Procesando", cls: "bg-amber-soft text-amber" },
  procesado: { label: "Procesado", cls: "bg-moss/10 text-moss" },
  error: { label: "Reintentando", cls: "bg-crimson-soft text-crimson" },
  pendiente_de_procesamiento: { label: "Pendiente de procesamiento", cls: "bg-paperDeep text-amber" },
};

/** URL del API utilizable desde client components (NEXT_PUBLIC_* se inyecta en build). */
export const PUBLIC_API_BASE =
  process.env.NEXT_PUBLIC_VIGIA_API_URL ?? "https://vigia-peru-api-36169102688.us-central1.run.app";

async function getJson<T>(path: string, revalidate = 5): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { next: { revalidate } } as any);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface ProcesamientosQuery {
  ubigeo?: string;
  codigo?: string;
  estado?: EstadoProc;
  limit?: number;
}

export function procesamientosQueryString(q: ProcesamientosQuery = {}): string {
  const params = new URLSearchParams(
    Object.entries(q)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
  return params.toString();
}

export const getProcesamientos = (q: ProcesamientosQuery = {}) =>
  getJson<{ data: Procesamiento[] }>(`/financiamiento/procesamientos?${procesamientosQueryString(q)}`).then((r) => r?.data ?? null);

export const getProcesamiento = (ocid: string) =>
  getJson<ProcesamientoDetalle>(`/financiamiento/procesamientos/${encodeURIComponent(ocid)}`, 3);

export const getResumenProcesamientos = () =>
  getJson<ResumenProcesamientos>(`/financiamiento/procesamientos/resumen`, 10);

// ─── Helpers de presentación ─────────────────────────────────────────────────

/** Etiqueta humana de una fase; para nombres fuera del pipeline devuelve el nombre tal cual. */
export function faseLabel(key: string | null | undefined): string {
  if (!key) return "En espera";
  if (key === "started") return "Iniciando";
  if (key === "final") return "Dictamen publicado";
  return FASES.find((f) => f.key === key)?.label ?? key.replace(/_/g, " ");
}

/** Progreso 0..100 de un procesamiento según su fase. */
export function faseProgreso(p: Pick<Procesamiento, "estado" | "faseIndex">): number {
  if (p.estado === "procesado") return 100;
  if (p.estado === "encolado") return 0;
  const i = p.faseIndex ?? 0;
  return Math.max(0, Math.min(100, Math.round((i / TOTAL_FASES) * 100)));
}

/** "hace 3 s" · "hace 2 min" · "hace 1 h" */
export function haceCuanto(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** "2 min 13 s" · "48 s" · "1 h 04 min" */
export function duracion(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

export const esActivo = (estado: EstadoProc) => estado === "encolado" || estado === "procesando";
