/**
 * El onboarding de la app de Gobserva Empleo (2026-11-07): una entrevista en forma de chat para quien busca trabajo en
 * el Estado. Siete preguntas de a una (qué trabajo buscas, con qué palabras, hasta dónde estudiaste, cuánta experiencia
 * tienes, dónde, desde qué sueldo y cómo avisarte). Aquí lo puro: las preguntas, los puestos con sus palabras (contadas
 * en las plazas abiertas de SERVIR el 11-07), cómo se lee lo que escribiste, cómo se dice cada respuesta y cómo se
 * guarda el perfil: la búsqueda «Mi perfil» (su URL), la alerta y la consulta del calce (GET /empleo/calce).
 *
 * Sin imports con «@/»: se prueba con node --test.
 */

export const PREGUNTAS_EMPLEO = ["puesto", "palabras", "estudios", "experiencia", "lugar", "sueldo", "avisos"] as const;
export type PreguntaEmpleo = (typeof PREGUNTAS_EMPLEO)[number];

export type Estudios = "secundaria" | "tecnica" | "egresado" | "bachiller" | "titulo" | "posgrado";

export interface PerfilEmpleo {
  /** Un nombre corto para lo que buscas («Administración», «Enfermera»). */
  puesto: string;
  palabras: string[];
  /** Tus estudios: las plazas que piden eso o menos. null: sin filtro. */
  tengo: Estudios | null;
  /** Tus años de experiencia: las plazas que piden eso o menos. null: cualquiera. */
  exp: number | null;
  /** La región como la pide la API («la-libertad»); null: todo el Perú. */
  region: string | null;
  sueldo: number | null;
  alerta: boolean;
  frecuencia: "semanal" | "diaria";
}

export const PERFIL_EMPLEO_VACIO: PerfilEmpleo = { puesto: "", palabras: [], tengo: null, exp: null, region: null, sueldo: null, alerta: true, frecuencia: "semanal" };

export const MAX_PALABRAS_EMPLEO = 10;
export const PRIMERAS_EMPLEO = 4;
/** El nombre de la búsqueda guardada que lleva el perfil (una por cuenta). */
export const NOMBRE_PERFIL = "Mi perfil";

export interface Puesto {
  clave: string;
  nombre: string;
  palabras: string[];
}

/** Los trabajos que más convoca el Estado en SERVIR, con palabras que sí aparecen en sus avisos. */
export const PUESTOS: Puesto[] = [
  { clave: "administracion", nombre: "Administración", palabras: ["asistente administrativo", "administrativo", "secretaria", "archivo"] },
  { clave: "contabilidad", nombre: "Contabilidad y finanzas", palabras: ["contador", "contabilidad", "tesorería", "presupuesto"] },
  { clave: "derecho", nombre: "Derecho", palabras: ["abogado", "legal", "jurídico"] },
  { clave: "salud", nombre: "Salud", palabras: ["médico", "enfermera", "obstetra", "técnico en enfermería"] },
  { clave: "social", nombre: "Psicología y trabajo social", palabras: ["psicólogo", "trabajador social", "promotor"] },
  { clave: "sistemas", nombre: "Sistemas e informática", palabras: ["sistemas", "informática", "soporte", "desarrollador"] },
  { clave: "ingenieria", nombre: "Ingeniería y obras", palabras: ["ingeniero", "obras", "residente", "arquitecto"] },
  { clave: "educacion", nombre: "Educación", palabras: ["docente", "educación", "tutor"] },
  { clave: "logistica", nombre: "Logística y compras", palabras: ["logística", "almacén", "abastecimiento", "compras"] },
  { clave: "comunicacion", nombre: "Comunicación", palabras: ["comunicador", "comunicaciones", "prensa", "diseñador"] },
  { clave: "conductor", nombre: "Conductor y operario", palabras: ["chofer", "conductor", "operario", "mantenimiento"] },
  { clave: "apoyo", nombre: "Seguridad y limpieza", palabras: ["vigilante", "seguridad", "limpieza", "auxiliar"] },
];

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

export const SUELDOS: { valor: number | null; etiqueta: string }[] = [
  { valor: null, etiqueta: "Cualquier sueldo" },
  { valor: 1500, etiqueta: "Desde S/ 1,500" },
  { valor: 2500, etiqueta: "Desde S/ 2,500" },
  { valor: 3500, etiqueta: "Desde S/ 3,500" },
  { valor: 5000, etiqueta: "Desde S/ 5,000" },
];

const normalizar = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const VACIAS = new Set(
  "a al como con de del el en entre la las lo los mas o otros para por que se sus su un una y busco buscando quiero trabajo trabajar empleo puesto plaza estado soy tengo experiencia anos años mi me algo area área cargo".split(" "),
);

const ARRANQUES = /^(?:(?:yo\s+)?(?:busco|quiero|necesito)(?:\s+(?:un|una))?(?:\s+(?:trabajo|empleo|puesto|plaza))?(?:\s+(?:de|como|en))?|soy(?:\s+(?:un|una))?|trabajo\s+(?:de|como|en))\s+/i;

