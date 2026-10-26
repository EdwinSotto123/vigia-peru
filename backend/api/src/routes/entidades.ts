import { Hono } from "hono";
import { z } from "zod";
import { escaparLike, pool } from "../lib/db.js";
import { COLS_ESTADO_FILA, joinsEstadoFila } from "../lib/estadoFila.js";
import { cachePublico, parametros } from "../lib/http.js";
import { Memo } from "../lib/cache.js";
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
  // `clase` = tipo/nivel derivado del NOMBRE (el campo `entidades.tipo` está casi todo en NULL). Mismas reglas que
  // frontend/lib/entidad-tipo.ts, en regex POSIX sobre nombre_norm (minúsculas, sin tildes). Es un filtro, no una
  // afirmación categórica: "ministerio" incluye al Ministerio Público, etc.
  clase: z.enum(["ministerio", "regional", "municipal", "organismo"]).optional(),
  // Solo las entidades con indicio de nepotismo (un pariente declarado en la DJI que es su locador; vista migr. 136).
  nepotismo: z.enum(["1"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const CLASE_REGEX: Record<string, string> = {
  ministerio: "ministerio",
  regional: "gobierno regional",
  municipal: "municipalidad",
  organismo: "organismo|superintendencia|instituto|autoridad|contraloria|defensoria|jurado|registro",
};

// ─── GET /entidades — lista con contadores agregados (paginada) ─
// Fase 2 (auditoría C9): desde la vista materializada `entidad_stats` (migración 35), una fila por
// entidad con sus conteos ya hechos; antes cada pedido agrupaba TODAS las convocatorias. Mismas
// filas. Orden: dictámenes publicados, después las que más contratos tienen desde 2015, nombre. La provincia sale de
// `zonas` (con tildes, migración 72) y no del texto del SEACE. Va hasta un refresco detrás.
entidadesRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { q, region, tipo, clase, nepotismo, limit, offset } = parsed.data;
  const modelos = await hayModelosLectura();
  const col = modelos ? "es" : "e";

  const conds: string[] = [];
  const vals: any[] = [];
  if (q && /^\d{4,11}$/.test(q)) {
    // Un RUC (o su comienzo): el placeholder dice "por nombre o RUC" y antes sólo miraba el nombre.
    vals.push(`${q}%`);
    conds.push(`${modelos ? "es" : "e"}.ruc::text LIKE $${vals.length}`);
  } else if (q) {
    vals.push(`%${escaparLike(q.toLowerCase())}%`);
    conds.push(modelos ? `es.nombre_norm LIKE immutable_unaccent($${vals.length})` : `immutable_unaccent(lower(e.nombre)) LIKE immutable_unaccent($${vals.length})`);
  }
  if (region) { vals.push(region); conds.push(`${modelos ? "es" : "e"}.region = $${vals.length}`); }
  if (tipo)   { vals.push(tipo);   conds.push(`${modelos ? "es" : "e"}.tipo = $${vals.length}`); }
  if (clase && CLASE_REGEX[clase]) {
    vals.push(CLASE_REGEX[clase]);
    conds.push(`${modelos ? "es.nombre_norm" : "immutable_unaccent(lower(e.nombre))"} ~ $${vals.length}`);
  }
  if (nepotismo) conds.push(`EXISTS (SELECT 1 FROM dji_nepotismo n WHERE n.entidad_ruc = ${col}.ruc)`);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const totalVals = [...vals];
  vals.push(limit, offset);
  const [r, total] = await Promise.all([
    pool.query(modelos
      ? `SELECT es.ruc, es.nombre, es.tipo, es.region,
                COALESCE((SELECT z.nombre FROM entidades e2 JOIN zonas z ON z.ubigeo = left(e2.ubigeo::text, 4) WHERE e2.ruc = es.ruc), es.provincia) AS provincia,
                es.distrito,
                es.pliego_nombre_mef AS "pliegoNombreMef",
                es.alertas_activas AS alertas,
                es.monto_alertas_activas::float AS monto,
                COALESCE(es.score_prom_activas, 0)::int AS "scorePromedio",
                NULL::int AS reportes,
                es.contratos,
                es.alertas_activas AS "contratosVigilados",
                NULL::jsonb AS serie,
                EXISTS (SELECT 1 FROM dji_nepotismo n WHERE n.entidad_ruc = es.ruc) AS "conNepotismo"
           FROM entidad_stats es
           ${where}
           ORDER BY es.alertas_activas DESC, es.contratos DESC NULLS LAST, es.nombre, es.ruc
           LIMIT $${vals.length - 1} OFFSET $${vals.length}`
      : `SELECT
           e.ruc, e.nombre, e.tipo, e.region,
           COALESCE((SELECT z.nombre FROM zonas z WHERE z.ubigeo = left(e.ubigeo::text, 4)), e.provincia) AS provincia, e.distrito,
           e.pliego_nombre_mef AS "pliegoNombreMef",
           COALESCE(a.alertas, 0)      AS alertas,
           COALESCE(a.monto, 0)::float AS monto,
           COALESCE(a.score_avg, 0)::int AS "scorePromedio",
           NULL::int                   AS reportes,   -- antes metadata.reportes_mock (inventado)
           COALESCE(cv.contratos, 0)::int AS contratos,
           COALESCE(a.alertas, 0)::int AS "contratosVigilados",
           NULL::jsonb                 AS serie,      -- antes metadata.serie_mock (inventado)
           EXISTS (SELECT 1 FROM dji_nepotismo n WHERE n.entidad_ruc = e.ruc) AS "conNepotismo"
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
         ORDER BY a.alertas DESC NULLS LAST, cv.contratos DESC NULLS LAST, e.nombre, e.ruc
         LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals,
    ),
    pool.query(`SELECT count(*)::int AS n FROM ${modelos ? "entidad_stats es" : "entidades e"} ${where}`, totalVals),
  ]);
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
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
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(r.rows[0]);
});

// ─── GET /entidades/regiones — las regiones (departamentos) para el filtro de la lista ─
// Antes de /:ruc para que Hono no lo tome por un RUC.
entidadesRouter.get("/regiones", async (c) => {
  const modelos = await hayModelosLectura();
  const r = await pool.query<{ region: string }>(
    `SELECT DISTINCT region FROM ${modelos ? "entidad_stats" : "entidades"} WHERE region IS NOT NULL AND region <> '' ORDER BY region`,
  );
  c.header("Cache-Control", cachePublico(3600, { maxAge: 600, swr: 3600 }));
  return c.json({ regiones: r.rows.map((x) => x.region) });
});

// ─── GET /entidades/:ruc ─────────────────────────────────────────
// ─── GET /entidades/:ruc/cruces — procesos cuyo ganador tiene cruces con otras fuentes (migración 48) ─
entidadesRouter.get("/:ruc/cruces", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(publicar(await crucesDeEntidad(ruc)));
});

// ─── GET /entidades/:ruc/fraccionamiento — órdenes menores de un mismo día que juntas pasan 8 UIT (migración 51) ─
entidadesRouter.get("/:ruc/fraccionamiento", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  // `?limit=` hasta 1000: la ficha las pide todas y las pagina (antes cortaba en 50 y decía "se muestran los 50").
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit")) || 50));
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
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

// ─── GET /entidades/:ruc/procesos — sus procesos adjudicados desde 2015 (CONOSCE desde 2018, migración 66; OCDS antes, 68) ─
// La base de Vigía (GET /contratos?entidad=) es casi toda de 2026; CONOSCE trae la historia. Un proceso por fila
// (código de convocatoria; ítems repetidos entre años, una vez), con el ganador de mayor monto, como
// GET /partidos/:clave/procesos. `resumen` va siempre sin filtros: las cifras de la ficha y los conteos de los filtros.
const ProcesosEntidadQuery = z.object({
  q: z.string().trim().min(3).max(80).optional(),
  objeto: z.string().max(40).optional(),
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  orden: z.enum(["fecha", "monto"]).default("fecha"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const PROCESOS_DE_ENTIDAD = `
  WITH a AS (SELECT DISTINCT ON (codigo_convocatoria, n_item) * FROM conosce_adjudicaciones WHERE entidad_ruc = $1
              ORDER BY codigo_convocatoria, n_item, anio DESC),
       c AS (SELECT a.codigo_convocatoria AS codigo, min(a.fecha_convocatoria) AS fecha, max(a.objeto) AS objeto, max(a.tipo_proceso) AS "tipoProceso",
                    max(a.nomenclatura) AS nomenclatura, max(a.descripcion_proceso) AS descripcion, max(a.entidad) AS entidad, count(*)::int AS items,
                    sum(a.monto_referencial)::float AS "montoReferencial", sum(a.monto_adjudicado)::float AS "montoAdjudicado",
                    (sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')))::float AS pen, max(a.moneda) AS moneda,
                    count(DISTINCT a.ruc_proveedor)::int AS proveedores,
                    (array_agg(a.proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS proveedor,
                    (array_agg(a.ruc_proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS "rucProveedor"
               FROM a GROUP BY a.codigo_convocatoria)
  SELECT * FROM c
  UNION ALL
  -- Antes de 2018, de la API OCDS (migración 68): CONOSCE empieza ese año.
  SELECT h.codigo, h.fecha_convocatoria, h.objeto, h.tipo_proceso, h.nomenclatura, h.descripcion, h.entidad, 1,
         h.monto_referencial::float, h.monto_adjudicado::float,
         CASE WHEN h.moneda IS NULL OR h.moneda = 'PEN' THEN h.monto_adjudicado::float END,
         CASE COALESCE(h.moneda, 'PEN') WHEN 'PEN' THEN 'Soles' WHEN 'USD' THEN 'Dólar Norteamericano' WHEN 'EUR' THEN 'Euro' ELSE h.moneda END,
         h.proveedores, h.proveedor, h.ruc_proveedor
    FROM procesos_historicos h
   WHERE h.entidad_ruc = $1 AND h.fecha_convocatoria < DATE '2018-01-01' AND NOT EXISTS (SELECT 1 FROM c WHERE c.codigo = h.codigo)`;

const procesosEntidadMemo = new Memo<Record<string, unknown>>({ nombre: "entidades:procesos", ttlMs: 300_000, staleMs: 300_000, max: 500 });

entidadesRouter.get("/:ruc/procesos", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const crudos = Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
  const parsed = ProcesosEntidadQuery.safeParse(crudos);
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await procesosEntidadMemo.obtener(`procesos:${ruc}:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [ruc];
    const conds: string[] = [];
    if (q.objeto) { vals.push(q.objeto); conds.push(`p.objeto = $${vals.length}`); }
    if (q.anio) { vals.push(q.anio); conds.push(`extract(year FROM p.fecha) = $${vals.length}`); }
    if (q.q) {
      // El nombre de una persona natural (RUC 10) no se busca (como en casos_cruce y partido_proceso).
      vals.push(q.q);
      conds.push(`mef_norm(coalesce(p.descripcion, '') || ' ' || coalesce(p.nomenclatura, '') || ' ' ||
                  CASE WHEN p."rucProveedor" LIKE '10%' THEN '' ELSE coalesce(p.proveedor, '') END) LIKE '%' || mef_norm($${vals.length}) || '%'`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const orden = q.orden === "monto" ? `p.pen DESC NULLS LAST, p.fecha DESC` : `p.fecha DESC, p.pen DESC NULLS LAST`;
    const [filas, resumen] = await Promise.all([
      // La página primero (pag) y después, sólo para esas filas, lo que Vigía sabe de cada una (lib/estadoFila.ts).
      pool.query(
        `WITH p AS (${PROCESOS_DE_ENTIDAD}),
         pag AS (
           SELECT p.*, cv.ocid, count(*) OVER ()::int AS total, (sum(p.pen) OVER ())::float AS monto
             FROM p LEFT JOIN convocatorias cv ON cv.ocid = p.codigo
             ${where}
            ORDER BY ${orden}, p.codigo
            LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size})
         SELECT pag.codigo, pag.nomenclatura, pag.descripcion, pag.objeto, pag."tipoProceso", to_char(pag.fecha, 'YYYY-MM-DD') AS fecha,
                pag.entidad, $1::text AS "entidadRuc", pag.items, pag."montoReferencial", pag."montoAdjudicado", pag.moneda, pag.proveedores,
                pag.proveedor, pag."rucProveedor", pag.ocid, pag.total, pag.monto, ${COLS_ESTADO_FILA}
           FROM pag
           ${joinsEstadoFila("pag.ocid")}
          ORDER BY ${orden.replace(/p\./g, "pag.")}, pag.codigo`, vals),
      pool.query(
        `WITH p AS (${PROCESOS_DE_ENTIDAD})
         SELECT count(*)::int AS procesos, COALESCE(sum(pen), 0)::float AS "montoAdjudicadoPen", count(DISTINCT "rucProveedor")::int AS proveedores,
                to_char(min(fecha), 'YYYY-MM-DD') AS desde,
                COALESCE((SELECT json_agg(x ORDER BY x.anio) FROM (SELECT extract(year FROM fecha)::int AS anio, count(*)::int AS procesos,
                                  COALESCE(sum(pen), 0)::float AS "montoAdjudicadoPen" FROM p GROUP BY 1) x), '[]') AS "porAnio",
                COALESCE((SELECT json_agg(x ORDER BY x.procesos DESC) FROM (SELECT COALESCE(objeto, 'Sin dato') AS objeto, count(*)::int AS procesos,
                                  COALESCE(sum(pen), 0)::float AS "montoAdjudicadoPen" FROM p GROUP BY 1) x), '[]') AS "porObjeto"
           FROM p`, [ruc]),
    ]);
    const total = filas.rows[0]?.total ?? 0;
    const monto = filas.rows[0]?.monto ?? 0;
    const data = filas.rows.map(({ total: _t, monto: _m, ...x }) => ({ ...x, nivel: null, lugar: null }));
    // El ganador puede ser una persona natural: publicar() la reconoce por su RUC 10 y tapa su nombre.
    return publicar({ total, montoAdjudicadoPen: monto, page: q.page, size: q.size, data, resumen: resumen.rows[0] });
  });
  c.header("Cache-Control", cachePublico(600, { maxAge: 120, swr: 600 }));
  return c.json(cuerpo);
});

entidadesRouter.get("/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const modelos = await hayModelosLectura();
  const [ent, mef, alertas, nep] = await Promise.all([
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
    // Nepotismo (indicio, no acusación): parientes declarados en la DJI que son locadores de ESTA entidad.
    // Detalle: el FUNCIONARIO (cargo público, su DJI es pública) + el parentesco + el PROVEEDOR (RUC-10). El nombre
    // del proveedor lo tapa publicar() como a cualquier locador (un apellido). Ver vista dji_nepotismo (migr. 136).
    pool.query<{ declarante: string; cargo: string | null; grado: string; parentesco: string; proveedorRuc: string; proveedorNombre: string; proveedorCodigo: string | null; ordenes: number; monto: number }>(
      `SELECT n.declarante_norm AS declarante, n.cargo, n.grado, n.parentesco, n.proveedor_ruc AS "proveedorRuc",
              n.proveedor_nombre AS "proveedorNombre", pc.codigo AS "proveedorCodigo", n.ordenes, n.monto
         FROM dji_nepotismo n LEFT JOIN persona_codigo pc ON pc.ruc = n.proveedor_ruc
        WHERE n.entidad_ruc = $1 ORDER BY n.monto DESC NULLS LAST LIMIT 40`,
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
  const porGradoMap = new Map<string, { grado: string; n: number; monto: number }>();
  for (const r of nep.rows) {
    const g = porGradoMap.get(r.grado) ?? { grado: r.grado, n: 0, monto: 0 };
    g.n += 1;
    g.monto += r.monto || 0;
    porGradoMap.set(r.grado, g);
  }
  const nepotismo = nep.rows.length
    ? {
        total: nep.rows.length,
        monto: nep.rows.reduce((a, r) => a + (r.monto || 0), 0),
        porGrado: [...porGradoMap.values()].sort((a, b) => b.monto - a.monto),
        // El proveedor (RUC-10) va tapado por publicar() como cualquier locador; el funcionario (cargo público) no.
        detalle: publicar(nep.rows),
      }
    : null;
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json({
    entidad,
    mef: mef.rows[0] ?? null,
    alertas: alertas.rows,
    nepotismo,
  });
});
