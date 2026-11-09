/**
 * Los adaptadores de las webs de convocatorias que el buscador genérico no entiende (docs/automatizacion_cas.md, fase 2;
 * medido el 2026-11-09: cada sitio funciona al 100 % o al 0 %). Uno por dominio: recibe la plaza de SERVIR y un cliente HTTP
 * (lib/empleoHttp.ts: GET/POST con cookies y el relay de Lima) y devuelve el proceso con sus documentos, o null.
 * `buscarBases` (lib/basesPlaza.ts) prueba primero el adaptador del dominio y, si no encuentra, el genérico.
 *
 * Reglas de todos: pocos pedidos (el tope del cliente), sin captchas, sin cuentas, y de los resultados (nombres y DNI) sólo
 * el enlace: lo filtra `soloEnlace` aguas abajo.
 */
import {
  buscarBases, documentosDePagina, enlaces, esDocumento, esProcesoGobPe, normalizar, numeroProceso, palabrasPuesto, type Enlace, type Hallazgo, type PlazaParaBases,
} from "./basesPlaza.js";
import type { Http } from "./empleoHttp.js";
import { ADAPTADORES_SALUD } from "./adaptadores/salud.js";
import { ADAPTADORES_NACIONALES } from "./adaptadores/nacionales.js";
import { ADAPTADORES_EDUCACION } from "./adaptadores/educacion.js";
import { ADAPTADORES_ESPECIALES, esMidis, esProvias, midis, provias } from "./adaptadores/especiales.js";

export type Adaptador = (p: PlazaParaBases, http: Http) => Promise<Hallazgo | null>;

/** Los adaptadores por dominio (en minúsculas). */
export const ADAPTADORES: Record<string, Adaptador> = {};

/**
 * La ola 2 (2026-11-09), en lib/adaptadores/: salud, educación, entidades nacionales y casos especiales (Drive, share.google, OECE,
 * MIDIS, Provías). Se suman la primera vez que se buscan, no al cargar: esos módulos usan este, y en el ciclo de imports
 * todavía no existirían.
 */
let olaRegistrada = false;
function registrarOla2(): void {
  if (olaRegistrada) return;
  olaRegistrada = true;
  for (const grupo of [ADAPTADORES_SALUD, ADAPTADORES_EDUCACION, ADAPTADORES_NACIONALES, ADAPTADORES_ESPECIALES]) {
    for (const [dominio, a] of Object.entries(grupo)) ADAPTADORES[dominio] ??= a;
  }
}

/** Todos los dominios con adaptador (para medir y para las pruebas). */
export function dominiosConAdaptador(): string[] {
  registrarOla2();
  return Object.keys(ADAPTADORES).sort();
}

