import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { aCruce, ETIQUETA_CRUCE } from "../lib/cruces.js";
import { publicar } from "../lib/privacidad.js";
import { conEnie, palabrasBusqueda } from "./personas.js";

/**
 * Empresas (migración 109): cada RUC 20 que ganó, postuló o recibió órdenes del Estado, con su puntaje de antecedentes
 * (0 a 100, con su desglose y sus reglas). Las personas naturales (RUC 10) no están acá: van en /personas.
 *
 * Privacidad (docs/PRIVACIDAD.md): la razón social y el RUC de una empresa son públicos y se buscan. Sus socios,
 * representantes y directivos son personas: salen bajo `socios` y `visitas` (papeles que publicar() reconoce y les
 * tapa un apellido) y nunca con su documento.
 *
 *   GET /empresas                       lista paginada: buscador (nombre o RUC), filtros, orden y el resumen
 *   GET /empresas/reglas                las reglas del puntaje (grupos, topes y puntos por antecedente)
 *   GET /empresas/:ruc                  la ficha: resumen, desglose del puntaje, año por año
 *   GET /empresas/:ruc/contratos        procesos que ganó, sola o en consorcio (CONOSCE)
 *   GET /empresas/:ruc/ordenes          órdenes de compra y de servicio (CONOSCE)
 *   GET /empresas/:ruc/clientes         las entidades que le adjudicaron o le compraron
 *   GET /empresas/:ruc/postulaciones    los procesos en que fue postor y quién ganó
 *   GET /empresas/:ruc/antecedentes     cada antecedente (cruces_proveedor) con su fuente
 *   GET /empresas/:ruc/socios           socios, representantes y directivos (RNP) y las empresas vinculadas
 *   GET /empresas/:ruc/visitas          visitas registradas de su gente a entidades públicas
 */
export const empresasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const listaMemo = new Memo<Record<string, unknown>>({ nombre: "empresas:lista", ttlMs: 600_000, staleMs: 600_000, max: 400 });
const fichaMemo = new Memo<Record<string, unknown> | null>({ nombre: "empresas:ficha", ttlMs: 600_000, staleMs: 600_000, max: 600 });

export const RUC_EMPRESA = /^20\d{9}$/;
export const NIVELES = ["alto", "medio", "bajo", "sin"] as const;
export const OBJETOS = ["Bien", "Servicio", "Obra", "Consultoría de Obra"] as const;
/** Soles en CONOSCE: "Soles" y, en los años viejos, "Nuevos Soles". */
const SOLES = `('Soles', 'Nuevos Soles')`;

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));

// ─── GET /empresas ──────────────────────────────────────────────────────────────────────────────
const Lista = z.object({
  // El nombre (palabras) o el RUC (sus primeras cifras).
  q: z.string().trim().min(2).max(80).optional(),
  nivel: z.enum([...NIVELES, "con"]).optional(),
  tipo: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  departamento: z.string().trim().min(2).max(40).optional(),
  objeto: z.enum(OBJETOS).optional(),
  inhabilitada: z.enum(["si"]).optional(),
  visitas: z.enum(["si"]).optional(),
  orden: z.enum(["puntaje", "monto", "contratos", "ordenes", "reciente", "nombre"]).default("puntaje"),
  page: z.coerce.number().int().min(1).max(5000).default(1),
  size: z.coerce.number().int().min(0).max(50).default(20),
});
type ListaQ = z.infer<typeof Lista>;

/** Lo que recibió: contratos que ganó sola y órdenes. Lo ganado en consorcio es de todo el consorcio: no se suma (índice de la migración 109). */
const MONTO = `(e.adj_monto + e.ord_monto)`;
const ORDEN: Record<ListaQ["orden"], string> = {
  puntaje: `e.puntaje DESC, ${MONTO} DESC`,
  monto: `${MONTO} DESC`,
  contratos: `(e.adj_procesos + e.cons_procesos) DESC, ${MONTO} DESC`,
  ordenes: `e.ord_n DESC, ${MONTO} DESC`,
  reciente: `e.ultima DESC NULLS LAST, ${MONTO} DESC`,
  nombre: `e.nombre ASC`,
};

/** "lima" → "LIMA", como mef_norm. */
const norm = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function filtros(q: ListaQ): { conds: string[]; vals: unknown[] } {
  const conds: string[] = [];
  const vals: unknown[] = [];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  if (q.q) {
    const cifras = q.q.replace(/\s+/g, "");
    if (/^\d{3,11}$/.test(cifras)) conds.push(`e.ruc LIKE ${p(`${cifras}%`)}`);
    else for (const w of palabrasBusqueda(q.q)) conds.push(`e.texto LIKE ${p(`%${w}%`)}`);
  }
  if (q.nivel === "con") conds.push(`e.puntaje > 0`);
  else if (q.nivel) conds.push(`e.nivel = ${p(q.nivel)}`);
  if (q.tipo) conds.push(`e.tipos @> ${p([q.tipo])}::text[]`);
  if (q.departamento) conds.push(`e.departamento = ${p(norm(q.departamento))}`);
  if (q.objeto) conds.push(`e.objeto = ${p(q.objeto)}`);
  if (q.inhabilitada) conds.push(`e.inhabilitada IS NOT NULL`);
  if (q.visitas) conds.push(`e.visitas > 0`);
  return { conds, vals };
}

