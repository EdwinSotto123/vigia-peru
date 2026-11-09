/**
 * Adaptadores de la ola 2 (sector salud): INEN, HR Ayacucho, Red de Salud Huamanga, Hospital Demarini (La Merced),
 * HR Hermilio Valdizán (Huánuco), Hospital Daniel A. Carrión (Huancayo), Red de Salud Otuzco, Red de Salud Huaylas Norte,
 * DIRESA Huánuco, Hospital de Ventanilla y Hospital Dos de Mayo. Medidos el 2026-11-09 desde Lima.
 *
 * Reglas de todos: pocos pedidos (2 a 3 por plaza), sin captchas ni cuentas, y nunca los resultados (aptos, puntajes,
 * horarios de entrevista, cuadros de méritos): tienen nombres y DNI.
 */
import {
  anioDe, celdas, fechaEs, hallazgo, nombreDeArchivo, regimenDe, textoPlano, type Adaptador,
} from "../empleoAdaptadores.js";
import {
  enlaces, esDocumento, normalizar, numeroProceso, palabrasPuesto, type Enlace, type PlazaParaBases,
} from "../basesPlaza.js";

// ─── Lo común ─────────────────────────────────────────────────────────────────────────────────────

const pad = (n: number, largo: number) => String(n).padStart(largo, "0");

/** Días entre dos fechas ISO (b - a). */
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Si una fecha ISO de la entidad cae cerca de la publicación en SERVIR (hasta `antes` días antes y `despues` después). */
const cerca = (fecha: string | null | undefined, p: PlazaParaBases, antes = 60, despues = 15) => {
  if (!fecha || !p.fecha_inicio) return true;
  const d = dias(fecha, p.fecha_inicio);
  return d <= antes && d >= -despues;
};

/** Qué tan lejos (en días, sin signo) está una fecha de la publicación de SERVIR (para desempatar). */
const distancia = (fecha: string | null | undefined, p: PlazaParaBases) => (fecha && p.fecha_inicio ? Math.abs(dias(fecha, p.fecha_inicio)) : 9_999);

/** El texto plano, con las letras «de adorno» (𝐂𝐀𝐒, 𝗖𝗔𝗦) como letras comunes y los guiones largos como «-». */
const plano = (html: string) => textoPlano(html).normalize("NFKC").replace(/[–—]/g, "-");

/** «N° 005-2026», «Nº 001 – 2026», «N.º 006-2026», «CAS-REG-005-2026» → { n, anio }. */
function numeroDe(texto: string): { n: number; anio: number } | null {
  const t = plano(texto);
  const m = /N\s*[.°ºo]*\s*[°º]?\s*0*(\d{1,4})\s*-\s*(20\d{2})/i.exec(t) ?? /(?<![0-9])0*(\d{1,4})\s*-\s*(20\d{2})(?![0-9])/.exec(t);
  return m ? { n: Number(m[1]), anio: Number(m[2]) } : null;
}
const esEl = (texto: string, n: number, anio: number) => {
  const x = numeroDe(texto);
  return !!x && x.n === n && x.anio === anio;
};

/** Lo que no son bases: resultados, listas de aptos, horarios de entrevista, actas, reclamos (con nombres y DNI). */
const NO_BASES = /resultad|apto|ganador|m[eé]rito|puntaje|preliminar|calificaci|entrevista|horario|relaci[oó]n de postulantes|postulantes|reclamo|absoluci|reconsideraci|\bactas?\b|evaluaci|declarad|listado|lista de/i;
/** Si el documento no es de resultados. Un «Acta de fe de erratas» sí va (corrige las bases); una fe de erratas de resultados, no. */
function sinResultados(t: string): boolean {
  const x = plano(t);
  if (/errata/i.test(x) && !/resultad|apto|ganador|m[eé]rito|puntaje|calificaci|entrevista/i.test(x)) return true;
  return !NO_BASES.test(x);
}

/** El texto de un encabezado a partir del pedazo que sigue a «<h3»: lo que hay entre el «>» y el «</h3>». */
function encabezado(pedazo: string, etiqueta: string): string {
  const fin = pedazo.search(new RegExp(`</${etiqueta}>`, "i"));
  const inicio = pedazo.indexOf(">");
  return fin > inicio && inicio >= 0 ? plano(pedazo.slice(inicio + 1, fin)) : "";
}