/** El dominio de la primera URL de `detalle_url` que no es Facebook. */
export function dominioDe(detalleUrl: string | null | undefined): string | null {
  const xs = [...(detalleUrl ?? "").matchAll(/https?:\/\/[^\s<>"'|]+/gi)].map((m) => m[0]);
  const url = xs.find((u) => !/facebook\.com/i.test(u)) ?? xs[0];
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export const adaptadorDe = (detalleUrl: string | null | undefined): Adaptador | null => {
  registrarOla2();
  const d = dominioDe(detalleUrl);
  return d ? (ADAPTADORES[d] ?? null) : null;
};

/**
 * El adaptador de una plaza: primero las entidades que SERVIR enlaza a una página de gob.pe pero publican sus procesos
 * en su propio aplicativo (MIDIS, Provías Nacional), por el nombre de la entidad; si no, el del dominio de su enlace.
 */
export function adaptadorDePlaza(p: Pick<PlazaParaBases, "entidad" | "detalle_url">): Adaptador | null {
  if (esMidis(p)) return midis;
  if (esProvias(p)) return provias;
  return adaptadorDe(p.detalle_url);
}

/**
 * Qué tan útil es un documento para leer la convocatoria (menos es primero): se leen los 3 primeros PDF, así que las bases,
 * el perfil o las plazas y el cronograma van antes que la norma general o los anexos de contrato.
 */
export function prioridadDocumento(d: Enlace): number {
  const t = `${d.texto} ${nombreDeArchivo(d.url)}`.toLowerCase();
  if (/\bbases?\b|convocatoria/.test(t)) return 0;
  if (/perfil|plazas|vacant|requisito|tdr|t[eé]rminos de referencia/.test(t)) return 1;
  if (/cronograma/.test(t)) return 2;
  if (/comunicado|errata/.test(t)) return 3;
  if (/norma|rvm|resoluci|directiva|reglamento|anexo|formato|contrato|declaraci/.test(t)) return 5;
  return 4;
}

/** Un hallazgo a partir de los documentos de un proceso (sin repetir, sólo con URL absoluta, los más útiles primero). */
export function hallazgo(pagina: string, docs: Enlace[], via: Hallazgo["via"] = "pagina_proceso"): Hallazgo | null {
  const vistos = new Set<string>();
  const documentos = docs
    .filter((d) => /^https?:\/\//i.test(d.url) && !vistos.has(d.url) && vistos.add(d.url))
    .map((d, i) => ({ d, i }))
    .sort((a, b) => prioridadDocumento(a.d) - prioridadDocumento(b.d) || a.i - b.i)
    .map(({ d }) => ({ ...d, texto: d.texto.replace(/\s*\d{2}\/\d{2}\/\d{4}\s*$/, "").trim() || d.texto }));
  return documentos.length ? { pagina, documentos, via } : null;
}

// ─── Lo común ─────────────────────────────────────────────────────────────────────────────────────────

/** El año de la convocatoria (el de su publicación en SERVIR). */
export const anioDe = (p: PlazaParaBases) => Number.parseInt((p.fecha_inicio ?? "").slice(0, 4), 10) || new Date().getFullYear();

/** El régimen por el número de SERVIR: «D.LEG 1057 - …» es CAS; «276-…», «728-…», el resto. */
export function regimenDe(numero: string | null): "cas" | "276" | "728" | "otro" {
  const t = (numero ?? "").toUpperCase();
  if (/1057|\bCAS\b/.test(t)) return "cas";
  if (/^\s*276\b|LEG\.?\s*276/.test(t)) return "276";
  if (/^\s*728\b|LEG\.?\s*728/.test(t)) return "728";
  return "otro";
}

const ENTIDADES_HTML: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", deg: "°", ordm: "º" };

/** El texto de un pedazo de HTML: sin etiquetas, con las entidades y los espacios en orden. */
export function textoPlano(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, k: string) => ENTIDADES_HTML[k] ?? (k.startsWith("#") ? String.fromCharCode(Number(k.slice(1))) : m))
    .replace(/\s+/g, " ")
    .trim();
}

/** Las celdas (td y th) de una fila, en orden, con su HTML de adentro. */
export function celdas(fila: string): string[] {
  return [...fila.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
}

/** El nombre de un archivo por su URL («BASES PROCESO CAS N 03-2026-INS»), para cuando el enlace no tiene texto. */
export function nombreDeArchivo(url: string): string {
  const ultimo = url.split(/[?#]/)[0].split("/").pop() ?? "";
  let t = ultimo;
  try {
    t = decodeURIComponent(ultimo);
  } catch {
    /* tal cual */
  }
  return t.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_+]+/g, " ").replace(/\s+/g, " ").trim() || "Documento";
}

/** Qué tanto se parece un texto al puesto de SERVIR (0 a 1: la parte de sus palabras que aparece). */
export function parecidoPuesto(titulo: string | null, texto: string): number {
  const ws = palabrasPuesto(titulo);
  if (!ws.length) return 0;
  const t = normalizar(texto);
  return ws.filter((w) => t.includes(w)).length / ws.length;
}

/** El número y el año en «N° 072 - PROMPERÚ - 2026», «CAS-003-2026», «019-2026», «Convocatoria 001-2026». */
export function numeroYAnio(texto: string): { n: number; anio: number } | null {
  const m = /(\d{1,4})\s*-\s*(?:[A-ZÁÉÍÓÚ.\s]{2,20}-\s*)?(20\d{2})/i.exec(texto);
  return m ? { n: Number(m[1]), anio: Number(m[2]) } : null;
}

const pad = (n: number, largo: number) => String(n).padStart(largo, "0");

/** Un `pedir` del buscador genérico hecho con el cliente HTTP (para mandar al genérico desde un adaptador). */
const pedirDe = (http: Http) => async (url: string) => {
  const r = await http.get(url);
  return r ? { status: r.status, html: r.texto, final: r.final } : null;
};

/** Para los sitios que publican sus convocatorias en otro lado: el genérico desde esa otra página. */
const redirigirA = (url: string): Adaptador => (p, http) => buscarBases({ ...p, detalle_url: url }, pedirDe(http));

/** Los campos ocultos de un formulario ASP.NET o JSF (ViewState y compañía). */
export function camposOcultos(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*type=["']hidden["'][^>]*>/gi)) {
    const nombre = /\bname=["']([^"']+)["']/i.exec(m[0])?.[1];
    if (nombre) out[nombre] = textoPlano(/\bvalue=["']([^"']*)["']/i.exec(m[0])?.[1] ?? "");
  }
  return out;
}

// ─── INS: lista ASP con filtro por número y año ───────────────────────────────────────────────────

/** INS (www.ins.gob.pe/cas/consulta_cas): la lista filtrada por año y número trae una fila; la 7.ª celda son las bases. */
const ins: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const url = `https://www.ins.gob.pe/cas/consulta_cas/index.asp?NroPag=1&tipoConvocatoria=CAS&anio=${anio}&convocatoria=${pad(n, 3)}&descripcion=`;
  const r = await http.pedir(url, { timeoutMs: 30_000 });
  if (!r?.texto) return null;
  for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    if (cs.length < 7) continue;
    const m = /CAS-0*(\d+)-(\d{4})/i.exec(textoPlano(cs[2]));
    if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
    // Las celdas 8 en adelante son resultados (con nombres): fuera.
    const docs = enlaces(cs[6], r.final).filter((e) => esDocumento(e.url)).map((e) => ({ url: e.url, texto: e.texto || nombreDeArchivo(e.url) }));
    return hallazgo(url, docs);
  }
  return null;
};

// ─── PromPerú: GridView de ASP.NET ───────────────────────────────────────────────────────────────

/** PromPerú (cas.promperu.gob.pe): la grilla del año (20 por página, con postback); C_PP… son las bases, CR_PP… el formato. */
const promperu: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const url = "https://cas.promperu.gob.pe/";
  let r = await http.get(url);
  for (let pagina = 1; r?.texto && pagina <= 5; pagina++) {
    const candidatos: { docs: Enlace[]; parecido: number }[] = [];
    for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
      const numero = /lblNumero_\d+["'][^>]*>([^<]*)</i.exec(fila)?.[1] ?? "";
      const m = /N\s*[°º]?\s*0*(\d+)\s*-\s*PROMPER.{1,2}\s*-\s*(\d{4})/i.exec(numero);
      if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
      const servicio = /lblServicio_\d+["'][^>]*>([^<]*)</i.exec(fila)?.[1] ?? "";
      const docs: Enlace[] = [];
      for (const h of fila.matchAll(/href=["']files\/([^"']+)["']/gi)) {
        const archivo = h[1];
        const texto = /^C_PP/i.test(archivo) ? "Bases de la convocatoria" : /^CR_PP/i.test(archivo) ? "Formato resumen de CV" : null;
        if (texto) docs.push({ url: new URL(`files/${archivo}`, url).toString(), texto });
      }
      candidatos.push({ docs, parecido: parecidoPuesto(p.titulo, servicio) });
    }
    // La misma convocatoria puede ir por la segunda o la tercera: la que más se parece al puesto (y la más nueva, arriba).
    const mejor = candidatos.sort((a, b) => b.parecido - a.parecido)[0];
    if (mejor) return hallazgo(url, mejor.docs);
    if (!new RegExp(`Page\\$${pagina + 1}`).test(r.texto)) break;
    r = await http.post(url, { ...camposOcultos(r.texto), __EVENTTARGET: "gvConvocatoria", __EVENTARGUMENT: `Page$${pagina + 1}`, ddlAnio: String(anio) });
  }
  return null;
};

// ─── DIRESA Callao: la API JSON de la grilla ─────────────────────────────────────────────────────

/** DIRESA Callao (ConcursoPlazas): un JSON por tipo y año, cada fila «… - Convocatoria 001-2026 - BASES» con su archivo. */
const diresaCallao: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://www.diresacallao.gob.pe/wdiresa/portal/ConcursoPlazas/";
  for (const tag of ["PLAZ0004", "PLAZ0008"]) {
    const filas = await http.json<{ descri?: string; file?: string }[]>(`${base}?tyzp=Fd598DIEzxx&tag=${tag}&myea=${anio}`);
    if (!Array.isArray(filas)) continue;
    const docs: Enlace[] = [];
    for (const f of filas) {
      const m = /Convocatoria\s+0*(\d+)\s*-\s*(\d{4})/i.exec(f.descri ?? "");
      if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
      const href = /href=['"]([^'"]+)['"]/i.exec(f.file ?? "")?.[1];
      if (href) docs.push({ url: href, texto: (f.descri ?? "").split(" - ").pop()?.trim() || "Documento" });
    }
    const h = hallazgo(`${base}#tab-2`, docs);
    if (h) return h;
  }
  return null;
};

// ─── Red de Salud Cusco Sur: WordPress (API REST) con las bases en Drive ─────────────────────────

const SIN_BASES = /RESULTAD|APTOS|RECONSIDERA|DEVOLUCI|FE DE ERRATA|GANADOR|ENTREVISTA/i;

/** Red de Salud Cusco Sur: las entradas de la categoría Convocatorias cerca de la fecha; el enlace a Drive es la base. */
const saludCuscoSur: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  const anio = anioDe(p);
  const regimen = regimenDe(p.numero);
  const fecha = p.fecha_inicio ? new Date(`${p.fecha_inicio}T00:00:00Z`) : new Date();
  const desde = new Date(fecha.getTime() - 20 * 86_400_000).toISOString().slice(0, 10);
  const posts = await http.json<{ date: string; link: string; title?: { rendered?: string }; content?: { rendered?: string } }[]>(
    `https://www.redsaludcuscosur.gob.pe/wp-json/wp/v2/posts?categories=10&after=${desde}T00:00:00&per_page=40&_fields=date,link,title,content`,
  );
  if (!Array.isArray(posts)) return null;
  const candidatos = posts
    .map((x) => ({ x, titulo: textoPlano(x.title?.rendered ?? "") }))
    .filter(({ titulo }) => !SIN_BASES.test(titulo))
    .filter(({ titulo }) => {
      const na = numeroYAnio(titulo);
      if (na && n != null) return na.n === n && na.anio === anio;
      // Los de 276 no llevan número: el régimen en el título.
      return regimen === "276" ? /\b276\b/.test(titulo) : regimen === "cas" ? /\bCAS\b/i.test(titulo) : false;
    })
    .sort((a, b) => Math.abs(Date.parse(a.x.date) - fecha.getTime()) - Math.abs(Date.parse(b.x.date) - fecha.getTime()));
  for (const { x } of candidatos) {
    const docs = enlaces(x.content?.rendered ?? "", x.link).filter((e) => esDocumento(e.url));
    const h = hallazgo(x.link, docs.map((e) => ({ url: e.url, texto: e.texto || "Bases" })));
    if (h) return h;
  }
  return null;
};

// ─── Red de Salud Tacna: Laravel con pestañas por régimen ────────────────────────────────────────

/** Red de Salud Tacna: /convocatorias (vigentes, en pestañas por régimen) y la ficha del proceso con su fila «Bases». */
const saludTacna: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const regimen = regimenDe(p.numero);
  const lista = "https://www.redsaludtacna.gob.pe/convocatorias";
  const r = await http.get(lista);
  if (!r?.texto) return null;
  const pestanas = regimen === "cas" ? ["cas"] : regimen === "276" ? ["cpe", "sup", "asc"] : ["cas", "cpe", "sup", "asc", "nom"];
  const candidatos: { url: string; parecido: number }[] = [];
  for (const bloque of r.texto.split(/<div class="tab-pane[^"]*" id="pills-/i).slice(1)) {
    const pestana = /^([a-z]+)/.exec(bloque)?.[1] ?? "";
    if (!pestanas.includes(pestana)) continue;
    for (const fila of bloque.split(/<tr\b/i).slice(1)) {
      const a = /<h6[^>]*>\s*<a href="([^"]+\/convocatorias\/\d+)"[^>]*>([^<]+)<\/a>/i.exec(fila);
      const na = a ? numeroYAnio(a[2]) : null;
      if (!a || !na || na.n !== n || na.anio !== anio) continue;
      candidatos.push({ url: a[1], parecido: parecidoPuesto(p.titulo, textoPlano(fila)) });
    }
  }
  const mejor = candidatos.sort((a, b) => b.parecido - a.parecido)[0];
  if (!mejor) return null;
  const d = await http.get(mejor.url);
  if (!d?.texto) return null;
  const docs: Enlace[] = [];
  for (const fila of d.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    const etapa = textoPlano(cs[0] ?? "");
    if (!/bases|anexo|perfil|cronograma|comunicado|errata/i.test(etapa) || /apto|resultado|entrevista|ganador/i.test(etapa)) continue;
    for (const e of enlaces(fila, d.final)) if (esDocumento(e.url)) docs.push({ url: e.url.replace(/^http:/, "https:"), texto: etapa });
  }
  for (const e of enlaces(d.texto, d.final)) if (/\/storage\/convocatoriatipo\//.test(e.url)) docs.push({ url: e.url.replace(/^http:/, "https:"), texto: "Anexos" });
  return hallazgo(mejor.url, docs);
};

