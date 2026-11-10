/**
 * Las bases de una plaza CAS, buscadas y leídas por Gobserva (2026-11-08, el usuario: «¿por qué nosotros no descargamos?
 * ¿resumimos bases y demás? parece que sólo somos proveedores de enlaces»).
 *
 * SERVIR no publica las bases: sólo un enlace a la web de la entidad (`detalle_url`), casi siempre a su lista de
 * convocatorias. Acá:
 *   1. buscarBases: abre esa página y busca el enlace de ESTE proceso por su número (el final de `numero`: «…-108» es el
 *      «CAS N° 108-2026»). Si el enlace es un documento, ése es; si es una página (la del proceso), la abre y toma sus
 *      documentos. En gob.pe recorre las hojas de la colección (?sheet=2…). Como mucho 9 pedidos.
 *   2. leerBases (2026-11-08, el usuario: «para las lecturas usa GLM 5.3 flash de Workers AI»): el texto de los PDF sale
 *      de Workers AI (`AI.toMarkdown`, gratis) y lo lee GLM 5.3 flash (vigia-llm, /v1/chat/completions; ~265 neuronas,
 *      ~USD 0,003 unas bases de 14 páginas) con una herramienta forzada: si los documentos son de esta plaza
 *      (`corresponde`), qué hará, el cronograma, cómo evalúan, qué presentar, cómo se postula y qué deja fuera a la gente.
 *      Las escaneadas también las lee GLM (es multimodal): cada página de un escaneo es un JPEG dentro del PDF (/DCTDecode)
 *      que se saca tal cual y va como imagen, de a 8 páginas por pedido (Workers AI no pasa de ~45 mil tokens; con 12
 *      páginas falla), en paralelo y hasta 24 páginas, y las lecturas se juntan. Haiku 5.5 (vigia-llm, /nativo, el PDF
 *      como documento) queda para los escaneos sin JPEG (CCITT, JBIG2) o si GLM falla, con su tope diario.
 *      Las bases traen a veces varias plazas: lee sólo la de este puesto y lo común. Nunca escribe nombres.
 *
 * Cubre gob.pe y los sitios que enlazan sus documentos en el HTML (el Poder Judicial, el Ministerio Público o la DRELM
 * bloquean a Cloudflare, y otros son aplicaciones con formulario: ahí queda «no encontradas» y el enlace de siempre).
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { z } from "zod";
import { MODELO_ASISTENTE } from "./asistente.js";
import { lista, texto } from "./resumenPlaza.js";
import { soloEnlace } from "./empleoFuentes.js";
import { adaptadorDePlaza } from "./empleoAdaptadores.js";
import { SinRelayHttp, clienteHttp, soloPeru, type Http, type RelayCompleto } from "./empleoHttp.js";

export interface PlazaParaBases {
  aviso: number;
  titulo: string | null;
  entidad: string | null;
  numero: string | null;
  detalle_url: string | null;
  fecha_inicio: string | null;
  /** «PIURA - SULLANA»: el departamento y la provincia o el distrito (para la corte del Poder Judicial). */
  ubicacion?: string | null;
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
  // Sin los comentarios: un <a> comentado (sin su </a>) se tragaba el enlace real que venía después (La Perla), y otros
  // esconden documentos de otro proceso (DRTC Ayacucho).
  html = html.replace(/<!--[\s\S]*?-->/g, " ");
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
  return /\.(pdf|docx?|zip|rar)(\?|$)/i.test(url) || /cdn\.www\.gob\.pe\/uploads\/document\/file\//i.test(url) || esDrive(url) || DESCARGAS.test(url);
}

/**
 * Descargas sin «.pdf» en la URL de los aplicativos que leen los adaptadores (lib/empleoAdaptadores*.ts): el visor de
 * MINJUS, las bases y el TDR de MINEDU, JUNTOS, MIDIS y PRONIED, MINSA, la API de Amazonas, la OECE (por POST), Provías (ASP), el
 * DOCman del INPE, la SMV, la PGE (el PDF viene dentro de una página), el Laserfiche del MINEM, el SENAMHI y SERNANP. Se confirma
 * que es PDF al bajarlo.
 */
const DESCARGAS = /\/convocatoria\/Preview\?file=|\/Descargar_(Bases|Tdr|base|tdr)\?idReq=|\/DescargarArchivo(Bases|PorId)\/|\/GetBaseConvocatoria\?|\/api\/Archivo\/\d+\/(descargar|ver)|\/Convocatoria\/ConsultarArchivo\?id=|\/descargaArchivoConvoca\.asp\?PK_eRecord=\d+|\/documentos\/\d+-[^/]+\/file\.html|\/ConsultasP8\/documento\.aspx\?vidDoc=|\/serviceView\/viewPdfModalPublic\?idFile=\d+|\/Laserfiche\/Descargar\?token=|\/include\/convocatorias_ver\.php\?ide_convo=\d+|sernanp\.gob\.pe\/download\/[0-9a-f-]{36}/i;

/** Un archivo de Google Drive (`/file/d/<id>/view`, `uc?id=`, `open?id=`): muchas entidades suben ahí sus bases. */
export const esDrive = (url: string) => /drive\.google\.com\/(file\/d\/[\w-]{10,}|uc\?|open\?id=)|docs\.google\.com\/(document|uc)/i.test(url);

/** La URL que baja el archivo (la de Drive es la de descarga directa; las demás, tal cual). */
export function urlDescarga(url: string): string {
  const id = /drive\.google\.com\/file\/d\/([\w-]{10,})/i.exec(url)?.[1] ?? /[?&]id=([\w-]{10,})/i.exec(url)?.[1];
  if (id && /drive\.google\.com/i.test(url)) return `https://drive.google.com/uc?export=download&id=${id}`;
  const doc = /docs\.google\.com\/document\/d\/([\w-]{10,})/i.exec(url)?.[1];
  if (doc) return `https://docs.google.com/document/d/${doc}/export?format=pdf`;
  return url;
}

/**
 * Cómo se baja un documento. Casi todos con GET; los que sólo responden a POST (OECE: `/Convocatoria/ConsultarArchivo`
 * con `id=<id de Drive>`, el GET da 405) los marca el adaptador con `#post` al final, y su consulta va como formulario.
 */
