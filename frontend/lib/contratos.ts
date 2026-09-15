/**
 * Cliente y tipos de "Contratos" (todo el SEACE ingerido, contrato por contrato).
 * Backend: backend/api/src/routes/contratos.ts
 * Plan:    docs/superpowers/plans/2026-09-15-seace-escala.md · Workstream F
 *
 * Mismo contrato que lib/auditoria.ts: los GET devuelven `null` si el API no responde.
 * Funcionan en server components (fetch cacheado) y en el cliente (NEXT_PUBLIC_VIGIA_API_URL).
 */

import { API_BASE } from "./api-client";
import type { Procesamiento } from "./auditoria";

export type TipoContrato = "bienes" | "servicios" | "consultoria" | "obras" | "convenio" | "directa" | "otro";
export type EtapaContrato =
  | "planificacion" | "convocada" | "adjudicada" | "contratada" | "en_ejecucion"
  | "finalizada" | "desierta" | "cancelada" | "nula" | "desconocida";
export type RiesgoContrato = "alto" | "medio" | "bajo" | "sin_analizar";
export type EstadoContrato = "sin_analizar" | "pendiente_de_procesamiento" | "esperando_documentos" | "encolado" | "procesando" | "procesado" | "error";
export type OrdenContratos = "fecha" | "monto" | "score";

export interface ContratoResumen {
  ocid: string;
  codigo: string;
  titulo: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  tipo: TipoContrato | null;
  etapa: EtapaContrato | null;
  modalidad: string | null;
  montoPen: number | null;
  moneda: string | null;
  fecha: string | null;                // YYYY-MM-DD (convocatoria)
  ubigeo: string | null;
  zona: string | null;
  lat: number | null;
  lon: number | null;
  procesable: boolean | null;
  estadoProcesamiento: EstadoContrato;
  /** Migración 19: en_cola (tipo/etapa con análisis activo) · documentos_listos (docs en GCS, análisis aún no activo) · sin_documentos. */
  estadoOperativo?: EstadoOperativo | null;
  score: number | null;
  banderas: number;
  proveedor: string | null;
  proveedorRuc: string | null;
}

export interface ContratoItem {
  id: string;
  posicion: number;
  descripcion: string | null;
  cantidad: number | null;
  unidad: string | null;
  montoPen: number | null;
  cubso: string | null;
  estado: string | null;
}

export interface ContratoDocumento {
  tipo: string | null;                 // biddingDocuments · awardNotice · contractSigned · …
  titulo: string | null;
  url: string;
  formato: string | null;
  fecha: string | null;
  /** tender · award · contract (de qué parte del expediente sale). */
  seccion?: "tender" | "award" | "contract";
  /** Copia vigente en el almacén de Vigía (retención 90 días): se puede previsualizar con URL firmada. */
  enVigia?: boolean;
}

export interface BanderaResumen {
  regla: string;
  severidad: "alta" | "media" | "baja";
  evidencia: string | null;
  norma: string | null;
}

export interface Clasificacion {
  tipo: TipoContrato | null;
  etapa: EtapaContrato | null;
  modalidad: string | null;
  procesable: boolean | null;
  motivoNoProcesable: string | null;
  agentesAplicables: string[] | null;
  validacionesPendientes: string[] | null;
  clasificadoAt: string | null;
}

export interface ContratoDetalle extends ContratoResumen {
  fechaBuenaPro: string | null;
  tipoProceso: string | null;
  fuenteFinanciamiento: string | null;
  nomenclatura: string | null;
  descripcion: string | null;
  postores: number | null;
  items: ContratoItem[];
  documentos: ContratoDocumento[];
  adjudicaciones: { id: string | null; fecha: string | null; montoPen: number | null; proveedor: string | null; proveedorRuc: string | null }[];
  alerta: { id: string; codigo: string; score: number | null; estado: string; analizadoEn: string | null; banderas: BanderaResumen[] } | null;
  procesamiento: Procesamiento | null;
  clasificacion: Clasificacion;
  /** Documentos vigentes en el almacén de Vigía (retención 90 días). null si la migración 15 no está. */
  documentosEnVigia: { n: number; expiraAt: string | null } | null;
  /** Pedido de descarga abierto (el batch nocturno lo atiende). */
  pedidoDescarga: { estado: "pendiente" | "descargando"; solicitadoAt: string } | null;
}

export interface ContratoZona {
  ubigeo: string;
  nombre: string;
  nivel: "departamento" | "provincia" | "distrito";
  lat: number;
  lon: number;
  total: number;
  sinAnalizar: number;
  pendientes: number;
  enProceso: number;
  procesados: number;
  conSenales: number;
  montoPen: number;
}

export interface ContratosPagina {
  data: ContratoResumen[];
  total: number;
  page: number;
  size: number;
}

