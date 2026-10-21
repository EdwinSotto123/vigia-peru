/**
 * Contraloría General de la República, Buscador de Informes → `informes_control` (migración 90): los informes de
 * servicio de control que señalan responsabilidad PENAL, CIVIL o ADMINISTRATIVA de funcionarios. Es responsabilidad
 * PRESUNTA (la Contraloría la identifica y la deriva al Ministerio Público, a la entidad o a su procedimiento
 * sancionador): no es una condena. Ver docs/CORRUPCION.md.
 *
 * Endpoint (JSON, sin captcha ni login): GET BusquedaInformesCGR.ashx?ActionPage=TransportType&Action=loadInformesElastic
 * &PageSize=1000&PageNumber=<n>&pGeneral=%20&pResponsabilidad="PENAL" OR "CIVIL" OR …, lo que arma el buscador
 * (Informes/Avanzada.html). Cada fila trae TotalRows/TotalPages, viene ordenada por fecha de publicación (más nueva
 * primero) y la paginación pasa los 10 000 resultados sin problema. Las cuatro responsabilidades juntas son ~14 100
 * informes (2026-10-21: penal 7 386, civil 5 012, administrativa entidad 10 620, administrativa PAS 3 519): 15 páginas.
 *
 * PRIVACIDAD: cada fila trae en `Text` (y a veces en `Funcionarios`) el DNI y el nombre de cada funcionario. Nada de eso
 * se guarda, ni en la base ni en R2: se toma una lista cerrada de campos (CAMPOS) y de los funcionarios sólo cuántos son.
 *
 * Una página por paso: se baja, se guarda limpia en R2 y se hace upsert por `codigo` (idempotente; un informe que deja
 * de aparecer no se borra). Al final refrescar_informes_control_entidad() resuelve ubigeo y RUC de todos.
 *
 * HOY NO LLEGA: el servidor del buscador (appbp.contraloria.gob.pe) sólo responde a IPs del Perú. Medido el 2026-10-21:
 * 522 directo (Miami), 522 por el relay (Zúrich), timeout con Browser Rendering y desde AWS us-east-2; 200 desde Lima.
 * Por eso no tiene cron: la carga mensual es backend/scripts/cargar_contraloria_informes.py (mismos campos y mismo
 * upsert), desde una PC en el Perú. La fuente queda para cuando haya una salida peruana (GET /diagnostico?partes=cgr
 * dice si ya llega).
 */

import type { WorkflowStep } from "cloudflare:workers";
import { BUCKET } from "../almacen.ts";
import { registrarCarga } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { ErrorHttp, obtener } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, fechaLima } from "./comun.ts";

const FUENTE = "contraloria_informes";
export const URL_BUSCADOR = "https://appbp.contraloria.gob.pe/BuscadorCGR/Informes/BusquedaInformesCGR.ashx";
const POR_PAGINA = 1000;
/** Tope de páginas por corrida (hoy son 15): si la Contraloría cambiara el tamaño de página, no se queda en un bucle. */
const MAX_PAGINAS = 60;
/** Lo que el buscador llama responsabilidad (los valores de su filtro F00x). */
export const RESPONSABILIDADES = ["PENAL", "CIVIL", "ADMINISTRATIVO ENTIDAD", "ADMINISTRATIVO PAS"];
const PASO = { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "10 minutes" } as const;

/** Los únicos campos que se leen de cada fila (ni `Text` ni `Funcionarios`: traen DNI y nombres). */
const CAMPOS = ["CodigoInforme", "NumeroInforme", "Descripcion", "ModalidadServicio", "Sector", "NivelGobierno", "Entidad",
  "Departamento", "Provincia", "Distrito", "Responsabilidad", "TotalFuncionarios", "FechaEmision", "FechaPublicacion",
  "FechaFinEjecucion", "RutaCloudInforme", "RutaCloudResumen", "ResumenInforme", "ResumenEjecutivo"] as const;
type FilaCgr = Partial<Record<(typeof CAMPOS)[number], unknown>> & { TotalPages?: unknown; TotalRows?: unknown };

export interface Informe {
  codigo: string;
  numero: string | null;
  titulo: string | null;
  modalidad: string | null;
  sector: string | null;
  nivel_gobierno: string | null;
  entidad_nombre: string;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  responsabilidades: string[];
  funcionarios: number | null;
  fecha_emision: string | null;
  fecha_publicacion: string | null;
  fecha_fin_ejecucion: string | null;
  url_pdf: string | null;
  url_resumen: string | null;
}

