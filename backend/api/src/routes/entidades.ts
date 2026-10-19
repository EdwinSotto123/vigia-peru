import { Hono } from "hono";
import { z } from "zod";
import { escaparLike, pool } from "../lib/db.js";
import { cachePublico, parametros } from "../lib/http.js";
import { hayModelosLectura } from "../lib/esquema.js";
import { crucesDeEntidad, fraccionamientoDeEntidad } from "../lib/cruces.js";
import { publicar } from "../lib/privacidad.js";
import { alertaNoDemo, alertaPublica, convocatoriaNoDemo, ENTIDAD_METADATA_MOCK } from "../lib/publicacion.js";

export const entidadesRouter = new Hono();

// Agregados de alertas: solo `activa` (como siempre) y NUNCA las semillas de demo `ALT-…`. Tampoco
// se leen las claves `*_mock` que seed_db.py dejó en entidades.metadata (reportes_mock, serie_mock,
// contratos, contratos_vigilados…): eran cifras inventadas. Ver lib/publicacion.ts §1.
const ALERTAS_ACTIVAS = `a.estado = 'activa' AND ${alertaNoDemo("a")}`;

const ListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  region: z.string().max(80).optional(),
  tipo: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── GET /entidades — lista con contadores agregados (paginada) ─
// Fase 2 (auditoría C9): desde la vista materializada `entidad_stats` (migración 35), una fila por
// entidad con sus conteos ya hechos; antes cada pedido agrupaba TODAS las convocatorias. Mismas
// filas y mismo orden (alertas activas DESC, nombre, ruc). Va hasta un refresco detrás.
entidadesRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { q, region, tipo, limit, offset } = parsed.data;
  const modelos = await hayModelosLectura();

  const conds: string[] = [];
  const vals: any[] = [];
  if (q) {
    vals.push(`%${escaparLike(q.toLowerCase())}%`);
    conds.push(modelos ? `es.nombre_norm LIKE immutable_unaccent($${vals.length})` : `immutable_unaccent(lower(e.nombre)) LIKE immutable_unaccent($${vals.length})`);
  }
  if (region) { vals.push(region); conds.push(`${modelos ? "es" : "e"}.region = $${vals.length}`); }
  if (tipo)   { vals.push(tipo);   conds.push(`${modelos ? "es" : "e"}.tipo = $${vals.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const totalVals = [...vals];
  vals.push(limit, offset);
  const [r, total] = await Promise.all([
    pool.query(modelos
      ? `SELECT es.ruc, es.nombre, es.tipo, es.region, es.provincia, es.distrito,
                es.pliego_nombre_mef AS "pliegoNombreMef",
                es.alertas_activas AS alertas,
                es.monto_alertas_activas::float AS monto,
                COALESCE(es.score_prom_activas, 0)::int AS "scorePromedio",
                NULL::int AS reportes,
                es.contratos,
                es.alertas_activas AS "contratosVigilados",
                NULL::jsonb AS serie
           FROM entidad_stats es
           ${where}
           ORDER BY es.alertas_activas DESC, es.nombre, es.ruc
           LIMIT $${vals.length - 1} OFFSET $${vals.length}`
      : `SELECT
           e.ruc, e.nombre, e.tipo, e.region, e.provincia, e.distrito,
           e.pliego_nombre_mef AS "pliegoNombreMef",
           COALESCE(a.alertas, 0)      AS alertas,
           COALESCE(a.monto, 0)::float AS monto,
           COALESCE(a.score_avg, 0)::int AS "scorePromedio",
           NULL::int                   AS reportes,   -- antes metadata.reportes_mock (inventado)
           COALESCE(cv.contratos, 0)::int AS contratos,
           COALESCE(a.alertas, 0)::int AS "contratosVigilados",
           NULL::jsonb                 AS serie       -- antes metadata.serie_mock (inventado)
         FROM entidades e
         LEFT JOIN (
           SELECT c.entidad_ruc, COUNT(*)::int AS contratos FROM convocatorias c WHERE ${convocatoriaNoDemo("c")} GROUP BY c.entidad_ruc
         ) cv ON cv.entidad_ruc = e.ruc
         LEFT JOIN (
           SELECT a.entidad_ruc, COUNT(*)::int AS alertas, SUM(a.monto_adjudicado) AS monto, AVG(a.score)::int AS score_avg
           FROM alertas a WHERE ${ALERTAS_ACTIVAS}
           GROUP BY a.entidad_ruc
         ) a ON a.entidad_ruc = e.ruc
         ${where}
         ORDER BY a.alertas DESC NULLS LAST, e.nombre, e.ruc
         LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals,
    ),
    pool.query(`SELECT count(*)::int AS n FROM ${modelos ? "entidad_stats es" : "entidades e"} ${where}`, totalVals),
  ]);
  c.header("Cache-Control", cachePublico(120, { maxAge: 60, swr: 60 }));
  return c.json({ data: r.rows, total: total.rows[0].n, limit, offset });
});

