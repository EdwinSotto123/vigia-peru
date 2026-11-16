/**
 * Patrones para quien investiga (migración 276):
 *
 *   GET /patrones?alcance=entidad|proveedor&ruc=&regla=&page=&size=
 *       Señales de los agentes que se REPITEN. Por entidad: la señal está en una parte de sus contratos leídos que es
 *       el doble de la del país (y al menos el 40 %). Por proveedor: la misma señal de proceso en 3 o más contratos y
 *       2 o más entidades. Cada patrón trae hasta 8 contratos de ejemplo.
 *   GET /patrones/acompanantes?ruc=&solo=fuertes&page=&size=
 *       Postores de relleno: empresas que casi nunca ganan y dedican sus postulaciones a acompañar a un mismo ganador.
 *       Con `ruc`, los de esa empresa (como ganadora y como acompañante); sin él, los pares más fuertes del país.
 *
 *   GET /patrones/consorcios?ruc=&page=&size=
 *       Socios de consorcio que compiten (migración 278): pares de empresas que postularon juntas en un consorcio y
 *       después, por separado, en 3 o más procesos de pocos postores que ganó una de las dos. Primero los más
 *       concentrados (muchos procesos en pocas entidades); al final, marcados, los de mercado nacional (migración 279).
 *
 *   GET /patrones/renovaciones?ruc=&page=&size=
 *       Servicios que una entidad volvió a contratar pagando 30 % o más por mes que en el contrato anterior
 *       (migración 283). Con `ruc`, los de esa entidad o los que ganó esa empresa.
 *   GET /patrones/duenos?ruc=&graves=1&min=   un mismo socio que gana en una entidad con varias empresas (migración 292)
 *   GET /patrones/precios?q=&tipo=bien|servicio&entidad=&anio=
 *       Precios de referencia. `bien`: los productos de los Catálogos de Perú Compras cuya descripción trae las palabras,
 *       con lo que pagaron por ellos 5 entidades o más (cuartil 1, mediana y cuartil 3 por año; sin IGV y con IGV).
 *       `servicio`: el costo MENSUAL de servicios parecidos (monto entre plazo, migración 280), con su contrato.
 *
 * Todo sale de señales y postulaciones ya públicas, sólo de empresas (RUC 20). Un patrón es un motivo para mirar, no una
 * acusación.
 */
import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { nombrePublicable } from "../lib/cruces.js";

export const patronesRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "patrones", ttlMs: 900_000, staleMs: 3_600_000, max: 400 });