/** «30-10-26» (dd-mm-aa) → «2026-10-30». */
const ddmmaa = (t: string | undefined) => {
  const m = /(\d{2})-(\d{2})-(\d{2})\b/.exec(t ?? "");
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
};

/** «dd-mm-aaaa» o «dd/mm/aaaa» en un texto → ISO. */
const fechaNumerica = (t: string) => fechaEs(t.replace(/(\d{1,2})-(\d{1,2})-(\d{4})/, "$1/$2/$3"));

/** El régimen pedido por SERVIR contra el título de la entidad: una plaza CAS no es una 276 y al revés. */
function mismoRegimen(p: PlazaParaBases, titulo: string): boolean {
  const t = plano(titulo);
  // Ni locación, ni prácticas, ni SERUMS, ni los concursos internos (ascenso, nombramiento, reasignación), ni concesiones.
  if (/locaci[oó]n|pr[aá]cticas|serums|ascenso|nombramiento|reasignaci|grupo ocupacional|concesi[oó]n/i.test(t)) return false;
  const cas = /\bCAS\b|1057/i.test(t);
  const r = regimenDe(p.numero);
  if (r === "cas") return cas;
  if (r === "276") return !cas && /276|plazo fijo|provisi[oó]n|concurso p[uú]blico/i.test(t);
  if (r === "728") return !cas && /728/.test(t);
  return !cas;
}

/**
 * Los perfiles (uno por puesto) que corresponden al puesto de SERVIR: los que tienen sus palabras («MEDICO» → los tres
 * «MEDICO», no «MEDICO RADIOLOGO»). Con menos de la mitad de las palabras, ninguno.
 */
function perfilesDelPuesto<T extends { nombre: string }>(titulo: string | null, xs: T[], max = 3): T[] {
  const ws = palabrasPuesto((titulo ?? "").replace(/\uFFFD/g, ""));
  if (!ws.length || !xs.length) return [];
  const igual = (a: string, b: string) => a.startsWith(b.slice(0, 6)) || b.startsWith(a.slice(0, 6));
  const puntuados = xs.map((x, i) => {
    const wx = palabrasPuesto(plano(x.nombre).replace(/[^\x20-\x7EÀ-ÿ]/g, " "));
    const comunes = ws.filter((w) => wx.some((v) => igual(v, w))).length;
    const sobran = wx.filter((v) => !ws.some((w) => igual(v, w))).length;
    return { x, i, s: comunes / ws.length - 0.01 * sobran };
  });
  const mejor = Math.max(...puntuados.map((p) => p.s));
  if (!(mejor >= 0.5)) return [];
  return puntuados.filter((p) => p.s >= mejor - 1e-9).sort((a, b) => a.i - b.i).slice(0, max).map((p) => p.x);
}

/** Un JSON que puede venir con BOM (el INEN). */
function jsonDe<T>(texto: string | undefined): T | null {
  try {
    return JSON.parse((texto ?? "").replace(/^\uFEFF/, "")) as T;
  } catch {
    return null;
  }
}

/** Los atributos de un HTML a texto (con las entidades hexadecimales «&#xBA;» que `enlaces` no conoce). */
const atributo = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&").trim();

// ─── INEN: la grilla en JSON de plataforma.inen.sld.pe ───────────────────────────────────────────

/**
 * INEN (plataforma.inen.sld.pe/sistemas/CAS/CAS1.php): la grilla se llena con server/convoctoria.php?accion=listar&ano=
 * (JSON con BOM). Una fila por proceso: REG19 «213-2026», REG2 el PDF de la convocatoria (perfil y cronograma), REG13 la
 * última etapa (resultados: fuera). Las bases estándar del año están en CAS1.php («… CAS 045-2026 en adelante»).
 */
