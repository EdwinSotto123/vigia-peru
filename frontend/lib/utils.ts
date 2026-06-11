import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
