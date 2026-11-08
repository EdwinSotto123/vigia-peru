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
 *   · «Más afines» (puntaje): primero las que tienen uno de tus puestos en el título (+2), después las que piden POCAS
 *     carreras y la tuya está entre ellas (+1: «Arquitectura o Ingeniería civil» es más tuya que una lista de seis).
 *   · Los puestos para sugerir salen de los títulos reales de las plazas que piden tu carrera (las de Arquitectura se
 *     llaman «especialista en infraestructura» o «en catastro», casi nunca «arquitecto»).
 *
 * Puro: arma las condiciones SQL sobre `fo` (formación normalizada), `ti` (título normalizado) y `es` (en cuántas partes
 * se divide la formación: una aproximación de cuántas carreras acepta), con sus parámetros.
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

/** Hasta cuántas partes de la formación cuenta como «pide pocas carreras». */
export const POCAS_CARRERAS = 3;

/** Cuántas partes tiene la formación (por comas, punto y coma, barras, «o», «y», «e»): la columna `es`. */
export const PARTES_FORMACION = `cardinality(regexp_split_to_array(COALESCE(s.formacion, ''), '\\s*(?:[,;/]|\\s[OoYyEe]\\s)\\s*'))`;

/**
 * Las condiciones: `porCarrera` y `porPuesto` (una por cada una, para contarlas), `calza` (lo que entra en «Para ti»),
 * `puntaje` (2 si pide la carrera, +2 si el título es de un puesto suyo, +1 si pide pocas carreras y la suya está) y
 * `motivo` (por qué calza cada plaza: qué carreras y qué puestos suyos, como arreglos de booleanos `mc` y `mp`). Los
 * parámetros se agregan a `vals`.
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
  const puntaje =
    `(CASE WHEN ${carrera ?? "false"} THEN 2 ELSE 0 END + CASE WHEN ${enTitulo} THEN 2 ELSE 0 END` +
    ` + CASE WHEN es <= ${POCAS_CARRERAS} AND ${carrera ?? "false"} THEN 1 ELSE 0 END)`;
  const arreglo = (xs: string[]) => (xs.length ? `ARRAY[${xs.map((x) => `COALESCE((${x}), false)`).join(", ")}]` : "ARRAY[]::boolean[]");
  const motivo = `${arreglo(porCarrera)} AS mc, ${arreglo(propios)} AS mp`;
  return { porCarrera, porPuesto, calza, puntaje, carrera, motivo };
}

/** Las tildes que más faltan en los títulos de SERVIR («TECNICO EN ENFERMERIA»): las palabras en «-cion»/«-sion» y estas. */
const TILDES: Record<string, string> = {
  tecnico: "técnico", tecnica: "técnica", tecnicos: "técnicos", enfermeria: "enfermería", logistica: "logística", informatica: "informática",
  juridico: "jurídico", juridica: "jurídica", publico: "público", publica: "pública", publicas: "públicas", publicos: "públicos",
  medico: "médico", medica: "médica", psicologo: "psicólogo", psicologa: "psicóloga", psicologia: "psicología", economico: "económico",
  economica: "económica", academico: "académico", quimico: "químico", ingenieria: "ingeniería", auditoria: "auditoría",
  tesoreria: "tesorería", contraloria: "contraloría", topografo: "topógrafo", geografo: "geógrafo", biologo: "biólogo",
  odontologo: "odontólogo", vehiculo: "vehículo", vehiculos: "vehículos", transito: "tránsito",
  tecnologia: "tecnología", tecnologias: "tecnologías", estadistica: "estadística", grafico: "gráfico",
  mecanico: "mecánico", electrico: "eléctrico", electronico: "electrónico",
  tutoria: "tutoría", asesoria: "asesoría", consultoria: "consultoría", cartografia: "cartografía", topografia: "topografía",
  fisica: "física", fisico: "físico", basica: "básica", basico: "básico", clinico: "clínico", clinica: "clínica",
};

/** Pone las tildes que faltan en un puesto en minúsculas. */
export function conTildes(t: string): string {
  return t
    .split(" ")
    .map((w) => TILDES[w] ?? (/(cion|sion)$/.test(w) && !/ción$|sión$/.test(w) ? w.replace(/ion$/, "ión") : w))
    .join(" ");
}

