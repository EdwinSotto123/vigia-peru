import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { datasetVisitas, VISITAS_CONGRESO, VISITAS_EN_LINEA } from "../lib/fuentes.js";

/**
 * Las visitas que recibió una entidad (fase 2.3 del plan del 2026-10-27):
 *
 *   GET /visitas/entidad/:ruc   cuántas y desde cuándo; quiénes la visitan (cada organización, la empresa que es si se
 *                               reconoce y si después le ganó un contrato o le dio órdenes), las empresas cuya gente la
 *                               visitó (por su socio, representante o directivo, aunque no la declarara) y lo que ganaron
 *                               después (migración 203), a qué oficinas (cargo y área de quien recibe, y si decide la
 *                               compra), las de familiares declarados de sus funcionarios (migración 188) y las 1,000 más
 *                               recientes.
 *
 * Privacidad: nunca el documento de quien visita; su nombre con un apellido tapado (publicar), y ni eso si es el familiar
 * de un funcionario (no se lo identifica). De quien recibe, sólo su cargo y su área.
 */
export const visitasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
/** Cuántas filas de cada lista van en la respuesta: el resto se busca en el servidor (GET /entidad/:ruc/buscar). */
const TOPE_ORGS = 1000;
const TOPE_AREAS = 300;
const TOPE_PARIENTES = 1000;
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
    const [conParientes, conDecisor, pre, conEmpresas] = await Promise.all([
      tabla("entidad_visita_pariente"),
      pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'visita_decisor'`).then((r) => r.rowCount! > 0).catch(() => false),
      // El resumen, las organizaciones y las oficinas precalculados (migración 188): en vivo, el GORE Loreto tardaba 12 s.
      tabla("entidad_visita_resumen"),
      tabla("entidad_visita_empresa"),
    ]);
    // La marca de quien decide ya va en la visita (migración 188); la de una visita recién cargada, en vivo.
    const decisor = pre ? `COALESCE(v.decisor, ${DECISOR})` : conDecisor ? DECISOR : "false";
    // Las visitas de la entidad por todos los nombres con que la registra el portal (migración 186).
    const V = `(SELECT v.* FROM visitas_entidades v WHERE v.entidad_visitada IN (SELECT entidad_visitada FROM visita_entidad_ruc WHERE ruc = $1))`;
    let despuesSinCalcular = false;
    const [resumen, orgs, areas, parientes, lista, empresas, totales] = await Promise.all([
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
      // primero que le dio la entidad después de la primera visita de su gente, con CUÁL fue: precalculado en
      // entidad_visita_empresa (migraciones 203 y 204). En vivo (sin esa tabla) tardaba hasta 90 s en EsSalud.
      conEmpresas && pre
        ? pool.query(
            `SELECT o.org, o.tipo, o.visitas, o.visitantes, to_char(o.primera, 'YYYY-MM-DD') AS primera, to_char(o.ultima, 'YYYY-MM-DD') AS ultima,
                    o.decisores, o.ruc, r.nombre AS empresa,
                    to_char(e.despues, 'YYYY-MM-DD') AS "despues", e.despues_tipo AS "despuesTipo", e.monto::float AS "montoDespues",
                    e.despues_numero AS "despuesNumero", e.despues_monto::float AS "despuesMonto"
               FROM (SELECT * FROM entidad_visita_org WHERE entidad_ruc = $1 ORDER BY visitas DESC LIMIT ${TOPE_ORGS}) o
               LEFT JOIN empresa_resumen r ON r.ruc = o.ruc
               LEFT JOIN entidad_visita_empresa e ON e.entidad_ruc = $1 AND e.ruc = o.ruc
              ORDER BY o.visitas DESC`, [ruc]).catch(() => {
            // Sin las columnas de la 204 (una base sin migrar): las organizaciones van sin «después».
            despuesSinCalcular = true;
            return pool.query(
              `SELECT o.org, o.tipo, o.visitas, o.visitantes, to_char(o.primera, 'YYYY-MM-DD') AS primera, to_char(o.ultima, 'YYYY-MM-DD') AS ultima,
                      o.decisores, o.ruc, r.nombre AS empresa, NULL::text AS "despues", NULL::text AS "despuesTipo", NULL::float AS "montoDespues"
                 FROM entidad_visita_org o LEFT JOIN empresa_resumen r ON r.ruc = o.ruc
                WHERE o.entidad_ruc = $1 ORDER BY o.visitas DESC LIMIT ${TOPE_ORGS}`, [ruc]);
          })
        : pool.query(
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
          ORDER BY o.visitas DESC`, [ruc]).catch((e: { code?: string }) => {
        // Si «lo que le dio después» no alcanza el plazo (EsSalud: miles de órdenes por proveedor), las organizaciones
        // salen igual, sin esa columna, y la respuesta lo dice: antes la pestaña entera daba 500.
        if (e?.code !== "57014" || !pre) throw e;
        despuesSinCalcular = true;
        return pool.query(
          `SELECT o.org, o.tipo, o.visitas, o.visitantes, to_char(o.primera, 'YYYY-MM-DD') AS primera, to_char(o.ultima, 'YYYY-MM-DD') AS ultima,
                  o.decisores, o.ruc, r.nombre AS empresa, NULL::text AS "despues", NULL::text AS "despuesTipo", NULL::float AS "montoDespues"
             FROM entidad_visita_org o LEFT JOIN empresa_resumen r ON r.ruc = o.ruc
            WHERE o.entidad_ruc = $1 ORDER BY o.visitas DESC LIMIT 300`, [ruc]);
      }),
      // A qué oficinas: el área y el cargo de quien recibe (nunca su nombre).
      pre
        ? pool.query(
            `SELECT area, NULLIF(cargo, '') AS cargo, visitas, privadas, decisor FROM entidad_visita_area
              WHERE entidad_ruc = $1 ORDER BY visitas DESC LIMIT ${TOPE_AREAS}`, [ruc])
        : pool.query(
        `SELECT COALESCE(NULLIF(btrim(v.funcionario_area), ''), 'Sin área en el registro') AS area, v.funcionario_cargo AS cargo,
                count(*)::int AS visitas, count(*) FILTER (WHERE v.tipo_entidad_visitante = 'privada')::int AS privadas,
                bool_or(${decisor}) AS decisor
           FROM ${V} v GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 60`, [ruc]),
      conParientes
        ? pool.query(
            `SELECT to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.parentesco, p.cargo, p.area, p.decisor, p.proveedor
               FROM entidad_visita_pariente p WHERE p.entidad_ruc = $1 ORDER BY p.fecha DESC LIMIT ${TOPE_PARIENTES}`, [ruc])
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
      // Las empresas cuya gente la visitó (migración 203) y, de ellas, las que recibieron algo desde la primera visita: en
      // PROD a lo más 930 por entidad. Sin nombres ni documentos de quienes visitan.
      conEmpresas
        ? Promise.all([
            pool.query(
              `SELECT count(*)::int AS empresas, count(*) FILTER (WHERE declaradas = 0)::int AS "soloSuGente",
                      count(*) FILTER (WHERE despues IS NOT NULL)::int AS ganaron,
                      count(*) FILTER (WHERE despues IS NOT NULL AND declaradas = 0)::int AS "ganaronSoloSuGente",
                      count(*) FILTER (WHERE despues IS NOT NULL AND antes = 0)::int AS "primeraVez"
                 FROM entidad_visita_empresa WHERE entidad_ruc = $1`, [ruc]),
            pool.query(
              `SELECT e.ruc, r.nombre AS empresa, e.visitas, e.visitantes, e.decisores, e.socio, e.representante, e.directivo,
                      e.nombre AS "porNombre", e.declaradas, e.personal, e.compartidas, e.otra_org AS "otraOrg",
                      to_char(e.primera, 'YYYY-MM-DD') AS primera, to_char(e.ultima, 'YYYY-MM-DD') AS ultima, e.antes,
                      to_char(e.despues, 'YYYY-MM-DD') AS despues, e.despues_tipo AS "despuesTipo", e.dias,
                      e.contratos, e.consorcios, e.ordenes, e.monto::float AS monto,
                      e.despues_numero AS "despuesNumero", e.despues_detalle AS "despuesDetalle", e.despues_monto::float AS "despuesMonto",
                      e.despues_codigo AS "despuesCodigo", e.despues_orden AS "despuesOrden", e.despues_ocid AS "despuesOcid"
                 FROM entidad_visita_empresa e LEFT JOIN empresa_resumen r ON r.ruc = e.ruc
                WHERE e.entidad_ruc = $1 AND e.despues IS NOT NULL
                -- Primero las que nunca le habían vendido (como la web por defecto), luego por lo que ganaron.
                ORDER BY (e.antes = 0) DESC, e.monto DESC, e.visitas DESC, e.ruc LIMIT 1000`, [ruc]),
          ]).catch((e) => { console.warn(`[visitas] empresas: ${(e as Error).message}`); return null; })
        : Promise.resolve(null),
      // Cuántas son en total (auditoría del 2026-10-29): la cifra de familiares contaba sólo las 500 que llegaban (hay
      // entidades con 6,748) y las organizaciones (300) y las oficinas (60) se cortaban sin decirlo.
      pre
        ? pool.query<{ o: number; a: number; p: number | null }>(
            `SELECT (SELECT count(*)::int FROM entidad_visita_org WHERE entidad_ruc = $1) AS o,
                    (SELECT count(*)::int FROM entidad_visita_area WHERE entidad_ruc = $1) AS a,
                    ${conParientes ? "(SELECT count(*)::int FROM entidad_visita_pariente WHERE entidad_ruc = $1)" : "NULL::int"} AS p`, [ruc])
            .then((x) => x.rows[0] ?? null).catch(() => null)
        : Promise.resolve(null),
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
        fueraDeHora: r.fueraDeHora, largas: r.largas, parientes: totales?.p ?? parientes.rows.length,
      },
      totales: { organizaciones: totales?.o ?? null, areas: totales?.a ?? null, parientes: totales?.p ?? null },
      organizaciones: orgs.rows.map((o) => ({ ...o, ruc: o.ruc && /^20\d{9}$/.test(o.ruc) ? o.ruc : null, empresa: o.ruc && /^20\d{9}$/.test(o.ruc) ? o.empresa : null })),
      // «Lo que le dio después» no alcanzó el plazo: las organizaciones van sin esa columna (la web no dice «nada después»).
      ...(despuesSinCalcular ? { despuesSinCalcular: true } : {}),
      // Las empresas de quienes la visitan (también por su socio, representante o directivo) y lo que ganaron después.
      ...(empresas
        ? {
            empresas: {
              ...empresas[0].rows[0],
              lista: empresas[1].rows,
            },
          }
        : {}),
      areas: areas.rows,
      parientes: parientes.rows,
      // Bajo `visitas`: publicar() le tapa un apellido a quien visita. El familiar de un funcionario va sin nombre.
      visitas: lista.rows.map(({ id, ruc: rucEmpresa, ...v }) => ({
        ...v,
        visitante: v.pariente ? null : v.visitante,
        empresa: rucEmpresa && /^20\d{9}$/.test(rucEmpresa) ? { ruc: rucEmpresa, nombre: nombres.get(rucEmpresa) ?? null } : null,
        // Su registro: el del Congreso, el reporte mensual de la PNDA (que es sólo de Loreto) o el registro en línea de la
        // PCM (la plataforma nacional y su exportación). Antes una visita nacional de 2025 iba al reporte de Loreto.
        enlace: v.fuente === "congreso_visitas" ? VISITAS_CONGRESO : v.fuente === "pnda_visitas" ? datasetVisitas(v.fecha) : VISITAS_EN_LINEA,
        clave: String(id),
      })),
      fuentes: [
        fuentes.includes("congreso_visitas") && { texto: "Registro de visitas del Congreso de la República", href: VISITAS_CONGRESO },
        { texto: "Registro de Visitas en Línea (PCM)", href: VISITAS_EN_LINEA },
      ].filter(Boolean),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * GET /visitas/entidad/:ruc/buscar?en=organizaciones|areas&q=  — busca en TODAS las organizaciones que la visitaron o en
 * todas sus oficinas, no sólo en las que llegaron con la pestaña (las 1,000 que más la visitan y las 300 oficinas con más
 * visitas: hay entidades con 41,952 organizaciones). A lo más 200, las de más visitas primero; misma forma que la pestaña.
 */