export function pedidoDescarga(url: string): { url: string; metodo: "GET" | "POST"; cuerpo?: string } {
  if (!/#post$/i.test(url)) return { url: urlDescarga(url), metodo: "GET" };
  const sin = url.replace(/#post$/i, "");
  const i = sin.indexOf("?");
  return i < 0 ? { url: sin, metodo: "POST", cuerpo: "" } : { url: sin.slice(0, i), metodo: "POST", cuerpo: sin.slice(i + 1) };
}

const FORMULARIO = "application/x-www-form-urlencoded; charset=UTF-8";

/** Un documento que puede ser un PDF para leer: termina en .pdf, es de gob.pe o está en Drive (se confirma al bajarlo). */
export const quizasPdf = (url: string) => esPdf(url) || esDrive(url) || DESCARGAS.test(url) || /cdn\.www\.gob\.pe\/uploads\/document\/file\/.*\.pdf/i.test(url);

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
export function pedidor(tope = 9, f: typeof fetch = fetch, relay?: Relay): { pedir: Pedir; usados: () => number } {
  let usados = 0;
  const pedir: Pedir = async (url) => {
    for (let intento = 0; intento < 2; intento++) {
      if (usados >= tope) return null;
      usados++;
      // Lo que sólo responde desde el Perú va por el relay de Lima; si el relay no está, es un error (se reintenta luego),
      // no un «no encontradas».
      if (necesitaPeru(url)) {
        const r = await porRelay(relay, url, 25_000);
        if (r.status >= 500 && intento === 0) continue;
        const tipo = r.headers.get("content-type") ?? "";
        const final = r.headers.get("x-relay-url") || url;
        if (!r.ok || !/html|xml|text\/plain/i.test(tipo)) return { status: r.status, html: "", final };
        return { status: r.status, html: (await r.text()).slice(0, 1_500_000), final };
      }
      try {
        // 25 s: hay servidores del Estado que tardan 4 a 11 s en responder (el INS).
        const r = await f(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(25_000) });
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
  /** Otro proceso que empató (se lee si el modelo dice que éste no es de la plaza). */
  alternativa?: Hallazgo;
}

/**
 * Busca los documentos del proceso desde la página que SERVIR enlaza. Primero el adaptador del dominio, si hay
 * (lib/empleoAdaptadores.ts, con su cliente HTTP); si no encuentra, el buscador genérico. null si no los encuentra.
 */
export async function buscarBases(p: PlazaParaBases, pedir: Pedir, http?: Http): Promise<Hallazgo | null> {
  const adaptador = http ? adaptadorDePlaza(p) : null;
  if (adaptador && http) {
    try {
      const h = await adaptador(p, http);
      if (h) return h;
    } catch (e) {
      if (e instanceof SinRelayHttp) throw new SinRelay(e.message);
      /* el genérico, por si acaso */
    }
  }
  const n = numeroProceso(p.numero);
  const anio = Number.parseInt((p.fecha_inicio ?? "").slice(0, 4), 10) || new Date().getFullYear();
  const palabras = palabrasPuesto(p.titulo);
  const urls = (p.detalle_url ?? "").split(/[;\s]+/).filter((u) => /^https?:\/\//i.test(u) && !/facebook\.com|talentosperu\.servir|servir\.gob\.pe\/?$/i.test(u)).slice(0, 2);
  for (const inicio of urls) {
    if (esPoderJudicial(inicio)) {
      const h = await buscarPoderJudicial(p, pedir);
      if (h) return h;
      continue;
    }
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

// ─── El relay de Lima y el Poder Judicial ──────────────────────────────────────────────────────────

/** Un pedido por el relay de Lima (POST /raw del relay, backend/relay-lima/relay.py). */
export type Relay = (url: string, timeoutMs: number, extra?: { metodo?: "GET" | "POST"; cuerpo?: string; cabeceras?: Record<string, string> }) => Promise<Response>;

/** El relay no está (la PC apagada) o rechazó el pedido: la búsqueda queda en «error» y se reintenta en 2 horas. */
export class SinRelay extends Error {}

/** Lo que sólo se lee por el relay de Lima: la misma lista de los adaptadores (lib/empleoHttp.ts). */
export const necesitaPeru = (url: string): boolean => soloPeru(url);

async function porRelay(relay: Relay | undefined, url: string, ms: number, extra?: Parameters<Relay>[2]): Promise<Response> {
  if (!relay) throw new SinRelay("sin_relay");
  let r: Response;
  try {
    r = await relay(url, ms, extra);
  } catch (e) {
    throw new SinRelay(`relay_lima: ${(e as Error).message.slice(0, 80)}`);
  }
  // Sin x-relay-status el error es del relay (401 por el token, 502 si no llegó al origen), no del sitio.
  if (!r.headers.get("x-relay-status")) throw new SinRelay(`relay_lima_${r.status}`);
  return r;
}

/** El relay de Lima de la API: el binding de Workers VPC `RELAY_LIMA` (wrangler.jsonc) con su token. */
export function relayDe(env: { RELAY_LIMA?: { fetch(input: string, init?: RequestInit): Promise<Response> }; RELAY_LIMA_TOKEN?: string }): Relay | undefined {
  const servicio = env.RELAY_LIMA;
  if (!servicio) return undefined;
  return (url, ms, extra) =>
    servicio.fetch("http://127.0.0.1:8080/raw", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vigia-token": (env.RELAY_LIMA_TOKEN ?? "").trim() },
      body: JSON.stringify({
        url,
        metodo: extra?.metodo ?? "GET",
        cabeceras: { "User-Agent": UA, Accept: "text/html,application/pdf,*/*", ...extra?.cabeceras },
        ...(extra?.metodo === "POST" ? { cuerpo: extra.cuerpo ?? "" } : {}),
      }),
      signal: AbortSignal.timeout(ms),
    });
}

export const esPoderJudicial = (u: string) => /^https?:\/\/aplicativo\.pj\.gob\.pe\/psep\b/i.test(u);

const PJ = "https://aplicativo.pj.gob.pe";

/** Los procesos de una lista del Poder Judicial: el combo `ddl_OrgDepV` (id → «… SUPLENCIA N° 010-2026-UE-PIURA (PIURA)»). */
export function procesosPoderJudicial(html: string): { id: string; texto: string }[] {
  const combo = /<select[^>]*name="[^"]*ddl_OrgDepV"[^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1] ?? "";
  return [...combo.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/gi)]
    .filter((m) => m[1] !== "0") // «--Seleccione--»
    .map((m) => ({ id: m[1], texto: desescapar(m[2]).trim() }));
}

/** Distritos de Lima y provincias con corte propia (la plaza dice «LIMA - ATE»; la lista, «(LIMA ESTE)»). */
const CORTE_POR_LUGAR: Record<string, string> = {
  "villa maria del triunfo": "lima sur", "san juan de miraflores": "lima sur", "villa el salvador": "lima sur", chorrillos: "lima sur",
  lurin: "lima sur", pachacamac: "lima sur", pucusana: "lima sur", "punta hermosa": "lima sur", "punta negra": "lima sur",
  "san bartolo": "lima sur", "santa maria del mar": "lima sur",
  ate: "lima este", "santa anita": "lima este", "el agustino": "lima este", "la molina": "lima este", chaclacayo: "lima este",
  lurigancho: "lima este", cieneguilla: "lima este", "san juan de lurigancho": "lima este",
  comas: "lima norte", carabayllo: "lima norte", independencia: "lima norte", "los olivos": "lima norte", "san martin de porres": "lima norte",
  "puente piedra": "puente piedra", ancon: "lima norte", "santa rosa": "lima norte", ventanilla: "ventanilla", "mi peru": "ventanilla",
  sullana: "sullana", santa: "santa", chimbote: "santa", "nuevo chimbote": "santa", huaura: "huaura", huacho: "huaura", barranca: "huaura",
  huaral: "huaura", canete: "canete", "san vicente de canete": "canete", chanchamayo: "selva central", satipo: "selva central",
  oxapampa: "selva central",
};

/** Las claves de la corte de la plaza, con su peso: la corte del nombre o del lugar (5), el departamento (2). */
export function cortesDePlaza(p: Pick<PlazaParaBases, "entidad" | "ubicacion">): { clave: string; peso: number }[] {
  const out: { clave: string; peso: number }[] = [];
  const ent = normalizar(p.entidad ?? "");
  const corte = /corte superior (?:nacional )?de justicia (?:de |del )?(?:la )?(.+)$/.exec(ent)?.[1]?.trim();
  if (corte) out.push({ clave: corte, peso: 5 });
  // Primero se separa y después se normaliza (normalizar convierte los guiones en espacios).
  const [dep = "", lugar = ""] = (p.ubicacion ?? "").split(/\s+-\s+/).map((x) => normalizar(x));
  if (CORTE_POR_LUGAR[lugar]) out.push({ clave: CORTE_POR_LUGAR[lugar], peso: 5 });
  if (dep) out.push({ clave: dep, peso: 2 });
  return out;
}

/** Si el texto del proceso nombra la corte (sin que «lima» calce con «lima sur»). */
function nombraCorte(t: string, clave: string): boolean {
  const c = clave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${c}\\b(?! (sur|este|norte|centro))`).test(t);
}

/**
 * El Poder Judicial (aplicativo.pj.gob.pe/psep, sólo desde el Perú): sus listas son un formulario ASP.NET con un combo de
 * procesos, pero los documentos de cada uno tienen dirección fija (`repositoriopsep/<id>_AnuncioConvocatoria.pdf`,
 * `_Cronograma.pdf`, `_BasesConcurso.pdf`). Se elige el proceso por el régimen (728 → listas E; CAS → listas C), el número,
 * el año y la corte (del nombre de la entidad o del lugar de la plaza). Si dos empatan y ninguno nombra la corte, nada.
 */
export async function buscarPoderJudicial(p: PlazaParaBases, pedir: Pedir): Promise<Hallazgo | null> {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = Number.parseInt((p.fecha_inicio ?? "").slice(0, 4), 10) || new Date().getFullYear();
  const regimen = /1057|\bcas\b/i.test(p.numero ?? "") ? "C" : "E";
  const cortes = cortesDePlaza(p);
  const numeroYAnio = new RegExp(`(?<![0-9])0*${n} ${anio}\\b`);
  const candidatos: { id: string; p: number; lista: string }[] = [];
  for (const [orden, pagina] of (["V", "P"] as const).entries()) {
    const lista = `${PJ}/psep/wfrmConvocatorias${pagina}.aspx?TCon=${regimen}`;
    const r = await pedir(lista);
    if (!r?.html) continue;
    for (const proc of procesosPoderJudicial(r.html)) {
      const t = normalizar(proc.texto);
      if (!numeroYAnio.test(t)) continue;
      const peso = Math.max(0, ...cortes.filter((c) => nombraCorte(t, c.clave)).map((c) => c.peso));
      if (!peso) continue;
      // Las vigentes antes que las «en proceso»; entre iguales, la más nueva (id mayor).
      candidatos.push({ id: proc.id, p: peso * 10 - orden, lista });
    }
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => b.p - a.p || Number(b.id) - Number(a.id));
  const hallazgo = (c: { id: string; lista: string }): Hallazgo => {
    const doc = (archivo: string, texto: string) => ({ url: `${PJ}/repositoriopsep/${c.id}_${archivo}.pdf`, texto });
    return {
      pagina: c.lista,
      documentos: [doc("AnuncioConvocatoria", "Aviso de convocatoria (perfil y plazas)"), doc("Cronograma", "Cronograma"), doc("BasesConcurso", "Bases del concurso")],
      via: "pagina_proceso",
    };
  };
  const [primero, segundo] = candidatos;
  return { ...hallazgo(primero), ...(segundo && segundo.p === primero.p && segundo.id !== primero.id ? { alternativa: hallazgo(segundo) } : {}) };
}

// ─── Bajar los PDF ──────────────────────────────────────────────────────────────────────────────────

/**
 * Hasta 25 MB por documento y 35 MB por plaza: el Worker tiene 128 MB y los pedidos que corren a la vez los comparten.
 * El 2026-11-09 unas bases de 47,6 MB del HR Eleazar Guzmán Barrón (bajadas a la vez con otro PDF de 9,5 MB, copiadas a
 * R2 y a toMarkdown) tumbaban el Worker antes de guardar, y como la plaza seguía primera en la cola, cada lote se caía en
 * ella. Las más grandes quedan con su enlace. Haiku sólo recibe las de hasta 15 MB.
 */
export const TOPE_PDF = 25 * 1024 * 1024;
export const TOPE_PDF_PLAZA = 35 * 1024 * 1024;
export const TOPE_PDF_HAIKU = 15 * 1024 * 1024;

/** Cuántas páginas tiene un PDF, aproximado (los /Type /Page sin comprimir); 0 si no se sabe. */
export function paginasPdf(bytes: Uint8Array): number {
  const s = new TextDecoder("latin1").decode(bytes);
  return (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** La clave del documento en R2: los primeros 24 hex del sha256 de su dirección. */
export const claveDocumento = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 24);

const empiezaConPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

/**
 * El PDF que viene DENTRO de una página como `data:application/pdf;base64,…` (el visor público de la PGE: su única
 * dirección estable; la descarga directa lleva un token que vence en minutos). null si la página no trae uno.
 */
export function pdfIncrustado(b: Uint8Array): Uint8Array | null {
  const s = new TextDecoder("latin1").decode(b);
  const m = /data:application\/pdf;base64,([A-Za-z0-9+/=\s]{400,})/.exec(s);
  if (!m) return null;
  const pdf = new Uint8Array(Buffer.from(m[1].replace(/\s+/g, ""), "base64"));
  return empiezaConPdf(pdf) ? pdf : null;
}

/**
 * Algunos sitios anteponen un script o una redirección al PDF (SERNANP: «<script>alert(2026); </script>https://…pdf»
 * y después el archivo). Si el `%PDF-` está en los primeros 2 KB, se recorta desde ahí.
 */
function pdfConPrefijo(b: Uint8Array): Uint8Array | null {
  const limite = Math.min(b.byteLength, 2048);
  for (let i = 0; i + 5 <= limite; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return b.slice(i);
  }
  return null;
}

/** El cuerpo de una respuesta por pedazos, cortando apenas pasa el tope (sin content-length no se sabe antes). */
export async function cuerpoConTope(r: Response, tope: number): Promise<Uint8Array | null> {
  const lector = r.body?.getReader();
  if (!lector) return null;
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) {
      await lector.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.byteLength;
  }
  return out;
}

/**
 * El visor Angular de MTPE: su URL es la única dirección pública del archivo; el PDF sólo lo entrega su API JSON en
 * base64. Se reconoce aquí para que el enlace que ve la persona siga siendo el del visor.
 */
const MTPE_PDF = /(?:convocatoriasmtpe\.trabajo\.gob\.pe|apptest\.trabajo\.gob\.pe(?::\d+)?)\/convocatorias\/#\/principal\/fileconvocatorias\/([^/]+)\/([^/?#]+\.pdf)/i;

async function bajarPdfMtpe(tipo: string, archivo: string, f: typeof fetch, tope: number, relay?: Relay): Promise<Uint8Array | null> {
  const destino = "https://convocatoriasmtpe.trabajo.gob.pe/convocatoriasback/api/fileconvocatorias/buscar";
  const cuerpo = JSON.stringify({ dato: { tipodoc: tipo, numdoc: archivo } });
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = necesitaPeru(destino)
        ? await porRelay(relay, destino, 90_000, { metodo: "POST", cuerpo, cabeceras: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*" } })
        : await f(destino, {
            method: "POST",
            headers: { "user-agent": UA, "content-type": "application/json", accept: "application/json, text/plain, */*" },
            body: cuerpo,
            signal: AbortSignal.timeout(60_000),
          });
      if (r.status >= 500 && intento === 0) continue;
      if (!r.ok) return null;
      // El JSON trae el PDF en base64: el cuerpo es ~1,4 veces el PDF.
      const b = await cuerpoConTope(r, Math.ceil(tope * 1.4) + 4096);
      if (!b) return null;
      let j: { dato?: string | null };
      try {
        j = JSON.parse(new TextDecoder().decode(b)) as { dato?: string | null };
      } catch {
        return null;
      }
      if (!j.dato) return null;
      const pdf = new Uint8Array(Buffer.from(j.dato, "base64"));
      if (pdf.byteLength > tope || pdf.byteLength < 500 || !empiezaConPdf(pdf)) return null;
      return pdf;
    } catch {
      if (intento === 1) return null;
    }
  }
  return null;
}

/** Baja un PDF (hasta `tope`, 25 MB por defecto). null si no es un PDF o es más grande. */
export async function bajarPdf(url: string, f: typeof fetch = fetch, relay?: Relay, tope = TOPE_PDF): Promise<Uint8Array | null> {
  const mtpe = MTPE_PDF.exec(url);
  if (mtpe) return bajarPdfMtpe(mtpe[1], mtpe[2], f, tope, relay);
  const { url: destino, metodo, cuerpo } = pedidoDescarga(url);
  const post = metodo === "POST" ? { cuerpo, cabeceras: { "Content-Type": FORMULARIO } } : null;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = necesitaPeru(destino)
        ? await porRelay(relay, destino, 90_000, post ? { metodo: "POST", ...post } : undefined)
        : await f(destino, {
            method: metodo,
            headers: { "user-agent": UA, accept: "application/pdf,*/*", ...(post ? { "content-type": FORMULARIO } : {}) },
            ...(post ? { body: cuerpo ?? "" } : {}),
            redirect: "follow",
            signal: AbortSignal.timeout(60_000),
          });
      if (r.status >= 500 && intento === 0) continue;
      if (!r.ok) return null;
      const largo = Number(r.headers.get("content-length") ?? "0");
      if (largo > tope) {
        await r.body?.cancel().catch(() => undefined);
        return null;
      }
      let b = await cuerpoConTope(r, tope);
      if (!b) return null;
      if (!empiezaConPdf(b)) b = pdfIncrustado(b) ?? pdfConPrefijo(b) ?? b;
      if (b.byteLength > tope || b.byteLength < 500 || !empiezaConPdf(b)) return null;
      return b;
    } catch (e) {
      if (e instanceof SinRelay) throw e;
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
  cronograma: lista(z.object({ etapa: texto(3, 120), fecha: texto(3, 90), postulas: z.boolean().optional().catch(undefined) }), 12),
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
- "cronograma": cada etapa con su fecha o rango, tal como lo dicen las bases (la postulación, la evaluación curricular, la entrevista, los resultados, la firma del contrato). Marca "postulas": true SOLO en la etapa en que la persona presenta su postulación (registra su hoja de vida o su ficha, envía o presenta su expediente o su CV); en las demás, false.
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
      cronograma: { type: "array", maxItems: 12, items: { type: "object", properties: { etapa: { type: "string" }, fecha: { type: "string" }, postulas: { type: "boolean" } }, required: ["etapa", "fecha", "postulas"] } },
      evaluacion: { type: "array", maxItems: 6, items: { type: "object", properties: { etapa: { type: "string" }, como: { type: "string" } }, required: ["etapa", "como"] } },
      documentos: { ...ESQUEMA_TEXTOS, maxItems: 12 },
      como_postular: { type: "object", properties: { medio: { type: "string", enum: [...MEDIOS_POSTULACION] }, detalle: { type: "string" } }, required: ["medio", "detalle"] },
      condiciones: { ...ESQUEMA_TEXTOS, maxItems: 5 },
      ojo: { ...ESQUEMA_TEXTOS, maxItems: 5 },
    },
    required: ["corresponde", "funciones", "requisitos_extra", "cronograma", "evaluacion", "documentos", "condiciones", "ojo"],
  },
} as const;

/** Lo que devuelve `AI.toMarkdown` por documento (la forma nueva trae `format`; la vieja, sólo `data`). */
interface Conversion {
  name?: string;
  format?: string;
  data?: string;
  error?: string;
}

interface EnvLlm {
  LLM?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  LLM_TOKEN?: string;
  /** Workers AI: el texto de los PDF (`toMarkdown`). */
  AI?: { toMarkdown(docs: { name: string; blob: Blob }[]): Promise<Conversion[] | Conversion> };
}

/** El modelo que lee las bases con texto (Workers AI, por vigia-llm). */
export const MODELO_BASES = "@cf/zai-org/glm-5.3-flash";
export const NOMBRE_MODELO_BASES = "glm-5.3-flash";
/** Menos letras que esto en todos los PDF: son escaneos (imágenes), sin texto que leer. */
export const MIN_TEXTO = 600;
/** Páginas escaneadas por pedido a GLM (8 páginas ≈ 42 mil tokens: entra; 12 ya no) y como mucho por lectura. */
export const PAGINAS_POR_PEDIDO = 8;
export const MAX_PAGINAS_IMAGEN = 24;

/**
 * Las páginas de un escaneo como JPEG: las imágenes /DCTDecode del PDF, en el orden en que aparecen (el de las páginas en
 * lo que sale de un escáner). Las chicas (logos, sellos: menos de 12 KB) no cuentan. Vacío si el escaneo usa otro formato.
 */
/** Los streams de imagen JPEG del PDF, en orden: sus bytes y si además vienen con Flate (`[/FlateDecode /DCTDecode]`). */
function streamsDct(bytes: Uint8Array): { datos: Uint8Array; flate: boolean }[] {
  const out: { datos: Uint8Array; flate: boolean }[] = [];
  const DCT = bytesDe("/DCTDecode");
  const STREAM = bytesDe("stream");
  const FIN = bytesDe("endstream");
  let desde = 0;
  for (;;) {
    const m = buscarBytes(bytes, DCT, desde);
    if (m < 0) break;
    const antes = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, m - 40), m));
    let i = buscarBytes(bytes, STREAM, m);
    if (i < 0) break;
    i += STREAM.length;
    while (bytes[i] === 0x0d || bytes[i] === 0x0a) i++;
    const j = buscarBytes(bytes, FIN, i);
    if (j < 0) break;
    let k = j;
    while (k > i && (bytes[k - 1] === 0x0d || bytes[k - 1] === 0x0a)) k--;
    out.push({ datos: bytes.subarray(i, k), flate: /\/FlateDecode\s*$/.test(antes) });
    desde = j + FIN.length;
  }
  return out;
}

/** Un JPEG que vale como página: empieza con FFD8 y pesa 12 KB o más (sin logos ni sellos chicos). */
const esPaginaJpeg = (x: Uint8Array) => x[0] === 0xff && x[1] === 0xd8 && x.byteLength >= 12_000;

/** Las páginas JPEG de un PDF escaneado (sólo las sin Flate; `paginasJpeg` también infla las otras). */
export function jpegsDePdf(bytes: Uint8Array, max = MAX_PAGINAS_IMAGEN): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const s of streamsDct(bytes)) {
    if (out.length >= max) break;
    if (!s.flate && esPaginaJpeg(s.datos)) out.push(s.datos.slice());
  }
  return out;
}

/** Infla un stream Flate (zlib) con DecompressionStream, hasta `tope` bytes. null si no se puede. */
async function inflar(b: Uint8Array, tope = 8 * 1024 * 1024): Promise<Uint8Array | null> {
  try {
    const flujo = new Blob([b as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"));
    return await cuerpoConTope(new Response(flujo), tope);
  } catch {
    return null;
  }
}

/**
 * Las páginas JPEG de un PDF escaneado, también las que el escáner guardó además con Flate (`/Filter [/FlateDecode
 * /DCTDecode]`: las bases de UNHEVAL, 2026-11-09), que se inflan para mandarlas como imagen.
 */
export async function paginasJpeg(bytes: Uint8Array, max = MAX_PAGINAS_IMAGEN): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const s of streamsDct(bytes)) {
    if (out.length >= max) break;
    const x = s.flate ? await inflar(s.datos) : s.datos.slice();
    if (x && esPaginaJpeg(x)) out.push(x);
  }
  return out;
}

const bytesDe = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0));

/** La primera posición de `patron` en `b` desde `desde` (-1 si no está). */
export function buscarBytes(b: Uint8Array, patron: Uint8Array, desde = 0): number {
  const primero = patron[0];
  for (let i = b.indexOf(primero, desde); i >= 0 && i <= b.length - patron.length; i = b.indexOf(primero, i + 1)) {
    let k = 1;
    while (k < patron.length && b[i + k] === patron[k]) k++;
    if (k === patron.length) return i;
  }
  return -1;
}

/** Junta las lecturas de varios pedidos (de a 8 páginas): listas sin repetir, el cronograma con más fechas, un solo medio. */
export function juntarLecturas(ls: LecturaBasesT[]): LecturaBasesT {
  const unir = (xs: string[][], max: number) => {
    const vistos = new Set<string>();
    const out: string[] = [];
    for (const x of xs.flat()) {
      const k = x.toLowerCase().replace(/\s+/g, " ").trim();
      if (!vistos.has(k)) {
        vistos.add(k);
        out.push(x);
      }
    }
    return out.slice(0, max);
  };
  const conFecha = (l: LecturaBasesT) => l.cronograma.filter((x) => /\d/.test(x.fecha)).length;
  const cronograma = [...ls].sort((a, b) => conFecha(b) - conFecha(a) || b.cronograma.length - a.cronograma.length)[0]?.cronograma ?? [];
  const evaluacion = [...ls].sort((a, b) => b.evaluacion.length - a.evaluacion.length)[0]?.evaluacion ?? [];
  const medios = ls.map((l) => l.como_postular).filter((x): x is NonNullable<LecturaBasesT["como_postular"]> => !!x);
  const como_postular = medios.find((x) => x.medio !== "otro") ?? medios[0] ?? null;
  return {
    corresponde: ls.some((l) => l.corresponde),
    funciones: unir(ls.map((l) => l.funciones), 8),
    requisitos_extra: unir(ls.map((l) => l.requisitos_extra), 6),
    cronograma,
    evaluacion,
    documentos: unir(ls.map((l) => l.documentos), 12),
    como_postular,
    condiciones: unir(ls.map((l) => l.condiciones), 5),
    ojo: unir(ls.map((l) => l.ojo), 5),
  };
}
/** Lo que se le pasa al modelo como mucho (~25 mil tokens). */
export const MAX_TEXTO = 90_000;

/** Base64 de bytes (en trozos: String.fromCharCode con 10 MB de argumentos revienta la pila). */
export function aBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

const sinPunto = (t: string) => t.replace(/\s*·\s*/g, ", ");

/** La lectura validada y sin «·» (lo que devuelvan Haiku o GLM). */
export function limpiarLectura(entrada: unknown): LecturaBasesT {
  const l = LecturaBases.parse(entrada);
  return {
    ...l,
    funciones: l.funciones.map(sinPunto),
    requisitos_extra: l.requisitos_extra.map(sinPunto),
    cronograma: l.cronograma.map((x) => ({ etapa: sinPunto(x.etapa), fecha: sinPunto(x.fecha), ...(x.postulas ? { postulas: true } : {}) })),
    evaluacion: l.evaluacion.map((x) => ({ etapa: sinPunto(x.etapa), como: sinPunto(x.como) })),
    documentos: l.documentos.map(sinPunto),
    como_postular: l.como_postular ? { ...l.como_postular, detalle: sinPunto(l.como_postular.detalle) } : null,
    condiciones: l.condiciones.map(sinPunto),
    ojo: l.ojo.map(sinPunto),
  };
}

/**
 * El contenido de lo que devuelve `toMarkdown` de un PDF: sin el bloque de metadatos (versión, productor, fechas: también
 * lo trae un escaneo) ni los títulos «Page N».
 */
export function contenidoMarkdown(md: string): string {
  const i = md.search(/^#{1,3}\s*Contents\s*$/im);
  const cuerpo = i >= 0 ? md.slice(i).replace(/^#{1,3}\s*Contents\s*$/im, "") : md.replace(/^#{1,3}\s*Metadata\s*$[\s\S]*?(?=^#{1,3}\s|(?![\s\S]))/im, "");
  return cuerpo
    .replace(/^#{1,4}\s*(Page|Página)\s*\d+\s*$/gim, "")
    .replace(/^#\s*documento-\d+\.pdf\s*$/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuántas letras tiene un texto (lo que de verdad se puede leer). */
export const letras = (t: string) => (t.match(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/g) ?? []).length;

/** Una lectura sin nada que mostrar (el modelo no pudo leer: un escaneo con algo de texto, un documento ilegible). */
export const lecturaVacia = (l: LecturaBasesT) => !l.cronograma.length && !l.documentos.length && !l.funciones.length && !l.evaluacion.length;

/** El texto de cada PDF por Workers AI (`toMarkdown`). Vacío si no hay binding o el PDF es un escaneo. */
export async function textoDePdfs(env: EnvLlm, pdfs: { titulo: string; bytes: Uint8Array }[]): Promise<{ titulo: string; texto: string }[]> {
  if (!env.AI || !pdfs.length) return pdfs.map((d) => ({ titulo: d.titulo, texto: "" }));
  try {
    const r = await env.AI.toMarkdown(pdfs.map((d, i) => ({ name: `documento-${i + 1}.pdf`, blob: new Blob([d.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }) })));
    const lista = Array.isArray(r) ? r : [r];
    // Por nombre (documento-N.pdf), no por posición: si vuelven en otro orden, el texto de la resolución quedaba pegado
    // a las bases escaneadas y éstas nunca se miraban como imagen.
    const porNombre = new Map(lista.map((x) => [(x as { name?: string }).name ?? "", x]));
    return pdfs.map((d, i) => {
      const x = porNombre.get(`documento-${i + 1}.pdf`) ?? lista[i];
      const texto = x && x.format !== "error" && typeof x.data === "string" ? x.data : "";
      return { titulo: d.titulo, texto: contenidoMarkdown(texto) };
    });
  } catch {
    return pdfs.map((d) => ({ titulo: d.titulo, texto: "" }));
  }
}

/** Los argumentos de la herramienta en una respuesta de chat/completions (o un JSON suelto en el texto, si no la usó). */
export function argumentosHerramienta(j: unknown): unknown {
  const m = (j as { choices?: { message?: { content?: unknown; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] } }[] })?.choices?.[0]?.message;
  const llamada = (m?.tool_calls ?? []).find((t) => t.function?.name === "bases") ?? m?.tool_calls?.[0];
  const args = llamada?.function?.arguments;
  if (args && typeof args === "object") return args;
  const crudo = typeof args === "string" ? args : typeof m?.content === "string" ? m.content : "";
  const i = crudo.indexOf("{");
  const k = crudo.lastIndexOf("}");
  if (i < 0 || k <= i) return null;
  try {
    return JSON.parse(crudo.slice(i, k + 1));
  } catch {
    return null;
  }
}

const HERRAMIENTA_OPENAI = {
  type: "function",
  function: { name: HERRAMIENTA.name, description: HERRAMIENTA.description, parameters: HERRAMIENTA.input_schema },
} as const;

/** Lee el TEXTO de los documentos con GLM 5.3 flash (Workers AI por vigia-llm). Tira "sin_modelo", "modelo_<status>" o "sin_lectura". */
export async function leerBasesGlm(
  env: EnvLlm,
  p: PlazaParaBases & { datosServir: string },
  textos: { titulo: string; texto: string }[],
): Promise<{ lectura: LecturaBasesT; entrada: number; salida: number; quien: string }> {
  if (!env.LLM || !env.LLM_TOKEN) throw new Error("sin_modelo");
  let resto = MAX_TEXTO;
  const partes: string[] = [];
  for (const t of textos) {
    if (resto <= 0 || !t.texto) continue;
    const cuerpo = t.texto.slice(0, resto);
    resto -= cuerpo.length;
    partes.push(`<documento titulo="${t.titulo.replace(/"/g, "'").slice(0, 200)}">\n${cuerpo}\n</documento>`);
  }
  return pedirGlm(env, `La plaza (datos de SERVIR):\n${p.datosServir}\n\nEl texto de los documentos:\n${partes.join("\n\n")}\n\nLee los documentos y responde con la herramienta «bases».`);
}

/** Un pedido a GLM 5.3 flash con la herramienta forzada. `quien`: lo que dice vigia-llm (Workers AI o su respaldo). */
async function pedirGlm(
  env: EnvLlm,
  contenido: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[],
): Promise<{ lectura: LecturaBasesT; entrada: number; salida: number; quien: string }> {
  if (!env.LLM || !env.LLM_TOKEN) throw new Error("sin_modelo");
  const r = await env.LLM.fetch(
    new Request("https://vigia-llm.interno/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_TOKEN}` },
      body: JSON.stringify({
        model: MODELO_BASES,
        messages: [{ role: "system", content: SISTEMA }, { role: "user", content: contenido }],
        tools: [HERRAMIENTA_OPENAI],
        tool_choice: { type: "function", function: { name: HERRAMIENTA.name } },
        reasoning_effort: "low",
        max_tokens: 6000,
      }),
    }),
  );
  if (!r.ok) throw new Error(`modelo_${r.status}`);
  const j = (await r.json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const args = argumentosHerramienta(j);
  if (!args) throw new Error("sin_lectura");
  const quien = (r.headers.get("x-vigia-modelo") ?? "").startsWith("respaldo") ? "respaldo" : NOMBRE_MODELO_BASES;
  return { lectura: limpiarLectura(args), entrada: j.usage?.prompt_tokens ?? 0, salida: j.usage?.completion_tokens ?? 0, quien };
}

/** Lee las PÁGINAS de un escaneo con GLM (imágenes JPEG), de a 8 por pedido y en paralelo, y junta las lecturas. */
export async function leerBasesImagenes(
  env: EnvLlm,
  p: PlazaParaBases & { datosServir: string },
  paginas: Uint8Array[],
): Promise<{ lectura: LecturaBasesT; entrada: number; salida: number; quien: string }> {
  const tandas: Uint8Array[][] = [];
  for (let i = 0; i < paginas.length; i += PAGINAS_POR_PEDIDO) tandas.push(paginas.slice(i, i + PAGINAS_POR_PEDIDO));
  const rs = await Promise.all(
    tandas.map((t, k) =>
      pedirGlm(env, [
        {
          type: "text",
          text: `La plaza (datos de SERVIR):\n${p.datosServir}\n\nLas bases están escaneadas: van como imágenes las páginas ${k * PAGINAS_POR_PEDIDO + 1} a ${k * PAGINAS_POR_PEDIDO + t.length} (de ${paginas.length}), en orden. Usa sólo lo que se lee en ellas; lo que no está en estas páginas déjalo vacío. Responde con la herramienta «bases».`,
        },
        ...t.map((b) => ({ type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${aBase64(b)}` } })),
      ]).catch(() => null),
    ),
  );
  const buenas = rs.filter((x): x is NonNullable<typeof x> => !!x);
  if (!buenas.length) throw new Error("sin_lectura");
  return {
    lectura: juntarLecturas(buenas.map((x) => x.lectura)),
    entrada: buenas.reduce((a, x) => a + x.entrada, 0),
    salida: buenas.reduce((a, x) => a + x.salida, 0),
    quien: buenas.some((x) => x.quien === "respaldo") ? "respaldo" : `${NOMBRE_MODELO_BASES}-imagen`,
  };
}

/** Lee los PDF con Haiku (el PDF entero como documento: sirve para escaneos). Tira "sin_modelo", "modelo_<status>" o "sin_lectura". */
export async function leerBasesHaiku(
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
  return { lectura: limpiarLectura(uso.input), entrada: j.usage?.input_tokens ?? 0, salida: j.usage?.output_tokens ?? 0 };
}

/**
 * Lee las bases: con texto, GLM 5.3 flash; escaneadas, GLM con las páginas como imágenes; si no hay JPEG o GLM falla,
 * Haiku si `puedeHaiku`. Devuelve quién leyó. Tira "escaneadas" si nada de eso se pudo, o el error del modelo.
 */
export async function leerBases(
  env: EnvLlm,
  p: PlazaParaBases & { datosServir: string },
  pdfs: { titulo: string; bytes: Uint8Array }[],
  puedeHaiku: boolean,
): Promise<{ lectura: LecturaBasesT; entrada: number; salida: number; modelo: string }> {
  const textos = await textoDePdfs(env, pdfs);
  const largo = textos.reduce((a, t) => a + letras(t.texto), 0);
  // Lo que falló, para decirlo si al final nadie pudo leer (un GLM caído es un error; un escaneo sin JPEG, «escaneadas»).
  let fallo: Error = new Error("escaneadas");
  // «No es de esta plaza» dicho leyendo sólo los PDF con texto (la resolución que aprueba, un anexo) cuando las bases son
  // un escaneo (UNHEVAL, 2026-11-09): antes de descartar se miran las páginas escaneadas; si tampoco, vale el «no».
  let negativo: { lectura: LecturaBasesT; entrada: number; salida: number; modelo: string } | null = null;
  const escaneados = pdfs.filter((_, i) => letras(textos[i]?.texto ?? "") < MIN_TEXTO);
  if (largo >= MIN_TEXTO) {
    try {
      const r = await leerBasesGlm(env, p, textos);
      const leida = { lectura: r.lectura, entrada: r.entrada, salida: r.salida, modelo: r.quien };
      if (r.lectura.corresponde && !lecturaVacia(r.lectura)) return leida;
      if (!r.lectura.corresponde) {
        let conImagenes = false;
        for (const d of pdfs) if ((conImagenes = (await paginasJpeg(d.bytes, 1)).length > 0)) break;
        if (!conImagenes) return leida;
        negativo = leida;
      }
      // GLM respondió pero sin nada que mostrar (algo de texto suelto en un escaneo): se lee como escaneo.
    } catch (e) {
      fallo = e as Error;
    }
  }
  // Escaneo: las páginas JPEG de cada PDF (después de un «no», primero las de los escaneados), en orden, hasta 24.
  const orden = negativo ? [...escaneados, ...pdfs.filter((d) => !escaneados.includes(d))] : pdfs;
  const paginas: Uint8Array[] = [];
  for (const d of orden) {
    if (paginas.length >= MAX_PAGINAS_IMAGEN) break;
    paginas.push(...(await paginasJpeg(d.bytes, MAX_PAGINAS_IMAGEN - paginas.length)));
  }
  if (paginas.length) {
    try {
      const r = await leerBasesImagenes(env, p, paginas);
      if (!r.lectura.corresponde || !lecturaVacia(r.lectura)) return { lectura: r.lectura, entrada: r.entrada, salida: r.salida, modelo: r.quien };
    } catch (e) {
      fallo = e as Error;
    }
  }
  if (negativo) return negativo;
  if (!puedeHaiku) throw fallo;
  const paraHaiku = elegirParaHaiku(pdfs);
  if (!paraHaiku.length) throw new Error("largas");
  return { ...(await leerBasesHaiku(env, p, paraHaiku)), modelo: MODELO_ASISTENTE };
}

/**
 * Lo que se le manda a Haiku (el PDF entero, en base64): hasta TOPE_PAGINAS páginas y PDF de hasta 15 MB, las bases
 * primero.
 */
export function elegirParaHaiku<T extends { bytes: Uint8Array }>(pdfs: T[]): T[] {
  const out: T[] = [];
  let paginas = 0;
  for (const x of pdfs) {
    if (x.bytes.byteLength > TOPE_PDF_HAIKU) continue;
    // Sin el conteo (páginas en objetos comprimidos): ~45 KB por página, lo que pesan estos PDF.
    const n = paginasPdf(x.bytes) || Math.ceil(x.bytes.byteLength / 45_000);
    if (paginas + n > TOPE_PAGINAS) continue;
    paginas += n;
    out.push(x);
  }
  return out;
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
  /** Quién leyó: «glm-5.3-flash» o «claude-haiku-5-5» (las escaneadas). */
  modelo?: string;
  tokens?: { entrada: number; salida: number };
}

export async function procesarBases(
  env: EnvLlm & { DOCUMENTOS?: BucketEscritura },
  p: PlazaParaBases & { datosServir: string },
  opciones: {
    puedeLeer: boolean;
    puedeHaiku?: boolean;
    pedir?: Pedir;
    http?: Http;
    bajar?: (url: string, tope?: number) => Promise<Uint8Array | null>;
    relay?: Relay;
    relayCompleto?: RelayCompleto;
  },
): Promise<ResultadoBases> {
  const pedir = opciones.pedir ?? pedidor(9, fetch, opciones.relay).pedir;
  // Los adaptadores (formularios, APIs) usan su cliente: hasta 20 pedidos, con cookies y el relay de Lima.
  const http = opciones.http ?? (opciones.pedir ? undefined : clienteHttp(20, fetch, opciones.relayCompleto));
  const bajar = opciones.bajar ?? ((u: string, tope?: number) => bajarPdf(u, fetch, opciones.relay, tope));
  const hallazgo = await buscarBases(p, pedir, http);
  if (!hallazgo) return { estado: "no_encontradas", pagina: null, documentos: [], lectura: null };
  const haiku = opciones.puedeHaiku ?? false;
  const r = await leerHallazgo(env, p, hallazgo, bajar, opciones.puedeLeer, haiku);
  // Si el modelo dijo que no son de esta plaza y había otro proceso empatado (Poder Judicial: «N° 003-2026» de suplencia
  // y de servicio específico en la misma corte), se lee ése.
  if (r.estado === "no_encontradas" && r.tokens && hallazgo.alternativa) {
    const r2 = await leerHallazgo(env, p, hallazgo.alternativa, bajar, opciones.puedeLeer, haiku);
    const t2 = r2.tokens ?? { entrada: 0, salida: 0 };
    return { ...r2, tokens: { entrada: r.tokens.entrada + t2.entrada, salida: r.tokens.salida + t2.salida } };
  }
  return r;
}

async function leerHallazgo(
  env: EnvLlm & { DOCUMENTOS?: BucketEscritura },
  p: PlazaParaBases & { datosServir: string },
  hallazgo: Hallazgo,
  bajar: (url: string, tope?: number) => Promise<Uint8Array | null>,
  puedeLeer: boolean,
  puedeHaiku: boolean,
): Promise<ResultadoBases> {
  const documentos: DocumentoBase[] = hallazgo.documentos.map((e) => ({ titulo: tituloDocumento(e), url: e.url }));
  // Los tres primeros PDF (las bases, el perfil, el cronograma): se bajan, se guardan en R2 y se leen dentro del tope de
  // páginas (el Poder Judicial reparte la convocatoria en tres: el aviso, el cronograma y las bases generales).
  // Nunca los de resultados (aptos, ganadores, puntajes): traen nombres y DNI; de ellos sólo queda el enlace.
  const aLeer = documentos.filter((d) => quizasPdf(d.url) && !soloEnlace(d.titulo, d.url)).slice(0, 3);
  // De a uno y con un tope por plaza (TOPE_PDF_PLAZA): todos a la vez llegaban a tumbar el Worker por memoria.
  const bajados: { d: DocumentoBase; bytes: Uint8Array }[] = [];
  let usados = 0;
  for (const d of aLeer) {
    const queda = Math.min(TOPE_PDF, TOPE_PDF_PLAZA - usados);
    if (queda < 500) break;
    const bytes = await bajar(d.url, queda).catch((e) => {
      if (e instanceof SinRelay) throw e;
      return null;
    });
    if (!bytes) continue;
    usados += bytes.byteLength;
    bajados.push({ d, bytes });
  }
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
  if (!puedeLeer) return { ...base, sin_lectura: "tope" };
  // GLM lee todos (el texto se recorta y las imágenes van hasta 24 páginas); el tope de páginas es de Haiku (paraHaiku).
  const leer = bajados;
  try {
    const { lectura, entrada, salida, modelo } = await leerBases(env, p, leer.map(({ d, bytes }) => ({ titulo: d.titulo, bytes })), puedeHaiku);
    if (!lectura.corresponde) return { estado: "no_encontradas", pagina: null, documentos: [], lectura: null, modelo, tokens: { entrada, salida } };
    for (const { d } of leer) d.leido = true;
    return { ...base, lectura, leida_at: new Date().toISOString(), modelo, tokens: { entrada, salida } };
  } catch (e) {
    // Escaneadas y sin Haiku hoy (su tope): se leen otro día; para la ficha es como el tope.
    const m = (e as Error).message;
    return { ...base, sin_lectura: m === "escaneadas" ? "tope" : m === "largas" ? "largas" : "error" };
  }
}