/** Las palabras que no pueden cerrar un puesto sugerido («especialista en gestión de»). */
const COLA = new Set(["de", "del", "la", "las", "los", "el", "en", "y", "e", "o", "u", "a", "al", "para", "por", "con"]);

/**
 * Un título de plaza como puesto para sugerir: en minúsculas, sin «(a)», «/a», números romanos ni el código del aviso,
 * hasta 40 letras sin cortar una palabra y sin terminar en «de». «TÉCNICO(A) EN ENFERMERÍA I» → «técnico en enfermería».
 */
export function puestoDeTitulo(t: string): string {
  const x = t
    .toLowerCase()
    .replace(/\((?:a|o|as|os|es)\)/g, "")
    .replace(/\/(?:a|o|as|os)\b/g, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?: (?:i|ii|iii|iv|v|vi|vii|viii|ix|x|a|o|\d+))+$/u, "");
  const r: string[] = [];
  for (const w of x.split(" ")) {
    if ([...r, w].join(" ").length > 40) break;
    r.push(w);
  }
  while (r.length && COLA.has(r[r.length - 1])) r.pop();
  return conTildes(r.join(" "));
}

/** La clave para no sugerir dos veces el mismo puesto («enfermera» y «enfermero», «técnico en enfermería» y «técnica…»). */
export const clavePuesto = (t: string) => palabrasNorm(t).map((w) => (/[AO]S?$/.test(w) ? w.replace(/[AO]S?$/, "") : w)).join(" ");

/**
 * La subconsulta de los puestos para sugerir: los títulos de las plazas de `desde` (las que piden tu carrera, con tus
 * filtros) agrupados por sus primeras seis palabras sin el género ni el nivel, los más frecuentes primero. Sin los
 * genéricos de una palabra («especialista») ni los títulos que no son un puesto («convocatoria…», «C S …»).
 */
export const SUGERIDOS_SQL = (desde: string) => `
  SELECT k, count(*)::int AS n, (array_agg(titulo ORDER BY (titulo ~ '[áéíóúÁÉÍÓÚ]') DESC, length(titulo), titulo))[1] AS t
    FROM (SELECT titulo, regexp_replace(array_to_string((regexp_split_to_array(btrim(regexp_replace(
                   regexp_replace(ti, ' (A|O|AS|OS)(?= |$)', '', 'g'), '( (I|II|III|IV|V|VI|VII|VIII|IX|X|[0-9]+))+$', '')), ' '))[1:6], ' '),
                   '( (DE|DEL|LA|LAS|LOS|EL|EN|Y|E|O|PARA|POR|CON|AL))+$', '') AS k
            FROM ${desde}) x
   WHERE k !~ '^(CONVOCATORIA|PROCESO|CAS |C S |PUESTO|PLAZA|CONTRATACION|SERVICIO DE CONTRATACION)'
     AND (k ~ ' ' AND k !~ '^(ESPECIALISTA|ANALISTA|ASISTENTE|TECNICO|AUXILIAR|PROFESIONAL|APOYO|PERSONAL) (I|II|III|IV|V)$'
          OR k ~ '^[A-Z]{5,}$' AND k !~ '^(ESPECIALISTA|ESPECIALISTAS|ANALISTA|ASISTENTE|TECNICO|AUXILIAR|COORDINADOR|PROFESIONAL|APOYO|PERSONAL|RESPONSABLE|JEFE|DIRECTOR|SUPERVISOR|OPERADOR|EJECUTIVO|PROMOTOR|GESTOR|MONITOR|PERITO|SECRETARIO|SECRETARIA)$')
   GROUP BY k ORDER BY count(*) DESC, k LIMIT 14`;

/** «arquitectura;arquitecto|ingeniería civil;ingeniero civil» → [["arquitectura","arquitecto"],["ingeniería civil","ingeniero civil"]]. */
export function leerCarreras(t: string | undefined, max = 5): string[][] {
  return (t ?? "")
    .split("|")
    .map((g) => [...new Set(g.split(";").map((v) => v.trim().slice(0, 60)).filter((v) => palabrasNorm(v).length > 0))].slice(0, 4))
    .filter((g) => g.length)
    .slice(0, max);
}
