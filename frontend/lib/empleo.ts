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
  /** Con el perfil puesto («Para ti»): por qué calza (las carreras, por su primera variante, y los puestos tuyos que tiene). */
  motivo?: { carreras: string[]; puestos: string[] };
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
  /** El nivel exacto que pide la plaza («Qué estudios piden» de la portada). */
  nivel?: NivelEmpleo;
  /** Los estudios de quien busca: las plazas que piden ese nivel o uno menor («Tus estudios»). */
  tengo?: NivelPersona;
  sueldo?: number;
  exp?: number;
  cierra?: "hoy" | "2dias" | "semana";
  senal?: SenalEmpleo;
  /** El RUC de la entidad que convoca. */
  entidad?: string;
  /**
   * El perfil de la app como filtro («Para ti», 2026-11-08: dejó de ser una página aparte): las carreras (grupos «|»,
   * variantes «;») y los puestos («|»), como en GET /empleo/calce.
   */
  carreras?: string;
  palabras?: string;
  /** «ti»: la lista con tu perfil puesto. Sin carreras ni puestos en la URL, la página los pone al leer tu perfil. */
  para?: "ti";
  /** «calce»: las más afines primero (sólo con el perfil puesto). */
  orden?: "cierre" | "sueldo" | "reciente" | "vacantes" | "calce";
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
/** Los estudios que una persona puede tener (sin «según el perfil», que es de la plaza). */
export type NivelPersona = Exclude<NivelEmpleo, "sin_dato">;
export const NIVELES_PERSONA: NivelPersona[] = ["secundaria", "tecnica", "egresado", "bachiller", "titulo", "posgrado"];

/**
 * Cuántas plazas puede postular quien tiene ese nivel: las que piden el suyo o uno menor (las «según el perfil» no se
 * cuentan: no se sabe qué piden). `porNivel` son los conteos de cada nivel exacto que trae la API.
 */
export function plazasHasta(porNivel: Conteo[], tengo: NivelPersona): number {
  const hasta = NIVELES_PERSONA.slice(0, NIVELES_PERSONA.indexOf(tengo) + 1) as string[];
  return porNivel.filter((c) => hasta.includes(c.clave)).reduce((s, c) => s + c.n, 0);
}

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

/** Casi todo en mayúsculas (como publica SERVIR): el 80 % de las letras, la misma regla de `oracion`. */
function casiMayusculas(t: string): boolean {
  const letras = t.match(/\p{L}/gu) ?? [];
  return letras.length > 0 && letras.filter((c) => c !== c.toLocaleLowerCase("es")).length / letras.length >= 0.8;
}

/**
 * Las siglas y los números romanos que el tipo oración dejaba en minúsculas («Enfermera/o - samu», «Especialista iii»,
 * «procesos cas por suplencia»). Sólo palabras enteras; sólo en lo que llegó en mayúsculas.
 */
const SIGLAS_PUESTO =
  /(?<!\p{L})(cas|samu|ugel|sis|essalud|minsa|ipress|cetpro|rrhh|siaf|siga|seace|osce|oece|oci|pnp|mef|diresa|geresa|diris|cites|tic|ti|sst|pad|uit|sunat|reniec|sunarp|onp|afp|ruc|pcm|ins|inen|insn|i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)(?!\p{L})/giu;

/** El puesto, en tipo oración con sus tildes (SERVIR lo publica en mayúsculas) y sus siglas en mayúsculas. */
export function puesto(t: string | null | undefined): string {
  if (!t) return "Puesto sin nombre";
  const o = oracion(t);
  return casiMayusculas(t) ? o.replace(SIGLAS_PUESTO, (s) => s.toLocaleUpperCase("es")) : o;
}

/**
 * La entidad, con mayúscula inicial en cada palabra y las siglas intactas. Arregla lo que el título natural deja a
 * medias en SERVIR: la inicial después de un punto o un guion pegados («Daniel A.carrión» → «Daniel A. Carrión»,
 * «Público-gerencia» → «Público-Gerencia») o de unas comillas («"red de Salud…» → «"Red de Salud…»), y la región
 * «La Libertad», que el conector «la» dejaba en minúscula.
 */
