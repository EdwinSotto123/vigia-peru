import { normalizar, DEPARTAMENTOS } from "@/components/salud/lista/filtros";

/**
 * Los filtros de /sanciones (GET /salud/sanciones): leídos de la URL, validados y pasados a la API. La URL lleva sólo lo que
 * cambia de lo de siempre (lo más reciente primero, página 1). Sin JSX.
 */
export type TipoFiltroSancion = "amonestacion" | "multa" | "cierre_definitivo" | "otra";

export const TIPOS_FILTRO: { clave: TipoFiltroSancion; nombre: string }[] = [
  { clave: "multa", nombre: "Multa" },
  { clave: "amonestacion", nombre: "Amonestación escrita" },
  { clave: "cierre_definitivo", nombre: "Cierre definitivo" },
  { clave: "otra", nombre: "Otra sanción" },
];

export const GRAVEDADES = [
  { clave: "leve", nombre: "Leve" },
  { clave: "grave", nombre: "Grave" },
  { clave: "muy_grave", nombre: "Muy grave" },
] as const;

export const ADMINISTRADAS = [
  { clave: "IPRESS", nombre: "Establecimientos (IPRESS)" },
  { clave: "IAFAS", nombre: "Aseguradoras (IAFAS)" },
  { clave: "UGIPRESS", nombre: "Unidades de gestión (UGIPRESS)" },
] as const;

export interface FiltrosSanciones {
  q?: string;
  departamento?: string;
  /** Sólo con la región: «LIMA», «HUAURA». */
  provincia?: string;
  /** Sólo con la región: «MIRAFLORES». */
  distrito?: string;
  tipo?: TipoFiltroSancion;
  gravedad?: "leve" | "grave" | "muy_grave";
  administrada?: "IPRESS" | "IAFAS" | "UGIPRESS";
  naturaleza?: "publica" | "privada";
  anio?: number;
  ipress?: string;
  judicial?: "si";
  orden?: "multa";
  pagina?: number;
}

type Params = Record<string, string | string[] | undefined> | undefined;
const uno = (p: Params, k: string): string | undefined => {
  const v = p?.[k];
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s.slice(0, 120) : undefined;
};

export function filtrosSancionesDeUrl(p: Params): FiltrosSanciones {
  const f: FiltrosSanciones = {};
  const q = uno(p, "q");
  if (q && q.length >= 2) f.q = q;
  const dep = uno(p, "departamento");
  if (dep && (DEPARTAMENTOS as readonly string[]).includes(normalizar(dep))) f.departamento = normalizar(dep);
  const prov = uno(p, "provincia");
  if (prov && f.departamento) f.provincia = normalizar(prov).slice(0, 60);
  const dist = uno(p, "distrito");
  if (dist && f.departamento) f.distrito = normalizar(dist).slice(0, 60);
  const tipo = uno(p, "tipo");
  if (tipo && TIPOS_FILTRO.some((t) => t.clave === tipo)) f.tipo = tipo as TipoFiltroSancion;
  const gravedad = uno(p, "gravedad");
  if (gravedad === "leve" || gravedad === "grave" || gravedad === "muy_grave") f.gravedad = gravedad;
  const adm = uno(p, "administrada");
  if (adm === "IPRESS" || adm === "IAFAS" || adm === "UGIPRESS") f.administrada = adm;
  const nat = uno(p, "naturaleza");
  if (nat === "publica" || nat === "privada") f.naturaleza = nat;
  const anio = Number(uno(p, "anio"));
  if (Number.isInteger(anio) && anio >= 2010 && anio <= 2100) f.anio = anio;
  const ipress = uno(p, "ipress");
  if (ipress && /^\d{1,8}$/.test(ipress)) f.ipress = ipress.padStart(8, "0");
  if (uno(p, "judicial") === "si") f.judicial = "si";
  if (uno(p, "orden") === "multa") f.orden = "multa";
  const pagina = Number(uno(p, "pagina"));
  if (Number.isInteger(pagina) && pagina > 1) f.pagina = Math.min(pagina, 500);
  return f;
}

const CLAVES: (keyof FiltrosSanciones)[] = ["q", "departamento", "provincia", "distrito", "tipo", "gravedad", "administrada", "naturaleza", "anio", "ipress", "judicial", "orden", "pagina"];

export function qsSanciones(f: FiltrosSanciones): string {
  const u = new URLSearchParams();
  for (const k of CLAVES) {
    const v = f[k];
    if (v == null || v === "") continue;
    if (k === "pagina" && Number(v) <= 1) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export function paramsSanciones(f: FiltrosSanciones, tamano: number): URLSearchParams {
  const u = new URLSearchParams();
  for (const k of CLAVES) {
    const v = f[k];
    if (v == null || v === "" || k === "pagina") continue;
    u.set(k, String(v));
  }
  u.set("pagina", String(f.pagina ?? 1));
  u.set("tamano", String(tamano));
  return u;
}

/** Las multas en UIT, como las publica SUSALUD (sin convertir a soles): «12.5». */
export const uit = (n: number | null | undefined) => (n == null ? "sin dato" : new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(n));
