/**
 * Personas contratadas (GET /personas*, migración 91): quienes reciben órdenes de servicio del Estado como personas
 * naturales (locadores, asesores, choferes…) y lo que otros registros públicos dicen de ellas en cada entidad.
 *
 * La API ya tapa lo personal (docs/PRIVACIDAD.md): el RUC 10 llega como `10·ref·…` y un apellido como `•••`; la ficha
 * se pide por un código al azar, nunca por RUC ni DNI. Las señales son indicios para revisar, no pruebas.
 *
 * Los GET devuelven `null` si la API no responde: quien llama no dibuja lo que no pudo leer.
 */
import { API_BASE } from "./api-client";

export type Severidad = "alta" | "media" | "baja";

export interface SenalResumen {
  tipo: TipoSenal;
  severidad: Severidad;
}

export interface GobiernoPersona {
  clave: string;
  nombre: string;
  anio: number;
}

/** Una persona en una entidad: lo que le pagó y sus señales. */
export interface PersonaEntidad {
  codigo: string;
  /** `10·ref·…` (nunca el RUC). */
  ruc: string;
  /** Con un apellido tapado (`•••`), salvo si es autoridad electa. */
  nombre: string | null;
  entidad: string | null;
  entidadRuc: string;
  dep: string | null;
  servicio: string | null;
  ordenes: number;
  /** Meses distintos con al menos una orden (sumados por año). */
  meses: number;
  monto: number;
  primera: string | null;
  ultima: string | null;
  anios: number[];
  senales: SenalResumen[];
  nSenales: number;
  gobiernos: GobiernoPersona[];
}

export interface ResumenPersonas {
  filas: number;
  personas: number;
  monto: number;
  ordenes: number;
  conSenales: number;
  alta: number;
  media: number;
  baja: number;
  porSenal: { tipo: TipoSenal; n: number }[];
  porServicio: { servicio: string; n: number; monto: number }[];
  porAnio: { anio: number; n: number }[];
}

export interface PaginaPersonas {
  total: number;
  page: number;
  size: number;
  data: PersonaEntidad[];
  /** Del alcance (entidad, región o partido), sin los demás filtros: las cifras y los conteos de los filtros. */
  resumen: ResumenPersonas;
}

export interface SenalDetalle {
  tipo: TipoSenal;
  severidad: Severidad;
  detalle: Record<string, unknown>;
  fuente: string | null;
  fuenteUrl: string | null;
}

export interface EntidadDePersona extends PersonaEntidad {
  depNombre: string | null;
  senalesDetalle: SenalDetalle[];
}

export interface ReferenciaPago {
  personas: number;
  mediana: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
}

export interface AnioDePersona {
  entidadRuc: string;
  entidad: string | null;
  anio: number;
  servicio: string | null;
  ordenes: number;
  meses: number;
  monto: number;
  porMes: number | null;
  /** ¿Es el trabajo de una persona? (si no, alquiler, comida… no se compara por mes). */
  personal: boolean;
  enLaEntidad: ReferenciaPago | null;
  enElPais: ReferenciaPago | null;
}

export interface FichaPersona {
  persona: {
    codigo: string;
    ruc: string;
    nombre: string | null;
    entidades: number;
    ordenes: number;
    monto: number;
    meses: number;
    primera: string | null;
    ultima: string | null;
    nSenales: number;
  };
  entidades: EntidadDePersona[];
  anual: AnioDePersona[];
}

export interface OrdenPersona {
  fecha: string;
  entidad: string | null;
  entidadRuc: string;
  numero: string | null;
  orden: string | null;
  descripcion: string | null;
  /** null si el monto es dudoso (migración 98). */
  monto: number | null;
  /** El monto que trae CONOSCE cuando no se puede creer (20 veces el tope de su modalidad…): se muestra, no se suma. */
  montoDudoso: number | null;
  /** Por qué no se puede creer (migración 102): `MOTIVO_DUDOSO` de lib/datoDudoso. */
  dudosoMotivo: string | null;
  /** Cómo se contrató, tal como lo escribe CONOSCE ("Contrataciones hasta 8 UIT…", "Deviene de Procesos de Selección"). */
  tipoContratacion: string | null;
  estado: string | null;
  servicio: string | null;
}

