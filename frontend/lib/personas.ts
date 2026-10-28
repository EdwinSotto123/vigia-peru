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
import { esAnioGobierno } from "./partidosApi";
import { uno } from "@/lib/utils";
import type { BanderaFicha } from "@/components/patrones/BanderasFicha";

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
  /** En el país o una entidad: órdenes con un monto que puede ser un error de CONOSCE (aparte del total). */
  dudosas?: { ordenes: number; monto: number } | null;
}

export interface PaginaPersonas {
  total: number;
  /** false: la API contó hasta un tope (10 001) o no pudo contar; `total` es un piso. */
  totalExacto?: boolean;
  page: number;
  size: number;
  data: PersonaEntidad[];
  /** Del alcance (entidad, región o partido), sin los demás filtros: las cifras y los conteos de los filtros. */
  resumen: ResumenPersonas;
  /** Las opciones de los filtros que dependen del alcance (null en la ficha de un partido o si no se pudieron leer). */
  facetas?: FacetasPersonas | null;
}

/**
 * Lo que dan los filtros de gobierno y de tramos en este alcance: los partidos que gobernaban las entidades (`valor` =
 * 'clave:año de la elección'), con cuántas contrataciones si se pudieron contar (`n` null en una región), y cuántas caen
 * en cada tramo de monto y de meses (sólo en una entidad).
 */
export interface FacetasPersonas {
  gobiernos: { valor: string; nombre: string | null; anio: number; n: number | null }[];
  tramos: Record<"monto" | "meses", Record<string, number>> | null;
  /** En una entidad: desde cuándo la gobierna la gestión actual, y cuántas contrataciones entraron con ella o venían de antes. */
  gestion?: { desde: string; quien: string | null; nivel: string; conteo: Record<"gestion" | "antes", number> } | null;
}

/** La gestión actual de una entidad (migración 181): la municipal o regional («Gestión 2023-2026») o la del Presidente. */
export interface GestionEntidad {
  desde: string;
  quien: string | null;
  nivel: string;
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
  gestion?: GestionEntidad | null;
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
    /** Sus órdenes con un monto que puede ser un error de CONOSCE: se muestran, van aparte de sus sumas. */
    dudosas?: { ordenes: number; monto: number | null; motivos: string[] | null } | null;
  };
  entidades: EntidadDePersona[];
  anual: AnioDePersona[];
  /** Lo cobrado cada mes por órdenes (línea de tiempo); `dudoso`, lo que puede ser un error de CONOSCE, aparte. */
  mensual?: { mes: string; monto: number; dudoso: number; ordenes: number }[];
  /** Los cambios de gobierno en la entidad que más le pagó, mientras tuvo órdenes (para marcarlos en la línea mes a mes). */
  cambios?: { mes: string; nivel: string; quien: string | null }[];
}

export interface OrdenPersona {
  fecha: string;
  entidad: string | null;
  entidadRuc: string;
  numero: string | null;
  orden: string | null;
  descripcion: string | null;
  /** El monto tal como lo publicó CONOSCE (también el dudoso: nunca se borra). */
  monto: number | null;
  /** Si el monto puede ser un error de CONOSCE (20 veces el tope de su modalidad…): el mismo monto, que va aparte de las sumas. */
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
  "nepotismo", "financio_campana", "candidato_gobierna", "autoridad_contratada", "inhabilitado", "aporte_gobierna", "nepotismo_gobierno",
  "apellidos_autoridad", "apellidos_funcionario", "funcionario_contratado", "meses_seguidos", "pago_alto", "al_borde_del_tope", "candidato", "aporte",
  "visita_previa", "tambien_planilla", "paso_a_planilla", "familia_estado", "socio_proveedor",
] as const;
export type TipoSenal = (typeof TIPOS_SENAL)[number];

/**
 * Cómo se nombra cada señal: `corto` en un chip, `titulo` en la ficha y `explica` para quien no sabe qué es. Ninguna
 * acusa: dicen qué registro coincide.
 */
