/**
 * Fechas de "Auditoría en vivo", siempre en hora de Lima. Salió de lib/auditoria.ts, que
 * las reexporta: quien importaba `fechaLima`, `duracion`… desde ahí no cambia nada.
 */

// ─── Fechas: siempre en hora de Lima ─────────────────────────────────────────
// Las fechas de esta pantalla se renderizan también en el servidor (Cloud Run, en UTC). Sin
// `timeZone`, un análisis de las 21:00 de Lima salía fechado al día siguiente. Los meses se
// escriben a mano (no con `month: "short"`): el ICU del servidor y el del navegador no siempre
// abrevian igual, y un "sept." contra "set." rompe la hidratación.

export const ZONA_LIMA = "America/Lima";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
const PARTES_LIMA = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_LIMA, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
});

export interface PartesFecha { y: number; m: number; d: number; h: number; min: number }

/** Año, mes (1-12), día, hora y minuto en Lima. null si la fecha no es válida. */
export function partesLima(v: string | number | Date | null | undefined): PartesFecha | null {
  if (v == null || v === "") return null;
  const t = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(t.getTime())) return null;
  const o: Record<string, number> = {};
  for (const p of PARTES_LIMA.formatToParts(t)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, min: o.minute };
}

/** "2026-09-17": el día calendario en Lima (para agrupar por día). */
export function diaLima(v: string | number | Date | null | undefined): string | null {
  const p = partesLima(v);
  return p ? `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` : null;
}

/**
 * "17 set." · "17 set., 13:54" · "17 de setiembre, 13:54" (`larga`). Hora de Lima.
 * `anio` agrega el año sólo cuando se pide.
 */
export function fechaLima(v: string | number | Date | null | undefined, o: { hora?: boolean; larga?: boolean; anio?: boolean } = {}): string {
  const p = partesLima(v);
  if (!p) return "";
  const dia = o.larga ? `${p.d} de ${MESES[p.m - 1]}` : `${p.d} ${MESES_CORTOS[p.m - 1]}`;
  const conAnio = o.anio ? (o.larga ? `${dia} de ${p.y}` : `${dia} ${p.y}`) : dia;
  return o.hora ? `${conAnio}, ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}` : conAnio;
}

/** "13:54:07" en Lima. */
export function horaLima(v: string | number | Date | null | undefined): string {
  if (v == null || v === "") return "";
  const t = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleTimeString("es-PE", { timeZone: ZONA_LIMA, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
}

/** "hace 3 s" · "hace 2 min" · "hace 1 h" · "hace 6 días" */
export function haceCuanto(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** Reloj de antigüedad que avanza de a un segundo: "6 días 03:12:05" · "03:12:05". */
export function relojEdad(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const hh = String(Math.floor((s % 86_400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return d > 0 ? `${d} ${d === 1 ? "día" : "días"} ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

/** "2 min 13 s" · "48 s" · "1 h 04 min" */
export function duracion(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "+0:42" · "+3:05": desde el primer evento de la corrida. Para bitácoras que ya terminaron. */
export function desfase(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `+${h}:${String(m).padStart(2, "0")}:${ss}` : `+${m}:${ss}`;
}

/**
 * Ritmo real: análisis terminados por día (hora de Lima) en los últimos `dias` días, hasta
 * hoy inclusive. Los días sin análisis también van, en 0: esconderlos es justamente lo que
 * haría parecer vivo un tablero que lleva días quieto.
 */
export function ritmoDiario(finalizados: (string | null | undefined)[], ahora: number, dias = 14): { dia: string; n: number }[] {
  const conteo = new Map<string, number>();
  for (const f of finalizados) {
    const d = diaLima(f);
    if (d) conteo.set(d, (conteo.get(d) ?? 0) + 1);
  }
  const hoy = partesLima(ahora);
  if (!hoy) return [];
  // Mediodía UTC del día de hoy en Lima: restar días completos nunca cruza un borde de fecha.
  const base = Date.UTC(hoy.y, hoy.m - 1, hoy.d, 12);
  const out: { dia: string; n: number }[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const t = new Date(base - i * 86_400_000);
    const dia = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    out.push({ dia, n: conteo.get(dia) ?? 0 });
  }
  return out;
}

/** "17 set." a partir de "2026-09-17" (sin construir un Date: no hay zona que desfasar). */
export function diaCorto(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  return m && d ? `${d} ${MESES_CORTOS[m - 1]}` : dia;
}
