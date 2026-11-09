/**
 * Ola 2 — educación y universidades: UNAS, DRE Áncash, MINEDU (www), UGEL 02, Colegio Militar Bolognesi (Blogger),
 * UGEL Tacna (carpeta de Drive), UGEL 04 (por IP) y UNHEVAL. Probados contra los sitios el 2026-11-09 desde el Perú.
 *
 * Recordatorio de las UGEL/DRE: en el 276 (y la Ley 23536) el «276-NN» de SERVIR NO es el número del proceso: cada oficina
 * tiene una ronda de contratación por periodo (RVM 175-2026-MINEDU); se toma la ronda más reciente en o poco antes de
 * `fecha_inicio`. Donde la entidad numera sus rondas y coincide, el número sólo desempata.
 */
import {
  ADAPTADORES, hallazgo, textoPlano, celdas, nombreDeArchivo, parecidoPuesto, numeroYAnio, regimenDe, anioDe, type Adaptador,
} from "../empleoAdaptadores.js";
import {
  enlaces, esDocumento, normalizar, numeroProceso, type Enlace,
} from "../basesPlaza.js";

// ─── Lo común (copias pequeñas de lo privado de empleoAdaptadores.ts) ───────────────────────────────

const pad = (n: number, largo: number) => String(n).padStart(largo, "0");

/** Días entre dos fechas ISO (b - a). */
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const hoy = () => new Date().toISOString().slice(0, 10);

const corrido = (iso: string, d: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

/** La ronda más reciente que no es posterior a la publicación de SERVIR (con `holgura` días) ni anterior a 60 días. */
function rondaVigente<T extends { fecha: string | null }>(rondas: T[], fechaInicio: string | null, holgura = 7): T | null {
  const limite = fechaInicio ?? hoy();
  return rondas
    .filter((r): r is T & { fecha: string } => !!r.fecha && dias(r.fecha, limite) >= -holgura && dias(r.fecha, limite) <= 60)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0] ?? null;
}

const ES_RESULTADO = /resultad|apto|ganador|cuadro de m|adjudicaci|evaluaci[oó]n (curricular|de conoc)|entrevista|puntaje|preliminar|final|absoluci|reclamo|cmf|cmp/i;

