/**
 * Los plazos de lo que se sigue, dichos para quien los lee: «Hoy», «Mañana», «En 3 días» (en hora de Lima), si están
 * cerca y la fecha con su hora. Los usan Inicio, Seguimiento y Calendario.
 */
import type { ItemSeguimiento, Plazo } from "@/lib/gobserva-cuenta";

const ZONA = "America/Lima";
const DIA = 86_400_000;

/** El día (YYYY-MM-DD) de una fecha en Lima. */
export function diaLima(fecha: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(fecha));
}

/** Cuántos días de calendario (en Lima) faltan: 0 hoy, 1 mañana, negativo si pasó. */
export function diasHasta(fecha: string, ahora = new Date()): number {
  const a = Date.parse(`${diaLima(ahora)}T00:00:00Z`);
  const b = Date.parse(`${diaLima(fecha)}T00:00:00Z`);
  return Math.round((b - a) / DIA);
}

export function cuando(fecha: string, ahora = new Date()): { texto: string; urgente: boolean; paso: boolean } {
  const d = diasHasta(fecha, ahora);
  const paso = new Date(fecha).getTime() < ahora.getTime();
  if (paso && d <= 0) return { texto: d === 0 ? "Hoy, ya pasó" : d === -1 ? "Ayer" : `Hace ${-d} días`, urgente: false, paso: true };
  if (d === 0) return { texto: "Hoy", urgente: true, paso: false };
  if (d === 1) return { texto: "Mañana", urgente: true, paso: false };
  return { texto: `En ${d} días`, urgente: d <= 2, paso: false };
}

/** «lun 10 nov, 23:59» (la hora sólo si no es medianoche). */
export function fechaHora(fecha: string): string {
  const f = new Date(fecha);
  const dia = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, weekday: "short", day: "numeric", month: "short" }).format(f).replace(/\./g, "");
  const hora = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false }).format(f);
  return hora === "00:00" ? dia : `${dia}, ${hora}`;
}

/** La ruta de la ficha de algo que se sigue. */
export function rutaItem(i: Pick<ItemSeguimiento, "tipo" | "ref">): string {
  return i.tipo === "menor" ? `/app/menor/${i.ref}` : `/app/oportunidad/${encodeURIComponent(i.ref)}`;
}

export interface Evento {
  item: ItemSeguimiento;
  plazo: Plazo;
}

/** Los plazos de todo lo que se sigue como eventos, en orden (sin las convocatorias, que ya pasaron al guardarlo). */
export function eventos(items: ItemSeguimiento[], { conConvocatoria = false } = {}): Evento[] {
  return items
    .flatMap((item) => item.plazos.filter((p) => conConvocatoria || p.clave !== "convocatoria").map((plazo) => ({ item, plazo })))
    .sort((a, b) => a.plazo.fecha.localeCompare(b.plazo.fecha));
}

/** Lo que sigue abierto (ni ganado, ni perdido, ni descartado). */
export const ABIERTOS = new Set(["guardada", "preparando", "presentada"]);
