/**
 * Las penalidades que las entidades aplicaron a sus contratistas (OSCE/OECE) → `penalidades` (migración 08), cada semana
 * (2026-11-03). La PNDA lista el dataset «Penalidades de contratistas» pero su recurso CSV es una página de la wiki del
 * OSCE en Atlassian, y el archivo está como adjunto de esa página: `penalidades.csv` (contratos desde 2018) y
 * `penalidades2018.csv` (otro corte, sin filas en común), que el OSCE reemplaza casi cada semana (versión 304 el 31 de
 * octubre de 2026). Antes se cargaba a mano una copia del 16 de mayo (backend/scripts/ingest/load_sanciones.py): 12 mil
 * filas hasta mayo; los dos adjuntos suman ~20 mil, hasta la semana anterior.
 *
 * Formato: `|` como separador, CP1252, fecha DD/MM/AA. La tabla se reemplaza entera en una transacción (sólo se usa
 * contada por empresa en los cruces: nadie guarda su id) y sólo si los archivos traen al menos el 90 % de lo que ya hay:
 * un adjunto roto o a medias no la vacía. El RUC del contratista va primero a `empresas` (la llave foránea de la 08).
 * Los cruces de cada día (oece_ocds, `penalidad`) la leen al día siguiente.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri, type Entrada } from "../almacen.ts";
import { registrarCarga } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { decodificarCp1252 } from "../csv.ts";
import { conDb } from "../db.ts";
import { obtener } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, DESCARGA } from "./comun.ts";

const FUENTE = "osce_penalidades";
const PAGINA = "106889271";
const WIKI = "https://osce-gob-pe.atlassian.net/wiki";
const ARCHIVOS = ["penalidades.csv", "penalidades2018.csv"];
const COLS = ["contrato_id", "empresa_ruc", "tipo_penalidad", "objeto_contrato", "entidad_contratante", "fecha", "descripcion", "monto"] as const;

interface Penalidad {
  contrato_id: string | null;
  empresa_ruc: string | null;
  tipo_penalidad: string;
  objeto_contrato: string;
  entidad_contratante: string;
  fecha: string | null;
  descripcion: string;
  monto: number | null;
}

/** DD/MM/AA o DD/MM/AAAA → AAAA-MM-DD; lo que no es una fecha válida, null. */
export function fechaPenalidad(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mes = Number(m[2]);
  const dia = Number(m[1]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || a < 2000 || a > 2100) return null;
  return `${a}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** El CSV de la wiki (ya decodificado) → filas de `penalidades`, con las mismas reglas que load_sanciones.py. */
export function normalizarPenalidades(texto: string): Penalidad[] {
  const lineas = texto.split(/\r?\n/);
  const cab = (lineas[0] ?? "").split("|").map((c) => c.trim().toUpperCase());
  const i = (n: string) => cab.indexOf(n);
  const idx = {
    id: i("ID CONTRATO"), ruc: i("RUC CONTRATISTA"), tipo: i("TIPO PENALIDAD"), objeto: i("OBJETO CONTRATO"),
    entidad: i("ENTIDAD CONTRATANTE"), fecha: i("FECHA PENALIDAD"), desc: i("DESCRIPCION/MOTIVO"), monto: i("MONTO"),
  };
  if (Object.values(idx).some((x) => x < 0)) throw new Error(`[${FUENTE}] la cabecera cambió: ${lineas[0]?.slice(0, 200)}`);
  const out: Penalidad[] = [];
  for (const l of lineas.slice(1)) {
    if (!l.trim()) continue;
    const c = l.split("|");
    const g = (k: number) => (c[k] ?? "").trim();
    const ruc = g(idx.ruc).replace(/\D/g, "");
    const monto = Number(g(idx.monto).replace(",", "."));
    out.push({
      contrato_id: g(idx.id) || null,
      empresa_ruc: /^\d{11}$/.test(ruc) ? ruc : null,
      tipo_penalidad: g(idx.tipo),
      objeto_contrato: g(idx.objeto).slice(0, 500),
      entidad_contratante: g(idx.entidad).slice(0, 500),
      fecha: fechaPenalidad(g(idx.fecha)),
      descripcion: g(idx.desc).slice(0, 500),
      monto: g(idx.monto) && Number.isFinite(monto) ? monto : null,
    });
  }
  return out;
}

/** La versión de cada adjunto en la wiki: sin cambios, no se vuelve a bajar. */
async function versiones(env: Env): Promise<Record<string, string>> {
  const r = await obtener(env, `${WIKI}/rest/api/content/${PAGINA}/child/attachment?limit=50&expand=version`);
  if (!r.ok) throw new Error(`[${FUENTE}] la wiki respondió ${r.status} a la lista de adjuntos`);
  const d = (await r.json()) as { results?: { title: string; version?: { number?: number; when?: string } }[] };
  return Object.fromEntries((d.results ?? []).map((a) => [a.title, `v${a.version?.number ?? "?"} ${a.version?.when ?? ""}`.trim()]));
}

export async function correrPenalidades(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const entradas = await step.do("bajar", DESCARGA, async () => {
    const v = await versiones(env);
    const almacen = new Almacen(env, FUENTE);
    const out: Entrada[] = [];
    for (const a of ARCHIVOS) {
      if (!v[a]) throw new Error(`[${FUENTE}] la wiki ya no tiene el adjunto ${a}`);
      out.push(await almacen.bajar(`${WIKI}/download/attachments/${PAGINA}/${encodeURIComponent(a)}?api=v2`, { archivo: a, modificado: v[a], forzar: p.forzar }));
      registrar("INFO", `   ${a}: ${v[a]}`, { fuente: FUENTE, instancia: id });
    }
    return out;
  });

  return step.do("cargar", CARGA, async () => {
    const almacen = new Almacen(env, FUENTE);
    const filas: Penalidad[] = [];
    const porArchivo: Record<string, number> = {};
    for (const e of entradas) {
      const r = normalizarPenalidades(decodificarCp1252(await almacen.leer(e)));
      porArchivo[nombreArchivo(e)] = r.length;
      filas.push(...r);
    }
    if (p.seco) return { porArchivo, filas: filas.length, seco: true };
    const sha = entradas.map((e) => e.sha256).join(",");
    return conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
      const [{ n: antes }] = await db.filas<{ n: number }>("SELECT count(*)::int AS n FROM penalidades");
      if (filas.length < antes * 0.9) {
        throw new Error(`[${FUENTE}] los adjuntos traen ${filas.length} penalidades y la tabla tiene ${antes}: no se reemplaza`);
      }
      // La llave foránea de la 08: cada contratista en `empresas` (razón social de relleno, como load_sanciones.py).
      const rucs = [...new Set(filas.map((f) => f.empresa_ruc).filter((r): r is string => !!r))];
      for (let i = 0; i < rucs.length; i += 2000) {
        await db.ejecutar(
          `INSERT INTO empresas (ruc, razon_social) SELECT r, '' FROM unnest($1::text[]) r ON CONFLICT (ruc) DO NOTHING`,
          [rucs.slice(i, i + 2000)]);
      }
      await db.ejecutar("DELETE FROM penalidades");
      let n = 0;
      for (let i = 0; i < filas.length; i += 1000) {
        const tanda = filas.slice(i, i + 1000);
        const vals: unknown[] = [];
        const tuplas = tanda.map((f) => {
          const b = vals.length;
          vals.push(...COLS.map((c) => f[c]));
          return `(${COLS.map((c, k) => `$${b + k + 1}${c === "fecha" ? "::date" : c === "monto" ? "::numeric" : ""}`).join(", ")})`;
        });
        n += await db.ejecutar(`INSERT INTO penalidades (${COLS.join(", ")}) VALUES ${tuplas.join(", ")}`, vals);
      }
      await registrarCarga(db, {
        fuente: FUENTE, clave: "penalidades", sha256: sha, tabla: "penalidades", archivo: ARCHIVOS.join(", "),
        gcs_uri: entradas.map(uri).join(", "), bytes: entradas.reduce((s, e) => s + e.bytes, 0), filas: n,
        fuente_url: `${WIKI}/spaces/PNDA/pages/${PAGINA}`, descargado_at: entradas[0]?.downloaded_at ?? null, estado: "ok",
      });
      registrar("INFO", `   → penalidades: ${antes} → ${n}`, { fuente: FUENTE, instancia: id });
      return { porArchivo, antes, ahora: n };
    }));
  });
}
