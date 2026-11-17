/**
 * La ficha del proveedor en el OECE de las empresas sancionadas (migración 337): apto y habilitado hoy, y sus sanciones
 * con su fin y si siguen vigentes. Con eso `ajustar_sanciones_con_ficha()` corrige las señales cuando el Tribunal
 * sustituyó o levantó una inhabilitación, cosa que los datos abiertos de sancionados no reflejan (A & G INDUSTRIES,
 * 2026-11-17: definitiva de 2016 sustituida en 2025 y marcada «sanción vigente» en un contrato de 2026).
 *
 * El OECE responde 403 fuera del Perú: va por el relay de Lima (`relay: "lima"`). Lo mismo que hace
 * backend/scripts/oece_fichas.py desde la PC, por tandas en pasos del Workflow: hasta MAX_EMPRESAS por corrida, las que no
 * se consultaron en 30 días, primero las definitivas y las de fin más reciente. Corre los lunes (src/calendario.ts): en
 * un mes pasa por todas. Al final, los dos ajustes (también los corre la cadena de cruces de cada noche).
 */

import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { obtener } from "../http.ts";

const BASE = "https://eap.oece.gob.pe";
const MAX_EMPRESAS = 700;
const POR_PASO = 35;
const PAUSA_MS = 1200;
const CAMPOS = ["idNumInhab", "descripcion", "nroRes", "fechaResol", "periodo", "fechaIni", "fechaFin", "vigente", "montoTexto"] as const;

const PENDIENTES = `
SELECT ruc FROM (
  SELECT ruc, bool_or(tipo = 'definitivo') AS defin, max(COALESCE(fecha_hasta, DATE '9999-12-31')) AS hasta
    FROM osce_sancionados WHERE ruc ~ '^20[0-9]{9}$' AND tipo IN ('temporal', 'definitivo') GROUP BY ruc) s
 WHERE (s.defin OR s.hasta >= DATE '2025-04-22')
   AND NOT EXISTS (SELECT 1 FROM oece_ficha_proveedor f WHERE f.ruc = s.ruc AND f.consultado_at > now() - interval '30 days')
 ORDER BY s.defin DESC, s.hasta DESC
 LIMIT $1`;

const GUARDAR = `
INSERT INTO oece_ficha_proveedor (ruc, consultado_at, apto, habilitado, sanciones, error)
SELECT x.ruc, now(), x.apto, x.habilitado, x.sanciones, x.error
  FROM jsonb_to_recordset($1::jsonb) AS x(ruc text, apto boolean, habilitado boolean, sanciones jsonb, error text)
ON CONFLICT (ruc) DO UPDATE SET consultado_at = EXCLUDED.consultado_at, apto = EXCLUDED.apto, habilitado = EXCLUDED.habilitado,
  sanciones = EXCLUDED.sanciones, error = EXCLUDED.error`;

interface Ficha {
  ruc: string;
  apto: boolean | null;
  habilitado: boolean | null;
  sanciones: Record<string, unknown>[];
  error: string | null;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json(env: Env, url: string): Promise<Record<string, unknown>> {
  const r = await obtener(env, url, { relay: "lima", timeoutMs: 40_000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

async function ficha(env: Env, ruc: string): Promise<Ficha> {
  try {
    const cns = await json(env, `${BASE}/ficha-proveedor-cns/1.0/ficha/${ruc}`);
    await espera(PAUSA_MS);
    const bus = await json(env, `${BASE}/perfilprov-bus/1.0/ficha/${ruc}`);
    await espera(PAUSA_MS);
    const ant = (cns.antecedentes ?? {}) as { sanciones?: Record<string, unknown>[] };
    const prov = (bus.proveedorT01 ?? {}) as { esAptoContratar?: boolean; esHabilitado?: boolean };
    const sanciones = (ant.sanciones ?? []).map((s) => ({
      ...Object.fromEntries(CAMPOS.map((k) => [k, s[k] ?? null])),
      motivo: Array.isArray(s.motivos) ? (s.motivos[0] ?? null) : null,
    }));
    return { ruc, apto: prov.esAptoContratar ?? null, habilitado: prov.esHabilitado ?? null, sanciones, error: null };
  } catch (e) {
    await espera(PAUSA_MS);
    return { ruc, apto: null, habilitado: null, sanciones: [], error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

export async function correrOeceFichas(env: Env, p: ParamsCorrida, step: WorkflowStep): Promise<unknown> {
  const limite = Math.max(1, Math.min(MAX_EMPRESAS, Number((p as { limite?: number }).limite) || MAX_EMPRESAS));
  const rucs = await step.do("empresas por consultar", { retries: { limit: 2, delay: "30 seconds" }, timeout: "2 minutes" }, () =>
    conDb(env.HYPERDRIVE, async (db) => (await db.filas<{ ruc: string }>(PENDIENTES, [limite])).map((r) => r.ruc)));
  if (p.seco) return { porConsultar: rucs.length };
  const cuenta = { consultadas: 0, errores: 0, habilitadas: 0, conSanciones: 0 };
  for (let i = 0; i < rucs.length; i += POR_PASO) {
    const tanda = rucs.slice(i, i + POR_PASO);
    const r = await step.do(`fichas ${i + 1} a ${i + tanda.length}`, { retries: { limit: 1, delay: "2 minutes" }, timeout: "10 minutes" }, async () => {
      const fichas: Ficha[] = [];
      for (const ruc of tanda) fichas.push(await ficha(env, ruc));
      // Sólo las que respondieron: una que falló (relay apagado, 500 de pasada) vuelve a pedirse la semana siguiente, en vez
      // de quedar 30 días como consultada.
      const buenas = fichas.filter((f) => !f.error);
      if (buenas.length) await conDb(env.HYPERDRIVE, (db) => db.ejecutar(GUARDAR, [JSON.stringify(buenas)]));
      return {
        consultadas: buenas.length, errores: fichas.length - buenas.length,
        habilitadas: buenas.filter((f) => f.habilitado).length, conSanciones: buenas.filter((f) => f.sanciones.length).length,
      };
    });
    for (const k of Object.keys(cuenta) as (keyof typeof cuenta)[]) cuenta[k] += r[k];
    // Sin salida peruana no tiene sentido seguir: la próxima semana continúa.
    if (r.consultadas === 0) return { ...cuenta, porConsultar: rucs.length, cortada: "ninguna ficha respondió en esta tanda (¿relay de Lima apagado?)" };
  }
  const ajustes = await step.do("ajustar señales con la ficha", { retries: { limit: 1, delay: "1 minute" }, timeout: "10 minutes" }, () =>
    conDb(env.HYPERDRIVE, async (db) => {
      const [s] = await db.filas<{ r: unknown }>("SELECT ajustar_sanciones_con_ficha() AS r");
      const [e] = await db.filas<{ r: number }>("SELECT ajustar_empresas_con_ficha() AS r");
      return { sanciones: s?.r ?? null, empresas: e?.r ?? null };
    }));
  return { ...cuenta, porConsultar: rucs.length, ajustes };
}
