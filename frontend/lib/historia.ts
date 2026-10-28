/**
 * La historia de una entidad, una empresa o un partido en una sola línea de tiempo (fase 3 del plan del 2026-10-27):
 * GET /historia/{entidad|empresa|partido}/:id de la API (backend/api/src/lib/historia.ts). Cada carril es un renglón: una
 * serie por mes (o por año) y sus hechos sueltos, cada uno con su fuente y dónde verificarlo; las marcas son los cambios
 * de gobierno y las elecciones; las secuencias, una cosa que llevó a otra (la visita y la buena pro, la gestión nueva y la
 * ola de órdenes a personas).
 */
import { API_BASE } from "@/lib/api-client";

export type Carril =
  | "gobierno"
  | "compras"
  | "ordenes"
  | "personas"
  | "menores"
  | "planilla"
  | "plazas"
  | "visitas"
  | "control"
  | "obras"
  | "politica"
  | "empresa"
  | "banderas"
  | "presupuesto";

export type SeveridadHistoria = "alta" | "media" | "baja";

export interface EventoHistoria {
  id: string;
  carril: Carril;
  tipo: string;
  fecha: string;
  hasta?: string | null;
  titulo: string;
  detalle?: string | null;
  monto?: number | null;
  severidad?: SeveridadHistoria | null;
  href?: string | null;
  fuente: string;
  enlace?: string | null;
}

export interface PuntoSerie {
  periodo: string;
  n: number;
  monto?: number | null;
  extra?: number | null;
}

export interface SerieHistoria {
  carril: Carril;
  titulo: string;
  medida: "n" | "monto";
  unidad: string;
  extra?: string | null;
  porAnio?: boolean;
  huecos: "cero" | "sin_dato";
  puntos: PuntoSerie[];
  fuente: string;
  enlace?: string | null;
  href?: string | null;
}

export interface MarcaHistoria {
  fecha: string;
  tipo: "gobierno" | "eleccion";
  texto: string;
}

export interface SecuenciaHistoria {
  id: string;
  tipo: string;
  severidad: SeveridadHistoria;
  titulo: string;
  explica: string;
  pasos: { fecha: string; texto: string }[];
  href?: string | null;
  fuente: string;
}

export interface Historia {
  sujeto: { tipo: "entidad" | "empresa" | "partido" | "contrato"; id: string; nombre: string | null };
  desde: string;
  hasta: string;
  carriles: { clave: Carril; titulo: string; explica: string }[];
  series: SerieHistoria[];
  eventos: EventoHistoria[];
  marcas: MarcaHistoria[];
  secuencias: SecuenciaHistoria[];
  omitidos: Partial<Record<Carril, number>>;
  fuentes: { texto: string; href: string }[];
  /** Empresa: hasta qué día llega el registro de visitas. */
  visitasHasta?: string | null;
}

export async function getHistoria(tipo: Historia["sujeto"]["tipo"], id: string): Promise<Historia | null> {
  const valido = tipo === "partido" ? /^[a-z0-9-]{2,120}$/.test(id) : tipo === "empresa" ? /^20\d{9}$/.test(id) : /^\d{11}$/.test(id);
  if (!valido) return null;
  try {
    const r = await fetch(`${API_BASE}/historia/${tipo}/${encodeURIComponent(id)}`, { next: { revalidate: 900 } } as RequestInit);
    return r.ok ? ((await r.json()) as Historia) : null;
  } catch {
    return null;
  }
}

// ─── Meses ──────────────────────────────────────────────────────────────────────────────────────

/** El mes «AAAA-MM» `k` meses después (o antes). */
export function sumarMes(mes: string, k: number): string {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Cuántos meses hay de `a` a `b` (0 si es el mismo). */
export function mesesDe(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];

/** «marzo de 2023». */
export function mesLargo(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

/** «mar. 2023». */
export function mesCorto(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES_CORTOS[m - 1]} ${a}`;
}

/** La inicial de cada mes, para el eje cuando se mira un tramo corto. */
export const INICIAL_MES = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** El hecho que va en un mes (un tramo, en todos los meses que cubre). */
export const mesDe = (fecha: string) => fecha.slice(0, 7);
