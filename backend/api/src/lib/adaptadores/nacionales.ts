/**
 * Adaptadores de la ola 2 (organismos nacionales), medidos el 2026-11-09 desde el Perú contra las webs de verdad.
 * Mismo contrato que lib/empleoAdaptadores.ts: reciben la plaza de SERVIR y el cliente HTTP, devuelven el proceso con sus
 * documentos (bases, perfil, cronograma, comunicados) o null. Nunca resultados ni listas de postulantes.
 */
import {
  hallazgo, textoPlano, celdas, nombreDeArchivo, parecidoPuesto, numeroYAnio, camposOcultos, regimenDe, anioDe, type Adaptador,
} from "../empleoAdaptadores.js";
import {
  enlaces, esDocumento, numeroProceso, normalizar, type Enlace,
} from "../basesPlaza.js";

// ─── Lo común (copias de los privados de empleoAdaptadores.ts) ──────────────────────────────────────

const pad = (n: number, largo: number) => String(n).padStart(largo, "0");
const ES_RESULTADO = /resultad|apto|ganador|cuadro de m|adjudicaci|evaluaci[oó]n (curricular|de conoc)|entrevista|puntaje|preliminar|final/i;
const NO_DOCUMENTO = /resultad|rrp|ret\b|rec\b|ref\b|ficha|apto|puntaje|ganador/i;
/** Lo que puede traer nombres de postulantes (listas de inscritos, actas, resultados, evaluaciones): nunca se enlaza. */
const CON_NOMBRES = /inscrit|postulantes|lista de|relaci[oó]n de|actas?\b|aptos?\b|resultad|ganador|puntaj|entrevista|evaluaci[oó]n|califica|seleccionad|m[eé]rito|preliminar|final\b/i;

