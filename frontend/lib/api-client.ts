/**
 * Cliente HTTP para el API Vigía Perú (Cloud Run).
 *
 * Pensado para llamarse desde **server components** de Next 14. Si se usa
 * desde un client component, prefija el env var con NEXT_PUBLIC_.
 *
 * El API ya devuelve los nombres camelCase que el frontend espera (ej. `montoSoles`,
 * `fechaBuenaPro`, `banderas[].opinionOece`) — no hace falta transformar.
 */

import type { Alerta, ReporteCiudadano } from "@/types";
import { esAlertaDemo, esAlertaReal, esConvergenciaReal, esReporteReal } from "./semillas";

export const API_BASE =
  process.env.VIGIA_API_URL ??
  process.env.NEXT_PUBLIC_VIGIA_API_URL ??
  // Por defecto el Worker de Cloudflare (la plataforma vive ahí; GCP quedó sin facturación). En runtime el
  // binding VIGIA_API_URL lo pisa; este valor es el que usa el BUILD al prerenderizar (antes caía al Cloud Run
  // muerto y las páginas estáticas quedaban en cero).
  "https://vigia-api.vigiaperu.workers.dev";

/**
 * Base de la API para pedidos DESDE EL NAVEGADOR. Detrás de Firebase Hosting (*.web.app,
 * *.firebaseapp.com o el dominio propio en NEXT_PUBLIC_DOMINIO_HOSTING) se usa el mismo dominio con
 * `/v1`: Hosting lo reenvía a la API y su CDN cachea lo que la API marca `public, s-maxage`. En
 * cualquier otro origen (run.app, localhost) y en el servidor se va directo a la API. Solo se usa
 * dentro de efectos y handlers (nunca en el render), así que el valor distinto en servidor y
 * navegador no descuadra la hidratación.
 */
export function baseApiNavegador(): string {
  if (typeof window === "undefined") return API_BASE;
  const host = window.location.hostname;
  const propio = process.env.NEXT_PUBLIC_DOMINIO_HOSTING;
  const detrasDeHosting = /\.(web\.app|firebaseapp\.com)$/.test(host) || (!!propio && host === propio);
  return detrasDeHosting ? `${window.location.origin}/v1` : API_BASE;
}

const DEFAULT_INIT: RequestInit = {
  // En server components: cachea 60s por URL+query. Ajustable si se necesita real-time.
  next: { revalidate: 60 } as any,
};

