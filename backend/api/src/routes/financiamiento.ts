/**
 * "Financia una auditoría" — lectura pública.
 * Diseño: docs/design/FINANCIA_UNA_AUDITORIA.md · esquema: backend/db/migrations/09_financiamiento.sql
 *
 *   GET /financiamiento/zonas?nivel=departamento[&padre=15]   estado por zona (mapa)
 *   GET /financiamiento/zonas/:ubigeo                          detalle + aliados + hijas
 *   GET /financiamiento/ranking?periodo=mes|anio|todo&region=&limit=&offset=  ranking de impacto (contratos, no soles)
 *   GET /financiamiento/estado                                  métricas globales + tarifa vigente
 *   GET /financiamiento/impacto/:codigo                         comprobante público de una contribución
 *   GET /financiamiento/aliados/:slug                           perfil público de un financiador
 *   GET /financiamiento/recientes                               últimas contribuciones confirmadas
 *   GET /financiamiento/pago                                    medios de pago (Yape/Plin/cuentas/QR) — públicos
 *   GET /financiamiento/alcance                                 qué tipos × etapas se analizan hoy (ajustes.procesamiento) + cola + docs listos
 *
 * Migración 22: "señal hallada" = alerta PUBLICADA (activa/confirmada) con ≥ 1 bandera; las alertas en
 * `revision` cuentan como procesadas pero no como señales (se exponen como `enRevision`). Aliado,
 * comprobante y estado global se calculan EN VIVO desde `asignaciones` (caché 30 s): el ranking y las
 * zonas leen las vistas materializadas que el dispatcher refresca al cerrar cada contrato.
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { getPagosConfig } from "./contribuciones.js";
import { alertaNoDemo, alertaPublica } from "../lib/publicacion.js";
import { Memo } from "../lib/cache.js";

export const financiamientoRouter = new Hono();

// Conteos de alertas (lib/publicacion.ts): "señal hallada" = alerta pública (publicada, no demo) con
// ≥ 1 bandera; "en revisión" = estado 'revision' (tampoco demo).
const SENAL_HALLADA = `${alertaPublica("a")} AND EXISTS (SELECT 1 FROM banderas b WHERE b.alerta_id = a.id)`;
const EN_REVISION = `a.estado = 'revision' AND ${alertaNoDemo("a")}`;

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
            en_revision AS "enRevision", documentos_listos AS "documentosListos",
            precio_pen::float AS "precioPen", precio_usd::float AS "precioUsd"
     FROM zona_estado WHERE ${where} ORDER BY nombre`, vals);
  cache(c, 120);
  return c.json({ data: r.rows });
});

// ─── GET /financiamiento/zonas/:ubigeo ───────────────────────────────────────
// En caché 60 s por ubigeo (= su Cache-Control): el resumen de la cola evalúa cola_auditoria (~100 ms).
const zonaMemo = new Memo<Record<string, unknown> | null>({ nombre: "financiamiento:zona", ttlMs: 60_000, max: 300 });

financiamientoRouter.get("/zonas/:ubigeo", async (c) => {
  const ubigeo = c.req.param("ubigeo");
  if (!/^\d{2}(\d{2}(\d{2})?)?$/.test(ubigeo)) return c.json({ error: "invalid_ubigeo" }, 400);
  const body = await zonaMemo.obtener(ubigeo, (ctl) => detalleZona(ubigeo, ctl.noGuardar));
  if (!body) return c.json({ error: "not_found" }, 404);
  cache(c, 60);
  return c.json(body);
});

async function detalleZona(ubigeo: string, noGuardar: () => void): Promise<Record<string, unknown> | null> {
  const [zona, hijas, aliados, breadcrumb, resumenCola, alcance] = await Promise.all([
    pool.query(
      `SELECT ubigeo, nivel, nombre, padre_ubigeo AS "padreUbigeo", lat::float, lon::float,
              pendientes, financiados, contribuciones, procesados, senales, total_cola AS "totalCola", estado,
              en_revision AS "enRevision", documentos_listos AS "documentosListos",
              precio_pen::float AS "precioPen", precio_usd::float AS "precioUsd"
       FROM zona_estado WHERE ubigeo = $1`, [ubigeo]),
    pool.query(
      `SELECT ubigeo, nivel, nombre, pendientes, financiados, procesados, senales, total_cola AS "totalCola", estado,
              en_revision AS "enRevision", documentos_listos AS "documentosListos"
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
    alcanceORespaldo(noGuardar),
  ]);
  if (!zona.rows.length) return null;
  return {
    zona: zona.rows[0],
    breadcrumb: breadcrumb.rows.reverse(),
    hijas: hijas.rows,
    aliados: aliados.rows,
    cola: { ...resumenCola.rows[0], documentosListos: zona.rows[0].documentosListos ?? 0 },
    alcance: alcance.procesamiento,
  };
}

const RankingQuery = z.object({
  periodo: z.enum(["mes", "anio", "todo"]).default("todo"),
  region: z.string().regex(/^\d{2,6}$/).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── GET /financiamiento/ranking ─────────────────────────────────────────────
financiamientoRouter.get("/ranking", async (c) => {
  const parsed = RankingQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { periodo, region, limit, offset } = parsed.data;
  const since = periodo === "mes" ? "date_trunc('month', now())" : periodo === "anio" ? "date_trunc('year', now())" : "'1970-01-01'::timestamptz";
  const vals: any[] = [];
  let zonaCond = "";
  if (region) { vals.push(region); zonaCond = ` AND co.ubigeo LIKE $${vals.length} || '%'`; }
  // Compartido entre la fila principal (agregada por financiador) y el conteo total: mismo
  // FROM/WHERE, así el total siempre coincide con lo que la paginación realmente recorre.
  const fromWhere = `FROM financiadores f
     JOIN contribuciones co ON co.financiador_id = f.id AND co.estado IN ('pagada','en_proceso','procesada')
          AND co.pagada_at >= ${since}${zonaCond}
     WHERE f.visible`;
  const totalVals = [...vals];
  vals.push(limit, offset);
  const [r, total] = await Promise.all([
    pool.query(
      `SELECT f.id, f.tipo, COALESCE(f.nombre_publico,'Anónimo') AS nombre, f.slug, f.logo_url AS "logoUrl",
              SUM(co.contratos)::int AS "contratosFinanciados",
              COUNT(DISTINCT co.ubigeo)::int AS zonas,
              (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
                WHERE s.contribucion_id = ANY(array_agg(co.id)) AND ${SENAL_HALLADA})::int AS "senalesHalladas",
              (SELECT count(s.procesada_at) FROM asignaciones s WHERE s.contribucion_id = ANY(array_agg(co.id)))::int AS "contratosProcesados",
              (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
                WHERE s.contribucion_id = ANY(array_agg(co.id)) AND ${EN_REVISION})::int AS "enRevision",
              MIN(co.pagada_at) AS desde
       ${fromWhere}
       GROUP BY f.id ORDER BY "contratosFinanciados" DESC, desde ASC LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals),
    // DISTINCT f.id matching el mismo FROM/WHERE == número de grupos que produciría el GROUP BY de arriba.
    pool.query(`SELECT COUNT(DISTINCT f.id)::int AS n ${fromWhere}`, totalVals),
  ]);
  cache(c, 60);
  return c.json({
    periodo,
    data: r.rows.map((row, i) => ({ posicion: offset + i + 1, ...row })),
    total: total.rows[0].n,
  });
});

// ─── GET /financiamiento/estado ──────────────────────────────────────────────
// En caché 30 s (+30 s sirviendo lo último mientras refresca): lo pide cada página pública. Antes
// contaba cola_auditoria dos veces (acá y en getAlcance, en serie): ~130 ms cada una en la base.
const estadoMemo = new Memo<Record<string, unknown>>({ nombre: "financiamiento:estado", ttlMs: 30_000, staleMs: 30_000 });

financiamientoRouter.get("/estado", async (c) => {
  const body = await estadoMemo.obtener("estado", async (ctl) => {
    const [tot, tarifa, hoy, alcance] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(co.contratos),0)::int AS "contratosFinanciados",
                COALESCE(SUM(co.monto_pen),0)::float AS "montoPen",
                COUNT(DISTINCT co.financiador_id)::int AS financiadores,
                COUNT(DISTINCT left(co.ubigeo,2))::int AS "regionesConAuditoria",
                (SELECT count(*) FROM asignaciones WHERE procesada_at IS NOT NULL)::int AS "contratosProcesados",
                (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
                  WHERE ${SENAL_HALLADA})::int AS "senalesHalladas",
                (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id WHERE ${EN_REVISION})::int AS "enRevision",
                (SELECT count(*) FROM zona_estado WHERE nivel='departamento' AND total_cola > 0)::int AS "regionesConCola",
                (SELECT COALESCE(sum(documentos_listos), 0) FROM zona_estado WHERE nivel='departamento')::int AS "documentosListos"
         FROM contribuciones co WHERE co.estado IN ('pagada','en_proceso','procesada')`),
      pool.query(`SELECT precio_pen::float AS "precioPen", precio_usd::float AS "precioUsd", costo_real_pen::float AS "costoRealPen", nota
                  FROM tarifas ORDER BY vigente_desde DESC LIMIT 1`),
      // "Hoy" como rango (mismo día que created_at::date = current_date en la zona de la sesión): así un
      // índice sobre created_at sirve; con el cast a date la base recorría las ~18 k convocatorias.
      pool.query(`SELECT (SELECT count(*) FROM alertas a WHERE a.created_at >= current_date::timestamptz
                            AND a.created_at < (current_date + 1)::timestamptz AND ${alertaNoDemo("a")})::int AS "procesadosHoy",
                         (SELECT count(*) FROM convocatorias WHERE created_at >= current_date::timestamptz
                            AND created_at < (current_date + 1)::timestamptz)::int AS "ingresadosHoy"`),
      alcanceORespaldo(ctl.noGuardar),
    ]);
    return { ...tot.rows[0], colaGlobal: alcance.colaFinanciable, ...hoy.rows[0], tarifa: tarifa.rows[0], alcance: alcance.procesamiento };
  });
  cache(c, 30);
  return c.json(body);
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
  // Por contrato: score, severidad y conteo de señales SOLO si la alerta está publicada; en revisión
  // humana o descartada salen null (con `alertaEstado` y `enRevision` para decir por qué).
  const det = await pool.query(
    `SELECT s.ocid, s.asignada_at AS "asignadaAt", s.procesada_at AS "procesadaAt",
            cv.objeto AS titulo, cv.cuantia_referencial::float AS "valorReferencial", e.nombre AS entidad,
            a.codigo AS "alertaCodigo",
            CASE WHEN alerta_publicada(a.estado) THEN a.score END AS score,
            a.estado AS "alertaEstado",
            COALESCE(a.estado = 'revision', false) AS "enRevision",
            -- La más grave (no max() de texto: alfabéticamente 'media' > 'alta').
            CASE WHEN alerta_publicada(a.estado)
                 THEN (SELECT b.severidad FROM banderas b WHERE b.alerta_id = a.id
                        ORDER BY CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END LIMIT 1) END AS severidad,
            CASE WHEN a.id IS NULL OR alerta_publicada(a.estado)
                 THEN (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id)::int END AS banderas
     FROM asignaciones s
     JOIN contribuciones co ON co.id = s.contribucion_id
     JOIN convocatorias cv ON cv.ocid = s.ocid
     LEFT JOIN entidades e ON e.ruc = cv.entidad_ruc
     LEFT JOIN alertas a ON a.id = s.alerta_id AND ${alertaNoDemo("a")}
     WHERE co.codigo = $1 ORDER BY s.asignada_at`, [codigo]);
  const h = head.rows[0];
  const procesados = det.rows.filter((r) => r.procesadaAt).length;
  const publicada = (r: { alertaEstado: string | null }) => r.alertaEstado === "activa" || r.alertaEstado === "confirmada";
  cache(c, 30);
  return c.json({
    ...h,
    financiador: h.visible ? h.financiador : "Aliado no visible (conflicto de interés declarado)",
    resumen: {
      asignados: det.rows.length,
      procesados,
      pendientes: h.contratos - det.rows.length,
      // Señales = banderas de alertas PUBLICADAS; lo que está en revisión humana no se cuenta.
      senales: det.rows.filter(publicada).reduce((n, r) => n + (r.banderas ?? 0), 0),
      contratosConSenal: det.rows.filter((r) => publicada(r) && (r.banderas ?? 0) > 0).length,
      enRevision: det.rows.filter((r) => r.alertaEstado === "revision").length,
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
            (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
              WHERE s.contribucion_id = co.id AND ${SENAL_HALLADA})::int AS senales,
            (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
              WHERE s.contribucion_id = co.id AND ${EN_REVISION})::int AS "enRevision"
     FROM contribuciones co JOIN zonas z ON z.ubigeo = co.ubigeo
     WHERE co.financiador_id = $1 AND co.estado IN ('pagada','en_proceso','procesada')
     ORDER BY co.pagada_at DESC`, [f.rows[0].id]);
  cache(c, 30);
  return c.json({ aliado: f.rows[0], contribuciones: cs.rows });
});

// ─── Alcance activo (migración 19): qué tipos × etapas entran hoy a la cola ──────────────
export interface Alcance {
  procesamiento: { tipos_activos: string[]; etapas_activas: string[]; nota?: string } | null;
  colaFinanciable: number;
  documentosListos: number;
  actualizadoAt: string | null;
}
// 60 s como antes, más 60 s sirviendo lo último mientras se refresca: el count(*) de cola_auditoria
// cuesta ~130 ms y lo comparten /estado, /zonas/:ubigeo, /alcance y el panel admin.
const alcanceMemo = new Memo<Alcance>({ nombre: "alcance:financiamiento", ttlMs: 60_000, staleMs: 60_000 });

/** Tira si falla la base: así la caché no guarda ceros (antes cada consulta caía a 0 y eso quedaba minutos). */
export function getAlcance(): Promise<Alcance> {
  return alcanceMemo.obtener("alcance", async () => {
    const [aj, cola, docs] = await Promise.all([
      pool.query(`SELECT valor, updated_at AS "updatedAt" FROM ajustes WHERE clave = 'procesamiento'`),
      pool.query(`SELECT count(*)::int AS n FROM cola_auditoria`),
      pool.query(`SELECT COALESCE(sum(documentos_listos), 0)::int AS n FROM zona_estado WHERE nivel = 'departamento'`),
    ]);
    return {
      procesamiento: aj.rows[0]?.valor ?? null,
      colaFinanciable: cola.rows[0]?.n ?? 0,
      documentosListos: docs.rows[0]?.n ?? 0,
      actualizadoAt: aj.rows[0]?.updatedAt ?? null,
    };
  });
}

const ALCANCE_VACIO: Alcance = { procesamiento: null, colaFinanciable: 0, documentosListos: 0, actualizadoAt: null };

/**
 * getAlcance() que nunca tira: con la base fallando responde como antes (cola 0, sin alcance). Quien
 * lo usa dentro de otra caché pasa su `noGuardar` en `alFallar`, para que esa tampoco guarde el respaldo.
 */
export function alcanceORespaldo(alFallar?: () => void): Promise<Alcance> {
  return getAlcance().catch((e) => {
    console.warn(`[financiamiento] alcance sin datos (respaldo en 0, no se guarda): ${(e as Error).message}`);
    alFallar?.();
    return ALCANCE_VACIO;
  });
}

// ─── GET /financiamiento/alcance ─────────────────────────────────────────────
financiamientoRouter.get("/alcance", async (c) => {
  cache(c, 60);
  return c.json(await alcanceORespaldo());
});

// ─── GET /financiamiento/pago ────────────────────────────────────────────────
financiamientoRouter.get("/pago", async (c) => {
  cache(c, 60);
  return c.json(await getPagosConfig());
});
