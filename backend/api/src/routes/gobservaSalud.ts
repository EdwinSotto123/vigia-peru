import { Hono, type Context } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros, SIN_CACHE } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { enSegundoPlano } from "../lib/plataforma.js";
import { claveIp, cuantasEn, dentroDeTope, HEADER_TURNSTILE, ipCliente, pedidoInterno, verificarTurnstile } from "../lib/antibots.js";
import { correrChat, type EnvChat } from "../lib/chatInvestigacion.js";
import { eventoPublico, huellaIp, enListaFija } from "../lib/chatVigia.js";
import { registrarConsumo } from "../lib/consumo.js";
import { registrar } from "../lib/registro.js";
import { embeber, vectorLiteral, type IaWorkers } from "../lib/rag.js";
import {
  CATEGORIAS, FUENTES_SALUD, HERRAMIENTAS_ASISTENTE_SALUD, URL_CMP, URL_SANCIONES, URL_SUNEDU, URL_VIGIA, consultaRenipress,
  pasosVerificarMedico, sistemaAsistenteSalud, tituloColegio, verificar, type DatosVerificacion,
} from "../lib/gobservaSalud.js";

/**
 * Gobserva Salud (salud.gobserva.cloud, 2026-11-20): verificar establecimientos de salud y médicos con fuentes oficiales
 * (migración 432; las cargas, backend/scrapers-worker/src/fuentes/susalud*.ts). Público y sin cuenta: es para cualquier
 * ciudadano. Se monta en /salud (app.ts).
 *
 *   GET  /salud/resumen                 cifras del país y fecha de cada fuente (la portada y el pie).
 *   GET  /salud/buscar?q=               un solo buscador: código de IPRESS, RUC, número de colegiatura o nombre.
 *   GET  /salud/establecimientos        la lista con filtros (texto, región, provincia, distrito, categoría, sector, tipo,
 *                                       estado, con sanciones, quirúrgico, internamiento), orden, páginas y facetas.
 *   GET  /salud/mapa                    los puntos (con los mismos filtros), compactos.
 *   GET  /salud/establecimiento/:codigo la ficha: registro, detalle, chequeos de verificación, sanciones, denuncias,
 *                                       recursos, cirugías, historial, fuentes y lo que Vigía sabe de su RUC.
 *   GET  /salud/medico/:colegiatura     lo que dicen las fuentes abiertas de una colegiatura (RENIPRESS) y cómo verificarla.
 *   GET  /salud/sanciones               el Registro de Sanciones de SUSALUD, con filtros y páginas.
 *   GET  /salud/cambios                 lo que cambió en RENIPRESS (altas, bajas, estado, categoría), lo más nuevo primero.
 *   GET  /salud/fuentes                 cada fuente con su última carga (archivo, fecha, filas, sha256) y la cobertura.
 *   GET  /salud/normas?q=               las normas de salud que responden a una pregunta (RAG, buscar_norma_salud).
 *   GET  /salud/sitemap                 los códigos para el sitemap del producto.
 *   POST /salud/asistente               el asistente (NDJSON): Turnstile y topes por IP, modelo abierto.
 *
 * Privacidad: ninguna tabla de Salud guarda nombres ni documentos de personas; del responsable de una IPRESS sólo su
 * colegio, colegiatura y RNE. Igual todo sale por `publicar()`.
 */
export const saludRouter = new Hono();

const CACHE = cachePublico(600, { maxAge: 120, swr: 3600 });
const CACHE_LARGO = cachePublico(3600, { maxAge: 600, swr: 21600 });
const memo = new Memo<unknown>({ nombre: "salud", ttlMs: 600_000, staleMs: 1_800_000, max: 600 });
const memoLargo = new Memo<unknown>({ nombre: "salud-largo", ttlMs: 3 * 3_600_000, staleMs: 6 * 3_600_000, max: 50 });

const CATS = ["I-1", "I-2", "I-3", "I-4", "II-1", "II-2", "II-E", "III-1", "III-2", "III-E"] as const;
const SECTORES = ["publico", "privado", "otro"] as const;
const TIPOS: Record<string, string> = {
  con_internamiento: "ESTABLECIMIENTO DE SALUD CON INTERNAMIENTO",
  sin_internamiento: "ESTABLECIMIENTO DE SALUD SIN INTERNAMIENTO",
  apoyo: "SERVICIO MÉDICO DE APOYO",
  oferta_flexible: "OFERTA FLEXIBLE",
  terapeuticas: "COMUNIDADES TERAPÉUTICAS",
};

/** Mayúsculas sin tildes ni signos (como mef_norm de la base). */
export function norm(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

const VACIAS = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "E", "EN", "SAC", "S A C", "EIRL", "SRL", "SA"]);
/** Las palabras de una búsqueda (sin las vacías, de 2 letras o más). */
export function palabras(q: string): string[] {
  return [...new Set(norm(q).split(" ").filter((w) => w.length >= 2 && !VACIAS.has(w)))].slice(0, 8);
}

// ─── Filtros de la lista y del mapa ────────────────────────────────────────────────────────────────

const Filtros = z.object({
  q: z.string().trim().max(120).optional(),
  departamento: z.string().trim().max(40).optional(),
  provincia: z.string().trim().max(60).optional(),
  distrito: z.string().trim().max(60).optional(),
  categoria: z.string().trim().max(60).optional(),           // una o varias, con coma
  sector: z.enum(SECTORES).optional(),
  tipo: z.enum(Object.keys(TIPOS) as [string, ...string[]]).optional(),
  estado: z.enum(["activos", "todos", "inactivos"]).default("activos"),
  sanciones: z.enum(["con", "sin"]).optional(),
  quirurgico: z.enum(["si"]).optional(),
  internamiento: z.enum(["si"]).optional(),
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  orden: z.enum(["relevancia", "nombre", "sanciones", "categoria", "denuncias"]).default("relevancia"),
  pagina: z.coerce.number().int().min(1).max(2000).default(1),
  tamano: z.coerce.number().int().min(5).max(100).default(25),
});
type FiltrosSalud = z.infer<typeof Filtros>;

