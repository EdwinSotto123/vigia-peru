/**
 * El onboarding de la app de Gobserva Empleo: una entrevista en forma de chat para quien busca trabajo en el Estado.
 *
 * Versión 2 (2026-11-08, el usuario: «me recomendó arquitecto de Java, mejora el formulario: que pida su CV, su
 * profesión…»). Empieza ofreciendo leer el CV (te propone las respuestas, no se guarda) y pregunta lo que decide si puedes
 * postular: tu CARRERA (se busca en la formación que pide cada plaza), tus estudios, tu experiencia, los PUESTOS que te
 * interesan (en el título, como palabra entera), dónde y desde qué sueldo, y cómo avisarte.
 *
 * Aquí lo puro (se prueba con node --test, sin «@/»): las preguntas, el catálogo de carreras con sus variantes y sus
 * puestos, cómo se dice cada respuesta, el perfil desde el CV y cómo se guarda: la búsqueda «Mi perfil», la alerta y la
 * consulta del calce (GET /empleo/calce).
 */

export const PREGUNTAS_EMPLEO = ["cv", "carrera", "estudios", "experiencia", "puestos", "lugar", "sueldo", "avisos"] as const;
export type PreguntaEmpleo = (typeof PREGUNTAS_EMPLEO)[number];

export type Estudios = "secundaria" | "tecnica" | "egresado" | "bachiller" | "titulo" | "posgrado";

export interface PerfilEmpleo {
  /** El nombre del perfil («Arquitectura»). */
  puesto: string;
  /** Tus carreras (del catálogo o escritas): se buscan en la formación que pide la plaza. */
  carreras: string[];
  /** Los puestos que te interesan: se buscan en el título de la plaza. */
  palabras: string[];
  tengo: Estudios | null;
  /** Tus años de experiencia: las plazas que piden eso o menos. null: cualquiera. */
  exp: number | null;
  /** La región como la pide la API («la-libertad»); null: todo el Perú. */
  region: string | null;
  sueldo: number | null;
  alerta: boolean;
  frecuencia: "semanal" | "diaria";
}

export const PERFIL_EMPLEO_VACIO: PerfilEmpleo = { puesto: "", carreras: [], palabras: [], tengo: null, exp: null, region: null, sueldo: null, alerta: true, frecuencia: "semanal" };

export const MAX_PALABRAS_EMPLEO = 10;
export const MAX_CARRERAS = 3;
/** El nombre de la búsqueda guardada que lleva el perfil (una por cuenta). */
export const NOMBRE_PERFIL = "Mi perfil";

export interface Carrera {
  nombre: string;
  /** Cómo la piden los avisos (cualquiera basta): «Contabilidad» o «Contador». */
  variantes: string[];
  /** Puestos que suelen ser de esa carrera (para sugerir). */
  puestos: string[];
}

/** Las carreras que más piden las plazas CAS (contadas en SERVIR el 2026-11-08), con sus puestos de siempre. */
export const CARRERAS: Carrera[] = [
  { nombre: "Derecho", variantes: ["derecho", "abogado"], puestos: ["abogado", "especialista legal", "asesor legal", "asistente legal"] },
  { nombre: "Contabilidad", variantes: ["contabilidad", "contador"], puestos: ["contador", "especialista en tesorería", "analista contable", "asistente contable"] },
  { nombre: "Administración", variantes: ["administración", "administrador"], puestos: ["asistente administrativo", "especialista administrativo", "especialista en logística", "analista de recursos humanos"] },
  { nombre: "Economía", variantes: ["economía", "economista"], puestos: ["economista", "especialista en presupuesto", "analista de planeamiento", "especialista en inversiones"] },
  { nombre: "Ingeniería civil", variantes: ["ingeniería civil", "ingeniero civil"], puestos: ["residente de obra", "supervisor de obra", "inspector de obra", "especialista en infraestructura"] },
  { nombre: "Arquitectura", variantes: ["arquitectura", "arquitecto"], puestos: ["arquitecto", "proyectista", "supervisor de obra", "especialista en edificaciones"] },
  { nombre: "Ingeniería de sistemas", variantes: ["ingeniería de sistemas", "informática", "computación", "ingeniería de software"], puestos: ["analista de sistemas", "desarrollador", "soporte técnico", "especialista en tecnologías de la información"] },
  { nombre: "Ingeniería industrial", variantes: ["ingeniería industrial", "ingeniero industrial"], puestos: ["especialista en procesos", "analista de logística", "especialista en abastecimiento"] },
  { nombre: "Ingeniería ambiental", variantes: ["ingeniería ambiental", "ingeniero ambiental"], puestos: ["especialista ambiental", "especialista en residuos sólidos", "fiscalizador ambiental"] },
  { nombre: "Agronomía", variantes: ["agronomía", "ingeniería agronómica", "ingeniería agrícola"], puestos: ["extensionista", "especialista agrario", "técnico agropecuario"] },
  { nombre: "Enfermería", variantes: ["enfermería", "enfermera", "enfermero"], puestos: ["enfermera", "enfermero"] },
  { nombre: "Medicina", variantes: ["medicina", "médico cirujano", "médico"], puestos: ["médico", "médico especialista", "médico cirujano"] },
  { nombre: "Obstetricia", variantes: ["obstetricia", "obstetra"], puestos: ["obstetra"] },
  { nombre: "Técnico en enfermería", variantes: ["técnico en enfermería", "técnica en enfermería"], puestos: ["técnico en enfermería", "técnico asistencial"] },
  { nombre: "Psicología", variantes: ["psicología", "psicólogo"], puestos: ["psicólogo", "psicóloga"] },
  { nombre: "Trabajo social", variantes: ["trabajo social", "trabajador social", "trabajadora social"], puestos: ["trabajadora social", "trabajador social", "promotor social"] },
  { nombre: "Educación", variantes: ["educación", "docente", "pedagogía"], puestos: ["docente", "promotor educativo", "especialista en educación"] },
  { nombre: "Comunicación", variantes: ["ciencias de la comunicación", "comunicación", "periodismo"], puestos: ["comunicador", "especialista en comunicaciones", "periodista"] },
];

