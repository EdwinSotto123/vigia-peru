import { API_BASE } from "@/lib/api-client";
import { REGIONES } from "@/lib/peru-data";
import { REGION_UBIGEO } from "@/components/mapa/region-match";
import { oracion } from "@/lib/formato";
import { regionDe } from "@/lib/regiones";

/**
 * Gobserva Licitaciones (licitaciones.gobserva.cloud): los tipos de GET /licitaciones/* (backend/api/src/routes/
 * licitaciones.ts), cómo se piden (5 min en la caché de datos) y cómo se nombran las cosas para un proveedor.
 */

export interface Oportunidad {
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  tipo: string | null;
  procedimiento: string | null;
  /** Valor referencial; null si la entidad no lo publicó (subasta inversa, comparación de precios). */
  valor: number | null;
  fecha: string;
  entidadRuc: string | null;
  entidad: string | null;
  region: string | null;
  /** Fin del plazo de consultas y observaciones (OCDS), si lo publicó. */
  consultasHasta: string | null;
  items: number;
}

export interface Conteo {
  clave: string;
  n: number;
  valor?: number;
}

export interface Competencia {
  procesos?: number;
  postoresPromedio?: number | null;
  unSoloPostor?: number;
  adjudicado?: number;
  adjSobreRef?: number | null;
}

export interface Resumen {
  ultimoDia: string | null;
  delUltimoDia: number;
  semana: number;
  quince: number;
  conValor: number;
  valorEnJuego: number;
  entidades: number;
  porTipo: Conteo[];
  porRegion: Conteo[];
  porDia: { f: string; n: number }[];
  recientes: Oportunidad[];
  mayores: Oportunidad[];
  competencia: Competencia;
}

export interface Pagina {
  q?: string;
  region?: string;
  tipo?: string;
  min?: number;
  max?: number;
  dias: number;
  entidad?: string;
  orden: "reciente" | "valor";
  page: number;
  size: number;
  total: number;
  resumen: { total: number; conValor: number; valorTotal: number; entidades: number };
  data: Oportunidad[];
  porTipo: Conteo[];
  porRegion: Conteo[];
}

export interface Proveedor {
  ruc: string;
  nombre: string | null;
  procesos: number;
  monto: number | null;
}

export interface Ficha {
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  descripcion: string | null;
  tipo: string | null;
  etapa: string | null;
  procedimiento: string | null;
  valor: number | null;
  fecha: string;
  consultas: { desde: string | null; hasta: string | null } | null;
  entidadRuc: string | null;
  entidad: string | null;
  entidadRegion: string | null;
  entidadProvincia: string | null;
  region: string | null;
  items: { posicion: number; descripcion: string | null; cantidad: number | null; unidad: string | null; cubso: string | null; cubsoNombre: string | null; valor: number | null; estado: string | null }[];
  documentos: { titulo: string; url: string; tipo: string | null; fecha: string | null; formato: string | null }[];
  enlaces: { oece: string; busqueda: string | null };
  inteligencia: {
    procesos?: number;
    monto?: number;
    adjSobreRef?: number | null;
    conPostores?: number;
    postoresPromedio?: number | null;
    unSoloPostor?: number;
    proveedores?: Proveedor[];
  } | null;
  parecidos: {
    ocid: string;
    codigo: string | null;
    descripcion: string | null;
    objeto: string | null;
    entidadRuc: string | null;
    entidad: string | null;
    departamento: string | null;
    fecha: string | null;
    unidad: string | null;
    cantidad: number | null;
    unitRef: number | null;
    unitAdj: number | null;
    adjudicado: number | null;
    ruc: string | null;
    proveedor: string | null;
  }[];
  precios: { cubso: string; unidad: string; anio: number; base: string; n: number; entidades: number; p25: number | null; mediana: number | null; p75: number | null }[];
}

export interface Mercado {
  q: string;
  palabras: string[];
  procesos: number;
  items: number;
  monto: number;
  adjSobreRef: number | null;
  entidades: number;
  ganadores: number;
  montoEmpresas: number;
  conPostores: number;
  postoresPromedio: number | null;
  unSoloPostor: number;
  serie: { mes: string; procesos: number; monto: number }[];
  compradores: Proveedor[];
  ganadoresTop: Proveedor[];
  regiones: { nombre: string; procesos: number; monto: number }[];
  recientes: { codigo: string; item: string | null; entidad: string | null; fecha: string; monto: number | null; ganador: string | null; ruc: string | null }[];
}