/** «dd/mm/yyyy» → «yyyy-mm-dd». */
const isoDe = (ddmmyyyy: string | undefined) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(ddmmyyyy ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** Días entre dos fechas ISO (b - a). */
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** «REQUISITOS Y CRONOGRAMA» → «Requisitos y cronograma». */
const oracion = (t: string) => {
  const s = textoPlano(t).replace(/\s+/g, " ").trim();
  return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;
};

/** El departamento de la plaza («AREQUIPA - LA JOYA» → «arequipa»). */
const departamento = (p: { ubicacion?: string | null }) => normalizar((p.ubicacion ?? "").split(" - ")[0] ?? "");

// ─── INPE: DOCman de Joomla (una entrada por proceso; la descripción enlaza bases, requisitos y anexos) ──────────

/** Las oficinas regionales del INPE por departamento (sólo desempata: la sede central también contrata para todo el país). */
const REGION_INPE: Record<string, string> = {
  tumbes: "norte", piura: "norte", lambayeque: "norte", "la libertad": "norte", cajamarca: "norte", ancash: "norte",
  lima: "lima", callao: "lima", ica: "lima",
  arequipa: "sur", moquegua: "sur", tacna: "sur",
  junin: "centro", huancavelica: "centro", ayacucho: "centro",
  huanuco: "oriente", pasco: "oriente", ucayali: "oriente",
  cusco: "sur oriente", apurimac: "sur oriente", "madre de dios": "sur oriente",
  puno: "altiplano",
  "san martin": "nor oriente", loreto: "nor oriente", amazonas: "nor oriente",
};
const SIGLAS_INPE: Record<string, string> = { ORN: "norte", ORL: "lima", ORSA: "sur", ORS: "sur", ORC: "centro", ORO: "oriente", ORSO: "sur oriente", ORSOC: "sur oriente", ORA: "altiplano", ORNO: "nor oriente", ORNOSM: "nor oriente" };
const UE_INPE: Record<string, string> = { "018": "lima", "010": "altiplano", "022": "sur oriente" };
const REGIONES = ["sur oriente", "nor oriente", "altiplano", "oriente", "norte", "centro", "lima", "sur"];

function regionInpe(titulo: string, descripcion: string): string | null {
  const sigla = /INPE\s*\/\s*(OR[A-Z]+)/i.exec(titulo)?.[1]?.toUpperCase();
  if (sigla && SIGLAS_INPE[sigla]) return SIGLAS_INPE[sigla];
  const ue = /UE\D{0,4}(\d{3})/i.exec(titulo)?.[1];
  if (ue && UE_INPE[ue]) return UE_INPE[ue];
  const d = normalizar(descripcion);
  return REGIONES.find((r) => new RegExp(`oficina regional (?:del? )?${r}\\b`).test(d)) ?? null;
}

/**
 * INPE (www.inpe.gob.pe/convocatorias.html): la lista de DOCman de a 60 (unas cinco semanas). El número se repite por
 * oficina regional («CAS N°005-2026-INPE/ORSA» y «…/ORO»): se elige por el puesto de la descripción, la oficina (por la
 * entidad de SERVIR o el departamento) y la fecha. El archivo principal de cada entrada es la directiva CAS general (el
 * mismo PDF en todas): se usan los enlaces de la descripción (REQUISITOS Y CRONOGRAMA, BASES, ANEXOS), que son
 * documentos de DOCman (…/documentos/15963-bases-006/file.html, sin extensión).
 */
const inpe: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const lista = "https://www.inpe.gob.pe/convocatorias.html?limit=60&limitstart=0";
  const r = await http.pedir(lista, { timeoutMs: 30_000 });
  if (!r?.texto) return null;
  const ent = normalizar(p.entidad ?? "");
  const quiere = REGIONES.find((x) => new RegExp(`oficina regional (?:del? )?${x}\\b`).test(ent)) ?? REGION_INPE[departamento(p)] ?? null;
  let mejor: { docs: Enlace[]; puntaje: number } | null = null;
  for (const b of r.texto.split(/<div class="docman_document"/i).slice(1)) {
    const titulo = textoPlano(/itemprop="name">([^<]*)</i.exec(b)?.[1] ?? "");
    const na = numeroYAnio(titulo);
    if (!na || na.n !== n || na.anio !== anio) continue;
    const desc = /itemprop="description">([\s\S]*?)<\/div>/i.exec(b)?.[1] ?? "";
    const texto = textoPlano(desc);
    const fecha = /datetime="(\d{4}-\d{2}-\d{2})/.exec(b)?.[1] ?? null;
    const region = regionInpe(titulo, texto);
    const parecido = parecidoPuesto(p.titulo, texto);
    if (parecido === 0 && (!quiere || region !== quiere)) continue;
    let puntaje = 3 * parecido + (quiere && region === quiere ? 1 : 0) - (quiere && region && region !== quiere ? 0.5 : 0);
    if (fecha && p.fecha_inicio && Math.abs(dias(fecha, p.fecha_inicio)) <= 7) puntaje += 0.5;
    const docs = enlaces(desc, r.final)
      .filter((e) => /\/documentos\/\d+-[^/?#]+(?:\.html|\/file\.html)$/i.test(e.url) && !CON_NOMBRES.test(`${e.texto} ${e.url}`))
      .map((e) => ({ url: e.url.replace(/(?<!\/file)\.html$/i, "/file.html"), texto: oracion(e.texto) || "Documento" }));
    if (docs.length && (!mejor || puntaje > mejor.puntaje)) mejor = { docs, puntaje };
  }
  return mejor ? hallazgo("https://www.inpe.gob.pe/convocatorias.html", mejor.docs) : null;
};

// ─── INDECOPI: tabla de WordPress (TablePress) con el enlace a la publicación de gob.pe ───────────────────────────

/** El nombre de un archivo de gob.pe sin el número de la publicación («8791191-cas-158-2026-perfil.pdf» → «Cas 158 2026 perfil»). */
const nombreGobPe = (url: string) => {
  const t = nombreDeArchivo(url).replace(/^\d{5,}-/, "").replace(/-+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Documento";
};

/**
 * INDECOPI (oportunidadeslaborales.indecopi.gob.pe): /convocatorias-cas/ (y /convocatorias-cap/ para el 728) es una
 * tabla con «158-2026 | puesto | … | Haz clic aquí» → la publicación de gob.pe con el perfil, el cronograma y las bases
 * generales. Dos pedidos.
 */
const indecopi: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const reg = regimenDe(p.numero);
  const base = "https://oportunidadeslaborales.indecopi.gob.pe";
  const lista = reg === "728" ? `${base}/convocatorias-cap/` : reg === "cas" ? `${base}/convocatorias-cas/` : null;
  if (!lista) return null;
  const r = await http.get(lista);
  if (!r?.texto) return null;
  let mejor: { url: string; parecido: number } | null = null;
  for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    const m = /^\s*0*(\d+)\s*-\s*(\d{4})/.exec(textoPlano(cs[0] ?? ""));
    if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
    const enlace = enlaces(fila, r.final).find((e) => /gob\.pe\/institucion\/indecopi\/informes-publicaciones\/\d+/i.test(e.url));
    if (!enlace) continue;
    const parecido = parecidoPuesto(p.titulo, `${textoPlano(cs[1] ?? "")} ${enlace.url.split("/").pop()}`);
    if (!mejor || parecido > mejor.parecido) mejor = { url: enlace.url, parecido };
  }
  if (!mejor) return null;
  const d = await http.get(mejor.url);
  if (!d?.texto) return null;
  const id = /informes-publicaciones\/(\d+)/.exec(mejor.url)?.[1] ?? "";
  const docs = enlaces(d.texto, d.final)
    .filter((e) => esDocumento(e.url) && /cdn\.www\.gob\.pe\/uploads\/document\/file\//i.test(e.url))
    .filter((e) => !ES_RESULTADO.test(`${e.texto} ${nombreDeArchivo(e.url)}`) && !CON_NOMBRES.test(`${e.texto} ${nombreDeArchivo(e.url)}`))
    .map((e) => {
      const propio = nombreDeArchivo(e.url).startsWith(`${id}-`);
      const generico = !e.texto || /^(ingresa|descarga|haz clic|clic|ver|aqu)/i.test(e.texto);
      return { url: e.url, texto: generico || propio ? nombreGobPe(e.url) : e.texto, propio };
    })
    // Los de esta publicación (perfil, cronograma) antes que los generales (bases, instructivo, declaraciones).
    .sort((a, b) => Number(b.propio) - Number(a.propio))
    .map(({ url, texto }) => ({ url, texto }));
  return hallazgo(mejor.url, docs);
};

// ─── SMV: ASP.NET con búsqueda y «Ver detalle» por postback ────────────────────────────────────────────────────────

/**
 * SMV (www.smv.gob.pe/ServicioTrabajaConNosotros): GET (ViewState) → POST «Buscar ofertas» (todas las vigentes, en
 * tarjetas) → POST «Ver detalle» de la tarjeta con el número y el régimen → la grilla de documentos (BASES, AVISO,
 * ANEXO A: PERFIL, ANEXO B: CRONOGRAMA…), cada uno en /ConsultasP8/documento.aspx?vidDoc={GUID} (redirige al PDF).
 * El reCAPTCHA de la página es del formulario de postulación, no de la búsqueda. Tres pedidos.
 */
const smv: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const url = "https://www.smv.gob.pe/ServicioTrabajaConNosotros/";
  const r = await http.get(url);
  if (!r?.texto) return null;
  const filtros = { "ctl00$MainContent$txtKeywords": "", "ctl00$MainContent$ddlRegimen": "0", "ctl00$MainContent$ddlSort": "date" };
  const boton = /name="ctl00\$MainContent\$btnSearch"[^>]*value="([^"]*)"|value="([^"]*)"[^>]*name="ctl00\$MainContent\$btnSearch"/.exec(r.texto);
  const l = await http.post(url, { ...camposOcultos(r.texto), ...filtros, "ctl00$MainContent$btnSearch": textoPlano(boton?.[1] ?? boton?.[2] ?? "Buscar Ofertas") });
  if (!l?.texto) return null;
  const numero = p.numero ?? "";
  const regimen = /30057/.test(numero) ? /30057/ : regimenDe(numero) === "cas" ? /CAS/i : regimenDe(numero) === "728" ? /Plazo|728/i : /PRACTIC/i.test(numero) ? /Practica/i : null;
  let mejor: { boton: string; parecido: number } | null = null;
  for (const tarjeta of l.texto.split(/class="job-card"/i).slice(1)) {
    const titulo = textoPlano(/class="job-title">([\s\S]*?)<\/div>/i.exec(tarjeta)?.[1] ?? "");
    const na = numeroYAnio(titulo);
    if (!na || na.n !== n || na.anio !== anio) continue;
    const etiqueta = textoPlano(/class="job-tag">([\s\S]*?)<\/span>/i.exec(tarjeta)?.[1] ?? "");
    if (regimen && !regimen.test(etiqueta)) continue;
    if (!/PRACTIC/i.test(numero) && /PRACTICANTE/i.test(titulo)) continue;
    const nombre = /name="(ctl00\$MainContent\$rptJobs\$ctl\d+\$btnVerDetalle)"/.exec(tarjeta)?.[1];
    if (!nombre) continue;
    const parecido = parecidoPuesto(p.titulo, textoPlano(/class="job-description">([\s\S]*?)<\/div>/i.exec(tarjeta)?.[1] ?? ""));
    if (!mejor || parecido > mejor.parecido) mejor = { boton: nombre, parecido };
  }
  if (!mejor) return null;
  const d = await http.post(url, { ...camposOcultos(l.texto), ...filtros, [mejor.boton]: "Ver detalle" });
  if (!d?.texto) return null;
  const grilla = /id="MainContent_gvDocumentos"[\s\S]*?<\/table>/i.exec(d.texto)?.[0] ?? "";
  const docs: Enlace[] = [];
  for (const fila of grilla.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    const texto = textoPlano(cs[0] ?? "");
    if (!texto || ES_RESULTADO.test(texto) || CON_NOMBRES.test(texto)) continue;
    // «Aviso de convocatoria» no es la base: que no le gane el lugar al perfil (se leen los tres primeros).
    const etiqueta = /^aviso/i.test(texto) ? "Aviso" : oracion(texto);
    for (const e of enlaces(fila, d.final)) if (/\/documento\.aspx\?vidDoc=/i.test(e.url)) docs.push({ url: e.url, texto: etiqueta });
  }
  return hallazgo(url, docs);
};

// ─── PGE: API JSON del portal de convocatorias (los PDF van en un visor con el PDF en base64) ─────────────────────

interface FilaPge { NUMERO?: string; ANIO?: string; DESCRIPCION?: string; ETP00?: string | null }

/**
 * Procuraduría General del Estado (convocas.pge.gob.pe): POST /serviceView/backendService (sp=list_convocatoria) con
 * todo el año en JSON. El número de SERVIR a veces no es el de la PGE (SERVIR 142 «Asistente legal» = PGE 143): se
 * empata por el número y el puesto (el número exacto pesa más). La etapa 0 («Detalle de la convocatoria») trae los
 * documentos iniciales (formato de convocatoria: perfil, requisitos y cronograma) y los comunicados; las etapas 1 en
 * adelante son resultados. Cada PDF se ve en /serviceView/viewPdfModalPublic?idFile=N (HTML con el PDF embebido en
 * base64: «data:application/pdf;base64,…»), que es la única URL estable (la de descarga lleva un token de 16 minutos).
 * Más las bases estándar vigentes de la portada.
 */
const pge: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://convocas.pge.gob.pe/";
  const j = await http.json<{ data?: FilaPge[] }>(`${base}serviceView/backendService`, { form: { sp: "list_convocatoria", parameters: `${anio},0,0000,00,1`, pagination: "false" } });
  const filas = (j?.data ?? []).filter((f) => Number(f.ANIO) === anio && f.ETP00);
  const fila = filas
    .map((f) => ({ f, d: Math.abs(Number(f.NUMERO) - n), s: parecidoPuesto(p.titulo, f.DESCRIPCION ?? "") }))
    .filter((x) => x.d === 0 || (x.d <= 20 && x.s >= 0.5))
    .map((x) => ({ ...x, puntaje: 2 * x.s - 0.05 * x.d + (x.d === 0 ? 0.3 : 0) }))
    .sort((a, b) => b.puntaje - a.puntaje)[0]?.f;
  if (!fila) return null;
  const docs: Enlace[] = [];
  for (const parte of (fila.ETP00 ?? "").split(",")) {
    const [tipo, titulo, id, comunicado] = parte.split("#");
    if (!id || !/^\d+$/.test(id) || (tipo !== "1" && comunicado !== "1") || NO_DOCUMENTO.test(titulo ?? "") || CON_NOMBRES.test(titulo ?? "")) continue;
    const texto = /documentos iniciales/i.test(titulo ?? "") ? "Convocatoria: perfil, requisitos y cronograma" : oracion(titulo ?? "Comunicado");
    docs.push({ url: `${base}serviceView/viewPdfModalPublic?idFile=${id}`, texto });
  }
  if (!docs.length) return null;
  // Las bases estándar vigentes: el primer enlace de la lista de bases de la portada.
  const portada = await http.get(base);
  const lista = /id="listaDeBases"[\s\S]*?<\/div>\s*<\/div>/i.exec(portada?.texto ?? "")?.[0] ?? "";
  const estandar = enlaces(lista, portada?.final ?? base).find((e) => esDocumento(e.url) && /\.pdf/i.test(e.url));
  if (estandar) docs.push({ url: estandar.url, texto: "Bases estándar del concurso CAS" });
  return hallazgo(base, docs);
};

