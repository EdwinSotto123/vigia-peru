/**
 * Organización 2.0 (fase 1 del plan del 2026-10-27): el organigrama de una entidad armado con lo que dicen sus fuentes,
 * cada oficina y cada dependencia con su evidencia. Funciones puras (test/organigrama.test.ts); la ruta
 * GET /planilla/organigrama (routes/planilla.ts) les pasa los datos.
 *
 * De dónde sale cada oficina:
 *   - su planilla del último mes (Portal de Transparencia): la dependencia de cada persona. Muchas sólo traen siglas
 *     («GRPPAT», «ORADM»): se expanden (expandirSigla) con los cargos que declaran sus propios funcionarios, los nombres
 *     de su planilla, la ley y los que usan otras entidades (organo_nombre_global, migración 186);
 *   - los cargos de jefatura vigentes de sus funcionarios en la DJI (Contraloría, dji_jefatura): «GERENTE REGIONAL DE
 *     INFRAESTRUCTURA» es la Gerencia Regional de Infraestructura y quien la encabeza (oficinaDeCargo);
 *   - la estructura mínima que fija la ley para su tipo de entidad (LOGR, LOM, LOPE, Ley Universitaria; data/estado.json);
 *   - el ROF o las designaciones publicadas en El Peruano, en las entidades del grafo que los tienen leídos.
 *
 * De quién depende cada una (la arista y su evidencia), de la más firme a la más débil:
 *   1. 'rof': el ROF o la designación publicada lo dice (El Peruano);
 *   2. 'planilla': la planilla la escribe así («SUBGERENCIA DE INFRAESTRUCTURA - GERENCIA DE DESARROLLO TERRITORIAL…»);
 *   3. 'ley': la ley de su tipo de entidad (LOGR: las gerencias regionales dependen de la Gerencia General Regional);
 *   4. 'funcion': inferida por su nombre o su función (la subgerencia de defensa civil, en la gerencia de recursos
 *      naturales, a la que la LOGR le asigna defensa civil; la de tesorería, en la de administración); se dibuja punteada;
 *   5. 'nivel': sin dato, bajo la gerencia general o la entidad; punteada.
 * Nada inventa una oficina: la que sólo está en la ley lo dice (enDatos = false).
 */
import estado from "../data/estado.json" with { type: "json" };

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type Funcion = "alta_direccion" | "compras" | "presupuesto" | "personal" | "legal" | "control" | "obras" | "finanzas" | "otras";
export type Nivel = 1 | 2 | 3 | 4;
export type TipoArista = "rof" | "planilla" | "ley" | "funcion" | "nivel";
export type PlantillaId = "TPL-GR" | "TPL-GL" | "TPL-MIN" | "TPL-OPE" | "TPL-OPT" | "TPL-OPR" | "TPL-UNIV";
export type ComoExpansion = "dji" | "planilla" | "ley" | "rof" | "diccionario" | "global" | "abreviatura" | "region";

export interface Enlace { texto: string; url: string | null }
export interface Jefe { nombre: string; cargo: string | null; ficha: string | null; fuente: "planilla" | "dji"; desde: string | null }

export interface NodoOrg {
  id: string;
  /** Para mostrar: el de la ley (con tildes) si la oficina es uno de sus órganos; si no, el de los datos. */
  nombre: string;
  /** Como la escribe la planilla, si era una sigla o una abreviatura («GRPPAT», «U.COMUNICACIONES»). */
  sigla: string | null;
  /** Cómo se resolvió la sigla y, si había más de una lectura, las otras. */
  expansion: { como: ComoExpansion; alternativas: string[] } | null;
  nivel: Nivel;
  funcion: Funcion;
  /** Un agrupador de la ley («Órganos de línea»), no una oficina. */
  grupo: boolean;
  /** null: cuelga de la entidad. */
  padre: string | null;
  arista: { tipo: TipoArista; texto: string; url: string | null } | null;
  evidencias: { tipo: "planilla" | "dji" | "ley" | "rof" | "entidad"; texto: string; url: string | null }[];
  jefes: Jefe[];
  /** Cómo la escribe la planilla (para abrir su gente filtrada por la oficina). */
  dependencias: string[];
  personas: number;
  planilla: number;
  cas: number;
  conSenales: number;
  altas: number;
  conFamilia: number;
  visitas: number;
  ultimaVisita: string | null;
  rol: "titular" | "aga" | null;
  /** false: sólo la trae la ley (no aparece en su planilla ni en las declaraciones de sus funcionarios). */
  enDatos: boolean;
  /** El Portal de Transparencia cortó su nombre (a 45 caracteres) y ninguna otra fuente lo trae entero. */
  cortado: boolean;
  /** Una unidad del mismo gobierno con su propio RUC (una UGEL, un hospital, un organismo adscrito): su organización es otra. */
  ruc: string | null;
}

export interface OficinaPlanilla {
  /** La dependencia tal como la agrupa la planilla (mayúsculas, espacios juntos). */
  dependencia: string;
  personas: number;
  planilla: number;
  cas: number;
  conSenales: number;
  altas: number;
  conFamilia: number;
  jefes: Jefe[];
}
export interface CargoDji { cargo: string; nombre: string; ficha: string | null; desde: string | null }
export interface NombreGlobal { texto: string; fuente: "planilla" | "dji"; entidades: number }
export interface VisitaArea { area: string; n: number; ultima: string | null }
/** Una unidad del gobierno entero: del gobierno regional (con su propio RUC) o un organismo adscrito al ministerio. */
export interface UnidadGobierno { ruc: string; nombre: string; personas: number; tipo: "regional" | "adscrito"; calificacion?: string | null; url?: string | null }

export interface DatosOrganigrama {
  entidad: { ruc: string; nombre: string; region: string | null; nivelGobierno: string | null };
  /** La del grafo (APLICA_ESTRUCTURA_TIPO), si la entidad está en él; si no, por su nombre (plantillaPorNombre). */
  plantilla: PlantillaId | null;
  /** El nodo de la entidad en el grafo del Estado (para su ROF leído, si lo hay). */
  nodoGrafo: string | null;
  oficinas: OficinaPlanilla[];
  cargos: CargoDji[];
  globales: NombreGlobal[];
  visitas: VisitaArea[];
  mesPlanilla: string | null;
  /** Las páginas oficiales de la entidad: su personal en el Portal de Transparencia, sus DJI en la Contraloría. */
  enlaces: { planilla: string | null; dji: string | null };
  /** El gobierno entero: las unidades del gobierno regional o los organismos adscritos al ministerio. */
  unidades?: UnidadGobierno[];
}

export interface Organigrama {
  plantilla: { id: PlantillaId; nombre: string; ley: Enlace | null } | null;
  nodos: NodoOrg[];
  resumen: { oficinas: number; personas: number; jefaturas: number; planilla: number; siglas: number; siglasExpandidas: number; inferidas: number; visitas: number; visitasSinOficina: number; unidades: number };
}

// ─── Texto ───────────────────────────────────────────────────────────────────

/** Mayúsculas sin tildes, sólo letras, números y espacios (como mef_norm). */
export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Las formas de escribir lo mismo (no son abreviaturas): «SUBGERENCIA» y «SUB GERENCIA». */
const FORMA: Record<string, string> = { SUBGERENCIA: "SUB GERENCIA", SUBDIRECCION: "SUB DIRECCION", SUBGERENTE: "SUB GERENTE", SUBDIRECTOR: "SUB DIRECTOR" };
/** Las abreviaturas que usan las planillas, palabra por palabra («OF. LOG.», «GCIA.», «RR.HH.»). */
const ABREVIATURA: Record<string, string> = {
  SUBGCIA: "SUB GERENCIA", SGCIA: "SUB GERENCIA",
  GCIA: "GERENCIA", GERENC: "GERENCIA", OFIC: "OFICINA", OF: "OFICINA", DIREC: "DIRECCION", DIRECC: "DIRECCION",
  DPTO: "DEPARTAMENTO", DEPTO: "DEPARTAMENTO", GRAL: "GENERAL", MUNIC: "MUNICIPAL", ADMIN: "ADMINISTRACION",
  ADMINIST: "ADMINISTRACION", PPTO: "PRESUPUESTO", PRESUP: "PRESUPUESTO", PLANEAM: "PLANEAMIENTO", PLANIF: "PLANIFICACION",
  INFRAEST: "INFRAESTRUCTURA", INFRAESTR: "INFRAESTRUCTURA", ABAST: "ABASTECIMIENTO", CONTAB: "CONTABILIDAD",
  TESOR: "TESORERIA", JURID: "JURIDICA", RRHH: "RECURSOS HUMANOS",
};
/** Al comienzo del nombre, una letra o dos son el tipo de órgano («U.COMUNICACIONES», «GER. DE…»). */
const ABREVIATURA_INICIO: Record<string, string> = {
  U: "UNIDAD", UF: "UNIDAD FUNCIONAL", OF: "OFICINA", GER: "GERENCIA", DIR: "DIRECCION", SG: "SUB GERENCIA", SUBG: "SUB GERENCIA",
};

