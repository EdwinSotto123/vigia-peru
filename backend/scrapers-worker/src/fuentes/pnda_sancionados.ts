/**
 * Proveedores sancionados por el Tribunal de Contrataciones (OECE) → `osce_sancionados`. Cruce: RUC con sanción vigente
 * como ganador, postor o socio → bandera CRÍTICA (art. 50 TUO Ley 30225).
 *
 * De dónde (desde el 2026-11-18): los dos CSV que el OECE reemplaza cada semana en su wiki de datos abiertos (la PNDA
 * enlaza ahí; el mismo patrón que osce_penalidades.ts): `sancionados.csv` (inhabilitaciones vigentes) y
 * `sancionados_multa.csv`. Separador `|`, CP1252, fechas AAAAMMDD.
 *
 * Por qué cambió: la fuente tiene clave `pnda_sancionados` porque leía 4 datasets de la PNDA, pero ninguno traía nada
 * nuevo (revisión del 2026-11-17): dos son sólo el enlace a esta wiki, uno es un XLSX de 2018 y el otro, un CSV de un
 * gobierno regional que llega a octubre de 2025. La corrida terminaba «ok» cada domingo sin cargar nada, y la tabla se
 * quedó en junio de 2026: faltaban 1 087 sanciones (1 054 inhabilitaciones temporales, 17 definitivas y 16 multas).
 *
 * Lo que el CSV no trae: el tipo y el periodo. El tipo sale de la fecha de fin (sin fin, definitiva: cotejado con las
 * 8 760 que ya estaban, ninguna lo contradice) y el periodo, de las dos fechas. Las multas del CSV son sólo las que
 * llevan suspensión; su Desde/Hasta es esa suspensión. Sólo agrega: una sanción que ya está no se toca (la vigencia de
 * hoy la corrige la ficha del OECE, migración 337).
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri, type Entrada } from "../almacen.ts";
import { registrarCarga } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { decodificarCp1252, filasDict, leerCsv } from "../csv.ts";
import { conDb } from "../db.ts";
import { obtener } from "../http.ts";
import { asciiNfkd, colapsar, fechaDmy, fechaIso, fechaYmd, strip } from "../py.ts";
import { registrar } from "../registro.ts";
import { CARGA, DESCARGA } from "./comun.ts";

const FUENTE = "pnda_sancionados";
const WIKI = "https://osce-gob-pe.atlassian.net/wiki";
/** Cada adjunto con la página de la wiki que lo lleva y lo que es. */
const ADJUNTOS = [
  { pagina: "106889269", archivo: "sancionados.csv", multa: false },
  { pagina: "106889276", archivo: "sancionados_multa.csv", multa: true },
] as const;
const TIPOS = new Set(["definitivo", "temporal", "multa"]);
const COLS = ["tipo", "razon_social", "razon_social_norm", "ruc", "es_persona_natural", "resolucion", "periodo",
  "fecha_desde", "fecha_hasta", "infraccion", "monto_multa_soles"] as const;

export interface Sancion {
  tipo: string;
  razon_social: string;
  razon_social_norm: string;
  ruc: string;
  es_persona_natural: boolean;
  resolucion: string;
  periodo: string | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  infraccion: string | null;
  /** Sólo en las multas del CSV de la wiki. */
  monto_multa_soles?: number | null;
}

/** `_date`: AAAAMMDD, DD/MM/AAAA o AAAA-MM-DD (como `strptime`: día y mes de 1 o 2 dígitos). */
export function fechaSancion(s: string | null): string | null {
  const t = strip(s ?? "");
  if (/^\d{8}$/.test(t)) return fechaIso(Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6)));
  return fechaDmy(t) ?? fechaYmd(t);
}

const normRazon = (s: string) => colapsar(asciiNfkd(s).toUpperCase());

