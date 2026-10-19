/**
 * OECE Contrataciones Abiertas (API OCDS) → cola de auditoría real: port de
 * backend/scrapers/oece_ocds/pipeline.py (detalles verificados de la API en su docstring y en
 * backend/scrapers/README.md).
 *
 *   GET /api/v1/releasesAfter?size=100&startDate=D&endDate=D   (fecha de convocatoria, inclusivas;
 *   cursor en `links.next`). Un proceso aparece en varios releases: queda el más reciente (`date`).
 *
 * Ingesta LIVIANA: registra la convocatoria y la entidad para que existan en la cola; el análisis
 * completo lo hace el orquestador cuando un aporte la financia. Desde Cloudflare en EE.UU. el WAF del
 * OECE responde 403: los GET salen por el relay (Zúrich).
 *
 * Pasos: zonas → días (un paso por día, sus filas a R2) → unir y cargar → refresh_financiamiento().
 */

import type { WorkflowStep } from "cloudflare:workers";
import { clasificar } from "../clasificacion.ts";
import type { Clasificacion } from "../clasificacion.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import type { Db } from "../db.ts";
import { dormir, obtener } from "../http.ts";
import { colapsar, contiene, cortar, dictDe, get, iterar, esDict, o, str, titulo, verdad } from "../py.ts";
import type { Dict } from "../py.ts";
import { registrar } from "../registro.ts";
import { ZonaIndex, resolverUbigeo } from "../ubigeo.ts";
import type { FilaZona } from "../ubigeo.ts";
import { CARGA, LECTURA, fechaLima, sumarDias } from "./comun.ts";

const BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1";
const PAGINA = 100;                        // máximo que acepta `size` en /releasesAfter
const OCID_PREFIJO = "ocds-dgv273-seacev3-";
const VENTANA_DIAS = 7;                    // el release sale días después del inicio del tenderPeriod
const ESPERAS_S = [2, 5, 10, 20, 40];      // entre reintentos ante 429/5xx/timeout
const UMBRAL_UBIGEO = 0.85;                // bajo esto se listan los tríos sin match
const TOPE_PAGINAS = 3000;

/** 'ocds-dgv273-seacev3-1212353' → '1212353' · 'ocds-dgv273-seacev3-2026-10404-12' → '2026-10404-12'. */
export function ocidCorto(ocid: unknown): string {
  const s = verdad(ocid) ? str(ocid) : "";
  if (s.startsWith(OCID_PREFIJO)) return s.slice(OCID_PREFIJO.length);
  // SEACE v2 (≤2013): 'ocds-dgv273-seacev2-2012-123-4' → 'v2-2012-123-4' para no chocar con v3.
  const m = /^ocds-dgv273-seacev(\d)-([\s\S]+)$/.exec(s);
  if (m) return m[1] === "3" ? m[2] : `v${m[1]}-${m[2]}`;
  if (s.startsWith("ocds-")) return s.slice(s.lastIndexOf("-") + 1);
  return s;
}

/** 'SAN IGNACIO' → 'San Ignacio' (misma convención que backend/scripts/ingest). */
export function slugRegion(nombre: unknown): string | null {
  if (!verdad(nombre)) return null;
  return titulo(colapsar(str(nombre))).replaceAll("Ancash", "Áncash").replaceAll("Junin", "Junín");
}

/** Saltos y tabulaciones escritos como texto (`\n`, `\r`, `\t` literales) → un espacio; espacios repetidos → uno. */
export function sinEscapes(s: string): string {
  return s.replace(/\\[nrt]/g, " ").replace(/\s{2,}/g, " ").trim();
}

function partyComprador(rel: Dict): Dict {
  for (const p of iterar(get(rel, "parties"))) {
    const roles = get(dictDe(p), "roles");
    if (contiene(roles, "buyer") || contiene(roles, "procuringEntity")) return dictDe(p);
  }
  return {};
}

function rucComprador(party: Dict): string | null {
  for (const ai of iterar(get(party, "additionalIdentifiers"))) {
    const id = esDict(ai) && Object.hasOwn(ai, "id") ? ai.id : "";
    if (get(ai, "scheme") === "PE-RUC" && Array.from(str(id)).length === 11) return str(id);
  }
  const ident = dictDe(get(party, "identifier"));
  const id = Object.hasOwn(ident, "id") ? ident.id : "";
  if (get(ident, "scheme") === "PE-RUC" && Array.from(str(id)).length === 11) return str(id);
  return null;
}

