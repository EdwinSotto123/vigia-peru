/**
 * "Financia una auditoría" — lectura pública.
 * Diseño: docs/design/FINANCIA_UNA_AUDITORIA.md · esquema: backend/db/migrations/09_financiamiento.sql
 *
 *   GET /financiamiento/zonas?nivel=departamento[&padre=15]   estado por zona (mapa)
 *   GET /financiamiento/zonas/:ubigeo                          detalle + aliados + hijas
 *   GET /financiamiento/ranking?periodo=mes|anio|todo&region=&limit=&offset=  ranking de impacto (contratos, no soles)
 *   GET /financiamiento/estado                                  métricas globales + tarifa vigente
 *   GET /financiamiento/impacto/:codigo?limit=100&cursor=       comprobante público de una contribución (detalle paginado)
 *   GET /financiamiento/aliados/:slug                           perfil público de un financiador (+ lo que publicó: migración 30)
 *   GET /financiamiento/recientes                               últimas contribuciones confirmadas
 *   GET /financiamiento/pago                                    medios de pago (Yape/Plin/cuentas/QR) — públicos
 *   GET /financiamiento/alcance                                 qué tipos × etapas se analizan hoy (ajustes.procesamiento) + cola + docs listos
 *   GET /financiamiento/entidades?q=&limit=1..50(20)&offset=    entidades que se pueden financiar (migración 39): con
 *                                                              contratos en cola; con `q`, por nombre o RUC (también sin cola)
 *   GET /financiamiento/entidades/:ruc                          una entidad: su cola, sus contratos, su zona, tarifa y aliados
 *
 * Aportes por ENTIDAD (migración 39): recientes, impacto y aliados traen `entidad: {ruc, nombre} | null`
 * (null = aporte por zona). Un aporte por entidad tiene también zona: la de la mayoría de sus contratos.
 *
 * Migración 22: "señal hallada" = alerta PUBLICADA (activa/confirmada) con ≥ 1 bandera; las alertas en
 * `revision` cuentan como procesadas pero no como señales (se exponen como `enRevision`). Aliado,
 * comprobante y estado global se calculan EN VIVO desde `asignaciones` (caché 30 s): el ranking y las
 * zonas leen las vistas materializadas que el dispatcher refresca al cerrar cada contrato.
 */

import { Hono } from "hono";
import { z } from "zod";
import { escaparLike, pool } from "../lib/db.js";
import { cachePublico, parametros } from "../lib/http.js";
import { decodificarCursor, codificarCursor } from "../lib/cursor.js";
import { getPagosConfig } from "./contribuciones.js";
import { alertaNoDemo, alertaPublica, convocatoriaNoDemo } from "../lib/publicacion.js";
import { Memo, responderJson, responderSerializado, serializar, type Serializado } from "../lib/cache.js";
import { conPerfilAliado, hayAporteEntidad, hayModelosLectura } from "../lib/esquema.js";
import { perfilPublicado } from "../lib/perfilAliado.js";
import { entidadDeAporteSql, tarifaVigente } from "../lib/aportes.js";

export const financiamientoRouter = new Hono();

// Conteos de alertas (lib/publicacion.ts): "señal hallada" = alerta pública (publicada, no demo) con
// ≥ 1 bandera; "en revisión" = estado 'revision' (tampoco demo).
const SENAL_HALLADA = `${alertaPublica("a")} AND EXISTS (SELECT 1 FROM banderas b WHERE b.alerta_id = a.id)`;
const EN_REVISION = `a.estado = 'revision' AND ${alertaNoDemo("a")}`;