async function get<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseApiNavegador()}${path}`, { ...DEFAULT_INIT, ...init });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new ApiError(res.status, path, txt.slice(0, 200));
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, public path: string, public detail: string) {
    super(`[API ${status}] ${path}: ${detail}`);
  }
}

// ─── Tipos extendidos (lo que devuelve el API) ─────────────────

/** Alerta tal cual la lista del API la devuelve (con joins ya hechos). */
export type ApiAlerta = Alerta & {
  /** UUID interno de Postgres */
  codigo?: string;
  estado?: "activa" | "descartada" | "confirmada" | "en_revision";
};

export interface ApiEntidad {
  ruc: string;
  nombre: string;
  tipo:
    | "municipal_distrital" | "municipal_provincial"
    | "gobierno_regional" | "ministerio"
    | "empresa_publica" | "organismo_autonomo";
  region: string;
  provincia: string | null;
  distrito: string | null;
  pliegoNombreMef: string | null;
  alertas: number;
  monto: number;
  scorePromedio: number;
  reportes: number | null;
  contratos: number | null;
  contratosVigilados: number | null;
  serie: number[] | null;
  /** Tiene indicio de nepotismo (un pariente declarado en la DJI que es su locador). */
  conNepotismo?: boolean;
  /**
   * Lo que toda entidad tiene, para la lista (GET /entidades, 2026-10-27; la API vieja no lo trae): sus contratos con un
   * ganador con antecedentes y con uno grave (null: no se pudieron contar), su presupuesto del MEF del año (null: sin
   * cruce con el MEF), sus informes de la Contraloría y las señales que cuentan los filtros.
   */
  antecedentes?: { con: number; alta: number } | null;
  presupuesto?: { anio: number; pim: number; devengado: number; deTodoElGobierno: boolean } | null;
  informes?: { total: number; penal: number };
  senales?: {
    /** Contratos que ganó una empresa ligada a quien la gobierna, en el período de `capturaDesde` a `capturaHasta`. */
    captura: number;
    capturaPartido: string | null;
    capturaDesde: string | null;
    capturaHasta: string | null;
    /** Personas de su planilla con una señal alta. */
    planillaAlta: number;
    /** Plazas CAS con señales de plaza a la medida. */
    plazasSenales: number;
    /** Locadores y personas de su planilla que financiaron la campaña del que gobierna (migraciones 177-178). */
    financioLocadores?: number;
    financioPlanilla?: number;
    financioPartido?: string | null;
  };
}

export interface ApiReporte extends ReporteCiudadano {
  confirmaciones: number;
  convergenciaId: string | null;
}

export interface ApiConvergencia {
  id: string;
  alertaId: string;
  reporteIds: string[];
  lat: number;
  lon: number;
  resumen: string;
}

// ─── Endpoints ──────────────────────────────────────────────────

export async function getAlertas(params: {
  region?: string;
  estado?: string;
  scoreMin?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<ApiAlerta[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const r = await get<{ data: ApiAlerta[] }>(`/alertas?${qs}`);
  // Nunca las alertas de demo sembradas en la base (ver lib/semillas.ts).
  return r.data.filter(esAlertaReal);
}

/** Página completa (con `total`) para /app/alertas — a diferencia de `getAlertas`, que
 *  otros call sites (mapa, landing) usan como lote fijo y descartan el conteo. */
export interface ApiAlertasPagina {
  data: ApiAlerta[];
  total: number;
  limit: number;
  offset: number;
}

export async function getAlertasPagina(params: {
  region?: string;
  estado?: string;
  scoreMin?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<ApiAlertasPagina> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const r = await get<ApiAlertasPagina>(`/alertas?${qs}`);
  const reales = r.data.filter(esAlertaReal);
  // El total del backend las cuenta; se descuentan las de esta página. Es una
  // aproximación hasta que se borren de la base (lib/semillas.ts).
  return { ...r, data: reales, total: Math.max(0, r.total - (r.data.length - reales.length)) };
}

export async function getAlerta(id: string): Promise<ApiAlerta | null> {
  try {
    const a = await get<ApiAlerta>(`/alertas/${encodeURIComponent(id)}`);
    return a && esAlertaDemo(a) ? null : a;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Una alerta publicada con lo mínimo para dibujarla en el mapa (`GET /alertas/puntos`). */
export interface ApiAlertaPunto {
  codigo: string;
  /** Código corto de la convocatoria (el del dossier: /app/convocatoria/{convocatoria}). */
  convocatoria: string | null;
  lat: number | null;
  lon: number | null;
  /** Ubigeo de la zona del contrato (2, 4 o 6 dígitos). */
  ubigeo: string | null;
  score: number;
  severidadMax: "alta" | "media" | "baja" | null;
  /** Señales publicadas de la alerta. */
  nBanderas: number;
}

/** COMPAT-API-VIEJA: el endpoint respondió que no existe; vale por lo que dure la página. */
let puntosAusente = false;

const numeroONull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * `GET /alertas/puntos`: TODAS las alertas publicadas, sin tope, en filas mínimas (el mapa
 * pinta y cuenta sobre el universo entero, no sobre una lista recortada). Acepta la lista
 * suelta o envuelta en `{ data }`.
 *
 * COMPAT-API-VIEJA: devuelve `null` si el endpoint todavía no existe (la API de prod lo
 * resuelve como `/alertas/:id` y responde 404); quien llama cae a `/alertas?limit=200`.
 * Cualquier otro error se lanza.
 */
export async function getAlertasPuntos(): Promise<ApiAlertaPunto[] | null> {
  // Ya se sabe que no existe: no se vuelve a preguntar (cada reintento sumaba un 404).
  if (puntosAusente) return null;
  let body: unknown;
  try {
    body = await get<unknown>(`/alertas/puntos`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
      puntosAusente = true;
      return null;
    }
    throw e;
  }
  const filas = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data : null;
  // Una respuesta sin lista (p. ej. el detalle de una alerta) es la API vieja: mismo trato que el 404.
  if (!filas) {
    puntosAusente = true;
    return null;
  }
  return (filas as Record<string, unknown>[])
    .map((f): ApiAlertaPunto => {
      // El contrato del API dice `convocatoria`; se aceptan los nombres de las otras rutas.
      const conv = [f.convocatoria, f.codigoconvocatoria, f.ocid].find((v) => v != null && v !== "");
      const sev = f.severidadMax;
      return {
        codigo: String(f.codigo ?? ""),
        convocatoria: conv != null ? String(conv) : null,
        lat: numeroONull(f.lat),
        lon: numeroONull(f.lon),
        ubigeo: typeof f.ubigeo === "string" && /^\d{2,6}$/.test(f.ubigeo) ? f.ubigeo : null,
        score: numeroONull(f.score) ?? 0,
        severidadMax: sev === "alta" || sev === "media" || sev === "baja" ? sev : null,
        nBanderas: numeroONull(f.nBanderas ?? f.n_banderas) ?? 0,
      };
    })
    .filter(esAlertaReal);
}

export async function getEntidades(params: {
  q?: string;
  region?: string;
  tipo?: string;
  limit?: number;
} = {}): Promise<ApiEntidad[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  const r = await get<{ data: ApiEntidad[] }>(`/entidades?${qs}`);
  return r.data;
}

/** Presupuesto del MEF de un departamento (nombre como en el MEF: "AMAZONAS", "PROVINCIA CONSTITUCIONAL DEL CALLAO"…). */
export async function getMefRegion(dept: string) {
  return get<import("./mef").RegionBudgetSummary>(`/mef/region/${encodeURIComponent(dept)}`);
}

/**
 * Cuántas filas tiene cada pestaña de la ficha de una entidad (GET /entidades/:ruc/conteos): con ellas cada pestaña lleva
 * su número y las vacías van al final. null si la API no responde (la ficha sigue sin números, en su orden de siempre).
 */
export interface ConteosEntidad {
  /** Contratos menores (≤8 UIT) del SEACE. */
  menores: number;
  /** El primer año con contratos menores en la base (el módulo del SEACE es reciente). */
  menoresDesde: number | null;
  /** Personas a las que pagó por órdenes de servicio (persona_resumen). */
  personas: number;
  /** Personas en su planilla del Portal de Transparencia (planilla_resumen). */
  planilla: number;
  /** Plazas CAS que publicó en SERVIR Talento Perú. */
  plazas: number;
  /** Desde cuándo guarda Vigía las plazas de SERVIR ("AAAA-MM-DD"). */
  plazasDesde: string | null;
  /** Informes de la Contraloría sobre ella. */
  informes: number;
  /** Sus órdenes de compra y de servicio (CONOSCE). null = tiene, pero todavía no están contadas (migración 148). */
  ordenes: number | null;
  /** Lo que suman, sin las de monto dudoso; null si no están contadas. */
  ordenesMonto: number | null;
  /** Sus obras públicas en INFOBRAS y sus inversiones en Invierte.pe (migración 160); null/ausente = sin dato. */
  obras?: number | null;
  inversiones?: number | null;
}

export async function getConteosEntidad(ruc: string): Promise<ConteosEntidad | null> {
  try {
    return await get<ConteosEntidad>(`/entidades/${ruc}/conteos`);
  } catch {
    return null;
  }
}

/** En qué gasta la entidad según el MEF (migración 63). null si la API no responde o no lo tiene. */
export async function getGastoEntidad(ruc: string) {
  try {
    return await get<import("./mef").GastoEntidad>(`/entidades/${ruc}/gasto`);
  } catch {
    return null;
  }
}

export async function getFraccionamientoEntidad(ruc: string, limit = 1000) {
  try {
    return await get<import("./contratos").FraccionamientoEntidad>(`/entidades/${ruc}/fraccionamiento?limit=${limit}`);
  } catch {
    return null;
  }
}

/** Indicio de nepotismo: parientes declarados en la DJI que son locadores de la entidad. El funcionario es cargo
 *  público (sin tapar); el proveedor (RUC-10) va con un apellido tapado, como cualquier locador. */
export interface NepotismoIndicio {
  /** El primer apellido del funcionario que lo declaró, o `null` si mostrarlo podría destapar el apellido tapado del
   *  pariente (hijo, sobrino, primo, nieto: ver `apellidoFuncionario` en el API). Su nombre completo nunca llega. */
  funcionarioApellido: string | null;
  cargo: string | null;    // su cargo en la entidad (de la DJI), p. ej. "JEFE DE ABASTECIMIENTO"
  declaranteFicha: string | null; // su ficha de planilla (si figura en la planilla de esta entidad): para enlazarlo
  grado: string;           // hermano | hijo | padre | conyuge | otro
  parentesco: string;
  proveedorRuc: string;
  proveedorNombre: string; // tapado por el backend (un apellido)
  proveedorCodigo: string | null; // id (12 hex) para enlazar a su ficha; la evidencia (sus órdenes) vive ahí
  ordenes: number;
  monto: number;
}
export interface NepotismoEntidad {
  total: number;
  monto: number;
  porGrado: { grado: string; n: number; monto: number }[];
  detalle?: NepotismoIndicio[];
}

export async function getEntidad(ruc: string) {
  try {
    // `informes` y `senales`: lo mismo que la lista cuenta para sus banderas (null o sin la clave: no se pudieron leer).
    return await get<{ entidad: any; mef: any; alertas: any[]; nepotismo: NepotismoEntidad | null; informes?: ApiEntidad["informes"] | null; senales?: ApiEntidad["senales"] | null }>(
      `/entidades/${ruc}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Estructura de decisión de una entidad (grafo del Estado, migración 126): quién aprueba/firma sus contratos. */