export interface Fila {
  ocid: string;
  codigo: string;
  date: string;
  entidad_ruc: string;
  entidad_nombre: unknown;
  objeto: string;
  cuantia: unknown;
  fecha: string | null;
  region: string | null;
  departamento: unknown;
  provincia: unknown;
  distrito: unknown;
  ubigeo: string | null;
  categoria: unknown;
  estado_tender: unknown;
  clasificacion: Clasificacion;
  payload: Dict;
}

/** Release OCDS → fila de convocatorias (+ entidad). null si no hay ocid o RUC del comprador. */
export function normalizarRelease(rel: Dict, ix: ZonaIndex): Fila | null {
  const ocid = ocidCorto(o(get(rel, "ocid"), ""));
  const party = partyComprador(rel);
  const ruc = rucComprador(party);
  if (!ocid || !ruc) return null;
  const dir = dictDe(get(party, "address"));
  const tender = dictDe(get(rel, "tender"));
  const valor = dictDe(get(tender, "value"));
  const periodo = dictDe(get(tender, "tenderPeriod"));
  const fecha = cortar(str(o(o(o(get(periodo, "startDate"), get(tender, "datePublished")), get(rel, "date")), "")), 10) || null;
  const [departamento, provincia, distrito] = [get(dir, "department"), get(dir, "region"), get(dir, "locality")];
  // Tipo × etapa × agentes sobre el release completo: acá aún están parties/awards; el payload guardado es recortado.
  const clas = clasificar(rel, ruc);
  const payload: Dict = {};
  for (const k of ["ocid", "id", "date", "tag", "buyer", "tender"]) if (Object.hasOwn(rel, k)) payload[k] = rel[k] ?? null;
  return {
    ocid,
    codigo: str(o(get(tender, "id"), ocid)),
    date: str(o(get(rel, "date"), "")),
    entidad_ruc: ruc,
    entidad_nombre: o(get(dictDe(get(rel, "buyer")), "name"), get(party, "name")),
    // El SEACE manda a veces los saltos de línea escritos como texto ("…PANEL LED \nPARA…"): se vuelven espacios.
    objeto: cortar(sinEscapes(str(o(o(get(tender, "description"), get(tender, "title")), ""))), 600),
    cuantia: o(get(valor, "amount_PEN"), get(valor, "amount")),
    fecha,
    region: slugRegion(o(provincia, departamento)),
    departamento, provincia, distrito,
    ubigeo: resolverUbigeo(ix, departamento, provincia, distrito),
    categoria: get(tender, "mainProcurementCategory"),
    estado_tender: get(tender, "status"),
    clasificacion: clas,
    payload,
  };
}

// ── red ─────────────────────────────────────────────────────────────────────
/**
 * GET con reintentos progresivos ante 429/5xx/timeouts. null si la API responde un error definitivo
 * (4xx distinto de 429), como `_get_json`.
 */
async function obtenerJson(env: Env, url: string, params?: Record<string, string | number>): Promise<Dict | null> {
  for (let i = 0; ; i++) {
    const pausa = ESPERAS_S[i];
    let r: Response;
    try {
      r = await obtener(env, url, { params, relay: true, sinReintentos: true, timeoutMs: 90_000 });
    } catch (e) {
      if (pausa === undefined) throw e;
      registrar("WARNING", `   ${url.split("?")[0].split("/").pop()} → ${(e as Error)?.name ?? e}; reintento ${i + 1} en ${pausa}s`, { fuente: "oece_ocds" });
      await dormir(pausa * 1000);
      continue;
    }
    if (r.status === 200) return (await r.json()) as Dict;
    const cuerpo = await r.text();
    if (r.status === 429 || r.status >= 500) {
      if (pausa === undefined) throw new Error(`HTTP ${r.status} persistente en ${url}`);
      registrar("WARNING", `   HTTP ${r.status}; reintento ${i + 1} en ${pausa}s`, { fuente: "oece_ocds" });
      await dormir(pausa * 1000);
      continue;
    }
    registrar("WARNING", `   HTTP ${r.status} → ${cuerpo.slice(0, 160).replaceAll("\n", " ")}`, { fuente: "oece_ocds" });
    return null;
  }
}