const inen: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://plataforma.inen.sld.pe/sistemas/CAS/";
  const r = await http.pedir(`${base}server/convoctoria.php?accion=listar&ano=${anio}`, { timeoutMs: 30_000 });
  const filas = jsonDe<Record<string, string>[]>(r?.texto);
  if (!Array.isArray(filas)) return null;
  // El número de SERVIR a veces no es el del INEN («SUPLENCIA-1» no es el CAS 001 de enero): la fecha tiene que estar cerca.
  const fila = filas.find((f) => {
    const m = /^\s*0*(\d+)\s*-\s*(\d{4})/.exec(f.REG19 ?? "");
    return !!m && Number(m[1]) === n && Number(m[2]) === anio && cerca(ddmmaa(f.REG18 || f.REG9), p, 45, 10);
  });
  if (!fila?.REG2) return null;
  const docs: Enlace[] = [{ url: new URL(`archivos/${fila.REG2}`, base).toString(), texto: `Convocatoria CAS ${fila.REG19}: ${textoPlano(fila.REG6 ?? "")}` }];
  const portada = await http.get(`${base}CAS1.php`);
  for (const e of enlaces(portada?.texto ?? "", portada?.final ?? base)) {
    const t = normalizar(e.texto);
    const desde = /bases estandar del proceso cas 0*(\d+) (\d{4}) en adelante/.exec(t);
    const hasta = /bases estandar para los procesos cas .*hasta el cas 0*(\d+) (\d{4})/.exec(t);
    if ((desde && Number(desde[2]) === anio && n >= Number(desde[1])) || (hasta && Number(hasta[2]) === anio && n <= Number(hasta[1]))) {
      docs.push({ url: e.url, texto: e.texto });
    }
  }
  return hallazgo(`${base}CAS1.php`, docs);
};

// ─── Hospital Regional de Ayacucho: DataTable con su JSON ────────────────────────────────────────

/**
 * HR Ayacucho (app.hrayacucho.gob.pe/sistema/view/convocatoria): la lista en /View/getConvocatoria («PROCESO CAS Nº
 * 001-2026-HRA (NECESIDADES TRANSITORIAS)») y los enlaces de cada proceso en /View/getConvocatori/{id} (pdf_basesNN y
 * pdf_comunicadoNN, en Drive). Las columnas curricular, entrevista y resultado no se tocan. Certificado vencido.
 */
const hrAyacucho: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://app.hrayacucho.gob.pe/sistema";
  const lista = await http.json<{ idconvocm: string; convocatoria: string }[]>(`${base}/View/getConvocatoria`);
  if (!Array.isArray(lista)) return null;
  const tipo = /SUPLENCIA/i.test(p.numero ?? "") ? /SUPLENCIA/i : /TRANSITORI|TEMPORAL|DETERMINADO/i;
  const elegido = lista
    .map((c) => ({ c, t: plano(c.convocatoria ?? "") }))
    .filter(({ t }) => esEl(t, n, anio) && mismoRegimen(p, t))
    .sort((a, b) => Number(tipo.test(b.t)) - Number(tipo.test(a.t)) || Number(b.c.idconvocm) - Number(a.c.idconvocm))[0];
  if (!elegido) return null;
  const d = await http.json<{ status?: boolean; data?: Record<string, string> }>(`${base}/View/getConvocatori/${elegido.c.idconvocm}`);
  const data = d?.data;
  if (!data) return null;
  const docs: Enlace[] = [];
  for (const etapa of ["bases", "comunicado"]) {
    for (let i = 1; i <= 9; i++) {
      const url = (data[`pdf_${etapa}${pad(i, 2)}`] ?? "").trim();
      const nombre = textoPlano(data[`det_${etapa}${pad(i, 2)}`] ?? "").replace(/\.(pdf|word|excel|docx?|xlsx?)$/i, "").trim();
      if (!url || !esDocumento(url) || !sinResultados(nombre)) continue;
      docs.push({ url, texto: nombre || (etapa === "bases" ? "Bases" : "Comunicado") });
    }
  }
  return hallazgo(`${base}/view/convocatoria`, docs);
};

// ─── Red de Salud Huamanga: una tabla de WordPress por régimen ───────────────────────────────────

/**
 * Red de Salud Huamanga (/convocatorias/): tablas «Convocatoria | Bases / Cronograma y Anexos | Fe de erratas |
 * Comunicados | Evaluación | Resultados finales | Estado», con las de años anteriores en la misma página. Sólo las tres
 * primeras columnas de documentos; si el número se repite («CAS N° 002 – 2026 (Anulado)» y el relanzado), el no anulado.
 */
