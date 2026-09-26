/**
 * Reglas de PUBLICACIÓN de la API de lectura. Un solo lugar, reusado por todas las rutas públicas
 * (alertas, entidades, reportes, buscar, contratos, financiamiento, procesamientos).
 *
 * 1 · Semillas de demo. `backend/scripts/seed/seed_db.py` sembró en la base real los datos de
 *     `frontend/lib/mock-data.ts`: 10 alertas `ALT-2026-00xx` (RUC y montos inventados, pegados a
 *     municipalidades reales), 6 denuncias `RPT-2026-00xx`, 3 convergencias `CNV-2026-00x` y claves
 *     `*_mock` en `entidades.metadata`. Hasta que corra
 *     `backend/db/cleanup/2026-09-23_borrar_semillas_demo.sql`, ninguna lectura pública las devuelve
 *     ni las cuenta. Las alertas reales se codifican `OECE-…`, así que basta el prefijo `ALT-`. Las
 *     denuncias reales TAMBIÉN se numeran `RPT-2026-…`: las de demo van una por una, nunca por patrón
 *     (mismo criterio que `frontend/lib/semillas.ts`).
 *
 * 2 · Alerta publicada = estado `activa` o `confirmada` (función SQL `alerta_publicada()`,
 *     migración 22). `revision` (la autoevaluación bloqueó la publicación) y `descartada` (una persona
 *     decidió no publicarla) NO exponen score, banderas, conteos de señales ni el dictamen: solo que
 *     existen, su estado (`enRevision`) y, para `revision`, los motivos públicos de
 *     GET /alertas/:id/revision.
 *
 * 3 · Reportes ciudadanos (`reportes_indexados.moderacion_estado`: pendiente | aprobado | rechazado,
 *     migración 05). Decisión:
 *       · Denuncias de OBRA: se publican mientras la moderación no las RECHACE. `pendiente` es público
 *         por diseño: el formulario promete "aparece como pin rojo en validación"
 *         (frontend/components/reporte/Confirmacion.tsx) y /app/denuncias muestra todas, no solo las
 *         aprobadas (components/denuncias/FiltrosDenuncias.tsx). Además no existe ningún endpoint
 *         que apruebe reportes: exigir `aprobado` dejaría el mapa vacío para siempre.
 *       · Denuncias a ENTIDADES (`modo = 'entidad'`, id `RPT-ENT-…`): NUNCA públicas. El producto
 *         promete que "entran al panel privado de validación" y lo que se publica, si hay patrón, es
 *         un dictamen en el perfil de la entidad, no la denuncia.
 *     `modo` no está en la migración 05: lo agregaba el schema-ensure de POST /reportes y desde la
 *     migración 33 está en la DDL versionada. Se lee directo (`r.modo`); antes iba por
 *     `to_jsonb(r)->>'modo'`, que serializaba la fila entera por cada reporte (auditoría A15).
 *
 * 4 · Coordenadas de reportes: "Usar mi ubicación" (FormObra) guarda el GPS de alta precisión del
 *     teléfono, o sea la posición de la persona que denunció. Se publican redondeadas a 3 decimales
 *     (≈ 110 m de latitud, ≈ 100 m de longitud a la latitud del Perú): suficiente para ubicar una obra,
 *     no para ubicar a alguien. El filtro `bbox` compara contra el punto REDONDEADO: si comparara
 *     contra el exacto, bisecando cajas cada vez más chicas se recuperaría la posición original.
 */

/** Literal SQL `ARRAY['a','b']::text[]` a partir de constantes de este módulo (no de input del usuario). */
const sqlTextos = (xs: readonly string[]) => `ARRAY[${xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(",")}]::text[]`;

export const REPORTES_DEMO = ["RPT-2026-0042", "RPT-2026-0058", "RPT-2026-0061", "RPT-2026-0073", "RPT-2026-0080", "RPT-2026-0085"] as const;
export const CONVERGENCIAS_DEMO = ["CNV-2026-001", "CNV-2026-002", "CNV-2026-003"] as const;
/** Claves que seed_db.py escribió en `entidades.metadata` (ninguna otra ruta las escribe). */
export const ENTIDAD_METADATA_MOCK = [
  "alertas_mock", "reportes_mock", "monto_mock", "serie_mock", "score_promedio", "contratos", "contratos_vigilados",
] as const;

// ─── Convocatorias ───────────────────────────────────────────────────────────

