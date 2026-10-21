/**
 * Planilla (GET /planilla, migración 92): el personal que cada entidad publica en su Portal de Transparencia, con sus
 * señales. Plazas CAS (GET /plazas, migración 93): las convocatorias que publicó en SERVIR Talento Perú, con las suyas.
 * La API ya tapa el apellido materno y a quienes nombran las señales. Las señales son indicios, no pruebas.
 */
import { API_BASE } from "./api-client";
import type { Severidad } from "./personas";

export const TIPOS_PLANILLA = ["tambien_ordenes", "candidato_gobierna", "brecha_cargo", "apellidos_autoridad", "apellidos_directivo", "antes_locador", "pago_extraordinario"] as const;
export type TipoPlanilla = (typeof TIPOS_PLANILLA)[number];
export const TIPOS_PLAZA = ["pide_experiencia_propia", "pide_poco", "plazo_corto", "sueldo_alto", "ya_hay_locadores"] as const;
export type TipoPlaza = (typeof TIPOS_PLAZA)[number];

export interface SenalConDetalle<T extends string> {
  tipo: T;
  severidad: Severidad;
  detalle: Record<string, unknown>;
}

export interface PersonaPlanilla {
  entidadRuc: string;
  entidad: string | null;
  /** Con el apellido materno tapado. */
  nombre: string;
  regimen: number | null;
  cargo: string | null;
  dependencia: string | null;
  /** Lo que cobró el último mes, con todo. */
  total: number | null;
  /** Su sueldo: remuneraciones + honorarios (migración 98). */
  base: number | null;
  /** Fuera del sueldo: otros beneficios, gratificación, incentivo. */
  extra: number | null;
  meses: number;
  primerMes: string | null;
  ultimoMes: string | null;
  senales: SenalConDetalle<TipoPlanilla>[];
  nSenales: number;
  /** Su ficha de persona contratada, si también recibe órdenes de servicio. */
  codigo: string | null;
}

export interface ResumenPlanilla {
  personas: number;
  totalMes: number;
  conSenales: number;
  alta: number;
  media: number;
  ultimoMes: string | null;
  porSenal: { tipo: TipoPlanilla; n: number }[];
  porRegimen: { regimen: number | null; n: number }[];
}

export interface PaginaPlanilla {
  total: number;
  page: number;
  size: number;
  data: PersonaPlanilla[];
  resumen: ResumenPlanilla;
}

export interface Plaza {
  aviso: number;
  titulo: string;
  entidad: string;
  entidadRuc: string | null;
  ubicacion: string | null;
  numero: string | null;
  vacantes: number | null;
  remuneracion: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  experiencia: string | null;
  formacion: string | null;
  especializacion: string | null;
  conocimiento: string | null;
  servicio: string | null;
  expGeneral: number | null;
  detalleUrl: string | null;
  senales: SenalConDetalle<TipoPlaza>[];
  nSenales: number;
}

export interface ResumenPlazas {
  plazas: number;
  vacantes: number;
  conSenales: number;
  medianaSueldo: number | null;
  desde: string | null;
  porSenal: { tipo: TipoPlaza; n: number }[];
}

export interface PaginaPlazas {
  total: number;
  page: number;
  size: number;
  data: Plaza[];
  resumen: ResumenPlazas;
}

export const REGIMEN: Record<number, string> = {
  1: "CAS", 2: "Régimen 276", 3: "Régimen 728 y otros", 4: "PAC", 5: "FAG", 6: "PNUD", 7: "Alto funcionario", 9: "Ley Servir",
};