// ─── UNICA: un micrositio por concurso docente ───────────────────────────────────────────────────

/** UNICA: el concurso docente vigente (nombramiento o contrato), con su tabla de resoluciones (bases, cronograma…). */
const unica: Adaptador = async (p, http) => {
  const t = normalizar(p.titulo ?? "");
  const micro = /ordinari|nombramiento/.test(t) ? "nombramientodocente" : /contratad|contrato/.test(t) ? "contratodocente" : null;
  if (!micro) return null;
  const anio = anioDe(p);
  const url = `https://www.unica.edu.pe/${micro}/`;
  const r = await http.get(url);
  if (!r?.texto || !r.texto.includes(String(anio))) return null;
  const docs: Enlace[] = [];
  for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    const titulo = textoPlano(cs[0] ?? "");
    if (!/bases|cronograma|reglamento|aprobaci|plazas|perfil|requisitos/i.test(titulo) || /resultado|apto/i.test(titulo)) continue;
    for (const e of enlaces(fila, r.final)) if (esDocumento(e.url) && e.url.includes(`/${anio}/`)) docs.push({ url: e.url, texto: titulo });
  }
  // Las bases primero (las que se leen).
  docs.sort((a, b) => Number(/bases/i.test(b.texto)) - Number(/bases/i.test(a.texto)));
  return hallazgo(url, docs);
};

// ─── El registro ─────────────────────────────────────────────────────────────────────────────────

Object.assign(ADAPTADORES, {
  "www.ins.gob.pe": ins,
  "cas.promperu.gob.pe": promperu,
  "www.diresacallao.gob.pe": diresaCallao,
  "www.redsaludcuscosur.gob.pe": saludCuscoSur,
  "www.redsaludtacna.gob.pe": saludTacna,
  "www.unica.edu.pe": unica,
  // La UNAH publica sus CAS en gob.pe (su web sólo enlaza ahí).
  "portal.unah.edu.pe": redirigirA("https://www.gob.pe/institucion/unah/informes-publicaciones/tipos/80-convocatorias-de-trabajo"),
} satisfies Record<string, Adaptador>);

// ─── Educación (UGEL) e INABIF ────────────────────────────────────────────────────────────────────

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07", agosto: "08",
  septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

/** «03 de noviembre 2026», «6 de Noviembre de 2026» o «05/11/2026» → «2026-11-03». */
export function fechaEs(texto: string): string | null {
  const a = /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de(?:l)?\s+)?(\d{4})/i.exec(texto);
  if (a && MESES[a[2].toLowerCase()]) return `${a[3]}-${MESES[a[2].toLowerCase()]}-${a[1].padStart(2, "0")}`;
  const b = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto);
  return b ? `${b[3]}-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}` : null;
}

/** Días entre dos fechas ISO (b - a). */
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * La ronda que corresponde a una publicación de SERVIR: la más reciente que no es posterior a la publicación (con unos
 * días de holgura: la entidad a veces sube la ronda después). En las UGEL, el número «276-92» de SERVIR NO es el del
 * proceso: cada UGEL tiene una sola ronda de contratación 276 por periodo (norma técnica RVM 175-2026-MINEDU).
 */
function rondaVigente<T extends { fecha: string | null }>(rondas: T[], fechaInicio: string | null, holgura = 7): T | null {
  const limite = fechaInicio ?? new Date().toISOString().slice(0, 10);
  return rondas
    .filter((r): r is T & { fecha: string } => !!r.fecha && dias(r.fecha, limite) >= -holgura && dias(r.fecha, limite) <= 60)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0] ?? null;
}

const ES_RESULTADO = /resultad|apto|ganador|cuadro de m|adjudicaci|evaluaci[oó]n (curricular|de conoc)|entrevista|puntaje|preliminar|final/i;

/** Los enlaces a documentos de un pedazo de HTML con su etiqueta (el texto antes del enlace si el enlace no tiene texto). */
function documentosEtiquetados(html: string, base: string, porDefecto: string): Enlace[] {
  const out: Enlace[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let previo = 0;
  for (const m of html.matchAll(re)) {
    let url: string;
    try {
      url = new URL(m[1].replace(/&amp;/g, "&"), base).toString();
    } catch {
      continue;
    }
    if (!esDocumento(url)) continue;
    const propio = textoPlano(m[2]).replace(/\(?ver (documento|norma)\)?/i, "").trim();
    const antes = textoPlano(html.slice(previo, m.index ?? 0)).split(/\s-\s|^-|\s-(?=[A-ZÁÉÍÓÚ])/).pop()?.replace(/^-/, "").trim() ?? "";
    previo = (m.index ?? 0) + m[0].length;
    const texto = propio.length > 3 ? propio : antes.length > 3 ? antes.slice(-80) : porDefecto;
    if (!ES_RESULTADO.test(texto)) out.push({ url, texto });
  }
  return out;
}

/** UGEL 07: CAS en su tabla (fila «CAS N° 072-2026 – PUESTO»); 276 por rondas con fecha («03 de noviembre 2026»). */
const ugel07: Adaptador = async (p, http) => {
  const anio = anioDe(p);
  if (regimenDe(p.numero) === "cas") {
    const n = numeroProceso(p.numero);
    if (n == null) return null;
    const url = "https://www.ugel07.gob.pe/convocatoria-cas/";
    const r = await http.get(url);
    if (!r?.texto) return null;
    for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
      const cs = celdas(fila);
      const m = cs.length >= 2 ? /CAS\s*N\D{0,3}0*(\d+)\s*-\s*(\d{4})/i.exec(textoPlano(cs[0])) : null;
      if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
      return hallazgo(url, enlaces(cs[1], r.final).filter((e) => esDocumento(e.url)).map((e) => ({ url: e.url, texto: "Bases y perfil del puesto" })));
    }
    return null;
  }
  const url = "https://www.ugel07.gob.pe/proceso-de-contratacion-de-personal-administrativo-del-decreto-legislativo-no-276/";
  const r = await http.get(url);
  if (!r?.texto) return null;
  const rondas = r.texto.split(/<div class="web_fecha">/i).slice(1).map((b) => {
    const fecha = fechaEs(textoPlano(b.slice(0, 120)));
    const caja = /<div class="web_border">([\s\S]*?)<\/div>/i.exec(b)?.[1] ?? "";
    return { fecha, docs: documentosEtiquetados(caja, r.final, "Documento del proceso") };
  });
  const ronda = rondaVigente(rondas.filter((x) => x.docs.length), p.fecha_inicio);
  return ronda ? hallazgo(url, ronda.docs, "lista") : null;
};

/** UGEL 06: sus listas viven en convocatorias.ugel06.gob.pe (acordeón con data-nombre y data-fecha por ronda). */
const ugel06: Adaptador = async (p, http) => {
  const anio = anioDe(p);
  const cas = regimenDe(p.numero) === "cas";
  const url = cas ? "https://convocatorias.ugel06.gob.pe/convocatorias-cas" : "https://convocatorias.ugel06.gob.pe/administracion-personal";
  const r = await http.get(url);
  if (!r?.texto) return null;
  const items = r.texto.split(/<div class="accordion-item"/i).slice(1).map((b) => ({
    nombre: textoPlano(/data-nombre="([^"]*)"/i.exec(b)?.[1] ?? ""),
    fecha: fechaEs(/data-fecha="([^"]*)"/i.exec(b)?.[1] ?? ""),
    html: b,
  }));
  if (cas) {
    const n = numeroProceso(p.numero);
    if (n == null) return null;
    // La numeración CAS se repite por programa: la fila con el número y el puesto que más se parece.
    let mejor: { item: (typeof items)[number]; fila: string; parecido: number } | null = null;
    for (const item of items) {
      for (const fila of item.html.split(/<tr\b/i).slice(1)) {
        const t = textoPlano(fila);
        const m = /CAS\s*0*(\d+)\s*-\s*(\d{4})/i.exec(t);
        if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
        const parecido = parecidoPuesto(p.titulo, t);
        if (!mejor || parecido > mejor.parecido) mejor = { item, fila, parecido };
      }
    }
    if (!mejor) return null;
    const propios = documentosEtiquetados(mejor.fila, r.final, "Perfil del puesto");
    // De la ronda: el cronograma, las bases y los anexos (no los resultados).
    const ronda = mejor.item.html.split(/<tr\b/i).slice(1)
      .filter((f) => /cronograma|bases|anexo/i.test(textoPlano(f)) && !/CAS\s*0*\d+\s*-\s*\d{4}/i.test(textoPlano(f)))
      .flatMap((f) => documentosEtiquetados(f, r.final, textoPlano(celdas(f)[1] ?? "") || "Documento del proceso"));
    return hallazgo(url, [...propios, ...ronda]);
  }
  const rondas = items
    .filter((x) => /\b276\b/.test(x.nombre) && /CONTRATACI/i.test(x.nombre))
    .map((x) => ({ ...x, docs: x.html.split(/<tr\b/i).slice(1).flatMap((f) => documentosEtiquetados(f, r.final, textoPlano(celdas(f)[1] ?? celdas(f)[0] ?? "") || "Documento del proceso")) }));
  const ronda = rondaVigente(rondas.filter((x) => x.docs.length), p.fecha_inicio);
  return ronda ? hallazgo(url, ronda.docs, "lista") : null;
};

