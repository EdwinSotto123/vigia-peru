import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { esRevisor } from "../lib/adminlog.js";
import { SIN_CACHE } from "../lib/http.js";
import { medirCobertura, recolectar, type EnvRecolector, type ModoLote, type ResumenLote } from "../lib/empleoRecolector.js";

/**
 * El recolector de bases de empleo (docs/automatizacion_cas.md; lib/empleoRecolector.ts), a mano y desde el cron:
 *
 *   POST /admin/empleo/recolectar?modo=medir|recolectar|vigilar&limite=20&leer=0|1&segundos=600
 *   POST /admin/empleo/cobertura       mide la cobertura de hoy (llena el registro de fuentes)
 *   GET  /admin/empleo/cobertura       la última medición: por familia y las fuentes más grandes
 *   GET  /admin/empleo/eventos         lo último que cambió en las convocatorias
 *   POST /admin/empleo/noche           el cron de la madrugada: cobertura (la primera vez), vigilar y recolectar
 */
export const adminEmpleoRouter = new Hono();

adminEmpleoRouter.use("/empleo/*", async (c, next) => {
  if (esRevisor(c)) return c.json({ error: "forbidden" }, 403);
  c.header("Cache-Control", SIN_CACHE);
  await next();
});

const Lote = z.object({
  modo: z.enum(["medir", "recolectar", "vigilar"]).default("recolectar"),
  limite: z.coerce.number().int().min(1).max(500).default(20),
  leer: z.enum(["0", "1"]).default("0"),
  segundos: z.coerce.number().int().min(10).max(840).default(600),
});

adminEmpleoRouter.post("/empleo/recolectar", async (c) => {
  const q = Lote.safeParse(c.req.query());
  if (!q.success) return c.json({ error: "parametros", detail: q.error.issues[0]?.message }, 400);
  const r = await recolectar(c.env as EnvRecolector, { modo: q.data.modo as ModoLote, limite: q.data.limite, leer: q.data.leer === "1", segundos: q.data.segundos });
  return c.json(r);
});

adminEmpleoRouter.post("/empleo/cobertura", async (c) => c.json(await medirCobertura()));

adminEmpleoRouter.get("/empleo/cobertura", async (c) => {
  const fecha = (await pool.query<{ f: string | null }>(`SELECT to_char(max(fecha), 'YYYY-MM-DD') AS f FROM empleo_cobertura`)).rows[0]?.f;
  if (!fecha) return c.json({ fecha: null, porFamilia: [], fuentes: [] });
  const [familias, fuentes] = await Promise.all([
    pool.query(
      `SELECT c.familia, count(*)::int AS fuentes, sum(c.abiertas)::int AS abiertas, sum(c.con_documentos)::int AS "conDocumentos",
              sum(c.con_lectura)::int AS "conLectura", sum(c.errores)::int AS errores
         FROM empleo_cobertura c WHERE c.fecha = $1 GROUP BY 1 ORDER BY 1`, [fecha]),
    pool.query(
      `SELECT e.dominio, e.familia, e.estado, e.adaptador, e.necesita_lima AS "necesitaLima", e.plazas_90d AS "plazas90d",
              cardinality(e.entidades) AS entidades, c.abiertas, c.con_documentos AS "conDocumentos", c.con_lectura AS "conLectura",
              c.errores, to_char(e.ultimo_exito AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS "ultimoExito", e.ultimo_error AS "ultimoError"
         FROM empleo_cobertura c JOIN empleo_fuente e ON e.id = c.fuente_id
        WHERE c.fecha = $1 ORDER BY e.plazas_90d DESC LIMIT 100`, [fecha]),
  ]);
  return c.json({ fecha, porFamilia: familias.rows, fuentes: fuentes.rows });
});

adminEmpleoRouter.get("/empleo/eventos", async (c) => {
  const r = await pool.query(
    `SELECT e.convocatoria, e.tipo, e.detalle, e.url, to_char(e.fecha, 'YYYY-MM-DD') AS fecha,
            to_char(e.visto_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS visto
       FROM empleo_evento e ORDER BY e.visto_at DESC LIMIT 200`);
  return c.json({ data: r.rows });
});

/**
 * La madrugada (cron cada 20 minutos de 00:00 a 05:40 de Lima, wrangler.jsonc): la primera vuelta mide la cobertura; cada
 * vuelta vigila las guardadas (documentos nuevos, sin bajar) y recolecta las que faltan, leyendo sólo las guardadas.
 * Cada vuelta cabe en los 15 minutos de un cron.
 */
adminEmpleoRouter.post("/empleo/noche", async (c) => {
  const env = c.env as EnvRecolector;
  const lima = new Date(Date.now() - 5 * 3600 * 1000);
  const salida: { cobertura?: unknown; vigilar?: ResumenLote; recolectar?: ResumenLote } = {};
  if (lima.getUTCHours() === 0 && lima.getUTCMinutes() < 20) salida.cobertura = await medirCobertura();
  salida.vigilar = await recolectar(env, { modo: "vigilar", limite: 40, leer: false, segundos: 200 });
  salida.recolectar = await recolectar(env, { modo: "recolectar", limite: 30, leer: true, segundos: 540 });
  return c.json(salida);
});
