import { DEPARTAMENTOS, nombreLugar } from "@/components/salud/lista/filtros";
import type { FiltroBarra } from "@/components/salud/filtros/BarraFiltros";

/**
 * Las listas de locales autorizados de Gobserva Car (revisión técnica, licencia, gas): un local del MTC, los filtros de la
 * URL (región, provincia, distrito, búsqueda, tipo de gas) y lo que piden la barra de filtros y las páginas. Las listas son
 * archivos estáticos (data/car, scripts/car): se filtran en el servidor, sin API.
 */
export interface Local {
  /** null: una persona natural con negocio (RUC 10), cuyo nombre no se guarda. */
  nombre?: string | null;
  direccion?: string | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  telefono?: string | null;
  resolucion?: string | null;
  fechaResolucion?: string | null;
  /** Gas vehicular: «GNV», «GLP» o los dos. */
  tipos?: string[];
}

export type Params = Record<string, string | string[] | undefined> | undefined;

export interface FiltrosLugar {
  region: string | null;
  provincia: string | null;
  distrito: string | null;
  q: string;
  tipo: string | null;
  seccion: string | null;
  pagina: number;
}

const texto = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
export const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

export function filtrosDeUrl(sp: Params): FiltrosLugar {
  const region = DEPARTAMENTOS.find((d) => d === normal(texto(sp?.region))) ?? null;
  const tipo = normal(texto(sp?.tipo));
  return {
    region,
    provincia: region ? normal(texto(sp?.provincia)) || null : null,
    distrito: region ? normal(texto(sp?.distrito)) || null : null,
    q: texto(sp?.q).slice(0, 60),
    tipo: tipo === "GNV" || tipo === "GLP" ? tipo : null,
    seccion: texto(sp?.seccion) || null,
    pagina: Math.max(1, Math.floor(Number(texto(sp?.pagina))) || 1),
  };
}

/** Lo que la URL lleva hoy, sin la página ni la pestaña (para la barra de filtros). */
export function paramsDe(f: FiltrosLugar): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ region: f.region, provincia: f.provincia, distrito: f.distrito, q: f.q, tipo: f.tipo }).filter(([, v]) => v) as [string, string][],
  );
}

/** Los locales que pasan los filtros. Una lista sin tipos de gas (los centros de cilindros) no se filtra por tipo. */
export function filtrar<T extends Local>(lista: T[], f: FiltrosLugar): T[] {
  const palabras = normal(f.q).split(/\s+/).filter((w) => w.length > 1);
  return lista.filter(
    (l) =>
      (!f.region || l.departamento === f.region) &&
      (!f.provincia || l.provincia === f.provincia) &&
      (!f.distrito || l.distrito === f.distrito) &&
      (!f.tipo || !l.tipos || l.tipos.includes(f.tipo)) &&
      palabras.every((w) => normal(`${l.nombre ?? ""} ${l.distrito ?? ""} ${l.provincia ?? ""} ${l.direccion ?? ""} ${l.resolucion ?? ""}`).includes(w)),
  );
}

function contar(listas: Local[][], clave: "departamento" | "provincia" | "distrito", cond: (l: Local) => boolean = () => true) {
  const n = new Map<string, number>();
  for (const lista of listas) for (const l of lista) if (l[clave] && cond(l)) n.set(l[clave]!, (n.get(l[clave]!) ?? 0) + 1);
  return n;
}

/**
 * Los filtros de lugar de la barra: la región (con cuántos locales tiene cada una, contando todas las listas de la página)
 * y, con una región, su provincia y su distrito (2026-11-22, el usuario: «debería haber región, distrito»).
 */
export function filtrosLugar(listas: Local[][], f: FiltrosLugar): FiltroBarra[] {
  const regiones = contar(listas, "departamento");
  const out: FiltroBarra[] = [
    {
      tipo: "uno",
      clave: "region",
      etiqueta: "Región",
      buscar: true,
      valor: f.region,
      opciones: DEPARTAMENTOS.filter((d) => regiones.has(d)).map((d) => ({ valor: d, nombre: nombreLugar(d), n: regiones.get(d) })),
    },
  ];
  if (!f.region) return out;
  const provincias = contar(listas, "provincia", (l) => l.departamento === f.region);
  const distritos = contar(listas, "distrito", (l) => l.departamento === f.region && (!f.provincia || l.provincia === f.provincia));
  const orden = (m: Map<string, number>) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  if (provincias.size > 1 || f.provincia)
    out.push({
      tipo: "uno",
      clave: "provincia",
      etiqueta: "Provincia",
      buscar: provincias.size > 8,
      valor: f.provincia,
      opciones: orden(provincias).map(([v, n]) => ({ valor: v, nombre: nombreLugar(v), n })),
    });
  if (distritos.size > 1 || f.distrito)
    out.push({
      tipo: "uno",
      clave: "distrito",
      etiqueta: "Distrito",
      buscar: distritos.size > 8,
      valor: f.distrito,
      opciones: orden(distritos).map(([v, n]) => ({ valor: v, nombre: nombreLugar(v), n })),
    });
  return out;
}

export const DEPENDIENTES = { region: ["provincia", "distrito"], provincia: ["distrito"] };

/** «Bellavista, Callao» o «Comas, Lima»: el distrito, la provincia si es otra y la región si es otra. */
export function lugarDe(l: Local): string {
  const partes = [l.distrito, l.provincia !== l.distrito ? l.provincia : null, l.departamento !== l.provincia ? l.departamento : null];
  return partes.filter(Boolean).map((x) => nombreLugar(x)).join(", ");
}

/** El nombre del lugar elegido, el más chico: «en Comas», «en Arequipa», «en el Perú». */
export function dondeDe(f: FiltrosLugar): string {
  const x = f.distrito ?? f.provincia ?? f.region;
  return x ? `en ${nombreLugar(x)}` : "en el Perú";
}

/** Una página de la lista; sólo la pestaña abierta usa la página de la URL (las demás empiezan en la 1). */
export function paginar<T>(lista: T[], pagina: number, tamano: number) {
  const paginas = Math.max(1, Math.ceil(lista.length / tamano));
  const actual = Math.min(pagina, paginas);
  return { paginas, pagina: actual, items: lista.slice((actual - 1) * tamano, actual * tamano) };
}

/** El buscador de mapas con el nombre y la dirección del local (no hay coordenadas en las listas del MTC). */
export function urlMapa(l: Local): string | null {
  if (!l.direccion) return null;
  const q = [l.nombre, l.direccion, l.distrito, l.departamento, "Perú"].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
