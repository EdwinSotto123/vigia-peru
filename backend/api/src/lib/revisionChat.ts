/**
 * Revisión automática de una respuesta del chat del admin, sin modelo: cada enlace y cada monto en soles de la respuesta
 * se busca en lo que devolvieron las herramientas en ese turno. Lo que no está queda «por revisar»; el panel lo lista y
 * lo marca en la respuesta. No dice que algo esté mal: dice que no sale tal cual de los datos consultados.
 *
 * Enlaces:
 *   - tal cual en una consulta (las herramientas ya traen el enlace de cada proceso, orden, empresa y entidad);
 *   - de Vigía, armado por el modelo: el RUC, el OCID o el número de orden que lleva tiene que estar en los datos. Una
 *     ficha /empresa/ de un RUC 10 siempre queda por revisar: es una persona natural y no se enlaza;
 *   - de afuera: la fuente oficial que nombró una herramienta (misma dirección sin la consulta) o nada.
 * Montos en soles (S/ en el texto, o las cifras de una columna de montos en una tabla):
 *   - la cifra está en los datos (al céntimo; redondeada al sol si se escribió sin decimales; «S/ 1.2 millones» con su
 *     precisión, contra los montos de los datos);
 *   - es el total de su tabla: la suma de las filas de arriba (y cuenta como dato para el resto del texto);
 *   - salió de un mensaje anterior de la conversación (la pregunta o una respuesta ya revisada).
 */

export interface PorRevisar {
  /** Lo que se ve en la respuesta: el texto del enlace o el monto. */
  texto: string;
  motivo: string;
  url?: string;
  /** Dónde está: la frase o la fila de la tabla. */
  contexto?: string;
}

export interface Revision {
  enlaces: { total: number; ok: number; anteriores: number; dudosos: PorRevisar[] };
  montos: { total: number; ok: number; sumas: number; anteriores: number; dudosos: PorRevisar[] };
}

const MAX_DUDOSOS = 60;

// ─── Índice de lo consultado ────────────────────────────────────────────────────────────────────────────────────────

const RE_URL = /https?:\/\/[^\s<>"'`)\]}|\\]+/g;
/** Claves de los datos que traen plata (las demás cifras sólo valen si coinciden al céntimo). */
const RE_CLAVE_MONTO = /monto|total|soles|pim|devengad|girad|valor|importe|gasto|suma|precio|presupuest|adjudicad|referencial|pagad|comprometid|mediana|promedio|costo|contratad|ofert|sueldo|remuner|aporte/i;

function decodificar(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Una dirección comparable: sin #, sin barra final, con la consulta ordenada y decodificada. */
export function normalizarUrl(u: string): string | null {
  try {
    const x = new URL(u.replace(/[.,;:!?]+$/, ""));
    const ruta = decodificar(x.pathname).replace(/\/+$/, "");
    const q = [...x.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    return `${x.protocol}//${x.host.toLowerCase()}${ruta}${q ? `?${q}` : ""}`;
  } catch {
    return null;
  }
}

function sinConsulta(u: string): string {
  return u.split("?")[0];
}

interface Indice {
  urls: Set<string>;
  rutas: Set<string>;
  digitos: Set<string>;
  texto: string;
  /** Las cifras de plata (claves de monto o «S/ …»), ordenadas (para «S/ 1.2 millones»). */
  montos: number[];
  centimos: Set<number>;
}

function indexar(textos: string[]): Indice {
  const urls = new Set<string>();
  const rutas = new Set<string>();
  const digitos = new Set<string>();
  const montos: number[] = [];
  const centimos = new Set<number>();
  const cifra = (v: number, dePlata: boolean) => {
    if (!Number.isFinite(v)) return;
    centimos.add(Math.round(v * 100));
    if (dePlata) montos.push(v);
  };
  const deTexto = (s: string) => {
    for (const m of s.matchAll(RE_SOLES)) {
      const p = leerMonto(m[1], m[2]);
      if (p) cifra(p.valor, true);
    }
  };
  const recorrer = (v: unknown, clave: string) => {
    if (typeof v === "number") cifra(v, RE_CLAVE_MONTO.test(clave));
    else if (typeof v === "string") {
      deTexto(v);
      // Una cifra guardada como texto («"monto": "38140.00"»).
      if (/^-?\d+(\.\d+)?$/.test(v.trim())) cifra(Number(v), RE_CLAVE_MONTO.test(clave));
    } else if (Array.isArray(v)) v.forEach((x) => recorrer(x, clave));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) recorrer(x, k);
  };
  for (const t of textos) {
    for (const m of t.matchAll(RE_URL)) {
      const n = normalizarUrl(m[0]);
      if (n) {
        urls.add(n);
        rutas.add(sinConsulta(n));
      }
    }
    for (const m of t.matchAll(/\d+/g)) digitos.add(m[0]);
    for (const m of t.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) cifra(Number(m[0].replace(/,/g, "")), false);
    try {
      recorrer(JSON.parse(t), "");
    } catch {
      deTexto(t);
    }
  }
  montos.sort((a, b) => a - b);
  return { urls, rutas, digitos, texto: textos.join("\n"), montos, centimos };
}

/** ¿Hay una cifra en [v - tol, v + tol]? (búsqueda binaria en una lista ordenada). */
function cerca(lista: number[], v: number, tol: number): boolean {
  let lo = 0;
  let hi = lista.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lista[mid] < v - tol) lo = mid + 1;
    else hi = mid;
  }
  return lo < lista.length && lista[lo] <= v + tol;
}

