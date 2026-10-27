/**
 * Formatos que usa toda la interfaz (DESIGN_SYSTEM.md §10.3): el ÚNICO lugar que
 * decide cómo se escribe un monto, un número, una fecha o un plural. La auditoría
 * del 2026-09-24 encontró cinco formatos de soles en la misma columna ("S/ 262,389"
 * junto a "S/ 1.3 M", "S/ 885 K" y "mil M"); un formateador por concepto lo evita.
 *
 * Vivían en `lib/mock-data.ts`, así que media app importaba del archivo de datos
 * inventados sólo para formatear un monto: el día que alguien borrara los mocks,
 * se rompía el formateo de montos reales.
 *
 * Todo es puro (sin React): sirve en server y client components.
 */

import { conTildes } from "./tildes";

const ZONA_LIMA = "America/Lima";
const NUM = new Intl.NumberFormat("es-PE");
const NUM_1 = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NUM_2 = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });

const esNumero = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Número entero con separador de miles: 18,393. Sin dato → "Sin dato". */
/** Espacio no separable (entre "S/", la cifra y su unidad) y fino no separable (antes de "%", §10.3): un monto no se
 * parte en dos renglones ("S/ 23.9" arriba y "M" abajo). */
const NBSP = " ";
const FINO = " ";

export function numero(n: number | null | undefined): string {
  return esNumero(n) ? NUM.format(Math.round(n)) : "Sin dato";
}

/** Soles completos, para tablas y textos: S/ 45,000 (≥ 1 000 sin decimales; < 1 000 hasta 2). */
export function soles(n: number | null | undefined): string {
  if (!esNumero(n)) return "Sin dato";
  return `S/${NBSP}${Math.abs(n) >= 1000 ? NUM.format(Math.round(n)) : NUM_2.format(n)}`;
}

/**
 * Soles compactos, para tarjetas y mapas: S/ 1.5 mil M · S/ 5.1 M · S/ 840 mil · S/ 320.
 * "mil M" y no "B": en español, un billón es un millón de millones.
 */
export function solesCompacto(n: number | null | undefined): string {
  if (!esNumero(n)) return "Sin dato";
  const a = Math.abs(n);
  // Un billón en español es un millón de millones (los montos imposibles que publica el Estado llegan ahí).
  if (a >= 1_000_000_000_000) {
    const t = NUM_1.format(n / 1_000_000_000_000);
    return `S/${NBSP}${t}${NBSP}${t === NUM_1.format(1) ? "billón" : "billones"}`;
  }
  if (a >= 1_000_000_000) return `S/${NBSP}${NUM_1.format(n / 1_000_000_000)}${NBSP}mil${NBSP}M`;
  if (a >= 1_000_000) return `S/${NBSP}${NUM_1.format(n / 1_000_000)}${NBSP}M`;
  if (a >= 1_000) return `S/${NBSP}${NUM.format(Math.round(n / 1_000))}${NBSP}mil`;
  return `S/${NBSP}${NUM.format(Math.round(n))}`;
}

/** Compatibilidad: el nombre que ya usan 12 archivos. Es `solesCompacto`. */
export const formatSoles = (n: number) => solesCompacto(n);

/**
 * Un número con hasta `decimales` decimales, como el resto del sitio (es-PE: punto decimal y coma de miles): «4.5», no
 * «4,5», que junto a «S/ 43,900» se leía como cuarenta y cinco.
 */
export function decimal(n: number | null | undefined, decimales = 1): string {
  if (!esNumero(n)) return "Sin dato";
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits: decimales }).format(n);
}

/** Porcentaje entero con espacio fino no separable: "12 %". */
export function porcentaje(n: number | null | undefined, { decimales = 0 } = {}): string {
  if (!esNumero(n)) return "Sin dato";
  const f = decimales ? new Intl.NumberFormat("es-PE", { maximumFractionDigits: decimales }) : NUM;
  return `${f.format(decimales ? n : Math.round(n))}${FINO}%`;
}

