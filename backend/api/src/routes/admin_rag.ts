/**
 * RAG de documentos (migración 258, lib/rag.ts): indexar desde el panel o desde un script.
 *
 *   POST /admin/rag/indexar?segundos=80&embeddings=4000&fuentes=200&lineas=auto|si|no
 *     Trocea lo nuevo o cambiado (dictámenes publicados, lecturas de IA, informes de control y textos de documentos),
 *     borra lo que ya no corresponde y calcula embeddings con Workers AI hasta el tope de tiempo (10 a 110 s; el troceo
 *     usa hasta el 40 %). Devuelve lo que hizo y lo que falta: { borradas, troceadas, fragmentosNuevos,
 *     embeddings: { calculados, reusados, pedidos, error }, pendientes: { fuentes, fragmentos }, lineas, segundos }.
 *     Llamadas en paralelo no se pisan (backend/scripts/rag_indexar.py llama varias a la vez para el llenado inicial).
 *   GET  /admin/rag/estado   cuántos fragmentos hay por origen y cuántos faltan embeber.
 *
 * El cron de 10 min (POST /admin/asignar, routes/admin.ts) llama a indexarRag con un tope chico.
 */
import { Hono } from "hono";
import { esErrorPg, poolAdmin as pool } from "../lib/db.js";
import { indexarRag, type IaWorkers } from "../lib/rag.js";

export const adminRagRouter = new Hono();

const entero = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};

/** El binding de Workers AI del pedido (sin él, sólo se trocea). */
export const iaDe = (env: unknown) => (env as { AI?: IaWorkers } | undefined)?.AI;

adminRagRouter.post("/rag/indexar", async (c) => {
  const lineas = c.req.query("lineas");
  try {
    const r = await indexarRag(iaDe(c.env), {
      segundos: entero(c.req.query("segundos"), 80, 10, 110),
      embeddings: entero(c.req.query("embeddings"), 4000, 0, 20000),
      fuentes: entero(c.req.query("fuentes"), 200, 0, 2000),
      lineas: lineas === "si" || lineas === "no" ? lineas : "auto",
    });
    return c.json(r);
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return c.json({ error: "sin_migracion", detail: "Falta la migración 258 (rag_fragmento)." }, 503);
    throw e;
  }
});

adminRagRouter.get("/rag/estado", async (c) => {
  try {
    const r = await pool.query(
      `SELECT origen, tipo, count(*)::int AS fragmentos, count(embedding)::int AS con_embedding,
              round(avg(length(texto)))::int AS largo_medio, max(indexado_at) AS ultimo
         FROM rag_fragmento GROUP BY 1, 2 ORDER BY 1, 2`);
    const o = await pool.query(`SELECT origen, count(*)::int AS fuentes, sum(fragmentos)::int AS fragmentos FROM rag_origen GROUP BY 1 ORDER BY 1`);
    const e = await pool.query(`SELECT lineas_at, lineas, lineas_segundos FROM rag_estado WHERE id`);
    return c.json({ porTipo: r.rows, fuentes: o.rows, lineasComunes: e.rows[0] ?? null });
  } catch (err) {
    if (esErrorPg(err, "42P01")) return c.json({ error: "sin_migracion", detail: "Falta la migración 258 (rag_fragmento)." }, 503);
    throw err;
  }
});