function tieneId(idx: Indice, id: string): boolean {
  return /^\d+$/.test(id) ? idx.digitos.has(id) : idx.texto.includes(id);
}

// ─── Montos ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** «S/ 489,309.75», «S/ 38 140», «S/ 1.2 millones», «S/ 280 mil», «S/. 5,000». */
const RE_SOLES = /S\/\.?\s?(\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)*)(?:\s?(millones|millón|millon|mil|M)(?![a-zñ]))?/gi;

/** Una cifra escrita y lo que puede apartarse por cómo se escribió (la mitad de su último dígito). */
export function leerMonto(numero: string, sufijo?: string): { valor: number; tol: number } | null {
  let s = numero.replace(/[.,]+$/, "");
  let decimales = 0;
  if (/^\d{1,3}([ ,]\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/[ ,]/g, "");
  } else if (/^\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s) || /^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(s)) {
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const valor = Number(s);
  if (!Number.isFinite(valor)) return null;
  decimales = s.includes(".") ? s.split(".")[1].length : 0;
  const suf = (sufijo ?? "").toLowerCase();
  const por = suf === "mil" ? 1e3 : suf ? 1e6 : 1;
  // Sin decimales ni sufijo se admite el redondeo al sol (280,461 por 280,461.20).
  const tol = por === 1 && decimales === 0 ? 1 : (0.5 * 10 ** -decimales) * por + 0.005;
  return { valor: valor * por, tol };
}

/** Las columnas de plata de una tabla: su encabezado lo dice (S/, monto, total, importe…). */
const RE_COLUMNA_MONTO = /S\/|soles|monto|importe|total|valor|gasto|pim|devengad|adjudicad|pagad|presupuest|precio|costo/i;
const RE_FILA_TOTAL = /^\W*(total|suma|subtotal)\b/i;

interface Celda {
  texto: string;
  valor: number;
  tol: number;
  contexto: string;
}

function celdas(linea: string): string[] {
  return linea.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
}

/** Las tablas markdown de la respuesta y las líneas que no son tabla. */
function partir(texto: string): { tablas: string[][][]; resto: string[] } {
  const tablas: string[][][] = [];
  const resto: string[] = [];
  const lineas = texto.split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const esFila = (l: string | undefined) => l != null && /^\s*\|.*\|\s*$/.test(l);
    if (esFila(lineas[i]) && /^\s*\|?\s*:?-{3,}/.test(lineas[i + 1] ?? "")) {
      const filas = [celdas(lineas[i])];
      i += 2;
      while (esFila(lineas[i])) filas.push(celdas(lineas[i++]));
      i--;
      tablas.push(filas);
    } else resto.push(lineas[i]);
  }
  return { tablas, resto };
}

function sinMarcas(s: string): string {
  return s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
}

// ─── La revisión ────────────────────────────────────────────────────────────────────────────────────────────────────

