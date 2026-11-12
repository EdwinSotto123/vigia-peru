/**
 * Operación del panel admin (plan 2026-09-16 · U4). Se monta bajo /admin (hereda el x-admin-token).
 *
 *   GET  /admin/operacion                         resumen en una pantalla: dispatcher (última corrida), servicios de
 *                                                 agentes y relay (lib/salud.ts: último estado conocido, nunca espera
 *                                                 un sondeo), cola por estado, pedidos de descarga, aportes por validar,
 *                                                 alertas en revisión, último lote
 *   POST /admin/procesamientos/:ocid/reanalizar   vuelve a encolar un contrato ya procesado (≈ US$ 0.25, ~3 min);
 *                                                 409 si hay un procesamiento activo (Cloud Run devuelve 429 al 2.º request)
 *   GET  /admin/cobertura/progreso                lote nocturno de documentos: descargados vs publicados, ritmo, estimación,
 *                                                 últimos errores por ítem
 *   GET  /admin/masivo                            análisis masivo (migr. 272 y 274): gasto frente al tope, por red, por
 *                                                 día, tandas de GitLab y últimos contratos
 *
 * Los servicios de agentes se consultan SIEMPRE desde la API (nunca desde el navegador): son URLs
 * internas y el health de Cloud Run tarda si la instancia arranca en frío.
 */

import { Hono } from "hono";
import { poolAdmin as pool } from "../lib/db.js"; // pool del panel (lib/db.ts)
import { actor, log } from "../lib/adminlog.js";
import { ingestaConvocatorias, saludRelay, saludServicios } from "../lib/salud.js";

export const adminOperacionRouter = new Hono();

// ─── GET /operacion ──────────────────────────────────────────────────────────
adminOperacionRouter.get("/operacion", async (c) => {
  const [disp, cola, pedidos, aportes, revision, lote, ingesta, servicios, relay, ultimos] = await Promise.all([
    pool.query(`SELECT max(iniciado_at) AS "ultimoInicio", max(latido_at) AS "ultimoLatido", max(finalizado_at) AS "ultimoFin",
                       count(*) FILTER (WHERE estado = 'procesando')::int AS activos,
                       count(*) FILTER (WHERE estado = 'procesando' AND latido_at < now() - interval '20 minutes')::int AS colgados,
                       count(*) FILTER (WHERE estado = 'procesado' AND finalizado_at >= now() - interval '24 hours')::int AS "procesados24h",
                       count(*) FILTER (WHERE estado = 'error')::int AS errores
                FROM procesamientos`).then((q) => q.rows[0]),
    pool.query(`SELECT estado, count(*)::int AS n FROM procesamientos GROUP BY estado`).then((q) => Object.fromEntries(q.rows.map((r) => [r.estado, r.n])) as Record<string, number>),
    pool.query(`SELECT count(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes,
                       count(*) FILTER (WHERE estado = 'descargando')::int AS descargando,
                       count(*) FILTER (WHERE estado = 'fallido')::int AS fallidos,
                       count(*) FILTER (WHERE estado = 'listo' AND atendido_at >= now() - interval '24 hours')::int AS "listos24h"
                FROM pedidos_descarga`).then((q) => q.rows[0]).catch(() => null),
    pool.query(`SELECT count(*) FILTER (WHERE estado = 'pendiente_pago' AND comprobante_url IS NOT NULL)::int AS "pendientesValidar",
                       count(*) FILTER (WHERE estado = 'pendiente_pago' AND comprobante_url IS NOT NULL)::int AS "conComprobante",
                       count(*) FILTER (WHERE estado IN ('pagada','en_proceso')
                         AND contratos > (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = contribuciones.id))::int AS "esperandoContratos"
                FROM contribuciones`).then((q) => q.rows[0]),
    pool.query(`SELECT count(*)::int AS n, min(analizado_en) AS "masAntigua" FROM alertas WHERE estado = 'revision'`).then((q) => q.rows[0]),
    pool.query(`SELECT id, tipo, estado, total::int, ok::int, fallidos::int, iniciado_at AS "iniciadoAt", finalizado_at AS "finalizadoAt", error
                FROM lotes_ingesta WHERE tipo = 'documentos' ORDER BY COALESCE(finalizado_at, iniciado_at, creado_at) DESC NULLS LAST LIMIT 1`)
      .then((q) => q.rows[0] ?? null).catch(() => null),
    // Compartida con /salud y en caché 30 s (lib/salud.ts).
    ingestaConvocatorias(),
    // Salud externa (lib/salud.ts): último estado conocido al instante; el sondeo corre en segundo plano.
    saludServicios(),
    saludRelay(),
    pool.query(`SELECT p.ocid, p.finalizado_at AS "finalizadoAt", EXTRACT(EPOCH FROM (p.finalizado_at - p.iniciado_at))::int AS segundos,
                       cv.objeto AS titulo, a.score, a.estado AS "alertaEstado"
                FROM procesamientos p JOIN convocatorias cv ON cv.ocid = p.ocid
                LEFT JOIN alertas a ON ocid_corto(a.ocid) = ocid_corto(p.ocid)
                WHERE p.estado = 'procesado' ORDER BY p.finalizado_at DESC NULLS LAST LIMIT 5`).then((q) => q.rows),
  ]);
  const ultimaCorrida: string | null = disp.ultimoLatido ?? disp.ultimoFin ?? disp.ultimoInicio ?? null;
  const horas = ultimaCorrida ? (Date.now() - new Date(ultimaCorrida).getTime()) / 36e5 : null;
  const horasIngesta = ingesta.ultimaIngesta ? (Date.now() - new Date(ingesta.ultimaIngesta).getTime()) / 36e5 : null;
  return c.json({
    dispatcher: { ...disp, ultimaCorrida, horasDesdeUltimaCorrida: horas,
      // Sin nada en cola no hay corrida que registrar: eso también es "ok".
      ok: disp.colgados === 0 && (disp.activos > 0 || (cola.encolado ?? 0) === 0 || (horas !== null && horas < 1)) },
    cola,
    servicios,
    relay,
    pedidos,
    aportes,
    revision,
    lote,
    ingesta: { ...ingesta, horasSinIngesta: horasIngesta, ok: horasIngesta !== null && horasIngesta < 36 },
    ultimos,
    generadoEn: new Date().toISOString(),
  });
});

