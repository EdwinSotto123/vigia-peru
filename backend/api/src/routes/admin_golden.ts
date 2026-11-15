/**
 * Trazabilidad de las pruebas de oro y del RAG normativo para el panel (migraciones 284 y 285).
 *
 *   GET /admin/golden                        los conjuntos, con su última corrida y la serie de F1 por imagen
 *   GET /admin/golden/corridas?conjunto=     las corridas de un conjunto (más reciente primero)
 *   GET /admin/golden/corridas/:id           una corrida: resumen, por regla y cada contrato con lo esperado y lo emitido
 *   GET /admin/golden/casos?conjunto=        los casos de un conjunto con lo esperado
 *   GET /admin/normas                        el corpus normativo: documentos y fragmentos por tipo y régimen
 *   GET /admin/normas/buscar?q=&fecha=       lo que el agente legal recibiría para esa pregunta y esa fecha de convocatoria
 *
 * Todo es de sólo lectura. Las corridas las sube backend/scripts/golden_subir.py.
 */
import { Hono } from "hono";
import { esErrorPg, poolAdmin as pool } from "../lib/db.js";
import { embeber, type IaWorkers } from "../lib/rag.js";

export const adminGoldenRouter = new Hono();

const sinMigracion = (c: { json: (b: unknown, s: number) => Response }) =>
  c.json({ error: "sin_migracion", detail: "Faltan las migraciones 284 o 285 (norma, golden_*)." }, 503);

adminGoldenRouter.get("/golden", async (c) => {
  try {
    const [conjuntos, corridas] = await Promise.all([
      pool.query(`SELECT clave, nombre, descripcion, que_mide AS "queMide", casos, to_char(actualizado_at, 'YYYY-MM-DD') AS actualizado
                    FROM golden_conjunto ORDER BY CASE que_mide WHEN 'banderas' THEN 0 WHEN 'citas_legales' THEN 1 ELSE 2 END, clave`),
      pool.query(`SELECT id, conjunto, corrida, variante, imagen, to_char(ejecutada_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS ejecutada,
                         contratos, errores, precision_pct::float AS precision, exhaustividad_pct::float AS exhaustividad, f1::float AS f1,
                         usd_medio::float AS "usdMedio", segundos_medio::float AS "segundosMedio", metricas, nota
                    FROM golden_corrida ORDER BY ejecutada_at DESC LIMIT 400`),
    ]);
    return c.json({
      conjuntos: conjuntos.rows.map((k) => {
        const suyas = corridas.rows.filter((x) => x.conjunto === k.clave);
        return { ...k, corridas: suyas.length, ultima: suyas[0] ?? null, serie: suyas.slice(0, 12).reverse() };
      }),
    });
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return sinMigracion(c);
    throw e;
  }
});

adminGoldenRouter.get("/golden/corridas", async (c) => {
  const conjunto = c.req.query("conjunto") ?? "";
  try {
    const r = await pool.query(
      `SELECT id, conjunto, corrida, variante, imagen, to_char(ejecutada_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS ejecutada,
              contratos, errores, precision_pct::float AS precision, exhaustividad_pct::float AS exhaustividad, f1::float AS f1,
              usd_medio::float AS "usdMedio", segundos_medio::float AS "segundosMedio", por_regla AS "porRegla", metricas, nota
         FROM golden_corrida WHERE ($1 = '' OR conjunto = $1) ORDER BY ejecutada_at DESC LIMIT 200`, [conjunto]);
    return c.json({ data: r.rows });
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return sinMigracion(c);
    throw e;
  }
});

adminGoldenRouter.get("/golden/corridas/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "not_found" }, 404);
  try {
    const k = await pool.query(
      `SELECT g.id, g.conjunto, j.nombre AS "conjuntoNombre", j.que_mide AS "queMide", g.corrida, g.variante, g.imagen,
              to_char(g.ejecutada_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS ejecutada, g.contratos, g.errores,
              g.precision_pct::float AS precision, g.exhaustividad_pct::float AS exhaustividad, g.f1::float AS f1,
              g.usd_medio::float AS "usdMedio", g.segundos_medio::float AS "segundosMedio", g.por_regla AS "porRegla", g.metricas, g.nota
         FROM golden_corrida g JOIN golden_conjunto j ON j.clave = g.conjunto WHERE g.id = $1`, [id]);
    if (!k.rows[0]) return c.json({ error: "not_found" }, 404);
    const r = await pool.query(
      `SELECT r.caso, r.estado, r.aciertos, r.falsas_alarmas AS "falsasAlarmas", r.omisiones, r.segundos::float AS segundos, r.usd::float AS usd,
              r.detalle, k.titulo, k.perfil, to_char(k.fecha, 'YYYY-MM-DD') AS fecha, k.regimen, k.esperado
         FROM golden_resultado r LEFT JOIN golden_caso k ON k.conjunto = $2 AND k.caso = r.caso
        WHERE r.corrida_id = $1
        ORDER BY (cardinality(r.falsas_alarmas) + cardinality(r.omisiones)) DESC, r.caso`, [id, k.rows[0].conjunto]);
    // La corrida anterior del mismo conjunto, para ver qué cambió.
    const ant = await pool.query(
      `SELECT id, imagen, f1::float AS f1, precision_pct::float AS precision, exhaustividad_pct::float AS exhaustividad,
              to_char(ejecutada_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS ejecutada
         FROM golden_corrida WHERE conjunto = $1 AND ejecutada_at < (SELECT ejecutada_at FROM golden_corrida WHERE id = $2)
          AND ($1 <> 'legal' OR variante = $3)      -- el analista legal se compara dentro de la misma red
        ORDER BY ejecutada_at DESC LIMIT 1`, [k.rows[0].conjunto, id, k.rows[0].variante]);
    return c.json({ corrida: k.rows[0], anterior: ant.rows[0] ?? null, resultados: r.rows });
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return sinMigracion(c);
    throw e;
  }
});