/** El nombre de una oficina en su forma canónica (abreviaturas abiertas, sin el paréntesis final «(E.M)»). */
export function canon(nombre: string): { texto: string; abreviado: boolean } {
  let n = norm(nombre.replace(/\s*\([^)]*\)\s*$/, "")).replace(/\bRR HH\b/g, "RRHH");
  let abreviado = false;
  const ws = n.split(" ").filter(Boolean);
  if (ws.length > 1 && ABREVIATURA_INICIO[ws[0]] && /^[A-Z]{1,4}[.\s]/.test(norm(nombre).slice(0, 5) + " ")) {
    // «U COMUNICACIONES» → «UNIDAD DE COMUNICACIONES» (el «de» que la abreviatura comió).
    const tipo = ABREVIATURA_INICIO[ws[0]];
    const resto = ws.slice(1);
    const conDe = ["DE", "DEL", "FUNCIONAL", "GENERAL", "REGIONAL", "MUNICIPAL", "EJECUTIVA", "ZONAL"].includes(resto[0]) ? resto : ["DE", ...resto];
    ws.splice(0, ws.length, ...tipo.split(" "), ...conDe);
    abreviado = true;
  }
  const out = ws.flatMap((w) => {
    const a = ABREVIATURA[w];
    if (a) abreviado = true;
    return (a ?? FORMA[w] ?? w).split(" ");
  });
  n = out.join(" ");
  return { texto: n, abreviado };
}

/** Las palabras que no cuentan para una sigla ni para comparar nombres. */
const VACIAS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "E", "EN", "A", "PARA", "CON", "AL", "O", "U"]);
/** Las que pueden estar o no en una sigla o en otra versión del nombre («GG» es la Gerencia General Regional). */
const OPCIONALES = new Set(["REGIONAL", "MUNICIPAL", "PROVINCIAL", "DISTRITAL", "NACIONAL"]);

export const palabras = (s: string) => canon(s).texto.split(" ").filter((w) => w && !VACIAS.has(w));

/** La llave con que se juntan los nombres de una misma oficina (sin vacías ni opcionales). */
export function claveOrgano(nombre: string): string {
  return palabras(nombre).filter((w) => !OPCIONALES.has(w)).join(" ");
}

// ─── Siglas ──────────────────────────────────────────────────────────────────

/** Una sola palabra de 2 a 8 letras (con o sin puntos: «O.R.ADM.» es ORADM). */
export function esSigla(texto: string): boolean {
  const t = texto.trim();
  if (/\s/.test(t.replace(/\.\s+/g, "."))) return false;
  const s = norm(t).replace(/ /g, "");
  return /^[A-Z]{2,8}$/.test(s);
}

/** ¿La sigla se arma con un prefijo de cada palabra, en orden? Las opcionales pueden faltar. */
export function alinea(sig: string, ws: string[]): boolean {
  const memo = new Map<string, boolean>();
  const ir = (i: number, j: number): boolean => {
    const k = `${i},${j}`;
    const v = memo.get(k);
    if (v !== undefined) return v;
    let r = false;
    if (j === ws.length) r = i === sig.length;
    else if (i === sig.length) r = ws.slice(j).every((w) => OPCIONALES.has(w));
    else {
      const w = ws[j];
      if (OPCIONALES.has(w) && ir(i, j + 1)) r = true;
      else {
        for (let n = 1; n <= Math.min(w.length, sig.length - i); n++) {
          if (sig.slice(i, i + n) !== w.slice(0, n)) break;
          if (ir(i + n, j + 1)) { r = true; break; }
        }
      }
    }
    memo.set(k, r);
    return r;
  };
  return ir(0, 0);
}

/** Siglas que no son iniciales (se arman con sílabas) y que usan casi todas las entidades del país. */
const DICCIONARIO: Record<string, string> = {
  DIRESA: "DIRECCION REGIONAL DE SALUD",
  GERESA: "GERENCIA REGIONAL DE SALUD",
  DIRIS: "DIRECCION DE REDES INTEGRADAS DE SALUD",
  DISA: "DIRECCION DE SALUD",
  UGEL: "UNIDAD DE GESTION EDUCATIVA LOCAL",
  GEREDU: "GERENCIA REGIONAL DE EDUCACION",
  DIRCETUR: "DIRECCION REGIONAL DE COMERCIO EXTERIOR Y TURISMO",
  DIREPRO: "DIRECCION REGIONAL DE LA PRODUCCION",
  DEMUNA: "DEFENSORIA MUNICIPAL DEL NINO Y DEL ADOLESCENTE",
  OMAPED: "OFICINA MUNICIPAL DE ATENCION A LA PERSONA CON DISCAPACIDAD",
  CIAM: "CENTRO INTEGRAL DE ATENCION AL ADULTO MAYOR",
  CEDIF: "CENTRO DE DESARROLLO INTEGRAL DE LA FAMILIA",
  SISFOH: "SISTEMA DE FOCALIZACION DE HOGARES",
};

export interface Candidato { nombre: string; como: ComoExpansion; peso: number; ws?: string[] }

/**
 * Lo que dice una sigla: el nombre completo con que calza (alinea) entre los candidatos, el de más peso (los de la propia
 * entidad pesan más que los de otras; en un gobierno regional, los nombres «regionales»). Sin candidato, si la última letra
 * es la inicial de la región («DRTCA» = DRTC + Ayacucho), se prueba sin ella.
 */
export function expandirSigla(texto: string, candidatos: Candidato[], ctx: { region?: string | null; nivelGobierno?: string | null } = {}):
  { nombre: string; como: ComoExpansion; alternativas: string[] } | null {
  const sig = norm(texto).replace(/ /g, "");
  if (DICCIONARIO[sig]) return { nombre: DICCIONARIO[sig], como: "diccionario", alternativas: [] };
  const buscar = (s: string) => {
    const hits = new Map<string, { nombre: string; como: ComoExpansion; peso: number }>();
    for (const c of candidatos) {
      const ws = c.ws ?? palabras(c.nombre);
      if (ws.length < 2 || ws[0][0] !== s[0] || ws.length > s.length + 3) continue;
      if (!alinea(s, ws)) continue;
      let peso = c.peso;
      if (ctx.nivelGobierno === "regional" && ws.includes("REGIONAL")) peso += 2;
      if ((ctx.nivelGobierno === "provincial" || ctx.nivelGobierno === "distrital") && ws.includes("MUNICIPAL")) peso += 2;
      const k = claveOrgano(c.nombre);
      const ya = hits.get(k);
      if (!ya || ya.peso < peso) hits.set(k, { nombre: canon(c.nombre).texto, como: c.como, peso });
    }
    return [...hits.values()].sort((a, b) => b.peso - a.peso);
  };
  let hits = buscar(sig);
  let como: ComoExpansion | null = null;
  const inicial = norm(ctx.region ?? "")[0];
  if (!hits.length && inicial && sig.length >= 4 && sig.endsWith(inicial)) {
    hits = buscar(sig.slice(0, -1));
    if (hits.length) como = "region";
  }
  if (!hits.length) return null;
  const [mejor, ...resto] = hits;
  // Otra lectura que pesa casi lo mismo: se dice, para que se vea que la sigla podía querer decir otra cosa.
  const alternativas = resto.filter((h) => h.peso >= mejor.peso * 0.6).slice(0, 2).map((h) => h.nombre);
  return { nombre: mejor.nombre, como: como ?? mejor.como, alternativas };
}

