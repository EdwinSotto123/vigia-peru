/**
 * ¿Cumples con la plaza? (2026-11-08, el usuario: «sin saber si cumples o no, sin decirte qué tienes que hacer
 * exactamente»). Cada requisito de la plaza contra tu perfil de la app (carrera, estudios y años de experiencia):
 *
 *   · «cumples»: tu perfil lo prueba (pide título y tienes título; pide 2 años y tienes 3 a 4).
 *   · «no»: tu perfil lo descarta (pide maestría y tienes título; pide 6 años y tienes 2; pide Ingeniería de sistemas y
 *     tu carrera es Contabilidad).
 *   · «confirma»: sólo tú lo sabes (cursos, conocimientos, colegiatura, que la experiencia sea en esa función). Se marca.
 *
 * La carrera se busca como en «Para ti» (lib/calceEmpleo.ts de la API): cada palabra de una de sus variantes, por su raíz,
 * al comienzo de una palabra del requisito. El nivel de estudios, como el NIVEL de routes/empleo.ts, pero la maestría
 * cuenta aparte («título … con maestría (egresado)» pide las dos cosas, no «egresado»).
 *
 * También: las fechas del cronograma de las bases («Del 20 al 23 de noviembre del 2026», «19/11/2026») y cuál es la
 * etapa en la que se postula. Puro: se prueba con node --test.
 */
import { CARRERAS, ESTUDIOS, EXPERIENCIAS, variantesDe, type Estudios, type PerfilEmpleo } from "./entrevista.ts";

/** «bases»: lo que las bases piden además del aviso de SERVIR (la lectura de las bases). */
export type TipoRequisito = "formacion" | "experiencia" | "curso" | "conocimiento" | "otro" | "bases";
export interface RequisitoPlaza {
  que: string;
  tipo: TipoRequisito;
}
export type EstadoRequisito = "cumples" | "no" | "confirma";
export interface Juicio extends RequisitoPlaza {
  /** Para recordar lo que marcaste (por aviso, en el navegador). */
  clave: string;
  estado: EstadoRequisito;
  /** Por qué, en una frase: «Pide maestría; tienes título profesional». */
  porque: string | null;
}

// ─── Textos como los deja mef_norm ───────────────────────────────────────────────────────────────
const VACIAS = new Set(["DEL", "LAS", "LOS", "CON", "PARA", "POR", "UNA", "UNO", "QUE", "SUS", "EN", "DE", "LA", "EL", "AL", "Y", "O", "E", "A", "U"]);

/** Mayúsculas, sin tildes, sólo letras, números y un espacio entre palabras (mef_norm). */
export const norm = (t: string) =>
  t.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const palabrasNorm = (t: string) => norm(t).split(" ").filter((w) => w.length >= 3 && !VACIAS.has(w)).slice(0, 5);
const raiz = (w: string) => (w.length <= 6 ? w : w.slice(0, Math.max(6, w.length - 3)));

/** ¿El texto (ya normalizado) pide esa carrera? Basta una de sus variantes, con todas sus palabras. */
export function pideCarrera(textoNorm: string, carrera: string): boolean {
  const fo = ` ${textoNorm} `;
  return variantesDe(carrera).some((v) => {
    const ws = palabrasNorm(v);
    return ws.length > 0 && ws.every((w) => fo.includes(` ${raiz(w)}`));
  });
}

/** ¿El requisito nombra carreras? Una del catálogo, o «… en <algo>» después de un grado. */
function nombraCarreras(textoNorm: string): boolean {
  if (CARRERAS.some((c) => pideCarrera(textoNorm, c.nombre))) return true;
  return / EN (?!GENERAL|CUALQUIER|CURSO)[A-Z]{4,}/.test(` ${textoNorm}`);
}