/**
 * Cómo se contrató una orden, en corto, y si detrás hubo una convocatoria pública. Las órdenes de hasta 8 UIT y las
 * demás "sin proceso de selección" no tienen convocatoria: la ley las permite sin concurso y la entidad no publica ni
 * la convocatoria ni sus términos de referencia. Las que "devienen de procesos de selección" sí: su convocatoria está en
 * el SEACE (la orden no trae su código).
 */
export function tipoContratacion(t: string | null | undefined): { corto: string; convocatoria: string } | null {
  if (!t) return null;
  const uit = /hasta (\d+) UIT/i.exec(t);
  if (uit) return { corto: `Hasta ${uit[1]} UIT, sin concurso`, convocatoria: "No tuvo convocatoria: la ley permite contratar hasta ese monto sin proceso de selección, y la entidad no publica una convocatoria ni sus términos de referencia." };
  if (/sin proceso de selecci/i.test(t)) return { corto: "Sin proceso de selección", convocatoria: "No tuvo convocatoria: es una contratación sin proceso de selección previo." };
  if (/procesos de selecci/i.test(t)) return { corto: "De un proceso de selección", convocatoria: "Viene de un proceso de selección con convocatoria pública en el SEACE. La orden no trae el código del proceso." };
  if (/exoneraci|directa/i.test(t)) return { corto: "Contratación directa", convocatoria: "Viene de una contratación directa: sin concurso, con su sustento publicado en el SEACE." };
  if (/cat[aá]logo/i.test(t)) return { corto: "Catálogo electrónico", convocatoria: "Viene de los catálogos electrónicos de Perú Compras, sin convocatoria propia." };
  if (/servicio p[uú]blico/i.test(t)) return { corto: "Servicio público", convocatoria: "Es el pago de un servicio público (agua, luz, teléfono): no tiene convocatoria." };
  if (/convenio/i.test(t)) return { corto: "Convenio entre entidades", convocatoria: "Viene de un convenio entre entidades del Estado: no tiene convocatoria." };
  if (/r[eé]gimen|especial/i.test(t)) return { corto: "Régimen especial", convocatoria: "Viene de un régimen especial de contratación." };
  if (/urgencia/i.test(t)) return { corto: "Decreto de urgencia", convocatoria: "Viene de una contratación por decreto de urgencia." };
  return { corto: t, convocatoria: "" };
}

export interface OrdenesPersona {
  total: number;
  page: number;
  size: number;
  data: OrdenPersona[];
}

// ─── Señales ───────────────────────────────────────────────────────────────────────────────────

export const TIPOS_SENAL = [
  "candidato_gobierna", "autoridad_contratada", "inhabilitado", "aporte_gobierna", "apellidos_autoridad", "apellidos_funcionario",
  "funcionario_contratado", "meses_seguidos", "pago_alto", "candidato", "aporte", "visita_previa", "tambien_planilla", "paso_a_planilla",
] as const;
export type TipoSenal = (typeof TIPOS_SENAL)[number];

/**
 * Cómo se nombra cada señal: `corto` en un chip, `titulo` en la ficha y `explica` para quien no sabe qué es. Ninguna
 * acusa: dicen qué registro coincide.
 */