export interface EstructuraEntidad {
  disponible: boolean;
  apruebaContratos?: string;
  estructuraLegal?: string | null;
  funcionarios?: { persona: string; cargo: string; organo: string }[];
  organos?: string[];
  corte?: string;
}
export async function getEstructuraEntidad(ruc: string): Promise<EstructuraEntidad | null> {
  try {
    return await get<EstructuraEntidad>(`/estructura/entidad/${ruc}`);
  } catch {
    // La estructura es opcional: si el grafo no la tiene o falla, la ficha sigue sin romperse.
    return null;
  }
}

// ─── Entidades: página filtrada+paginada (server-side) + resumen global ─────
// `getEntidades` (arriba) sigue devolviendo el arreglo plano tal cual — lo consume
// components/mapa/EntidadesDeZona.tsx — así que no se le toca la forma. /app/entidades
// usa `getEntidadesPagina`, que sí trae `total` real (antes truncaba un batch de 100).

const TIPOS_ENTIDAD: ApiEntidad["tipo"][] = [
  "municipal_distrital",
  "municipal_provincial",
  "gobierno_regional",
  "ministerio",
  "empresa_publica",
  "organismo_autonomo",
];

/**
 * El tipo de la entidad como lo muestra la web (lib/entidad-tipo.ts): el backend lo deriva igual, del nombre y, si no
 * dice nada, del tipo declarado. `municipal` junta las dos municipalidades; `sin`, las que no se pueden clasificar.
 */
