/**
 * Geografía del Perú: los 25 departamentos con su centroide INEI, su población
 * y sus provincias. **Nada más.**
 *
 * Hasta hoy este archivo declaraba en su segunda línea "métricas mock para el
 * demo" y traía, por departamento y por provincia, `alertas`, `convergentes`,
 * `monto`, `scorePromedio`, una serie de seis meses y un top de entidades —
 * todo inventado. El mapa los pintaba sobre provincias reales: `Yungay` salía
 * roja con "2 alertas" que no existen en ninguna base, y el pie del mapa
 * invitaba a "tocar una provincia roja". Un producto que acusa al Estado de
 * falta de transparencia no puede fabricar señales de riesgo sobre el mapa del
 * país. Las métricas se amputaron.
 *
 * De dónde salen ahora las cifras del mapa:
 *   · contratos, monto, cola, leídos, señales → `getContratosGeo` (/contratos/geo),
 *     en tres niveles (departamento · provincia · distrito), con ubigeo real.
 *   · financiamiento de la auditoría por zona → `getZonas` (/financiamiento/zonas).
 *
 * No hay serie temporal: no existe ningún endpoint con historia, y el campo
 * `serie` que vivía acá era literalmente `metadata->'serie_mock'`.
 *
 * Los `nombre` de provincia deben seguir coincidiendo (ignorando acentos y
 * mayúsculas) con los de `public/peru-provinces.json`: es el join visual del
 * mapa y la llave de `belongsToRegion` en `components/mapa/region-match.ts`.
 */

export interface ProvinciaGeo {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
}

export interface RegionGeo {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
  poblacion: number;
  provincias: ProvinciaGeo[];
}