const RE_MD = /\[((?:[^[\]]|\[[^\]]*\])*)\]\((https?:\/\/[^\s)]+)\)/g;
const ES_VIGIA = /(^|\.)gobserva\.cloud$/i;

function motivoVigia(u: URL, idx: Indice): string | null {
  const seg = u.pathname.split("/").filter(Boolean).map(decodificar);
  if (seg[0] === "empresa" && seg[1]) {
    if (/^10\d{9}$/.test(seg[1])) return "Enlaza la ficha de un RUC 10 (persona natural): no se publica.";
    return tieneId(idx, seg[1]) ? null : "Ese RUC no salió de ninguna consulta.";
  }
  if (seg[0] === "entidad" && seg[1]) {
    if (!tieneId(idx, seg[1])) return "Ese RUC de entidad no salió de ninguna consulta.";
    const cq = u.searchParams.get("cq");
    return cq && !tieneId(idx, cq) ? `La orden ${cq} no salió de ninguna consulta.` : null;
  }
  // Una ficha con un identificador (contrato, compra menor, obra…): el último tramo con una cifra.
  const id = [...seg].reverse().find((s) => /\d/.test(s));
  if (!id) return null; // una página general (/fuentes, /app/contratos)
  return tieneId(idx, id) ? null : `«${id}» no salió de ninguna consulta.`;
}

/**
 * Revisa `respuesta` contra `fuentes` (lo que devolvieron las herramientas en este turno) y `anteriores` (los mensajes
 * previos de la conversación, incluida la pregunta).
 */
