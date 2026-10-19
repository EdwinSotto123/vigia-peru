/**
 * Datos de la portada, ya elegidos y formateados en el servidor.
 *
 * Las escenas de la portada son componentes cliente (necesitan el DOM para
 * animarse), pero no deben elegir ni formatear nada: reciben objetos planos. Así
 * nunca cruza una función el límite servidor/cliente —compila, pasa `tsc` y
 * revienta sólo en producción, y este repositorio ya se comió ese bug dos veces.
 */

import { esAlertaReal } from "./semillas";
import { fecha, soles } from "./formato";
import { conTildes } from "./tildes";

export interface BanderaReal {
  regla: string;
  severidad: string;
  evidencia?: string | null;
  norma?: string | null;
}

export interface AlertaReal {
  id: string;
  /** Falta en las alertas viejas; sin código, la alerta no se muestra. */
  codigo?: string | null;
  codigoconvocatoria: string;
  objeto: string | null;
  score: number | null;
  entidad: string | null;
  proveedor: string | null;
  montoSoles: number | null;
  fechaBuenaPro: string | null;
  region: string | null;
  fuenteUrl: string | null;
  banderas: BanderaReal[] | null;
}

/** Lo que la portada muestra de un caso. Todo string, ya formateado. */
/**
 * El SEACE escribe todo en MAYÚSCULAS ("ADQUISICIÓN DE SUMINISTRO DE ALIMENTOS (CARNES)…"), que
 * cansa y parece un grito. `tituloNatural` lo vuelve legible sin tocar el dato: cada palabra con su
 * inicial en mayúscula y los conectores en minúscula ("Programa Nacional de Centros Juveniles").
 * Se usa título y no oración a propósito: en una oración los nombres propios ("José Quiñones",
 * "Chiclayo") quedarían en minúscula. Las siglas y los códigos conocidos se respetan; las tildes que la fuente
 * perdió se reponen (lib/tildes: "HUANUCO" → "Huánuco").
 */
const MENORES = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "para", "por", "con", "al", "a", "o", "u", "su", "sus"]);
// Siglas que se respetan, también las de las entidades que el SEACE pone al final ("… - ESSALUD", "… - SUNAT").
// Sin palabras comunes ("RED", "ACTIVOS", "ANA" de Santa Ana): esas van a título.
const SIGLAS_ENTIDAD = [
  "sunat", "essalud", "sunarp", "sedapal", "osinergmin", "osiptel", "ositran", "sunass", "sunafil", "sunedu", "indecopi", "reniec",
  "inpe", "minsa", "minedu", "minam", "minagri", "midagri", "mtc", "mtpe", "mvcs", "mimp", "midis", "minem", "mincetur", "mininter",
  "mindef", "minjus", "pcm", "sis", "ugel", "diresa", "geresa", "diris", "senamhi", "senasa", "sanipes", "senace", "sernanp", "serfor",
  "ingemmet", "igp", "inei", "bcrp", "sbs", "cgr", "jnj", "fap", "provias", "foncodes", "pronabec", "pronied", "devida", "conadis",
  "cenepred", "indeci", "copesco", "fonafe", "petroperu", "enapu", "corpac", "serpost", "sedalib", "epsel", "emapa", "electroperu",
  "electrocentro", "electronoroeste", "electronorte", "electrosur", "enosa", "hidrandina", "egasa", "egemsa", "adinelsa", "cofide",
  "agrobanco", "inen", "insn", "iiap", "imarpe", "itp", "concytec", "cenfotur", "sencico", "sineace", "sutran", "apn", "atu", "emape",
  "emmsa", "serpar",
];
const SIGLA = new RegExp(
  `^(?:s\\.?a\\.?c?\\.?|e\\.?i\\.?r\\.?l\\.?|s\\.?r\\.?l\\.?|seace|ruc|oece|osce|dni|uit|igv|onpe|jne|mef|pnp|ii|iii|iv|vi|vii|viii|ix|xi|xii|n°|nº|${SIGLAS_ENTIDAD.join("|")})$`,
  "i",
);

