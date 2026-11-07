import { TIPOS_PROCESO, type TipoProceso } from "./filtros.ts";

/**
 * Los filtros de los contratos menores abiertos (≤8 UIT) en la URL de la app, y cómo se piden a la API
 * (GET /licitaciones/menores: `page` y `size` en vez de `pag` y `tam`). Puro, como filtros.ts.
 */

export const CUANDO = [
  { clave: "hoy", etiqueta: "Cierran hoy" },
  { clave: "nuevas", etiqueta: "Nuevos (24 horas)" },
] as const;
export const ORDENES_MENORES = [
  { clave: "cierra", etiqueta: "Cierran antes" },
  { clave: "reciente", etiqueta: "Más recientes" },
] as const;

export interface FiltrosMenores {
  q: string;
  tipo: TipoProceso[];
  region: string[];
  cuando: (typeof CUANDO)[number]["clave"] | null;
  orden: (typeof ORDENES_MENORES)[number]["clave"];
  pag: number;
  tam: 10 | 20 | 50;
}

export const FILTROS_MENORES: FiltrosMenores = { q: "", tipo: [], region: [], cuando: null, orden: "cierra", pag: 1, tam: 20 };

type Entrada = URLSearchParams | Record<string, string | string[] | undefined>;
const leer = (e: Entrada, k: string) => (e instanceof URLSearchParams ? e.get(k) ?? "" : ((Array.isArray(e[k]) ? e[k]![0] : e[k]) as string | undefined) ?? "");
const lista = (t: string) => [...new Set(t.split(",").map((x) => x.trim()).filter(Boolean))];

export function leerMenores(e: Entrada): FiltrosMenores {
  const pag = Number.parseInt(leer(e, "pag"), 10);
  const tam = Number(leer(e, "tam"));
  return {
    q: leer(e, "q").trim().slice(0, 120),
    tipo: lista(leer(e, "tipo")).filter((t): t is TipoProceso => (TIPOS_PROCESO as readonly string[]).includes(t)),
    region: lista(leer(e, "region")).filter((r) => /^\d{2}$/.test(r)),
    cuando: (CUANDO.find((c) => c.clave === leer(e, "cuando"))?.clave ?? null) as FiltrosMenores["cuando"],
    orden: leer(e, "orden") === "reciente" ? "reciente" : "cierra",
    // La API llega hasta la página 100.
    pag: Number.isFinite(pag) && pag >= 1 ? Math.min(pag, 100) : 1,
    tam: tam === 10 || tam === 50 ? tam : 20,
  };
}

/** Los filtros como URL de la app, sin los valores por defecto. */
export function aParamsMenores(f: FiltrosMenores): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.tipo.length) p.set("tipo", f.tipo.join(","));
  if (f.region.length) p.set("region", f.region.join(","));
  if (f.cuando) p.set("cuando", f.cuando);
  if (f.orden !== "cierra") p.set("orden", f.orden);
  if (f.pag !== 1) p.set("pag", String(f.pag));
  if (f.tam !== 20) p.set("tam", String(f.tam));
  return p;
}

/** Los mismos filtros como los pide la API (page y size). */
export function aApiMenores(f: FiltrosMenores): URLSearchParams {
  const p = aParamsMenores({ ...f, pag: 1, tam: 20 });
  p.set("page", String(f.pag));
  p.set("size", String(f.tam));
  p.set("orden", f.orden);
  return p;
}

export const activosMenores = (f: FiltrosMenores) => (f.q ? 1 : 0) + f.tipo.length + f.region.length + (f.cuando ? 1 : 0);
