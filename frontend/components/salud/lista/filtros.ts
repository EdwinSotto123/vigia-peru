import { conAcentos } from "@/lib/financiamiento";
import { CATEGORIAS_ORDEN, TIPOS_IPRESS, nombrePropio, type Sector } from "@/lib/gobserva-salud";
import { tildesEnTitulo } from "@/lib/tildes";
import type { FiltroSeguro } from "@/lib/salud-seguros";

/**
 * Los filtros de /establecimientos y de /mapa de Gobserva Salud, leídos de la URL y pasados a la API (GET
 * /salud/establecimientos y /salud/mapa). Sin JSX: lo usan las páginas del servidor y el mapa (cliente). La URL lleva sólo
 * lo que cambia de lo de siempre (activas, por relevancia, página 1), así un enlace se puede compartir y queda corto.
 */

/** Los 25 departamentos como los escribe RENIPRESS (mayúsculas, sin tildes): el valor del filtro. */
export const DEPARTAMENTOS = [
  "AMAZONAS", "ANCASH", "APURIMAC", "AREQUIPA", "AYACUCHO", "CAJAMARCA", "CALLAO", "CUSCO", "HUANCAVELICA", "HUANUCO", "ICA", "JUNIN",
  "LA LIBERTAD", "LAMBAYEQUE", "LIMA", "LORETO", "MADRE DE DIOS", "MOQUEGUA", "PASCO", "PIURA", "PUNO", "SAN MARTIN", "TACNA", "TUMBES", "UCAYALI",
] as const;

/** «SAN MARTIN» → «San Martín», «HUANUCO» → «Huánuco». */
export function nombreLugar(t: string | null | undefined): string {
  if (!t) return "";
  return conAcentos(tildesEnTitulo(nombrePropio(t)));
}

/** «Miraflores, Lima»: el distrito y el departamento (o lo que haya). */
export function lugarIpress(x: { distrito: string | null; provincia?: string | null; departamento: string | null }): string {
  const partes = [x.distrito, x.departamento].filter((p): p is string => !!p).map(nombreLugar);
  return [...new Set(partes)].join(", ") || "Sin ubicación";
}

/** Mayúsculas sin tildes (como `norm` de la API), para comparar un departamento con el nombre del mapa. */
export function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

export type OrdenLista = "relevancia" | "nombre" | "sanciones" | "categoria" | "denuncias";
export type EstadoLista = "activos" | "todos" | "inactivos";

export const ORDENES: { clave: OrdenLista; nombre: string }[] = [
  { clave: "relevancia", nombre: "Relevancia" },
  { clave: "nombre", nombre: "Nombre, de la A a la Z" },
  { clave: "categoria", nombre: "Mayor categoría primero" },
  { clave: "sanciones", nombre: "Más sanciones firmes primero" },
  { clave: "denuncias", nombre: "Más denuncias primero" },
];

export const ESTADOS: { clave: EstadoLista; nombre: string }[] = [
  { clave: "activos", nombre: "Activos en RENIPRESS" },
  { clave: "todos", nombre: "Activos e inactivos" },
  { clave: "inactivos", nombre: "Sólo inactivos (cierre, baja)" },
];

export interface FiltrosLista {
  q?: string;
  departamento?: string;
  provincia?: string;
  distrito?: string;
  categoria?: string;
  sector?: Sector;
  tipo?: string;
  estado?: EstadoLista;
  sanciones?: "con" | "sin";
  quirurgico?: "si";
  internamiento?: "si";
  /** Con qué seguro atiende (la institución en RENIPRESS): lib/salud-seguros.ts. */
  seguro?: FiltroSeguro;
  /** Declaró atender las 24 horas. */
  h24?: "si";
  orden?: OrdenLista;
  pagina?: number;
}

type Params = Record<string, string | string[] | undefined> | undefined;

const uno = (p: Params, k: string): string | undefined => {
  const v = p?.[k];
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s.slice(0, 120) : undefined;
};

const CATS_VALIDAS = new Set<string>([...CATEGORIAS_ORDEN, "SIN"]);