function palabra(p: string, enMayuscula: boolean): string {
  if (!p) return p;
  if (SIGLA.test(p.replace(/[(),.;:]+$/g, "")) || /\d/.test(p)) return p; // siglas y códigos: tal cual
  const baja = conTildes(p.toLocaleLowerCase("es"));
  if (enMayuscula) return baja.charAt(0).toLocaleUpperCase("es") + baja.slice(1);
  return baja;
}

/**
 * "PROGRAMA NACIONAL DE CENTROS JUVENILES" → "Programa Nacional de Centros Juveniles". Un nombre casi todo en
 * mayúsculas con un pedazo ya escrito ("GOBIERNO REGIONAL DE AREQUIPA Sede Central") se arregla palabra por palabra:
 * las que vienen en mayúsculas se pasan a título y las demás quedan como vienen.
 */
export function tituloNatural(t: string): string {
  if (t !== t.toLocaleUpperCase("es")) {
    const letras = t.match(/\p{L}/gu) ?? [];
    const mayus = letras.filter((c) => c !== c.toLocaleLowerCase("es")).length;
    if (letras.length === 0 || mayus / letras.length < 0.6) return t; // ya viene legible
    return t
      .split(/\s+/)
      .map((p, i) => (p === p.toLocaleUpperCase("es") ? palabra(p, i === 0 || !MENORES.has(p.toLocaleLowerCase("es"))) : p))
      .join(" ");
  }
  return t
    .split(/\s+/)
    .map((p, i) => palabra(p, i === 0 || !MENORES.has(p.toLocaleLowerCase("es"))))
    .join(" ");
}

export interface CasoPortada {
  codigo: string;
  convocatoria: string;
  entidad: string;
  objeto: string;
  monto: string | null;
  proveedor: string | null;
  fecha: string | null;
  region: string | null;
  fuenteUrl: string | null;
  hallazgo: string;
  norma: string;
  severidad: "alta" | "media" | "baja";
  /** Cuántas señales más trae el mismo contrato, además de la que se muestra. */
  otrasSenales: number;
}

/**
 * Las 10 alertas `ALT-2026-00xx` son semillas del mock sembradas en la base de
 * producción (las únicas con coordenadas, por eso se colaban en cualquier mapa
 * de pines). La portada vivía mostrándolas en el ticker, y si la API caía,
 * mostraba `ALERTAS_MOCK` entero sin avisar. Acá se filtran siempre.
 */
export { esAlertaReal };

const PESO_SEVERIDAD: Record<string, number> = { alta: 3, media: 2, baja: 1 };

/**
 * Qué señales pueden ir en la portada. Sólo las que describen el PROCESO
 * (competencia, precios, plazos, forma de contratar), calculadas sobre datos
 * publicados. Quedan fuera, a propósito:
 *  - las que hablan de personas (vínculos, familiares, historial de un
 *    funcionario): la portada no es el lugar para poner un nombre propio junto a
 *    la palabra "riesgo", aunque el dato sea público;
 *  - `red_flag_documental`, la bandera genérica que un modelo redacta leyendo el
 *    PDF: es valiosa dentro del análisis, pero es la que más puede equivocarse, y
 *    en la portada un error se lee como el producto entero equivocándose.
 */
const REGLAS_DE_PROCESO =
  /^(unica_oferta_valida|unico_postor_alto|procedimiento_no_competitivo|sobreprecio_.*|oferta_igual_valor_referencial|cuantia_al_limite_del_tope|spec_restrictiva|plazo_convocatoria_minimo|emergencia_no_acreditada|directa_sin_fundamento|oferta_mas_barata_no_gana|ofertas_agrupadas)$/;