/**
 * SQL: la convocatoria `alias` no es la semilla de demo. seed_db.py (seed_expediente) insertó el
 * "expediente Chira Piura" con un OCID sintético `ocds-vigia-<codigoProceso>` (ítems, postores,
 * ofertas y documentos inventados); los OCID reales son `ocds-dgv273-…` o el código corto del SEACE.
 */
export const convocatoriaNoDemo = (alias = "c") => `${alias}.ocid NOT LIKE 'ocds-vigia-%'`;

// ─── Alertas ─────────────────────────────────────────────────────────────────

/** SQL: la alerta `alias` no es una semilla de demo (las reales son `OECE-…`). */
export const alertaNoDemo = (alias = "a") => `${alias}.codigo NOT LIKE 'ALT-%'`;

/** SQL: la alerta `alias` es pública (publicada y no demo). */
export const alertaPublica = (alias = "a") => `(alerta_publicada(${alias}.estado) AND ${alertaNoDemo(alias)})`;

export const esAlertaDemo = (codigo: unknown) => typeof codigo === "string" && codigo.startsWith("ALT-");
export const esPublicada = (estado: unknown) => estado === "activa" || estado === "confirmada";

/**
 * Resumen del análisis (RESULTADO_SQL de procesamientos.ts, usado también por /contratos/:ocid):
 * si la alerta no está publicada, sin score, sin señales, sin veredicto de mercado ni reglas disparadas.
 */
export function redactarResultado<T extends Record<string, unknown>>(r: T | null | undefined): (T & { enRevision: boolean }) | null {
  if (!r) return null;
  const enRevision = r.estado === "revision";
  if (esPublicada(r.estado)) return { ...r, enRevision };
  return { ...r, enRevision, score: null, banderas: null, mercado: null, reglasDisparadas: null };
}

/**
 * SQL de las columnas `score` / `banderas` (conteo) de la vista `procesamientos_publico` (alias `v`
 * opcional). Sin alerta todavía: score NULL y 0 banderas, como antes. Alerta no publicada: ambos NULL.
 */
export const procScoreSql = (p = "") => `CASE WHEN alerta_publicada(${p}alerta_estado) THEN ${p}score END`;
export const procBanderasSql = (p = "") =>
  `CASE WHEN ${p}alerta_estado IS NULL OR alerta_publicada(${p}alerta_estado) THEN ${p}banderas::int END`;

// ─── Reportes ciudadanos y convergencias ─────────────────────────────────────

export const reporteNoDemo = (alias = "r") => `${alias}.id <> ALL(${sqlTextos(REPORTES_DEMO)})`;

/** SQL: el reporte `alias` se puede mostrar en público (ver §3 del encabezado). */
export const reportePublico = (alias = "r") => `(${reporteNoDemo(alias)}
  AND COALESCE(${alias}.modo, 'obra') <> 'entidad'
  AND ${alias}.id NOT LIKE 'RPT-ENT-%'
  AND COALESCE(${alias}.moderacion_estado, 'pendiente') <> 'rechazado')`;

export const convergenciaNoDemo = (alias = "c") => `${alias}.id <> ALL(${sqlTextos(CONVERGENCIAS_DEMO)})`;

/** SQL: la convergencia `alias` es pública: no demo, su alerta está publicada y al menos un reporte es público. */
export const convergenciaPublica = (alias = "c") => `(${convergenciaNoDemo(alias)}
  AND EXISTS (SELECT 1 FROM alertas ca WHERE ca.id = ${alias}.alerta_id AND ${alertaPublica("ca")})
  AND EXISTS (SELECT 1 FROM reportes_indexados cr WHERE cr.id = ANY(${alias}.reporte_ids) AND ${reportePublico("cr")}))`;

/** SQL: ids de `reporte_ids` de la convergencia `alias` que son públicos (en su orden original). */
export const reporteIdsPublicos = (alias = "c") => `ARRAY(
  SELECT u.rid FROM unnest(${alias}.reporte_ids) WITH ORDINALITY AS u(rid, i)
  JOIN reportes_indexados ur ON ur.id = u.rid
  WHERE ${reportePublico("ur")} ORDER BY u.i)`;

/** SQL: latitud / longitud publicadas de un GEOGRAPHY(POINT), redondeadas a 3 decimales (§4). */
export const latPublica = (geo: string) => `round(ST_Y(${geo}::geometry)::numeric, 3)::float8`;
export const lonPublica = (geo: string) => `round(ST_X(${geo}::geometry)::numeric, 3)::float8`;
