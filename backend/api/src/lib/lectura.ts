/**
 * "¿Lo leyó Vigía?" sobre las columnas de `contrato_estado` (y de `contratos_agregado`, que tiene las mismas): una sola
 * definición para la lista de contratos (/contratos) y la de procesos de un partido (/partidos/:clave/procesos).
 */

export const LECTURAS = ["sin_leer", "leyendo", "publicado", "revision"] as const;
export type Lectura = (typeof LECTURAS)[number];

/** Los estados de procesamiento que cuentan como "leyéndose". */
export const LEYENDO = "('encolado', 'procesando')";

/** Condición de `lectura` sobre riesgo + estado_proc; `p` es el prefijo de las columnas ("ce." o ""). */
export function lecturaSql(l: Lectura, p: string): string {
  switch (l) {
    case "sin_leer": return `(${p}riesgo = 'sin_analizar' AND ${p}estado_proc NOT IN ${LEYENDO})`;
    case "leyendo": return `${p}estado_proc IN ${LEYENDO}`;
    case "publicado": return `${p}riesgo IN ('alto', 'medio', 'bajo')`;
    case "revision": return `${p}riesgo = 'en_revision'`;
  }
}

/** La categoría de lectura de una fila, para contar (las mismas cuatro, más "otro" para lo descartado). */
export const casoLectura = (p: string) => `CASE WHEN ${p}estado_proc IN ${LEYENDO} THEN 'leyendo'
                                    WHEN ${p}riesgo IN ('alto', 'medio', 'bajo') THEN 'publicado'
                                    WHEN ${p}riesgo = 'en_revision' THEN 'revision'
                                    WHEN ${p}riesgo = 'sin_analizar' THEN 'sin_leer' ELSE 'otro' END`;