// ─── ATU: el portal de transparencia (lista en texto con separadores) ────────────────────────────────────────────

/**
 * ATU (portal.atu.gob.pe/ConvocatoriasCAS/ es un iframe de transparencia.atu.gob.pe/pte/ConvocatoriasCas/): la lista
 * del año es un POST a /PTE/ConvocatoriasCAS/ListarConvocatorias con «2026|5» (el año y su id del combo) que devuelve
 * cabecera § filas § celdas separadas por ¬ y |. La columna «Bases» trae perfil, bases y cronograma («texto¦archivo»);
 * «Requisito de Conocimiento», el temario. Los archivos están en /PTE/filesCAS/. Dos pedidos.
 */
const atu: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const raiz = "https://transparencia.atu.gob.pe/PTE/";
  const pagina = `${raiz}ConvocatoriasCas/`;
  const inicio = await http.get(pagina);
  const ids: Record<string, string> = { 2023: "1", 2024: "3", 2025: "4", 2026: "5" };
  for (const m of (inicio?.texto ?? "").matchAll(/<option value="(\d+)">\s*(20\d{2})\s*</g)) ids[m[2]] = m[1];
  const id = ids[String(anio)];
  if (!id) return null;
  const r = await http.post(`${raiz}ConvocatoriasCAS/ListarConvocatorias`, { data: `${anio}|${id}` });
  if (!r?.texto) return null;
  const [cabecera = "", filas = "", detalle = ""] = r.texto.split("§");
  const columnas = cabecera.split("¬").map((c) => c.split("|")).filter((c) => /^\d+$/.test(c[0] ?? ""));
  const utiles = new Set(columnas.filter(([, nombre]) => /bases|requisito de conocimiento/i.test(nombre ?? "") && !/resultado/i.test(nombre ?? "")).map(([idc]) => idc));
  let mejor: { id: string; parecido: number } | null = null;
  for (const f of filas.split("¬")) {
    const [idConv, proceso = "", puesto = ""] = f.split("|");
    const m = /N\D{0,3}0*(\d+)\s*-\s*(\d{4})/i.exec(proceso);
    if (!idConv || !m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
    const parecido = parecidoPuesto(p.titulo, puesto);
    if (!mejor || parecido > mejor.parecido) mejor = { id: idConv, parecido };
  }
  if (!mejor) return null;
  const docs: Enlace[] = [];
  for (const d of detalle.split("¬")) {
    const [, idConv, idCol, valor = "", tipo] = d.split("|");
    if (idConv !== mejor.id || !utiles.has(idCol ?? "") || (tipo !== "E" && tipo !== "A")) continue;
    const [texto, archivo] = tipo === "E" ? valor.split("¦") : [nombreDeArchivo(valor), valor];
    if (!archivo || ES_RESULTADO.test(`${texto} ${archivo}`) || CON_NOMBRES.test(`${texto} ${archivo}`)) continue;
    docs.push({ url: new URL(`filesCAS/${archivo.trim()}`, raiz).toString(), texto: textoPlano(texto ?? "") || nombreDeArchivo(archivo) });
  }
  return hallazgo(pagina, docs);
};