/** UGEL 03 (sigepo): los puestos vigentes en JSON; el perfil y las bases del año tienen rutas fijas (sólo http). */
const ugel03: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "http://sistemas06.ugel03.gob.pe/sigepo";
  const j = await http.json<{ data?: { cod_puesto?: string; puesto?: string }[] }>(`${base}/Vigente_cas/get_puestos`);
  const puesto = (j?.data ?? []).find((x) => {
    const m = /(\d+)-(\d{4})/.exec(x.cod_puesto ?? "");
    return !!m && Number(m[1]) === n && Number(m[2]) === anio;
  });
  if (!puesto?.cod_puesto) return null;
  return hallazgo(`${base}/vigente_cas`, [
    { url: `${base}/assets/bases/BASES_ADMINISTRATIVAS_VIRTUAL_${anio}.pdf`, texto: `Bases administrativas ${anio}` },
    { url: `${base}/assets/${anio}/CAS/${puesto.cod_puesto}.pdf`, texto: `Perfil del puesto ${puesto.cod_puesto}` },
  ]);
};

/** UGEL Santa: 276 en la carpeta del periodo (/site/2027/Contrato-Administrativo-2027/); CAS por el número en el archivo. */
const ugelSanta: Adaptador = async (p, http) => {
  const anio = anioDe(p);
  if (regimenDe(p.numero) === "cas") {
    const n = numeroProceso(p.numero);
    if (n == null) return null;
    const url = `https://ugelsanta.gob.pe/noticias/contrato-cas-${anio}`;
    const r = await http.get(url);
    if (!r?.texto) return null;
    const docs = enlaces(r.texto, r.final)
      .filter((e) => esDocumento(e.url) && new RegExp(`CAS\\s*0*${n}\\s*-\\s*${anio}`, "i").test(nombreDeArchivo(e.url)))
      .filter((e) => !ES_RESULTADO.test(nombreDeArchivo(e.url)))
      .map((e) => ({ url: e.url, texto: nombreDeArchivo(e.url) }));
    return hallazgo(url, docs);
  }
  const url = "https://ugelsanta.gob.pe/noticias/contrato-administrativo";
  const r = await http.get(url);
  if (!r?.texto) return null;
  const todos = enlaces(r.texto, r.final).filter((e) => esDocumento(e.url));
  const periodos = [...new Set(todos.map((e) => Number(/\/site\/(\d{4})\/Contrato-Administrativo-\1\//i.exec(e.url)?.[1] ?? 0)).filter(Boolean))];
  // El periodo de contrato: el siguiente año desde octubre (las rondas de noviembre son para el año que viene).
  const mes = Number((p.fecha_inicio ?? "").slice(5, 7)) || 1;
  const quiero = mes >= 10 ? anio + 1 : anio;
  const periodo = periodos.includes(quiero) ? quiero : Math.max(0, ...periodos);
  if (!periodo) return null;
  const docs = todos
    .filter((e) => e.url.includes(`/site/${periodo}/Contrato-Administrativo-${periodo}/`) && !ES_RESULTADO.test(nombreDeArchivo(e.url)))
    .map((e) => ({ url: e.url, texto: nombreDeArchivo(e.url) }));
  return hallazgo(url, docs, "lista");
};

/** INABIF: la lista (un renglón por proceso «389-001-2026», con el enlace a su ficha) y en la ficha, la primera celda: las bases. */
const inabif: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const lista = "https://www.inabif.gob.pe/portalweb/convocatoria_v3.php";
  const r = await http.pedir(lista, { timeoutMs: 30_000 });
  if (!r?.texto) return null;
  let mejor: { c: string; parecido: number } | null = null;
  for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
    const m = /(\d+)-(\d{3})-(\d{4})/.exec(fila);
    if (!m || Number(m[1]) !== n || Number(m[3]) !== anio) continue;
    const c = /index2-19\.php\?c=([0-9a-f]{32})/i.exec(fila)?.[1];
    if (!c) continue;
    const parecido = parecidoPuesto(p.titulo, textoPlano(fila));
    if (!mejor || parecido > mejor.parecido) mejor = { c, parecido };
  }
  if (!mejor) return null;
  const ficha = `https://www.inabif.gob.pe/portalweb/portal/portaldeconvocatorias/index2-19.php?c=${mejor.c}`;
  const d = await http.get(ficha);
  if (!d?.texto) return null;
  const tabla = /class="tabla4"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i.exec(d.texto)?.[1] ?? "";
  const primera = celdas(/<tr\b[\s\S]*?<\/tr>/i.exec(tabla)?.[0] ?? "")[0] ?? "";
  return hallazgo(ficha, enlaces(primera, d.final).filter((e) => esDocumento(e.url)).map((e) => ({ url: e.url, texto: "Bases" })));
};

Object.assign(ADAPTADORES, {
  "www.ugel07.gob.pe": ugel07,
  "ugel07.gob.pe": ugel07,
  "www.ugel06.gob.pe": ugel06,
  "ugel06.gob.pe": ugel06,
  "convocatorias.ugel06.gob.pe": ugel06,
  "sistemas06.ugel03.gob.pe": ugel03,
  "ugelsanta.gob.pe": ugelSanta,
  "www.ugelsanta.gob.pe": ugelSanta,
  "www.inabif.gob.pe": inabif,
} satisfies Record<string, Adaptador>);

// ─── Aplicativos propios (MINJUS, MINEDU, SUNAFIL, JUNTOS, MINSA) ────────────────────────────────

/** Los títulos de SERVIR y de la entidad, comparables (sin tildes, sin signos, en minúsculas). */
const tituloComparable = (t: string | null | undefined) => normalizar(textoPlano(t ?? "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** «dd/mm/yyyy» → «yyyy-mm-dd». */
const isoDe = (ddmmyyyy: string | undefined) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(ddmmyyyy ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const NO_DOCUMENTO = /resultad|rrp|ret\b|rec\b|ref\b|ficha|apto|puntaje|ganador/i;

/**
 * MINJUS (JSF de PrimeFaces): la grilla de 2026 se pide por AJAX de a 100 (con el nonce de la página: sin él, la vista
 * revienta). El número de SERVIR no es el de MINJUS: se empata por el título (y la fecha de postulación, y el lugar entre
 * paréntesis si hay varios iguales). Cada botón de BASES devuelve el visor con una URL estable: /convocatoria/Preview?file=.
 */
const minjus: Adaptador = async (p, http) => {
  const url = "https://convocatoria.minjus.gob.pe/convocatoria/public/index.xhtml";
  const r = await http.get(url);
  if (!r?.texto) return null;
  let vista = camposOcultos(r.texto)["javax.faces.ViewState"];
  const nonce = /nonce="([^"]+)"/.exec(r.texto)?.[1];
  if (!vista || !nonce) return null;
  const ajax = { "Faces-Request": "partial/ajax", "X-Requested-With": "XMLHttpRequest" };
  const deVista = (xml: string) => /<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]>/.exec(xml)?.[1];
  const titulo = tituloComparable(p.titulo);
  const lugar = tituloComparable((p.ubicacion ?? "").split(" - ").pop());
  if (titulo.length < 6) return null;
  for (let first = 0; first <= 300; first += 100) {
    const pag = await http.post(url, {
      "javax.faces.partial.ajax": "true", "javax.faces.source": "frmResultados:grid", "javax.faces.partial.execute": "frmResultados:grid",
      "javax.faces.partial.render": "frmResultados:grid", "frmResultados:grid": "frmResultados:grid", "frmResultados:grid_pagination": "true",
      "frmResultados:grid_first": String(first), "frmResultados:grid_rows": "100", "frmResultados:grid_skipChildren": "true",
      "frmResultados:grid_encodeFeature": "true", frmResultados: "frmResultados", "frmResultados:grid_rppDD": "100",
      "javax.faces.ViewState": vista, "primefaces.nonce": nonce,
    }, ajax);
    if (!pag?.texto || !pag.texto.includes("data-ri=")) break;
    vista = deVista(pag.texto) ?? vista;
    const filas = pag.texto.split(/<tr data-ri="/).slice(1).map((f) => {
      const cs = celdas(f);
      const fechas = [...(cs[0] ?? "").matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => isoDe(m[1]));
      return {
        titulo: tituloComparable(cs[1] ?? ""),
        desde: fechas[0] ?? null,
        botones: [...f.matchAll(/<button id="([^"]+)"[^>]*title="([^"]+)"/g)].map((m) => ({ id: m[1], nombre: textoPlano(m[2]) })),
      };
    });
    const candidatas = filas.filter((f) => (f.titulo.startsWith(titulo) || titulo.startsWith(f.titulo.slice(0, Math.max(12, titulo.length - 5))))
      && (!f.desde || !p.fecha_inicio || f.desde >= p.fecha_inicio));
    const fila = candidatas.length > 1 && lugar ? (candidatas.find((f) => f.titulo.includes(lugar)) ?? candidatas[0]) : candidatas[0];
    if (!fila) continue;
    const docs: Enlace[] = [];
    for (const b of fila.botones.filter((x) => /base|perfil|comunicado/i.test(x.nombre) && !NO_DOCUMENTO.test(x.nombre)).slice(0, 3)) {
      const v = await http.post(url, {
        "javax.faces.partial.ajax": "true", "javax.faces.source": b.id, "javax.faces.partial.execute": "@all",
        "javax.faces.partial.render": "dlgPreview", [b.id]: b.id, frmResultados: "frmResultados", "javax.faces.ViewState": vista, "primefaces.nonce": nonce,
      }, ajax);
      vista = (v?.texto && deVista(v.texto)) || vista;
      const file = v?.texto ? /\/convocatoria\/Preview\?file=([^"&]+)/.exec(v.texto)?.[1] : null;
      if (file) docs.push({ url: `https://convocatoria.minjus.gob.pe/convocatoria/Preview?file=${file}`, texto: b.nombre.toLowerCase().replace(/^./, (c) => c.toUpperCase()) });
    }
    return hallazgo(url, docs);
  }
  return null;
};

/** MINEDU (PostulacionCas): una sola página con los procesos por abrir; se empata por el título o el código AIRHSP. */
const minedu: Adaptador = async (p, http) => {
  const url = "https://postulacioncas.minedu.gob.pe/PostulacionCas/Home";
  const r = await http.get(url);
  if (!r?.texto) return null;
  const titulo = tituloComparable(p.titulo);
  const airhsp = /\((\d{6})\)|AIRHSP\D{0,5}(\d{6})/i.exec(p.titulo ?? "");
  const codigo = airhsp?.[1] ?? airhsp?.[2];
  for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    if (cs.length < 6) continue;
    const t = tituloComparable(cs[1]);
    const igual = t === titulo || (codigo && cs[1].includes(codigo)) || (titulo.length > 20 && (t.startsWith(titulo) || titulo.startsWith(t)));
    if (!igual) continue;
    const docs: Enlace[] = [];
    for (const e of enlaces(fila, r.final)) {
      if (/Descargar_Bases/i.test(e.url)) docs.push({ url: e.url, texto: "Bases del proceso CAS" });
      else if (/Descargar_Tdr/i.test(e.url)) docs.push({ url: e.url, texto: "Perfil del puesto (TDR)" });
    }
    return hallazgo(url, docs);
  }
  return null;
};

/**
 * SUNAFIL (BootsFaces): un POST del formulario de búsqueda con el número y el año devuelve la fila; las bases y los
 * comunicados están en Google Drive.
 */
const sunafil: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const inicio = "https://aplicativosweb2.sunafil.gob.pe/si.convocatoria/convocatoria";
  const r = await http.get(inicio);
  if (!r?.texto) return null;
  const accion = /<form id="formConvocatoria"[^>]*action="([^"]+)"/i.exec(r.texto)?.[1];
  if (!accion) return null;
  const selects = [...r.texto.matchAll(/<select[^>]*name="(formConvocatoria:[^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)];
  const form: Record<string, string> = { ...camposOcultos(r.texto), formConvocatoria: "formConvocatoria", "input_formConvocatoria:numproceso": String(n), "input_formConvocatoria:cargo": "", "formConvocatoria:btnBuscar": "" };
  for (const [, nombre, opciones] of selects) {
    if (new RegExp(`value="${anio}"`).test(opciones)) form[nombre] = String(anio);
    else form[nombre] = /selRegimen/i.test(nombre) ? (/<option[^>]*selected[^>]*value="([^"]*)"|<option[^>]*value="([^"]*)"[^>]*selected/i.exec(opciones)?.slice(1).find(Boolean) ?? /<option[^>]*value="([^"]*)"/i.exec(opciones)?.[1] ?? "") : "";
  }
  const res = await http.post(new URL(accion, inicio).toString(), form);
  if (!res?.texto) return null;
  for (const fila of res.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    const m = cs.length >= 6 ? /^\s*0*(\d+)\s*-\s*(\d{4})/.exec(textoPlano(cs[0])) : null;
    if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
    const docs: Enlace[] = [
      ...enlaces(cs[4], res.final).filter((e) => esDocumento(e.url)).map((e) => ({ url: e.url, texto: "Bases de la convocatoria" })),
      ...enlaces(cs[5], res.final).filter((e) => esDocumento(e.url)).map((e) => ({ url: e.url, texto: "Comunicado" })),
    ];
    return hallazgo(inicio, docs);
  }
  return null;
};