// ─── Cargos → oficinas ───────────────────────────────────────────────────────

/** Un nombre de oficina empieza por su tipo de órgano. */
export const ORGANO = /^(SUB GERENCIA|GERENCIA|SUB DIRECCION|DIRECCION|OFICINA|UNIDAD|DEPARTAMENTO|DIVISION|AREA|ALCALDIA|GOBERNACION|VICEGOBERNACION|SECRETARIA|PROCURADURIA|ORGANO|COORDINACION|JEFATURA|DESPACHO|PRESIDENCIA|VICEMINISTERIO|CONSEJO|CONCEJO|RECTORADO|VICERRECTORADO|FACULTAD|DEFENSORIA|CENTRO|PROGRAMA|SUB PREFECTURA)\b/;

const ROL: [RegExp, string][] = [
  [/^SUB ?GERENTE( REGIONAL| MUNICIPAL)? DE (.+)$/, "SUB GERENCIA$1 DE $2"],
  [/^GERENTE (GENERAL|MUNICIPAL)( REGIONAL)?$/, "GERENCIA $1$2"],
  [/^GERENTE( REGIONAL| MUNICIPAL)? DE (.+)$/, "GERENCIA$1 DE $2"],
  [/^DIRECTORA? (GENERAL |EJECUTIVO |EJECUTIVA |REGIONAL )?DE LA (OFICINA|UNIDAD|DIRECCION|SUB DIRECCION|SUBDIRECCION) (.+)$/, "$2 $3"],
  [/^DIRECTORA? (REGIONAL|GENERAL|EJECUTIVO|EJECUTIVA)( SECTORIAL)? DE (.+)$/, "DIRECCION $1 DE $3"],
  [/^SUB ?DIRECTORA? DE (.+)$/, "SUB DIRECCION DE $1"],
  [/^DIRECTORA? DE (.+)$/, "DIRECCION DE $1"],
  [/^JEF[EA] DE (LA |EL )?(OFICINA|UNIDAD|AREA|DIVISION|DEPARTAMENTO|ORGANO) (.+)$/, "$2 $3"],
  [/^JEF[EA] DEL (ORGANO|DEPARTAMENTO|AREA) (.+)$/, "$1 $2"],
  [/^GOBERNADORA? REGIONAL$/, "GOBERNACION REGIONAL"],
  [/^VICE ?GOBERNADORA? REGIONAL$/, "VICEGOBERNACION REGIONAL"],
  [/^ALCALDE(SA)?( PROVINCIAL| DISTRITAL)?$/, "ALCALDIA"],
  [/^SECRETARI[OA] GENERAL$/, "SECRETARIA GENERAL"],
  [/^PROCURADORA? PUBLICA?( REGIONAL| MUNICIPAL)?$/, "PROCURADURIA PUBLICA$1"],
  [/^MINISTR[OA] DE (.+)$/, "DESPACHO MINISTERIAL"],
  [/^VICE ?MINISTR[OA] DE (.+)$/, "DESPACHO VICEMINISTERIAL DE $1"],
  [/^RECTORA?$/, "RECTORADO"],
];
/** Los cargos de jefatura (para la planilla: quién encabeza la oficina). */
export const ES_JEFATURA = /^(SUB ?GERENTE|GERENTE|SUB ?DIRECTORA?|DIRECTORA?|JEF[EA]|GOBERNADORA?|VICE ?GOBERNADORA?|ALCALDE(SA)?|TENIENTE ALCALDE|SECRETARI[OA] GENERAL|PROCURADORA?|MINISTR[OA]|VICE ?MINISTR[OA]|PRESIDENT[EA]|RECTORA?|VICE ?RECTORA?|DECAN[OA]|ADMINISTRADORA?|SUPERINTENDENTE|CONTRALORA?)\b/;

/** La oficina que encabeza quien declara ese cargo («GERENTE REGIONAL DE INFRAESTRUCTURA» → GERENCIA REGIONAL DE INFRAESTRUCTURA). */
export function oficinaDeCargo(cargo: string): string | null {
  const c = norm(cargo).replace(/\s+(I|II|III|IV|V|VI)$/, "");
  for (const [re, rep] of ROL) {
    if (!re.test(c)) continue;
    const o = canon(c.replace(re, rep)).texto;
    return ORGANO.test(o) && o.split(" ").length >= 2 ? o : null;
  }
  return null;
}

// ─── Dependencias de la planilla ─────────────────────────────────────────────

/** Un tramo que empieza por un tipo de órgano o que es una sigla: puede ser la oficina de la que depende. */
const PARECE_OFICINA = /^(SUB ?GERENCIA|GERENCIA|SUB ?DIRECCION|DIRECCION|OFICINA|UNIDAD|DEPARTAMENTO|DIVISION|AREA|ALCALDIA|GOBERNACION|SECRETARIA|PROCURADURIA|ORGANO|COORDINACION|JEFATURA|DESPACHO|PRESIDENCIA|VICEMINISTERIO)\b/;

/**
 * «SUBGERENCIA DE INFRAESTRUCTURA - GERENCIA DE DESARROLLO TERRITORIAL E INFRAESTRUCTURA» → [la subgerencia, la gerencia]:
 * la planilla escribe de quién depende. Un tramo que no parece una oficina («DIRESA - LA LIBERTAD») queda en el nombre.
 */
export function partirDependencia(dep: string): string[] {
  const limpio = dep.replace(/\bSUB\s*-\s*(GERENCIA|DIRECCION)/gi, "SUB$1");
  const tramos = limpio.split(/\s*-\s*/).map((t) => t.trim()).filter(Boolean);
  if (tramos.length < 2) return [dep.trim()];
  const out: string[] = [tramos[0]];
  for (const t of tramos.slice(1)) {
    const n = canon(t).texto;
    if (PARECE_OFICINA.test(n) || esSigla(t)) out.push(t);
    else out[out.length - 1] = `${out[out.length - 1]} - ${t}`;
  }
  return out;
}

// ─── Nivel y función ─────────────────────────────────────────────────────────

const ALTA = /^(GOBERNACION|VICEGOBERNACION|ALCALDIA|DESPACHO (MINISTERIAL|PRESIDENCIAL|DE ALCALDIA)|PRESIDENCIA( EJECUTIVA| DEL CONSEJO DIRECTIVO)?$|CONCEJO MUNICIPAL|CONSEJO (REGIONAL|DIRECTIVO|UNIVERSITARIO)|ASAMBLEA UNIVERSITARIA|GERENCIA (GENERAL|MUNICIPAL)( REGIONAL)?$|SECRETARIA GENERAL|JEFATURA( INSTITUCIONAL| NACIONAL)?$|VICEMINISTERIO|DESPACHO VICEMINISTERIAL|RECTORADO)/;
const NIVEL2 = /^(GERENCIA|DIRECCION (GENERAL|REGIONAL|EJECUTIVA|NACIONAL)|OFICINA (GENERAL|REGIONAL)|PROCURADURIA|ORGANO DE CONTROL|OFICINA DE CONTROL INSTITUCIONAL)\b/;
const NIVEL3 = /^(SUB GERENCIA|SUB DIRECCION|OFICINA|UNIDAD|DIRECCION|DIVISION|DEPARTAMENTO|AREA|COORDINACION|JEFATURA)\b/;

export function nivelDe(nombre: string): Nivel {
  const n = canon(nombre).texto;
  if (ALTA.test(n)) return 1;
  if (NIVEL2.test(n)) return 2;
  if (NIVEL3.test(n)) return 3;
  return 4;
}