export const SENAL: Record<TipoSenal, { corto: string; titulo: string; explica: string }> = {
  candidato_gobierna: {
    corto: "Candidato del que gobierna",
    titulo: "Fue candidato del partido que gobernaba la entidad",
    explica: "Postuló (JNE) por el partido que gobernaba la entidad cuando le dieron las órdenes.",
  },
  autoridad_contratada: {
    corto: "Autoridad electa",
    titulo: "Es autoridad electa y recibió órdenes",
    explica:
      "Es alcalde, regidor, gobernador o consejero regional en funciones (JNE). Si es de la misma municipalidad, la ley le prohíbe ejercer cargos en ella (Ley Orgánica de Municipalidades, art. 11).",
  },
  inhabilitado: {
    corto: "Inhabilitado",
    titulo: "Recibió órdenes estando inhabilitado",
    explica: "El Tribunal de Contrataciones del Estado lo tenía inhabilitado para contratar con el Estado cuando se emitieron esas órdenes.",
  },
  aporte_gobierna: {
    corto: "Aportó al que gobierna",
    titulo: "Aportó al partido que gobernaba la entidad",
    explica: "Figura en la ONPE como aportante del partido que gobernaba la entidad que lo contrató.",
  },
  apellidos_autoridad: {
    corto: "Apellidos de una autoridad",
    titulo: "Tiene los dos apellidos de una autoridad de la entidad",
    explica:
      "Sus dos apellidos son los del alcalde, un regidor, el gobernador o un consejero del gobierno que lo contrató. No prueba parentesco: es un dato para revisar.",
  },
  apellidos_funcionario: {
    corto: "Apellidos de un funcionario",
    titulo: "Tiene los dos apellidos de un funcionario de la entidad",
    explica:
      "Sus dos apellidos, poco comunes, son los de alguien que declaró trabajar en la misma entidad (declaración jurada de intereses). No prueba parentesco.",
  },
  funcionario_contratado: {
    corto: "Trabaja en la entidad",
    titulo: "Declaró trabajar en la misma entidad",
    explica: "En su declaración jurada de intereses dijo trabajar en la entidad el mismo año en que ella le dio órdenes de servicio.",
  },
  meses_seguidos: {
    corto: "Casi todos los meses",
    titulo: "Recibió órdenes casi todos los meses",
    explica:
      "Tuvo órdenes de la misma entidad en 10 meses o más de un mismo año: un puesto permanente pagado como locación de servicios, sin concurso ni beneficios.",
  },
  pago_alto: {
    corto: "Cobra mucho más",
    titulo: "Cobra mucho más que otros por lo mismo",
    explica:
      "Por mes cobró 2,5 veces o más lo que la misma entidad paga, en la mediana, a quienes hacen el mismo tipo de servicio, y más de S/ 6,000, con órdenes en dos meses o más.",
  },
  candidato: {
    corto: "Fue candidato",
    titulo: "Fue candidato de otro partido",
    explica: "Postuló (JNE) por un partido que no es el que gobernaba la entidad.",
  },
  aporte: {
    corto: "Aportó a un partido",
    titulo: "Aportó a otro partido",
    explica: "Figura en la ONPE como aportante de un partido que no es el que gobernaba la entidad.",
  },
  visita_previa: {
    corto: "Visitó antes",
    titulo: "Visitó la entidad antes de ser contratado",
    explica: "El registro de visitas lo muestra en la entidad en los 180 días antes de su primera orden del año.",
  },
  tambien_planilla: {
    corto: "También en planilla",
    titulo: "Recibió órdenes el mismo mes en que figura en la planilla",
    explica:
      "La entidad le dio órdenes de servicio en meses en que también figura en su planilla (Portal de Transparencia): cobra por los dos lados. Coincide por el nombre completo dentro de la misma entidad.",
  },
  paso_a_planilla: {
    corto: "Pasó a planilla",
    titulo: "Después de sus órdenes entró a la planilla de la entidad",
    explica:
      "Primero recibió órdenes de servicio y después apareció en la planilla de la misma entidad, en un mes en que esta ya publicaba su planilla. Es común al pasar de locador a CAS: es un dato, no una falta.",
  },
};

export const SEVERIDAD_TEXTO: Record<Severidad, string> = { alta: "Grave", media: "Para revisar", baja: "Dato" };

/** Las fuentes de cada señal, para el pie. */
export const FUENTE_TEXTO: Record<string, string> = {
  jne_candidaturas: "JNE, candidaturas",
  jne_autoridades: "JNE, autoridades electas",
  onpe_aportantes: "ONPE, aportes a partidos",
  dji_contraloria: "Contraloría, declaraciones juradas de intereses",
  osce_sancionados: "Tribunal de Contrataciones del Estado, sancionados",
  conosce_ordenes: "OECE, CONOSCE: órdenes de compra y de servicio",
  pte_personal: "Portal de Transparencia Estándar, personal",
  visitas_entidades: "Registro de visitas a entidades",
};