/** Puestos para quien no tiene una carrera (secundaria o estudios técnicos). */
export const PUESTOS_SIN_CARRERA = ["auxiliar administrativo", "chofer", "conductor", "vigilante", "auxiliar de limpieza", "operario", "digitador", "notificador"];

const normalizar = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
/** ¿Dos textos iguales sin mirar tildes, mayúsculas ni espacios? */
export const igualEmpleo = (a: string, b: string) => normalizar(a) === normalizar(b);
const mayuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** La carrera del catálogo con ese nombre o una de sus variantes (null si es una escrita). */
export function carreraDe(texto: string): Carrera | null {
  const n = normalizar(texto);
  return CARRERAS.find((c) => normalizar(c.nombre) === n || c.variantes.some((v) => normalizar(v) === n)) ?? null;
}

/** Cómo se busca una carrera en la formación: sus variantes del catálogo o, si es escrita, ella misma. */
export const variantesDe = (texto: string) => carreraDe(texto)?.variantes ?? [texto.trim()];

/** Los puestos para sugerir: los de tus carreras (o los de quien no tiene carrera), sin repetir, hasta 10. */
export function puestosSugeridos(carreras: string[], ya: string[] = []): string[] {
  const base = carreras.length ? carreras.flatMap((c) => carreraDe(c)?.puestos ?? []) : PUESTOS_SIN_CARRERA;
  const r = [...ya];
  for (const x of base) if (!r.some((y) => normalizar(y) === normalizar(x))) r.push(x);
  return r.slice(0, Math.max(10, ya.length));
}

/** Suma una carrera escrita (con su nombre del catálogo si lo es), sin repetir y hasta el tope. */
export function agregarCarrera(actuales: string[], texto: string): string[] {
  const t = texto.trim().replace(/\s+/g, " ").slice(0, 60);
  if (t.length < 3) return actuales;
  const nombre = carreraDe(t)?.nombre ?? mayuscula(t);
  if (actuales.some((c) => normalizar(c) === normalizar(nombre)) || actuales.length >= MAX_CARRERAS) return actuales;
  return [...actuales, nombre];
}

/** Suma puestos escritos («archivo, trámite»): de 3 a 40 letras, sin repetir y hasta el tope. */
export function agregarPalabrasEmpleo(actuales: string[], texto: string): string[] {
  const r = [...actuales];
  const tiene = new Set(actuales.map(normalizar));
  for (const t of texto.split(/[,;\n]/)) {
    const w = t.trim().replace(/\s+/g, " ").toLowerCase();
    if (w.length < 3 || w.length > 40 || tiene.has(normalizar(w)) || r.length >= MAX_PALABRAS_EMPLEO) continue;
    tiene.add(normalizar(w));
    r.push(w);
  }
  return r;
}

export const ESTUDIOS: { valor: Estudios; etiqueta: string }[] = [
  { valor: "secundaria", etiqueta: "Secundaria completa" },
  { valor: "tecnica", etiqueta: "Estudios técnicos" },
  { valor: "egresado", etiqueta: "Universitario o egresado" },
  { valor: "bachiller", etiqueta: "Bachiller" },
  { valor: "titulo", etiqueta: "Título profesional" },
  { valor: "posgrado", etiqueta: "Maestría o doctorado" },
];