/** Un nombre corto para lo que buscas desde lo que escribiste: sin «Busco trabajo de…», hasta el primer punto y 50 letras. */
export function puestoDesdeTexto(texto: string): string {
  let t = texto.trim().replace(/\s+/g, " ").replace(ARRANQUES, "");
  t = t.split(/[.;:\n]/)[0].trim();
  if (t.length > 50) t = t.slice(0, 50).replace(/\s+\S*$/, "");
  t = t.replace(/[,\s]+(?:y|e|o)?$/i, "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** Palabras con contenido de lo que escribiste, en su orden, sin repetir ni las que ya están. */
export function sugerirPalabrasEmpleo(texto: string, ya: string[], max = 8): string[] {
  const tiene = new Set(ya.map(normalizar));
  const r: string[] = [];
  for (const w of texto.toLowerCase().split(/[^a-záéíóúüñ0-9]+/i)) {
    const n = normalizar(w);
    if (w.length < 4 || VACIAS.has(n) || tiene.has(n) || /^\d+$/.test(w)) continue;
    tiene.add(n);
    r.push(w);
    if (r.length >= max) break;
  }
  return r;
}

export function perfilDesdePuesto(p: PerfilEmpleo, x: Puesto): PerfilEmpleo {
  return { ...p, puesto: x.nombre, palabras: x.palabras.slice(0, PRIMERAS_EMPLEO) };
}

export function perfilDesdeTextoEmpleo(p: PerfilEmpleo, texto: string): PerfilEmpleo {
  const limpio = texto.trim().replace(/\s+/g, " ").slice(0, 300);
  return { ...p, puesto: puestoDesdeTexto(limpio).slice(0, 60), palabras: sugerirPalabrasEmpleo(limpio, [], PRIMERAS_EMPLEO) };
}

/** Las palabras para tocar: las elegidas y, detrás, las del puesto (o de lo escrito) que aún no están. */
export function candidatasEmpleo(p: PerfilEmpleo, puesto: Puesto | null, texto = "", max = 12): string[] {
  const extra = puesto ? puesto.palabras : sugerirPalabrasEmpleo(texto, p.palabras, 8);
  const r = [...p.palabras];
  for (const w of extra) if (!r.some((x) => normalizar(x) === normalizar(w))) r.push(w);
  return r.slice(0, Math.max(max, p.palabras.length));
}

/** Suma palabras escritas a mano («archivo, trámite»): de 2 a 40 letras, sin repetir y hasta el tope. */
export function agregarPalabrasEmpleo(actuales: string[], texto: string): string[] {
  const r = [...actuales];
  const tiene = new Set(actuales.map(normalizar));
  for (const t of texto.split(/[,;\n]/)) {
    const w = t.trim().replace(/\s+/g, " ").toLowerCase();
    if (w.length < 2 || w.length > 40 || tiene.has(normalizar(w)) || r.length >= MAX_PALABRAS_EMPLEO) continue;
    tiene.add(normalizar(w));
    r.push(w);
  }
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
export function textoRespuestaEmpleo(q: PreguntaEmpleo, p: PerfilEmpleo, region: (slug: string) => string, puesto: Puesto | null, escrito: string): string {
  switch (q) {
    case "puesto":
      return puesto ? puesto.nombre : escrito || p.puesto;
    case "palabras":
      return listaNaturalEmpleo(p.palabras, 6);
    case "estudios":
      return ESTUDIOS.find((e) => e.valor === p.tengo)?.etiqueta ?? "Prefiero no filtrar por estudios";
    case "experiencia":
      return EXPERIENCIAS.find((e) => e.valor === p.exp)?.etiqueta ?? "5 años o más";
    case "lugar":
      return p.region ? region(p.region) : "Todo el Perú";
    case "sueldo":
      return SUELDOS.find((s) => s.valor === p.sueldo)?.etiqueta ?? `Desde S/ ${p.sueldo}`;
    case "avisos":
      return !p.alerta ? "No, yo entro a mirar" : p.frecuencia === "diaria" ? "Sí, cada mañana" : "Sí, cada semana";
  }
}

/** La consulta del calce (GET /empleo/calce): las palabras del perfil, las sugeridas que sólo se cuentan y los filtros. */
export function paramsCalce(p: PerfilEmpleo, otras: string[] = [], extra: Record<string, string | number> = {}): URLSearchParams {
  const q = new URLSearchParams();
  if (p.palabras.length) q.set("palabras", p.palabras.join("|"));
  if (otras.length) q.set("otras", otras.join("|"));
  if (p.region) q.set("region", p.region);
  if (p.tengo) q.set("tengo", p.tengo);
  if (p.sueldo != null) q.set("sueldo", String(p.sueldo));
  if (p.exp != null) q.set("exp", String(p.exp));
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  return q;
}

/** El perfil como la búsqueda «Mi perfil» (lo que se guarda en la cuenta) y de vuelta. */
export function aQueryPerfil(p: PerfilEmpleo): string {
  const q = paramsCalce(p);
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
  const tengo = q.get("tengo");
  const region = q.get("region");
  return {
    ...PERFIL_EMPLEO_VACIO,
    puesto: (q.get("puesto") ?? "").slice(0, 60),
    palabras: (q.get("palabras") ?? "").split("|").map((w) => w.trim()).filter(Boolean).slice(0, MAX_PALABRAS_EMPLEO),
    tengo: tengo && ESTUDIOS_VALIDOS.has(tengo) ? (tengo as Estudios) : null,
    exp: num("exp"),
    region: region && /^[a-z-]{3,30}$/.test(region) ? region : null,
    sueldo: num("sueldo"),
  };
}

/**
 * La alerta del perfil, con los filtros de la lista de plazas (el texto pide TODAS sus palabras): va la palabra
 * principal y los demás filtros; lo demás lo ordena «Para ti».
 */
export function aAlertaEmpleo(p: PerfilEmpleo): { nombre: string; filtros: Record<string, string | number> } {
  const filtros: Record<string, string | number> = {};
  if (p.palabras[0]) filtros.q = p.palabras[0];
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