export const FILA_EMPRESA = `e.ruc, e.nombre, e.departamento, e.objeto, e.estado_sunat AS "estadoSunat",
  e.adj_procesos AS "adjProcesos", e.adj_monto::float AS "adjMonto", e.cons_procesos AS "consProcesos", e.cons_monto::float AS "consMonto",
  e.adj_dudosos AS "adjDudosos", e.ord_n AS "ordN", e.ord_monto::float AS "ordMonto", e.ord_dudosas AS "ordDudosas",
  e.entidades, e.postulaciones, e.ganadas, to_char(e.primera, 'YYYY-MM-DD') AS primera, to_char(e.ultima, 'YYYY-MM-DD') AS ultima,
  e.visitas, e.inhabilitada, to_char(e.inhabilitada_hasta, 'YYYY-MM-DD') AS "inhabilitadaHasta",
  e.puntaje, e.nivel, e.tipos, e.n_alta AS "nAlta", e.n_media AS "nMedia", e.n_baja AS "nBaja",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', t.tipo, 'severidad', (ARRAY['alta', 'media', 'baja'])[t.r + 1]) ORDER BY t.r, t.pts DESC)
              FROM (SELECT c->>'tipo' AS tipo, min(CASE c->>'severidad' WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END) AS r,
                           sum((c->>'puntos')::numeric) AS pts
                      FROM jsonb_array_elements(e.antecedentes) g, jsonb_array_elements(g->'cruces') c GROUP BY 1) t), '[]') AS cruces`;

async function resumen(conds: string[], vals: unknown[]) {
  const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await pool.query(
    `WITH s AS MATERIALIZED (SELECT e.ruc, e.nivel, e.tipos, e.departamento, e.objeto, e.inhabilitada, e.visitas, e.adj_monto, e.cons_monto,
                                    e.ord_monto, e.adj_dudosos, e.adj_monto_dudoso, e.ord_dudosas, e.ord_monto_dudoso
                               FROM empresa_resumen e ${donde})
     SELECT (SELECT count(*) FROM s)::int AS empresas,
            (SELECT COALESCE(sum(adj_monto), 0) FROM s)::float AS "adjMonto",
            (SELECT COALESCE(sum(cons_monto), 0) FROM s)::float AS "consMonto",
            (SELECT COALESCE(sum(ord_monto), 0) FROM s)::float AS "ordMonto",
            (SELECT count(*) FROM s WHERE inhabilitada IS NOT NULL)::int AS inhabilitadas,
            (SELECT count(*) FROM s WHERE visitas > 0)::int AS "conVisitas",
            (SELECT jsonb_build_object('procesos', COALESCE(sum(adj_dudosos), 0), 'monto', COALESCE(sum(adj_monto_dudoso), 0),
                                       'ordenes', COALESCE(sum(ord_dudosas), 0), 'montoOrdenes', COALESCE(sum(ord_monto_dudoso), 0)) FROM s) AS dudosos,
            COALESCE((SELECT jsonb_object_agg(nivel, n) FROM (SELECT nivel, count(*)::int AS n FROM s GROUP BY 1) x), '{}') AS "porNivel",
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT t AS tipo, count(*)::int AS n FROM s, unnest(s.tipos) t GROUP BY t) x), '[]') AS "porTipo",
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT departamento, count(*)::int AS n FROM s WHERE departamento IS NOT NULL GROUP BY 1) x), '[]') AS "porDepartamento",
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT objeto, count(*)::int AS n FROM s WHERE objeto IS NOT NULL GROUP BY 1) x), '[]') AS "porObjeto"`,
    vals);
  const fila = r.rows[0];
  return { ...fila, porTipo: (fila.porTipo as { tipo: string; n: number }[]).map((t) => ({ ...t, etiqueta: ETIQUETA_CRUCE[t.tipo] ?? t.tipo })) };
}

