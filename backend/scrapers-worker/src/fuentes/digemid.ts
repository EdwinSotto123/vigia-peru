/**
 * DIGEMID → los medicamentos de Gobserva Salud (migración 441). Diario (calendario.ts) y a mano con /correr; el relleno
 * desde una PC con scripts/susalud_local.ts (`precios <zip>` y `alertas <cuántas>`).
 *
 * Fuentes oficiales de la Dirección General de Medicamentos, Insumos y Drogas (verificadas el 2026-11-21, sin cuenta ni
 * captcha):
 *   · Indicador de precios del Observatorio: `Archivos/Indicadores/TendenciaCentral/FT_AAAAMM.zip`, un Excel por mes con
 *     ~15 mil presentaciones (registro sanitario, titular, fabricante, principio activo y la media, mediana y moda del
 *     precio en farmacias y boticas privadas). Sale con ~5 semanas de rezago: se prueba desde el mes pasado hacia atrás.
 *   · Alertas DIGEMID: la API pública de su web (`webDigemid/wp-json/wp/v2/posts?categories=34`, ~1 700 entradas, cada una
 *     con su PDF). Del PDF se guarda el texto normalizado (para buscar un lote o un registro) y los registros sanitarios
 *     que nombra; en la web se enlaza el PDF oficial, el texto no se publica.
 *
 * Idempotente: el ZIP con el mismo sha256 no se recarga; una alerta se relee sólo si DIGEMID la modificó o su PDF falló.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb, type Db } from "../db.ts";
import { dormir, pedirLima } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, LECTURA } from "./comun.ts";
import { decimal, entero, insertarTandas, limpio, normalizar } from "./susalud.ts";

export const FUENTE = "digemid";
export const BASE_DIGEMID = "https://www.digemid.minsa.gob.pe";
export const API_ALERTAS = `${BASE_DIGEMID}/webDigemid/wp-json/wp/v2/posts`;
export const URL_PRECIOS = (am: string) => `${BASE_DIGEMID}/Archivos/Indicadores/TendenciaCentral/FT_${am}.zip`;
/** Entre pedidos a la web de DIGEMID: sin ráfagas. Con 0,8 s respondió 429 al PDF número 15 y luego no dejó bajar PDF por un buen rato (2026-11-21). */
const PAUSA_MS = 6000;
/** Ante un 429 se espera y se reintenta el mismo PDF; si sigue, se corta la tanda (lo que falta queda para después). */
const ESPERA_429_MS = [30_000, 60_000, 120_000];
/** El PDF que todavía no se pudo leer (DIGEMID pidió bajar el ritmo): se reintenta en la corrida siguiente. */
export const PDF_PENDIENTE = "PDF pendiente: HTTP 429";
const POR_PASO = 20;

/**
 * Gobserva se presenta como lo que es (no como un navegador): la web de DIGEMID responde a este agente y rechaza el de
 * curl (verificado el 2026-11-21).
 */
export const UA_GOBSERVA = "Gobserva/1.0 (+https://gobserva.cloud; datos abiertos)";

/** Quien pide: el Worker (directo y, si no contesta, por el relay de Lima) o la PC (`pedidorDirecto`). */
export type Pedir = (url: string) => Promise<Response>;

export const pedidorDirecto: Pedir = (url) => fetch(url, { headers: { "User-Agent": UA_GOBSERVA }, signal: AbortSignal.timeout(60_000) });

export function pedidorWorker(env: Env): Pedir {
  return async (url) => {
    try {
      const r = await pedidorDirecto(url);
      if (r.ok || r.status === 404 || r.status === 400) return r;
      await r.body?.cancel();
      registrar("INFO", `   ${url.split("?")[0]} directo: HTTP ${r.status}; por el relay de Lima`, { fuente: FUENTE });
    } catch (e) {
      registrar("INFO", `   ${url.split("?")[0]} directo: ${(e as Error).message.slice(0, 120)}; por el relay de Lima`, { fuente: FUENTE });
    }
    if (!env.RELAY_LIMA) throw new Error(`${url}: no responde directo y falta el relay de Lima`);
    const r = await pedirLima(env, { url, cabeceras: { "User-Agent": UA_GOBSERVA }, timeoutMs: 120_000 });
    return r.origen === null ? r.respuesta : new Response(r.respuesta.body, { status: r.origen, headers: r.respuesta.headers });
  };
}