const saludHuamanga: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const url = "https://redsaludhuamanga.pe/convocatorias/";
  const r = await http.pedir(url, { timeoutMs: 30_000 });
  if (!r?.texto) return null;
  const candidatos: { cs: string[]; anulado: boolean; regimen: boolean; fecha: string | null; i: number }[] = [];
  for (const [i, fila] of r.texto.split(/<tr\b/i).slice(1).entries()) {
    const cs = celdas(fila);
    if (cs.length < 4) continue;
    const titulo = plano(cs[0]);
    if (!esEl(titulo, n, anio) || !mismoRegimen(p, titulo)) continue;
    // La fecha: la primera «(03-11-2026 Hora: 17:00)» de la fila (al lado de las bases o de las fe de erratas).
    const fecha = fechaNumerica(plano(cs.slice(1).join(" ")));
    candidatos.push({ cs, anulado: /anulad/i.test(titulo), regimen: /\b(276|728)\b/.test(titulo), fecha, i });
  }
  const elegido = candidatos.sort((a, b) => Number(a.anulado) - Number(b.anulado) || Number(b.regimen) - Number(a.regimen)
    || distancia(a.fecha, p) - distancia(b.fecha, p) || b.i - a.i)[0];
  if (!elegido) return null;
  const docs: Enlace[] = [];
  const porDefecto = ["", "Bases, cronograma y anexos", "Fe de erratas", "Comunicado"];
  for (const k of [1, 2, 3]) {
    for (const e of enlaces(elegido.cs[k] ?? "", r.final)) {
      const t = plano(e.texto);
      if (!esDocumento(e.url) || !sinResultados(t)) continue;
      docs.push({ url: e.url, texto: !t || /^descargar$/i.test(t) ? porDefecto[k] : t });
    }
  }
  return hallazgo(url, docs);
};

// ─── Hospital Demarini (La Merced): una página por convocatoria («Quinta convocatoria 2026») ──────

const ORDINALES = ["", "primera", "segunda", "tercera", "cuarta", "quinta", "sexta", "septima|setima", "octava", "novena", "decima",
  "decima primera|undecima|onceava", "decima segunda|duodecima|doceava", "decima tercera", "decima cuarta", "decima quinta"];

/**
 * Hospital Demarini (hdemarini.gob.pe/convocatorias-2026/): botones con title «QUINTA CONVOCATORIA 2026» o «CAS SUPLENCIA
 * N° 001-2026»; la página de cada una trae sus documentos (bases, anexos, resolución, fe de erratas). El CAS N se busca
 * por su número o por el ordinal; la suplencia por su número, y si no tiene página propia, la convocatoria N del año
 * (SERVIR publicó «SUPLENCIA-005» el mismo día que el CAS 005-2026). El sitio tiene spam inyectado: sólo el contenido.
 */