async function pedir<T>(ruta: string, revalidate = 300): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}/licitaciones${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getResumen = () => pedir<Resumen>("/resumen");
export const getOportunidades = (params: URLSearchParams) => pedir<Pagina>(`/oportunidades?${params.toString()}`);
export const getFicha = (ocid: string) => pedir<Ficha>(`/oportunidades/${encodeURIComponent(ocid)}`);
export const getMercado = (q: string) => pedir<Mercado>(`/mercado?q=${encodeURIComponent(q)}`, 3600);

/** Los tipos de contratación, como los dice un proveedor. */
export const TIPOS: { clave: string; nombre: string; detalle: string }[] = [
  { clave: "bienes", nombre: "Bienes", detalle: "Productos y suministros" },
  { clave: "servicios", nombre: "Servicios", detalle: "Servicios en general" },
  { clave: "obras", nombre: "Obras", detalle: "Construcción y mantenimiento" },
  { clave: "consultoria", nombre: "Consultoría", detalle: "Estudios, expedientes y supervisión" },
];
const NOMBRE_TIPO: Record<string, string> = { ...Object.fromEntries(TIPOS.map((t) => [t.clave, t.nombre])), convenio: "Convenio" };
export const nombreTipo = (t: string | null | undefined) => (t ? NOMBRE_TIPO[t] ?? oracion(t) : "Sin tipo");

/** Las 25 regiones con su ubigeo, en orden alfabético (para el filtro). */
export const REGIONES_UBIGEO: { ubigeo: string; nombre: string }[] = REGIONES.map((r) => ({ ubigeo: REGION_UBIGEO[r.id], nombre: r.nombre }))
  .filter((r) => !!r.ubigeo)
  .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
export const nombreRegion = (ubigeo: string | null | undefined) => (ubigeo ? regionDe(ubigeo)?.nombre ?? `Región ${ubigeo}` : "Sin región");

/**
 * Un texto del SEACE para leerlo: las comillas que el SEACE guarda como «¿» vuelven a ser comillas, los espacios se
 * ordenan y la oración va en minúsculas (casi todo llega en mayúsculas).
 */
export function limpiar(t: string | null | undefined): string {
  if (!t) return "";
  // Un objeto que el SEACE manda entero entre comillas («"SERVICIO DE…"») va sin ellas: si no, la oración empieza en la
  // comilla y la primera palabra queda en minúscula.
  const s = t.replace(/¿/g, "“").replace(/\s+/g, " ").trim().replace(/^["“”'«»\s]+|["“”'«»\s]+$/g, "");
  return oracion(s);
}

/** «hoy», «ayer», «hace 3 días» (por el día del calendario de Lima). */
export function haceDias(iso: string | null | undefined): string {
  if (!iso) return "Sin fecha";
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
  hoy.setHours(0, 0, 0, 0);
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const n = Math.round((hoy.getTime() - d.getTime()) / 86_400_000);
  return n <= 0 ? "hoy" : n === 1 ? "ayer" : `hace ${n} días`;
}

/** Días que faltan para una fecha (negativo si ya pasó). */
export function diasHasta(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
  hoy.setHours(0, 0, 0, 0);
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((d.getTime() - hoy.getTime()) / 86_400_000);
}

/** El tipo de documento del OCDS, en castellano. */
export const TIPO_DOCUMENTO: Record<string, string> = {
  biddingDocuments: "Bases",
  technicalSpecifications: "Especificaciones técnicas",
  tenderNotice: "Convocatoria",
  clarifications: "Absolución de consultas",
  evaluationCriteria: "Criterios de evaluación",
  awardNotice: "Buena pro",
  contractDraft: "Proforma de contrato",
  complaints: "Observaciones",
  eligibilityCriteria: "Requisitos de calificación",
};

/** Ejemplos de rubros para tocar (búsquedas que traen mercado). */
export const RUBROS_EJEMPLO = [
  "combustible",
  "alimentos",
  "medicamentos",
  "uniformes",
  "computadoras",
  "agua potable",
  "pistas y veredas",
  "seguridad y vigilancia",
  "limpieza",
  "consultoría de obras",
];