/** El sha256 de unos bytes, en hexadecimal (datasets_cargas). */
export async function sha256(datos: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", datos));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Utilidades puras ──────────────────────────────────────────────────────────────────────────────

/** «EE-01234», «ee 01234» → «EE01234»; lo que no tiene forma de registro sanitario → null. */
export function registroNorm(v: unknown): string | null {
  const t = String(v ?? "").toUpperCase().replace(/[\s-]+/g, "");
  return /^[A-Z]{1,3}\d{4,6}[A-Z]?$/.test(t) ? t : null;
}

/** Los registros sanitarios que nombra un texto (sin repetir). */
export function registrosEn(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.toUpperCase().matchAll(/\b([A-Z]{1,3})\s?-?\s?(\d{4,6})([A-Z]?)\b/g)) {
    const r = registroNorm(`${m[1]}${m[2]}${m[3]}`);
    // «AÑO 2026», «SE 2026» y parecidos no son registros: un prefijo de una letra con un año delante se descarta.
    if (r && !/^(A|AL|DE|EN|SE|Y|N|NO|AL)(19|20)\d{2}$/.test(r)) out.add(r);
  }
  return [...out];
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", ordm: "º", deg: "°" };
/** HTML → texto plano, con las entidades resueltas. */
export function textoHtml(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h\d|li|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export type TipoAlerta = "falsificado" | "calidad" | "seguridad" | "modificacion" | "internacional" | "otra";
/** Las subcategorías de «Alertas y Modificaciones» (32) en la web de DIGEMID. */
const TIPOS: [number, TipoAlerta][] = [[37, "falsificado"], [35, "calidad"], [38, "seguridad"], [36, "modificacion"], [66, "internacional"]];

export interface Entrada {
  id: number; date: string; modified?: string; link: string; categories?: number[];
  title?: { rendered?: string }; content?: { rendered?: string }; excerpt?: { rendered?: string };
}

export interface FilaAlerta {
  id: number; numero: string | null; fecha: string; tipo: TipoAlerta; titulo: string; motivo: string | null; productos: string | null;
  url: string; pdf_url: string | null; modificado_at: string | null;
}

/** Una entrada de la API → la fila (sin el texto del PDF). */
export function filaAlerta(e: Entrada): FilaAlerta {
  const titulo = textoHtml(e.title?.rendered) || `Alerta ${e.id}`;
  const n = /(\d{1,4})\s*[-–]\s*(\d{4})/.exec(titulo);
  const html = e.content?.rendered ?? "";
  const cuerpo = textoHtml(html);
  // Dos formas: «Productos: …» (desde 2023) y «Productos IFA: …» con «Productos Marca: …» (las de 2022 y antes).
  const partes = cuerpo.split(/Productos?(?:\s+(?:IFA|Marca))?\s*:/i);
  const motivo = limpio(partes[0]?.replace(/Descargar\s*$/i, "").replace(/\n+/g, " "));
  const despues = partes.length > 1 ? partes.slice(1).map((x) => x.trim()).filter(Boolean).join(", ") : textoHtml(e.excerpt?.rendered);
  const productos = limpio(despues.replace(/Descargar.*$/is, "").replace(/\n+/g, " "));
  // El PDF va como enlace («Descargar») o incrustado (<embed src=…>) en las antiguas.
  const pdf = /(?:href|src)="([^"]+\.pdf)"/i.exec(html)?.[1] ?? null;
  const cats = new Set(e.categories ?? []);
  return {
    id: e.id,
    numero: n ? `${Number(n[1])}-${n[2]}` : null,
    fecha: e.date.slice(0, 10),
    tipo: TIPOS.find(([c]) => cats.has(c))?.[1] ?? (/INTERNACIONAL/i.test(titulo) ? "internacional" : "otra"),
    titulo,
    motivo: motivo ? motivo.slice(0, 500) : null,
    productos: productos ? productos.slice(0, 1000) : null,
    url: e.link,
    pdf_url: pdf ? new URL(pdf, BASE_DIGEMID).href : null,
    modificado_at: e.modified ? `${e.modified}-05:00` : null,
  };
}

