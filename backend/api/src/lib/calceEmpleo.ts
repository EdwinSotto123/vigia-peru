/**
 * Qué plazas CAS calzan con quien busca trabajo (2026-11-08; el usuario puso «arquitecto» y le salió «Analista en
 * arquitectura Java II»). Antes cada palabra se buscaba como pedazo de texto en todo el aviso. Ahora:
 *
 *   · Su CARRERA se busca en la FORMACIÓN que pide la plaza («Título profesional en Arquitectura o Ingeniería civil»): es lo
 *     que decide si puede postular. Cada palabra por su raíz al comienzo de una palabra (ARQUITECT calza ARQUITECTO y
 *     ARQUITECTURA; INGENIE, INGENIERO e INGENIERÍA). Una carrera tiene variantes («Contabilidad» o «Contador»): basta una.
 *   · Los PUESTOS que le interesan se buscan en el TÍTULO como palabra entera, con su femenino y su plural (ARQUITECTO,
 *     ARQUITECTA, ARQUITECTOS; nunca ARQUITECTURA).
 *   · Con carrera, la plaza tiene que pedirla; los puestos sólo suben en el orden. Sin carrera (perfiles de antes), calza
 *     un puesto en el título o su raíz en la formación.
 *
 * Puro: arma las condiciones SQL sobre `fo` (formación normalizada) y `ti` (título normalizado), con sus parámetros.
 */

const VACIAS = new Set(["DEL", "LAS", "LOS", "CON", "PARA", "POR", "UNA", "UNO", "QUE", "SUS", "EN", "DE", "LA", "EL", "AL", "Y", "O", "E", "A", "U"]);

/** Las palabras de un texto como las deja mef_norm: mayúsculas, sin tildes, sólo letras y números; sin las vacías. */
export function palabrasNorm(t: string): string[] {
  return t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !VACIAS.has(w))
    .slice(0, 5);
}

/** La raíz de una palabra de una carrera: lo que comparten ARQUITECTO y ARQUITECTURA (las cortas, enteras). */
export const raiz = (w: string) => (w.length <= 6 ? w : w.slice(0, Math.max(6, w.length - 3)));

/** Una palabra de un puesto como palabra entera, con su femenino y su plural: CONTADOR(A|ES|AS)?, ARQUITECT(O|A|OS|AS)?. */
export function puestoRegex(w: string): string {
  if (/[AEO]$/.test(w)) return `(^| )${w.slice(0, -1)}(O|A|E|OS|AS|ES)?( |$)`;
  return `(^| )${w}(A|ES|AS)?( |$)`;
}

export const carreraRegex = (w: string) => `(^| )${raiz(w)}`;

export interface PerfilCalce {
  /** Cada carrera con sus variantes («contabilidad», «contador»). */
  carreras: string[][];
  /** Los puestos del perfil (cuentan en «alguna» y en el orden). */
  puestos: string[];
  /** Puestos sugeridos que sólo se cuentan (las fichas de la entrevista). */
  otros: string[];
}

/**
 * Las condiciones: `porCarrera` y `porPuesto` (una por cada una, para contarlas), `calza` (lo que entra en «Para ti») y
 * `puntaje` (2 si pide la carrera, +1 si el título es de un puesto suyo). Los parámetros se agregan a `vals`.
 */
export function condicionesCalce(p: PerfilCalce, vals: unknown[]) {
  const poner = (v: unknown) => {
    vals.push(v);
    return `$${vals.length}`;
  };
  const variante = (texto: string, col: "fo", re: (w: string) => string) => {
    const ws = palabrasNorm(texto);
    return ws.length ? ws.map((w) => `${col} ~ ${poner(re(w))}`).join(" AND ") : "false";
  };
  const porCarrera = p.carreras.map((vs) => (vs.length ? vs.map((v) => `(${variante(v, "fo", carreraRegex)})`).join(" OR ") : "false"));
  const puesto = (t: string) => {
    const ws = palabrasNorm(t);
    return ws.length ? ws.map((w) => `ti ~ ${poner(puestoRegex(w))}`).join(" AND ") : "false";
  };
  const porPuesto = [...p.puestos, ...p.otros].map(puesto);
  const carrera = porCarrera.length ? porCarrera.map((x) => `(${x})`).join(" OR ") : null;
  const propios = porPuesto.slice(0, p.puestos.length);
  const enTitulo = propios.length ? propios.map((x) => `(${x})`).join(" OR ") : "false";
  let calza: string;
  if (carrera) calza = `(${carrera})`;
  else if (p.puestos.length) {
    // Perfiles de antes (sólo palabras): el puesto en el título, o su raíz en la formación.
    const enFormacion = p.puestos.map((t) => `(${variante(t, "fo", carreraRegex)})`).join(" OR ");
    calza = `((${enTitulo}) OR ${enFormacion})`;
  } else calza = "false";
  const puntaje = `(CASE WHEN ${carrera ?? "false"} THEN 2 ELSE 0 END + CASE WHEN ${enTitulo} THEN 1 ELSE 0 END)`;
  return { porCarrera, porPuesto, calza, puntaje, carrera };
}

/** «arquitectura;arquitecto|ingeniería civil;ingeniero civil» → [["arquitectura","arquitecto"],["ingeniería civil","ingeniero civil"]]. */
export function leerCarreras(t: string | undefined, max = 5): string[][] {
  return (t ?? "")
    .split("|")
    .map((g) => [...new Set(g.split(";").map((v) => v.trim().slice(0, 60)).filter((v) => palabrasNorm(v).length > 0))].slice(0, 4))
    .filter((g) => g.length)
    .slice(0, max);
}