/** El WHERE de una búsqueda (alias i = salud_ipress, x = salud_indicador). */
export function condiciones(f: Partial<FiltrosSalud>, vals: unknown[] = []): { sql: string; vals: unknown[]; relevancia: string | null } {
  const w: string[] = ["i.en_registro"];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  let relevancia: string | null = null;
  if (f.estado === "activos") w.push("i.activo");
  else if (f.estado === "inactivos") w.push("NOT i.activo");
  const q = (f.q ?? "").trim();
  if (q) {
    if (/^\d{1,8}$/.test(q) && q.length >= 4) {
      w.push(`i.codigo = ${p(q.padStart(8, "0"))}`);
    } else if (/^\d{11}$/.test(q)) {
      w.push(`x.ruc = ${p(q)}`);
    } else {
      const ps = palabras(q);
      for (const x of ps) {
        const k = p(`%${x}%`);
        w.push(`(i.nombre_norm LIKE ${k} OR coalesce(x.razon_social, '') ILIKE ${k} OR i.distrito ILIKE ${k} OR i.provincia ILIKE ${k})`);
      }
      // Relevancia: la palabra entera en el nombre pesa más que el parecido de letras; un hospital o una clínica con
      // internamiento va antes que un laboratorio con un nombre parecido («anglo» → Clínica Angloamericana, no Anglolab).
      if (ps.length) {
        // Literal y no parámetro: la lista, el conteo y las facetas comparten `vals` y sólo la lista ordena; un
        // parámetro que una consulta no usa es un error de Postgres («bind message supplies N parameters»). Las palabras
        // ya vienen normalizadas a [A-Z0-9 ], así que el literal es seguro.
        const k = `'${ps.join(" ").replace(/[^A-Z0-9 ]/g, "")}'`;
        relevancia = `(word_similarity(${k}, i.nombre_norm) + 0.5 * similarity(i.nombre_norm, ${k})
          + CASE WHEN i.tipo ILIKE '%CON INTERNAMIENTO%' THEN 0.25 WHEN i.categoria IS NOT NULL THEN 0.1 ELSE 0 END
          + CASE WHEN i.activo THEN 0.1 ELSE 0 END)`;
      }
    }
  }
  if (f.departamento) w.push(`i.departamento = ${p(norm(f.departamento))}`);
  if (f.provincia) w.push(`i.provincia = ${p(norm(f.provincia))}`);
  if (f.distrito) w.push(`i.distrito = ${p(norm(f.distrito))}`);
  if (f.categoria) {
    const cats = f.categoria.split(",").map((c) => c.trim().toUpperCase()).filter((c) => (CATS as readonly string[]).includes(c) || c === "SIN");
    const reales = cats.filter((c) => c !== "SIN");
    const partes = [] as string[];
    if (reales.length) partes.push(`i.categoria = ANY(${p(reales)}::text[])`);
    if (cats.includes("SIN")) partes.push("i.categoria IS NULL");
    if (partes.length) w.push(`(${partes.join(" OR ")})`);
  }
  if (f.sector) w.push(`i.sector = ${p(f.sector)}`);
  if (f.tipo) w.push(`i.tipo = ${p(TIPOS[f.tipo])}`);
  if (f.sanciones === "con") w.push("x.sanciones > 0");
  else if (f.sanciones === "sin") w.push("coalesce(x.sanciones, 0) = 0");
  if (f.quirurgico === "si") w.push("x.quirurgico");
  if (f.internamiento === "si") w.push("x.internamiento");
  if (f.ruc) w.push(`x.ruc = ${p(f.ruc)}`);
  return { sql: w.join(" AND "), vals, relevancia };
}

const ORDEN_CATEGORIA = `array_position(ARRAY['III-2','III-1','III-E','II-2','II-1','II-E','I-4','I-3','I-2','I-1']::text[], i.categoria) NULLS LAST`;

/** Las columnas de una IPRESS en listas, búsqueda y mapa. */
const COLS = `i.codigo, i.nombre, i.categoria, i.sector, i.institucion, i.clasificacion, i.tipo, i.estado, i.activo,
  i.departamento, i.provincia, i.distrito, i.direccion, i.lat, i.lon, i.telefono, i.horario,
  coalesce(x.sanciones, 0) AS sanciones, to_char(x.ultima_sancion, 'YYYY-MM-DD') AS "ultimaSancion",
  coalesce(x.cierre_definitivo, false) AS "cierreDefinitivo", x.denuncias_anio AS denuncias, x.denuncias_de AS "denunciasDe",
  x.cirugias_12m AS "cirugias12m", x.quirurgico, coalesce(x.internamiento, false) AS internamiento, coalesce(x.con_detalle, false) AS "conDetalle",
  x.ruc, x.razon_social AS "razonSocial", x.medicos, x.camas`;

// ─── GET /salud/resumen ───────────────────────────────────────────────────────────────────────────

