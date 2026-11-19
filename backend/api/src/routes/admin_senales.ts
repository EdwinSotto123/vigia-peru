/**
 * Revisión a mano de los indicadores en observación (migración 398; la regla es de la 329).
 *
 *   GET  /admin/senales-observacion                    cada indicador: casos, revisados, precisión y si puede graduarse
 *   GET  /admin/senales-observacion/:tipo?ver=&page=    la muestra por revisar (orden al azar estable) o lo ya revisado
 *   POST /admin/senales-observacion/:tipo/veredicto     { ocid, ruc, veredicto, nota? } guarda (o cambia) un veredicto
 *   POST /admin/senales-observacion/:tipo/graduar       sólo admin, con 40 casos decididos o más: el indicador puntúa
 *   POST /admin/senales-observacion/:tipo/observar      sólo admin: lo devuelve a observación
 *
 * La muestra sale de cruces_proveedor en un orden al azar que no cambia entre visitas (md5 del caso): no se eligen los
 * casos más graves ni los más fáciles, así la precisión medida vale para todo el indicador. El revisor ve el caso con su
 * detalle completo (es el panel del equipo) y abre el contrato para leer la evidencia.
 */
import { Hono } from "hono";
import { z } from "zod";
import { esErrorPg, poolAdmin as pool } from "../lib/db.js";
import { actor, esRevisor, log } from "../lib/adminlog.js";
import { ETIQUETA_CRUCE } from "../lib/cruces.js";
import { leerValidacion } from "../lib/validacion.js";

export const adminSenalesRouter = new Hono();

/** Casos decididos (acierta + no acierta) que hacen falta para poder graduar un indicador (migración 329). */
export const MINIMO_REVISADOS = 40;

/** Límite inferior del intervalo de Wilson al 95 %: cuánto acierta, como mínimo, con lo revisado hasta ahora. */
export function wilsonInferior(aciertos: number, n: number): number | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = aciertos / n;
  const centro = p + (z * z) / (2 * n);
  const margen = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centro - margen) / (1 + (z * z) / n));
}

const sinMigracion = (c: { json: (b: unknown, s: number) => Response }) =>
  c.json({ error: "sin_migracion", detail: "Falta la migración 398 (senal_revision)." }, 503);

const TIPO = /^[a-z_]{3,60}$/;

adminSenalesRouter.get("/senales-observacion", async (c) => {
  try {
    const r = await pool.query(
      `WITH tipos AS (SELECT tipo, true AS en_observacion FROM senal_en_observacion
                      UNION SELECT DISTINCT tipo, false FROM senal_revision WHERE tipo NOT IN (SELECT tipo FROM senal_en_observacion))
       SELECT t.tipo, t.en_observacion AS "enObservacion",
              (SELECT count(*)::int FROM cruces_proveedor k WHERE k.tipo = t.tipo) AS casos,
              (SELECT count(DISTINCT k.ocid)::int FROM cruces_proveedor k WHERE k.tipo = t.tipo) AS procesos,
              count(r.*) FILTER (WHERE r.veredicto = 'acierta')::int AS aciertan,
              count(r.*) FILTER (WHERE r.veredicto = 'no_acierta')::int AS "noAciertan",
              count(r.*) FILTER (WHERE r.veredicto = 'dudoso')::int AS dudosos,
              max(r.revisado_at) AS "ultimaRevision",
              (SELECT motivo FROM senal_en_observacion o WHERE o.tipo = t.tipo) AS motivo,
              (SELECT jsonb_build_object('casos', b.casos, 'universo', b.universo, 'que', b.universo_que)
                 FROM senal_tasa_base b WHERE b.tipo = t.tipo) AS "tasaBase"
         FROM tipos t LEFT JOIN senal_revision r ON r.tipo = t.tipo
        GROUP BY t.tipo, t.en_observacion ORDER BY t.en_observacion DESC, t.tipo`);
    return c.json({
      minimo: MINIMO_REVISADOS,
      data: r.rows.map((x) => {
        const decididos = x.aciertan + x.noAciertan;
        return {
          ...x,
          etiqueta: ETIQUETA_CRUCE[x.tipo] ?? x.tipo,
          decididos,
          precision: decididos ? x.aciertan / decididos : null,
          precisionMinima: wilsonInferior(x.aciertan, decididos),
          puedeGraduar: x.enObservacion && decididos >= MINIMO_REVISADOS,
        };
      }),
    });
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return sinMigracion(c);
    throw e;
  }
});