// ─── COFOPRI: PHP con la lista por estado (vigentes, en proceso, concluidas) ────────────────────────────────────

/**
 * COFOPRI (convocatorias.cofopri.gob.pe/convocatoriasCas): la portada carga por AJAX verConvos.php?t='V'&a='2026'
 * (vigentes), 'P' (en proceso) y 'C' (concluidas). Cada proceso: «N° : 0136-2026 CONVOCATORIA … DE UN/A …» con su
 * enlace «Ver Aviso» (las bases con el perfil) y, en la cabecera, las fe de erratas. Los resultados (verResulpre.php y
 * los PDF de resultados) quedan fuera. TLS con la cadena incompleta (sólo el certificado del sitio): por el relay.
 */
const cofopri: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://convocatorias.cofopri.gob.pe/convocatoriasCas/";
  for (const estado of ["V", "P", "C"]) {
    const r = await http.get(`${base}verConvos.php?t=%27${estado}%27&a=%27${anio}%27`);
    if (!r?.texto) continue;
    let mejor: { docs: Enlace[]; parecido: number } | null = null;
    for (const bloque of r.texto.split(/class="nomcnv"/i).slice(1)) {
      const fin = bloque.search(/<\/td>/i);
      const cabecera = bloque.slice(0, fin < 0 ? 400 : fin);
      const titulo = textoPlano(cabecera);
      const m = /N\s*[°º]?\s*:\s*0*(\d+)\s*-\s*(\d{4})/i.exec(titulo);
      if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
      const docs: Enlace[] = [];
      const aviso = /<a\b[^>]*href="([^"]+)"[^>]*title="Ver Aviso"/i.exec(bloque)?.[1];
      if (aviso) docs.push({ url: new URL(aviso.replace(/&amp;/g, "&"), base).toString(), texto: "Bases y perfil del puesto" });
      for (const e of enlaces(cabecera, base)) {
        if (esDocumento(e.url) && !/verResul/i.test(e.url) && !CON_NOMBRES.test(`${e.texto} ${nombreDeArchivo(e.url)}`)) docs.push({ url: e.url, texto: e.texto || nombreDeArchivo(e.url) });
      }
      const parecido = parecidoPuesto(p.titulo, titulo);
      if (docs.length && (!mejor || parecido > mejor.parecido)) mejor = { docs, parecido };
    }
    if (mejor) return hallazgo(`${base}InicioConvocatoriasCas.php`, mejor.docs);
  }
  return null;
};