/** El texto de un PDF (todas sus páginas). */
export async function textoPdf(datos: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(datos);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

// ─── Precios (el catálogo) ─────────────────────────────────────────────────────────────────────────

export interface FilaMedicamento {
  codigo: number; nombre: string; nombre_norm: string; concentracion: string | null; forma: string | null; presentacion: string | null;
  fracciones: number | null; clasificacion: string | null; registro: string | null; titular: string | null; fabricante: string | null;
  pais: string | null; grupo: string | null; ifa: string | null; ifa_norm: string | null; cantidad_ifas: number | null;
  establecimientos: number | null; precio_media: number | null; precio_mediana: number | null; precio_moda: number | null;
}

const MESES: Record<string, number> = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SETIEMBRE: 9, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };

/** El ZIP del Indicador de precios → filas y el mes («PERIODO SETIEMBRE 2026» → 2026-09-01). */
export function leerPrecios(zip: Uint8Array): { filas: FilaMedicamento[]; periodo: string | null; archivo: string } {
  const archivos = unzipSync(zip, { filter: (f) => /\.xlsx$/i.test(f.name) });
  const [archivo, datos] = Object.entries(archivos)[0] ?? [];
  if (!datos) throw new Error("el ZIP de precios no trae un Excel");
  const wb = XLSX.read(datos, { type: "array" });
  const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  let periodo: string | null = null;
  let k = 0;
  for (; k < Math.min(filas.length, 20); k++) {
    const t = normalizar(String(filas[k]?.join(" ") ?? ""));
    const m = /PERIODO (\w+) (\d{4})/.exec(t);
    if (m && MESES[m[1]]) periodo = `${m[2]}-${String(MESES[m[1]]).padStart(2, "0")}-01`;
    if (/CODIGO DE PRODUCTO/.test(t)) break;
  }
  const cab = (filas[k] ?? []).map((c) => normalizar(String(c ?? "")));
  const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
  const C = {
    codigo: col(/^CODIGO DE PRODUCTO$/), nombre: col(/^NOMBRE COMERCIAL$/), concentracion: col(/^CONCENTRACION$/), forma: col(/^FORMA FARMACEUTICA$/),
    presentacion: col(/^PRESENTACION$/), fracciones: col(/^FRACCIONES$/), clasificacion: col(/^CLASIFICACION$/), registro: col(/^REGISTRO SANITARIO$/),
    titular: col(/^TITULAR/), fabricante: col(/^FABRICANTE$/), pais: col(/^PAIS$/), grupo: col(/^GRUPO/), ifa: col(/^IFA$/), cantidad_ifas: col(/^CANTIDAD IFAS?$/),
    establecimientos: col(/^CANTIDAD DE ESTABLECIMIENTOS/), media: col(/^MEDIA$/), mediana: col(/^MEDIANA$/), moda: col(/^MODA$/),
  };
  const faltan = Object.entries(C).filter(([, i]) => i < 0).map(([c]) => c);
  if (faltan.length) throw new Error(`el Excel de precios cambió de forma: faltan ${faltan.join(", ")}`);
  const out: FilaMedicamento[] = [];
  const vistos = new Set<number>();
  const precio = (v: unknown) => { const n = decimal(v); return n !== null && n >= 0 && n < 1e8 ? Math.round(n * 100) / 100 : null; };
  for (const f of filas.slice(k + 1)) {
    const codigo = entero(f[C.codigo]);
    const nombre = limpio(f[C.nombre]);
    if (codigo === null || !nombre || vistos.has(codigo)) continue;
    vistos.add(codigo);
    const ifa = limpio(f[C.ifa]);
    out.push({
      codigo, nombre, nombre_norm: normalizar(nombre), concentracion: limpio(f[C.concentracion]), forma: limpio(f[C.forma]),
      presentacion: limpio(f[C.presentacion]), fracciones: entero(f[C.fracciones]), clasificacion: limpio(f[C.clasificacion])?.toUpperCase() ?? null,
      registro: registroNorm(f[C.registro]) ?? limpio(f[C.registro])?.toUpperCase() ?? null, titular: limpio(f[C.titular]), fabricante: limpio(f[C.fabricante]),
      pais: limpio(f[C.pais]), grupo: limpio(f[C.grupo]), ifa, ifa_norm: ifa ? normalizar(ifa) : null, cantidad_ifas: entero(f[C.cantidad_ifas]),
      establecimientos: entero(f[C.establecimientos]), precio_media: precio(f[C.media]), precio_mediana: precio(f[C.mediana]), precio_moda: precio(f[C.moda]),
    });
  }
  return { filas: out, periodo, archivo: archivo.split("/").pop() ?? archivo };
}

