import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * La escala de letra de tailwind.config.ts (`fontSize`). tailwind-merge no la conoce: sin esto toma `text-meta` por un
 * COLOR y `cn("text-meta text-mute")` borraba el tamaño. Si se agrega un tamaño allá, va también acá (la guardia
 * `npm run auditar:estilo` compara las dos listas).
 */
export const ESCALA_LETRA = ["micro", "rotulo", "meta", "dato", "cuerpo", "destacado", "bloque", "seccion", "cifra", "titulo", "portada"] as const;

const twMerge = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: [...ESCALA_LETRA] }] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Un parámetro de la URL (`searchParams`) como texto: recortado, o undefined si falta, viene vacío o repetido. */
export const uno = (v: string | string[] | undefined): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Un valor crudo de la API como texto: recortado, o null si no es un texto con algo. */
export const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Como `txt`, pero un número también vale (los campos de `detalle` que llegan como 2024 o "2024"). */
export const txtONumero = (v: unknown): string | null => (typeof v === "number" ? String(v) : txt(v));

// Combining diacritical marks: U+0300 - U+036F
const COMBINING = /[̀-ͯ]/g;

/** "Áncash" → "ancash" ; "La Libertad" → "lalibertad" */
export function normalizeRegionId(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\./g, "");
}
