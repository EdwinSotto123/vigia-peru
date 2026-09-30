/**
 * Cliente y tipos de "Financia una auditoría".
 * Backend: backend/api/src/routes/financiamiento.ts · contribuciones.ts
 * Diseño:  docs/design/FINANCIA_UNA_AUDITORIA.md
 *
 * Los GET funcionan tanto en server components (fetch cacheado) como en el
 * cliente (NEXT_PUBLIC_VIGIA_API_URL). Todo devuelve `null` en vez de tirar si
 * el API no responde: la landing nunca debe caerse por esta sección.
 */

import { API_BASE } from "./api-client";
import { soles, solesCompacto } from "./formato";

export type ZonaEstado = "sin_datos" | "pendiente" | "parcial" | "financiada" | "procesada";
export type NivelZona = "departamento" | "provincia" | "distrito";

export interface Zona {
  ubigeo: string;
  nivel: NivelZona;
  nombre: string;
  padreUbigeo: string | null;
  lat: number | null;
  lon: number | null;
  pendientes: number;
  financiados: number;
  contribuciones: number;
  procesados: number;
  /** Contratos con alerta PUBLICADA y ≥ 1 bandera (las alertas en revisión no cuentan). */
  senales: number;
  totalCola: number;
  estado: ZonaEstado;
  /** Procesados cuya alerta espera revisión humana (cuentan como procesados, no como señales). */
  enRevision?: number;
  /** Contratos de tipos/etapas aún NO activos con documentos vigentes (análisis en preparación). */
  documentosListos?: number;
  precioPen: number;
  precioUsd: number;
}

/** Alcance activo del procesamiento (ajustes.procesamiento, migración 19). */
export interface AlcanceProcesamiento {
  tipos_activos: string[];
  etapas_activas: string[];
  nota?: string;
}
export interface Alcance {
  procesamiento: AlcanceProcesamiento | null;
  colaFinanciable: number;
  documentosListos: number;
  actualizadoAt: string | null;
}

export interface Aliado {
  nombre: string;
  tipo: "empresa" | "persona" | "organizacion";
  slug: string | null;
  logoUrl: string | null;
  contratos: number;
  ultimoAporte: string | null;
}

export interface ZonaDetalle {
  zona: Zona;
  breadcrumb: { ubigeo: string; nombre: string; nivel: NivelZona }[];
  hijas: Pick<Zona, "ubigeo" | "nivel" | "nombre" | "pendientes" | "financiados" | "procesados" | "senales" | "totalCola" | "estado" | "enRevision" | "documentosListos">[];
  aliados: Aliado[];
  cola: { contratos: number; montoReferencial: number; entidades: number; documentosListos?: number };
  alcance?: AlcanceProcesamiento | null;
}

export interface RankingRow {
  posicion: number;
  id: number;
  tipo: Aliado["tipo"];
  nombre: string;
  slug: string | null;
  logoUrl: string | null;
  contratosFinanciados: number;
  zonas: number;
  senalesHalladas: number;
  contratosProcesados: number;
  enRevision?: number;
  desde: string | null;
}

export interface EstadoGlobal {
  contratosFinanciados: number;
  montoPen: number;
  financiadores: number;
  regionesConAuditoria: number;
  contratosProcesados: number;
  senalesHalladas: number;
  enRevision?: number;
  colaGlobal: number;
  regionesConCola: number;
  documentosListos?: number;
  procesadosHoy: number;
  ingresadosHoy: number;
  tarifa: { precioPen: number; precioUsd: number; costoRealPen: number; nota: string | null };
  alcance?: AlcanceProcesamiento | null;
}

export interface ContribucionReciente {
  codigo: string;
  contratos: number;
  pagadaAt: string;
  estado: string;
  mensajePublico: string | null;
  /** Hoy /financiamiento/recientes no lo trae; si llega, "institucional" = lote del capital semilla. */
  pasarela?: string | null;
  ubigeo: string;
  zona: string;
  nivel: NivelZona;
  /** Aporte por ENTIDAD: la entidad elegida (la zona es sólo donde está la mayoría de sus contratos). */
  entidad?: EntidadAporte | null;
  financiador: string;
  tipo: Aliado["tipo"];
  slug: string | null;
  logoUrl: string | null;
}

/** La entidad de un aporte por entidad (A5: recientes, comprobante, admin). */
export interface EntidadAporte {
  ruc: string;
  nombre: string;
}