export const CLASES_ENTIDAD = [
  "ministerio", "regional", "municipal", "provincial", "distrital", "universidad", "salud", "educacion", "programa",
  "beneficencia", "fuerzas", "empresa", "organismo", "publico", "sin",
] as const;
export type ClaseEntidad = (typeof CLASES_ENTIDAD)[number];

/** Lo que otros registros dicen de la entidad (los filtros de «Filtros»), con sus valores en la URL. */
export const CONTROLES_ENTIDAD = ["penal", "civil", "administrativa", "alguno"] as const;
export const PLANILLAS_ENTIDAD = ["alta", "con"] as const;
export const PLAZAS_ENTIDAD = ["senales", "con"] as const;
/** El primero es el de por defecto (no va en la URL): por contratos, que toda entidad tiene. */
export const ORDENES_ENTIDADES = [
  { valor: "contratos", etiqueta: "Más contratos" },
  { valor: "dictamen", etiqueta: "Más contratos con dictamen" },
  { valor: "nombre", etiqueta: "Por nombre" },
] as const;
export type OrdenEntidades = (typeof ORDENES_ENTIDADES)[number]["valor"];

export interface EntidadesQuery {
  q?: string;
  tipo?: ApiEntidad["tipo"];
  /** Región (nombre de departamento tal como lo trae el backend). */
  region?: string;
  /** Tipo de la entidad (derivado del nombre, como se muestra). */
  clase?: ClaseEntidad;
  /** La provincia: los cuatro primeros dígitos del ubigeo. */
  provincia?: string;
  /** El partido que la gobierna (gobiernos regionales y municipalidades), como lo escribe el JNE. */
  partido?: string;
  /** Con contratos cuyo ganador está ligado al partido que la gobierna (captura). */
  captura?: boolean;
  /** Informes de la Contraloría con ese tipo de responsabilidad presunta, o alguno. */
  control?: (typeof CONTROLES_ENTIDAD)[number];
  planilla?: (typeof PLANILLAS_ENTIDAD)[number];
  plazas?: (typeof PLAZAS_ENTIDAD)[number];
  /** Solo las entidades con indicio de nepotismo (un pariente declarado en la DJI que es su locador). */
  nepotismo?: boolean;
  /** Solo las que tienen locadores o personas de planilla que financiaron la campaña del que la gobierna (migración 178). */
  financio?: boolean;
  orden?: OrdenEntidades;
  page?: number;
}

