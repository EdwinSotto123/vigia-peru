import { API_BASE } from "@/lib/api-client";

/**
 * Las prácticas del Estado en la app de Empleo (2026-11-08): las preprofesionales (para estudiantes) y las profesionales
 * (para egresados) que las entidades publican en Talento Perú. La API es GET /empleo/practicas y /empleo/practicas/:id
 * (backend/api/src/routes/empleo.ts, migración 271); el scraper, servir_practicas en el Worker de scrapers.
 */

export type ModalidadPractica = "practica_pre" | "practica_pro";

export const MODALIDAD: Record<string, { corto: string; largo: string; quien: string }> = {
  practica_pre: { corto: "Preprofesionales", largo: "Prácticas preprofesionales", quien: "Para estudiantes" },
  practica_pro: { corto: "Profesionales", largo: "Prácticas profesionales", quien: "Para egresados" },
  otra: { corto: "Prácticas", largo: "Prácticas", quien: "Revisa los requisitos" },
};

export interface Practica {
  id: string;
  titulo: string;
  entidad: string;
  modalidad: ModalidadPractica | "otra";
  tipoModalidad: string | null;
  ubicacion: string | null;
  region: string | null;
  numero: string | null;
  vacantes: number | null;
  subvencion: number | null;
  duracionMeses: number | null;
  jornadaHoras: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  unidadOrganica: string | null;
  requerimientos: string[];
}

export interface FichaPractica extends Practica {
  direccion: string | null;
  actividades: string[];
  conocimientos: string | null;
  beneficios: { horario_ingreso?: string | null; horario_salida?: string | null; texto?: string[] } | null;
  cronograma: { etapa: string; inicio: string | null; fin: string | null }[];
  correo: string | null;
  web: string | null;
  detalleUrl: string | null;
  abierta: boolean;
}

export interface ListaPracticas {
  data: Practica[];
  total: number;
  page: number;
  size: number;
  porModalidad: { clave: string; n: number }[];
  porRegion: { clave: string; n: number }[];
  actualizado: string | null;
}

export interface FiltrosPracticas {
  q?: string;
  region?: string;
  modalidad?: ModalidadPractica;
  page?: number;
}

/** Los filtros de la URL de /app/practicas, sin lo que no vale. */
export function filtrosPracticas(sp: Record<string, string | string[] | undefined> | undefined): FiltrosPracticas {
  const uno = (k: string) => {
    const v = sp?.[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const q = uno("q");
  const region = uno("region");
  const modalidad = uno("modalidad");
  const page = Number(uno("page"));
  return {
    q: q && q.length >= 2 ? q.slice(0, 80) : undefined,
    region: region && /^[a-z-]{3,30}$/.test(region) ? region : undefined,
    modalidad: modalidad === "practica_pre" || modalidad === "practica_pro" ? modalidad : undefined,
    page: Number.isInteger(page) && page > 1 && page <= 200 ? page : undefined,
  };
}

export function qsPracticas(f: FiltrosPracticas, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v != null && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function leer<T>(ruta: string, revalidate = 300): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getPracticas = (f: FiltrosPracticas, size = 20) => leer<ListaPracticas>(`/empleo/practicas${qsPracticas(f, { size })}`);

export const getPractica = (id: string) => (/^[0-9a-f]{16}$/.test(id) ? leer<FichaPractica>(`/empleo/practicas/${id}`) : Promise.resolve(null));

/**
 * Los requerimientos como los publica SERVIR: la condición («Estudiante», «Egresado»), el tipo de carrera («Carrera
 * Universitaria», «Ambos tipos de carreras») y las carreras.
 */
export function leerRequerimientos(xs: string[]): { condicion: string | null; tipoCarrera: string | null; carreras: string[] } {
  let condicion: string | null = null;
  let tipoCarrera: string | null = null;
  const carreras: string[] = [];
  for (const x of xs) {
    if (!condicion && /^(estudiante|egresad|bachiller|titulad)/i.test(x)) condicion = x;
    else if (!tipoCarrera && /carrera|ambos tipos/i.test(x)) tipoCarrera = x;
    else carreras.push(x);
  }
  return { condicion, tipoCarrera, carreras };
}

/** «S/ 1,230 al mes», o «Sin dato» (la entidad no la publicó o la publicó mal). */
export function textoSubvencion(n: number | null): string {
  return n ? `S/ ${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(n)} al mes` : "Sin dato";
}

/** «3 meses, 30 horas a la semana». */
export function textoDuracion(p: Pick<Practica, "duracionMeses" | "jornadaHoras">): string | null {
  const partes = [
    p.duracionMeses ? `${p.duracionMeses} ${p.duracionMeses === 1 ? "mes" : "meses"} de convenio` : null,
    p.jornadaHoras ? `${p.jornadaHoras} horas a la semana` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}
