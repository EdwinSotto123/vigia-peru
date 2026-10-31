/**
 * /admin/fuentes — de dónde salen los datos y en qué está cada pipeline, auditable desde el panel.
 *
 *   GET /admin/fuentes  → {
 *     agenda:     cada fuente del catálogo (lib/catalogoFuentes.ts: Worker, PC y CI) con dónde y cuándo corre, su última
 *                 corrida, sus cargas y su estado (al día, atrasada, falló…),
 *     corridas:   las últimas 150 corridas de corridas_fuente (migración 74): quién la lanzó, parámetros,
 *                 duración, resumen o error,
 *     documentos: los pedidos de descarga por estado (sólo contratos financiados) y los últimos lotes de la fuente
 *                 `documentos`, con lo que hay vigente en el almacén,
 *     base:       los contratos de la base por año (con ganador, en la cola, leídos) y los procesos adjudicados
 *                 (CONOSCE desde 2018, OCDS antes), guardados en admin_cache (migración 219) con `calculadoAt`, y la
 *                 ventana de la cola,
 *     derivados:  cuándo se refrescaron las vistas del mapa, el financiamiento y los contratos.
 *   }
 * Con caché de 1 minuto, como /admin/cobertura. Lo lee también el revisor.
 */

import { Hono } from "hono";
import { poolAdmin as pool } from "../lib/db.js";
import { agregado, type ClaveAgregado } from "../lib/agregadosPanel.js";
import { estadoFuentes } from "../lib/catalogoFuentes.js";

export const adminFuentesRouter = new Hono();

let cache: { at: number; body: unknown } | null = null;

const avisar = (e: unknown) => {
  console.warn(`[admin/fuentes] ${String((e as Error).message).slice(0, 160)}`);
  return null;
};

const filas = <T = Record<string, unknown>>(sql: string, vals: unknown[] = []) =>
  pool.query(sql, vals).then((r) => r.rows as T[]).catch(avisar);

const guardado = (clave: ClaveAgregado) => agregado<Record<string, unknown>[]>(clave).catch(avisar);

adminFuentesRouter.get("/fuentes", async (c) => {
  if (cache && Date.now() - cache.at < 60_000) return c.json(cache.body);
  const [corridas, estados, pedidos, lotes, almacen, base, procesos, cola, derivados] = await Promise.all([
    filas(`SELECT instancia, fuente, origen, params, estado, inicio, fin, segundos, resumen, error
             FROM corridas_fuente ORDER BY inicio DESC LIMIT 150`),
    // Cada fuente del catálogo con su última corrida, sus cargas y su estado (lib/catalogoFuentes.ts).
    estadoFuentes(pool),
    filas(`SELECT estado, motivo, count(*)::int AS n, max(solicitado_at) AS ultimo FROM pedidos_descarga GROUP BY 1, 2 ORDER BY 1, 2`),
    filas(`SELECT id, estado, total::int, ok::int, fallidos::int, iniciado_at AS "iniciadoAt", finalizado_at AS "finalizadoAt", error
             FROM lotes_ingesta WHERE id LIKE 'cf-%' ORDER BY iniciado_at DESC NULLS LAST LIMIT 15`),
    filas(`SELECT count(*) FILTER (WHERE borrado_at IS NULL AND expira_at > now())::int AS vigentes,
                  COALESCE(sum(bytes) FILTER (WHERE borrado_at IS NULL AND expira_at > now()), 0)::bigint AS bytes,
                  count(DISTINCT ocid) FILTER (WHERE borrado_at IS NULL AND expira_at > now())::int AS contratos,
                  count(*) FILTER (WHERE lote_id LIKE 'cf-%')::int AS "deCloudflare"
             FROM documentos_gcs`),
    // Los contratos y los procesos por año recorren las tablas grandes (0.7 y 2.2 s en PROD): salen de admin_cache, al día
    // cada 25 min (lib/agregadosPanel.ts).
    guardado("fuentes.base"),
    guardado("fuentes.procesos"),
    filas(`SELECT (SELECT valor->>'cola_desde' FROM ajustes WHERE clave = 'procesamiento') AS desde,
                  (SELECT sum(pendientes)::int FROM zona_estado WHERE length(ubigeo) = 2) AS financiable`),
    filas(`SELECT nombre, refrescado_at AS "refrescadoAt", duracion_ms AS "duracionMs", refrescos::int FROM derivados_refresco ORDER BY nombre`),
  ]);
  const body = {
    agenda: estados,
    corridas: corridas ?? [],
    sinBitacora: corridas === null,
    documentos: { pedidos: pedidos ?? [], lotes: lotes ?? [], almacen: almacen?.[0] ?? null },
    base: {
      porAnio: base?.valor ?? [],
      procesos: procesos?.valor ?? [],
      cola: cola?.[0] ?? null,
      calculadoAt: base?.calculadoAt ?? null, // de cuándo son las cifras por año
    },
    derivados: derivados ?? [],
    generadoAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), body };
  return c.json(body);
});
