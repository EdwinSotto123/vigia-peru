/**
 * Métricas y transparencia (página pública /metricas, 2026-11-16): qué tan bien leen los agentes, qué tan bien busca el
 * RAG normativo, cuánto de lo que se publica pasó una verificación y cuánto costó todo, con la fecha de cada dato.
 *
 *   GET /transparencia            los cuatro bloques (agentes, rag, verificacion, costos), una hora en caché
 *   GET /transparencia/bitacora   el registro con fecha de validaciones, cargas del RAG, tandas del masivo, refrescos y
 *                                 cargas de datos: ?tipo=&q=&pagina=&tam=
 *
 * Reglas (el repositorio y esta ruta son públicos):
 *   · sólo agregados: ni nombres, ni RUC, ni OCID, ni texto de dictámenes, ni errores internos, ni nombres de funciones
 *     de la nube. Las notas de las corridas son texto libre de quien las subió: pasan por `notaPublica`.
 *   · nada inventado: un bloque cuya tabla falta o cuya consulta falla sale `null` (la página dice «no medido») y esa
 *     respuesta no se guarda en la caché.
 *   · de dónde sale cada cifra: golden_* (migr. 285, las sube backend/scripts/golden_subir.py y
 *     backend/rag/evaluar_normas.py --subir), norma* (284-290), senales_publicas (35), transparencia_analisis y
 *     transparencia_costo (300), documento_lectura, menor_lectura, agente_masivo* (274), costos_mes (206),
 *     refresco_cola (260) y corridas_fuente.
 */
import { Hono } from "hono";
import { z } from "zod";
import { esErrorPg, escaparLike, pool } from "../lib/db.js";
import { Memo, type ControlMemo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";

export const transparenciaRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86_400 });
const CACHE_BITACORA = cachePublico(300, { maxAge: 60, swr: 3600 });
const memo = new Memo<Record<string, unknown>>({ nombre: "transparencia", ttlMs: 3_600_000, staleMs: 6 * 3_600_000, max: 2 });
const memoBitacora = new Memo<Record<string, unknown>>({ nombre: "transparencia:bitacora", ttlMs: 300_000, staleMs: 3_600_000, max: 120 });
const memoBitacoraTexto = new Memo<Record<string, unknown>>({ nombre: "transparencia:bitacora:q", ttlMs: 300_000, max: 40 });

const LIMA = "America/Lima";
const MINUTO = `'YYYY-MM-DD HH24:MI'`;

/** Las redes de agentes, en el orden en que se muestran. `otros` es el perfil de lo que no cae en ninguna red. */
export const REDES: { clave: string; nombre: string }[] = [
  { clave: "bienes", nombre: "Bienes" },
  { clave: "servicios", nombre: "Servicios" },
  { clave: "consultoria", nombre: "Consultoría" },
  { clave: "obras", nombre: "Obras" },
  { clave: "directas", nombre: "Contrataciones directas" },
];
const NOMBRE_RED: Record<string, string> = { ...Object.fromEntries(REDES.map((r) => [r.clave, r.nombre])), otros: "Otros objetos", sin_dato: "Sin red registrada" };
export const nombreRed = (clave: string | null | undefined) => NOMBRE_RED[clave ?? "sin_dato"] ?? "Otra red";

/**
 * Una nota de corrida, si se puede publicar. Es texto libre de quien subió la corrida: se descarta entera si nombra algo
 * de la nube (ARN, funciones), una credencial o un número con forma de DNI o de RUC. Mejor sin nota que con un dato de más.
 */
export function notaPublica(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const s = t.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/arn:|lambda|vigia-agente|token|secret|contrase|password|clave de|api[_ -]?key|(?<![\d-])\d{8}(?![\d-])|(?<!\d)\d{11}(?!\d)/i.test(s)) return null;
  return s.length > 240 ? `${s.slice(0, 239).trimEnd()}…` : s;
}

/** «123 de 584 (21.1 %)» (así lo guarda evaluar_normas.py) → {n, de}. */
export function parteDe(t: unknown): { n: number; de: number } | null {
  const m = typeof t === "string" ? /^\s*(\d+)\s+de\s+(\d+)/.exec(t) : null;
  return m && Number(m[2]) > 0 ? { n: Number(m[1]), de: Number(m[2]) } : null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Corre un bloque: si su tabla no existe (migración sin aplicar) da `null`; si falla por otra cosa, `null` y sin guardar. */
async function bloque<T>(nombre: string, ctl: ControlMemo, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (!esErrorPg(e, "42P01", "42883", "42703")) {
      ctl.noGuardar();
      console.warn(`[transparencia] ${nombre}: ${(e as Error).message}`);
    }
    return null;
  }
}