/** «dd/mm/yyyy» → «yyyy-mm-dd». */
const isoDe = (ddmmyyyy: string | undefined | null) => {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(ddmmyyyy ?? "");
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

/** La primera URL de `detalle_url` de un dominio. */
const urlDe = (p: { detalle_url: string | null }, dominio: RegExp) =>
  (p.detalle_url ?? "").split(/[;\s|]+/).map((u) => u.replace(/[,.;]+$/, "")).find((u) => {
    try {
      return dominio.test(new URL(u).hostname);
    } catch {
      return false;
    }
  }) ?? null;

// ─── UNAS (Drupal): una tabla «N° 047/276 - (01) Puesto» con el PDF y una ficha con los anexos ─────────

/**
 * UNAS: /convocatoria-de-personal lista los procesos (12 por página, lo más nuevo arriba) como «N° 047/276 - (01)
 * Profesional II - … - Cuarta Convocatoria», con la fecha «Del» y el PDF de la convocatoria. El número de SERVIR es el de
 * la UNAS; una misma plaza se convoca varias veces (primera, segunda…): la convocatoria más reciente que no es posterior a
 * la publicación. La ficha (/content/…) suma el enlace «Descargar Anexos» (Drive). Los resultados quedan fuera.
 */
const unas: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const reg = regimenDe(p.numero);
  const sigla = reg === "cas" ? "CAS" : reg === "276" ? "276" : reg === "728" ? "728" : null;
  if (!sigla) return null;
  const base = "https://portalweb.unas.edu.pe";
  const detalle = urlDe(p, /(^|\.)unas\.edu\.pe$/i);
  const camino = detalle && /^\/convocatoria-de-[a-z-]+$/.test(new URL(detalle).pathname) ? new URL(detalle).pathname : "/convocatoria-de-personal";
  const fecha = p.fecha_inicio ?? hoy();
  for (let pagina = 0; pagina < 3; pagina++) {
    const lista = `${base}${camino}${pagina ? `?page=${pagina}` : ""}`;
    const r = await http.get(lista);
    if (!r?.texto) return null;
    const filas = r.texto.split(/<tr\b/i).slice(1).map((f) => {
      const titulo = textoPlano(/views-field-title[^>]*>([\s\S]*?)<\/td>/i.exec(f)?.[1] ?? "");
      const m = /N\D{0,3}0*(\d+)\s*\/\s*(276|CAS|728)\b/i.exec(titulo);
      return {
        titulo,
        n: m ? Number(m[1]) : null,
        sigla: m?.[2].toUpperCase() ?? null,
        fecha: /views-field-field-del-convocatoria[\s\S]*?content="(\d{4}-\d{2}-\d{2})/i.exec(f)?.[1] ?? null,
        ficha: /views-field-title[\s\S]*?href="([^"]+)"/i.exec(f)?.[1] ?? null,
        docs: enlaces(/views-field-field-archivo-convocatoria[^>]*>([\s\S]*?)<\/td>/i.exec(f)?.[1] ?? "", r.final).filter((e) => esDocumento(e.url)),
      };
    }).filter((x) => x.n != null && x.fecha);
    const candidatas = filas.filter((x) => x.n === n && x.sigla === sigla && dias(x.fecha!, fecha) >= -7 && dias(x.fecha!, fecha) <= 120)
      .sort((a, b) => b.fecha!.localeCompare(a.fecha!) || parecidoPuesto(p.titulo, b.titulo) - parecidoPuesto(p.titulo, a.titulo));
    const elegida = candidatas[0];
    if (elegida) {
      const docs: Enlace[] = elegida.docs.filter((e) => !ES_RESULTADO.test(`${e.texto} ${nombreDeArchivo(e.url)}`));
      if (elegida.ficha) {
        const ficha = new URL(elegida.ficha, base).toString();
        const d = await http.get(ficha);
        for (const e of enlaces(d?.texto ?? "", d?.final ?? ficha)) {
          if (!esDocumento(e.url) || !/unas\.edu\.pe\/sites\/default\/files\/|drive\.google\.com|docs\.google\.com/i.test(e.url)) continue;
          const texto = /anexo/i.test(e.texto) ? "Anexos" : e.texto || nombreDeArchivo(e.url);
          if (!ES_RESULTADO.test(`${texto} ${nombreDeArchivo(e.url)}`)) docs.push({ url: e.url, texto });
        }
        return hallazgo(ficha, docs);
      }
      return hallazgo(lista, docs);
    }
    // Lo más viejo de la página ya es anterior a la ventana: no hay más que buscar.
    const masVieja = filas.map((x) => x.fecha!).sort()[0];
    if (!masVieja || dias(masVieja, fecha) > 120 || !new RegExp(`[?&]page=${pagina + 1}\\b`).test(r.texto)) break;
  }
  return null;
};

// ─── DRE Áncash (Laravel + Vue): una API JSON pública ─────────────────────────────────────────────

interface ConvocatoriaDrea { id: string; attributes?: { correlativo?: string; titulo?: string; fecha_publicado?: string } }

/**
 * DRE Áncash: /api/front/page/convocatorias?anio=… (10 por página, lo más nuevo arriba) con el correlativo «032 - 2026
 * (CAP)» y el título; /api/front/page/convocatorias/{id} trae la lista de documentos con su tipo (BASE, COMUNICADO…).
 * CAS por el correlativo «(CAS)»; 276 por la ronda de contratación «(CAP)» vigente (el número sólo desempata).
 */
