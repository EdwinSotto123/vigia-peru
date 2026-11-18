/**
 * El informe de indicios en formato de control de un contrato (GET /v1/contratos/:ocid/informe-control; la API lo arma en
 * backend/api/src/lib/informeControl.ts). Los tipos son los del documento que devuelve la API, tal cual.
 */
import { API_BASE } from "./api-client";

export type SeveridadInforme = "alta" | "media" | "baja";

export interface EnlaceInforme {
  texto: string;
  url: string;
  /** La copia de Vigía de un documento del SEACE (abre aunque el SEACE falle). */
  copia?: string | null;
  fuente?: string;
}

export interface NormaInforme {
  id: string;
  documento: string;
  articulo: string | null;
  epigrafe: string | null;
  extracto: string;
  url: string | null;
  version: string | null;
  clase: "norma" | "criterio";
}

export interface PrecedenteInforme {
  id: string;
  numero: string | null;
  codigo: string;
  entidad: string | null;
  anio: number | null;
  titulo: string | null;
  observacion: string | null;
  modalidad: string | null;
  responsabilidades: string[];
  url: string | null;
}

export interface RegistrosInforme {
  titulo: string;
  columnas: string[];
  filas: (string | number | null)[][];
  total: number | null;
}

export interface ObservacionInforme {
  numero: number;
  id: string;
  tema: string;
  severidad: SeveridadInforme;
  sumilla: string;
  condicion: string[];
  criterio: { fecha: string | null; base: "convocatoria" | "hecho"; ley: string; normas: NormaInforme[]; referencias: string[] };
  efecto: string;
  causa: string;
  evidencia: EnlaceInforme[];
  registros: RegistrosInforme[];
  precedentes: PrecedenteInforme[];
  senales: { tipo: string; etiqueta: string; severidad: SeveridadInforme; origen: "cruce" | "dictamen"; fuente: string }[];
  redaccion: "modelo" | "datos";
}

export interface InformeControl {
  version: string;
  titulo: string;
  numero: string;
  fecha: string;
  aviso: string;
  general: {
    titulo: string;
    objetivo: string;
    entidad: { nombre: string | null; ruc: string | null };
    proceso: { nomenclatura: string | null; codigo: string | null; ocid: string; procedimiento: string | null; tipo: string | null; etapa: string | null };
    montos: { referencial: number | null; adjudicado: number | null; contratado: number | null; moneda: string };
    lugar: string | null;
    fechas: { convocatoria: string | null; buenaPro: string | null; contrato: string | null };
    contratistas: { nombre: string | null; ruc: string | null; monto: number | null }[];
    elaboradoPor: string;
  };
  alcance: {
    periodo: { desde: string | null; hasta: string | null };
    antecedentesDesde: string | null;
    corte: string;
    regimen: string;
    registros: string[];
    documentos: { titulo: string; tipo: string | null; fecha: string | null; url: string; copia: string | null }[];
    nota: string;
  };
  observaciones: ObservacionInforme[];
  otrasSenales: { etiqueta: string; severidad: SeveridadInforme; fuente: string }[];
  antecedentesControl: PrecedenteInforme[];
  conclusion: string[];
  recomendaciones: string[];
  fuentes: { texto: string; url: string; tipo: string }[];
  enlaces: { vigia: string; dictamen: string | null; oece: string; conosce: string };
  verificacion: { cifrasRevisadas: number; oracionesQuitadas: number; observacionesConTextoDelModelo: number; observacionesConTextoDeDatos: number };
}

export interface RespuestaInformeControl {
  ocid: string;
  estado: "listo";
  version: number;
  generadoAt: string;
  modelo: string | null;
  costoUsd: number;
  tokens: { entrada: number; salida: number };
  desactualizado?: boolean;
  provisional?: boolean;
  aviso?: string;
  informe: InformeControl;
  markdown: string;
}

export type ResultadoInformeControl =
  | { tipo: "listo"; datos: RespuestaInformeControl }
  | { tipo: "generando"; reintentarEn: number }
  | { tipo: "sin_senales"; detalle: string }
  | { tipo: "tope"; detalle: string; reintentarEn: number }
  /** Sin redactar todavía y sin sesión: redactarlo cuesta, así que se pide con una cuenta (2026-11-18). */
  | { tipo: "requiere_cuenta"; detalle: string; senales: number }
  | { tipo: "error"; detalle: string };

/** Para qué usa Vigía quien crea la cuenta desde el informe (voluntario; PUT /cuentas/me/perfil-uso, migración 388). */
export const PERFILES_USO = ["periodista", "investigador", "control", "ciudadano"] as const;
export type PerfilUso = (typeof PERFILES_USO)[number];
export const esPerfilUso = (v: unknown): v is PerfilUso => typeof v === "string" && (PERFILES_USO as readonly string[]).includes(v);

/**
 * Pide el documento. La primera vez se redacta (unos 20 a 60 segundos): el pedido queda abierto hasta que termina. Si otro
 * pedido lo está redactando, «generando» con cuándo volver a preguntar.
 */
export async function pedirInformeControl(ocid: string, senal?: AbortSignal, token?: string | null): Promise<ResultadoInformeControl> {
  let r: Response;
  try {
    // Con sesión, el token: sólo una cuenta puede hacer que se redacte (lo guardado lo ve cualquiera).
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    r = await fetch(`${API_BASE}/contratos/${encodeURIComponent(ocid)}/informe-control`, { signal: senal, cache: "no-store", headers });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return { tipo: "error", detalle: "No pudimos conectarnos con Vigía. Revisa tu conexión y vuelve a intentarlo." };
  }
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  const detalle = typeof j?.detail === "string" ? j.detail : null;
  if (r.status === 200 && j?.informe) return { tipo: "listo", datos: j as unknown as RespuestaInformeControl };
  if (r.status === 202) return { tipo: "generando", reintentarEn: Number(j?.reintentarEn) || 30 };
  if (r.status === 404 && j?.error === "sin_senales") return { tipo: "sin_senales", detalle: detalle ?? "Este contrato no tiene señales." };
  if (r.status === 401 && j?.error === "requiere_cuenta") {
    return { tipo: "requiere_cuenta", detalle: detalle ?? "Entra con tu cuenta para pedir este informe.", senales: Number(j?.senales) || 0 };
  }
  if (r.status === 429) return { tipo: "tope", detalle: detalle ?? "Se pidieron muchos informes seguidos.", reintentarEn: Number(j?.reintentarEn) || 60 };
  return { tipo: "error", detalle: detalle ?? "No se pudo preparar el informe en este momento." };
}

const NUM2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Soles exactos, al céntimo (un informe para control no redondea): «S/ 1,112,981.43». */
export const solesExactos = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `S/ ${NUM2.format(n)}` : "Sin dato");

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
/** «1 de junio de 2026», como lo escribe el documento. */
export function fechaInforme(iso: string | null | undefined): string {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return "Sin fecha";
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}
