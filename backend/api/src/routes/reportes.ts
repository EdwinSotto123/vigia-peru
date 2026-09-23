/**
 * Reportes ciudadanos — proyección que vive en Postgres.
 *
 * Note: el source-of-truth real es Firestore. Una Cloud Function on-create
 * mete los reportes acá para queries analíticas. Este router sólo lee.
 *
 * Para CREAR un reporte, el frontend escribe directo a Firestore (más rápido,
 * habilita real-time listeners para el mapa).
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import {
  convergenciaPublica, latPublica, lonPublica, reporteIdsPublicos, reportePublico,
} from "../lib/publicacion.js";

export const reportesRouter = new Hono();

// Qué reporte es público (moderación, denuncias a entidades, semillas de demo) y por qué las
// coordenadas salen redondeadas: ver el encabezado de lib/publicacion.ts (§1, §3, §4).

/**
 * Columnas PÚBLICAS de un reporte (alias `r`), las mismas en la lista y en el detalle. Nunca
 * `SELECT *`: la tabla guarda contacto_email / contacto_nombre / contacto_telefono,
 * personas_involucradas, user_id, direccion_texto y media_urls, que no se publican.
 * `convergenciaId` solo si esa convergencia también es pública.
 */
const COLS_PUBLICAS = `
  r.id, r.categoria, r.descripcion,
  r.foto_url AS "fotoUrl",
  r.region,
  to_char(r.fecha, 'YYYY-MM-DD') AS fecha,
  r.confirmado,
  r.confirmaciones,
  (SELECT cv.id FROM convergencias cv WHERE cv.id = r.convergencia_id AND ${convergenciaPublica("cv")}) AS "convergenciaId",
  ${latPublica("r.ubicacion_geo")} AS lat,
  ${lonPublica("r.ubicacion_geo")} AS lon`;