const dreAncash: Adaptador = async (p, http) => {
  const anio = anioDe(p);
  const n = numeroProceso(p.numero);
  const cas = regimenDe(p.numero) === "cas";
  const api = "https://web.dreancash.gob.pe/api/front/page/convocatorias";
  const leer = async (q: string, a = anio, pagina = 1) =>
    ((await http.json<{ data?: { data?: ConvocatoriaDrea[] } }>(`${api}?page=${pagina}&anio=${a}&search=${encodeURIComponent(q)}`))?.data?.data ?? []).map((c) => {
      const corr = c.attributes?.correlativo ?? "";
      const m = /^\s*0*(\d+)\s*-\s*(\d{4})\s*\(([A-Z]+)\)/i.exec(corr);
      return { id: c.id, n: m ? Number(m[1]) : null, anio: m ? Number(m[2]) : null, tipo: m?.[3].toUpperCase() ?? "", titulo: textoPlano(c.attributes?.titulo ?? ""), fecha: isoDe(c.attributes?.fecha_publicado) };
    });
  let elegida: Awaited<ReturnType<typeof leer>>[number] | null = null;
  if (cas) {
    if (n == null) return null;
    const conCas = (xs: Awaited<ReturnType<typeof leer>>) => xs.find((x) => x.tipo === "CAS" && x.n === n && x.anio === anio) ?? null;
    // La búsqueda sólo mira el título: se pagina. El correlativo es uno solo para todos los tipos y va en orden (10 por
    // página, lo más nuevo arriba): la página se calcula desde el primero de la primera.
    const primera = await leer("");
    elegida = conCas(primera);
    const tope = primera.find((x) => x.n != null)?.n;
    if (!elegida && tope && tope > n) {
      const estimada = Math.floor((tope - n) / 10) + 1;
      for (const pagina of [estimada, estimada + 1, estimada - 1].filter((x) => x > 1)) {
        elegida = conCas(await leer("", anio, pagina));
        if (elegida) break;
      }
    }
  } else {
    // Las rondas de contratación 276 («PROCESO DE CONTRATACIÓN … 276 – PERÍODO 2027», «CONCURSO PÚBLICO DE MÉRITOS PARA
    // CUBRIR PLAZAS ADMINISTRATIVAS … (DL 276)»), no el nombramiento, la rotación ni el ascenso. En enero y febrero, también
    // las del año anterior.
    const mes = Number((p.fecha_inicio ?? "").slice(5, 7)) || 12;
    const lista = [...(await leer("276")), ...(mes <= 2 ? await leer("276", anio - 1) : [])];
    const rondas = lista.filter((x) => x.tipo !== "CAS" && /\b276\b/.test(x.titulo) && /CONTRATACI|CONTRATO|CONCURSO P|PLAZAS ADMINISTRATIVAS/i.test(x.titulo)
      && !/NOMBRAMIENTO|ASCENSO|ROTACI|REASIGNA|ENCARGATURA|RENOVACI/i.test(x.titulo));
    const conNumero = rondas.find((x) => x.n === n && x.anio === anio);
    elegida = conNumero && rondaVigente([conNumero], p.fecha_inicio) ? conNumero : rondaVigente(rondas, p.fecha_inicio);
  }
  if (!elegida) return null;
  const d = await http.json<{ data?: { item?: { lista?: { tipo?: string; titulo?: string; file?: string; es_imagen?: boolean }[] } } }>(`${api}/${elegida.id}`);
  const docs: Enlace[] = [];
  for (const x of d?.data?.item?.lista ?? []) {
    const tipo = textoPlano(x.tipo ?? "");
    const titulo = textoPlano(x.titulo ?? "");
    if (!x.file || ES_RESULTADO.test(`${tipo} ${titulo}`)) continue;
    docs.push({ url: x.file, texto: /^documento principal$/i.test(titulo) ? (tipo === "BASE" ? "Bases de la convocatoria" : "Convocatoria") : titulo || tipo });
  }
  return hallazgo(`https://web.dreancash.gob.pe/Convocatoria/${elegida.id}`, docs);
};

// ─── MINEDU (www): la página de transparencia muestra en un iframe el aplicativo PostulacionCas ────────

/** www.minedu.gob.pe/transparencia/2013/cas_online.php enmarca postulacioncas.minedu.gob.pe: su adaptador. */
const mineduWww: Adaptador = (p, http) => {
  const a = ADAPTADORES["postulacioncas.minedu.gob.pe"];
  return a ? a(p, http) : Promise.resolve(null);
};

// ─── UGEL 02 (Drupal): la tabla de rondas 276, sin fechas ────────────────────────────────────────