const MARCA_DE_ORGANIZACION =
  /\b(S\.?\s?A\.?\s?C|E\.?\s?I\.?\s?R\.?\s?L|S\.?\s?R\.?\s?L|S\.?\s?A|EMPRESA|SOCIEDAD|CONSORCIO|CORPORACI[OÓ]N|INVERSIONES|GRUPO|COMPA[NÑ][IÍ]A|LIMITADA|ASOCIACI[OÓ]N|CONTRATISTAS|DISTRIBUIDORA|SERVICIOS|IMPORT\w*|INC|LTDA|MUNICIPALIDAD|GOBIERNO|UNIVERSIDAD|HOSPITAL|MINISTERIO)\b/i;

/**
 * Tres o más palabras seguidas en mayúsculas sin ninguna marca de organización
 * son, casi siempre, el nombre de una persona natural (un postor que perdió, un
 * proveedor con negocio propio). Es conservador a propósito: si descarta una
 * señal de más, la portada elige otra; si deja pasar un nombre, ya no hay vuelta.
 */
const nombraAUnaPersona = (texto: string) =>
  // Lo que la API tapó (un apellido "•••", un DNI, una referencia "ref·…") es, por definición, una persona.
  /•|ref·/.test(texto) ||
  (texto.match(/(?:\b[A-ZÁÉÍÓÚÑ]{2,}\b[ ,]*){3,}/g) ?? []).some((tramo) => !MARCA_DE_ORGANIZACION.test(tramo));

/** Si una regla describe el PROCESO (competencia, precios, plazos…): las únicas que la portada nombra. */
export const esReglaDeProceso = (regla: string) => REGLAS_DE_PROCESO.test(regla);

/** Otra señal del mismo contrato, sólo por su nombre: nunca su evidencia (puede nombrar personas). */
export interface OtraSenal {
  etiqueta: string;
  severidad: "alta" | "media" | "baja";
}

/** La bandera más fuerte que se puede mostrar: de proceso, con evidencia legible y norma citada. */
/**
 * La lista `/alertas` de la API nueva recorta la evidencia a 320 caracteres (como el
 * resumen de procesamientos). Una evidencia de ese largo exacto, o que termina en "…", llegó
 * cortada: en la portada no se muestra una frase a medias.
 */
const EVIDENCIA_RECORTADA = 320;
const recortada = (t: string) => t.length === EVIDENCIA_RECORTADA || /…\s*$/.test(t);

function mejorBandera(a: AlertaReal): BanderaReal | null {
  const legibles = (a.banderas ?? []).filter(
    (b) =>
      REGLAS_DE_PROCESO.test(b.regla) &&
      b.norma &&
      b.evidencia &&
      b.evidencia.length >= 80 &&
      b.evidencia.length <= 700 &&
      !recortada(b.evidencia) &&
      !nombraAUnaPersona(b.evidencia),
  );
  legibles.sort((x, y) => (PESO_SEVERIDAD[y.severidad] ?? 0) - (PESO_SEVERIDAD[x.severidad] ?? 0));
  return legibles[0] ?? null;
}


/**
 * El texto sale tal cual lo guardó el análisis, con arreglos de forma y
 * ninguno de fondo: el separador "·" que usan algunas reglas pasa a coma, y los
 * "¿" que deja SEACE donde había un carácter que no supo codificar (comillas o
 * guiones, según el caso). Suelto entre espacios era un guion; pegado a una
 * palabra, una comilla. Si el texto trae un "?", el "¿" es de verdad y no se
 * toca.
 */
function limpiar(t: string, raya = ", "): string {
  // "S/." es como lo escribe el análisis; la portada usa "S/" en todas partes.
  // La raya larga entre espacios pasa a coma en el texto y a dos puntos en la
  // cita de la norma ("Art. 5 Ley 32069: principio de competencia"), salvo
  // entre dos cifras: "2023 – 2024" es un rango y queda como está. Se mira el
  // carácter de cada lado con una función y no con un lookbehind, que no
  // compila en Safari anterior a 16.4.
  let r = t
    .replace(/S\/\.\s?/g, "S/ ")
    .replace(/(\S?)\s[—–]\s(\S?)/g, (m, antes: string, despues: string) =>
      /\d/.test(antes) && /\d/.test(despues) ? m : `${antes}${raya}${despues}`,
    )
    .replace(/\s*·\s*/g, ", ");
  if (!r.includes("?")) r = r.replace(/\s¿\s/g, " - ").replace(/¿/g, '"');
  return r.replace(/\s{2,}/g, " ").trim();
}