// ─── Parámetros de la lista ─────────────────────────────────────────────────────────────────────

/** Nombres de los filtros en la URL. Dentro de otra ficha (entidad, partido) van con `p` delante: no chocan con los suyos. */
export interface ParamsPersonas {
  senal: string;
  severidad: string;
  servicio: string;
  anio: string;
  orden: string;
  page: string;
  /** El buscador: la entidad y el tipo de servicio (nunca el nombre de la persona). */
  q: string;
}
export const PARAMS_SOLOS: ParamsPersonas = { senal: "senal", severidad: "severidad", servicio: "servicio", anio: "anio", orden: "orden", page: "page", q: "q" };
export const PARAMS_EN_FICHA: ParamsPersonas = { senal: "psenal", severidad: "psev", servicio: "pservicio", anio: "panio", orden: "pord", page: "ppag", q: "pq" };

export const ORDENES_PERSONAS = [
  { valor: "senales", etiqueta: "Más señales" },
  { valor: "monto", etiqueta: "Mayor monto" },
  { valor: "meses", etiqueta: "Más meses" },
  { valor: "ordenes", etiqueta: "Más órdenes" },
  { valor: "reciente", etiqueta: "Más recientes" },
] as const;

export interface FiltrosPersonas {
  entidad?: string;
  dep?: string;
  partido?: string;
  periodo?: number;
  senal?: string;
  severidad?: string;
  servicio?: string;
  anio?: number;
  orden?: string;
  q?: string;
  page?: number;
  size?: number;
}

type Busqueda = Record<string, string | string[] | undefined> | undefined;
const uno = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Lee de la URL los filtros de la lista (con los nombres de `P`), validados como la API. */
export function filtrosDeUrl(sp: Busqueda, P: ParamsPersonas): FiltrosPersonas {
  const senal = uno(sp?.[P.senal]);
  const sev = uno(sp?.[P.severidad]);
  const anio = Number(uno(sp?.[P.anio]));
  const orden = uno(sp?.[P.orden]);
  const q = uno(sp?.[P.q])?.slice(0, 80);
  return {
    senal: senal && (TIPOS_SENAL as readonly string[]).includes(senal) ? senal : undefined,
    severidad: sev && ["alta", "media", "baja", "con", "sin"].includes(sev) ? sev : undefined,
    servicio: uno(sp?.[P.servicio])?.slice(0, 60),
    anio: anio >= 2018 && anio <= 2100 ? anio : undefined,
    orden: orden && ORDENES_PERSONAS.some((o) => o.valor === orden) ? orden : undefined,
    q: q && q.length >= 2 ? q : undefined,
    page: Math.max(1, Number(uno(sp?.[P.page])) || 1),
  };
}

/** Los mismos filtros como parámetros de URL de la lista (para `Listado` y la paginación). */
export function parametrosDe(f: FiltrosPersonas, P: ParamsPersonas): Record<string, string | undefined> {
  return {
    [P.senal]: f.senal,
    [P.severidad]: f.severidad,
    [P.servicio]: f.servicio,
    [P.anio]: f.anio ? String(f.anio) : undefined,
    [P.orden]: f.orden,
    [P.q]: f.q,
  };
}

async function leer<T>(ruta: string, revalidate = 600): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export function getPersonas(f: FiltrosPersonas): Promise<PaginaPersonas | null> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return leer<PaginaPersonas>(`/personas?${p.toString()}`);
}

export const getFichaPersona = (codigo: string) =>
  /^[0-9a-f]{12}$/.test(codigo) ? leer<FichaPersona>(`/personas/${codigo}`) : Promise.resolve(null);

export function getOrdenesPersona(codigo: string, f: { entidad?: string; anio?: number; q?: string; page?: number; size?: number }) {
  if (!/^[0-9a-f]{12}$/.test(codigo)) return Promise.resolve(null);
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return leer<OrdenesPersona>(`/personas/${codigo}/ordenes?${p.toString()}`);
}

export const rutaPersona = (codigo: string, seccion?: string) => `/app/personas/${codigo}${seccion ? `?seccion=${seccion}` : ""}`;
