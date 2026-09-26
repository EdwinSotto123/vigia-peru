/**
 * Alertas publicadas — listas. El detalle (/:id, /:id/full, /:id/traza, /:id/revision) y el POST
 * están en alertas_detalle.ts, montado al final (las rutas fijas van antes que `/:id`).
 *
 *   GET /alertas?region=&estado=&scoreMin=&conSenales=true&limit=&offset=   lista con banderas inline
 *   GET /alertas/puntos                                                     TODAS las publicadas, filas mínimas (mapa)
 *   GET /alertas/analizadas?limit=&offset=&q=&riesgo=&zona=&orden=           análisis publicados + total + resumen
 */

import { Hono } from "hono";
import { z } from "zod";
import { OCID_CANDIDATOS, escaparLike, pool } from "../lib/db.js";
import { Memo, responderJson, type Serializado } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { alertaPublica } from "../lib/publicacion.js";
import { alertasDetalleRouter } from "./alertas_detalle.js";

export const alertasRouter = new Hono();

// ─── GET /alertas — lista con joins (entidad+proveedor) + banderas inline ──
//   ?region=&estado=&scoreMin=&conSenales=true&limit=&offset=
//   · Solo alertas PUBLICADAS (activa/confirmada) y no demo — ver lib/publicacion.ts. Las que la
//     autoevaluación bloqueó (`revision`) o una persona descartó (`descartada`) no se listan: sus
//     motivos públicos están en GET /alertas/:id/revision. `estado=descartada|en_revision` es válido
//     pero no devuelve filas.
//   · `conSenales=true`: solo contratos con ≥ 1 bandera (los analizados sin señal traen
//     `banderas = []` y score 0). `total` refleja el mismo filtro. Sin el parámetro: todas, como antes.
//   · `evidencia` recortada a 320 caracteres (como RESULTADO_SQL): el texto completo está en el
//     dossier. Orden con desempate por id (antes dos alertas con el mismo score y alta podían
//     cambiar de página entre pedidos). `total` siempre.
const ListQuery = z.object({
  region: z.string().max(80).optional(),
  estado: z.enum(["activa", "descartada", "confirmada", "en_revision"]).optional(),
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  conSenales: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

alertasRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const { region, estado, scoreMin, conSenales, limit, offset } = parsed.data;

  // Base: publicada y no demo (antes solo `estado <> 'revision'`: se colaban las descartadas y las semillas).
  const conds: string[] = [alertaPublica("a")];
  const vals: any[] = [];
  if (region)            { vals.push(region);    conds.push(`a.region = $${vals.length}`); }
  if (estado)            { vals.push(estado);    conds.push(`a.estado = $${vals.length}`); }
  if (scoreMin != null)  { vals.push(scoreMin);  conds.push(`a.score >= $${vals.length}`); }
  if (conSenales === "true") conds.push(`EXISTS (SELECT 1 FROM banderas bx WHERE bx.alerta_id = a.id)`);
  const where = `WHERE ${conds.join(" AND ")}`;

  const totalVals = [...vals];
  vals.push(limit, offset);
  const [r, total] = await Promise.all([
    pool.query(
      `SELECT
         a.id, a.codigo, a.codigo_convocatoria AS codigoconvocatoria,
         a.objeto, a.score, a.estado,
         a.entidad_ruc      AS "rucEntidad",
         COALESCE(e.nombre, '—')        AS entidad,
         a.proveedor_ruc    AS "rucProveedor",
         COALESCE(emp.razon_social, '—') AS proveedor,
         a.monto_adjudicado::float AS "montoSoles",
         to_char(a.fecha_buena_pro, 'YYYY-MM-DD') AS "fechaBuenaPro",
         a.region, a.provincia, a.distrito,
         a.unico_postor     AS "unicoPostor",
         a.edad_ruc_dias    AS "edadRucDias",
         a.fuente_url       AS "fuenteUrl",
         ST_Y(a.ubicacion_geo::geometry) AS lat,
         ST_X(a.ubicacion_geo::geometry) AS lon,
         COALESCE(
           (SELECT json_agg(
              json_build_object(
                'regla', b.regla,
                'severidad', b.severidad,
                'evidencia', left(b.evidencia, 320),
                'norma', b.norma,
                'opinionOece', b.opinion_oece,
                'fuenteUrl', b.fuente_url
              ) ORDER BY
                CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, b.id
            )
            FROM banderas b WHERE b.alerta_id = a.id),
           '[]'::json
         ) AS banderas
       FROM alertas a
       LEFT JOIN entidades e   ON e.ruc   = a.entidad_ruc
       LEFT JOIN empresas  emp ON emp.ruc = a.proveedor_ruc
       ${where}
       ORDER BY a.score DESC, a.created_at DESC, a.id
       LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals,
    ),
    // Mismo WHERE que arriba, sin los joins (no filtran por columnas de entidades/empresas).
    pool.query(`SELECT count(*)::int AS n FROM alertas a ${where}`, totalVals),
  ]);
  c.header("Cache-Control", cachePublico(60, { maxAge: 30, swr: 60 }));
  return c.json({ data: r.rows, total: total.rows[0].n, limit, offset });
});

// ─── GET /alertas/puntos — el mapa entero, en filas mínimas ──────────────────
// TODAS las alertas publicadas, sin tope (auditoría C8: el mapa pedía `/alertas?limit=200` y se
// truncaba en silencio). Por fila: {codigo, convocatoria, lat, lon, ubigeo, score, severidadMax, nBanderas}.
//   · convocatoria: el código corto que abre /app/convocatoria/[id]: el OCID corto (codigo_convocatoria
//     guarda a veces sólo el último tramo, p. ej. "12" de 2026-10404-12, y sería ambiguo).
//   · lat/lon: la ubicación de la alerta si la tiene (el frontend ancla a la zona si no).
//   · ubigeo: zona del contrato (vista convocatoria_zona: existe antes y después de la migración 32).
const puntosMemo = new Memo<Serializado>({ nombre: "alertas:puntos", ttlMs: 60_000, staleMs: 60_000 });

alertasRouter.get("/puntos", (c) =>
  responderJson(c, puntosMemo, "puntos", async () => {
    const r = await pool.query(
      `SELECT a.codigo,
              COALESCE(ocid_corto(a.ocid), NULLIF(a.codigo_convocatoria, '')) AS convocatoria,
              ST_Y(a.ubicacion_geo::geometry) AS lat, ST_X(a.ubicacion_geo::geometry) AS lon,
              z.ubigeo, COALESCE(a.score, 0) AS score,
              b.sev AS "severidadMax", COALESCE(b.n, 0)::int AS "nBanderas"
         FROM alertas a
         LEFT JOIN LATERAL (
           SELECT count(*) AS n,
                  (array_agg(bb.severidad ORDER BY CASE bb.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END))[1] AS sev
             FROM banderas bb WHERE bb.alerta_id = a.id) b ON TRUE
         LEFT JOIN LATERAL (
           SELECT cz.ubigeo::text AS ubigeo FROM convocatoria_zona cz
            WHERE cz.ocid = ANY(${OCID_CANDIDATOS("a.ocid")}) AND ocid_corto(cz.ocid) = ocid_corto(a.ocid)
            ORDER BY (cz.ocid = a.ocid) DESC, cz.ocid LIMIT 1) z ON TRUE
        WHERE ${alertaPublica("a")}
        ORDER BY a.score DESC NULLS LAST, a.created_at DESC, a.id`);
    return { data: r.rows, total: r.rows.length };
  }, cachePublico(60, { swr: 60 })));

// ─── GET /alertas/analizadas — análisis publicados ───────────────────────────
// Reemplaza al orquestador (action=list). Misma forma que _list_analyzed: { count, items } y además
// `total` (conteo en SQL), `limit`, `offset` y `resumen` (auditoría C8: el frontend pedía 500, el
// API daba 100 y los indicadores salían de esa lista truncada).
//   ?limit=1..100 (20) &offset=  &q=<texto>  &riesgo=alto|medio|bajo|sin_senales  &zona=<región>
//   &orden=reciente|score|monto
//   · riesgo = el nivel de frontend/components/convocatoria/sections/conteoRiesgo.ts: sin señales si
//     no tiene banderas o su score es 0; si no, el tramo del score (70 / 40).
//   · resumen = {porNivel: {alta, media, baja, sin_senales}, ultima, ultimos7d} sobre `q` y `zona`
//     pero SIN el filtro de riesgo (porNivel sirve de faceta); `total` respeta todos los filtros.
const AnalizadasQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  q: z.string().trim().max(120).optional(),
  riesgo: z.enum(["alto", "medio", "bajo", "sin_senales"]).optional(),
  zona: z.string().trim().max(80).optional(),
  orden: z.enum(["reciente", "score", "monto"]).default("reciente"),
});
const analizadasMemo = new Memo<Serializado>({ nombre: "alertas:analizadas", ttlMs: 30_000, staleMs: 30_000, max: 200 });
const analizadasTextoMemo = new Memo<Serializado>({ nombre: "alertas:analizadas:texto", ttlMs: 30_000, max: 30 });

const NIVEL_SQL = `CASE WHEN x.n_banderas = 0 OR x.score = 0 THEN 'sin_senales' WHEN x.score IS NULL THEN NULL
                        WHEN x.score >= 70 THEN 'alto' WHEN x.score >= 40 THEN 'medio' ELSE 'bajo' END`;

alertasRouter.get("/analizadas", async (c) => {
  const parsed = AnalizadasQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = { ...parsed.data, q: parsed.data.q || undefined, zona: parsed.data.zona || undefined };
  return responderJson(c, q.q ? analizadasTextoMemo : analizadasMemo, JSON.stringify(q), () => analizadas(q),
    cachePublico(30, { swr: 120 }));
});

async function analizadas(q: z.infer<typeof AnalizadasQuery>) {
  const vals: unknown[] = [];
  const conds = [`(a.analizado_en IS NOT NULL OR a.score > 0 OR COALESCE(bc.n_banderas, 0) > 0)`, alertaPublica("a")];
  if (q.q) {
    vals.push(`%${escaparLike(q.q)}%`);
    const p = `$${vals.length}`;
    conds.push(`(a.codigo_convocatoria ILIKE ${p} OR a.ocid ILIKE ${p} OR a.objeto ILIKE ${p} OR e.nombre ILIKE ${p}
                 OR a.entidad_ruc ILIKE ${p} OR a.proveedor_ruc ILIKE ${p})`);
  }
  if (q.zona) { vals.push(q.zona); conds.push(`a.region = $${vals.length}`); }
  const base = `WITH x AS (
      SELECT a.id, a.codigo, a.ocid, a.score, a.objeto, a.monto_adjudicado, a.region,
             to_char(a.fecha_buena_pro, 'YYYY-MM-DD') AS fecha_buena_pro,
             a.analizado_en, a.created_at, a.updated_at, a.codigo_convocatoria,
             e.nombre AS entidad, a.entidad_ruc, a.proveedor_ruc,
             LENGTH(a.dictamen_markdown) AS dictamen_chars,
             COALESCE(bc.n_banderas, 0)::int AS n_banderas, COALESCE(bc.n_alta, 0)::int AS n_alta,
             COALESCE(bc.n_media, 0)::int AS n_media, COALESCE(bc.n_baja, 0)::int AS n_baja
        FROM alertas a
        LEFT JOIN entidades e ON e.ruc = a.entidad_ruc
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS n_banderas,
                 COUNT(*) FILTER (WHERE severidad='alta')  AS n_alta,
                 COUNT(*) FILTER (WHERE severidad='media') AS n_media,
                 COUNT(*) FILTER (WHERE severidad='baja')  AS n_baja
            FROM banderas WHERE alerta_id = a.id) bc ON TRUE
       WHERE ${conds.join(" AND ")}),
    niv AS (SELECT x.*, ${NIVEL_SQL} AS nivel FROM x)`;
  const baseVals = [...vals];
  const filtroNivel = q.riesgo ? (vals.push(q.riesgo), `WHERE nivel = $${vals.length}`) : "";
  // Si lo buscado es exactamente el código de un análisis, ese va primero (como hacía el frontend).
  let exacto = "";
  if (q.q) { vals.push(q.q); exacto = `(niv.codigo_convocatoria = ocid_corto($${vals.length}) OR ocid_corto(niv.ocid) = ocid_corto($${vals.length})) DESC, `; }
  const orden = q.orden === "score" ? `niv.score DESC NULLS LAST, niv.analizado_en DESC NULLS LAST`
    : q.orden === "monto" ? `niv.monto_adjudicado DESC NULLS LAST, niv.analizado_en DESC NULLS LAST`
    : `COALESCE(niv.analizado_en, niv.created_at, niv.updated_at) DESC NULLS LAST`;
  const listaVals = [...vals, q.limit, q.offset];
  const [r, tot, res] = await Promise.all([
    pool.query(`${base} SELECT * FROM niv ${filtroNivel} ORDER BY ${exacto}${orden}, niv.id
                LIMIT $${listaVals.length - 1} OFFSET $${listaVals.length}`, listaVals),
    pool.query(`${base} SELECT count(*)::int AS n FROM niv ${filtroNivel}`, vals.slice(0, q.riesgo ? baseVals.length + 1 : baseVals.length)),
    pool.query(`${base} SELECT
                  count(*) FILTER (WHERE nivel = 'alto')::int AS alta, count(*) FILTER (WHERE nivel = 'medio')::int AS media,
                  count(*) FILTER (WHERE nivel = 'bajo')::int AS baja, count(*) FILTER (WHERE nivel = 'sin_senales')::int AS sin_senales,
                  max(analizado_en) AS ultima,
                  count(*) FILTER (WHERE analizado_en >= now() - interval '7 days')::int AS "ultimos7d"
                FROM niv`, baseVals),
  ]);
  const items = r.rows.map((row) => ({
    codigo: row.codigo,
    ocid: row.ocid,
    codigo_convocatoria: (row.ocid ?? "").split("-").pop() ?? "",
    score: Number(row.score ?? 0),
    objeto: (row.objeto ?? "").slice(0, 200),
    monto: Number(row.monto_adjudicado ?? 0),
    region: row.region,
    fecha_buena_pro: row.fecha_buena_pro ?? null,
    analizado_en: row.analizado_en ? new Date(row.analizado_en).toISOString() : null,
    entidad: row.entidad,
    entidad_ruc: row.entidad_ruc,
    proveedor_ruc: row.proveedor_ruc,
    dictamen_chars: Number(row.dictamen_chars ?? 0),
    n_banderas: row.n_banderas,
    n_alta: row.n_alta,
    n_media: row.n_media,
    n_baja: row.n_baja,
  }));
  const s = res.rows[0];
  return {
    count: items.length,
    items,
    total: tot.rows[0].n,
    limit: q.limit,
    offset: q.offset,
    resumen: {
      porNivel: { alta: s.alta, media: s.media, baja: s.baja, sin_senales: s.sin_senales },
      ultima: s.ultima ? new Date(s.ultima).toISOString() : null,
      ultimos7d: s.ultimos7d,
    },
  };
}

// Detalle y escritura (van después de las rutas fijas de arriba: `/:id` las capturaría).
alertasRouter.route("/", alertasDetalleRouter);