export function revisarRespuesta(respuesta: string, fuentes: string[], anteriores: string[] = []): Revision {
  const idx = indexar(fuentes);
  const ant = indexar(anteriores);
  const rev: Revision = {
    enlaces: { total: 0, ok: 0, anteriores: 0, dudosos: [] },
    montos: { total: 0, ok: 0, sumas: 0, anteriores: 0, dudosos: [] },
  };

  // Enlaces: cada dirección distinta una vez, con el texto con que aparece primero.
  const vistos = new Map<string, string>();
  for (const m of respuesta.matchAll(RE_MD)) if (!vistos.has(m[2])) vistos.set(m[2], sinMarcas(m[1]) || m[2]);
  for (const m of respuesta.matchAll(RE_URL)) {
    const u = m[0].replace(/[.,;:!?]+$/, "");
    if (![...vistos.keys()].some((k) => k.replace(/[.,;:!?]+$/, "") === u)) vistos.set(u, u);
  }
  for (const [url, texto] of vistos) {
    const n = normalizarUrl(url);
    if (!n) continue;
    rev.enlaces.total++;
    if (idx.urls.has(n)) {
      rev.enlaces.ok++;
      continue;
    }
    const u = new URL(url.replace(/[.,;:!?]+$/, ""));
    let motivo: string | null;
    if (ES_VIGIA.test(u.hostname)) motivo = motivoVigia(u, idx);
    else motivo = idx.rutas.has(sinConsulta(n)) ? null : "Este enlace no salió de ninguna consulta: puede estar inventado o roto.";
    if (!motivo) rev.enlaces.ok++;
    else if (ant.urls.has(n) && !motivo.includes("RUC 10")) rev.enlaces.anteriores++;
    else if (rev.enlaces.dudosos.length < MAX_DUDOSOS) rev.enlaces.dudosos.push({ texto, url, motivo });
  }

  // Montos.
  const sumas: number[] = [];
  const yaListados = new Set<string>();
  const revisar = (c: Celda) => {
    rev.montos.total++;
    // Al céntimo, cualquier cifra de los datos; con redondeo, sólo las que son plata (un conteo o un código no cuentan).
    const exacto = idx.centimos.has(Math.round(c.valor * 100));
    if (exacto || cerca(idx.montos, c.valor, c.tol)) {
      rev.montos.ok++;
      return;
    }
    if (sumas.some((v) => Math.abs(v - c.valor) <= Math.max(c.tol, 1))) {
      rev.montos.sumas++;
      return;
    }
    if (ant.centimos.has(Math.round(c.valor * 100)) || cerca(ant.montos, c.valor, c.tol)) {
      rev.montos.anteriores++;
      return;
    }
    if (yaListados.has(c.texto) || rev.montos.dudosos.length >= MAX_DUDOSOS) return;
    yaListados.add(c.texto);
    rev.montos.dudosos.push({
      texto: c.texto,
      contexto: c.contexto,
      motivo: "No está tal cual en los datos consultados: puede ser una suma o una cuenta del modelo. Revísalo.",
    });
  };

  const { tablas, resto } = partir(respuesta);
  for (const filas of tablas) {
    const [cab, ...cuerpo] = filas;
    const deMonto = cab.map((h) => RE_COLUMNA_MONTO.test(h) && !/%|porcentaje/i.test(h));
    const esTotal = cuerpo.map((f) => RE_FILA_TOTAL.test(sinMarcas(f[0] ?? "")));
    // Una columna «Total (S/)» que suma las otras columnas de plata de su fila («Órdenes (S/)» + «Procesos (S/)»).
    const columnaTotal = cab.map((h, j) => deMonto[j] && RE_FILA_TOTAL.test(sinMarcas(h)));
    const valorCelda = (texto: string | undefined) => {
      const v = sinMarcas(texto ?? "");
      const m = [...v.matchAll(RE_SOLES)][0];
      return (m ? leerMonto(m[1], m[2]) : /^-?\d[\d.,\s]*$/.test(v) ? leerMonto(v) : null)?.valor ?? 0;
    };
    const cuadraSuma = (suma: number, p: { valor: number; tol: number }) =>
      Math.abs(suma - p.valor) <= Math.max(1, p.tol, Math.abs(p.valor) * 0.0005);
    // Primero las filas comunes; después los totales contra la suma de su columna.
    const orden = [...cuerpo.keys()].sort((a, b) => Number(esTotal[a]) - Number(esTotal[b]));
    for (const i of orden) {
      const fila = cuerpo[i];
      fila.forEach((celda, j) => {
        const limpia = sinMarcas(celda);
        const conSoles = [...limpia.matchAll(RE_SOLES)];
        const leidos = conSoles.length
          ? conSoles.map((m) => ({ texto: m[0].trim(), p: leerMonto(m[1], m[2]) }))
          : deMonto[j] && /^-?\d[\d.,\s]*$/.test(limpia)
            ? [{ texto: limpia, p: leerMonto(limpia) }]
            : [];
        for (const { texto, p } of leidos) {
          if (!p) continue;
          const contexto = `Fila «${sinMarcas(fila[0] ?? "").slice(0, 60)}», columna «${sinMarcas(cab[j] ?? "").slice(0, 40)}»`;
          const deLaColumna = esTotal[i] && cuadraSuma(cuerpo.reduce((s, f, k) => (esTotal[k] ? s : s + valorCelda(f[j])), 0), p);
          const otras = cab.flatMap((_, k) => (k !== j && deMonto[k] && !columnaTotal[k] ? [k] : []));
          const deLaFila = columnaTotal[j] && otras.length > 1 && cuadraSuma(otras.reduce((s, k) => s + valorCelda(fila[k]), 0), p);
          if (deLaColumna || deLaFila) {
            rev.montos.total++;
            rev.montos.sumas++;
            sumas.push(p.valor);
            continue;
          }
          revisar({ texto, valor: p.valor, tol: p.tol, contexto });
        }
      });
    }
  }
  for (const linea of resto) {
    const limpia = sinMarcas(linea);
    for (const m of limpia.matchAll(RE_SOLES)) {
      const p = leerMonto(m[1], m[2]);
      if (!p) continue;
      revisar({ texto: m[0].trim(), valor: p.valor, tol: p.tol, contexto: alrededor(limpia, m.index ?? 0, m[0].length) });
    }
  }
  return rev;
}

/** La frase alrededor de un monto, cortada en espacios (unas 70 letras antes y 50 después). */
export function alrededor(linea: string, i: number, largo: number): string {
  let desde = Math.max(0, i - 70);
  if (desde > 0) desde = Math.min(i, linea.indexOf(" ", desde) + 1 || desde);
  let hasta = Math.min(linea.length, i + largo + 50);
  if (hasta < linea.length) hasta = Math.max(i + largo, linea.lastIndexOf(" ", hasta));
  return `${desde > 0 ? "…" : ""}${linea.slice(desde, hasta).trim()}${hasta < linea.length ? "…" : ""}`;
}
