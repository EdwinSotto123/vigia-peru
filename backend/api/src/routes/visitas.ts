import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { datasetVisitas, VISITAS_EN_LINEA } from "../lib/fuentes.js";

/**
 * Las visitas que recibió una entidad (fase 2.3 del plan del 2026-10-27):
 *
 *   GET /visitas/entidad/:ruc   cuántas y desde cuándo; quiénes la visitan (cada organización, la empresa que es si se
 *                               reconoce y si después le ganó un contrato o le dio órdenes), a qué oficinas (cargo y área
 *                               de quien recibe, y si decide la compra), las de familiares declarados de sus funcionarios
 *                               (migración 188) y las 1,000 más recientes.
 *
 * Privacidad: nunca el documento de quien visita; su nombre con un apellido tapado (publicar), y ni eso si es el familiar
 * de un funcionario (no se lo identifica). De quien recibe, sólo su cargo y su área.
 */
export const visitasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown> | null>({ nombre: "visitas:entidad", ttlMs: 900_000, staleMs: 3_600_000, max: 300 });

/** Fuera del horario de oficina: antes de las 7, desde las 19 o en fin de semana. */
const FUERA_DE_HORA = `(v.hora_ingreso < TIME '07:00' OR v.hora_ingreso >= TIME '19:00' OR extract(isodow FROM v.fecha_visita) IN (6, 7))`;
const DECISOR = `visita_decisor(v.funcionario_cargo, v.funcionario_area)`;

async function tabla(nombre: string): Promise<boolean> {
  const r = await pool.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [nombre]).catch(() => null);
  return !!r?.rows[0]?.ok;
}