// ─── POST /procesamientos/:ocid/reanalizar ───────────────────────────────────
adminOperacionRouter.post("/procesamientos/:ocid/reanalizar", async (c) => {
  const ocid = c.req.param("ocid");
  const body = await c.req.json().catch(() => ({})) as { motivo?: string };
  const who = actor(c);
  // Cloud Run responde 429 al segundo request concurrente al mismo servicio: con algo procesándose, no se lanza.
  const activos = await pool.query(`SELECT ocid FROM procesamientos WHERE estado = 'procesando' AND latido_at >= now() - interval '20 minutes'`);
  if (activos.rows.length) {
    return c.json({ error: "procesamiento_activo", detail: `Hay ${activos.rows.length} contrato(s) en análisis (${activos.rows.map((r) => r.ocid).join(", ")}). Espera a que terminen.`, activos: activos.rows.map((r) => r.ocid) }, 409);
  }
  const r = await pool.query(
    `UPDATE procesamientos SET estado = 'encolado', intentos = 0, error = NULL, worker = NULL, fase_actual = NULL, fase_index = NULL,
            fases = '{}'::jsonb, eventos = '[]'::jsonb, iniciado_at = NULL, finalizado_at = NULL, encolado_at = now()
     WHERE ocid = $1 AND estado IN ('procesado', 'error', 'pendiente_de_procesamiento') RETURNING ocid`, [ocid]);
  if (!r.rows.length) return c.json({ error: "not_found_or_not_reanalizable", detail: "Solo se re-analizan contratos financiados que ya terminaron (procesado, error o pendiente)." }, 404);
  await log(who, "reanalizar", `procesamiento:${ocid}`, { motivo: (body.motivo ?? "").slice(0, 300) || null, costoEstimadoUsd: 0.25 });
  return c.json({ ok: true, ocid, estado: "encolado", nota: "El dispatcher lo toma en su próxima corrida (cada 5 min); la alerta anterior se reemplaza al persistir la nueva." });
});

