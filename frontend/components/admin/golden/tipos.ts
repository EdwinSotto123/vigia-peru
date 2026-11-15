/**
 * Pruebas de oro en el panel (/admin/golden): cada conjunto de casos con su respuesta de referencia, cada corrida de
 * una imagen del agente contra él y, por caso, lo esperado frente a lo emitido. Y el RAG normativo (/admin/normas): el
 * corpus y un probador que devuelve lo mismo que recibe el agente legal.
 *
 * Tipos de las respuestas de la API (todas GET, bajo /api/admin) y lo que comparten las pestañas para escribirlas.
 */
import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { Tone } from "@/components/admin/ui";
import { reglaLabel } from "@/lib/auditoria-reglas";

export type QueMide = "banderas" | "citas_legales" | "recuperacion";

export interface Corrida {
  id: string | number;
  conjunto: string;
  /** El nombre de la carpeta de la corrida. */
  corrida: string | null;
  variante: string | null;
  /** La etiqueta de la imagen del agente: «b390f6b6-sdk». */
  imagen: string | null;
  /** «YYYY-MM-DD HH:MM». */
  ejecutada: string | null;
  contratos: number | null;
  errores: number | null;
  /** 0 a 100. */
  precision: number | null;
  /** 0 a 100. */
  exhaustividad: number | null;
  /** 0 a 1. */
  f1: number | null;
  usdMedio: number | null;
  segundosMedio: number | null;
  metricas: Record<string, unknown> | null;
  nota: string | null;
  /** Por regla: [aciertos, falsas alarmas, omisiones]. Sólo en la lista de corridas y en el detalle. */
  porRegla?: Record<string, [number, number, number]> | null;
}

export interface Conjunto {
  clave: string;
  nombre: string;
  descripcion: string | null;
  queMide: QueMide;
  casos: number;
  actualizado: string | null;
  /** Cuántas corridas tiene. */
  corridas: number;
  ultima: Corrida | null;
  /** Hasta 12, de la más vieja a la más nueva. */
  serie: Corrida[];
}

export interface RespuestaGolden {
  conjuntos: Conjunto[];
}

export interface Esperado {
  estado: "disparada" | "no_disparada" | "sin_dato";
  severidad?: string | null;
  evidencia?: string | null;
}

export interface CitaLegal {
  cita: string | null;
  norma: string | null;
  articulo: string | null;
  existe?: boolean | null;
  rige?: boolean | null;
  estado: "ok" | "otro_regimen" | "no_existe";
}

export interface BanderaLegal {
  vector: string | null;
  severidad: string | null;
  descripcion: string | null;
  norma: string | null;
}

export interface ResumenCitas {
  total: number;
  ok: number;
  otro_regimen: number;
  no_existe: number;
}

export interface DetalleResultado {
  /** Conjuntos de banderas: la evidencia que dio el agente por cada regla que emitió. */
  emitidas?: Record<string, string | null>;
  /** Conjunto legal. */
  banderas_legales?: BanderaLegal[];
  citas?: CitaLegal[];
  resumen_citas?: ResumenCitas;
}

export interface Resultado {
  /** OCID corto del contrato, o el id de la pregunta. */
  caso: string;
  estado: "ok" | "error";
  aciertos: string[];
  falsasAlarmas: string[];
  omisiones: string[];
  segundos: number | null;
  usd: number | null;
  titulo: string | null;
  perfil: string | null;
  fecha: string | null;
  regimen: string | null;
  esperado: Record<string, Esperado> | null;
  detalle: DetalleResultado | null;
}

export interface CorridaAnterior {
  id: string | number;
  imagen: string | null;
  f1: number | null;
  precision: number | null;
  exhaustividad: number | null;
  ejecutada: string | null;
}

export interface RespuestaCorrida {
  corrida: Corrida & { conjuntoNombre: string | null; queMide: QueMide };
  anterior: CorridaAnterior | null;
  resultados: Resultado[];
}

export interface Caso {
  conjunto: string;
  caso: string;
  titulo: string | null;
  perfil: string | null;
  fecha: string | null;
  regimen: string | null;
  esperado: Record<string, Esperado> | null;
  nota: string | null;
}

// ─── Normas ──────────────────────────────────────────────────────────────────────

export interface NormasPorTipo {
  tipo: string;
  regimen: string | null;
  jerarquia: number | string | null;
  documentos: number;
  fragmentos: number;
  conVector: number;
  conArticulo: number;
  desde: string | null;
  hasta: string | null;
}

export interface DocumentoNorma {
  slug: string;
  documento: string | null;
  numero: string | null;
  tipo: string | null;
  regimen: string | null;
  fechaEmision: string | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  urlOficial: string | null;
  materia?: string | null;
  estado?: string | null;
  /** C confirmado en fuente oficial, S fuente secundaria, PV por verificar. */
  verificacion?: string | null;
  /** El slug de la norma de la que esta es otra versión por fecha. */
  versionDe?: string | null;
  origen?: string | null;
  fragmentos: number;
}

export interface RespuestaNormas {
  porTipo: NormasPorTipo[];
  documentos: DocumentoNorma[];
}

export type AplicaNorma = "norma" | "criterio" | "criterio_anterior";

/** Una regla de cumplimiento que se verifica contra el corpus (tabla `norma_regla`). */
export interface ReglaNorma {
  id: string;
  categoria: string;
  fase: string | null;
  descripcion: string;
  fundamento: string | null;
  normas: string[];
  tipoVerificacion: string | null;
  parametro: string | null;
  valorReferencia: string | null;
  severidad: string | null;
  regimen: string[];
  verificacion: string | null;
  reglaVigia: string | null;
  nota: string | null;
}