/**
 * La familia de cada señal, para agrupar el desplegable «Señal» (<optgroup>) en el orden de GRUPOS_SENAL: antes era una
 * lista plana de 20 ordenada por cuántas había.
 */
export const GRUPOS_SENAL = ["Política", "Familia y funcionarios", "Sus empresas", "Cómo se le paga", "Otros registros"] as const;
export const GRUPO_SENAL: Record<TipoSenal, (typeof GRUPOS_SENAL)[number]> = {
  financio_campana: "Política", candidato_gobierna: "Política", aporte_gobierna: "Política", autoridad_contratada: "Política",
  candidato: "Política", aporte: "Política",
  nepotismo: "Familia y funcionarios", nepotismo_gobierno: "Familia y funcionarios", familia_estado: "Familia y funcionarios",
  apellidos_autoridad: "Familia y funcionarios",
  apellidos_funcionario: "Familia y funcionarios", funcionario_contratado: "Familia y funcionarios",
  meses_seguidos: "Cómo se le paga", pago_alto: "Cómo se le paga", al_borde_del_tope: "Cómo se le paga", tambien_planilla: "Cómo se le paga",
  paso_a_planilla: "Cómo se le paga",
  socio_proveedor: "Sus empresas",
  inhabilitado: "Otros registros", visita_previa: "Otros registros",
};

export const SENAL: Record<TipoSenal, { corto: string; titulo: string; explica: string }> = {
  nepotismo: {
    // El mismo nombre que la bandera de la entidad y de la cabecera de la ficha (antes «Pariente de un funcionario»).
    corto: "Posible nepotismo",
    titulo: "Un funcionario de la entidad lo declaró como su pariente",
    explica:
      "Un funcionario de esta entidad lo declaró como pariente en su Declaración Jurada de Intereses (Ley 31227), y él figura como locador (proveedor) de la misma entidad. Es un indicio de posible nepotismo para revisión humana, no una acusación: la declaración es pública y el impedimento depende del cargo del funcionario (Ley 32069, art. 30).",
  },
  financio_campana: {
    corto: "Financió la campaña del que gobierna",
    titulo: "Aportó a la campaña del que gobierna y después recibió sus órdenes",
    explica:
      "Aportó dinero (ONPE) a la campaña de la organización política en la misma elección que la llevó a gobernar esta entidad (o, en un ministerio, al partido del Presidente), y después ese gobierno le dio órdenes de servicio. Aportar es legal: lo que se señala es que quien financió la campaña luego cobra de ese gobierno. Es un dato para revisar, no una prueba de favor.",
  },
  familia_estado: {
    corto: "Familia en el Estado",
    titulo: "Un funcionario de otra entidad lo declaró como su pariente",
    explica:
      "Un funcionario de otra entidad, de otro gobierno, lo declaró como pariente en su Declaración Jurada de Intereses. No es nepotismo (no trabajan en la misma entidad ni en el mismo gobierno): es un dato de contexto, para ver si hay familia en el Estado detrás de una contratación. No prueba nada por sí solo.",
  },
  nepotismo_gobierno: {
    corto: "Pariente en el mismo gobierno",
    titulo: "Un funcionario de otra entidad del mismo gobierno lo declaró como su pariente",
    explica:
      "Un funcionario de otra entidad del mismo gobierno (el gobierno regional y sus UGEL u hospitales, o la municipalidad y sus organismos) lo declaró como pariente en su Declaración Jurada de Intereses, y él es locador de esta entidad. Entre entidades de un mismo gobierno pueden cruzarse favores; es un indicio para revisar, no una acusación.",
  },
  socio_proveedor: {
    corto: "Socio de un proveedor",
    titulo: "Es socio o representante de una empresa que también le vende a esta entidad",
    explica:
      "Según el Registro Nacional de Proveedores de la OECE, es socio, representante o directivo de una empresa que también le vendió a esta entidad (órdenes de compra o de servicio, o una buena pro), además de las órdenes que recibe como persona. Es la misma persona, por su documento: no un homónimo. Puede ser legal; vale revisar si la empresa le vendió en los mismos años y si él intervino en esas compras.",
  },
  al_borde_del_tope: {
    corto: "Órdenes al borde del tope",
    titulo: "Sus órdenes van justo debajo del tope",
    explica:
      "La mitad o más de las órdenes que le dio la entidad (y al menos tres) quedaron entre el 95 % y el 100 % del tope de su año (8 UIT; 9 UIT en 2022, con el D.U. 016-2022), el monto desde el cual se debe hacer un proceso de selección. Puede ser casualidad o la forma de no hacer un proceso: vale revisar si el servicio se partió en órdenes.",
  },
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
    corto: "Comparte apellidos con una autoridad",
    titulo: "Tiene los dos apellidos de una autoridad de la entidad",
    explica:
      "Sus dos apellidos son los del alcalde, un regidor, el gobernador o un consejero del gobierno que lo contrató. No prueba parentesco: es un dato para revisar.",
  },
  apellidos_funcionario: {
    corto: "Comparte apellidos con un funcionario",
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
    explica:
      "El registro de visitas lo muestra en la entidad en los 180 días antes de su primera orden ahí. Pesa más si lo recibió quien decide las compras (el titular, la gerencia, la administración, la logística o un comité).",
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
  oece_rnp: "OECE, Registro Nacional de Proveedores (conformación jurídica)",
};

