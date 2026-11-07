/**
 * Fechas y plazos de la app, siempre a la hora de Lima. Los montos y números son los de toda la interfaz
 * (lib/formato.ts: `soles`, `solesCompacto`, `numero`); aquí va sólo lo propio de la app: el vencimiento de un plazo y la
 * fecha con hora. Puro, para el servidor, el cliente y las pruebas.
 */

const ZONA = "America/Lima";
const DIA = 86_400_000;

const SOLO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un instante desde lo que publica el OECE. Muchas fechas llegan sin hora («2026-11-05»): son un día de Lima, no la
 * medianoche UTC (que en Lima es el día anterior). Un plazo sin hora vence al final de ese día; una publicación, al inicio.
 */
export function instante(iso: string, borde: "inicio" | "fin" = "fin"): number {
  return SOLO_DIA.test(iso) ? Date.parse(`${iso}T${borde === "fin" ? "23:59:59" : "00:00:00"}-05:00`) : Date.parse(iso);
}

/** El día de Lima (AAAA-MM-DD) de un instante (una fecha sin hora ya es un día de Lima). */
export function diaLima(d: string | number | Date): string {
  if (typeof d === "string" && SOLO_DIA.test(d)) return d;
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(d));
}

/** Días de calendario de Lima entre hoy y el día del plazo: 0 hoy, 1 mañana, -1 ayer. */
export function diasHasta(iso: string, ahora: number = Date.now()): number {
  const a = Date.parse(`${diaLima(ahora)}T00:00:00Z`);
  const b = Date.parse(`${diaLima(iso)}T00:00:00Z`);
  return Math.round((b - a) / DIA);
}

const FECHA_CORTA = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, day: "numeric", month: "short" });
const FECHA_HORA = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const FECHA_LARGA = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, day: "numeric", month: "long", year: "numeric" });

const valida = (iso: string | null | undefined): iso is string => !!iso && !Number.isNaN(Date.parse(iso));
/** Para mostrar: una fecha sin hora se toma a mediodía de Lima (no se corre de día). */
const aMostrar = (iso: string) => new Date(SOLO_DIA.test(iso) ? `${iso}T12:00:00-05:00` : iso);

/** «7 nov.» */
export function fechaCortaLima(iso: string | null | undefined): string {
  return valida(iso) ? FECHA_CORTA.format(aMostrar(iso)) : "Sin fecha";
}

/** «sáb., 7 nov., 23:59» */
export function fechaHoraLima(iso: string | null | undefined): string {
  return valida(iso) ? (SOLO_DIA.test(iso) ? fechaCortaLima(iso) : FECHA_HORA.format(new Date(iso))) : "Sin fecha";
}

/** «7 de noviembre de 2026» */
export function fechaLargaLima(iso: string | null | undefined): string {
  return valida(iso) ? FECHA_LARGA.format(aMostrar(iso)) : "Sin fecha";
}

export type EstadoPlazo = "sin_dato" | "vencido" | "hoy" | "pronto" | "abierto";

export interface Vencimiento {
  estado: EstadoPlazo;
  /** Días de calendario hasta el plazo (negativo si pasó); null sin plazo. */
  dias: number | null;
  /** Corto, para una insignia: «Hoy», «En 2 días», «Vence 18 nov.», «Venció 5 nov.». */
  texto: string;
}

/** Cómo está un plazo: vencido, hoy, pronto (hasta 3 días) o abierto. Lo que venció hoy más temprano, ya venció. */
export function vencimiento(iso: string | null | undefined, ahora: number = Date.now()): Vencimiento {
  if (!valida(iso)) return { estado: "sin_dato", dias: null, texto: "Sin plazo" };
  const dias = diasHasta(iso, ahora);
  if (instante(iso, "fin") < ahora) return { estado: "vencido", dias, texto: `Venció ${fechaCortaLima(iso)}` };
  if (dias <= 0) return { estado: "hoy", dias: 0, texto: "Vence hoy" };
  if (dias <= 3) return { estado: "pronto", dias, texto: dias === 1 ? "Vence mañana" : `En ${dias} días` };
  return { estado: "abierto", dias, texto: `Vence ${fechaCortaLima(iso)}` };
}

/** «hace 3 días», «hoy», «ayer»: para la fecha de publicación. */
export function haceDias(iso: string | null | undefined, ahora: number = Date.now()): string {
  if (!valida(iso)) return "Sin fecha";
  const d = -diasHasta(iso, ahora);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  return `hace ${d} días`;
}

/** Porcentaje entero con espacio fino: «67 %». */
export function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}