export interface Comprobante {
  codigo: string;
  contratos: number;
  montoPen: number;
  estado: string;
  pagadaAt: string | null;
  createdAt: string;
  mensajePublico: string | null;
  /**
   * Método con el que entró el aporte: "yape" | "plin" | "transferencia" para un aporte
   * ciudadano, "institucional" para un lote del capital semilla de Vigía Perú (sin pago).
   */
  pasarela?: string | null;
  ubigeo: string;
  zona: string;
  nivel: NivelZona;
  /** Aporte por ENTIDAD: la entidad elegida. Sin ella, el aporte fue por zona. */
  entidad?: EntidadAporte | null;
  financiador: string;
  tipo: Aliado["tipo"];
  slug: string | null;
  logoUrl: string | null;
  resumen:{ asignados: number; procesados: number; pendientes: number; senales: number; contratosConSenal?: number; enRevision?: number; montoAuditado: number };
  detalle: ComprobanteContrato[];
}

export interface ComprobanteContrato {
  ocid: string;
  asignadaAt: string;
  procesadaAt: string | null;
  titulo: string | null;
  valorReferencial: number | null;
  entidad: string | null;
  alertaCodigo: string | null;
  alertaEstado?: string | null;
  score: number | null;
  severidad: string | null;
  banderas: number;
}

async function getJson<T>(path: string, revalidate = 120): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { next: { revalidate } } as any);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const getZonas = (nivel: NivelZona = "departamento", padre?: string) =>
  getJson<{ data: Zona[] }>(`/financiamiento/zonas?nivel=${nivel}${padre ? `&padre=${padre}` : ""}`, 300).then((r) =>
    r?.data ? r.data.map((z) => ({ ...z, nombre: conAcentos(z.nombre) })) : null,
  );

export const getZona = (ubigeo: string) =>
  getJson<ZonaDetalle>(`/financiamiento/zonas/${ubigeo}`, 60).then((d) =>
    d
      ? {
          ...d,
          zona: { ...d.zona, nombre: conAcentos(d.zona.nombre) },
          breadcrumb: d.breadcrumb.map((b) => ({ ...b, nombre: conAcentos(b.nombre) })),
          hijas: d.hijas.map((h) => ({ ...h, nombre: conAcentos(h.nombre) })),
        }
      : null,
  );

export const getRanking = (periodo: "mes" | "anio" | "todo" = "todo") =>
  getJson<{ data: RankingRow[] }>(`/financiamiento/ranking?periodo=${periodo}`, 300).then((r) => r?.data ?? null);

export interface RankingQuery {
  periodo?: "mes" | "anio" | "todo";
  /** Ubigeo de 2 a 6 dígitos (mismo filtro que getZonas/FiltroRegion). */
  region?: string;
  limit?: number;
  offset?: number;
}

export interface RankingPagina {
  periodo: "mes" | "anio" | "todo";
  data: RankingRow[];
  /** Financiadores distintos que cumplen el filtro (no filas crudas): base real para paginar. */
  total: number;
}

function rankingQueryString(q: RankingQuery): string {
  const params = new URLSearchParams();
  params.set("periodo", q.periodo ?? "todo");
  if (q.region) params.set("region", q.region);
  if (q.limit != null) params.set("limit", String(q.limit));
  if (q.offset) params.set("offset", String(q.offset));
  return params.toString();
}

/** Como getRanking, pero con región y paginación reales (muro de /app/aliados). */
export const getRankingPaginado = (q: RankingQuery = {}) =>
  getJson<RankingPagina>(`/financiamiento/ranking?${rankingQueryString(q)}`, 300);

export const getEstadoGlobal = () => getJson<EstadoGlobal>("/financiamiento/estado", 120);

export const getRecientes = () =>
  getJson<{ data: ContribucionReciente[] }>("/financiamiento/recientes", 60).then((r) =>
    r?.data ? r.data.map((c) => ({ ...c, zona: conAcentos(c.zona) })) : null,
  );

export const getPago = () => getJson<import("@/components/financiar/PaymentMethods").PagoPublico>("/financiamiento/pago", 60);

export const getComprobante = (codigo: string) =>
  getJson<Comprobante>(`/financiamiento/impacto/${encodeURIComponent(codigo)}`, 30).then((c) =>
    c ? { ...c, zona: conAcentos(c.zona) } : null,
  );