/** La fuente en corto, para la línea de la señal (la completa, con su enlace, va en la evidencia). */
export const FUENTE_CORTA: Record<string, string> = {
  jne_candidaturas: "JNE",
  jne_autoridades: "JNE",
  onpe_aportantes: "ONPE",
  dji_contraloria: "Contraloría, DJI",
  osce_sancionados: "Tribunal de Contrataciones",
  conosce_ordenes: "CONOSCE",
  pte_personal: "Portal de Transparencia",
  visitas_entidades: "Registro de visitas",
  oece_rnp: "OECE, RNP",
};

/** El parentesco declarado en la DJI, como lo dice la ficha ("hijo" → "hijo(a)"). */
export const GRADO_PARIENTE: Record<string, string> = {
  hermano: "hermano(a)",
  conyuge: "cónyuge o conviviente",
  hijo: "hijo(a)",
  padre: "padre o madre",
  otro: "pariente",
};

// ─── Señales distintas ─────────────────────────────────────────────────────────────────────────

/**
 * Qué hace iguales a dos señales de entidades distintas: el mismo tipo, la misma severidad y el mismo detalle. Lo que es
 * de la persona y no de una entidad (un aporte, una candidatura, ser autoridad de otro gobierno) llega igual en cada
 * entidad que la contrató; las de una entidad (nepotismo, meses seguidos, también en planilla) traen su propio detalle.
 */
export const claveSenal = (s: Pick<SenalDetalle, "tipo" | "severidad" | "detalle">) => `${s.tipo}|${s.severidad}|${JSON.stringify(s.detalle ?? {})}`;

export interface SenalDistinta {
  clave: string;
  senal: SenalDetalle;
  /** Las entidades (RUC) en que vale, en el orden de la ficha. */
  en: string[];
}

const RANGO: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };
const ORDEN_TIPO = new Map<string, number>(TIPOS_SENAL.map((t, i): [string, number] => [t, i]));

/** De la más grave a la más leve; a igual severidad, primero la de una sola entidad y después por tipo. */
export function compararSenales(a: SenalDistinta, b: SenalDistinta): number {
  return (
    RANGO[a.senal.severidad] - RANGO[b.senal.severidad] ||
    Number(a.en.length > 1) - Number(b.en.length > 1) ||
    (ORDEN_TIPO.get(a.senal.tipo) ?? 99) - (ORDEN_TIPO.get(b.senal.tipo) ?? 99)
  );
}

/**
 * Las señales de una persona contadas UNA vez (K13 de la auditoría 2026-10-26: la cifra decía 14 y la ficha mostraba 8,
 * porque la API manda una fila por entidad). `total` es lo que dicen la cifra, la pestaña y el índice; `enVarias`, cuántas
 * valen en más de una entidad (por eso las de cada entidad suman más que el total).
 */
