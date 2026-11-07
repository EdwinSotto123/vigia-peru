/**
 * Los filtros de la bandeja y su forma en la URL (docs/PLAN.md, «Filtros»). Puro: lo usan la página del servidor (lee
 * los searchParams), el hook del cliente (escribe la URL) y los adaptadores. Un valor que no se entiende se descarta,
 * nunca rompe la página; los valores por defecto no se escriben en la URL.
 */

export const TIPOS_PROCESO = ["bienes", "servicios", "obras", "consultoria"] as const;
export type TipoProceso = (typeof TIPOS_PROCESO)[number];

export const ORDENES = [
  { clave: "recientes", etiqueta: "Más recientes" },
  { clave: "vence", etiqueta: "Vencen antes" },
  { clave: "valor_desc", etiqueta: "Mayor valor" },
  { clave: "valor_asc", etiqueta: "Menor valor" },
  { clave: "entidad", etiqueta: "Entidad (A a Z)" },
] as const;
export type Orden = (typeof ORDENES)[number]["clave"];

export const CONSULTAS = [
  { clave: "abiertas", etiqueta: "Consultas abiertas" },
  { clave: "3d", etiqueta: "Vencen en 3 días" },
  { clave: "7d", etiqueta: "Vencen en 7 días" },
  { clave: "vencidas", etiqueta: "Consultas vencidas" },
] as const;
export type FiltroConsultas = (typeof CONSULTAS)[number]["clave"];

export const PUBLICADAS = [7, 15, 30] as const;
export const TAMANOS = [10, 20, 50] as const;

export interface FiltrosBandeja {
  q: string;
  tipo: TipoProceso[];
  region: string[];
  proc: string;
  min: number | null;
  max: number | null;
  pub: (typeof PUBLICADAS)[number];
  cons: FiltroConsultas | null;
  senal: boolean;
  orden: Orden;
  pag: number;
  tam: (typeof TAMANOS)[number];
}

export const FILTROS_POR_DEFECTO: FiltrosBandeja = {
  q: "",
  tipo: [],
  region: [],
  proc: "",
  min: null,
  max: null,
  pub: 30,
  cons: null,
  senal: false,
  orden: "recientes",
  pag: 1,
  tam: 20,
};

type Entrada = URLSearchParams | Record<string, string | string[] | undefined>;

function leer(e: Entrada, clave: string): string {
  if (e instanceof URLSearchParams) return e.get(clave) ?? "";
  const v = e[clave];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const lista = (t: string) => [...new Set(t.split(",").map((x) => x.trim()).filter(Boolean))];
const monto = (t: string): number | null => {
  const limpio = t.replace(/[^\d.]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const entero = (t: string, def: number) => {
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n >= 1 ? n : def;
};
const de = <T extends string | number>(t: string, validos: readonly T[], def: T): T =>
  (validos.find((v) => String(v) === t) ?? def) as T;

/** Los filtros desde la URL (los searchParams de la página o un URLSearchParams). */
export function leerFiltros(e: Entrada): FiltrosBandeja {
  const d = FILTROS_POR_DEFECTO;
  let min = monto(leer(e, "min"));
  let max = monto(leer(e, "max"));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return {
    q: leer(e, "q").trim().slice(0, 120),
    tipo: lista(leer(e, "tipo")).filter((t): t is TipoProceso => (TIPOS_PROCESO as readonly string[]).includes(t)),
    region: lista(leer(e, "region")).filter((r) => /^\d{2}$/.test(r)),
    proc: leer(e, "proc").trim().slice(0, 80),
    min,
    max,
    pub: Number(de(leer(e, "pub"), PUBLICADAS.map(String), String(d.pub))) as FiltrosBandeja["pub"],
    cons: (CONSULTAS.find((c) => c.clave === leer(e, "cons"))?.clave ?? null) as FiltroConsultas | null,
    senal: leer(e, "senal") === "1",
    orden: de(leer(e, "orden"), ORDENES.map((o) => o.clave), d.orden),
    pag: entero(leer(e, "pag"), 1),
    tam: Number(de(leer(e, "tam"), TAMANOS.map(String), String(d.tam))) as FiltrosBandeja["tam"],
  };
}

/** Los filtros como URL, sin los valores por defecto: `?q=toner&tipo=bienes,servicios&pag=2`. */
export function aParams(f: FiltrosBandeja): URLSearchParams {
  const d = FILTROS_POR_DEFECTO;
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.tipo.length) p.set("tipo", f.tipo.join(","));
  if (f.region.length) p.set("region", f.region.join(","));
  if (f.proc) p.set("proc", f.proc);
  if (f.min != null) p.set("min", String(f.min));
  if (f.max != null) p.set("max", String(f.max));
  if (f.pub !== d.pub) p.set("pub", String(f.pub));
  if (f.cons) p.set("cons", f.cons);
  if (f.senal) p.set("senal", "1");
  if (f.orden !== d.orden) p.set("orden", f.orden);
  if (f.pag !== d.pag) p.set("pag", String(f.pag));
  if (f.tam !== d.tam) p.set("tam", String(f.tam));
  return p;
}

/** Cambia filtros: todo cambio que no sea de página vuelve a la primera. */
export function cambiar(f: FiltrosBandeja, cambios: Partial<FiltrosBandeja>): FiltrosBandeja {
  return { ...f, ...cambios, pag: cambios.pag ?? 1 };
}

/** Cuántos filtros de búsqueda hay puestos (sin contar orden, página ni tamaño). */
export function filtrosActivos(f: FiltrosBandeja): number {
  const d = FILTROS_POR_DEFECTO;
  return (
    (f.q ? 1 : 0) +
    f.tipo.length +
    f.region.length +
    (f.proc ? 1 : 0) +
    (f.min != null || f.max != null ? 1 : 0) +
    (f.pub !== d.pub ? 1 : 0) +
    (f.cons ? 1 : 0) +
    (f.senal ? 1 : 0)
  );
}

/** Sin tildes, en minúsculas y con los espacios juntos: para buscar texto. */
export function normalizar(t: string | null | undefined): string {
  return (t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