const CAMPOS_MED = ["codigo", "nombre", "nombre_norm", "concentracion", "forma", "presentacion", "fracciones", "clasificacion", "registro", "titular",
  "fabricante", "pais", "grupo", "ifa", "ifa_norm", "cantidad_ifas", "establecimientos", "precio_media", "precio_mediana", "precio_moda"] as const;
const CAST_MED: Record<string, string> = { codigo: "::int", fracciones: "::int", cantidad_ifas: "::int", establecimientos: "::int",
  precio_media: "::numeric", precio_mediana: "::numeric", precio_moda: "::numeric" };

/** Upsert del catálogo de un mes. Un mes más viejo que el cargado no pisa al nuevo. */
export async function cargarPrecios(db: Db, filas: FilaMedicamento[], periodo: string, archivo: string): Promise<Record<string, number>> {
  await db.ejecutar(`CREATE TEMP TABLE IF NOT EXISTS tmp_medicamento (LIKE salud_medicamento INCLUDING DEFAULTS) ON COMMIT PRESERVE ROWS`);
  await db.ejecutar("TRUNCATE tmp_medicamento");
  await insertarTandas(db, "tmp_medicamento", [...CAMPOS_MED, "periodo", "fuente_archivo"],
    filas.map((f) => ({ ...f, periodo, fuente_archivo: archivo })), { ...CAST_MED, periodo: "::date" });
  const r = await db.filas<{ nuevas: number; actualizadas: number }>(`
    WITH up AS (
      INSERT INTO salud_medicamento (${CAMPOS_MED.join(", ")}, periodo, fuente_archivo)
      SELECT ${CAMPOS_MED.join(", ")}, periodo, fuente_archivo FROM tmp_medicamento
      ON CONFLICT (codigo) DO UPDATE SET ${CAMPOS_MED.filter((c) => c !== "codigo").map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
        periodo = EXCLUDED.periodo, fuente_archivo = EXCLUDED.fuente_archivo, visto_at = now()
       WHERE salud_medicamento.periodo <= EXCLUDED.periodo
      RETURNING (xmax = 0) AS nueva
    ) SELECT count(*) FILTER (WHERE nueva)::int AS nuevas, count(*) FILTER (WHERE NOT nueva)::int AS actualizadas FROM up`);
  await db.ejecutar(`UPDATE salud_medicamento m SET en_catalogo = (m.periodo = x.ultimo)
                       FROM (SELECT max(periodo) AS ultimo FROM salud_medicamento) x WHERE m.en_catalogo IS DISTINCT FROM (m.periodo = x.ultimo)`);
  return { filas: filas.length, ...r[0] };
}

/** Carga un ZIP de precios ya bajado (el Worker y la PC). */
export async function cargarZipPrecios(db: Db, datos: Uint8Array, huella: string, am: string, url: string,
  p: { forzar?: boolean; seco?: boolean } = {}): Promise<Record<string, number | string | boolean>> {
  if (!p.forzar && (await yaCargado(db, FUENTE, `precios_${am}`, huella))) return { ya_cargado: true };
  const { filas, periodo, archivo } = leerPrecios(datos);
  if (filas.length < 5_000) throw new Error(`precios ${am} con sólo ${filas.length} productos: no parece el archivo completo`);
  const mes = periodo ?? `${am.slice(0, 4)}-${am.slice(4)}-01`;
  if (p.seco) return { seco: true, filas: filas.length, periodo: mes };
  const r = await cargarPrecios(db, filas, mes, archivo);
  await registrarCarga(db, {
    fuente: FUENTE, clave: `precios_${am}`, tabla: "salud_medicamento", archivo: `FT_${am}.zip`, sha256: huella, bytes: datos.length,
    filas: filas.length, fuente_url: url, descargado_at: new Date().toISOString(),
  });
  return { ...r, periodo: mes };
}

// ─── Alertas ───────────────────────────────────────────────────────────────────────────────────────

const CAMPOS_API = "id,date,modified,link,categories,title,content,excerpt";