/** "a", "a y b", "a, b y c": una enumeración en palabras, en vez de datos sueltos con un separador. */
export function listaY(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/**
 * Un texto del SEACE, del MEF o de CONOSCE escrito todo en mayúsculas, como oración: "ADQUISICION DE VIVERES PARA LA
 * TROPA" → "Adquisición de víveres para la tropa", con las tildes que la fuente perdió (lib/tildes). Lo que ya trae
 * minúsculas se deja como viene (lo escribió alguien a mano). Las mismas palabras en todas las listas: contratos,
 * procesos, partidas del presupuesto.
 */
export function oracion(t: string): string {
  const s = t.trim();
  // "Casi todo en mayúsculas" también cuenta ("DERIVADA DE LA SUBASTA… Nº 001-2026-ítems"): 80 % de las letras.
  const letras = s.match(/\p{L}/gu) ?? [];
  const mayusculas = letras.filter((c) => c !== c.toLocaleLowerCase("es")).length;
  // Escrito a mano: se respeta, pero empieza con mayúscula ("contratación de la obra…" → "Contratación de la obra…").
  if (letras.length === 0 || mayusculas / letras.length < 0.8) return s.charAt(0).toLocaleUpperCase("es") + s.slice(1);
  const b = conTildes(s.toLocaleLowerCase("es"));
  return b.charAt(0).toLocaleUpperCase("es") + b.slice(1);
}

/** "1 contrato", "2 contratos". El número va formateado. */
export function plural(n: number, singular: string, pluralTexto: string): string {
  return `${NUM.format(n)} ${n === 1 ? singular : pluralTexto}`;
}

const aFecha = (d: string | number | Date | null | undefined): Date | null => {
  if (d == null || d === "") return null;
  const f = d instanceof Date ? d : new Date(d);
  return Number.isNaN(f.getTime()) ? null : f;
};

const anioLima = (f: Date) => Number(new Intl.DateTimeFormat("es-PE", { timeZone: ZONA_LIMA, year: "numeric" }).format(f));

/** "24 de setiembre de 2026". Una fecha sola ("2026-09-24") se toma como día de Lima, sin correrla un día. */
export function fecha(d: string | number | Date | null | undefined): string {
  const f = aFecha(typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00-05:00` : d);
  if (!f) return "Sin fecha";
  return new Intl.DateTimeFormat("es-PE", { timeZone: ZONA_LIMA, day: "numeric", month: "long", year: "numeric" }).format(f);
}

/** Para tablas: "24 set. 2026"; sin año si es el año en curso: "24 set.". */
export function fechaCorta(d: string | number | Date | null | undefined): string {
  const f = aFecha(typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00-05:00` : d);
  if (!f) return "Sin fecha";
  const conAnio = anioLima(f) !== anioLima(new Date());
  return new Intl.DateTimeFormat("es-PE", { timeZone: ZONA_LIMA, day: "numeric", month: "short", ...(conAnio ? { year: "numeric" } : {}) }).format(f);
}

/**
 * Relativo sólo para lo reciente (< 7 días): "hace 5 min", "hace 3 h", "ayer";
 * después, la fecha corta. Un "hace 43 días" obliga a hacer la cuenta. Número y unidad
 * van unidos por un espacio duro: "hace 21 / h" partido en dos líneas no se lee.
 */
export function relativo(d: string | number | Date | null | undefined, ahora: number = Date.now()): string {
  const f = aFecha(d);
  if (!f) return "Sin fecha";
  const s = Math.round((ahora - f.getTime()) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)}\u00a0min`;
  if (s < 86_400) return `hace ${Math.round(s / 3600)}\u00a0h`;
  if (s < 2 * 86_400) return "ayer";
  if (s < 7 * 86_400) return `hace ${Math.floor(s / 86_400)}\u00a0días`;
  return fechaCorta(f);
}

/** "Hoy" en Lima (AAAA-MM-DD), no en UTC: a las 19:00 de Lima el día UTC ya cambió. */
export function hoyLima(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_LIMA }).format(ahora);
}

/**
 * Un texto listo para buscar dentro de él: sin tildes, en minúsculas y con los espacios juntos ("Ñ" queda "n").
 * Lo usan los buscadores de las listas que llegan enteras al navegador (`TablaPaginada`).
 */
export function paraBuscar(t: string | null | undefined): string {
  return (t ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Si `texto` tiene todas las palabras de `consulta` (en cualquier orden), ya pasadas por `paraBuscar`. */
export function coincide(texto: string, consulta: string): boolean {
  if (!consulta) return true;
  return consulta.split(" ").every((p) => texto.includes(p));
}