/**
 * UGEL 02: /proc-cont-pers-admi-276 es una tabla (lo más nuevo arriba) con «009-2026», la descripción («… para el año
 * 2027»), la convocatoria, los comunicados, las plazas y los cuadros de mérito (fuera). La tabla no tiene fechas: se toma
 * el periodo (desde noviembre, el del año siguiente; si no hay, el del año) y, en él, la ronda con el número de SERVIR o,
 * si no, la más reciente.
 */
const ugel02: Adaptador = async (p, http) => {
  const url = "https://www.ugel02.gob.pe/proc-cont-pers-admi-276";
  const r = await http.get(url);
  if (!r?.texto) return null;
  const anio = anioDe(p);
  const n = numeroProceso(p.numero);
  const filas = r.texto.split(/<tr\b/i).slice(1).map((f) => {
    const cs = celdas(f);
    const nro = /0*(\d+)\s*-\s*(20\d{2})/.exec(textoPlano(cs[0] ?? ""));
    const desc = textoPlano(cs[1] ?? "");
    const periodo = Number(/(?:a[ñn]o|periodo(?:\s+lectivo)?)\s+(20\d{2})/i.exec(desc)?.[1] ?? nro?.[2] ?? 0);
    return { n: nro ? Number(nro[1]) : null, anio: nro ? Number(nro[2]) : null, desc, periodo, cs };
  }).filter((x) => x.n != null && x.cs.length >= 6 && /\b276\b/.test(x.desc) && /contrat/i.test(x.desc) && !/ascenso|nombramiento|rotaci|reasigna|encarg/i.test(x.desc));
  const mes = Number((p.fecha_inicio ?? "").slice(5, 7)) || new Date().getUTCMonth() + 1;
  const quiero = mes >= 11 ? anio + 1 : anio;
  let ronda = null as (typeof filas)[number] | null;
  for (const periodo of [quiero, quiero === anio ? anio + 1 : anio]) {
    const xs = filas.filter((x) => x.periodo === periodo);
    ronda = xs.find((x) => x.n === n && x.anio === anio) ?? xs[0] ?? null;
    if (ronda) break;
  }
  if (!ronda) return null;
  const docs: Enlace[] = [];
  const columnas: [number, string][] = [[2, "Convocatoria y cronograma"], [4, "Plazas"], [3, "Comunicado"]];
  for (const [i, nombre] of columnas) {
    for (const e of enlaces(ronda.cs[i] ?? "", r.final)) {
      const archivo = nombreDeArchivo(e.url);
      if (esDocumento(e.url) && !ES_RESULTADO.test(archivo)) docs.push({ url: e.url.replace(/^http:/, "https:"), texto: `${nombre}: ${archivo}` });
    }
  }
  return hallazgo(url, docs, "lista");
};

// ─── Colegio Militar Francisco Bolognesi (Blogger): el feed JSON ─────────────────────────────────

interface EntradaBlogger { published?: { $t?: string }; title?: { $t?: string }; content?: { $t?: string }; link?: { rel?: string; href?: string }[] }

const NO_CONVOCATORIA = /RESULTAD|ABSOLUCI|COMUNICADO|ENTREVISTA|VERIFICACI|APTOS|GANADOR|FE DE ERRATA|RECLAMO|ADJUDICA|PRELIMINAR|FINAL/i;

/**
 * UE Colegio Militar Francisco Bolognesi (uecmfbrrhh.blogspot.com): cada convocatoria es una entrada «CONVOCATORIA NRO
 * 012-2026-UE-CMFB» con la convocatoria en imágenes y los anexos en Drive; los resultados son otras entradas (fuera).
 * Por el número (si cae en la ventana de la publicación) o, si no, la convocatoria más reciente antes de la publicación.
 */