export const getAlcance = () => getJson<Alcance>("/financiamiento/alcance", 60);

// ─── Financiar por ENTIDAD (GET /financiamiento/entidades[/:ruc]) ────────────

/** Una entidad en la vista "Por entidad" de /app/financiar. */
export interface EntidadFinanciable {
  ruc: string;
  nombre: string;
  tipo: string | null;
  region: string | null;
  /** Contratos de la entidad en cola (tipos y etapas activos): los que se pueden financiar hoy. */
  enCola: number;
  /** De esos, los que ya tienen sus documentos en el almacén de Vigía: se leen apenas se financian. */
  conDocumentos: number;
  /** Contratos de la entidad con dictamen publicado. */
  auditados: number;
  /** Convocatorias registradas de la entidad, de todo tipo. */
  contratos: number;
}

export interface EntidadesFinanciables {
  /** Entidades que cumplen la búsqueda (sin búsqueda: las que tienen contratos en cola). */
  total: number;
  items: EntidadFinanciable[];
}

export interface EntidadesFinanciablesQuery {
  /** Nombre (desde 2 letras, sin tildes) o RUC de 11 dígitos. */
  q?: string;
  /** 1 a 50 (el API usa 20 si no se dice). */
  limit?: number;
  offset?: number;
}

/** Un contrato de la entidad que espera financiamiento (hasta 50, del más reciente al más antiguo). */
export interface ContratoEnColaEntidad {
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  montoReferencial: number | null;
  fecha: string | null;
  documentosListos: boolean;
}

/** Un aliado visible que financió contratos de esta entidad (top 12 por contratos). */
export interface AliadoEntidad {
  nombre: string;
  slug: string | null;
  logoUrl: string | null;
  tipo: string;
  contratos: number;
}

export interface EntidadFinanciableDetalle {
  entidad: {
    ruc: string;
    nombre: string;
    tipo: string | null;
    region: string | null;
    /** La zona que lleva su aporte: donde está la mayoría de sus contratos en cola. */
    zona: { ubigeo: string; nombre: string } | null;
  };
  cola: { contratos: number; conDocumentos: number; montoReferencial: number };
  /** `enProceso`: financiados que todavía no tienen dictamen. */
  contratos: { total: number; auditados: number; enProceso: number };
  /** Tipos que hoy se auditan (ajustes.procesamiento): hoy `["bienes"]`. */
  tiposActivos: string[];
  precioPen: number;
  enCola: ContratoEnColaEntidad[];
  aliados: AliadoEntidad[];
}

const esNumero = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Entidades con contratos que se pueden financiar. Sin `q`: sólo las que tienen contratos
 * en cola, de más a menos. Con `q` (≥ 2 letras o un RUC): también las que hoy no tienen nada
 * en cola. `null` = el API no respondió o respondió otra cosa: la página muestra el error,
 * nunca una lista vacía que parezca un dato.
 */
export async function getEntidadesFinanciables({ q, limit, offset }: EntidadesFinanciablesQuery = {}): Promise<EntidadesFinanciables | null> {
  const p = new URLSearchParams();
  const t = (q ?? "").trim();
  if (t.length >= 2) p.set("q", t.slice(0, 80));
  if (limit != null) p.set("limit", String(Math.min(50, Math.max(1, Math.floor(limit)))));
  if (offset && offset > 0) p.set("offset", String(Math.floor(offset)));
  const qs = p.toString();
  const r = await getJson<EntidadesFinanciables>(`/financiamiento/entidades${qs ? `?${qs}` : ""}`, 60);
  if (!r || !esNumero(r.total) || !Array.isArray(r.items)) return null;
  return r;
}

/**
 * La entidad para la página "¿En qué gasta tu dinero…?". Tres desenlaces distintos, porque
 * la página los dice distinto: los datos; `"no_encontrada"` (404 del API o un RUC que no es
 * de 11 dígitos); `null` (el API no respondió: se muestra el error, nunca ceros).
 */