/** null: «5 años o más» (no filtra: puede postular a todas). */
export const EXPERIENCIAS: { valor: number | null; etiqueta: string }[] = [
  { valor: 0, etiqueta: "Sin experiencia" },
  { valor: 1, etiqueta: "1 año" },
  { valor: 2, etiqueta: "2 años" },
  { valor: 4, etiqueta: "3 a 4 años" },
  { valor: null, etiqueta: "5 años o más" },
];

/** Los años de experiencia del CV como una respuesta de la entrevista. */
export const experienciaDe = (anos: number): number | null => (anos <= 0 ? 0 : anos === 1 ? 1 : anos === 2 ? 2 : anos <= 4 ? 4 : null);

export const SUELDOS: { valor: number | null; etiqueta: string }[] = [
  { valor: null, etiqueta: "Cualquier sueldo" },
  { valor: 1500, etiqueta: "Desde S/ 1,500" },
  { valor: 2500, etiqueta: "Desde S/ 2,500" },
  { valor: 3500, etiqueta: "Desde S/ 3,500" },
  { valor: 5000, etiqueta: "Desde S/ 5,000" },
];

/** Lo que devuelve POST /gobserva/cuenta/cv (backend/api/src/lib/cv.ts). */
export interface CvLeido {
  carreras: string[];
  estudios: Estudios | null;
  anosExperiencia: number | null;
  anosSectorPublico: number | null;
  puestos: string[];
  region: string | null;
}

/** El perfil propuesto desde el CV: sus carreras (con el nombre del catálogo si lo son), grado, experiencia, puestos y región. */
export function perfilDesdeCv(p: PerfilEmpleo, cv: CvLeido): PerfilEmpleo {
  const carreras = cv.carreras.reduce<string[]>((xs, c) => agregarCarrera(xs, c), []);
  const palabras = agregarPalabrasEmpleo([], cv.puestos.join(","));
  return {
    ...p,
    carreras,
    palabras,
    puesto: carreras[0] ?? palabras[0] ?? p.puesto,
    tengo: cv.estudios ?? p.tengo,
    exp: cv.anosExperiencia != null ? experienciaDe(cv.anosExperiencia) : p.exp,
    region: cv.region ?? p.region,
  };
}

/** Las preguntas que el CV ya respondió (las demás se preguntan igual). */
export function respondidasPorCv(cv: CvLeido): PreguntaEmpleo[] {
  const r: PreguntaEmpleo[] = ["cv"];
  if (cv.carreras.length) r.push("carrera");
  if (cv.estudios) r.push("estudios");
  if (cv.anosExperiencia != null) r.push("experiencia");
  if (cv.puestos.length) r.push("puestos");
  return r;
}