/** Las entradas de alertas, de la más nueva a la más vieja (por fecha de modificación), hasta `max`. */
export async function listarAlertas(pedir: Pedir, max: number, desde: string | null = null): Promise<Entrada[]> {
  const out: Entrada[] = [];
  for (let pagina = 1; out.length < max; pagina++) {
    const q = new URLSearchParams({ categories: "34", per_page: "100", page: String(pagina), orderby: "modified", order: "desc", _fields: CAMPOS_API });
    if (desde) q.set("modified_after", desde);
    const r = await pedir(`${API_ALERTAS}?${q}`);
    if (r.status === 400) { await r.body?.cancel(); break; } // pasó la última página
    if (!r.ok) { await r.body?.cancel(); throw new Error(`alertas DIGEMID: HTTP ${r.status}`); }
    const lote = (await r.json()) as Entrada[];
    out.push(...lote);
    if (lote.length < 100) break;
    await dormir(PAUSA_MS);
  }
  return out.slice(0, max);
}

/** Las que hay que leer: nuevas, modificadas desde la última lectura o con el PDF fallado (hasta 3 intentos por día). */
export async function alertasPorLeer(db: Db, entradas: Entrada[]): Promise<Entrada[]> {
  if (!entradas.length) return [];
  const hay = await db.filas<{ id: number; modificado_at: string | null; pdf_error: string | null; leido_at: string }>(
    "SELECT id, modificado_at::text, pdf_error, leido_at::text FROM salud_alerta WHERE id = ANY($1::int[])", [entradas.map((e) => e.id)]);
  const por = new Map(hay.map((h) => [h.id, h]));
  return entradas.filter((e) => {
    const h = por.get(e.id);
    if (!h) return true;
    // Un 429 se reintenta enseguida; otro error del PDF, a las 8 horas.
    if (h.pdf_error && (/429/.test(h.pdf_error) || Date.parse(h.leido_at) < Date.now() - 8 * 3600_000)) return true;
    return !!e.modified && (!h.modificado_at || Date.parse(`${e.modified}-05:00`) > Date.parse(h.modificado_at) + 1000);
  });
}

export async function guardarAlerta(db: Db, f: FilaAlerta, texto: string | null, error: string | null): Promise<void> {
  const registros = texto ? registrosEn(`${texto}\n${f.productos ?? ""}`) : registrosEn(f.productos ?? "");
  await db.ejecutar(`
    INSERT INTO salud_alerta (id, numero, fecha, tipo, titulo, motivo, productos, url, pdf_url, texto_norm, registros, modificado_at, leido_at, pdf_error)
    VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12::timestamptz, now(), $13)
    ON CONFLICT (id) DO UPDATE SET numero = EXCLUDED.numero, fecha = EXCLUDED.fecha, tipo = EXCLUDED.tipo, titulo = EXCLUDED.titulo,
      motivo = EXCLUDED.motivo, productos = EXCLUDED.productos, url = EXCLUDED.url, pdf_url = EXCLUDED.pdf_url,
      texto_norm = coalesce(EXCLUDED.texto_norm, salud_alerta.texto_norm),
      registros = CASE WHEN EXCLUDED.texto_norm IS NULL THEN salud_alerta.registros ELSE EXCLUDED.registros END,
      modificado_at = EXCLUDED.modificado_at, leido_at = now(), pdf_error = EXCLUDED.pdf_error`,
  [f.id, f.numero, f.fecha, f.tipo, f.titulo, f.motivo, f.productos, f.url, f.pdf_url, texto ? normalizar(texto).slice(0, 60_000) : null,
    registros, f.modificado_at, error]);
}

/** Lee y guarda unas alertas (con el texto de su PDF). `conPdf: false` guarda sólo la entrada y deja el PDF pendiente. */
export async function leerAlertas(pedir: Pedir, db: Db, entradas: Entrada[], conPdf = true): Promise<Record<string, number>> {
  const cuenta: Record<string, number> = { leidas: 0, sin_pdf: 0, pdf_fallido: 0 };
  for (const e of entradas) {
    const f = filaAlerta(e);
    let texto: string | null = null;
    let error: string | null = null;
    if (f.pdf_url && !conPdf) {
      error = PDF_PENDIENTE;
    } else if (f.pdf_url) {
      try {
        let r = await pedir(encodeURI(decodeURI(f.pdf_url)));
        for (let k = 0; r.status === 429 && k < ESPERA_429_MS.length; k++) {
          await r.body?.cancel();
          cuenta.esperas = (cuenta.esperas ?? 0) + 1;
          await dormir(ESPERA_429_MS[k]);
          r = await pedir(encodeURI(decodeURI(f.pdf_url)));
        }
        if (r.status === 429) {
          // Ni esperando: se corta aquí, sin guardar esta alerta (la próxima corrida la vuelve a intentar).
          await r.body?.cancel();
          cuenta.cortada = 1;
          break;
        }
        if (!r.ok) { await r.body?.cancel(); throw new Error(`PDF: HTTP ${r.status}`); }
        texto = await textoPdf(new Uint8Array(await r.arrayBuffer()));
        if (!texto.trim()) { texto = null; error = "PDF sin texto (escaneado)"; }
      } catch (x) {
        error = (x as Error).message.slice(0, 300);
      }
      await dormir(PAUSA_MS);
    } else {
      cuenta.sin_pdf++;
    }
    await guardarAlerta(db, f, texto, error);
    if (error) cuenta.pdf_fallido++;
    else cuenta.leidas++;
  }
  return cuenta;
}

