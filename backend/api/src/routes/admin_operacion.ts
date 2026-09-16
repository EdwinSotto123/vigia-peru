/**
 * Operación del panel admin (plan 2026-09-16 · U4). Se monta bajo /admin (hereda el x-admin-token).
 *
 *   GET  /admin/operacion                         resumen en una pantalla: dispatcher (última corrida), servicios de
 *                                                 agentes (GET / con timeout 3 s, caché 60 s), relay, cola por estado,
 *                                                 pedidos de descarga, aportes por validar, alertas en revisión, último lote
 *   POST /admin/procesamientos/:ocid/reanalizar   vuelve a encolar un contrato ya procesado (≈ US$ 0.25, ~3 min);
 *                                                 409 si hay un procesamiento activo (Cloud Run devuelve 429 al 2.º request)
 *   GET  /admin/cobertura/progreso                lote nocturno de documentos: descargados vs publicados, ritmo, estimación,
 *                                                 últimos errores por ítem
 *
 * Los servicios de agentes se consultan SIEMPRE desde la API (nunca desde el navegador): son URLs
 * internas y el health de Cloud Run tarda si la instancia arranca en frío.
 */

import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { actor, log } from "../lib/adminlog.js";

export const adminOperacionRouter = new Hono();

// ─── Servicios de agentes (uno por perfil) ───────────────────────────────────
const HOST = process.env.AGENT_HOST_SUFFIX ?? "oq3gq6a4ka-uc.a.run.app";
const SERVICIOS: { perfil: "bienes" | "servicios" | "obras" | "otros"; nombre: string; url: string }[] = [
  { perfil: "bienes", nombre: "agent-orchestrator-adk", url: process.env.AGENT_URL_BIENES ?? `https://agent-orchestrator-adk-${HOST}` },
  { perfil: "servicios", nombre: "agente-servicios", url: process.env.AGENT_URL_SERVICIOS ?? `https://agente-servicios-${HOST}` },
  { perfil: "obras", nombre: "agente-obras", url: process.env.AGENT_URL_OBRAS ?? `https://agente-obras-${HOST}` },
  { perfil: "otros", nombre: "agente-otros", url: process.env.AGENT_URL_OTROS ?? `https://agente-otros-${HOST}` },
];

export interface SaludServicio {
  perfil: string; nombre: string; url: string;
  ok: boolean | null;                 // null = sin respuesta en 3 s (posible arranque en frío)
  status: number | null; ms: number | null;
  detalle: { perfil?: string; tipos_aceptados?: string[]; model?: string; agentes?: string[] } | null;
  error: string | null;
}