// ─── Estudios ────────────────────────────────────────────────────────────────────────────────────
const ORDEN_ESTUDIOS: Estudios[] = ["secundaria", "tecnica", "egresado", "bachiller", "titulo", "posgrado"];
const rango = (e: Estudios) => ORDEN_ESTUDIOS.indexOf(e);
const NIVEL_RE: [Estudios, RegExp][] = [
  ["secundaria", /(SECUNDARIA|PRIMARIA)/],
  ["tecnica", /(TECNIC|INSTITUTO|CETPRO)/],
  ["egresado", /(ESTUDIANTE|EGRESAD|ESTUDIOS UNIVERSITARIOS|UNIVERSITARIO INCOMPLETO)/],
  ["bachiller", /BACHILLER/],
  [
    "titulo",
    /(TITULO|TITULAD|LICENCIAD|COLEGIA|PROFESIONAL|MEDICO|ABOGAD|INGENIER|CONTADOR|ENFERMER|OBSTETR|PSICOLOG|ARQUITECT|ECONOMISTA|NUTRICIONIST|ODONTOLOG|QUIMICO|BIOLOG)/,
  ],
];
const POSGRADO = /(MAESTR|MAGISTER|DOCTORADO)/;
const DESEABLE = /(DESEABLE|DE PREFERENCIA|PREFERENTEMENTE|OPCIONAL|VALORA|DE SER EL CASO)/;
/** Cómo se dice el nivel que pide la plaza. */
export const NIVEL_PIDE: Record<Estudios, string> = {
  secundaria: "secundaria completa",
  tecnica: "estudios técnicos",
  egresado: "estudios universitarios o ser egresado",
  bachiller: "bachiller",
  titulo: "título profesional",
  posgrado: "maestría",
};
const etiquetaEstudios = (e: Estudios) => (ESTUDIOS.find((x) => x.valor === e)?.etiqueta ?? e).toLowerCase();

/**
 * El nivel MÁS BAJO que acepta el requisito (lo que dice antes de la maestría) y si además pide maestría (o sólo la
 * valora). «Título universitario en X con maestría (egresado) en Y» → título y maestría requerida.
 */
export function nivelQuePide(textoNorm: string): { minimo: Estudios | null; posgrado: "requerido" | "deseable" | null } {
  const i = textoNorm.search(POSGRADO);
  const antes = i >= 0 ? textoNorm.slice(0, i) : textoNorm;
  let minimo = NIVEL_RE.find(([, re]) => re.test(antes))?.[0] ?? null;
  if (!minimo && i >= 0) minimo = "posgrado";
  const posgrado = i >= 0 ? (DESEABLE.test(textoNorm.slice(i)) ? "deseable" : "requerido") : null;
  return { minimo, posgrado };
}

// ─── Experiencia ─────────────────────────────────────────────────────────────────────────────────
const NUMEROS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11,
  doce: 12, quince: 15, dieciocho: 18, veinte: 20, veinticuatro: 24, treinta: 30, treintaiseis: 36,
};
const plano = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Los años de experiencia que pide un texto («seis (06) años», «1 año», «6 meses», «no requiere»), o null. */
export function aniosQuePide(texto: string): number | null {
  const s = plano(texto);
  if (/(no (requiere|indispensable|necesaria|se requiere)|sin experiencia)/.test(s)) return 0;
  const conDigitos = s.match(/(\d+(?:[.,]\d+)?)\s*\)?\s*(anos?|meses|mes)\b/);
  const conPalabra = s.match(/\b([a-z]+)\s+(?:\(\s*\d+\s*\)\s*)?(anos?|meses|mes)\b/);
  let n: number | null = null;
  let unidad = "";
  if (conDigitos) {
    n = Number(conDigitos[1].replace(",", "."));
    unidad = conDigitos[2];
  } else if (conPalabra && NUMEROS[conPalabra[1]] != null) {
    n = NUMEROS[conPalabra[1]];
    unidad = conPalabra[2];
  }
  if (n == null || !Number.isFinite(n)) return null;
  return unidad.startsWith("mes") ? Math.round((n / 12) * 100) / 100 : n;
}

/** «1 año», «6 años», «6 meses». */
export function textoAnios(n: number): string {
  if (n > 0 && n < 1) {
    const m = Math.round(n * 12);
    return m === 1 ? "1 mes" : `${m} meses`;
  }
  return n === 1 ? "1 año" : `${String(n).replace(".", ",")} años`;
}

/** Lo que dice tu perfil, como rango de años: «3 a 4 años» → [3, 4]; «5 años o más» (null) → [5, ∞). */
function rangoExp(exp: number | null): [number, number] {
  if (exp == null) return [5, Infinity];
  if (exp === 4) return [3, 4];
  return [exp, exp];
}
const etiquetaExp = (exp: number | null) => (EXPERIENCIAS.find((e) => e.valor === exp)?.etiqueta ?? "5 años o más").toLowerCase();

