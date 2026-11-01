import { API_BASE } from "@/lib/api-client";
import { oracion } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";

/**
 * Gobserva Empleo (empleo.gobserva.cloud, 2026-11-01): tipos, nombres y lectores de GET /empleo/* (backend
 * routes/empleo.ts). La ficha de una plaza es GET /plazas/:aviso (lib/planilla.ts → getFichaPlaza).
 *
 * La región llega de la API como su nombre en mayúsculas y sin tildes («LA LIBERTAD»); en la URL va en minúsculas con
 * guiones («la-libertad»). El nivel de estudios es el MÁS BAJO que acepta la plaza (lo lee la API de su formación).
 */

export type NivelEmpleo = "secundaria" | "tecnica" | "egresado" | "bachiller" | "titulo" | "posgrado" | "sin_dato";
export type SenalEmpleo = "pide_experiencia_propia" | "pide_poco" | "plazo_corto" | "ya_hay_locadores" | "gestion_saliente";

export interface PlazaEmpleo {
  aviso: number;
  titulo: string;
  entidad: string;
  entidadRuc: string | null;
  ubicacion: string | null;
  region: string | null;
  nivel: NivelEmpleo;
  vacantes: number | null;
  remuneracion: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  expGeneral: number | null;
  formacion: string | null;
  colegiatura: boolean;
  tipos: SenalEmpleo[];
  nSenales: number;
}

export interface Conteo {
  clave: string;
  n: number;
  vacantes?: number;
  mediana?: number | null;
}

export interface ResumenEmpleo {
  abiertas: number;
  vacantes: number;
  medianaSueldo: number | null;
  cierranHoy: number;
  cierran2dias: number;
  cierranSemana: number;
  nuevas: number;
  hasta1Anio: number;
  mas5000: number;
  sinUniversidad: number;
  conSenales: number;
  entidades: number;
  porRegion: Conteo[];
  porNivel: Conteo[];
  porSenal: { tipo: SenalEmpleo; n: number }[];
  entidadesTop: { entidad: string; ruc: string | null; n: number; vacantes: number }[];
  cierranPronto: PlazaEmpleo[];
  mejorPagadas: PlazaEmpleo[];
  actualizado: string | null;
}

export interface ListaEmpleo {
  total: number;
  page: number;
  size: number;
  vacantes: number;
  medianaSueldo: number | null;
  facetas: { region: Conteo[]; nivel: Conteo[] };
  data: PlazaEmpleo[];
}

/** Los filtros de /plazas (los mismos nombres en la URL y en la API). */
export interface FiltrosEmpleo {
  q?: string;
  region?: string;
  nivel?: NivelEmpleo;
  sueldo?: number;
  exp?: number;
  cierra?: "hoy" | "2dias" | "semana";
  senal?: SenalEmpleo;
  orden?: "cierre" | "sueldo" | "reciente" | "vacantes";
  page?: number;
}

export const NIVEL: Record<NivelEmpleo, { corto: string; largo: string }> = {
  secundaria: { corto: "Secundaria", largo: "Secundaria completa" },
  tecnica: { corto: "Técnica", largo: "Estudios técnicos" },
  egresado: { corto: "Egresado", largo: "Egresado o estudiante universitario" },
  bachiller: { corto: "Bachiller", largo: "Bachiller universitario" },
  titulo: { corto: "Título", largo: "Título profesional" },
  posgrado: { corto: "Posgrado", largo: "Maestría o doctorado" },
  sin_dato: { corto: "Según el perfil", largo: "Según el perfil del puesto" },
};
export const NIVELES_ORDEN: NivelEmpleo[] = ["secundaria", "tecnica", "egresado", "bachiller", "titulo", "posgrado", "sin_dato"];

/** Los 25 departamentos (y el Callao) como los nombra la API, con su nombre bien escrito. */
const REGION_NOMBRE: Record<string, string> = {
  AMAZONAS: "Amazonas",
  ANCASH: "Áncash",
  APURIMAC: "Apurímac",
  AREQUIPA: "Arequipa",
  AYACUCHO: "Ayacucho",
  CAJAMARCA: "Cajamarca",
  CALLAO: "Callao",
  CUSCO: "Cusco",
  HUANCAVELICA: "Huancavelica",
  HUANUCO: "Huánuco",
  ICA: "Ica",
  JUNIN: "Junín",
  "LA LIBERTAD": "La Libertad",
  LAMBAYEQUE: "Lambayeque",
  LIMA: "Lima",
  LORETO: "Loreto",
  "MADRE DE DIOS": "Madre de Dios",
  MOQUEGUA: "Moquegua",
  PASCO: "Pasco",
  PIURA: "Piura",
  PUNO: "Puno",
  "SAN MARTIN": "San Martín",
  TACNA: "Tacna",
  TUMBES: "Tumbes",
  UCAYALI: "Ucayali",
};
export const REGIONES_EMPLEO = Object.keys(REGION_NOMBRE);