/** CSV del Tribunal (ya decodificado) → filas para osce_sancionados (`normalize_csv`). */
export function normalizarCsv(texto: string): Sancion[] {
  const out: Sancion[] = [];
  for (const r of filasDict(leerCsv(texto, ";"))) {
    const ruc = strip(r.RUC ?? "");
    if (!/^\d+$/.test(ruc)) continue;
    const inh = strip(r.INH ?? "").toLowerCase();
    const rs = strip(r.RAZON_SOCIAL ?? "");
    out.push({
      tipo: TIPOS.has(inh) ? inh : "temporal",
      razon_social: rs,
      razon_social_norm: normRazon(rs),
      ruc: ruc.padStart(11, "0"),
      es_persona_natural: ruc.startsWith("10"),
      resolucion: strip(r.RESOLUCION ?? ""),
      periodo: strip(r.PERIODO_INH ?? "") || null,
      fecha_desde: fechaSancion(r.DESDE),
      fecha_hasta: fechaSancion(r.HASTA),
      infraccion: strip(`${r.INFRACCION ?? ""} ${r.OTRA_INFRACCION ?? ""}`) || null,
    });
  }
  return out;
}

/** «36 MESES»: los meses enteros entre el inicio y el fin (coincide con el periodo que publica el RNP en 97 de cada 100). */
export function periodoEntre(desde: string | null, hasta: string | null): string | null {
  if (!desde || !hasta) return null;
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  const n = (a2 - a1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return n > 0 ? `${n} MESES` : null;
}

/**
 * Un CSV de la wiki del OECE (ya decodificado) → filas para osce_sancionados. `multa`: el de multas (trae MONTO).
 * Se saltan las filas sin RUC o sin resolución y las que terminan antes de empezar (sanciones dejadas sin efecto).
 */
export function normalizarWiki(texto: string, multa: boolean): Sancion[] {
  const lineas = texto.split(/\r?\n/);
  const cab = (lineas[0] ?? "").split("|").map((c) => c.trim().toUpperCase());
  const i = (n: string) => cab.indexOf(n);
  const idx = { ruc: i("RUC"), razon: i("NOMBRE_RAZONODENOMINACIONSOCIAL"), desde: i("FECHA_INICIO"), hasta: i("FECHA_FIN"),
                res: i("NUMERO_RESOLUCION"), infr: i("DE_MOTIVO_INFRACCION"), monto: i("MONTO") };
  const faltan = Object.entries(idx).filter(([k, v]) => v < 0 && (k !== "monto" || multa)).map(([k]) => k);
  if (faltan.length) throw new Error(`[${FUENTE}] la cabecera del CSV cambió (falta ${faltan.join(", ")}): ${lineas[0]?.slice(0, 200)}`);
  const out: Sancion[] = [];
  for (const l of lineas.slice(1)) {
    if (!l.trim()) continue;
    const c = l.split("|");
    const g = (k: number) => strip(c[k] ?? "");
    const ruc = g(idx.ruc);
    const resolucion = g(idx.res).replace(/\s+/g, "");
    if (!/^\d{8,11}$/.test(ruc) || !resolucion) continue;
    const desde = fechaSancion(g(idx.desde));
    const hasta = fechaSancion(g(idx.hasta));
    if (desde && hasta && hasta < desde) continue;
    const rs = g(idx.razon);
    const monto = multa ? Number(g(idx.monto).replace(",", ".")) : NaN;
    out.push({
      tipo: multa ? "multa" : hasta ? "temporal" : "definitivo",
      razon_social: rs,
      razon_social_norm: normRazon(rs),
      ruc: ruc.padStart(11, "0"),
      es_persona_natural: ruc.padStart(11, "0").startsWith("10"),
      resolucion,
      periodo: periodoEntre(desde, hasta),
      fecha_desde: desde,
      fecha_hasta: hasta,
      infraccion: g(idx.infr) || null,
      monto_multa_soles: multa && Number.isFinite(monto) && monto > 0 ? monto : null,
    });
  }
  return out;
}

/** La versión de un adjunto en su página de la wiki: sin cambios, no se vuelve a bajar. */
async function versionDe(env: Env, pagina: string, archivo: string): Promise<string | null> {
  const r = await obtener(env, `${WIKI}/rest/api/content/${pagina}/child/attachment?limit=50&expand=version`);
  if (!r.ok) throw new Error(`[${FUENTE}] la wiki respondió ${r.status} a la lista de adjuntos de la página ${pagina}`);
  const d = (await r.json()) as { results?: { title: string; version?: { number?: number; when?: string } }[] };
  const a = (d.results ?? []).find((x) => x.title === archivo);
  return a ? `v${a.version?.number ?? "?"} ${a.version?.when ?? ""}`.trim() : null;
}

export async function correrSancionados(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const entradas = await step.do("bajar", DESCARGA, async () => {
    const almacen = new Almacen(env, FUENTE);
    const out: { entrada: Entrada; multa: boolean }[] = [];
    for (const a of ADJUNTOS) {
      const v = await versionDe(env, a.pagina, a.archivo);
      if (!v) throw new Error(`[${FUENTE}] la wiki ya no tiene el adjunto ${a.archivo} en la página ${a.pagina}`);
      out.push({ multa: a.multa, entrada: await almacen.bajar(`${WIKI}/download/attachments/${a.pagina}/${encodeURIComponent(a.archivo)}?api=v2`,
                                                              { archivo: a.archivo, modificado: v, forzar: p.forzar }) });
      registrar("INFO", `   ${a.archivo}: ${v}`, { fuente: FUENTE, instancia: id });
    }
    return out;
  });

  return step.do("cargar", CARGA, async () => {
    const almacen = new Almacen(env, FUENTE);
    const porLlave = new Map<string, Sancion>();
    const archivos: Record<string, number> = {};
    for (const { entrada: e, multa } of entradas) {
      const r = normalizarWiki(decodificarCp1252(await almacen.leer(e)), multa);
      archivos[nombreArchivo(e)] = r.length;
      registrar("INFO", `   ${nombreArchivo(e)} → ${r.length} sanciones`, { fuente: FUENTE, instancia: id });
      // Una sanción una vez: el CSV repite algunas (ruc, resolución), y el índice único rechazaría la tanda entera.
      for (const f of r) if (!porLlave.has(`${f.ruc}|${f.resolucion}`)) porLlave.set(`${f.ruc}|${f.resolucion}`, f);
    }
    const filas = [...porLlave.values()];
    // Un adjunto roto o a medias no es una carga: las inhabilitaciones vigentes son miles.
    if (filas.length < 5000) throw new Error(`[${FUENTE}] los CSV traen sólo ${filas.length} sanciones: no se carga`);
    if (p.seco) return { archivos, filas: filas.length, seco: true };
    const nuevas = await conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
      await db.ejecutar("CREATE UNIQUE INDEX IF NOT EXISTS osce_sancionados_ruc_res_uq ON osce_sancionados (ruc, resolucion)");
      let n = 0;
      for (let k = 0; k < filas.length; k += 1000) {
        const tanda = filas.slice(k, k + 1000);
        const vals: unknown[] = [];
        const tuplas = tanda.map((f) => {
          const b = vals.length;
          vals.push(...COLS.map((c) => f[c] ?? null));
          return `(${COLS.map((c, j) => {
            const ph = `$${b + j + 1}`;
            // La resolución, sin espacios: con espacios sueltos («1494-2008- TC-S3») el índice único (ruc, resolucion) no
            // reconocía la misma sanción (2,376 duplicados el 2026-09-16, migración 221).
            if (c === "resolucion") return `regexp_replace(${ph}, '\\s+', '', 'g')`;
            return `${ph}${c.startsWith("fecha") ? "::date" : c === "es_persona_natural" ? "::boolean" : c === "monto_multa_soles" ? "::numeric" : ""}`;
          }).join(", ")})`;
        });
        n += await db.ejecutar(`INSERT INTO osce_sancionados (${COLS.join(", ")}) VALUES ${tuplas.join(", ")} ON CONFLICT (ruc, resolucion) DO NOTHING`, vals);
      }
      const es = entradas.map((x) => x.entrada);
      await registrarCarga(db, {
        fuente: FUENTE, clave: "sancionados", sha256: es.map((e) => e.sha256).join(","), tabla: "osce_sancionados",
        archivo: ADJUNTOS.map((a) => a.archivo).join(", "), gcs_uri: es.map(uri).join(", "), bytes: es.reduce((t, e) => t + e.bytes, 0),
        filas: n, fuente_url: `${WIKI}/spaces/PNDA/pages/${ADJUNTOS[0].pagina}`, descargado_at: es[0]?.downloaded_at ?? null, estado: "ok",
      });
      return n;
    }));
    registrar("INFO", `   → osce_sancionados: ${nuevas} sanciones nuevas de ${filas.length}`, { fuente: FUENTE, instancia: id });
    return { archivos, filas: filas.length, nuevas };
  });
}