export const REGIONES: RegionGeo[] = [
  {
    id: "ancash",
    nombre: "Áncash",
    lat: -9.5277,
    lon: -77.5278,
    poblacion: 1180000,
    provincias: [
      { id: "ancash-huaraz", nombre: "Huaraz", lat: -9.5277, lon: -77.5278 },
      { id: "ancash-carhuaz", nombre: "Carhuaz", lat: -9.276, lon: -77.6437 },
      { id: "ancash-yungay", nombre: "Yungay", lat: -9.1378, lon: -77.7458 },
      { id: "ancash-recuay", nombre: "Recuay", lat: -9.7218, lon: -77.4533 },
      { id: "ancash-huaylas", nombre: "Huaylas", lat: -9.0464, lon: -77.8089 },
      { id: "ancash-santa", nombre: "Santa", lat: -9.0742, lon: -78.5938 },
      { id: "ancash-casma", nombre: "Casma", lat: -9.4747, lon: -78.3025 },
      { id: "ancash-bolognesi", nombre: "Bolognesi", lat: -10.0667, lon: -77.2167 },
    ],
  },
  {
    id: "cusco",
    nombre: "Cusco",
    lat: -13.5319,
    lon: -71.9675,
    poblacion: 1357000,
    provincias: [
      { id: "cusco-cusco", nombre: "Cusco", lat: -13.531, lon: -71.9075 },
      { id: "cusco-calca", nombre: "Calca", lat: -13.4147, lon: -71.8492 },
      { id: "cusco-laconvencion", nombre: "La Convencion", lat: -12.9, lon: -72.7 },
      { id: "cusco-espinar", nombre: "Espinar", lat: -14.7972, lon: -71.4118 },
      { id: "cusco-quispicanchi", nombre: "Quispicanchi", lat: -13.7, lon: -71.6 },
    ],
  },
  {
    id: "lima",
    nombre: "Lima",
    lat: -12.0464,
    lon: -77.0428,
    poblacion: 10720000,
    provincias: [
      { id: "lima-lima", nombre: "Lima", lat: -12.0608, lon: -77.0345 },
      { id: "lima-canete", nombre: "Cañete", lat: -13.0833, lon: -76.3833 },
      { id: "lima-huaura", nombre: "Huaura", lat: -11.107, lon: -77.609 },
      { id: "lima-huaral", nombre: "Huaral", lat: -11.4954, lon: -77.2068 },
    ],
  },
  {
    id: "piura",
    nombre: "Piura",
    lat: -5.1945,
    lon: -80.6328,
    poblacion: 2050000,
    provincias: [
      { id: "piura-piura", nombre: "Piura", lat: -5.1936, lon: -80.6203 },
      { id: "piura-sullana", nombre: "Sullana", lat: -4.9039, lon: -80.685 },
      { id: "piura-talara", nombre: "Talara", lat: -4.5781, lon: -81.2719 },
      { id: "piura-sechura", nombre: "Sechura", lat: -5.5577, lon: -80.8214 },
    ],
  },
  {
    id: "lalibertad",
    nombre: "La Libertad",
    lat: -8.1116,
    lon: -79.0288,
    poblacion: 2016000,
    provincias: [
      { id: "lalibertad-trujillo", nombre: "Trujillo", lat: -8.1116, lon: -79.0288 },
      { id: "lalibertad-pataz", nombre: "Pataz", lat: -7.823, lon: -77.625 },
      { id: "lalibertad-otuzco", nombre: "Otuzco", lat: -7.9, lon: -78.5833 },
      { id: "lalibertad-sanchezcarrion", nombre: "Sanchez Carrion", lat: -7.8167, lon: -78.0333 },
    ],
  },
  {
    id: "arequipa",
    nombre: "Arequipa",
    lat: -16.409,
    lon: -71.5375,
    poblacion: 1497000,
    provincias: [
      { id: "arequipa-arequipa", nombre: "Arequipa", lat: -16.409, lon: -71.5375 },
      { id: "arequipa-camana", nombre: "Camana", lat: -16.6233, lon: -72.7156 },
      { id: "arequipa-caylloma", nombre: "Caylloma", lat: -15.6336, lon: -71.7794 },
    ],
  },
  {
    id: "junin",
    nombre: "Junín",
    lat: -12.0651,
    lon: -75.2049,
    poblacion: 1361000,
    provincias: [
      { id: "junin-huancayo", nombre: "Huancayo", lat: -12.0651, lon: -75.2049 },
      { id: "junin-tarma", nombre: "Tarma", lat: -11.4197, lon: -75.6906 },
      { id: "junin-satipo", nombre: "Satipo", lat: -11.2528, lon: -74.6356 },
    ],
  },
  {
    id: "puno",
    nombre: "Puno",
    lat: -15.8402,
    lon: -70.0219,
    poblacion: 1172000,
    provincias: [
      { id: "puno-puno", nombre: "Puno", lat: -15.8402, lon: -70.0219 },
      { id: "puno-sanroman", nombre: "San Roman", lat: -15.4944, lon: -70.13 },
      { id: "puno-azangaro", nombre: "Azangaro", lat: -14.9094, lon: -70.1881 },
    ],
  },
  {
    id: "cajamarca",
    nombre: "Cajamarca",
    lat: -7.1611,
    lon: -78.5126,
    poblacion: 1453000,
    provincias: [
      { id: "cajamarca-cajamarca", nombre: "Cajamarca", lat: -7.1611, lon: -78.5126 },
      { id: "cajamarca-jaen", nombre: "Jaen", lat: -5.7081, lon: -78.8081 },
      { id: "cajamarca-celendin", nombre: "Celendin", lat: -6.866, lon: -78.146 },
    ],
  },
  {
    id: "loreto",
    nombre: "Loreto",
    lat: -3.7437,
    lon: -73.2516,
    poblacion: 1027000,
    provincias: [
      { id: "loreto-maynas", nombre: "Maynas", lat: -3.7437, lon: -73.2516 },
      { id: "loreto-altoamazonas", nombre: "Alto Amazonas", lat: -5.2406, lon: -76.0322 },
    ],
  },
  { id: "tumbes", nombre: "Tumbes", lat: -3.5669, lon: -80.453, poblacion: 247000, provincias: [] },
  { id: "lambayeque", nombre: "Lambayeque", lat: -6.7011, lon: -79.9061, poblacion: 1310000, provincias: [] },
  { id: "amazonas", nombre: "Amazonas", lat: -6.2308, lon: -77.8718, poblacion: 426000, provincias: [] },
  { id: "sanmartin", nombre: "San Martín", lat: -6.4886, lon: -76.3658, poblacion: 899000, provincias: [] },
  { id: "huanuco", nombre: "Huánuco", lat: -9.9295, lon: -76.2422, poblacion: 760000, provincias: [] },
  { id: "ucayali", nombre: "Ucayali", lat: -8.3791, lon: -74.5539, poblacion: 506000, provincias: [] },
  { id: "pasco", nombre: "Pasco", lat: -10.6828, lon: -76.2563, poblacion: 254000, provincias: [] },
  { id: "huancavelica", nombre: "Huancavelica", lat: -12.7866, lon: -74.9764, poblacion: 365000, provincias: [] },
  { id: "ica", nombre: "Ica", lat: -14.0681, lon: -75.7286, poblacion: 850000, provincias: [] },
  { id: "ayacucho", nombre: "Ayacucho", lat: -13.1631, lon: -74.2247, poblacion: 668000, provincias: [] },
  { id: "apurimac", nombre: "Apurímac", lat: -14.0608, lon: -73.0353, poblacion: 430000, provincias: [] },
  { id: "madrededios", nombre: "Madre de Dios", lat: -12.5933, lon: -69.1894, poblacion: 142000, provincias: [] },
  { id: "moquegua", nombre: "Moquegua", lat: -17.1936, lon: -70.9347, poblacion: 192000, provincias: [] },
  { id: "tacna", nombre: "Tacna", lat: -18.0066, lon: -70.2463, poblacion: 354000, provincias: [] },
  { id: "callao", nombre: "Callao", lat: -12.0566, lon: -77.1181, poblacion: 1130000, provincias: [] },
];

/** Mapeo id-interno → nombre en MEF Datos Abiertos (campo DEPARTAMENTO_EJECUTORA_NOMBRE). */
export const REGION_TO_MEF_DEPT: Record<string, string> = {
  amazonas: "AMAZONAS",
  ancash: "ANCASH",
  apurimac: "APURIMAC",
  arequipa: "AREQUIPA",
  ayacucho: "AYACUCHO",
  cajamarca: "CAJAMARCA",
  callao: "PROVINCIA CONSTITUCIONAL DEL CALLAO",
  cusco: "CUSCO",
  huancavelica: "HUANCAVELICA",
  huanuco: "HUANUCO",
  ica: "ICA",
  junin: "JUNIN",
  lalibertad: "LA LIBERTAD",
  lambayeque: "LAMBAYEQUE",
  lima: "LIMA",
  loreto: "LORETO",
  madrededios: "MADRE DE DIOS",
  moquegua: "MOQUEGUA",
  pasco: "PASCO",
  piura: "PIURA",
  puno: "PUNO",
  sanmartin: "SAN MARTIN",
  tacna: "TACNA",
  tumbes: "TUMBES",
  ucayali: "UCAYALI",
};
