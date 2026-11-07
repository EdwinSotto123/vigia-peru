/**
 * Bajar una respuesta del chat de investigación como informe: Word (.docx), Excel (.xlsx), CSV y PDF (por la ventana de
 * impresión). Todo se arma en el navegador a partir del markdown de la respuesta, sin pasar por el API: el texto ya llegó
 * con las reglas de privacidad aplicadas (DNI fuera, un apellido tapado) y se exporta tal cual, nunca más.
 *
 * - Word: el informe entero (títulos, listas, tablas, enlaces que se pueden abrir), con cabecera (pregunta, fecha, fuente),
 *   un anexo «Cómo se armó» (modelo y consultas hechas) y número de página al pie. OOXML escrito a mano y comprimido con
 *   fflate: sin librerías de Word.
 * - Excel: una hoja «Informe» (pregunta, fecha, índice de tablas y el texto) y una hoja por cada tabla, con su título como
 *   nombre, la fila de títulos fija, filtros y las cifras como números de verdad (S/, US$ y % con su formato). RUC, OCID y
 *   demás códigos quedan como texto para no perder dígitos.
 * - CSV: una tabla, un CSV; varias, un ZIP con un CSV por tabla. Se exporta lo que se ve (como lib/csv.ts).
 * - PDF: la respuesta ya pintada en la página, en un documento A4 limpio, y la ventana de imprimir («Guardar como PDF»).
 */