export const SENAL_PLANILLA: Record<TipoPlanilla, { corto: string; titulo: string; explica: string }> = {
  tambien_ordenes: {
    corto: "Cobra también por órdenes",
    titulo: "Está en la planilla y además recibe órdenes de servicio",
    explica: "El mismo mes en que figura en la planilla, la misma entidad le dio órdenes de servicio. Cobrar dos veces del Estado está prohibido, salvo por docencia.",
  },
  candidato_gobierna: {
    corto: "Candidato del que gobierna",
    titulo: "Fue candidato del partido que gobierna la entidad",
    explica: "Postuló (JNE) por el partido que gobierna la entidad. Coincide por nombre completo y departamento: la planilla no trae DNI.",
  },
  brecha_cargo: {
    corto: "Gana el doble que su cargo",
    titulo: "Gana el doble o más que otros con su mismo cargo",
    explica: "Su sueldo (sin gratificaciones, liquidaciones ni otros beneficios del mes) es el doble o más que la mediana de quienes tienen su mismo cargo en la misma entidad.",
  },
  pago_extraordinario: {
    corto: "Pago extraordinario",
    titulo: "Recibió un pago grande fuera de su sueldo",
    explica:
      "Ese mes cobró S/ 20,000 o más en otros beneficios, gratificación o incentivo, el triple de su sueldo o más: suele ser una liquidación, un retiro incentivado o un bono. No es irregular por sí mismo.",
  },
  apellidos_autoridad: {
    corto: "Apellidos de una autoridad",
    titulo: "Tiene los dos apellidos de una autoridad de la entidad",
    explica: "Sus dos apellidos son los del alcalde, un regidor, el gobernador o un consejero del gobierno de la entidad. No prueba parentesco.",
  },
  apellidos_directivo: {
    corto: "Apellidos de un directivo",
    titulo: "Tiene los dos apellidos de un directivo de la misma planilla",
    explica: "Sus dos apellidos, poco comunes, son los de un gerente, director o jefe de la misma entidad. No prueba parentesco.",
  },
  antes_locador: {
    corto: "Antes fue locador",
    titulo: "Antes de entrar a la planilla fue locador de la entidad",
    explica: "Recibió órdenes de servicio de la misma entidad antes de aparecer en su planilla.",
  },
};

export const SENAL_PLAZA: Record<TipoPlaza, { corto: string; titulo: string; explica: string }> = {
  pide_experiencia_propia: {
    corto: "Pide experiencia en la entidad",
    titulo: "Pide experiencia en la misma entidad que convoca",
    explica: "Sólo la tiene quien ya trabaja ahí: es una forma de hacer la plaza a la medida de alguien.",
  },
  pide_poco: {
    corto: "Paga mucho, pide poco",
    titulo: "Paga S/ 6,000 o más y pide muy poco",
    explica: "Pide menos de un año de experiencia o ningún grado académico para un sueldo alto.",
  },
  plazo_corto: {
    corto: "Plazo corto",
    titulo: "Estuvo publicada 3 días o menos",
    explica: "Con tan poco tiempo, casi nadie de afuera se entera ni alcanza a postular.",
  },
  sueldo_alto: {
    corto: "Sueldo alto",
    titulo: "Paga el doble o más que plazas parecidas",
    explica: "Ofrece el doble o más que la mediana de las plazas del mismo tipo de servicio en todo el país.",
  },
  ya_hay_locadores: {
    corto: "Ya hay locadores",
    titulo: "La entidad ya pagaba ese servicio por órdenes",
    explica: "En los 12 meses antes, la entidad pagó por órdenes de servicio el mismo tipo de trabajo a una, dos o tres personas: la plaza puede ser para quien ya lo hacía.",
  },
};

async function leer<T>(ruta: string, revalidate = 600): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const qs = (f: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return p.toString();
};

export const getPlanilla = (f: { entidad?: string; dep?: string; senal?: string; regimen?: number; severidad?: string; orden?: string; page?: number; size?: number }) =>
  leer<PaginaPlanilla>(`/planilla?${qs(f)}`);

export const getPlazas = (f: { entidad?: string; dep?: string; senal?: string; severidad?: string; orden?: string; page?: number; size?: number }) =>
  leer<PaginaPlazas>(`/plazas?${qs(f)}`);
