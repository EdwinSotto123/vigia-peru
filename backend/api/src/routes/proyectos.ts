import { Hono } from "hono";
import { z } from "zod";
import { pool, poolAdmin } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { enSegundoPlano } from "../lib/plataforma.js";
import { palabras } from "../lib/obras.js";

/**
 * Gobserva Obras (obras.gobserva.cloud, 2026-11-01): los proyectos de inversión pública (Invierte.pe) y las obras en marcha
 * (INFOBRAS), para quien construye, supervisa o vende materiales. Se monta en /proyectos (app.ts): /obras ya es de Vigía
 * (routes/obras.ts). Todo sale de la tabla plana gobserva_proyecto y de las funciones de la migración 232.
 *
 *   GET /proyectos/resumen        la portada: el pipeline (se vienen, con expediente, licitándose), lo que está en marcha
 *                                 y paralizado, lo que falta ejecutar, por región y por sector, los que se vienen más
 *                                 grandes, los que se están licitando y las obras más grandes en marcha.
 *   GET /proyectos/lista          la lista con pestaña (se vienen, en marcha, paralizadas, todos), filtros (texto, región,
 *                                 sector, nivel, fase, modalidad, tipo, monto, entidad), orden y sus facetas con conteos.
 *   GET /proyectos/ficha/:cui     la ficha de una inversión (activa o cerrada): gobserva_obras_ficha().
 *   GET /proyectos/mercado        el mercado de obras de una región y un sector: gobserva_obras_mercado().
 *   GET /proyectos/sitemap        los CUI que van al sitemap del producto.
 *
 * Privacidad: la tabla y las funciones sólo traen empresas con RUC 20 (de un consorcio, sus integrantes RUC 20); una
 * persona natural no se nombra ni se cuenta con su RUC. Igual todo sale por `publicar()`.
 *
 * La tabla se rehace con gobserva_refrescar_proyectos() (~18 s): lo ideal es al final de cada carga de invierte_pe e
 * infobras; si la API la encuentra con más de 20 h, la pide en segundo plano con el pool del panel (120 s por sentencia),
 * a lo más una vez por hora en cada instancia.
 *
 * `condicionesProyectos(filtros)` arma el WHERE de una búsqueda (los filtros de la lista) para reusarlo fuera de aquí: las
 * alertas de Obras (lib/gobservaAlertas.ts) lo cruzan con `primera_vez` y `fase_cambio_at` de la tabla.
 */
export const proyectosRouter = new Hono();

const CACHE = cachePublico(600, { maxAge: 120, swr: 3600 });
const CACHE_LARGO = cachePublico(3600, { maxAge: 600, swr: 21600 });
const memo = new Memo<Record<string, unknown>>({ nombre: "proyectos", ttlMs: 600_000, staleMs: 1_800_000, max: 400 });
const memoLargo = new Memo<Record<string, unknown>>({ nombre: "proyectos-largo", ttlMs: 6 * 3_600_000, staleMs: 6 * 3_600_000, max: 200 });
/** Las fichas (null: no existe; una inversión recién cargada tarda como mucho una hora en aparecer). */
const memoFicha = new Memo<Record<string, unknown> | null>({ nombre: "proyectos-ficha", ttlMs: 3_600_000, staleMs: 3_600_000, max: 800 });

export const PESTANAS = ["se_vienen", "en_marcha", "paralizadas", "todos"] as const;
export const FASES = ["viable", "expediente", "licitacion", "ejecucion", "paralizada", "terminada", "sin_movimiento"] as const;
export const SECTORES = [
  "transporte", "saneamiento", "educacion", "salud", "agro", "urbano", "deporte", "energia", "ambiente", "seguridad", "gestion",
  "social", "comercio", "justicia", "comunicaciones", "otros",
] as const;
export const MODALIDADES = ["contrata", "directa", "mixta", "oxi", "app", "nucleo", "otra"] as const;
const NIVELES = ["gn", "gr", "gl"] as const;
const REGION = /^(0[1-9]|1\d|2[0-5])$/;

/** Lo que define cada pestaña. */
const PESTANA_SQL: Record<(typeof PESTANAS)[number], string> = {
  se_vienen: "p.se_viene",
  en_marcha: "p.fase = 'ejecucion'",
  paralizadas: "p.fase = 'paralizada'",
  todos: "true",
};

