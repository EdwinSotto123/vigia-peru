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

/**
 * La misma regla que casoLectura, en JS: para repartir conteos ya agrupados por (estado_proc, riesgo), como los de
 * partido_proceso_facetas (migración 383). Si cambia una, cambia la otra (lectura.test.ts las compara).
 */
export function categoriaLectura(estado: string | null, riesgo: string | null): Lectura | "otro" {
  if (estado === "encolado" || estado === "procesando") return "leyendo";
  if (riesgo === "alto" || riesgo === "medio" || riesgo === "bajo") return "publicado";
  if (riesgo === "en_revision") return "revision";
  if (riesgo === "sin_analizar") return "sin_leer";
  return "otro";
}

/** La categoría de lectura de una fila, para contar (las mismas cuatro, más "otro" para lo descartado). */
export const casoLectura = (p: string) => `CASE WHEN ${p}estado_proc IN ${LEYENDO} THEN 'leyendo'
                                    WHEN ${p}riesgo IN ('alto', 'medio', 'bajo') THEN 'publicado'
                                    WHEN ${p}riesgo = 'en_revision' THEN 'revision'
                                    WHEN ${p}riesgo = 'sin_analizar' THEN 'sin_leer' ELSE 'otro' END`;