/** La consulta del buscador: las responsabilidades unidas con OR, como las arma su JavaScript. */
export function urlPagina(pagina: number, responsabilidades: string[] = RESPONSABILIDADES): string {
  const u = new URL(URL_BUSCADOR);
  u.search = new URLSearchParams({
    ActionPage: "TransportType", Action: "loadInformesElastic", PageSize: String(POR_PAGINA), PageNumber: String(pagina),
    pGeneral: " ", pResponsabilidad: responsabilidades.map((r) => `"${r}"`).join(" OR "),
  }).toString();
  return u.toString();
}

/** Texto limpio: sin espacios de relleno (la Contraloría rellena varios campos a 400 caracteres). */
const txt = (v: unknown) => (v == null ? null : String(v).replace(/\s+/g, " ").trim() || null);

/** '2026/09/24' → '2026-09-24'; cualquier otra cosa, null. */
export function fechaCgr(v: unknown): string | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(txt(v) ?? "");
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3]) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** 'CIVIL ,PENAL , ADMINISTRATIVO PAS' → ['administrativa_pas', 'civil', 'penal']. */
export function responsabilidades(v: unknown): string[] {
  const nombres: Record<string, string> = {
    PENAL: "penal", CIVIL: "civil", "ADMINISTRATIVO ENTIDAD": "administrativa_entidad",
    "ADMINISTRATIVO PAS": "administrativa_pas", ADMINISTRATIVO: "administrativa",
  };
  const out = new Set<string>();
  for (const parte of String(v ?? "").split(",")) {
    const r = parte.replace(/\s+/g, " ").trim().toUpperCase();
    if (r) out.add(nombres[r] ?? r.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  }
  return [...out].sort();
}

/** Los enlaces vienen en http:// (redirige a https). */
const https = (v: unknown) => txt(v)?.replace(/^http:\/\//i, "https://") ?? null;

/** Una fila del buscador → informe, sin datos de personas. null si no trae código o entidad. */
export function aInforme(f: FilaCgr): Informe | null {
  const codigo = txt(f.CodigoInforme);
  const entidad = txt(f.Entidad);
  if (!codigo || !entidad) return null;
  const n = Number(txt(f.TotalFuncionarios));
  return {
    codigo,
    numero: txt(f.NumeroInforme),
    titulo: txt(f.Descripcion),
    modalidad: txt(f.ModalidadServicio),
    sector: txt(f.Sector),
    nivel_gobierno: txt(f.NivelGobierno),
    entidad_nombre: entidad,
    departamento: txt(f.Departamento),
    provincia: txt(f.Provincia),
    distrito: txt(f.Distrito),
    responsabilidades: responsabilidades(f.Responsabilidad),
    funcionarios: Number.isInteger(n) && n >= 0 ? n : null,
    fecha_emision: fechaCgr(f.FechaEmision),
    fecha_publicacion: fechaCgr(f.FechaPublicacion),
    fecha_fin_ejecucion: fechaCgr(f.FechaFinEjecucion),
    url_pdf: https(f.RutaCloudInforme ?? f.ResumenInforme),
    url_resumen: https(f.RutaCloudResumen ?? f.ResumenEjecutivo),
  };
}

/** Una respuesta del buscador → informes y total de páginas. */
export function parsearPagina(texto: string): { informes: Informe[]; paginas: number; total: number } {
  const filas = JSON.parse(texto) as FilaCgr[];
  if (!Array.isArray(filas)) throw new Error("el buscador no devolvió una lista");
  const informes = filas.map(aInforme).filter((x): x is Informe => x !== null);
  return { informes, paginas: Number(filas[0]?.TotalPages ?? 0) || 0, total: Number(filas[0]?.TotalRows ?? 0) || 0 };
}

/** GET directo; si el buscador no responde a Cloudflare (403, 5xx o red), por el relay de Zúrich. */
async function leerPagina(env: Env, url: string): Promise<{ texto: string; via: string }> {
  try {
    const r = await obtener(env, url, { timeoutMs: 120_000 });
    if (r.ok) return { texto: await r.text(), via: "directo" };
    await r.body?.cancel();
    if (r.status !== 403 && r.status < 500) throw new ErrorHttp(r.status, url);
    registrar("WARNING", `   Contraloría respondió ${r.status} directo: voy por el relay`, { fuente: FUENTE });
  } catch (e) {
    if (e instanceof ErrorHttp) throw e;
    registrar("WARNING", `   Contraloría directo falló (${String((e as Error)?.message ?? e).slice(0, 120)}): voy por el relay`, { fuente: FUENTE });
  }
  const r = await obtener(env, url, { relay: true, timeoutMs: 120_000 });
  if (!r.ok) {
    await r.body?.cancel();
    throw new ErrorHttp(r.status, url, r.status === 522 || r.status === 504
      ? "por el relay: la Contraloría no responde fuera del Perú; cargar con backend/scripts/cargar_contraloria_informes.py"
      : "por el relay");
  }
  return { texto: await r.text(), via: "relay" };
}

const COLS = ["codigo", "numero", "titulo", "modalidad", "sector", "nivel_gobierno", "entidad_nombre", "departamento", "provincia",
  "distrito", "responsabilidades", "funcionarios", "fecha_emision", "fecha_publicacion", "fecha_fin_ejecucion", "url_pdf", "url_resumen"] as const;
const ACTUALIZABLES = COLS.filter((c) => c !== "codigo");

/** Upsert por código: un solo parámetro JSON (1 000 filas × 17 columnas pasarían el límite de parámetros de pg). */
const SQL_UPSERT = `
  INSERT INTO informes_control AS ic (${COLS.join(", ")})
  SELECT ${COLS.join(", ")} FROM jsonb_to_recordset($1::jsonb) AS x (
    codigo TEXT, numero TEXT, titulo TEXT, modalidad TEXT, sector TEXT, nivel_gobierno TEXT, entidad_nombre TEXT,
    departamento TEXT, provincia TEXT, distrito TEXT, responsabilidades TEXT[], funcionarios INT, fecha_emision DATE,
    fecha_publicacion DATE, fecha_fin_ejecucion DATE, url_pdf TEXT, url_resumen TEXT)
  ON CONFLICT (codigo) DO UPDATE SET ${ACTUALIZABLES.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, updated_at = now()
  WHERE (${ACTUALIZABLES.map((c) => `ic.${c}`).join(", ")}) IS DISTINCT FROM (${ACTUALIZABLES.map((c) => `EXCLUDED.${c}`).join(", ")})`;

export async function correrContraloria(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const hoy = fechaLima();
  const resumen: Record<string, unknown> = { paginas: 0, informes: 0, escritos: 0, via: {} as Record<string, number> };
  let paginas = 1;
  for (let n = 1; n <= paginas && n <= MAX_PAGINAS; n++) {
    const r = await step.do(`página ${n}`, PASO, async () => {
      const url = urlPagina(n);
      const { texto, via } = await leerPagina(env, url);
      const { informes, paginas: total_paginas, total } = parsearPagina(texto);
      // Crudo LIMPIO en R2 (sólo los campos que se cargan): el original trae DNI y nombres.
      await env.CRUDOS.put(`raw/${FUENTE}/${hoy}/pagina-${String(n).padStart(3, "0")}.json`,
        JSON.stringify({ url, pagina: n, total, total_paginas, informes }), { httpMetadata: { contentType: "application/json" } });
      if (p.seco || !informes.length) return { informes: informes.length, escritos: 0, total_paginas, total, via };
      const escritos = await conDb(env.HYPERDRIVE, (db) => db.ejecutar(SQL_UPSERT, [JSON.stringify(informes)]));
      registrar("INFO", `   página ${n}/${total_paginas}: ${informes.length} informes, ${escritos} nuevos o cambiados (${via})`, { fuente: FUENTE, instancia: id });
      return { informes: informes.length, escritos, total_paginas, total, via };
    });
    paginas = r.total_paginas;
    resumen.paginas = n;
    resumen.total_buscador = r.total;
    resumen.informes = (resumen.informes as number) + r.informes;
    resumen.escritos = (resumen.escritos as number) + r.escritos;
    const via = resumen.via as Record<string, number>;
    via[r.via] = (via[r.via] ?? 0) + 1;
  }
  if (p.seco) return { ...resumen, seco: true };

  resumen.cruce = await step.do("refrescar_informes_control_entidad", CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
    const [c] = await db.filas<{ informes: number; con_ubigeo: number; con_ruc: number; ambiguos: number }>(
      "SELECT * FROM refrescar_informes_control_entidad()");
    // Para /admin/cobertura: una carga por corrida, con la huella de lo que quedó en la tabla.
    const [h] = await db.filas<{ sha: string }>(
      `SELECT encode(sha256(convert_to(coalesce(string_agg(codigo || '|' || coalesce(fecha_publicacion::text, ''), ',' ORDER BY codigo), ''), 'UTF8')), 'hex') AS sha
         FROM informes_control`);
    await registrarCarga(db, {
      fuente: FUENTE, clave: "con_responsabilidad", tabla: "informes_control", archivo: `${hoy}`,
      gcs_uri: `r2://${BUCKET}/raw/${FUENTE}/${hoy}/`, sha256: h.sha, filas: c.informes,
      fuente_url: URL_BUSCADOR, descargado_at: new Date().toISOString(),
    });
    registrar("INFO", `   cruce: ${c.con_ruc}/${c.informes} con RUC, ${c.con_ubigeo} con distrito, ${c.ambiguos} ambiguos`, { fuente: FUENTE, instancia: id });
    return c;
  }));
  return resumen;
}