const hdemarini: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null || regimenDe(p.numero) !== "cas") return null;
  const anio = anioDe(p);
  const r = await http.get(`https://hdemarini.gob.pe/convocatorias-${anio}/`);
  if (!r?.texto) return null;
  const botones = [...r.texto.matchAll(/<a\b[^>]*>/gi)].map((m) => ({
    href: /\bhref="([^"]+)"/i.exec(m[0])?.[1] ?? "",
    titulo: normalizar(plano(/\btitle="([^"]*)"/i.exec(m[0])?.[1] ?? "")),
  })).filter((b) => b.href && /convocatoria|suplencia/.test(b.titulo));
  const conNumero = (b: { titulo: string }) => new RegExp(`(?<![0-9])0*${n} ${anio}\\b`).test(b.titulo);
  const ord = ORDINALES[n];
  const porSuplencia = botones.find((b) => /suplencia/.test(b.titulo) && conNumero(b));
  const porNumero = botones.find((b) => /\bcas\b/.test(b.titulo) && !/suplencia/.test(b.titulo) && conNumero(b));
  const porOrdinal = ord ? botones.find((b) => new RegExp(`^(?:${ord}) convocatoria`).test(b.titulo) && !/suplencia/.test(b.titulo)) : undefined;
  const suplencia = /SUPLENCIA/i.test(p.numero ?? "");
  const boton = suplencia ? (porSuplencia ?? porNumero ?? porOrdinal) : (porNumero ?? porOrdinal);
  if (!boton) return null;
  const pagina = new URL(boton.href, r.final).toString();
  const d = await http.get(pagina);
  if (!d?.texto) return null;
  const inicio = d.texto.search(/<div class="vce/i);
  const fin = d.texto.indexOf("Entradas recientes", Math.max(0, inicio));
  const contenido = d.texto.slice(Math.max(0, inicio), fin > inicio ? fin : undefined);
  const docs = enlaces(contenido, d.final)
    .filter((e) => esDocumento(e.url) && /hdemarini\.gob\.pe\/wp-content\/uploads\//i.test(e.url))
    .map((e) => ({ url: e.url, texto: plano(e.texto) || nombreDeArchivo(e.url) }))
    .filter((e) => sinResultados(e.texto) && sinResultados(nombreDeArchivo(e.url)));
  // Que sean de estos días (la carpeta del mes de WordPress): una convocatoria vieja con el mismo ordinal no sirve.
  const meses = docs.map((e) => /\/uploads\/(\d{4})\/(\d{2})\//.exec(e.url)).filter((m): m is RegExpExecArray => !!m).map((m) => `${m[1]}-${m[2]}-15`);
  if (meses.length && !meses.some((f) => cerca(f, p, 75, 30))) return null;
  return hallazgo(pagina, docs);
};

// ─── Hospital Regional Hermilio Valdizán (Huánuco): Django con fases ─────────────────────────────

const MESES_CORTOS: Record<string, string> = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", set: "09", oct: "10", nov: "11", dic: "12" };
/** «Nov. 6, 2026» → «2026-11-06». */
const fechaCorta = (t: string) => {
  const m = /([a-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/i.exec(t);
  const mes = m ? MESES_CORTOS[m[1].toLowerCase()] : undefined;
  return m && mes ? `${m[3]}-${mes}-${m[2].padStart(2, "0")}` : null;
};

/**
 * HR Hermilio Valdizán (/convocatoria/convocatoria_list/): una tabla por año con «… CAS A PLAZO DETERMINADO N°006-2026» y
 * su /convocatoria/detalle/{id}/. En la ficha, una sección por fase (<h5>): de «Base y Cronograma» van las bases y anexos
 * y, de las plazas (un PDF por puesto), sólo el perfil del puesto de SERVIR. Las fases de resultados, fuera.
 */
const hrhvm: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://www.hrhvm.gob.pe";
  const r = await http.get(`${base}/convocatoria/convocatoria_list/`);
  if (!r?.texto) return null;
  const candidatos: { url: string; fecha: string | null }[] = [];
  for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    if (cs.length < 5) continue;
    const nombre = plano(cs[1]);
    const href = /href="([^"]*\/convocatoria\/detalle\/\d+\/?)"/i.exec(fila)?.[1];
    if (!href || !esEl(nombre, n, anio) || !mismoRegimen(p, nombre)) continue;
    candidatos.push({ url: new URL(href, r.final).toString(), fecha: fechaCorta(plano(cs[2])) });
  }
  const elegido = candidatos.sort((a, b) => distancia(a.fecha, p) - distancia(b.fecha, p))[0];
  if (!elegido) return null;
  const d = await http.get(elegido.url);
  if (!d?.texto) return null;
  const generales: Enlace[] = [];
  const plazas: { nombre: string; docs: Enlace[] }[] = [];
  for (const fase of d.texto.split(/<h5\b/i).slice(1)) {
    const titulo = encabezado(fase, "h5");
    if (!/base|cronograma|comunicado|errata|perfil/i.test(titulo) || /resultado|evaluaci|absoluci|reclamo|entrevista|apto/i.test(titulo)) continue;
    let seccion = "";
    for (const fila of fase.split(/<tr\b/i).slice(1)) {
      const cs = celdas(fila);
      if (cs.length === 1) {
        seccion = plano(cs[0]);
        continue;
      }
      const nombre = plano(cs[1] ?? "");
      const docs = enlaces(cs.slice(2).join(" "), d.final).filter((e) => esDocumento(e.url));
      if (!docs.length || !sinResultados(nombre)) continue;
      if (/plaza|perfil|puesto/i.test(seccion)) plazas.push({ nombre, docs });
      else for (const e of docs) generales.push({ url: e.url, texto: nombre || nombreDeArchivo(e.url) });
    }
  }
  const perfiles = perfilesDelPuesto(p.titulo, plazas).flatMap((x) => x.docs.map((e) => ({ url: e.url, texto: `Perfil del puesto: ${x.nombre}` })));
  return hallazgo(elegido.url, [...generales, ...perfiles]);
};

// ─── Hospital Daniel Alcides Carrión (Huancayo): una tabla por año ───────────────────────────────

/**
 * Hospital Daniel A. Carrión (hdachyo.gob.pe/index.php/gestion/convocatoria-personal): una tabla por año, una fila por
 * proceso («PROCESO CAS N° 003-2026-HNC-DAC», «CONCURSO DE PROVISION ABIERTO N° 002-2026-HNC-DAC» para la 276) con sus
 * enlaces a Drive en la segunda celda; de ahí, todo menos resultados, actas y reclamos.
 */
