/**
 * Las bases de una plaza CAS, buscadas y leídas por Gobserva (2026-11-08, el usuario: «¿por qué nosotros no descargamos?
 * ¿resumimos bases y demás? parece que sólo somos proveedores de enlaces»).
 *
 * SERVIR no publica las bases: sólo un enlace a la web de la entidad (`detalle_url`), casi siempre a su lista de
 * convocatorias. Acá:
 *   1. buscarBases: abre esa página y busca el enlace de ESTE proceso por su número (el final de `numero`: «…-108» es el
 *      «CAS N° 108-2026»). Si el enlace es un documento, ése es; si es una página (la del proceso), la abre y toma sus
 *      documentos. En gob.pe recorre las hojas de la colección (?sheet=2…). Como mucho 9 pedidos.
 *   2. leerBases: Haiku 5.5 (vigia-llm, /nativo) lee los PDF y responde con una herramienta forzada: si los documentos son
 *      de esta plaza (`corresponde`), qué hará, el cronograma, cómo evalúan, qué presentar, cómo se postula y qué deja fuera
 *      a la gente. Las bases traen a veces varias plazas: lee sólo la de este puesto y lo común. Nunca escribe nombres.
 *
 * Cubre gob.pe y los sitios que enlazan sus documentos en el HTML (el Poder Judicial, el Ministerio Público o la DRELM
 * bloquean a Cloudflare, y otros son aplicaciones con formulario: ahí queda «no encontradas» y el enlace de siempre).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { MODELO_ASISTENTE } from "./asistente.js";
import { lista, texto } from "./resumenPlaza.js";

export interface PlazaParaBases {
  aviso: number;
  titulo: string | null;
  entidad: string | null;
  numero: string | null;
  detalle_url: string | null;
  fecha_inicio: string | null;
}

export interface Enlace {
  url: string;
  texto: string;
}

export interface DocumentoBase {
  titulo: string;
  url: string;
  /** Si lo bajamos y lo guardamos en R2: la clave (24 hex) de GET /empleo/bases/:clave. */
  clave?: string;
  /** Si Haiku lo leyó. */
  leido?: boolean;
}

// ─── Lo puro: leer enlaces y puntuarlos ─────────────────────────────────────────────────────────────

/** El número del proceso: lo último de `numero` («D.LEG 1057 - DETERMINADO (…)-108» → 108, «276-26» → 26). */
export function numeroProceso(numero: string | null): number | null {
  const m = /(\d{1,4})\s*$/.exec(numero ?? "");
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return n > 0 ? n : null;
}

/** Minúsculas, sin tildes, «N°»/«Nº»/«_»/«%20» como espacios: para comparar texto y direcciones. */
export function normalizar(s: string): string {
  let t = s;
  try {
    t = decodeURIComponent(t);
  } catch {
    /* deja el texto como vino */
  }
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[°º]/g, " ")
    .replace(/[-_+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const desescapar = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, k: string) => ENTIDADES[k] ?? "").replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

/** Los enlaces de una página (absolutos, sin repetir, sin anclas ni javascript:). */
export function enlaces(html: string, base: string): Enlace[] {
  const vistos = new Map<string, Enlace>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try {
      url = new URL(desescapar(m[1]).trim(), base).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(url)) continue;
    const textoA = desescapar(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const previo = vistos.get(url);
    if (!previo || (!previo.texto && textoA)) vistos.set(url, { url, texto: textoA.slice(0, 300) });
  }
  return [...vistos.values()];
}

/** Si el enlace es un documento (PDF, Word, ZIP o un archivo de gob.pe), no una página. */
export function esDocumento(url: string): boolean {
  if (/\/preview_[^/]*\.(jpe?g|png)(\?|$)/i.test(url)) return false;
  return /\.(pdf|docx?|zip|rar)(\?|$)/i.test(url) || /cdn\.www\.gob\.pe\/uploads\/document\/file\//i.test(url);
}

export const esPdf = (url: string) => /\.pdf(\?|$)/i.test(url);

