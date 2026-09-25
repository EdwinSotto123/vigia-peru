/**
 * Lecturas del dossier que varias piezas necesitan contestar igual: qué corrió
 * de verdad, cuál es el nivel de riesgo, qué señales se pueden sostener.
 *
 * Antes cada componente respondía a su manera: la cabecera sacaba el nivel del
 * conteo de señales, la barra lateral de cortes 85/70/40 escritos a mano, y un
 * análisis que se cortó a los dos agentes se publicaba como "Sin hallazgos".
 */

import { claveDePaso, pasoDeClave, TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { faseLabelCorto } from "@/lib/auditoria";
import { nivelDeScore, SEVERIDAD, SIN_SENALES, type NivelSeveridad, type SeveridadUI } from "@/lib/severidad";
import { fecha, fechaCorta, soles } from "@/lib/formato";
import type { ApiResult, Bandera } from "./types";

// ─── Qué corrió ───────────────────────────────────────────────────────────

export interface EstadoCorrida {
  /** Claves del catálogo de los agentes que dejaron rastro en la traza, en orden del DAG. */
  agentes: string[];
  /** Los mismos, con su nombre en castellano. */
  nombres: string[];
  /** Cuántos agentes tiene el pipeline completo (catálogo). */
  total: number;
  hayTraza: boolean;
  corrioCumplimiento: boolean;
  corrioDictamen: boolean;
  /** El paso que guarda las señales en la base corrió (o hay señales guardadas). */
  guardoSenales: boolean;
  /** Se puede afirmar que el análisis terminó: reglas evaluadas, señales guardadas y dictamen escrito. */
  completa: boolean;
  /** Lo que faltó para poder afirmarlo, en castellano. */
  faltan: string[];
}

export function estadoCorrida(result: ApiResult): EstadoCorrida {
  const trace = (result.agent_trace || []) as any[];
  const claves = new Set<string>();
  const tools = new Set<string>();
  for (const ev of trace) {
    const candidatos: unknown[] = [ev?.agent];
    // El orquestador viejo invocaba a los agentes como herramientas: el nombre
    // del tool_call ES el agente ("compliance_agent").
    if (ev?.kind === "tool_call") {
      candidatos.push(ev?.name);
      if (typeof ev?.name === "string") tools.add(ev.name);
      // El orquestador viejo tasaba precios con una herramienta, no con el agente.
      if (typeof ev?.name === "string" && /^analyze_market/.test(ev.name)) candidatos.push("market_price_agent");
    }
    if (ev?.kind === "transfer") candidatos.push(ev?.to);
    for (const c of candidatos) {
      if (typeof c !== "string" || !c) continue;
      if (c !== ev?.agent && !/_agent$/.test(c)) continue;
      const k = claveDePaso(c);
      if (k && pasoDeClave(k)?.tipo === "agente") claves.add(k);
    }
  }
  const dictamen = (result.dictamen?.dictamen_markdown || "").trim();
  const nBanderas = (result.compliance?.banderas || []).length;
  const corrioCumplimiento = claves.has("compliance");
  const corrioDictamen = dictamen.length > 100 || claves.has("report_writer");
  const guardoSenales = nBanderas > 0 || tools.has("persist_alert_from_flags");
  const hayTraza = trace.length > 0;

  const faltan: string[] = [];
  if (!corrioCumplimiento) faltan.push(hayTraza ? "la evaluación de las reglas de contratación" : "el registro de qué agentes corrieron");
  if (corrioCumplimiento && !guardoSenales) faltan.push("el guardado de las señales");
  if (!corrioDictamen) faltan.push("el dictamen");

  const orden = Object.fromEntries(
    ["compliance", "document_parser", "document_legal_analyst", "market", "proveedor", "web_research", "news_research", "entity_personnel", "person_network", "compliance_extended", "report_writer", "self_eval"].map((k, i) => [k, i]),
  );
  const agentes = Array.from(claves).sort((a, b) => (orden[a] ?? 99) - (orden[b] ?? 99));
  return {
    agentes,
    nombres: agentes.map((k) => pasoDeClave(k)?.nombre ?? faseLabelCorto(k)),
    total: TOTAL_AGENTES,
    hayTraza,
    corrioCumplimiento,
    corrioDictamen,
    guardoSenales,
    completa: hayTraza && corrioCumplimiento && corrioDictamen && guardoSenales,
    faltan,
  };
}

// ─── Severidad de cada señal: UNA lectura para la cabecera, los chips y la lista ──

export type SeveridadSenal = "alta" | "media" | "baja";

/**
 * La severidad de una señal del payload, venga como venga ("ALTA", " media ", vacía).
 * La cabecera contaba con `toLowerCase()` y la lista con una comparación exacta, así
 * que una "ALTA" salía como alta arriba y como baja abajo, y una sin severidad no
 * contaba en la cabecera pero sí en la lista: los totales no cuadraban. Lo que no es
 * alta ni media es baja, igual en todas partes.
 */
export function severidadDe(b: { severidad?: unknown } | null | undefined): SeveridadSenal {
  const s = String(b?.severidad ?? "").trim().toLowerCase();
  return s === "alta" || s === "media" ? s : "baja";
}

export interface ConteoSeveridad {
  total: number;
  alta: number;
  media: number;
  baja: number;
}

export function contarSeveridades(banderas: ReadonlyArray<{ severidad?: unknown }>): ConteoSeveridad {
  const c: ConteoSeveridad = { total: 0, alta: 0, media: 0, baja: 0 };
  for (const b of banderas) {
    c.total++;
    c[severidadDe(b)]++;
  }
  return c;
}

// ─── Nivel del dossier: UNA escala (lib/severidad) y las palabras de §10.1 ───

export interface NivelDossier {
  /** `alta|media|baja` = peso del riesgo (sólo con señales); `limpio` = sin señales; `incompleto` = no se puede afirmar. */
  nivel: NivelSeveridad | "incompleto" | "limpio";
  etiqueta: string;
  detalle: string;
  ui: SeveridadUI;
}

/** Tramos del peso del riesgo con las MISMAS palabras que las listas (lib/severidad: "Riesgo alto"…). */
const TRAMO: Record<SeveridadSenal, { etiqueta: string; detalle: string }> = {
  alta: { etiqueta: "Riesgo alto", detalle: "Varias señales pesan juntas" },
  media: { etiqueta: "Riesgo medio", detalle: "Señales que conviene revisar" },
  baja: { etiqueta: "Riesgo bajo", detalle: "Señales de poco peso, igual se muestran" },
};

/**
 * El nivel que se muestra en la cabecera del dossier. Con señales, es el "peso del
 * riesgo": el tramo del puntaje con los cortes de `lib/severidad` (70/40), con las
 * palabras de las listas ("Riesgo alto · medio · bajo"). Sin señales, "Sin señales"
 * (`SIN_SENALES`, el único check verde) sólo si el análisis terminó; si se cortó,
 * incompleto.
 *
 * Un contrato con señales y puntaje bajo NO lleva el check verde: ponerlo junto a una
 * señal publicada es la contradicción que la auditoría de coherencia marcó como P1.
 * Lleva el tono neutro de una señal baja (`SEVERIDAD.baja`, ícono Info).
 */
export function nivelDelDossier(score: number | null | undefined, nSenales: number, corrida: EstadoCorrida): NivelDossier {
  if (nSenales === 0) {
    if (!corrida.completa) {
      return {
        nivel: "incompleto",
        etiqueta: "Análisis incompleto",
        detalle: "No se puede afirmar que no haya señales",
        ui: SEVERIDAD.sin_analizar,
      };
    }
    return {
      nivel: "limpio",
      etiqueta: SIN_SENALES.etiqueta,
      detalle: "El análisis terminó sin señales de riesgo",
      ui: SIN_SENALES,
    };
  }
  const nivel = nivelDeScore(score ?? 0) as SeveridadSenal;
  return { nivel, ...TRAMO[nivel], ui: { ...SEVERIDAD[nivel], etiqueta: TRAMO[nivel].etiqueta } };
}

// ─── Estado de publicación ───────────────────────────────────────────────

/**
 * ¿El dossier es de una alerta frenada para revisión humana? GET /alertas/:id/full la
 * devuelve sin score, señales ni dictamen (`enRevision`, `estado: "revision"`,
 * `publicada: false`). Se lee de las tres formas porque la adaptación del dossier
 * (lib/dossier-adaptar) puede traer cualquiera de ellas.
 */
export function dossierEnRevision(result: ApiResult): boolean {
  return (
    result.enRevision === true ||
    result.estado === "revision" ||
    result._bridge_meta?.enRevision === true ||
    result._bridge_meta?.estado === "revision"
  );
}

// ─── Dinero: un solo formato en todo el dossier ───────────────────────────

/**
 * El dossier es evidencia y tiene tablas (ítems, postores, precios unitarios): todos sus
 * montos van completos con `soles` de lib/formato ("S/ 84,172", "S/ 12.50"), nunca
 * compactados. Antes convivían "S/ 1.23 M", "S/ 885 K" y "S/ 262,389" en el mismo informe.
 * Acepta lo que venga del payload (número o texto); lo que no es un número es "Sin dato".
 */
export function montoDossier(n: unknown): string {
  if (n == null || n === "") return soles(null);
  const v = typeof n === "number" ? n : Number(String(n).replace(/[^\d.-]/g, ""));
  return soles(Number.isFinite(v) ? v : null);
}

/**
 * Fechas del payload con `fecha`/`fechaCorta` de lib/formato ("24 de setiembre de 2026",
 * "24 set. 2026"). Los agentes a veces devuelven otro formato ("15/03/2020", "marzo 2024"):
 * ese se deja tal cual, porque pasarlo por `new Date` lo convertía en "Sin fecha" o, peor,
 * en otro día.
 */
export function fechaDossier(v: unknown, corta = false): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return "Sin fecha";
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  return corta ? fechaCorta(t.slice(0, 10)) : fecha(t.slice(0, 10));
}

