/**
 * Estructura de decisión de una entidad, del grafo del Estado (migración 126, dataset/CLAUDE-GENERADO, corte 2026):
 * quién APRUEBA sus contratos (la AGA, según la estructura legal) y qué altos funcionarios la ocupan hoy. Sirve para
 * acercar la responsabilidad: no solo "la entidad contrató", sino quién decide y firma.
 *
 * Son datos INSTITUCIONALES de funcionarios PÚBLICOS (ministros, secretarios generales…): sin DNI y figuras públicas,
 * así que no pasa por publicar() (no hay persona privada que tapar).
 */
import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { cachePublico } from "../lib/http.js";

export const estructuraRouter = new Hono();

/** La autoridad que aprueba los contratos según el nivel de gobierno (Ley 32069, art. 25.1.b). */
const APRUEBA: Record<string, string> = {
  GL: "Gerencia Municipal",
  GR: "Gerencia General Regional",
  GN: "Secretaría General",
};

estructuraRouter.get("/entidad/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);

  const ent = await pool.query<{ nodo_id: string; nivel_gobierno: string | null }>(
    `SELECT nodo_id, nivel_gobierno FROM grafo_entidad WHERE ruc = $1 LIMIT 1`, [ruc]);
  if (!ent.rows.length) {
    c.header("Cache-Control", cachePublico(3600, { maxAge: 300, swr: 86400 }));
    return c.json({ disponible: false });
  }
  const nodo = ent.rows[0].nodo_id;
  const nivel = ent.rows[0].nivel_gobierno ?? "";

  const [estructura, funcionarios, organos] = await Promise.all([
    pool.query<{ nombre: string }>(
      `SELECT et.nombre FROM grafo_aristas a
         JOIN grafo_nodos et ON et.id = a.destino AND et.tipo = 'ESTRUCTURA_TIPO'
        WHERE a.origen = $1 AND a.tipo = 'APLICA_ESTRUCTURA_TIPO' LIMIT 1`, [nodo]),
    // Persona → cargo → órgano → entidad (los altos funcionarios que hoy ocupan cargos de esta entidad).
    pool.query<{ persona: string; cargo: string; organo: string }>(
      `SELECT DISTINCT p.nombre AS persona, cg.nombre AS cargo, og.nombre AS organo
         FROM grafo_aristas od
         JOIN grafo_nodos og ON og.id = od.origen AND og.tipo = 'ORGANO'
         JOIN grafo_aristas cen ON cen.destino = og.id AND cen.tipo = 'CARGO_EN'
         JOIN grafo_nodos cg ON cg.id = cen.origen AND cg.tipo = 'CARGO'
         JOIN grafo_aristas oc ON oc.destino = cg.id AND oc.tipo = 'OCUPA_CARGO'
         JOIN grafo_nodos p ON p.id = oc.origen AND p.tipo = 'PERSONA'
        WHERE od.destino = $1 AND od.tipo = 'ORGANO_DE'
        ORDER BY og.nombre, cg.nombre`, [nodo]),
    pool.query<{ nombre: string }>(
      `SELECT og.nombre FROM grafo_aristas od
         JOIN grafo_nodos og ON og.id = od.origen AND og.tipo = 'ORGANO'
        WHERE od.destino = $1 AND od.tipo = 'ORGANO_DE' ORDER BY og.nombre`, [nodo]),
  ]);

  c.header("Cache-Control", cachePublico(3600, { maxAge: 300, swr: 86400 }));
  return c.json({
    disponible: true,
    apruebaContratos: APRUEBA[nivel] ?? "Autoridad de la gestión administrativa",
    estructuraLegal: estructura.rows[0]?.nombre ?? null,
    funcionarios: funcionarios.rows,
    organos: organos.rows.map((r) => r.nombre),
    corte: "2026",
  });
});