// ─── 1. Precisión de los agentes ──────────────────────────────────────────────────────────────────────────────────

interface FilaCorrida {
  conjunto: string; nombre: string; queMide: string | null; casos: number; variante: string; imagen: string | null; fecha: string;
  contratos: number; errores: number; precision: number | null; exhaustividad: number | null; f1: number | null;
  usdMedio: number | null; segundosMedio: number | null; metricas: unknown; nota: string | null;
}

const corridaPublica = (c: FilaCorrida) => ({
  fecha: c.fecha, version: c.imagen, contratos: c.contratos, errores: c.errores, precision: c.precision, exhaustividad: c.exhaustividad, f1: c.f1,
  usdMedio: c.usdMedio, segundosMedio: c.segundosMedio, nota: notaPublica(c.nota),
});

export function armarAgentes(filas: FilaCorrida[]) {
  const redes = REDES.map((r) => {
    const suyas = filas.filter((f) => f.conjunto === r.clave);
    if (!suyas.length) return null;
    return { clave: r.clave, nombre: r.nombre, casos: suyas[0].casos, corridas: suyas.length, ultima: corridaPublica(suyas[suyas.length - 1]), serie: suyas.map(corridaPublica) };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  // El analista legal se mide dentro de cada red (variante = la red): qué dice y si las normas que cita existen y regían.
  const legal = REDES.map((r) => {
    const suyas = filas.filter((f) => f.conjunto === "legal" && (f.variante === r.clave || obj(f.metricas).red === r.clave));
    if (!suyas.length) return null;
    const citas = (f: FilaCorrida) => {
      const k = obj(obj(f.metricas).citas);
      const total = num(k.total);
      return total ? { total, ok: num(k.ok) ?? 0, otroRegimen: num(k.otro_regimen) ?? 0, noExiste: num(k.no_existe) ?? 0 } : null;
    };
    const ultima = suyas[suyas.length - 1];
    return {
      clave: r.clave, nombre: r.nombre, corridas: suyas.length,
      ultima: { ...corridaPublica(ultima), citas: citas(ultima) },
      serie: suyas.map((f) => ({ fecha: f.fecha, version: f.imagen, f1: f.f1, precision: f.precision, exhaustividad: f.exhaustividad, citas: citas(f) })),
    };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const fechas = filas.filter((f) => f.queMide !== "recuperacion").map((f) => f.fecha).sort();
  return { fecha: fechas[fechas.length - 1] ?? null, desde: fechas[0] ?? null, redes, legal };
}

export function armarRagSerie(filas: FilaCorrida[]) {
  return filas.filter((f) => f.conjunto === "rag_normas").map((f) => {
    const m = obj(f.metricas);
    return {
      fecha: f.fecha, sistema: f.imagen, preguntas: num(m.preguntas) ?? f.contratos,
      acierto8: num(m["acierto@8"]), acierto10: num(m["acierto@10"]), mrr: num(m.MRR), normaPrimero: num(m.norma_primero),
      regimenEquivocado: parteDe(m.regimen_equivocado), nota: notaPublica(f.nota),
    };
  });
}

const corridas = () =>
  pool.query<FilaCorrida>(
    `SELECT g.conjunto, j.nombre, j.que_mide AS "queMide", j.casos, g.variante, g.imagen,
            to_char(g.ejecutada_at AT TIME ZONE '${LIMA}', ${MINUTO}) AS fecha, g.contratos, g.errores,
            g.precision_pct::float AS precision, g.exhaustividad_pct::float AS exhaustividad, g.f1::float AS f1,
            g.usd_medio::float AS "usdMedio", g.segundos_medio::float AS "segundosMedio", g.metricas, g.nota
       FROM golden_corrida g JOIN golden_conjunto j ON j.clave = g.conjunto
      ORDER BY g.ejecutada_at, g.id`).then((r) => r.rows);

// ─── 2. RAG normativo ─────────────────────────────────────────────────────────────────────────────────────────────

async function corpus() {
  const [tipos, reglas] = await Promise.all([
    pool.query<{ tipo: string; documentos: number; fragmentos: number; conVector: number; actualizado: string | null }>(
      `SELECT n.tipo, count(DISTINCT n.slug)::int AS documentos, count(f.id)::int AS fragmentos, count(f.embedding)::int AS "conVector",
              to_char(max(n.actualizado_at) AT TIME ZONE '${LIMA}', ${MINUTO}) AS actualizado
         FROM norma n LEFT JOIN norma_fragmento f ON f.slug = n.slug GROUP BY 1 ORDER BY 2 DESC`),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM norma_regla`).catch(() => ({ rows: [] as { n: number }[] })),
  ]);
  const suma = (k: "documentos" | "fragmentos" | "conVector") => tipos.rows.reduce((t, x) => t + x[k], 0);
  return {
    normas: suma("documentos"), fragmentos: suma("fragmentos"), conVector: suma("conVector"),
    opiniones: tipos.rows.find((x) => x.tipo === "opinion")?.documentos ?? 0,
    reglas: reglas.rows[0]?.n ?? null,
    actualizado: tipos.rows.map((x) => x.actualizado).filter(Boolean).sort().pop() ?? null,
    porTipo: tipos.rows.map(({ tipo, documentos, fragmentos }) => ({ tipo, documentos, fragmentos })),
  };
}

// ─── 3. Verificación ──────────────────────────────────────────────────────────────────────────────────────────────

const senales = () =>
  pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE verificada IS TRUE)::int AS cotejadas,
            count(*) FILTER (WHERE verificada IS FALSE)::int AS "noCotejadas", count(*) FILTER (WHERE verificada IS NULL)::int AS "sinCotejo",
            count(DISTINCT alerta_id)::int AS contratos,
            count(*) FILTER (WHERE severidad = 'alta')::int AS alta, count(*) FILTER (WHERE severidad = 'media')::int AS media,
            count(*) FILTER (WHERE severidad = 'baja')::int AS baja
       FROM senales_publicas WHERE NOT repetida`).then((r) => r.rows[0] ?? null);

const SUMAS_DICTAMEN = `count(*)::int AS n, count(*) FILTER (WHERE con_verificacion)::int AS "conVerificacion",
            count(*) FILTER (WHERE degradado)::int AS degradados,
            COALESCE(sum(reglas_citadas), 0)::int AS "reglasCitadas", COALESCE(sum(reglas_sin_senal), 0)::int AS "reglasSinSenal",
            COALESCE(sum(urls_sin_respaldo), 0)::int AS "urlsSinRespaldo", COALESCE(sum(urls_quitadas), 0)::int AS "urlsQuitadas",
            COALESCE(sum(rucs_sin_respaldo), 0)::int AS "rucsSinRespaldo", COALESCE(sum(rucs_sustituidos), 0)::int AS "rucsSustituidos",
            COALESCE(sum(cita_n), 0)::int AS "citaN", COALESCE(sum(cita_ok), 0)::int AS "citaOk",
            COALESCE(sum(respaldo_n), 0)::int AS "respaldoN", COALESCE(sum(respaldo_ok), 0)::int AS "respaldoOk",
            COALESCE(sum(precio_n), 0)::int AS "precioN", COALESCE(sum(precio_ok), 0)::int AS "precioOk",
            COALESCE(sum(descartes), 0)::int AS descartes`;

async function dictamenes() {
  const [total, porRed] = await Promise.all([
    pool.query(
      `SELECT ${SUMAS_DICTAMEN},
              to_char(min(analizado_en) AT TIME ZONE '${LIMA}', 'YYYY-MM-DD') AS desde,
              to_char(max(analizado_en) AT TIME ZONE '${LIMA}', ${MINUTO}) AS hasta
         FROM transparencia_analisis`),
    pool.query(`SELECT COALESCE(red, 'sin_dato') AS red, ${SUMAS_DICTAMEN} FROM transparencia_analisis GROUP BY 1 ORDER BY 2 DESC`),
  ]);
  if (!total.rows[0] || !total.rows[0].n) return null;
  return { ...total.rows[0], porRed: porRed.rows.map((x) => ({ ...x, nombre: nombreRed(x.red) })) };
}

// ─── 4. Costos y volumen ──────────────────────────────────────────────────────────────────────────────────────────

/** Contratos con análisis guardado, por mes: sale de las columnas de `alertas` (no lee el JSON), así que existe siempre. */
const analizados = () =>
  pool.query<{ mes: string; n: number }>(
    `SELECT to_char(analizado_en AT TIME ZONE '${LIMA}', 'YYYY-MM') AS mes, count(*)::int AS n
       FROM alertas WHERE analisis_full IS NOT NULL AND analizado_en IS NOT NULL AND codigo NOT LIKE 'ALT-%' GROUP BY 1 ORDER BY 1`)
    .then((r) => ({ total: r.rows.reduce((t, x) => t + x.n, 0), porMes: r.rows }));

/** Costo de los análisis guardados, por mes, red, modelo y día (GROUPING: 7 mes, 11 red, 13 modelo, 14 día, 15 total). */
async function costoAnalisis() {
  const r = await pool.query<{ g: number; mes: string | null; red: string | null; modelo: string | null; dia: string | null; n: number; conCosto: number; usd: number }>(
    `SELECT GROUPING(mes, red, modelo, dia)::int AS g, mes, red, modelo, dia, count(*)::int AS n, count(usd)::int AS "conCosto", COALESCE(sum(usd), 0)::float AS usd
       FROM (SELECT to_char(analizado_en AT TIME ZONE '${LIMA}', 'YYYY-MM') AS mes, COALESCE(red, 'sin_dato') AS red,
                    COALESCE(modelo, 'sin_dato') AS modelo, to_char(analizado_en AT TIME ZONE '${LIMA}', 'YYYY-MM-DD') AS dia, usd
               FROM transparencia_analisis) x
      GROUP BY GROUPING SETS ((mes), (red), (modelo), (dia), ())`);
  const total = r.rows.find((x) => x.g === 15);
  if (!total || !total.n) return null;
  const de = (g: number) => r.rows.filter((x) => x.g === g);
  const medio = (x: { conCosto: number; usd: number }) => (x.conCosto ? x.usd / x.conCosto : null);
  return {
    n: total.n, conCosto: total.conCosto, usd: total.usd, medioUsd: medio(total),
    porMes: de(7).map((x) => ({ mes: x.mes!, n: x.n, usd: x.usd })).sort((a, b) => a.mes.localeCompare(b.mes)),
    porRed: de(11).map((x) => ({ red: x.red!, nombre: nombreRed(x.red), n: x.n, usd: x.usd, medioUsd: medio(x) })).sort((a, b) => b.n - a.n),
    porModelo: de(13).map((x) => ({ modelo: x.modelo === "sin_dato" ? null : x.modelo, n: x.n, usd: x.usd })).sort((a, b) => b.n - a.n),
    porDia: de(14).map((x) => ({ dia: x.dia!, n: x.n, usd: x.usd })).sort((a, b) => a.dia.localeCompare(b.dia)).slice(-45),
  };
}

/** Lo gastado en validar: cada contrato de cada corrida de las pruebas de oro (las del analista legal son las mismas corridas). */
const validacion = () =>
  pool.query(
    `SELECT count(DISTINCT c.id)::int AS corridas, count(*)::int AS contratos, count(r.usd)::int AS "conCosto",
            COALESCE(sum(r.usd), 0)::float AS usd, COALESCE(sum(r.segundos), 0)::float AS segundos,
            to_char(min(c.ejecutada_at) AT TIME ZONE '${LIMA}', 'YYYY-MM-DD') AS desde,
            to_char(max(c.ejecutada_at) AT TIME ZONE '${LIMA}', ${MINUTO}) AS hasta
       FROM golden_resultado r JOIN golden_corrida c ON c.id = r.corrida_id JOIN golden_conjunto j ON j.clave = c.conjunto
      WHERE j.que_mide = 'banderas'`).then((r) => (r.rows[0]?.contratos ? r.rows[0] : null));

const CLASE_LECTURA: Record<string, string> = {
  buena_pro: "Actas de buena pro", bases: "Bases", consultas: "Consultas y observaciones", contrato: "Contratos firmados",
  menor_tdr: "Términos de referencia de contratos menores", menor_contrato: "Contratos menores",
};

async function lectores() {
  const [docs, menores] = await Promise.all([
    pool.query<{ g: number; clase: string | null; modelo: string | null; mes: string | null; n: number; ok: number; paginas: number; usd: number; hasta: string | null }>(
      `SELECT GROUPING(clase, modelo, mes)::int AS g, clase, modelo, mes, count(*)::int AS n, count(*) FILTER (WHERE estado = 'ok')::int AS ok,
              COALESCE(sum(paginas), 0)::int AS paginas, COALESCE(sum(costo_usd), 0)::float AS usd,
              to_char(max(leido_at) AT TIME ZONE '${LIMA}', ${MINUTO}) AS hasta
         FROM (SELECT clase, modelo, to_char(leido_at AT TIME ZONE '${LIMA}', 'YYYY-MM') AS mes, estado, paginas, costo_usd, leido_at FROM documento_lectura) x
        GROUP BY GROUPING SETS ((clase), (modelo), (mes), ())`),
    pool.query<{ clase: string; n: number; ok: number; usd: number; hasta: string | null }>(
      `SELECT clase, count(*)::int AS n, count(*) FILTER (WHERE estado = 'ok')::int AS ok, COALESCE(sum(costo_usd), 0)::float AS usd,
              to_char(max(leido_at) AT TIME ZONE '${LIMA}', ${MINUTO}) AS hasta
         FROM menor_lectura GROUP BY 1 ORDER BY 2 DESC`).catch(() => ({ rows: [] as { clase: string; n: number; ok: number; usd: number; hasta: string | null }[] })),
  ]);
  const total = docs.rows.find((x) => x.g === 7);
  if (!total) return null;
  const fila = (x: { n: number; ok: number; paginas?: number; usd: number }) => ({ n: x.n, ok: x.ok, paginas: x.paginas ?? null, usd: x.usd });
  return {
    documentos: { ...fila(total), hasta: total.hasta },
    porClase: docs.rows.filter((x) => x.g === 3).map((x) => ({ clase: x.clase!, nombre: CLASE_LECTURA[x.clase!] ?? "Otros documentos", ...fila(x) })).sort((a, b) => b.n - a.n),
    porModelo: docs.rows.filter((x) => x.g === 5).map((x) => ({ modelo: x.modelo, ...fila(x) })).sort((a, b) => b.n - a.n),
    porMes: docs.rows.filter((x) => x.g === 6).map((x) => ({ mes: x.mes!, ...fila(x) })).sort((a, b) => a.mes.localeCompare(b.mes)),
    menores: menores.rows.length
      ? {
          n: menores.rows.reduce((t, x) => t + x.n, 0), ok: menores.rows.reduce((t, x) => t + x.ok, 0), usd: menores.rows.reduce((t, x) => t + x.usd, 0),
          hasta: menores.rows.map((x) => x.hasta).filter(Boolean).sort().pop() ?? null,
          porClase: menores.rows.map((x) => ({ clase: x.clase, nombre: CLASE_LECTURA[x.clase] ?? "Otros documentos", n: x.n, ok: x.ok, usd: x.usd })),
        }
      : null,
  };
}

const ESTADO_MASIVO: Record<string, string> = {
  ok: "Análisis terminados", error: "Intentos con error", en_vuelo: "En curso ahora", externo: "Anotado contra el tope desde fuera del masivo",
};

async function masivo() {
  const [estados, dias, redes, tandas] = await Promise.all([
    pool.query<{ estado: string; n: number; usd: number }>(`SELECT estado, count(*)::int AS n, COALESCE(sum(costo), 0)::float AS usd FROM agente_masivo GROUP BY 1 ORDER BY 2 DESC`),
    pool.query<{ dia: string; ok: number; errores: number; usd: number }>(
      `SELECT to_char(COALESCE(terminado_en, creado_en) AT TIME ZONE '${LIMA}', 'YYYY-MM-DD') AS dia, count(*) FILTER (WHERE estado = 'ok')::int AS ok,
              count(*) FILTER (WHERE estado = 'error')::int AS errores, COALESCE(sum(costo), 0)::float AS usd
         FROM agente_masivo GROUP BY 1 ORDER BY 1`),
    pool.query<{ red: string; ok: number; errores: number; usd: number }>(
      `SELECT COALESCE(red, 'sin_dato') AS red, count(*) FILTER (WHERE estado = 'ok')::int AS ok, count(*) FILTER (WHERE estado = 'error')::int AS errores,
              COALESCE(sum(costo), 0)::float AS usd
         FROM agente_masivo WHERE estado IN ('ok', 'error') GROUP BY 1 ORDER BY 2 DESC`),
    pool.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE fin IS NULL)::int AS "enCurso", COALESCE(sum(ok), 0)::int AS ok, COALESCE(sum(errores), 0)::int AS errores,
              COALESCE(sum(costo), 0)::float AS usd, max(tope)::float AS "topeUsd",
              to_char(min(inicio) AT TIME ZONE '${LIMA}', 'YYYY-MM-DD') AS desde, to_char(max(inicio) AT TIME ZONE '${LIMA}', ${MINUTO}) AS ultima
         FROM agente_masivo_tanda`).catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);
  if (!estados.rows.length) return null;
  return {
    n: estados.rows.reduce((t, x) => t + x.n, 0), usd: estados.rows.reduce((t, x) => t + x.usd, 0),
    porEstado: estados.rows.map((x) => ({ estado: x.estado, nombre: ESTADO_MASIVO[x.estado] ?? "Otro estado", n: x.n, usd: x.usd })),
    porDia: dias.rows.slice(-45),
    porRed: redes.rows.map((x) => ({ ...x, nombre: nombreRed(x.red) })),
    tandas: tandas.rows[0] && tandas.rows[0].n ? tandas.rows[0] : null,
    desde: dias.rows[0]?.dia ?? null, hasta: dias.rows[dias.rows.length - 1]?.dia ?? null,
  };
}

/** Las tablas grandes que se nombran, con su nombre para la gente. Lista cerrada: no se publica el catálogo de la base. */
const TABLAS: Record<string, string> = {
  conosce_ordenes: "Órdenes de compra y de servicio",
  visitas_entidades: "Visitas a entidades públicas",
  convocatorias: "Convocatorias y procesos del SEACE",
  planilla_pte: "Planillas del Estado",
  perucompras_item: "Ítems comprados por Perú Compras",
  mef_ejecutora_gasto: "Gasto por unidad ejecutora (MEF)",
  documentos_texto: "Texto de los documentos leídos",
  rag_fragmento: "Fragmentos de documentos para la búsqueda",
  norma_fragmento: "Fragmentos de normas (RAG normativo)",
  alertas: "Análisis de contratos (dictámenes)",
  casos_cruce: "Cruces de registros",
  documento_lectura: "Lecturas de documentos con IA",
};

async function almacenamiento() {
  const [base, tablas, docs] = await Promise.all([
    pool.query<{ bytes: number }>(`SELECT pg_database_size(current_database())::float8 AS bytes`),
    pool.query<{ tabla: string; filas: number; bytes: number }>(
      `SELECT c.relname AS tabla, GREATEST(c.reltuples, 0)::float8 AS filas, pg_total_relation_size(c.oid)::float8 AS bytes
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'm') AND c.relname = ANY($1::text[])
        ORDER BY 3 DESC`, [Object.keys(TABLAS)]),
    pool.query<{ n: number; bytes: number | null; hasta: string | null }>(
      `SELECT count(*)::int AS n, sum(bytes)::float8 AS bytes, to_char(max(creado_at) AT TIME ZONE '${LIMA}', 'YYYY-MM-DD') AS hasta
         FROM documentos_gcs WHERE borrado_at IS NULL`).catch(() => ({ rows: [] as { n: number; bytes: number | null; hasta: string | null }[] })),
  ]);
  return {
    baseBytes: base.rows[0]?.bytes ?? null,
    tablas: tablas.rows.map((x) => ({ nombre: TABLAS[x.tabla], filas: Math.round(x.filas), bytes: x.bytes })),
    documentos: docs.rows[0]?.n ? docs.rows[0] : null,
  };
}

/** Lo que no se mide en la base: las facturas que carga costos_mes.py (migr. 206) y lo que el dueño escribe a mano (migr. 300). */
async function facturas() {
  const [mes, tc] = await Promise.all([
    pool.query(
      `SELECT to_char(mes, 'YYYY-MM') AS mes, titulo, proveedor, monto_usd::float AS "montoUsd", fuente, parcial, to_char(al, 'YYYY-MM-DD') AS al
         FROM costos_mes ORDER BY mes DESC, monto_usd DESC LIMIT 240`),
    pool.query(`SELECT to_char(mes, 'YYYY-MM') AS mes, pen_por_usd::float AS "penPorUsd", fuente FROM tipo_cambio_mes ORDER BY mes DESC LIMIT 1`)
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);
  return { filas: mes.rows, tipoCambio: tc.rows[0] ?? null };
}

const declarados = () =>
  pool.query(
    `SELECT to_char(mes, 'YYYY-MM') AS mes, concepto, categoria, monto::float AS monto, moneda, fuente, nota,
            to_char(registrado_at AT TIME ZONE '${LIMA}', 'YYYY-MM-DD') AS registrado
       FROM transparencia_costo ORDER BY mes DESC, monto DESC LIMIT 500`).then((r) => r.rows);

transparenciaRouter.get("/", async (c) => {
  const cuerpo = await memo.obtener("todo", async (ctl) => {
    const [filas, corp, sen, dict, anal, costo, valid, lect, mas, alm, fact, decl] = await Promise.all([
      bloque("corridas", ctl, corridas), bloque("corpus", ctl, corpus), bloque("senales", ctl, senales), bloque("dictamenes", ctl, dictamenes),
      bloque("analizados", ctl, analizados), bloque("costoAnalisis", ctl, costoAnalisis), bloque("validacion", ctl, validacion),
      bloque("lectores", ctl, lectores), bloque("masivo", ctl, masivo), bloque("almacenamiento", ctl, almacenamiento),
      bloque("facturas", ctl, facturas), bloque("declarados", ctl, declarados),
    ]);
    const serieRag = filas ? armarRagSerie(filas) : [];
    return {
      generado: new Date().toISOString(),
      agentes: filas ? armarAgentes(filas) : null,
      rag: corp || serieRag.length ? { corpus: corp, serie: serieRag, fecha: serieRag[serieRag.length - 1]?.fecha ?? null } : null,
      verificacion: { senales: sen, dictamenes: dict },
      costos: { analizados: anal, analisis: costo, validacion: valid, lectores: lect, masivo: mas, almacenamiento: alm, facturas: fact, declarados: decl },
    };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── 5. Bitácora ──────────────────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_BITACORA = ["validacion", "rag", "masivo", "refresco", "carga"] as const;

const Bitacora = z.object({
  tipo: z.enum(TIPOS_BITACORA).optional(),
  q: z.string().trim().max(80).optional(),
  pagina: z.coerce.number().int().min(1).max(2000).default(1),
  tam: z.coerce.number().int().min(5).max(100).default(25),
});

/** Un número como texto, igual que en el resto del sitio (es-PE: punto decimal). */
const decimalEs = (expr: string) => `(${expr})::text`;

/**
 * Cada renglón: cuándo, de qué tipo, qué fue, cómo terminó (ok, error, en_curso, saltado) y su resultado en una frase.
 * Sin el SQL de los refrescos, sin mensajes de error, sin de dónde se lanzó cada tanda: sólo qué corrió y cómo terminó.
 */
const BITACORA_SQL = `
  SELECT g.ejecutada_at AS fecha,
         CASE WHEN j.que_mide = 'recuperacion' THEN 'rag' ELSE 'validacion' END AS tipo,
         CASE j.que_mide WHEN 'recuperacion' THEN 'Evaluación del buscador de normas'
                         WHEN 'citas_legales' THEN 'Prueba de oro del analista legal, red de ' || g.variante
                         ELSE 'Prueba de oro: ' || j.nombre END AS titulo,
         'ok' AS estado,
         CASE WHEN j.que_mide = 'recuperacion'
              THEN format('Acierto entre los 8 primeros %s %%, MRR %s, en %s preguntas', ${decimalEs("g.exhaustividad_pct")}, COALESCE(g.metricas ->> 'MRR', 'sin dato'), g.contratos)
              ELSE format('F1 %s, precisión %s %%, exhaustividad %s %%, en %s contratos', COALESCE(${decimalEs("g.f1")}, 'sin dato'), COALESCE(${decimalEs("g.precision_pct")}, 'sin dato'), COALESCE(${decimalEs("g.exhaustividad_pct")}, 'sin dato'), g.contratos) END AS resultado,
         g.imagen AS version, g.nota AS nota
    FROM golden_corrida g JOIN golden_conjunto j ON j.clave = g.conjunto
  UNION ALL
  SELECT max(n.actualizado_at), 'rag', 'Carga de normas al corpus', 'ok',
         format('%s documentos cargados o actualizados', count(*)), NULL, NULL
    FROM norma n GROUP BY (n.actualizado_at AT TIME ZONE '${LIMA}')::date
  UNION ALL
  SELECT t.inicio, 'masivo', 'Tanda del análisis masivo',
         CASE WHEN t.fin IS NULL THEN 'en_curso' ELSE 'ok' END,
         CASE WHEN t.fin IS NULL THEN format('En curso, con tope de US$ %s', round(t.tope))
              ELSE format('%s análisis terminados, %s con error, US$ %s, en %s min', COALESCE(t.ok, 0), COALESCE(t.errores, 0),
                          ${decimalEs("round(COALESCE(t.costo, 0), 2)")}, round(extract(epoch FROM t.fin - t.inicio) / 60)) END,
         NULL, NULL
    FROM agente_masivo_tanda t
  UNION ALL
  SELECT COALESCE(r.fin, r.inicio, r.creado), 'refresco', 'Refresco: ' || regexp_replace(r.nombre, '[^a-zA-Z0-9_ /áéíóúñ-]', '', 'g'),
         CASE r.estado WHEN 'ok' THEN 'ok' WHEN 'error' THEN 'error' WHEN 'saltado' THEN 'saltado' ELSE 'en_curso' END,
         CASE r.estado WHEN 'ok' THEN format('Terminó en %s s', round(extract(epoch FROM r.fin - r.inicio)))
                       WHEN 'error' THEN format('Falló después de %s intentos', r.intentos)
                       WHEN 'saltado' THEN 'Se saltó: le falta una migración' ELSE 'En cola o corriendo' END,
         NULL, NULL
    FROM refresco_cola r
  UNION ALL
  SELECT COALESCE(f.fin, f.inicio), 'carga', 'Carga de datos: ' || regexp_replace(f.fuente, '[^a-zA-Z0-9_]', '', 'g'),
         CASE f.estado WHEN 'ok' THEN 'ok' WHEN 'error' THEN 'error' ELSE 'en_curso' END,
         CASE f.estado WHEN 'ok' THEN format('Terminó en %s s', COALESCE(f.segundos, 0)) WHEN 'error' THEN 'Terminó con error' ELSE 'En curso' END,
         NULL, NULL
    FROM corridas_fuente f`;

interface FilaBitacora { fecha: string; tipo: string; titulo: string; estado: string; resultado: string; version: string | null; nota: string | null }

async function bitacora(q: z.infer<typeof Bitacora>) {
  const vals: unknown[] = [];
  const texto = q.q && q.q.length >= 2 ? (vals.push(`%${escaparLike(q.q)}%`), `(b.titulo ILIKE $${vals.length} OR b.resultado ILIKE $${vals.length})`) : "TRUE";
  // Los conteos por tipo no llevan el filtro de tipo (son las opciones del filtro); la página sí.
  const conteos = pool.query<{ tipo: string; n: number; hasta: string | null }>(
    `WITH b AS (${BITACORA_SQL})
     SELECT b.tipo, count(*)::int AS n, to_char(max(b.fecha) AT TIME ZONE '${LIMA}', ${MINUTO}) AS hasta FROM b WHERE b.fecha IS NOT NULL AND ${texto} GROUP BY 1`, vals);
  const pv = [...vals];
  const tipo = q.tipo ? (pv.push(q.tipo), `b.tipo = $${pv.length}`) : "TRUE";
  pv.push(q.tam, (q.pagina - 1) * q.tam);
  const pagina = pool.query<FilaBitacora>(
    `WITH b AS (${BITACORA_SQL})
     SELECT to_char(b.fecha AT TIME ZONE '${LIMA}', ${MINUTO}) AS fecha, b.tipo, b.titulo, b.estado, b.resultado, b.version, b.nota
       FROM b WHERE b.fecha IS NOT NULL AND ${texto} AND ${tipo}
      ORDER BY b.fecha DESC, b.titulo
      LIMIT $${pv.length - 1} OFFSET $${pv.length}`, pv);
  const [k, p] = await Promise.all([conteos, pagina]);
  const porTipo = TIPOS_BITACORA.map((t) => ({ tipo: t, n: k.rows.find((x) => x.tipo === t)?.n ?? 0 }));
  return {
    data: p.rows.map((x) => ({ ...x, nota: notaPublica(x.nota) })),
    total: q.tipo ? porTipo.find((x) => x.tipo === q.tipo)?.n ?? 0 : porTipo.reduce((t, x) => t + x.n, 0),
    porTipo, pagina: q.pagina, tam: q.tam,
    hasta: k.rows.map((x) => x.hasta).filter(Boolean).sort().pop() ?? null,
  };
}

transparenciaRouter.get("/bitacora", async (c) => {
  const parsed = Bitacora.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = { ...parsed.data, q: parsed.data.q || undefined };
  try {
    const cuerpo = await (q.q ? memoBitacoraTexto : memoBitacora).obtener(JSON.stringify(q), () => bitacora(q));
    c.header("Cache-Control", CACHE_BITACORA);
    return c.json(cuerpo);
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883", "42703")) return c.json({ error: "sin_migracion" }, 503);
    throw e;
  }
});