/** JUNTOS (Kendo): la lista pública en JSON; «214-2026» es el número de SERVIR. Bases y comunicados por id. */
const juntos: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://convocatoria.juntos.gob.pe";
  const lista = await http.json<{ NroConvocatoria?: string; IdBase?: number; IdTieneRequerimiento?: number; TextoComunicados?: string; NombreCargo?: string }[]>(
    `${base}/Convocatoria/ListarConvocatoriasPublico?Estado=2&IdConvocatoria=0&IdTipo=1&Anio=${anio}`,
  );
  const c = (lista ?? []).find((x) => {
    const m = /^\s*0*(\d+)\s*-\s*(\d{4})/.exec(x.NroConvocatoria ?? "");
    return !!m && Number(m[1]) === n && Number(m[2]) === anio;
  });
  if (!c) return null;
  const docs: Enlace[] = [];
  if (c.IdBase && c.IdTieneRequerimiento === 1) docs.push({ url: `${base}/Convocatoria/DescargarArchivoBases/?id=${c.IdBase}`, texto: "Bases de la convocatoria" });
  for (const parte of (c.TextoComunicados ?? "").split("|")) {
    const [nombre, id] = parte.split("#");
    if (id && nombre && !NO_DOCUMENTO.test(nombre)) docs.push({ url: `${base}/Convocatoria/DescargarArchivoPorId/?idConvocatoriaDoc=${id}`, texto: textoPlano(nombre) });
  }
  return hallazgo(`${base}/Convocatoria/Lista`, docs);
};

/** MINSA: la tabla de convocatorias (2025 y 2026) con «059-2026 DETERMINADO» y su enlace a la base. */
const minsa: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const url = "https://convocatorias.minsa.gob.pe/convocatorias";
  const r = await http.pedir(url, { timeoutMs: 30_000 });
  if (!r?.texto) return null;
  let mejor: { docs: Enlace[]; puntaje: number } | null = null;
  for (const fila of r.texto.split(/<tr id="/i).slice(1)) {
    const cs = celdas(fila);
    const m = cs.length >= 5 ? /^\s*0*(\d+)\s*-\s*(\d{4})/.exec(textoPlano(cs[0])) : null;
    if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
    const puntaje = parecidoPuesto(p.titulo, textoPlano(cs[1])) + (isoDe(textoPlano(cs[3])) === p.fecha_inicio ? 1 : 0);
    const docs = enlaces(cs[4], r.final).filter((e) => /GetBaseConvocatoria/i.test(e.url)).map((e) => ({ url: e.url, texto: "Bases de la convocatoria" }));
    if (docs.length && (!mejor || puntaje > mejor.puntaje)) mejor = { docs, puntaje };
  }
  return mejor ? hallazgo(url, mejor.docs) : null;
};

// ─── Plataformas regionales (Cajamarca, Piura, Amazonas) y la DRE Cajamarca ──────────────────────

const VACIAS = new Set(["de", "la", "del", "los", "las", "y", "unidad", "ejecutora", "gobierno", "region", "regional", "gr", "ue", "sede"]);
/** Qué tanto se parecen dos nombres de entidad (0 a 1), con abreviaturas («TRANSP» = «TRANSPORTES»). */
export function parecidoEntidad(a: string, b: string): number {
  const ws = (t: string) => normalizar(t).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !VACIAS.has(w));
  const x = ws(a);
  const y = ws(b);
  if (!x.length || !y.length) return 0;
  const [chico, grande] = x.length <= y.length ? [x, y] : [y, x];
  const comun = chico.filter((w) => grande.some((v) => v.startsWith(w.slice(0, 5)) || w.startsWith(v.slice(0, 5)))).length;
  return comun / chico.length;
}

