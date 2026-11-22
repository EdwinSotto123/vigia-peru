/**
 * Con qué seguro te atienden (Gobserva Salud, 2026-11-22; el usuario: «que sea útil para una persona de a pie que quiera
 * atenderse»). Lo que dice cada seguro sale de gob.pe y lo que es cada establecimiento, de la institución que declaró en
 * RENIPRESS. Un convenio puntual (una clínica con el SIS, un hospital con una EPS) no está en RENIPRESS: por eso siempre
 * se dice «pregunta». La emergencia y el parto se atienden en cualquiera (Ley 26842, artículos 3 y 39, modificados por la
 * Ley 27604). Sin JSX: lo usan la ficha, las listas y «Cerca de mí».
 */

export const URL_SIS_PARA_TODOS = "https://www.gob.pe/8970-afiliarte-al-sis-para-todos";
export const URL_CITA_MINSA = "https://www.gob.pe/32985-obtener-cita-medica-en-un-establecimiento-del-minsa";
export const URL_CITA_ESSALUD = "https://www.gob.pe/277";
/** La Ley General de Salud (Ley 26842) en gob.pe: los artículos 3 y 39 obligan a atender una emergencia. */
export const URL_LEY_SALUD = "https://www.gob.pe/institucion/minsa/normas-legales/256661-26842";

/** El filtro de la API (POST /salud/cerca y GET /salud/establecimientos): la institución que declaró en RENIPRESS. */
export type FiltroSeguro = "sis" | "essalud" | "sanidad" | "privado";

/** Lo que la persona tiene, como lo diría: el botón de «¿Qué seguro tienes?». */
export interface SeguroPersona {
  clave: "sis" | "essalud" | "privado" | "ninguno";
  etiqueta: string;
  /** Qué establecimientos se buscan con ese seguro. */
  filtro: FiltroSeguro;
  /** Lo que se le muestra al elegirlo: dónde empezar y qué cuesta, en dos oraciones. */
  guia: string;
  enlace: { href: string; texto: string } | null;
  /** «Los que atienden con SIS»: para el título de la lista. */
  lista: string;
}

export const SEGUROS_PERSONA: SeguroPersona[] = [
  {
    clave: "sis",
    etiqueta: "SIS",
    filtro: "sis",
    guia:
      "Con SIS la atención es gratis en los establecimientos del MINSA y de los gobiernos regionales. Para un especialista de hospital suelen pedirte la referencia de un centro o puesto de salud: empieza por ahí.",
    enlace: { href: URL_CITA_MINSA, texto: "Cómo sacar una cita en el MINSA" },
    lista: "del MINSA y los gobiernos regionales (atienden con SIS)",
  },
  {
    clave: "essalud",
    etiqueta: "EsSalud",
    filtro: "essalud",
    guia:
      "EsSalud te atiende en el centro asistencial que te asignó según tu DNI, con tu seguro activo. Si necesitas un especialista que ahí no hay, desde ese centro te refieren a otro.",
    enlace: { href: URL_CITA_ESSALUD, texto: "Cómo sacar una cita en EsSalud" },
    lista: "de EsSalud",
  },
  {
    clave: "privado",
    etiqueta: "Seguro privado o EPS",
    filtro: "privado",
    guia:
      "En una clínica o un consultorio privado pagas tú o tu seguro. Antes de atenderte, pregunta si tiene convenio con tu seguro y cuánto te tocará pagar.",
    enlace: null,
    lista: "privados",
  },
  {
    clave: "ninguno",
    etiqueta: "No tengo seguro",
    filtro: "sis",
    guia:
      "Si no tienes otro seguro, puedes afiliarte gratis al SIS con tu DNI o carné de extranjería, sin pagos mensuales, y atenderte gratis en los del MINSA y los gobiernos regionales. También te atienden ahí pagando la cita.",
    enlace: { href: URL_SIS_PARA_TODOS, texto: "Afiliarte gratis al SIS" },
    lista: "del MINSA y los gobiernos regionales (pagando la cita o con el SIS)",
  },
];

export const seguroPersonaDe = (clave: string | null | undefined) => SEGUROS_PERSONA.find((s) => s.clave === clave) ?? null;