import { strToU8, zipSync, type Zippable } from "fflate";
import type { PhrasingContent, Root, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { nombreArchivo } from "@/lib/csv";
import type { Revision } from "./conversacion";

// ─── Lo común ───────────────────────────────────────────────────────────────

const SITIO = "https://vigia.gobserva.cloud";
const NOTA_SENAL = "Una señal es un indicio para revisar, no una acusación. Las personas naturales aparecen con un apellido tapado.";
const FUENTE = "Datos públicos reunidos por Vigía by Gobserva (vigia.gobserva.cloud).";

export interface MetaInforme {
  /** La pregunta que respondió. */
  pregunta: string | null;
  fecha: Date;
  /** El id del modelo que contestó («claude-haiku-5-5»). */
  modelo: string | null;
  /** Títulos de las herramientas que respondieron bien, en orden y con repetidas. */
  consultas: string[];
  /** La revisión automática de enlaces y montos (si llegó): va al anexo «Cómo se armó este informe». */
  revision?: Revision | null;
}

/**
 * La revisión automática en frases para el anexo: la cuenta y, si hay, lo que quedó por revisar (hasta 25 de cada uno).
 */
export function lineasRevision(r: Revision | null | undefined): { cuenta: string; dudosos: string[] } | null {
  if (!r || r.enlaces.total + r.montos.total === 0) return null;
  const enlaces = r.enlaces.ok + r.enlaces.anteriores;
  const montos = r.montos.ok + r.montos.sumas + r.montos.anteriores;
  const partes = [
    r.enlaces.total ? `${enlaces} de ${r.enlaces.total} enlaces` : null,
    r.montos.total ? `${montos} de ${r.montos.total} montos en soles` : null,
  ].filter(Boolean);
  const cuenta = `Revisión automática: ${partes.join(" y ")} salen de los datos consultados${r.montos.sumas ? ` (${r.montos.sumas} son totales de tabla)` : ""}.`;
  const dudosos = [
    ...r.enlaces.dudosos.slice(0, 25).map((d) => `Enlace por revisar: «${d.texto}» (${d.motivo.replace(/\.$/, "")}).`),
    ...r.montos.dudosos.slice(0, 25).map((d) => `Monto por revisar: ${d.texto}${d.contexto ? `, en «${d.contexto.replace(/^…|…$/g, "")}»` : ""}.`),
  ];
  return { cuenta, dudosos };
}

export interface Celda {
  texto: string;
  /** El primer enlace de la celda (absoluto), si tiene. */
  enlace: string | null;
}

export interface TablaExtraida {
  titulo: string;
  columnas: Celda[];
  filas: Celda[][];
}

export function analizar(texto: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(texto) as Root;
}

/** Sólo enlaces web o de correo, siempre absolutos (los relativos son de Vigía). */
function absoluta(url: string): string | null {
  try {
    const u = new URL(url, SITIO);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" ? u.href : null;
  } catch {
    return null;
  }
}

type Nodo = RootContent | PhrasingContent;

/** El texto de un nodo, sin formato. `conEnlaces`: «texto (url)» cuando el enlace no se lee en el texto. */
function plano(nodos: readonly Nodo[], conEnlaces = false): string {
  let s = "";
  for (const n of nodos) {
    if (n.type === "text" || n.type === "inlineCode") s += n.value;
    else if (n.type === "break") s += " ";
    else if (n.type === "image") s += n.alt ?? "";
    else if (n.type === "link") {
      const texto = plano(n.children, conEnlaces);
      const url = absoluta(n.url);
      s += conEnlaces && url && !texto.includes(url.replace(/^https?:\/\//, "").replace(/\/$/, "")) ? `${texto} (${url})` : texto;
    } else if ("children" in n) s += plano(n.children as Nodo[], conEnlaces);
  }
  return s.replace(/\s+/g, " ").trim();
}

function primerEnlace(nodos: readonly Nodo[]): string | null {
  for (const n of nodos) {
    if (n.type === "link") {
      const url = absoluta(n.url);
      if (url) return url;
    }
    if ("children" in n) {
      const dentro = primerEnlace(n.children as Nodo[]);
      if (dentro) return dentro;
    }
  }
  return null;
}

/** Recorre los bloques en el orden en que se leen (también dentro de listas y citas). */
function recorrer(nodos: readonly RootContent[], visitar: (n: RootContent, previo: RootContent | undefined) => void) {
  nodos.forEach((n, i) => {
    visitar(n, nodos[i - 1]);
    if (n.type === "list" || n.type === "listItem" || n.type === "blockquote" || n.type === "footnoteDefinition") {
      recorrer(n.children as RootContent[], visitar);
    }
  });
}

/** Lo que presenta a la tabla justo antes: un renglón corto o el último punto de una lista («2. Otras distritales…:»). */
function presentacion(previo: RootContent | undefined): string {
  if (previo?.type === "paragraph") return plano(previo.children);
  if (previo?.type === "list") {
    const primero = previo.children[previo.children.length - 1]?.children[0];
    if (primero?.type === "paragraph") return plano(primero.children);
  }
  return "";
}

/** «Tabla 2: Proveedores_2023_2026.» → «Proveedores 2023 2026». */
const limpiarTitulo = (t: string) =>
  t
    .replace(/^tabla\s*\d+\s*[:.\-–]\s*/i, "")
    .replace(/_/g, " ")
    .replace(/[:.]\s*$/, "")
    .trim();

/**
 * Las tablas de la respuesta, cada una con un título: el renglón corto que la presenta (o el último punto de la lista
 * de antes), si no el último subtítulo, si no «Tabla N».
 */
export function extraerTablas(raiz: Root): TablaExtraida[] {
  const out: TablaExtraida[] = [];
  let subtitulo: string | null = null;
  recorrer(raiz.children, (n, previo) => {
    if (n.type === "heading") subtitulo = plano(n.children);
    if (n.type !== "table" || !n.children.length) return;
    const antes = presentacion(previo);
    const titulo = limpiarTitulo(antes && antes.length <= 90 ? antes : subtitulo ?? "") || `Tabla ${out.length + 1}`;
    const ancho = Math.max(...n.children.map((f) => f.children.length));
    const celdas = n.children.map((f) =>
      Array.from({ length: ancho }, (_, j) => {
        const c = f.children[j];
        return c ? { texto: plano(c.children), enlace: primerEnlace(c.children) } : { texto: "", enlace: null };
      }),
    );
    out.push({ titulo, columnas: celdas[0], filas: celdas.slice(1) });
  });
  return out;
}

const fechaLarga = (d: Date) =>
  d.toLocaleString("es-PE", { timeZone: "America/Lima", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fechaCorta = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);

/** «claude-haiku-5-5» → «Claude Haiku 5.5 (rápido)». */
export function nombreModelo(id: string | null): string | null {
  if (!id) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id);
  if (!m) return id;
  const familia = m[1][0].toUpperCase() + m[1].slice(1);
  const modo = /haiku/i.test(id) ? " (rápido)" : /sonnet|opus/i.test(id) ? " (profundo)" : "";
  return `Claude ${familia} ${m[2]}${m[3] ? `.${m[3]}` : ""}${modo}`;
}

/** «Ficha de la entidad (2)», en el orden de la primera vez. */
function resumenConsultas(consultas: string[]): string[] {
  const cuenta = new Map<string, number>();
  for (const c of consultas) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
  return [...cuenta].map(([t, n]) => (n > 1 ? `${t} (${n})` : t));
}

/** «vigia-dime-todo-sobre-el-alcalde-de-wanchaq-2026-11-06». */
export function nombreBase(meta: MetaInforme): string {
  return `vigia-${nombreArchivo(meta.pregunta ?? "informe")}-${fechaCorta(meta.fecha)}`;
}

export function bajar(datos: Uint8Array | string, nombre: string, tipo: string) {
  const parte: BlobPart = typeof datos === "string" ? datos : (datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength) as ArrayBuffer);
  const url = URL.createObjectURL(new Blob([parte], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Texto seguro para XML (también saca los caracteres de control que Word y Excel no aceptan). */
const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const T_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function core(titulo: string, fecha: Date): string {
  const iso = fecha.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(titulo)}</dc:title><dc:creator>Vigía by Gobserva</dc:creator><cp:lastModifiedBy>Vigía by Gobserva</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
}

const APP = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Vigía by Gobserva</Application></Properties>`;

const zip = (archivos: Record<string, string>): Uint8Array => {
  const z: Zippable = {};
  for (const [ruta, contenido] of Object.entries(archivos)) z[ruta] = strToU8(contenido);
  return zipSync(z, { level: 6 });
};

// ─── Word ───────────────────────────────────────────────────────────────────

/** Ancho útil de la página A4 con 2 cm de margen, en veinteavos de punto. */
const ANCHO_UTIL = 11906 - 2 * 1134;

interface Formato {
  b?: boolean;
  i?: boolean;
  s?: boolean;
  codigo?: boolean;
  enlace?: boolean;
}

class Word {
  private enlaces: string[] = [];
  /** Cada lista numerada tiene su propia numeración (empieza en su número). */
  listas: { id: number; nivel: number; inicio: number }[] = [];
  /** El nivel de título más alto de la respuesta: ese pasa a ser el «Título 1» del documento. */
  nivelBase = 1;

  enlace(url: string): string {
    let i = this.enlaces.indexOf(url);
    if (i < 0) i = this.enlaces.push(url) - 1;
    return `rIdE${i + 1}`;
  }

  relaciones(): string {
    const fijas = [
      `<Relationship Id="rIdEstilos" Type="${T_REL}/styles" Target="styles.xml"/>`,
      `<Relationship Id="rIdNumeracion" Type="${T_REL}/numbering" Target="numbering.xml"/>`,
      `<Relationship Id="rIdPie" Type="${T_REL}/footer" Target="footer1.xml"/>`,
    ];
    const externas = this.enlaces.map((u, i) => `<Relationship Id="rIdE${i + 1}" Type="${T_REL}/hyperlink" Target="${xml(u)}" TargetMode="External"/>`);
    return `${XML}<Relationships xmlns="${NS_REL}">${[...fijas, ...externas].join("")}</Relationships>`;
  }

  nuevaLista(nivel: number, inicio: number): number {
    const id = this.listas.length + 2; // el 1 es el de viñetas
    this.listas.push({ id, nivel, inicio });
    return id;
  }
}

function run(texto: string, f: Formato): string {
  const rpr = [
    f.enlace && '<w:rStyle w:val="Hipervinculo"/>',
    f.codigo && '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>',
    f.b && "<w:b/>",
    f.i && "<w:i/>",
    f.s && "<w:strike/>",
    f.codigo && '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F1"/>',
  ]
    .filter(Boolean)
    .join("");
  const props = rpr ? `<w:rPr>${rpr}</w:rPr>` : "";
  return texto
    .split("\n")
    .map((parte, k) => `<w:r>${props}${k ? "<w:br/>" : ""}<w:t xml:space="preserve">${xml(parte)}</w:t></w:r>`)
    .join("");
}

function enLinea(nodos: readonly PhrasingContent[], f: Formato, w: Word): string {
  return nodos
    .map((n): string => {
      switch (n.type) {
        case "text":
          return run(n.value, f);
        case "strong":
          return enLinea(n.children, { ...f, b: true }, w);
        case "emphasis":
          return enLinea(n.children, { ...f, i: true }, w);
        case "delete":
          return enLinea(n.children, { ...f, s: true }, w);
        case "inlineCode":
          return run(n.value, { ...f, codigo: true });
        case "break":
          return "<w:r><w:br/></w:r>";
        case "image":
          return n.alt ? run(n.alt, f) : "";
        case "link": {
          const url = absoluta(n.url);
          if (!url) return enLinea(n.children, f, w);
          return `<w:hyperlink r:id="${w.enlace(url)}" w:history="1">${enLinea(n.children, { ...f, enlace: true }, w)}</w:hyperlink>`;
        }
        // El HTML crudo no se pinta en la página (react-markdown lo descarta): tampoco acá.
        case "html":
        case "footnoteReference":
          return "";
        default:
          return "children" in n ? enLinea(n.children as PhrasingContent[], f, w) : "";
      }
    })
    .join("");
}

interface Parrafo {
  estilo?: string;
  numero?: { id: number; nivel: number };
  sangria?: number;
  alineado?: "right" | "center";
}

function parrafo(contenido: string, p: Parrafo = {}): string {
  const ppr = [
    p.estilo && `<w:pStyle w:val="${p.estilo}"/>`,
    p.numero && `<w:numPr><w:ilvl w:val="${p.numero.nivel}"/><w:numId w:val="${p.numero.id}"/></w:numPr>`,
    p.sangria != null && `<w:ind w:left="${p.sangria}"/>`,
    p.alineado && `<w:jc w:val="${p.alineado}"/>`,
  ]
    .filter(Boolean)
    .join("");
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${contenido}</w:p>`;
}

/** Anchos de columna según lo que traen (entre 5 y 40 caracteres de peso), repartiendo el ancho de la página. */
function anchosWord(t: Table, ancho: number): number[] {
  const peso = Array.from({ length: ancho }, (_, j) =>
    Math.min(40, Math.max(5, ...t.children.map((f) => (f.children[j] ? plano(f.children[j].children).length : 0)))),
  );
  const total = peso.reduce((a, b) => a + b, 0);
  return peso.map((p) => Math.floor((ANCHO_UTIL * p) / total));
}

/** ¿La mayoría de las celdas con algo (sin la fila de títulos) son cifras? Esas columnas van a la derecha. */
function columnasNumericas(filas: string[][], ancho: number): boolean[] {
  return Array.from({ length: ancho }, (_, j) => {
    const llenas = filas.map((f) => (f[j] ?? "").trim()).filter((v) => v && v !== "—" && v !== "-");
    // Un año («2024») es una etiqueta, no una cifra: la columna «Año» queda a la izquierda.
    return llenas.length > 0 && llenas.filter((v) => comoNumero(v) && !/^(19|20)\d{2}$/.test(v)).length / llenas.length >= 0.6;
  });
}

function tablaWord(t: Table, w: Word): string {
  const ancho = Math.max(1, ...t.children.map((f) => f.children.length));
  const anchos = anchosWord(t, ancho);
  const numericas = columnasNumericas(
    t.children.slice(1).map((f) => f.children.map((c) => plano(c.children))),
    ancho,
  );
  const grid = anchos.map((a) => `<w:gridCol w:w="${a}"/>`).join("");
  const filas = t.children
    .map((fila, i) => {
      const celdas = Array.from({ length: ancho }, (_, j) => {
        const c = fila.children[j];
        const a = t.align?.[j] ?? (numericas[j] ? "right" : null);
        const contenido = c ? enLinea(c.children, i === 0 ? { b: true } : {}, w) : "";
        const fondo = i === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="DAE6E4"/>' : "";
        return `<w:tc><w:tcPr><w:tcW w:w="${anchos[j]}" w:type="dxa"/>${fondo}</w:tcPr>${parrafo(contenido, { estilo: "Celda", alineado: a === "right" || a === "center" ? a : undefined })}</w:tc>`;
      }).join("");
      return `<w:tr><w:trPr><w:cantSplit/>${i === 0 ? "<w:tblHeader/>" : ""}</w:trPr>${celdas}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TablaVigia"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${filas}</w:tbl>${parrafo("", { estilo: "Espacio" })}`;
}

function bloquesWord(nodos: readonly RootContent[], w: Word, nivelLista = 0, cita = false): string {
  return nodos
    .map((n): string => {
      switch (n.type) {
        case "heading": {
          const nivel = Math.min(3, Math.max(1, n.depth - w.nivelBase + 1));
          return parrafo(enLinea(n.children, {}, w), { estilo: `Heading${nivel}` });
        }
        case "paragraph":
          return parrafo(enLinea(n.children, {}, w), { estilo: cita ? "Cita" : undefined });
        case "blockquote":
          return bloquesWord(n.children as RootContent[], w, nivelLista, true);
        case "list": {
          const nivel = Math.min(nivelLista, 2);
          const id = n.ordered ? w.nuevaLista(nivel, n.start ?? 1) : 1;
          return n.children
            .map((item) => {
              const [primero, ...resto] = item.children;
              const marca = item.checked == null ? "" : item.checked ? "☑ " : "☐ ";
              const cabeza =
                primero?.type === "paragraph"
                  ? parrafo(run(marca, {}) + enLinea(primero.children, {}, w), { numero: { id, nivel }, estilo: "Lista" })
                  : parrafo(run(marca, {}), { numero: { id, nivel }, estilo: "Lista" }) + bloquesWord(primero ? [primero as RootContent] : [], w, nivelLista + 1, cita);
              const cola = resto
                .map((b) =>
                  b.type === "paragraph"
                    ? parrafo(enLinea(b.children, {}, w), { estilo: "Lista", sangria: 360 * (nivel + 1) })
                    : bloquesWord([b as RootContent], w, nivelLista + 1, cita),
                )
                .join("");
              return cabeza + cola;
            })
            .join("");
        }
        case "code":
          return parrafo(run(n.value, { codigo: true }), { estilo: "Codigo" });
        case "thematicBreak":
          return parrafo("", { estilo: "Separador" });
        case "table":
          return tablaWord(n, w);
        case "footnoteDefinition":
          return bloquesWord(n.children as RootContent[], w, nivelLista, cita);
        default:
          return "";
      }
    })
    .join("");
}

function minimoTitulo(raiz: Root): number {
  let min = 6;
  recorrer(raiz.children, (n) => {
    if (n.type === "heading") min = Math.min(min, n.depth);
  });
  return min;
}

const COLOR_TINTA = "1F2928";
const COLOR_ACENTO = "426608";
const COLOR_GRIS = "5B6B69";
const COLOR_LINEA = "C8D6D3";

const ESTILOS_WORD = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:color w:val="${COLOR_TINTA}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="es-PE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="paragraph" w:styleId="Marca"><w:name w:val="Marca"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:b/><w:color w:val="${COLOR_ACENTO}"/><w:sz w:val="17"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Pregunta"><w:name w:val="Pregunta"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/><w:szCs w:val="25"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="20"/></w:pPr><w:rPr><w:color w:val="${COLOR_GRIS}"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${COLOR_ACENTO}"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/><w:szCs w:val="25"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Lista"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Cita"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="${COLOR_ACENTO}"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:color w:val="3A4A48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Codigo"><w:name w:val="Código"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="EEF2F1"/><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Celda"><w:name w:val="Celda"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Espacio"><w:name w:val="Espacio"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60" w:line="120" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Separador"><w:name w:val="Separador"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${COLOR_LINEA}"/></w:pBdr><w:spacing w:after="200"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Nota"><w:name w:val="Nota"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="${COLOR_GRIS}"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Pie"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="${COLOR_GRIS}"/><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hipervinculo"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="2F5D0A"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TablaVigia"><w:name w:val="Tabla Vigía"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LINEA}"/><w:left w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LINEA}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LINEA}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LINEA}"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LINEA}"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LINEA}"/></w:tblBorders><w:tblCellMar><w:top w:w="50" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

function nivelesLista(formato: "bullet" | "decimal"): string {
  const marcas = ["•", "◦", "▪"];
  return [0, 1, 2]
    .map(
      (i) =>
        `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${formato}"/><w:lvlText w:val="${formato === "bullet" ? marcas[i] : `%${i + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`,
    )
    .join("");
}

function numeracion(w: Word): string {
  const instancias = w.listas
    .map((l) => `<w:num w:numId="${l.id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${l.nivel}"><w:startOverride w:val="${l.inicio}"/></w:lvlOverride></w:num>`)
    .join("");
  return `${XML}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${nivelesLista("bullet")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${nivelesLista("decimal")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${instancias}</w:numbering>`;
}

const PIE_WORD = `${XML}<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${NS_R}"><w:p><w:pPr><w:pStyle w:val="Pie"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Vigía by Gobserva  |  vigia.gobserva.cloud  |  Página </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> de </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;

/** El informe en Word (.docx). */
export function informeWord(texto: string, meta: MetaInforme): Uint8Array {
  const raiz = analizar(texto);
  const w = new Word();
  w.nivelBase = minimoTitulo(raiz);
  const modelo = nombreModelo(meta.modelo);
  const consultas = resumenConsultas(meta.consultas);
  const revision = lineasRevision(meta.revision);

  const cabecera = [
    parrafo(run("VIGÍA BY GOBSERVA  |  CHAT DE INVESTIGACIÓN", {}), { estilo: "Marca" }),
    parrafo(run("Informe de investigación", {}), { estilo: "Title" }),
    meta.pregunta ? parrafo(run(meta.pregunta, {}), { estilo: "Pregunta" }) : "",
    parrafo(run(`Fecha: ${fechaLarga(meta.fecha)} (hora de Lima)`, {}), { estilo: "Meta" }),
    parrafo(run("Fuente: datos públicos reunidos por Vigía by Gobserva (", {}) + `<w:hyperlink r:id="${w.enlace(SITIO)}" w:history="1">${run("vigia.gobserva.cloud", { enlace: true })}</w:hyperlink>` + run(")", {}), { estilo: "Meta" }),
    parrafo("", { estilo: "Separador" }),
  ].join("");

  const cuerpo = bloquesWord(raiz.children, w);

  const anexo = [
    parrafo(run("Cómo se armó este informe", {}), { estilo: "Heading1" }),
    modelo ? parrafo(run(`Modelo: ${modelo}.`, {}), { estilo: "Lista", numero: { id: 1, nivel: 0 } }) : "",
    parrafo(run(consultas.length ? `Consultas a los datos de Vigía: ${meta.consultas.length}.` : "Sin consultas a los datos de Vigía.", {}), { estilo: "Lista", numero: { id: 1, nivel: 0 } }),
    ...consultas.map((c) => parrafo(run(c, {}), { estilo: "Lista", numero: { id: 1, nivel: 1 } })),
    ...(revision ? [
      parrafo(run(revision.cuenta, {}), { estilo: "Lista", numero: { id: 1, nivel: 0 } }),
      ...revision.dudosos.map((d) => parrafo(run(d, {}), { estilo: "Lista", numero: { id: 1, nivel: 1 } })),
    ] : []),
    parrafo(run(NOTA_SENAL, {}), { estilo: "Nota" }),
  ].join("");

  const documento = `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${NS_R}"><w:body>${cabecera}${cuerpo}${anexo}<w:sectPr><w:footerReference w:type="default" r:id="rIdPie"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  return zip({
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="${NS_REL}"><Relationship Id="rId1" Type="${T_REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${T_REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    "docProps/core.xml": core(meta.pregunta ? `Informe: ${meta.pregunta.slice(0, 200)}` : "Informe de investigación", meta.fecha),
    "docProps/app.xml": APP,
    "word/document.xml": documento,
    "word/styles.xml": ESTILOS_WORD,
    "word/numbering.xml": numeracion(w),
    "word/footer1.xml": PIE_WORD,
    "word/_rels/document.xml.rels": w.relaciones(),
  });
}

// ─── Excel ──────────────────────────────────────────────────────────────────

/** Índices de `cellXfs` en ESTILOS_EXCEL. */
const X = {
  general: 0,
  titulos: 1,
  texto: 2,
  miles0: 3,
  miles2: 4,
  soles0: 5,
  soles2: 6,
  dolares: 7,
  pct0: 8,
  pct1: 9,
  pct2: 10,
  enlace: 11,
  tituloHoja: 12,
  negrita: 13,
  nota: 14,
} as const;

const ESTILOS_EXCEL = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;S/ &quot;#,##0"/><numFmt numFmtId="165" formatCode="&quot;S/ &quot;#,##0.00"/><numFmt numFmtId="166" formatCode="&quot;US$ &quot;#,##0.00"/><numFmt numFmtId="167" formatCode="0.0%"/></numFmts>
<fonts count="5"><font><sz val="11"/><color rgb="FF${COLOR_TINTA}"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF${COLOR_TINTA}"/><name val="Calibri"/><family val="2"/></font><font><u/><sz val="11"/><color rgb="FF2F5D0A"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="15"/><color rgb="FF${COLOR_TINTA}"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF${COLOR_GRIS}"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDAE6E4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF${COLOR_LINEA}"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * «S/ 1,234,567.89» → 1234567.89 con formato de soles; «43.2 %» → 0.432; «1,571» → 1571. Lo que parece un código (7 o
 * más dígitos sin separadores, o un cero adelante: RUC, OCID, CUI) sigue siendo texto. null si no es una cifra.
 */
export function comoNumero(crudo: string): { n: number; estilo: number } | null {
  let t = crudo.replace(/[  ]/g, " ").trim();
  if (!t || t.length > 32) return null;
  let moneda: "S/" | "US$" | null = null;
  const m0 = /^(S\/\.?|US\$|\$)\s*/.exec(t);
  if (m0) {
    moneda = m0[1].startsWith("S") ? "S/" : "US$";
    t = t.slice(m0[0].length);
  }
  let signo = 1;
  if (/^[-−–]/.test(t)) {
    signo = -1;
    t = t.slice(1).trim();
  } else if (t.startsWith("+")) t = t.slice(1).trim();
  if (!moneda) {
    const m1 = /^(S\/\.?|US\$|\$)\s*/.exec(t);
    if (m1) {
      moneda = m1[1].startsWith("S") ? "S/" : "US$";
      t = t.slice(m1[0].length);
    }
  }
  let pct = false;
  if (/\s*%$/.test(t)) {
    pct = true;
    t = t.replace(/\s*%$/, "");
  }
  let entero: string;
  let dec = "";
  let comas = false;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/.exec(t))) {
    entero = m[1].replace(/,/g, "");
    dec = m[2] ?? "";
    comas = true;
  } else if ((m = /^(\d{1,3}(?:\.\d{3}){2,})$/.exec(t))) {
    entero = m[1].replace(/\./g, "");
    comas = true;
  } else if ((m = /^(\d+)(?:\.(\d+))?$/.exec(t))) {
    entero = m[1];
    dec = m[2] ?? "";
    if (!moneda && !pct && (entero.length >= 7 || (entero.length > 1 && entero.startsWith("0")))) return null;
  } else return null;
  const n = signo * Number(dec ? `${entero}.${dec}` : entero);
  if (!Number.isFinite(n)) return null;
  if (pct) return { n: n / 100, estilo: dec.length >= 2 ? X.pct2 : dec.length === 1 ? X.pct1 : X.pct0 };
  if (moneda === "S/") return { n, estilo: dec ? X.soles2 : X.soles0 };
  if (moneda === "US$") return { n, estilo: X.dolares };
  if (comas) return { n, estilo: dec ? X.miles2 : X.miles0 };
  return { n, estilo: X.general };
}

function letra(i: number): string {
  let s = "";
  for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

const MAX_CELDA = 32_000;

interface CeldaExcel {
  texto?: string;
  numero?: number;
  estilo: number;
  enlace?: string;
  /** Un enlace a otra hoja del mismo libro («'Proveedores'!A1»). */
  destino?: string;
}

class Hoja {
  filas: (CeldaExcel | null)[][] = [];
  /** Alto de cada fila en puntos (sólo las que lo necesitan): Excel no siempre recalcula el de un texto ajustado. */
  altos: (number | undefined)[] = [];
  anchos: number[] = [];
  filtro: string | null = null;
  congelar = false;
  /** Al imprimir, todas las columnas en el ancho de la hoja (las tablas). */
  ajustarAncho = false;

  constructor(public nombre: string) {}

  xml(): { hoja: string; rels: string | null } {
    const externos: { ref: string; url: string }[] = [];
    const internos: { ref: string; destino: string }[] = [];
    const filas = this.filas
      .map((fila, i) => {
        const celdas = fila
          .map((c, j) => {
            if (!c) return "";
            const ref = `${letra(j)}${i + 1}`;
            if (c.enlace) externos.push({ ref, url: c.enlace });
            if (c.destino) internos.push({ ref, destino: c.destino });
            if (c.numero != null) return `<c r="${ref}" s="${c.estilo}"><v>${c.numero}</v></c>`;
            const t = (c.texto ?? "").slice(0, MAX_CELDA);
            return t ? `<c r="${ref}" s="${c.estilo}" t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>` : `<c r="${ref}" s="${c.estilo}"/>`;
          })
          .join("");
        const alto = this.altos[i];
        return `<row r="${i + 1}"${alto ? ` ht="${alto}" customHeight="1"` : ""}>${celdas}</row>`;
      })
      .join("");
    const vista = this.congelar
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const cols = this.anchos.length ? `<cols>${this.anchos.map((a, i) => `<col min="${i + 1}" max="${i + 1}" width="${a}" customWidth="1"/>`).join("")}</cols>` : "";
    const enlaces = [
      ...externos.map((e, k) => `<hyperlink ref="${e.ref}" r:id="rIdE${k + 1}"/>`),
      ...internos.map((e) => `<hyperlink ref="${e.ref}" location="${xml(e.destino)}"/>`),
    ].join("");
    const ajuste = this.ajustarAncho ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : "";
    const pagina = this.ajustarAncho ? `<pageSetup paperSize="9" orientation="${this.anchos.reduce((a, b) => a + b, 0) > 95 ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>` : "";
    const hoja = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}">${ajuste}${vista}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${filas}</sheetData>${this.filtro ? `<autoFilter ref="${this.filtro}"/>` : ""}${enlaces ? `<hyperlinks>${enlaces}</hyperlinks>` : ""}<pageMargins left="0.6" right="0.6" top="0.7" bottom="0.7" header="0.3" footer="0.3"/>${pagina}</worksheet>`;
    const rels = externos.length
      ? `${XML}<Relationships xmlns="${NS_REL}">${externos.map((e, k) => `<Relationship Id="rIdE${k + 1}" Type="${T_REL}/hyperlink" Target="${xml(e.url)}" TargetMode="External"/>`).join("")}</Relationships>`
      : null;
    return { hoja, rels };
  }
}

/** Nombre de hoja válido (sin []:*?/\, hasta 31 caracteres) y distinto de los anteriores. */
function nombreHoja(titulo: string, usados: Set<string>): string {
  let base = titulo.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim() || "Tabla";
  if (base.length > 31) base = base.slice(0, 31).replace(/\s+\S*$/, "").trim() || base.slice(0, 31);
  let nombre = base;
  for (let k = 2; usados.has(nombre.toLowerCase()) || nombre.toLowerCase() === "historial"; k++) {
    const sufijo = ` (${k})`;
    nombre = `${base.slice(0, 31 - sufijo.length).trim()}${sufijo}`;
  }
  usados.add(nombre.toLowerCase());
  return nombre;
}

const refHoja = (nombre: string) => `'${nombre.replace(/'/g, "''")}'`;

/** Las líneas del texto para la hoja «Informe»: títulos en negrita, listas con su viñeta y los enlaces a la vista. */
function lineasInforme(raiz: Root, hojasDeTablas: string[]): CeldaExcel[] {
  const out: CeldaExcel[] = [];
  let tabla = 0;
  const bloques = (nodos: readonly RootContent[], prefijo: string) => {
    for (const n of nodos) {
      if (n.type === "heading") out.push({ texto: plano(n.children), estilo: X.negrita });
      else if (n.type === "paragraph") out.push({ texto: prefijo + plano(n.children, true), estilo: X.texto });
      else if (n.type === "blockquote") bloques(n.children as RootContent[], `${prefijo}  `);
      else if (n.type === "code") out.push({ texto: n.value, estilo: X.texto });
      else if (n.type === "list") {
        n.children.forEach((item, k) => {
          const marca = n.ordered ? `${(n.start ?? 1) + k}. ` : "- ";
          const [primero, ...resto] = item.children;
          if (primero?.type === "paragraph") out.push({ texto: `${prefijo}${marca}${plano(primero.children, true)}`, estilo: X.texto });
          else if (primero) bloques([primero as RootContent], `${prefijo}${marca}`);
          bloques(resto as RootContent[], `${prefijo}    `);
        });
      } else if (n.type === "table") {
        const hoja = hojasDeTablas[tabla++];
        if (hoja) out.push({ texto: `${prefijo}[Tabla en la hoja «${hoja}»]`, estilo: X.enlace, destino: `${refHoja(hoja)}!A1` });
      }
    }
  };
  bloques(raiz.children, "");
  return out;
}

/** El informe en Excel (.xlsx): la hoja «Informe» y una hoja por tabla. */
export function informeExcel(texto: string, meta: MetaInforme): Uint8Array {
  const raiz = analizar(texto);
  const tablas = extraerTablas(raiz);
  const usados = new Set<string>(["informe"]);
  const nombres = tablas.map((t) => nombreHoja(t.titulo, usados));

  const informe = new Hoja("Informe");
  informe.anchos = [110];
  const fila = (c: CeldaExcel | null) => {
    informe.filas.push([c]);
    // Unos 95 caracteres por renglón en una columna de 110 (de sobra, para que al imprimir no se corte).
    const renglones = c?.texto ? c.texto.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 95)), 0) : 1;
    informe.altos.push(renglones > 1 ? Math.min(409, renglones * 15 + 2) : undefined);
  };
  fila({ texto: "Informe de investigación de Vigía", estilo: X.tituloHoja });
  if (meta.pregunta) fila({ texto: `Pregunta: ${meta.pregunta}`, estilo: X.negrita });
  fila({ texto: `Fecha: ${fechaLarga(meta.fecha)} (hora de Lima)`, estilo: X.texto });
  fila({ texto: `Fuente: ${FUENTE}`, estilo: X.texto });
  const modelo = nombreModelo(meta.modelo);
  if (modelo) fila({ texto: `Modelo: ${modelo}`, estilo: X.texto });
  fila(null);
  if (tablas.length) {
    fila({ texto: "Tablas de esta respuesta (cada una en su hoja)", estilo: X.negrita });
    nombres.forEach((n, i) => fila({ texto: `${i + 1}. ${n}  (${tablas[i].filas.length} filas)`, estilo: X.enlace, destino: `${refHoja(n)}!A1` }));
    fila(null);
  }
  fila({ texto: "Respuesta", estilo: X.negrita });
  for (const l of lineasInforme(raiz, nombres)) fila(l);
  fila(null);
  const consultas = resumenConsultas(meta.consultas);
  if (consultas.length) fila({ texto: `Consultas a los datos de Vigía (${meta.consultas.length}): ${consultas.join(", ")}.`, estilo: X.nota });
  const revision = lineasRevision(meta.revision);
  if (revision) for (const l of [revision.cuenta, ...revision.dudosos]) fila({ texto: l, estilo: X.nota });
  fila({ texto: NOTA_SENAL, estilo: X.nota });

  const hojas = [informe];
  tablas.forEach((t, i) => {
    const h = new Hoja(nombres[i]);
    h.congelar = true;
    h.ajustarAncho = true;
    h.filas.push(t.columnas.map((c) => ({ texto: c.texto, estilo: X.titulos })));
    for (const f of t.filas) {
      h.filas.push(
        f.map((c) => {
          const num = c.enlace ? null : comoNumero(c.texto);
          if (num) return { numero: num.n, estilo: num.estilo };
          if (c.enlace) return { texto: c.texto || c.enlace, estilo: X.enlace, enlace: c.enlace };
          // Sólo el texto que no entra en la columna (60) se ajusta en varios renglones.
          return { texto: c.texto, estilo: c.texto.length > 60 ? X.texto : X.general };
        }),
      );
    }
    const ncol = t.columnas.length;
    h.anchos = Array.from({ length: ncol }, (_, j) => {
      const largo = Math.max(t.columnas[j].texto.length * 1.1, ...t.filas.map((f) => (f[j]?.texto ?? "").length));
      return Math.round(Math.min(60, Math.max(9, largo * 1.2 + 2)));
    });
    if (t.filas.length && ncol) h.filtro = `A1:${letra(ncol - 1)}${t.filas.length + 1}`;
    hojas.push(h);
  });

  const archivos: Record<string, string> = {};
  hojas.forEach((h, i) => {
    const { hoja, rels } = h.xml();
    archivos[`xl/worksheets/sheet${i + 1}.xml`] = hoja;
    if (rels) archivos[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = rels;
  });
  const filtros = hojas
    .map((h, i) => (h.filtro ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xml(refHoja(h.nombre))}!${h.filtro.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}</definedName>` : ""))
    .join("");
  archivos["xl/workbook.xml"] = `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}"><bookViews><workbookView/></bookViews><sheets>${hojas.map((h, i) => `<sheet name="${xml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${filtros ? `<definedNames>${filtros}</definedNames>` : ""}</workbook>`;
  archivos["xl/_rels/workbook.xml.rels"] = `${XML}<Relationships xmlns="${NS_REL}">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${T_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="${T_REL}/styles" Target="styles.xml"/></Relationships>`;
  archivos["xl/styles.xml"] = ESTILOS_EXCEL;
  archivos["docProps/core.xml"] = core(meta.pregunta ? `Informe: ${meta.pregunta.slice(0, 200)}` : "Informe de investigación", meta.fecha);
  archivos["docProps/app.xml"] = APP;
  archivos["_rels/.rels"] = `${XML}<Relationships xmlns="${NS_REL}"><Relationship Id="rId1" Type="${T_REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${T_REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  archivos["[Content_Types].xml"] = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  return zip(archivos);
}

// ─── CSV ────────────────────────────────────────────────────────────────────

function textoCsv(t: TablaExtraida): string {
  const celda = (c: Celda) => {
    const v = c.enlace && !c.texto.includes(c.enlace) ? (c.texto ? `${c.texto} (${c.enlace})` : c.enlace) : c.texto;
    return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return "﻿" + [t.columnas, ...t.filas].map((f) => f.map(celda).join(",")).join("\r\n");
}

/** Una tabla: el CSV. Varias: un ZIP con un CSV por tabla. null si la respuesta no tiene tablas. */
export function tablasCsv(texto: string, meta: MetaInforme): { datos: Uint8Array | string; nombre: string; tipo: string } | null {
  const tablas = extraerTablas(analizar(texto));
  if (!tablas.length) return null;
  const base = nombreBase(meta);
  if (tablas.length === 1) return { datos: textoCsv(tablas[0]), nombre: `${base}.csv`, tipo: "text/csv;charset=utf-8" };
  const archivos: Record<string, string> = {};
  tablas.forEach((t, i) => {
    archivos[`${String(i + 1).padStart(2, "0")}-${nombreArchivo(t.titulo)}.csv`] = textoCsv(t);
  });
  return { datos: zip(archivos), nombre: `${base}-tablas.zip`, tipo: "application/zip" };
}

/** Cuántas tablas tiene la respuesta (para decidir si se ofrecen Excel y CSV). */
export function contarTablas(texto: string): number {
  if (!/\|\s*:?-{2,}/.test(texto)) return 0;
  return extraerTablas(analizar(texto)).length;
}

// ─── PDF (impresión) ────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS_IMPRESION = `
@page { size: A4; margin: 16mm 16mm 18mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html { background: #fff; }
body { margin: 0 auto; max-width: 180mm; padding: 8mm 0; font: 10.5pt/1.5 "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; color: #${COLOR_TINTA}; background: #fff; }
@media print { body { padding: 0; max-width: none; } }
header { border-bottom: 1.5pt solid #${COLOR_ACENTO}; padding-bottom: 8pt; margin-bottom: 12pt; }
.marca { margin: 0 0 6pt; font: 700 8pt/1 Consolas, "JetBrains Mono", ui-monospace, monospace; letter-spacing: .06em; color: #${COLOR_ACENTO}; }
h1 { margin: 0 0 4pt; font-size: 19pt; line-height: 1.2; }
.pregunta { margin: 0 0 6pt; font-size: 12.5pt; font-weight: 600; }
.meta { margin: 0; font-size: 9pt; color: #${COLOR_GRIS}; }
main h1, main h2, main h3, main h4, main h5, main h6 { break-after: avoid; page-break-after: avoid; line-height: 1.25; }
main h3 { margin: 16pt 0 5pt; font-size: 14pt; color: #${COLOR_ACENTO}; }
main h4 { margin: 13pt 0 4pt; font-size: 12pt; color: #${COLOR_ACENTO}; }
main h5, main h6 { margin: 10pt 0 3pt; font-size: 10.5pt; }
p { margin: 0 0 7pt; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 7pt; padding-left: 16pt; }
li { margin: 0 0 3pt; }
a { color: #2F5D0A; text-decoration: underline; overflow-wrap: anywhere; }
table { width: 100%; margin: 4pt 0 10pt; border-collapse: collapse; font-size: 8.8pt; line-height: 1.35; }
th, td { border: 0.75pt solid #${COLOR_LINEA}; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { background: #DAE6E4; font-weight: 600; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
blockquote { margin: 6pt 0; padding: 2pt 10pt; border-left: 2pt solid #${COLOR_ACENTO}; color: #3A4A48; }
code { font-family: Consolas, ui-monospace, monospace; font-size: 9pt; background: #EEF2F1; padding: 0 2pt; border-radius: 2pt; }
pre { background: #EEF2F1; padding: 6pt 8pt; white-space: pre-wrap; border-radius: 3pt; }
pre code { background: none; padding: 0; }
hr { border: 0; border-top: 0.75pt solid #${COLOR_LINEA}; margin: 12pt 0; }
footer { margin-top: 18pt; padding-top: 8pt; border-top: 0.75pt solid #${COLOR_LINEA}; font-size: 9pt; color: #3A4A48; break-inside: avoid; }
footer h2 { margin: 0 0 4pt; font-size: 10.5pt; color: #${COLOR_TINTA}; }
footer ul { margin-bottom: 6pt; }
.nota { font-style: italic; color: #${COLOR_GRIS}; }
`;

/** El documento A4 del informe a partir del HTML de la respuesta ya pintada. */
export function documentoImpresion(html: string, meta: MetaInforme): string {
  const modelo = nombreModelo(meta.modelo);
  const consultas = resumenConsultas(meta.consultas);
  const revision = lineasRevision(meta.revision);
  const titulo = meta.pregunta ? `Vigía: ${meta.pregunta.slice(0, 90)}` : "Informe de investigación de Vigía";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title><style>${CSS_IMPRESION}</style></head><body>
<header><p class="marca">VIGÍA BY GOBSERVA | CHAT DE INVESTIGACIÓN</p><h1>Informe de investigación</h1>${meta.pregunta ? `<p class="pregunta">${esc(meta.pregunta)}</p>` : ""}<p class="meta">Fecha: ${esc(fechaLarga(meta.fecha))} (hora de Lima)</p><p class="meta">Fuente: datos públicos reunidos por Vigía by Gobserva (<a href="${SITIO}">vigia.gobserva.cloud</a>)</p></header>
<main>${html}</main>
<footer><h2>Cómo se armó este informe</h2><ul>${modelo ? `<li>Modelo: ${esc(modelo)}.</li>` : ""}<li>${consultas.length ? `Consultas a los datos de Vigía (${meta.consultas.length}): ${esc(consultas.join(", "))}.` : "Sin consultas a los datos de Vigía."}</li>${revision ? `<li>${esc(revision.cuenta)}${revision.dudosos.length ? `<ul>${revision.dudosos.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}</li>` : ""}</ul><p class="nota">${esc(NOTA_SENAL)}</p></footer>
</body></html>`;
}

/**
 * El HTML de la respuesta pintada, sin los textos para lector de pantalla («(se abre en otra pestaña)») y con las
 * columnas de cifras alineadas a la derecha (como en el Word).
 */
export function htmlDeRespuesta(el: Element): string {
  const copia = el.cloneNode(true) as Element;
  copia.querySelectorAll(".sr-only").forEach((n) => n.remove());
  // Las marcas de la revisión automática son de la pantalla: el documento va limpio (la cuenta va en el anexo).
  copia.querySelectorAll("mark[data-revision]").forEach((n) => n.replaceWith(...Array.from(n.childNodes)));
  copia.querySelectorAll("a[data-revision]").forEach((a) => {
    a.removeAttribute("data-revision");
    a.removeAttribute("title");
    a.removeAttribute("class");
    a.querySelectorAll("svg").forEach((n) => n.remove());
  });
  copia.querySelectorAll("table").forEach((tabla) => {
    const filas = Array.from(tabla.querySelectorAll("tr"));
    const celdas = filas.map((f) => Array.from(f.children) as HTMLElement[]);
    const ancho = Math.max(0, ...celdas.map((f) => f.length));
    const numericas = columnasNumericas(
      celdas.slice(1).map((f) => f.map((c) => c.textContent ?? "")),
      ancho,
    );
    for (const fila of celdas) {
      fila.forEach((c, j) => {
        if (numericas[j] && !c.style.textAlign && !c.getAttribute("align")) c.style.textAlign = "right";
      });
    }
  });
  return copia.innerHTML;
}

/**
 * Abre la ventana de imprimir con el informe (de ahí, «Guardar como PDF»). En escritorio, un marco fuera de la vista; en
 * el celular (donde imprimir un marco suele imprimir la página entera), una pestaña nueva que se imprime al cargar.
 */
export function imprimir(documento: string, nombre: string): void {
  const tactil = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  if (tactil) {
    const conAuto = documento.replace("</body>", "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)})</script></body>");
    const url = URL.createObjectURL(new Blob([conAuto], { type: "text/html;charset=utf-8" }));
    const ventana = window.open(url, "_blank");
    if (!ventana) window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  document.getElementById("vigia-impresion")?.remove();
  const marco = document.createElement("iframe");
  marco.id = "vigia-impresion";
  marco.setAttribute("aria-hidden", "true");
  marco.tabIndex = -1;
  marco.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:1200px;border:0;";
  const tituloAntes = document.title;
  const restaurar = () => {
    document.title = tituloAntes;
  };
  marco.onload = () => {
    const v = marco.contentWindow;
    if (!v) return;
    // El nombre que el navegador propone para el PDF sale del título de la página.
    document.title = nombre;
    v.addEventListener("afterprint", restaurar);
    v.focus();
    v.print();
    setTimeout(restaurar, 1500);
  };
  marco.srcdoc = documento;
  document.body.appendChild(marco);
}