export function senalesDistintas(entidades: EntidadDePersona[]) {
  const por = new Map<string, SenalDistinta>();
  for (const e of entidades) {
    for (const s of e.senalesDetalle) {
      const k = claveSenal(s);
      const x = por.get(k);
      if (!x) por.set(k, { clave: k, senal: s, en: [e.entidadRuc] });
      else if (!x.en.includes(e.entidadRuc)) x.en.push(e.entidadRuc);
    }
  }
  const lista = [...por.values()].sort(compararSenales);
  const cuenta = (sev: Severidad) => lista.filter((x) => x.senal.severidad === sev).length;
  return { lista, porClave: por, total: lista.length, altas: cuenta("alta"), medias: cuenta("media"), bajas: cuenta("baja"), enVarias: lista.filter((x) => x.en.length > 1).length };
}

/**
 * Las banderas de la cabecera de una persona (las de su ficha, fijas en todas las pestañas): una por tipo de señal, con
 * la peor severidad entre sus entidades, el nepotismo primero (el orden del catálogo desempata) y todas hacia la
 * pestaña Señales, donde está la evidencia. El nepotismo se nombra como en la entidad: «Posible nepotismo».
 */
export function banderasPersona(lista: SenalDistinta[], hrefSenales: string): BanderaFicha[] {
  const por = new Map<string, BanderaFicha>();
  for (const x of lista) {
    const t = x.senal.tipo;
    const previa = por.get(t);
    if (!previa) {
      por.set(t, { tipo: t, severidad: x.senal.severidad, nombre: t === "nepotismo" ? "Posible nepotismo" : SENAL[t]?.corto ?? t, explica: SENAL[t]?.titulo, href: hrefSenales });
    } else if (RANGO[x.senal.severidad] < RANGO[previa.severidad]) previa.severidad = x.senal.severidad;
  }
  return [...por.values()].sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad] || (ORDEN_TIPO.get(a.tipo) ?? 99) - (ORDEN_TIPO.get(b.tipo) ?? 99));
}

/** "2020 a 2024", "2026" o null. */
export function aniosTexto(anios: readonly number[] | null | undefined): string | null {
  const a = [...(anios ?? [])].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[0] === a[a.length - 1] ? String(a[0]) : `${a[0]} a ${a[a.length - 1]}`;
}

/** Los filtros de la pestaña Órdenes de una persona (`oent`, `oanio`, `oq`, `opag`), validados como la API. */
export function filtrosOrdenesDeUrl(sp: Busqueda) {
  const entidad = uno(sp?.oent);
  const anio = Number(uno(sp?.oanio));
  const q = uno(sp?.oq);
  return {
    entidad: entidad && /^\d{11}$/.test(entidad) ? entidad : undefined,
    anio: anio >= 2018 && anio <= 2100 ? anio : undefined,
    q: q && q.length >= 2 ? q.slice(0, 80) : undefined,
    page: Math.max(1, Number(uno(sp?.opag)) || 1),
  };
}

export const hayFiltrosOrdenes = (f: ReturnType<typeof filtrosOrdenesDeUrl>) => Boolean(f.entidad || f.anio || f.q || f.page > 1);

// ─── Parámetros de la lista ─────────────────────────────────────────────────────────────────────