export async function getEntidadFinanciable(ruc: string): Promise<EntidadFinanciableDetalle | "no_encontrada" | null> {
  if (!/^\d{11}$/.test(ruc)) return "no_encontrada";
  try {
    const res = await fetch(`${API_BASE}/financiamiento/entidades/${ruc}`, { next: { revalidate: 60 } } as any);
    if (res.status === 404) return "no_encontrada";
    if (!res.ok) return null;
    const d = (await res.json()) as Partial<EntidadFinanciableDetalle> | null;
    // Sin las cifras de la cola no hay página: faltando, es un error y no un cero.
    if (!d?.entidad?.nombre || !esNumero(d.cola?.contratos) || !esNumero(d.contratos?.total) || !esNumero(d.precioPen)) return null;
    return {
      entidad: d.entidad,
      cola: d.cola!,
      contratos: d.contratos!,
      tiposActivos: Array.isArray(d.tiposActivos) ? d.tiposActivos : [],
      precioPen: d.precioPen,
      enCola: Array.isArray(d.enCola) ? d.enCola : [],
      aliados: Array.isArray(d.aliados) ? d.aliados : [],
    };
  } catch {
    return null;
  }
}

// ─── Alcance activo en palabras ──────────────────────────────────────────────

const TIPO_TXT: Record<string, string> = {
  bienes: "bienes", servicios: "servicios", consultoria: "consultorías", obras: "obras", convenio: "convenios", directa: "contrataciones directas", otro: "otros",
};
const ETAPA_TXT: Record<string, string> = {
  planificacion: "en planificación", convocada: "convocados", adjudicada: "adjudicados", contratada: "contratados", en_ejecucion: "en ejecución", finalizada: "finalizados",
};
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** Los tipos que hoy se auditan, en palabras: "bienes", "bienes y obras". Vacío si no hay dato. */
export function tiposEnPalabras(tipos: string[] | null | undefined): string {
  return lista((tipos ?? []).map((t) => TIPO_TXT[t] ?? t));
}

/** "bienes con adjudicación o contrato" — para etiquetar la cola financiable. */
export function alcanceCorto(a: AlcanceProcesamiento | null | undefined): string {
  if (!a) return "bienes con adjudicación";
  const tipos = lista(a.tipos_activos.map((t) => TIPO_TXT[t] ?? t));
  const cerrada = ["adjudicada", "contratada", "en_ejecucion", "finalizada"].every((e) => a.etapas_activas.includes(e))
    && !a.etapas_activas.includes("convocada") && !a.etapas_activas.includes("planificacion");
  return cerrada ? `${tipos} con adjudicación o contrato` : `${tipos} ${lista(a.etapas_activas.map((e) => ETAPA_TXT[e] ?? e))}`;
}

/** Explicación completa para el tooltip/<details> del alcance. */
export function alcanceLargo(a: AlcanceProcesamiento | null | undefined): string {
  if (!a) return "Hoy la cola financiable incluye solo contratos de bienes ya adjudicados o contratados.";
  return `Hoy la cola financiable incluye solo ${alcanceCorto(a)}. Los demás contratos se descargan y clasifican igual: cuando sus documentos están en el almacén de Vigía aparecen como "documentos listos" y entrarán a la cola cuando su análisis se active.${a.nota ? ` ${a.nota}` : ""}`;
}

// ─── Helpers de presentación ─────────────────────────────────────────────────

export const ESTADO_LABEL: Record<ZonaEstado, string> = {
  sin_datos: "Sin contratos ingresados",
  pendiente: "Pendiente de financiar",
  parcial: "Parcialmente financiada",
  financiada: "Financiada, en proceso",
  procesada: "Auditoría completada",
};

/**
 * Punto de color del estado de una zona, con tokens (DESIGN_SYSTEM.md §3): gris mientras
 * nadie financia, granate (la marca: alguien pagó la lectura) mientras se financia, y
 * `moss` (positivo) cuando la lectura terminó. Nunca ámbar: el ámbar es "Señal media".
 * Siempre va junto a `ESTADO_LABEL`: el color solo no dice nada.
 */
export const ESTADO_PUNTO: Record<ZonaEstado, string> = {
  sin_datos: "bg-paper ring-1 ring-inset ring-paperEdge",
  pendiente: "bg-paperEdge ring-1 ring-inset ring-mute/30",
  parcial: "bg-granate-300",
  financiada: "bg-granate",
  procesada: "bg-moss",
};

/**
 * Los mismos colores en hex, para quien los pinta con `style` (mapas, Mi impacto).
 * Son los valores de los tokens de `ESTADO_PUNTO`; si cambia uno, cambian los dos.
 */
export const ESTADO_FILL: Record<ZonaEstado, string> = {
  sin_datos: "#F0EBE8",
  pendiente: "#E3DCD8",
  parcial: "#D896A5",
  financiada: "#711C30",
  procesada: "#3F7D43",
};