// ─── GET /entidades/summary ── KPIs globales ────────────────────
entidadesRouter.get("/summary", async (c) => {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM entidades) AS total_entidades,
       (SELECT COUNT(*)::int FROM entidades e
          WHERE EXISTS (SELECT 1 FROM alertas a WHERE a.entidad_ruc = e.ruc AND ${ALERTAS_ACTIVAS})
       ) AS con_alertas,
       (SELECT COALESCE(SUM(a.monto_adjudicado), 0)::float FROM alertas a WHERE ${ALERTAS_ACTIVAS}) AS monto`,
  );
  c.header("Cache-Control", cachePublico(120, { maxAge: 60, swr: 60 }));
  return c.json(r.rows[0]);
});

// ─── GET /entidades/:ruc ─────────────────────────────────────────
// ─── GET /entidades/:ruc/cruces — procesos cuyo ganador tiene cruces con otras fuentes (migración 48) ─
entidadesRouter.get("/:ruc/cruces", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 300 }));
  return c.json(publicar(await crucesDeEntidad(ruc)));
});

// ─── GET /entidades/:ruc/fraccionamiento — órdenes menores de un mismo día que juntas pasan 8 UIT (migración 51) ─
entidadesRouter.get("/:ruc/fraccionamiento", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  // `?limit=` hasta 1000: la ficha las pide todas y las pagina (antes cortaba en 50 y decía "se muestran los 50").
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit")) || 50));
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 300 }));
  return c.json(publicar(await fraccionamientoDeEntidad(ruc, limit)));
});

// ─── GET /entidades/:ruc/gasto — en qué gasta, según el MEF (migraciones 63 y 64) ─
// Suma las unidades ejecutoras con que cruzó la entidad (`mef_entity_budget.sec_ejecs`) en el último año cargado. Si la
// entidad cruzó con el pliego regional entero (`keyword` 'pliego …'), son las cifras de todo el gobierno regional:
// `cruce` lo dice y la ficha lo avisa. Ocho miradas, armadas en árbol donde corresponde:
//   genéricas › partidas › específicas · funciones · proyectos · fuentes › rubros · meses · programas › productos
type TipoGasto = "partida" | "funcion" | "proyecto" | "especifica" | "rubro" | "mes" | "programa" | "producto";
interface FilaGasto { tipo: TipoGasto; codigo: string; nombre: string | null; grupo: string | null; pim: number; devengado: number }
interface Dato { codigo: string; nombre: string; pim: number; devengado: number }

const porPim = (a: { pim: number }, b: { pim: number }) => b.pim - a.pim;

/** Junta en `lista` el dato con el mismo nombre (dos códigos que el clasificador llama igual son, en la ficha, uno). */
function sumarPorNombre<T extends Dato>(lista: T[], d: T): T {
  const igual = lista.find((p) => p.nombre.trim() === d.nombre.trim());
  if (!igual) {
    lista.push(d);
    return d;
  }
  igual.pim += d.pim;
  igual.devengado += d.devengado;
  return igual;
}

entidadesRouter.get("/:ruc/gasto", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const r = await pool.query<FilaGasto & { anio: number; cruce: string | null }>(
    `WITH e AS (SELECT sec_ejecs, split_part(keyword, ' ', 1) AS cruce FROM mef_entity_budget WHERE entidad_ruc = $1),
          u AS (SELECT max(g.anio) AS anio FROM mef_ejecutora_gasto g, e WHERE g.sec_ejec = ANY(e.sec_ejecs))
     SELECT u.anio, e.cruce, g.tipo, g.codigo, max(g.nombre) AS nombre, max(g.grupo) AS grupo,
            sum(g.pim)::float AS pim, sum(g.devengado)::float AS devengado
       FROM mef_ejecutora_gasto g, e, u
      WHERE g.anio = u.anio AND g.sec_ejec = ANY(e.sec_ejecs)
      GROUP BY u.anio, e.cruce, g.tipo, g.codigo
     HAVING sum(g.pim) > 0 OR sum(g.devengado) > 0`,
    [ruc],
  );
  c.header("Cache-Control", cachePublico(3600, { maxAge: 300, swr: 3600 }));
  const filas = r.rows;
  const de = (t: TipoGasto) => filas.filter((x) => x.tipo === t);
  // 2999999 es el "proyecto" del MEF para las inversiones sin código propio (su actividad dice sólo "ACCIONES DE
  // INVERSIÓN" u "OBRAS"): sin nombre en el archivo.
  const dato = (f: FilaGasto): Dato => ({
    codigo: f.codigo,
    nombre: f.nombre || (f.tipo === "proyecto" && f.codigo === "2999999" ? "OTRAS INVERSIONES, SIN CÓDIGO DE PROYECTO EN EL MEF" : f.codigo),
    pim: f.pim,
    devengado: f.devengado,
  });

  // Genéricas › partidas › específicas. Dos partidas con el mismo nombre en una genérica ("GASTOS VARIABLES Y
  // OCASIONALES" del personal activo y del CAS) van juntas; sus específicas, también.
  type Partida = Dato & { especificas: Dato[] };
  const genericas = new Map<string, { nombre: string; pim: number; devengado: number; partidas: Partida[] }>();
  const partidaPorCodigo = new Map<string, Partida>();
  for (const f of de("partida")) {
    const g = f.grupo || "OTROS";
    let x = genericas.get(g);
    if (!x) genericas.set(g, (x = { nombre: g, pim: 0, devengado: 0, partidas: [] }));
    x.pim += f.pim;
    x.devengado += f.devengado;
    partidaPorCodigo.set(f.codigo, sumarPorNombre<Partida>(x.partidas, { ...dato(f), especificas: [] }));
  }
  for (const f of de("especifica")) {
    const p = partidaPorCodigo.get(f.grupo ?? "");
    if (p) sumarPorNombre(p.especificas, dato(f));
  }
  for (const g of genericas.values()) {
    g.partidas.sort(porPim);
    for (const p of g.partidas) {
      p.especificas.sort(porPim);
      // Una sola específica que se llama como su partida no agrega nada.
      if (p.especificas.length === 1 && p.especificas[0].nombre.trim() === p.nombre.trim()) p.especificas = [];
    }
  }

  // Fuentes › rubros: de dónde viene la plata.
  const fuentes = new Map<string, { nombre: string; pim: number; devengado: number; rubros: Dato[] }>();
  for (const f of de("rubro")) {
    const k = f.grupo || "OTRAS FUENTES";
    let x = fuentes.get(k);
    if (!x) fuentes.set(k, (x = { nombre: k, pim: 0, devengado: 0, rubros: [] }));
    x.pim += f.pim;
    x.devengado += f.devengado;
    sumarPorNombre(x.rubros, dato(f));
  }
  for (const x of fuentes.values()) {
    x.rubros.sort(porPim);
    // "RECURSOS ORDINARIOS" › "RECURSOS ORDINARIOS": un solo rubro con el nombre de su fuente no agrega nada.
    if (x.rubros.length === 1 && x.rubros[0].nombre.trim() === x.nombre.trim()) x.rubros = [];
  }

  // Programas › productos.
  type Programa = Dato & { productos: Dato[] };
  const programas = new Map<string, Programa>(de("programa").map((f) => [f.codigo, { ...dato(f), productos: [] }]));
  for (const f of de("producto")) {
    const p = programas.get(f.grupo ?? "");
    if (p) sumarPorNombre(p.productos, { ...dato(f), codigo: f.codigo.split(".").pop() ?? f.codigo });
  }
  for (const p of programas.values()) p.productos.sort(porPim);

  const proyectos = de("proyecto").map(dato).sort(porPim);
  return c.json({
    anio: filas[0]?.anio ?? null,
    cruce: filas[0]?.cruce ?? null,
    genericas: [...genericas.values()].sort(porPim),
    funciones: de("funcion").map(dato).sort(porPim),
    proyectos: {
      total: proyectos.length,
      pim: proyectos.reduce((s, p) => s + p.pim, 0),
      devengado: proyectos.reduce((s, p) => s + p.devengado, 0),
      // Todos: la ficha los pagina.
      lista: proyectos,
    },
    fuentes: [...fuentes.values()].sort(porPim),
    // Los doce meses, con cero los que no tienen devengado (la serie no salta).
    meses: Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1,
      devengado: de("mes").filter((f) => Number(f.codigo) === i + 1).reduce((s, f) => s + f.devengado, 0),
    })),
    programas: [...programas.values()].sort(porPim),
  });
});

entidadesRouter.get("/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const modelos = await hayModelosLectura();
  const [ent, mef, alertas] = await Promise.all([
    pool.query(modelos
      // alertas, monto y contratos desde entidad_stats; la cola, en vivo (1,5 ms con la migración 32).
      ? `SELECT e.*,
                COALESCE(es.alertas_activas, 0)::int AS alertas,
                COALESCE(es.monto_alertas_activas, 0)::float AS monto,
                COALESCE(es.contratos, 0)::int AS contratos,
                (SELECT count(*) FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid WHERE c.entidad_ruc = e.ruc)::int AS "contratosEnCola",
                (SELECT z.nombre FROM zonas z WHERE z.ubigeo = e.ubigeo) AS "zonaNombre"
           FROM entidades e
           LEFT JOIN entidad_stats es ON es.ruc = e.ruc
          WHERE e.ruc = $1`
      : `SELECT e.*,
                COALESCE(a.alertas, 0)::int AS alertas,
                COALESCE(a.monto, 0)::float AS monto,
                (SELECT count(*) FROM convocatorias c WHERE c.entidad_ruc = e.ruc AND ${convocatoriaNoDemo("c")})::int AS contratos,
                (SELECT count(*) FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid WHERE c.entidad_ruc = e.ruc)::int AS "contratosEnCola",
                (SELECT z.nombre FROM zonas z WHERE z.ubigeo = e.ubigeo) AS "zonaNombre"
           FROM entidades e
           LEFT JOIN (
             SELECT a.entidad_ruc, COUNT(*) AS alertas, SUM(a.monto_adjudicado) AS monto
             FROM alertas a WHERE ${ALERTAS_ACTIVAS} GROUP BY a.entidad_ruc
           ) a ON a.entidad_ruc = e.ruc
          WHERE e.ruc = $1`,
      [ruc],
    ),
    // `corte`: la fecha del archivo del MEF del que salió (last_refreshed es cuándo se recalculó).
    pool.query(
      `SELECT b.*, (SELECT max(corte) FROM mef_ejecutora_anual) AS corte
         FROM mef_entity_budget b WHERE b.entidad_ruc = $1`,
      [ruc],
    ),
    // Solo alertas PUBLICADAS y no demo: antes salían también las que están en revisión humana o
    // descartadas, con su score (no publicado).
    pool.query(
      `SELECT a.id, a.codigo, a.codigo_convocatoria, a.score, a.fecha_buena_pro,
              a.monto_adjudicado, a.estado, a.objeto, a.region
         FROM alertas a WHERE a.entidad_ruc = $1 AND ${alertaPublica("a")}
         ORDER BY a.score DESC, a.id LIMIT 20`,
      [ruc],
    ),
  ]);
  if (ent.rows.length === 0) return c.json({ error: "not_found" }, 404);
  // metadata sin las claves `*_mock` de seed_db.py (cifras inventadas).
  const entidad = ent.rows[0];
  if (entidad.metadata && typeof entidad.metadata === "object") {
    const limpia: Record<string, unknown> = { ...entidad.metadata };
    for (const k of ENTIDAD_METADATA_MOCK) delete limpia[k];
    entidad.metadata = limpia;
  }
  c.header("Cache-Control", cachePublico(120, { maxAge: 60, swr: 60 }));
  return c.json({
    entidad,
    mef: mef.rows[0] ?? null,
    alertas: alertas.rows,
  });
});
