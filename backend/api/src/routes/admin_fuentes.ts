/**
 * /admin/fuentes — de dónde salen los datos y en qué está cada pipeline, auditable desde el panel.
 *
 *   GET /admin/fuentes  → {
 *     agenda:     cada fuente de vigia-scrapers con cuándo corre (la de src/calendario.ts) y su última corrida,
 *     corridas:   las últimas 150 corridas de corridas_fuente (migración 74): quién la lanzó, parámetros,
 *                 duración, resumen o error,
 *     documentos: los pedidos de descarga por estado (sólo contratos financiados) y los últimos lotes de la fuente
 *                 `documentos`, con lo que hay vigente en el almacén,
 *     base:       los contratos de la base por año (con ganador, en la cola, leídos) y los procesos adjudicados
 *                 (CONOSCE desde 2018, OCDS antes), y la ventana de la cola,
 *     derivados:  cuándo se refrescaron las vistas del mapa, el financiamiento y los contratos.
 *   }
 * Con caché de 1 minuto, como /admin/cobertura. Lo lee también el revisor.
 */

import { Hono } from "hono";
import { poolAdmin as pool } from "../lib/db.js";

export const adminFuentesRouter = new Hono();

/**
 * La agenda de vigia-scrapers. Es la de backend/scrapers-worker/src/calendario.ts (crons de wrangler.jsonc, hora de
 * Lima): si cambia allá, cambia acá. `lanza` son las que corren dentro de otra.
 */
const AGENDA: { fuente: string; nombre: string; agenda: string; que: string; lanza?: string[] }[] = [
  { fuente: "oece_ocds", nombre: "OECE · contratos (OCDS)", agenda: "Diario, 06:00", que: "Convocatorias de los últimos 7 días con su ganador; después, cruces y casos cruzados. Con relleno: la historia desde 2015, día por día." },
  { fuente: "documentos", nombre: "Documentos de los financiados", agenda: "Cada hora, al minuto 40", que: "Los expedientes (bases, actas, contratos) de los contratos financiados, a R2. Nada más se descarga." },
  { fuente: "conosce", nombre: "CONOSCE · adjudicaciones, postores, contratos", agenda: "Sábados, 08:00", que: "Reportes del SEACE desde 2018; después, consorcios, procesos por partido y cruces." },
  { fuente: "conosce_ordenes", nombre: "CONOSCE · órdenes de compra y servicio", agenda: "Sábados, 08:00", que: "Los últimos 3 meses de órdenes; después, fraccionamiento (órdenes del mismo día que pasan 8 UIT)." },
  { fuente: "mef_presupuesto", nombre: "MEF · presupuesto", agenda: "Lunes, 08:00", que: "Presupuesto y gasto por ejecutora; lanza el detalle (en qué gasta) en tres pasadas.", lanza: ["mef_detalle", "mef_cargar_gasto"] },
  { fuente: "onpe_claridad", nombre: "ONPE · aportes y candidatos", agenda: "Miércoles, 08:00", que: "Aportantes y candidatos de Claridad." },
  { fuente: "onpe_gastos", nombre: "ONPE · gastos de campaña", agenda: "Miércoles, 08:00", que: "Proveedores de las campañas." },
  { fuente: "pnda_sancionados", nombre: "Tribunal · sancionados", agenda: "Domingos, 08:00", que: "Proveedores sancionados e inhabilitados." },
  { fuente: "pnda_visitas", nombre: "Registro de visitas", agenda: "Días 1 y 15, 08:00", que: "Visitas a las entidades." },
  { fuente: "pnda_dji", nombre: "Declaraciones juradas de intereses", agenda: "Día 5, 08:00", que: "DJI de funcionarios." },
  { fuente: "jne_infogob", nombre: "JNE · autoridades electas", agenda: "Día 5, 08:00", que: "Autoridades y su organización política." },
  { fuente: "pnda_oece", nombre: "OECE · penalidades y adicionales", agenda: "Día 1, 08:00", que: "Datasets del OECE en la Plataforma Nacional de Datos Abiertos." },
  { fuente: "oece_historico", nombre: "OECE · procesos 2015-2017", agenda: "A mano (relleno)", que: "Procesos adjudicados antes de 2018, que CONOSCE no trae." },
];

let cache: { at: number; body: unknown } | null = null;

const filas = <T = Record<string, unknown>>(sql: string, vals: unknown[] = []) =>
  pool.query(sql, vals).then((r) => r.rows as T[]).catch((e) => {
    console.warn(`[admin/fuentes] ${String((e as Error).message).slice(0, 160)}`);
    return null;
  });