/** La experiencia que pide en algo (la función, el puesto, el sector público): ésa la confirmas tú. */
const ESPECIFICA =
  /(especific|en la funcion|en (el )?puestos?|en (el |los )?cargos?|cargos? de|en la materia|en el area|en el sector publico|como (asistente|especialista|analista|auxiliar|jefe|coordinador|responsable|tecnico|profesional))/;

// ─── El juicio ───────────────────────────────────────────────────────────────────────────────────
const PEOR: Record<EstadoRequisito, number> = { cumples: 0, confirma: 1, no: 2 };
const peor = (a: EstadoRequisito, b: EstadoRequisito) => (PEOR[b] > PEOR[a] ? b : a);
export const claveRequisito = (r: RequisitoPlaza) => `${r.tipo}:${norm(r.que).slice(0, 60)}`;

function juzgarFormacion(r: RequisitoPlaza, p: PerfilEmpleo | null): Pick<Juicio, "estado" | "porque"> {
  const t = norm(r.que);
  // «Colegiado y habilitado» sin un grado: sólo tú lo sabes.
  if (/(COLEGIA|HABILITAD)/.test(t) && !/(TITULO|BACHILLER|LICENCIAD|EGRESAD|TECNIC)/.test(t)) return { estado: "confirma", porque: null };
  const { minimo, posgrado } = nivelQuePide(t);
  const necesario = posgrado === "requerido" ? "posgrado" : minimo;
  let estado: EstadoRequisito = "cumples";
  const malas: string[] = [];
  const buenas: string[] = [];
  const dudas: string[] = [];
  if (necesario) {
    if (!p?.tengo) {
      estado = "confirma";
      dudas.push(`Pide ${NIVEL_PIDE[necesario]}`);
    } else if (rango(p.tengo) < rango(necesario)) {
      estado = "no";
      malas.push(`Pide ${NIVEL_PIDE[necesario]}; tienes ${etiquetaEstudios(p.tengo)}`);
    } else buenas.push(`Pide ${NIVEL_PIDE[necesario]}; tienes ${etiquetaEstudios(p.tengo)}`);
  }
  // La carrera: en el requisito del grado (no en el de la maestría, que es otra cosa) y si nombra carreras.
  if (minimo !== "posgrado" && minimo !== "secundaria" && nombraCarreras(t)) {
    const mias = p?.carreras ?? [];
    const calza = mias.find((c) => pideCarrera(t, c));
    if (!mias.length) {
      estado = peor(estado, "confirma");
      dudas.push("Revisa que tu carrera esté entre las que pide");
    } else if (calza) buenas.push(`Pide ${calza}, tu carrera`);
    else if (/ AFIN/.test(` ${t}`)) {
      estado = peor(estado, "confirma");
      dudas.push(`Acepta carreras afines: revisa si ${mias.length === 1 ? mias[0] : "la tuya"} cuenta`);
    } else {
      estado = "no";
      malas.push(`Tu carrera (${mias.join(", ")}) no está entre las que pide`);
    }
  } else if (minimo === "posgrado" && p?.tengo === "posgrado" && / EN [A-Z]{4,}/.test(` ${t}`)) {
    estado = peor(estado, "confirma");
    dudas.push("Tienes maestría: confirma que sea en una de esas");
  }
  if (posgrado === "deseable") buenas.push("La maestría suma, pero no es obligatoria");
  const porque = estado === "no" ? malas.join(". ") : estado === "confirma" ? [...dudas, ...buenas].join(". ") : buenas.join(". ");
  return { estado, porque: porque || null };
}