/** Las columnas de un proyecto en las listas y la portada. */
const COLS = `p.cui, p.nombre, p.fase, p.se_viene AS "seViene", p.tipo, p.nivel, p.sector, p.funcion, p.modalidad,
  p.entidad, p.entidad_ruc AS "entidadRuc", p.region, p.provincia, p.distrito,
  p.costo::float, p.viable::float, p.por_ejecutar::float AS "porEjecutar", p.devengado::float, p.pim_anio::float AS "pimAnio",
  p.con_expediente AS "conExpediente", to_char(p.fecha_viable, 'YYYY-MM-DD') AS "fechaViable",
  to_char(p.ultimo_gasto, 'YYYY-MM') AS "ultimoGasto", p.avance_mef::float AS "avanceMef", p.obras,
  p.obra_codigo AS "obraCodigo", p.obra_estado AS "obraEstado", p.obra_fisico::float AS "obraFisico",
  p.obra_programado::float AS "obraProgramado", to_char(p.obra_avance_al, 'YYYY-MM-DD') AS "obraAvanceAl",
  to_char(p.obra_inicio, 'YYYY-MM-DD') AS "obraInicio", to_char(p.obra_fin, 'YYYY-MM-DD') AS "obraFin",
  to_char(p.obra_paralizada_desde, 'YYYY-MM-DD') AS "paralizadaDesde", p.obra_causal AS causal,
  p.ejecutor_ruc AS "ejecutorRuc", p.ejecutor, p.obra_representa AS "obraRepresenta",
  p.convocatoria_ocid AS "convocatoriaOcid", p.convocatoria_tipo AS "convocatoriaTipo",
  to_char(p.convocatoria_fecha, 'YYYY-MM-DD') AS "convocatoriaFecha", p.convocatoria_valor::float AS "convocatoriaValor", p.procesos`;

// ─── El refresco de la tabla ─────────────────────────────────────────────────────────────────────────────────────────

let ultimoIntento = 0;

/** Si la tabla tiene más de 20 h, pide rehacerla en segundo plano (a lo más una vez por hora en esta instancia). */
function refrescarSiHaceFalta(refrescado: unknown) {
  const at = typeof refrescado === "string" ? Date.parse(refrescado) : NaN;
  const edad = Number.isFinite(at) ? Date.now() - at : Infinity;
  if (edad < 20 * 3_600_000 || Date.now() - ultimoIntento < 3_600_000) return;
  ultimoIntento = Date.now();
  enSegundoPlano(
    poolAdmin
      .query("SELECT gobserva_refrescar_proyectos() AS r")
      .then((r) => console.log(JSON.stringify({ severity: "INFO", message: "[proyectos] tabla refrescada", r: r.rows[0]?.r })))
      .catch((e: Error) => console.warn(JSON.stringify({ severity: "WARNING", message: `[proyectos] el refresco falló: ${e.message}` }))),
  );
}

const ESTADO = `SELECT to_char(refrescado_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS refrescado,
  to_char(inversiones_al, 'YYYY-MM-DD') AS "inversionesAl", to_char(infobras_al, 'YYYY-MM-DD') AS "infobrasAl"
  FROM gobserva_proyecto_estado WHERE id`;

// ─── GET /proyectos/resumen ──────────────────────────────────────────────────────────────────────────────────────────