// ─── La corrida ────────────────────────────────────────────────────────────────────────────────────

/** Los meses a probar para el ZIP de precios: del pasado hacia atrás («202610», «202609»…). */
export function mesesAProbar(ms: number, n = 4): string[] {
  const d = new Date(ms - 5 * 3600_000);
  const out: string[] = [];
  for (let k = 1; k <= n; k++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1));
    out.push(`${m.getUTCFullYear()}${String(m.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export async function correrDigemid(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const pedir = pedidorWorker(env);
  const resultados: Record<string, unknown> = {};

  // 1. Precios: el ZIP más nuevo publicado.
  const am = await step.do("buscar el ZIP de precios", LECTURA, async () => {
    for (const m of mesesAProbar(Date.now())) {
      const r = await pedir(URL_PRECIOS(m));
      await r.body?.cancel();
      if (r.ok) return m;
    }
    return null;
  });
  if (am) {
    // El ZIP pesa ~2 MB: se baja y se carga en el mismo paso (con el mismo sha256 no se recarga).
    resultados.precios = await step.do(`precios ${am}`, CARGA, async () => {
      const r = await pedir(URL_PRECIOS(am));
      if (!r.ok) { await r.body?.cancel(); throw new Error(`precios ${am}: HTTP ${r.status}`); }
      const datos = new Uint8Array(await r.arrayBuffer());
      const huella = await sha256(datos);
      return conDb(env.HYPERDRIVE, (db) => cargarZipPrecios(db, datos, huella, am, URL_PRECIOS(am), p));
    });
  } else {
    registrar("WARNING", "   precios: ningún ZIP de los últimos 4 meses responde", { fuente: FUENTE, instancia: id });
  }

  // 2. Alertas: las nuevas o modificadas (en la primera corrida, todas), de a 20 por paso.
  // Tope de 300: la lista vuelve del paso como resultado del Workflow (y el relleno se hace desde la PC).
  const max = Math.max(1, Math.min(p.paso ?? 120, 300));
  const porLeer = await step.do("alertas por leer", LECTURA, () =>
    conDb(env.HYPERDRIVE, async (db) => {
      const ultima = (await db.filas<{ m: string | null }>("SELECT (max(modificado_at) - interval '3 days')::text AS m FROM salud_alerta"))[0]?.m;
      const desde = p.forzar || !ultima ? null : new Date(ultima).toISOString().slice(0, 19);
      const lista = await alertasPorLeer(db, await listarAlertas(pedir, max, desde));
      // Al Workflow sólo lo que hace falta para leerla (el contenido HTML entra: es corto).
      return lista.slice(0, max);
    }));
  const suma: Record<string, number> = { leidas: 0, sin_pdf: 0, pdf_fallido: 0 };
  for (let k = 0; k < porLeer.length; k += POR_PASO) {
    const tanda = porLeer.slice(k, k + POR_PASO);
    const r = await step.do(`alertas ${k + 1}-${k + tanda.length}`, { ...CARGA, timeout: "10 minutes" }, () =>
      conDb(env.HYPERDRIVE, (db) => (p.seco ? Promise.resolve({ seco: tanda.length }) : leerAlertas(pedir, db, tanda))));
    for (const [c, v] of Object.entries(r)) suma[c] = (suma[c] ?? 0) + Number(v);
  }
  resultados.alertas = { por_leer: porLeer.length, ...suma };
  registrar("INFO", `   digemid: ${JSON.stringify(resultados)}`, { fuente: FUENTE, instancia: id });
  return resultados;
}