/**
 * Lo que se compara de un enlace: su texto y el final de su dirección (sin «informes-publicaciones», la carpeta de
 * gob.pe: caía en las normas y ningún proceso de gob.pe salía).
 */
const huellaEnlace = (e: Enlace) =>
  normalizar(`${e.texto} ${e.url.split("?")[0].split("/").slice(-2).join(" ")}`.replace(/informes-publicaciones/gi, " "));

/**
 * Si el texto nombra al proceso `n`: «CAS N° 108-2026», «cas-n-108-2026-ugel01-…», «PROCESO CAS N° 93 -2026»,
 * «Convocatoria 005». El número tiene que venir pegado a una de esas palabras: un «5» suelto no basta.
 */
export function mencionaProceso(textoNormalizado: string, n: number): boolean {
  const re = new RegExp(`(?:\\bcas|proceso|convocatoria|concurso|\\bn|\\bnro|\\bnum)[\\s.:-]{0,6}(?:n[\\s.:-]{0,3})?0*${n}(?![0-9])`);
  return re.test(textoNormalizado.replace(/-/g, " - "));
}

/** Las palabras del puesto que sirven para reconocerlo (sin «de», «en», «I», «II»…). */
export function palabrasPuesto(titulo: string | null): string[] {
  return [...new Set(normalizar(titulo ?? "").split(/[^a-z0-9]+/).filter((p) => p.length >= 4 && !VACIAS.has(p)))].slice(0, 6);
}
const VACIAS = new Set(["para", "como", "area", "unidad", "oficina", "servicio", "servicios", "plaza", "puesto"]);

// Sin \b al final: los archivos traen el número pegado («anexo1.pdf», «comunicado2.pdf»).
const BUENOS = /\b(bases|perfil|terminos de referencia|tdr\b|requisitos|convocatoria|aviso)/;
const MEDIOS = /\b(cronograma|anexo|formato|declaracion|ficha)/;
const RESULTADOS = /\b(resultado|comunicado|actas?\b|fe de errata|puntaje|aptos?\b|ganador|entrevista|evaluacion curricular|rectificacion|postergacion|cancelacion|desiert)/;
/** Normas y oficios: traen «N° 005-2026» pero no son el proceso. */
const NORMAS = /\b(resolucion|directiva|decreto|ley\b|oficio|informe|memorando|ordenanza|acuerdo)/;

/** El puntaje de un enlace candidato a ser el del proceso. 0 si no lo nombra. */
export function puntajeEnlace(e: Enlace, n: number, anio: number, palabras: string[]): number {
  const t = huellaEnlace(e);
  if (!mencionaProceso(t, n)) return 0;
  let p = 3;
  if (NORMAS.test(t)) p -= 4;
  if (t.includes(String(anio))) p += 2;
  else if (/20\d\d/.test(t)) p -= 2;
  p += Math.min(3, palabras.filter((w) => t.includes(w)).length);
  if (esDocumento(e.url)) p += 1;
  return p;
}

/** Los documentos de la página de un proceso, los más útiles primero (las bases antes que los resultados). */
export function documentosDePagina(lista: Enlace[], n: number | null, anio: number, todos = false): Enlace[] {
  const docs = lista.filter((e) => esDocumento(e.url));
  const puntuados = docs.map((e) => {
    const t = huellaEnlace(e);
    // En la página de UN proceso todos son de él: ahí el número no suma (si no, los anexos les ganan a las bases).
    let p = todos ? 2 : 0;
    if (!todos && n != null && mencionaProceso(t, n)) p += 4;
    if (BUENOS.test(t)) p += 3;
    else if (MEDIOS.test(t)) p += 1;
    if (RESULTADOS.test(t)) p -= 6;
    if (t.includes(String(anio))) p += 1;
    if (esPdf(e.url)) p += 1;
    return { e, p };
  });
  // Los documentos de otra carpeta que la del mejor (otra convocatoria en la misma página) bajan.
  const mejor = [...puntuados].sort((a, b) => b.p - a.p)[0];
  const carpeta = (u: string) => u.split("?")[0].replace(/\/[^/]*$/, "");
  if (mejor && !/cdn\.www\.gob\.pe/.test(mejor.e.url)) {
    for (const x of puntuados) if (carpeta(x.e.url) !== carpeta(mejor.e.url)) x.p -= 2;
  }
  return puntuados.filter((x) => x.p >= 2).sort((a, b) => b.p - a.p).slice(0, 5).map((x) => x.e);
}

