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
  /** Un tercer número (las visitas a quien decide). */
  extra2?: number | null;
}

export interface SerieHistoria {
  carril: Carril;
  titulo: string;
  medida: "n" | "monto";
  unidad: string;
  extra?: string | null;
  /** Qué es `extra2`, si lo trae. */
  extra2?: string | null;
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

/** Un hecho de un hilo: lo que pasó entre una misma empresa y la entidad, con su fecha. */
export interface HechoHilo {
  fecha: string;
  hasta?: string | null;
  tipo: "visitas" | "despues" | "contrato" | "obra" | "paralizada" | "sancion";
  titulo: string;
  detalle?: string | null;
  monto?: number | null;
  severidad?: SeveridadHistoria | null;
  href?: string | null;
}

/** Una empresa y lo que pasó entre ella y la entidad en el tiempo (sólo si junta dos clases de hechos o más). */
export interface HiloHistoria {
  ruc: string;
  nombre: string;
  resumen: string;
  severidad: SeveridadHistoria;
  hechos: HechoHilo[];
  href: string;
}

/** Un patrón de sus series: un pico fuera de lo normal, el gasto al cierre del año o lo de antes de una elección. */
export interface PatronHistoria {
  id: string;
  tipo: "pico" | "fin_de_anio" | "antes_eleccion";
  severidad: SeveridadHistoria;
  titulo: string;
  explica: string;
  carril: Carril;
  mes: string;
  hasta?: string | null;
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
  /** Entidad: las empresas cuyos hechos con ella se encadenan en el tiempo (la vista «Hilos»). */
  hilos?: HiloHistoria[];
  /** Los patrones de sus series (picos, cierre del año, antes de una elección). */
  patrones?: PatronHistoria[];
  omitidos: Partial<Record<Carril, number>>;
  fuentes: { texto: string; href: string }[];
  /** Empresa: hasta qué día llega el registro de visitas. */
  visitasHasta?: string | null;
}

export async function getHistoria(tipo: Historia["sujeto"]["tipo"], id: string): Promise<Historia | null> {
  const valido =
    tipo === "partido" ? /^[a-z0-9-]{2,120}$/.test(id)
    : tipo === "empresa" ? /^20\d{9}$/.test(id)
    : tipo === "contrato" ? /^[A-Za-z0-9-]{3,100}$/.test(id)
    : /^\d{11}$/.test(id);
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

// ─── Lo normal de cada renglón ──────────────────────────────────────────────────────────────────

/** Lo mínimo que tiene que sumar un mes para que se marque como pico (la misma regla que patronesDeSeries de la API). */
export const MINIMO_PICO: Partial<Record<Carril, number>> = { compras: 5, ordenes: 30, personas: 10, plazas: 5, visitas: 30 };

/**
 * Lo normal de cada mes de una serie mensual: la mediana de sus doce meses anteriores (con al menos seis), y cuántas
 * veces lo normal es ese mes. Con `huecos: "cero"` un mes sin fila cuenta como cero. Por periodo «AAAA-MM».
 */
export function normalDeSerie(s: SerieHistoria): Map<string, { mediana: number; veces: number }> {
  const out = new Map<string, { mediana: number; veces: number }>();
  if (s.porAnio || !s.puntos.length) return out;
  const ordenados = [...s.puntos].sort((a, b) => a.periodo.localeCompare(b.periodo));
  const meses: { mes: string; v: number }[] = [];
  if (s.huecos === "sin_dato") meses.push(...ordenados.map((p) => ({ mes: p.periodo, v: p.n })));
  else {
    const por = new Map(ordenados.map((p) => [p.periodo, p.n]));
    for (let m = ordenados[0].periodo; m <= ordenados[ordenados.length - 1].periodo; m = sumarMes(m, 1)) meses.push({ mes: m, v: por.get(m) ?? 0 });
  }
  meses.forEach((x, i) => {
    const prev = meses.slice(Math.max(0, i - 12), i).map((y) => y.v).sort((a, b) => a - b);
    if (prev.length < 6) return;
    const k = Math.floor(prev.length / 2);
    const mediana = prev.length % 2 ? prev[k] : (prev[k - 1] + prev[k]) / 2;
    out.set(x.mes, { mediana, veces: x.v / Math.max(mediana, 1) });
  });
  return out;
}

/** «×2,4 lo normal», «la mitad de lo normal», «como lo normal». */
export function comoLoNormal(veces: number): string {
  if (veces >= 1.5) return `${veces.toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces lo normal`;
  if (veces <= 0.5) return veces === 0 ? "nada, cuando lo normal es más" : "menos de la mitad de lo normal";
  return "cerca de lo normal";
}
