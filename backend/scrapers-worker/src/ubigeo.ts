/**
 * Ubigeo INEI a partir de los nombres del OCDS (buyer.address: department, region = provincia,
 * locality = distrito): lo de backend/scrapers/_core/ubigeo.py. Match por nombre normalizado,
 * descendiendo departamento → provincia → distrito; si un nivel no matchea, queda el superior.
 */

import { asciiNfkd, colapsar, str, verdad } from "./py.ts";

/** `'  San   Martín-de Porres '` → `'SAN MARTIN DE PORRES'`. */
export function norm(s: unknown): string {
  if (!verdad(s)) return "";
  return colapsar(asciiNfkd(str(s)).toUpperCase().replaceAll("-", " "));
}

export interface FilaZona {
  ubigeo: string;
  nivel: string;
  nombre: string;
  padre_ubigeo: string | null;
}

export class ZonaIndex {
  readonly dptos = new Map<string, string>();                   // norm(nombre) → ubigeo(2)
  readonly provs = new Map<string, string>();                   // dpto + "|" + norm → ubigeo(4)
  readonly dists = new Map<string, string>();                   // prov + "|" + norm → ubigeo(6)

  static desdeFilas(filas: Iterable<FilaZona>): ZonaIndex {
    const ix = new ZonaIndex();
    for (const f of filas) {
      const n = norm(f.nombre);
      if (f.nivel === "departamento") ix.dptos.set(n, f.ubigeo);
      else if (f.nivel === "provincia") ix.provs.set(`${f.padre_ubigeo || ""}|${n}`, f.ubigeo);
      else if (f.nivel === "distrito") ix.dists.set(`${f.padre_ubigeo || ""}|${n}`, f.ubigeo);
    }
    return ix;
  }
}

/** Letras mínimas para aceptar un match por prefijo (nombre truncado). */
const MIN_PREFIJO = 8;

/**
 * El OCDS del OECE trunca `locality` (~19 caracteres): 'SANTA CRUZ DE TOLED'. Acepta el prefijo solo
 * si es largo y hay UN único distrito de la provincia que empiece así.
 */
function distritoPorPrefijo(ix: ZonaIndex, prov: string, loc: string): string | null {
  if (loc.length < MIN_PREFIJO) return null;
  const hits: string[] = [];
  for (const [clave, u] of ix.dists) {
    const corte = clave.indexOf("|");
    if (clave.slice(0, corte) === prov && clave.slice(corte + 1).startsWith(loc)) hits.push(u);
  }
  return hits.length === 1 ? hits[0] : null;
}

/** El ubigeo más fino que se pueda resolver (6, 4 o 2 dígitos) o null. */
export function resolverUbigeo(ix: ZonaIndex, departamento: unknown, region: unknown, localidad: unknown): string | null {
  const d = ix.dptos.get(norm(departamento));
  if (!d) return null;
  const p = verdad(region) ? ix.provs.get(`${d}|${norm(region)}`) : undefined;
  if (!p) return d;
  const loc = norm(localidad);
  const z = loc ? (ix.dists.get(`${p}|${loc}`) || distritoPorPrefijo(ix, p, loc)) : null;
  return z || p;
}