saludRouter.get("/resumen", async (c) => {
  const cuerpo = await memo.obtener("resumen", async () => {
    const [cifras, porDepto, fuentes] = await Promise.all([
      pool.query(`
        SELECT count(*) FILTER (WHERE i.en_registro)::int AS ipress,
               count(*) FILTER (WHERE i.en_registro AND i.activo)::int AS activas,
               count(*) FILTER (WHERE i.en_registro AND i.activo AND i.sector = 'publico')::int AS publicas,
               count(*) FILTER (WHERE i.en_registro AND i.activo AND i.sector = 'privado')::int AS privadas,
               count(*) FILTER (WHERE i.en_registro AND i.activo AND i.tipo ILIKE '%CON INTERNAMIENTO%')::int AS "conInternamiento",
               count(*) FILTER (WHERE i.en_registro AND NOT i.activo)::int AS inactivas,
               count(*) FILTER (WHERE x.sanciones > 0)::int AS "conSanciones",
               count(*) FILTER (WHERE i.lat IS NOT NULL)::int AS "conUbicacion",
               count(*) FILTER (WHERE x.con_detalle)::int AS "conDetalle",
               (SELECT count(*)::int FROM salud_sancion WHERE en_registro) AS sanciones,
               (SELECT count(*)::int FROM salud_sancion WHERE en_registro AND tipo_sancion = 'multa') AS multas,
               (SELECT coalesce(sum(multa_uit), 0)::float FROM salud_sancion WHERE en_registro) AS "multasUit",
               (SELECT count(*)::int FROM salud_sancion WHERE en_registro AND fecha_emision >= current_date - 365) AS "sancionesUltimoAnio",
               (SELECT max(anio) FROM salud_denuncia_anual) AS "denunciasAnio",
               (SELECT coalesce(sum(denuncias), 0)::int FROM salud_denuncia_anual WHERE anio = (SELECT max(anio) FROM salud_denuncia_anual)) AS denuncias
          FROM salud_ipress i LEFT JOIN salud_indicador x ON x.codigo = i.codigo`),
      pool.query(`
        SELECT i.departamento AS clave, count(*) FILTER (WHERE i.activo)::int AS activas,
               count(*) FILTER (WHERE i.activo AND i.sector = 'privado')::int AS privadas,
               count(*) FILTER (WHERE x.sanciones > 0)::int AS "conSanciones",
               coalesce(sum(x.sanciones), 0)::int AS sanciones
          FROM salud_ipress i LEFT JOIN salud_indicador x ON x.codigo = i.codigo
         WHERE i.en_registro AND i.departamento IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
      estadoFuentes(),
    ]);
    return publicar({ ...cifras.rows[0], porDepartamento: porDepto.rows, fuentes, categorias: CATEGORIAS });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/** La última carga de cada archivo de SUSALUD (datasets_cargas) y la cobertura del detalle. */
async function estadoFuentes() {
  const [cargas, detalle] = await Promise.all([
    pool.query(`SELECT clave, archivo, fuente_url AS url, to_char(cargado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD"T"HH24:MI') AS "cargadoAl",
                       filas, left(sha256, 16) AS sha256
                  FROM datasets_cargas WHERE fuente = 'susalud' AND estado = 'ok' ORDER BY cargado_at DESC`).catch(() => ({ rows: [] })),
    pool.query(`SELECT count(*) FILTER (WHERE leido_at IS NOT NULL AND error IS NULL)::int AS leidas,
                       to_char(max(leido_at) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD"T"HH24:MI') AS "ultimaLectura",
                       (SELECT count(*)::int FROM salud_ipress WHERE en_registro) AS total,
                       (SELECT to_char(max(visto_at) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') FROM salud_ipress) AS "renipressAl",
                       (SELECT to_char(max(visto_at) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') FROM salud_sancion) AS "sancionesAl",
                       (SELECT to_char(max(make_date(anio, mes, 1)), 'YYYY-MM') FROM salud_recursos) AS "recursosAl",
                       (SELECT to_char(max(make_date(anio, mes, 1)), 'YYYY-MM') FROM salud_cirugia_mes) AS "cirugiasAl",
                       (SELECT max(anio) FROM salud_denuncia_anual) AS "denunciasAl"
                  FROM salud_ipress_detalle`),
  ]);
  const ultimas = new Map<string, Record<string, unknown>>();
  for (const r of cargas.rows as Record<string, unknown>[]) {
    const k = String(r.clave).replace(/_\d{4}(_\d{1,2})?$/, "");
    if (!ultimas.has(k)) ultimas.set(k, r);
  }
  const d = detalle.rows[0] as Record<string, unknown>;
  return {
    renipressAl: d.renipressAl, sancionesAl: d.sancionesAl, recursosAl: d.recursosAl, cirugiasAl: d.cirugiasAl, denunciasAl: d.denunciasAl,
    detalle: { leidas: d.leidas, total: d.total, ultimaLectura: d.ultimaLectura },
    cargas: Object.fromEntries(ultimas),
  };
}

// ─── GET /salud/buscar ────────────────────────────────────────────────────────────────────────────

saludRouter.get("/buscar", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return c.json({ error: "consulta_corta", detail: "Escribe al menos 2 letras o un número." }, 400);
  const cuerpo = await memo.obtener(`buscar:${q.toLowerCase()}`, async () => {
    const digitos = q.replace(/\D/g, "");
    const pareceColegiatura = /^(cmp|c\.?m\.?p\.?|colegiatura|col\.?)?\s*n?[°º.]?\s*\d{1,6}$/i.test(q) && digitos.length >= 1 && digitos.length <= 6;
    const { sql, vals, relevancia } = condiciones({ q, estado: "todos" });
    const orden = relevancia ? `i.activo DESC, ${relevancia} DESC, i.nombre` : "i.activo DESC, i.nombre";
    const [ipress, medicos, sanciones] = await Promise.all([
      pool.query(`SELECT ${COLS} FROM salud_ipress i LEFT JOIN salud_indicador x ON x.codigo = i.codigo WHERE ${sql} ORDER BY ${orden} LIMIT 12`, vals),
      pareceColegiatura ? responsables(digitos.replace(/^0+/, ""), null) : Promise.resolve([]),
      // Las sanciones sin IPRESS unida (IAFAS, UGIPRESS o sin código) también se encuentran por su nombre.
      palabras(q).length && !/^\d+$/.test(q)
        ? pool.query(`SELECT s.id, s.nombre, s.administrada_tipo AS "administradaTipo", s.tipo_sancion AS "tipoSancion",
                             to_char(s.fecha_emision, 'YYYY-MM-DD') AS "fechaEmision", s.ipress_codigo AS "ipressCodigo"
                        FROM salud_sancion s
                       WHERE s.en_registro AND s.ipress_codigo IS NULL AND ${palabras(q).map((_, k) => `mef_norm(s.nombre) LIKE $${k + 1}`).join(" AND ")}
                       ORDER BY s.fecha_emision DESC NULLS LAST LIMIT 8`, palabras(q).map((w) => `%${w}%`))
        : Promise.resolve({ rows: [] }),
    ]);
    return publicar({
      q,
      establecimientos: ipress.rows,
      colegiatura: pareceColegiatura ? { numero: digitos.replace(/^0+/, ""), responsableDe: medicos, verificar: pasosVerificarMedico(digitos.replace(/^0+/, "")) } : null,
      sancionesSinEstablecimiento: sanciones.rows,
      // Si escribió un nombre de persona, el buscador no busca personas: lo dice y da el camino al CMP.
      nota: !pareceColegiatura && !ipress.rows.length
        ? "No encontramos un establecimiento con ese nombre. Si buscas a un médico, su habilitación se verifica en «Conoce a tu médico» del Colegio Médico del Perú con su número de colegiatura o sus apellidos."
        : null,
      urlCmp: URL_CMP,
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /salud/establecimientos ──────────────────────────────────────────────────────────────────

saludRouter.get("/establecimientos", async (c) => {
  const f = Filtros.safeParse(parametros(c));
  if (!f.success) return c.json({ error: "filtros_invalidos", detail: f.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  const q = f.data;
  const cuerpo = await memo.obtener(`lista:${JSON.stringify(q)}`, async () => {
    const { sql, vals, relevancia } = condiciones(q);
    const ordenes: Record<string, string> = {
      relevancia: relevancia ? `${relevancia} DESC, i.nombre` : `coalesce(x.sanciones, 0) > 0 DESC, ${ORDEN_CATEGORIA}, i.nombre`,
      nombre: "i.nombre",
      sanciones: "coalesce(x.sanciones, 0) DESC, x.ultima_sancion DESC NULLS LAST, i.nombre",
      categoria: `${ORDEN_CATEGORIA}, i.nombre`,
      denuncias: "coalesce(x.denuncias_anio, 0) DESC, i.nombre",
    };
    const off = (q.pagina - 1) * q.tamano;
    const base = `FROM salud_ipress i LEFT JOIN salud_indicador x ON x.codigo = i.codigo WHERE ${sql}`;
    const [filas, total, facetas] = await Promise.all([
      pool.query(`SELECT ${COLS} ${base} ORDER BY ${ordenes[q.orden]} LIMIT ${q.tamano} OFFSET ${off}`, vals),
      pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE x.sanciones > 0)::int AS "conSanciones" ${base}`, vals),
      pool.query(`
        WITH b AS MATERIALIZED (SELECT i.departamento, i.provincia, i.categoria, i.sector, i.tipo ${base})
        SELECT (SELECT coalesce(json_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT departamento AS clave, count(*)::int AS n FROM b WHERE departamento IS NOT NULL GROUP BY 1) t) AS departamento,
               (SELECT coalesce(json_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT provincia AS clave, count(*)::int AS n FROM b WHERE provincia IS NOT NULL GROUP BY 1) t) AS provincia,
               (SELECT coalesce(json_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT coalesce(categoria, 'SIN') AS clave, count(*)::int AS n FROM b GROUP BY 1) t) AS categoria,
               (SELECT coalesce(json_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT sector AS clave, count(*)::int AS n FROM b GROUP BY 1) t) AS sector,
               (SELECT coalesce(json_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT tipo AS clave, count(*)::int AS n FROM b WHERE tipo IS NOT NULL GROUP BY 1) t) AS tipo`, vals),
    ]);
    return publicar({
      filas: filas.rows, total: total.rows[0].n, conSanciones: total.rows[0].conSanciones, pagina: q.pagina, tamano: q.tamano,
      facetas: facetas.rows[0], filtros: q,
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /salud/mapa ──────────────────────────────────────────────────────────────────────────────

/**
 * Los puntos: [código, lat, lon, categoría, sector (p|v|o), activo (1|0), sanciones, quirúrgico (1|0|null)]. Sin filtros son
 * todas las activas con ubicación (~20 mil, ~700 KB sin comprimir); el nombre se pide al tocar un punto (la ficha).
 */
saludRouter.get("/mapa", async (c) => {
  const f = Filtros.safeParse(parametros(c));
  if (!f.success) return c.json({ error: "filtros_invalidos" }, 400);
  const q = f.data;
  const clave = `mapa:${JSON.stringify({ ...q, pagina: 1, tamano: 25, orden: "relevancia" })}`;
  const cuerpo = await (q.q ? memo : memoLargo).obtener(clave, async () => {
    const { sql, vals } = condiciones(q);
    const r = await pool.query(`
      SELECT json_agg(json_build_array(i.codigo, round(i.lat::numeric, 5), round(i.lon::numeric, 5), i.categoria,
                                       CASE i.sector WHEN 'publico' THEN 'p' WHEN 'privado' THEN 'v' ELSE 'o' END,
                                       CASE WHEN i.activo THEN 1 ELSE 0 END, coalesce(x.sanciones, 0),
                                       CASE WHEN x.quirurgico THEN 1 WHEN x.quirurgico = false THEN 0 END)) AS p,
             count(*)::int AS n
        FROM salud_ipress i LEFT JOIN salud_indicador x ON x.codigo = i.codigo
       WHERE ${sql} AND i.lat IS NOT NULL`, vals);
    const sinUbicacion = await pool.query(`SELECT count(*)::int AS n FROM salud_ipress i LEFT JOIN salud_indicador x ON x.codigo = i.codigo WHERE ${sql} AND i.lat IS NULL`, vals);
    return { puntos: r.rows[0].p ?? [], total: r.rows[0].n, sinUbicacion: sinUbicacion.rows[0].n, columnas: ["codigo", "lat", "lon", "categoria", "sector", "activo", "sanciones", "quirurgico"] };
  });
  c.header("Cache-Control", CACHE_LARGO);
  return c.json(cuerpo);
});

// ─── GET /salud/establecimiento/:codigo ───────────────────────────────────────────────────────────

/** Los que responde una colegiatura en RENIPRESS (con o sin colegio). */
async function responsables(colegiatura: string, colegio: string | null): Promise<Record<string, unknown>[]> {
  if (!/^\d{1,7}$/.test(colegiatura)) return [];
  const r = await pool.query(`
    SELECT ${COLS}, d.responsable_colegio AS "responsableColegio", d.responsable_rne AS "responsableRne",
           to_char(d.leido_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "leidoAl"
      FROM salud_ipress_detalle d JOIN salud_ipress i ON i.codigo = d.codigo LEFT JOIN salud_indicador x ON x.codigo = i.codigo
     WHERE d.responsable_colegiatura = $1 AND ($2::text IS NULL OR d.responsable_colegio ILIKE $2)
     ORDER BY i.activo DESC, i.nombre LIMIT 60`, [colegiatura, colegio]);
  return r.rows.map((x: Record<string, unknown>) => ({ ...x, colegio: tituloColegio(x.responsableColegio as string | null) }));
}

const memoFicha = new Memo<Record<string, unknown> | null>({ nombre: "salud-ficha", ttlMs: 900_000, staleMs: 1_800_000, max: 1500 });

export async function fichaEstablecimiento(codigo: string): Promise<Record<string, unknown> | null> {
  return memoFicha.obtener(codigo, async (ctl) => {
    const base = await pool.query(`
      SELECT ${COLS}, i.ubigeo, i.disa, i.red, i.microred, i.unidad_ejecutora AS "unidadEjecutora", i.imagenes,
             to_char(i.inicio_actividad, 'YYYY-MM-DD') AS "inicioActividad", i.en_registro AS "enRegistro",
             to_char(i.visto_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "vistoAl",
             to_char(i.primera_vez AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "primeraVez", i.fuente_archivo AS "fuenteArchivo",
             x.sanciones_multa_uit::float AS "multasUit", coalesce(x.sanciones_judicializadas, 0) AS "sancionesJudicializadas",
             x.consultas_anio AS consultas, to_char(x.cirugias_hasta, 'YYYY-MM') AS "cirugiasHasta",
             to_char(x.recursos_al, 'YYYY-MM') AS "recursosAl"
        FROM salud_ipress i LEFT JOIN salud_indicador x ON x.codigo = i.codigo WHERE i.codigo = $1`, [codigo]);
    const i = base.rows[0] as Record<string, unknown> | undefined;
    if (!i) { ctl.noGuardar(); return null; }
    const [detalle, sanciones, denuncias, recursos, cirugias, cambios, hermanas, fuentes] = await Promise.all([
      pool.query(`SELECT ruc, razon_social AS "razonSocial", propietario_natural AS "propietarioNatural", categoria,
                         categoria_documento AS "categoriaDocumento", to_char(categoria_fecha, 'YYYY-MM-DD') AS "categoriaFecha",
                         resolucion_creacion AS "resolucionCreacion", to_char(fecha_registro, 'YYYY-MM-DD') AS "fechaRegistro",
                         ambientes, camas, telefono_emergencia AS "telefonoEmergencia", upss, ups, upss_suspendidas AS "upssSuspendidas",
                         especialidades, cartera, documentos, consultores, responsable_colegio AS "responsableColegio",
                         responsable_colegiatura AS "responsableColegiatura", responsable_rne AS "responsableRne",
                         situacion_estado AS "situacionEstado", situacion_condicion AS "situacionCondicion", historial,
                         to_char(leido_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "leidoAl", error
                    FROM salud_ipress_detalle WHERE codigo = $1`, [codigo]),
      pool.query(`SELECT s.id, s.nombre, s.enlace, s.pas, s.resolucion, to_char(s.fecha_emision, 'YYYY-MM-DD') AS "fechaEmision",
                         to_char(s.fecha_notificacion, 'YYYY-MM-DD') AS "fechaNotificacion", to_char(s.fecha_inscripcion, 'YYYY-MM-DD') AS "fechaInscripcion",
                         s.tipo_sancion AS "tipoSancion", s.tipo_sancion_texto AS "tipoSancionTexto", s.multa_uit::float AS "multaUit",
                         s.medidas_correctivas AS "medidasCorrectivas", s.judicializacion, s.judicializada, s.cancelacion,
                         s.infraccion_codigo AS "infraccionCodigo", s.gravedad, s.infraccion, s.normas, f.detalle AS "infraccionDetalle",
                         s.fuente_url AS "fuenteUrl", to_char(s.visto_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "vistoAl"
                    FROM salud_sancion s LEFT JOIN salud_infraccion f ON f.codigo = s.infraccion_codigo
                   WHERE s.ipress_codigo = $1 AND s.en_registro ORDER BY s.fecha_emision DESC NULLS LAST`, [codigo]),
      pool.query(`SELECT anio, consultas, denuncias, de_oficio AS "deOficio" FROM salud_denuncia_anual WHERE codigo = $1 ORDER BY anio`, [codigo]),
      pool.query(`SELECT anio, mes, consultorios, consultorios_funcionales AS "consultoriosFuncionales", camas, medicos, medicos_serums AS "medicosSerums",
                         medicos_residentes AS "medicosResidentes", enfermeras, odontologos, psicologos, nutricionistas, tecnologos, obstetrices,
                         farmaceuticos, auxiliares, otros_profesionales AS "otrosProfesionales", ambulancias
                    FROM salud_recursos WHERE codigo = $1`, [codigo]),
      pool.query(`SELECT anio, mes, sum(mayores)::int AS mayores, sum(menores)::int AS menores, sum(suspendidas)::int AS suspendidas,
                         sum(mayores + menores) FILTER (WHERE programacion = 1)::int AS programadas,
                         sum(mayores + menores) FILTER (WHERE programacion = 2)::int AS emergencia
                    FROM salud_cirugia_mes WHERE codigo = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [codigo]),
      pool.query(`SELECT campo, antes, despues, to_char(detectado AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha, fuente
                    FROM salud_ipress_cambio WHERE codigo = $1 ORDER BY detectado DESC LIMIT 60`, [codigo]),
      pool.query(`SELECT i2.codigo, i2.nombre, i2.categoria, i2.estado, i2.activo, i2.distrito, i2.departamento
                    FROM salud_indicador x JOIN salud_indicador y ON y.ruc = x.ruc AND y.codigo <> x.codigo
                    JOIN salud_ipress i2 ON i2.codigo = y.codigo
                   WHERE x.codigo = $1 AND x.ruc IS NOT NULL ORDER BY i2.activo DESC, i2.nombre LIMIT 40`, [codigo]),
      estadoFuentes(),
    ]);
    const d = (detalle.rows[0] ?? null) as Record<string, unknown> | null;
    const ruc = (d?.ruc as string | null) ?? null;
    const vigia = ruc ? await enVigia(ruc) : null;
    const lista = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
    const upss = lista<{ nombre: string | null; estado: string | null }>(d?.upss);
    const upssQuirurgicas = upss.filter((u) => /QUIR[UÚ]RGIC/i.test(u.nombre ?? "") && /^ACTIVO/i.test(u.estado ?? "ACTIVO")).map((u) => (u.nombre ?? "").replace(/^UPSS\s*-\s*/i, "").toLowerCase());
    const datos: DatosVerificacion = {
      codigo, estado: i.estado as string | null, activo: !!i.activo, enRegistro: !!i.enRegistro, categoria: i.categoria as string | null,
      vistoAl: i.vistoAl as string | null,
      detalle: d && d.leidoAl && !d.error ? {
        leidoAl: d.leidoAl as string, categoria: d.categoria as string | null, categoriaDocumento: d.categoriaDocumento as string | null,
        categoriaFecha: d.categoriaFecha as string | null, quirurgico: upssQuirurgicas.length > 0, upssQuirurgicas,
        documentos: lista<{ tipo: string | null; adjunto: boolean }>(d.documentos),
        responsableColegio: d.responsableColegio as string | null, responsableColegiatura: d.responsableColegiatura as string | null,
      } : null,
      sanciones: { total: Number(i.sanciones ?? 0), ultima: i.ultimaSancion as string | null, cierre: !!i.cierreDefinitivo, judicializadas: Number(i.sancionesJudicializadas ?? 0) },
      sancionesAl: (fuentes.sancionesAl as string | null) ?? null,
      denuncias: { anio: (i.denunciasDe as number | null) ?? null, denuncias: (i.denuncias as number | null) ?? null, consultas: (i.consultas as number | null) ?? null },
    };
    const cat = (d?.categoria as string | null) ?? (i.categoria as string | null);
    return publicar({
      ...i,
      categoriaInfo: cat ? CATEGORIAS[cat] ?? null : null,
      detalle: d ? { ...d, colegio: d.responsableColegio ? tituloColegio(d.responsableColegio as string) : null } : null,
      verificacion: verificar(datos),
      registroSanciones: sanciones.rows,
      denunciasPorAnio: denuncias.rows,
      recursos: recursos.rows[0] ?? null,
      cirugiasPorMes: cirugias.rows,
      cambios: cambios.rows,
      mismaEmpresa: hermanas.rows,
      vigia,
      fuentes: {
        renipress: { url: consultaRenipress(codigo), al: i.vistoAl, archivo: i.fuenteArchivo },
        detalle: d?.leidoAl ? { url: consultaRenipress(codigo), al: d.leidoAl } : null,
        sanciones: { url: URL_SANCIONES, al: fuentes.sancionesAl },
        denuncias: { url: FUENTES_SALUD.find((x) => x.clave === "denuncias")!.url, al: fuentes.denunciasAl },
        recursos: { url: FUENTES_SALUD.find((x) => x.clave === "recursos")!.url, al: fuentes.recursosAl },
        cirugias: { url: FUENTES_SALUD.find((x) => x.clave === "cirugias")!.url, al: fuentes.cirugiasAl },
      },
      aviso: "Lo que dice RENIPRESS es declaración jurada de la IPRESS (art. 7 de la R.S. N.° 004-2021-SUSALUD/S). Una denuncia no es una sanción. La sanción de una IPRESS no es una sanción a sus profesionales.",
    });
  });
}

/** Lo que Vigía sabe del RUC del propietario (sólo RUC 20): empresa que le vende al Estado, o entidad pública. */
async function enVigia(ruc: string): Promise<Record<string, unknown> | null> {
  if (!/^20\d{9}$/.test(ruc)) return null;
  const [emp, ent, ic, sunat] = await Promise.all([
    pool.query(`SELECT nombre, estado_sunat AS "estadoSunat", adj_procesos AS procesos, adj_monto::float AS monto, ord_n AS ordenes,
                       ord_monto::float AS "ordenesMonto", entidades, inhabilitada, to_char(inhabilitada_hasta, 'YYYY-MM-DD') AS "inhabilitadaHasta"
                  FROM empresa_resumen WHERE ruc = $1`, [ruc]).catch(() => ({ rows: [] })),
    pool.query(`SELECT nombre FROM entidades WHERE ruc = $1`, [ruc]).catch(() => ({ rows: [] })),
    pool.query(`SELECT count(*)::int AS n, max(fecha_emision)::text AS ultimo FROM informes_control WHERE entidad_ruc = $1`, [ruc]).catch(() => ({ rows: [{ n: 0 }] })),
    pool.query(`SELECT estado, condicion FROM sunat_padron WHERE ruc = $1`, [ruc]).catch(() => ({ rows: [] })),
  ]);
  const e = emp.rows[0] as Record<string, unknown> | undefined;
  const en = ent.rows[0] as Record<string, unknown> | undefined;
  const informes = ic.rows[0] as { n: number; ultimo: string | null };
  if (!e && !en && !informes.n && !sunat.rows[0]) return null;
  return {
    ruc,
    sunat: sunat.rows[0] ?? null,
    empresa: e ? { ...e, url: `${URL_VIGIA}/empresa/${ruc}` } : null,
    entidad: en ? { nombre: en.nombre, url: `${URL_VIGIA}/entidad/${ruc}` } : null,
    informesControl: informes.n ? { total: informes.n, ultimo: informes.ultimo, url: `${URL_VIGIA}/entidad/${ruc}?seccion=control` } : null,
  };
}

saludRouter.get("/establecimiento/:codigo", async (c) => {
  const crudo = c.req.param("codigo").trim();
  if (!/^\d{1,8}$/.test(crudo)) return c.json({ error: "codigo_invalido", detail: "El código de IPRESS tiene hasta 8 cifras." }, 400);
  const codigo = crudo.padStart(8, "0");
  const f = await fichaEstablecimiento(codigo);
  if (!f) {
    c.header("Cache-Control", cachePublico(300));
    return c.json({ error: "no_encontrado", detail: `El código ${codigo} no está en RENIPRESS.`, consulta: consultaRenipress(codigo) }, 404);
  }
  // Sin detalle o con uno de más de 30 días: se pide al cargador (lo lee primero en su próxima corrida).
  const leido = (f.detalle as { leidoAl?: string | null } | null)?.leidoAl;
  if (!leido || Date.now() - Date.parse(leido) > 30 * 86_400_000) {
    enSegundoPlano(pool.query("SELECT salud_pedir_detalle($1)", [codigo]).then(() => undefined).catch(() => undefined));
  }
  c.header("Cache-Control", CACHE);
  return c.json(f);
});

// ─── GET /salud/medico/:colegiatura ───────────────────────────────────────────────────────────────

saludRouter.get("/medico/:colegiatura", async (c) => {
  const n = c.req.param("colegiatura").replace(/\D/g, "").replace(/^0+/, "");
  if (!n || n.length > 7) return c.json({ error: "colegiatura_invalida", detail: "Escribe el número de colegiatura (sólo cifras)." }, 400);
  const colegio = c.req.query("colegio") === "todos" ? null : "%MEDICO%";
  const cuerpo = await memo.obtener(`medico:${n}:${colegio ?? "todos"}`, async () => {
    const [lista, cobertura] = await Promise.all([
      responsables(n, colegio),
      pool.query(`SELECT count(*) FILTER (WHERE leido_at IS NOT NULL AND error IS NULL)::int AS leidas, (SELECT count(*)::int FROM salud_ipress WHERE en_registro) AS total,
                         to_char(max(leido_at) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS al FROM salud_ipress_detalle`),
    ]);
    const cob = cobertura.rows[0] as { leidas: number; total: number; al: string | null };
    const rnes = [...new Set(lista.map((x) => x.responsableRne as string | null).filter(Boolean))];
    return publicar({
      colegiatura: n,
      colegio: colegio ? "Colegio Médico del Perú" : null,
      rne: rnes,
      responsableDe: lista,
      cobertura: cob,
      resumen: lista.length
        ? `En RENIPRESS (SUSALUD), la colegiatura N.° ${n} figura como responsable de la atención en ${lista.length === 1 ? "un establecimiento" : `${lista.length} establecimientos`}. Eso es lo que declaró cada IPRESS; no dice si hoy está habilitado.`
        : `La colegiatura N.° ${n} no figura como responsable de la atención en los ${cob.leidas.toLocaleString("es-PE")} establecimientos cuyo detalle de RENIPRESS revisamos (de ${cob.total.toLocaleString("es-PE")}). Eso no dice nada sobre el médico: la mayoría no dirige un establecimiento.`,
      habilitacion: {
        estado: "verificar_en_cmp",
        detalle: "Si un médico está habilitado lo dice sólo el Colegio Médico del Perú. Su consulta pide cuenta y captcha, por eso no la leemos de forma automática.",
        url: URL_CMP,
      },
      verificar: pasosVerificarMedico(n),
      fuentes: [
        { nombre: "RENIPRESS (SUSALUD), detalle por IPRESS", url: consultaRenipress("00000000").replace(/&idipress=.*$/, ""), al: cob.al },
        { nombre: "Conoce a tu médico (CMP)", url: URL_CMP, al: null },
        { nombre: "Registro Nacional de Grados y Títulos (SUNEDU)", url: URL_SUNEDU, al: null },
      ],
      aviso: "No guardamos ni mostramos nombres ni documentos de los profesionales. La sanción de una IPRESS no es una sanción a quien la dirige.",
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /salud/sanciones ─────────────────────────────────────────────────────────────────────────

const FiltrosSanciones = z.object({
  q: z.string().trim().max(120).optional(),
  departamento: z.string().trim().max(40).optional(),
  tipo: z.enum(["amonestacion", "multa", "cierre_definitivo", "otra"]).optional(),
  gravedad: z.enum(["leve", "grave", "muy_grave"]).optional(),
  administrada: z.enum(["IPRESS", "IAFAS", "UGIPRESS"]).optional(),
  naturaleza: z.enum(["publica", "privada"]).optional(),
  anio: z.coerce.number().int().min(2010).max(2100).optional(),
  ipress: z.string().regex(/^\d{1,8}$/).optional(),
  judicial: z.enum(["si"]).optional(),
  orden: z.enum(["recientes", "multa"]).default("recientes"),
  pagina: z.coerce.number().int().min(1).max(500).default(1),
  tamano: z.coerce.number().int().min(5).max(100).default(25),
});

saludRouter.get("/sanciones", async (c) => {
  const f = FiltrosSanciones.safeParse(parametros(c));
  if (!f.success) return c.json({ error: "filtros_invalidos", detail: f.error.issues.map((i) => i.message).join("; ") }, 400);
  const q = f.data;
  const cuerpo = await memo.obtener(`sanciones:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const w = ["s.en_registro"];
    for (const x of palabras(q.q ?? "")) w.push(`(mef_norm(s.nombre) LIKE ${p(`%${x}%`)} OR coalesce(i.nombre_norm, '') LIKE $${vals.length})`);
    if (q.departamento) w.push(`mef_norm(s.departamento) = ${p(norm(q.departamento))}`);
    if (q.tipo) w.push(`s.tipo_sancion = ${p(q.tipo)}`);
    if (q.gravedad) w.push(`s.gravedad = ${p(q.gravedad)}`);
    if (q.administrada) w.push(`s.administrada_tipo = ${p(q.administrada)}`);
    if (q.naturaleza) w.push(`s.naturaleza ILIKE ${p(q.naturaleza === "publica" ? "P_blica%" : "Privada%")}`);
    if (q.anio) w.push(`extract(year FROM s.fecha_emision) = ${p(q.anio)}`);
    if (q.ipress) w.push(`s.ipress_codigo = ${p(q.ipress.padStart(8, "0"))}`);
    if (q.judicial) w.push("s.judicializada");
    const base = `FROM salud_sancion s LEFT JOIN salud_ipress i ON i.codigo = s.ipress_codigo WHERE ${w.join(" AND ")}`;
    const orden = q.orden === "multa" ? "s.multa_uit DESC NULLS LAST, s.fecha_emision DESC" : "s.fecha_emision DESC NULLS LAST, s.id";
    const [filas, total] = await Promise.all([
      pool.query(`SELECT s.id, s.nombre, s.administrada_tipo AS "administradaTipo", s.naturaleza, s.institucion, s.ipress_codigo AS "ipressCodigo",
                         s.enlace, i.nombre AS "ipressNombre", s.pas, s.resolucion, to_char(s.fecha_emision, 'YYYY-MM-DD') AS "fechaEmision",
                         s.tipo_sancion AS "tipoSancion", s.multa_uit::float AS "multaUit", s.gravedad, s.infraccion_codigo AS "infraccionCodigo",
                         left(s.infraccion, 400) AS infraccion, s.judicializada, s.departamento, s.provincia, s.distrito
                    ${base} ORDER BY ${orden} LIMIT ${q.tamano} OFFSET ${(q.pagina - 1) * q.tamano}`, vals),
      pool.query(`SELECT count(*)::int AS n, coalesce(sum(s.multa_uit), 0)::float AS uit,
                         count(*) FILTER (WHERE s.tipo_sancion = 'multa')::int AS multas,
                         count(*) FILTER (WHERE s.tipo_sancion = 'amonestacion')::int AS amonestaciones,
                         count(*) FILTER (WHERE s.tipo_sancion = 'cierre_definitivo')::int AS cierres,
                         count(*) FILTER (WHERE s.judicializada)::int AS judicializadas,
                         (SELECT coalesce(json_agg(t ORDER BY t.anio DESC), '[]') FROM (SELECT extract(year FROM s2.fecha_emision)::int AS anio, count(*)::int AS n
                            FROM salud_sancion s2 WHERE s2.en_registro AND s2.fecha_emision IS NOT NULL GROUP BY 1) t) AS "porAnio"
                    ${base}`, vals),
    ]);
    const fuentes = await estadoFuentes();
    return publicar({ filas: filas.rows, ...total.rows[0], pagina: q.pagina, tamano: q.tamano, filtros: q, fuente: { url: URL_SANCIONES, al: fuentes.sancionesAl } });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /salud/cambios ───────────────────────────────────────────────────────────────────────────

saludRouter.get("/cambios", async (c) => {
  const pagina = Math.min(Math.max(Number(c.req.query("pagina") ?? 1) || 1, 1), 200);
  const campo = c.req.query("campo");
  const campos = ["estado", "categoria", "alta", "baja_registro", "nombre", "direccion", "categoria_detalle", "situacion"];
  const filtro = campo && campos.includes(campo) ? campo : null;
  const cuerpo = await memo.obtener(`cambios:${pagina}:${filtro}`, async () => {
    const r = await pool.query(`
      SELECT c.codigo, i.nombre, i.departamento, i.distrito, i.categoria, c.campo, c.antes, c.despues, c.fuente,
             to_char(c.detectado AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha
        FROM salud_ipress_cambio c JOIN salud_ipress i ON i.codigo = c.codigo
       WHERE c.campo <> 'telefono' AND ($1::text IS NULL OR c.campo = $1)
       ORDER BY c.detectado DESC, c.id DESC LIMIT 50 OFFSET ${(pagina - 1) * 50}`, [filtro]);
    const t = await pool.query(`SELECT count(*)::int AS n FROM salud_ipress_cambio WHERE ($1::text IS NULL OR campo = $1)`, [filtro]);
    return publicar({ filas: r.rows, total: t.rows[0].n, pagina, tamano: 50 });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /salud/fuentes ───────────────────────────────────────────────────────────────────────────

saludRouter.get("/fuentes", async (c) => {
  const cuerpo = await memo.obtener("fuentes", async () => publicar({ fuentes: FUENTES_SALUD, estado: await estadoFuentes() }));
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /salud/normas ────────────────────────────────────────────────────────────────────────────

saludRouter.get("/normas", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 400);
  if (q.length < 4) return c.json({ error: "consulta_corta" }, 400);
  const n = Math.min(Math.max(Number(c.req.query("n") ?? 8) || 8, 1), 20);
  const ia = (c.env as { AI?: IaWorkers } | undefined)?.AI;
  const cuerpo = await memo.obtener(`normas:${n}:${q.toLowerCase()}`, async () => {
    let vector: string | null = null;
    if (ia) {
      try { vector = vectorLiteral((await embeber(ia, [q], 15_000))[0]); } catch (e) { registrar("WARNING", `[salud] normas sin vector: ${(e as Error).message}`); }
    }
    const r = await pool.query(`SELECT slug, documento, numero, tipo, to_char(fecha_emision, 'YYYY-MM-DD') AS "fechaEmision", articulo, epigrafe,
                                       left(texto, 1600) AS texto, url_oficial AS url, round(puntaje::numeric, 5)::float AS puntaje
                                  FROM buscar_norma_salud($1, $2::halfvec, $3)`, [q, vector, n]);
    return { q, normas: r.rows, conVector: !!vector };
  });
  c.header("Cache-Control", CACHE_LARGO);
  return c.json(cuerpo);
});

// ─── GET /salud/sitemap ───────────────────────────────────────────────────────────────────────────

saludRouter.get("/sitemap", async (c) => {
  const cuerpo = await memoLargo.obtener("sitemap", async () => {
    const r = await pool.query(`SELECT i.codigo, to_char(greatest(i.cambio_at, i.primera_vez, d.leido_at) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS al
                                  FROM salud_ipress i LEFT JOIN salud_ipress_detalle d ON d.codigo = i.codigo LEFT JOIN salud_indicador x ON x.codigo = i.codigo
                                 WHERE i.en_registro AND (i.activo OR x.sanciones > 0) ORDER BY i.codigo LIMIT 45000`);
    return { establecimientos: r.rows };
  });
  c.header("Cache-Control", CACHE_LARGO);
  return c.json(cuerpo);
});

// ─── POST /salud/asistente ────────────────────────────────────────────────────────────────────────

/** Topes del asistente (sin cuenta: por conexión y en total; el modelo es abierto y barato, ~US$ 0,002 por pregunta). */
export const TOPES_ASISTENTE_SALUD = { ipMinuto: 4, ipDia: 25, totalDia: 1500, faltasBloqueo: 12 } as const;
const DIA_S = 24 * 60 * 60;

const CuerpoAsistente = z.object({
  mensajes: z.array(z.object({ rol: z.enum(["usuario", "asistente"]), texto: z.string().trim().min(1).max(4000) })).min(1).max(16),
});

saludRouter.post("/asistente", async (c) => {
  const b = CuerpoAsistente.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body", detail: "Manda { mensajes }." }, 400);
  const { mensajes } = b.data;
  if (mensajes[mensajes.length - 1].rol !== "usuario") return c.json({ error: "invalid_body", detail: "El último mensaje tiene que ser tuyo." }, 400);
  if (mensajes.reduce((n, m) => n + m.texto.length, 0) > 16_000) {
    return c.json({ error: "conversacion_larga", detail: "La conversación ya es muy larga: empieza una nueva." }, 413);
  }
  const rechazo = await protegerAsistente(c);
  if (rechazo) return rechazo;
  const env = (c.env ?? {}) as EnvChat;
  const ip = pedidoInterno(c) ? "interno" : huellaIp(claveIp(ipCliente(c)));
  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return stream(c, async (s) => {
    const escribir = (o: Record<string, unknown>) => s.write(`${JSON.stringify(eventoPublico(o))}\n`);
    const fin = await correrChat(env, {
      mensajes, modelo: "rapido", actor: `salud:${ip.slice(0, 8)}`,
      app: { ruta: "/mcp/salud", sistema: sistemaAsistenteSalud(), vueltas: 8, max: 6000,
        sin: [] },
    }, escribir);
    await registrarConsumo({ uid: "salud-publico", canal: "asistente", detalle: "rapido", app: "salud", creditos: 0, costoUsd: fin.costo })
      .catch((e) => registrar("WARNING", `[salud] consumo sin guardar: ${(e as Error).message}`));
  });
});

/** Turnstile (lo resuelve la página), la lista fija, el bloqueo automático y los topes por conexión y del día. */
async function protegerAsistente(c: Context): Promise<Response | null> {
  if (pedidoInterno(c)) return null;
  const ipCruda = ipCliente(c);
  const ip = claveIp(ipCruda);
  const huella = huellaIp(ip);
  const no = (status: 403 | 429, error: string, detail: string) => {
    c.header("Cache-Control", SIN_CACHE);
    if (status === 429 && error === "muy_seguido") c.header("Retry-After", "60");
    return c.json({ error, detail }, status);
  };
  const captcha = await verificarTurnstile(c.req.header(HEADER_TURNSTILE), ipCruda);
  if (captcha === "captcha_requerido" || captcha === "captcha_invalido") {
    return no(403, captcha, "Confirma que eres una persona (la casilla de verificación) y vuelve a preguntar.");
  }
  if (enListaFija(process.env.CHAT_BLOQUEO, ip, huella, "")) return no(403, "bloqueado", "El asistente no está disponible para esta conexión.");
  if ((await cuantasEn(`chatsalud|bloqueo|${huella}`, DIA_S, true)) > 0) return no(403, "bloqueado", "El asistente no está disponible para esta conexión por un uso fuera de lo normal.");
  const T = TOPES_ASISTENTE_SALUD;
  if (!(await dentroDeTope(`chatsalud|min|${huella}`, T.ipMinuto, 60))) {
    if (!(await dentroDeTope(`chatsalud|faltas|${huella}`, T.faltasBloqueo, 60 * 60, true))) {
      await dentroDeTope(`chatsalud|bloqueo|${huella}`, 1, DIA_S, true);
      registrar("WARNING", `[salud] bloqueo automático de 24 h: h:${huella}`);
    }
    return no(429, "muy_seguido", "Hiciste varias preguntas seguidas. Espera un minuto.");
  }
  if (!(await dentroDeTope(`chatsalud|dia|${huella}`, T.ipDia, DIA_S, true))) {
    return no(429, "tope_dia", `Desde esta conexión ya se hicieron ${T.ipDia} preguntas en las últimas 24 horas. Vuelve mañana.`);
  }
  if (!(await dentroDeTope("chatsalud|total", T.totalDia, DIA_S, true))) {
    return no(429, "tope_total", "El asistente llegó a su límite de hoy. Vuelve mañana; mientras, el buscador y las fichas siguen abiertos.");
  }
  return null;
}

export { HERRAMIENTAS_ASISTENTE_SALUD };