/** Soles con el formato único del producto (lib/formato): "S/ 45,000", "S/ 3". */
export const formatPEN = (n: number) => soles(n);
export const formatUSD = (n: number) => `US$ ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

/** Montos grandes en tarjetas y frases: el compacto único del producto ("S/ 3.2 M", "S/ 228 mil"). */
export const formatPENCorto = (n: number) => solesCompacto(n);

/** Mínimo de contratos por aporte: mismo CHECK (contratos >= 5) que exige el backend. */
export const MIN_CONTRATOS = 5;
/** Por entidad el mínimo es 1: una entidad puede tener menos de 5 contratos en cola. */
export const MIN_CONTRATOS_ENTIDAD = 1;

/** Tipo de financiador en palabras (el API lo manda crudo: "organizacion"). */
export const TIPO_FINANCIADOR_LABEL: Record<Aliado["tipo"], string> = {
  empresa: "Empresa",
  organizacion: "Organización",
  persona: "Persona",
};

/**
 * El mensaje público de un aporte, si se puede mostrar.
 * Los lotes institucionales (capital semilla, procesados desde el panel admin) traen
 * un texto interno ("Procesado desde el panel admin por …") que no es para el público.
 */
export function mensajePublicoVisible(mensaje: string | null | undefined, pasarela?: string | null): string | null {
  if (!mensaje) return null;
  if (pasarela === "institucional") return null;
  if (/panel admin/i.test(mensaje)) return null;
  return mensaje;
}

export interface ParteTarifa {
  monto: number;
  concepto: string;
}

/**
 * "S/1 procesamiento · S/1 infraestructura y datos · S/1 reserva expedientes pesados"
 * → partes con monto. El separador del API nunca llega a la pantalla.
 */
export function partesTarifa(nota: string | null | undefined): ParteTarifa[] {
  if (!nota) return [];
  return nota
    .split(/\s*·\s*/)
    .map((p) => p.match(/^S\/\s?(\d+(?:[.,]\d+)?)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ monto: Number(m[1].replace(",", ".")), concepto: m[2].trim() }));
}

/** "procesamiento (S/ 1), infraestructura y datos (S/ 1) y reserva expedientes pesados (S/ 1)". */
export function frasePartesTarifa(partes: ParteTarifa[]): string {
  const xs = partes.map((p) => `${p.concepto} (${formatPEN(p.monto)})`);
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/**
 * Tildes para mostrar los nombres de zona: el API los guarda sin acento ("Ancash",
 * "Apurimac", "Junin", "La Convencion"). Palabra por palabra, solo las que en el
 * Perú siempre se escriben con tilde; lo que no está acá se muestra tal cual.
 */
const ACENTOS: Record<string, string> = {
  Ancash: "Áncash", Apurimac: "Apurímac", Junin: "Junín", Huanuco: "Huánuco", Martin: "Martín",
  Convencion: "Convención", Asuncion: "Asunción", Concepcion: "Concepción", Bolivar: "Bolívar",
  Bongara: "Bongará", Camana: "Camaná", Caraveli: "Caravelí", Celendin: "Celendín", Chepen: "Chepén",
  Contumaza: "Contumazá", Fermin: "Fermín", Carrion: "Carrión", Sanchez: "Sánchez", Chimu: "Chimú",
  Huamalies: "Huamalíes", Huancane: "Huancané", Huarochiri: "Huarochirí", Huaytara: "Huaytará",
  Jaen: "Jaén", Julcan: "Julcán", Union: "Unión", Caceres: "Cáceres", Ramon: "Ramón", Morropon: "Morropón",
  Oyon: "Oyón", Purus: "Purús", Rodriguez: "Rodríguez", Roman: "Román", Victor: "Víctor", Huaman: "Huamán",
  Viru: "Virú", Azangaro: "Azángaro", Marañon: "Marañón", Rimac: "Rímac", Belen: "Belén", Jose: "José",
  Maria: "María", Andres: "Andrés", Tomas: "Tomás", Nicolas: "Nicolás", Jesus: "Jesús",
};

export function conAcentos(nombre: string): string {
  if (!nombre) return nombre;
  return nombre.replace(/[A-Za-zÁÉÍÓÚáéíóúÑñÜü]+/g, (w) => ACENTOS[w] ?? w);
}