/**
 * Cuántas entidades hay en cada opción de los filtros (GET /entidades?facetas=1), sobre la región, la provincia y el
 * tipo elegidos (cada faceta, sin su propio filtro). No miran la búsqueda por texto.
 */
export interface FacetasEntidades {
  /** Por el tipo que se muestra (`municipal_distrital`…; `sin` = sin clasificar). */
  tipos: { valor: string; n: number }[];
  provincias: { valor: string; etiqueta: string; n: number }[];
  partidos: { valor: string; n: number }[];
  senales: Record<"captura" | "penal" | "civil" | "administrativa" | "informes" | "planillaAlta" | "planilla" | "plazasSenales" | "plazas" | "nepotismo", number> &
    Partial<Record<"financio", number>>;
}

export const ENTIDADES_PAGE_SIZE = 20;

/** Lee `searchParams` de Next (strings sueltos) y deja solo lo válido — mismo patrón que parseContratosQuery. */
export function parseEntidadesQuery(sp: Record<string, string | string[] | undefined> = {}): EntidadesQuery {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const de = <T extends string>(k: string, valores: readonly T[]) => { const v = s(k); return v && (valores as readonly string[]).includes(v) ? (v as T) : undefined; };
  const page = Math.max(1, Number(s("page") ?? 1) || 1);
  const tipo = s("tipo");
  const provincia = s("provincia");
  const partido = s("partido")?.trim();
  return {
    page,
    q: s("q")?.slice(0, 120) || undefined,
    tipo: tipo && (TIPOS_ENTIDAD as string[]).includes(tipo) ? (tipo as ApiEntidad["tipo"]) : undefined,
    region: s("region")?.slice(0, 80) || undefined,
    clase: de("clase", CLASES_ENTIDAD),
    provincia: provincia && /^\d{4}$/.test(provincia) ? provincia : undefined,
    partido: partido && partido.length >= 2 ? partido.slice(0, 120) : undefined,
    captura: s("captura") === "1" || undefined,
    control: de("control", CONTROLES_ENTIDAD),
    planilla: de("planilla", PLANILLAS_ENTIDAD),
    plazas: de("plazas", PLAZAS_ENTIDAD),
    nepotismo: s("nepotismo") === "1" || undefined,
    financio: s("financio") === "1" || undefined,
    // El orden por defecto no va en la URL. Un `?orden=` de un enlace viejo («Mayor monto», que ordenaba sólo la página) se ignora.
    orden: de("orden", ORDENES_ENTIDADES.map((o) => o.valor)),
  };
}

export interface EntidadesPagina {
  data: ApiEntidad[];
  total: number;
  page: number;
  size: number;
  /** null si la API no las pudo contar (los filtros van sin números). */
  facetas: FacetasEntidades | null;
}

/** Página real del ranking de entidades con filtros server-side: GET /entidades?...&limit=&offset=, con sus facetas. */
export async function getEntidadesPagina(query: EntidadesQuery = {}): Promise<EntidadesPagina> {
  const page = Math.max(1, query.page ?? 1);
  const size = ENTIDADES_PAGE_SIZE;
  const qs = new URLSearchParams();
  for (const k of ["q", "tipo", "region", "clase", "provincia", "partido", "control", "planilla", "plazas", "orden"] as const) {
    const v = query[k];
    if (v) qs.set(k, v);
  }
  if (query.captura) qs.set("captura", "1");
  if (query.nepotismo) qs.set("nepotismo", "1");
  if (query.financio) qs.set("financio", "1");
  qs.set("facetas", "1");
  qs.set("limit", String(size));
  qs.set("offset", String((page - 1) * size));
  const r = await get<{ data: ApiEntidad[]; total: number; limit: number; offset: number; facetas?: FacetasEntidades | null }>(`/entidades?${qs}`);
  return { data: r.data, total: r.total, page, size, facetas: r.facetas ?? null };
}

/** Las regiones (departamentos) para poblar el filtro de la lista de entidades. */
export async function getRegionesEntidades(): Promise<string[]> {
  try {
    const r = await get<{ regiones: string[] }>(`/entidades/regiones`);
    return r.regiones ?? [];
  } catch {
    return [];
  }
}

export interface EntidadesResumen {
  totalEntidades: number;
  conAlertas: number;
  monto: number;
  /** Las que tienen contratos en la base (desde 2015). null: la API no lo trae. */
  conContratos: number | null;
  /** Las que tienen algún contrato con un ganador con antecedentes, y con alguno grave. null: no se pudieron contar. */
  conAntecedentes: number | null;
  conGraves: number | null;
  /** Las que tienen informes de la Contraloría (responsabilidad presunta). */
  conInformes: number | null;
}