// ─── GET /cobertura/progreso ─────────────────────────────────────────────────
let progresoCache: { at: number; body: unknown } | null = null;
adminOperacionRouter.get("/cobertura/progreso", async (c) => {
  if (progresoCache && Date.now() - progresoCache.at < 60_000) return c.json(progresoCache.body);
  const [tot, ritmo, errores, loteActual, pendientesDocs] = await Promise.all([
    // Sólo se bajan los documentos de los contratos que pasan a lectura (procesamientos): el avance se mide contra ellos.
    // Antes sumaba lo publicado por las ~830 mil convocatorias (no terminaba nunca, y «faltan» y «fin estimado» contaban
    // documentos que nadie va a bajar). Unido por ocid, la vista sólo calcula esas filas (~320).
    pool.query(`SELECT count(*)::int AS contratos,
                       COALESCE(sum(cc.docs_publicados), 0)::bigint AS publicados, COALESCE(sum(cc.docs_vigentes), 0)::bigint AS vigentes,
                       count(*) FILTER (WHERE cc.docs_publicados > 0)::int AS "contratosConDocsPublicados",
                       count(*) FILTER (WHERE cc.docs_vigentes > 0)::int AS "contratosConDocs",
                       count(*) FILTER (WHERE cc.docs_publicados > 0 AND cc.docs_vigentes = 0)::int AS "contratosSinBajar"
                FROM procesamientos p JOIN cobertura_contratos cc ON cc.ocid = p.ocid`).then((q) => q.rows[0]),
    pool.query(`SELECT date_trunc('day', creado_at)::date AS dia, count(*)::int AS n, count(DISTINCT ocid)::int AS contratos
                FROM documentos_gcs WHERE creado_at >= now() - interval '7 days' GROUP BY 1 ORDER BY 1`).then((q) => q.rows),
    pool.query(`SELECT li.lote_id AS "loteId", li.clave, li.error, li.procesado_at AS "procesadoAt"
                FROM lotes_items li WHERE li.estado = 'error' ORDER BY li.procesado_at DESC NULLS LAST LIMIT 20`).then((q) => q.rows).catch(() => []),
    pool.query(`SELECT id, tipo, estado, total::int, ok::int, fallidos::int, iniciado_at AS "iniciadoAt", finalizado_at AS "finalizadoAt", error
                FROM lotes_ingesta WHERE tipo = 'documentos' ORDER BY COALESCE(finalizado_at, iniciado_at, creado_at) DESC NULLS LAST LIMIT 1`)
      .then((q) => q.rows[0] ?? null).catch(() => null),
    pool.query(`SELECT count(*)::int AS n FROM lotes_items li JOIN lotes_ingesta l ON l.id = li.lote_id
                WHERE l.tipo = 'documentos' AND li.estado = 'pending'`).then((q) => q.rows[0].n as number).catch(() => 0),
  ]);
  const publicados = Number(tot.publicados), vigentes = Number(tot.vigentes);
  const restantes = Math.max(0, publicados - vigentes);
  // Ritmo = promedio de las noches con actividad en la última semana (el lote solo corre de noche).
  const nochesActivas = ritmo.filter((r) => r.n > 0);
  const porNoche = nochesActivas.length ? Math.round(nochesActivas.reduce((a, r) => a + r.n, 0) / nochesActivas.length) : 0;
  const nochesRestantes = porNoche > 0 ? Math.ceil(restantes / porNoche) : null;
  const body = {
    contratos: tot.contratos as number,
    publicados, vigentes, restantes, pct: publicados ? Math.round((vigentes / publicados) * 1000) / 10 : 0,
    contratosConDocsPublicados: tot.contratosConDocsPublicados, contratosConDocs: tot.contratosConDocs, contratosSinBajar: tot.contratosSinBajar,
    ritmo, porNoche, nochesRestantes,
    estimadoFin: nochesRestantes !== null ? new Date(Date.now() + nochesRestantes * 864e5).toISOString() : null,
    itemsPendientes: pendientesDocs,
    loteActual, errores,
    generadoAt: new Date().toISOString(),
  };
  progresoCache = { at: Date.now(), body };
  return c.json(body);
});

