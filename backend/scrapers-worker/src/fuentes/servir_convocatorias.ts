/**
 * SERVIR Talento Perú, «Ofertas laborales» → `servir_convocatoria` (migración 93): las plazas CAS que publican las
 * entidades, con sus requisitos (experiencia, formación, conocimientos), su sueldo y sus fechas. Es el port semanal de
 * backend/scripts/cargar_servir_convocatorias.py (mismo parseo y mismo upsert), que queda de respaldo.
 *
 * SERVIR (JSF + PrimeFaces, detrás de Imperva) sólo responde a IPs del Perú: 403 desde Cloudflare y desde Zúrich. Sale por
 * el relay de Lima (backend/relay-lima) con `pedirLima`, que lleva método, formulario y cookies. La sesión (cookies y
 * ViewState) la lleva este Worker de un pedido al siguiente y de un paso al siguiente.
 *
 * Cómo se lee (medido el 2026-10-31 desde el Perú):
 *   1. GET ofertas_laborales.xhtml: la página en que va la sesión (la 1 si es nueva), su ViewState y 10 plazas.
 *   2. Cada plaza: POST del formulario con su botón «¡Ver más!» → 302 → detalle_ofertas_laborales.xhtml (el relay sigue
 *      la redirección). El botón dice la fila; la página es la que la SESIÓN tiene en el servidor.
 *   3. La página siguiente: POST AJAX de PrimeFaces con «Sig.» (partial-response con el formulario nuevo; el ViewState
 *      no cambia). Hay también «Atras», «Primero» y «Último», y ninguna forma de saltar a una página dada.
 *   ~330 páginas y ~3 300 plazas: ~3 700 pedidos, una hora con la pausa (PAUSA_MS).
 *
 * Como la página vive en la sesión del servidor, cada paso empieza con un GET que dice dónde va y, si no es donde tocaba
 * (un intento anterior del paso ya avanzó, o la sesión venció y volvió a la 1), llega con el paginador por el camino más
 * corto (Sig. o Atras, o Primero o Último y de ahí). Un ViewState vencido no da error: SERVIR rehace la vista y devuelve la
 * página donde va la sesión (un «Ver más» no llega al detalle, un «Sig.» no avanza). Eso se detecta y se resincroniza; el
 * script de Python, en cambio, se saltaba esas plazas sin avisar o cortaba la lectura.
 *
 * De a PAGINAS_POR_PASO páginas por paso. Cada paso escribe sus plazas (upsert por `aviso`: nada se borra y lo que sigue
 * publicado renueva `ultima_vez`) y deja el crudo limpio en R2. Al final, refrescar_plazas() y refrescar_plazas_extra()
 * (migración 183), y la carga en datasets_cargas. Con `seco` no escribe en la base.
 *
 * Cada día, INCREMENTAL (2026-11-08, el usuario aprobó leer SERVIR a diario): la fila del listado ya dice título,
 * entidad, número de convocatoria, ubicación, vacantes, sueldo y fechas. Con eso (`huellaFila`) se reconoce la plaza que
 * ya está en la base y NO se abre su detalle (el ~90 % del tiempo: ~1,7 s por plaza); sólo renueva `ultima_vez`. Se abre
 * el de las nuevas y el de las que cambiaron algo de eso. Las huellas repetidas (plazas idénticas salvo el aviso: ~13 %)
 * se cuentan: si el listado trae más que la base, se abre la que sobra. Los jueves (y con `forzar`), la lectura COMPLETA
 * de siempre, que también ve lo que cambia sólo en el detalle (requisitos).
 *
 * `desde` y `hasta` son PÁGINAS de SERVIR (para probar o para retomar): {"fuente":"servir_convocatorias","seco":true,
 * "hasta":"0003"} lee las 3 primeras, como `--seco --paginas 3` del script. Con 4 cifras porque POST /correr sólo deja
 * pasar `desde`/`hasta` con forma de fecha (AAAA, AAAA-MM o AAAA-MM-DD); en el Workflow también vale «3».
 *
 * Privacidad: una plaza no nombra a quién la gana. Si un texto trae un correo o un teléfono de contacto, se quita
 * (sinContactos): no se guarda ni en la base ni en R2.
 */

import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { registrarCarga } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { dormir, pedirLima, UA } from "../http.ts";
import type { PedidoLima } from "../http.ts";
import { colapsar, fechaIso, strip } from "../py.ts";
import { registrar } from "../registro.ts";
import { CARGA, esperarRelayLima, fechaLima } from "./comun.ts";

const FUENTE = "servir_convocatorias";
export const URL_SERVIR = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";
const ORIGEN = "https://app.servir.gob.pe";
const FORM = "frmLstOfertsLabo";
/**
 * Páginas por paso: ~11 pedidos por página (10 detalles y «Sig.»), unos 2 minutos por paso. Una corrida son ~35 pasos de
 * ~1,5 KB de resultado y ~3 800 subpedidos (relay, base y R2): lejos de los límites de Workflows en el plan pago (10 000
 * pasos y 10 000 subpedidos por instancia, 1 MiB por resultado de paso, 30 s de CPU por paso: el parseo usa ~0,2 ms por
 * página).
 */
export const PAGINAS_POR_PASO = 10;
/** Entre pedido y pedido a SERVIR (el script de Python esperaba 0,3 s entre detalles). */
export const PAUSA_MS = 500;
/** Lo que puede durar un intento de un paso antes de dejar de pedir: menos que el timeout del paso (PASO). */
const LIMITE_TANDA_MS = 17 * 60_000;
/** Resincronizaciones (GET y volver a la página) por camino antes de rendirse y dejar el paso a los reintentos. */
const MAX_FALLOS = 8;
const PASO: WorkflowStepConfig = { retries: { limit: 3, delay: "2 minutes", backoff: "exponential" }, timeout: "20 minutes" };

// ── html.unescape de Python ─────────────────────────────────────────────────────────────────────────────────────────
// Las del Latin-1 (de U+00A0 a U+00FF, en orden): en HTML5 valen también sin punto y coma.
const LATIN1 = ("nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute " +
  "micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil " +
  "Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute " +
  "Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute " +
  "icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml").split(" ");