const FUNCIONES: [Funcion, RegExp][] = [
  ["alta_direccion", /\b(ALCALDIA|GOBERNACION|DESPACHO|PRESIDENCIA|GERENCIA (GENERAL|MUNICIPAL)|SECRETARIA GENERAL|JEFATURA (INSTITUCIONAL|NACIONAL)|VICEMINISTERIO|CONSEJO (MUNICIPAL|REGIONAL)|CONCEJO MUNICIPAL)\b/],
  ["compras", /\b(LOGISTICA|ABASTECIMIENTO|ADQUISICIONES|CONTRATACIONES|COMPRAS|BIENES Y SERVICIOS|ALMACEN)\b/],
  ["presupuesto", /\b(PRESUPUESTO|PLANEAMIENTO|PLANIFICACION|PROGRAMACION|INVERSIONES|PREINVERSION|MODERNIZACION)\b/],
  ["personal", /\b(RECURSOS HUMANOS|PERSONAL|TALENTO|GESTION HUMANA)\b/],
  ["legal", /\b(ASESORIA JURIDICA|ASUNTOS JURIDICOS|PROCURADURIA|LEGAL)\b/],
  ["control", /\b(CONTROL INSTITUCIONAL|AUDITORIA|INTEGRIDAD|OCI)\b/],
  ["obras", /\b(OBRAS|INFRAESTRUCTURA|DESARROLLO URBANO|PROYECTOS|ESTUDIOS|SUPERVISION|LIQUIDACION|EQUIPO MECANICO)\b/],
  ["finanzas", /\b(ADMINISTRACION|TESORERIA|CONTABILIDAD|FINANZAS|ECONOMIA|RENTAS|RECAUDACION)\b/],
];
export function funcionDe(nombre: string): Funcion {
  const n = canon(nombre).texto;
  for (const [f, re] of FUNCIONES) if (re.test(n)) return f;
  return "otras";
}

// ─── Plantillas y leyes ──────────────────────────────────────────────────────

interface OrganoPlantilla { id: string; nombre: string | null; depende: string | null; funciones: string | null; base: string | null; estado: string | null }
interface CargoPlantilla { id: string; nombre: string | null; organo: string | null; designa: string | null; base: string | null; estado: string | null }
interface RelacionPlantilla { tipo: string; de: string; a: string; texto: string | null; estado: string | null }
interface Plantilla { nombre: string | null; aplica: string | null; organos: OrganoPlantilla[]; cargos: CargoPlantilla[]; relaciones: RelacionPlantilla[] }
interface OrganoRof { id: string; nombre: string | null; tipo: string | null; padre: string | null; nivel: number | null; funciones: string | null; norma: string | null; fuente: string | null; url: string | null }

const PLANTILLAS = (estado as unknown as { plantillas: Record<string, Plantilla> }).plantillas;
const ADSCRITOS = (estado as unknown as { adscritos: { entidad: string; organismo: string | null; sigla: string | null; ministerio: string; calificacion: string | null; url: string | null }[] }).adscritos ?? [];
/** Los organismos adscritos a un ministerio (su nodo en el grafo), con su calificación y la norma. */
export const adscritosDe = (nodoMinisterio: string | null) => (nodoMinisterio ? ADSCRITOS.filter((a) => a.ministerio === nodoMinisterio) : []);
const ROF = (estado as unknown as { rof: Record<string, { entidad: string | null; organos: OrganoRof[] }> }).rof;

/** El nombre corto de cada plantilla y la ley que la funda (con su texto oficial). */
const LEY_PLANTILLA: Record<PlantillaId, { corto: string; ley: Enlace }> = {
  "TPL-GR": { corto: "Gobierno regional", ley: { texto: "Ley Orgánica de Gobiernos Regionales (Ley 27867)", url: "https://leyes.congreso.gob.pe/Documentos/Leyes/27867.pdf" } },
  "TPL-GL": { corto: "Municipalidad", ley: { texto: "Ley Orgánica de Municipalidades (Ley 27972)", url: "https://leyes.congreso.gob.pe/Documentos/Leyes/27972.pdf" } },
  "TPL-MIN": { corto: "Ministerio", ley: { texto: "Ley Orgánica del Poder Ejecutivo (Ley 29158)", url: "https://leyes.congreso.gob.pe/Documentos/Leyes/29158.pdf" } },
  "TPL-OPE": { corto: "Organismo público ejecutor", ley: { texto: "Ley Orgánica del Poder Ejecutivo (Ley 29158)", url: "https://leyes.congreso.gob.pe/Documentos/Leyes/29158.pdf" } },
  "TPL-OPT": { corto: "Organismo técnico especializado", ley: { texto: "Ley Orgánica del Poder Ejecutivo (Ley 29158)", url: "https://leyes.congreso.gob.pe/Documentos/Leyes/29158.pdf" } },
  "TPL-OPR": { corto: "Organismo regulador", ley: { texto: "Ley Orgánica del Poder Ejecutivo (Ley 29158)", url: "https://leyes.congreso.gob.pe/Documentos/Leyes/29158.pdf" } },
  "TPL-UNIV": { corto: "Universidad pública", ley: { texto: "Ley Universitaria (Ley 30220)", url: "https://leyes.congreso.gob.pe/Documentos/Leyes/30220.pdf" } },
};

/**
 * La ley que cita una base legal, con su texto oficial (archivo del Congreso; verificados el 2026-10-27). El artículo 29-A
 * de la LOGR lo agregó la Ley 27902 y el 11 lo cambió la 30305: se enlaza la que lo trae.
 */
export function leyDe(base: string | null | undefined): Enlace | null {
  const b = base ?? "";
  const congreso = (n: string) => `https://leyes.congreso.gob.pe/Documentos/Leyes/${n}.pdf`;
  if (/29-A/.test(b)) return { texto: `${b} (Ley 27902)`, url: congreso("27902") };
  if (/30305/.test(b)) return { texto: b, url: congreso("30305") };
  if (/LOGR/.test(b)) return { texto: b, url: congreso("27867") };
  if (/LOM\b/.test(b)) return { texto: b, url: congreso("27972") };
  if (/LOPE/.test(b)) return { texto: b, url: congreso("29158") };
  if (/30220/.test(b)) return { texto: b, url: congreso("30220") };
  if (/32069/.test(b)) return { texto: b, url: "https://leyes.congreso.gob.pe/Documentos/2021_2026/ADLP/Texto_Consolidado/32069-TXM.pdf" };
  if (/27785/.test(b)) return { texto: b, url: congreso("27785") };
  if (/Constituci/.test(b)) return { texto: b, url: "https://cdn.www.gob.pe/uploads/document/file/9139522/7498785-constitucion-politica_2025-final-dic-2025.pdf" };
  return b ? { texto: b, url: null } : null;
}

/** La plantilla por el nombre de la entidad, cuando no está en el grafo (las unidades de un gobierno regional no tienen). */
export function plantillaPorNombre(nombre: string): PlantillaId | null {
  const n = norm(nombre);
  if (/^MUNICIPALIDAD (PROVINCIAL|DISTRITAL|METROPOLITANA|DE CENTRO POBLADO)?/.test(n) && !/ - /.test(nombre)) return "TPL-GL";
  if (/^GOBIERNO REGIONAL\b/.test(n) && (!/ - /.test(nombre) || /SEDE CENTRAL/.test(n))) return "TPL-GR";
  if (/^MINISTERIO\b/.test(n)) return "TPL-MIN";
  if (/^UNIVERSIDAD NACIONAL\b/.test(n)) return "TPL-UNIV";
  return null;
}

/** Los órganos de la ley con un nombre corto para mostrar (el libro trae «Gerencia General o la que haga sus veces»). */
const NOMBRE_ORGANO: Record<string, string> = {
  "TPL-GL-OCI": "Órgano de Control Institucional",
  "TPL-MIN-DVM": "Despachos viceministeriales",
  "TPL-MIN-ADM": "Órganos de administración interna",
  "TPL-MIN-LIN": "Órganos de línea",
  "TPL-OPE-GG": "Gerencia General",
  "TPL-OPT-GG": "Gerencia General",
  "TPL-OPR-GG": "Gerencia General",
  "TPL-UNIV-FAC": "Facultades",
};
/** Los agrupadores (no son una oficina): sólo se muestran si algo cuelga de ellos. */
const GRUPOS = new Set(["TPL-MIN-ADM", "TPL-MIN-LIN", "TPL-MIN-DVM", "TPL-UNIV-FAC"]);

/**
 * Las reglas de la ley para lo que la plantilla no nombra uno por uno: en un gobierno regional, toda gerencia regional
 * depende de la Gerencia General Regional (la designa el gobernador, LOGR art. 21 c); en un ministerio, las oficinas
 * generales cuelgan de la Secretaría General (órganos de administración interna, LOPE art. 24) y las direcciones generales
 * de los despachos viceministeriales (órganos de línea, art. 24).
 */
