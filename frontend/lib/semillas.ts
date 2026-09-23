/**
 * Las filas de DEMO que viven en la base de producción, y cómo reconocerlas.
 *
 * `backend/scripts/seed/seed_db.py` sembró en la base real los mismos datos de
 * `lib/mock-data.ts`: 10 alertas `ALT-2026-00xx` (con RUC y montos inventados,
 * pegadas a municipalidades reales), 6 denuncias `RPT-2026-00xx` con fotos de
 * banco de imágenes y 3 "convergencias" que las unen. La API las devuelve como
 * cualquier otra fila, y la interfaz las mostraba como hechos: un score de 91
 * sobre la Municipalidad de Yungay, "confirmado por 2 vecinos"…
 *
 * Hasta que se borren de la base, TODA lectura pasa por acá. Los códigos de
 * denuncia se listan uno por uno (no por prefijo): las denuncias reales también
 * se numeran `RPT-2026-…`, y un filtro por patrón las borraría a ellas.
 */

/** Códigos de alerta de demo: las reales son `OECE-…`. */
export const esAlertaDemo = (a: { codigo?: string | null }) => !!a.codigo && /^ALT-/i.test(a.codigo);

/** Una alerta que sí salió de un análisis (tiene código y no es de demo). */
export const esAlertaReal = (a: { codigo?: string | null }) => !!a.codigo && !esAlertaDemo(a);

/** Las 6 denuncias sembradas desde `REPORTES_MOCK`. */
export const REPORTES_DEMO: ReadonlySet<string> = new Set([
  "RPT-2026-0042",
  "RPT-2026-0058",
  "RPT-2026-0061",
  "RPT-2026-0073",
  "RPT-2026-0080",
  "RPT-2026-0085",
]);

export const esReporteReal = (r: { id?: string | null }) => !!r.id && !REPORTES_DEMO.has(r.id);

/** Las 3 convergencias sembradas desde `CONVERGENCIAS_MOCK`. */
export const CONVERGENCIAS_DEMO: ReadonlySet<string> = new Set(["CNV-2026-001", "CNV-2026-002", "CNV-2026-003"]);

export const esConvergenciaReal = (c: { id?: string | null }) => !!c.id && !CONVERGENCIAS_DEMO.has(c.id);
