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
  ubigeo: string;
  zona: string;
  nivel: NivelZona;
  financiador: string;
  tipo: Aliado["tipo"];
  slug: string | null;
  logoUrl: string | null;
}

export interface Comprobante {
  codigo: string;
  contratos: number;
  montoPen: number;
  estado: string;
  pagadaAt: string | null;
  createdAt: string;
  mensajePublico: string | null;
  ubigeo: string;
  zona: string;
  nivel: NivelZona;
  financiador: string;
  tipo: Aliado["tipo"];
  slug: string | null;
  logoUrl: string | null;
  resumen: { asignados: number; procesados: number; pendientes: number; senales: number; contratosConSenal?: number; enRevision?: number; montoAuditado: number };
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
  getJson<{ data: Zona[] }>(`/financiamiento/zonas?nivel=${nivel}${padre ? `&padre=${padre}` : ""}`, 300).then((r) => r?.data ?? null);

export const getZona = (ubigeo: string) => getJson<ZonaDetalle>(`/financiamiento/zonas/${ubigeo}`, 60);

export const getRanking = (periodo: "mes" | "anio" | "todo" = "todo") =>
  getJson<{ data: RankingRow[] }>(`/financiamiento/ranking?periodo=${periodo}`, 300).then((r) => r?.data ?? null);

export const getEstadoGlobal = () => getJson<EstadoGlobal>("/financiamiento/estado", 120);

export const getRecientes = () =>
  getJson<{ data: ContribucionReciente[] }>("/financiamiento/recientes", 60).then((r) => r?.data ?? null);

export const getPago = () => getJson<import("@/components/financiar/PaymentMethods").PagoPublico>("/financiamiento/pago", 60);

export const getComprobante = (codigo: string) =>
  getJson<Comprobante>(`/financiamiento/impacto/${encodeURIComponent(codigo)}`, 30);

export const getAlcance = () => getJson<Alcance>("/financiamiento/alcance", 60);

// ─── Alcance activo en palabras ──────────────────────────────────────────────

const TIPO_TXT: Record<string, string> = {
  bienes: "bienes", servicios: "servicios", consultoria: "consultorías", obras: "obras", convenio: "convenios", directa: "contrataciones directas", otro: "otros",
};
const ETAPA_TXT: Record<string, string> = {
  planificacion: "en planificación", convocada: "convocados", adjudicada: "adjudicados", contratada: "contratados", en_ejecucion: "en ejecución", finalizada: "finalizados",
};
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

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
  financiada: "Financiada · en proceso",
  procesada: "Auditoría completada",
};

/** Colores del mapa de campaña. Ámbar = en curso, verde = logrado, gris = nada aún. */
export const ESTADO_FILL: Record<ZonaEstado, string> = {
  sin_datos: "#EEF1F4",
  pendiente: "#D9DEE4",
  parcial: "#F2C879",
  financiada: "#9CCB9F",
  procesada: "#3F7D43",
};

export const formatPEN = (n: number) => `S/ ${n.toLocaleString("es-PE", { maximumFractionDigits: 0 })}`;
export const formatUSD = (n: number) => `US$ ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