async function pingServicio(s: (typeof SERVICIOS)[number]): Promise<SaludServicio> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  const t0 = Date.now();
  try {
    const r = await fetch(s.url.replace(/\/$/, "") + "/", { signal: ctl.signal, headers: { accept: "application/json" } });
    const ms = Date.now() - t0;
    const j = await r.json().catch(() => null) as SaludServicio["detalle"] & { ok?: boolean } | null;
    return { ...s, ok: r.ok && (j?.ok ?? true), status: r.status, ms,
      detalle: j ? { perfil: j.perfil, tipos_aceptados: j.tipos_aceptados, model: (j as any).model ?? (j as any).modelo, agentes: j.agentes } : null,
      error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    const abort = (e as Error).name === "AbortError";
    return { ...s, ok: abort ? null : false, status: null, ms: Date.now() - t0, detalle: null,
      error: abort ? "sin respuesta en 3 s (posible arranque en frío)" : (e as Error).message.slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

let serviciosCache: { at: number; data: SaludServicio[] } | null = null;
async function saludServicios(): Promise<{ data: SaludServicio[]; consultadoAt: string; cacheado: boolean }> {
  if (serviciosCache && Date.now() - serviciosCache.at < 60_000) {
    return { data: serviciosCache.data, consultadoAt: new Date(serviciosCache.at).toISOString(), cacheado: true };
  }
  const data = await Promise.all(SERVICIOS.map(pingServicio));
  const cache = { at: Date.now(), data };
  serviciosCache = cache;
  // Arranque en frío (~8 s en Cloud Run): los que no respondieron en 3 s se vuelven a consultar en
  // segundo plano con 20 s y se corrigen en la caché; el siguiente refresco del panel ya los ve.
  data.forEach((s, i) => {
    if (s.ok !== null) return;
    (async () => {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000);
      const t0 = Date.now();
      try {
        const r = await fetch(s.url.replace(/\/$/, "") + "/", { signal: ctl.signal, headers: { accept: "application/json" } });
        const j = await r.json().catch(() => null) as { ok?: boolean; perfil?: string; tipos_aceptados?: string[]; agentes?: string[]; model?: string } | null;
        cache.data[i] = { ...s, ok: r.ok && (j?.ok ?? true), status: r.status, ms: Date.now() - t0,
          detalle: j ? { perfil: j.perfil, tipos_aceptados: j.tipos_aceptados, model: j.model, agentes: j.agentes } : null,
          error: r.ok ? "respondió en el 2.º intento (arranque en frío)" : `HTTP ${r.status}` };
      } catch (e) {
        cache.data[i] = { ...s, ok: false, status: null, ms: Date.now() - t0, detalle: null, error: `sin respuesta en 20 s: ${(e as Error).message.slice(0, 80)}` };
      } finally { clearTimeout(t); }
    })();
  });
  return { data, consultadoAt: new Date().toISOString(), cacheado: false };
}

async function saludRelay(): Promise<{ url: string | null; ok: boolean | null }> {
  const relayUrl = process.env.LOCAL_DOWNLOADER_URL ?? null;
  if (!relayUrl) return { url: null, ok: null };
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
    const base = relayUrl.replace(/\/$/, "");
    const r = await fetch(base + "/health", { signal: ctl.signal }).catch(() => fetch(base, { signal: ctl.signal }));
    clearTimeout(t);
    return { url: relayUrl, ok: r.ok || r.status < 500 };
  } catch { return { url: relayUrl, ok: false }; }
}

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
    pool.query(`SELECT count(*) FILTER (WHERE estado = 'pendiente_pago')::int AS "pendientesValidar",
                       count(*) FILTER (WHERE estado = 'pendiente_pago' AND comprobante_url IS NOT NULL)::int AS "conComprobante",
                       count(*) FILTER (WHERE estado IN ('pagada','en_proceso')
                         AND contratos > (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = contribuciones.id))::int AS "esperandoContratos"
                FROM contribuciones`).then((q) => q.rows[0]),
    pool.query(`SELECT count(*)::int AS n, min(analizado_en) AS "masAntigua" FROM alertas WHERE estado = 'revision'`).then((q) => q.rows[0]),
    pool.query(`SELECT id, tipo, estado, total::int, ok::int, fallidos::int, iniciado_at AS "iniciadoAt", finalizado_at AS "finalizadoAt", error
                FROM lotes_ingesta WHERE tipo = 'documentos' ORDER BY COALESCE(finalizado_at, iniciado_at, creado_at) DESC NULLS LAST LIMIT 1`)
      .then((q) => q.rows[0] ?? null).catch(() => null),
    pool.query(`SELECT max(created_at) AS "ultimaIngesta", count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS "ultimas24h",
                       count(*)::int AS total FROM convocatorias`).then((q) => q.rows[0]),
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
    pool.query(`SELECT COALESCE(sum(docs_publicados), 0)::bigint AS publicados, COALESCE(sum(docs_vigentes), 0)::bigint AS vigentes,
                       count(*) FILTER (WHERE docs_publicados > 0)::int AS "contratosConDocsPublicados",
                       count(*) FILTER (WHERE docs_vigentes > 0)::int AS "contratosConDocs",
                       count(*) FILTER (WHERE docs_publicados > 0 AND docs_vigentes = 0)::int AS "contratosSinBajar"
                FROM cobertura_contratos`).then((q) => q.rows[0]),
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
