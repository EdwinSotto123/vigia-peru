/**
 * "Financia una auditoría" — lectura pública.
 * Diseño: docs/design/FINANCIA_UNA_AUDITORIA.md · esquema: backend/db/migrations/09_financiamiento.sql
 *
 *   GET /financiamiento/zonas?nivel=departamento[&padre=15]   estado por zona (mapa)
 *   GET /financiamiento/zonas/:ubigeo                          detalle + aliados + hijas
 *   GET /financiamiento/ranking?periodo=mes|anio|todo           ranking de impacto (contratos, no soles)
 *   GET /financiamiento/estado                                  métricas globales + tarifa vigente
 *   GET /financiamiento/impacto/:codigo                         comprobante público de una contribución
 *   GET /financiamiento/aliados/:slug                           perfil público de un financiador
 *   GET /financiamiento/recientes                               últimas contribuciones confirmadas
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";

export const financiamientoRouter = new Hono();

const cache = (c: any, seconds: number) => c.header("Cache-Control", `public, s-maxage=${seconds}, stale-while-revalidate=60`);

const ZonasQuery = z.object({
  nivel: z.enum(["departamento", "provincia", "distrito"]).default("departamento"),
  padre: z.string().regex(/^\d{2,4}$/).optional(),
});

// ─── GET /financiamiento/zonas ───────────────────────────────────────────────
financiamientoRouter.get("/zonas", async (c) => {
  const parsed = ZonasQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { nivel, padre } = parsed.data;
  const vals: any[] = [nivel];
  let where = "nivel = $1";
  if (padre) { vals.push(padre); where += ` AND padre_ubigeo = $2`; }
  const r = await pool.query(
    `SELECT ubigeo, nivel, nombre, padre_ubigeo AS "padreUbigeo", lat::float, lon::float,
            pendientes, financiados, contribuciones, asignados, procesados, senales, total_cola AS "totalCola", estado,
            precio_pen::float AS "precioPen", precio_usd::float AS "precioUsd"
     FROM zona_estado WHERE ${where} ORDER BY nombre`, vals);
  cache(c, 300);
  return c.json({ data: r.rows });
});

// ─── GET /financiamiento/zonas/:ubigeo ───────────────────────────────────────
financiamientoRouter.get("/zonas/:ubigeo", async (c) => {
  const ubigeo = c.req.param("ubigeo");
  if (!/^\d{2}(\d{2}(\d{2})?)?$/.test(ubigeo)) return c.json({ error: "invalid_ubigeo" }, 400);
  const [zona, hijas, aliados, breadcrumb, resumenCola] = await Promise.all([
    pool.query(
      `SELECT ubigeo, nivel, nombre, padre_ubigeo AS "padreUbigeo", lat::float, lon::float,
              pendientes, financiados, contribuciones, procesados, senales, total_cola AS "totalCola", estado,
              precio_pen::float AS "precioPen", precio_usd::float AS "precioUsd"
       FROM zona_estado WHERE ubigeo = $1`, [ubigeo]),
    pool.query(
      `SELECT ubigeo, nivel, nombre, pendientes, financiados, procesados, senales, total_cola AS "totalCola", estado
       FROM zona_estado WHERE padre_ubigeo = $1 ORDER BY total_cola DESC, nombre`, [ubigeo]),
    pool.query(
      `SELECT COALESCE(f.nombre_publico, 'Anónimo') AS nombre, f.tipo, f.slug, f.logo_url AS "logoUrl",
              SUM(co.contratos)::int AS contratos, MAX(co.pagada_at) AS "ultimoAporte"
       FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id
       WHERE co.ubigeo LIKE $1 || '%' AND co.estado IN ('pagada','en_proceso','procesada') AND f.visible
       GROUP BY f.id ORDER BY contratos DESC LIMIT 12`, [ubigeo]),
    pool.query(
      `WITH RECURSIVE up AS (
         SELECT ubigeo, nombre, nivel, padre_ubigeo FROM zonas WHERE ubigeo = $1
         UNION ALL SELECT z.ubigeo, z.nombre, z.nivel, z.padre_ubigeo FROM zonas z JOIN up ON z.ubigeo = up.padre_ubigeo)
       SELECT ubigeo, nombre, nivel FROM up`, [ubigeo]),
    pool.query(
      `SELECT count(*)::int AS contratos, COALESCE(sum(c.cuantia_referencial),0)::float AS "montoReferencial",
              count(DISTINCT c.entidad_ruc)::int AS entidades
       FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid WHERE q.ubigeo LIKE $1 || '%'`, [ubigeo]),
  ]);
  if (!zona.rows.length) return c.json({ error: "not_found" }, 404);
  cache(c, 120);
  return c.json({
    zona: zona.rows[0],
    breadcrumb: breadcrumb.rows.reverse(),
    hijas: hijas.rows,
    aliados: aliados.rows,
    cola: resumenCola.rows[0],
  });
});

// ─── GET /financiamiento/ranking ─────────────────────────────────────────────
financiamientoRouter.get("/ranking", async (c) => {
  const periodo = new URL(c.req.url).searchParams.get("periodo") ?? "todo";
  const region = new URL(c.req.url).searchParams.get("region");
  const since = periodo === "mes" ? "date_trunc('month', now())" : periodo === "anio" ? "date_trunc('year', now())" : "'1970-01-01'::timestamptz";
  const vals: any[] = [];
  let zonaCond = "";
  if (region && /^\d{2,6}$/.test(region)) { vals.push(region); zonaCond = ` AND co.ubigeo LIKE $${vals.length} || '%'`; }
  const r = await pool.query(
    `SELECT f.id, f.tipo, COALESCE(f.nombre_publico,'Anónimo') AS nombre, f.slug, f.logo_url AS "logoUrl",
            SUM(co.contratos)::int AS "contratosFinanciados",
            COUNT(DISTINCT co.ubigeo)::int AS zonas,
            (SELECT count(s.alerta_id) FROM asignaciones s WHERE s.contribucion_id = ANY(array_agg(co.id)))::int AS "senalesHalladas",
            (SELECT count(s.procesada_at) FROM asignaciones s WHERE s.contribucion_id = ANY(array_agg(co.id)))::int AS "contratosProcesados",
            MIN(co.pagada_at) AS desde
     FROM financiadores f
     JOIN contribuciones co ON co.financiador_id = f.id AND co.estado IN ('pagada','en_proceso','procesada')
          AND co.pagada_at >= ${since}${zonaCond}
     WHERE f.visible
     GROUP BY f.id ORDER BY "contratosFinanciados" DESC, desde ASC LIMIT 100`, vals);
  cache(c, 300);
  return c.json({ periodo, data: r.rows.map((row, i) => ({ posicion: i + 1, ...row })) });
});

// ─── GET /financiamiento/estado ──────────────────────────────────────────────
financiamientoRouter.get("/estado", async (c) => {
  const [tot, tarifa, hoy] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(co.contratos),0)::int AS "contratosFinanciados",
              COALESCE(SUM(co.monto_pen),0)::float AS "montoPen",
              COUNT(DISTINCT co.financiador_id)::int AS financiadores,
              COUNT(DISTINCT left(co.ubigeo,2))::int AS "regionesConAuditoria",
              (SELECT count(*) FROM asignaciones WHERE procesada_at IS NOT NULL)::int AS "contratosProcesados",
              (SELECT count(*) FROM asignaciones WHERE alerta_id IS NOT NULL)::int AS "senalesHalladas",
              (SELECT count(*) FROM cola_auditoria)::int AS "colaGlobal",
              (SELECT count(*) FROM zona_estado WHERE nivel='departamento' AND total_cola > 0)::int AS "regionesConCola"
       FROM contribuciones co WHERE co.estado IN ('pagada','en_proceso','procesada')`),
    pool.query(`SELECT precio_pen::float AS "precioPen", precio_usd::float AS "precioUsd", costo_real_pen::float AS "costoRealPen", nota
                FROM tarifas ORDER BY vigente_desde DESC LIMIT 1`),
    pool.query(`SELECT (SELECT count(*) FROM alertas WHERE created_at::date = current_date)::int AS "procesadosHoy",
                       (SELECT count(*) FROM convocatorias WHERE created_at::date = current_date)::int AS "ingresadosHoy"`),
  ]);
  cache(c, 120);
  return c.json({ ...tot.rows[0], ...hoy.rows[0], tarifa: tarifa.rows[0] });
});

// ─── GET /financiamiento/recientes ───────────────────────────────────────────
financiamientoRouter.get("/recientes", async (c) => {
  const r = await pool.query(
    `SELECT co.codigo, co.contratos, co.pagada_at AS "pagadaAt", co.estado, co.mensaje_publico AS "mensajePublico",
            z.ubigeo, z.nombre AS zona, z.nivel,
            COALESCE(f.nombre_publico,'Anónimo') AS financiador, f.tipo, f.slug, f.logo_url AS "logoUrl"
     FROM contribuciones co
     JOIN financiadores f ON f.id = co.financiador_id
     JOIN zonas z ON z.ubigeo = co.ubigeo
     WHERE co.estado IN ('pagada','en_proceso','procesada') AND f.visible
     ORDER BY co.pagada_at DESC LIMIT 20`);
  cache(c, 60);
  return c.json({ data: r.rows });
});

// ─── GET /financiamiento/impacto/:codigo ─────────────────────────────────────
financiamientoRouter.get("/impacto/:codigo", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const head = await pool.query(
    `SELECT co.codigo, co.contratos, co.monto_pen::float AS "montoPen", co.estado, co.pagada_at AS "pagadaAt",
            co.created_at AS "createdAt", co.mensaje_publico AS "mensajePublico", co.pasarela,
            z.ubigeo, z.nombre AS zona, z.nivel,
            COALESCE(f.nombre_publico,'Anónimo') AS financiador, f.tipo, f.slug, f.logo_url AS "logoUrl", f.visible,
            t.precio_pen::float AS "precioPen"
     FROM contribuciones co
     JOIN financiadores f ON f.id = co.financiador_id
     JOIN zonas z ON z.ubigeo = co.ubigeo
     JOIN tarifas t ON t.id = co.tarifa_id
     WHERE co.codigo = $1`, [codigo]);
  if (!head.rows.length) return c.json({ error: "not_found" }, 404);
  const det = await pool.query(
    `SELECT s.ocid, s.asignada_at AS "asignadaAt", s.procesada_at AS "procesadaAt",
            cv.objeto AS titulo, cv.cuantia_referencial::float AS "valorReferencial", e.nombre AS entidad,
            a.codigo AS "alertaCodigo", a.score,
            (SELECT max(b.severidad) FROM banderas b WHERE b.alerta_id = a.id) AS severidad,
            (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id)::int AS banderas
     FROM asignaciones s
     JOIN contribuciones co ON co.id = s.contribucion_id
     JOIN convocatorias cv ON cv.ocid = s.ocid
     LEFT JOIN entidades e ON e.ruc = cv.entidad_ruc
     LEFT JOIN alertas a ON a.id = s.alerta_id
     WHERE co.codigo = $1 ORDER BY s.asignada_at`, [codigo]);
  const h = head.rows[0];
  const procesados = det.rows.filter((r) => r.procesadaAt).length;
  cache(c, 60);
  return c.json({
    ...h,
    financiador: h.visible ? h.financiador : "Aliado no visible (conflicto de interés declarado)",
    resumen: {
      asignados: det.rows.length,
      procesados,
      pendientes: h.contratos - det.rows.length,
      senales: det.rows.reduce((n, r) => n + (r.banderas ?? 0), 0),
      montoAuditado: det.rows.reduce((n, r) => n + (r.valorReferencial ?? 0), 0),
    },
    detalle: det.rows,
  });
});

// ─── GET /financiamiento/aliados/:slug ───────────────────────────────────────
financiamientoRouter.get("/aliados/:slug", async (c) => {
  const slug = c.req.param("slug");
  const f = await pool.query(
    `SELECT id, tipo, COALESCE(nombre_publico,'Anónimo') AS nombre, slug, logo_url AS "logoUrl", created_at AS "desde"
     FROM financiadores WHERE slug = $1 AND visible`, [slug]);
  if (!f.rows.length) return c.json({ error: "not_found" }, 404);
  const cs = await pool.query(
    `SELECT co.codigo, co.contratos, co.estado, co.pagada_at AS "pagadaAt", z.ubigeo, z.nombre AS zona, z.nivel,
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id AND s.procesada_at IS NOT NULL)::int AS procesados,
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id AND s.alerta_id IS NOT NULL)::int AS senales
     FROM contribuciones co JOIN zonas z ON z.ubigeo = co.ubigeo
     WHERE co.financiador_id = $1 AND co.estado IN ('pagada','en_proceso','procesada')
     ORDER BY co.pagada_at DESC`, [f.rows[0].id]);
  cache(c, 120);
  return c.json({ aliado: f.rows[0], contribuciones: cs.rows });
});