// ─── GET /masivo ─────────────────────────────────────────────────────────────
/**
 * Análisis masivo con las Lambdas de agentes (migraciones 272 y 274): cuánto se gastó frente al tope, lo hecho y lo que
 * falta por red, el gasto por día, las tandas de GitLab y los últimos contratos. Los pendientes son los que contó la
 * última tanda (contarlos en vivo es caro). El usuario, 2026-11-12: «que salga en la plataforma cuánto hemos gastado».
 */
let masivoCache: { at: number; body: unknown } | null = null;
adminOperacionRouter.get("/masivo", async (c) => {
  if (masivoCache && Date.now() - masivoCache.at < 30_000) return c.json(masivoCache.body);
  const [redes, dias, tandas, ultimos] = await Promise.all([
    pool.query(`SELECT red, count(*) FILTER (WHERE estado = 'ok')::int AS hechos, count(*) FILTER (WHERE estado = 'error')::int AS errores,
                       count(*) FILTER (WHERE estado = 'en_vuelo')::int AS "enVuelo", COALESCE(sum(costo), 0)::float AS costo,
                       (avg(costo) FILTER (WHERE estado = 'ok' AND costo_medido))::float AS medio,
                       (avg(segundos) FILTER (WHERE estado = 'ok'))::float AS segundos,
                       count(*) FILTER (WHERE estado = 'ok' AND score >= 70)::int AS alto
                  FROM agente_masivo GROUP BY red ORDER BY red`).then((q) => q.rows),
    pool.query(`SELECT to_char((COALESCE(terminado_en, creado_en) AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD') AS dia,
                       count(*) FILTER (WHERE estado = 'ok')::int AS hechos, count(*) FILTER (WHERE estado = 'error')::int AS errores,
                       COALESCE(sum(costo), 0)::float AS costo
                  FROM agente_masivo GROUP BY 1 ORDER BY 1 DESC LIMIT 30`).then((q) => q.rows),
    pool.query(`SELECT origen, inicio, fin, tope::float, plan, filtro, pendientes, sin_info AS "sinInfo", gastado_al_inicio::float AS "gastadoAlInicio",
                       ok, errores, costo::float
                  FROM agente_masivo_tanda ORDER BY inicio DESC LIMIT 24`).then((q) => q.rows).catch(() => []),
    pool.query(`SELECT ocid, red, estado, costo::float, segundos::float, score, left(error, 160) AS error, terminado_en AS "terminadoEn"
                  FROM agente_masivo WHERE ocid IS NOT NULL AND estado <> 'en_vuelo'
                 ORDER BY terminado_en DESC NULLS LAST LIMIT 40`).then((q) => q.rows),
  ]);
  const gastado = redes.reduce((a, r) => a + Number(r.costo), 0);
  const ultima = tandas[0] ?? null;
  const pendientes: Record<string, number> = ultima?.pendientes ?? {};
  const sinInfo: Record<string, number> = ultima?.sinInfo ?? {};
  const hechos = redes.reduce((a, r) => a + Number(r.hechos), 0);
  const medioGlobal = (() => {
    const conMedio = redes.filter((r) => r.medio != null && r.hechos > 0);
    const n = conMedio.reduce((a, r) => a + Number(r.hechos), 0);
    return n ? conMedio.reduce((a, r) => a + Number(r.medio) * Number(r.hechos), 0) / n : null;
  })();
  const faltanUsd = Object.entries(pendientes).reduce((a, [red, n]) => {
    const medio = redes.find((r) => r.red === red)?.medio ?? medioGlobal ?? 0.2;
    return a + n * Number(medio);
  }, 0);
  const tope = ultima?.tope ?? null;
  const body = {
    gastado, tope, hechos, medioGlobal,
    errores: redes.reduce((a, r) => a + Number(r.errores), 0),
    enVuelo: redes.reduce((a, r) => a + Number(r.enVuelo), 0),
    pendientes, sinInfo, faltanUsd,
    alcanzaPara: tope != null && medioGlobal ? Math.max(0, Math.floor((tope - gastado) / medioGlobal)) : null,
    filtro: ultima?.filtro ?? null,
    redes, dias, tandas, ultimos,
    generadoAt: new Date().toISOString(),
  };
  masivoCache = { at: Date.now(), body };
  return c.json(body);
});