/** Todas las páginas de un día (cursor `links.next`): filas por ocid, quedándose con el release más reciente. */
async function recorrerDia(env: Env, dia: string, ix: ZonaIndex, tope: number): Promise<{ paginas: number; releases: number; filas: Map<string, Fila> }> {
  const filas = new Map<string, Fila>();
  let url: string | null = `${BASE}/releasesAfter`;
  let params: Record<string, string | number> | undefined = { size: PAGINA, startDate: dia, endDate: dia };
  let paginas = 0;
  let releases = 0;
  while (url && paginas < tope) {
    const datos = await obtenerJson(env, url, params);
    params = undefined;                                   // `links.next` ya trae la query completa
    if (!datos) break;
    const rels = iterar(get(datos, "releases"));
    if (!rels.length) break;
    paginas++;
    releases += rels.length;
    for (const rel of rels) {
      if (!esDict(rel)) continue;
      const fila = normalizarRelease(rel, ix);
      if (!fila) continue;
      const previa = filas.get(fila.ocid);
      if (!previa || fila.date > previa.date) filas.set(fila.ocid, fila);
    }
    const sig = get(dictDe(get(datos, "links")), "next");
    url = typeof sig === "string" && sig ? sig : null;
  }
  return { paginas, releases, filas };
}

// ── carga ───────────────────────────────────────────────────────────────────
const COLS_CONV = 21;