const titulo = (t: string) => t.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());

/** El puesto, en tipo oración con sus tildes (SERVIR lo publica en mayúsculas). */
export const puesto = (t: string | null | undefined) => (t ? oracion(t) : "Puesto sin nombre");
/** La entidad, con mayúscula inicial en cada palabra y las siglas intactas. */
export const entidadNombre = (t: string | null | undefined) => (t ? tituloNatural(t) : "Entidad sin nombre");
export const nombreRegion = (clave: string | null | undefined) => (clave ? REGION_NOMBRE[clave] ?? titulo(clave) : "Sin región");
export const slugRegion = (clave: string) => clave.toLowerCase().replace(/\s+/g, "-");
export const claveDeSlug = (slug: string | undefined) => (slug ? slug.replace(/-/g, " ").toUpperCase() : undefined);

/** «Lima - San Isidro»: la ubicación del aviso, bien escrita. */
export function lugar(ubicacion: string | null | undefined): string {
  if (!ubicacion) return "Sin lugar";
  return ubicacion
    .split(" - ")
    .map((p) => {
      const k = p.trim().normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
      return REGION_NOMBRE[k] ?? titulo(p.trim());
    })
    .join(", ");
}

/** Hoy en Lima, «YYYY-MM-DD». */
export function hoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Días que faltan para el cierre (0 = cierra hoy; negativo = ya cerró). */
export function diasParaCierre(fechaFin: string | null | undefined): number | null {
  if (!fechaFin) return null;
  const a = Date.parse(`${hoyLima()}T00:00:00Z`);
  const b = Date.parse(`${fechaFin}T00:00:00Z`);
  return Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

export function textoCierre(dias: number | null): string {
  if (dias == null) return "Sin fecha de cierre";
  if (dias < 0) return "Ya cerró";
  if (dias === 0) return "Cierra hoy";
  if (dias === 1) return "Cierra mañana";
  return `Cierra en ${dias} días`;
}

/** «12 nov.»: una fecha del calendario (YYYY-MM-DD), sin correrla por la zona horaria. */
export function fechaDia(iso: string | null | undefined): string {
  if (!iso) return "Sin fecha";
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", timeZone: "UTC" }).format(d).toLowerCase();
}

/** «Hasta 1 año», «3 años», «Sin experiencia»: lo que pide la plaza en años de experiencia general. */
export function textoExperiencia(anios: number | null | undefined): string | null {
  if (anios == null) return null;
  if (anios === 0) return "Sin experiencia";
  if (anios < 1) return `${Math.round(anios * 12)} meses de experiencia`;
  const n = Number.isInteger(anios) ? anios : Math.round(anios * 10) / 10;
  return n === 1 ? "1 año de experiencia" : `${n} años de experiencia`;
}

/** La consulta de /plazas (sin vacíos), para la URL y para la API. */
export function qsEmpleo(f: FiltrosEmpleo, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v != null && v !== "" && !(k === "page" && v === 1) && !(k === "orden" && v === "cierre")) p.set(k, String(v));
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

export const getResumenEmpleo = () => leer<ResumenEmpleo>("/empleo/resumen");

export function getPlazasEmpleo(f: FiltrosEmpleo, size = 12) {
  return leer<ListaEmpleo>(`/empleo/plazas${qsEmpleo({ ...f, orden: f.orden ?? "cierre" }, { size, orden: f.orden ?? "cierre" })}`);
}

/** Lee los filtros de la URL de /plazas, descartando lo que no es válido. */
export function filtrosDeUrl(sp: Record<string, string | string[] | undefined> | undefined): FiltrosEmpleo {
  const uno = (k: string) => {
    const v = sp?.[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const num = (k: string, max: number) => {
    const v = Number(uno(k));
    return Number.isFinite(v) && v >= 0 && v <= max ? v : undefined;
  };
  const q = uno("q");
  const region = uno("region");
  const nivel = uno("nivel") as NivelEmpleo | undefined;
  const cierra = uno("cierra");
  const senal = uno("senal") as SenalEmpleo | undefined;
  const orden = uno("orden");
  return {
    q: q && q.length >= 2 ? q.slice(0, 80) : undefined,
    region: region && /^[a-z-]{3,30}$/.test(region) ? region : undefined,
    nivel: nivel && nivel in NIVEL ? nivel : undefined,
    sueldo: num("sueldo", 100000) || undefined,
    exp: num("exp", 30),
    cierra: cierra === "hoy" || cierra === "2dias" || cierra === "semana" ? cierra : undefined,
    senal: senal && ["pide_experiencia_propia", "pide_poco", "plazo_corto", "ya_hay_locadores", "gestion_saliente"].includes(senal) ? senal : undefined,
    orden: orden === "sueldo" || orden === "reciente" || orden === "vacantes" ? orden : "cierre",
    page: Math.max(1, Math.min(300, Math.floor(num("page", 300) ?? 1))) || 1,
  };
}