proyectosRouter.get("/resumen", async (c) => {
  // En frío recorre gobserva_proyecto (~150 mil filas) tres veces: ~40 s medidos el 2026-11-20, más de lo que espera la
  // portada de Obras («las cifras no cargaron»). La tabla se refresca una vez al día: caché larga en memoria y en el
  // borde, que sirve la copia anterior mientras rehace la nueva.
  const cuerpo = await memoLargo.obtener("resumen", async () => {
    // Tres sentencias (y no ocho): cada una abre su conexión, y en frío eso pesaba más que las consultas.
    const lista = (donde: string, orden: string, n: number) =>
      `COALESCE((SELECT json_agg(t) FROM (SELECT ${COLS} FROM gobserva_proyecto p WHERE ${donde} ORDER BY ${orden} LIMIT ${n}) t), '[]')`;
    const [cifras, listas, estado] = await Promise.all([
      pool.query(
        `WITH g AS MATERIALIZED (SELECT region, sector, se_viene, fase, costo FROM gobserva_proyecto)
         SELECT x.*,
                COALESCE((SELECT json_agg(t ORDER BY t."seVienenMonto" DESC) FROM (
                  SELECT region AS clave, count(*) FILTER (WHERE se_viene)::int AS "seVienen",
                         COALESCE(sum(costo) FILTER (WHERE se_viene), 0)::float AS "seVienenMonto",
                         count(*) FILTER (WHERE fase = 'ejecucion')::int AS "enMarcha",
                         COALESCE(sum(costo) FILTER (WHERE fase = 'ejecucion'), 0)::float AS "enMarchaMonto",
                         count(*) FILTER (WHERE fase = 'paralizada')::int AS paralizadas
                    FROM g WHERE region IS NOT NULL GROUP BY 1) t), '[]') AS "porRegion",
                COALESCE((SELECT json_agg(t ORDER BY t."seVienenMonto" DESC) FROM (
                  SELECT sector AS clave, count(*) FILTER (WHERE se_viene)::int AS "seVienen",
                         COALESCE(sum(costo) FILTER (WHERE se_viene), 0)::float AS "seVienenMonto",
                         count(*) FILTER (WHERE fase = 'ejecucion')::int AS "enMarcha",
                         COALESCE(sum(costo) FILTER (WHERE fase = 'ejecucion'), 0)::float AS "enMarchaMonto"
                    FROM g GROUP BY 1) t), '[]') AS "porSector"
           FROM (SELECT count(*)::int AS activas,
                count(*) FILTER (WHERE se_viene)::int AS "seVienen",
                COALESCE(sum(costo) FILTER (WHERE se_viene), 0)::float AS "seVienenMonto",
                count(*) FILTER (WHERE se_viene AND fase = 'viable')::int AS viables,
                COALESCE(sum(costo) FILTER (WHERE se_viene AND fase = 'viable'), 0)::float AS "viablesMonto",
                count(*) FILTER (WHERE se_viene AND fase = 'expediente')::int AS expediente,
                COALESCE(sum(costo) FILTER (WHERE se_viene AND fase = 'expediente'), 0)::float AS "expedienteMonto",
                count(*) FILTER (WHERE fase = 'licitacion')::int AS licitando,
                COALESCE(sum(costo) FILTER (WHERE fase = 'licitacion'), 0)::float AS "licitandoMonto",
                count(*) FILTER (WHERE fase = 'ejecucion')::int AS "enMarcha",
                COALESCE(sum(costo) FILTER (WHERE fase = 'ejecucion'), 0)::float AS "enMarchaMonto",
                count(*) FILTER (WHERE fase = 'ejecucion' AND obra_estado = 'En Ejecución')::int AS "enMarchaInfobras",
                count(*) FILTER (WHERE fase = 'paralizada')::int AS paralizadas,
                COALESCE(sum(costo) FILTER (WHERE fase = 'paralizada'), 0)::float AS "paralizadasMonto",
                COALESCE(sum(por_ejecutar) FILTER (WHERE se_viene OR fase IN ('ejecucion', 'paralizada')), 0)::float AS "porEjecutar",
                COALESCE(sum(pim_anio), 0)::float AS "pimAnio",
                COALESCE(sum(devengado_anio), 0)::float AS "devengadoAnio",
                count(*) FILTER (WHERE se_viene AND fecha_viable >= current_date - 30)::int AS "nuevos30",
                count(*) FILTER (WHERE se_viene AND costo >= 10000000)::int AS "seVienen10m",
                count(*) FILTER (WHERE se_viene AND tipo = 'equipamiento')::int AS "seVienenEquipamiento",
                count(*) FILTER (WHERE se_viene AND modalidad IN ('contrata', 'mixta', 'oxi', 'app', 'nucleo'))::int AS "seVienenContrata"
           FROM gobserva_proyecto) x`,
      ),
      pool.query(
        `SELECT
           -- Los que se vienen más grandes con expediente técnico, declarados viables en los últimos 2 años.
           ${lista("p.se_viene AND p.fase = 'expediente' AND p.fecha_viable >= current_date - 730", "p.costo DESC NULLS LAST, p.cui DESC", 6)} AS "seVienenTop",
           ${lista("p.fase = 'licitacion'", "p.convocatoria_fecha DESC NULLS LAST, p.costo DESC NULLS LAST, p.cui DESC", 4)} AS "licitandoTop",
           ${lista("p.fase = 'ejecucion' AND p.obra_estado = 'En Ejecución'", "p.costo DESC NULLS LAST, p.cui DESC", 6)} AS "enMarchaTop",
           -- Los recién declarados viables (o aprobados): el pipeline que acaba de nacer.
           ${lista("p.se_viene AND p.costo >= 1000000", "p.fecha_viable DESC NULLS LAST, p.costo DESC NULLS LAST, p.cui DESC", 6)} AS nuevos`,
      ),
      pool.query(ESTADO),
    ]);
    const est = estado.rows[0] ?? null;
    refrescarSiHaceFalta(est?.refrescado);
    return publicar({ ...cifras.rows[0], ...listas.rows[0], estado: est });
  });
  c.header("Cache-Control", CACHE_LARGO);
  return c.json(cuerpo);
});

