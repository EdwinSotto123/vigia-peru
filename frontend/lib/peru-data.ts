// Datos enriquecidos por región y provincia. Centroides reales (INEI),
// métricas mock para el demo. El motor real las computa en el backend.
// Los `nombre` de provincia deben coincidir (ignorando acentos/case) con los
// del archivo public/peru-provinces.json para hacer join visual.

export type MetricaId = "alertas" | "convergentes" | "monto" | "score";

export interface ProvinciaData {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
  alertas: number;
  convergentes: number;
  monto: number;
  scorePromedio: number;
}

export interface RegionData {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
  poblacion: number;
  alertas: number;
  reportes: number;
  convergentes: number;
  monto: number;
  scorePromedio: number;
  serie: number[];
  topEntidades: { nombre: string; alertas: number; monto: number }[];
  provincias: ProvinciaData[];
}

export const MESES_SERIE = ["Nov", "Dic", "Ene", "Feb", "Mar", "Abr"];

export const REGIONES: RegionData[] = [
  {
    id: "ancash",
    nombre: "Áncash",
    lat: -9.5277,
    lon: -77.5278,
    poblacion: 1180000,
    alertas: 9,
    reportes: 4,
    convergentes: 3,
    monto: 14_700_000,
    scorePromedio: 82,
    serie: [2, 4, 5, 6, 8, 9],
    topEntidades: [
      { nombre: "Mun. Dist. Independencia", alertas: 2, monto: 4280000 },
      { nombre: "Mun. Prov. Yungay", alertas: 2, monto: 4250000 },
      { nombre: "Mun. Prov. Santa (Chimbote)", alertas: 2, monto: 3650000 },
      { nombre: "Mun. Prov. Carhuaz", alertas: 1, monto: 980000 },
      { nombre: "Mun. Dist. Recuay", alertas: 1, monto: 540000 },
    ],
    provincias: [
      { id: "ancash-huaraz", nombre: "Huaraz", lat: -9.5277, lon: -77.5278, alertas: 2, convergentes: 1, monto: 2840000, scorePromedio: 86 },
      { id: "ancash-carhuaz", nombre: "Carhuaz", lat: -9.276, lon: -77.6437, alertas: 1, convergentes: 0, monto: 980000, scorePromedio: 78 },
      { id: "ancash-yungay", nombre: "Yungay", lat: -9.1378, lon: -77.7458, alertas: 2, convergentes: 1, monto: 4250000, scorePromedio: 91 },
      { id: "ancash-recuay", nombre: "Recuay", lat: -9.7218, lon: -77.4533, alertas: 1, convergentes: 0, monto: 540000, scorePromedio: 71 },
      { id: "ancash-huaylas", nombre: "Huaylas", lat: -9.0464, lon: -77.8089, alertas: 1, convergentes: 1, monto: 1490000, scorePromedio: 93 },
      { id: "ancash-santa", nombre: "Santa", lat: -9.0742, lon: -78.5938, alertas: 2, convergentes: 0, monto: 3650000, scorePromedio: 82 },
      { id: "ancash-casma", nombre: "Casma", lat: -9.4747, lon: -78.3025, alertas: 1, convergentes: 0, monto: 650000, scorePromedio: 65 },
      { id: "ancash-bolognesi", nombre: "Bolognesi", lat: -10.0667, lon: -77.2167, alertas: 1, convergentes: 0, monto: 720000, scorePromedio: 74 },
    ],
  },
  {
    id: "cusco",
    nombre: "Cusco",
    lat: -13.5319,
    lon: -71.9675,
    poblacion: 1357000,
    alertas: 7,
    reportes: 3,
    convergentes: 2,
    monto: 16_540_000,
    scorePromedio: 68,
    serie: [1, 2, 3, 4, 5, 7],
    topEntidades: [
      { nombre: "Gob. Reg. Cusco", alertas: 2, monto: 7140000 },
      { nombre: "Mun. Dist. La Convención", alertas: 1, monto: 3260000 },
      { nombre: "Mun. Dist. Espinar", alertas: 1, monto: 2580000 },
      { nombre: "Mun. Dist. San Sebastián", alertas: 1, monto: 1750000 },
      { nombre: "Mun. Dist. Wanchaq", alertas: 2, monto: 1810000 },
    ],
    provincias: [
      { id: "cusco-cusco", nombre: "Cusco", lat: -13.531, lon: -71.9075, alertas: 3, convergentes: 1, monto: 4850000, scorePromedio: 60 },
      { id: "cusco-calca", nombre: "Calca", lat: -13.4147, lon: -71.8492, alertas: 1, convergentes: 0, monto: 5120000, scorePromedio: 64 },
      { id: "cusco-laconvencion", nombre: "La Convencion", lat: -12.9, lon: -72.7, alertas: 1, convergentes: 1, monto: 3260000, scorePromedio: 78 },
      { id: "cusco-espinar", nombre: "Espinar", lat: -14.7972, lon: -71.4118, alertas: 1, convergentes: 0, monto: 2580000, scorePromedio: 81 },
      { id: "cusco-quispicanchi", nombre: "Quispicanchi", lat: -13.7, lon: -71.6, alertas: 1, convergentes: 0, monto: 730000, scorePromedio: 55 },
    ],
  },
  {
    id: "lima",
    nombre: "Lima",
    lat: -12.0464,
    lon: -77.0428,
    poblacion: 10720000,
    alertas: 5,
    reportes: 2,
    convergentes: 1,
    monto: 24_800_000,
    scorePromedio: 64,
    serie: [0, 1, 1, 2, 3, 5],
    topEntidades: [
      { nombre: "Mun. Prov. Lima", alertas: 2, monto: 18900000 },
      { nombre: "Mun. Prov. Cañete", alertas: 1, monto: 2640000 },
      { nombre: "Mun. Prov. Huaura", alertas: 1, monto: 1860000 },
      { nombre: "Mun. Prov. Huaral", alertas: 1, monto: 1400000 },
    ],
    provincias: [
      { id: "lima-lima", nombre: "Lima", lat: -12.0608, lon: -77.0345, alertas: 2, convergentes: 0, monto: 18900000, scorePromedio: 65 },
      { id: "lima-canete", nombre: "Cañete", lat: -13.0833, lon: -76.3833, alertas: 1, convergentes: 1, monto: 2640000, scorePromedio: 70 },
      { id: "lima-huaura", nombre: "Huaura", lat: -11.107, lon: -77.609, alertas: 1, convergentes: 0, monto: 1860000, scorePromedio: 62 },
      { id: "lima-huaral", nombre: "Huaral", lat: -11.4954, lon: -77.2068, alertas: 1, convergentes: 0, monto: 1400000, scorePromedio: 58 },
    ],
  },
  {
    id: "piura",
    nombre: "Piura",
    lat: -5.1945,
    lon: -80.6328,
    poblacion: 2050000,
    alertas: 4,
    reportes: 1,
    convergentes: 1,
    monto: 11_400_000,
    scorePromedio: 80,
    serie: [0, 1, 2, 2, 3, 4],
    topEntidades: [
      { nombre: "Gob. Reg. Piura", alertas: 1, monto: 6700000 },
      { nombre: "Mun. Prov. Talara", alertas: 1, monto: 2380000 },
      { nombre: "Mun. Prov. Sullana", alertas: 1, monto: 1320000 },
      { nombre: "Mun. Prov. Sechura", alertas: 1, monto: 1000000 },
    ],
    provincias: [
      { id: "piura-piura", nombre: "Piura", lat: -5.1936, lon: -80.6203, alertas: 1, convergentes: 1, monto: 6700000, scorePromedio: 88 },
      { id: "piura-sullana", nombre: "Sullana", lat: -4.9039, lon: -80.685, alertas: 1, convergentes: 0, monto: 1320000, scorePromedio: 72 },
      { id: "piura-talara", nombre: "Talara", lat: -4.5781, lon: -81.2719, alertas: 1, convergentes: 0, monto: 2380000, scorePromedio: 75 },
      { id: "piura-sechura", nombre: "Sechura", lat: -5.5577, lon: -80.8214, alertas: 1, convergentes: 0, monto: 1000000, scorePromedio: 68 },
    ],
  },
  {
    id: "lalibertad",
    nombre: "La Libertad",
    lat: -8.1116,
    lon: -79.0288,
    poblacion: 2016000,
    alertas: 5,
    reportes: 1,
    convergentes: 0,
    monto: 12_200_000,
    scorePromedio: 76,
    serie: [0, 0, 1, 2, 4, 5],
    topEntidades: [
      { nombre: "Gob. Reg. La Libertad", alertas: 2, monto: 6700000 },
      { nombre: "Mun. Prov. Pataz", alertas: 1, monto: 2900000 },
      { nombre: "Mun. Prov. Otuzco", alertas: 1, monto: 1450000 },
      { nombre: "Mun. Prov. Sánchez Carrión", alertas: 1, monto: 1150000 },
    ],
    provincias: [
      { id: "lalibertad-trujillo", nombre: "Trujillo", lat: -8.1116, lon: -79.0288, alertas: 2, convergentes: 0, monto: 6700000, scorePromedio: 82 },
      { id: "lalibertad-pataz", nombre: "Pataz", lat: -7.823, lon: -77.625, alertas: 1, convergentes: 0, monto: 2900000, scorePromedio: 90 },
      { id: "lalibertad-otuzco", nombre: "Otuzco", lat: -7.9, lon: -78.5833, alertas: 1, convergentes: 0, monto: 1450000, scorePromedio: 66 },
      { id: "lalibertad-sanchezcarrion", nombre: "Sanchez Carrion", lat: -7.8167, lon: -78.0333, alertas: 1, convergentes: 0, monto: 1150000, scorePromedio: 74 },
    ],
  },
  {
    id: "arequipa",
    nombre: "Arequipa",
    lat: -16.409,
    lon: -71.5375,
    poblacion: 1497000,
    alertas: 3,
    reportes: 1,
    convergentes: 0,
    monto: 8_100_000,
    scorePromedio: 71,
    serie: [0, 1, 1, 2, 2, 3],
    topEntidades: [
      { nombre: "Mun. Prov. Arequipa", alertas: 1, monto: 4200000 },
      { nombre: "Mun. Prov. Caylloma", alertas: 1, monto: 2300000 },
      { nombre: "Mun. Prov. Camaná", alertas: 1, monto: 1600000 },
    ],
    provincias: [
      { id: "arequipa-arequipa", nombre: "Arequipa", lat: -16.409, lon: -71.5375, alertas: 1, convergentes: 0, monto: 4200000, scorePromedio: 73 },
      { id: "arequipa-camana", nombre: "Camana", lat: -16.6233, lon: -72.7156, alertas: 1, convergentes: 0, monto: 1600000, scorePromedio: 60 },
      { id: "arequipa-caylloma", nombre: "Caylloma", lat: -15.6336, lon: -71.7794, alertas: 1, convergentes: 0, monto: 2300000, scorePromedio: 79 },
    ],
  },
  {
    id: "junin",
    nombre: "Junín",
    lat: -12.0651,
    lon: -75.2049,
    poblacion: 1361000,
    alertas: 4,
    reportes: 1,
    convergentes: 0,
    monto: 9_700_000,
    scorePromedio: 72,
    serie: [0, 1, 1, 2, 3, 4],
    topEntidades: [
      { nombre: "Mun. Prov. Huancayo", alertas: 2, monto: 5800000 },
      { nombre: "Mun. Prov. Satipo", alertas: 1, monto: 2400000 },
      { nombre: "Mun. Prov. Tarma", alertas: 1, monto: 1500000 },
    ],
    provincias: [
      { id: "junin-huancayo", nombre: "Huancayo", lat: -12.0651, lon: -75.2049, alertas: 2, convergentes: 0, monto: 5800000, scorePromedio: 71 },
      { id: "junin-tarma", nombre: "Tarma", lat: -11.4197, lon: -75.6906, alertas: 1, convergentes: 0, monto: 1500000, scorePromedio: 64 },
      { id: "junin-satipo", nombre: "Satipo", lat: -11.2528, lon: -74.6356, alertas: 1, convergentes: 0, monto: 2400000, scorePromedio: 80 },
    ],
  },
  {
    id: "puno",
    nombre: "Puno",
    lat: -15.8402,
    lon: -70.0219,
    poblacion: 1172000,
    alertas: 3,
    reportes: 0,
    convergentes: 0,
    monto: 7_300_000,
    scorePromedio: 67,
    serie: [0, 0, 1, 1, 2, 3],
    topEntidades: [
      { nombre: "Mun. Prov. Puno", alertas: 1, monto: 3200000 },
      { nombre: "Mun. Prov. San Román", alertas: 1, monto: 2800000 },
      { nombre: "Mun. Prov. Azángaro", alertas: 1, monto: 1300000 },
    ],
    provincias: [
      { id: "puno-puno", nombre: "Puno", lat: -15.8402, lon: -70.0219, alertas: 1, convergentes: 0, monto: 3200000, scorePromedio: 68 },
      { id: "puno-sanroman", nombre: "San Roman", lat: -15.4944, lon: -70.13, alertas: 1, convergentes: 0, monto: 2800000, scorePromedio: 72 },
      { id: "puno-azangaro", nombre: "Azangaro", lat: -14.9094, lon: -70.1881, alertas: 1, convergentes: 0, monto: 1300000, scorePromedio: 60 },
    ],
  },
  {
    id: "cajamarca",
    nombre: "Cajamarca",
    lat: -7.1611,
    lon: -78.5126,
    poblacion: 1453000,
    alertas: 3,
    reportes: 1,
    convergentes: 0,
    monto: 6_800_000,
    scorePromedio: 70,
    serie: [0, 0, 1, 1, 2, 3],
    topEntidades: [
      { nombre: "Mun. Prov. Cajamarca", alertas: 1, monto: 3100000 },
      { nombre: "Mun. Prov. Jaén", alertas: 1, monto: 2300000 },
      { nombre: "Mun. Prov. Celendín", alertas: 1, monto: 1400000 },
    ],
    provincias: [
      { id: "cajamarca-cajamarca", nombre: "Cajamarca", lat: -7.1611, lon: -78.5126, alertas: 1, convergentes: 0, monto: 3100000, scorePromedio: 76 },
      { id: "cajamarca-jaen", nombre: "Jaen", lat: -5.7081, lon: -78.8081, alertas: 1, convergentes: 0, monto: 2300000, scorePromedio: 70 },
      { id: "cajamarca-celendin", nombre: "Celendin", lat: -6.866, lon: -78.146, alertas: 1, convergentes: 0, monto: 1400000, scorePromedio: 65 },
    ],
  },
  {
    id: "loreto",
    nombre: "Loreto",
    lat: -3.7437,
    lon: -73.2516,
    poblacion: 1027000,
    alertas: 2,
    reportes: 0,
    convergentes: 0,
    monto: 4_200_000,
    scorePromedio: 63,
    serie: [0, 0, 0, 1, 1, 2],
    topEntidades: [
      { nombre: "Mun. Prov. Maynas", alertas: 1, monto: 2500000 },
      { nombre: "Mun. Prov. Alto Amazonas", alertas: 1, monto: 1700000 },
    ],
    provincias: [
      { id: "loreto-maynas", nombre: "Maynas", lat: -3.7437, lon: -73.2516, alertas: 1, convergentes: 0, monto: 2500000, scorePromedio: 58 },
      { id: "loreto-altoamazonas", nombre: "Alto Amazonas", lat: -5.2406, lon: -76.0322, alertas: 1, convergentes: 0, monto: 1700000, scorePromedio: 67 },
    ],
  },
  // Regiones sin alertas (vista vacía en drilldown)
  {
    id: "tumbes", nombre: "Tumbes", lat: -3.5669, lon: -80.453,
    poblacion: 247000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "lambayeque", nombre: "Lambayeque", lat: -6.7011, lon: -79.9061,
    poblacion: 1310000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "amazonas", nombre: "Amazonas", lat: -6.2308, lon: -77.8718,
    poblacion: 426000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "sanmartin", nombre: "San Martín", lat: -6.4886, lon: -76.3658,
    poblacion: 899000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "huanuco", nombre: "Huánuco", lat: -9.9295, lon: -76.2422,
    poblacion: 760000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "ucayali", nombre: "Ucayali", lat: -8.3791, lon: -74.5539,
    poblacion: 506000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "pasco", nombre: "Pasco", lat: -10.6828, lon: -76.2563,
    poblacion: 254000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "huancavelica", nombre: "Huancavelica", lat: -12.7866, lon: -74.9764,
    poblacion: 365000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "ica", nombre: "Ica", lat: -14.0681, lon: -75.7286,
    poblacion: 850000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "ayacucho", nombre: "Ayacucho", lat: -13.1631, lon: -74.2247,
    poblacion: 668000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "apurimac", nombre: "Apurímac", lat: -14.0608, lon: -73.0353,
    poblacion: 430000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "madrededios", nombre: "Madre de Dios", lat: -12.5933, lon: -69.1894,
    poblacion: 142000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "moquegua", nombre: "Moquegua", lat: -17.1936, lon: -70.9347,
    poblacion: 192000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "tacna", nombre: "Tacna", lat: -18.0066, lon: -70.2463,
    poblacion: 354000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
  {
    id: "callao", nombre: "Callao", lat: -12.0566, lon: -77.1181,
    poblacion: 1130000, alertas: 0, reportes: 0, convergentes: 0, monto: 0, scorePromedio: 0,
    serie: [0,0,0,0,0,0], topEntidades: [], provincias: [],
  },
];

export function regionMetric(r: RegionData, metric: MetricaId): number {
  switch (metric) {
    case "alertas": return r.alertas;
    case "convergentes": return r.convergentes;
    case "monto": return r.monto;
    case "score": return r.scorePromedio;
  }
}

export function severityBucket(score: number): "low" | "mid" | "high" | "crit" {
  if (score >= 85) return "crit";
  if (score >= 70) return "high";
  if (score >= 40) return "mid";
  return "low";
}

export function metricLabel(m: MetricaId): string {
  return {
    alertas: "Alertas automáticas",
    convergentes: "Casos convergentes",
    monto: "Monto vigilado (S/.)",
    score: "Score de riesgo",
  }[m];
}

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

export function radiusForMetric(value: number, max: number): number {
  if (max === 0) return 18;
  const min = 18;
  const peak = 56;
  const t = Math.sqrt(value / max);
  return min + (peak - min) * t;
}