/** El nombre de un documento para mostrarlo: el texto del enlace si dice algo; si no, el nombre del archivo. */
export function tituloDocumento(e: Enlace): string {
  const t = e.texto.replace(/\s+/g, " ").trim();
  if (t.length >= 6 && !/^(descargar|ver|aqui|aquí|clic|click|ver documento|ver norma|ver aqui|ver aquí|pdf|abrir)\b/i.test(t)) return recortarTitulo(t);
  let archivo = e.url.split("?")[0].split("/").pop() ?? "documento";
  try {
    archivo = decodeURIComponent(archivo);
  } catch {
    /* tal cual */
  }
  const limpio = archivo.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/^\d{4,}[-_]/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const oracion = limpio === limpio.toUpperCase() || limpio === limpio.toLowerCase() ? limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase() : limpio;
  return recortarTitulo(oracion || "Documento");
}
const recortarTitulo = (t: string) => (t.length > 90 ? `${t.slice(0, 88).replace(/\s+\S*$/, "")}…` : t);

/** En una lista por años, el enlace (del mismo sitio, no un documento) cuyo texto es el año: «2026», «Año 2026», «Convocatorias CAS 2026». */
export function paginaDelAnio(lista: Enlace[], base: string, anio: number): Enlace | null {
  let host = "";
  try {
    host = new URL(base).host;
  } catch {
    return null;
  }
  const re = new RegExp(`^(?:(?:ano|año|convocatorias?|procesos?|cas|concursos?|personal)\\s+){0,3}${anio}$`, "i");
  return (
    lista.find((e) => {
      try {
        return new URL(e.url).host === host && !esDocumento(e.url) && re.test(normalizar(e.texto)) && e.url.split("#")[0] !== base.split("#")[0];
      } catch {
        return false;
      }
    }) ?? null
  );
}

/** Si la página es una lista de gob.pe que se pagina con ?sheet=N (colecciones, tipos de publicación, temas). */
export const esListaGobPe = (u: string) => /^https:\/\/www\.gob\.pe\/(institucion\/[^/]+\/)?(colecciones|informes-publicaciones\/tipos|tema|campa)/i.test(u) || /^https:\/\/www\.gob\.pe\/institucion\/[^/]+\/?$/i.test(u);
/** Si la página es la de UN proceso en gob.pe (todos sus documentos son de él). */
export const esProcesoGobPe = (u: string) => /^https:\/\/www\.gob\.pe\/institucion\/[^/]+\/informes-publicaciones\/\d+-/i.test(u);

// ─── Buscar: con pedidos ────────────────────────────────────────────────────────────────────────────

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type Pedir = (url: string) => Promise<{ status: number; html: string; final: string } | null>;

