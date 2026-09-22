/**
 * La señal, normalizada, con el agente que la produjo ya resuelto contra el catálogo.
 *
 * El dato del nexo agente→señal existe desde hace tiempo (`SenalRiesgo.agente`, migración 18
 * para `verificada`) y ningún componente lo usaba: una señal cotejada contra la fuente oficial
 * se veía idéntica a una sin cotejar, que es la diferencia entre una pista y una acusación.
 */

import type { CitaDocumento, SenalRiesgo } from "@/lib/auditoria";
import { claveDePaso } from "./catalogo";

export type Severidad = "alta" | "media" | "baja";

export interface SenalAgente {
  regla: string;
  severidad: Severidad;
  /** Clave del catálogo ("market"), o null si el backend no declaró agente. */
  agente: string | null;
  /** Lo que vino del backend, tal cual, para poder mostrarlo cuando no se resuelve. */
  agenteBruto: string | null;
  /** `banderas.verificacion.ok`: true cotejada, false cotejo fallido, null sin cotejo registrado. */
  verificada: boolean | null;
  evidencia: string | null;
  evidenciaTextual: string | null;
  norma: string | null;
  fuenteUrl: string | null;
  item: string | null;
  opinion: { num: string | null; url: string | null; snippet: string | null } | null;
  citas: CitaDocumento[];
}

export interface ConteoSenales {
  total: number;
  alta: number;
  media: number;
  baja: number;
  /** Cuántas de esas señales tienen un cotejo automático favorable. */
  verificadas: number;
  /** Cuántas traen registro de cotejo (favorable o no). Si es 0, este análisis no lo guarda. */
  conCotejo: number;
}

export const CONTEO_VACIO: ConteoSenales = { total: 0, alta: 0, media: 0, baja: 0, verificadas: 0, conCotejo: 0 };

export const ORDEN_SEVERIDAD: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };

export function contar(senales: SenalAgente[]): ConteoSenales {
  const c: ConteoSenales = { ...CONTEO_VACIO };
  for (const s of senales) {
    c.total++;
    c[s.severidad]++;
    if (s.verificada != null) c.conCotejo++;
    if (s.verificada === true) c.verificadas++;
  }
  return c;
}

/** Señales por clave de agente. Las que no declaran agente se agrupan bajo `sin_agente`. */
export const SIN_AGENTE = "sin_agente";

export function agruparPorAgente(senales: SenalAgente[]): Record<string, SenalAgente[]> {
  const out: Record<string, SenalAgente[]> = {};
  for (const s of senales) {
    const k = s.agente ?? SIN_AGENTE;
    (out[k] ??= []).push(s);
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad]);
  }
  return out;
}

/** La señal más grave que emitió un agente — es lo que decide el color de su fila en el eje. */
export function severidadMaxima(senales: SenalAgente[] | undefined): Severidad | null {
  if (!senales?.length) return null;
  return senales.reduce<Severidad>((peor, s) => (ORDEN_SEVERIDAD[s.severidad] < ORDEN_SEVERIDAD[peor] ? s.severidad : peor), "baja");
}

const sev = (v: unknown): Severidad => (v === "alta" || v === "media" ? v : "baja");
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** `SenalRiesgo` (GET /contratos/:ocid · /financiamiento/procesamientos/:ocid) → señal normalizada. */
export function desdeSenalRiesgo(s: SenalRiesgo): SenalAgente {
  return {
    regla: s.regla || "sin_regla",
    severidad: sev(s.severidad),
    agente: claveDePaso(s.agente),
    agenteBruto: txt(s.agente),
    verificada: typeof s.verificada === "boolean" ? s.verificada : null,
    evidencia: txt(s.evidencia),
    evidenciaTextual: null,
    norma: txt(s.norma),
    fuenteUrl: txt(s.fuenteUrl),
    item: null,
    opinion: null,
    citas: Array.isArray(s.citas) ? s.citas : [],
  };
}