/** Nombres de los filtros en la URL. Dentro de otra ficha (entidad, partido) van con `p` delante: no chocan con los suyos. */
export interface ParamsPersonas {
  senal: string;
  severidad: string;
  servicio: string;
  anio: string;
  /** El partido que gobernaba la entidad, en un período ('clave:año'). */
  gobierno: string;
  monto: string;
  meses: string;
  /** «Cuándo entró»: con la gestión actual (`gestion`) o desde antes (`antes`). */
  ingreso: string;
  orden: string;
  page: string;
  /** El buscador: la entidad y el tipo de servicio (nunca el nombre de la persona). */
  q: string;
}
export const PARAMS_SOLOS: ParamsPersonas = {
  senal: "senal", severidad: "severidad", servicio: "servicio", anio: "anio", gobierno: "gobierno", monto: "monto", meses: "meses", ingreso: "ingreso", orden: "orden", page: "page", q: "q",
};
export const PARAMS_EN_FICHA: ParamsPersonas = {
  senal: "psenal", severidad: "psev", servicio: "pservicio", anio: "panio", gobierno: "pgob", monto: "pmonto", meses: "pmeses", ingreso: "ping", orden: "pord", page: "ppag", q: "pq",
};

/**
 * Los filtros por tramos (los mismos de la API, `TRAMOS_PERSONA`): lo que le pagó la entidad en todos sus años y en
 * cuántos meses le dio órdenes.
 */
export const TRAMOS_PERSONA: Record<"monto" | "meses", readonly { valor: string; etiqueta: string }[]> = {
  monto: [
    { valor: "menos5", etiqueta: "Menos de S/ 5 mil" },
    { valor: "5a20", etiqueta: "De S/ 5 mil a 20 mil" },
    { valor: "20a100", etiqueta: "De S/ 20 mil a 100 mil" },
    { valor: "100a300", etiqueta: "De S/ 100 mil a 300 mil" },
    { valor: "mas300", etiqueta: "Más de S/ 300 mil" },
  ],
  meses: [
    { valor: "1", etiqueta: "Un mes" },
    { valor: "2a6", etiqueta: "De 2 a 6 meses" },
    { valor: "7a11", etiqueta: "De 7 a 11 meses" },
    { valor: "12a23", etiqueta: "De 12 a 23 meses" },
    { valor: "24mas", etiqueta: "24 meses o más" },
  ],
};
const esTramo = (t: "monto" | "meses", v: string | undefined) => (v && TRAMOS_PERSONA[t].some((o) => o.valor === v) ? v : undefined);

/** «Cuándo entró» (los mismos valores de la API, `INGRESO_PERSONA`): su primera orden frente al inicio de la gestión actual. */
export const INGRESO_PERSONA = [
  { valor: "gestion", etiqueta: "Entró con la gestión actual" },
  { valor: "antes", etiqueta: "Ya estaba antes y siguió" },
] as const;

/**
 * Las opciones de un filtro buscable con nombres únicos: el campo elige la opción por su nombre (`<datalist>`), así que
 * dos iguales no se distinguirían. La segunda lleva «(2)».
 */