const ventana = (html: string) => [...html.matchAll(/window\.open\('([^']+)'/g)].map((m) => m[1]);

/** Cajamarca (Django, dos dominios la misma app): pestañas por entidad, tarjetas por proceso, plazas con su perfil. */
const cajamarca: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = new URL((p.detalle_url ?? "").match(/https?:\/\/[^\s]+/)?.[0] ?? "https://convocatoriasgrc.regioncajamarca.gob.pe/").origin;
  const es276 = regimenDe(p.numero) === "276";
  const tarjetas = (html: string) => html.split(/<div class="card mb-5/i).slice(1).map((c) => ({
    titulo: textoPlano(/class="card-label[^"]*">([\s\S]*?)<\/span>/i.exec(c)?.[1] ?? ""),
    entidad: textoPlano(/class="text-muted[^"]*">([\s\S]*?)<\/span>/i.exec(c)?.[1] ?? ""),
    pk: /data-pk="(\d+)"\s+data-tipo="01"/i.exec(c)?.[1] ?? null,
    bases: ventana(c),
  }));
  const sirve = (t: { titulo: string; entidad: string }) => {
    const m = /N\s*[°ºo.]*\s*0*(\d+)\s*-\s*(20\d{2})/i.exec(t.titulo) ?? /\b0*(\d+)\s*-\s*(20\d{2})/.exec(t.titulo);
    return !!m && Number(m[1]) === n && Number(m[2]) === anio && /\b276\b/.test(t.titulo) === es276 && parecidoEntidad(p.entidad ?? "", t.entidad) >= 0.5;
  };
  // Las abiertas, por la pestaña de la entidad; si no, las cerradas por búsqueda.
  const inicio = await http.get(`${base}/`);
  const pestanas = [...(inicio?.texto ?? "").matchAll(/<a data-pk="(\d+)"[\s\S]*?<\/a>/gi)].map((m) => ({ pk: m[1], nombre: textoPlano(m[0]) }));
  const entidad = pestanas.map((x) => ({ ...x, s: parecidoEntidad(p.entidad ?? "", x.nombre) })).sort((a, b) => b.s - a.s)[0];
  let tarjeta = null as ReturnType<typeof tarjetas>[number] | null;
  if (entidad && entidad.s >= 0.5) {
    const l = await http.get(`${base}/lista/${entidad.pk}/`);
    tarjeta = tarjetas(l?.texto ?? "").filter(sirve).sort((a, b) => Number(b.pk) - Number(a.pk))[0] ?? null;
  }
  if (!tarjeta) {
    const l = await http.get(`${base}/convocatorias/inactivas/lista/?pagination=100&search=${pad(n, 3)}-${anio}&page=1`);
    tarjeta = tarjetas(l?.texto ?? "").filter(sirve).sort((a, b) => Number(b.pk) - Number(a.pk))[0] ?? null;
  }
  if (!tarjeta?.pk) return null;
  const docs: Enlace[] = tarjeta.bases.map((u) => ({ url: new URL(u, base).toString(), texto: "Bases" }));
  // El perfil de la plaza (buscada por la primera palabra del puesto).
  const palabra = (palabrasPuesto(p.titulo)[0] ?? "").toUpperCase();
  const plazas = await http.get(`${base}/plaza/lista/${tarjeta.pk}/?page=1&pagination=100&search=${encodeURIComponent(palabra)}`);
  const plaza = (plazas?.texto ?? "").split(/<tr\b/i).slice(1)
    .map((f) => ({ pk: /data-pk="(\d+)"[^>]*btnDetallePlaza|btnDetallePlaza[^>]*data-pk="(\d+)"/i.exec(f)?.slice(1).find(Boolean), s: parecidoPuesto(p.titulo, textoPlano(f)) }))
    .filter((x) => x.pk).sort((a, b) => b.s - a.s)[0];
  if (plaza?.pk) {
    const d = await http.get(`${base}/plaza/detalle/${plaza.pk}/`);
    for (const u of ventana(d?.texto ?? "")) docs.push({ url: new URL(u, base).toString(), texto: "Perfil del puesto" });
  }
  const pub = await http.get(`${base}/publicaciones/lista/${tarjeta.pk}/`);
  for (const fila of (pub?.texto ?? "").split(/<tr\b/i).slice(1)) {
    const t = textoPlano(fila);
    if (NO_DOCUMENTO.test(t)) continue;
    for (const u of ventana(fila)) docs.push({ url: new URL(u, base).toString(), texto: /errata/i.test(t) ? "Fe de erratas" : "Comunicado" });
  }
  return hallazgo(`${base}/`, docs);
};

/** Piura: /{entidad} con toda su historia en una tabla, y /{entidad}/{id} con los documentos por etapa. */
const piura: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const url = (p.detalle_url ?? "").match(/https?:\/\/convocatorias\.regionpiura\.gob\.pe\/[^\s]*/i)?.[0];
  const slug = url ? new URL(url).pathname.split("/").filter(Boolean)[0] : null;
  if (!slug) return null;
  const base = "https://convocatorias.regionpiura.gob.pe";
  const r = await http.get(`${base}/${slug}`);
  if (!r?.texto) return null;
  const candidatos = r.texto.split(/<tr\b/i).slice(1).map((f) => {
    const cs = celdas(f);
    const nombre = textoPlano(cs[3] ?? "");
    const m = /N\s*[º°o.]*\s*0*(\d+)\s*-\s*(20\d{2})/i.exec(nombre) ?? /\b0*(\d+)\s*-\s*(20\d{2})/.exec(nombre);
    const id = new RegExp(`href="(?:\\/)?${slug}\\/(\\d+)"`, "i").exec(f)?.[1];
    const fecha = /data-order="(\d{4}-\d{2}-\d{2})/.exec(cs[0] ?? f)?.[1] ?? null;
    return { id, fecha, ok: !!m && Number(m[1]) === n && Number(m[2]) === anio, abierta: /vigente|en proceso/i.test(textoPlano(cs[1] ?? "")) };
  }).filter((x) => x.ok && x.id);
  const elegido = candidatos.sort((a, b) => Number(b.abierta) - Number(a.abierta) || (b.fecha ?? "").localeCompare(a.fecha ?? ""))[0];
  if (!elegido) return null;
  const ficha = `${base}/${slug}/${elegido.id}`;
  const d = await http.get(ficha);
  if (!d?.texto) return null;
  const docs: Enlace[] = [];
  for (const fila of d.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    const etapa = textoPlano(cs[1] ?? "");
    if (!etapa || /resultado|absoluci/i.test(etapa)) continue;
    for (const e of enlaces(fila, d.final)) if (esDocumento(e.url)) docs.push({ url: e.url, texto: etapa });
  }
  return hallazgo(ficha, docs);
};

/** Amazonas (gorea360): una API pública en JSON (convocatorias, archivos y plazas); los archivos por /api/Archivo/{id}/descargar. */
const amazonas: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  const anio = anioDe(p);
  const api = "https://api.gorea360.regionamazonas.gob.pe/api";
  const [conv, unidades] = await Promise.all([
    http.json<{ datos?: { convocatoriaId: number; unidadEjecutoraId: number; nombre: string; anioProceso: number; numero: number; tipoConvocatoriaId: number }[] }>(`${api}/Convocatoria`),
    http.json<{ datos?: Record<string, unknown>[] }>(`${api}/UnidadEjecutora/combo`),
  ]);
  const nombreUnidad = (u: Record<string, unknown>) => String(u.nombre ?? u.descripcion ?? u.text ?? u.label ?? "");
  const unidad = (unidades?.datos ?? []).map((u) => ({ id: Number(u.id ?? u.unidadEjecutoraId ?? u.value), s: parecidoEntidad(p.entidad ?? "", nombreUnidad(u)) }))
    .sort((a, b) => b.s - a.s)[0];
  if (!unidad || unidad.s < 0.5) return null;
  const tipo = regimenDe(p.numero) === "276" ? 1 : 34;
  const c = (conv?.datos ?? []).filter((x) => x.unidadEjecutoraId === unidad.id && x.anioProceso === anio && x.tipoConvocatoriaId === tipo).find((x) => {
    const m = /N\s*[º°o.]*\s*0*(\d+)\s*-\s*(20\d{2})/i.exec(x.nombre) ?? /\b0*(\d+)\s*-\s*(20\d{2})/.exec(x.nombre);
    return n == null || (m ? Number(m[1]) === n : x.numero === n);
  });
  if (!c) return null;
  const [archivos, plazas] = await Promise.all([
    http.json<{ datos?: { archivoId: number; tipoNombre: string }[] }>(`${api}/ConvocatoriaArchivo/convocatoria/${c.convocatoriaId}`),
    http.json<{ datos?: { nombre: string; archivoId: number | null }[] }>(`${api}/Plaza/convocatoria/${c.convocatoriaId}`),
  ]);
  const docs: Enlace[] = (archivos?.datos ?? []).map((a) => ({ url: `${api}/Archivo/${a.archivoId}/descargar`, texto: textoPlano(a.tipoNombre) || "Documento" }));
  const plaza = (plazas?.datos ?? []).filter((x) => x.archivoId).map((x) => ({ ...x, s: parecidoPuesto(p.titulo, x.nombre) })).sort((a, b) => b.s - a.s)[0];
  if (plaza && plaza.s > 0) docs.push({ url: `${api}/Archivo/${plaza.archivoId}/descargar`, texto: `Perfil del puesto: ${textoPlano(plaza.nombre)}` });
  return hallazgo(`https://convocatorias.regionamazonas.gob.pe/`, docs);
};