const hdachyo: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const url = "https://hdachyo.gob.pe/index.php/gestion/convocatoria-personal";
  const r = await http.get(url);
  if (!r?.texto) return null;
  for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    if (cs.length < 2) continue;
    const titulo = plano(cs[0]);
    if (!esEl(titulo, n, anio) || !mismoRegimen(p, titulo) || /ascenso|reasignaci|nombramiento|locaci|grupo ocupacional/i.test(titulo)) continue;
    const docs = enlaces(cs[1], r.final)
      .filter((e) => esDocumento(e.url) && sinResultados(e.texto))
      .map((e) => ({ url: e.url, texto: plano(e.texto) || "Documento del proceso" }));
    const h = hallazgo(url, docs);
    if (h) return h;
  }
  return null;
};

// ─── Red de Salud Otuzco: una tabla por convocatoria (con <caption>) ─────────────────────────────

/**
 * Red de Salud Otuzco (/cas-2026/, /plazo-fijo-2026/, /suplencia-2026/): pestañas con una tabla por convocatoria; el
 * <caption> dice «CONVOCATORIA PÚBLICA N.º 006-2026 …» y cada fila «etapa | Descargar». Fuera los resultados, la
 * absolución de reclamos, los horarios y la resolución que conforma el comité.
 */
const otuzco: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const base = "https://www.reddesaludotuzco.gob.pe";
  const paginas = regimenDe(p.numero) === "cas" ? [`cas-${anio}`] : [`plazo-fijo-${anio}`, `suplencia-${anio}`];
  for (const pagina of paginas) {
    const r = await http.get(`${base}/${pagina}/`);
    if (!r?.texto) continue;
    for (const tabla of r.texto.split(/<table\b/i).slice(1)) {
      const titulo = plano(/<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(tabla)?.[1] ?? "");
      if (!esEl(titulo, n, anio)) continue;
      const docs: Enlace[] = [];
      for (const fila of tabla.split(/<tr\b/i).slice(1)) {
        const cs = celdas(fila);
        if (cs.length < 2) continue;
        const etapa = plano(cs[0]);
        if (!etapa || !sinResultados(etapa) || /comit[eé]/i.test(etapa)) continue;
        for (const e of enlaces(cs[1], r.final)) if (esDocumento(e.url)) docs.push({ url: e.url, texto: etapa });
      }
      const h = hallazgo(`${base}/${pagina}/`, docs);
      if (h) return h;
    }
  }
  return null;
};

// ─── Red de Salud Huaylas Norte: una página por concurso CAS ─────────────────────────────────────

/**
 * Red de Salud Huaylas Norte: la portada tiene una tarjeta por concurso («Concurso CAS 2026 II · CAS N°002-2026-RSHN» →
 * /cas-2026-iI); en la página, «I. ASPECTO LEGAL» (bases, fe de erratas) y «III. COMUNICADOS»; «II. DESARROLLO DEL
 * PROCESO» son resultados. (El 2026-11-09 sólo había CAS 001 y 002 de 2026: las plazas «-004» de SERVIR no estaban.)
 */
const huaylasNorte: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null || regimenDe(p.numero) !== "cas") return null;
  const anio = anioDe(p);
  const base = "https://redsaludhuaylasnorte.gob.pe/";
  const r = await http.get(base);
  if (!r?.texto) return null;
  let pagina: string | null = null;
  for (const tarjeta of r.texto.split(/<h2\b/i).slice(1)) {
    const href = /href="([^"]*\/cas-\d{4}[^"]*)"/i.exec(tarjeta)?.[1];
    if (href && /\bCAS\b/i.test(plano(tarjeta)) && esEl(plano(tarjeta), n, anio)) {
      pagina = new URL(href, r.final).toString();
      break;
    }
  }
  if (!pagina) return null;
  const d = await http.get(pagina);
  if (!d?.texto) return null;
  const docs: Enlace[] = [];
  for (const seccion of d.texto.split(/<h2\b/i).slice(1)) {
    const titulo = encabezado(seccion, "h2");
    if (!/aspecto legal|comunicado/i.test(titulo)) continue;
    for (const bloque of seccion.split(/<h3\b/i).slice(1)) {
      const nombre = encabezado(bloque, "h3");
      if (!sinResultados(nombre)) continue;
      for (const e of enlaces(bloque, d.final)) if (esDocumento(e.url)) docs.push({ url: e.url, texto: nombre || "Documento del proceso" });
    }
  }
  return hallazgo(pagina, docs);
};

