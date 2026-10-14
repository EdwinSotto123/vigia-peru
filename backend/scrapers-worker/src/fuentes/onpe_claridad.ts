/**
 * ONPE Claridad — aportes a organizaciones políticas → `onpe_aportantes`, y padrón de candidatos →
 * `onpe_candidatos`. Port de backend/scrapers/onpe_claridad/pipeline.py (normalización idéntica: la prueban
 * test/onpe.test.ts y los vectores de scripts/vectores_py.py).
 *
 * Verificado el 2026-10-14:
 * - El backend no valida el token de reCAPTCHA: las consultas responden sin él. Igual se manda si la
 *   página lo genera, como hace el pipeline de Python.
 * - Lo que bloquea es Cloudflare según la huella del cliente: un fetch desde un Worker (también por el relay)
 *   recibe el challenge. El Chrome de Browser Rendering pasa. Se abre el portal una vez por paso y las
 *   consultas salen desde la página, con su mismo origen.
 *
 * Pasos: pares (organización, proceso) de campaña e IFA → detalle de aportantes en tandas de PARES_POR_PASO
 * (un navegador por tanda) → padrón de candidatos. Cada par se carga solo si su contenido cambió: el sha256
 * es el de las respuestas del backend, sin la hora de descarga (el JSON de Python la incluía y por eso nunca
 * se salteaba nada).
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Browser, Page } from "@cloudflare/puppeteer";
import type { WorkflowStep } from "cloudflare:workers";
import { BUCKET } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import type { Db } from "../db.ts";
import { dormir } from "../http.ts";
import { colapsar, fechaDmy, fechaYmd, reprFlotante, sinMarcasNfd, strip } from "../py.ts";
import { registrar } from "../registro.ts";

const FUENTE = "onpe_claridad";
export const PORTAL_URL = "https://claridadportal.onpe.gob.pe/consulta-aportante";
const BACKEND = "https://claridad.onpe.gob.pe/claridad-backend/portal/";
const SITEKEY = "6Lf6p1UtAAAAACYJTSj2fVJhFIYrjduWSWWajOXp";   // reCAPTCHA v3 público del portal
const PAGINA = 500;
const PAUSA_MS = 1000;
const PARES_POR_PASO = 40;
const TIPO_APORTE: Record<string, string> = { F: "efectivo", E: "especie", A: "actividad", O: "otros" };
const PASO = { retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "30 minutes" } as const;

// ── normalización (pura) ────────────────────────────────────────────────────
/** `slug`: NFKD → ASCII, minúsculas, todo lo que no es [a-z0-9] → "-", hasta 80. */
export function slug(s: string | null | undefined): string {
  const t = (s ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  return t.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** `norm`: NFD sin marcas, mayúsculas, espacios colapsados. */
export function norm(s: string | null | undefined): string {
  return colapsar(sinMarcasNfd(s ?? "").toUpperCase());
}

function fecha(s: unknown): string | null {
  const t = strip(typeof s === "string" ? s : "");
  return fechaDmy(t) ?? fechaYmd(t);
}

/**
 * Monto del JSON del backend con su texto original (lo deja así `parsearJson`): Python distingue `70000.0`
 * (float) de `70000` (int) y eso entra en `aporte_clave`.
 */
export interface Monto {
  valor: number;
  texto: string;
}

/** `JSON.parse` que conserva el texto de cada `monto` (para el `f"{monto}"` de Python). */
export function parsearJson(texto: string): unknown {
  return JSON.parse(texto, function (this: unknown, clave: string, valor: unknown, ctx?: { source?: string }) {
    return clave === "monto" && typeof valor === "number" ? ({ valor, texto: ctx?.source ?? String(valor) } satisfies Monto) : valor;
  });
}

/** `f"{monto}"` de Python sobre el valor que dio json.loads (int, float o None). */
function montoPy(m: unknown): string {
  if (m === null || m === undefined) return "None";
  if (typeof m === "object" && "texto" in (m as Monto)) {
    const { valor, texto } = m as Monto;
    return /[.eE]/.test(texto) ? reprFlotante(valor) : String(valor);
  }
  if (typeof m === "string") return m;
  return String(m);
}

const montoValor = (m: unknown): number | string | null =>
  m === null || m === undefined ? null : typeof m === "object" && "valor" in (m as Monto) ? (m as Monto).valor : (m as number | string);

async function sha1(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DocDetalle {
  proceso: string;
  organizacion: string;
  ruc?: string | null;
  aportantes?: Record<string, unknown>[] | null;
  descargado_at?: string | null;
  endpoint?: string;
}

export interface Aporte {
  numero_documento: string | null;
  nombre: string;
  nombre_original: string | null;
  partido: string;
  año: number | null;
  fecha_aporte: string | null;
  monto: number | string | null;
  tipo_aporte: string | null;
  nivel: string;
  fuente: string;
  fuente_url: string;
  proceso: string;
  ruc_organizacion: string | null;
  tipo_receptor: string;
  receptor: null;
  aporte_clave: string;
}

const txt = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** `normalize_detail`: el documento de un par (organización, proceso) → filas de onpe_aportantes. */
export async function normalizarDetalle(doc: DocDetalle): Promise<Aporte[]> {
  const proceso = doc.proceso;
  const org = doc.organizacion;
  const rucOrg = doc.ruc ?? null;   // tal cual: un "" queda "" (como `doc.get("ruc")`)
  const out: Aporte[] = [];
  for (const a of doc.aportantes ?? []) {
    const docn = strip(txt(a.dni) || "");
    const razon = strip(txt(a.razonSocial) || "");
    const apellidos = strip(txt(a.apellidos) || "");
    const nombres = strip(txt(a.nombres) || "");
    const nombreOrig = razon && razon.toUpperCase() !== "N/A" ? razon : [apellidos, nombres].filter(Boolean).join(" ");
    if (!nombreOrig && !docn) continue;
    const f = fecha(a.fechaAporte);
    const tipoCrudo = a.tipoAporte;
    const tipo = TIPO_APORTE[strip(txt(tipoCrudo) || "").toUpperCase()] ?? (tipoCrudo ? txt(tipoCrudo) : null);
    const anioElec = txt(a.anioEleccion);
    const anio = f ? Number(f.slice(0, 4)) : /^\d+$/.test(anioElec) ? Number(anioElec) : null;
    const clave = await sha1([proceso, rucOrg || "", org, docn, nombreOrig, txt(a.fechaAporte) || "", montoPy(a.monto), txt(tipoCrudo) || ""].join("|"));
    out.push({
      numero_documento: /^\d+$/.test(docn) && (docn.length === 8 || docn.length === 11) ? docn : docn || null,
      nombre: norm(nombreOrig) || docn || "",
      nombre_original: nombreOrig || null,
      partido: org,
      año: anio,
      fecha_aporte: f,
      monto: montoValor(a.monto),
      tipo_aporte: tipo,
      nivel: proceso.startsWith("IFA") ? "anual" : "campaña",
      fuente: "ONPE_Claridad",
      fuente_url: PORTAL_URL,
      proceso,
      ruc_organizacion: rucOrg,
      tipo_receptor: "organizacion",
      receptor: null,
      aporte_clave: clave,
    });
  }
  return out;
}

export interface Candidato {
  dni: string | null;
  apellidos: string | null;
  nombres: string | null;
  organizacion: string | null;
  departamento: string | null;
  proceso: string | null;
  total_ingresos: unknown;
  fuente: string;
  fuente_url: string;
}

/** `normalize_candidatos`. */
export function normalizarCandidatos(doc: { candidatos?: Record<string, unknown>[] | null }): Candidato[] {
  return (doc.candidatos ?? []).map((c) => {
    const dni = strip(txt(c.dni) || "");
    return {
      dni: /^\d+$/.test(dni) ? dni : null,
      apellidos: strip(txt(c.apellidos) || "") || null,
      nombres: strip(txt(c.nombres) || "") || null,
      organizacion: strip(txt(c.organizacion) || "") || null,
      departamento: strip(txt(c.departamento) || "") || null,
      proceso: strip((txt(c.proceso) || "").replaceAll(" ", "")) || null,
      total_ingresos: montoValor(c.totalIngresos) ?? null,
      fuente: "onpe_claridad",
      fuente_url: PORTAL_URL,
    };
  });
}

// ── el portal (Browser Rendering) ───────────────────────────────────────────
const LLAMADA = `async ([sitekey, url, body]) => {
  try {
    if (typeof grecaptcha !== "undefined") {
      body.token = await Promise.race([grecaptcha.execute(sitekey, {action: "submit"}), new Promise((r) => setTimeout(() => r(undefined), 5000))]);
    }
  } catch (e) {}
  try {
    const r = await fetch(url, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
    return [r.status, await r.text()];
  } catch (e) { return [-1, "fetch: " + e]; }
}`;

class Portal {
  private readonly navegador: Browser;
  private readonly pagina: Page;

  private constructor(navegador: Browser, pagina: Page) {
    this.navegador = navegador;
    this.pagina = pagina;
  }

  static async abrir(env: Env): Promise<Portal> {
    const navegador = await puppeteer.launch(env.BROWSER);
    try {
      const pagina = await navegador.newPage();
      await pagina.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
      for (let i = 0; ; i++) {
        const t = (await pagina.title()) || "";
        if (t && !t.startsWith("Just a moment") && !t.startsWith("Un momento")) break;
        if (i >= 90) throw new Error("Cloudflare no dejó pasar al navegador (el título sigue en el challenge)");
        await dormir(1000);
      }
      await dormir(3000);   // que cargue grecaptcha
      return new Portal(navegador, pagina);
    } catch (e) {
      await navegador.close().catch(() => undefined);
      throw e;
    }
  }

  /** POST al backend desde la página; texto JSON de la respuesta (con reintentos, como `_call`). */
  async llamar(ruta: string, cuerpo: Record<string, unknown>, intentos = 4): Promise<string> {
    let ultimo = "";
    for (let k = 0; k < intentos; k++) {
      const [st, texto] = (await this.pagina.evaluate(`(${LLAMADA})(${JSON.stringify([SITEKEY, BACKEND + ruta, cuerpo])})`)) as [number, string];
      if (st === 200 && texto.startsWith("{")) return texto;
      ultimo = `${st} ${String(texto).slice(0, 120).replaceAll("\n", " ")}`;
      registrar("WARNING", `   ${ruta} → ${ultimo} (intento ${k + 1})`, { fuente: FUENTE });
      await dormir(3000 * (k + 1));
    }
    throw new Error(`${ruta}: sin respuesta válida tras ${intentos} intentos (${ultimo})`);
  }

  async cerrar(): Promise<void> {
    await this.navegador.close().catch(() => undefined);
  }
}

async function conPortal<T>(env: Env, fn: (p: Portal) => Promise<T>): Promise<T> {
  const p = await Portal.abrir(env);
  try {
    return await fn(p);
  } finally {
    await p.cerrar();
  }
}

// ── pares, detalle y carga ──────────────────────────────────────────────────
interface Par {
  ruc: string | null;
  organizacion: string;
  proceso: string;           // tal como lo devuelve el backend (puede traer espacios)
  totales: Record<string, number | string | null>;
}

const proc = (p: Par) => p.proceso.replaceAll(" ", "");
const clavePar = (p: Par) => `${proc(p)}/${p.ruc || "sin-ruc"}/${slug(p.organizacion)}`;

async function listar(portal: Portal, ruta: string): Promise<Par[]> {
  const d = JSON.parse(await portal.llamar(ruta, { filters: [{ code: "op", value: "" }], orders: { field: "", type: "DESC" }, page: 0, size: 5000 }));
  await dormir(PAUSA_MS);
  return ((d.data ?? []) as Record<string, unknown>[]).map((x) => ({
    ruc: typeof x.ruc === "string" ? x.ruc : null,
    organizacion: String(x.organizacion ?? ""),
    proceso: String(x.proceso ?? ""),
    totales: Object.fromEntries(["efectivo", "especie", "actividad", "otros", "total"]
      .map((k) => [k, (typeof x[k] === "number" || typeof x[k] === "string" ? x[k] : null) as number | string | null])),
  }));
}

/** Todas las páginas del detalle de un par. Devuelve los textos crudos (para el sha256) y los aportantes. */
async function detalle(portal: Portal, par: Par): Promise<{ crudo: string[]; aportantes: Record<string, unknown>[]; declarado: number }> {
  const ruta = proc(par).startsWith("IFA") ? "consult/org/find-detail-ifa" : "consult/org/find-detail";
  const crudo: string[] = [];
  const aportantes: Record<string, unknown>[] = [];
  let total = 0;
  for (let pg = 1; ; pg++) {
    const texto = await portal.llamar(ruta, {
      filters: [{ code: "ruc", value: par.ruc ?? "" }, { code: "opEqual", value: par.organizacion }, { code: "process", value: par.proceso },
        { code: "yearApo", value: "" }],
      orders: { field: "op", type: "ASC" }, page: pg, size: PAGINA,
    });
    crudo.push(texto);
    const d = parsearJson(texto) as { data?: { listaAportantes?: Record<string, unknown>[] }; total?: number; pages?: number };
    const lista = d.data?.listaAportantes ?? [];
    total = d.total ?? 0;
    aportantes.push(...lista);
    if (!lista.length || pg >= (d.pages ?? 1)) break;
    await dormir(PAUSA_MS);
  }
  return { crudo, aportantes, declarado: total || aportantes.length };
}

const COLS = ["numero_documento", "nombre", "nombre_original", "partido", "año", "fecha_aporte", "monto", "tipo_aporte", "nivel", "fuente",
  "fuente_url", "proceso", "ruc_organizacion", "tipo_receptor", "receptor", "aporte_clave"] as const;
const CASTS: Record<string, string> = { "año": "::int", fecha_aporte: "::date", monto: "::numeric", descargado_at: "::timestamptz" };

async function cargarPar(db: Db, doc: DocDetalle, filas: Aporte[], sha: string, archivo: string, descargado: string): Promise<void> {
  await db.transaccion(async () => {
    await db.ejecutar("DELETE FROM onpe_aportantes WHERE proceso = $1 AND partido = $2 AND COALESCE(ruc_organizacion, '') = $3",
      [doc.proceso, doc.organizacion, doc.ruc ?? ""]);
    const cols = [...COLS, "sha256", "descargado_at"];
    for (let i = 0; i < filas.length; i += 1000) {
      const vals: unknown[] = [];
      const tuplas = filas.slice(i, i + 1000).map((f) => {
        const b = vals.length;
        vals.push(...COLS.map((c) => f[c]), sha, descargado);
        return `(${cols.map((c, j) => `$${b + j + 1}${CASTS[c] ?? ""}`).join(", ")})`;
      });
      await db.ejecutar(`INSERT INTO onpe_aportantes (${cols.map((c) => (c === "año" ? '"año"' : c)).join(", ")}) VALUES ${tuplas.join(", ")} ` +
        "ON CONFLICT (aporte_clave) WHERE aporte_clave IS NOT NULL DO NOTHING", vals);
    }
    await registrarCarga(db, {
      fuente: FUENTE, clave: `${doc.proceso}/${doc.ruc || "sin-ruc"}/${slug(doc.organizacion)}`, tabla: "onpe_aportantes", archivo,
      gcs_uri: `r2://${BUCKET}/raw/${FUENTE}/${archivo}`, sha256: sha, filas: filas.length, fuente_url: doc.endpoint ?? null,
      descargado_at: descargado,
    });
  });
}

const CAND_COLS = ["dni", "apellidos", "nombres", "organizacion", "departamento", "proceso", "total_ingresos", "fuente", "fuente_url"] as const;

export async function correrOnpe(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const pares = await step.do("pares", PASO, () => conPortal(env, async (portal) => {
    const todos = [...await listar(portal, "consult/org/find"), ...await listar(portal, "consult/org/find-ifa")];
    registrar("INFO", `   ${todos.length} pares (organización, proceso)`, { fuente: FUENTE, instancia: id });
    return todos;
  }));

  const resumen = { pares: pares.length, cargados: 0, sin_cambios: 0, fallidos: [] as string[], aportes: 0, seco: !!p.seco };
  for (let i = 0; i < pares.length; i += PARES_POR_PASO) {
    const tanda = pares.slice(i, i + PARES_POR_PASO);
    const r = await step.do(`detalle ${i / PARES_POR_PASO + 1}`, PASO, () => conPortal(env, (portal) => conDb(env.HYPERDRIVE, async (db) => {
      const out = { cargados: 0, sin_cambios: 0, fallidos: [] as string[], aportes: 0 };
      for (const par of tanda) {
        let d;
        try {
          d = await detalle(portal, par);
        } catch (e) {
          // El backend responde 500 para algunas parejas (pasaba igual en Python): se anota y se sigue.
          registrar("WARNING", `   ${proc(par)} · ${par.organizacion.slice(0, 50)}: ${(e as Error).message.slice(0, 160)} — se omite`,
            { fuente: FUENTE, instancia: id });
          out.fallidos.push(`${proc(par)} · ${par.organizacion}`);
          continue;
        }
        const descargado = new Date().toISOString();
        const sha = await sha256(d.crudo.join("\n"));
        const doc: DocDetalle = {
          proceso: proc(par), organizacion: par.organizacion, ruc: par.ruc, aportantes: d.aportantes, descargado_at: descargado,
          endpoint: BACKEND + (proc(par).startsWith("IFA") ? "consult/org/find-detail-ifa" : "consult/org/find-detail"),
        };
        const filas = await normalizarDetalle(doc);
        out.aportes += filas.length;
        if (p.seco) continue;
        if (!p.forzar && (await yaCargado(db, FUENTE, clavePar(par), sha))) {
          out.sin_cambios++;
          await dormir(PAUSA_MS);
          continue;
        }
        const archivo = `${proc(par)}/${par.ruc || "sin-ruc"}__${slug(par.organizacion)}.json`;
        await env.CRUDOS.put(`raw/${FUENTE}/${archivo}`, JSON.stringify({
          fuente: "ONPE Claridad · consulta de aportantes", endpoint: doc.endpoint,
          filters: { ruc: par.ruc, opEqual: par.organizacion, process: par.proceso }, proceso: doc.proceso, ruc: par.ruc,
          organizacion: par.organizacion, totales_declarados: par.totales, total_registros: d.declarado, descargado_at: descargado,
          respuestas: d.crudo,
        }), { httpMetadata: { contentType: "application/json" } });
        await cargarPar(db, doc, filas, sha, archivo, descargado);
        out.cargados++;
        await dormir(PAUSA_MS);
      }
      return out;
    })));
    resumen.cargados += r.cargados;
    resumen.sin_cambios += r.sin_cambios;
    resumen.aportes += r.aportes;
    resumen.fallidos.push(...r.fallidos);
    registrar("INFO", `   tanda ${i / PARES_POR_PASO + 1}: ${r.cargados} cargados · ${r.sin_cambios} sin cambios · ${r.fallidos.length} con error`,
      { fuente: FUENTE, instancia: id });
  }

  if (!p.seco && resumen.fallidos.length) {
    await step.do("registrar fallidos", PASO, () => conDb(env.HYPERDRIVE, async (db) => {
      for (const f of resumen.fallidos) {
        await registrarCarga(db, { fuente: FUENTE, clave: `error/${slug(f)}`, tabla: "onpe_aportantes", sha256: "-", estado: "error",
          error: "backend de Claridad devolvió error en find-detail", fuente_url: PORTAL_URL });
      }
      return resumen.fallidos.length;
    }));
  }

  const candidatos = await step.do("candidatos", PASO, () => conPortal(env, async (portal) => {
    const crudo: string[] = [];
    const lista: Record<string, unknown>[] = [];
    let total: number | null = null;
    // Páginas 1-based: la 0 repite la 1 y, contando desde 0, la última quedaba sin pedir (467 candidatos el 14/10).
    for (let pg = 1, paginas = 1; pg <= paginas; pg++) {
      const texto = await portal.llamar("consult/candidate/find-lastname",
        { filters: [{ code: "candidato", value: "" }], orders: { field: "", type: "DESC" }, page: pg, size: PAGINA });
      crudo.push(texto);
      const d = parsearJson(texto) as { data?: Record<string, unknown>[]; pages?: number; total?: number };
      paginas = d.pages ?? 1;
      total = d.total ?? null;
      if (!d.data?.length) break;
      lista.push(...d.data);
      await dormir(PAUSA_MS);
    }
    const filas = normalizarCandidatos({ candidatos: lista });
    const sha = await sha256(crudo.join("\n"));
    const descargado = new Date().toISOString();
    const stats = { filas: filas.length, con_dni: filas.filter((c) => c.dni).length, declarado: total };
    if (p.seco) return { ...stats, seco: true };
    return conDb(env.HYPERDRIVE, async (db) => {
      if (!p.forzar && (await yaCargado(db, FUENTE, "candidatos", sha))) return { ...stats, ya_cargado: true };
      const archivo = `candidatos/candidatos_${descargado.slice(0, 10)}.json`;
      await env.CRUDOS.put(`raw/${FUENTE}/${archivo}`, JSON.stringify({ fuente: "ONPE Claridad · candidatos", descargado_at: descargado, respuestas: crudo }),
        { httpMetadata: { contentType: "application/json" } });
      return db.transaccion(async () => {
        await db.ejecutar("TRUNCATE onpe_candidatos");          // es una foto completa del padrón
        const cols = [...CAND_COLS, "sha256", "descargado_at"];
        for (let i = 0; i < filas.length; i += 1000) {
          const vals: unknown[] = [];
          const tuplas = filas.slice(i, i + 1000).map((f) => {
            const b = vals.length;
            vals.push(...CAND_COLS.map((c) => f[c]), sha, descargado);
            return `(${cols.map((c, j) => `$${b + j + 1}${c === "total_ingresos" ? "::numeric" : c === "descargado_at" ? "::timestamptz" : ""}`).join(", ")})`;
          });
          await db.ejecutar(`INSERT INTO onpe_candidatos (${cols.join(", ")}) VALUES ${tuplas.join(", ")} ` +
            "ON CONFLICT (COALESCE(dni,''), nombre_norm, COALESCE(organizacion,''), COALESCE(proceso,'')) DO NOTHING", vals);
        }
        const [c] = await db.filas<{ n: number; con_dni: number }>("SELECT count(*)::int AS n, count(dni)::int AS con_dni FROM onpe_candidatos");
        await registrarCarga(db, { fuente: FUENTE, clave: "candidatos", tabla: "onpe_candidatos", archivo, gcs_uri: `r2://${BUCKET}/raw/${FUENTE}/${archivo}`,
          sha256: sha, filas: c.n, fuente_url: BACKEND + "consult/candidate/find-lastname", descargado_at: descargado });
        return { ...stats, en_base: c.n, en_base_con_dni: c.con_dni };
      });
    });
  }));
  registrar("INFO", `   aportes: ${resumen.cargados} pares cargados · ${resumen.sin_cambios} sin cambios · ${resumen.fallidos.length} con error · ` +
    `candidatos ${JSON.stringify(candidatos)}`, { fuente: FUENTE, instancia: id });
  return { ...resumen, fallidos: resumen.fallidos.length, candidatos };
}
