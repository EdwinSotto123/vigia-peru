/**
 * Centroides aproximados de los 24 departamentos + Lima Provincia del Perú.
 * Coords en formato (lat, lon) WGS84. Usados para posicionar pines de alertas
 * cuando la convocatoria no trae lat/lon explícito.
 *
 * Fuente: aproximaciones de capital regional, suficiente para visualización.
 */

export interface RegionCentroid {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
}

export const REGION_COORDS: RegionCentroid[] = [
  { id: "amazonas",       nombre: "Amazonas",       lat: -6.2308,  lon: -77.8722 },
  { id: "ancash",         nombre: "Áncash",         lat: -9.5277,  lon: -77.5278 },
  { id: "apurimac",       nombre: "Apurímac",       lat: -13.6354, lon: -72.8810 },
  { id: "arequipa",       nombre: "Arequipa",       lat: -16.4090, lon: -71.5375 },
  { id: "ayacucho",       nombre: "Ayacucho",       lat: -13.1588, lon: -74.2233 },
  { id: "cajamarca",      nombre: "Cajamarca",      lat: -7.1638,  lon: -78.5003 },
  { id: "callao",         nombre: "Callao",         lat: -12.0500, lon: -77.1300 },
  { id: "cusco",          nombre: "Cusco",          lat: -13.5319, lon: -71.9675 },
  { id: "huancavelica",   nombre: "Huancavelica",   lat: -12.7867, lon: -74.9737 },
  { id: "huanuco",        nombre: "Huánuco",        lat: -9.9306,  lon: -76.2422 },
  { id: "ica",            nombre: "Ica",            lat: -14.0681, lon: -75.7286 },
  { id: "junin",          nombre: "Junín",          lat: -12.0651, lon: -75.2049 },
  { id: "la_libertad",    nombre: "La Libertad",    lat: -8.1116,  lon: -79.0287 },
  { id: "lambayeque",     nombre: "Lambayeque",     lat: -6.7011,  lon: -79.9061 },
  { id: "lima",           nombre: "Lima",           lat: -12.0464, lon: -77.0428 },
  { id: "loreto",         nombre: "Loreto",         lat: -3.7437,  lon: -73.2516 },
  { id: "madre_de_dios",  nombre: "Madre de Dios",  lat: -12.5933, lon: -69.1894 },
  { id: "moquegua",       nombre: "Moquegua",       lat: -17.1936, lon: -70.9347 },
  { id: "pasco",          nombre: "Pasco",          lat: -10.6828, lon: -76.2566 },
  { id: "piura",          nombre: "Piura",          lat: -5.1945,  lon: -80.6328 },
  { id: "puno",           nombre: "Puno",           lat: -15.8402, lon: -70.0219 },
  { id: "san_martin",     nombre: "San Martín",     lat: -6.4858,  lon: -76.3611 },
  { id: "tacna",          nombre: "Tacna",          lat: -18.0066, lon: -70.2463 },
  { id: "tumbes",         nombre: "Tumbes",         lat: -3.5669,  lon: -80.4515 },
  { id: "ucayali",        nombre: "Ucayali",        lat: -8.3791,  lon: -74.5539 },
];

function normalizar(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// Pre-computar mapa normalizado para lookup O(1)
const _lookup = new Map<string, RegionCentroid>();
for (const r of REGION_COORDS) {
  _lookup.set(normalizar(r.nombre), r);
  _lookup.set(r.id, r);
}

/**
 * Devuelve el centroide de la región dada por nombre (acepta "Tumbes",
 * "TUMBES", "Áncash", "Ancash", "la_libertad", etc.) o null si no matchea.
 */
export function coordsForRegion(regionName: string | null | undefined): { lat: number; lon: number } | null {
  if (!regionName) return null;
  const key = normalizar(regionName);
  if (!key) return null;
  const match = _lookup.get(key);
  if (match) return { lat: match.lat, lon: match.lon };
  // Fallback: buscar por substring (ej. "Lima Metropolitana")
  for (const r of REGION_COORDS) {
    if (normalizar(r.nombre).startsWith(key) || key.startsWith(normalizar(r.nombre))) {
      return { lat: r.lat, lon: r.lon };
    }
  }
  return null;
}

/**
 * Aplica un jitter determinista basado en el id para evitar que múltiples
 * alertas en la misma región queden apiladas en el mismo punto.
 */
export function coordsForRegionWithJitter(
  regionName: string | null | undefined,
  id: string,
): { lat: number; lon: number } | null {
  const base = coordsForRegion(regionName);
  if (!base) return null;
  // Hash simple del id → offset entre -0.3° y +0.3° (~33km)
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const dx = ((h & 0xff) / 255 - 0.5) * 0.6;
  const dy = (((h >> 8) & 0xff) / 255 - 0.5) * 0.6;
  return { lat: base.lat + dy, lon: base.lon + dx };
}