function juzgarExperiencia(r: RequisitoPlaza, p: PerfilEmpleo | null, expGeneral: number | null): Pick<Juicio, "estado" | "porque"> {
  const s = plano(r.que);
  const especifica = ESPECIFICA.test(s) && !/general|privado/.test(s);
  const anios = aniosQuePide(r.que) ?? (especifica ? null : expGeneral);
  if (anios == null) return { estado: "confirma", porque: null };
  if (anios === 0) return { estado: "cumples", porque: "No pide experiencia" };
  if (!p) return { estado: "confirma", porque: `Pide ${textoAnios(anios)}` };
  const [min, max] = rangoExp(p.exp);
  const tienes = etiquetaExp(p.exp);
  if (max < anios) return { estado: "no", porque: `Pide ${textoAnios(anios)} de experiencia; tienes ${tienes}` };
  if (especifica) return { estado: "confirma", porque: `Tienes ${tienes} en total: confirma que ${textoAnios(anios)} sean en eso` };
  if (min >= anios) {
    // El texto entero del aviso trae también la específica: ésa la confirmas tú.
    if (/especific/.test(s)) return { estado: "confirma", porque: `Pide ${textoAnios(anios)} en total; tienes ${tienes}. Confirma la experiencia específica` };
    return { estado: "cumples", porque: `Pide ${textoAnios(anios)} de experiencia; tienes ${tienes}` };
  }
  return { estado: "confirma", porque: `Pide ${textoAnios(anios)} de experiencia; tienes ${tienes}: confírmalo` };
}

/** Cada requisito contra tu perfil (null: sin perfil, todo queda para confirmar). */
export function juzgar(requisitos: RequisitoPlaza[], perfil: PerfilEmpleo | null, plaza: { expGeneral: number | null }): Juicio[] {
  // La experiencia general del aviso va sólo al primer requisito de experiencia que no diga sus años.
  let generalUsada = false;
  return requisitos.map((r) => {
    let j: Pick<Juicio, "estado" | "porque">;
    if (r.tipo === "formacion") j = juzgarFormacion(r, perfil);
    else if (r.tipo === "experiencia") {
      j = juzgarExperiencia(r, perfil, generalUsada ? null : plaza.expGeneral);
      generalUsada = true;
    } else j = { estado: "confirma", porque: null };
    return { ...r, clave: claveRequisito(r), ...j };
  });
}

export type Veredicto = "cumples" | "confirma" | "no";
/** El veredicto: «no» si algo te descarta; «confirma» si falta marcar algo; «cumples» si todo está. */
export function veredicto(juicios: Juicio[], marcados: ReadonlySet<string>): { estado: Veredicto; cumples: number; confirma: number; no: number } {
  let cumples = 0;
  let confirma = 0;
  let no = 0;
  for (const j of juicios) {
    if (j.estado === "no") no++;
    else if (j.estado === "cumples" || marcados.has(j.clave)) cumples++;
    else confirma++;
  }
  return { estado: no ? "no" : confirma ? "confirma" : "cumples", cumples, confirma, no };
}

// ─── Los requisitos del aviso de SERVIR (cuando no hay «Lo esencial») ────────────────────────────
/** En oración: SERVIR escribe a veces todo en mayúsculas. */
function oracion(t: string): string {
  const letras = t.replace(/[^\p{L}]/gu, "");
  const mayus = letras.replace(/[^\p{Lu}]/gu, "").length;
  const x = letras.length && mayus / letras.length > 0.6 ? t.toLocaleLowerCase("es") : t;
  return x.charAt(0).toLocaleUpperCase("es") + x.slice(1);
}

/** Un campo del aviso en sus partes: viñetas, asteriscos, guiones de lista y líneas. */
function partesDe(texto: string): string[] {
  return texto
    .split(/\s*(?:[•▪●*]|\n|(?:^|\s)-\s)\s*/)
    .map((x) => x.replace(/^[\s.:;,-]+|[\s;,]+$/g, "").trim())
    .filter((x) => x.replace(/[^\p{L}\p{N}]/gu, "").length >= 4)
    .map(oracion);
}

/**
 * Los requisitos de los campos del aviso. La formación, los cursos y los conocimientos, parte por parte; la experiencia,
 * entera (sus partes «general» y «específica» se leen mejor juntas).
 */