// ─── DIRESA Huánuco: la API JSON de sistemas.diresahuanuco.gob.pe ────────────────────────────────

interface ConvocatoriaDiresa {
  id: string;
  codigo?: string;
  titulo_convocatoria?: string;
  fecha_publicacion?: string;
  documentos?: { detalle?: { titulo?: string; url?: string; tipo_documento?: string }[] };
}

/**
 * DIRESA Huánuco (recursoshumanos.diresahuanuco.gob.pe, Next.js sin HTML en el servidor): la lista sale de
 * sistemas.diresahuanuco.gob.pe/Api/get_convocatoria.php?tipo=CAS|DL 276|DL 728 con «CAS-REG-005-2026» y sus documentos
 * (los resultados vienen aparte y no se leen). El «Perfil del puesto» apunta a la publicación de gob.pe, que tiene un PDF
 * por puesto («cod-airhsp-001171-medico-especialista-…»): de ahí, el del puesto de SERVIR.
 */
const diresaHuanuco: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null) return null;
  const anio = anioDe(p);
  const r = regimenDe(p.numero);
  const tipo = r === "cas" ? "CAS" : r === "276" ? "DL 276" : r === "728" ? "DL 728" : null;
  if (!tipo) return null;
  const j = await http.json<{ data?: ConvocatoriaDiresa[] }>(`https://sistemas.diresahuanuco.gob.pe/Api/get_convocatoria.php?tipo=${encodeURIComponent(tipo)}`);
  const c = (j?.data ?? [])
    .filter((x) => {
      const m = /0*(\d+)\s*-\s*(20\d{2})\s*$/.exec(x.codigo ?? "");
      return m ? Number(m[1]) === n && Number(m[2]) === anio : esEl(x.titulo_convocatoria ?? "", n, anio);
    })
    .sort((a, b) => distancia(a.fecha_publicacion, p) - distancia(b.fecha_publicacion, p))[0];
  if (!c) return null;
  const pagina = `https://recursoshumanos.diresahuanuco.gob.pe/convocatorias/${tipo === "CAS" ? "cas" : tipo === "DL 276" ? "dl-276" : "dl-728"}/`;
  const docs: Enlace[] = [];
  let publicacion: string | null = null;
  for (const x of c.documentos?.detalle ?? []) {
    const url = (x.url ?? "").trim();
    const nombre = plano(x.titulo ?? "") || x.tipo_documento || "Documento";
    if (!url || !sinResultados(nombre)) continue;
    if (esDocumento(url)) docs.push({ url, texto: nombre });
    else if (/^https:\/\/www\.gob\.pe\//i.test(url) && /perfil/i.test(`${nombre} ${x.tipo_documento ?? ""}`)) publicacion = url;
  }
  if (publicacion) {
    const g = await http.get(publicacion);
    const ya = new Set(docs.map((x) => x.url.split("?")[0]));
    const otros = enlaces(g?.texto ?? "", g?.final ?? publicacion)
      .filter((e) => /cdn\.www\.gob\.pe\/uploads\/document\/file\//i.test(e.url) && !ya.has(e.url.split("?")[0]))
      .map((e) => ({ url: e.url, nombre: nombreDeArchivo(e.url).replace(/^\d+-/, "").replace(/-/g, " ") }))
      .filter((x) => sinResultados(x.nombre));
    for (const x of perfilesDelPuesto(p.titulo, otros)) docs.push({ url: x.url, texto: `Perfil del puesto: ${x.nombre}` });
  }
  return hallazgo(pagina, docs);
};

// ─── Hospital de Ventanilla: una tabla PHP ───────────────────────────────────────────────────────

/**
 * Hospital de Ventanilla (/convocatorias-cas/): «N° Convocatoria | Postular | Estado | Bases | Evaluación | Resultados |
 * Comunicados»; las bases y los comunicados (sin los recursos de reconsideración). Evaluación y resultados, nunca.
 */
const ventanilla: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null || regimenDe(p.numero) !== "cas") return null;
  const anio = anioDe(p);
  const url = "https://hospitaldeventanilla.gob.pe/convocatorias-cas/";
  const r = await http.get(url);
  if (!r?.texto) return null;
  for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    const m = cs.length >= 7 ? /^\s*0*(\d+)\s*-\s*(\d{4})/.exec(plano(cs[0])) : null;
    if (!m || Number(m[1]) !== n || Number(m[2]) !== anio) continue;
    const docs: Enlace[] = [
      ...enlaces(cs[3], r.final).filter((e) => esDocumento(e.url)).map((e) => ({ url: e.url, texto: "Bases de la convocatoria" })),
      ...enlaces(cs[6], r.final).filter((e) => esDocumento(e.url) && sinResultados(e.texto)).map((e) => ({ url: e.url, texto: plano(e.texto) || "Comunicado" })),
    ];
    return hallazgo(url, docs);
  }
  return null;
};