const cmfb: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  const anio = anioDe(p);
  const fecha = p.fecha_inicio ?? hoy();
  const feed = await http.json<{ feed?: { entry?: EntradaBlogger[] } }>(
    `https://uecmfbrrhh.blogspot.com/feeds/posts/default?alt=json&max-results=40&published-max=${corrido(fecha, 7)}T23:59:59-05:00`,
  );
  const entradas = (feed?.feed?.entry ?? []).map((e) => ({
    titulo: textoPlano(e.title?.$t ?? ""),
    fecha: (e.published?.$t ?? "").slice(0, 10) || null,
    enlace: e.link?.find((l) => l.rel === "alternate")?.href ?? "",
    html: e.content?.$t ?? "",
  })).filter((x) => /CONVOCATORIA/i.test(x.titulo) && !NO_CONVOCATORIA.test(x.titulo) && x.enlace);
  const conNumero = n == null ? [] : entradas.filter((x) => {
    const na = numeroYAnio(x.titulo);
    return !!na && na.n === n && na.anio === anio;
  });
  const elegida = rondaVigente(conNumero, p.fecha_inicio) ?? rondaVigente(entradas, p.fecha_inicio);
  if (!elegida) return null;
  const docs: Enlace[] = [];
  let pagina = 0;
  for (const e of enlaces(elegida.html, elegida.enlace)) {
    if (/blogger\.googleusercontent\.com\/img\//i.test(e.url) || /\.(jpe?g|png)(\?|$)/i.test(e.url)) docs.push({ url: e.url, texto: `Convocatoria (imagen, página ${++pagina})` });
    else if (esDocumento(e.url) && !ES_RESULTADO.test(e.texto)) docs.push({ url: e.url, texto: /anexo/i.test(e.texto) ? "Anexos" : e.texto || "Documento" });
  }
  // Los PDF (los anexos) primero: son los que se leen; las imágenes quedan como enlace.
  docs.sort((a, b) => Number(/imagen/.test(a.texto)) - Number(/imagen/.test(b.texto)));
  return hallazgo(elegida.enlace, docs);
};

// ─── UGEL Tacna: una página por periodo con su carpeta de Drive incrustada ───────────────────────

const MESES_EN: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** La fecha de la columna «Last modified» de una carpeta de Drive en inglés: «Nov 4», «12/10/25» o «3:45 PM» (hoy). */
function fechaDrive(t: string, ahora = new Date()): string | null {
  const s = t.trim();
  if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(s)) return ahora.toISOString().slice(0, 10);
  const a = /^([A-Za-z]{3})\s+(\d{1,2})$/.exec(s);
  if (a && MESES_EN[a[1].toLowerCase()]) {
    let y = ahora.getUTCFullYear();
    const iso = (yy: number) => `${yy}-${pad(MESES_EN[a[1].toLowerCase()], 2)}-${pad(Number(a[2]), 2)}`;
    if (iso(y) > corrido(ahora.toISOString().slice(0, 10), 1)) y--;
    return iso(y);
  }
  const b = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (b) return `${b[3].length === 2 ? `20${b[3]}` : b[3]}-${pad(Number(b[1]), 2)}-${pad(Number(b[2]), 2)}`;
  return null;
}