/** Lo que es un establecimiento según su institución: una etiqueta corta para las listas y la oración para la ficha. */
export interface SeguroIpress {
  clave: FiltroSeguro | "otro";
  /** «Con SIS», «EsSalud», «Sanidad», «Privado»; null si la institución no dice con qué seguro atiende. */
  corto: string | null;
  titulo: string;
  texto: string;
  enlace: { href: string; texto: string } | null;
}

const SANIDADES: Record<string, string> = {
  "SANIDAD DEL EJERCITO DEL PERU": "del Ejército",
  "SANIDAD DE LA POLICIA NACIONAL DEL PERU": "de la Policía",
  "SANIDAD DE LA MARINA DE GUERRA DEL PERU": "de la Marina",
  "SANIDAD DE LA FUERZA AEREA DEL PERU": "de la Fuerza Aérea",
};

export function seguroIpress(institucion: string | null | undefined): SeguroIpress {
  const i = (institucion ?? "").toUpperCase().trim();
  if (i === "MINSA" || i === "GOBIERNO REGIONAL") {
    return {
      clave: "sis",
      corto: "Con SIS",
      titulo: "Atiende con SIS",
      texto: `Es ${i === "MINSA" ? "del Ministerio de Salud" : "de un gobierno regional"}: con SIS la atención es gratis. Si no tienes ningún seguro, puedes afiliarte gratis al SIS con tu DNI, o atenderte pagando la cita.`,
      enlace: { href: URL_SIS_PARA_TODOS, texto: "Afiliarte gratis al SIS" },
    };
  }
  if (i === "ESSALUD") {
    return {
      clave: "essalud",
      corto: "EsSalud",
      titulo: "Es de EsSalud",
      texto: "Atiende a los asegurados de EsSalud a los que les asignó este centro, con su seguro activo. Si no es tu centro asignado o no tienes EsSalud, aquí te atienden si es una emergencia o un parto.",
      enlace: { href: URL_CITA_ESSALUD, texto: "Cómo sacar una cita en EsSalud" },
    };
  }
  if (i.startsWith("SANIDAD")) {
    const de = SANIDADES[i] ?? "de las Fuerzas Armadas o la Policía";
    return {
      clave: "sanidad",
      corto: "Sanidad",
      titulo: `Es de la Sanidad ${de}`,
      texto: `Atiende a su personal y a sus familiares con derecho. Si no es tu caso, aquí te atienden si es una emergencia o un parto.`,
      enlace: null,
    };
  }
  if (i === "PRIVADO") {
    return {
      clave: "privado",
      corto: "Privado",
      titulo: "Es privado",
      texto: "Pagas tú o tu seguro privado o EPS. Antes de atenderte, pregunta el precio y si tiene convenio con tu seguro: RENIPRESS no lo dice.",
      enlace: null,
    };
  }
  return {
    clave: "otro",
    corto: null,
    titulo: i && !/^OTROS?$/i.test(i) ? `Es de ${i.length <= 8 ? i : i.charAt(0) + i.slice(1).toLowerCase()}` : "Sin institución declarada",
    texto: "RENIPRESS no dice con qué seguro atiende: pregunta antes de ir.",
    enlace: null,
  };
}

/**
 * Declaró atender las 24 horas: «24 HORAS», «24 hrs», «L-D 00:00 - 24:00», «24:00 horas», «Emerg: 24x7»; no «8:00 -
 * 24:00». El mismo patrón filtra en la API (ES_24H, backend/api/src/routes/gobservaSalud.ts): si cambia uno, el otro.
 */
// 2026-11-22: también «00:00 - 23:59», «8:00 - 8:00» (no «8:00 - 8:00 PM», que son 12 horas) y «24 hras».
const H24 = /(^|[^0-9])([0-9]{1,2})[:.]00 *(-|a) *\2[:.]00(?! *[ap][.]? *m)([^0-9]|$)|(^|[^0-9:])24 *(h|hs|hrs?|hras?|horas?)([^a-z]|$)|(^|[^0-9])0?0[:.]00 *(-|a)? *(24[:.]?00|23[:.]59)|24 *x *7|^ *24(:00)? *(h|hrs?|hras?|horas?)?[.]? *$/i;
export const atiende24 = (horario: string | null | undefined): boolean => !!horario && H24.test(horario);
