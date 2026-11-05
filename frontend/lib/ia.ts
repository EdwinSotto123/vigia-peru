import { API_BASE } from "./api-client";

/**
 * Lo que leyó la IA (GET /ia/resumen, backend/api/src/routes/ia.ts): las cifras y los ejemplos de la página /app/ia. Tres
 * cosas distintas que antes sólo se veían sueltas en cada ficha:
 *   · los dictámenes: el análisis de varios agentes de un proceso, con su puntaje y sus señales;
 *   · los documentos de los procesos (bases, consultas, acta de buena pro, contrato) leídos con Claude Haiku;
 *   · los de los contratos menores (el requerimiento y el contrato u orden).
 * Los nombres de personas ya vienen tapados y los ejemplos no traen al proveedor.
 */

export type Severidad = "alta" | "media" | "baja";

export interface ClaseLeida<C extends string = string> {
  clase: C;
  /** Documentos distintos (uno por contrato y clase). */
  documentos: number;
  /** Lecturas: la primera más las que la confirman (una segunda y, en las marcas de un requerimiento, una tercera). */
  lecturas: number;
  /** Contratos con algún hallazgo publicado de este documento; null si este documento no da hallazgos (el contrato firmado). */
  conHallazgo: number | null;
  ultima: string | null;
}

export interface DictamenEjemplo {
  /** El código corto del proceso: abre su dictamen con rutaContrato(convocatoria, "dictamen"). */
  convocatoria: string | null;
  objeto: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  score: number | null;
  region: string | null;
  monto: number | null;
  fecha: string | null;
  senales: number;
  /** Sus tres señales más graves. */
  principales: { regla: string; severidad: Severidad; etiqueta: string }[];
}

export interface ProcesoEjemplo {
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  monto: number | null;
  fecha: string | null;
  hallazgos: { tipo: string; severidad: Severidad; etiqueta: string }[];
}

export interface MenorEjemplo {
  id: number;
  codigo: string | null;
  descripcion: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  monto: number | null;
  moneda: string | null;
  fecha: string | null;
  /** Su señal más grave (por ella se eligió el ejemplo) y todas las de lectura que tiene. */
  tipo: string;
  severidad: Severidad;
  tipos: string[];
}

export type ClaseProceso = "bases" | "consultas" | "buena_pro" | "contrato";
export type ClaseMenor = "menor_tdr" | "menor_contrato";

export interface ResumenIa {
  generado: string;
  ultimaLectura: string | null;
  modelos: string[];
  totales: { documentos: number; contratos: number; lecturas: number; costoUsd: number };
  dictamenes: {
    publicados: number;
    enRevision: number;
    /** Publicados con puntaje de 60 o más. */
    fuertes: number;
    tramos: { alto: number; medio: number; bajo: number; sinSenales: number };
    ultima: string | null;
    ejemplos: DictamenEjemplo[];
  };
  procesos: {
    documentos: number;
    contratos: number;
    lecturas: number;
    conHallazgo: number;
    clases: ClaseLeida<ClaseProceso>[];
    hallazgos: { tipo: string; severidad: Severidad; etiqueta: string; procesos: number }[];
    ejemplos: ProcesoEjemplo[];
  };
  menores: {
    documentos: number;
    contratos: number;
    lecturas: number;
    conHallazgo: number;
    clases: ClaseLeida<ClaseMenor>[];
    hallazgos: { tipo: string; severidad: Severidad; contratos: number }[];
    ejemplos: MenorEjemplo[];
  };
}

/** Cambia por tandas: una hora en la caché de Next, como la de la API. Null si la API no respondió. */
export async function getResumenIa(): Promise<ResumenIa | null> {
  try {
    const r = await fetch(`${API_BASE}/ia/resumen`, { next: { revalidate: 3600 } } as RequestInit);
    return r.ok ? ((await r.json()) as ResumenIa) : null;
  } catch {
    return null;
  }
}

/** El nombre de cada documento, en plural y en el orden en que pasan en una contratación. */
export const NOMBRE_CLASE: Record<ClaseProceso | ClaseMenor, { nombre: string; que: string }> = {
  bases: { nombre: "Bases", que: "Lo que se exigió para competir: requisitos, experiencia, marcas." },
  consultas: { nombre: "Consultas y observaciones", que: "Lo que reclamaron los participantes y qué respondió la entidad." },
  buena_pro: { nombre: "Actas de buena pro", que: "Cada postor, si quedó fuera, por qué y cuánto ofreció." },
  contrato: { nombre: "Contratos firmados", que: "Monto, plazo, garantía, adelantos y penalidades." },
  menor_tdr: { nombre: "Requerimientos", que: "Qué se pidió, a quién se exige qué, las marcas y si nombra a quién contratar." },
  menor_contrato: { nombre: "Contratos u órdenes", que: "El número, el monto, el RUC y los ítems con su precio." },
};