/** Los archivos de una carpeta pública de Drive (la vista incrustada es HTML sin JS): nombre, enlace y fecha. */
async function carpetaDrive(http: Parameters<Adaptador>[1], id: string): Promise<{ titulo: string; url: string; fecha: string | null }[]> {
  // En inglés (lo decide accept-language, no ?hl=): «Nov 4» y «12/22/25» (mes/día/año), sin ambigüedad.
  const r = await http.get(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}&hl=en`, { "accept-language": "en-US,en;q=0.9" });
  if (!r?.texto) return [];
  return r.texto.split(/<div class="flip-entry"/i).slice(1).map((b) => ({
    titulo: textoPlano(/flip-entry-title">([\s\S]*?)<\/div>/i.exec(b)?.[1] ?? ""),
    url: (/href="([^"]+)"/i.exec(b)?.[1] ?? "").replace(/&amp;/g, "&"),
    fecha: fechaDrive(textoPlano(/flip-entry-last-modified"><div>([^<]*)</i.exec(b)?.[1] ?? "")),
  })).filter((x) => /\/file\/d\//.test(x.url));
}

/**
 * UGEL Tacna: /oficina/proceso-de-contrato-de-personal-administrativo-d-l-n0-276-y-profesionales-de-la-salud-2027 (una por
 * periodo) incrusta una carpeta de Drive con todo lo del periodo. Si una «CONVOCATORIA N° 025-2026 …» lleva el número de
 * SERVIR y cae en la ventana, ésa (con lo que nombra su número); si no, la ronda: lo publicado entre 45 días antes y 7
 * después de la publicación de SERVIR, sin resultados ni las convocatorias numeradas de otras instituciones educativas.
 */
const ugelTacna: Adaptador = async (p, http) => {
  const inicio = urlDe(p, /(^|\.)ugeltacna\.gob\.pe$/i);
  if (!inicio) return null;
  const anio = anioDe(p);
  const n = numeroProceso(p.numero);
  const fecha = p.fecha_inicio ?? hoy();
  const mes = Number(fecha.slice(5, 7));
  const raiz = /^(https?:\/\/[^/]+\/oficina\/proceso-de-contrato-de-personal-administrativo[a-z0-9-]*?-salud)(?:-\d{4})?\/?$/i.exec(inicio)?.[1];
  const paginas = [...new Set([inicio, ...(raiz ? [`${raiz}-${mes >= 11 ? anio + 1 : anio}`, `${raiz}-${mes >= 11 ? anio : anio + 1}`] : [])])].slice(0, 2);
  for (const pagina of paginas) {
    const r = await http.get(pagina);
    const id = /embeddedfolderview\?id=([\w-]+)/i.exec(r?.texto ?? "")?.[1];
    if (!id) continue;
    const archivos = await carpetaDrive(http, id);
    const enVentana = (x: { fecha: string | null }) => !!x.fecha && dias(x.fecha, fecha) >= -7 && dias(x.fecha, fecha) <= 45;
    const numeroDe = (t: string) => /CONVOCATORIA\s*(?:N\D{0,3})?0*(\d+)\s*-\s*(20\d{2})/i.exec(t);
    const propia = n == null ? undefined : archivos.find((x) => {
      const m = numeroDe(x.titulo);
      return !!m && Number(m[1]) === n && Number(m[2]) === anio && enVentana(x);
    });
    // Sin el número: la convocatoria numerada más reciente a la fecha (las de cada institución educativa); si la carpeta no
    // las numera (la ronda del periodo), todo lo publicado en la ventana.
    const ronda = propia ?? rondaVigente(archivos.filter((x) => /^\s*(?:\d{1,3}\.\s*)?CONVOCATORIA\b/i.test(x.titulo) && numeroDe(x.titulo)), p.fecha_inicio);
    let docs: { titulo: string; url: string }[];
    if (ronda) {
      const m = numeroDe(ronda.titulo)!;
      const re = new RegExp(`(?<![0-9])0*${Number(m[1])}\\s*-\\s*${m[2]}`);
      docs = archivos.filter((x) => (x === ronda || re.test(x.titulo)) && !ES_RESULTADO.test(x.titulo));
    } else {
      docs = archivos.filter((x) => enVentana(x) && !ES_RESULTADO.test(x.titulo) && !numeroDe(x.titulo));
    }
    const h = hallazgo(pagina, docs.map((x) => ({ url: x.url, texto: x.titulo.replace(/^\d{1,3}\.\s*/, "") })), ronda ? "pagina_proceso" : "lista");
    if (h) return h;
  }
  return null;
};

// ─── UGEL 04 (CodeIgniter, por IP): DataTables del lado del servidor ─────────────────────────────

/**
 * UGEL 04 (http://38.187.4.52/grupo-convocatorias): POST /consulta/lista (DataTables) por tipo de convocatoria
 * (4 = administrativo, 2 = auxiliares), lo más nuevo arriba, con la fecha y una columna por etapa: convocatoria, plazas,
 * cuadros de mérito (fuera), comunicado y adjudicación (fuera). La ronda vigente a la fecha de SERVIR (las filas del mismo
 * día se juntan) y la norma técnica del tipo (POST /consulta/listar_normativa), la más reciente a esa fecha.
 */
const ugel04: Adaptador = async (p, http) => {
  const base = "http://38.187.4.52/grupo-convocatorias";
  const reg = regimenDe(p.numero);
  if (reg === "cas") return null;
  const tipo = /auxiliar de educaci/i.test(p.titulo ?? "") ? "2" : "4";
  const form: Record<string, string> = { draw: "1", start: "0", length: "30", ci_csrf_token: "", "search[value]": "" };
  for (let i = 0; i <= 4; i++) form[`columns[${i}][search][value]`] = i === 4 ? tipo : i === 1 ? "0" : "";
  const r = await http.post(`${base}/consulta/lista`, form, { "x-requested-with": "XMLHttpRequest" });
  const texto = r?.texto ?? "";
  const i = texto.indexOf('{"draw"');
  if (i < 0) return null;
  let filas: (string | null)[][] = [];
  try {
    filas = (JSON.parse(texto.slice(i)) as { data?: (string | null)[][] }).data ?? [];
  } catch {
    return null;
  }
  const rondas = filas.map((f) => {
    const docs: Enlace[] = [];
    // Lo que también se subió como cuadro de mérito o adjudicación (una fe de erratas de los resultados) es resultado.
    const deResultados = new Set([5, 6, 8].flatMap((c) => enlaces(f[c] ?? "", `${base}/consulta/`).map((e) => nombreDeArchivo(e.url))));
    const columnas: [number, string][] = [[3, "Convocatoria"], [4, "Plazas"], [7, "Comunicado"]];
    for (const [c, nombre] of columnas) {
      for (const e of enlaces(f[c] ?? "", `${base}/consulta/`)) {
        const archivo = nombreDeArchivo(e.url);
        if (!ES_RESULTADO.test(archivo) && !deResultados.has(archivo)) docs.push({ url: e.url, texto: `${nombre}: ${archivo.replace(/^\d\.\s*/, "")}` });
      }
    }
    return { fecha: /(\d{4}-\d{2}-\d{2})/.exec(f[1] ?? "")?.[1] ?? null, desc: textoPlano(f[2] ?? ""), docs };
  }).filter((x) => /contrat/i.test(x.desc));
  const ronda = rondaVigente(rondas.filter((x) => x.docs.length), p.fecha_inicio);
  if (!ronda) return null;
  // Las filas del mismo día juntas; el mismo archivo subido en varias columnas o filas («… (1).pdf»), una vez.
  const vistos = new Set<string>();
  const docs = rondas.filter((x) => x.fecha === ronda.fecha).flatMap((x) => x.docs).filter((d) => {
    const k = normalizar(nombreDeArchivo(d.url)).replace(/^\d+\.?\s+/, "").replace(/\s*\(\d+\)$/, "");
    return !vistos.has(k) && !!vistos.add(k);
  });
  // La norma técnica del proceso (la RVM que hace de bases del 276 en educación).
  const normas = await http.json<{ asuntoContrato?: string; fechaRegistro?: string; url_normativa?: string | null }[]>(`${base}/consulta/listar_normativa`, { form: { valor_tipo: tipo } });
  const norma = (normas ?? [])
    .map((x) => ({ ...x, fecha: (x.fechaRegistro ?? "").slice(0, 10) }))
    .filter((x) => x.url_normativa && x.fecha && dias(x.fecha, ronda.fecha!) >= -7 && dias(x.fecha, ronda.fecha!) <= 400)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (norma?.url_normativa) docs.push({ url: new URL(`../documentos/normativas/${encodeURIComponent(norma.url_normativa)}`, `${base}/consulta/`).toString(), texto: `Norma técnica: ${textoPlano(norma.asuntoContrato ?? "") || nombreDeArchivo(norma.url_normativa)}` });
  return hallazgo(`${base}/consulta/administrativo`, docs, "lista");
};

// ─── UNHEVAL (Laravel): las listas de DataTables en JSON ─────────────────────────────────────────

/**
 * UNHEVAL (convocatoria.unheval.edu.pe): /convocatorias/vigentes/data y /convocatorias/en_curso/data devuelven las filas
 * («002-2026-V», el tipo C.A.S/276/728, el puesto, el enlace a las bases); /convocatorias/edit/{id} trae la resolución y
 * /convocatorias/show_comunicados/{id} los comunicados (cronograma, fe de erratas). Las evaluaciones de la fila, fuera.
 * El número se repite por convocatoria («-IV», «-V»): el puesto que más se parece y, si empatan, la más nueva.
 */
const unheval: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const reg = regimenDe(p.numero);
  const base = "https://convocatoria.unheval.edu.pe";
  const ajax = { "x-requested-with": "XMLHttpRequest" };
  for (const lista of ["vigentes", "en_curso"]) {
    const j = await http.json<{ aaData?: unknown[][] }>(`${base}/convocatorias/${lista}/data`, { cabeceras: ajax });
    const filas = (j?.aaData ?? []).map((f) => {
      const cod = textoPlano(String(f[0] ?? ""));
      const m = /^0*(\d+)\s*-\s*(\d{4})/.exec(cod);
      const partes = String(f[1] ?? "").split(/<br\s*\/?>/i).map((x) => textoPlano(x));
      const todo = f.map((x) => String(x ?? "")).join(" ");
      return {
        n: m ? Number(m[1]) : null, anio: m ? Number(m[2]) : null, tipo: partes[0] ?? "", puesto: partes.slice(1).join(" "),
        id: Number(/ver_(?:detalles|comunicados)\((\d+)\)/.exec(todo)?.[1] ?? 0),
        bases: /['"](\/storage\/procesos\/bases\/[^'"]+)['"]/.exec(todo)?.[1] ?? null,
      };
    }).filter((x) => x.n === n && x.anio === anio && x.id)
      .filter((x) => reg === "cas" ? /C\.?\s*A\.?\s*S/i.test(x.tipo) : reg === "276" ? /\b276\b/.test(x.tipo) : reg === "728" ? /\b728\b/.test(x.tipo) : true);
    const elegida = filas.sort((a, b) => parecidoPuesto(p.titulo, b.puesto) - parecidoPuesto(p.titulo, a.puesto) || b.id - a.id)[0];
    if (!elegida) continue;
    const docs: Enlace[] = [];
    if (elegida.bases) docs.push({ url: new URL(elegida.bases, base).toString(), texto: "Bases de la convocatoria" });
    const ficha = await http.json<{ archivo_bases?: string; archivo_resolucion?: string }>(`${base}/convocatorias/edit/${elegida.id}`, { cabeceras: ajax });
    const local = (x?: string) => (x ? (/^https?:/i.test(x) ? x : new URL(x.replace(/^public\//, "/storage/"), base).toString()) : null);
    const basesFicha = local(ficha?.archivo_bases);
    if (!elegida.bases && basesFicha) docs.push({ url: basesFicha, texto: "Bases de la convocatoria" });
    const resolucion = local(ficha?.archivo_resolucion);
    if (resolucion) docs.push({ url: resolucion, texto: "Resolución que aprueba la convocatoria" });
    const com = await http.get(`${base}/convocatorias/show_comunicados/${elegida.id}`, ajax);
    for (const fila of (com?.texto ?? "").split(/<tr\b/i).slice(1)) {
      const nombre = celdas(fila).map((c) => textoPlano(c)).filter((t) => t && !/^\d{2}\/\d{2}\/\d{4}/.test(t) && !/^descargar$/i.test(t))[0] ?? "Comunicado";
      if (ES_RESULTADO.test(nombre)) continue;
      // El <a> de «Descargar» se cierra con </button> (sin </a>): el href, directo.
      for (const m of fila.matchAll(/href=['"]([^'"]+\.(?:pdf|docx?|zip|rar))['"]/gi)) {
        docs.push({ url: new URL(m[1], base).toString(), texto: `Comunicado: ${nombre.toLowerCase().replace(/^./, (c) => c.toUpperCase())}` });
      }
    }
    return hallazgo(`${base}/`, docs);
  }
  return null;
};

export const ADAPTADORES_EDUCACION: Record<string, Adaptador> = {
  "portalweb.unas.edu.pe": unas,
  "web.dreancash.gob.pe": dreAncash,
  "www.minedu.gob.pe": mineduWww,
  "www.ugel02.gob.pe": ugel02,
  "ugel02.gob.pe": ugel02,
  "uecmfbrrhh.blogspot.com": cmfb,
  "www.ugeltacna.gob.pe": ugelTacna,
  "ugeltacna.gob.pe": ugelTacna,
  "38.187.4.52": ugel04,
  "convocatoria.unheval.edu.pe": unheval,
};