function aCaso(a: AlertaReal, b: BanderaReal): CasoPortada {
  const sev = (b.severidad === "alta" || b.severidad === "media" || b.severidad === "baja" ? b.severidad : "media") as CasoPortada["severidad"];
  return {
    codigo: a.codigo ?? "",
    convocatoria: a.codigoconvocatoria,
    entidad: a.entidad ?? "Entidad no identificada",
    objeto: a.objeto ? limpiar(a.objeto) : "Sin objeto declarado en el expediente",
    monto: a.montoSoles != null && a.montoSoles > 0 ? soles(a.montoSoles) : null,
    proveedor: a.proveedor,
    fecha: a.fechaBuenaPro ? fecha(a.fechaBuenaPro) : null,
    region: a.region,
    fuenteUrl: a.fuenteUrl,
    hallazgo: limpiar(b.evidencia!),
    norma: limpiar(b.norma!, ": "),
    severidad: sev,
    otrasSenales: Math.max(0, (a.banderas?.length ?? 1) - 1),
  };
}

/**
 * Elige los casos de la portada de forma DETERMINISTA: el de mayor score con una
 * señal legible, y después los siguientes de regiones distintas. No hay azar —
 * una portada que cambia de caso en cada recarga no se puede citar ni verificar.
 */
export function elegirCasos(alertas: AlertaReal[], cuantos = 4): CasoPortada[] {
  const candidatos = alertas
    .filter(esAlertaReal)
    // Sólo contratos que ganó una organización: un proveedor persona natural es
    // un nombre propio, y en la portada no va (ver `REGLAS_DE_PROCESO`).
    .filter((a) => !!a.proveedor && MARCA_DE_ORGANIZACION.test(a.proveedor))
    .map((a) => ({ a, b: mejorBandera(a) }))
    .filter((x): x is { a: AlertaReal; b: BanderaReal } => x.b !== null)
    .sort(
      (x, y) =>
        (y.a.score ?? 0) - (x.a.score ?? 0) ||
        (PESO_SEVERIDAD[y.b.severidad] ?? 0) - (PESO_SEVERIDAD[x.b.severidad] ?? 0) ||
        (y.a.fechaBuenaPro ?? "").localeCompare(x.a.fechaBuenaPro ?? ""),
    );

  const elegidos: CasoPortada[] = [];
  const regiones = new Set<string>();
  for (const { a, b } of candidatos) {
    const r = (a.region ?? "").toLowerCase();
    if (elegidos.length > 0 && r && regiones.has(r)) continue;
    elegidos.push(aCaso(a, b));
    if (r) regiones.add(r);
    if (elegidos.length === cuantos) break;
  }
  return elegidos;
}

/**
 * "Leído" es "tiene score" (la definición de /app/contratos): un análisis en revisión o
 * descartado también se leyó, aunque no sume a las señales.
 */
export function contarLeidos(r: Partial<Record<string, number>> | null | undefined): number | null {
  if (!r) return null;
  return (r.alto ?? 0) + (r.medio ?? 0) + (r.bajo ?? 0) + (r.en_revision ?? 0) + (r.descartado ?? 0);
}

/** Una cajita de la escala: cuántos contratos de un tipo hay y cuántos leyó Vigía. */
export interface TipoEscala {
  clave: "bienes" | "servicios" | "obras" | "consultoria" | "otros";
  etiqueta: string;
  total: number;
  /** `null`: su lectura falló. Se dice "Sin dato", no se inventa un 0. */
  leidos: number | null;
}

/** El año de la escala: sólo si casi todo lo publicado se convocó ese año (el ⓘ da el número exacto). */
export interface AnioEscala {
  anio: number;
  enAnio: number;
}
