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
 *   GET /patrones/observacion?tipo=&ruc=&page=&size=
 *       Los indicadores EN OBSERVACIÓN (migración 329), contrato por contrato: una reunión con quien decide las compras
 *       mientras se evaluaban las ofertas, visitas «personales» repetidas a quien decide, y ofertas de rivales vinculados
 *       registradas casi a la vez. No entran al riesgo del contrato hasta medir su precisión; aquí está la lista entera
 *       para revisarlos. De quien recibió una visita, sólo el cargo y el área.
 *
 * Todo sale de señales y postulaciones ya públicas, sólo de empresas (RUC 20). Un patrón es un motivo para mirar, no una
 * acusación.
 */
import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { TAPA_NOMBRE, etiquetaParentesco, publicar } from "../lib/privacidad.js";
import { esCargoDeEleccion } from "../lib/electos.js";
import { papelesRnp } from "../lib/familiaFuncionario.js";
import { ETIQUETA_CRUCE, catalogoSenales, nombrePublicable } from "../lib/cruces.js";
import { depurarReferencias } from "../lib/laboratorioPrecios.js";
import { taparNombrePropio } from "./personas.js";
import { casoAutoridad, casoComprasFamilia, casoDueno, casoGrupo, casoInhabilitada, casoRenovacion, sqlClaveAutoridad, sqlClaveRenovacion, casoRecien, casoRelleno, casoRepetida, salDeClaves, sqlClaveInhabilitada, sqlClaveDueno, sqlClaveGrupo, sqlClaveRecien, sqlClaveRelleno, sqlClaveRepetida, type CasoPatron, type Pedir } from "../lib/casoPatron.js";

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
  /** La clave opaca de un caso (su ficha de caso). */
  clave: z.string().regex(/^[0-9a-f]{16}$/).optional(),
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
    if (q.clave) conds.push(`${sqlClaveRelleno(add(salDeClaves()))} = ${add(q.clave)}`);
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const n = vals.length;
    const [filas, total] = await Promise.all([
      pool.query(
        `SELECT ruc_ganador AS "rucGanador", ganador, ruc_acompanante AS "rucAcompanante", acompanante, juntos, entidades,
                ${sqlClaveRelleno(add(salDeClaves()))} AS clave,
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

/**
 * GET /patrones/acompanantes/procesos?acompanante=&ganador=  Los procesos en que postularon LOS DOS (CONOSCE, desde 2018),
 * del más reciente al más antiguo: quién ganó cada uno, con cuántos postores y por cuánto. Es la evidencia de una fila de
 * «Postores de relleno» (el panel lateral de /app/patrones la pide al abrirse). Sólo empresas (RUC 20). Hasta 80.
 */
const Pareja = z.object({ acompanante: z.string().regex(/^20\d{9}$/), ganador: z.string().regex(/^20\d{9}$/) });

patronesRouter.get("/acompanantes/procesos", async (c) => {
  const p = Pareja.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`pareja:${q.acompanante}:${q.ganador}`, async () => {
    const r = await pool.query(
      `WITH c AS (
         SELECT a.codigo_convocatoria::text AS codigo, min(a.fecha_convocatoria) AS fecha
           FROM conosce_postores a
          WHERE a.ruc_postor = $1 AND a.anio >= 2018
            AND EXISTS (SELECT 1 FROM conosce_postores b WHERE b.codigo_convocatoria = a.codigo_convocatoria AND b.ruc_postor = $2)
          GROUP BY 1)
       SELECT c.codigo, cv.ocid, r.entidad_ruc AS "entidadRuc", r.entidad, left(COALESCE(r.descripcion, cv.objeto), 220) AS objeto,
              to_char(c.fecha, 'YYYY-MM-DD') AS fecha, r.monto::float AS monto,
              COALESCE($2 = ANY (r.rucs), false) AS "ganoElGanador", COALESCE($1 = ANY (r.rucs), false) AS "ganoElAcompanante",
              (SELECT count(DISTINCT x.ruc_postor) FROM conosce_postores x WHERE x.codigo_convocatoria = c.codigo)::int AS postores
         FROM c
         LEFT JOIN conosce_proceso_resumen r ON r.codigo = c.codigo
         LEFT JOIN convocatorias cv ON cv.codigo::text = c.codigo
        ORDER BY c.fecha DESC NULLS LAST, c.codigo DESC LIMIT 80`, [q.acompanante, q.ganador]);
    const filas = r.rows as { ganoElGanador: boolean; ganoElAcompanante: boolean; postores: number }[];
    return publicar({
      acompanante: q.acompanante, ganador: q.ganador, total: filas.length,
      ganoElGanador: filas.filter((x) => x.ganoElGanador).length,
      ganoElAcompanante: filas.filter((x) => x.ganoElAcompanante).length,
      // Los que cuenta el patrón: 2 a 4 postores, ganó el acompañado y no el acompañante.
      delPatron: filas.filter((x) => x.ganoElGanador && !x.ganoElAcompanante && x.postores >= 2 && x.postores <= 4).length,
      data: r.rows,
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Consorcios = z.object({
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  /** La clave opaca de un caso (su ficha de caso). */
  clave: z.string().regex(/^[0-9a-f]{16}$/).optional(),
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
    if (q.clave) conds.push(`${sqlClaveDueno(add(salDeClaves()))} = ${add(q.clave)}`);
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const n = vals.length;
    const [filas, total] = await Promise.all([
      pool.query(
        `SELECT g.entidad_ruc AS "entidadRuc", en.nombre AS entidad, g.nombre, g.contratos, g.seguidos, g.monto::float AS monto,
                ${sqlClaveDueno(add(salDeClaves()))} AS clave,
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

/**
 * GET /patrones/inhabilitadas?ruc=&graves=1  Empresas que ganan mientras otra empresa del mismo socio está inhabilitada
 * (cruce `socio_de_inhabilitada`, migración 297). Una fila por empresa ganadora e inhabilitada: cuántos contratos ganó
 * dentro de la sanción y cuántos son graves (sanción definitiva, o la ganadora se fundó o el socio entró cerca del inicio
 * de la sanción). Con `ruc`: la ganadora, la inhabilitada o la entidad que contrató. El socio sale con un apellido tapado.
 */
const Inhabilitadas = Consorcios.extend({ graves: z.enum(["1", "true"]).optional() });

patronesRouter.get("/inhabilitadas", async (c) => {
  const p = Inhabilitadas.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`inhabilitadas:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds: string[] = [];
    if (q.ruc) conds.push(`(x.ruc = ${add(q.ruc)} OR x.sancionada_ruc = $${vals.length} OR $${vals.length} = ANY(x.ents))`);
    if (q.graves) conds.push("x.graves > 0");
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // Unas 2 400 banderas: se agrupan al vuelo (la respuesta queda en memoria).
    const r = await pool.query(
      `WITH x AS (
         SELECT c.ruc_empresa AS ruc, c.detalle->>'sancionada_ruc' AS sancionada_ruc, max(c.detalle->>'sancionada') AS sancionada,
                max(c.detalle->>'sancion') AS sancion, min(c.detalle->>'sancion_desde') AS sancion_desde, max(c.detalle->>'sancion_hasta') AS sancion_hasta,
                max(c.persona_nombre) AS nombre, count(DISTINCT c.ocid)::int AS contratos,
                (count(DISTINCT c.ocid) FILTER (WHERE c.severidad = 'alta'))::int AS graves, sum(c.monto)::float AS monto,
                count(DISTINCT cv.entidad_ruc)::int AS entidades, min(c.fecha) AS desde, max(c.fecha) AS hasta,
                COALESCE(bool_or((c.detalle->>'hecha_para_seguir')::boolean), false) AS hecha, max(c.detalle->>'fundada') AS fundada,
                (array_agg(c.ocid ORDER BY c.monto DESC NULLS LAST))[1:3] AS ejemplos, array_agg(DISTINCT cv.entidad_ruc::text) AS ents
           FROM cruces_proveedor c JOIN convocatorias cv ON cv.ocid = c.ocid
          WHERE c.tipo = 'socio_de_inhabilitada'
          GROUP BY 1, 2)
       SELECT x.ruc, e.razon_social AS empresa, x.sancionada_ruc AS "sancionadaRuc", x.sancionada, x.sancion, x.sancion_desde AS "sancionDesde",
              x.sancion_hasta AS "sancionHasta", x.nombre, x.contratos, x.graves, x.monto, x.entidades,
              ${sqlClaveInhabilitada(add(salDeClaves()), "x.ruc", "x.sancionada_ruc")} AS clave,
              to_char(x.desde, 'YYYY-MM-DD') AS desde, to_char(x.hasta, 'YYYY-MM-DD') AS hasta, x.hecha AS "hechaParaSeguir", x.fundada, x.ejemplos,
              (count(*) OVER ())::int AS total
         FROM x LEFT JOIN empresas e ON e.ruc = x.ruc ${donde}
        ORDER BY x.graves DESC, x.contratos DESC, x.monto DESC NULLS LAST, x.ruc LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals);
    return publicar({
      total: r.rows[0]?.total ?? 0, page: q.page, size: q.size,
      // `socios` es la forma que `publicar()` ya conoce de los cruces: tapa un apellido.
      data: r.rows.map(({ nombre, total: _t, ...x }) => ({ ...x, socios: [{ nombre: nombrePublicable(nombre), rol: "Socio" }] })),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * GET /patrones/control?ruc=&graves=1&misma=1  Empresas que ganan con un socio o representante comprendido en un informe
 * de control de la Contraloría anterior a la buena pro (cruce `socio_con_informe_control`, migraciones 303 y 307). Una
 * fila por empresa y persona: su informe más grave, cuántos contratos ganó después y en cuántas entidades. Con `ruc`: la
 * empresa, la entidad del informe o la entidad que contrató. `misma`: sólo donde el informe es de la entidad que contrató.
 * La responsabilidad es PRESUNTA; el socio sale con un apellido tapado y sin documento.
 */
const Control = Consorcios.extend({ graves: z.enum(["1", "true"]).optional(), misma: z.enum(["1", "true"]).optional() });

patronesRouter.get("/control", async (c) => {
  const p = Control.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`control:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds: string[] = [];
    if (q.ruc) conds.push(`(x.ruc = ${add(q.ruc)} OR x.informe_entidad_ruc = $${vals.length} OR $${vals.length} = ANY(x.ents))`);
    if (q.graves) conds.push("x.graves > 0");
    if (q.misma) conds.push("x.misma");
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // Unas 6 700 banderas: se agrupan al vuelo (la respuesta queda en memoria). El documento de la persona no sale de la
    // consulta: sólo agrupa. El informe que se muestra es el MÁS ANTIGUO de la persona entre los de sus banderas: así
    // todos los contratos contados son posteriores a él (con el más reciente, «ganados después» no era cierto para los
    // contratos anteriores a ese informe).
    const r = await pool.query(
      `WITH x AS (
         SELECT c.ruc_empresa AS ruc, max(c.persona_nombre) AS nombre, max(c.detalle->>'rol_en_empresa') AS rol,
                (array_agg(c.detalle->>'informe_codigo' ORDER BY c.detalle->>'emision', c.fecha))[1] AS informe_codigo,
                (array_agg(c.detalle->>'informe_numero' ORDER BY c.detalle->>'emision', c.fecha))[1] AS informe_numero,
                (array_agg(c.detalle->>'informe_entidad' ORDER BY c.detalle->>'emision', c.fecha))[1] AS informe_entidad,
                (array_agg(c.detalle->>'informe_entidad_ruc' ORDER BY c.detalle->>'emision', c.fecha))[1] AS informe_entidad_ruc,
                (array_agg(c.detalle->>'emision' ORDER BY c.detalle->>'emision', c.fecha))[1] AS emision,
                (array_agg(c.detalle->'responsabilidades' ORDER BY c.detalle->>'emision', c.fecha))[1] AS responsabilidades,
                (array_agg(c.detalle->>'url_resumen' ORDER BY c.detalle->>'emision', c.fecha))[1] AS ficha,
                max((c.detalle->>'n_informes')::int) AS informes,
                count(DISTINCT c.ocid)::int AS contratos, (count(DISTINCT c.ocid) FILTER (WHERE c.severidad = 'alta'))::int AS graves,
                sum(c.monto)::float AS monto, count(DISTINCT cv.entidad_ruc)::int AS entidades,
                COALESCE(bool_or((c.detalle->>'misma_entidad')::boolean OR (c.detalle->>'misma_entidad_en_otro')::boolean), false) AS misma,
                min(c.fecha) AS desde, max(c.fecha) AS hasta,
                (array_agg(c.ocid ORDER BY c.severidad = 'alta' DESC, c.monto DESC NULLS LAST))[1:3] AS ejemplos,
                array_agg(DISTINCT cv.entidad_ruc::text) AS ents
           FROM cruces_proveedor c JOIN convocatorias cv ON cv.ocid = c.ocid
          WHERE c.tipo = 'socio_con_informe_control'
          GROUP BY c.ruc_empresa, c.persona_doc)
       SELECT x.ruc, e.razon_social AS empresa, x.nombre, x.rol, x.informe_codigo AS "informeCodigo", x.informe_numero AS "informeNumero",
              x.informe_entidad AS "informeEntidad", x.informe_entidad_ruc AS "informeEntidadRuc", x.emision, x.responsabilidades, x.ficha,
              x.informes, x.contratos, x.graves, x.monto, x.entidades, x.misma AS "mismaEntidad",
              to_char(x.desde, 'YYYY-MM-DD') AS desde, to_char(x.hasta, 'YYYY-MM-DD') AS hasta, x.ejemplos, (count(*) OVER ())::int AS total
         FROM x LEFT JOIN empresas e ON e.ruc = x.ruc ${donde}
        ORDER BY x.misma DESC, x.graves DESC, x.contratos DESC, x.monto DESC NULLS LAST, x.ruc LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals);
    return publicar({
      total: r.rows[0]?.total ?? 0, page: q.page, size: q.size,
      // `socios` es la forma que `publicar()` ya conoce de los cruces: tapa un apellido.
      data: r.rows.map(({ nombre, rol, total: _t, ...x }) => ({
        ...x, socios: [{ nombre: nombrePublicable(nombre), rol: /SOCIO/.test(String(rol)) ? "Socio" : "Representante legal" }],
      })),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * GET /patrones/observados?ruc=&graves=1&siguio=1  Proveedores con procesos que la Contraloría observó en un informe de
 * control (cruce `observado_por_contraloria`, migración 313), por empresa y entidad: cuántos procesos, el perjuicio que
 * cuantifican las observaciones, el informe más antiguo y cuánto le adjudicó esa MISMA entidad después de emitido ese
 * informe (CONOSCE, sólo lo ganado con su propio RUC: lo ganado en consorcio no se cuenta). Con `ruc`: la empresa o la
 * entidad. `siguio`: sólo donde la entidad le volvió a adjudicar después del informe. Sólo empresas (RUC 20).
 * La responsabilidad que identifica un informe es PRESUNTA y de funcionarios: el informe no sanciona al proveedor.
 */
const Observados = Consorcios.extend({ graves: z.enum(["1", "true"]).optional(), siguio: z.enum(["1", "true"]).optional() });

patronesRouter.get("/observados", async (c) => {
  const p = Observados.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`observados:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds: string[] = [];
    if (q.ruc) conds.push(`(x.ruc = ${add(q.ruc)} OR x.entidad_ruc = $${vals.length})`);
    if (q.graves) conds.push("x.graves > 0");
    if (q.siguio) conds.push("d.despues > 0");
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // Unas mil banderas: se agrupan al vuelo (la respuesta queda en memoria) y lo adjudicado después sale del índice
    // (ruc_proveedor, entidad_ruc) de CONOSCE. El informe que se muestra es el MÁS ANTIGUO del par: todo lo contado como
    // «después» es posterior a él.
    const r = await pool.query(
      `WITH b AS (
         SELECT c.ruc_empresa AS ruc, btrim(cv.entidad_ruc::text) AS entidad_ruc, c.ocid, c.severidad, c.monto, c.fecha,
                c.detalle->>'informe_codigo' AS codigo, c.detalle->>'informe_numero' AS numero, NULLIF(c.detalle->>'emision', '')::date AS emision,
                c.detalle->'responsabilidades' AS resp, c.detalle->>'url_resumen' AS ficha, c.detalle->>'tema' AS tema
           FROM cruces_proveedor c JOIN convocatorias cv ON cv.ocid = c.ocid
          WHERE c.tipo = 'observado_por_contraloria' AND c.ruc_empresa ~ '^20[0-9]{9}$'),
       x AS (
         SELECT ruc, entidad_ruc, count(DISTINCT ocid)::int AS observados, (count(DISTINCT ocid) FILTER (WHERE severidad = 'alta'))::int AS graves,
                sum(monto)::float AS monto, min(emision) AS emision,
                (array_agg(codigo ORDER BY emision, ocid))[1] AS informe_codigo, (array_agg(numero ORDER BY emision, ocid))[1] AS informe_numero,
                (array_agg(resp ORDER BY emision, ocid))[1] AS responsabilidades, (array_agg(ficha ORDER BY emision, ocid))[1] AS ficha,
                count(DISTINCT codigo)::int AS informes, array_agg(DISTINCT tema) FILTER (WHERE tema IS NOT NULL) AS temas,
                (array_agg(ocid ORDER BY severidad = 'alta' DESC, monto DESC NULLS LAST))[1:3] AS ejemplos,
                min(fecha) AS desde, max(fecha) AS hasta
           FROM b GROUP BY ruc, entidad_ruc),
       -- Las observaciones del par, una vez cada una (una observación puede nombrar varios contratos del mismo proveedor),
       -- y su perjuicio en soles: el mismo monto repetido dentro de un informe es su total, y cuenta una vez.
       k AS (
         SELECT DISTINCT b.ruc, b.entidad_ruc, p.codigo, p.n, CASE WHEN p.moneda = 'PEN' AND p.perjuicio > 0 THEN p.perjuicio END AS perjuicio
           FROM b JOIN informe_control_proceso p ON p.ocid = b.ocid),
       o AS (
         SELECT n.ruc, n.entidad_ruc, n.observaciones, m.perjuicio
           FROM (SELECT ruc, entidad_ruc, count(*)::int AS observaciones FROM k GROUP BY 1, 2) n
           LEFT JOIN (SELECT ruc, entidad_ruc, sum(perjuicio)::float AS perjuicio
                        FROM (SELECT DISTINCT ruc, entidad_ruc, codigo, perjuicio FROM k WHERE perjuicio IS NOT NULL) u GROUP BY 1, 2) m
             ON m.ruc = n.ruc AND m.entidad_ruc = n.entidad_ruc)
       SELECT x.ruc, e.razon_social AS empresa, x.entidad_ruc AS "entidadRuc", en.nombre AS entidad, x.observados, x.graves, x.monto, o.perjuicio,
              o.observaciones, x.informes, x.temas, x.informe_codigo AS "informeCodigo", x.informe_numero AS "informeNumero",
              to_char(x.emision, 'YYYY-MM-DD') AS emision, x.responsabilidades, x.ficha, x.ejemplos,
              to_char(x.desde, 'YYYY-MM-DD') AS desde, to_char(x.hasta, 'YYYY-MM-DD') AS hasta,
              COALESCE(d.despues, 0) AS despues, d.monto_despues AS "montoDespues", to_char(d.ultima, 'YYYY-MM-DD') AS "ultimaDespues",
              (count(*) OVER ())::int AS total
         FROM x
         LEFT JOIN o ON o.ruc = x.ruc AND o.entidad_ruc = x.entidad_ruc
         LEFT JOIN empresas e ON e.ruc = x.ruc
         LEFT JOIN entidades en ON btrim(en.ruc::text) = x.entidad_ruc
         LEFT JOIN LATERAL (
           SELECT count(DISTINCT a.codigo_convocatoria)::int AS despues, sum(a.monto_adjudicado)::float AS monto_despues, max(a.fecha_buenapro) AS ultima
             FROM conosce_adjudicaciones a
            WHERE x.emision IS NOT NULL AND a.ruc_proveedor = x.ruc AND a.entidad_ruc = x.entidad_ruc
              AND a.fecha_buenapro > x.emision AND a.monto_adjudicado > 0) d ON true
         ${donde}
        ORDER BY (COALESCE(d.despues, 0) > 0) DESC, x.graves DESC, COALESCE(d.despues, 0) DESC, o.perjuicio DESC NULLS LAST, x.ruc, x.entidad_ruc
        LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals);
    return publicar({ total: r.rows[0]?.total ?? 0, page: q.page, size: q.size, data: r.rows.map(({ total: _t, ...x }) => x) });
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

const PreciosEstado = z.object({
  q: z.string().trim().min(5).max(300),
  unidad: z.string().trim().max(60).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * GET /patrones/precios-estado?q=&unidad=&hasta= — lo que pagó el Estado por un bien nombrado con esas palabras
 * (migración 338-339, `precios_por_texto`): procesos adjudicados, compras menores, catálogo de Perú Compras y otros
 * contratos leídos, cada uno con su cuartil 1, mediana y cuartil 3 en una unidad. Para el panel de cada renglón de la
 * ficha (los renglones leídos de las bases y del contrato no traen CUBSO). `hasta`: la fecha del proceso (precios de
 * entonces, no de hoy).
 */
patronesRouter.get("/precios-estado", async (c) => {
  const p = PreciosEstado.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  // Si la consulta falla (un tiempo de espera con la base cargada), NO es un cero: antes devolvía la lista vacía, la
  // guardaba en la memoria y la CDN la servía una hora, y el MCP decía «sin compras del Estado» (2026-11-18). Ahora: 503,
  // sin guardar y sin caché; quien la pide dice que no respondió.
  const cuerpo = await memo.obtener(`precios-estado:${JSON.stringify(q)}`, async (ctl) => {
    const r = await pool.query(
      `SELECT fuente, detalle, unidad, n, p25::float AS p25, mediana::float AS mediana, p75::float AS p75
         FROM precios_por_texto($1, $2, COALESCE($3::date, CURRENT_DATE)) WHERE mediana > 0`,
      [q.q, q.unidad ?? null, q.hasta ?? null],
    ).catch((err: Error) => {
      console.warn(`[precios-estado] no respondió: ${err.message}`);
      ctl.noGuardar();
      return null;
    });
    if (!r) return { referencias: [], noRespondio: true };
    return { referencias: depurarReferencias(r.rows as { unidad: string | null; n: number; mediana: number }[]) };
  });
  if (cuerpo.noRespondio) {
    c.header("Cache-Control", "no-store");
    return c.json(cuerpo, 503);
  }
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Grupos = z.object({
  entidad: z.string().regex(/^20\d{9}$/).optional(),
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  persona: z.string().regex(/^[0-9a-f]{12}$/).optional(),
  /** El RUC de la entidad O de una empresa del grupo (el buscador de la web, que no sabe cuál de las dos es). */
  buscar: z.string().regex(/^20\d{9}$/).optional(),
  /** La clave opaca de un grupo (su ficha de caso): 16 hex del md5 de la entidad y el grupo. */
  clave: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  severidad: z.enum(["alta", "media", "baja"]).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const VIA: Record<string, string> = {
  socio_comun: "comparten un socio o representante",
  es_socio: "la persona es socia o representante de la empresa",
  hermanos_probables: "sus socios comparten los dos apellidos (posibles hermanos)",
};

/**
 * GET /patrones/grupos?entidad=&ruc=&persona=&severidad= — grupos de proveedores de una misma entidad unidos por dueño o
 * por familia probable (migración 343): empresas que comparten un socio, la persona que vende con su RUC 10 y es socia de
 * una de ellas, y socios con los mismos dos apellidos poco comunes. Con lo que hicieron juntos en las órdenes: al borde del
 * tope de 8 UIT, órdenes el mismo día con números correlativos y el mismo objeto repartido entre miembros. `persona` es el
 * código de su ficha (un RUC 10 nunca se recibe ni se muestra).
 */
patronesRouter.get("/grupos", async (c) => {
  const p = Grupos.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`grupos:${JSON.stringify(q)}`, async () => {
    let ruc = q.ruc ?? null;
    if (q.persona) {
      const r = await pool.query<{ ruc: string }>(`SELECT ruc FROM persona_codigo WHERE codigo = $1`, [q.persona]);
      ruc = r.rows[0]?.ruc ?? "sin-persona";
    }
    const r = await pool.query(
      `SELECT r.entidad_ruc AS "entidadRuc", (SELECT es.nombre FROM entidad_stats es WHERE es.ruc = r.entidad_ruc) AS entidad, r.grupo,
              r.miembros, r.empresas, r.personas, r.ordenes, r.monto::float AS monto, to_char(r.desde, 'YYYY-MM-DD') AS desde,
              to_char(r.hasta, 'YYYY-MM-DD') AS hasta, r.hasta_8uit AS "hasta8Uit", r.borde, r.monto_borde::float AS "montoBorde",
              r.sobre_tope AS "sobreTope", r.dias_juntos AS "diasJuntos", r.monto_juntos::float AS "montoJuntos", r.correlativas,
              r.repartidos, r.monto_repartido::float AS "montoRepartido", r.puesto_grupo AS "puestoGrupo", r.puesto_mayor AS "puestoMayor", r.parte_entidad::float AS "parteEntidad",
              r.severidad, r.detalle, ${sqlClaveGrupo("$8")} AS clave, (count(*) OVER ())::int AS total
         FROM grupo_proveedor_resumen r
        WHERE ($1::text IS NULL OR r.entidad_ruc = $1) AND ($3::text IS NULL OR r.severidad = $3)
          AND ($7::text IS NULL OR ${sqlClaveGrupo("$8")} = $7)
          AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM grupo_proveedor g WHERE g.entidad_ruc = r.entidad_ruc AND g.grupo = r.grupo AND g.ruc = $2))
          AND ($6::text IS NULL OR r.entidad_ruc = $6
               OR EXISTS (SELECT 1 FROM grupo_proveedor g WHERE g.entidad_ruc = r.entidad_ruc AND g.grupo = r.grupo AND g.ruc = $6))
        ORDER BY CASE r.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, r.monto DESC
        LIMIT $4 OFFSET $5`,
      [q.entidad ?? null, ruc, q.severidad ?? null, q.size, (q.page - 1) * q.size, q.buscar ?? null, q.clave ?? null, salDeClaves()],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const grupos = r.rows as Record<string, any>[];
    // Por qué están juntos: los vínculos entre sus miembros, con la persona que los une (un apellido tapado).
    const vinc = grupos.length ? await pool.query(
      `SELECT v.entidad_ruc, g.grupo, v.a, v.b, v.via, v.persona, v.persona_b
         FROM grupo_proveedor_vinculo v JOIN grupo_proveedor g ON g.entidad_ruc = v.entidad_ruc AND g.ruc = v.a
        WHERE (v.entidad_ruc, g.grupo) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
      [grupos.map((x) => x.entidadRuc), grupos.map((x) => x.grupo)],
    ).catch(() => ({ rows: [] as Record<string, any>[] })) : { rows: [] as Record<string, any>[] };
    // La ficha de cada persona (por su código: el RUC 10 no sale).
    const personas = grupos.flatMap((x) => ((x.detalle?.miembros ?? []) as { ruc: string }[]).map((m) => m.ruc)).filter((x) => x.startsWith("10"));
    const codigos = personas.length
      ? new Map((await pool.query<{ ruc: string; codigo: string }>(`SELECT ruc, codigo FROM persona_codigo WHERE ruc = ANY($1)`, [personas])).rows.map((x) => [x.ruc, x.codigo]))
      : new Map<string, string>();
    // Cuánto de lo que cada integrante le vendió al Estado por órdenes (desde 2018) viene de ESA entidad: las cuatro
    // empresas del caso de la UNI dependían de ella entre el 92 % y el 99,9 %.
    const pares = grupos.flatMap((x) => ((x.detalle?.miembros ?? []) as { ruc: string }[]).map((m) => [x.entidadRuc as string, m.ruc]));
    const dependencia = new Map<string, number>();
    if (pares.length) {
      const d = await pool.query<{ entidad: string; ruc: string; parte: number }>(
        `WITH p AS (SELECT * FROM unnest($1::text[], $2::text[]) AS t(entidad, ruc)),
              tot AS (
                SELECT ruc, entidad_ruc, sum(monto) AS monto FROM empresa_orden_anual WHERE anio >= 2018 AND ruc IN (SELECT ruc FROM p) GROUP BY 1, 2
                UNION ALL
                SELECT ruc, entidad_ruc, sum(monto) FROM persona_orden_anual WHERE anio >= 2018 AND ruc IN (SELECT ruc FROM p) GROUP BY 1, 2)
         SELECT p.entidad, p.ruc,
                (sum(t.monto) FILTER (WHERE t.entidad_ruc = p.entidad) / NULLIF(sum(t.monto), 0))::float AS parte
           FROM p JOIN tot t ON t.ruc = p.ruc GROUP BY 1, 2`,
        [pares.map((x) => x[0]), pares.map((x) => x[1])],
      ).catch(() => ({ rows: [] as { entidad: string; ruc: string; parte: number }[] }));
      for (const r of d.rows) if (r.parte != null) dependencia.set(`${r.entidad}|${r.ruc}`, Math.round(r.parte * 1000) / 1000);
    }
    const data = grupos.map(({ total: _t, detalle, ...x }) => {
      const miembros = ((detalle?.miembros ?? []) as { ruc: string; nombre: string; ordenes: number; monto: number }[]);
      const nombreDe = new Map(miembros.map((m) => [m.ruc, m.nombre]));
      const conNombre = (o: { ruc?: string }) => ({ ...o, nombre: o.ruc ? nombreDe.get(o.ruc) ?? null : null });
      return {
        ...x,
        miembros: miembros.map((m) => ({ ...m, persona: m.ruc.startsWith("10"), codigo: codigos.get(m.ruc) ?? null,
          parteDeSusVentas: dependencia.get(`${x.entidadRuc}|${m.ruc}`) ?? null })),
        vinculos: vinc.rows.filter((v) => v.entidad_ruc === x.entidadRuc && v.grupo === x.grupo).map((v) => ({
          a: v.a, nombreA: nombreDe.get(v.a) ?? null, b: v.b, nombreB: nombreDe.get(v.b) ?? null, via: v.via, que: VIA[v.via] ?? v.via,
          persona: v.persona ? taparNombrePropio(nombrePublicable(v.persona), v.persona) : null,
          personaB: v.persona_b ? taparNombrePropio(nombrePublicable(v.persona_b), v.persona_b) : null,
        })),
        // El detalle de cada día y de cada objeto, con tope: un objeto repartido llegó a traer 538 órdenes y la página de 20
        // grupos pesaba 1,5 MB (medido el 2026-11-17). Las cuentas (ordenes, miembros, monto) siguen completas.
        dias: ((detalle?.dias ?? []) as Record<string, any>[]).map((d) => ({ ...d, detalle: (d.detalle ?? []).slice(0, 30).map(conNombre) })),
        objetosRepartidos: ((detalle?.repartidos ?? []) as Record<string, any>[]).map((d) => ({ ...d, detalle: (d.detalle ?? []).slice(0, 12).map(conNombre) })),
        sobreTopeOrdenes: ((detalle?.sobre_tope ?? []) as Record<string, any>[]).map(conNombre),
        // Un integrante que un funcionario de la misma entidad declaró como pariente (migración 344). Si el funcionario es una
        // autoridad electa (su nombre es público), su cargo y un parentesco de sangre destaparían el apellido tapado del
        // pariente: entonces sólo «un funcionario de la entidad» y «pariente».
        parientesDeFuncionarios: ((detalle?.parientes_de_funcionarios ?? []) as Record<string, any>[]).map((d) => {
          const electo = /ALCALDE|REGIDOR|GOBERNADOR|CONSEJER|CONGRESISTA|PRESIDENTE REGIONAL/i.test(String(d.cargo ?? ""));
          // via «socio» (migración 350): el pariente es socio, representante o directivo de esta empresa del grupo.
          return { ...conNombre(d), cargo: electo ? null : d.cargo ?? null, parentesco: electo ? "pariente" : d.parentesco ?? null,
                   ordenes: d.ordenes ?? null, monto: d.monto ?? null, via: d.via === "socio" ? "socio" : "ruc10" };
        }),
      };
    });
    return publicar({ total: grupos[0]?.total ?? 0, page: q.page, size: q.size, data,
      como_leerlo: "Un grupo junta proveedores de la misma entidad unidos por un socio o representante común, por una persona que vende con su RUC y es socia de una empresa del grupo, o por socios con los mismos dos apellidos poco comunes (parentesco probable, no comprobado: los registros no traen parentescos). Cada uno visto solo puede parecer pequeño; juntos se suman." });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Repetidas = z.object({
  entidad: z.string().regex(/^20\d{9}$/).optional(),
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  /** El RUC de la entidad o el de la empresa: la web tiene un solo filtro. */
  buscar: z.string().regex(/^20\d{9}$/).optional(),
  /** La clave opaca de un caso (su ficha de caso). */
  clave: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  severidad: z.enum(["alta", "media", "baja"]).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /patrones/repetidas?entidad=&ruc=&buscar=&severidad= — la misma compra repetida en semanas (migración 348): órdenes directas
 * de bienes del mismo proveedor, el mismo monto y el mismo objeto, de 7 a 90 días entre la primera y la última. Puede ser
 * un fraccionamiento en el tiempo (juntas pasan el tope de 8 UIT), una orden registrada dos veces (si las dos se devengaron,
 * un posible pago doble) o un suministro periódico legítimo. `ruc` es el de una empresa (un RUC 10 no se recibe).
 */
patronesRouter.get("/repetidas", async (c) => {
  const p = Repetidas.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`repetidas:${JSON.stringify(q)}`, async () => {
    const r = await pool.query(
      `SELECT x.entidad_ruc AS "entidadRuc", (SELECT es.nombre FROM entidad_stats es WHERE es.ruc = x.entidad_ruc) AS entidad,
              x.ruc_contratista AS ruc, x.contratista AS nombre, x.monto::float AS monto, x.ordenes, x.total::float AS total, x.tope::float AS tope,
              to_char(x.desde, 'YYYY-MM-DD') AS desde, to_char(x.hasta, 'YYYY-MM-DD') AS hasta, x.dias, x.devengadas, x.objeto, x.severidad, x.detalle,
              ${sqlClaveRepetida("$8")} AS clave, (count(*) OVER ())::int AS total_filas
         FROM ordenes_repetidas x
        WHERE ($1::text IS NULL OR x.entidad_ruc = $1) AND ($2::text IS NULL OR x.ruc_contratista = $2) AND ($3::text IS NULL OR x.severidad = $3)
          AND ($6::text IS NULL OR x.entidad_ruc = $6 OR x.ruc_contratista = $6) AND ($7::text IS NULL OR ${sqlClaveRepetida("$8")} = $7)
        ORDER BY CASE x.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, x.total DESC
        LIMIT $4 OFFSET $5`,
      [q.entidad ?? null, q.ruc ?? null, q.severidad ?? null, q.size, (q.page - 1) * q.size, q.buscar ?? null, q.clave ?? null, salDeClaves()],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const filas = r.rows as Record<string, any>[];
    return publicar({
      total: filas[0]?.total_filas ?? 0, page: q.page, size: q.size,
      data: filas.map(({ total_filas: _t, ...x }) => x),
      como_leerlo: "La misma compra (proveedor, monto y objeto) en varias órdenes directas de 7 a 90 días entre sí. Si juntas pasan el tope de 8 UIT y cada una queda al borde, es la forma de un fraccionamiento en el tiempo; si todas se devengaron, pregunta si se pagó dos veces. Un suministro mensual puede explicarlo: mira el requerimiento.",
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Recien = z.object({
  /** RUC de la entidad o de la empresa. */
  buscar: z.string().regex(/^20\d{9}$/).optional(),
  /** La clave opaca de un caso (su ficha de caso). */
  clave: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  severidad: z.enum(["alta", "media", "baja"]).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /patrones/recien?buscar=&severidad= — empresas recién creadas que reciben órdenes directas (migración 355): la
 * entidad les emitió su primera orden sin proceso a 90 días o menos de su alta en la SUNAT, con S/ 30 mil o más en su
 * primer año. Sin consorcios (nacen al ganar un proceso). Sólo empresas (RUC 20).
 */
patronesRouter.get("/recien", async (c) => {
  const p = Recien.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`recien:${JSON.stringify(q)}`, async () => {
    const r = await pool.query(
      `SELECT x.entidad_ruc AS "entidadRuc", (SELECT es.nombre FROM entidad_stats es WHERE es.ruc = x.entidad_ruc) AS entidad,
              x.ruc_empresa AS ruc, x.empresa AS nombre, to_char(x.fecha_alta, 'YYYY-MM-DD') AS "fechaAlta",
              to_char(x.primera_orden, 'YYYY-MM-DD') AS "primeraOrden", x.dias, x.ordenes_1a AS "ordenesPrimerAnio", x.monto_1a::float AS "montoPrimerAnio",
              x.ordenes, x.monto::float AS monto, x.parte_entidad::float AS "parteEntidad", x.severidad, ${sqlClaveRecien("$6")} AS clave,
              (count(*) OVER ())::int AS total_filas
         FROM empresa_recien_creada_ordenes x
        WHERE ($1::text IS NULL OR x.entidad_ruc = $1 OR x.ruc_empresa = $1) AND ($2::text IS NULL OR x.severidad = $2)
          AND ($5::text IS NULL OR ${sqlClaveRecien("$6")} = $5)
        ORDER BY CASE x.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, x.monto_1a DESC
        LIMIT $3 OFFSET $4`,
      [q.buscar ?? null, q.severidad ?? null, q.size, (q.page - 1) * q.size, q.clave ?? null, salDeClaves()],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const filas = r.rows as Record<string, any>[];
    return publicar({
      total: filas[0]?.total_filas ?? 0, page: q.page, size: q.size,
      data: filas.map(({ total_filas: _t, ...x }) => x),
      como_leerlo: "Empresas que se inscribieron en la SUNAT y a los pocos días ya recibían órdenes directas (sin proceso de selección) de una entidad. Grave: primera orden a 30 días o menos, S/ 100 mil o más en su primer año y la entidad es casi todo lo que le vendieron al Estado. Puede ser un negocio que ya existía con otro RUC: mira quién la creó (sus socios) y quién pidió la compra.",
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Doble = z.object({
  /** RUC de la entidad de la planilla o de la que emitió las órdenes. */
  buscar: z.string().regex(/^20\d{9}$/).optional(),
  severidad: z.enum(["media", "baja"]).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /patrones/doble?buscar=&severidad= — cobran del Estado por dos lados (migración 352): personas que están en la
 * planilla de una entidad y, esos mismos meses, recibieron órdenes de servicio de otra. La ley no permite dos ingresos del
 * Estado salvo la docencia y las dietas (art. 40 de la Constitución; art. 3 de la Ley 28175): con docencia el caso va
 * como «baja». El empate es por nombre completo (un solo RUC 10 lo lleva): la persona sale con el materno tapado y el
 * enlace a su ficha única; nunca su documento.
 */
patronesRouter.get("/doble", async (c) => {
  const p = Doble.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`doble:${JSON.stringify(q)}`, async () => {
    const r = await pool.query(
      `SELECT d.entidad_ruc AS "entidadRuc", d.entidad, d.cargo, d.regimen, d.sueldo::float AS sueldo, d.otra_ruc AS "otraRuc", d.otra,
              d.ordenes, d.monto::float AS monto, d.meses, to_char(d.desde, 'YYYY-MM') AS desde, to_char(d.hasta, 'YYYY-MM') AS hasta,
              d.docente, d.severidad, d.codigo, pp.paterno, pp.nombres, (count(*) OVER ())::int AS total_filas
         FROM doble_percepcion d
         LEFT JOIN planilla_persona pp ON pp.entidad_ruc = d.entidad_ruc AND pp.nombre_norm = d.nombre_norm
        WHERE ($1::text IS NULL OR d.entidad_ruc = $1 OR d.otra_ruc = $1) AND ($2::text IS NULL OR d.severidad = $2)
        ORDER BY CASE d.severidad WHEN 'media' THEN 0 ELSE 1 END, d.monto DESC
        LIMIT $3 OFFSET $4`,
      [q.buscar ?? null, q.severidad ?? null, q.size, (q.page - 1) * q.size],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const filas = r.rows as Record<string, any>[];
    return publicar({
      total: filas[0]?.total_filas ?? 0, page: q.page, size: q.size,
      // El nombre, ya con el materno tapado (como la planilla): paterno, la tapa y los nombres.
      data: filas.map(({ total_filas: _t, paterno, nombres, ...x }) => ({ ...x, persona: [paterno, TAPA_NOMBRE, nombres].filter(Boolean).join(" ") || null })),
      como_leerlo: "Cada fila es una persona de la planilla de una entidad que, en esos mismos meses, recibió órdenes de servicio de otra. La ley no permite percibir dos ingresos del Estado, salvo la docencia y las dietas (artículo 40 de la Constitución; artículo 3 de la Ley 28175). El empate es por nombre completo: confirma que es la misma persona antes de afirmar nada.",
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const ComprasFamilia = z.object({
  /** RUC de la entidad, o de la empresa del familiar. */
  buscar: z.string().regex(/^20\d{9}$/).optional(),
  severidad: z.enum(["alta", "media", "baja"]).optional(),
  /** Sólo los casos graves y medios (los que cuenta la bandera de una ficha). */
  relevantes: z.enum(["1"]).optional(),
  /** La clave de un caso (su ficha de caso). */
  clave: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /patrones/compras-familia?buscar=&severidad= — trabaja en compras y un familiar recibe órdenes de su entidad
 * (migración 364): funcionarios cuyo puesto declarado (sección de empleos de su declaración jurada) es de logística,
 * abastecimiento o contrataciones, con un familiar declarado en esa misma declaración que recibió órdenes a su nombre de
 * esa entidad. La ley impide contratar con la entidad al cónyuge, conviviente y parientes hasta el segundo grado de quien
 * interviene en sus contrataciones. En observación: dice que puesto, parentesco y órdenes coinciden; no que intervino.
 *
 * Privacidad: la persona sale con el materno tapado y el enlace a su ficha; el familiar, sólo por su parentesco (nunca su
 * nombre ni su documento). Sólo puestos de compras: quien «decide» incluye autoridades electas, cuyo parentesco va
 * reservado, y eso se ve en la ficha de cada una con sus reservas.
 */
patronesRouter.get("/compras-familia", async (c) => {
  const p = ComprasFamilia.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`compras-familia:${JSON.stringify(q)}`, async () => {
    const [r, t] = await Promise.all([
      pool.query(
        `SELECT k.entidad_ruc AS "entidadRuc", k.entidad, k.cargo, to_char(k.cargo_desde, 'YYYY-MM-DD') AS "cargoDesde",
                to_char(k.cargo_hasta, 'YYYY-MM-DD') AS "cargoHasta", to_char(k.visto_hasta, 'YYYY-MM-DD') AS "vistoHasta",
                k.parentesco, k.cercano, k.ordenes, k.monto::float AS monto, k.desde, k.hasta,
                k.ordenes_en_puesto AS "ordenesEnPuesto", k.monto_en_puesto::float AS "montoEnPuesto", k.ordenes_antes AS "ordenesAntes",
                k.ordenes_luego AS "ordenesLuego", to_char(k.primera_en_puesto, 'YYYY-MM-DD') AS "primeraEnPuesto",
                to_char(k.ultima_en_puesto, 'YYYY-MM-DD') AS "ultimaEnPuesto",
                k.via, NULLIF(k.empresa_ruc, '') AS "empresaRuc", k.empresa, k.rol_en_empresa AS "rolEnEmpresa",
                to_char(k.pariente_desde, 'YYYY-MM-DD') AS "parienteDesde", k.procesos_en_puesto AS "procesosEnPuesto",
                k.monto_procesos_en_puesto::float AS "montoProcesosEnPuesto",
                k.coincide, k.empezo_despues AS "empezoDespues", k.severidad, k.codigo, fr.paterno, fr.nombres, fr.cargo AS cargo_indice,
                -- La llave del caso para pedir su evidencia (el número del familiar no sale de la base).
                md5(k.codigo || '|' || k.entidad_ruc || '|' || k.pariente || '|' || k.empresa_ruc) AS clave,
                (count(*) OVER ())::int AS total_filas
           FROM funcionario_compras_familiar k LEFT JOIN funcionario_resumen fr ON fr.codigo = k.codigo
          WHERE k.tipo_cargo = 'compras' AND ($1::text IS NULL OR k.entidad_ruc = $1 OR k.empresa_ruc = $1) AND ($2::text IS NULL OR k.severidad = $2)
            AND ($5::boolean IS NOT TRUE OR k.severidad IN ('alta', 'media'))
            AND ($6::text IS NULL OR md5(k.codigo || '|' || k.entidad_ruc || '|' || k.pariente || '|' || k.empresa_ruc) = $6)
          ORDER BY CASE k.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
                   COALESCE(k.monto_en_puesto, 0) + COALESCE(k.monto_procesos_en_puesto, 0) DESC, k.monto DESC, k.codigo, k.empresa_ruc
          LIMIT $3 OFFSET $4`, [q.buscar ?? null, q.severidad ?? null, q.size, (q.page - 1) * q.size, q.relevantes === "1", q.clave ?? null]),
      pool.query<{ severidad: string; casos: number; personas: number; entidades: number; monto: number; montoEnPuesto: number }>(
        `SELECT k.severidad, count(*)::int AS casos, count(DISTINCT k.codigo)::int AS personas, count(DISTINCT k.entidad_ruc)::int AS entidades,
                COALESCE(sum(k.monto), 0)::float AS monto,
                COALESCE(sum(COALESCE(k.monto_en_puesto, 0) + COALESCE(k.monto_procesos_en_puesto, 0)), 0)::float AS "montoEnPuesto"
           FROM funcionario_compras_familiar k
          WHERE k.tipo_cargo = 'compras' AND ($1::text IS NULL OR k.entidad_ruc = $1 OR k.empresa_ruc = $1) GROUP BY 1`, [q.buscar ?? null]),
    ]).catch(() => [{ rows: [] as Record<string, unknown>[] }, { rows: [] as { severidad: string; casos: number; personas: number; entidades: number; monto: number; montoEnPuesto: number }[] }] as const);
    const filas = r.rows as Record<string, any>[];
    return publicar({
      total: filas[0]?.total_filas ?? 0, page: q.page, size: q.size,
      resumen: Object.fromEntries(t.rows.map((x) => [x.severidad, { casos: x.casos, personas: x.personas, entidades: x.entidades, monto: x.monto, montoEnPuesto: x.montoEnPuesto }])),
      data: filas
        // Una autoridad electa no entra aquí aunque su puesto declarado diga compras (ver arriba).
        .filter((x) => !esCargoDeEleccion(x.cargo_indice) && !esCargoDeEleccion(x.cargo))
        .map(({ total_filas: _t, paterno, nombres, cargo_indice: _c, parentesco, rolEnEmpresa, ...x }) => ({
          ...x, parentesco: etiquetaParentesco(parentesco) ?? "Familiar", rolEnEmpresa: papelesRnp(rolEnEmpresa),
          persona: [paterno, TAPA_NOMBRE, nombres].filter(Boolean).join(" ") || null,
        })),
      enObservacion: true,
      como_leerlo: "Cada fila es un funcionario cuyo puesto declarado es de compras, logística o contrataciones y un familiar que declaró en su declaración jurada de intereses, con lo que ese familiar recibió de la misma entidad: órdenes a su nombre (via «persona») o las ventas de una empresa en la que figura como socio, representante o directivo según el RNP (via «empresa», con su RUC y los procesos que ganó en ese tiempo). Las órdenes se cuentan por su fecha de emisión frente al puesto: las emitidas mientras lo tenía (del inicio declarado al cese o, sin cese, a su última declaración que lo nombra), las de antes y las de después. «Alta»: familiar cercano (cónyuge o conviviente, padres, hijos, hermanos) con al menos una orden emitida mientras el funcionario tenía el puesto. La ley impide contratar con la entidad a los parientes hasta el segundo grado de quien interviene en sus contrataciones (artículo 11 del TUO de la Ley 30225; artículo 30 de la Ley 32069). Es una señal en observación: dice que el puesto, el parentesco y las órdenes coinciden, no que la persona intervino. Hay que ver quién pidió y quién aprobó cada orden.",
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const VentasCompraFamilia = z.object({ clave: z.string().regex(/^[0-9a-f]{32}$/) });

/**
 * GET /patrones/compras-familia/ventas?clave= — la evidencia de un caso (migración 369): cada orden y cada proceso frente
 * al puesto (`momento`), el reparto por momento y, si el familiar vende con una empresa, los datos de esa empresa.
 *
 * Privacidad: con la empresa (pública) cada orden trae su número y su descripción; a nombre del familiar, sólo la fecha y
 * el monto (así las guarda la tabla). Una autoridad electa no tiene evidencia aquí (su parentesco va reservado).
 */
patronesRouter.get("/compras-familia/ventas", async (c) => {
  const p = VentasCompraFamilia.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const { clave } = p.data;
  const cuerpo = await memo.obtener(`compras-familia-ventas:${clave}`, async () => {
    const caso = (await pool.query<{ codigo: string; entidad_ruc: string; pariente: number; empresa_ruc: string; via: string; cargo: string; cargo_indice: string | null }>(
      `SELECT k.codigo, k.entidad_ruc, k.pariente, k.empresa_ruc, k.via, k.cargo, fr.cargo AS cargo_indice
         FROM funcionario_compras_familiar k LEFT JOIN funcionario_resumen fr ON fr.codigo = k.codigo
        WHERE md5(k.codigo || '|' || k.entidad_ruc || '|' || k.pariente || '|' || k.empresa_ruc) = $1 LIMIT 1`, [clave])).rows[0];
    if (!caso || esCargoDeEleccion(caso.cargo_indice) || esCargoDeEleccion(caso.cargo)) return { vacio: true };
    const del = [caso.codigo, caso.entidad_ruc, caso.pariente, caso.empresa_ruc];
    const [ventas, resumen, empresa] = await Promise.all([
      pool.query(
        `SELECT v.tipo, to_char(v.fecha, 'YYYY-MM-DD') AS fecha, v.monto::float AS monto, v.momento, v.orden, v.tipo_orden AS "tipoOrden", v.estado,
                v.descripcion, v.nomenclatura, v.ocid
           FROM funcionario_compras_familiar_venta v
          WHERE v.codigo = $1 AND v.entidad_ruc = $2 AND v.pariente = $3 AND v.empresa_ruc = $4
          ORDER BY v.fecha DESC, v.orden NULLS LAST LIMIT 600`, del),
      pool.query(
        `SELECT v.momento, v.tipo, count(*)::int AS n, COALESCE(sum(v.monto), 0)::float AS monto,
                to_char(min(v.fecha), 'YYYY-MM-DD') AS desde, to_char(max(v.fecha), 'YYYY-MM-DD') AS hasta
           FROM funcionario_compras_familiar_venta v
          WHERE v.codigo = $1 AND v.entidad_ruc = $2 AND v.pariente = $3 AND v.empresa_ruc = $4
          GROUP BY 1, 2`, del),
      caso.via === "empresa"
        ? pool.query(
            `SELECT e.nombre, to_char(e.fecha_alta, 'YYYY-MM-DD') AS "fechaAlta", e.estado_sunat AS "estadoSunat", e.entidades, COALESCE(e.ord_n, 0) AS ordenes,
                    COALESCE(e.ord_monto, 0)::float AS monto, COALESCE(e.adj_procesos, 0) AS procesos, COALESCE(e.adj_monto, 0)::float AS "montoProcesos",
                    e.socios, e.representantes, e.inhabilitada,
                    (SELECT COALESCE(sum(o.monto), 0)::float FROM empresa_orden_anual o WHERE o.ruc = e.ruc AND o.entidad_ruc = $2) AS "montoDeEstaEntidad",
                    (SELECT COALESCE(sum(o.ordenes), 0)::int FROM empresa_orden_anual o WHERE o.ruc = e.ruc AND o.entidad_ruc = $2) AS "ordenesDeEstaEntidad"
               FROM empresa_resumen e WHERE e.ruc = $1`, [caso.empresa_ruc, caso.entidad_ruc]).catch(() => null)
        : null,
    ]);
    return publicar({
      via: caso.via, entidadRuc: caso.entidad_ruc, empresaRuc: caso.empresa_ruc || null,
      ventas: ventas.rows, resumen: resumen.rows, empresa: empresa?.rows[0] ?? null,
    });
  });
  if ((cuerpo as { vacio?: boolean }).vacio) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const AutoridadExsocio = z.object({
  /** RUC de la entidad o de la empresa. */
  buscar: z.string().regex(/^20\d{9}$/).optional(),
  /** La clave opaca de un caso (su ficha de caso). */
  clave: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  severidad: z.enum(["alta", "media"]).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const ROL_RNP: Record<string, string> = { SOCIO_ACCIONISTA_TITULAR: "socio", REPRESENTANTE_LEGAL: "representante legal", ORGANO_ADMINISTRACION: "directivo" };

/**
 * GET /patrones/autoridad-exsocio?buscar=&severidad= — la autoridad electa dejó de figurar en una empresa y esa empresa le
 * vendió a la entidad que gobierna o fiscaliza (migración 367). El impedimento para contratar alcanza a la persona jurídica
 * en la que la autoridad tenga o haya tenido más del 30 % dentro de los 12 meses anteriores a la convocatoria. En
 * observación: el RNP no publica el porcentaje y el corte en que dejó de figurar es mensual.
 *
 * Privacidad: es una autoridad electa y va con su nombre completo, como en el resto del sistema; su documento no sale.
 */
patronesRouter.get("/autoridad-exsocio", async (c) => {
  const p = AutoridadExsocio.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`autoridad-exsocio:${JSON.stringify(q)}`, async () => {
    const [r, t] = await Promise.all([
      pool.query(
        `SELECT v.ruc_empresa AS "empresaRuc", v.empresa, v.autoridad, v.cargo, v.lugar, v.entidad_ruc AS "entidadRuc", v.entidad,
                to_char(v.periodo_inicio, 'YYYY-MM-DD') AS "periodoInicio", to_char(v.periodo_fin, 'YYYY-MM-DD') AS "periodoFin", v.roles,
                v.fue_socio AS "fueSocio", to_char(v.desde, 'YYYY-MM-DD') AS desde, to_char(v.baja_corte, 'YYYY-MM-DD') AS "bajaCorte",
                v.ordenes, v.monto_ordenes::float AS "montoOrdenes", v.procesos, v.monto_procesos::float AS "montoProcesos",
                v.ventas_mientras AS "ventasMientras", v.ventas_en_plazo AS "ventasEnPlazo", v.monto_en_plazo::float AS "montoEnPlazo",
                v.ventas_despues AS "ventasDespues", to_char(v.primera, 'YYYY-MM-DD') AS primera, to_char(v.ultima, 'YYYY-MM-DD') AS ultima,
                v.severidad, ${sqlClaveAutoridad("$6")} AS clave, (count(*) OVER ())::int AS total_filas
           FROM autoridad_exsocio_venta v
          WHERE ($1::text IS NULL OR v.entidad_ruc = $1 OR v.ruc_empresa = $1) AND ($2::text IS NULL OR v.severidad = $2)
            AND ($5::text IS NULL OR ${sqlClaveAutoridad("$6")} = $5)
          ORDER BY CASE v.severidad WHEN 'alta' THEN 0 ELSE 1 END, v.monto_en_plazo DESC, v.monto_ordenes + v.monto_procesos DESC, v.ruc_empresa, v.entidad_ruc
          LIMIT $3 OFFSET $4`, [q.buscar ?? null, q.severidad ?? null, q.size, (q.page - 1) * q.size, q.clave ?? null, salDeClaves()]),
      pool.query<{ casos: number; autoridades: number; empresas: number; entidades: number; monto: number; montoEnPlazo: number }>(
        `SELECT count(*)::int AS casos, count(DISTINCT v.autoridad_id)::int AS autoridades, count(DISTINCT v.ruc_empresa)::int AS empresas,
                count(DISTINCT v.entidad_ruc)::int AS entidades, COALESCE(sum(v.monto_ordenes + v.monto_procesos), 0)::float AS monto,
                COALESCE(sum(v.monto_en_plazo), 0)::float AS "montoEnPlazo"
           FROM autoridad_exsocio_venta v WHERE ($1::text IS NULL OR v.entidad_ruc = $1 OR v.ruc_empresa = $1)`, [q.buscar ?? null]),
    ]).catch(() => [{ rows: [] as Record<string, unknown>[] }, { rows: [] as { casos: number; autoridades: number; empresas: number; entidades: number; monto: number; montoEnPlazo: number }[] }] as const);
    const filas = r.rows as Record<string, any>[];
    return publicar({
      total: filas[0]?.total_filas ?? 0, page: q.page, size: q.size,
      resumen: t.rows[0] ?? null,
      data: filas.map(({ total_filas: _t, roles, ...x }) => ({ ...x, roles: ((roles ?? []) as string[]).map((y) => ROL_RNP[y] ?? y.toLowerCase().replace(/_/g, " ")) })),
      enObservacion: true,
      como_leerlo: "Cada fila es una autoridad electa (alcalde, regidor, gobernador, consejero) que dejó de figurar en la conformación jurídica de una empresa del Registro Nacional de Proveedores, con lo que esa empresa le vendió, dentro de su periodo, a la entidad que gobierna o fiscaliza: órdenes por su fecha de emisión y procesos por su buena pro. «ventasEnPlazo» cuenta las ventas de cuando todavía figuraba en la empresa o de los 12 meses siguientes al corte en que dejó de figurar. El impedimento para contratar alcanza a la persona jurídica en la que la autoridad tenga o haya tenido más del 30 % del capital dentro de los 12 meses anteriores a la convocatoria, y a la que integra o representa (literal i del numeral 11.1 del artículo 11 de la Ley 30225; tipo 3.A del numeral 3 del párrafo 30.1 del artículo 30 de la Ley 32069). Es una señal en observación: el RNP no publica el porcentaje de participación y el corte en que dejó de figurar es mensual. Hay que pedir la partida registral de la empresa y los expedientes de esas compras.",
    });
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
                r.exceso::float AS exceso, r.proveedor_ruc AS "proveedorRuc", e.nombre AS proveedor, r.mismo_proveedor AS "mismoProveedor",
                ${sqlClaveRenovacion(add(salDeClaves()))} AS clave
           FROM servicio_renovacion r LEFT JOIN empresa_resumen e ON e.ruc = r.proveedor_ruc ${donde}
          ORDER BY r.fecha DESC NULLS LAST, r.diff_pct DESC, r.ocid LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals),
      pool.query<{ n: number; exceso: number | null }>(`SELECT count(*)::int AS n, sum(r.exceso)::float AS exceso FROM servicio_renovacion r ${donde}`, vals.slice(0, n)),
    ]);
    return publicar({ total: total.rows[0]?.n ?? 0, exceso: total.rows[0]?.exceso ?? 0, page: q.page, size: q.size, data: filas.rows });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const TIPOS_OBSERVACION = ["reunion_en_evaluacion", "visita_personal_decisor", "ofertas_a_la_vez", "trabajo_en_el_ganador",
  "firma_en_plazo_de_apelacion"] as const;
const Observacion = z.object({
  tipo: z.enum(TIPOS_OBSERVACION).optional(),
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

patronesRouter.get("/observacion", async (c) => {
  const p = Observacion.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`observacion:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    // Sólo empresas: de una persona natural no se publica nada de esto.
    const conds = [`c.tipo = ANY(${add(q.tipo ? [q.tipo] : [...TIPOS_OBSERVACION])}::text[])`, "c.ruc_empresa ~ '^20[0-9]{9}$'"];
    if (q.ruc) conds.push(`(c.ruc_empresa = ${add(q.ruc)} OR btrim(cv.entidad_ruc::text) = $${vals.length})`);
    const [r, t, cat] = await Promise.all([
      pool.query(
        // De quien recibió la visita, sólo su cargo y su área (nunca su nombre): la última visita en la reunión durante
        // la evaluación; el funcionario visitado en las visitas personales. Quien visitó no va en la lista: está en la
        // ficha del contrato, con un apellido tapado.
        // Primero la página (unos cientos de filas en total) y después los nombres. `empresas.ruc` y `entidades.ruc` son
        // character(11): se compara con ese tipo, o la base deja el índice y recorre 250 mil empresas por fila (60 s).
        `WITH k AS MATERIALIZED (
           SELECT c.tipo, c.severidad, c.ocid, c.ruc_empresa, c.fecha, c.detalle, (count(*) OVER ())::int AS total
             FROM cruces_proveedor c
             JOIN convocatorias cv ON cv.ocid = c.ocid
            WHERE ${conds.join(" AND ")}
            ORDER BY CASE c.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, c.fecha DESC NULLS LAST, c.ocid, c.ruc_empresa
            LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)})
         SELECT k.tipo, k.severidad, k.ocid, cv.codigo, cv.objeto, k.ruc_empresa AS ruc, e.razon_social AS empresa,
                btrim(cv.entidad_ruc::text) AS "entidadRuc", en.nombre AS entidad,
                to_char(k.fecha, 'YYYY-MM-DD') AS fecha, k.detalle->>'buena_pro' AS "buenaPro", k.detalle->>'oferta' AS oferta,
                (k.detalle->>'dias_evaluacion')::int AS "diasEvaluacion", (k.detalle->>'visitas_n')::int AS visitas,
                (k.detalle->>'dias')::int AS dias, (k.detalle->>'meses')::int AS meses,
                (k.detalle->>'ya_proveedor')::boolean AS "yaProveedor",
                COALESCE(k.detalle->>'cargo_funcionario', k.detalle->'visitas'->-1->>'cargo', k.detalle->>'cargo') AS cargo,
                -- trabajo_en_el_ganador: cuándo fue el empleo frente a la buena pro, y sus fechas.
                k.detalle->>'cuando' AS cuando, k.detalle->>'empleo_desde' AS "empleoDesde", k.detalle->>'empleo_hasta' AS "empleoHasta",
                -- firma_en_plazo_de_apelacion: cuándo se firmó, cuántos días hábiles después de la buena pro y con cuántas ofertas.
                k.detalle->>'firma' AS firma, (k.detalle->>'dias_habiles')::int AS "diasHabiles", (k.detalle->>'ofertas')::int AS ofertas,
                k.detalle->>'consentimiento_registrado' AS consentimiento, k.detalle->>'norma' AS norma,
                COALESCE(k.detalle->>'area_funcionario', k.detalle->'visitas'->-1->>'area') AS area,
                (k.detalle->>'minutos')::float AS minutos, k.detalle->>'hora_ganador' AS "horaGanador", k.detalle->>'hora_otro' AS "horaOtro",
                k.detalle->'otros_postores'->>0 AS "otroRuc", eo.razon_social AS otro, k.total
           FROM k
           JOIN convocatorias cv ON cv.ocid = k.ocid
           LEFT JOIN empresas e ON e.ruc = k.ruc_empresa::char(11)
           LEFT JOIN entidades en ON en.ruc = cv.entidad_ruc
           LEFT JOIN empresas eo ON eo.ruc = (k.detalle->'otros_postores'->>0)::char(11)
          ORDER BY CASE k.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, k.fecha DESC NULLS LAST, k.ocid, k.ruc_empresa`, vals),
      pool.query<{ tipo: string; n: number }>(
        `SELECT tipo, count(*)::int AS n FROM cruces_proveedor
          WHERE tipo = ANY($1::text[]) AND ruc_empresa ~ '^20[0-9]{9}$' GROUP BY tipo ORDER BY n DESC`, [[...TIPOS_OBSERVACION]]),
      catalogoSenales(),
    ]);
    return publicar({
      total: r.rows[0]?.total ?? 0, page: q.page, size: q.size,
      porTipo: t.rows.map((x) => ({ tipo: x.tipo, n: x.n, etiqueta: ETIQUETA_CRUCE[x.tipo] ?? x.tipo, tasaBase: cat.tasas.get(x.tipo) ?? null })),
      data: r.rows.map(({ total: _t, ...x }) => ({ ...x, etiqueta: ETIQUETA_CRUCE[x.tipo] ?? x.tipo })),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /patrones/entidad/:ruc ──────────────────────────────────────────────────────────────────
/** Las listas de este archivo que se pueden pedir por entidad, con su ruta para una sola fila (interesa el total). */
const LISTAS_DE_ENTIDAD: [clave: string, ruta: (ruc: string) => string][] = [
  ["entidades", (r) => `/?alcance=entidad&ruc=${r}&size=1`],
  ["duenos", (r) => `/duenos?ruc=${r}&size=1`],
  ["grupos", (r) => `/grupos?buscar=${r}&size=1`],
  ["repetidas", (r) => `/repetidas?buscar=${r}&size=1`],
  ["recien", (r) => `/recien?buscar=${r}&size=1`],
  ["renovaciones", (r) => `/renovaciones?ruc=${r}&size=1`],
  ["compras", (r) => `/compras-familia?buscar=${r}&relevantes=1&size=1`],
  ["autoridad", (r) => `/autoridad-exsocio?buscar=${r}&size=1`],
  ["doble", (r) => `/doble?buscar=${r}&size=1`],
  ["inhabilitadas", (r) => `/inhabilitadas?ruc=${r}&size=1`],
  ["control", (r) => `/control?ruc=${r}&size=1`],
  ["observados", (r) => `/observados?ruc=${r}&size=1`],
  ["observacion", (r) => `/observacion?ruc=${r}&size=1`],
];

/**
 * GET /patrones/entidad/:ruc — el índice de la pestaña «Patrones» de una entidad: qué patrones tienen casos en ella y
 * cuántos. Pedido del usuario del 2026-11-18: la ficha de la entidad tenía banderas sueltas y listas filtradas, pero
 * no decía «aquí hay patrones de concertación» ni tenía una ficha por patrón.
 *
 * No repite ninguna regla: le pregunta a cada lista de este mismo archivo (por dentro, sin salir a la red) con el RUC de
 * la entidad, y suma los antecedentes de los ganadores de sus contratos por tipo (casos_cruce), con seis contratos de
 * ejemplo de cada uno. En tandas de cinco, para no ocupar el pozo de conexiones. `casos: null` = esa lista no respondió.
 */
/** Las mismas listas, por la empresa (como ganadora, acompañante, socia de consorcio, integrante de un grupo…). */
const LISTAS_DE_EMPRESA: [clave: string, ruta: (ruc: string) => string][] = [
  ["proveedores", (r) => `/?alcance=proveedor&ruc=${r}&size=1`],
  ["relleno", (r) => `/acompanantes?ruc=${r}&size=1`],
  ["consorcios", (r) => `/consorcios?ruc=${r}&size=1`],
  ["duenos", (r) => `/duenos?ruc=${r}&size=1`],
  ["grupos", (r) => `/grupos?buscar=${r}&size=1`],
  ["repetidas", (r) => `/repetidas?buscar=${r}&size=1`],
  ["recien", (r) => `/recien?buscar=${r}&size=1`],
  ["renovaciones", (r) => `/renovaciones?ruc=${r}&size=1`],
  ["compras", (r) => `/compras-familia?buscar=${r}&relevantes=1&size=1`],
  ["autoridad", (r) => `/autoridad-exsocio?buscar=${r}&size=1`],
  ["inhabilitadas", (r) => `/inhabilitadas?ruc=${r}&size=1`],
  ["control", (r) => `/control?ruc=${r}&size=1`],
  ["observados", (r) => `/observados?ruc=${r}&size=1`],
  ["observacion", (r) => `/observacion?ruc=${r}&size=1`],
];

/** Cuántos casos tiene cada lista con ese RUC: se le pregunta a cada una por dentro, en tandas de cinco. */
async function casosPorLista(listasDe: typeof LISTAS_DE_ENTIDAD, ruc: string, env: unknown): Promise<{ clave: string; casos: number | null }[]> {
  const contar = async (ruta: string): Promise<number | null> => {
    try {
      const r = await patronesRouter.request(ruta, undefined, env as object);
      if (!r.ok) return null;
      return Number(((await r.json()) as { total?: number }).total ?? 0);
    } catch (e) {
      console.warn(`[patrones] índice de ${ruc}, ${ruta}: ${(e as Error).message}`);
      return null;
    }
  };
  const listas: { clave: string; casos: number | null }[] = [];
  for (let i = 0; i < listasDe.length; i += 5) {
    const tanda = listasDe.slice(i, i + 5);
    const ns = await Promise.all(tanda.map(([, ruta]) => contar(ruta(ruc))));
    tanda.forEach(([clave], j) => listas.push({ clave, casos: ns[j] }));
  }
  return listas;
}

/**
 * GET /patrones/empresa/:ruc — en qué patrones aparece una empresa y con cuántos casos: lo que su pestaña «Antecedentes»
 * pone arriba de lo que dicen de ella los demás registros.
 */
patronesRouter.get("/empresa/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^20\d{9}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await memo.obtener(`de-empresa:${ruc}`, async () => publicar({ ruc, listas: await casosPorLista(LISTAS_DE_EMPRESA, ruc, c.env) }));
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

patronesRouter.get("/entidad/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^20\d{9}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await memo.obtener(`de-entidad:${ruc}`, async () => {
    const listas = await casosPorLista(LISTAS_DE_ENTIDAD, ruc, c.env);
    // Los antecedentes de quienes ganaron sus contratos, por tipo: cuántos contratos, cuántos de señal alta, cuánto suman,
    // cuántas empresas y los seis contratos más pesados (lo grave primero).
    const cruces = await pool.query(
      `WITH x AS (
         SELECT t.tipo, t.severidad, k.ocid, k.codigo, k.objeto, k.proveedor, k.ruc, k.monto, k.fecha_buena_pro,
                row_number() OVER (PARTITION BY t.tipo ORDER BY (t.severidad = 'alta') DESC, k.monto DESC NULLS LAST, k.ocid) AS rn
           FROM casos_cruce k CROSS JOIN LATERAL jsonb_to_recordset(k.cruces) AS t(tipo text, severidad text)
          WHERE k.entidad_ruc = $1 AND t.tipo IS NOT NULL),
       -- Quiénes lo repiten: los proveedores con más contratos de la entidad con ese antecedente.
       p AS (
         SELECT x.tipo, x.ruc, max(x.proveedor) AS proveedor, count(*)::int AS contratos, COALESCE(sum(x.monto), 0)::float AS monto,
                row_number() OVER (PARTITION BY x.tipo ORDER BY count(*) DESC, sum(x.monto) DESC NULLS LAST, x.ruc) AS rn
           FROM x GROUP BY x.tipo, x.ruc)
       SELECT x.tipo, count(*)::int AS contratos, (count(*) FILTER (WHERE x.severidad = 'alta'))::int AS graves,
              (count(*) FILTER (WHERE x.severidad = 'media'))::int AS medias,
              COALESCE(sum(x.monto), 0)::float AS monto, count(DISTINCT x.ruc)::int AS empresas,
              jsonb_agg(jsonb_build_object('ocid', x.ocid, 'codigo', x.codigo, 'objeto', left(x.objeto, 180), 'proveedor', x.proveedor, 'ruc', x.ruc,
                                           'monto', x.monto, 'fecha', to_char(x.fecha_buena_pro, 'YYYY-MM-DD'), 'severidad', x.severidad)
                        ORDER BY x.rn) FILTER (WHERE x.rn <= 6) AS ejemplos,
              (SELECT jsonb_agg(jsonb_build_object('ruc', p.ruc, 'proveedor', p.proveedor, 'contratos', p.contratos, 'monto', p.monto) ORDER BY p.rn)
                 FROM p WHERE p.tipo = x.tipo AND p.rn <= 5 AND p.contratos > 1) AS repiten
         FROM x GROUP BY x.tipo ORDER BY 3 DESC, 2 DESC`, [ruc])
      .catch((e) => { console.warn(`[patrones] cruces de ${ruc}: ${(e as Error).message}`); return { rows: [] as Record<string, any>[] }; });
    return publicar({
      ruc, listas,
      cruces: (cruces.rows as Record<string, any>[]).map((x) => ({ ...x, etiqueta: ETIQUETA_CRUCE[x.tipo] ?? x.tipo })),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/** Qué patrones ya tienen su ficha de caso, y quién la arma. */
const CASOS: Record<string, (clave: string, pedir: Pedir) => Promise<CasoPatron | null>> = {
  grupos: casoGrupo,
  compras: casoComprasFamilia,
  duenos: casoDueno,
  relleno: casoRelleno,
  inhabilitadas: casoInhabilitada,
  autoridad: casoAutoridad,
  renovaciones: casoRenovacion,
  repetidas: casoRepetida,
  recien: casoRecien,
};

/**
 * GET /patrones/caso/:tipo/:clave — la ficha de UN caso de un patrón (pedido del usuario del 2026-11-18): su historia hecho
 * por hecho, quiénes son (nodos y vínculos), por qué llama la atención, cada orden o contrato con su enlace, qué revisar y
 * sus fuentes, en un solo molde para todos los patrones (lib/casoPatron.ts). La clave es opaca (nunca un RUC 10).
 */
patronesRouter.get("/caso/:tipo/:clave", async (c) => {
  const tipo = c.req.param("tipo");
  const clave = c.req.param("clave");
  const armar = CASOS[tipo];
  // 16 hex (los grupos) o 32 (compras y familia, que ya tenía su clave entera).
  if (!armar || !/^(?:[0-9a-f]{16}|[0-9a-f]{32})$/.test(clave)) return c.json({ error: "not_found" }, 404);
  const pedir: Pedir = async (ruta) => {
    const r = await patronesRouter.request(ruta, undefined, c.env as object);
    return r.ok ? ((await r.json()) as Record<string, any>) : null;
  };
  const cuerpo = await memo.obtener(`caso:${tipo}:${clave}`, async (ctl) => {
    try {
      const caso = await armar(clave, pedir);
      return caso ? publicar(caso as unknown as Record<string, unknown>) : { noEncontrado: true };
    } catch (e) {
      console.warn(`[patrones] caso ${tipo}/${clave}: ${(e as Error).message}`);
      ctl.noGuardar();
      return { noRespondio: true };
    }
  });
  if (cuerpo.noRespondio) {
    c.header("Cache-Control", "no-store");
    return c.json({ error: "no_respondio" }, 503);
  }
  if (cuerpo.noEncontrado) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