const cache = (c: any, seconds: number) => c.header("Cache-Control", cachePublico(seconds, { swr: 60 }));

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
  const conEntidad = await hayAporteEntidad();
  const r = await pool.query(
    `SELECT co.codigo, co.contratos, co.pagada_at AS "pagadaAt", co.estado, co.mensaje_publico AS "mensajePublico",
            z.ubigeo, z.nombre AS zona, z.nivel, ${entidadDeAporteSql("co", conEntidad)} AS entidad,
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
// Auditoría M3: un aporte puede tener hasta 50.000 contratos y el detalle salía entero (~22 MB).
// Ahora `resumen` se cuenta en SQL sobre TODOS los contratos y `detalle` va paginado:
// `?limit=` (100 por defecto, máx. 200) y `?cursor=` (el `siguiente` de la página anterior; null = no hay más).
const ImpactoQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().max(200).optional(),
});

financiamientoRouter.get("/impacto/:codigo", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  if (codigo.length > 40) return c.json({ error: "not_found" }, 404);
  const parsed = ImpactoQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { limit } = parsed.data;
  const cur = parsed.data.cursor ? decodificarCursor(parsed.data.cursor, "i", 2) : null;
  if (parsed.data.cursor && !cur) return c.json({ error: "invalid_cursor" }, 400);
  const conEntidad = await hayAporteEntidad();
  const head = await pool.query(
    `SELECT co.id, co.codigo, co.contratos, co.monto_pen::float AS "montoPen", co.estado, co.pagada_at AS "pagadaAt",
            co.created_at AS "createdAt", co.mensaje_publico AS "mensajePublico", co.pasarela,
            z.ubigeo, z.nombre AS zona, z.nivel, ${entidadDeAporteSql("co", conEntidad)} AS entidad,
            COALESCE(f.nombre_publico,'Anónimo') AS financiador, f.tipo, f.slug, f.logo_url AS "logoUrl", f.visible,
            t.precio_pen::float AS "precioPen"
     FROM contribuciones co
     JOIN financiadores f ON f.id = co.financiador_id
     JOIN zonas z ON z.ubigeo = co.ubigeo
     JOIN tarifas t ON t.id = co.tarifa_id
     WHERE co.codigo = $1`, [codigo]);
  if (!head.rows.length) return c.json({ error: "not_found" }, 404);
  const { id: contribucionId, ...h } = head.rows[0];
  // Por contrato: score, severidad y conteo de señales SOLO si la alerta está publicada; en revisión
  // humana o descartada salen null (con `alertaEstado` y `enRevision` para decir por qué).
  const desde = cur ? `AND (s.asignada_at, s.id) > ($2::timestamptz, $3::bigint)` : "";
  const valsDet: unknown[] = cur ? [contribucionId, cur[0], cur[1], limit + 1] : [contribucionId, limit + 1];
  const [det, res] = await Promise.all([
    pool.query(
      `SELECT s.id::text AS _id, s.asignada_at::text AS _k, s.ocid, s.asignada_at AS "asignadaAt", s.procesada_at AS "procesadaAt",
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
       JOIN convocatorias cv ON cv.ocid = s.ocid
       LEFT JOIN entidades e ON e.ruc = cv.entidad_ruc
       LEFT JOIN alertas a ON a.id = s.alerta_id AND ${alertaNoDemo("a")}
       WHERE s.contribucion_id = $1 ${desde}
       ORDER BY s.asignada_at, s.id
       LIMIT $${valsDet.length}`, valsDet),
    // Totales sobre TODOS los contratos del aporte (antes se sumaban en JS sobre la lista entera).
    // Señales = banderas de alertas PUBLICADAS; lo que está en revisión humana no se cuenta.
    pool.query(
      `SELECT count(*)::int AS asignados, count(s.procesada_at)::int AS procesados,
              COALESCE(sum(b.n) FILTER (WHERE alerta_publicada(a.estado)), 0)::int AS senales,
              count(*) FILTER (WHERE alerta_publicada(a.estado) AND b.n > 0)::int AS "contratosConSenal",
              count(*) FILTER (WHERE a.estado = 'revision')::int AS "enRevision",
              COALESCE(sum(cv.cuantia_referencial), 0)::float AS "montoAuditado"
       FROM asignaciones s
       JOIN convocatorias cv ON cv.ocid = s.ocid
       LEFT JOIN alertas a ON a.id = s.alerta_id AND ${alertaNoDemo("a")}
       LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM banderas b WHERE b.alerta_id = a.id) b ON TRUE
       WHERE s.contribucion_id = $1`, [contribucionId]),
  ]);
  const hay = det.rows.length > limit;
  const filas = det.rows.slice(0, limit);
  const ultima = filas[filas.length - 1];
  const r = res.rows[0];
  cache(c, 30);
  return c.json({
    ...h,
    financiador: h.visible ? h.financiador : "Aliado no visible (conflicto de interés declarado)",
    resumen: {
      asignados: r.asignados,
      procesados: r.procesados,
      pendientes: h.contratos - r.asignados,
      senales: r.senales,
      contratosConSenal: r.contratosConSenal,
      enRevision: r.enRevision,
      montoAuditado: r.montoAuditado,
    },
    detalle: filas.map(({ _id, _k, ...fila }) => fila),
    siguiente: hay && ultima ? codificarCursor("i", [ultima._k, ultima._id]) : null,
    limit,
  });
});

// ─── GET /financiamiento/aliados/:slug ───────────────────────────────────────
// Perfil público (migración 30: descripción, web, correo de contacto, redes y portada), que quien aporta
// edita desde su cuenta: reglas en lib/perfilAliado.ts, detección de las columnas en lib/esquema.ts.
// Sin la migración, el perfil sale sin esos datos (en vez de un 500).
const MAX_CONTRIBUCIONES_ALIADO = 100;
const COLS_ALIADO = `id, tipo, COALESCE(nombre_publico,'Anónimo') AS nombre, slug, logo_url AS "logoUrl", created_at AS "desde"`;
// email_publico: el correo que el aliado publicó. `email` (el del pago) nunca entra en esta consulta.
const COLS_ALIADO_PERFIL = `, descripcion, sitio_web AS "sitioWeb", email_publico AS "emailPublico", redes, portada_url AS "portadaUrl"`;

financiamientoRouter.get("/aliados/:slug", async (c) => {
  const slug = c.req.param("slug");
  const { valor: f } = await conPerfilAliado((perfil) => pool.query(
    `SELECT ${COLS_ALIADO}${perfil ? COLS_ALIADO_PERFIL : ""} FROM financiadores WHERE slug = $1 AND visible`, [slug]));
  if (!f.rows.length) return c.json({ error: "not_found" }, 404);
  const r = f.rows[0];
  // Campo por campo, sin esparcir la fila: sólo sale lo que el aliado publicó, saneado otra vez
  // (por si algo lo escribió sin pasar por su cuenta). Sin la migración 30, todo vacío.
  const p = perfilPublicado(r);
  const aliado = {
    id: r.id, tipo: r.tipo, nombre: r.nombre, slug: r.slug, logoUrl: r.logoUrl, desde: r.desde,
    descripcion: p.descripcion, web: p.sitioWeb, email: p.emailPublico, redes: p.redes, portadaUrl: p.portadaUrl,
  };
  const conEntidad = await hayAporteEntidad();
  const cs = await pool.query(
    `SELECT co.codigo, co.contratos, co.estado, co.pagada_at AS "pagadaAt", z.ubigeo, z.nombre AS zona, z.nivel,
            ${entidadDeAporteSql("co", conEntidad)} AS entidad,
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id AND s.procesada_at IS NOT NULL)::int AS procesados,
            (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
              WHERE s.contribucion_id = co.id AND ${SENAL_HALLADA})::int AS senales,
            (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
              WHERE s.contribucion_id = co.id AND ${EN_REVISION})::int AS "enRevision"
     FROM contribuciones co JOIN zonas z ON z.ubigeo = co.ubigeo
     WHERE co.financiador_id = $1 AND co.estado IN ('pagada','en_proceso','procesada')
     ORDER BY co.pagada_at DESC NULLS LAST, co.id DESC
     LIMIT ${MAX_CONTRIBUCIONES_ALIADO}`, [r.id]);
  // Con tope (auditoría M3): las 100 más recientes y el total contado en SQL.
  const total = cs.rows.length < MAX_CONTRIBUCIONES_ALIADO ? cs.rows.length
    : (await pool.query(`SELECT count(*)::int AS n FROM contribuciones co
                          WHERE co.financiador_id = $1 AND co.estado IN ('pagada','en_proceso','procesada')`, [r.id])).rows[0].n;
  cache(c, 30);
  return c.json({ aliado, contribuciones: cs.rows, totalContribuciones: total });
});

// ─── Entidades que se pueden financiar (migración 39) ─────────────────────────
// Financiar una ENTIDAD: se le asignan contratos al azar entre los suyos en cola (con documentos listos
// primero), mínimo 1. Estas dos lecturas arman la búsqueda y la ficha para elegirla.

const EntidadesQuery = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
// 60 s (= su Cache-Control). El texto libre va en una caché aparte y chica (lib/cache.ts).
const entidadesMemo = new Memo<Serializado>({ nombre: "financiamiento:entidades", ttlMs: 60_000, staleMs: 60_000, max: 100 });
const entidadesTextoMemo = new Memo<Serializado>({ nombre: "financiamiento:entidades:texto", ttlMs: 60_000, max: 30 });

// ─── GET /financiamiento/entidades ───────────────────────────────────────────
// → { total, items: [{ruc, nombre, tipo, region, enCola, conDocumentos, auditados, contratos}] }
//   · sin `q`: sólo las que tienen contratos en cola;
//   · con `q` (2 caracteres o más): por nombre sin tildes, o el RUC exacto (11 dígitos); también sin cola.
//   Orden: enCola DESC, nombre. enCola/conDocumentos en vivo (cola_auditoria); auditados (alertas
//   publicadas) y contratos desde entidad_stats (35), que va hasta un refresco detrás.
financiamientoRouter.get("/entidades", async (c) => {
  const parsed = EntidadesQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { limit, offset } = parsed.data;
  const q = parsed.data.q && [...parsed.data.q].length >= 2 ? parsed.data.q : undefined;
  return responderJson(c, q ? entidadesTextoMemo : entidadesMemo, JSON.stringify({ q, limit, offset }),
    () => entidadesFinanciables(q, limit, offset), cachePublico(60, { swr: 60 }));
});

async function entidadesFinanciables(q: string | undefined, limit: number, offset: number) {
  // Sin la 35 (entidad_stats), las mismas columnas desde `entidades`, contadas en vivo.
  const fuente = (await hayModelosLectura())
    ? "entidad_stats es"
    : `(SELECT e.ruc, e.nombre, immutable_unaccent(lower(e.nombre)) AS nombre_norm, e.tipo, e.region,
               (SELECT count(*) FROM convocatorias c WHERE c.entidad_ruc = e.ruc AND ${convocatoriaNoDemo("c")})::int AS contratos,
               (SELECT count(*) FROM alertas a WHERE a.entidad_ruc = e.ruc AND ${alertaPublica("a")})::int AS alertas_publicadas
          FROM entidades e) es`;
  const vals: unknown[] = [];
  let filtro = "";
  if (q && /^\d{11}$/.test(q)) {
    vals.push(q);
    filtro = "WHERE es.ruc = $1";
  } else if (q) {
    vals.push(`%${escaparLike(q.toLowerCase())}%`);
    filtro = "WHERE es.nombre_norm LIKE immutable_unaccent($1)";
  }
  vals.push(limit, offset);
  // Una consulta: `base` se calcula una vez (CTE usado dos veces) para el total y para la página.
  const r = await pool.query(
    `WITH cola AS (
       SELECT c.entidad_ruc AS ruc, count(*)::int AS n,
              count(*) FILTER (WHERE documentos_listos(q.ocid))::int AS listos
         FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid
        WHERE c.entidad_ruc IS NOT NULL
        GROUP BY 1
     ),
     base AS (
       SELECT btrim(es.ruc) AS ruc, es.nombre, es.tipo, es.region,
              COALESCE(k.n, 0) AS "enCola", COALESCE(k.listos, 0) AS "conDocumentos",
              COALESCE(es.alertas_publicadas, 0)::int AS auditados, COALESCE(es.contratos, 0)::int AS contratos
         FROM ${fuente} ${q ? "LEFT JOIN" : "JOIN"} cola k ON k.ruc = es.ruc
        ${filtro}
     )
     SELECT (SELECT count(*)::int FROM base) AS total,
            COALESCE((SELECT json_agg(p ORDER BY p."enCola" DESC, p.nombre, p.ruc)
                        FROM (SELECT * FROM base ORDER BY "enCola" DESC, nombre, ruc
                               LIMIT $${vals.length - 1} OFFSET $${vals.length}) p), '[]'::json) AS items`, vals);
  return { total: r.rows[0]?.total ?? 0, items: r.rows[0]?.items ?? [] };
}

// ─── GET /financiamiento/entidades/:ruc ──────────────────────────────────────
// La ficha para financiar una entidad (404 `entidad_no_encontrada`). En caché 60 s por RUC.
//   · entidad.zona: la que llevaría su aporte (zona_de_entidad, 39); null sin cola o sin la 39.
//   · contratos.enProceso: contratos de la entidad asignados a un aporte (cualquiera) sin alerta todavía.
//   · enCola: hasta 50, los más recientes primero. aliados: financiadores VISIBLES con aportes a esta
//     entidad (por entidad, no por zona), top 12 por contratos.
//   · tiposActivos: ajustes.procesamiento ([] si no hay alcance configurado: entra todo).
const entidadMemo = new Memo<Serializado | null>({ nombre: "financiamiento:entidad", ttlMs: 60_000, max: 300 });

financiamientoRouter.get("/entidades/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "entidad_no_encontrada" }, 404);
  const s = await entidadMemo.obtener(ruc, async (ctl) => {
    const v = await detalleEntidad(ruc, ctl.noGuardar);
    return v ? serializar(v) : null;
  });
  if (!s) return c.json({ error: "entidad_no_encontrada" }, 404);
  return responderSerializado(c, s, cachePublico(60, { swr: 60 }));
});

async function detalleEntidad(ruc: string, noGuardar: () => void): Promise<Record<string, unknown> | null> {
  const ent = await pool.query(`SELECT btrim(e.ruc) AS ruc, e.nombre, e.tipo, e.region FROM entidades e WHERE e.ruc = $1`, [ruc]);
  if (!ent.rows.length) return null;
  const conEntidad = await hayAporteEntidad();
  const vacio = Promise.resolve({ rows: [] as any[] });
  const [zona, resumen, lista, aliados, tarifa, alcance] = await Promise.all([
    conEntidad ? pool.query(`SELECT z.ubigeo, z.nombre FROM zonas z WHERE z.ubigeo = zona_de_entidad($1)`, [ruc]) : vacio,
    pool.query(
      `SELECT k.contratos, k."conDocumentos", k."montoReferencial",
              (SELECT count(*) FROM convocatorias c WHERE c.entidad_ruc = $1 AND ${convocatoriaNoDemo("c")})::int AS total,
              (SELECT count(*) FROM alertas a WHERE a.entidad_ruc = $1 AND ${alertaPublica("a")})::int AS auditados,
              (SELECT count(*) FROM asignaciones s JOIN convocatorias c ON c.ocid = s.ocid
                WHERE c.entidad_ruc = $1 AND s.alerta_id IS NULL)::int AS "enProceso"
         FROM (SELECT count(*)::int AS contratos,
                      count(*) FILTER (WHERE documentos_listos(q.ocid))::int AS "conDocumentos",
                      COALESCE(sum(c.cuantia_referencial), 0)::float AS "montoReferencial"
                 FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid
                WHERE c.entidad_ruc = $1) k`, [ruc]),
    pool.query(
      `SELECT q.ocid, c.codigo, c.objeto, c.cuantia_referencial::float AS "montoReferencial",
              to_char(q.fecha_convocatoria, 'YYYY-MM-DD') AS fecha, documentos_listos(q.ocid) AS "documentosListos"
         FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid
        WHERE c.entidad_ruc = $1
        ORDER BY q.fecha_convocatoria DESC NULLS LAST, q.ocid
        LIMIT 50`, [ruc]),
    conEntidad
      ? pool.query(
        `SELECT COALESCE(f.nombre_publico, 'Anónimo') AS nombre, f.slug, f.logo_url AS "logoUrl", f.tipo,
                SUM(co.contratos)::int AS contratos
           FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id
          WHERE co.entidad_ruc = $1 AND co.estado IN ('pagada','en_proceso','procesada') AND f.visible
          GROUP BY f.id ORDER BY contratos DESC, MAX(co.pagada_at) DESC NULLS LAST, f.id LIMIT 12`, [ruc])
      : vacio,
    tarifaVigente(pool),
    alcanceORespaldo(noGuardar),
  ]);
  // Sin tarifa vigente no se inventa un precio: sale null y no se guarda en caché.
  if (!tarifa) noGuardar();
  const r = resumen.rows[0];
  const tipos = alcance.procesamiento?.tipos_activos;
  const e = ent.rows[0];
  return {
    entidad: { ruc: e.ruc, nombre: e.nombre, tipo: e.tipo ?? null, region: e.region ?? null, zona: zona.rows[0] ?? null },
    cola: { contratos: r.contratos, conDocumentos: r.conDocumentos, montoReferencial: r.montoReferencial },
    contratos: { total: r.total, auditados: r.auditados, enProceso: r.enProceso },
    tiposActivos: Array.isArray(tipos) ? tipos.filter((t): t is string => typeof t === "string") : [],
    precioPen: tarifa?.precioPen ?? null,
    enCola: lista.rows,
    aliados: aliados.rows,
  };
}

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
      // La cola por departamento ya está sumada en zona_estado (`pendientes`, el mismo rollup que
      // count(cola_auditoria)): leerla cuesta O(zonas). El count(*) recorría convocatorias entera
      // (medido en staging: el único scan completo de la tabla en una pasada fría por toda la API).
      // Queda tan fresco como el último refresco (condicional, a lo sumo cada 10 min).
      pool.query(`SELECT COALESCE(sum(pendientes), 0)::int AS n FROM zona_estado WHERE nivel = 'departamento'`),
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