// ─── SUTRAN: la tabla del portal viejo (www2, Joomla) por http ───────────────────────────────────────────────────

/**
 * SUTRAN (www.sutran.gob.pe/cuadro-convocatorias-cas.html es un iframe de www2.sutran.gob.pe): una tabla con todas las
 * CAS («254-2026 | período | puesto | Bases | resultados… | Comunicado»). www2 tiene el TLS con la cadena incompleta,
 * pero responde por http (la tabla y los PDF): se pide por http y no hace falta el relay. Un pedido.
 */
const sutran: Adaptador = async (p, http) => {
  if (regimenDe(p.numero) !== "cas") return null;
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const url = "http://www2.sutran.gob.pe/portal/index.php/convocatorias-cas-sutran2";
  const r = await http.pedir(url, { timeoutMs: 30_000 });
  if (!r?.texto) return null;
  const tabla = /id="tblconvocatorias"[\s\S]*?<\/table>/i.exec(r.texto)?.[0] ?? r.texto;
  let mejor: { docs: Enlace[]; parecido: number } | null = null;
  for (const fila of tabla.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    const m = /^\s*0*(\d+)\s*-\s*(\d{4})/.exec(textoPlano(cs[0] ?? ""));
    if (cs.length < 4 || !m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
    const docs: Enlace[] = enlaces(cs[3], r.final).filter((e) => esDocumento(e.url)).map((e) => ({ url: e.url, texto: "Bases de la convocatoria" }));
    for (const e of enlaces(cs[8] ?? "", r.final)) {
      if (esDocumento(e.url) && !CON_NOMBRES.test(nombreDeArchivo(e.url))) docs.push({ url: e.url, texto: `Comunicado: ${nombreDeArchivo(e.url)}` });
    }
    const parecido = parecidoPuesto(p.titulo, textoPlano(cs[2] ?? ""));
    if (docs.length && (!mejor || parecido > mejor.parecido)) mejor = { docs, parecido };
  }
  return mejor ? hallazgo("https://www.sutran.gob.pe/cuadro-convocatorias-cas.html", mejor.docs) : null;
};

// ─── OSINERGMIN: SharePoint (perfil por número, bases generales por rango) ──────────────────────────────────────

const SITIO_OSINERGMIN = "https://www.osinergmin.gob.pe/seccion/institucional/oportunidadeslaborales";

/** La búsqueda de SharePoint de la lista de convocatorias (CSOM anónimo, con la plantilla segura de la página). */
export async function buscarOsinergmin(http: Parameters<Adaptador>[1], estado: string, digest: string) {
  const props = ["CodigoConvocatoriaOWSTEXT", "CargoOWSTEXT", "PerfilOWSLINK", "ListItemID"];
  const adds = props.map((x, i) => `<Method Name="Add" Id="${20 + i}" ObjectPathId="13"><Parameters><Parameter Type="String">${x}</Parameter></Parameters></Method>`).join("");
  const xml = `<Request xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009" SchemaVersion="15.0.0.0" LibraryVersion="16.0.0.0" ApplicationName="Javascript Library"><Actions><ObjectPath Id="1" ObjectPathId="0" /><SetProperty Id="2" ObjectPathId="0" Name="QueryText"><Parameter Type="String">${estado}</Parameter></SetProperty><SetProperty Id="3" ObjectPathId="0" Name="QueryTemplate"><Parameter Type="String">(contentclass:sts_listitem OR IsDocument:True) SPSiteUrl:http://wcmportal ListId:55DDA71D-E027-46C1-9434-6B15D202B750  ModalidadOWSCHCS:CAS   EstadoConvocatoriaOWSCHCS:{SearchBoxQuery}</Parameter></SetProperty><SetProperty Id="4" ObjectPathId="0" Name="RowLimit"><Parameter Type="Number">50</Parameter></SetProperty><SetProperty Id="5" ObjectPathId="0" Name="SourceId"><Parameter Type="Guid">{8413cd39-2156-4e00-b54d-11efd9abdb89}</Parameter></SetProperty><SetProperty Id="6" ObjectPathId="0" Name="SafeQueryPropertiesTemplateUrl"><Parameter Type="String">querygroup://webroot/Paginas/ConvocatoriaCAS.aspx?groupname=Default</Parameter></SetProperty><SetProperty Id="7" ObjectPathId="0" Name="IgnoreSafeQueryPropertiesTemplateUrl"><Parameter Type="Boolean">false</Parameter></SetProperty><ObjectPath Id="14" ObjectPathId="13" />${adds}<ObjectPath Id="61" ObjectPathId="60" /><Method Name="ExecuteQuery" Id="66" ObjectPathId="60"><Parameters><Parameter ObjectPathId="0" /></Parameters></Method></Actions><ObjectPaths><Constructor Id="0" TypeId="{80173281-fffd-47b6-9a49-312e06ff8428}" /><Property Id="13" ParentId="0" Name="SelectProperties" /><Constructor Id="60" TypeId="{8d2ac302-db2f-46fe-9015-872b35f15098}" /></ObjectPaths></Request>`;
  const r = await http.pedir(`${SITIO_OSINERGMIN}/_vti_bin/client.svc/ProcessQuery`, {
    cuerpo: xml, cabeceras: { "content-type": "text/xml", "x-requestdigest": digest, "x-requested-with": "XMLHttpRequest", accept: "application/json" },
  });
  const filas: Record<string, string | null>[] = [];
  try {
    for (const x of JSON.parse(r?.texto ?? "[]") as unknown[]) {
      const tablas = (x as { ResultTables?: { ResultRows?: Record<string, string | null>[] }[] })?.ResultTables;
      for (const t of tablas ?? []) filas.push(...(t.ResultRows ?? []));
    }
  } catch {
    /* sin filas */
  }
  return filas;
}

/**
 * OSINERGMIN (SharePoint): la lista y el detalle se pintan con JavaScript (búsqueda de SharePoint), pero el perfil de
 * cada proceso está en una ruta fija (/seccion/centro_documental/ResultadosSeleccionPersonal/Perfiles/CAS-075-2026.pdf;
 * el número de SERVIR es el de OSINERGMIN) y las bases son generales por rango de procesos, enlazadas en la página de
 * convocatorias CAS (estática). Se confirma el perfil con un HEAD; si no está en la ruta fija, la búsqueda de SharePoint
 * (contextinfo anónimo + ProcessQuery con la plantilla segura de la página, por estado) da el enlace y el idItem.
 */
const osinergmin: Adaptador = async (p, http) => {
  if (regimenDe(p.numero) !== "cas") return null;
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const lista = "https://www.osinergmin.gob.pe/seccion/institucional/oportunidades-laborales/convocatorias/convocatorias-cas";
  const codigo = `CAS-${pad(n, 3)}-${anio}`;
  let perfil: string | null = `https://www.osinergmin.gob.pe/seccion/centro_documental/ResultadosSeleccionPersonal/Perfiles/${codigo}.pdf`;
  let pagina = lista;
  const h = await http.pedir(perfil, { metodo: "HEAD" });
  if (!h || h.status !== 200 || !/pdf/i.test(h.tipo)) {
    perfil = null;
    const c = await http.pedir(`${SITIO_OSINERGMIN}/_api/contextinfo`, { metodo: "POST", cuerpo: "", cabeceras: { accept: "application/json;odata=verbose" } });
    const digest = /"FormDigestValue":"([^"]+)"/.exec(c?.texto ?? "")?.[1];
    for (const estado of digest ? ["Vigente", "En proceso"] : []) {
      const fila = (await buscarOsinergmin(http, estado, digest!)).find((f) => {
        const m = /0*(\d+)\s*-\s*(\d{4})/.exec(f.CodigoConvocatoriaOWSTEXT ?? "");
        return !!m && Number(m[1]) === n && Number(m[2]) === anio;
      });
      const href = /href="([^"]+)"/.exec(fila?.PerfilOWSLINK ?? "")?.[1]?.replace(/&#58;/g, ":");
      if (!fila || !href) continue;
      perfil = new URL(new URL(href).pathname, "https://www.osinergmin.gob.pe").toString();
      if (fila.ListItemID) pagina = `${lista}/detalle?idItem=${fila.ListItemID}`;
      break;
    }
  }
  if (!perfil) return null;
  const docs: Enlace[] = [{ url: perfil, texto: `Perfil del puesto ${codigo.replace(/-/, " ")}` }];
  // Las bases: las del rango que incluye el proceso o, si ninguno, las vigentes («Bases-concurso-CAS.pdf»).
  const r = await http.get(lista);
  const todas = enlaces(r?.texto ?? "", r?.final ?? lista).filter((e) => /\/ResultadosSeleccionPersonal\/Bases-concurso-CAS[^/]*\.pdf$/i.test(e.url));
  const clave = (a: number, x: number) => a * 1000 + x;
  const rango = todas.find((e) => {
    const m = /CAS-(\d+)-(\d{4})-hasta-CAS-(\d+)-(\d{4})/i.exec(e.url);
    return !!m && clave(Number(m[2]), Number(m[1])) <= clave(anio, n) && clave(anio, n) <= clave(Number(m[4]), Number(m[3]));
  });
  const vigentes = todas.find((e) => /Bases-concurso-CAS\.pdf$/i.test(e.url));
  const bases = rango ?? vigentes;
  if (bases) docs.push({ url: bases.url, texto: "Bases del concurso CAS" });
  return hallazgo(pagina, docs);
};