const Lista = z.object({
  alcance: z.enum(["entidad", "proveedor"]).default("entidad"),
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  regla: z.string().trim().regex(/^[a-z_0-9]{3,60}$/).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

patronesRouter.get("/", async (c) => {
  const p = Lista.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`lista:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [q.alcance];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds = ["alcance = $1"];
    if (q.ruc) conds.push(`ruc = ${add(q.ruc)}`);
    if (q.regla) conds.push(`regla = ${add(q.regla)}`);
    const donde = conds.join(" AND ");
    const [filas, total, reglas] = await Promise.all([
      pool.query(
        `SELECT ruc, nombre, regla, casos, leidos, entidades, tasa::float AS tasa, tasa_pais::float AS "tasaPais", veces::float AS veces,
                monto::float AS monto, ejemplos, to_char(refrescado_at, 'YYYY-MM-DD') AS "calculadoEl"
           FROM patron_agentes WHERE ${donde}
          ORDER BY veces DESC, casos DESC, ruc LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals),
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM patron_agentes WHERE ${donde}`, vals.slice(0, vals.length - 2)),
      pool.query(`SELECT regla, count(*)::int AS n FROM patron_agentes WHERE alcance = $1 GROUP BY 1 ORDER BY 2 DESC`, [q.alcance]),
    ]);
    return publicar({ total: total.rows[0]?.n ?? 0, page: q.page, size: q.size, porRegla: reglas.rows, data: filas.rows });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Acompanantes = z.object({
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  solo: z.enum(["fuertes", "todos"]).default("fuertes"),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

patronesRouter.get("/acompanantes", async (c) => {
  const p = Acompanantes.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`acomp:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds: string[] = [];
    if (q.ruc) conds.push(`(ruc_ganador = ${add(q.ruc)} OR ruc_acompanante = $${vals.length})`);
    if (q.solo === "fuertes" && !q.ruc) conds.push("fuerte");
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const n = vals.length;
    const [filas, total] = await Promise.all([
      pool.query(
        `SELECT ruc_ganador AS "rucGanador", ganador, ruc_acompanante AS "rucAcompanante", acompanante, juntos, entidades,
                postulo AS "postulacionesDelAcompanante", gano AS "ganadasDelAcompanante", parte::float AS parte,
                to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta, vinculo, fuerte
           FROM postor_acompanante ${donde}
          ORDER BY fuerte DESC, (vinculo IS NOT NULL) DESC, juntos DESC, ruc_ganador LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals),
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM postor_acompanante ${donde}`, vals.slice(0, n)),
    ]);
    return publicar({ total: total.rows[0]?.n ?? 0, page: q.page, size: q.size, data: filas.rows });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Consorcios = z.object({
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

patronesRouter.get("/consorcios", async (c) => {
  const p = Consorcios.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`consorcios:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const donde = q.ruc ? `WHERE ruc_a = ${add(q.ruc)} OR ruc_b = $${vals.length}` : "";
    const n = vals.length;
    const [filas, total] = await Promise.all([
      pool.query(
        `SELECT ruc_a AS "rucA", nombre_a AS "nombreA", ruc_b AS "rucB", nombre_b AS "nombreB", consorcios, rivales, solas,
                gano_a AS "ganoA", gano_b AS "ganoB", entidades, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta,
                amplio AS "mercadoNacional"
           FROM consorcio_rival ${donde}
          ORDER BY amplio, (rivales::float / entidades) DESC, solas DESC, rivales DESC, ruc_a LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals),
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM consorcio_rival ${donde}`, vals.slice(0, n)),
    ]);
    return publicar({ total: total.rows[0]?.n ?? 0, page: q.page, size: q.size, data: filas.rows });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * GET /patrones/duenos?ruc=  Un mismo socio que gana en una entidad con varias empresas, objetos parecidos (migración 292).
 * Una fila por entidad y socio: sus empresas, cuántos contratos y cuántos con 90 días o menos entre uno y otro. Con `ruc`,
 * los de esa entidad o los grupos en que está esa empresa. El socio sale con un apellido tapado y sin documento.
 */
const Duenos = Consorcios.extend({
  /** Sólo grupos con contratos a 90 días o menos entre sí (la forma grave). */
  graves: z.enum(["1", "true"]).optional(),
  /** Mínimo de contratos parecidos del grupo. */
  min: z.coerce.number().int().min(2).max(500).optional(),
});

patronesRouter.get("/duenos", async (c) => {
  const p = Duenos.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`duenos:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    // De la tabla ya agrupada (migración 293). Con RUC: la entidad, o los grupos en que participa esa empresa.
    const conds: string[] = [];
    if (q.ruc) conds.push(`(g.entidad_ruc = ${add(q.ruc)} OR g.rucs @> ARRAY[$${vals.length}])`);
    if (q.graves) conds.push("g.seguidos > 0");
    if (q.min) conds.push(`g.contratos >= ${add(q.min)}`);
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const n = vals.length;
    const [filas, total] = await Promise.all([
      pool.query(
        `SELECT g.entidad_ruc AS "entidadRuc", en.nombre AS entidad, g.nombre, g.contratos, g.seguidos, g.monto::float AS monto,
                to_char(g.desde, 'YYYY-MM-DD') AS desde, to_char(g.hasta, 'YYYY-MM-DD') AS hasta, g.ejemplos, g.empresas
           FROM mismo_dueno_grupo g LEFT JOIN entidades en ON en.ruc = g.entidad_ruc ${donde}
          ORDER BY g.seguidos DESC, g.contratos DESC, g.entidad_ruc LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals),
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM mismo_dueno_grupo g ${donde}`, vals.slice(0, n)),
    ]);
    return publicar({
      total: total.rows[0]?.n ?? 0, page: q.page, size: q.size,
      // `socios` es la forma que `publicar()` ya conoce de los cruces: tapa un apellido.
      data: filas.rows.map(({ nombre, ...x }) => ({ ...x, socios: [{ nombre: nombrePublicable(nombre), rol: "Socio" }] })),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Precios = z.object({
  q: z.string().trim().min(3).max(120),
  tipo: z.enum(["bien", "servicio"]).default("bien"),
  entidad: z.string().regex(/^20\d{9}$/).optional(),
  anio: z.coerce.number().int().min(2017).max(2035).optional(),
});
const IGV = 1.18;

patronesRouter.get("/precios", async (c) => {
  const p = Precios.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  // Todas las palabras (sin tildes, en minúsculas) tienen que estar en la descripción.
  const palabras = [...new Set(q.q.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").split(/\s+/).filter((w) => w.length >= 2))].slice(0, 6);
  if (!palabras.length) return c.json({ error: "invalid_query", detail: "Escribe al menos una palabra." }, 400);
  const pats = palabras.map((w) => `%${w.replace(/[%_\\]/g, "")}%`);
  const cuerpo = await memo.obtener(`precios:${JSON.stringify({ ...q, palabras })}`, async () => {
    if (q.tipo === "bien") {
      const conds = pats.map((_, i) => `f.descripcion_norm LIKE $${i + 2}`).join(" AND ");
      const r = await pool.query(
        `SELECT f.ficha, f.descripcion, f.marca, f.nro_parte AS "nroParte", f.catalogo, r.anio, r.lineas, r.entidades,
                r.p25::float AS p25, r.mediana::float AS mediana, r.p75::float AS p75
           FROM perucompras_ficha f JOIN perucompras_precio_ref r ON r.ficha = f.ficha
          WHERE r.anio >= $1 AND r.mediana > 0 AND ${conds}
          ORDER BY r.anio DESC, r.entidades DESC, r.lineas DESC LIMIT 40`, [q.anio ?? new Date().getFullYear() - 1, ...pats]);
      return publicar({
        tipo: "bien", total: r.rows.length,
        data: r.rows.map((x) => ({ ...x, medianaConIgv: Math.round(x.mediana * IGV * 100) / 100, p25ConIgv: Math.round(x.p25 * IGV * 100) / 100, p75ConIgv: Math.round(x.p75 * IGV * 100) / 100 })),
      });
    }
    const vals: unknown[] = [...pats];
    const conds = pats.map((_, i) => `unaccent(s.objeto_norm) LIKE $${i + 1}`);
    if (q.entidad) { vals.push(q.entidad); conds.push(`s.entidad_ruc = $${vals.length}`); }
    const r = await pool.query<{ costoMensual: number }>(
      `SELECT s.ocid, s.entidad, s.entidad_ruc AS "entidadRuc", s.objeto, to_char(s.fecha, 'YYYY-MM-DD') AS fecha, s.monto::float AS monto,
              s.plazo_dias AS "plazoDias", s.plazo_fuente AS "plazoFuente", s.costo_mensual::float AS "costoMensual", s.tipo
         FROM servicio_costo_mensual s WHERE ${conds.join(" AND ")} ORDER BY s.fecha DESC NULLS LAST LIMIT 60`, vals);
    const cm = r.rows.map((x) => x.costoMensual).sort((a, b) => a - b);
    const pc = (k: number) => (cm.length ? cm[Math.min(cm.length - 1, Math.floor(k * (cm.length - 1) + 0.5))] : null);
    return publicar({ tipo: "servicio", total: r.rows.length, resumen: cm.length >= 5 ? { n: cm.length, p25: pc(0.25), mediana: pc(0.5), p75: pc(0.75) } : null, data: r.rows });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Renovaciones = z.object({
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

patronesRouter.get("/renovaciones", async (c) => {
  const p = Renovaciones.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`renovaciones:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const donde = q.ruc ? `WHERE r.entidad_ruc = ${add(q.ruc)} OR r.proveedor_ruc = $${vals.length}` : "";
    const n = vals.length;
    const [filas, total] = await Promise.all([
      pool.query(
        `SELECT r.ocid, r.ocid_anterior AS "ocidAnterior", r.entidad_ruc AS "entidadRuc", r.entidad, r.objeto, to_char(r.fecha, 'YYYY-MM-DD') AS fecha,
                to_char(r.fecha_anterior, 'YYYY-MM-DD') AS "fechaAnterior", r.monto::float AS monto, r.monto_anterior::float AS "montoAnterior",
                r.plazo_dias AS "plazoDias", r.plazo_anterior AS "plazoAnterior", r.costo_mensual::float AS "costoMensual",
                r.costo_mensual_anterior::float AS "costoMensualAnterior", r.diff_pct::float AS "diffPct", r.similitud::float AS similitud,
                r.exceso::float AS exceso, r.proveedor_ruc AS "proveedorRuc", e.nombre AS proveedor, r.mismo_proveedor AS "mismoProveedor"
           FROM servicio_renovacion r LEFT JOIN empresa_resumen e ON e.ruc = r.proveedor_ruc ${donde}
          ORDER BY r.fecha DESC NULLS LAST, r.diff_pct DESC, r.ocid LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals),
      pool.query<{ n: number; exceso: number | null }>(`SELECT count(*)::int AS n, sum(r.exceso)::float AS exceso FROM servicio_renovacion r ${donde}`, vals.slice(0, n)),
    ]);
    return publicar({ total: total.rows[0]?.n ?? 0, exceso: total.rows[0]?.exceso ?? 0, page: q.page, size: q.size, data: filas.rows });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