/** Los filtros de la URL, validados: lo que no se entiende se descarta (nunca llega a la API un valor que la rompa). */
export function filtrosDeUrl(p: Params): FiltrosLista {
  const f: FiltrosLista = {};
  const q = uno(p, "q");
  if (q && q.length >= 2) f.q = q;
  const dep = uno(p, "departamento");
  if (dep) {
    const n = normalizar(dep);
    if ((DEPARTAMENTOS as readonly string[]).includes(n)) f.departamento = n;
  }
  const prov = uno(p, "provincia");
  if (prov && f.departamento) f.provincia = normalizar(prov).slice(0, 60);
  const dist = uno(p, "distrito");
  if (dist && f.departamento) f.distrito = normalizar(dist).slice(0, 60);
  // El formulario manda la provincia escondida con el departamento al que pertenece: si en el formulario se eligió otro
  // departamento, la provincia (y el distrito) de antes ya no corresponden.
  const de = uno(p, "provinciaDe");
  if (de && normalizar(de) !== f.departamento) {
    delete f.provincia;
    delete f.distrito;
  }
  const cat = uno(p, "categoria");
  if (cat) {
    const cats = cat.toUpperCase().split(",").map((c) => c.trim()).filter((c) => CATS_VALIDAS.has(c));
    if (cats.length) f.categoria = [...new Set(cats)].join(",");
  }
  const sector = uno(p, "sector");
  if (sector === "publico" || sector === "privado" || sector === "otro") f.sector = sector;
  const tipo = uno(p, "tipo");
  if (tipo && TIPOS_IPRESS.some((t) => t.clave === tipo)) f.tipo = tipo;
  const estado = uno(p, "estado");
  if (estado === "todos" || estado === "inactivos") f.estado = estado;
  const sanciones = uno(p, "sanciones");
  if (sanciones === "con" || sanciones === "sin") f.sanciones = sanciones;
  if (uno(p, "quirurgico") === "si") f.quirurgico = "si";
  if (uno(p, "internamiento") === "si") f.internamiento = "si";
  const seguro = uno(p, "seguro");
  if (seguro === "sis" || seguro === "essalud" || seguro === "sanidad" || seguro === "privado") f.seguro = seguro;
  if (uno(p, "h24") === "si") f.h24 = "si";
  const orden = uno(p, "orden");
  if (orden && ORDENES.some((o) => o.clave === orden) && orden !== "relevancia") f.orden = orden as OrdenLista;
  const pagina = Number(uno(p, "pagina"));
  if (Number.isInteger(pagina) && pagina > 1) f.pagina = Math.min(pagina, 2000);
  return f;
}

/** El orden de las claves en la URL (siempre el mismo: el mismo filtro es la misma dirección). */
const CLAVES: (keyof FiltrosLista)[] = ["q", "departamento", "provincia", "distrito", "categoria", "seguro", "h24", "sector", "tipo", "estado", "sanciones", "quirurgico", "internamiento", "orden", "pagina"];

/** «?departamento=LIMA&sector=privado», sin los valores de siempre. */
export function qsLista(f: FiltrosLista): string {
  const u = new URLSearchParams();
  for (const k of CLAVES) {
    const v = f[k];
    if (v == null || v === "") continue;
    if (k === "estado" && v === "activos") continue;
    if (k === "orden" && v === "relevancia") continue;
    if (k === "pagina" && Number(v) <= 1) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Los parámetros de la API para una página de la lista. */
export function paramsApi(f: FiltrosLista, tamano: number): URLSearchParams {
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

/** Los filtros que también entiende el mapa (sin texto, orden ni página). */
export function filtrosMapa(f: FiltrosLista): FiltrosLista {
  const { departamento, categoria, sector, tipo, estado, sanciones, quirurgico, internamiento, seguro, h24 } = f;
  return { departamento, categoria, sector, tipo, estado, sanciones, quirurgico, internamiento, seguro, h24 };
}

/** El nombre de una categoría para un filtro: «II-1» o «Sin categoría». */
export const nombreCategoria = (c: string) => (c === "SIN" ? "Sin categoría" : c);

/** El nombre de un tipo de IPRESS por su clave de filtro. */
export const nombreTipo = (clave: string) => TIPOS_IPRESS.find((t) => t.clave === clave)?.nombre ?? clave;
