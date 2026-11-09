/**
 * Ola 2, sitios especiales (2026-11-09): EPS Emapa Cañete, DRTC Ayacucho, Municipalidad de La Perla, Municipalidad de
 * Pachitea, carpetas y archivos de Google Drive, enlaces cortos share.google, DIRESA Madre de Dios (destino de un
 * share.google), OECE (caspublico), MIDIS (Sis_Convocatoria) y Provías Nacional (gis.proviasnac).
 *
 * MIDIS y Provías no se registran por dominio (SERVIR enlaza páginas de servicio de www.gob.pe): se exportan `midis` y
 * `provias`, con `esMidis` y `esProvias` para reconocer sus plazas. También se registran por su propio dominio
 * (app.midis.gob.pe, gis.proviasnac.gob.pe) por si SERVIR enlaza ahí directo.
 *
 * Reglas: pocos pedidos, sin captchas ni cuentas, y nunca los resultados (listas con nombres): se descartan por la
 * columna o por el nombre del documento.
 */
import {
  ADAPTADORES, anioDe, celdas, hallazgo, nombreDeArchivo, numeroYAnio, parecidoPuesto, regimenDe, textoPlano, type Adaptador,
} from "../empleoAdaptadores.js";
import {
  buscarBases, enlaces, esDocumento, mencionaProceso, normalizar, numeroProceso, type Enlace, type Hallazgo, type PlazaParaBases,
} from "../basesPlaza.js";
import type { Http } from "../empleoHttp.js";

// ─── Lo común ─────────────────────────────────────────────────────────────────────────────────────────

/** Sin comentarios HTML: un `<a href>` dentro de un comentario se come al enlace de verdad que viene después (La Perla). */
const sinComentarios = (html: string) => html.replace(/<!--[\s\S]*?-->/g, " ");