adminGoldenRouter.get("/golden/casos", async (c) => {
  const conjunto = c.req.query("conjunto") ?? "";
  try {
    const r = await pool.query(
      `SELECT conjunto, caso, titulo, perfil, to_char(fecha, 'YYYY-MM-DD') AS fecha, regimen, esperado, nota
         FROM golden_caso WHERE conjunto = $1 ORDER BY caso LIMIT 500`, [conjunto]);
    return c.json({ data: r.rows });
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return sinMigracion(c);
    throw e;
  }
});

adminGoldenRouter.get("/normas", async (c) => {
  try {
    const [porTipo, docs] = await Promise.all([
      pool.query(`SELECT n.tipo, n.regimen, n.jerarquia, count(DISTINCT n.slug)::int AS documentos, count(f.id)::int AS fragmentos,
                         count(f.embedding)::int AS "conVector", count(f.articulo)::int AS "conArticulo",
                         to_char(min(COALESCE(n.fecha_emision, n.vigencia_desde)), 'YYYY-MM-DD') AS desde,
                         to_char(max(COALESCE(n.fecha_emision, n.vigencia_desde)), 'YYYY-MM-DD') AS hasta
                    FROM norma n LEFT JOIN norma_fragmento f ON f.slug = n.slug GROUP BY 1, 2, 3 ORDER BY 3, 2`),
      pool.query(`SELECT n.slug, n.documento, n.numero, n.tipo, n.regimen, to_char(n.fecha_emision, 'YYYY-MM-DD') AS "fechaEmision",
                         to_char(n.vigencia_desde, 'YYYY-MM-DD') AS "vigenciaDesde", to_char(n.vigencia_hasta, 'YYYY-MM-DD') AS "vigenciaHasta",
                         n.url_oficial AS "urlOficial", (SELECT count(*)::int FROM norma_fragmento f WHERE f.slug = n.slug) AS fragmentos
                    FROM norma n WHERE n.tipo NOT IN ('opinion') ORDER BY n.jerarquia, n.regimen DESC, n.documento LIMIT 200`),
    ]);
    return c.json({ porTipo: porTipo.rows, documentos: docs.rows });
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return sinMigracion(c);
    throw e;
  }
});

adminGoldenRouter.get("/normas/buscar", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 400);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("fecha") ?? "") ? c.req.query("fecha")! : new Date().toISOString().slice(0, 10);
  if (q.length < 3) return c.json({ error: "invalid_query", detail: "Escribe una pregunta." }, 400);
  try {
    const ia = (c.env as { AI?: IaWorkers } | undefined)?.AI;
    let vector: string | null = null;
    if (ia) {
      try {
        vector = `[${(await embeber(ia, [q], 15_000))[0].join(",")}]`;
      } catch {
        vector = null;       // sin vector se busca sólo por palabras, y se dice
      }
    }
    const r = await pool.query(
      `SELECT slug, documento, numero, tipo, regimen, aplica, to_char(fecha_emision, 'YYYY-MM-DD') AS "fechaEmision", articulo, epigrafe,
              left(texto, 700) AS texto, url_oficial AS "urlOficial", rango_palabras AS "rangoPalabras", rango_vector AS "rangoVector",
              round(puntaje::numeric, 5)::float AS puntaje
         FROM buscar_norma($1, $2::halfvec, $3::date, 24, NULL)`, [q, vector, fecha]);
    return c.json({ pregunta: q, fecha, regimen: fecha >= "2025-04-22" ? "32069" : "30225", busqueda: vector ? "hibrida" : "solo_palabras", data: r.rows });
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return sinMigracion(c);
    throw e;
  }
});