/** DRE Cajamarca: la lista de publicaciones (10 por página, búsqueda por POST con su csrftoken); 276 por ronda, CAS por número. */
const dreCajamarca: Adaptador = async (p, http) => {
  const anio = anioDe(p);
  const base = "https://www.educacioncajamarca.gob.pe";
  const r = await http.get(`${base}/portal/ac/189`);
  if (!r?.texto) return null;
  const items = (html: string) => html.split(/class="normatividad-item/i).slice(1).map((b) => ({
    titulo: textoPlano(/<h5[^>]*>([\s\S]*?)<\/h5>/i.exec(b)?.[1] ?? ""),
    fecha: fechaEs(textoPlano(/<small class="[^"]*text-muted[^"]*">([\s\S]*?)<\/small>/i.exec(b)?.[1] ?? "")),
    docs: [...b.matchAll(/<a\b[^>]*href="([^"]*\/media\/portal\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => ({ url: new URL(m[1].replace(/&amp;/g, "&"), base).toString(), texto: textoPlano(/<small>([\s\S]*?)<\/small>/i.exec(m[2])?.[1] ?? m[2]) || nombreDeArchivo(m[1]) }))
      .filter((d) => !ES_RESULTADO.test(d.texto) && !/apto|fe de errata/i.test(d.texto)),
  }));
  if (regimenDe(p.numero) === "cas") {
    const n = numeroProceso(p.numero);
    if (n == null) return null;
    const conCas = (html: string) => items(html).find((x) => new RegExp(`CAS\\s*N\\D{0,3}0*${n}\\s*-\\s*${anio}`, "i").test(x.titulo));
    let item = conCas(r.texto);
    if (!item) {
      const csrf = http.cookies().csrftoken;
      if (csrf) {
        const s = await http.pedir(`${base}/portal/docs/267/CAS/${anio}/0`, { form: { csrfmiddlewaretoken: csrf }, cabeceras: { referer: `${base}/portal/ac/189` } });
        item = s?.texto ? conCas(s.texto) : undefined;
      }
    }
    return item ? hallazgo(`${base}/portal/ac/189`, item.docs) : null;
  }
  const ronda = rondaVigente(items(r.texto).filter((x) => /\b276\b/.test(x.titulo) && x.docs.length), p.fecha_inicio);
  return ronda ? hallazgo(`${base}/portal/ac/189`, ronda.docs, "lista") : null;
};

Object.assign(ADAPTADORES, {
  "convocatoria.minjus.gob.pe": minjus,
  "postulacioncas.minedu.gob.pe": minedu,
  "aplicativosweb2.sunafil.gob.pe": sunafil,
  "convocatoria.juntos.gob.pe": juntos,
  "convocatorias.minsa.gob.pe": minsa,
  "convocatoriasgrc.regioncajamarca.gob.pe": cajamarca,
  "convocatorias.regioncajamarca.gob.pe": cajamarca,
  "convocatorias.regionpiura.gob.pe": piura,
  "convocatorias.regionamazonas.gob.pe": amazonas,
  "www.educacioncajamarca.gob.pe": dreCajamarca,
} satisfies Record<string, Adaptador>);

// ─── gob.pe: la búsqueda pública (busquedas.json) ─────────────────────────────────────────────────

/**
 * gob.pe (1 303 plazas en 90 días): en vez de recorrer la página que enlaza SERVIR (una portada, una página de servicio,
 * una colección con hojas), se busca en `busquedas.json` por institución y ventana de fechas: el número, luego lo más
 * nuevo, luego el régimen (276/728) y luego las palabras del puesto. Medido el 2026-11-09 sobre 81 plazas: mismo hallazgo
 * en 38, 12 nuevos y 3 publicaciones equivocadas corregidas, con 2,6 pedidos en promedio. Los enlaces directos a una
 * publicación siguen con el genérico (ya funcionan).
 */
const NO_INSTITUCION = new Set(["", "estado", "busquedas", "tema", "funcionariospublicos", "redessociales", "establecimientosdesalud", "aeropuertosperu", "institucion", "es", "normas-legales", "noticias"]);
const NORMAS_GOBPE = /\b(resolucion|directiva|decreto|ley\b|oficio|informe|memorando|ordenanza|acuerdo|convenio|cuadro multianual|rendicion)/;
const RESULTADOS_GOBPE = /\b(resultado|comunicado|actas?\b|fe de errata|puntaje|aptos?\b|ganador|entrevista|evaluacion curricular|rectificacion|postergacion|cancelacion|desiert|concurso interno|ascenso|cambio de grupo ocupacional|reasignacion|nombramiento)/;

