/**
 * Utilidades compartidas del panel de zona del mapa.
 *
 * - `REGION_UBIGEO`: regionId (slug de `lib/peru-data` y `properties.id` del
 *   geojson) → ubigeo INEI de departamento (`properties.code`). Es la llave que
 *   une el mapa de alertas con "Financia una auditoría" (`/app/financiar/[ubigeo]`).
 * - `belongsToRegion`: las alertas/entidades/reportes de la base traen `region`
 *   a veces como departamento ("Áncash"), a veces como provincia ("Huamanga").
 *   Comparamos normalizado contra el nombre del departamento y sus provincias.
 */

import { REGIONES } from "@/lib/peru-data";
import { normalizeRegionId } from "@/lib/utils";

export const REGION_UBIGEO: Record<string, string> = {
  amazonas: "01",
  ancash: "02",
  apurimac: "03",
  arequipa: "04",
  ayacucho: "05",
  cajamarca: "06",
  callao: "07",
  cusco: "08",
  huancavelica: "09",
  huanuco: "10",
  ica: "11",
  junin: "12",
  lalibertad: "13",
  lambayeque: "14",
  lima: "15",
  loreto: "16",
  madrededios: "17",
  moquegua: "18",
  pasco: "19",
  piura: "20",
  puno: "21",
  sanmartin: "22",
  tacna: "23",
  tumbes: "24",
  ucayali: "25",
};

export const UBIGEO_REGION: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_UBIGEO).map(([id, code]) => [code, id]),
);

// Provincias que la API usa como `region` y que no están en el catálogo de REGIONES
// (lib/peru-data sólo lista las provincias con centroide INEI cargado a mano).
const EXTRA_PROVINCIAS: Record<string, string[]> = {
  ayacucho: ["huamanga", "huancasancos", "lamar"],
  apurimac: ["abancay", "andahuaylas", "antabamba"],
  cajamarca: ["cutervo"],
  arequipa: ["caraveli"],
  puno: ["melgar"],
  loreto: ["mariscalramoncastilla", "maynas"],
  sanmartin: ["moyobamba"],
  ucayali: ["coronelportillo", "atalaya"],
  amazonas: ["bongara", "utcubamba"],
  moquegua: ["ilo"],
  madrededios: ["tambopata"],
  lalibertad: ["ascope"],
  ancash: ["huarmey"],
  cusco: ["paucartambo"],
};

const keysCache = new Map<string, Set<string>>();

function regionKeys(regionId: string): Set<string> {
  const cached = keysCache.get(regionId);
  if (cached) return cached;
  const region = REGIONES.find((r) => r.id === regionId);
  const keys = new Set<string>([regionId]);
  if (region) {
    keys.add(normalizeRegionId(region.nombre));
    for (const p of region.provincias) keys.add(normalizeRegionId(p.nombre));
  }
  for (const p of EXTRA_PROVINCIAS[regionId] ?? []) keys.add(p);
  keysCache.set(regionId, keys);
  return keys;
}

/** ¿Este registro (alerta, entidad, reporte) pertenece al departamento `regionId`? */
export function belongsToRegion(
  item: { region?: string | null; provincia?: string | null },
  regionId: string,
): boolean {
  const keys = regionKeys(regionId);
  const r = normalizeRegionId(item.region || "");
  const p = normalizeRegionId(item.provincia || "");
  if (r && keys.has(r)) return true;
  if (p && keys.has(p)) return true;
  // "Lima Metropolitana", "Región Áncash", etc.
  if (r && r.length >= 4) {
    for (const k of keys) if (k.length >= 4 && (r.includes(k) || k.includes(r))) return true;
  }
  return false;
}