// ─── GET /proyectos/lista ────────────────────────────────────────────────────────────────────────────────────────────

const QLista = z.object({
  pestana: z.enum(PESTANAS).default("se_vienen"),
  q: z.string().trim().max(120).optional(),
  region: z.string().regex(REGION).optional(),
  sector: z.enum(SECTORES).optional(),
  nivel: z.enum(NIVELES).optional(),
  fase: z.enum(FASES).optional(),
  modalidad: z.enum(MODALIDADES).optional(),
  tipo: z.enum(["obra", "equipamiento"]).optional(),
  min: z.coerce.number().min(0).max(1e13).optional(),
  max: z.coerce.number().min(0).max(1e13).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  orden: z.enum(["monto", "reciente"]).default("monto"),
  page: z.coerce.number().int().min(1).max(50).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
type QL = z.infer<typeof QLista>;
type Faceta = "region" | "sector" | "nivel" | "fase" | "modalidad" | "tipo";
const FACETAS: Faceta[] = ["region", "sector", "nivel", "fase", "modalidad", "tipo"];

/** Los filtros de una búsqueda de proyectos: los de GET /proyectos/lista sin orden ni página (los guarda una alerta). */
export interface FiltrosProyectos {
  /** Sin pestaña, todos (una alerta suele no tenerla: los cambios de fase son lo que avisa). */
  pestana?: string;
  q?: string;
  region?: string;
  sector?: string;
  nivel?: string;
  fase?: string;
  modalidad?: string;
  tipo?: string;
  min?: number | string;
  max?: number | string;
  entidad?: string;
}
const CAMPOS_FILTRO = {
  pestana: z.enum(PESTANAS),
  q: z.string().trim().min(1).max(120),
  region: z.string().regex(REGION),
  sector: z.enum(SECTORES),
  nivel: z.enum(NIVELES),
  fase: z.enum(FASES),
  modalidad: z.enum(MODALIDADES),
  tipo: z.enum(["obra", "equipamiento"]),
  min: z.coerce.number().positive().max(1e13),
  max: z.coerce.number().positive().max(1e13),
  entidad: z.string().regex(/^\d{11}$/),
} as const;
type Validos = { [K in keyof typeof CAMPOS_FILTRO]?: z.infer<(typeof CAMPOS_FILTRO)[K]> };

/** Cada filtro por su cuenta: uno mal escrito (de una alerta vieja, de una URL) se descarta y no tumba la búsqueda. */
function validos(f: FiltrosProyectos): Validos {
  const out: Record<string, unknown> = {};
  for (const [k, esquema] of Object.entries(CAMPOS_FILTRO)) {
    const v = (f as Record<string, unknown>)[k];
    if (v == null || v === "") continue;
    const r = esquema.safeParse(v);
    if (r.success) out[k] = r.data;
  }
  return out as Validos;
}

/**
 * Las piezas del WHERE de una búsqueda (alias `p` = gobserva_proyecto): lo que no es faceta (pestaña, texto, montos,
 * entidad) en `fijas`; cada faceta, en `marcas` («true» si no se filtra), para contarla sin ella. `p` agrega un valor
 * y devuelve su marcador ($n).
 */
function piezas(f: Validos, p: (v: unknown) => string) {
  const fijas = f.pestana ? [PESTANA_SQL[f.pestana]] : [];
  if (f.min != null) fijas.push(`p.costo >= ${p(f.min)}`);
  if (f.max != null) fijas.push(`p.costo <= ${p(f.max)}`);
  if (f.entidad) fijas.push(`p.entidad_ruc = '${f.entidad}'`); // 11 dígitos ya validados: literal, como en lib/obras.ts
  for (const w of palabras(f.q)) fijas.push(`p.texto LIKE ${p(`%${w}%`)}`);
  const marcas: Record<Faceta, string> = {
    region: f.region ? `p.region = ${p(f.region)}` : "true",
    sector: f.sector ? `p.sector = ${p(f.sector)}` : "true",
    nivel: f.nivel ? `p.nivel = ${p(f.nivel.toUpperCase())}` : "true",
    fase: f.fase ? `p.fase = ${p(f.fase)}` : "true",
    modalidad: f.modalidad ? `p.modalidad = ${p(f.modalidad)}` : "true",
    tipo: f.tipo ? `p.tipo = ${p(f.tipo)}` : "true",
  };
  return { fijas, marcas };
}

/**
 * La condición de una búsqueda de proyectos para reusarla fuera de esta ruta (las alertas de Obras,
 * lib/gobservaAlertas.ts): `where` sobre `gobserva_proyecto p` (sin la palabra WHERE; «true» sin filtros) y sus valores,
 * con marcadores desde `$inicio`. Los filtros que no valen se descartan. Por ejemplo, lo nuevo desde el último aviso:
 *
 *   const { where, vals } = condicionesProyectos(alerta.filtros);
 *   pool.query(`SELECT … FROM gobserva_proyecto p WHERE ${where}
 *                 AND (p.primera_vez > $${vals.length + 1} OR p.fase_cambio_at > $${vals.length + 1})`, [...vals, desde]);
 */
export function condicionesProyectos(filtros: FiltrosProyectos, inicio = 1): { where: string; vals: unknown[] } {
  const vals: unknown[] = [];
  const { fijas, marcas } = piezas(validos(filtros), (v) => {
    vals.push(v);
    return `$${inicio + vals.length - 1}`;
  });
  const todas = [...fijas, ...Object.values(marcas).filter((m) => m !== "true")];
  return { where: todas.length ? todas.join(" AND ") : "true", vals };
}

/** Las condiciones de la lista: la misma regla, con la pestaña siempre puesta. */
function condiciones(q: QL) {
  const vals: unknown[] = [];
  const { fijas, marcas } = piezas(validos({ ...q, pestana: q.pestana }), (v) => {
    vals.push(v);
    return `$${vals.length}`;
  });
  return { fijas, marcas, vals };
}

function ordenDe(q: QL): string {
  if (q.orden === "monto") return "p.costo DESC NULLS LAST, p.cui DESC";
  if (q.pestana === "paralizadas") return "p.obra_paralizada_desde DESC NULLS LAST, p.costo DESC NULLS LAST, p.cui DESC";
  if (q.pestana === "en_marcha") return "COALESCE(p.obra_inicio, p.fecha_viable) DESC NULLS LAST, p.costo DESC NULLS LAST, p.cui DESC";
  return "p.fecha_viable DESC NULLS LAST, p.costo DESC NULLS LAST, p.cui DESC";
}

proyectosRouter.get("/lista", async (c) => {
  const p = QLista.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`lista:${JSON.stringify(q)}`, async () => {
    const { fijas, marcas, vals } = condiciones(q);
    const todas = Object.values(marcas);
    const sin = (f: Faceta) => FACETAS.filter((x) => x !== f).map((x) => `f_${x}`).join(" AND ");
    const conteo = (f: Faceta, col: string, extra = "") =>
      `COALESCE((SELECT json_agg(t ORDER BY t.n DESC, t.clave) FROM (SELECT ${col} AS clave, count(*)::int AS n FROM b
                  WHERE ${sin(f)}${extra} GROUP BY 1) t), '[]')`;
    // Cuántos hay en cada pestaña con los demás filtros: la misma búsqueda sin la pestaña (ni la fase, que el enlace de
    // cada pestaña quita), contada de una vez.
    const sinPestana = condicionesProyectos({ ...q, pestana: undefined, fase: undefined } as FiltrosProyectos);
    const [filas, resumen, pestanas] = await Promise.all([
      pool.query(
        `SELECT ${COLS} FROM gobserva_proyecto p WHERE ${[...fijas, ...todas].join(" AND ")}
          ORDER BY ${ordenDe(q)} LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
        vals,
      ),
      pool.query(
        `WITH b AS MATERIALIZED (
           SELECT p.region, p.sector, p.nivel, p.fase, p.modalidad, p.tipo, p.costo, p.por_ejecutar, p.entidad_ruc,
                  ${FACETAS.map((f) => `(${marcas[f]}) AS f_${f}`).join(", ")}
             FROM gobserva_proyecto p WHERE ${fijas.join(" AND ")}
         )
         SELECT (SELECT count(*) FROM b WHERE ${FACETAS.map((f) => `f_${f}`).join(" AND ")})::int AS total,
                (SELECT COALESCE(sum(costo), 0) FROM b WHERE ${FACETAS.map((f) => `f_${f}`).join(" AND ")})::float AS monto,
                (SELECT COALESCE(sum(por_ejecutar), 0) FROM b WHERE ${FACETAS.map((f) => `f_${f}`).join(" AND ")})::float AS "porEjecutar",
                (SELECT count(DISTINCT entidad_ruc) FROM b WHERE ${FACETAS.map((f) => `f_${f}`).join(" AND ")})::int AS entidades,
                ${conteo("region", "region", " AND region IS NOT NULL")} AS region,
                ${conteo("sector", "sector")} AS sector,
                ${conteo("nivel", "lower(nivel)", " AND nivel IS NOT NULL")} AS nivel,
                ${conteo("fase", "fase")} AS fase,
                ${conteo("modalidad", "modalidad", " AND modalidad IS NOT NULL")} AS modalidad,
                ${conteo("tipo", "tipo")} AS tipo`,
        vals,
      ),
      pool.query(
        `SELECT ${PESTANAS.map((t) => `count(*) FILTER (WHERE ${PESTANA_SQL[t]})::int AS ${t}`).join(", ")}
           FROM gobserva_proyecto p WHERE ${sinPestana.where}`,
        sinPestana.vals,
      ),
    ]);
    const r = resumen.rows[0] as Record<string, unknown>;
    return publicar({
      ...q,
      total: r.total,
      pestanas: pestanas.rows[0] ?? null,
      resumen: { monto: r.monto, porEjecutar: r.porEjecutar, entidades: r.entidades },
      facetas: { region: r.region, sector: r.sector, nivel: r.nivel, fase: r.fase, modalidad: r.modalidad, tipo: r.tipo },
      data: filas.rows,
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /proyectos/ficha/:cui ───────────────────────────────────────────────────────────────────────────────────────

proyectosRouter.get("/ficha/:cui", async (c) => {
  const cui = c.req.param("cui");
  if (!/^\d{7}$/.test(cui)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await memoFicha.obtener(`ficha:${cui}`, async () => {
    const r = await pool.query("SELECT gobserva_obras_ficha($1) AS f", [cui]);
    const f = r.rows[0]?.f as Record<string, unknown> | null | undefined;
    return f ? publicar(f) : null;
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE_LARGO);
  return c.json(cuerpo);
});

// ─── GET /proyectos/mercado ──────────────────────────────────────────────────────────────────────────────────────────

const QMercado = z.object({ region: z.string().regex(REGION).optional(), sector: z.enum(SECTORES).optional() });

proyectosRouter.get("/mercado", async (c) => {
  const p = QMercado.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const { region, sector } = p.data;
  const cuerpo = await memoLargo.obtener(`mercado:${region ?? ""}:${sector ?? ""}`, async () => {
    const r = await pool.query("SELECT gobserva_obras_mercado($1, $2) AS m", [region ?? null, sector ?? null]);
    return publicar((r.rows[0]?.m ?? {}) as Record<string, unknown>);
  });
  c.header("Cache-Control", CACHE_LARGO);
  return c.json(cuerpo);
});

// ─── GET /proyectos/sitemap ──────────────────────────────────────────────────────────────────────────────────────────

proyectosRouter.get("/sitemap", async (c) => {
  const cuerpo = await memoLargo.obtener("sitemap", async () => {
    const r = await pool.query(
      `SELECT cui, to_char(actualizado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha FROM gobserva_proyecto
        WHERE se_viene OR fase IN ('ejecucion', 'paralizada') ORDER BY costo DESC NULLS LAST, cui LIMIT 5000`,
    );
    return { data: r.rows };
  });
  c.header("Cache-Control", CACHE_LARGO);
  return c.json(cuerpo);
});