// ─── MINEM: API JSON del portal ConvocaMinem (archivos de Laserfiche por token) ──────────────────────────────────

interface FilaMinem {
  coD_PROCESO?: string; iD_ANO_PROCESO?: string; nombrE_PUESTO?: string; nombrE_ARCHIVO?: string | null; tokeN_LASERFICHE?: string | null;
  comunicados?: { token?: string; nombrE_ARCHIVO?: string; desC_TIPO_COMUNICADO?: string; observacion?: string; desC_FASES_CRONOGRAMA?: string }[];
}

/**
 * MINEM (pad2.minem.gob.pe/ConvocaMinem_Portal): POST /Home/Buscar con la palabra «105-2026», el año, el régimen (C =
 * CAS, S = 30057, P = prácticas) y todos los estados: JSON con el token de Laserfiche de las bases y de cada comunicado
 * (los demás tokens son resultados). Las descargas son /Laserfiche/Descargar?token=… (el token cambia en cada consulta;
 * uno de hace minutos sigue sirviendo). Un pedido.
 */
const minem: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const numero = p.numero ?? "";
  const regimen = /30057/.test(numero) ? "S" : /PRACTIC/i.test(numero) ? "P" : "C";
  const base = "https://pad2.minem.gob.pe/ConvocaMinem_Portal";
  const j = await http.json<{ ok?: boolean; data?: FilaMinem[] }>(`${base}/Home/Buscar`, { form: { Palabra: `${pad(n, 3)}-${anio}`, Anio: String(anio), Regimen: regimen, Estado: "%", Pagina: "1" } });
  const fila = (j?.data ?? [])
    .filter((f) => Number(f.coD_PROCESO) === n && Number(f.iD_ANO_PROCESO) === anio)
    .sort((a, b) => parecidoPuesto(p.titulo, b.nombrE_PUESTO ?? "") - parecidoPuesto(p.titulo, a.nombrE_PUESTO ?? ""))[0];
  if (!fila) return null;
  const descarga = (token: string) => `${base}/Laserfiche/Descargar?token=${encodeURIComponent(token)}`;
  const docs: Enlace[] = [];
  if (fila.tokeN_LASERFICHE) docs.push({ url: descarga(fila.tokeN_LASERFICHE), texto: "Bases de la convocatoria" });
  for (const c of fila.comunicados ?? []) {
    const texto = [c.desC_TIPO_COMUNICADO, c.observacion].filter(Boolean).join(": ") || c.nombrE_ARCHIVO || "Comunicado";
    if (c.token && !CON_NOMBRES.test(`${c.desC_TIPO_COMUNICADO ?? ""} ${c.observacion ?? ""} ${c.nombrE_ARCHIVO ?? ""}`)) docs.push({ url: descarga(c.token), texto: `Comunicado (${texto})` });
  }
  return hallazgo(base, docs);
};