export type EstadoOperativo = "en_cola" | "documentos_listos" | "sin_documentos";
export const OPERATIVOS: { value: EstadoOperativo; label: string }[] = [
  { value: "en_cola", label: "En cola (análisis activo)" },
  { value: "documentos_listos", label: "Documentos listos · análisis en preparación" },
  { value: "sin_documentos", label: "Sin documentos aún" },
];

export interface ContratosQuery {
  page?: number;
  size?: number;
  q?: string;
  tipo?: TipoContrato | "";
  etapa?: EtapaContrato | "";
  ubigeo?: string;
  entidad?: string;
  monto_min?: number | string;
  monto_max?: number | string;
  riesgo?: RiesgoContrato | "";
  estado?: EstadoContrato | "";
  operativo?: EstadoOperativo | "";
  orden?: OrdenContratos | "";
}

export const TIPOS: { value: TipoContrato; label: string }[] = [
  { value: "bienes", label: "Bienes" },
  { value: "servicios", label: "Servicios" },
  { value: "consultoria", label: "Consultoría" },
  { value: "obras", label: "Obras" },
  { value: "convenio", label: "Convenio" },
  { value: "directa", label: "Contratación directa" },
  { value: "otro", label: "Otro" },
];

export const ETAPAS: { value: EtapaContrato; label: string }[] = [
  { value: "planificacion", label: "Planificación" },
  { value: "convocada", label: "Convocada" },
  { value: "adjudicada", label: "Adjudicada" },
  { value: "contratada", label: "Contratada" },
  { value: "en_ejecucion", label: "En ejecución" },
  { value: "finalizada", label: "Finalizada" },
  { value: "desierta", label: "Desierta" },
  { value: "cancelada", label: "Cancelada" },
  { value: "nula", label: "Nula" },
  { value: "desconocida", label: "Desconocida" },
];

export const RIESGOS: { value: RiesgoContrato; label: string }[] = [
  { value: "alto", label: "Señal alta (≥ 70)" },
  { value: "medio", label: "Señal media (40–69)" },
  { value: "bajo", label: "Señal baja (< 40)" },
  { value: "sin_analizar", label: "Sin analizar" },
];

export const ORDENES: { value: OrdenContratos; label: string }[] = [
  { value: "fecha", label: "Más recientes" },
  { value: "monto", label: "Mayor monto" },
  { value: "score", label: "Mayor señal de riesgo" },
];

export const tipoLabel = (t: string | null | undefined) => TIPOS.find((x) => x.value === t)?.label ?? null;
export const etapaLabel = (e: string | null | undefined) => ETAPAS.find((x) => x.value === e)?.label ?? null;

/** Estados que lib/auditoria no conoce (el resto usa `EstadoPill`). */
export const ESTADO_CONTRATO_EXTRA: Record<"sin_analizar" | "pendiente_de_procesamiento", { label: string; cls: string }> = {
  sin_analizar: { label: "Sin analizar", cls: "bg-paperDeep text-mute" },
  pendiente_de_procesamiento: { label: "Pendiente de procesamiento", cls: "bg-amber-soft/60 text-clay" },
};

export function riesgoDe(score: number | null | undefined): RiesgoContrato {
  if (score == null) return "sin_analizar";
  if (score >= 70) return "alto";
  if (score >= 40) return "medio";
  return "bajo";
}

export const RIESGO_CLS: Record<RiesgoContrato, string> = {
  alto: "text-rust",
  medio: "text-amber",
  bajo: "text-moss",
  sin_analizar: "text-mute",
};

/** RUC que empieza en 10 = persona natural con negocio (contiene el DNI): se redacta. */
export const esPersonaNatural = (ruc: string | null | undefined) => !!ruc && /^10\d{9}$/.test(ruc);

export function contratosQueryString(q: ContratosQuery = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === "" || (k === "page" && Number(v) <= 1)) continue;
    params.set(k, String(v));
  }
  return params.toString();
}

/** Lee `searchParams` de Next (strings sueltos) y deja solo lo válido. */
export function parseContratosQuery(sp: Record<string, string | string[] | undefined> = {}): ContratosQuery {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const page = Math.max(1, Number(s("page") ?? 1) || 1);
  const num = (k: string) => { const v = s(k); return v && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined; };
  const ubigeo = s("ubigeo");
  const entidad = s("entidad");
  return {
    page,
    q: s("q")?.slice(0, 120) || undefined,
    tipo: TIPOS.some((t) => t.value === s("tipo")) ? (s("tipo") as TipoContrato) : undefined,
    etapa: ETAPAS.some((t) => t.value === s("etapa")) ? (s("etapa") as EtapaContrato) : undefined,
    ubigeo: ubigeo && /^\d{2}(\d{2}(\d{2})?)?$/.test(ubigeo) ? ubigeo : undefined,
    entidad: entidad && /^\d{11}$/.test(entidad) ? entidad : undefined,
    monto_min: num("monto_min"),
    monto_max: num("monto_max"),
    riesgo: RIESGOS.some((t) => t.value === s("riesgo")) ? (s("riesgo") as RiesgoContrato) : undefined,
    operativo: OPERATIVOS.some((t) => t.value === s("operativo")) ? (s("operativo") as EstadoOperativo) : undefined,
    orden: ORDENES.some((t) => t.value === s("orden")) ? (s("orden") as OrdenContratos) : undefined,
  };
}