/** Las que HTML5 acepta sin punto y coma («&amp», «&aacute»…): Python las reconoce también como prefijo («&ampx» → «&x»). */
const SIN_PUNTO: Record<string, string> = {
  amp: "&", AMP: "&", lt: "<", LT: "<", gt: ">", GT: ">", quot: '"', QUOT: '"', COPY: "©", REG: "®",
  ...Object.fromEntries(LATIN1.map((n, i) => [n, String.fromCodePoint(0xa0 + i)])),
};
/** Las demás que pueden salir en un texto, con punto y coma. */
const CON_PUNTO: Record<string, string> = {
  ...SIN_PUNTO, apos: "'", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  bull: "•", hellip: "…", prime: "′", Prime: "″", euro: "€", trade: "™", OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š",
  Yuml: "Ÿ", fnof: "ƒ", circ: "ˆ", tilde: "˜", ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwnj: "\u200c", zwj: "\u200d",
  lrm: "\u200e", rlm: "\u200f", dagger: "†", Dagger: "‡", permil: "‰", lsaquo: "‹", rsaquo: "›", larr: "←", rarr: "→",
  uarr: "↑", darr: "↓", harr: "↔", minus: "−", le: "≤", ge: "≥", ne: "≠", infin: "∞", check: "✓", Tab: "\t", NewLine: "\n",
  excl: "!", num: "#", dollar: "$", percnt: "%", lpar: "(", rpar: ")", ast: "*", plus: "+", comma: ",", period: ".",
  sol: "/", colon: ":", semi: ";", equals: "=", quest: "?", commat: "@", lsqb: "[", lbrack: "[", bsol: "\\", rsqb: "]",
  rbrack: "]", Hat: "^", lowbar: "_", grave: "`", lcub: "{", lbrace: "{", verbar: "|", vert: "|", rcub: "}", rbrace: "}",
};
/** &#128; a &#159; se leen como cp1252 (lo que hace Python). */
const CP1252 = "€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ";
const RE_REFERENCIA = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/g;

function referencia(_m: string, s: string): string {
  if (s[0] === "#") {
    const hexa = s[1] === "x" || s[1] === "X";
    const n = parseInt(s.slice(hexa ? 2 : 1).replace(/;$/, ""), hexa ? 16 : 10);
    if (n === 0) return "\ufffd";
    if (n === 0x0d) return "\r";
    if (n >= 0x80 && n <= 0x9f) return CP1252[n - 0x80];
    if ((n >= 0xd800 && n <= 0xdfff) || n > 0x10ffff) return "\ufffd";
    // Los que Python descarta: controles, no caracteres y los que terminan en FFFE/FFFF.
    if ((n >= 0x1 && n <= 0x8) || n === 0xb || (n >= 0xe && n <= 0x1f) || n === 0x7f || (n >= 0xfdd0 && n <= 0xfdef) || (n & 0xfffe) === 0xfffe) return "";
    return String.fromCodePoint(n);
  }
  if (s.endsWith(";")) {
    const v = CON_PUNTO[s.slice(0, -1)];
    if (v !== undefined && Object.hasOwn(CON_PUNTO, s.slice(0, -1))) return v;
  } else if (Object.hasOwn(SIN_PUNTO, s)) {
    return SIN_PUNTO[s];
  }
  // El nombre más largo que HTML5 acepta sin punto y coma, y el resto tal cual («&notin» → «¬in»).
  for (let x = s.length - 1; x > 1; x--) if (Object.hasOwn(SIN_PUNTO, s.slice(0, x))) return SIN_PUNTO[s.slice(0, x)] + s.slice(x);
  return `&${s}`;
}

/** `html.unescape` de Python: numéricas (con sus reglas para 0, 128-159 y lo inválido) y nombradas, con o sin «;». */
export function desescapar(s: string): string {
  return s.includes("&") ? s.replace(RE_REFERENCIA, referencia) : s;
}

// ── El parseo de cargar_servir_convocatorias.py, al carácter ────────────────────────────────────────────────────────
/** `limpio()`: sin etiquetas, desescapado y con los espacios juntados; null si queda vacío. */
export function limpio(t: string | null | undefined): string | null {
  if (t == null) return null;
  return colapsar(desescapar(t.replace(/<[^>]+>/g, " "))) || null;
}

/** `texto_plano()`: el texto de cada celda del HTML (sin scripts ni estilos), separado por « | ». */
export function textoPlano(h: string): string {
  return h.replace(/<script.*?<\/script>|<style.*?<\/style>/gs, " ").split(/<[^>]+>/).map((p) => colapsar(desescapar(p))).filter((x) => x).join(" | ");
}

export function viewState(h: string): string | null {
  const m = /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/.exec(h) ?? /<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]>/.exec(h);
  return m ? m[1] : null;
}

/** `campos()`: los campos del formulario (texto, ocultos y selects), sin los botones. */
export function campos(h: string): Record<string, string> {
  const f: Record<string, string> = {};
  for (const m of h.matchAll(/<input\b[^>]*>/g)) {
    const etiqueta = m[0];
    const n = /name="([^"]+)"/.exec(etiqueta);
    if (!n || !n[1].startsWith(FORM) || /type="(submit|button)"/.test(etiqueta)) continue;
    const v = /value="([^"]*)"/.exec(etiqueta);
    f[n[1]] = v ? desescapar(v[1]) : "";
  }
  for (const m of h.matchAll(new RegExp(`<select\\b[^>]*name="(${FORM}[^"]*)"`, "g"))) if (!Object.hasOwn(f, m[1])) f[m[1]] = "";
  return f;
}

/** Los botones del paginador, por su texto (el primero que aparece: el paginador de arriba). */
export type Boton = "primero" | "atras" | "siguiente" | "ultimo";
const TEXTO_BOTON: Record<Boton, string> = { primero: "Primero", atras: "Atras", siguiente: "Sig\\.", ultimo: ".ltimo" };

export function boton(h: string, b: Boton): string | null {
  const m = new RegExp(`<button id="(${FORM}:j_idt\\d+)"(?:(?!</button>).)*?>${TEXTO_BOTON[b]}</span>`, "s").exec(h);
  return m ? m[1] : null;
}

/** `boton_siguiente()`. */
export const botonSiguiente = (h: string) => boton(h, "siguiente");

/** `botones_ver_mas()`: los «¡Ver más!» de la página, en orden. */
export function botonesVerMas(h: string): string[] {
  return [...h.matchAll(new RegExp(`<button id="(${FORM}:idPnlRepeatPuestos:\\d+:j_idt\\d+)"[^>]*title="[^"]*Ver m`, "g"))].map((m) => m[1]);
}