// ─── SENAMHI: la grilla por AJAX (PHP) ────────────────────────────────────────────────────────────────────────────

/**
 * SENAMHI (www.senamhi.gob.pe/?p=convocatorias): la grilla sale de un POST a /include/_convocatorias_lista_varias_bases.php
 * (a = año, e = cas | 728 | 276 | all) con una fila por proceso: «CASV 080-2026 | puesto | DR LORETO | publicación | cierre
 * | Bases (include/convocatorias_ver.php?ide_convo=N, un PDF) | formato | Anexos | resultados (convocatorias_verResp.php)».
 * Las segundas convocatorias («2DA CASV 056-2026») repiten el número: la de fecha más cercana. Un pedido.
 */
const senamhi: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const reg = regimenDe(p.numero);
  const tipo = reg === "cas" ? "cas" : reg === "276" ? "276" : reg === "728" ? "728" : "all";
  const r = await http.pedir("https://www.senamhi.gob.pe/include/_convocatorias_lista_varias_bases.php", { form: { a: String(anio), e: tipo }, timeoutMs: 30_000 });
  if (!r?.texto) return null;
  const base = "https://www.senamhi.gob.pe/";
  const depto = departamento(p);
  let mejor: { docs: Enlace[]; puntaje: number } | null = null;
  for (const fila of r.texto.split(/<tr>/i).slice(1)) {
    const texto = textoPlano(fila);
    const m = /^\s*(?:\d\s*(?:DA|RA|TA)\s+)?[A-Z]{2,6}\s*0*(\d+)\s*-\s*(\d{4})/i.exec(texto);
    if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
    const docs: Enlace[] = [];
    for (const e of enlaces(fila, base)) {
      if (/\/include\/convocatorias_ver\.php\?ide_convo=\d+/i.test(e.url)) docs.push({ url: e.url, texto: "Bases de la convocatoria" });
      else if (/\/pdf\/anexo-conv\//i.test(e.url)) docs.push({ url: e.url, texto: "Anexos de la convocatoria" });
    }
    if (!docs.length) continue;
    const fecha = isoDe(texto.match(/\d{2}\/\d{2}\/\d{4}/)?.[0]);
    let puntaje = 3 * parecidoPuesto(p.titulo, texto) + (depto.length >= 3 && normalizar(texto).includes(depto) ? 1 : 0);
    if (fecha && p.fecha_inicio) puntaje -= Math.min(2, Math.abs(dias(fecha, p.fecha_inicio)) / 15);
    if (!mejor || puntaje > mejor.puntaje) mejor = { docs, puntaje };
  }
  return mejor ? hallazgo(`${base}?p=convocatorias`, mejor.docs) : null;
};

