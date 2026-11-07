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

/** Un GET a /licitaciones/* de la API (null si falla). Lo usa también el adaptador en vivo de la app. */
export async function pedir<T>(ruta: string, revalidate = 300): Promise<T | null> {
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

// ─── Contrataciones menores abiertas (≤8 UIT, prod6; GET /licitaciones/menores, migración 262) ──────────────────────

/** Una contratación menor que todavía se puede cotizar. Sin monto: la entidad no publica uno referencial. */
export interface Menor {
  id: number;
  codigo: string;
  tipo: string | null;
  descripcion: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  area: string | null;
  invitacion: string | null;
  publicada: string | null;
  abreCotizacion: string | null;
  /** Cuándo cierra la cotización (con hora). */
  cierra: string;
  consultasHasta: string | null;
  regiones: string[] | null;
  items: number;
  /** Hasta tres nombres CUBSO de sus ítems. */
  rubros: string[] | null;
}

export interface PaginaMenores {
  total: number;
  page: number;
  size: number;
  resumen: { total: number; entidades: number };
  cabecera: { abiertas: number; cierranHoy: number; nuevas24h: number; actualizado: string | null };
  data: Menor[];
  porTipo: Conteo[];
  porRegion: Conteo[];
}

export interface ItemMenor {
  cubso: string | null;
  nombre: string | null;
  descripcion: string | null;
  cantidad: number | null;
  unidad: string | null;
  distrito: string | null;
}

export interface FichaMenor extends Omit<Menor, "items"> {
  estado: string;
  abierta: boolean;
  distritos: string[] | null;
  vistaDesde: string;
  tieneRequerimiento: boolean;
  requerimientoNombre: string | null;
  items: ItemMenor[];
  /** Lo que esa entidad compró por contratos menores en 12 meses (ganadores: sólo empresas). */
  entidadMenores: { contratos: number; monto: number; proveedores: number; aPersonas: number; ganadores: Proveedor[] } | null;
  /** Lo que se pagó por los mismos ítems (CUBSO) en contratos menores adjudicados (24 meses). */
  precios: { cubso: string; nombre: string | null; unidad: string | null; veces: number; mediana: number; minimo: number; maximo: number; ultima: string | null }[];
  /** El precio de referencia del mismo CUBSO en los procesos del Estado (el año más reciente): mediana y rango intercuartil. */
  preciosProcesos: { cubso: string; unidad: string | null; anio: number; veces: number; p25: number; mediana: number; p75: number }[];
}

export const getMenores = (params: URLSearchParams) => pedir<PaginaMenores>(`/menores?${params.toString()}`, 120);
export const getMenor = (id: string) => pedir<FichaMenor>(`/menores/${encodeURIComponent(id)}`, 120);
/** El requerimiento (TDR o especificaciones) en PDF, servido por la API desde R2. */
export const urlRequerimientoMenor = (id: number | string) => `${API_BASE}/licitaciones/menores/${id}/requerimiento`;

/**
 * Cuánto falta para que cierre una cotización, para leerlo de un vistazo: «cierra en 45 min», «cierra en 5 h»,
 * «cierra mañana a las 09:00», «cierra el 12 nov.». `urgente` si faltan menos de 6 horas.
 */
export function cierreMenor(iso: string | null | undefined, ahora = Date.now()): { texto: string; urgente: boolean; cerrada: boolean } {
  if (!iso) return { texto: "Sin fecha de cierre", urgente: false, cerrada: false };
  const fin = new Date(iso).getTime();
  const min = Math.round((fin - ahora) / 60_000);
  if (min <= 0) return { texto: "Cerrada", urgente: false, cerrada: true };
  const hora = new Date(fin).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false });
  const dia = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  if (min < 60) return { texto: `Cierra en ${min} min`, urgente: true, cerrada: false };
  if (min < 6 * 60) return { texto: `Cierra en ${Math.round(min / 60)} h (${hora})`, urgente: true, cerrada: false };
  if (dia(fin) === dia(ahora)) return { texto: `Cierra hoy a las ${hora}`, urgente: false, cerrada: false };
  if (dia(fin) === dia(ahora + 86_400_000)) return { texto: `Cierra mañana a las ${hora}`, urgente: false, cerrada: false };
  const fecha = new Date(fin).toLocaleDateString("es-PE", { timeZone: "America/Lima", day: "numeric", month: "short" });
  return { texto: `Cierra el ${fecha} a las ${hora}`, urgente: false, cerrada: false };
}

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
  // comilla y la primera palabra queda en minúscula. Los saltos de línea que llegan escritos («obra:\nmejoramiento»,
  // con la barra y la n como texto) son un espacio.
  const s = t.replace(/\\[nrt]/g, " ").replace(/¿/g, "“").replace(/\s+/g, " ").trim().replace(/^["“”'«»\s]+|["“”'«»\s]+$/g, "");
  return oracion(s);
}

const sinTildes = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "");