/** `pagina_de()`: «Página 3 de 330» → [3, 330]. */
export function paginaDe(h: string): [number, number] | null {
  const m = /P.gina (\d+) de (\d+)/.exec(h);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** `fecha()`: «30/10/2026» → «2026-10-30». A diferencia de Python, una fecha que no existe da null (la base la rechazaría). */
export function fecha(t: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t ?? "");
  return m ? fechaIso(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/**
 * `monto()`: «S/. 2,572.00» → 2572 (null si no hay número, o si no cabe en NUMERIC(14, 2)). Sin punto y con dos cifras
 * tras la última coma, esa coma es la de los decimales: «S/. 8,364,19» → 8364.19 y «S/ 2500,00» → 2500 (2026-11-01:
 * antes salían 836419 y 250000, la plaza encabezaba «Las mejor pagadas» y se marcaba con sueldo alto).
 */
export function monto(t: string | null | undefined): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(t ?? "");
  if (!m) return null;
  const s = m[1];
  const n = /^\d+(?:,\d{3})*,\d{2}$/.test(s) ? Number(`${s.slice(0, -3).replaceAll(",", "")}.${s.slice(-2)}`) : Number(s.replaceAll(",", ""));
  if (!Number.isFinite(n) || n >= 1e12) return null;
  // Un sueldo CAS mensual no pasa de ~S/ 20 mil (el tope es S/ 15,600). 100 mil o más que entre 100 da un sueldo posible
  // son céntimos leídos como soles, en un formato que todavía no reconocemos (2026-11-08: 836419, 320019, 300019).
  return n >= 100_000 && n / 100 <= 30_000 ? Math.round(n) / 100 : n;
}

const ETIQUETAS = {
  experiencia: "EXPERIENCIA:", formacion: "FORMACIÓN ACADÉMICA - PERFIL:", especializacion: "ESPECIALIZACIÓN:",
  conocimiento: "CONOCIMIENTO:", competencias: "COMPETENCIAS:", detalle_url: "DETALLE:", vacantes: "CANTIDAD DE VACANTES:",
  numero: "NÚMERO DE CONVOCATORIA:", remuneracion: "REMUNERACIÓN:", fecha_inicio: "FECHA INICIO DE PUBLICACIÓN:",
  fecha_fin: "FECHA FIN DE PUBLICACIÓN:", entidad: "INSTITUCIÓN:",
} as const;
type Clave = keyof typeof ETIQUETAS;
const ES_ETIQUETA = new Set<string>(Object.values(ETIQUETAS));
const MAX_INT = 2_147_483_647;

/** Una plaza: las columnas de `servir_convocatoria` que se cargan (las demás las calcula refrescar_plazas()). */
export interface Plaza {
  aviso: number;
  titulo: string;
  entidad: string;
  ubicacion: string | null;
  numero: string | null;
  vacantes: number | null;
  remuneracion: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  experiencia: string | null;
  formacion: string | null;
  especializacion: string | null;
  conocimiento: string | null;
  competencias: string | null;
  detalle_url: string | null;
}

/**
 * `vacantes_de()`: la cantidad de vacantes, o null si no es una cantidad. Algunos avisos traen en esa celda el sueldo (el
 * 2026-11-02, «Secretario judicial»: 6,620 vacantes y S/ 6,620): un número de más de 50 igual al sueldo no se cuenta (los
 * tres que había inflaban el total de 4,836 a 20,716 vacantes).
 */
export function vacantesDe(texto: string | null | undefined, remuneracion: number | null): number | null {
  if (/S\/|\d[.,]\d{2}\b/.test(texto ?? "")) return null; // un monto, no una cantidad
  const m = /\d+/.exec(texto ?? "");
  const n = m ? Number(m[0]) : null;
  if (n === null || n > MAX_INT) return null;
  if (n > 50 && remuneracion !== null && n === Math.round(remuneracion)) return null;
  return n;
}

/**
 * `parsear_detalle()`: el detalle de una plaza. Cada dato es el texto que sigue a su etiqueta (las celdas van separadas
 * por «|»); el aviso es el «N° 823283» solo en su celda, junto a «Imprimir aviso» (el menú nombra decretos con «N°»).
 */
export function parsearDetalle(h: string): Plaza | null {
  const plano = textoPlano(h);
  const partes = plano.split("|").map(strip);
  const d: Partial<Record<Clave, string>> = {};
  for (const [clave, etiqueta] of Object.entries(ETIQUETAS) as [Clave, string][]) {
    for (let i = 0; i < partes.length; i++) {
      if (partes[i].toUpperCase() === etiqueta && i + 1 < partes.length && !ES_ETIQUETA.has(partes[i + 1].toUpperCase())) {
        d[clave] = partes[i + 1];
        break;
      }
    }
  }
  const avisos = [...plano.matchAll(/\|\s*N°\s*(\d{5,})\s*\|/g)].map((m) => m[1]);
  const aviso = avisos.length ? Number(/^\d+/.exec(avisos[avisos.length - 1])![0]) : null;
  const i = partes.indexOf("Resumen del Aviso");
  const titulo = i >= 0 && i + 1 < partes.length ? partes[i + 1] : null;
  if (aviso === null || aviso > MAX_INT || !titulo || !d.entidad) return null;
  const ubic = /Ubicaci.n:\s*\|\s*([^|]+)/.exec(plano);
  const remuneracion = monto(d.remuneracion);
  return {
    aviso, titulo, entidad: d.entidad, ubicacion: ubic ? strip(ubic[1]) : null, numero: d.numero ?? null,
    vacantes: vacantesDe(d.vacantes, remuneracion), remuneracion,
    fecha_inicio: fecha(d.fecha_inicio), fecha_fin: fecha(d.fecha_fin), experiencia: d.experiencia ?? null,
    formacion: d.formacion ?? null, especializacion: d.especializacion ?? null, conocimiento: d.conocimiento ?? null,
    competencias: d.competencias ?? null, detalle_url: (d.detalle_url ?? "").startsWith("http") ? d.detalle_url! : null,
  };
}

/** `ubicaciones_del_listado()`: la ubicación de cada plaza del listado, en orden (el detalle no siempre la trae). */
export function ubicacionesDelListado(h: string): (string | null)[] {
  return [...h.matchAll(/Ubicaci.n:<\/span>(.*?)<\/span>/gs)].map((m) => limpio(m[1]));
}

/**
 * La respuesta AJAX de PrimeFaces trae el formulario dentro de un CDATA: se arma una página con él y el ViewState nuevo
 * (lo de `leer_todo()` tras «Sig.»).
 */
export function paginaParcial(xml: string, vistaAnterior: string): string {
  const cuerpo = [...xml.matchAll(/<!\[CDATA\[(.*?)\]\]>/gs)].map((m) => m[1]).join("");
  return `${cuerpo}<input type="hidden" name="javax.faces.ViewState" value="${viewState(xml) ?? vistaAnterior}" />`;
}

// ── Lo que el port agrega ───────────────────────────────────────────────────────────────────────────────────────────
/** Lo que una fila del listado dice de su plaza sin abrir el detalle. */
export interface FilaListado {
  titulo: string | null;
  entidad: string | null;
  ubicacion: string | null;
  numero: string | null;
  vacantes: number | null;
  remuneracion: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

/** Las filas del listado, en orden: cada «cuadro-vacantes» con su título, su entidad y sus datos. */
export function filasDelListado(h: string): FilaListado[] {
  return h.split('cuadro-vacantes"').slice(1).map((b) => {
    // «Fecha Inicio de⏎Publicación:»: la etiqueta puede venir partida en renglones.
    const dato = (et: string) => limpio(new RegExp(`${et}\\s*:\\s*</span>\\s*<span[^>]*>(.*?)</span>`, "s").exec(b)?.[1]);
    const remuneracion = monto(dato("Remuneraci.n"));
    return {
      titulo: limpio(/titulo-vacante[^>]*><label>(.*?)<\/label>/s.exec(b)?.[1]),
      entidad: limpio(/nombre-entidad[^>]*>.*?<b>(.*?)<\/b>/s.exec(b)?.[1]),
      ubicacion: dato("Ubicaci.n"),
      numero: dato("N.mero\\s+de\\s+Convocatoria"),
      vacantes: vacantesDe(dato("Cantidad\\s+de\\s+Vacantes"), remuneracion),
      remuneracion,
      fecha_inicio: fecha(dato("Fecha\\s+Inicio\\s+de\\s+Publicaci.n")),
      fecha_fin: fecha(dato("Fecha\\s+Fin\\s+de\\s+Publicaci.n")),
    };
  });
}

const normal = (t: string | null | undefined) =>
  (t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/**
 * La huella de una plaza con lo que se ve en el listado: la misma desde una fila del listado o desde la fila de la base
 * (que se cargó del detalle). Si cambia cualquiera de esos datos, la plaza se vuelve a leer entera.
 */
export function huellaFila(f: FilaListado): string {
  return [normal(f.titulo), normal(f.entidad), normal(f.numero), normal(f.ubicacion), f.vacantes ?? "",
    f.remuneracion == null ? "" : Number(f.remuneracion).toFixed(2), f.fecha_inicio ?? "", f.fecha_fin ?? ""].join("|");
}

/** Las plazas de la base que el listado puede traer (las que no vencieron hace más de 3 días), por su huella. */
export const SQL_CONOCIDAS = `
  SELECT aviso, titulo, entidad, numero, ubicacion, vacantes, remuneracion::float8 AS remuneracion,
         to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin
    FROM servir_convocatoria WHERE fecha_fin >= (now() AT TIME ZONE 'America/Lima')::date - 3`;

/** Huella → los avisos de la base con esa huella (más de uno: plazas idénticas salvo el aviso). */
export function mapaConocidas(filas: (FilaListado & { aviso: number })[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const f of filas) {
    const h = huellaFila(f);
    const xs = m.get(h);
    if (xs) xs.push(f.aviso);
    else m.set(h, [f.aviso]);
  }
  return m;
}

/** Lo que hace falta de una página del listado para pedir sus plazas y moverse: chico y serializable. */
export interface Listado {
  pagina: number;
  paginas: number;
  vista: string;
  campos: Record<string, string>;
  verMas: string[];
  ubicaciones: (string | null)[];
  /** El título de cada fila: para comprobar que el detalle que llega es el de esa fila. */
  titulos: (string | null)[];
  /** La huella de cada fila (huellaFila): para no abrir el detalle de una plaza que ya está en la base. */
  huellas: string[];
  botones: Partial<Record<Boton, string>>;
  /** «3299 puesto(s) encontrado(s) en total.»: sólo lo trae el GET. */
  puestos: number | null;
}

/** Una página del listado (la de un GET o la armada con paginaParcial); null si no es el listado. */
export function parsearListado(h: string): Listado | null {
  const pg = paginaDe(h);
  const vista = viewState(h);
  if (!pg || !vista || !h.includes(`id="${FORM}"`)) return null;
  const botones: Partial<Record<Boton, string>> = {};
  for (const b of ["primero", "atras", "siguiente", "ultimo"] as Boton[]) {
    const id = boton(h, b);
    if (id) botones[b] = id;
  }
  const puestos = /(\d+) puesto\(s\) encontrado\(s\)/.exec(h);
  return {
    pagina: pg[0], paginas: pg[1], vista, campos: campos(h), verMas: botonesVerMas(h), ubicaciones: ubicacionesDelListado(h),
    titulos: [...h.matchAll(/titulo-vacante[^>]*><label>(.*?)<\/label>/gs)].map((m) => limpio(m[1])), botones,
    huellas: filasDelListado(h).map(huellaFila),
    puestos: puestos ? Number(puestos[1]) : null,
  };
}

/**
 * Qué botón acerca más a la página `n` desde la `m` (de `y`), entre los que trae la página: Sig. o Atras de a una, o
 * Primero o Último y de ahí. Tras un clic exitoso el camino que queda es uno más corto. null si no hay cómo.
 */
export function caminoA(m: number, n: number, y: number, hay: Partial<Record<Boton, unknown>> = { primero: 1, atras: 1, siguiente: 1, ultimo: 1 }): Boton | null {
  const opciones: [Boton, number][] = [];
  if (n > m) opciones.push(["siguiente", n - m]);
  if (n < m) opciones.push(["atras", m - n]);
  if (m !== 1) opciones.push(["primero", n]);
  if (m !== y) opciones.push(["ultimo", 1 + y - n]);
  const posibles = opciones.filter(([b]) => hay[b]);
  return posibles.length ? posibles.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : null;
}

const RE_CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** Un teléfono con su palabra delante: «TELÉFONO: (01) 234-5678», «CEL. 987 654 321», «WHATSAPP 987654321». */
const RE_TELEFONO = /\b(TEL[EÉ]FONOS?|TELFS?|TEL|CEL(?:ULAR(?:ES)?)?|M[OÓ]VIL(?:ES)?|WHATS ?APP|WSP|FONO)(\.?\s*(?:N[°º]\s*)?[:.]?\s*)((?:\+?51\s*)?\(?\d[\d\s()-]{4,}\d)/giu;
/** Un celular peruano suelto: 9 dígitos que empiezan con 9, juntos o de a 3 («987654321», «987 654 321»). */
const RE_CELULAR = /(?<![\d.,])(?:\+?51\s?)?9\d{2}[\s-]?\d{3}[\s-]?\d{3}(?![\d.,]\d|\d)/g;
export const OMITIDO = "[contacto omitido]";

/** Un texto sin correos ni teléfonos de contacto (se reemplazan por OMITIDO). Devuelve el texto y cuántos quitó. */
export function sinContactos(t: string): { texto: string; quitados: number } {
  let quitados = 0;
  const texto = t
    .replace(RE_CORREO, () => (quitados++, OMITIDO))
    .replace(RE_TELEFONO, (m, palabra: string, sep: string, numero: string) =>
      (numero.match(/\d/g)?.length ?? 0) >= 6 ? (quitados++, `${palabra}${sep}${OMITIDO}`) : m)
    .replace(RE_CELULAR, () => (quitados++, OMITIDO));
  return { texto, quitados };
}

const TEXTOS = ["titulo", "experiencia", "formacion", "especializacion", "conocimiento", "competencias"] as const;

/** La plaza como se guarda: sin contactos en los textos, sin enlaces de WhatsApp ni con correo, y sin NUL (Postgres no los acepta). */
export function paraGuardar(d: Plaza): { plaza: Plaza; quitados: number } {
  const p: Plaza = { ...d };
  let quitados = 0;
  for (const c of TEXTOS) {
    if (p[c] == null) continue;
    const r = sinContactos(p[c]!);
    quitados += r.quitados;
    (p as unknown as Record<string, string | null>)[c] = r.texto;
  }
  if (p.detalle_url && /@|wa\.me\/|whatsapp\./i.test(p.detalle_url)) {
    p.detalle_url = null;
    quitados++;
  }
  for (const [k, v] of Object.entries(p)) if (typeof v === "string" && v.includes("\u0000")) (p as unknown as Record<string, string>)[k] = v.replaceAll("\u0000", "");
  return { plaza: p, quitados };
}

// ── La sesión con SERVIR ────────────────────────────────────────────────────────────────────────────────────────────
/** Lo que vuelve de un pedido a SERVIR: status del origen (null si falló el relay), URL final, texto y cookies nuevas. */
export interface RespuestaServir {
  status: number | null;
  url: string;
  texto: string;
  cookies: Record<string, string>;
}
/** Cómo se le pide algo a SERVIR: por el relay de Lima en el Worker; una SERVIR simulada en las pruebas. */
export type Transporte = (p: PedidoLima) => Promise<RespuestaServir>;

export function transporteLima(env: Env): Transporte {
  return async (p) => {
    const r = await pedirLima(env, p);
    return { status: r.origen, url: r.url, texto: await r.respuesta.text(), cookies: r.cookies };
  };
}

/** El intento del paso ya usó su tiempo: no se pide nada más (el paso lo reintenta Workflows). */
export class TiempoAgotado extends Error {}

const formulario = (campos: Record<string, string>) => new URLSearchParams(Object.entries(campos)).toString();
const resumirTexto = (t: string) => colapsar(t.replace(/<script.*?<\/script>|<style.*?<\/style>/gs, " ").replace(/<[^>]+>/g, " ")).slice(0, 160);
const mismoTitulo = (a: string, b: string) => colapsar(a).toUpperCase() === colapsar(b).toUpperCase();

export interface OpcionesSesion {
  pausaMs?: number;
  /** Ms de reloj que puede durar la sesión pidiendo (por defecto, LIMITE_TANDA_MS). */
  limiteMs?: number;
}

/**
 * Una sesión con SERVIR: las cookies (JSESSIONID y las de Imperva) y la última página del listado. Todo lo que hace falta
 * para seguir en otro paso son las cookies (`cookies`) y el número de página.
 */
export class SesionServir {
  cookies: Record<string, string>;
  listado: Listado | null = null;
  pedidos = 0;
  resincronizaciones = 0;
  /** Los puestos que SERVIR dice tener (el último GET que lo trajo). */
  puestos: number | null = null;
  /** Detalles seguidos que no se pudieron bajar. */
  private fallidas = 0;
  private readonly pedir: Transporte;
  private readonly pausaMs: number;
  private readonly limite: number;

  constructor(pedir: Transporte, cookies: Record<string, string> = {}, op: OpcionesSesion = {}) {
    this.pedir = pedir;
    this.cookies = { ...cookies };
    this.pausaMs = op.pausaMs ?? PAUSA_MS;
    this.limite = Date.now() + (op.limiteMs ?? LIMITE_TANDA_MS);
  }

  private async pedido(metodo: "GET" | "POST", cuerpo?: string, ajax = false): Promise<RespuestaServir> {
    if (Date.now() > this.limite) throw new TiempoAgotado("la tanda pasó su tiempo: la sigue el reintento del paso");
    if (this.pedidos > 0) await dormir(this.pausaMs);
    this.pedidos++;
    const cabeceras: Record<string, string> = {
      "User-Agent": UA, "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
      Accept: ajax ? "application/xml, text/xml, */*; q=0.01" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    const galletas = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    if (galletas) cabeceras.Cookie = galletas;
    if (metodo === "POST") Object.assign(cabeceras, { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Origin: ORIGEN, Referer: URL_SERVIR });
    if (ajax) Object.assign(cabeceras, { "Faces-Request": "partial/ajax", "X-Requested-With": "XMLHttpRequest" });
    // «Sig.» y los demás botones del paginador mueven la página de la sesión: no se repiten a ciegas (irA comprueba).
    const r = await this.pedir({ url: URL_SERVIR, metodo, cabeceras, ...(cuerpo === undefined ? {} : { cuerpo }), ...(ajax ? { sinReintentos: true } : {}) });
    Object.assign(this.cookies, r.cookies);
    return r;
  }

  /** GET del listado: la página donde va la sesión en el servidor (la 1 si es nueva o venció), con un ViewState nuevo. */
  async abrir(): Promise<Listado> {
    const r = await this.pedido("GET");
    const l = r.status === 200 ? parsearListado(r.texto) : null;
    if (!l) {
      throw new Error(`SERVIR no devolvió el listado (${r.status === null ? "el relay de Lima no llegó" : `HTTP ${r.status}`}): ${resumirTexto(r.texto)}`);
    }
    if (l.puestos !== null) this.puestos = l.puestos;
    return (this.listado = l);
  }

  /** Un botón del paginador (POST AJAX). La página que devuelve, o null si no vino un listado. */
  private async navegar(b: Boton): Promise<Listado | null> {
    const l = this.listado!;
    const id = l.botones[b];
    if (!id) return null;
    const r = await this.pedido("POST", formulario({
      "javax.faces.partial.ajax": "true", "javax.faces.source": id, "javax.faces.partial.execute": "@all",
      "javax.faces.partial.render": `${FORM}:mensaje ${FORM}`, [id]: id, [FORM]: FORM, ...l.campos, "javax.faces.ViewState": l.vista,
    }), true);
    if (r.status !== 200) throw new Error(`«${b}» de SERVIR: ${r.status === null ? "el relay de Lima no llegó" : `HTTP ${r.status}`}`);
    return parsearListado(paginaParcial(r.texto, l.vista));
  }

  /**
   * Lleva la sesión a la página `n` con el paginador, comprobando la página que vuelve en cada clic. Si un clic no hace lo
   * esperado (ViewState vencido: SERVIR devuelve la página donde va, con un ViewState nuevo), se sigue desde ahí; si no
   * vuelve nada legible, se reabre con un GET.
   */
  async irA(n: number): Promise<Listado> {
    let l = this.listado ?? (await this.abrir());
    for (let fallos = 0; l.pagina !== n; ) {
      if (n < 1 || n > l.paginas) throw new Error(`SERVIR no tiene la página ${n} (tiene ${l.paginas})`);
      const b = caminoA(l.pagina, n, l.paginas, l.botones);
      if (!b) throw new Error(`la página ${l.pagina} de SERVIR no trae los botones para ir a la ${n}`);
      const esperada = b === "siguiente" ? l.pagina + 1 : b === "atras" ? l.pagina - 1 : b === "primero" ? 1 : l.paginas;
      let nuevo: Listado | null = null;
      try {
        nuevo = await this.navegar(b);
      } catch (e) {
        if (e instanceof TiempoAgotado) throw e;
        registrar("WARNING", `   SERVIR, de la página ${l.pagina} a la ${n}: ${String((e as Error)?.message ?? e).slice(0, 160)}`, { fuente: FUENTE });
      }
      if (nuevo && nuevo.pagina === esperada) {
        l = this.listado = nuevo;
        continue;
      }
      if (++fallos > MAX_FALLOS) throw new Error(`no se pudo llevar la sesión de SERVIR a la página ${n} (va en la ${l.pagina})`);
      this.resincronizaciones++;
      l = this.listado = nuevo ?? (await this.abrir());
    }
    return l;
  }

  /**
   * «¡Ver más!» de la fila `k` de la página actual: la plaza, o null si el detalle no se lee o no se puede bajar (como en
   * Python, se salta; tres seguidas cortan: es que SERVIR o el relay no responden). Si no llega al detalle (ViewState o
   * sesión vencidos) o llega el de otra fila, se reabre la sesión, se vuelve a la página y se pide otra vez.
   */
  async plaza(k: number): Promise<Plaza | null> {
    let cortes = 0;
    let reaperturas = 0;
    for (;;) {
      const l = this.listado!;
      if (k >= l.verMas.length) return null;
      let r: RespuestaServir | null = null;
      let problema = "";
      try {
        r = await this.pedido("POST", formulario({ [FORM]: FORM, ...l.campos, [l.verMas[k]]: "", "javax.faces.ViewState": l.vista }));
      } catch (e) {
        if (e instanceof TiempoAgotado) throw e;
        problema = String((e as Error)?.message ?? e);
        // Un corte de la conexión se reintenta tal cual: «Ver más» no mueve la página.
        if (++cortes < 3) {
          registrar("WARNING", `   SERVIR, plaza ${k + 1} de la página ${l.pagina}: ${problema.slice(0, 160)}; otra vez`, { fuente: FUENTE });
          continue;
        }
      }
      // Los 5xx ya los reintentó pedirLima.
      if (r && r.status !== 200) problema = r.status === null ? `el relay de Lima no llegó (${resumirTexto(r.texto)})` : `HTTP ${r.status}`;
      if (problema) {
        if (++this.fallidas >= 3) throw new Error(`SERVIR no responde los detalles de las plazas: ${problema.slice(0, 200)}`);
        registrar("WARNING", `   SERVIR, plaza ${k + 1} de la página ${l.pagina}: ${problema.slice(0, 160)}; se salta`, { fuente: FUENTE });
        return null;
      }
      if (r && r.url.includes("detalle_ofertas_laborales") && r.texto.includes("frmDetaOferLabo")) {
        this.fallidas = 0;
        const d = parsearDetalle(r.texto);
        if (!d) return null;
        if (!d.ubicacion && k < l.ubicaciones.length) d.ubicacion = l.ubicaciones[k];
        // La fila del botón (idPnlRepeatPuestos:<fila>:…): el título de esa fila tiene que ser el del detalle.
        const fila = Number(/:idPnlRepeatPuestos:(\d+):/.exec(l.verMas[k])?.[1] ?? k);
        const esperado = l.titulos[fila];
        if (!esperado || mismoTitulo(esperado, d.titulo)) return d;
        if (reaperturas > 0) {
          registrar("WARNING", `   SERVIR, página ${l.pagina} fila ${fila + 1}: el listado dice «${esperado.slice(0, 80)}» y el detalle «${d.titulo.slice(0, 80)}»; se guarda el detalle`, { fuente: FUENTE });
          return d;
        }
      }
      if (reaperturas >= 2) throw new Error(`la plaza ${k + 1} de la página ${l.pagina} de SERVIR no llegó a su detalle tras reabrir la sesión`);
      reaperturas++;
      this.resincronizaciones++;
      await this.abrir();
      await this.irA(l.pagina);
    }
  }
}

// ── La carga ────────────────────────────────────────────────────────────────────────────────────────────────────────
const COLS = ["aviso", "titulo", "entidad", "ubicacion", "numero", "vacantes", "remuneracion", "fecha_inicio", "fecha_fin", "experiencia",
  "formacion", "especializacion", "conocimiento", "competencias", "detalle_url"] as const;
const ACTUALIZABLES = COLS.filter((c) => c !== "aviso");

/**
 * El upsert del script (por `aviso`, todo se actualiza y `ultima_vez = now()`), que además cuenta cuántas son nuevas
 * (xmax = 0: la fila se insertó), cuántas ya estaban y, de ésas, cuántas cambiaron algún dato.
 */
export const SQL_UPSERT = `
  WITH x AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x (
      aviso INT, titulo TEXT, entidad TEXT, ubicacion TEXT, numero TEXT, vacantes INT, remuneracion NUMERIC, fecha_inicio DATE,
      fecha_fin DATE, experiencia TEXT, formacion TEXT, especializacion TEXT, conocimiento TEXT, competencias TEXT, detalle_url TEXT)),
  antes AS (
    SELECT s.aviso, (${ACTUALIZABLES.map((c) => `s.${c}`).join(", ")}) IS DISTINCT FROM (${ACTUALIZABLES.map((c) => `x.${c}`).join(", ")}) AS cambio
      FROM servir_convocatoria s JOIN x ON x.aviso = s.aviso),
  up AS (
    INSERT INTO servir_convocatoria AS s (${COLS.join(", ")})
    SELECT ${COLS.join(", ")} FROM x
    ON CONFLICT (aviso) DO UPDATE SET ${ACTUALIZABLES.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, ultima_vez = now()
    RETURNING s.aviso, (s.xmax = 0) AS nueva)
  SELECT count(*) FILTER (WHERE up.nueva)::int AS nuevas, count(*) FILTER (WHERE NOT up.nueva)::int AS actualizadas,
         count(*) FILTER (WHERE antes.cambio)::int AS "conCambios"
    FROM up LEFT JOIN antes ON antes.aviso = up.aviso`;

/** Lo que pasa de un paso al siguiente: la sesión (sus cookies), la página que toca y el día de la corrida. */
export interface Estado {
  cookies: Record<string, string>;
  pagina: number;
  dia: string;
  /** Sin abrir el detalle de las plazas que ya están en la base (todos los días salvo los jueves). */
  incremental?: boolean;
  /** De las huellas repetidas en la base, cuántas filas ya se reconocieron (para abrir la que sobre). */
  repetidas?: Record<string, number>;
}

export interface Tanda {
  estado: Estado;
  terminado: boolean;
  desde: number;
  hasta: number;
  paginasServir: number;
  puestos: number | null;
  avisos: number[];
  /** Plazas reconocidas por su huella, sin abrir el detalle. */
  conocidas: number;
  sinDatos: number;
  quitados: number;
  nuevas: number;
  actualizadas: number;
  conCambios: number;
  pedidos: number;
  resincronizaciones: number;
}

export interface OpcionesCorrida extends OpcionesSesion {
  /** Para las pruebas: otra SERVIR en vez del relay de Lima. */
  transporte?: Transporte;
  /** Para las pruebas: las huellas de la base (si no, SQL_CONOCIDAS). */
  conocidas?: Map<string, number[]>;
  /** Para las pruebas: el instante que decide si hoy toca la lectura completa (jueves). */
  ahora?: number;
}

/** Un paso: de la página `estado.pagina` hasta `hasta` (o la última), sus plazas a la base y el crudo limpio a R2. */
export async function leerTanda(env: Env, p: ParamsCorrida, estado: Estado, hasta: number, op: OpcionesCorrida = {}): Promise<Tanda> {
  const ses = new SesionServir(op.transporte ?? transporteLima(env), estado.cookies, op);
  const abierta = await ses.abrir();
  const vacia = { avisos: [], conocidas: 0, sinDatos: 0, quitados: 0, nuevas: 0, actualizadas: 0, conCambios: 0, pedidos: ses.pedidos, resincronizaciones: 0 };
  if (estado.pagina > abierta.paginas) {
    // La lista se achicó entre un paso y otro (una sesión nueva ve las plazas de ese momento): ya no queda nada por leer.
    return { estado: { ...estado, cookies: ses.cookies }, terminado: true, desde: estado.pagina, hasta: estado.pagina - 1,
      paginasServir: abierta.paginas, puestos: ses.puestos, ...vacia };
  }
  let l = await ses.irA(estado.pagina);
  const desde = l.pagina;
  // Por aviso, como el dict del script: una plaza repetida queda en su primer lugar con lo último que se leyó.
  const plazas = new Map<number, Plaza>();
  let sinDatos = 0;
  let quitados = 0;
  // Incremental: las huellas de la base y las plazas que se reconocen sin abrir su detalle.
  const conocidas = estado.incremental
    ? (op.conocidas ?? mapaConocidas(await conDb(env.HYPERDRIVE, (db) => db.filas<FilaListado & { aviso: number }>(SQL_CONOCIDAS))))
    : null;
  const repetidas = { ...(estado.repetidas ?? {}) };
  const reconocidos = new Set<number>();
  let nReconocidas = 0;
  for (;;) {
    const pagina = ses.listado!;
    for (let k = 0; k < pagina.verMas.length; k++) {
      if (conocidas) {
        const fila = Number(/:idPnlRepeatPuestos:(\d+):/.exec(pagina.verMas[k])?.[1] ?? k);
        const h = pagina.huellas[fila];
        const avisos = h ? conocidas.get(h) : undefined;
        const vistas = avisos && avisos.length > 1 ? (repetidas[h] ?? 0) : 0;
        if (avisos && vistas < avisos.length) {
          if (avisos.length > 1) repetidas[h] = vistas + 1;
          for (const a of avisos) reconocidos.add(a);
          nReconocidas++;
          continue;
        }
      }
      const d = await ses.plaza(k);
      if (!d) {
        sinDatos++;
        continue;
      }
      const g = paraGuardar(d);
      quitados += g.quitados;
      plazas.set(g.plaza.aviso, g.plaza);
    }
    l = ses.listado!;
    if (l.pagina >= l.paginas || l.pagina >= hasta) break;
    l = await ses.irA(l.pagina + 1);
  }
  const lista = [...plazas.values()];
  for (const x of lista) reconocidos.delete(x.aviso);
  const terminado = l.pagina >= l.paginas;
  const clave = `raw/${FUENTE}/${estado.dia}/paginas-${String(desde).padStart(3, "0")}-${String(l.pagina).padStart(3, "0")}.json`;
  await env.CRUDOS.put(clave, JSON.stringify({ url: URL_SERVIR, desde, hasta: l.pagina, paginas: l.paginas, puestos: ses.puestos,
    descargado_at: new Date().toISOString(), plazas: lista, ...(conocidas ? { reconocidas: [...reconocidos] } : {}) }),
    { httpMetadata: { contentType: "application/json" } });
  let cuentas = { nuevas: 0, actualizadas: 0, conCambios: 0 };
  if (!p.seco && (lista.length || reconocidos.size)) {
    cuentas = await conDb(env.HYPERDRIVE, async (db) => {
      // Las reconocidas siguen publicadas: renuevan `ultima_vez` como si se hubieran vuelto a leer.
      if (reconocidos.size) await db.filas("UPDATE servir_convocatoria SET ultima_vez = now() WHERE aviso = ANY($1::int[])", [[...reconocidos]]);
      return lista.length ? (await db.filas<typeof cuentas>(SQL_UPSERT, [JSON.stringify(lista)]))[0] : cuentas;
    });
  }
  return {
    estado: { cookies: ses.cookies, pagina: l.pagina + 1, dia: estado.dia, incremental: estado.incremental, repetidas },
    terminado, desde, hasta: l.pagina, paginasServir: l.paginas, puestos: ses.puestos,
    avisos: [...lista.map((x) => x.aviso), ...reconocidos], conocidas: nReconocidas, sinDatos, quitados, ...cuentas, pedidos: ses.pedidos,
    resincronizaciones: ses.resincronizaciones,
  };
}

/** `desde`/`hasta` como página de SERVIR (un entero desde 1, «3» o «0003»); null si no viene o no lo es. */
/** ¿Hoy es jueves en Lima? (el día de la lectura completa). */
export const esJuevesLima = (ms: number = Date.now()) => new Date(ms - 5 * 3600 * 1000).getUTCDay() === 4;

export function paginaParam(v: unknown): number | null {
  const t = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return /^\d{1,4}$/.test(t) && Number(t) >= 1 ? Number(t) : null;
}

export async function correrServir(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string, op: OpcionesCorrida = {}): Promise<unknown> {
  await esperarRelayLima(env, step, FUENTE);
  const primera = paginaParam(p.desde) ?? 1;
  const ultima = paginaParam(p.hasta);
  // Completa los jueves (la de siempre) o con `forzar`; los demás días, incremental (ver la cabecera).
  const completa = !!p.forzar || esJuevesLima(op.ahora);
  let estado: Estado = { cookies: {}, pagina: primera, dia: fechaLima(), incremental: !completa, repetidas: {} };
  const avisos = new Set<number>();
  const r = { modo: completa ? "completa" : "incremental", paginas: 0, paginas_servir: 0, puestos_servir: null as number | null, conocidas: 0,
    detalles: 0, sin_datos: 0, contactos_quitados: 0, nuevas: 0, actualizadas: 0, con_cambios: 0, pedidos: 0, resincronizaciones: 0 };
  let error: unknown = null;
  for (let ini = primera; ; ini = estado.pagina) {
    const fin = Math.min(ini + PAGINAS_POR_PASO - 1, ultima ?? Number.MAX_SAFE_INTEGER);
    const desdeEstado = estado;
    let t: Tanda;
    try {
      t = await step.do(`páginas ${ini}-${fin}`, PASO, () => leerTanda(env, p, desdeEstado, fin, op));
    } catch (e) {
      // Lo leído hasta aquí ya está en la base: se refresca igual y la corrida termina con el error.
      error = e;
      break;
    }
    estado = t.estado;
    for (const a of t.avisos) avisos.add(a);
    r.paginas += t.hasta - t.desde + 1;
    r.paginas_servir = t.paginasServir;
    if (t.puestos !== null) r.puestos_servir = t.puestos;
    r.conocidas += t.conocidas;
    r.detalles += t.avisos.length - t.conocidas;
    r.sin_datos += t.sinDatos;
    r.contactos_quitados += t.quitados;
    r.nuevas += t.nuevas;
    r.actualizadas += t.actualizadas;
    r.con_cambios += t.conCambios;
    r.pedidos += t.pedidos;
    r.resincronizaciones += t.resincronizaciones;
    registrar("INFO", `   páginas ${t.desde}-${t.hasta} de ${t.paginasServir}: ${t.avisos.length} plazas` +
      (t.conocidas ? ` (${t.conocidas} reconocidas sin abrir)` : "") + (p.seco ? "" : `, ${t.nuevas} nuevas`) +
      (t.resincronizaciones ? `, ${t.resincronizaciones} resincronizaciones` : ""), { fuente: FUENTE, instancia: id });
    if (t.terminado || (ultima !== null && t.hasta >= ultima)) break;
  }
  const resumen: Record<string, unknown> = { ...r, plazas: avisos.size, seco: !!p.seco };
  if (!error && ultima === null && primera === 1 && r.puestos_servir && avisos.size < 0.9 * r.puestos_servir) {
    registrar("WARNING", `   SERVIR dice ${r.puestos_servir} puestos y se leyeron ${avisos.size} plazas`, { fuente: FUENTE, instancia: id });
  }

  if (!p.seco && avisos.size) {
    resumen.senales = await step.do("refrescar_plazas", CARGA, () => conDb(env.HYPERDRIVE, async (db) =>
      Number((await db.filas<{ n: number }>("SELECT refrescar_plazas() AS n"))[0]?.n ?? 0)));
    // La plaza de la gestión saliente (migración 183): después, porque refrescar_plazas() rehace todas las señales.
    resumen.gestion_saliente = await step.do("refrescar_plazas_extra", CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
      const [{ existe }] = await db.filas<{ existe: boolean }>("SELECT to_regprocedure('refrescar_plazas_extra()') IS NOT NULL AS existe");
      return existe ? Number((await db.filas<{ n: number }>("SELECT refrescar_plazas_extra() AS n"))[0]?.n ?? 0) : null;
    }));
    const dia = estado.dia;
    const huella = [...avisos].sort((a, b) => a - b).join(",");
    const completa = !error;
    resumen.base = await step.do("registrar carga", CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
      const [c] = await db.filas<{ total: number; con_ruc: number; con_senales: number }>(
        `SELECT count(*)::int AS total, count(entidad_ruc)::int AS con_ruc, (count(*) FILTER (WHERE n_senales > 0))::int AS con_senales
           FROM servir_convocatoria`);
      // Para /admin/cobertura, como el script: una carga por día (clave = la fecha), sólo si la lectura terminó (el error de
      // una corrida cortada queda en la bitácora de corridas). El sha256 es el de los avisos leídos.
      if (completa) {
        const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(huella));
        await registrarCarga(db, {
          fuente: FUENTE, clave: dia, tabla: "servir_convocatoria", archivo: `raw/${FUENTE}/${dia}/`,
          sha256: [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""), filas: avisos.size, fuente_url: URL_SERVIR,
          descargado_at: new Date().toISOString(),
        });
      }
      return c;
    }));
    registrar("INFO", `   servir: ${avisos.size} plazas (${r.nuevas} nuevas); en la base ${JSON.stringify(resumen.base)}`, { fuente: FUENTE, instancia: id });
  }
  if (error) throw error;
  return resumen;
}