// ─── Señales de sobreprecio que el mercado no sostiene ────────────────────

export const esReglaSobreprecio = (b: Pick<Bandera, "regla"> | null | undefined) =>
  String(b?.regla || "").toLowerCase().startsWith("sobreprecio");

/**
 * Si el backend dejó `market_analysis.sobreprecio_pct` en null, su juez de
 * plausibilidad decidió que el lote no es comparable. Una señal de sobreprecio
 * en ese mismo dossier ("+102.5 %" junto a "0 de 95 ítems con precio medido")
 * no se puede sostener: se aparta como no verificable, fuera de los conteos.
 */
export function separarBanderas(result: ApiResult): { visibles: Bandera[]; noVerificables: Bandera[] } {
  const todas = (result.compliance?.banderas || []) as Bandera[];
  const medido = result.market_analysis?.sobreprecio_pct != null;
  if (medido) return { visibles: todas, noVerificables: [] };
  return {
    visibles: todas.filter((b) => !esReglaSobreprecio(b)),
    noVerificables: todas.filter(esReglaSobreprecio),
  };
}

// ─── Observaciones del agente de precios que sí son para personas ─────────

/**
 * `observaciones_clave` mezcla hallazgos con líneas de bitácora del backend
 * ("vía fan-out de 10 workers paralelos", "1 chunk(s) excedieron el timeout").
 * Solo se muestran las que una persona puede usar.
 */
const BITACORA_RX =
  /fan-out|workers?\b|chunk|timeout|grounding|referencias_internas|BD SEACE|tomad[oa] de:|calculad[oa]s? en c[oó]digo|\d+\s*[ºª°]\s*pase|ronda\b|^Preciados\s+\d|no se emite bandera|person_network|esta corrida|\b[a-z]+_[a-z_]+\b/i;

export function observacionesLegibles(obs: unknown): string[] {
  if (!Array.isArray(obs)) return [];
  return obs.filter((o): o is string => typeof o === "string" && !!o.trim() && !BITACORA_RX.test(o));
}