empresasRouter.get("/", async (c) => {
  const parsed = Lista.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await listaMemo.obtener(JSON.stringify(q), async () => {
    const { conds, vals } = filtros(q);
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [filas, rs] = await Promise.all([
      q.size === 0 ? null : pool.query(
        `SELECT ${FILA_EMPRESA} FROM empresa_resumen e ${donde}
          ORDER BY ${ORDEN[q.orden]}, e.ruc LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, vals),
      resumen(conds, vals),
    ]);
    return publicar({ total: rs.empresas, page: q.page, size: q.size, data: filas?.rows.map(conNombre) ?? [], resumen: rs });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const conNombre = <T extends { nombre?: string | null }>(f: T): T => ({ ...f, nombre: f.nombre ? conEnie(f.nombre) : f.nombre });

// ─── GET /empresas/reglas ───────────────────────────────────────────────────────────────────────
empresasRouter.get("/reglas", async (c) => {
  const cuerpo = await fichaMemo.obtener("reglas", async () => {
    const [g, r] = await Promise.all([
      pool.query(`SELECT grupo, titulo, explica, tope FROM empresa_puntaje_grupo ORDER BY orden`),
      pool.query(`SELECT tipo, severidad, grupo, puntos::float AS puntos FROM empresa_puntaje_regla ORDER BY grupo, tipo,
                         CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END`),
    ]);
    return {
      niveles: [
        { nivel: "alto", desde: 50 }, { nivel: "medio", desde: 20 }, { nivel: "bajo", desde: 1 }, { nivel: "sin", desde: 0 },
      ],
      grupos: g.rows.map((x) => ({
        ...x,
        reglas: r.rows.filter((y) => y.grupo === x.grupo).map((y) => ({ tipo: y.tipo, severidad: y.severidad, puntos: y.puntos, etiqueta: ETIQUETA_CRUCE[y.tipo] ?? y.tipo })),
      })),
    };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc ─────────────────────────────────────────────────────────────────────────
empresasRouter.get("/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!RUC_EMPRESA.test(ruc)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await fichaMemo.obtener(`ficha:${ruc}`, async () => {
    const [e, grupos, anual] = await Promise.all([
      pool.query(
        `SELECT ${FILA_EMPRESA}, e.adj_monto_dudoso::float AS "adjMontoDudoso", e.adj_otra_moneda AS "adjOtraMoneda",
                e.ord_monto_dudoso::float AS "ordMontoDudoso", to_char(e.fecha_alta, 'YYYY-MM-DD') AS "fechaAlta", e.domicilio,
                e.actividad, e.socios, e.representantes, e.directivos, e.vinculadas, e.visitas_clientes AS "visitasClientes",
                e.antecedentes, to_char(e.actualizado, 'YYYY-MM-DD') AS actualizado
           FROM empresa_resumen e WHERE e.ruc = $1`, [ruc]),
      pool.query(`SELECT grupo, titulo, explica, tope FROM empresa_puntaje_grupo ORDER BY orden`),
      // Año por año: lo adjudicado (sola y en consorcio, en soles y sin lo dudoso) y lo pagado por órdenes.
      pool.query(
        `WITH a AS (
           SELECT false AS cons, a.codigo_convocatoria, a.entidad_ruc, a.fecha_buenapro, a.monto_adjudicado, a.moneda
             FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1
           UNION ALL
           SELECT true, a.codigo_convocatoria, a.entidad_ruc, a.fecha_buenapro, a.monto_adjudicado, a.moneda
             FROM conosce_adjudicaciones a
            WHERE a.ruc_proveedor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1)
              AND a.ruc_proveedor !~ '^(10|20)[0-9]{9}$'
         ), pr AS (
           -- Cada proceso una vez (el año de su buena pro), y si su monto parece mal cargado: ése no se suma.
           SELECT codigo_convocatoria, entidad_ruc, cons, extract(year FROM max(fecha_buenapro))::int AS anio,
                  sum(monto_adjudicado) FILTER (WHERE moneda IN ${SOLES}) AS monto
             FROM a GROUP BY 1, 2, 3 HAVING max(fecha_buenapro) IS NOT NULL
         ), ad AS (
           SELECT anio, count(*) FILTER (WHERE NOT cons)::int AS contratos,
                  COALESCE(sum(monto) FILTER (WHERE NOT cons AND NOT dud), 0)::float AS adjudicado,
                  count(*) FILTER (WHERE cons)::int AS "enConsorcio",
                  COALESCE(sum(monto) FILTER (WHERE cons AND NOT dud), 0)::float AS "adjudicadoConsorcio",
                  count(*) FILTER (WHERE dud)::int AS "contratosDudosos", COALESCE(sum(monto) FILTER (WHERE dud), 0)::float AS "adjudicadoDudoso"
             FROM pr CROSS JOIN LATERAL (SELECT ${DUDOSO_ADJ("pr")} AS dud) d GROUP BY anio
         ), o AS (
           SELECT anio, sum(ordenes)::int AS ordenes, sum(monto)::float AS ordenado, sum(dudosas)::int AS dudosas, sum(monto_dudoso)::float AS "ordenadoDudoso"
             FROM empresa_orden_anual WHERE ruc = $1 GROUP BY anio
         )
         SELECT COALESCE(ad.anio, o.anio) AS anio, COALESCE(ad.contratos, 0) AS contratos, COALESCE(ad.adjudicado, 0) AS adjudicado,
                COALESCE(ad."enConsorcio", 0) AS "enConsorcio", COALESCE(ad."adjudicadoConsorcio", 0) AS "adjudicadoConsorcio",
                COALESCE(ad."contratosDudosos", 0) AS "contratosDudosos", COALESCE(ad."adjudicadoDudoso", 0) AS "adjudicadoDudoso",
                COALESCE(o.ordenes, 0) AS ordenes, COALESCE(o.ordenado, 0) AS ordenado, COALESCE(o.dudosas, 0) AS dudosas,
                COALESCE(o."ordenadoDudoso", 0) AS "ordenadoDudoso"
           FROM ad FULL JOIN o ON o.anio = ad.anio ORDER BY 1`, [ruc]),
    ]);
    const fila = e.rows[0];
    if (!fila) return null;
    const titulo = new Map(grupos.rows.map((g) => [g.grupo, g]));
    const antecedentes = (fila.antecedentes as { grupo: string; puntos: number; tope: number; cruces: { tipo: string; severidad: string; n: number; puntos: number }[] }[])
      .map((g) => ({
        ...g, puntos: Number(g.puntos), titulo: titulo.get(g.grupo)?.titulo ?? g.grupo, explica: titulo.get(g.grupo)?.explica ?? null,
        cruces: g.cruces.map((x) => ({ ...x, puntos: Number(x.puntos), etiqueta: ETIQUETA_CRUCE[x.tipo] ?? x.tipo })),
      }));
    return publicar({ empresa: conNombre({ ...fila, antecedentes: undefined }), antecedentes, anual: anual.rows });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * El proceso de un ítem adjudicado tiene un monto que parece mal cargado (la regla de los contratos, migración 102):
 * la adjudicación más grande es 20 veces el referencial de todo el proceso y pasa S/ 1 M, o el referencial es de
 * S/ 1 o menos y la adjudicación pasa S/ 100 mil. `t` es el alias de la fila de conosce_adjudicaciones.
 */
const DUDOSO_ADJ = (t: string) => `EXISTS (
  SELECT 1 FROM (SELECT sum(ref) AS ref, max(adj) AS adj
                   FROM (SELECT x.n_item, max(x.monto_referencial) AS ref, max(x.monto_adjudicado) AS adj
                           FROM conosce_adjudicaciones x
                          WHERE x.codigo_convocatoria = ${t}.codigo_convocatoria AND x.entidad_ruc = ${t}.entidad_ruc AND x.moneda IN ${SOLES}
                          GROUP BY x.n_item) i) p
   WHERE p.ref > 0 AND ((p.ref <= 1 AND p.adj > 100000) OR (p.ref > 1 AND p.adj >= 20 * p.ref AND p.adj > 1000000)))`;

/** El motivo, si el proceso tiene un monto que parece mal cargado (la misma regla que DUDOSO_ADJ); null si no. */
const MOTIVO_ADJ = (t: string) => `(
  SELECT CASE WHEN p.ref <= 1 THEN 'referencial_simbolico' ELSE 'adjudicado_20x' END
    FROM (SELECT sum(ref) AS ref, max(adj) AS adj
            FROM (SELECT x.n_item, max(x.monto_referencial) AS ref, max(x.monto_adjudicado) AS adj
                    FROM conosce_adjudicaciones x
                   WHERE x.codigo_convocatoria = ${t}.codigo_convocatoria AND x.entidad_ruc = ${t}.entidad_ruc AND x.moneda IN ${SOLES}
                   GROUP BY x.n_item) i) p
   WHERE p.ref > 0 AND ((p.ref <= 1 AND p.adj > 100000) OR (p.ref > 1 AND p.adj >= 20 * p.ref AND p.adj > 1000000)))`;

/** La empresa existe en el resumen (las subrutas responden 404 si no). */
async function existe(ruc: string): Promise<{ nombre: string } | null> {
  if (!RUC_EMPRESA.test(ruc)) return null;
  const r = await pool.query<{ nombre: string }>(`SELECT nombre FROM empresa_resumen WHERE ruc = $1`, [ruc]);
  return r.rows[0] ?? null;
}

// ─── GET /empresas/:ruc/contratos ───────────────────────────────────────────────────────────────
const Contratos = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2015).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  como: z.enum(["sola", "consorcio"]).optional(),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

empresasRouter.get("/:ruc/contratos", async (c) => {
  const ruc = c.req.param("ruc");
  const parsed = Contratos.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await fichaMemo.obtener(`contratos:${ruc}:${JSON.stringify(q)}`, async () => {
    if (!(await existe(ruc))) return null;
    const vals: unknown[] = [ruc];
    const conds: string[] = [];
    if (q.anio) { vals.push(q.anio); conds.push(`extract(year FROM p.fecha) = $${vals.length}`); }
    if (q.entidad) { vals.push(q.entidad); conds.push(`p.entidad_ruc = $${vals.length}`); }
    if (q.como) conds.push(q.como === "consorcio" ? `p.consorcio IS NOT NULL` : `p.consorcio IS NULL`);
    for (const w of palabrasBusqueda(q.q)) {
      vals.push(`%${w}%`);
      conds.push(`mef_norm(concat_ws(' ', p.descripcion, p.entidad, p.nomenclatura, p.codigo, p.consorcio)) LIKE $${vals.length}`);
    }
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // Cada proceso una vez, con sus ítems sumados; el monto en soles (otra moneda, aparte). Después, sólo para la página:
    // si el monto parece mal cargado, el OCID para abrir su ficha y los antecedentes de la empresa en ese proceso.
    const r = await pool.query(
      `WITH a AS (
         SELECT a.*, NULL::text AS consorcio, NULL::text AS ruc_consorcio FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1
         UNION ALL
         SELECT a.*, a.proveedor, a.ruc_proveedor FROM conosce_adjudicaciones a
          WHERE a.ruc_proveedor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1) AND a.ruc_proveedor !~ '^(10|20)[0-9]{9}$'
       ), p AS (
         SELECT a.codigo_convocatoria AS codigo, a.entidad_ruc, max(a.entidad) AS entidad, max(a.entidad_departamento) AS departamento,
                max(a.objeto) AS objeto, max(a.tipo_proceso) AS "tipoProceso", max(a.nomenclatura) AS nomenclatura,
                max(a.descripcion_proceso) AS descripcion, max(a.fecha_buenapro) AS fecha, count(*)::int AS items,
                sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ${SOLES}) AS monto,
                sum(a.monto_adjudicado) FILTER (WHERE a.moneda NOT IN ${SOLES}) AS "montoOtraMoneda",
                max(a.moneda) FILTER (WHERE a.moneda NOT IN ${SOLES}) AS "otraMoneda",
                max(a.consorcio) AS consorcio, max(a.ruc_consorcio) AS ruc_consorcio
           FROM a GROUP BY a.codigo_convocatoria, a.entidad_ruc
       ), pag AS (
         SELECT p.*, count(*) OVER ()::int AS total FROM p ${donde}
          ORDER BY p.fecha DESC NULLS LAST, p.codigo DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}
       )
       SELECT pag.codigo, pag.entidad_ruc AS "entidadRuc", pag.entidad, pag.departamento, pag.objeto, pag."tipoProceso", pag.nomenclatura,
              pag.descripcion, to_char(pag.fecha, 'YYYY-MM-DD') AS fecha, pag.items, pag.monto::float AS monto,
              pag."montoOtraMoneda"::float AS "montoOtraMoneda", pag."otraMoneda", pag.consorcio, pag.total,
              ${MOTIVO_ADJ("pag2")} AS dudoso, cv.ocid, k.cruces AS antecedentes
         FROM pag
         CROSS JOIN LATERAL (SELECT pag.codigo AS codigo_convocatoria, pag.entidad_ruc) pag2
         LEFT JOIN LATERAL (SELECT c.ocid FROM convocatorias c WHERE c.codigo = pag.codigo AND c.entidad_ruc = pag.entidad_ruc LIMIT 1) cv ON true
         LEFT JOIN casos_cruce k ON k.ocid = cv.ocid AND k.ruc = $1
        ORDER BY pag.fecha DESC NULLS LAST, pag.codigo DESC`, vals);
    const total = r.rows[0]?.total ?? 0;
    return publicar({
      total, page: q.page, size: q.size,
      data: r.rows.map(({ total: _t, antecedentes, ...f }) => ({
        // casos_cruce.cruces: [{tipo, severidad, n}] (migración 57), los graves primero.
        ...f, antecedentes: ((antecedentes as { tipo: string; severidad: string }[] | null) ?? [])
          .map((t) => ({ tipo: t.tipo, severidad: t.severidad, etiqueta: ETIQUETA_CRUCE[t.tipo] ?? t.tipo }))
          .sort((a, b) => "amb".indexOf(a.severidad[0]) - "amb".indexOf(b.severidad[0])),
      })),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/ordenes ─────────────────────────────────────────────────────────────────
const Ordenes = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  tipo: z.enum(["compra", "servicio"]).optional(),
  dudosa: z.enum(["si"]).optional(),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

empresasRouter.get("/:ruc/ordenes", async (c) => {
  const ruc = c.req.param("ruc");
  const parsed = Ordenes.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await fichaMemo.obtener(`ordenes:${ruc}:${JSON.stringify(q)}`, async () => {
    if (!(await existe(ruc))) return null;
    const vals: unknown[] = [ruc];
    // Como empresa_orden_anual: en soles, sin las anuladas; las de monto dudoso se muestran con su monto original.
    const conds = [`o.ruc_contratista = $1`, `o.moneda = 'Nuevos Soles'`, `o.estado IS DISTINCT FROM 'Anulada'`, `(o.monto > 0 OR o.monto_dudoso IS NOT NULL)`];
    if (q.entidad) { vals.push(q.entidad); conds.push(`o.entidad_ruc = $${vals.length}`); }
    if (q.anio) { vals.push(q.anio); conds.push(`o.fecha_emision >= make_date($${vals.length}, 1, 1) AND o.fecha_emision < make_date($${vals.length} + 1, 1, 1)`); }
    if (q.tipo) conds.push(q.tipo === "compra" ? `o.tipo_orden ILIKE '%compra%'` : `o.tipo_orden NOT ILIKE '%compra%'`);
    if (q.dudosa) conds.push(`o.monto_dudoso IS NOT NULL`);
    for (const w of palabrasBusqueda(q.q)) {
      vals.push(`%${w}%`);
      conds.push(`mef_norm(COALESCE(o.descripcion, '') || ' ' || COALESCE(o.entidad, '') || ' ' || COALESCE(o.nro_orden, '')) LIKE $${vals.length}`);
    }
    const r = await pool.query(
      `WITH o AS (
         SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.*
           FROM conosce_ordenes o WHERE ${conds.join(" AND ")}
          ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
       SELECT to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.entidad, o.entidad_ruc AS "entidadRuc", o.nro_orden AS numero,
              o.orden, o.tipo_orden AS "tipoOrden", o.descripcion, COALESCE(o.monto, o.monto_dudoso)::float AS monto,
              o.monto_dudoso::float AS "montoDudoso", o.dudoso_motivo AS "dudosoMotivo", o.tipo_contratacion AS "tipoContratacion",
              o.estado, count(*) OVER ()::int AS total
         FROM o ORDER BY o.fecha_emision DESC, o.orden DESC
        LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, vals);
    const total = r.rows[0]?.total ?? 0;
    return publicar({ total, page: q.page, size: q.size, data: r.rows.map(({ total: _t, ...f }) => f) });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/clientes ────────────────────────────────────────────────────────────────
empresasRouter.get("/:ruc/clientes", async (c) => {
  const ruc = c.req.param("ruc");
  const cuerpo = await fichaMemo.obtener(`clientes:${ruc}`, async () => {
    if (!(await existe(ruc))) return null;
    // Cada entidad con lo que le adjudicó (sola o en consorcio) y lo que le compró por órdenes, y las visitas de la gente
    // de la empresa a esa entidad. Todas: la web las pagina y las busca.
    const r = await pool.query(
      `WITH a AS (
         SELECT a.entidad_ruc, a.entidad, a.entidad_departamento AS departamento, a.codigo_convocatoria, a.fecha_buenapro,
                CASE WHEN a.moneda IN ${SOLES} THEN a.monto_adjudicado END AS monto, false AS cons
           FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1
         UNION ALL
         SELECT a.entidad_ruc, a.entidad, a.entidad_departamento, a.codigo_convocatoria, a.fecha_buenapro,
                CASE WHEN a.moneda IN ${SOLES} THEN a.monto_adjudicado END, true
           FROM conosce_adjudicaciones a
          WHERE a.ruc_proveedor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1) AND a.ruc_proveedor !~ '^(10|20)[0-9]{9}$'
       ), ad AS (
         SELECT entidad_ruc, max(entidad) AS entidad, max(departamento) AS departamento,
                count(DISTINCT codigo_convocatoria)::int AS contratos, COALESCE(sum(monto), 0)::float AS adjudicado,
                bool_or(cons) AS consorcio, min(fecha_buenapro) AS primera, max(fecha_buenapro) AS ultima
           FROM a WHERE entidad_ruc IS NOT NULL GROUP BY entidad_ruc
       ), o AS (
         SELECT entidad_ruc, max(entidad) AS entidad, max(departamento) AS departamento, sum(ordenes)::int AS ordenes,
                sum(monto)::float AS ordenado, sum(dudosas)::int AS dudosas, min(primera) AS primera, max(ultima) AS ultima
           FROM empresa_orden_anual WHERE ruc = $1 GROUP BY entidad_ruc
       ), v AS (
         SELECT entidad_ruc, count(*)::int AS visitas FROM empresa_visita WHERE ruc = $1 AND entidad_ruc IS NOT NULL GROUP BY entidad_ruc
       )
       SELECT COALESCE(ad.entidad_ruc, o.entidad_ruc) AS "entidadRuc", COALESCE(ad.entidad, o.entidad) AS entidad,
              COALESCE(ad.departamento, o.departamento) AS departamento, COALESCE(ad.contratos, 0) AS contratos,
              COALESCE(ad.adjudicado, 0) AS adjudicado, COALESCE(ad.consorcio, false) AS consorcio, COALESCE(o.ordenes, 0) AS ordenes,
              COALESCE(o.ordenado, 0) AS ordenado, COALESCE(o.dudosas, 0) AS dudosas, COALESCE(v.visitas, 0) AS visitas,
              to_char(least(ad.primera, o.primera), 'YYYY-MM-DD') AS primera, to_char(greatest(ad.ultima, o.ultima), 'YYYY-MM-DD') AS ultima
         FROM ad FULL JOIN o ON o.entidad_ruc = ad.entidad_ruc
         LEFT JOIN v ON v.entidad_ruc = COALESCE(ad.entidad_ruc, o.entidad_ruc)
        ORDER BY COALESCE(ad.adjudicado, 0) + COALESCE(o.ordenado, 0) DESC
        LIMIT 5000`, [ruc]);
    return publicar({ total: r.rows.length, data: r.rows });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/postulaciones ───────────────────────────────────────────────────────────
const Postulaciones = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  resultado: z.enum(["gano", "perdio"]).optional(),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

empresasRouter.get("/:ruc/postulaciones", async (c) => {
  const ruc = c.req.param("ruc");
  const parsed = Postulaciones.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await fichaMemo.obtener(`postulaciones:${ruc}:${JSON.stringify(q)}`, async () => {
    if (!(await existe(ruc))) return null;
    const vals: unknown[] = [ruc];
    const conds: string[] = [];
    if (q.resultado) conds.push(q.resultado === "gano" ? `g.gano` : `NOT g.gano`);
    for (const w of palabrasBusqueda(q.q)) {
      vals.push(`%${w}%`);
      conds.push(`mef_norm(concat_ws(' ', g.descripcion, g.entidad, g.codigo, g.consorcio)) LIKE $${vals.length}`);
    }
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // Los procesos en que fue postor (sola o en un consorcio) y, de cada uno, quién ganó: con su RUC si es una empresa.
    const r = await pool.query(
      `WITH p AS (
         SELECT p.codigo_convocatoria AS codigo, min(p.fecha_propuesta) AS fecha, max(p.fecha_convocatoria) AS convocatoria,
                max(CASE WHEN p.ruc_postor <> $1 THEN p.postor END) AS consorcio,
                array_agg(DISTINCT p.ruc_postor) AS postores
           FROM conosce_postores p
          WHERE p.ruc_postor = $1
             OR (p.ruc_postor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1) AND p.ruc_postor !~ '^(10|20)[0-9]{9}$')
          GROUP BY p.codigo_convocatoria
       ), g AS (
         SELECT p.*, w.entidad, w.entidad_ruc, w.descripcion, w.objeto, w.ganadores, w.monto, COALESCE(w.gano, false) AS gano
           FROM p
           LEFT JOIN LATERAL (
             SELECT max(a.entidad) AS entidad, max(a.entidad_ruc) AS entidad_ruc, max(a.descripcion_proceso) AS descripcion, max(a.objeto) AS objeto,
                    jsonb_agg(DISTINCT jsonb_build_object('ruc', CASE WHEN a.ruc_proveedor ~ '^20[0-9]{9}$' THEN a.ruc_proveedor END,
                                                          'nombre', a.proveedor)) AS ganadores,
                    sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ${SOLES}) AS monto,
                    bool_or(a.ruc_proveedor = ANY (p.postores)) AS gano
               FROM conosce_adjudicaciones a WHERE a.codigo_convocatoria = p.codigo) w ON true
       )
       SELECT g.codigo, to_char(COALESCE(g.fecha, g.convocatoria), 'YYYY-MM-DD') AS fecha, g.entidad, g.entidad_ruc AS "entidadRuc",
              g.descripcion, g.objeto, g.consorcio, g.gano, g.ganadores, g.monto::float AS monto, count(*) OVER ()::int AS total,
              count(*) FILTER (WHERE g.gano) OVER ()::int AS ganadas
         FROM g ${donde}
        ORDER BY COALESCE(g.fecha, g.convocatoria) DESC NULLS LAST, g.codigo DESC
        LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, vals);
    const total = r.rows[0]?.total ?? 0;
    return publicar({
      total, ganadas: r.rows[0]?.ganadas ?? 0, page: q.page, size: q.size,
      data: r.rows.map(({ total: _t, ganadas: _g, ganadores, ...f }) => ({
        ...f,
        // Un ganador sin nada (el proceso no tiene adjudicación cargada) no se lista.
        ganadores: ((ganadores as { ruc: string | null; nombre: string | null }[] | null) ?? []).filter((x) => x.nombre || x.ruc),
      })),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/antecedentes ────────────────────────────────────────────────────────────
empresasRouter.get("/:ruc/antecedentes", async (c) => {
  const ruc = c.req.param("ruc");
  const cuerpo = await fichaMemo.obtener(`antecedentes:${ruc}`, async () => {
    if (!(await existe(ruc))) return null;
    // Cada cruce con su fuente; si es de un proceso, el código y la entidad para abrir su ficha (allí está la evidencia).
    const r = await pool.query(
      `SELECT p.tipo, p.ruc_empresa, p.ocid, p.severidad, p.fecha, p.monto, p.persona_nombre, p.persona_rol, p.detalle, p.fuente, p.fuente_url,
              r.grupo, r.puntos::float AS puntos, cv.codigo, cv.entidad
         FROM cruces_proveedor p
         LEFT JOIN empresa_puntaje_regla r ON r.tipo = p.tipo AND r.severidad = p.severidad
         LEFT JOIN LATERAL (SELECT c.codigo, e.nombre AS entidad FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
                             WHERE p.ocid IS NOT NULL AND c.ocid = p.ocid LIMIT 1) cv ON true
        WHERE p.ruc_empresa = $1
        ORDER BY CASE p.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, p.tipo, p.fecha DESC NULLS LAST
        LIMIT 2000`, [ruc]);
    return publicar({
      total: r.rows.length,
      data: r.rows.map((x) => ({ ...aCruce(x), grupo: x.grupo ?? null, puntos: x.puntos ?? 0, codigo: x.codigo ?? null, entidad: x.entidad ?? null })),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/socios ──────────────────────────────────────────────────────────────────
const ROL: Record<string, string> = {
  SOCIO_ACCIONISTA_TITULAR: "socio",
  REPRESENTANTE_LEGAL: "representante legal",
  ORGANO_ADMINISTRACION: "directivo",
};

empresasRouter.get("/:ruc/socios", async (c) => {
  const ruc = c.req.param("ruc");
  const cuerpo = await fichaMemo.obtener(`socios:${ruc}`, async () => {
    if (!(await existe(ruc))) return null;
    const [socios, vinculadas, sociaDe] = await Promise.all([
      // Cada persona una vez, con todos sus papeles. Una empresa socia sale con su RUC (las empresas son públicas).
      pool.query(
        `SELECT max(r.nombre) AS nombre, array_agg(DISTINCT r.tipo_rol) AS roles, to_char(min(r.fecha_inicio_vigencia), 'YYYY-MM-DD') AS desde,
                bool_or(r.tipo_documento = 'REG. UNICO DE CONTRIBUYENTES') AS es_empresa,
                CASE WHEN bool_or(r.tipo_documento = 'REG. UNICO DE CONTRIBUYENTES') AND max(r.numero_documento) ~ '^20[0-9]{9}$'
                     THEN max(r.numero_documento) END AS ruc,
                max(r.forma_societaria) AS forma, to_char(max(r.fecha_corte), 'YYYY-MM-DD') AS corte,
                (SELECT count(DISTINCT r2.ruc_empresa)::int FROM rnp_conformacion_juridica r2
                  WHERE r2.numero_documento = r.numero_documento AND r2.ruc_empresa <> $1 AND r2.ruc_empresa LIKE '20%') AS "otrasEmpresas"
           FROM rnp_conformacion_juridica r WHERE r.ruc_empresa = $1 AND r.numero_documento IS NOT NULL
          GROUP BY r.numero_documento
          ORDER BY bool_or(r.tipo_rol = 'REPRESENTANTE_LEGAL') DESC, bool_or(r.tipo_rol = 'SOCIO_ACCIONISTA_TITULAR') DESC, max(r.nombre)`, [ruc]),
      // Otras empresas con alguien en común, y quiénes: cada persona una vez, con sus papeles aquí y allá.
      pool.query(
        `WITH par AS (
           SELECT r2.ruc_empresa::text AS ruc, r1.numero_documento AS doc, max(r1.nombre) AS nombre,
                  array_agg(DISTINCT r1.tipo_rol) AS aqui, array_agg(DISTINCT r2.tipo_rol) AS alla
             FROM rnp_conformacion_juridica r1
             JOIN rnp_conformacion_juridica r2 ON r2.numero_documento = r1.numero_documento AND r2.ruc_empresa <> r1.ruc_empresa
            WHERE r1.ruc_empresa = $1 AND r2.ruc_empresa LIKE '20%'
            GROUP BY 1, 2)
         SELECT par.ruc, e.nombre, e.puntaje, e.nivel, e.inhabilitada, (e.adj_monto + e.ord_monto)::float AS monto,
                (e.adj_procesos + e.cons_procesos) AS contratos,
                jsonb_agg(jsonb_build_object('nombre', par.nombre, 'aqui', par.aqui, 'alla', par.alla) ORDER BY par.nombre) AS socios
           FROM par LEFT JOIN empresa_resumen e ON e.ruc = par.ruc
          GROUP BY par.ruc, e.nombre, e.puntaje, e.nivel, e.inhabilitada, e.adj_monto, e.ord_monto, e.adj_procesos, e.cons_procesos
          ORDER BY COALESCE(e.puntaje, 0) DESC, COALESCE(e.adj_monto + e.ord_monto, 0) DESC
          LIMIT 500`, [ruc]),
      // Las empresas de las que esta es socia.
      pool.query(
        `SELECT r.ruc_empresa::text AS ruc, e.nombre, e.puntaje, e.nivel, array_agg(DISTINCT r.tipo_rol) AS roles
           FROM rnp_conformacion_juridica r LEFT JOIN empresa_resumen e ON e.ruc = r.ruc_empresa::text
          WHERE r.numero_documento = $1 GROUP BY r.ruc_empresa, e.nombre, e.puntaje, e.nivel ORDER BY e.nombre`, [ruc]),
    ]);
    const roles = (rs: string[] | null) => (rs ?? []).map((x) => ROL[x] ?? x.toLowerCase().replace(/_/g, " "));
    return publicar({
      // Las personas bajo `socios` (publicar() les tapa un apellido, en orden SUNAT); las empresas socias, aparte y completas.
      socios: socios.rows.filter((s) => !s.es_empresa).map((s) => ({ nombre: s.nombre, roles: roles(s.roles), desde: s.desde, otrasEmpresas: s.otrasEmpresas })),
      empresasSocias: socios.rows.filter((s) => s.es_empresa).map((s) => ({ ruc: s.ruc, nombre: s.nombre, roles: roles(s.roles), desde: s.desde })),
      sociaDe: sociaDe.rows.map((s) => ({ ...s, roles: roles(s.roles) })),
      corte: socios.rows[0]?.corte ?? null,
      vinculadas: vinculadas.rows.map((v) => ({
        ruc: v.ruc, nombre: v.nombre ?? null, puntaje: v.puntaje ?? null, nivel: v.nivel ?? null, inhabilitada: v.inhabilitada ?? null,
        monto: v.monto ?? 0, contratos: v.contratos ?? 0,
        socios: (v.socios as { nombre: string; aqui: string[]; alla: string[] }[]).map((s) => ({ nombre: s.nombre, roles: roles(s.aqui), rolesAlla: roles(s.alla) })),
      })),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/visitas ─────────────────────────────────────────────────────────────────
const VIA: Record<string, string> = {
  socio: "socio", representante: "representante legal", directivo: "directivo", nombre: "dijo venir de la empresa",
};

empresasRouter.get("/:ruc/visitas", async (c) => {
  const ruc = c.req.param("ruc");
  const cuerpo = await fichaMemo.obtener(`visitas:${ruc}`, async () => {
    if (!(await existe(ruc))) return null;
    // Si la entidad visitada le adjudicó o le compró algo, lo primero que le dio después de la visita (y cuánto después).
    const r = await pool.query(
      `SELECT to_char(v.fecha_visita, 'YYYY-MM-DD') AS fecha, v.entidad_visitada AS entidad, ev.entidad_ruc AS "entidadRuc", ev.via,
              v.visitante, v.funcionario_nombre AS funcionario, v.funcionario_cargo AS "cargoFuncionario", v.funcionario_area AS area,
              v.motivo, v.lugar_especifico AS lugar, v.entidad_visitante AS "entidadDeclarada", v.fuente,
              to_char(LEAST(ad.f, od.f), 'YYYY-MM-DD') AS "despues", (LEAST(ad.f, od.f) - v.fecha_visita) AS "diasDespues",
              CASE WHEN ad.f IS NOT NULL AND (od.f IS NULL OR ad.f <= od.f) THEN 'contrato' WHEN od.f IS NOT NULL THEN 'orden' END AS "despuesTipo"
         FROM empresa_visita ev
         JOIN visitas_entidades v ON v.id = ev.visita_id
         LEFT JOIN LATERAL (SELECT min(a.fecha_buenapro) AS f FROM conosce_adjudicaciones a
                             WHERE ev.entidad_ruc IS NOT NULL AND a.ruc_proveedor = $1 AND a.entidad_ruc = ev.entidad_ruc
                               AND a.fecha_buenapro >= v.fecha_visita) ad ON true
         LEFT JOIN LATERAL (SELECT min(o.fecha_emision) AS f FROM conosce_ordenes o
                             WHERE ev.entidad_ruc IS NOT NULL AND o.entidad_ruc = ev.entidad_ruc AND o.ruc_contratista = $1
                               AND o.fecha_emision >= v.fecha_visita) od ON true
        WHERE ev.ruc = $1
        ORDER BY v.fecha_visita DESC NULLS LAST, v.id DESC
        LIMIT 3000`, [ruc]);
    return publicar({
      total: r.rows.length,
      // Bajo `visitas`: publicar() le tapa un apellido al visitante y al funcionario.
      visitas: r.rows.map((v) => ({ ...v, via: VIA[v.via] ?? v.via, diasDespues: v.diasDespues == null ? null : Number(v.diasDespues) })),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