const REGLAS_LEY: Partial<Record<PlantillaId, { re: RegExp; padre: string; texto: string; base: string }[]>> = {
  "TPL-GR": [
    { re: /^GERENCIA REGIONAL DE /, padre: "TPL-GR-GGR", texto: "Las gerencias regionales dependen de la Gerencia General Regional; a sus gerentes los designa el gobernador", base: "LOGR arts. 21 c y 26" },
    { re: /^GERENCIA GENERAL( REGIONAL)?$/, padre: "TPL-GR-GOB", texto: "La Gerencia General Regional depende de la Gobernación Regional", base: "LOGR arts. 21 c y 26" },
    { re: /^VICEGOBERNACION/, padre: "TPL-GR-GOB", texto: "El vicegobernador acompaña al gobernador en la Gobernación Regional", base: "LOGR art. 11 (Ley 30305)" },
  ],
  "TPL-GL": [
    { re: /^GERENCIA MUNICIPAL$/, padre: "TPL-GL-ALC", texto: "La Gerencia Municipal depende de la Alcaldía: el alcalde designa al gerente municipal", base: "LOM arts. 26–28" },
    { re: /^(OFICINA (GENERAL )?DE )?ASESORIA JURIDICA$/, padre: "TPL-GL-GM", texto: "La asesoría jurídica es parte de la estructura administrativa básica, bajo la Gerencia Municipal", base: "LOM art. 28" },
    { re: /^(OFICINA (GENERAL )?DE )?(PLANEAMIENTO|PLANIFICACION) Y PRESUPUESTO$/, padre: "TPL-GL-GM", texto: "Planeamiento y presupuesto es parte de la estructura administrativa básica, bajo la Gerencia Municipal", base: "LOM art. 28" },
    { re: /^PROCURADURIA PUBLICA/, padre: "TPL-GL-ALC", texto: "La Procuraduría Pública Municipal: al procurador lo designa el alcalde", base: "LOM arts. 28–29" },
  ],
  "TPL-MIN": [
    { re: /^(DESPACHO VICEMINISTERIAL|VICEMINISTERIO)/, padre: "TPL-MIN-DVM", texto: "Cada despacho viceministerial es parte de la alta dirección, bajo el Despacho Ministerial", base: "LOPE arts. 24 y 26" },
    { re: /^SECRETARIA GENERAL$/, padre: "TPL-MIN-DM", texto: "La Secretaría General depende del Despacho Ministerial", base: "LOPE arts. 24 y 27" },
    { re: /^OFICINA GENERAL /, padre: "TPL-MIN-SG", texto: "La LOPE ubica a los órganos de administración interna bajo la Secretaría General; su ROF puede precisarlo", base: "LOPE arts. 3 y 24.3" },
    { re: /^DIRECCION GENERAL /, padre: "TPL-MIN-LIN", texto: "Las direcciones generales son órganos de línea: dependen de los despachos viceministeriales", base: "LOPE art. 24.4" },
  ],
};

/**
 * Lo que la LOGR (art. 29-A, Ley 27902) le asigna a cada gerencia regional: una dirección regional sectorial o una
 * subgerencia de ese tema cuelga, inferido, de la gerencia que tiene la función.
 */
const SECTORES_GR: { re: RegExp; gerencia: RegExp; texto: string }[] = [
  { re: /\b(INDUSTRIA|COMERCIO|TURISMO|ARTESANIA|PESQUERIA|PRODUCCION|MINERIA|MINAS|ENERGIA|HIDROCARBUROS|AGRICULTURA|AGRARIA|IRRIGACION|RIEGO)\b/, gerencia: /^GERENCIA REGIONAL DE DESARROLLO ECONOMICO/, texto: "Desarrollo Económico (industria, comercio, turismo, pesquería, minería, energía y agricultura)" },
  { re: /\b(EDUCACION|EDUCATIVA|CULTURA|DEPORTES|SALUD|HOSPITAL|VIVIENDA|TRABAJO|EMPLEO|POBLACION|SANEAMIENTO|DESARROLLO SOCIAL|IGUALDAD)\b/, gerencia: /^GERENCIA REGIONAL DE DESARROLLO SOCIAL/, texto: "Desarrollo Social (educación, cultura, salud, vivienda, trabajo y promoción del empleo)" },
  { re: /\b(VIALIDAD|TRANSPORTES|TELECOMUNICACIONES|CONSTRUCCION)\b/, gerencia: /^GERENCIA REGIONAL DE INFRAESTRUCTURA/, texto: "Infraestructura (vialidad, transportes, comunicaciones y construcción)" },
  { re: /\b(RECURSOS NATURALES|MEDIO AMBIENTE|AMBIENTAL|AREAS PROTEGIDAS|DEFENSA CIVIL)\b/, gerencia: /^GERENCIA REGIONAL DE RECURSOS NATURALES/, texto: "Recursos Naturales y Gestión del Medio Ambiente (áreas protegidas, medio ambiente y defensa civil)" },
  { re: /\b(PLANEAMIENTO|PRESUPUESTO|ACONDICIONAMIENTO TERRITORIAL|PROGRAMACION|INVERSIONES|PREINVERSION|ESTADISTICA|DESARROLLO INSTITUCIONAL)\b/, gerencia: /^GERENCIA REGIONAL DE PLANEAMIENTO/, texto: "Planeamiento, Presupuesto y Acondicionamiento Territorial" },
];

/** Palabras que no distinguen una oficina de otra al buscarle el padre por su nombre. */
const GENERICAS = new Set(["GERENCIA", "SUB", "DIRECCION", "OFICINA", "UNIDAD", "REGIONAL", "GENERAL", "DESARROLLO", "GESTION", "SERVICIOS",
  "MUNICIPAL", "PROGRAMA", "AREA", "DIVISION", "DEPARTAMENTO", "COORDINACION", "NACIONAL", "PUBLICA", "PUBLICO", "FUNCIONAL", "EJECUTIVA",
  "PROVINCIAL", "DISTRITAL", "ZONAL", "SECTORIAL", "JEFATURA", "INSTITUCIONAL"]);

// ─── Armado ──────────────────────────────────────────────────────────────────

/** La función que cubre a otra: compras, personal y finanzas cuelgan de la administración. */
const FUNCION_PADRE: Partial<Record<Funcion, Funcion[]>> = {
  compras: ["compras", "finanzas"],
  personal: ["personal", "finanzas"],
  finanzas: ["finanzas"],
  presupuesto: ["presupuesto"],
  obras: ["obras"],
  legal: ["legal"],
};

/** El agrupador de las oficinas que ningún dato ubica: su dependencia no la dicen la planilla, su ROF ni la ley. */
export const SIN_DEPENDENCIA = "SIN DEPENDENCIA EN LOS DATOS";

const vacio = (id: string, nombre: string): NodoOrg => ({
  id, nombre, sigla: null, expansion: null, nivel: nivelDe(nombre), funcion: funcionDe(nombre), grupo: false, padre: null, arista: null,
  evidencias: [], jefes: [], dependencias: [], personas: 0, planilla: 0, cas: 0, conSenales: 0, altas: 0, conFamilia: 0, visitas: 0,
  ultimaVisita: null, rol: null, enDatos: false, cortado: false, ruc: null,
});

/** Distancia de edición entre dos textos, o más que `tope` (se corta apenas lo pasa). */
export function distancia(a: string, b: string, tope = 2): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let min = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < min) min = cur[j];
    }
    if (min > tope) return tope + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Los números (y los romanos) de un nombre: «UGEL 01» y «UGEL 02», o «DIRECCION I» y «DIRECCION II», no son la misma. */
const numeros = (s: string) => (s.match(/\b(\d+|I{1,3}|IV|V|VI{1,3}|IX|X)\b/g) ?? []).join(" ");

/**
 * ¿«a» es «b» cortado? El Portal de Transparencia corta la dependencia a 45 caracteres en algunas entidades («DIRECCION
 * GENERAL DE INTERVENCIONES ESTRATEGI»): todas sus palabras son las de «b» y la última va a medias ('parcial'), o el
 * corte cayó justo entre dos palabras ('borde': «…MEDICAMENTOS INSUMOS Y»). El borde no prueba nada por sí solo: «SUB
 * GERENCIA DE FISCALIZACION ADMINISTRATIVA» no es «… Y POLICIA MUNICIPAL» de otra municipalidad.
 */