adminFuentesRouter.get("/fuentes", async (c) => {
  if (cache && Date.now() - cache.at < 60_000) return c.json(cache.body);
  const [corridas, ultimas, pedidos, lotes, almacen, base, procesos, cola, derivados] = await Promise.all([
    filas(`SELECT instancia, fuente, origen, params, estado, inicio, fin, segundos, resumen, error
             FROM corridas_fuente ORDER BY inicio DESC LIMIT 150`),
    // La última de cada fuente y cuántas salieron bien o mal en 30 días.
    filas(`SELECT DISTINCT ON (fuente) fuente, instancia, estado, inicio, fin, segundos, error,
                  count(*) FILTER (WHERE estado = 'ok' AND inicio > now() - interval '30 days') OVER (PARTITION BY fuente)::int AS ok30,
                  count(*) FILTER (WHERE estado = 'error' AND inicio > now() - interval '30 days') OVER (PARTITION BY fuente)::int AS error30
             FROM corridas_fuente ORDER BY fuente, inicio DESC`),
    filas(`SELECT estado, motivo, count(*)::int AS n, max(solicitado_at) AS ultimo FROM pedidos_descarga GROUP BY 1, 2 ORDER BY 1, 2`),
    filas(`SELECT id, estado, total::int, ok::int, fallidos::int, iniciado_at AS "iniciadoAt", finalizado_at AS "finalizadoAt", error
             FROM lotes_ingesta WHERE id LIKE 'cf-%' ORDER BY iniciado_at DESC NULLS LAST LIMIT 15`),
    filas(`SELECT count(*) FILTER (WHERE borrado_at IS NULL AND expira_at > now())::int AS vigentes,
                  COALESCE(sum(bytes) FILTER (WHERE borrado_at IS NULL AND expira_at > now()), 0)::bigint AS bytes,
                  count(DISTINCT ocid) FILTER (WHERE borrado_at IS NULL AND expira_at > now())::int AS contratos,
                  count(*) FILTER (WHERE lote_id LIKE 'cf-%')::int AS "deCloudflare"
             FROM documentos_gcs`),
    // Por año: lo de la vista contratos_agregado (al día cada 10 min) y, aparte, cuántos tienen ganador (sin abrir el
    // jsonb: adjudicaciones o proveedor_ruc). Juntos sobre convocatorias × contrato_estado tardaba ~45 s con la historia.
    filas(`SELECT a.anio, a.contratos, a."enCola", a.leidos, g."conGanador" FROM
             (SELECT extract(year FROM mes)::int AS anio, sum(n)::int AS contratos,
                     COALESCE(sum(n) FILTER (WHERE operativo = 'en_cola'), 0)::int AS "enCola",
                     COALESCE(sum(n) FILTER (WHERE riesgo <> 'sin_analizar'), 0)::int AS leidos
                FROM contratos_agregado GROUP BY 1) a
             LEFT JOIN (SELECT extract(year FROM fecha_convocatoria)::int AS anio,
                               count(*) FILTER (WHERE adjudicaciones IS NOT NULL OR proveedor_ruc IS NOT NULL)::int AS "conGanador"
                          FROM convocatorias WHERE ocid NOT LIKE 'ocds-vigia-%' GROUP BY 1) g ON g.anio IS NOT DISTINCT FROM a.anio
            ORDER BY a.anio DESC NULLS LAST`),
    filas(`SELECT anio, sum(n)::int AS procesos, string_agg(DISTINCT fuente, ' y ') AS fuente FROM (
             SELECT anio::int AS anio, count(DISTINCT codigo_convocatoria) AS n, 'CONOSCE' AS fuente FROM conosce_adjudicaciones GROUP BY 1
             UNION ALL
             SELECT extract(year FROM fecha_convocatoria)::int, count(*), 'OCDS' FROM procesos_historicos WHERE fecha_convocatoria < DATE '2018-01-01' GROUP BY 1
           ) x GROUP BY anio ORDER BY anio DESC`),
    filas(`SELECT (SELECT valor->>'cola_desde' FROM ajustes WHERE clave = 'procesamiento') AS desde,
                  (SELECT sum(pendientes)::int FROM zona_estado WHERE length(ubigeo) = 2) AS financiable`),
    filas(`SELECT nombre, refrescado_at AS "refrescadoAt", duracion_ms AS "duracionMs", refrescos::int FROM derivados_refresco ORDER BY nombre`),
  ]);
  const porFuente = new Map((ultimas ?? []).map((u) => [String(u.fuente), u]));
  const agenda = AGENDA.map((a) => ({ ...a, ultima: porFuente.get(a.fuente) ?? null, lanzadas: (a.lanza ?? []).map((f) => porFuente.get(f) ?? { fuente: f }) }));
  const body = {
    agenda,
    corridas: corridas ?? [],
    sinBitacora: corridas === null,
    documentos: { pedidos: pedidos ?? [], lotes: lotes ?? [], almacen: almacen?.[0] ?? null },
    base: { porAnio: base ?? [], procesos: procesos ?? [], cola: cola?.[0] ?? null },
    derivados: derivados ?? [],
    generadoAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), body };
  return c.json(body);
});
