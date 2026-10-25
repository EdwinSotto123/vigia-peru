/**
 * Recorrido de navegación: cuando una lista enlaza a un detalle, le pasa `?desde=<su URL con filtros>` para que la
 * ficha pueda (1) mostrar en las migas de dónde vino el usuario y (2) que "volver" regrese a la lista tal como estaba
 * (con sus filtros), en vez de a la ruta pelada. Es aditivo: sin `?desde` todo queda como antes. `desde` siempre es
 * una ruta interna; se valida antes de usarla como href.
 */
import type { Miga } from "@/components/patrones";

type Params = Record<string, string | string[] | number | undefined | null> | undefined;

/** Query string "?a=b&c=d" a partir de un objeto de parámetros (omite vacíos). */
export function qsDesde(parametros: Params): string {
  if (!parametros) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) { for (const x of v) if (x) p.append(k, String(x)); }
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** La URL de origen (ruta + sus filtros), para pasar como `desde`. */
export const urlDesde = (ruta: string, parametros?: Params): string => ruta + qsDesde(parametros);

/** Añade `?desde=` (o `&desde=`) a un href destino. */
export function conDesde(href: string, desde?: string): string {
  if (!desde) return href;
  return `${href}${href.includes("?") ? "&" : "?"}desde=${encodeURIComponent(desde)}`;
}

/** Rótulo humano del origen, derivado de su ruta. */
export function rotuloDesde(url: string): string {
  let path = url;
  try { path = decodeURIComponent(url); } catch { /* ya decodificado */ }
  path = path.split("?")[0];
  if (path.includes("/app/contratos")) return "Contratos";
  if (path.includes("/app/entidades") || path.includes("/entidad/")) return "Entidades";
  if (path.includes("/app/empresas") || path.includes("/empresa/")) return "Empresas";
  if (path.includes("/app/personas")) return "Personas contratadas";
  if (path.includes("/app/poder")) return "Mapa de poder";
  return "Volver";
}

/** Una ruta interna segura (no externa, no protocol-relative). */
const interno = (d: string | undefined): d is string => !!d && d.startsWith("/") && !d.startsWith("//");

/** Lee y valida `desde` de un searchParams (objeto de server o de useSearchParams ya decodificado). */
export function leerDesde(sp: { desde?: string | string[] } | undefined): string | undefined {
  const v = sp?.desde;
  const d = Array.isArray(v) ? v[0] : v;
  return interno(d) ? d : undefined;
}

/**
 * Antepone el origen al recorrido de migas. `items` es el recorrido fijo [Inicio, Sección, …, actual]; si hay un
 * `desde` válido, reemplaza el paso de la Sección por el origen con sus filtros (y su rótulo), conservando el resto.
 */
export function migasConDesde(desde: string | undefined, items: Miga[]): Miga[] {
  if (!interno(desde) || items.length < 2) return items;
  return [items[0], { etiqueta: rotuloDesde(desde), href: desde }, ...items.slice(2)];
}