export function esCortado(a: string, b: string): "parcial" | "borde" | null {
  const wa = a.split(" ");
  const wb = b.split(" ");
  if (a.length < 30 || wa.length > wb.length || b.length <= a.length) return null;
  for (let i = 0; i < wa.length - 1; i++) if (wa[i] !== wb[i]) return null;
  const ult = wa[wa.length - 1];
  const suya = wb[wa.length - 1];
  if (!suya.startsWith(ult)) return null;
  return ult === suya ? "borde" : "parcial";
}

export function armarOrganigrama(d: DatosOrganigrama): Organigrama {
  const ctx = { region: d.entidad.region, nivelGobierno: d.entidad.nivelGobierno };
  const plantillaId = d.plantilla ?? plantillaPorNombre(d.entidad.nombre);
  const plantilla = plantillaId ? PLANTILLAS[plantillaId] : null;
  const rof = d.nodoGrafo ? ROF[d.nodoGrafo] : undefined;

  // 1. Los nombres completos con que se leen las siglas: los de la entidad pesan más que los de otras.
  const deCargos = d.cargos.map((c) => ({ c, oficina: oficinaDeCargo(c.cargo) }));
  const candidatos: Candidato[] = [
    ...deCargos.filter((x) => x.oficina).map((x) => ({ nombre: x.oficina!, como: "dji" as const, peso: 40 })),
    ...d.oficinas.flatMap((o) => partirDependencia(o.dependencia)).filter((t) => !esSigla(t)).map((t) => ({ nombre: t, como: "planilla" as const, peso: 35 })),
    ...(plantilla?.organos ?? []).filter((o) => o.nombre).map((o) => ({ nombre: o.nombre!, como: "ley" as const, peso: 30 })),
    ...(rof?.organos ?? []).filter((o) => o.nombre).map((o) => ({ nombre: o.nombre!, como: "rof" as const, peso: 38 })),
    ...d.globales.flatMap((g) => {
      const nombre = g.fuente === "dji" ? oficinaDeCargo(g.texto) : g.texto;
      return nombre ? [{ nombre, como: "global" as const, peso: 5 + Math.min(15, Math.log2(1 + g.entidades) * 2) }] : [];
    }),
  ].map((c) => ({ ...c, ws: palabras(c.nombre) }));

  const nodos = new Map<string, NodoOrg>();
  /** Los nodos que se juntaron con otro: la llave vieja apunta a la nueva. */
  const alias = new Map<string, string>();
  const real = (id: string) => { let k = id; while (alias.has(k)) k = alias.get(k)!; return k; };
  /** El nodo de un nombre (lo crea si no está): por su llave canónica. */
  const nodo = (nombre: string, mostrar?: string): NodoOrg => {
    const k = real(claveOrgano(nombre) || norm(nombre));
    let n = nodos.get(k);
    if (!n) {
      n = vacio(k, mostrar ?? canon(nombre).texto);
      nodos.set(k, n);
    } else if (mostrar) n.nombre = mostrar;
    return n;
  };
  /** Un nombre de la planilla, con su sigla o abreviatura resuelta. */
  const leer = (texto: string): { nombre: string; sigla: string | null; expansion: NodoOrg["expansion"] } => {
    if (esSigla(texto)) {
      const e = expandirSigla(texto, candidatos, ctx);
      if (e) return { nombre: e.nombre, sigla: texto.trim(), expansion: { como: e.como, alternativas: e.alternativas } };
      return { nombre: norm(texto), sigla: null, expansion: null };
    }
    const c = canon(texto);
    return { nombre: c.texto, sigla: c.abreviado ? texto.trim() : null, expansion: c.abreviado ? { como: "abreviatura", alternativas: [] } : null };
  };
  /** Las dependencias que dicen los datos (planilla y ROF): se aplican después de juntar los nombres repetidos. */
  const pendientes: { hijo: string; padre: string; arista: NonNullable<NodoOrg["arista"]> }[] = [];
  const mes = d.mesPlanilla ? ` de ${d.mesPlanilla}` : "";

  // 2. La planilla: cada dependencia, su oficina y, si la escribe, de quién depende.
  for (const o of d.oficinas) {
    const cadena = partirDependencia(o.dependencia).map((t) => {
      const l = leer(t);
      const n = nodo(l.nombre);
      if (l.sigla && !n.sigla) { n.sigla = l.sigla; n.expansion = l.expansion; }
      n.enDatos = true;
      return n;
    });
    const propia = cadena[0];
    propia.dependencias.push(o.dependencia);
    propia.personas += o.personas;
    propia.planilla += o.planilla;
    propia.cas += o.cas;
    propia.conSenales += o.conSenales;
    propia.altas += o.altas;
    propia.conFamilia += o.conFamilia;
    for (const j of o.jefes) if (!propia.jefes.some((x) => x.nombre === j.nombre)) propia.jefes.push(j);
    if (!propia.evidencias.some((e) => e.tipo === "planilla")) {
      propia.evidencias.push({ tipo: "planilla", texto: `Su planilla${mes} la escribe «${o.dependencia}»`, url: d.enlaces.planilla });
    }
    for (let i = 0; i + 1 < cadena.length; i++) {
      pendientes.push({ hijo: cadena[i].id, padre: cadena[i + 1].id, arista: { tipo: "planilla", texto: `La planilla escribe la dependencia como «${o.dependencia}»`, url: d.enlaces.planilla } });
    }
  }

  // 3. La DJI: las jefaturas vigentes, cada una su oficina y quien la encabeza.
  for (const { c, oficina } of deCargos) {
    if (!oficina) continue;
    const n = nodo(oficina);
    n.enDatos = true;
    if (!n.jefes.some((j) => j.nombre === c.nombre)) n.jefes.push({ nombre: c.nombre, cargo: c.cargo, ficha: c.ficha, fuente: "dji", desde: c.desde });
    if (!n.evidencias.some((e) => e.tipo === "dji")) {
      n.evidencias.push({ tipo: "dji", texto: `Su jefatura declara el cargo «${norm(c.cargo)}» en la declaración jurada de intereses`, url: d.enlaces.dji });
    }
  }

  // 4. El ROF leído (si lo hay): sus órganos y de quién depende cada uno, con la norma publicada.
  const porRof = new Map<string, NodoOrg>();
  for (const o of rof?.organos ?? []) {
    if (!o.nombre) continue;
    const n = nodo(o.nombre, o.nombre);
    n.enDatos = true;
    n.evidencias.push({ tipo: "rof", texto: o.norma ? `Lo nombra ${o.norma}` : "Lo nombra su ROF", url: o.url });
    porRof.set(o.id, n);
  }
  for (const o of rof?.organos ?? []) {
    const n = porRof.get(o.id);
    const p = o.padre ? porRof.get(o.padre) : undefined;
    if (n && p) pendientes.push({ hijo: n.id, padre: p.id, arista: { tipo: "rof", texto: o.norma ? `Según ${o.norma}` : "Según su ROF", url: o.url } });
  }

  // 5. La ley: sus órganos (aunque no estén en los datos). Se reconocen también sin «general»: la «Oficina de Asesoría
  // Jurídica» de la LOM es la «Oficina General de Asesoría Jurídica» de su planilla (y conserva su nombre).
  const sinGeneral = (k: string) => k.split(" ").filter((w) => w !== "GENERAL").join(" ");
  const porLey = new Map<string, NodoOrg>();
  for (const o of plantilla?.organos ?? []) {
    if (!o.nombre) continue;
    const mostrar = NOMBRE_ORGANO[o.id] ?? o.nombre;
    const k = claveOrgano(mostrar);
    const pariente = nodos.has(real(k)) ? undefined : [...nodos.values()].find((x) => x.enDatos && sinGeneral(x.id) === sinGeneral(k));
    const n = pariente ?? nodo(mostrar, mostrar);
    n.grupo = GRUPOS.has(o.id);
    const ley = leyDe(o.base);
    n.evidencias.push({ tipo: "ley", texto: `La ley lo pide para todo ${LEY_PLANTILLA[plantillaId!].corto.toLowerCase()}${o.base ? ` (${o.base})` : ""}`, url: ley?.url ?? null });
    porLey.set(o.id, n);
  }

  // 6. Los nombres repetidos se juntan: el cortado por el portal con el entero, el que tiene una errata con el bien escrito.
  const juntar = (de: NodoOrg, en: NodoOrg) => {
    if (de === en) return;
    en.personas += de.personas; en.planilla += de.planilla; en.cas += de.cas;
    en.conSenales += de.conSenales; en.altas += de.altas; en.conFamilia += de.conFamilia;
    for (const j of de.jefes) if (!en.jefes.some((x) => x.nombre === j.nombre)) en.jefes.push(j);
    for (const e of de.evidencias) if (!en.evidencias.some((x) => x.tipo === e.tipo && x.texto === e.texto)) en.evidencias.push(e);
    en.dependencias.push(...de.dependencias.filter((x) => !en.dependencias.includes(x)));
    if (!en.sigla && de.sigla) { en.sigla = de.sigla; en.expansion = de.expansion; }
    en.enDatos ||= de.enDatos;
    en.grupo &&= de.grupo;
    for (const [k, n] of porLey) if (n === de) porLey.set(k, en);
    for (const [k, n] of porRof) if (n === de) porRof.set(k, en);
    nodos.delete(de.id);
    alias.set(de.id, en.id);
  };
  {
    const lista = [...nodos.values()].map((n) => ({ n, t: canon(n.nombre).texto }));
    const inicio = (t: string) => t.split(" ").slice(0, 2).join(" ");
    const porDos = new Map<string, typeof lista>();
    for (const x of lista) porDos.set(inicio(x.t), [...(porDos.get(inicio(x.t)) ?? []), x]);
    // ¿Esta entidad publica sus dependencias cortadas? Si hay varias cortadas a media palabra, un corte justo entre dos
    // palabras también lo es (con 40 caracteres o más); si no, sólo cuentan las cortadas a media palabra.
    const parciales = lista.filter((a) => a.t.length >= 30 && (porDos.get(inicio(a.t)) ?? []).some((b) => esCortado(a.t, b.t) === "parcial")).length;
    const corta = (a: string, b: string) => {
      const c = esCortado(a, b);
      return c === "parcial" || (c === "borde" && parciales >= 3 && a.length >= 40);
    };
    // a. Cortados: con el único nombre entero que los continúa (o el más largo, si son el mismo cortado varias veces).
    for (const a of [...lista].sort((x, y) => x.t.length - y.t.length)) {
      if (!nodos.has(a.n.id) || a.t.length < 30) continue;
      const largos = (porDos.get(inicio(a.t)) ?? []).filter((b) => b !== a && nodos.has(b.n.id) && corta(a.t, b.t)).sort((x, y) => y.t.length - x.t.length);
      if (largos.length && largos.every((b) => b === largos[0] || esCortado(b.t, largos[0].t))) juntar(a.n, largos[0].n);
    }
    // Y el que sigue cortado, con su nombre entero si lo usa otra fuente (sus jefaturas en la DJI, otras entidades).
    const enteros = new Map<string, string[]>();
    for (const c of candidatos) {
      const t = canon(c.nombre).texto;
      enteros.set(inicio(t), [...(enteros.get(inicio(t)) ?? []), t]);
    }
    for (const a of lista) {
      if (!nodos.has(a.n.id) || a.t.length < 38 || a.n.nombre !== a.t) continue;
      const largos = [...new Set((enteros.get(inicio(a.t)) ?? []).filter((t) => corta(a.t, t)))].sort((x, y) => y.length - x.length);
      if (largos.length && largos.every((t) => t === largos[0] || esCortado(t, largos[0]))) a.n.nombre = largos[0];
      // Sin nombre entero en ninguna fuente, en una entidad cuyo portal corta: queda marcado.
      else if (parciales >= 3 && a.t.length >= 40 && a.n.dependencias.some((x) => x.length >= 43)) a.n.cortado = true;
    }
    // b. Erratas: el mismo tipo de órgano, una o dos letras de diferencia, los mismos números; queda el de más gente.
    const vivos = lista.filter((x) => nodos.has(x.n.id) && x.t.length >= 15);
    const porInicio = new Map<string, typeof vivos>();
    for (const x of vivos) {
      const k = x.t.split(" ")[0];
      porInicio.set(k, [...(porInicio.get(k) ?? []), x]);
    }
    for (const grupo of porInicio.values()) {
      grupo.sort((x, y) => x.t.length - y.t.length);
      for (let i = 0; i < grupo.length; i++) {
        for (let j = i + 1; j < grupo.length && grupo[j].t.length - grupo[i].t.length <= 2; j++) {
          const a = grupo[i], b = grupo[j];
          if (!nodos.has(a.n.id) || !nodos.has(b.n.id) || numeros(a.t) !== numeros(b.t)) continue;
          if (distancia(a.t, b.t, 2) > 2) continue;
          const [de, en] = a.n.personas > b.n.personas || (a.n.personas === b.n.personas && !b.n.enDatos) ? [b.n, a.n] : [a.n, b.n];
          juntar(de, en);
        }
      }
    }
  }

  const setPadre = (hijo: NodoOrg, padre: NodoOrg | null, arista: NonNullable<NodoOrg["arista"]>) => {
    if (hijo.padre || hijo === padre) return false;
    // Sin ciclos: el padre no puede colgar del hijo.
    for (let p = padre; p; p = p.padre ? nodos.get(p.padre) ?? null : null) if (p === hijo) return false;
    hijo.padre = padre ? padre.id : null;
    hijo.arista = arista;
    return true;
  };
  // 7. Las dependencias en orden de firmeza: el ROF (la norma), la ley (paso 8) y la planilla después (paso 8b): lo que la
  // ley ubica, como la asesoría jurídica de una municipalidad bajo la Gerencia Municipal, no lo mueve una planilla mal escrita.
  const aplicar = (t: "rof" | "planilla") => {
    for (const p of pendientes.filter((x) => x.arista.tipo === t)) {
      const h = nodos.get(real(p.hijo));
      const pa = nodos.get(real(p.padre));
      if (h && pa) setPadre(h, pa, p.arista);
    }
  };
  aplicar("rof");

  // 8. La ley: de quién depende cada órgano que nombra, y las reglas para los que no nombra uno por uno.
  if (plantilla) {
    for (const o of plantilla.organos) {
      const n = porLey.get(o.id);
      if (!n || !o.depende) continue;
      const padre = plantilla.organos.find((x) => x.nombre === o.depende);
      const p = padre ? porLey.get(padre.id) : undefined;
      const ley = leyDe(o.base);
      if (p) setPadre(n, p, { tipo: "ley", texto: `${n.nombre} depende de ${p.nombre}${o.base ? ` (${o.base})` : ""}`, url: ley?.url ?? null });
    }
    for (const r of REGLAS_LEY[plantillaId!] ?? []) {
      const p = porLey.get(r.padre);
      if (!p) continue;
      for (const n of nodos.values()) {
        if (n === p || n.grupo || !r.re.test(canon(n.nombre).texto)) continue;
        setPadre(n, p, { tipo: "ley", texto: `${r.texto} (${r.base})`, url: leyDe(r.base)?.url ?? null });
      }
    }
    // Titular y autoridad de la gestión administrativa (AGA, la que aprueba las contrataciones; Ley 32069 art. 25).
    for (const rel of plantilla.relaciones.filter((x) => x.tipo === "EJERCE_ROL")) {
      const cargo = plantilla.cargos.find((c) => c.id === rel.de);
      const organo = cargo?.organo ? plantilla.organos.find((o) => o.nombre === cargo.organo) : undefined;
      const n = organo ? porLey.get(organo.id) : undefined;
      if (!n) continue;
      if (rel.a === "ROL-TITULAR") n.rol = "titular";
      else if (rel.a === "ROL-AGA" && n.rol !== "titular") n.rol = "aga";
    }
  }

  // 8b. La planilla.
  aplicar("planilla");

  // 9. Lo que sigue sin padre: por su tema o su función (inferido) y, si no, por su nivel.
  const lista = () => [...nodos.values()];
  const titular = lista().find((n) => n.rol === "titular");
  const cabeza = (["TPL-GR-GGR", "TPL-GL-GM", "TPL-MIN-SG", "TPL-OPE-GG", "TPL-OPT-GG", "TPL-OPR-GG"] as const)
    .map((id) => porLey.get(id)).find(Boolean)
    ?? lista().find((n) => /^(GERENCIA GENERAL|GERENCIA MUNICIPAL|SECRETARIA GENERAL)/.test(canon(n.nombre).texto));
  const raices = new Set([...porLey.values()].filter((n) => !n.padre).map((n) => n.id));
  const huerfanas: NodoOrg[] = [];
  for (const n of lista()) {
    if (n.padre || n.grupo || raices.has(n.id)) continue;
    const c = canon(n.nombre).texto;
    // La alta dirección sin dato, junto a la titular (la Secretaría General de un gobierno regional, la vicegobernación).
    if (n.nivel === 1) {
      if (titular && titular !== n) setPadre(n, titular, { tipo: "nivel", texto: `Sin dato de su dependencia: la alta dirección se muestra junto a ${titular.nombre}`, url: null });
      continue;
    }
    const propias = new Set(palabras(c).filter((w) => !GENERICAS.has(w) && !OPCIONALES.has(w)));
    // a. Por su nombre: una oficina de nivel 3 o 4 con dos palabras propias en común con una sola de nivel 2.
    if (n.nivel >= 3) {
      const afines = lista().filter((p) => p !== n && !p.grupo && p.nivel === 2 &&
        palabras(p.nombre).filter((w) => propias.has(w)).length >= 2);
      if (afines.length === 1 && setPadre(n, afines[0], { tipo: "funcion", texto: `Inferido por su nombre: comparte el tema con ${afines[0].nombre}`, url: null })) continue;
    }
    // b. En un gobierno regional, por lo que la LOGR le asigna a cada gerencia (art. 29-A).
    if (plantillaId === "TPL-GR" && /^(DIRECCION REGIONAL|SUB GERENCIA)/.test(c)) {
      const s = SECTORES_GR.find((x) => x.re.test(c));
      const g = s ? lista().find((p) => p !== n && s.gerencia.test(canon(p.nombre).texto)) : undefined;
      if (s && g && setPadre(n, g, { tipo: "funcion", texto: `Inferido: la LOGR le asigna su tema a la Gerencia Regional de ${s.texto} (art. 29-A)`, url: leyDe("LOGR art. 29-A")?.url ?? null })) continue;
    }
    // c. Por su función: compras, tesorería o personal, en la oficina de administración; obras, en la de infraestructura.
    if (n.nivel >= 3) {
      const buscadas = FUNCION_PADRE[n.funcion];
      const p = buscadas
        ?.map((f) => lista().filter((x) => x !== n && !x.grupo && x.nivel === 2 && x.funcion === f).sort((a, b) => b.personas - a.personas)[0])
        .find(Boolean);
      if (p && setPadre(n, p, { tipo: "funcion", texto: `Inferido por su función: ${n.funcion === "obras" ? "las oficinas de obras dependen de la de infraestructura" : "dependen de la de administración"} en casi todos los ROF`, url: null })) continue;
    }
    // d. Sin dato: las de nivel 2, bajo la gerencia general (como en la mayoría de los ROF); las demás, aparte.
    if (n.nivel === 2 && cabeza && cabeza !== n) {
      setPadre(n, cabeza, { tipo: "nivel", texto: `Sin dato de su dependencia: se muestra bajo ${cabeza.nombre}, como en la mayoría de los ROF`, url: null });
      continue;
    }
    huerfanas.push(n);
  }
  if (huerfanas.length) {
    const g = vacio(SIN_DEPENDENCIA, "Oficinas sin dependencia en los datos");
    g.grupo = true;
    g.nivel = 4;
    g.funcion = "otras";
    nodos.set(g.id, g);
    for (const n of huerfanas) setPadre(n, g, { tipo: "nivel", texto: "Sin dato de su dependencia: su planilla, su ROF y la ley no la dicen", url: null });
  }

  // 9b. El gobierno entero: las unidades del gobierno regional con su propio RUC (salud, educación, hospitales, UGEL),
  // bajo la gerencia a la que la LOGR le asigna su tema (inferido), y los organismos adscritos al ministerio. Cada una
  // tiene su propia organización: se abre en su ficha.
  const unidades = d.unidades ?? [];
  const grupoUnidades = (id: string, nombre: string) => {
    let g = nodos.get(id);
    if (!g) {
      g = vacio(id, nombre);
      g.grupo = true;
      g.nivel = 2;
      g.funcion = "otras";
      nodos.set(id, g);
    }
    return g;
  };
  for (const u of unidades) {
    const corto = canon(u.nombre.replace(/^GOBIERNO REGIONAL[^-]*-\s*/i, "")).texto || canon(u.nombre).texto;
    const n = vacio(`RUC ${u.ruc}`, u.tipo === "adscrito" ? u.nombre : corto);
    n.ruc = u.ruc;
    n.enDatos = true;
    n.nivel = 3;
    n.personas = u.personas;
    n.evidencias.push({ tipo: "entidad", texto: u.tipo === "adscrito"
      ? `Es un organismo público adscrito al ministerio${u.calificacion ? ` (${u.calificacion.toLowerCase()})` : ""}, con su propio RUC y su propia organización`
      : "Es una unidad del gobierno regional con su propio RUC y su propia planilla", url: u.url ?? null });
    nodos.set(n.id, n);
    if (u.tipo === "adscrito") {
      setPadre(n, grupoUnidades("ORGANISMOS ADSCRITOS", "Organismos adscritos"), {
        tipo: "ley", texto: "Adscrito al ministerio según la calificación de los organismos públicos (DS 097-2021-PCM)", url: u.url ?? null,
      });
      continue;
    }
    const s = SECTORES_GR.find((x) => x.re.test(corto));
    const g = s ? lista().find((p) => !p.ruc && s.gerencia.test(canon(p.nombre).texto)) : undefined;
    if (s && g) {
      setPadre(n, g, { tipo: "funcion", texto: `Inferido: unidad del gobierno regional con su propio RUC; la LOGR le asigna su tema a la Gerencia Regional de ${s.texto} (art. 29-A)`, url: leyDe("LOGR art. 29-A")?.url ?? null });
    } else {
      setPadre(n, grupoUnidades("UNIDADES DEL GOBIERNO REGIONAL", "Otras unidades del gobierno regional"), {
        tipo: "nivel", texto: "Unidad del gobierno regional con su propio RUC: ningún dato dice de qué gerencia depende", url: null,
      });
    }
  }

  // 10. Las visitas por el área visitada (el nombre que escribe el registro, leído como las oficinas).
  let visitasSinOficina = 0;
  let visitasTotal = 0;
  for (const v of d.visitas) {
    visitasTotal += v.n;
    const l = leer(v.area);
    const n = nodos.get(real(claveOrgano(l.nombre)));
    if (!n) { visitasSinOficina += v.n; continue; }
    n.visitas += v.n;
    if (v.ultima && (!n.ultimaVisita || v.ultima > n.ultimaVisita)) n.ultimaVisita = v.ultima;
  }

  // 11. Los agrupadores de la ley que quedaron vacíos, fuera.
  for (const g of lista().filter((n) => n.grupo)) {
    if (!lista().some((n) => n.padre === g.id)) nodos.delete(g.id);
  }

  const out = lista().sort((a, b) => a.nivel - b.nivel || b.personas - a.personas || a.nombre.localeCompare(b.nombre));
  const reales = out.filter((n) => !n.grupo);
  return {
    plantilla: plantillaId ? { id: plantillaId, nombre: LEY_PLANTILLA[plantillaId].corto, ley: LEY_PLANTILLA[plantillaId].ley } : null,
    nodos: out,
    resumen: {
      oficinas: reales.filter((n) => n.enDatos).length,
      personas: reales.reduce((t, n) => t + n.personas, 0),
      jefaturas: reales.reduce((t, n) => t + n.jefes.length, 0),
      planilla: reales.reduce((t, n) => t + n.planilla, 0),
      siglas: reales.filter((n) => n.sigla).length,
      siglasExpandidas: reales.filter((n) => n.sigla && n.expansion).length,
      inferidas: reales.filter((n) => n.arista && (n.arista.tipo === "funcion" || n.arista.tipo === "nivel")).length,
      visitas: visitasTotal,
      visitasSinOficina,
      unidades: unidades.length,
    },
  };
}