/** Las URL de `detalle_url` (puede traer varias). */
const urlsDe = (detalle: string | null | undefined) => [...(detalle ?? "").matchAll(/https?:\/\/[^\s<>"'|;]+/gi)].map((m) => m[0].replace(/[,.]+$/, ""));

/** Resultados y etapas con nombres de postulantes (sobre texto normalizado: sin tildes, «_» y «-» como espacios). */
const RESULTADO = /resultad|\baptos?\b|ganador|cuadro de merit|merito final|puntaje|entrevista|evaluacion ?(curricular|de conoc|psico|de hoja|hojadevida|de cv|tecnica|de compet)|evalcurricular|psicotecnic|absolucion|reclamo|separador|relacion de (postulantes|aptos|ganadores|inscritos)|acta de evaluacion|declarad|suscripcion/;
const esResultado = (t: string) => RESULTADO.test(normalizar(t));

/** Las columnas de una tabla por etapas que sirven (bases, anexos, comunicados…) y las que no (resultados por etapa). */
const COLUMNA_SI = /bases|anexo|formato|comunicado|errata|cronograma|perfil|resolucion|tdr|requisito|documento/;
const COLUMNA_NO = /curricular|psicotec|entrevista|cuadro|resultado|final|ficha|conocimiento|evaluacion|merito|apto|suscripcion|revision/;

const oracion = (t: string) => {
  const s = t.replace(/^\s*\d+\.\s*/, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
};

/** El texto propio de un enlace si dice algo («VER BASES» → «BASES»); si no, la etiqueta que se le da. */
const textoDeEnlace = (propio: string, porDefecto: string) => {
  const t = propio.replace(/^\s*(ver|descargar)\s+/i, "").trim();
  return t.length > 3 && !/^(ver|descargar|aqu[ií]|clic|click|abrir|pdf)\b/i.test(t) ? t : porDefecto;
};

/** Las cabeceras (th) de una tabla: el texto tal cual y normalizado. */
const cabecerasDe = (tabla: string) =>
  [...tabla.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => ({ texto: textoPlano(m[1]), clave: normalizar(textoPlano(m[1])) }));

/** Los documentos de una fila, sólo de las columnas útiles (bases, anexos, comunicados…), sin resultados. */
function documentosDeFila(fila: string, cabeceras: { texto: string; clave: string }[], base: string): Enlace[] {
  const out: Enlace[] = [];
  celdas(fila).forEach((celda, j) => {
    const cab = cabeceras[j];
    if (!cab || !COLUMNA_SI.test(cab.clave) || COLUMNA_NO.test(cab.clave)) return;
    for (const e of enlaces(celda, base)) {
      if (!esDocumento(e.url)) continue;
      const texto = textoDeEnlace(e.texto, oracion(cab.texto));
      if (esResultado(`${texto} ${nombreDeArchivo(e.url)}`)) continue;
      out.push({ url: e.url, texto });
    }
  });
  return out;
}

/**
 * Los enlaces a documentos de un HTML con su etiqueta: el texto del enlace si dice algo, si no el texto que lo precede
 * (WordPress con botones «Descargar» bajo un título).
 */
function documentosConEtiqueta(html: string, base: string, acepta: (url: string) => boolean): Enlace[] {
  const out: Enlace[] = [];
  let previo = 0;
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const ini = m.index ?? 0;
    const antes = textoPlano(html.slice(previo, ini));
    previo = ini + m[0].length;
    let url: string;
    try {
      url = new URL(m[1].replace(/&amp;|&#0?38;/g, "&").trim(), base).toString();
    } catch {
      continue;
    }
    if (!esDocumento(url) || !acepta(url)) continue;
    const etiqueta = (antes.length > 120 ? antes.slice(-120).replace(/^\S*\s/, "") : antes).trim();
    const texto = textoDeEnlace(textoPlano(m[2]), etiqueta || nombreDeArchivo(url));
    if (esResultado(`${texto} ${nombreDeArchivo(url)}`)) continue;
    out.push({ url, texto });
  }
  return out;
}

/** Las bases antes que el acta o la resolución que las aprueba (hallazgo() ordena por tipo y, a igual tipo, por orden). */
const basesPrimero = (docs: Enlace[]) => {
  const esBases = (d: Enlace) => /^\s*bases\b/i.test(d.texto) || (/\bbases\b/i.test(nombreDeArchivo(d.url)) && !/acta|resoluci/i.test(`${d.texto} ${nombreDeArchivo(d.url)}`));
  return [...docs.filter(esBases), ...docs.filter((d) => !esBases(d))];
};

const pedirDe = (http: Http) => async (url: string) => {
  const r = await http.get(url);
  return r ? { status: r.status, html: r.texto, final: r.final } : null;
};

const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ─── EPS Emapa Cañete (aguacanete.com/convocatorias) ───────────────────────────────────────────────

/**
 * Una tabla por concurso, con su título en el párrafo de antes («CONVOCATORIA CONCURSO PÚBLICO DE MÉRITOS N° 005-2026-EPS
 * EMAPA CANETE S.A.») y una columna por etapa: se toman Resolución, Bases, Formatos y Comunicado.
 */
const aguaCanete: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const url = "https://aguacanete.com/convocatorias";
  const r = await http.get(url);
  if (!r?.texto) return null;
  const trozos = sinComentarios(r.texto).split(/<table\b/i);
  for (let i = 1; i < trozos.length; i++) {
    const parrafos = [...trozos[i - 1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
    const titulo = textoPlano(parrafos.at(-1)?.[1] ?? "");
    const m = /N\D{0,3}0*(\d+)\s*-\s*(20\d{2})/i.exec(titulo);
    if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
    const tabla = trozos[i].split(/<\/table>/i)[0];
    const cabeceras = cabecerasDe(tabla);
    const docs = tabla.split(/<tr\b/i).slice(1).filter((f) => /<td\b/i.test(f)).flatMap((f) => documentosDeFila(f, cabeceras, r.final));
    return hallazgo(url, docs);
  }
  return null;
};

// ─── DRTC Ayacucho (convocatoria.html: una página estática con todo) ───────────────────────────────

/** Los archivos llevan régimen, número y año en el nombre: convocatoria2026/bases_276_003_2026.pdf, anexos_CAS_002_2026.docx. */
const drtcAyacucho: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const regimen = regimenDe(p.numero);
  const clave = regimen === "cas" ? "cas" : regimen === "276" || regimen === "728" ? regimen : null;
  if (!clave) return null;
  const url = "https://www.drtcayacucho.gob.pe/convocatoria.html";
  const r = await http.get(url);
  if (!r?.texto) return null;
  const re = new RegExp(`(^|\\s)${clave} 0*${n} ${anio}$`);
  const docs: Enlace[] = [];
  for (const e of enlaces(sinComentarios(r.texto), r.final)) {
    if (!esDocumento(e.url)) continue;
    const nombre = normalizar(nombreDeArchivo(e.url));
    if (!re.test(nombre) || esResultado(nombre)) continue;
    const tipo = /^bases/.test(nombre) ? "Bases" : /^anexo/.test(nombre) ? "Anexos" : /^fe ?de ?errata/.test(nombre) ? "Fe de erratas" : /^comunicado/.test(nombre) ? "Comunicado" : nombreDeArchivo(e.url);
    docs.push({ url: e.url, texto: `${tipo} ${clave.toUpperCase()} N° ${String(n).padStart(3, "0")}-${anio}` });
  }
  return hallazgo(url, docs);
};

// ─── Municipalidad de La Perla (tabla «process-row» con una columna por etapa) ─────────────────────

const laPerla: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const propia = urlsDe(p.detalle_url).find((u) => /munilaperla\.gob\.pe\/convocatoria/i.test(u));
  const url = propia ?? (regimenDe(p.numero) === "cas" ? "https://www.munilaperla.gob.pe/convocatoria-cas" : "https://www.munilaperla.gob.pe/convocatoria-D-L-N%C2%B0728-mdlp.html");
  const r = await http.get(url);
  if (!r?.texto) return null;
  const html = sinComentarios(r.texto);
  const tabla = /<table\b[^>]*id="tablaProcesos"[\s\S]*?<\/table>/i.exec(html)?.[0] ?? html;
  const cabeceras = cabecerasDe(tabla);
  let mejor: { docs: Enlace[]; parecido: number } | null = null;
  for (const fila of tabla.split(/<tr\b/i).slice(1)) {
    if (!/<td\b/i.test(fila)) continue;
    const na = numeroYAnio(textoPlano(celdas(fila)[0] ?? ""));
    if (!na || na.n !== n || na.anio !== anio) continue;
    const parecido = parecidoPuesto(p.titulo, textoPlano(fila));
    if (!mejor || parecido > mejor.parecido) mejor = { docs: documentosDeFila(fila, cabeceras, r.final), parecido };
  }
  return mejor ? hallazgo(r.final, mejor.docs) : null;
};

// ─── Municipalidad de Pachitea (WordPress: una página por convocatoria, «728-vi-2026») ─────────────

const ROMANOS = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"];

/** La lista del régimen enlaza «/728-vi-2026/» o «/cas-iii-2026-2/» (el número en romanos); ahí, los botones «Descargar». */
const pachitea: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null || n >= ROMANOS.length) return null;
  const anio = anioDe(p);
  const regimen = regimenDe(p.numero);
  const prefijo = regimen === "cas" ? "cas" : regimen === "728" || regimen === "276" ? regimen : null;
  if (!prefijo) return null;
  const base = "https://munipachitea.gob.pe";
  const lista = prefijo === "cas" ? `${base}/cas-2025/` : `${base}/987582637-2/`;
  const r = await http.get(lista);
  const re = new RegExp(`^https?://munipachitea\\.gob\\.pe/${prefijo}-(?:${ROMANOS[n]}|0*${n})-${anio}(?:-\\d+)?/?(?:[?#]|$)`, "i");
  const enLista = r?.texto ? enlaces(r.texto, r.final).find((e) => re.test(e.url)) : undefined;
  const ficha = enLista ? enLista.url.split(/[?#]/)[0] : `${base}/${prefijo}-${ROMANOS[n]}-${anio}/`;
  const d = await http.get(ficha);
  if (!d?.texto || d.status >= 400) return null;
  // Sólo lo subido a la página (el menú enlaza documentos de gob.pe que no son del proceso).
  const docs = documentosConEtiqueta(sinComentarios(d.texto), d.final, (u) => /munipachitea\.gob\.pe\/wp-content\/uploads\//i.test(u));
  return hallazgo(ficha, basesPrimero(docs));
};

// ─── Google Drive (carpetas públicas sin sesión ni JS: embeddedfolderview) ──────────────────────────

interface EntradaDrive { id: string; url: string; titulo: string; carpeta: boolean; tipo: string; fecha: string | null }

const MESES_CORTOS: Record<string, number> = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };

/** «26 oct», «21 sept», «26 oct 2025», «10:32» (hoy), «26/10/2025» u «Oct 26, 2025» → ISO (sin año: el último que no es futuro). */
export function fechaDrive(t: string, hoy = new Date()): string | null {
  const s = normalizar(t).replace(/\./g, " ").replace(/\s+/g, " ").trim();
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const hoyIso = hoy.toISOString().slice(0, 10);
  if (/^\d{1,2}:\d{2}/.test(s)) return hoyIso;
  let m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  let dia: number | null = null;
  let mes: number | null = null;
  let anio: number | null = null;
  m = /(\d{1,2}) (?:de )?([a-z]{3})[a-z]*(?: (?:de )?(\d{4}))?/.exec(s);
  if (m && MESES_CORTOS[m[2]]) [dia, mes, anio] = [Number(m[1]), MESES_CORTOS[m[2]], m[3] ? Number(m[3]) : null];
  else {
    m = /([a-z]{3})[a-z]* (\d{1,2})(?:,? (\d{4}))?/.exec(s);
    if (m && MESES_CORTOS[m[1]]) [dia, mes, anio] = [Number(m[2]), MESES_CORTOS[m[1]], m[3] ? Number(m[3]) : null];
  }
  if (dia == null || mes == null) return null;
  if (anio != null) return iso(anio, mes, dia);
  const y = hoy.getUTCFullYear();
  const f = iso(y, mes, dia);
  return f > hoyIso ? iso(y - 1, mes, dia) : f;
}

/** Las entradas de una carpeta (HTML de embeddedfolderview). */
export function entradasDrive(html: string): EntradaDrive[] {
  return html.split(/<div class="flip-entry" id="entry-/).slice(1).map((b) => {
    const id = /^([\w-]+)/.exec(b)?.[1] ?? "";
    const href = (/<a href="([^"]+)"/.exec(b)?.[1] ?? "").replace(/&amp;/g, "&");
    const tipo = /\/type\/([^"]+)"/.exec(b)?.[1] ?? "";
    const carpeta = /\/folders\//.test(href);
    const url = carpeta ? `https://drive.google.com/drive/folders/${id}`
      : /docs\.google\.com\/document\//.test(href) ? `https://docs.google.com/document/d/${id}/edit`
        : /\/file\/d\//.test(href) ? `https://drive.google.com/file/d/${id}/view` : href;
    return {
      id, url, carpeta, tipo,
      titulo: textoPlano(/class="flip-entry-title">([\s\S]*?)<\/div>/.exec(b)?.[1] ?? ""),
      fecha: fechaDrive(textoPlano(/class="flip-entry-last-modified"><div>([^<]*)</.exec(b)?.[1] ?? "")),
    };
  }).filter((e) => e.id && e.url);
}

/** Un archivo que se puede leer: PDF, Word o un documento de Google (no imágenes ni hojas de cálculo). */
const esLeible = (e: EntradaDrive) => !e.carpeta
  && (/application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml|vnd\.google-apps\.document)/i.test(e.tipo) || /\.(pdf|docx?)$/i.test(e.titulo));

async function carpetaDrive(http: Http, id: string, clave?: string | null): Promise<{ titulo: string; entradas: EntradaDrive[] } | null> {
  const r = await http.get(`https://drive.google.com/embeddedfolderview?id=${id}${clave ? `&resourcekey=${encodeURIComponent(clave)}` : ""}`);
  if (!r?.texto || r.status >= 400 || !/flip-entries|flip-contents/.test(r.texto)) return null;
  return { titulo: textoPlano(/<title>([\s\S]*?)<\/title>/i.exec(r.texto)?.[1] ?? ""), entradas: entradasDrive(r.texto) };
}

const REGIMENES: Record<string, RegExp> = { cas: /\b(cas|1057)\b/, "276": /\b276\b/, "728": /\b728\b/ };
/** Carpetas que no son un concurso de plazas para postular (ascensos, reasignaciones, concesiones, etc.). */
const NO_PLAZA = /ascenso|reasignac|concesion|cafeteria|asistencia|bienes|locador|practica|encargatura|nombramiento|cambio de grupo/;
const ES_CONVOCATORIA = /convocatoria|proceso|concurso|seleccion|\bcas\b|1057|\b276\b|\b728\b|plaza|puesto/;

/** Si el texto (normalizado) nombra el proceso n: «Convocatoria Nº006», «Proceso N 002», «006-2026». */
const nombraNumero = (t: string, n: number, anio: number) => mencionaProceso(t, n) || new RegExp(`(?<![0-9])0*${n} (${anio}|${anio + 1})\\b`).test(t);

/** Los documentos de una carpeta del proceso (y de sus subcarpetas de bases o perfiles, hasta dos). */
async function documentosDeCarpeta(http: Http, entradas: EntradaDrive[]): Promise<Enlace[]> {
  const docs = entradas.filter((e) => esLeible(e) && !esResultado(e.titulo)).map((e) => ({ url: e.url, texto: e.titulo.replace(/\.(pdf|docx?)$/i, "") }));
  if (docs.length) return docs;
  const subs = entradas.filter((e) => e.carpeta && /bases|perfil|convocatoria|anexo|tdr|cronograma|comunicado|requisito/.test(normalizar(e.titulo)) && !esResultado(e.titulo)).slice(0, 2);
  const out: Enlace[] = [];
  for (const s of subs) {
    const c = await carpetaDrive(http, s.id);
    for (const e of c?.entradas ?? []) if (esLeible(e) && !esResultado(e.titulo)) out.push({ url: e.url, texto: e.titulo.replace(/\.(pdf|docx?)$/i, "") });
  }
  return out;
}

/**
 * Una carpeta pública de Drive. Si es la carpeta de UN proceso (sólo archivos), sus documentos; si reúne procesos en
 * subcarpetas («Convocatoria Nº006- TEMPORAL - DL. 1057»), la del número y el régimen de la plaza, o la del régimen creada
 * cerca de la publicación en SERVIR (la numeración de SERVIR no siempre es la de la entidad; la otra va de alternativa).
 */
async function driveCarpeta(p: PlazaParaBases, http: Http, id: string, clave: string | null): Promise<Hallazgo | null> {
  const raiz = await carpetaDrive(http, id, clave);
  if (!raiz) return null;
  const n = numeroProceso(p.numero);
  const anio = anioDe(p);
  const regimen = regimenDe(p.numero);
  const pagina = `https://drive.google.com/drive/folders/${id}`;
  const carpetas = raiz.entradas.filter((e) => e.carpeta);
  const candidatas = carpetas.map((e) => {
    const t = normalizar(e.titulo);
    if (!ES_CONVOCATORIA.test(t) || NO_PLAZA.test(t) || esResultado(t)) return null;
    const nombrados = Object.entries(REGIMENES).filter(([, re]) => re.test(t)).map(([k]) => k);
    if (nombrados.length && !nombrados.includes(regimen)) return null;
    const num = n != null && nombraNumero(t, n, anio);
    const cerca = !!e.fecha && !!p.fecha_inicio && dias(p.fecha_inicio, e.fecha) >= -15 && dias(p.fecha_inicio, e.fecha) <= 5;
    if (!num && !cerca) return null;
    const distancia = e.fecha && p.fecha_inicio ? Math.abs(dias(p.fecha_inicio, e.fecha)) : 999;
    return { e, puntos: 3 * Number(num) + 3 * Number(cerca) + Number(nombrados.includes(regimen)), distancia };
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.puntos - a.puntos || a.distancia - b.distancia);
  if (candidatas.length) {
    for (const [i, c] of candidatas.slice(0, 2).entries()) {
      const sub = await carpetaDrive(http, c.e.id);
      const h = hallazgo(c.e.url, sub ? await documentosDeCarpeta(http, sub.entradas) : []);
      if (!h) continue;
      // Otra que empata casi (mismo régimen, cerca en el tiempo o con el número): de alternativa.
      const otra = candidatas.slice(i + 1).find((x) => x.puntos >= c.puntos - 1);
      if (otra) {
        const sub2 = await carpetaDrive(http, otra.e.id);
        const alt = sub2 ? hallazgo(otra.e.url, await documentosDeCarpeta(http, sub2.entradas)) : null;
        if (alt) h.alternativa = alt;
      }
      return h;
    }
    return null;
  }
  // La carpeta del proceso: sus archivos (los que nombran el número, si alguno lo hace).
  const docs = await documentosDeCarpeta(http, raiz.entradas);
  if (!docs.length) return null;
  const conNumero = n != null ? docs.filter((d) => nombraNumero(normalizar(d.texto), n, anio)) : [];
  if (conNumero.length) return hallazgo(pagina, conNumero);
  return docs.length <= 8 ? hallazgo(pagina, docs) : null;
}

/** Un archivo de Drive: su nombre (og:title de la vista) y, si es un resultado, nada. */
async function driveArchivo(http: Http, id: string): Promise<Hallazgo | null> {
  const url = `https://drive.google.com/file/d/${id}/view`;
  const r = await http.get(url);
  const titulo = textoPlano(/<meta property="og:title" content="([^"]*)"/i.exec(r?.texto ?? "")?.[1] ?? "");
  if (r && r.status >= 400) return null;
  if (titulo && esResultado(titulo)) return null;
  return hallazgo(url, [{ url, texto: titulo.replace(/\.(pdf|docx?)$/i, "") || "Documento" }], "documento");
}

const drive: Adaptador = async (p, http) => {
  for (const u of urlsDe(p.detalle_url)) {
    if (!/drive\.google\.com/i.test(u)) continue;
    const clave = /[?&]resourcekey=([\w-]+)/i.exec(u)?.[1] ?? null;
    const carpeta = /\/folders\/([\w-]{10,})/i.exec(u)?.[1] ?? /folderview\?(?:[^#]*&)?id=([\w-]{10,})/i.exec(u)?.[1];
    if (carpeta) return driveCarpeta(p, http, carpeta, clave);
    const archivo = /\/file\/d\/([\w-]{10,})/i.exec(u)?.[1] ?? /\/uc\?(?:[^#]*&)?id=([\w-]{10,})/i.exec(u)?.[1];
    if (archivo) return driveArchivo(http, archivo);
    // open?id=…: archivo o carpeta, según adónde redirige.
    const abierto = /\/open\?(?:[^#]*&)?id=([\w-]{10,})/i.exec(u)?.[1];
    if (abierto) {
      const r = await http.get(u);
      const fin = r?.final ?? "";
      if (/\/folders\//.test(fin)) return driveCarpeta(p, http, abierto, clave);
      return driveArchivo(http, abierto);
    }
  }
  return null;
};

// ─── share.google: el enlace corto lleva (302 → 301) a la página de la entidad ─────────────────────

/**
 * share.google/XXXX → (302) www.google.com/share.google?q=XXXX → (301) la página de verdad. Un GET sigue las
 * redirecciones; con el destino, el adaptador de su dominio (si hay) y luego el buscador genérico.
 */
const shareGoogle: Adaptador = async (p, http) => {
  const corto = urlsDe(p.detalle_url).find((u) => /^https?:\/\/share\.google\//i.test(u));
  if (!corto) return null;
  // GET, no HEAD: a un HEAD, www.google.com/share.google responde 200 sin redirigir.
  const r = await http.pedir(corto, { timeoutMs: 25_000 });
  let destino = r?.final ?? "";
  // Por si Google deja un intermedio (google.com/url?q=…).
  const q = /^https:\/\/www\.google\.[a-z.]+\/url\?(?:[^#]*&)?q=([^&]+)/i.exec(destino)?.[1];
  if (q) destino = decodeURIComponent(q);
  if (!/^https?:\/\//i.test(destino) || /^https?:\/\/(share\.google|(www\.)?google\.[a-z.]+)\//i.test(destino)) return null;
  const plaza = { ...p, detalle_url: destino };
  let host = "";
  try {
    host = new URL(destino).hostname.toLowerCase();
  } catch {
    return null;
  }
  const propio = ADAPTADORES[host];
  if (propio && propio !== shareGoogle) {
    const h = await propio(plaza, http);
    if (h) return h;
  }
  // El genérico (sin `http`: así no vuelve a correr el adaptador del dominio).
  return buscarBases(plaza, pedirDe(http));
};

// ─── DIRESA Madre de Dios (apps.diresamdd.gob.pe: Django, tarjetas y ficha con columnas por etapa) ──

const diresaMdd: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const regimen = regimenDe(p.numero);
  const base = "http://apps.diresamdd.gob.pe";
  const codigo = (t: string) => /(CAS|276|728)\D{0,14}?0*(\d{1,3})\s*-\s*(20\d{2})/i.exec(t);
  let ficha: string | null = null;
  for (let pagina = 1; pagina <= 2 && !ficha; pagina++) {
    const r = await http.get(pagina === 1 ? `${base}/` : `${base}/?page=${pagina}`);
    if (!r?.texto) break;
    let previo = 0;
    for (const m of r.texto.matchAll(/href="(\/convocatorias\/detalle_convocatoria\/\d+\/)"/g)) {
      const tarjeta = textoPlano(r.texto.slice(previo, m.index ?? 0));
      previo = (m.index ?? 0) + m[0].length;
      const c = codigo(tarjeta.split(/C[oó]digo:/i).pop() ?? "");
      if (!c || Number(c[2]) !== n || Number(c[3]) !== anio) continue;
      const reg = c[1].toUpperCase() === "CAS" ? "cas" : c[1];
      if (regimen !== "otro" && reg !== regimen) continue;
      ficha = `${base}${m[1]}`;
      break;
    }
  }
  if (!ficha) return null;
  const d = await http.get(ficha);
  if (!d?.texto) return null;
  const html = sinComentarios(d.texto);
  const docs: Enlace[] = [];
  const tabla = /<table\b[\s\S]*?<\/table>/i.exec(html.slice(html.search(/Resultados de las etapas/i)))?.[0] ?? "";
  const cabeceras = cabecerasDe(tabla);
  for (const f of tabla.split(/<tr\b/i).slice(1)) if (/<td\b/i.test(f)) docs.push(...documentosDeFila(f, cabeceras, d.final));
  for (const e of enlaces(html, d.final)) if (esDocumento(e.url) && /bases/i.test(e.texto)) docs.push({ url: e.url, texto: e.texto });
  // Un archivo de OTRO proceso en la columna de bases (pasa: «NRO-03» en la ficha del 04): fuera.
  const propios = docs.filter((x) => {
    const c = /NRO-0*(\d+)-(20\d{2})/i.exec(decodeURIComponent(x.url));
    return !c || (Number(c[1]) === n && Number(c[2]) === anio);
  });
  return hallazgo(ficha, propios);
};

// ─── OECE (caspublico.oece.gob.pe: JSON dentro de JSON; las bases son archivos privados de Drive por POST) ──

interface ConvocatoriaOece { c_num?: string; c_tit?: string; c_base?: string | null; c_rol_ent?: string | null; d_fec_pub?: string | null }

/**
 * ObtenerListas da el id de cada año; ConsultarConvocatorias (vigentes, luego concluidas) la fila «00136 -CAS-OSCE-2026»
 * con c_base (bases) y c_rol_ent (perfil): ids de Drive privados que sólo baja POST /Convocatoria/ConsultarArchivo
 * (cuerpo id=…). Los comunicado1…4 son RESULTADOS (con nombres): fuera. El documento va como …ConsultarArchivo?id=…#post.
 * TLS roto (cadena incompleta): en producción por el relay tolerante.
 */
const oece: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://caspublico.oece.gob.pe";
  const listas = await http.json<{ responseProceso?: string }>(`${base}/Convocatoria/ObtenerListas`);
  let procesos: { n_cod_proc?: number; n_anio?: number }[] = [];
  try {
    procesos = (JSON.parse(listas?.responseProceso ?? "{}") as { RptaLista?: typeof procesos }).RptaLista ?? [];
  } catch {
    return null;
  }
  const proceso = procesos.find((x) => x.n_anio === anio);
  if (!proceso?.n_cod_proc) return null;
  for (const estado of [1, 2]) {
    const r = await http.pedir(`${base}/Convocatoria/ConsultarConvocatorias`, {
      form: { idProceso: String(proceso.n_cod_proc), idPerfil: "0", estado: String(estado), skip: "0", take: "500" },
      cabeceras: { accept: "application/json, text/javascript, */*; q=0.01", "x-requested-with": "XMLHttpRequest", referer: `${base}/` },
      timeoutMs: 30_000,
    });
    let filas: ConvocatoriaOece[] = [];
    try {
      const j = JSON.parse(r?.texto ?? "{}") as { jsonConvocatoria?: string };
      filas = (JSON.parse(j.jsonConvocatoria ?? "{}") as { RptaLista?: ConvocatoriaOece[] }).RptaLista ?? [];
    } catch {
      continue;
    }
    const candidatas = filas.filter((x) => {
      const m = /^\s*0*(\d+)\s*-\s*CAS\b.*?(20\d{2})\s*$/i.exec(x.c_num ?? "");
      return !!m && Number(m[1]) === n && Number(m[2]) === anio;
    }).sort((a, b) => parecidoPuesto(p.titulo, b.c_tit ?? "") - parecidoPuesto(p.titulo, a.c_tit ?? ""));
    const c = candidatas[0];
    if (!c) continue;
    const docs: Enlace[] = [];
    const archivo = (id: string) => `${base}/Convocatoria/ConsultarArchivo?id=${encodeURIComponent(id)}#post`;
    if (c.c_base) docs.push({ url: archivo(c.c_base), texto: `Bases ${(c.c_num ?? "").replace(/\s*-\s*/g, "-").trim()}`.trim() });
    if (c.c_rol_ent) docs.push({ url: archivo(c.c_rol_ent), texto: `Perfil del puesto: ${textoPlano(c.c_tit ?? "").replace(/^\d+\.\s*/, "")}` });
    return hallazgo(`${base}/`, docs);
  }
  return null;
};

// ─── MIDIS (app.midis.gob.pe/Sis_Convocatoria: el mismo sistema Kendo que JUNTOS) ──────────────────

interface FilaMidis { NroConvocatoria?: string; NombreCargo?: string; IdBase?: number; IdTieneRequerimiento?: number; TextoComunicados?: string | null }

/** Las plazas del MIDIS (el ministerio; sus programas tienen sistemas propios): por la entidad o por el enlace de SERVIR. */
export const esMidis = (p: Pick<PlazaParaBases, "entidad" | "detalle_url">) =>
  /^\s*MINISTERIO DE DESARROLLO E INCLUSI[OÓ]N SOCIAL\s*$/i.test(p.entidad ?? "")
  || /76218-convocatorias-del-estado-midis|app\.midis\.gob\.pe\/Sis_Convocatoria/i.test(p.detalle_url ?? "");

/** Comunicados que sirven (no los resultados que también van en esa columna). */
const COMUNICADO_UTIL = /comunicado|errata|modificaci|cronograma|bases|perfil|ampliaci|prorroga|postergaci|reprogramaci|cancelad|suspendid/;

/**
 * ListarConvocatoriasPublico (GET, JSON sin sesión): Estado=2 son las «EN PROCESO» de todos los años (~680 KB), Estado=3
 * las concluidas (~1,1 MB); Estado=0 trae todo (~2 MB: roza el tope del cliente, no se usa). «096-2026» es el número de
 * SERVIR. Bases: DescargarArchivoBases/?id=IdBase; comunicados: DescargarArchivoPorId/?idConvocatoriaDoc=… (sin resultados).
 */
export const midis: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://app.midis.gob.pe/Sis_Convocatoria";
  for (const estado of [2, 3]) {
    const lista = await http.json<FilaMidis[]>(`${base}/Convocatoria/ListarConvocatoriasPublico?Estado=${estado}&IdConvocatoria=0&IdTipo=1`, { timeoutMs: 30_000 });
    if (!Array.isArray(lista)) continue;
    const c = lista.filter((x) => {
      const m = /^\s*0*(\d+)\s*-\s*(\d{4})/.exec(x.NroConvocatoria ?? "");
      return !!m && Number(m[1]) === n && Number(m[2]) === anio;
    }).sort((a, b) => parecidoPuesto(p.titulo, b.NombreCargo ?? "") - parecidoPuesto(p.titulo, a.NombreCargo ?? ""))[0];
    if (!c) continue;
    const docs: Enlace[] = [];
    if (c.IdBase && c.IdTieneRequerimiento === 1) docs.push({ url: `${base}/Convocatoria/DescargarArchivoBases/?id=${c.IdBase}`, texto: `Bases CAS N° ${c.NroConvocatoria}: ${c.NombreCargo ?? ""}`.trim() });
    for (const parte of (c.TextoComunicados ?? "").split("|")) {
      const [nombre, id] = parte.split("#");
      if (!id || !nombre || esResultado(nombre) || !COMUNICADO_UTIL.test(normalizar(nombre))) continue;
      docs.push({ url: `${base}/Convocatoria/DescargarArchivoPorId/?idConvocatoriaDoc=${id}`, texto: textoPlano(nombre) });
    }
    return hallazgo(`${base}/Convocatoria/Lista`, docs);
  }
  return null;
};

// ─── Provías Nacional (gis.proviasnac.gob.pe/convocatorias: ASP clásico, sólo http) ────────────────

/** Las plazas de Provías Nacional (no Provías Descentralizado): por la entidad o por el enlace de SERVIR. */
export const esProvias = (p: Pick<PlazaParaBases, "entidad" | "detalle_url">) =>
  (/PROVIAS NACIONAL|PROV[IÍ]AS NACIONAL/i.test(p.entidad ?? "") && !/DESCENTRALIZADO/i.test(p.entidad ?? ""))
  || /35478-postular-a-las-oportunidades-laborales-de-provias|gis\.proviasnac\.gob\.pe/i.test(p.detalle_url ?? "");

/**
 * listado_convocatorias.asp (año, tipo 2 = CAS / 1 = CAP, estado 1 activas / 2 en proceso / 3 concluidas) → la fila
 * «CP-CAS - 0052 - 2026» con su detalle_convocatoria.asp → los downloadArchivo('11873','BASES CAS N°052-2026.pdf') →
 * descargaArchivoConvoca.asp?PK_eRecord=11873 (PDF como application/octet-stream). OJO: la ficha trae en un campo oculto
 * (s_Resultados) la lista de postulantes con nombres: sólo se leen los downloadArchivo, nada más de esa página.
 */
/**
 * El sitio es windows-1252 y el cliente lee todo como UTF-8: «N°», «Ó»… llegan como U+FFFD. Para las etiquetas: «N�» →
 * «N°», «CI�N»/«SI�N» → «CIÓN»/«SIÓN», el resto fuera (y el «&nbsp» sin punto y coma que deja el ASP).
 */
const sinRombos = (t: string) => t.replace(/&nbsp;?/gi, " ").replace(/N�/g, "N°").replace(/([CS]I)�(N)/g, "$1Ó$2").replace(/�/g, "").replace(/\s+/g, " ").trim();

export const provias: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const tipo = regimenDe(p.numero) === "cas" ? 2 : 1;
  const base = "http://gis.proviasnac.gob.pe/convocatorias/";
  for (const estado of [1, 2, 3]) {
    const r = await http.get(`${base}listado_convocatorias.asp?FK_eAnio=${anio}&FK_eTProceso=${tipo}&FK_eTProcEstado=${estado}`);
    if (!r?.texto) continue;
    let mejor: { url: string; parecido: number } | null = null;
    const filas = r.texto.split(/onclick="ir_a\('/i).slice(1);
    for (const f of filas) {
      const rel = /^(detalle_convocatoria\.asp\?[^']+)'/i.exec(f)?.[1];
      const numero = /cNumeroProceso=([^'&]+)/i.exec(rel ?? "")?.[1] ?? "";
      const m = /0*(\d+)\s*-\s*(20\d{2})\s*$/.exec(numero.replace(/%20/g, " "));
      if (!rel || !m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
      const parecido = parecidoPuesto(p.titulo, sinRombos(textoPlano(f.split(/<\/tr>/i)[0])));
      if (!mejor || parecido > mejor.parecido) mejor = { url: new URL(rel, base).toString(), parecido };
    }
    if (!mejor) continue;
    const d = await http.get(mejor.url);
    if (!d?.texto) return null;
    const docs: Enlace[] = [];
    for (const m of d.texto.matchAll(/downloadArchivo\('(\d+)'\s*,\s*'([^']*)'[^)]*\)[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const descripcion = sinRombos(textoPlano(celdas(m[3])[0] ?? "") || textoPlano(m[2]));
      if (esResultado(`${descripcion} ${m[2]}`)) continue;
      docs.push({ url: `${base}descargaArchivoConvoca.asp?PK_eRecord=${m[1]}`, texto: descripcion.slice(0, 160) });
    }
    return hallazgo(mejor.url, basesPrimero(docs));
  }
  return null;
};

// ─── El registro ─────────────────────────────────────────────────────────────────────────────────

export const ADAPTADORES_ESPECIALES: Record<string, Adaptador> = {
  "aguacanete.com": aguaCanete,
  "www.aguacanete.com": aguaCanete,
  "www.drtcayacucho.gob.pe": drtcAyacucho,
  "drtcayacucho.gob.pe": drtcAyacucho,
  "munilaperla.gob.pe": laPerla,
  "www.munilaperla.gob.pe": laPerla,
  "munipachitea.gob.pe": pachitea,
  "www.munipachitea.gob.pe": pachitea,
  "drive.google.com": drive,
  "share.google": shareGoogle,
  "apps.diresamdd.gob.pe": diresaMdd,
  "caspublico.oece.gob.pe": oece,
  "app.midis.gob.pe": midis,
  "gis.proviasnac.gob.pe": provias,
};