const Cola = z.object({
  ver: z.enum(["pendientes", "revisados"]).default("pendientes"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  size: z.coerce.number().int().min(1).max(50).default(10),
});

adminSenalesRouter.get("/senales-observacion/:tipo", async (c) => {
  const tipo = c.req.param("tipo");
  if (!TIPO.test(tipo)) return c.json({ error: "tipo_invalido" }, 400);
  const q = Cola.safeParse(c.req.query());
  if (!q.success) return c.json({ error: "pedido_invalido", issues: q.error.issues }, 400);
  const { ver, page, size } = q.data;
  try {
    const r = await pool.query(
      `SELECT k.ocid, k.ruc_empresa AS ruc, k.severidad, to_char(k.fecha, 'YYYY-MM-DD') AS fecha, k.monto::float AS monto,
              k.detalle, k.persona_rol AS "personaRol", k.fuente, k.fuente_url AS "fuenteUrl",
              cv.codigo, cv.objeto, btrim(cv.entidad_ruc::text) AS "entidadRuc", en.nombre AS entidad, e.razon_social AS empresa,
              r.veredicto, r.nota, r.revisado_por AS "revisadoPor", r.revisado_at AS "revisadoAt",
              (count(*) OVER ())::int AS total
         FROM cruces_proveedor k
         JOIN convocatorias cv ON cv.ocid = k.ocid
         LEFT JOIN entidades en ON en.ruc = cv.entidad_ruc
         LEFT JOIN empresas e ON e.ruc = k.ruc_empresa::bpchar
         LEFT JOIN senal_revision r ON r.tipo = k.tipo AND r.ocid = k.ocid AND r.ruc_empresa = k.ruc_empresa
        WHERE k.tipo = $1 AND (r.tipo IS ${ver === "pendientes" ? "" : "NOT "}NULL)
        ORDER BY ${ver === "pendientes" ? "md5(k.tipo || k.ocid || k.ruc_empresa)" : "r.revisado_at DESC"}
        LIMIT $2 OFFSET $3`,
      [tipo, size, (page - 1) * size]);
    return c.json({ tipo, etiqueta: ETIQUETA_CRUCE[tipo] ?? tipo, ver, page, size, total: r.rows[0]?.total ?? 0,
      data: r.rows.map(({ total: _t, ...x }) => x) });
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return sinMigracion(c);
    throw e;
  }
});

const Veredicto = z.object({
  ocid: z.string().min(1).max(80),
  ruc: z.string().regex(/^\d{11}$/),
  veredicto: z.enum(["acierta", "no_acierta", "dudoso"]),
  nota: z.string().trim().max(1000).optional(),
});

adminSenalesRouter.post("/senales-observacion/:tipo/veredicto", async (c) => {
  const tipo = c.req.param("tipo");
  if (!TIPO.test(tipo)) return c.json({ error: "tipo_invalido" }, 400);
  const b = Veredicto.safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return c.json({ error: "pedido_invalido", issues: b.error.issues }, 400);
  const quien = actor(c);
  try {
    const r = await pool.query(
      `INSERT INTO senal_revision (tipo, ocid, ruc_empresa, veredicto, nota, severidad, revisado_por)
       SELECT k.tipo, k.ocid, k.ruc_empresa, $4, NULLIF($5, ''), k.severidad, $6
         FROM cruces_proveedor k WHERE k.tipo = $1 AND k.ocid = $2 AND k.ruc_empresa = $3 LIMIT 1
       ON CONFLICT (tipo, ocid, ruc_empresa) DO UPDATE
         SET veredicto = EXCLUDED.veredicto, nota = EXCLUDED.nota, revisado_por = EXCLUDED.revisado_por, revisado_at = now()
       RETURNING veredicto`,
      [tipo, b.data.ocid, b.data.ruc, b.data.veredicto, b.data.nota ?? "", quien]);
    if (!r.rows.length) return c.json({ error: "not_found", detail: "Ese caso ya no está entre los del indicador." }, 404);
    await log(quien, "revisar_senal", `senal:${tipo}:${b.data.ocid}:${b.data.ruc}`, { veredicto: b.data.veredicto });
    return c.json({ ok: true, veredicto: r.rows[0].veredicto });
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return sinMigracion(c);
    throw e;
  }
});

/**
 * GET /admin/senales-validacion: la última validación externa (migración 401): cuánto encuentra el puntaje de lo que la
 * Contraloría observó, frente al monto y al azar, y por tipo de bandera observados / esperados con su intervalo.
 */
adminSenalesRouter.get("/senales-validacion", async (c) => {
  // La verdad contra la que se mide: lo que observó la Contraloría (401) o lo que el Tribunal declaró fundado o anuló (404).
  const etiqueta = c.req.query("etiqueta") === "tribunal" ? "tribunal" : "contraloria";
  try {
    return c.json(await leerValidacion(pool, etiqueta));
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return c.json({ error: "sin_migracion", detail: "Falta la migración 401 (validacion_*)." }, 503);
    throw e;
  }
});

adminSenalesRouter.post("/senales-observacion/:tipo/graduar", async (c) => {
  if (esRevisor(c)) return c.json({ error: "solo_admin", detail: "Graduar un indicador lo decide un administrador." }, 403);
  const tipo = c.req.param("tipo");
  if (!TIPO.test(tipo)) return c.json({ error: "tipo_invalido" }, 400);
  const n = await pool.query(
    `SELECT count(*) FILTER (WHERE veredicto = 'acierta')::int AS a, count(*) FILTER (WHERE veredicto = 'no_acierta')::int AS b
       FROM senal_revision WHERE tipo = $1`, [tipo]);
  const { a, b } = n.rows[0] as { a: number; b: number };
  if (a + b < MINIMO_REVISADOS) {
    return c.json({ error: "faltan_revisiones", detail: `Hay ${a + b} casos decididos; hacen falta ${MINIMO_REVISADOS}.` }, 409);
  }
  const r = await pool.query(`DELETE FROM senal_en_observacion WHERE tipo = $1 RETURNING tipo`, [tipo]);
  if (!r.rows.length) return c.json({ error: "no_esta_en_observacion" }, 404);
  await log(actor(c), "graduar_senal", `senal:${tipo}`, { aciertan: a, noAciertan: b, precision: a / (a + b) });
  return c.json({ ok: true, tipo, nota: "Puntúa desde el próximo refresco de los cruces (casos_cruce)." });
});

adminSenalesRouter.post("/senales-observacion/:tipo/observar", async (c) => {
  if (esRevisor(c)) return c.json({ error: "solo_admin" }, 403);
  const tipo = c.req.param("tipo");
  if (!TIPO.test(tipo)) return c.json({ error: "tipo_invalido" }, 400);
  await pool.query(
    `INSERT INTO senal_en_observacion (tipo, motivo) VALUES ($1, 'Devuelto a observación desde el panel.') ON CONFLICT (tipo) DO NOTHING`, [tipo]);
  await log(actor(c), "observar_senal", `senal:${tipo}`, {});
  return c.json({ ok: true, tipo });
});