export function entidadNombre(t: string | null | undefined): string {
  if (!t) return "Entidad sin nombre";
  return tituloNatural(t)
    .replace(/(\p{L})\.(\p{Ll})/gu, (_m, a: string, b: string) => `${a}. ${b.toLocaleUpperCase("es")}`)
    .replace(/(\p{L})-(\p{Ll})/gu, (_m, a: string, b: string) => `${a}-${b.toLocaleUpperCase("es")}`)
    .replace(/(["«“(])(\p{Ll})/gu, (_m, q: string, b: string) => `${q}${b.toLocaleUpperCase("es")}`)
    .replace(/(?<!\p{L})la Libertad(?!\p{L})/gu, "La Libertad");
}
/** La clave de la región como la tabla, aunque la fuente la mande con tilde, en minúsculas o con espacios («Junín »). */
const claveRegion = (c: string) => c.normalize("NFD").replace(/\p{M}/gu, "").trim().toUpperCase();
export const nombreRegion = (clave: string | null | undefined) => (clave ? REGION_NOMBRE[claveRegion(clave)] ?? titulo(clave) : "Sin región");
export const slugRegion = (clave: string) => clave.toLowerCase().replace(/\s+/g, "-");
export const claveDeSlug = (slug: string | undefined) => (slug ? slug.replace(/-/g, " ").toUpperCase() : undefined);

/**
 * «Lima, Jesús María»: la ubicación del aviso («LIMA - JESUS MARIA»), bien escrita. La región sale de su tabla; la
 * provincia o el distrito, en título natural con sus tildes («Carmen de la Legua Reynoso», «Magdalena del Mar»).
 */
export function lugar(ubicacion: string | null | undefined): string {
  if (!ubicacion) return "Sin lugar";
  return ubicacion
    .split(" - ")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const k = p.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
      return REGION_NOMBRE[k] ?? tituloNatural(p).replace(/(?<!\p{L})el Salvador(?!\p{L})/gu, "El Salvador");
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

/** «1 año», «3 años», «6 meses», «No pide»: los años de experiencia general que pide la plaza, cortos. */
export function aniosCorto(anios: number | null | undefined): string | null {
  if (anios == null) return null;
  if (anios === 0) return "No pide";
  if (anios < 1) {
    const m = Math.max(1, Math.round(anios * 12));
    return m === 1 ? "1 mes" : `${m} meses`;
  }
  const n = Number.isInteger(anios) ? anios : Math.round(anios * 10) / 10;
  return n === 1 ? "1 año" : `${n} años`;
}

/** «1 año de experiencia», «3 años de experiencia», «Sin experiencia»: lo que pide la plaza en años de experiencia general. */
export function textoExperiencia(anios: number | null | undefined): string | null {
  const c = aniosCorto(anios);
  if (c == null) return null;
  return c === "No pide" ? "Sin experiencia" : `${c} de experiencia`;
}

/** «Hoy, 2 nov.», «Mañana, 3 nov.», «7 nov., en 5 días», «Cerró el 1 nov.»: el cierre con su fecha, sin repetir «cierra». */
export function cierreConFecha(dias: number | null, fechaFin: string | null | undefined): string {
  if (dias == null || !fechaFin) return "Sin fecha de cierre";
  const f = fechaDia(fechaFin);
  if (dias < 0) return `Cerró el ${f}`;
  if (dias === 0) return `Hoy, ${f}`;
  if (dias === 1) return `Mañana, ${f}`;
  return `${f}, en ${dias} días`;
}

/**
 * El tipo de contrato CAS según lo que dice la convocatoria (su número o su título: «D.LEG 1057 - DETERMINADO (NECESIDAD
 * TRANSITORIA)-004», «… por suplencia»). `temporal` en null cuando el aviso no lo dice: entonces sólo «CAS», sin inventar
 * el plazo (desde la Ley 31131 un CAS también puede ser a plazo indeterminado).
 */
export function tipoContrato(...textos: (string | null | undefined)[]): { texto: string; temporal: boolean | null } {
  const t = textos.filter(Boolean).join(" ").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  if (/INDETERMINADO/.test(t)) return { texto: "CAS a plazo indeterminado", temporal: false };
  if (/SUPLENCIA/.test(t)) return { texto: "CAS por suplencia (temporal)", temporal: true };
  if (/TRANSITORI/.test(t)) return { texto: "CAS por necesidad transitoria (temporal)", temporal: true };
  if (/DETERMINADO|TEMPORAL/.test(t)) return { texto: "CAS a plazo determinado", temporal: true };
  return { texto: "CAS", temporal: null };
}

/**
 * Por dónde llegan hoy las alertas (lib/gobserva-planes: `correoActivo`). Mientras el correo no sale, lo nuevo llega al
 * celular (avisos del navegador) y a la cuenta: no se promete un correo que todavía no se manda.
 */
export const canalAlertas = (correoActivo: boolean) => (correoActivo ? "por correo y en tu celular" : "en tu celular y en tu cuenta");

/** Un requisito que el aviso deja sin contenido y manda a las bases: «Según el perfil del puesto», «Ver bases». */
const REQUISITO_EN_BASES = /^(?:seg[uú]n|ver|de acuerdo (?:a|al|con)|conforme (?:a|al)|indicad[oa]s? en)\b.{0,40}(?:perfil|bases|t[eé]rminos|tdr)/i;
/** Un requisito que dice que no se pide nada: «No aplica», «No requiere», «Ninguno». */
const REQUISITO_NO_PIDE = /^(?:no (?:aplica|requiere|se requiere|indispensable|es (?:necesario|indispensable|requisito)|corresponde)|ning[uú]n[oa]?|n\/a|sin requisitos?)(?![\p{L}])/iu;

/** Qué dice de verdad un requisito del aviso: algo que se puede cumplir, «está en las bases» o «no pide nada». */
export function claseRequisito(t: string): "requisito" | "en_bases" | "no_pide" {
  const s = t.replace(/^[\s•▪●\-–.:;]+/, "").trim();
  if (REQUISITO_EN_BASES.test(s)) return "en_bases";
  if (REQUISITO_NO_PIDE.test(s)) return "no_pide";
  return "requisito";
}

/** «a», «a y b», «a, b y c» (o «a ni b» después de un «no»): una lista corta en una frase. */
export function enumerar(lista: string[], conector: "y" | "ni" = "y"): string {
  if (lista.length <= 1) return lista[0] ?? "";
  return `${lista.slice(0, -1).join(", ")} ${conector} ${lista[lista.length - 1]}`;
}

/** Cuántos filtros de la lista están puestos, sin contar el texto (que se ve en su campo) ni el orden ni la página. */
export function filtrosPuestos(f: FiltrosEmpleo): number {
  return [f.region, f.nivel, f.tengo, f.sueldo, f.exp, f.cierra, f.senal, f.entidad].filter((v) => v != null && v !== "").length;
}

/** Si la búsqueda se puede guardar como alerta: tiene al menos uno de los filtros que una alerta entiende (comun.tsx). */
export function esAlertable(f: FiltrosEmpleo): boolean {
  return !!(f.q || f.region || f.nivel || f.tengo || f.sueldo || f.exp != null || f.cierra || f.senal || f.entidad);
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
  const tengo = uno("tengo") as NivelPersona | undefined;
  const entidad = uno("entidad");
  const cierra = uno("cierra");
  const senal = uno("senal") as SenalEmpleo | undefined;
  const orden = uno("orden");
  const carreras = uno("carreras")?.slice(0, 600);
  const palabras = uno("palabras")?.slice(0, 600);
  const conPerfil = !!(carreras || palabras);
  return {
    carreras,
    palabras,
    para: uno("para") === "ti" ? "ti" : undefined,
    q: q && q.length >= 2 ? q.slice(0, 80) : undefined,
    region: region && /^[a-z-]{3,30}$/.test(region) ? region : undefined,
    nivel: nivel && nivel in NIVEL ? nivel : undefined,
    tengo: tengo && NIVELES_PERSONA.includes(tengo) ? tengo : undefined,
    entidad: entidad && /^\d{11}$/.test(entidad) ? entidad : undefined,
    sueldo: num("sueldo", 100000) || undefined,
    exp: num("exp", 30),
    cierra: cierra === "hoy" || cierra === "2dias" || cierra === "semana" ? cierra : undefined,
    senal: senal && ["pide_experiencia_propia", "pide_poco", "plazo_corto", "ya_hay_locadores", "gestion_saliente"].includes(senal) ? senal : undefined,
    orden: orden === "sueldo" || orden === "reciente" || orden === "vacantes" || (orden === "calce" && conPerfil) ? orden : "cierre",
    page: Math.max(1, Math.min(300, Math.floor(num("page", 300) ?? 1))) || 1,
  };
}

/** «Para ti» de la app: la lista de plazas con tu perfil puesto (antes /app/para-ti, una página aparte). */
export const RUTA_PARA_TI = "/app/plazas?para=ti";