/** Las palabras del molde de un objeto del SEACE: no dicen qué se compra («contratación del suministro de…»). */
const GENERICAS = new Set([
  "contratacion", "adquisicion", "suministro", "servicio", "servicios", "ejecucion", "obra", "obras", "para", "del", "las", "los",
  "una", "unos", "unas", "con", "por", "que", "como", "entre", "sobre", "segun", "desde", "hasta", "mediante", "mejoramiento",
  "creacion", "ampliacion", "recuperacion", "rehabilitacion", "renovacion", "remodelacion", "construccion", "contruccion", "instalacion",
  "reparacion", "elaboracion", "expediente", "tecnico", "tecnica", "tecnicos", "bienes", "compra", "diversos", "diversas", "varios",
  "varias", "otros", "otras", "proyecto", "abastecimiento", "distribucion", "especialidad", "general", "institucional", "nivel",
  "item", "items", "atencion", "programa", "meta", "diseno", "contratar", "adquirir", "dirigido", "dirigida", "destinado",
  "destinada", "este", "esta", "cada", "todo", "toda", "todos", "todas", "sede", "central", "region", "regional", "distrito",
  "distrital", "provincia", "provincial", "departamento",
]);
const util = (w: string) => w.length > 3 && !/^\d+$/.test(w) && !GENERICAS.has(sinTildes(w));

/**
 * El rubro de una convocatoria en una o dos palabras, para proponer su mercado: «material médico», «agua potable»,
 * «combustible». Se salta el molde del SEACE («contratación del suministro de…», «ejecución de la obra…»); una palabra
 * larga y precisa («combustible», «consultoría») va sola si lo que sigue es otra cosa («combustible para el equipo…»).
 */
export function rubroDe(objeto: string | null | undefined): string {
  const t = limpiar(objeto).toLocaleLowerCase("es-PE").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const i = t.findIndex(util);
  if (i < 0) return "";
  const primera = t[i];
  const salida = [primera];
  let cruzo = false;
  for (let j = i + 1; j < t.length; j++) {
    if (util(t[j])) {
      if (!cruzo || primera.length < 8) salida.push(t[j]);
      break;
    }
    cruzo = true;
    if (primera.length >= 8) break;
  }
  return salida.join(" ");
}

/** Los procedimientos que casi nunca publican el valor referencial en los datos abiertos. */
export const sinValorHabitual = (procedimiento: string | null | undefined) => /subasta|comparaci/i.test(procedimiento ?? "");

/** Las bases primero; lo demás, en el orden en que lo publicó la entidad. */
export function ordenarDocumentos<T extends { tipo: string | null }>(docs: T[]): T[] {
  return docs.map((d, i) => ({ d, i })).sort((a, b) => Number(b.d.tipo === "biddingDocuments") - Number(a.d.tipo === "biddingDocuments") || a.i - b.i).map((x) => x.d);
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