const ListQuery = z.object({
  region: z.string().optional(),
  categoria: z.string().optional(),
  // Filtro por moderación: `rechazado` es válido pero nunca devuelve filas (no se publica).
  estado: z.enum(["pendiente", "aprobado", "rechazado"]).optional(),
  confirmados: z.enum(["true", "false"]).optional(),
  bbox: z.string().optional(), // 'minLon,minLat,maxLon,maxLat'
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── GET /reportes — lista paginada (camelCase para el frontend) ─
reportesRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { region, categoria, estado, confirmados, bbox, limit, offset } = parsed.data;

  // Base: solo reportes publicables (obra, no rechazados, no demo). El total usa el mismo WHERE.
  const conds: string[] = [reportePublico("r")];
  const vals: any[] = [];
  if (region)    { vals.push(region);    conds.push(`r.region = $${vals.length}`); }
  if (categoria) { vals.push(categoria); conds.push(`r.categoria = $${vals.length}`); }
  if (estado)    { vals.push(estado);    conds.push(`COALESCE(r.moderacion_estado, 'pendiente') = $${vals.length}`); }
  if (confirmados === "true")  conds.push(`r.confirmado = TRUE`);
  if (confirmados === "false") conds.push(`r.confirmado = FALSE`);
  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      // Contra el punto REDONDEADO (el mismo que se publica), no el exacto: si no, bisecando
      // cajas cada vez más chicas se recuperaría el GPS original de quien denunció.
      vals.push(parts[0], parts[1], parts[2], parts[3]);
      conds.push(
        `${lonPublica("r.ubicacion_geo")} BETWEEN $${vals.length - 3} AND $${vals.length - 1}
         AND ${latPublica("r.ubicacion_geo")} BETWEEN $${vals.length - 2} AND $${vals.length}`,
      );
    }
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const totalVals = [...vals];
  vals.push(limit, offset);

  const [r, total] = await Promise.all([
    pool.query(
      `SELECT ${COLS_PUBLICAS}
       FROM reportes_indexados r ${where}
       ORDER BY r.fecha DESC, r.created_at DESC
       LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals,
    ),
    pool.query(`SELECT count(*)::int AS n FROM reportes_indexados r ${where}`, totalVals),
  ]);
  return c.json({ data: r.rows, total: total.rows[0].n, limit, offset });
});

// ─── GET /reportes/convergencias — para el cruce con alertas ─────
// Solo convergencias públicas: no demo, con la alerta PUBLICADA (una alerta en revisión o descartada
// no se cruza en público) y al menos un reporte público; `reporteIds` lista solo los públicos.
reportesRouter.get("/convergencias", async (c) => {
  const r = await pool.query(
    `SELECT c.id, c.alerta_id AS "alertaId", ${reporteIdsPublicos("c")} AS "reporteIds",
            ${latPublica("c.ubicacion_geo")} AS lat,
            ${lonPublica("c.ubicacion_geo")} AS lon,
            c.resumen
       FROM convergencias c
      WHERE ${convergenciaPublica("c")}
       ORDER BY c.created_at DESC`,
  );
  return c.json({ data: r.rows });
});

// ─── POST /reportes — crear denuncia ciudadana ──────────────────
const MediaItem = z.object({
  url: z.string().url(),
  tipo: z.enum(["foto", "video", "documento", "audio"]).default("foto"),
  filename: z.string().max(200).optional().nullable(),
  size_bytes: z.number().optional().nullable(),
  content_type: z.string().max(80).optional().nullable(),
});

const CreateReporte = z.object({
  modo: z.enum(["obra", "entidad"]).default("obra"),
  categoria: z.string().min(2).max(80),
  descripcion: z.string().min(10).max(4000),
  // Legacy: una sola foto. Sigue soportado para compatibilidad.
  fotoUrl: z.string().url().optional().nullable(),
  // Nuevo: múltiples archivos (fotos, videos, documentos)
  media: z.array(MediaItem).max(20).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lon: z.number().min(-180).max(180).optional().nullable(),
  direccionTexto: z.string().max(500).optional().nullable(),
  region: z.string().max(80).optional().nullable(),
  provincia: z.string().max(80).optional().nullable(),
  distrito: z.string().max(80).optional().nullable(),
  rucEntidad: z.string().regex(/^\d{11}$/).optional().nullable(),
  // Datos opcionales adicionales
  montoEstimado: z.number().optional().nullable(),
  periodoDesde: z.string().max(10).optional().nullable(),
  periodoHasta: z.string().max(10).optional().nullable(),
  personasInvolucradas: z.string().max(1000).optional().nullable(),
  enlacesExternos: z.array(z.string().url()).max(10).optional().nullable(),
  contactoEmail: z.string().email().optional().nullable(),
  contactoNombre: z.string().max(120).optional().nullable(),
  contactoTelefono: z.string().max(40).optional().nullable(),
  anonimo: z.boolean().optional().default(true),
});

reportesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateReporte.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", detail: parsed.error.errors }, 400);
  }
  const d = parsed.data;
  const id = `RPT-${d.modo === "entidad" ? "ENT-" : ""}${new Date().getFullYear()}-${String(
    Math.floor(1000 + Math.random() * 9000),
  )}`;
  // ubicacion_geo: solo seteamos si tenemos lat+lon. Para denuncias a entidades
  // (sin foto/ubicación) queda NULL — la columna debe permitir NULL.
  const hasGeo = d.lat != null && d.lon != null;

  // Schema-ensure idempotente: crea la tabla si no existe y agrega columnas
  // nuevas. Postgres es tolerante a IF NOT EXISTS en ALTER COLUMN.
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS reportes_indexados (
         id TEXT PRIMARY KEY, categoria TEXT NOT NULL, descripcion TEXT NOT NULL,
         foto_url TEXT, region TEXT, ubicacion_geo GEOGRAPHY(POINT, 4326),
         direccion_texto TEXT, ruc_entidad TEXT, contacto_email TEXT,
         confirmado BOOL DEFAULT FALSE, confirmaciones INT DEFAULT 1,
         convergencia_id TEXT, fecha DATE DEFAULT CURRENT_DATE,
         moderacion_estado TEXT DEFAULT 'pendiente',
         modo TEXT DEFAULT 'obra',
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`,
    );
    await pool.query(
      `ALTER TABLE reportes_indexados
          ALTER COLUMN ubicacion_geo DROP NOT NULL,
          ADD COLUMN IF NOT EXISTS direccion_texto TEXT,
          ADD COLUMN IF NOT EXISTS ruc_entidad TEXT,
          ADD COLUMN IF NOT EXISTS contacto_email TEXT,
          ADD COLUMN IF NOT EXISTS modo TEXT DEFAULT 'obra',
          ADD COLUMN IF NOT EXISTS media_urls JSONB DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS provincia TEXT,
          ADD COLUMN IF NOT EXISTS distrito TEXT,
          ADD COLUMN IF NOT EXISTS monto_estimado NUMERIC,
          ADD COLUMN IF NOT EXISTS periodo_desde DATE,
          ADD COLUMN IF NOT EXISTS periodo_hasta DATE,
          ADD COLUMN IF NOT EXISTS personas_involucradas TEXT,
          ADD COLUMN IF NOT EXISTS enlaces_externos JSONB DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS contacto_nombre TEXT,
          ADD COLUMN IF NOT EXISTS contacto_telefono TEXT,
          ADD COLUMN IF NOT EXISTS anonimo BOOL DEFAULT TRUE`,
    );
  } catch (e: any) {
    if (!/already|does not exist/i.test(e?.message || "")) {
      console.error("[reportes] schema-ensure error:", e?.message);
    }
  }

  // Componer media_urls: combina legacy `fotoUrl` (si vino) + lista `media`
  const mediaList: any[] = [];
  if (d.fotoUrl) mediaList.push({ url: d.fotoUrl, tipo: "foto" });
  if (Array.isArray(d.media)) mediaList.push(...d.media);
  // foto_url legacy = primera foto si hay
  const primeraFoto = mediaList.find((m) => m.tipo === "foto")?.url ?? d.fotoUrl ?? null;

  try {
    const vals: any[] = [
      id, d.modo, d.categoria, d.descripcion,
      primeraFoto,
      d.region ?? null,
      d.direccionTexto ?? null,
      d.rucEntidad ?? null,
      d.contactoEmail ?? null,
      JSON.stringify(mediaList),
      d.provincia ?? null,
      d.distrito ?? null,
      d.montoEstimado ?? null,
      d.periodoDesde ?? null,
      d.periodoHasta ?? null,
      d.personasInvolucradas ?? null,
      JSON.stringify(d.enlacesExternos ?? []),
      d.contactoNombre ?? null,
      d.contactoTelefono ?? null,
      d.anonimo ?? true,
    ];
    if (hasGeo) vals.push(`POINT(${d.lon} ${d.lat})`);

    await pool.query(
      `INSERT INTO reportes_indexados
         (id, modo, categoria, descripcion, foto_url, region,
          direccion_texto, ruc_entidad, contacto_email,
          media_urls, provincia, distrito,
          monto_estimado, periodo_desde, periodo_hasta,
          personas_involucradas, enlaces_externos,
          contacto_nombre, contacto_telefono, anonimo,
          ubicacion_geo, confirmado, confirmaciones, fecha, created_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, $8, $9,
               $10::jsonb, $11, $12,
               $13, $14, $15,
               $16, $17::jsonb,
               $18, $19, $20,
               ${hasGeo ? "ST_GeogFromText($21)" : "NULL"},
               FALSE, 1, CURRENT_DATE, NOW())`,
      vals,
    );
  } catch (e: any) {
    return c.json({ error: "insert_failed", detail: e?.message?.slice(0, 400) }, 500);
  }
  return c.json({ id, ok: true });
});

// ─── GET /reportes/:id ───────────────────────────────────────────
// Misma forma y mismas columnas públicas que cada fila de GET /reportes (camelCase). Un reporte
// no publicable (denuncia a entidad, rechazado, demo) responde 404 igual que uno inexistente:
// no se confirma su existencia.
reportesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const r = await pool.query(
    `SELECT ${COLS_PUBLICAS}
       FROM reportes_indexados r
      WHERE r.id = $1 AND ${reportePublico("r")}`,
    [id],
  );
  if (r.rows.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json(r.rows[0]);
});
