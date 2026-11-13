/**
 * «Lo que falta leer» vive desde el 2026-11-13 en Auditoría en vivo, en su pestaña `falta` (antes era /app/financiar,
 * otra página con su propio menú: la auditoría visual pidió juntarlas). Sus filtros llevan nombre propio, `buscar` y
 * `pag`, para no pisar la búsqueda y la página de las otras pestañas de la auditoría (`q`, `pagina`); `por`, `anio`,
 * `region` y `orden` no chocan con nada. Las fichas de una zona, una entidad o un partido siguen en /app/financiar/….
 */
export const RUTA_FALTA = "/app/auditoria";
export const PARAM_BUSCAR = "buscar";
export const PARAM_PAG = "pag";

type Consulta = Record<string, string | undefined>;

/** La consulta de la pestaña, con `seccion=falta` delante. */
export const queryFalta = (p: Consulta = {}): Consulta => ({ seccion: "falta", ...p });

/** La URL de la pestaña con estos filtros (los vacíos fuera). */
export function hrefFalta(p: Consulta = {}): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(queryFalta(p))) if (v) u.set(k, v);
  return `${RUTA_FALTA}?${u.toString()}`;
}