export function etiquetasUnicas<T extends { valor: string; etiqueta: string }>(opciones: T[]): T[] {
  const vistas = new Map<string, number>();
  return opciones.map((o) => {
    const n = (vistas.get(o.etiqueta) ?? 0) + 1;
    vistas.set(o.etiqueta, n);
    return n === 1 ? o : { ...o, etiqueta: `${o.etiqueta} (${n})` };
  });
}

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
  gobierno?: string;
  senal?: string;
  severidad?: string;
  servicio?: string;
  anio?: number;
  monto?: string;
  meses?: string;
  ingreso?: string;
  orden?: string;
  q?: string;
  page?: number;
  size?: number;
}

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** Lee de la URL los filtros de la lista (con los nombres de `P`), validados como la API. */
export function filtrosDeUrl(sp: Busqueda, P: ParamsPersonas): FiltrosPersonas {
  const senal = uno(sp?.[P.senal]);
  const sev = uno(sp?.[P.severidad]);
  const anio = Number(uno(sp?.[P.anio]));
  const orden = uno(sp?.[P.orden]);
  const q = uno(sp?.[P.q])?.slice(0, 80);
  const gobierno = uno(sp?.[P.gobierno]);
  return {
    senal: senal && (TIPOS_SENAL as readonly string[]).includes(senal) ? senal : undefined,
    severidad: sev && ["alta", "media", "baja", "con", "sin"].includes(sev) ? sev : undefined,
    servicio: uno(sp?.[P.servicio])?.slice(0, 60),
    anio: anio >= 2018 && anio <= 2100 ? anio : undefined,
    gobierno: gobierno && /^[a-z0-9-]{1,80}:\d{4}$/.test(gobierno) && esAnioGobierno(Number(gobierno.split(":")[1])) ? gobierno : undefined,
    monto: esTramo("monto", uno(sp?.[P.monto])),
    meses: esTramo("meses", uno(sp?.[P.meses])),
    ingreso: INGRESO_PERSONA.some((o) => o.valor === uno(sp?.[P.ingreso])) ? uno(sp?.[P.ingreso]) : undefined,
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
    [P.gobierno]: f.gobierno,
    [P.monto]: f.monto,
    [P.meses]: f.meses,
    [P.ingreso]: f.ingreso,
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

/**
 * Lo que la persona es en otros registros públicos, unido por su DNI (que nunca sale de la API): GET /personas/:codigo/perfil.
 * Las empresas son las de RUC 20; del funcionario que la declaró como pariente, su entidad, su cargo y su primer apellido.
 */
export interface PerfilPersona {
  empresas: {
    ruc: string; nombre: string | null; rol: string | null; desde: string | null; vendido: number; entidades: number | null;
    inhabilitada: boolean | null; estadoSunat: string | null; nAlta: number | null;
  }[];
  candidaturas: { anio: number | null; partido: string | null; cargo: string | null; resultado: string | null; region: string | null; provincia: string | null; distrito: string | null }[];
  autoridades: { cargo: string | null; partido: string | null; desde: string | null; hasta: string | null; vigente: boolean | null; departamento: string | null; provincia: string | null; distrito: string | null }[];
  aportes: { partido: string | null; anio: number | null; fecha: string | null; monto: number | null; tipo: string | null; nivel: string | null; proceso: string | null }[];
  visitas: {
    total: number;
    /** `fuente`: el registro del que salió cada visita (portal_visitas_nacional, congreso_visitas, pnda_visitas…). */
    ultimas: { fecha: string | null; entidad: string | null; cargo: string | null; area: string | null; motivo: string | null; fuente?: string | null }[];
    hasta?: string | null;
    /** Todas sus visitas, por entidad (las 12 que más visitó): para la línea de vida. */
    porEntidad?: { entidad: string | null; n: number; primera: string | null; ultima: string | null; aQuienDecide: number }[];
    /** Las visitas antes de su primera orden en una entidad (señal visita_previa, migración 195). */
    antesDeOrden?: { entidadRuc: string; entidad: string | null; severidad: string; primeraOrden: string | null; primeraVisita: string | null; n: number; aQuienDecide: number }[];
  };
  familia: { entidadRuc: string; entidad: string | null; parentesco: string | null; grado: string | null; cargo: string | null; funcionarioApellido: string | null; ficha: string | null }[];
  /** `idPte`: el id de la entidad en el Portal de Transparencia (su página de personal), null si no se sabe. */
  planilla: { entidadRuc: string; entidad: string | null; ficha: string | null; cargo: string | null; regimen: number | null; dependencia: string | null; desde: string | null; hasta: string | null; base: number | null; nSenales: number | null; idPte?: number | null }[];
  entidades: { entidadRuc: string; entidad: string | null; primera: string | null; ultima: string | null; ordenes: number; monto: number }[];
}

export const getPerfilPersona = (codigo: string) =>
  /^[0-9a-f]{12}$/.test(codigo) ? leer<PerfilPersona>(`/personas/${codigo}/perfil`) : Promise.resolve(null);

export function getOrdenesPersona(codigo: string, f: { entidad?: string; anio?: number; q?: string; page?: number; size?: number }) {
  if (!/^[0-9a-f]{12}$/.test(codigo)) return Promise.resolve(null);
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return leer<OrdenesPersona>(`/personas/${codigo}/ordenes?${p.toString()}`);
}

export const rutaPersona = (codigo: string, seccion?: string) => `/app/personas/${codigo}${seccion ? `?seccion=${seccion}` : ""}`;