/** «a», «a y b», «a, b y c»; con más de `max`, «a, b, c y 4 más». */
export function listaNaturalEmpleo(xs: string[], max = 4): string {
  if (xs.length === 0) return "";
  if (xs.length > max) return `${xs.slice(0, max - 1).join(", ")} y ${xs.length - (max - 1)} más`;
  if (xs.length === 1) return xs[0];
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/** Cómo se dice cada respuesta en la burbuja de quien responde. `region`: el nombre de una región desde su clave. */
export function textoRespuestaEmpleo(q: PreguntaEmpleo, p: PerfilEmpleo, region: (slug: string) => string, conCv: boolean): string {
  switch (q) {
    case "cv":
      return conCv ? "Te paso mi CV" : "Prefiero responder yo";
    case "carrera":
      return p.carreras.length ? listaNaturalEmpleo(p.carreras) : "No tengo una carrera";
    case "estudios":
      return ESTUDIOS.find((e) => e.valor === p.tengo)?.etiqueta ?? "Prefiero no filtrar por estudios";
    case "experiencia":
      return EXPERIENCIAS.find((e) => e.valor === p.exp)?.etiqueta ?? "5 años o más";
    case "puestos":
      return p.palabras.length ? listaNaturalEmpleo(p.palabras, 5) : "Cualquiera de mi carrera";
    case "lugar":
      return p.region ? region(p.region) : "Todo el Perú";
    case "sueldo":
      return SUELDOS.find((s) => s.valor === p.sueldo)?.etiqueta ?? `Desde S/ ${p.sueldo}`;
    case "avisos":
      return !p.alerta ? "No, yo entro a mirar" : p.frecuencia === "diaria" ? "Sí, cada mañana" : "Sí, cada semana";
  }
}

/**
 * La consulta del calce (GET /empleo/calce): las carreras con sus variantes («arquitectura;arquitecto|…»), los puestos,
 * los sugeridos que sólo se cuentan y los filtros.
 */
export function paramsCalce(p: PerfilEmpleo, otras: string[] = [], extra: Record<string, string | number> = {}): URLSearchParams {
  const q = new URLSearchParams();
  if (p.carreras.length) q.set("carreras", p.carreras.map((c) => variantesDe(c).join(";")).join("|"));
  if (p.palabras.length) q.set("palabras", p.palabras.join("|"));
  if (otras.length) q.set("otras", otras.join("|"));
  if (p.region) q.set("region", p.region);
  if (p.tengo) q.set("tengo", p.tengo);
  if (p.sueldo != null) q.set("sueldo", String(p.sueldo));
  if (p.exp != null) q.set("exp", String(p.exp));
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  return q;
}

/** Las carreras del catálogo que sólo se cuentan (las fichas de la entrevista), sin las ya elegidas. */
export const carrerasParaContar = (elegidas: string[]) =>
  CARRERAS.filter((c) => !elegidas.some((e) => igualEmpleo(e, c.nombre))).map((c) => c.variantes.join(";")).join("|");

/** El nombre del perfil si no lo escribiste: tu primera carrera o tu primer puesto. */
export const nombrePerfilEmpleo = (p: PerfilEmpleo) => p.carreras[0] ?? (p.palabras[0] ? mayuscula(p.palabras[0]) : "");

/** ¿Hay con qué buscar? (una carrera o un puesto). */
export const conQueBuscar = (p: PerfilEmpleo) => p.carreras.length > 0 || p.palabras.length > 0;

/** El perfil como la búsqueda «Mi perfil» (lo que se guarda en la cuenta) y de vuelta. Las carreras van por su nombre. */
export function aQueryPerfil(p: PerfilEmpleo): string {
  const q = new URLSearchParams();
  if (p.carreras.length) q.set("carreras", p.carreras.join("|"));
  if (p.palabras.length) q.set("palabras", p.palabras.join("|"));
  if (p.region) q.set("region", p.region);
  if (p.tengo) q.set("tengo", p.tengo);
  if (p.sueldo != null) q.set("sueldo", String(p.sueldo));
  if (p.exp != null) q.set("exp", String(p.exp));
  if (p.puesto) q.set("puesto", p.puesto);
  return q.toString();
}

const ESTUDIOS_VALIDOS = new Set<string>(ESTUDIOS.map((e) => e.valor));

export function dePerfilQuery(query: string): PerfilEmpleo {
  const q = new URLSearchParams(query);
  const num = (k: string) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  const lista = (k: string, max: number) => (q.get(k) ?? "").split("|").map((w) => w.trim()).filter(Boolean).slice(0, max);
  const tengo = q.get("tengo");
  const region = q.get("region");
  return {
    ...PERFIL_EMPLEO_VACIO,
    puesto: (q.get("puesto") ?? "").slice(0, 60),
    carreras: lista("carreras", MAX_CARRERAS),
    palabras: lista("palabras", MAX_PALABRAS_EMPLEO),
    tengo: tengo && ESTUDIOS_VALIDOS.has(tengo) ? (tengo as Estudios) : null,
    exp: num("exp"),
    region: region && /^[a-z-]{3,30}$/.test(region) ? region : null,
    sueldo: num("sueldo"),
  };
}

/**
 * La alerta del perfil, con los filtros de la lista de plazas (el texto pide TODAS sus palabras en el aviso): va la
 * primera carrera (como la piden los avisos) o el primer puesto, y los demás filtros; lo demás lo ordena «Para ti».
 */
export function aAlertaEmpleo(p: PerfilEmpleo): { nombre: string; filtros: Record<string, string | number> } {
  const filtros: Record<string, string | number> = {};
  const texto = p.carreras.length ? variantesDe(p.carreras[0])[0] : p.palabras[0];
  if (texto) filtros.q = texto;
  if (p.region) filtros.region = p.region;
  if (p.tengo) filtros.tengo = p.tengo;
  if (p.sueldo != null) filtros.sueldo = p.sueldo;
  if (p.exp != null) filtros.exp = p.exp;
  return { nombre: `${p.puesto.trim() || "Mi perfil"} (mi perfil)`.slice(0, 80), filtros };
}

/** La primera pregunta sin responder después de `desde` (o antes, si todas las siguientes están); null: todas listas. */
export function siguienteEmpleo(respondidas: ReadonlySet<PreguntaEmpleo>, desde: PreguntaEmpleo | null = null): PreguntaEmpleo | null {
  const i = desde ? PREGUNTAS_EMPLEO.indexOf(desde) : -1;
  return PREGUNTAS_EMPLEO.slice(i + 1).find((p) => !respondidas.has(p)) ?? PREGUNTAS_EMPLEO.find((p) => !respondidas.has(p)) ?? null;
}