// ─── Hospital Nacional Dos de Mayo: una página por convocatoria CAS ──────────────────────────────

/**
 * Hospital Dos de Mayo (/Portal/Concurso1057ConvocatoriaCas0052026): una página por proceso (la URL lleva número y año)
 * con «Fecha | Norma | Descripción | Descargar». Las bases están en fass3.hdosdemayo.gob.pe (se piden por https) y el
 * enlace trae «N&#xBA;» (entidad hexadecimal): se arma la URL a mano.
 */
const dosDeMayo: Adaptador = async (p, http) => {
  const n = numeroProceso(p.numero);
  if (n == null || regimenDe(p.numero) !== "cas") return null;
  const anio = anioDe(p);
  const enUrl = /Concurso1057ConvocatoriaCas(\d{3})(\d{4})/i.exec(p.detalle_url ?? "");
  const url = `https://www.hdosdemayo.gob.pe/Portal/Concurso1057ConvocatoriaCas${enUrl ? `${enUrl[1]}${enUrl[2]}` : `${pad(n, 3)}${anio}`}`;
  const r = await http.get(url);
  if (!r?.texto || r.status >= 400) return null;
  const titulo = plano(/class="textoTitulo"[^>]*>([\s\S]*?)<\/label>/i.exec(r.texto)?.[1] ?? "");
  if (titulo && !numeroDe(titulo)) return null;
  const docs: Enlace[] = [];
  for (const fila of r.texto.split(/<tr\b/i).slice(1)) {
    const cs = celdas(fila);
    if (cs.length < 4) continue;
    const norma = plano(cs[1]);
    const descripcion = plano(cs[2]);
    if (!sinResultados(`${norma} ${descripcion}`)) continue;
    const href = /href=['"]([^'"]+)['"]/i.exec(cs[3])?.[1];
    if (!href) continue;
    let u: string;
    try {
      u = new URL(atributo(href), r.final).toString().replace(/^http:\/\/fass3\./i, "https://fass3.");
    } catch {
      continue;
    }
    if (esDocumento(u)) docs.push({ url: u, texto: descripcion || norma || "Documento" });
  }
  return hallazgo(url, docs);
};

// ─── El registro ─────────────────────────────────────────────────────────────────────────────────

export const ADAPTADORES_SALUD: Record<string, Adaptador> = {
  "portal.inen.sld.pe": inen,
  "plataforma.inen.sld.pe": inen,
  "app.hrayacucho.gob.pe": hrAyacucho,
  "www.hrayacucho.gob.pe": hrAyacucho,
  "hrayacucho.gob.pe": hrAyacucho,
  "redsaludhuamanga.pe": saludHuamanga,
  "www.redsaludhuamanga.pe": saludHuamanga,
  "hdemarini.gob.pe": hdemarini,
  "www.hdemarini.gob.pe": hdemarini,
  "www.hrhvm.gob.pe": hrhvm,
  "hrhvm.gob.pe": hrhvm,
  "hdachyo.gob.pe": hdachyo,
  "www.hdachyo.gob.pe": hdachyo,
  "www.reddesaludotuzco.gob.pe": otuzco,
  "reddesaludotuzco.gob.pe": otuzco,
  "redsaludhuaylasnorte.gob.pe": huaylasNorte,
  "www.redsaludhuaylasnorte.gob.pe": huaylasNorte,
  "recursoshumanos.diresahuanuco.gob.pe": diresaHuanuco,
  "hospitaldeventanilla.gob.pe": ventanilla,
  "www.hospitaldeventanilla.gob.pe": ventanilla,
  "www.hdosdemayo.gob.pe": dosDeMayo,
  "hdosdemayo.gob.pe": dosDeMayo,
};
