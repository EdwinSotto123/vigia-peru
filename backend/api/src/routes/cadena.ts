/**
 * Capa C — la cadena de captura de una entidad: combina la Capa A (quién la gobierna y qué empresas ligadas al partido
 * ganan sus contratos) con la Capa B (quién aprueba/decide esos contratos, del grafo del Estado). Cierra el círculo:
 *   [empresas] —(financió / es socio / vendió a la campaña)→ [partido + su autoridad] —(gobierna)→ [la entidad]
 *     —(aprueba y decide sus contratos)→ [la AGA / los funcionarios]  ↩ y esas empresas ganan esos contratos.
 *
 * Son INDICIOS de registros públicos para revisión humana, NUNCA una acusación. No existe "quién firmó un contrato
 * puntual" (el grafo del Estado es estructural): el nodo de decisión es la AGA (órgano que aprueba, Ley 32069) y los
 * altos funcionarios que la ocupan hoy, cuando el grafo los tiene (sobre todo nacionales; en distritos suele ser solo
 * la AGA por nivel + la autoridad electa).
 *
 *   GET /cadena/entidad/:ruc
 */
import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { publicar } from "../lib/privacidad.js";
import { cachePublico } from "../lib/http.js";

export const cadenaRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 600 });

/** La autoridad que aprueba los contratos según el nivel de gobierno del grafo (Ley 32069, art. 25.1.b). */
const AGA: Record<string, string> = {
  GL: "Gerencia Municipal",
  GR: "Gerencia General Regional",
  GN: "Secretaría General",
};

cadenaRouter.get("/entidad/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "not_found" }, 404);

  const [pe, emp, ge] = await Promise.all([
    pool.query<{ entidad: string; partido: string | null; autoridad: string | null; cargo_gob: string | null; nivel: string | null; n_captura: number; n_financiaron: number; n_vendieron: number; n_socio: number }>(
      `SELECT entidad, partido, autoridad, cargo_gob, nivel,
              n_captura::int, n_financiaron::int, n_vendieron::int, n_socio::int
         FROM poder_entidad WHERE entidad_ruc = $1`, [ruc]),
    pool.query<{ ruc: string; nombre: string | null; lazos: string[]; contratos: number; monto: number }>(
      `SELECT cp.ruc_empresa AS ruc, max(e.razon_social) AS nombre,
              array_agg(DISTINCT cp.tipo) AS lazos,
              count(DISTINCT cp.ocid)::int AS contratos,
              COALESCE(sum(cp.monto), 0)::float AS monto
         FROM cruces_proveedor cp
         JOIN convocatorias c ON c.ocid = cp.ocid AND c.entidad_ruc = $1
         LEFT JOIN empresas e ON e.ruc = cp.ruc_empresa
        WHERE cp.tipo IN ('partido_gobernante', 'vendio_gobernante', 'socio_en_entidad')
          AND cp.ruc_empresa ~ '^20[0-9]{9}$'
        GROUP BY cp.ruc_empresa
        ORDER BY count(DISTINCT cp.ocid) DESC, 5 DESC LIMIT 8`, [ruc]),
    pool.query<{ nodo_id: string; nivel_gobierno: string | null }>(
      `SELECT nodo_id, nivel_gobierno FROM grafo_entidad WHERE ruc = $1 LIMIT 1`, [ruc]),
  ]);

  const p = pe.rows[0];
  if (!p && emp.rows.length === 0) {
    c.header("Cache-Control", CACHE);
    return c.json({ disponible: false });
  }

  // Funcionarios del grafo del Estado (si los tiene; en distritos suele venir vacío → solo la AGA por nivel).
  let funcionarios: { persona: string; cargo: string; organo: string }[] = [];
  const nivelG = ge.rows[0]?.nivel_gobierno ?? null;
  if (ge.rows[0]) {
    const f = await pool.query<{ persona: string; cargo: string; organo: string }>(
      `SELECT DISTINCT pr.nombre AS persona, cg.nombre AS cargo, og.nombre AS organo
         FROM grafo_aristas od
         JOIN grafo_nodos og ON og.id = od.origen AND og.tipo = 'ORGANO'
         JOIN grafo_aristas cen ON cen.destino = og.id AND cen.tipo = 'CARGO_EN'
         JOIN grafo_nodos cg ON cg.id = cen.origen AND cg.tipo = 'CARGO'
         JOIN grafo_aristas oc ON oc.destino = cg.id AND oc.tipo = 'OCUPA_CARGO'
         JOIN grafo_nodos pr ON pr.id = oc.origen AND pr.tipo = 'PERSONA'
        WHERE od.destino = $1 AND od.tipo = 'ORGANO_DE'
        ORDER BY og.nombre, cg.nombre LIMIT 8`, [ge.rows[0].nodo_id]);
    funcionarios = f.rows;
  }
  const apruebaContratos = nivelG
    ? (AGA[nivelG] ?? "Autoridad de la gestión administrativa")
    : p?.nivel === "regional" ? "Gerencia General Regional" : "Gerencia Municipal";

  c.header("Cache-Control", CACHE);
  // La parte "política/plata" pasa por publicar() (privacidad); la decisión son figuras públicas (como estructura.ts),
  // va tal cual.
  const base = publicar({
    entidad: { ruc, nombre: p?.entidad ?? null },
    partido: p?.partido ?? null,
    autoridad: p?.autoridad ?? null,
    cargo: p?.cargo_gob ?? null,
    nivel: p?.nivel ?? null,
    captura: p ? { n_captura: p.n_captura, n_financiaron: p.n_financiaron, n_vendieron: p.n_vendieron, n_socio: p.n_socio } : null,
    empresas: emp.rows,
  }) as Record<string, unknown>;
  return c.json({ disponible: true, ...base, decision: { apruebaContratos, funcionarios, delGrafo: !!ge.rows[0] } });
});
