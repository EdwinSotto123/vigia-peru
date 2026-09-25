/**
 * Los ocho evaluadores que revisan un análisis antes de publicarlo (backend: self-eval), y cómo
 * se lee el resultado de cada uno. Puro: lo usan los "Controles de calidad" del informe y el
 * panel en vivo (ObservabilidadPanel).
 *
 * El nombre y la pregunta por defecto son los de siempre; cuando la traza trae su propia
 * `pregunta`, manda la de la traza.
 */

import type { EvaluacionTraza } from "./modelo";

export interface Evaluador {
  n: string;
  label: string;
  d: string;
}

export const EVALS: Evaluador[] = [
  { n: "respaldo_de_bandera", label: "Respaldo de bandera", d: "¿la bandera está respaldada por datos verificables (RUC, monto, fecha, artículo)?" },
  { n: "cita_evidencia", label: "Cita de evidencia", d: "¿cada bandera cita norma + fuente oficial (SEACE/OECE)?" },
  { n: "plausibilidad_precio", label: "Plausibilidad de precio", d: "¿el sobreprecio se sostiene con la mediana de mercado?" },
  { n: "coherencia_objeto_items", label: "Coherencia objeto ↔ ítems", d: "¿los ítems analizados pertenecen al objeto de la convocatoria?" },
  { n: "tono_no_acusatorio", label: "Tono no acusatorio", d: "¿el dictamen usa 'señal de riesgo' y nunca acusa de delito?" },
  { n: "completitud_analisis", label: "Completitud del análisis", d: "¿corrieron todas las etapas (docs, mercado, red, dictamen, banderas)?" },
  { n: "cobertura_prensa", label: "Cobertura de prensa", d: "¿el agente de prensa devolvió cobertura estructurada (noticias o 'sin menciones'), no vacío?" },
  { n: "firmantes_plausibles", label: "Firmantes plausibles", d: "¿los firmantes son reales, no placeholders de plantilla ('POSTOR N' sin DNI)?" },
];

/** Cómo quedó un control. `sin_datos`: corrió pero no tenía nada que revisar (n = 0). */
export type ResultadoControl = "aprobado" | "parcial" | "no_aprobado" | "sin_datos" | "no_corrio";

const ETIQUETAS_OK = new Set(["ok", "coherente"]);

export function resultadoDe(ev: EvaluacionTraza | undefined): ResultadoControl {
  if (!ev) return "no_corrio";
  if (ev.pct == null) {
    if (ev.label) return ETIQUETAS_OK.has(ev.label.toLowerCase()) ? "aprobado" : "no_aprobado";
    return "sin_datos";
  }
  if (ev.n === 0) return "sin_datos";
  if (ev.pct >= 100) return "aprobado";
  return ev.pct > 0 ? "parcial" : "no_aprobado";
}

/** "Juez de IA" o "En código", según el `metodo` que declara el backend. */
export function metodoHumano(metodo: string | null | undefined): "Juez de IA" | "En código" | null {
  const m = (metodo ?? "").toLowerCase();
  if (!m) return null;
  if (m.includes("llm") || m.includes("judge") || m.includes("juez")) return "Juez de IA";
  if (m.includes("determin") || m.includes("código") || m.includes("codigo")) return "En código";
  return null;
}