/** KPIs globales de todo el universo de entidades (no respeta filtros de búsqueda): GET /entidades/summary. */
export async function getEntidadesResumen(): Promise<EntidadesResumen> {
  const r = await get<{
    total_entidades: number; con_alertas: number; monto: number;
    con_contratos?: number | null; con_antecedentes?: number | null; con_graves?: number | null; con_informes?: number | null;
  }>(`/entidades/summary`);
  return {
    totalEntidades: r.total_entidades, conAlertas: r.con_alertas, monto: r.monto,
    conContratos: r.con_contratos ?? null, conAntecedentes: r.con_antecedentes ?? null, conGraves: r.con_graves ?? null,
    conInformes: r.con_informes ?? null,
  };
}

export interface MediaItem {
  url: string;
  tipo: "foto" | "video" | "documento" | "audio";
  filename?: string | null;
  size_bytes?: number | null;
  content_type?: string | null;
}

export async function createReporte(payload: {
  modo: "obra" | "entidad";
  categoria: string;
  descripcion: string;
  fotoUrl?: string | null;
  media?: MediaItem[];
  lat?: number | null;
  lon?: number | null;
  direccionTexto?: string | null;
  region?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  rucEntidad?: string | null;
  montoEstimado?: number | null;
  periodoDesde?: string | null;
  periodoHasta?: string | null;
  personasInvolucradas?: string | null;
  enlacesExternos?: string[];
  contactoEmail?: string | null;
  contactoNombre?: string | null;
  contactoTelefono?: string | null;
  anonimo?: boolean;
}, cabeceras: Record<string, string> = {}): Promise<{ id: string; ok: true }> {
  // `cabeceras`: la verificación contra bots (`cf-turnstile-response`, components/seguridad/mensajes.ts).
  const r = await fetch(`${API_BASE}/reportes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabeceras },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) throw new ApiError(r.status, "/reportes", JSON.stringify(data).slice(0, 200));
  return data;
}

export async function getReportes(params: {
  region?: string;
  categoria?: string;
  confirmados?: "true" | "false";
  bbox?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ApiReporte[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const r = await get<{ data: ApiReporte[] }>(`/reportes?${qs}`);
  return r.data.filter(esReporteReal);
}

export interface ReportesPagina {
  data: ApiReporte[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Igual que `getReportes` pero devuelve el sobre completo con `total` real
 * (COUNT del backend) para paginar de verdad — lo usa /app/denuncias para
 * "página N de M". `getReportes` se deja intacto devolviendo solo el array:
 * MapaWrapper.tsx y el propio mapa de /app/denuncias ya dependen de esa forma
 * para pedir un batch grande sin paginar.
 */
export async function getReportesPagina(params: {
  region?: string;
  categoria?: string;
  confirmados?: "true" | "false";
  bbox?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ReportesPagina> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const r = await get<ReportesPagina>(`/reportes?${qs}`);
  const reales = r.data.filter(esReporteReal);
  return { ...r, data: reales, total: Math.max(0, r.total - (r.data.length - reales.length)) };
}

export async function getConvergencias(): Promise<ApiConvergencia[]> {
  const r = await get<{ data: ApiConvergencia[] }>(`/reportes/convergencias`);
  return r.data.filter(esConvergenciaReal);
}

/**
 * `GET /reportes/:id` en el backend hace `SELECT *` (columnas snake_case tal cual la tabla:
 * foto_url, convergencia_id) a diferencia de `GET /reportes` que sí alias-ea a camelCase — por
 * eso acá se normaliza a mano en vez de castear directo a ApiReporte.
 */
export async function getReporte(id: string): Promise<ApiReporte | null> {
  if (!esReporteReal({ id })) return null;
  try {
    const row = await get<Record<string, any>>(`/reportes/${encodeURIComponent(id)}`);
    return {
      id: row.id,
      categoria: row.categoria,
      descripcion: row.descripcion,
      fotoUrl: row.fotoUrl ?? row.foto_url ?? undefined,
      lat: Number(row.lat),
      lon: Number(row.lon),
      region: row.region,
      fecha: row.fecha,
      confirmado: !!row.confirmado,
      confirmaciones: row.confirmaciones ?? 1,
      convergenciaId: row.convergenciaId ?? row.convergencia_id ?? null,
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