export const MATERIA: Record<string, string> = {
  contrataciones: "Contrataciones",
  control: "Control",
  presupuesto: "Presupuesto",
  administrativo: "Administrativo",
  empleo_publico: "Empleo público",
  inversion: "Inversión pública",
};

export const VERIFICACION: Record<string, { nombre: string; pista: string }> = {
  C: { nombre: "Confirmado", pista: "Confirmado en la fuente oficial" },
  S: { nombre: "Fuente secundaria", pista: "Sale de una fuente secundaria: falta confirmarlo en la oficial" },
  PV: { nombre: "Por verificar", pista: "Dato pendiente de verificación" },
};

export const COMO_SE_VERIFICA: Record<string, string> = {
  determinista: "Cálculo con datos",
  dato_externo: "Dato de otra fuente",
  documental: "Lectura del documento",
  rag_llm: "Análisis con normas",
};

export interface ResultadoNorma {
  slug: string;
  documento: string | null;
  numero: string | null;
  tipo: string | null;
  regimen: string | null;
  aplica: AplicaNorma;
  fechaEmision: string | null;
  articulo: string | null;
  /** Si el artículo tenía otro texto en la fecha pedida: «Texto que regía hasta el …». */
  version?: string | null;
  epigrafe: string | null;
  texto: string | null;
  urlOficial: string | null;
  /** El puesto en la búsqueda por palabras y en la de vectores; null si no salió en esa. */
  rangoPalabras: number | null;
  rangoVector: number | null;
  puntaje: number | null;
}

export interface RespuestaBuscarNormas {
  pregunta: string;
  fecha: string | null;
  regimen: string | null;
  busqueda: "hibrida" | "solo_palabras";
  data: ResultadoNorma[];
}

// ─── Para escribir ───────────────────────────────────────────────────────────────

export const QUE_MIDE: Record<QueMide, { nombre: string; caso: string; casos: string }> = {
  banderas: { nombre: "Banderas del contrato", caso: "contrato", casos: "contratos" },
  citas_legales: { nombre: "Citas legales", caso: "contrato", casos: "contratos" },
  recuperacion: { nombre: "Recuperación de normas", caso: "pregunta", casos: "preguntas" },
};

/** El nombre legible de una regla, como en el resto de la app; sin etiqueta, el identificador con espacios. */
export const nombreRegla = (regla: string) => reglaLabel(regla);

/** «32069» → «Ley 32069». */
export const nombreRegimen = (r: string | null | undefined) => (r ? (/^\d+$/.test(r) ? `Ley ${r}` : r) : null);

const NUM2 = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM1 = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });
const NUM3 = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const esNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** F1 (0 a 1) con dos decimales: «0.91». */
export const fmtF1 = (n: number | null | undefined) => (esNum(n) ? NUM2.format(n) : null);
/** Un porcentaje que ya viene de 0 a 100: «92.3 %». */
export const fmtPct = (n: number | null | undefined) => (esNum(n) ? `${NUM1.format(n)} %` : null);
export const fmtUsd = (n: number | null | undefined) => (esNum(n) ? `US$ ${NUM3.format(n)}` : null);
export const fmtSeg = (n: number | null | undefined) => (esNum(n) ? `${NUM1.format(n)} s` : null);

/** «YYYY-MM-DD HH:MM» → «14 nov. 2026, 09:30», tal como llega (sin correr la hora). */
export function fmtEjecutada(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dia = d.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" });
  return m[4] ? `${dia}, ${m[4]}:${m[5]}` : dia;
}

/** La diferencia entre dos corridas: su texto con signo y el tono (mejor, peor o igual). */
export function diferencia(ahora: number | null | undefined, antes: number | null | undefined, como: "f1" | "pct"): { texto: string; tono: Tone } | null {
  if (!esNum(ahora) || !esNum(antes)) return null;
  const d = ahora - antes;
  const umbral = como === "f1" ? 0.005 : 0.05;
  if (Math.abs(d) < umbral) return { texto: "igual", tono: "neutral" };
  const cifra = como === "f1" ? NUM2.format(Math.abs(d)) : `${NUM1.format(Math.abs(d))} pts`;
  return { texto: `${d > 0 ? "+" : "−"}${cifra}`, tono: d > 0 ? "ok" : "danger" };
}

/** Un número suelto de `metricas` (la API no dice su escala: se escribe como llega, con hasta dos decimales). */
export function fmtMetrica(v: unknown): string | null {
  return esNum(v) ? new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(v) : typeof v === "string" && v.trim() ? v : null;
}

export const numeroDe = (v: unknown): number | null => (esNum(v) ? v : null);

/** La API responde 503 `{error:"sin_migracion"}` cuando la base todavía no tiene las tablas. */
export const esSinMigracion = (e: unknown): boolean =>
  !!e && typeof e === "object" && (e as { status?: unknown }).status === 503 && /sin_migracion/.test(String((e as { message?: unknown }).message ?? ""));

/** Las corridas de la más nueva a la más vieja (la fecha «YYYY-MM-DD HH:MM» se ordena como texto). */
export const porFechaDesc = <T extends { ejecutada: string | null }>(xs: T[]): T[] => [...xs].sort((a, b) => (b.ejecutada ?? "").localeCompare(a.ejecutada ?? ""));

// ─── Lo elegido, en la URL ───────────────────────────────────────────────────────

/**
 * Los parámetros de la pantalla (`?tab=`, `?conjunto=`, `?corrida=`) leídos de la URL y cambiados sin ir al servidor,
 * como `usePestana` (Next sincroniza history.replaceState con useSearchParams). `null` quita el parámetro.
 */
export function useParametros() {
  const params = useSearchParams();
  const poner = useCallback((cambios: Record<string, string | null>) => {
    const sp = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);
  return { conjunto: params.get("conjunto"), corrida: params.get("corrida"), poner };
}