const corrido = (iso: string, d: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

interface ResultadoGobPe { titulo: string; href: string; doc: string | null; pub: string | null; texto: string }

async function slugsGobPe(inicio: string, http: Http): Promise<string[]> {
  let m = /^https:\/\/www\.gob\.pe\/institucion\/([^/?#]+)/i.exec(inicio);
  if (m) return [m[1].toLowerCase()];
  m = /^https:\/\/www\.gob\.pe\/([a-z][a-z0-9-]*)\/?$/i.exec(inicio);
  if (m && !NO_INSTITUCION.has(m[1].toLowerCase())) return [m[1].toLowerCase()];
  const r = await http.get(inicio);
  if (!r) return [];
  m = /^https:\/\/www\.gob\.pe\/institucion\/([^/?#]+)/i.exec(r.final);
  if (m) return [m[1].toLowerCase()];
  const out: string[] = [];
  for (const e of enlaces(r.texto, r.final)) {
    const k = /^https:\/\/www\.gob\.pe\/([a-z][a-z0-9-]*)\/?$/i.exec(e.url)?.[1]?.toLowerCase();
    if (k && !NO_INSTITUCION.has(k) && !out.includes(k)) out.push(k);
  }
  return out.slice(0, 3);
}

async function buscarGobPe(http: Http, slugs: string[], term: string, desde: string, hasta: string, orden: "none" | "recent"): Promise<{ total: number; res: ResultadoGobPe[] }> {
  const q = new URLSearchParams();
  q.append("contenido[]", "publicaciones");
  q.append("contenido[]", "campañas");
  for (const s of slugs) q.append("institucion[]", s);
  q.set("term", term);
  q.set("sort_by", orden);
  q.set("desde", desde);
  q.set("hasta", hasta);
  q.set("sheet", "1");
  const j = await http.json<{ data?: { attributes?: { total_count?: number; results?: Record<string, unknown>[] } } }>(`https://www.gob.pe/busquedas.json?${q}`);
  if (!j) return { total: -1, res: [] };
  const a = j.data?.attributes ?? {};
  const res: ResultadoGobPe[] = [];
  for (const x of a.results ?? []) {
    const url = String(x.url ?? "");
    const href = /href="([^"]+)"/.exec(url)?.[1];
    if (!href || !slugs.some((s) => href.toLowerCase().startsWith(`/institucion/${s}/`))) continue;
    if (!/\/(informes-publicaciones|campa%C3%B1as|campañas)\/\d+/i.test(href)) continue;
    const titulo = textoPlano(url);
    const doc = typeof x.action_url === "string" ? x.action_url : null;
    const archivo = (doc ?? "").split("/").pop()?.split("?")[0] ?? "";
    res.push({ titulo, href: `https://www.gob.pe${href}`, doc, pub: fechaEs(String(x.publication ?? "")), texto: `${titulo} ${textoPlano(String(x.content ?? ""))} ${archivo} ${href.split("/").pop()}` });
  }
  return { total: a.total_count ?? 0, res };
}

function otroNumero(t: string, n: number | null): boolean {
  if (n == null) return false;
  for (const m of t.matchAll(/\b(?:cas|proceso|convocatoria|concurso)\s+(?:temporal\s+|transitorio\s+)?(?:n\s+|nro\s+)?0*(\d{1,4})\s+(?:20\d\d)?/g)) if (Number(m[1]) !== n) return true;
  return false;
}

/** El puntaje de un resultado de la búsqueda para la plaza (reglas medidas sobre 81 casos; ver la cabecera). */
export function puntajeGobPe(
  x: Pick<ResultadoGobPe, "titulo" | "texto" | "doc" | "pub">, p: Pick<PlazaParaBases, "fecha_inicio">, n: number | null, anio: number, palabras: string[], regimen: string | null, lugar: string[],
) {
  const t = normalizar(x.texto).replace(/\//g, " ");
  const tt = normalizar(x.titulo);
  let pt = 0;
  // «CAS N° 007-2026» o el par número-año («Provisión Externa 007-2026»), sin el «n» suelto («Cas. Unión, Lote N° 1» es un caserío).
  const num = n != null && (
    new RegExp(`\\b(?:cas|proceso|convocatoria|concurso|seleccion|cap)(?: (?:temporal|transitorio|por suplencia temporal))?[ .:]{0,3}(?:n|nro|no)?[ .:]{0,3}0*${n}(?![0-9])`).test(t)
    || new RegExp(`(?<![0-9])0*${n} (${anio}|${anio + 1})\\b`).test(t));
  const otro = !num && otroNumero(t, n);
  if (num) pt += 5;
  if (otro) pt -= 6;
  if (NORMAS_GOBPE.test(tt)) pt -= 1;
  if (RESULTADOS_GOBPE.test(tt)) pt -= 4;
  if (/\b(bases|convocatoria|perfil|terminos de referencia|tdr)\b/.test(`${tt} ${normalizar((x.doc ?? "").split("/").pop() ?? "")}`)) pt += 1;
  if (/\b(anexos?|formatos?|fichas?)\b/.test(tt) && !/\bbases\b/.test(tt)) pt -= 1;
  if (t.includes(String(anio)) || t.includes(String(anio + 1))) pt += 1;
  else if (/20\d\d/.test(t)) pt -= 2;
  const tit = palabras.filter((w) => t.includes(w.slice(0, Math.max(5, Math.min(w.length, 7))))).length;
  pt += Math.min(3, tit);
  const reg = !!regimen && new RegExp(`\\b${regimen}\\b`).test(t);
  if (reg) pt += 2;
  // Otro régimen: una plaza 276/728 no es un «CAS» (1057), y una CAS no es una «276»/«728».
  if (regimen && !reg && /\b(cas|1057)\b/.test(t)) pt -= 4;
  if (!regimen && /\b(d l|d leg|decreto legislativo|regimen laboral)\s*(n\s*)?(276|728)\b/.test(t) && !/\b(cas|1057)\b/.test(t)) pt -= 4;
  const enLugar = lugar.some((l) => l.length >= 4 && t.includes(l));
  if (enLugar) pt += 1;
  const conv = /\b(convocatoria|proceso|seleccion|concurso|cas|bases|contratacion|personal|plazas?|puestos?|perfil|tdr|terminos de referencia)\b/.test(t);
  if (conv) pt += 1;
  const cerca = !!x.pub && !!p.fecha_inicio && x.pub >= corrido(p.fecha_inicio, -12) && x.pub <= corrido(p.fecha_inicio, 2);
  if (cerca) pt += 1;
  const malo = !conv || RESULTADOS_GOBPE.test(tt) || otro || (!!regimen && !reg && /\b(cas|1057)\b/.test(t))
    || /^[^a-z]*(resolucion|directiva|decreto|ley|oficio|informe|memorando|ordenanza|acuerdo|convenio|modificacion|aprobacion|aprobar|constancia|aviso de inscripcion)\b/.test(tt);
  // Sin número: que sea de personal y no una compra u obra («Proceso de Selección N° PRO-001-2026-MVCS/HUALLANCA-OxI»).
  const personal = /\b(cas|1057|276|728|contratacion administrativa de servicios|personal|puesto|plaza|perfil|terminos de referencia)\b/.test(t)
    && !/\b(oxi|obra|obras|bienes|consultoria|adquisicion|licitacion|expediente tecnico|contratacion directa|subasta)\b/.test(t);
  const ok = !malo && ((num && pt >= 6) || (!num && personal && reg && (enLugar || tit >= 1 || cerca) && pt >= 5) || (!num && personal && tit >= Math.min(2, palabras.length) && pt >= 5));
  return { p: pt, num, tit, ok, malo };
}

const cuerpoNormal = (html: string) => normalizar(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "));

const gobpe: Adaptador = async (p, http) => {
  const crudo = (p.detalle_url ?? "").split(/[;\s]+/).map((u) => u.replace(/[,.;]+$/, "")).find((u) => /^https:\/\/www\.gob\.pe\//i.test(u));
  if (!crudo || !p.fecha_inicio) return null;
  // La vista previa del panel de gob.pe (pide sesión) → el enlace público corto.
  const inicio = crudo.replace(/^https:\/\/www\.gob\.pe\/admin2\/informes-publicaciones\/(\d+)-[^?#]*.*$/i, "https://www.gob.pe/es/i/$1");
  // Un enlace directo a la publicación: lo resuelve el genérico (ya lo hacía bien).
  if (esProcesoGobPe(inicio)) return null;
  const n = numeroProceso(p.numero);
  const anio = anioDe(p);
  const palabras = palabrasPuesto(p.titulo);
  const regimen = /^(276|728)\b/.exec(p.numero ?? "")?.[1] ?? null;
  const lugar = (p.ubicacion ?? "").split(/\s+-\s+/).map((s) => normalizar(s));
  let slugs = await slugsGobPe(inicio, http);
  if (!slugs.length) return null;
  const desde = corrido(p.fecha_inicio, -45);
  const hasta = corrido(p.fecha_inicio, 5);
  let mejor: { x: ResultadoGobPe; p: number } | null = null;
  let empatados: ResultadoGobPe[] = [];
  const evaluar = (rs: ResultadoGobPe[]) => {
    for (const x of rs) {
      const k = puntajeGobPe(x, p, n, anio, palabras, regimen, lugar);
      if (!k.ok) continue;
      if (!mejor || k.p > mejor.p) {
        mejor = { x, p: k.p };
        empatados = [x];
      } else if (k.p === mejor.p && x.href !== mejor.x.href) empatados.push(x);
    }
  };
  // 1. El número solo (gob.pe ignora los ceros: 3 = 03 = 003).
  if (n != null) {
    let a = await buscarGobPe(http, slugs, String(n), desde, hasta, "none");
    if (a.total < 0) {
      // Institución renombrada (/drscy → /sbscy): la búsqueda da 404; la portada redirige al nombre nuevo.
      const r = await http.get(inicio);
      const k = r ? /^https:\/\/www\.gob\.pe\/(?:institucion\/)?([a-z][a-z0-9-]*)/i.exec(r.final)?.[1]?.toLowerCase() : null;
      if (k && !slugs.includes(k)) slugs = [k];
      a = await buscarGobPe(http, slugs, String(n), desde, hasta, "none");
    }
    evaluar(a.res);
  }
  // 2. Lo más nuevo de la ventana (el número sólo en la descripción o en el archivo).
  if (!mejor) evaluar((await buscarGobPe(http, slugs, "", desde, hasta, "recent")).res);
  // 3. 276/728: el régimen (la convocatoria anual de la UGEL no lleva el número de la plaza).
  if (!mejor && regimen) evaluar((await buscarGobPe(http, slugs, regimen, desde, hasta, "recent")).res);
  // 4. Las palabras del puesto (una campaña que reúne varios puestos): si hay pocas, se abre y se verifica el puesto.
  if (!mejor && palabras.length) {
    const b = await buscarGobPe(http, slugs, palabras.slice(0, 4).join(" "), desde, hasta, "none");
    evaluar(b.res);
    const q3 = !mejor && b.total > 0 && b.total <= 3 ? b.res.filter((x) => !puntajeGobPe(x, p, n, anio, palabras, regimen, lugar).malo) : [];
    if (q3.length) {
      const r = await http.get(q3[0].href);
      const cuerpo = cuerpoNormal(r?.texto ?? "");
      const enCuerpo = palabras.filter((w) => cuerpo.includes(w.slice(0, Math.max(5, Math.min(w.length, 7))))).length;
      if (r && enCuerpo >= Math.min(2, palabras.length)) return hallazgo(q3[0].href, documentosDePagina(enlaces(r.texto, r.final), n, anio, true));
    }
  }
  if (!mejor) return null;
  const elegido = mejor as { x: ResultadoGobPe; p: number };
  let pagina = elegido.x.href;
  let html: { texto: string; final: string } | null = null;
  if (empatados.length > 1) {
    // Varias unidades con el mismo número (FAP: «Nº002-2026 - AGRAJ», «- GRUP7»…): la que nombra el puesto o el lugar.
    let mejorEmpate: { href: string; puntos: number; texto: string; final: string } | null = null;
    for (const x of empatados.slice(0, 3)) {
      const r = await http.get(x.href);
      if (!r) continue;
      const cuerpo = cuerpoNormal(r.texto);
      const puntos = palabras.filter((w) => cuerpo.includes(w.slice(0, Math.max(5, Math.min(w.length, 7))))).length + lugar.filter((l) => l.length >= 4 && cuerpo.includes(l)).length;
      if (!mejorEmpate || puntos > mejorEmpate.puntos) mejorEmpate = { href: x.href, puntos, texto: r.texto, final: r.final };
    }
    if (!mejorEmpate || mejorEmpate.puntos === 0) return null;
    pagina = mejorEmpate.href;
    html = mejorEmpate;
  }
  if (!html) {
    const r = await http.get(pagina);
    if (r) html = r;
  }
  const docs = html ? documentosDePagina(enlaces(html.texto, html.final), n, anio, true) : [];
  return hallazgo(pagina, docs.length ? docs : elegido.x.doc ? [{ url: elegido.x.doc, texto: elegido.x.titulo }] : []);
};

Object.assign(ADAPTADORES, { "www.gob.pe": gobpe, "gob.pe": gobpe } satisfies Record<string, Adaptador>);