/** Upsert de entidades y convocatorias (mismo SQL que load() de Python, en tandas de 500). */
async function cargar(db: Db, filas: Fila[]): Promise<{ convocatorias: number; entidades: number }> {
  const ents = new Map<string, Fila>();
  for (const f of filas) ents.set(f.entidad_ruc, f);
  await db.transaccion(async () => {
    const listaEnts = [...ents.values()];
    for (let i = 0; i < listaEnts.length; i += 500) {
      const tanda = listaEnts.slice(i, i + 500);
      const vals: unknown[] = [];
      const tuplas = tanda.map((f) => {
        vals.push(f.entidad_ruc, cortar(str(o(f.entidad_nombre, "")), 300), slugRegion(f.departamento), slugRegion(f.provincia),
          slugRegion(f.distrito), f.ubigeo && f.ubigeo.length === 6 ? f.ubigeo : null);
        const b = vals.length - 6;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
      });
      // entidades.ubigeo es CHAR(6) = distrito; solo se guarda cuando se resolvió a ese nivel.
      await db.ejecutar(`
        INSERT INTO entidades (ruc, nombre, region, provincia, distrito, ubigeo)
        VALUES ${tuplas.join(", ")}
        ON CONFLICT (ruc) DO UPDATE SET
          ubigeo    = COALESCE(NULLIF(entidades.ubigeo, ''), EXCLUDED.ubigeo),
          region    = COALESCE(entidades.region, EXCLUDED.region),
          provincia = COALESCE(entidades.provincia, EXCLUDED.provincia),
          distrito  = COALESCE(entidades.distrito, EXCLUDED.distrito),
          updated_at = now()`, vals);
    }
    for (let i = 0; i < filas.length; i += 500) {
      const tanda = filas.slice(i, i + 500);
      const vals: unknown[] = [];
      const tuplas = tanda.map((f) => {
        const c = f.clasificacion;
        vals.push(f.ocid, f.codigo, f.entidad_ruc, f.objeto, f.cuantia ?? null, f.fecha, f.region, f.ubigeo, f.categoria ?? null,
          f.estado_tender ?? null, "ocds_api", JSON.stringify(f.payload), c.tipo, c.etapa, c.modalidad, c.procesable,
          c.motivo_no_procesable, c.agentes, c.validaciones_pendientes, c.proveedor_ruc);
        const b = vals.length - (COLS_CONV - 1);
        const p = (k: number) => `$${b + k}`;
        return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}::numeric, ${p(6)}::date, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ` +
          `${p(12)}::jsonb, ${p(13)}, ${p(14)}, ${p(15)}, ${p(16)}::boolean, ${p(17)}, ${p(18)}::text[], ${p(19)}::text[], ${p(20)}, now())`;
      });
      // No se pisa lo que ya cargó el orquestador (objeto, cuantía, payload completo).
      // La clasificación SÍ se actualiza siempre: el release nuevo trae la etapa más reciente.
      await db.ejecutar(`
        INSERT INTO convocatorias (ocid, codigo, entidad_ruc, objeto, cuantia_referencial, fecha_convocatoria,
                                   region, ubigeo, categoria, estado_tender, fuente, ocds_payload,
                                   tipo_contratacion, etapa, modalidad, procesable, motivo_no_procesable,
                                   agentes_aplicables, validaciones_pendientes, proveedor_ruc, clasificado_at)
        VALUES ${tuplas.join(", ")}
        ON CONFLICT (ocid) DO UPDATE SET
          ubigeo              = COALESCE(convocatorias.ubigeo, EXCLUDED.ubigeo),
          objeto              = CASE WHEN convocatorias.objeto = '' THEN EXCLUDED.objeto ELSE convocatorias.objeto END,
          cuantia_referencial = COALESCE(convocatorias.cuantia_referencial, EXCLUDED.cuantia_referencial),
          fecha_convocatoria  = COALESCE(convocatorias.fecha_convocatoria, EXCLUDED.fecha_convocatoria),
          region              = COALESCE(convocatorias.region, EXCLUDED.region),
          categoria           = COALESCE(convocatorias.categoria, EXCLUDED.categoria),
          estado_tender       = COALESCE(EXCLUDED.estado_tender, convocatorias.estado_tender),
          tipo_contratacion   = EXCLUDED.tipo_contratacion,
          etapa               = EXCLUDED.etapa,
          modalidad           = EXCLUDED.modalidad,
          procesable          = EXCLUDED.procesable,
          motivo_no_procesable = EXCLUDED.motivo_no_procesable,
          agentes_aplicables  = EXCLUDED.agentes_aplicables,
          validaciones_pendientes = EXCLUDED.validaciones_pendientes,
          proveedor_ruc       = COALESCE(EXCLUDED.proveedor_ruc, convocatorias.proveedor_ruc),
          clasificado_at      = now(),
          updated_at          = now()`, vals);
    }
  });
  return { convocatorias: filas.length, entidades: ents.size };
}

// ── corrida ─────────────────────────────────────────────────────────────────
export interface ResumenOcds {
  ventana: string;
  dias: number;
  paginas: number;
  releases: number;
  convocatorias: number;
  con_ubigeo: number;
  a_nivel_distrito: number;
  crudo: string;
  cargadas?: { convocatorias: number; entidades: number };
  refresh_s?: number;
  cruces?: { tipo: string; filas: number }[];
  sin_match?: [string, number][];
}

function dias(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) out.push(d);
  return out;
}

async function leerZonas(env: Env): Promise<FilaZona[]> {
  return conDb(env.HYPERDRIVE, (db) => db.filas<FilaZona>("SELECT ubigeo, nivel, nombre, padre_ubigeo FROM zonas"));
}

export async function correrOcds(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<ResumenOcds> {
  const hoy = fechaLima();
  const desde = p.desde || sumarDias(hoy, -VENTANA_DIAS);
  const hasta = p.hasta || hoy;
  const lista = dias(desde, hasta);
  registrar("INFO", `   ventana ${desde} → ${hasta} (${lista.length} días) · tope ${TOPE_PAGINAS} páginas`, { fuente: "oece_ocds", instancia: id });
  const zonas = await step.do("zonas", LECTURA, () => leerZonas(env));
  const ix = ZonaIndex.desdeFilas(zonas);
  const prefijo = `raw/oece_ocds/${hoy}/${id}`;

  // Un paso por día: el día se baja entero o se reintenta entero; sus filas quedan en R2 (un paso
  // devuelve ≤ 1 MiB y un día puede traer 1 000 convocatorias con su tender completo).
  let paginas = 0;
  let releases = 0;
  for (const dia of lista) {
    const tope = TOPE_PAGINAS - paginas;
    if (tope <= 0) {
      registrar("WARNING", `   tope de páginas alcanzado en ${dia}; corto`, { fuente: "oece_ocds", instancia: id });
      break;
    }
    const r = await step.do(`dia ${dia}`, { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: "20 minutes" }, async () => {
      const { paginas, releases, filas } = await recorrerDia(env, dia, ix, tope);
      const ndjson = [...filas.values()].map((f) => JSON.stringify(f)).join("\n");
      await env.CRUDOS.put(`${prefijo}/dia-${dia}.ndjson`, ndjson, { httpMetadata: { contentType: "application/x-ndjson" } });
      return { paginas, releases, filas: filas.size };
    });
    paginas += r.paginas;
    releases += r.releases;
    if (r.releases) {
      registrar("INFO", `   ${dia} · ${String(r.paginas).padStart(3)} pág · ${String(r.releases).padStart(5)} releases · ${r.filas} convocatorias`,
        { fuente: "oece_ocds", instancia: id });
    }
  }

  // Unir los días (un proceso puede caer en dos días si cambió su tenderPeriod: gana el release más
  // reciente, como el dict de Python), guardar el crudo de la ventana y cargar.
  const resumen = await step.do("unir y cargar", CARGA, async () => {
    const filas = new Map<string, Fila>();
    for (const dia of lista) {
      const obj = await env.CRUDOS.get(`${prefijo}/dia-${dia}.ndjson`);
      if (!obj) continue;
      for (const linea of (await obj.text()).split("\n")) {
        if (!linea) continue;
        const f = JSON.parse(linea) as Fila;
        const previa = filas.get(f.ocid);
        if (!previa || f.date > previa.date) filas.set(f.ocid, f);
      }
    }
    const lista_ = [...filas.values()];
    const crudo = `raw/oece_ocds/${hoy}/releases_${desde}_${hasta}.ndjson`;
    await env.CRUDOS.put(crudo, lista_.map((f) => JSON.stringify(f)).join("\n") + (lista_.length ? "\n" : ""),
      { httpMetadata: { contentType: "application/x-ndjson" } });
    await Promise.all(lista.map((dia) => env.CRUDOS.delete(`${prefijo}/dia-${dia}.ndjson`)));
    const sinMatch = new Map<string, number>();
    for (const f of lista_) {
      if (f.ubigeo) continue;
      const trio = JSON.stringify([f.departamento ?? null, f.provincia ?? null, f.distrito ?? null]);
      sinMatch.set(trio, (sinMatch.get(trio) ?? 0) + 1);
    }
    const conUbigeo = lista_.length - [...sinMatch.values()].reduce((a, b) => a + b, 0);
    const out: ResumenOcds = {
      ventana: `${desde} → ${hasta}`, dias: lista.length, paginas, releases, convocatorias: lista_.length, con_ubigeo: conUbigeo,
      a_nivel_distrito: lista_.filter((f) => f.ubigeo && f.ubigeo.length === 6).length, crudo,
    };
    const pct = conUbigeo / Math.max(1, lista_.length);
    if (sinMatch.size && (pct < UMBRAL_UBIGEO || p.seco)) {
      out.sin_match = [...sinMatch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    }
    if (p.seco || !lista_.length) return out;
    out.cargadas = await conDb(env.HYPERDRIVE, (db) => cargar(db, lista_));
    return out;
  });
  registrar("INFO", `   ${resumen.paginas} páginas · ${resumen.releases} releases · ${resumen.convocatorias} convocatorias únicas · ` +
    `${resumen.con_ubigeo} con ubigeo · ${resumen.a_nivel_distrito} a nivel distrito`, { fuente: "oece_ocds", instancia: id });
  if (resumen.sin_match) registrar("WARNING", `   tríos sin match: ${JSON.stringify(resumen.sin_match)}`, { fuente: "oece_ocds", instancia: id });
  if (!resumen.cargadas) return resumen;

  // El mapa y /financiamiento/estado quedan al día (~30 s con 20 mil filas).
  const refresh = await step.do("refresh_financiamiento", CARGA, async () => {
    const t0 = Date.now();
    await conDb(env.HYPERDRIVE, (db) => db.ejecutar("SELECT refresh_financiamiento()"));
    return Math.round((Date.now() - t0) / 1000);
  });
  registrar("INFO", `   → convocatorias upsert ${resumen.cargadas.convocatorias} · entidades ${resumen.cargadas.entidades} · ` +
    `refresh_financiamiento() en ${refresh}s`, { fuente: "oece_ocds", instancia: id });
  // Cruces de los ganadores con ONPE, JNE, visitas, penalidades y sanciones (migración 48, ~2 s). Corre a diario
  // acá porque los procesos nuevos llegan por esta fuente; las demás cambian semanal o mensualmente.
  const cruces = await step.do("refrescar_cruces", CARGA, () =>
    conDb(env.HYPERDRIVE, (db) => db.filas<{ tipo: string; filas: number }>("SELECT * FROM refrescar_cruces()")));
  // Casos cruzados (migración 57): la lista nacional de /cruces, por proceso y ganador.
  await step.do("refrescar_casos_cruce", CARGA, () =>
    conDb(env.HYPERDRIVE, async (db) => (await db.filas<{ n: number }>("SELECT refrescar_casos_cruce() AS n"))[0]?.n ?? 0));
  registrar("INFO", `   → cruces: ${cruces.map((c) => `${c.tipo} ${c.filas}`).join(" · ")}`, { fuente: "oece_ocds", instancia: id });
  return { ...resumen, refresh_s: refresh, cruces };
}