export function requisitosDeServir(p: { formacion: string | null; experiencia: string | null; especializacion: string | null; conocimiento: string | null }): RequisitoPlaza[] {
  const r: RequisitoPlaza[] = [];
  const con = (t: string | null) => (t && t.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 ? t.trim() : null);
  const sinRequisito = (t: string) => /^(no (requiere|aplica|indispensable)|ver bases|segun bases|no)\b/.test(plano(t));
  const f = con(p.formacion);
  if (f && !sinRequisito(f)) for (const x of partesDe(f)) r.push({ que: x, tipo: "formacion" });
  const e = con(p.experiencia);
  if (e && !/^ver bases|^segun bases/.test(plano(e))) r.push({ que: oracion(e.replace(/\s*[•▪●*]\s*/g, " ").replace(/\s+/g, " ")), tipo: "experiencia" });
  const c = con(p.especializacion);
  if (c && !sinRequisito(c)) for (const x of partesDe(c)) r.push({ que: x, tipo: "curso" });
  const k = con(p.conocimiento);
  if (k && !sinRequisito(k)) for (const x of partesDe(k.replace(/\.\s+/g, "\n"))) r.push({ que: x, tipo: "conocimiento" });
  return r;
}

// ─── El cronograma de las bases ──────────────────────────────────────────────────────────────────
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MES_RE = "(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";
const mesDe = (m: string) => (m === "setiembre" ? 9 : MESES.indexOf(m) + 1);
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Las fechas de una etapa del cronograma: la primera y la última («Del 05 de noviembre al 18 de noviembre del 2026»,
 * «Del 20 al 23 de noviembre», «19/11/2026», «04 de noviembre de 2026»). Sin año, el de `anio`. null si no dice una fecha.
 */
export function fechasDe(texto: string, anio: number): { desde: string; hasta: string } | null {
  const s = plano(texto);
  const fechas: { d: number; m: number; a: number | null; i: number }[] = [];
  // «del 20 al 23 de noviembre»: el primer día toma el mes del segundo.
  for (const x of s.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(?:al|y|-)\\s+(\\d{1,2})\\s+de\\s+${MES_RE}(?:\\s+(?:de|del)\\s+(\\d{4}))?`, "g"))) {
    const a = x[4] ? Number(x[4]) : null;
    fechas.push({ d: Number(x[1]), m: mesDe(x[3]), a, i: x.index ?? 0 });
    fechas.push({ d: Number(x[2]), m: mesDe(x[3]), a, i: (x.index ?? 0) + 1 });
  }
  for (const x of s.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?${MES_RE}(?:\\s+(?:de|del)\\s+(\\d{4}))?`, "g"))) {
    fechas.push({ d: Number(x[1]), m: mesDe(x[2]), a: x[3] ? Number(x[3]) : null, i: x.index ?? 0 });
  }
  for (const x of s.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const a = Number(x[3]);
    fechas.push({ d: Number(x[1]), m: Number(x[2]), a: a < 100 ? 2000 + a : a, i: x.index ?? 0 });
  }
  const validas = fechas.filter((f) => f.m >= 1 && f.m <= 12 && f.d >= 1 && f.d <= 31).sort((a, b) => a.i - b.i);
  if (!validas.length) return null;
  // Sin año: el de la fecha siguiente que lo diga, o el de hoy.
  const conAnio = validas.map((f, k) => ({ ...f, a: f.a ?? validas.slice(k + 1).find((g) => g.a != null)?.a ?? anio }));
  const a = conAnio[0];
  const b = conAnio[conAnio.length - 1];
  return { desde: iso(a.a, a.m, a.d), hasta: iso(b.a, b.m, b.d) };
}

/** Cómo se llama la etapa en la que se postula (presentar el CV, el expediente, la ficha). */
export const ETAPA_POSTULACION =
  /postula|presentaci[oó]n (del |de (la )?)?(expediente|cv|hoja|ficha|documentos|propuesta)|expediente virtual|inscripci[oó]n|recepci[oó]n de (expedientes|documentos|cv|hojas?)|registro de (la )?(hoja de vida|ficha|cv|postulantes?)|env[ií]o (del |de (la )?)?(cv|expediente|hoja|ficha|documentos)/i;

/** La etapa en la que se postula: la que marcó la lectura; en las de antes (sin `postulas`), la que lo dice. -1 si no hay. */
export function etapaDePostular(cronograma: { etapa: string; postulas?: boolean }[]): number {
  const marcada = cronograma.findIndex((f) => f.postulas);
  return marcada >= 0 ? marcada : cronograma.findIndex((f) => ETAPA_POSTULACION.test(f.etapa));
}