async function getJson<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { next: { revalidate } } as any);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const getContratos = (q: ContratosQuery = {}) =>
  getJson<ContratosPagina>(`/contratos?${contratosQueryString(q)}`, 60);

export const getContrato = (ocid: string) =>
  getJson<ContratoDetalle>(`/contratos/${encodeURIComponent(ocid)}`, 60);

export const getContratosGeo = (q: Pick<ContratosQuery, "tipo" | "etapa" | "riesgo" | "ubigeo" | "entidad" | "q"> & { nivel?: "distrito" | "provincia" | "departamento" } = {}) =>
  getJson<{ nivel: string; data: ContratoZona[] }>(`/contratos/geo?${contratosQueryString(q as ContratosQuery)}`, 300).then((r) => r?.data ?? null);

// ─── Resumen de procesamiento enriquecido (PanelProcesamiento) ───────────────

export interface ProcesamientoActivo {
  ocid: string;
  faseActual: string | null;
  faseIndex: number | null;
  financiador: string;
  zona: string | null;
  titulo: string | null;
  desdeSeg: number;
}

export interface LoteIngesta {
  id: string;
  tipo: string | null;
  estado: string | null;
  total: number | null;
  completados: number | null;
  fallidos: number | null;
  iniciado: string | null;
}

export interface ResumenProcesamientoVivo {
  porEstado: Record<string, number>;
  procesadosHoy: number;
  activos: ProcesamientoActivo[];
  lote: LoteIngesta | null;
  descargados24h: number;
  /** Migración 19: qué se analiza hoy y cuántos contratos tienen documentos listos. */
  procesamientoActivo: { tipos_activos: string[]; etapas_activas: string[]; nota?: string } | null;
  documentosListos: { n: number; contratos: number } | null;
  /** Pedidos de descarga (migración 15); null si la tabla no existe. */
  pedidos: { pendientes: number; descargando: number; listos24h: number; fallidos: number } | null;
  agentesActivos: string[];
}

export const getResumenVivo = () =>
  getJson<ResumenProcesamientoVivo>(`/financiamiento/procesamientos/resumen`, 5);

// ─── Presentación ────────────────────────────────────────────────────────────

export const formatMonto = (n: number | null | undefined, moneda: string | null = "PEN") => {
  if (n == null) return "—";
  if (n === 0) return "—";
  const pre = moneda && moneda !== "PEN" ? `${moneda} ` : "S/ ";
  if (n >= 1_000_000) return `${pre}${(n / 1_000_000).toLocaleString("es-PE", { maximumFractionDigits: 1 })} M`;
  return `${pre}${n.toLocaleString("es-PE", { maximumFractionDigits: 0 })}`;
};

export const formatFecha = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y.slice(2)}` : iso;
};

const TIPO_DOC: Record<string, string> = {
  biddingDocuments: "Bases",
  awardNotice: "Buena pro",
  contractSigned: "Contrato",
  evaluationReports: "Evaluación",
  clarifications: "Absolución de consultas",
  tenderNotice: "Convocatoria",
  contractArrangements: "Contrato",
};
export const tipoDocLabel = (t: string | null | undefined) => (t ? TIPO_DOC[t] ?? t.replace(/([a-z])([A-Z])/g, "$1 $2") : "Documento");

const VALIDACION: Record<string, string> = {
  infobras_avance: "Avance físico de obra (INFOBRAS) no disponible",
  market: "Sin ítems comparables para precios de mercado",
  document_parser: "Sin documentos descargables del expediente",
  person_network: "Sin RUC de proveedor para la red de personas",
  web_research: "Sin RUC de proveedor para la investigación web",
  news_research: "Sin RUC de proveedor para la búsqueda en prensa",
  entity_personnel: "Sin RUC de entidad para funcionarios",
  compliance_extended: "Sin proveedor para cumplimiento extendido",
};
export const validacionLabel = (v: string) => VALIDACION[v] ?? v.replace(/_/g, " ");

const MOTIVO: Record<string, string> = {
  tipo_no_soportado: "Tipo de contratación aún no soportado por los agentes",
  etapa_desconocida: "No se pudo determinar la etapa del proceso",
  sin_postores: "Todavía no hay postores ni bases publicadas",
  planificacion: "El proceso está en planificación: no hay bases ni postores",
};
export const motivoLabel = (m: string | null | undefined) => (m ? MOTIVO[m] ?? m.replace(/_/g, " ") : "Pendiente de procesamiento");