visitasRouter.get("/entidad/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const cuerpo = await memo.obtener(ruc, async () => {
    const [conParientes, conDecisor, pre] = await Promise.all([
      tabla("entidad_visita_pariente"),
      pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'visita_decisor'`).then((r) => r.rowCount! > 0).catch(() => false),
      // El resumen, las organizaciones y las oficinas precalculados (migración 188): en vivo, el GORE Loreto tardaba 12 s.
      tabla("entidad_visita_resumen"),
    ]);
    // La marca de quien decide ya va en la visita (migración 188); la de una visita recién cargada, en vivo.
    const decisor = pre ? `COALESCE(v.decisor, ${DECISOR})` : conDecisor ? DECISOR : "false";
    // Las visitas de la entidad por todos los nombres con que la registra el portal (migración 186).
    const V = `(SELECT v.* FROM visitas_entidades v WHERE v.entidad_visitada IN (SELECT entidad_visitada FROM visita_entidad_ruc WHERE ruc = $1))`;
    const [resumen, orgs, areas, parientes, lista] = await Promise.all([
      pre
        ? pool.query(
            `SELECT total, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta, privadas, publicas, personas,
                    visitantes, decisores, fuera_de_hora AS "fueraDeHora", largas, fuentes
               FROM entidad_visita_resumen WHERE entidad_ruc = $1`, [ruc])
        : pool.query(
        `SELECT count(*)::int AS total, to_char(min(v.fecha_visita), 'YYYY-MM-DD') AS desde, to_char(max(v.fecha_visita), 'YYYY-MM-DD') AS hasta,
                count(*) FILTER (WHERE v.tipo_entidad_visitante = 'privada')::int AS privadas,
                count(*) FILTER (WHERE v.tipo_entidad_visitante = 'publica')::int AS publicas,
                count(*) FILTER (WHERE v.tipo_entidad_visitante = 'persona_natural')::int AS personas,
                count(DISTINCT v.numero_documento)::int AS visitantes,
                count(*) FILTER (WHERE ${decisor})::int AS decisores,
                count(*) FILTER (WHERE ${FUERA_DE_HORA})::int AS "fueraDeHora",
                count(*) FILTER (WHERE v.duracion_min >= 240)::int AS largas,
                array_agg(DISTINCT v.fuente) AS fuentes
           FROM ${V} v`, [ruc]),
      // Quiénes la visitan: cada organización declarada, la empresa que es (por las visitas que ya se le atribuyen) y lo
      // primero que le dio la entidad después de su primera visita.
      pool.query(
        `WITH o AS (${pre
           ? `SELECT org, tipo, visitas, visitantes, primera, ultima, decisores, ruc FROM entidad_visita_org
               WHERE entidad_ruc = $1 ORDER BY visitas DESC LIMIT 300`
           : `
           SELECT upper(btrim(v.entidad_visitante)) AS org, max(v.tipo_entidad_visitante) AS tipo, count(*)::int AS visitas,
                  count(DISTINCT v.numero_documento)::int AS visitantes, min(v.fecha_visita) AS primera, max(v.fecha_visita) AS ultima,
                  count(*) FILTER (WHERE ${decisor})::int AS decisores,
                  mode() WITHIN GROUP (ORDER BY ev.ruc) AS ruc
             FROM ${V} v LEFT JOIN empresa_visita ev ON ev.visita_id = v.id
            WHERE v.entidad_visitante IS NOT NULL AND btrim(v.entidad_visitante) <> '' AND v.tipo_entidad_visitante <> 'persona_natural'
            GROUP BY 1 ORDER BY 3 DESC LIMIT 300`})
         SELECT o.org, o.tipo, o.visitas, o.visitantes, to_char(o.primera, 'YYYY-MM-DD') AS primera, to_char(o.ultima, 'YYYY-MM-DD') AS ultima,
                o.decisores, o.ruc, r.nombre AS empresa,
                to_char(LEAST(ad.f, od.f), 'YYYY-MM-DD') AS "despues",
                CASE WHEN ad.f IS NOT NULL AND (od.f IS NULL OR ad.f <= od.f) THEN 'contrato' WHEN od.f IS NOT NULL THEN 'orden' END AS "despuesTipo",
                (COALESCE(ad.monto, 0) + COALESCE(od.monto, 0))::float AS "montoDespues"
           FROM o
           LEFT JOIN empresa_resumen r ON r.ruc = o.ruc
           LEFT JOIN LATERAL (SELECT min(a.fecha_buenapro) AS f, sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
                                FROM conosce_adjudicaciones a
                               WHERE o.ruc IS NOT NULL AND a.ruc_proveedor = o.ruc AND a.entidad_ruc = $1 AND a.fecha_buenapro >= o.primera) ad ON true
           LEFT JOIN LATERAL (SELECT min(x.fecha_emision) AS f, sum(x.monto) FILTER (WHERE x.monto_dudoso IS NULL) AS monto
                                FROM conosce_ordenes x
                               WHERE o.ruc IS NOT NULL AND x.entidad_ruc = $1 AND x.ruc_contratista = o.ruc AND x.fecha_emision >= o.primera
                                 AND x.estado IS DISTINCT FROM 'Anulada') od ON true
          ORDER BY o.visitas DESC`, [ruc]),
      // A qué oficinas: el área y el cargo de quien recibe (nunca su nombre).
      pre
        ? pool.query(
            `SELECT area, NULLIF(cargo, '') AS cargo, visitas, privadas, decisor FROM entidad_visita_area
              WHERE entidad_ruc = $1 ORDER BY visitas DESC LIMIT 60`, [ruc])
        : pool.query(
        `SELECT COALESCE(NULLIF(btrim(v.funcionario_area), ''), 'Sin área en el registro') AS area, v.funcionario_cargo AS cargo,
                count(*)::int AS visitas, count(*) FILTER (WHERE v.tipo_entidad_visitante = 'privada')::int AS privadas,
                bool_or(${decisor}) AS decisor
           FROM ${V} v GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 60`, [ruc]),
      conParientes
        ? pool.query(
            `SELECT to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.parentesco, p.cargo, p.area, p.decisor, p.proveedor
               FROM entidad_visita_pariente p WHERE p.entidad_ruc = $1 ORDER BY p.fecha DESC LIMIT 500`, [ruc])
        : Promise.resolve({ rows: [] }),
      pool.query(
        `SELECT v.id, to_char(v.fecha_visita, 'YYYY-MM-DD') AS fecha, to_char(v.hora_ingreso, 'HH24:MI') AS hora, v.duracion_min AS duracion,
                v.visitante, v.tipo_entidad_visitante AS tipo, v.entidad_visitante AS organizacion,
                v.funcionario_cargo AS cargo, v.funcionario_area AS area, left(v.motivo, 160) AS motivo, v.fuente,
                ${decisor} AS decisor, ${FUERA_DE_HORA} AS "fueraDeHora",
                ${conParientes ? `EXISTS (SELECT 1 FROM entidad_visita_pariente p WHERE p.entidad_ruc = $1 AND p.visita_id = v.id)` : "false"} AS pariente,
                (SELECT ev.ruc FROM empresa_visita ev WHERE ev.visita_id = v.id LIMIT 1) AS ruc
           -- Las 1,000 más recientes de cada nombre de la entidad (el índice entidad_visitada + fecha las da en orden, sin
           -- leer las demás) y de ellas, las 1,000 más recientes. Con «IN (nombres)» la base leía TODAS las visitas de la
           -- entidad para ordenarlas: el Congreso (1,2 M) o el MIMP (357 mil) pasaban los 10 s y la API daba 500.
           FROM visita_entidad_ruc m
           CROSS JOIN LATERAL (
             SELECT x.* FROM visitas_entidades x
              WHERE x.entidad_visitada = m.entidad_visitada AND x.fecha_visita IS NOT NULL
              ORDER BY x.fecha_visita DESC, x.id DESC LIMIT 1000) v
          WHERE m.ruc = $1
          ORDER BY v.fecha_visita DESC, v.id DESC LIMIT 1000`, [ruc]),
    ]);
    const r = resumen.rows[0];
    if (!r || !r.total) return { total: 0, hasta: null };
    // La empresa de cada visita, con su nombre (una consulta para todas).
    const rucs = [...new Set(lista.rows.map((x) => x.ruc).filter(Boolean))];
    const nombres = rucs.length
      ? new Map((await pool.query<{ ruc: string; nombre: string }>(`SELECT ruc, nombre FROM empresa_resumen WHERE ruc = ANY($1)`, [rucs])).rows.map((x) => [x.ruc, x.nombre]))
      : new Map<string, string>();
    const fuentes: string[] = r.fuentes ?? [];
    return publicar({
      total: r.total,
      desde: r.desde,
      hasta: r.hasta,
      resumen: {
        privadas: r.privadas, publicas: r.publicas, personas: r.personas, visitantes: r.visitantes, decisores: r.decisores,
        fueraDeHora: r.fueraDeHora, largas: r.largas, parientes: parientes.rows.length,
      },
      organizaciones: orgs.rows.map((o) => ({ ...o, ruc: o.ruc && /^20\d{9}$/.test(o.ruc) ? o.ruc : null, empresa: o.ruc && /^20\d{9}$/.test(o.ruc) ? o.empresa : null })),
      areas: areas.rows,
      parientes: parientes.rows,
      // Bajo `visitas`: publicar() le tapa un apellido a quien visita. El familiar de un funcionario va sin nombre.
      visitas: lista.rows.map(({ id, ruc: rucEmpresa, ...v }) => ({
        ...v,
        visitante: v.pariente ? null : v.visitante,
        empresa: rucEmpresa && /^20\d{9}$/.test(rucEmpresa) ? { ruc: rucEmpresa, nombre: nombres.get(rucEmpresa) ?? null } : null,
        enlace: v.fuente === "congreso_visitas" ? "https://wb2server.congreso.gob.pe/regvisitastransparencia/" : datasetVisitas(v.fecha),
        clave: String(id),
      })),
      fuentes: [
        fuentes.includes("congreso_visitas") && { texto: "Registro de visitas del Congreso de la República", href: "https://wb2server.congreso.gob.pe/regvisitastransparencia/" },
        { texto: "Registro de Visitas en Línea (PCM)", href: VISITAS_EN_LINEA },
      ].filter(Boolean),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