visitasRouter.get("/entidad/:ruc/buscar", async (c) => {
  const ruc = c.req.param("ruc");
  const en = c.req.query("en");
  const q = (c.req.query("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!/^\d{11}$/.test(ruc) || (en !== "organizaciones" && en !== "areas") || q.length < 3) return c.json({ error: "consulta_invalida" }, 400);
  if (!(await tabla("entidad_visita_org"))) return c.json({ [en]: [] });
  // Lo que escribe la persona va como texto, no como comodín de LIKE.
  const patron = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  if (en === "areas") {
    const r = await pool.query(
      `SELECT area, NULLIF(cargo, '') AS cargo, visitas, privadas, decisor FROM entidad_visita_area
        WHERE entidad_ruc = $1 AND (unaccent(area) ILIKE unaccent($2) OR unaccent(COALESCE(cargo, '')) ILIKE unaccent($2))
        ORDER BY visitas DESC LIMIT 200`, [ruc, patron]);
    c.header("Cache-Control", CACHE);
    return c.json(publicar({ areas: r.rows }));
  }
  const r = await pool.query(
    `SELECT o.org, o.tipo, o.visitas, o.visitantes, to_char(o.primera, 'YYYY-MM-DD') AS primera, to_char(o.ultima, 'YYYY-MM-DD') AS ultima,
            o.decisores, o.ruc, r.nombre AS empresa,
            to_char(e.despues, 'YYYY-MM-DD') AS "despues", e.despues_tipo AS "despuesTipo", e.monto::float AS "montoDespues",
            e.despues_numero AS "despuesNumero", e.despues_monto::float AS "despuesMonto"
       FROM entidad_visita_org o
       LEFT JOIN empresa_resumen r ON r.ruc = o.ruc
       LEFT JOIN entidad_visita_empresa e ON e.entidad_ruc = $1 AND e.ruc = o.ruc
      WHERE o.entidad_ruc = $1
        AND (unaccent(o.org) ILIKE unaccent($2) OR unaccent(COALESCE(r.nombre, '')) ILIKE unaccent($2) OR (o.ruc = $3 AND o.ruc LIKE '20%'))
      ORDER BY o.visitas DESC LIMIT 200`, [ruc, patron, q]).catch(() => null);
  c.header("Cache-Control", CACHE);
  return c.json(publicar({
    organizaciones: (r?.rows ?? []).map((o) => ({ ...o, ruc: o.ruc && /^20\d{9}$/.test(o.ruc) ? o.ruc : null, empresa: o.ruc && /^20\d{9}$/.test(o.ruc) ? o.empresa : null })),
  }));
});