// ─── MINAM: WordPress (una entrada por proceso, con la sección «Convocatoria») ───────────────────────────────────

/**
 * MINAM (www.minam.gob.pe/convocatorias/): la lista (unas 50 por página) enlaza «CAS 081-2026-MINAM – CONVOCATORIA EN
 * LÍNEA»; las segundas convocatorias van como «CAS 061-II-2026». La entrada tiene su fecha y, bajo «Convocatoria», las
 * bases del grupo y el TDR del puesto. Se prueba la primera página y luego la segunda; con varias rondas, la de fecha
 * más cercana a la publicación de SERVIR (sin pasarse).
 */
const minam: Adaptador = async (p, http) => {
  if (regimenDe(p.numero) !== "cas") return null;
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const re = new RegExp(`\\bcas\\s*0*${n}\\s*-\\s*(?:(i{1,3}|iv|v)\\s*-\\s*)?${anio}\\b`, "i");
  let candidatos: Enlace[] = [];
  for (const url of ["https://www.minam.gob.pe/convocatorias/", "https://www.minam.gob.pe/convocatorias/page/2/"]) {
    const r = await http.get(url);
    if (!r?.texto) break;
    candidatos = enlaces(r.texto, r.final).filter((e) => /\/convocatorias\/[^/]+\/?$/i.test(e.url) && re.test(e.texto));
    if (candidatos.length) break;
  }
  let mejor: { url: string; docs: Enlace[]; d: number } | null = null;
  for (const c of candidatos.slice(0, 2)) {
    const d = await http.get(c.url);
    if (!d?.texto) continue;
    const fecha = /<span id="fecha">(\d{4}-\d{2}-\d{2})<\/span>/i.exec(d.texto)?.[1] ?? null;
    const seccion = /<h3>\s*Convocatoria\s*<\/h3>([\s\S]*?)(?:<h[34]\b|<\/div>)/i.exec(d.texto)?.[1] ?? "";
    const docs = enlaces(seccion, d.final)
      .filter((e) => esDocumento(e.url) && !CON_NOMBRES.test(`${e.texto} ${nombreDeArchivo(e.url)}`))
      .map((e) => ({ url: e.url.replace(/^http:\/\/www\.minam\.gob\.pe\//i, "https://www.minam.gob.pe/"), texto: /^TDR/i.test(nombreDeArchivo(e.url)) ? `Términos de referencia (${nombreDeArchivo(e.url)})` : /^BASES/i.test(nombreDeArchivo(e.url)) ? `Bases (${nombreDeArchivo(e.url)})` : e.texto || nombreDeArchivo(e.url) }));
    if (!docs.length) continue;
    const dd = fecha && p.fecha_inicio ? dias(fecha, p.fecha_inicio) : 0;
    const distancia = dd < -5 ? 1000 + Math.abs(dd) : Math.abs(dd);
    if (!mejor || distancia < mejor.d) mejor = { url: c.url, docs, d: distancia };
  }
  return mejor ? hallazgo(mejor.url, mejor.docs) : null;
};

// ─── El registro ─────────────────────────────────────────────────────────────────────────────────────────────────

export const ADAPTADORES_NACIONALES: Record<string, Adaptador> = {
  "www.inpe.gob.pe": inpe,
  "inpe.gob.pe": inpe,
  "oportunidadeslaborales.indecopi.gob.pe": indecopi,
  "www.smv.gob.pe": smv,
  "convocas.pge.gob.pe": pge,
  "portal.atu.gob.pe": atu,
  "transparencia.atu.gob.pe": atu,
  "convocatorias.cofopri.gob.pe": cofopri,
  "www.sutran.gob.pe": sutran,
  "www2.sutran.gob.pe": sutran,
  "www.osinergmin.gob.pe": osinergmin,
  "pad2.minem.gob.pe": minem,
  "www.senamhi.gob.pe": senamhi,
  "www.minam.gob.pe": minam,
};

