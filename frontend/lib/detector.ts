/**
 * Las cifras reales del detector de la portada (components/landing/Detector.tsx): cuántas veces encontró Vigía cada
 * señal que el ejemplo enciende, y el primer caso de dos patrones para abrir uno de verdad.
 *
 * Tres pedidos, en paralelo y cacheados 15 minutos:
 *  - GET /senales?limit=1: sólo sus facetas, que cuentan las señales por regla en todo lo que Vigía leyó.
 *  - GET /patrones/acompanantes?solo=fuertes&size=1: las parejas de postor de relleno (el total y la primera).
 *  - GET /patrones/repetidas?size=1: la misma compra repetida en semanas (el total y la primera).
 * Si uno falla, su parte queda en null y el detector no muestra esa cifra: el ejemplo se sigue pudiendo jugar.
 */
import { API_BASE } from "./api-client";

export interface PatronDetector {
  total: number;
  /** La clave opaca de su primer caso (la ficha /app/patrones/caso/…), o null. */
  caso: string | null;
}

export interface CifrasDetector {
  /** Señales por regla (id de la regla → cuántas). */
  reglas: Record<string, number> | null;
  relleno: PatronDetector | null;
  repetidas: PatronDetector | null;
}

async function leer(ruta: string): Promise<unknown> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate: 900 } } as RequestInit);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

function reglasDe(j: unknown): Record<string, number> | null {
  const facetas = esObjeto(j) && esObjeto(j.facetas) ? j.facetas : null;
  if (!facetas || !Array.isArray(facetas.regla)) return null;
  const salida: Record<string, number> = {};
  for (const f of facetas.regla) {
    if (esObjeto(f) && typeof f.valor === "string" && typeof f.n === "number") salida[f.valor] = f.n;
  }
  return Object.keys(salida).length ? salida : null;
}

function patronDe(j: unknown): PatronDetector | null {
  if (!esObjeto(j) || typeof j.total !== "number" || j.total <= 0) return null;
  const primero = Array.isArray(j.data) && esObjeto(j.data[0]) ? j.data[0] : null;
  const clave = primero && typeof primero.clave === "string" && /^[0-9a-f]{16}$/.test(primero.clave) ? primero.clave : null;
  return { total: j.total, caso: clave };
}

export async function getCifrasDetector(): Promise<CifrasDetector> {
  const [senales, relleno, repetidas] = await Promise.all([
    leer("/senales?limit=1"),
    leer("/patrones/acompanantes?solo=fuertes&size=1"),
    leer("/patrones/repetidas?size=1"),
  ]);
  return { reglas: reglasDe(senales), relleno: patronDe(relleno), repetidas: patronDe(repetidas) };
}
