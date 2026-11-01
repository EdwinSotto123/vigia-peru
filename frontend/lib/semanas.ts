/**
 * Semanas de lunes a domingo, como las cuenta GET /novedades/semana: cada una se nombra por su lunes («2026-10-12»).
 * Las fechas llegan como día del calendario (`YYYY-MM-DD`): se leen en UTC para que ninguna zona horaria las corra un día.
 */

const DIA = 86_400_000;
const enUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
// El mes suelto, en minúscula: el Intl del Worker lo devuelve con mayúscula («Octubre», «Ago.»), y en castellano va en
// minúscula («del 5 al 11 de octubre»).
const LARGO = new Intl.DateTimeFormat("es-PE", { month: "long", timeZone: "UTC" });
const CORTO = new Intl.DateTimeFormat("es-PE", { month: "short", timeZone: "UTC" });
const MES_LARGO = { format: (d: Date) => LARGO.format(d).toLocaleLowerCase("es-PE") };
const MES_CORTO = { format: (d: Date) => CORTO.format(d).toLocaleLowerCase("es-PE") };
const anioDe = (d: Date) => d.getUTCFullYear();
const anioHoy = () => new Date().getFullYear();

/** El domingo de la semana que empieza en `lunes`. */
export function finDeSemana(lunes: string): string {
  return new Date(enUtc(lunes).getTime() + 6 * DIA).toISOString().slice(0, 10);
}

/** «12 oct.»: el lunes de una semana, para el eje de la gráfica. */
export function diaMes(iso: string): string {
  const d = enUtc(iso);
  return `${d.getUTCDate()} ${MES_CORTO.format(d)}`;
}

/** «oct.»: el mes de una fecha, para marcar dónde empieza cada mes en el eje. */
export function mesDe(iso: string): string {
  return MES_CORTO.format(enUtc(iso));
}

/**
 * «del 12 al 18 de octubre», «del 28 de septiembre al 4 de octubre»; con el año si no es el de hoy («… de 2025»).
 * `hasta` por defecto es el domingo de esa semana.
 */
export function rangoSemana(desde: string, hasta = finDeSemana(desde)): string {
  const a = enUtc(desde);
  const b = enUtc(hasta);
  const anio = anioDe(b) !== anioHoy() ? ` de ${anioDe(b)}` : "";
  const mesA = MES_LARGO.format(a);
  const mesB = MES_LARGO.format(b);
  if (anioDe(a) !== anioDe(b)) return `del ${a.getUTCDate()} de ${mesA} de ${anioDe(a)} al ${b.getUTCDate()} de ${mesB} de ${anioDe(b)}`;
  return mesA === mesB
    ? `del ${a.getUTCDate()} al ${b.getUTCDate()} de ${mesB}${anio}`
    : `del ${a.getUTCDate()} de ${mesA} al ${b.getUTCDate()} de ${mesB}${anio}`;
}

/** «el 18 de mayo» (con el año si no es el de hoy): la última fecha que trae una fuente. */
export function diaLargo(iso: string): string {
  const d = enUtc(iso);
  return `el ${d.getUTCDate()} de ${MES_LARGO.format(d)}${anioDe(d) !== anioHoy() ? ` de ${anioDe(d)}` : ""}`;
}

/** Días enteros entre una fecha del calendario y hoy (en Lima no importa: es para decir «hace N días» a grandes rasgos). */
export function diasDesde(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - enUtc(iso).getTime()) / DIA));
}