/** Un GET de HTML con tiempo límite; un reintento si la CDN responde 5xx (la de gob.pe da 530 a veces). */
export function pedidor(tope = 9, f: typeof fetch = fetch): { pedir: Pedir; usados: () => number } {
  let usados = 0;
  const pedir: Pedir = async (url) => {
    for (let intento = 0; intento < 2; intento++) {
      if (usados >= tope) return null;
      usados++;
      try {
        const r = await f(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
        if (r.status >= 500 && intento === 0) continue;
        const tipo = r.headers.get("content-type") ?? "";
        if (!r.ok || !/html|xml|text\/plain/i.test(tipo)) return { status: r.status, html: "", final: r.url || url };
        const html = (await r.text()).slice(0, 1_500_000);
        return { status: r.status, html, final: r.url || url };
      } catch {
        if (intento === 1) return null;
      }
    }
    return null;
  };
  return { pedir, usados: () => usados };
}

export interface Hallazgo {
  pagina: string;
  documentos: Enlace[];
  via: "documento" | "pagina_proceso" | "lista";
}

/** Busca los documentos del proceso desde la página que SERVIR enlaza. null si no los encuentra. */
export async function buscarBases(p: PlazaParaBases, pedir: Pedir): Promise<Hallazgo | null> {
  const n = numeroProceso(p.numero);
  const anio = Number.parseInt((p.fecha_inicio ?? "").slice(0, 4), 10) || new Date().getFullYear();
  const palabras = palabrasPuesto(p.titulo);
  const urls = (p.detalle_url ?? "").split(/[;\s]+/).filter((u) => /^https?:\/\//i.test(u) && !/facebook\.com|talentosperu\.servir|servir\.gob\.pe\/?$/i.test(u)).slice(0, 2);
  for (const inicio of urls) {
    if (esDocumento(inicio)) return { pagina: inicio, documentos: [{ url: inicio, texto: "" }], via: "documento" };
    if (esProcesoGobPe(inicio)) {
      const r = await pedir(inicio);
      const docs = r?.html ? documentosDePagina(enlaces(r.html, r.final), n, anio, true) : [];
      if (docs.length) return { pagina: inicio, documentos: docs, via: "pagina_proceso" };
      continue;
    }
    if (n == null) continue;
    // La lista (con sus hojas, en gob.pe): el enlace que nombra al proceso.
    const hojas = esListaGobPe(inicio) ? 5 : 1;
    let mejor: { e: Enlace; p: number } | null = null;
    let todos: Enlace[] = [];
    for (let hoja = 1; hoja <= hojas && !mejor; hoja++) {
      const url = hoja === 1 ? inicio : `${inicio.split("?")[0]}?sheet=${hoja}`;
      const r = await pedir(url);
      if (!r?.html) break;
      todos = enlaces(r.html, r.final);
      for (const e of todos) {
        const pt = puntajeEnlace(e, n, anio, palabras);
        if (pt >= 4 && (!mejor || pt > mejor.p)) mejor = { e, p: pt };
      }
      if (hojas > 1 && !todos.some((e) => /[?&]sheet=\d+/.test(e.url))) break;
    }
    // Listas por año («Año 2026» → la lista de ese año): un salto más por el enlace del año, en el mismo sitio.
    if (!mejor && hojas === 1) {
      const delAnio = paginaDelAnio(todos, inicio, anio);
      const r = delAnio ? await pedir(delAnio.url) : null;
      if (r?.html) {
        todos = enlaces(r.html, r.final);
        for (const e of todos) {
          const pt = puntajeEnlace(e, n, anio, palabras);
          if (pt >= 4 && (!mejor || pt > mejor.p)) mejor = { e, p: pt };
        }
      }
    }
    if (!mejor) continue;
    if (esDocumento(mejor.e.url)) {
      // Los documentos de la misma lista que nombran al proceso (bases, anexos, cronograma).
      const hermanos = todos.filter((e) => esDocumento(e.url) && puntajeEnlace(e, n, anio, palabras) >= mejor.p - 2);
      const docs = documentosDePagina(hermanos.length ? hermanos : [mejor.e], n, anio, true);
      return { pagina: inicio, documentos: docs.length ? docs : [mejor.e], via: "lista" };
    }
    // Un salto más: la página del proceso.
    const r2 = await pedir(mejor.e.url);
    if (!r2?.html) continue;
    const docs = documentosDePagina(enlaces(r2.html, r2.final), n, anio, esProcesoGobPe(mejor.e.url));
    if (docs.length) return { pagina: mejor.e.url, documentos: docs, via: "pagina_proceso" };
  }
  return null;
}

// ─── Bajar los PDF ──────────────────────────────────────────────────────────────────────────────────

export const TOPE_PDF = 10 * 1024 * 1024;

/** Cuántas páginas tiene un PDF, aproximado (los /Type /Page sin comprimir); 0 si no se sabe. */
export function paginasPdf(bytes: Uint8Array): number {
  const s = new TextDecoder("latin1").decode(bytes);
  return (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** La clave del documento en R2: los primeros 24 hex del sha256 de su dirección. */
export const claveDocumento = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 24);

/** Baja un PDF (hasta 10 MB). null si no es un PDF o es muy grande. */
export async function bajarPdf(url: string, f: typeof fetch = fetch): Promise<Uint8Array | null> {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await f(url, { headers: { "user-agent": UA, accept: "application/pdf,*/*" }, redirect: "follow", signal: AbortSignal.timeout(25_000) });
      if (r.status >= 500 && intento === 0) continue;
      if (!r.ok) return null;
      const largo = Number(r.headers.get("content-length") ?? "0");
      if (largo > TOPE_PDF) return null;
      const b = new Uint8Array(await r.arrayBuffer());
      if (b.byteLength > TOPE_PDF || b.byteLength < 500) return null;
      if (!(b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)) return null; // %PDF
      return b;
    } catch {
      if (intento === 1) return null;
    }
  }
  return null;
}

// ─── Leer con Haiku ─────────────────────────────────────────────────────────────────────────────────

const MEDIOS_POSTULACION = ["en_linea", "correo", "mesa_de_partes", "plataforma", "otro"] as const;

export const LecturaBases = z.object({
  corresponde: z.boolean().catch(false),
  funciones: lista(texto(5, 240), 8),
  requisitos_extra: lista(texto(5, 240), 6),
  cronograma: lista(z.object({ etapa: texto(3, 120), fecha: texto(3, 90) }), 12),
  evaluacion: lista(z.object({ etapa: texto(3, 100), como: texto(3, 240) }), 6),
  documentos: lista(texto(3, 220), 12),
  como_postular: z.object({ medio: z.enum(MEDIOS_POSTULACION).catch("otro"), detalle: texto(5, 420) }).nullable().catch(null),
  condiciones: lista(texto(3, 180), 5),
  ojo: lista(texto(5, 260), 5),
});
export type LecturaBasesT = z.infer<typeof LecturaBases>;

const SISTEMA = `Lees las bases (y otros documentos) de una convocatoria CAS del Estado peruano y se las explicas a una persona que piensa postular a UNA plaza. Escribe en español del Perú, de tú, con frases cortas y simples, en oración (no en mayúsculas). Responde SIEMPRE con la herramienta «bases».
Reglas:
- "corresponde": true sólo si los documentos son de esta convocatoria (el mismo número de proceso, o el mismo puesto en la misma entidad y año). Si son de otra convocatoria, de otro año o no son bases (un resultado, un comunicado, una norma), responde false y deja todo lo demás vacío.
- Las bases pueden traer varias plazas: usa sólo lo de ESTA plaza (por su puesto o código) y lo que es común a todas.
- Usa SOLO lo que dicen los documentos. No inventes fechas, puntajes, documentos ni requisitos.
- Nunca escribas nombres de personas (ni de la comisión ni de nadie), DNI, teléfonos ni firmas. Un correo o una dirección web institucional para postular sí.
- "funciones": lo que hará en el puesto, de 3 a 8, cada una en una frase corta.
- "requisitos_extra": lo que las bases piden y no está en los datos de SERVIR que te paso (colegiatura y habilitación, SERUMS, licencia de conducir, una especialidad). Vacío si no agregan nada.
- "cronograma": cada etapa con su fecha o rango, tal como lo dicen las bases (la postulación, la evaluación curricular, la entrevista, los resultados, la firma del contrato).
- "evaluacion": cada etapa de la evaluación con cómo se califica (puntaje mínimo y máximo, peso, si es eliminatoria).
- "documentos": lo que hay que presentar para postular (CV documentado, anexos y declaraciones juradas con su número, copia del DNI, constancias), cada uno por separado.
- "como_postular": por dónde se postula (en_linea: un formulario o sistema; correo; mesa_de_partes: física o virtual; plataforma: Talento Perú u otra) y el detalle: la dirección web o el correo, el horario y cómo nombrar el archivo si lo dicen.
- "condiciones": la duración del contrato, el lugar de trabajo y el horario o la modalidad, si lo dicen.
- "ojo": de 0 a 5 cosas de las bases que dejan fuera a la gente (foliar y firmar cada hoja, un orden de documentos, un formato o un peso de archivo, postular fuera de hora, no declarar algo). Sólo si las bases lo dicen.
- Nunca uses el signo «·». Separa con comas o en la lista.`;

const ESQUEMA_TEXTOS = { type: "array", items: { type: "string" } } as const;
const HERRAMIENTA = {
  name: "bases",
  description: "Lo que dicen las bases sobre esta plaza, en palabras simples.",
  input_schema: {
    type: "object",
    properties: {
      corresponde: { type: "boolean" },
      funciones: { ...ESQUEMA_TEXTOS, maxItems: 8 },
      requisitos_extra: { ...ESQUEMA_TEXTOS, maxItems: 6 },
      cronograma: { type: "array", maxItems: 12, items: { type: "object", properties: { etapa: { type: "string" }, fecha: { type: "string" } }, required: ["etapa", "fecha"] } },
      evaluacion: { type: "array", maxItems: 6, items: { type: "object", properties: { etapa: { type: "string" }, como: { type: "string" } }, required: ["etapa", "como"] } },
      documentos: { ...ESQUEMA_TEXTOS, maxItems: 12 },
      como_postular: { type: "object", properties: { medio: { type: "string", enum: [...MEDIOS_POSTULACION] }, detalle: { type: "string" } }, required: ["medio", "detalle"] },
      condiciones: { ...ESQUEMA_TEXTOS, maxItems: 5 },
      ojo: { ...ESQUEMA_TEXTOS, maxItems: 5 },
    },
    required: ["corresponde", "funciones", "requisitos_extra", "cronograma", "evaluacion", "documentos", "condiciones", "ojo"],
  },
} as const;

interface EnvLlm {
  LLM?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  LLM_TOKEN?: string;
}

/** Base64 de bytes (en trozos: String.fromCharCode con 10 MB de argumentos revienta la pila). */
export function aBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

const sinPunto = (t: string) => t.replace(/\s*·\s*/g, ", ");

/** Lee los PDF con Haiku. Devuelve la lectura y los tokens usados. Tira "sin_modelo", "modelo_<status>" o "sin_lectura". */
export async function leerBases(
  env: EnvLlm,
  p: PlazaParaBases & { datosServir: string },
  pdfs: { titulo: string; bytes: Uint8Array }[],
): Promise<{ lectura: LecturaBasesT; entrada: number; salida: number }> {
  if (!env.LLM || !env.LLM_TOKEN) throw new Error("sin_modelo");
  const contenido = [
    ...pdfs.map((d) => ({ type: "document", title: d.titulo.slice(0, 200), source: { type: "base64", media_type: "application/pdf", data: aBase64(d.bytes) } })),
    { type: "text", text: `La plaza (datos de SERVIR):\n${p.datosServir}\nLee los documentos y responde con la herramienta «bases».` },
  ];
  const r = await env.LLM.fetch(
    new Request("https://vigia-llm.interno/nativo/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.LLM_TOKEN, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELO_ASISTENTE,
        max_tokens: 3000,
        system: SISTEMA,
        tools: [HERRAMIENTA],
        tool_choice: { type: "tool", name: "bases" },
        messages: [{ role: "user", content: contenido }],
      }),
    }),
  );
  if (!r.ok) throw new Error(`modelo_${r.status}`);
  const j = (await r.json()) as { content?: { type: string; name?: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const uso = (j.content ?? []).find((b) => b.type === "tool_use" && b.name === "bases");
  if (!uso?.input) throw new Error("sin_lectura");
  const l = LecturaBases.parse(uso.input);
  const lectura: LecturaBasesT = {
    ...l,
    funciones: l.funciones.map(sinPunto),
    requisitos_extra: l.requisitos_extra.map(sinPunto),
    cronograma: l.cronograma.map((x) => ({ etapa: sinPunto(x.etapa), fecha: sinPunto(x.fecha) })),
    evaluacion: l.evaluacion.map((x) => ({ etapa: sinPunto(x.etapa), como: sinPunto(x.como) })),
    documentos: l.documentos.map(sinPunto),
    como_postular: l.como_postular ? { ...l.como_postular, detalle: sinPunto(l.como_postular.detalle) } : null,
    condiciones: l.condiciones.map(sinPunto),
    ojo: l.ojo.map(sinPunto),
  };
  return { lectura, entrada: j.usage?.input_tokens ?? 0, salida: j.usage?.output_tokens ?? 0 };
}

// ─── Todo junto: buscar, bajar, guardar la copia y leer ─────────────────────────────────────────────

/** Páginas que se leen como mucho en un pedido (unos 150 mil tokens; las bases de muchas plazas pasan de 60). */
export const TOPE_PAGINAS = 60;

interface BucketEscritura {
  put(clave: string, valor: Uint8Array, opciones?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
}

export interface ResultadoBases {
  estado: "encontradas" | "no_encontradas";
  pagina: string | null;
  documentos: DocumentoBase[];
  lectura: LecturaBasesT | null;
  /** Por qué no hay lectura: "tope" (del día), "largas", "sin_pdf", "error". */
  sin_lectura?: "tope" | "largas" | "sin_pdf" | "error";
  leida_at?: string;
  tokens?: { entrada: number; salida: number };
}

export async function procesarBases(
  env: EnvLlm & { DOCUMENTOS?: BucketEscritura },
  p: PlazaParaBases & { datosServir: string },
  opciones: { puedeLeer: boolean; pedir?: Pedir; bajar?: (url: string) => Promise<Uint8Array | null> },
): Promise<ResultadoBases> {
  const pedir = opciones.pedir ?? pedidor(9).pedir;
  const bajar = opciones.bajar ?? ((u: string) => bajarPdf(u));
  const hallazgo = await buscarBases(p, pedir);
  if (!hallazgo) return { estado: "no_encontradas", pagina: null, documentos: [], lectura: null };
  const documentos: DocumentoBase[] = hallazgo.documentos.map((e) => ({ titulo: tituloDocumento(e), url: e.url }));
  // Los dos primeros PDF (las bases y el perfil o el cronograma): se bajan, se guardan en R2 y se leen.
  const aLeer = documentos.filter((d) => esPdf(d.url)).slice(0, 2);
  const bajados = (await Promise.all(aLeer.map(async (d) => ({ d, bytes: await bajar(d.url).catch(() => null) })))).filter(
    (x): x is { d: DocumentoBase; bytes: Uint8Array } => x.bytes != null,
  );
  if (env.DOCUMENTOS) {
    await Promise.all(bajados.map(async ({ d, bytes }) => {
      const clave = claveDocumento(d.url);
      try {
        await env.DOCUMENTOS!.put(`servir/bases/${clave}.pdf`, bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { origen: d.url.slice(0, 500), aviso: String(p.aviso) } });
        d.clave = clave;
      } catch {
        /* sin copia: queda el enlace original */
      }
    }));
  }
  const base: ResultadoBases = { estado: "encontradas", pagina: hallazgo.pagina, documentos, lectura: null };
  if (!bajados.length) return { ...base, sin_lectura: "sin_pdf" };
  if (!opciones.puedeLeer) return { ...base, sin_lectura: "tope" };
  // Dentro del tope de páginas: las bases primero; el segundo documento sólo si entra.
  const leer: typeof bajados = [];
  let paginas = 0;
  for (const x of bajados) {
    const n = paginasPdf(x.bytes) || Math.ceil(x.bytes.byteLength / 150_000);
    if (paginas + n > TOPE_PAGINAS) continue;
    paginas += n;
    leer.push(x);
  }
  if (!leer.length) return { ...base, sin_lectura: "largas" };
  try {
    const { lectura, entrada, salida } = await leerBases(env, p, leer.map(({ d, bytes }) => ({ titulo: d.titulo, bytes })));
    if (!lectura.corresponde) return { estado: "no_encontradas", pagina: null, documentos: [], lectura: null, tokens: { entrada, salida } };
    for (const { d } of leer) d.leido = true;
    return { ...base, lectura, leida_at: new Date().toISOString(), tokens: { entrada, salida } };
  } catch {
    return { ...base, sin_lectura: "error" };
  }
}
