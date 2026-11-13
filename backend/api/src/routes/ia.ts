/**
 * Lo que leyó la IA, en un solo lugar (pedido del usuario del 2026-11-05: «¿qué ha predicho la IA, análisis, resúmenes y
 * demás, o solo ha detectado banderas?» y «solo apilamos sin dar orden o contar una historia»). La página /app/ia lo
 * cuenta en capítulos; esta ruta le da las cifras y los ejemplos de cada uno.
 *
 *   GET /ia/resumen → {
 *     generado, ultimaLectura (AAAA-MM-DD, hora de Lima), modelos,
 *     totales:    { documentos, contratos, lecturas, costoUsd }          las lecturas de documentos (procesos + menores)
 *     dictamenes: { publicados, enRevision, fuertes, tramos, ultima, ejemplos[] }
 *     procesos:   { documentos, contratos, lecturas, conHallazgo, clases[], hallazgos[], ejemplos[] }
 *     menores:    { documentos, contratos, lecturas, conHallazgo, clases[], hallazgos[], ejemplos[] }
 *   }
 *
 * De dónde sale cada parte:
 *   · Dictámenes: `alertas` (el análisis de varios agentes de un proceso). Sólo los publicados (`alerta_publicada`, sin
 *     las semillas de demo) muestran puntaje y ejemplos; de los frenados para revisión humana se dice cuántos son y nada
 *     más (lib/publicacion.ts §2). Ejemplos: los 6 publicados más recientes con puntaje de 60 o más.
 *   · Documentos de los procesos: `documento_lectura` (migración 245: acta de buena pro, bases, pliego de consultas y
 *     contrato, leídos con Claude Haiku). Un documento es una (ocid, clase); sus lecturas incluyen la segunda (`-2`) que
 *     confirma las banderas. Los hallazgos son los PUBLICADOS, no las banderas crudas de una lectura: los que pasaron a
 *     `casos_cruce` (refrescar_cruce_acta, migración 248: con dos lecturas, sólo si las dos coinciden). Se cuentan por
 *     ahí y no por `cruces_proveedor`, que no tiene índice por tipo (5,7 s contra 50 ms por el GIN de `casos_cruce.tipos`).
 *     El contrato firmado no da banderas públicas: sus hechos (plazo, garantía, penalidades) van en la ficha.
 *   · Contratos menores: `menor_lectura` (requerimiento y contrato u orden; versiones v1, v1-2 y la tercera mirada a las
 *     marcas, v1-m) y sus señales publicadas en `menor_senal` (migración 252), sólo las que salen de leer un documento.
 *
 * Personas: los ejemplos llevan al proveedor sólo para que `publicar` reconozca el par RUC 10 + nombre y tape ese
 * nombre donde aparezca (la descripción de un contrato menor suele nombrar a quien presta el servicio); después se
 * quita del cuerpo: la página no lo muestra. Nunca sale la cita de una señal (puede nombrar a un abogado, un locador).
 *
 * Cambia despacio (las lecturas corren por tandas): caché de una hora en el isolate y en el borde, servida vieja hasta
 * seis horas mientras se refresca.
 */

import { Hono } from "hono";
import { consultaConPlazo } from "../lib/db.js";
import { Memo, responderJson, type ControlMemo, type Serializado } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { alertaNoDemo, alertaPublica } from "../lib/publicacion.js";
import { etiquetaRegla } from "../lib/reglas.js";
import { ETIQUETA_CRUCE } from "../lib/cruces.js";

export const iaRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 21_600 });
const memo = new Memo<Serializado>({ nombre: "ia:resumen", ttlMs: 3_600_000, staleMs: 21_600_000, max: 1 });

type Severidad = "alta" | "media" | "baja";

/** Las banderas de los documentos de un proceso que se publican (migración 248), con la severidad con que se publican. */
export const TIPOS_PROCESO: Record<string, Severidad> = {
  acta_solo_queda_el_ganador: "media",
  acta_descalificados_por_formalidad: "media",
  acta_oferta_mas_baja_descartada: "media",
  consultas_denuncia_direccionamiento: "media",
  consultas_observaciones_a_requisitos_rechazadas: "baja",
  bases_marca_sin_equivalente: "media",
  bases_experiencia_alta: "baja",
};

/** Las señales de un contrato menor que salen de leer su requerimiento o su contrato (SENALES_DOCUMENTO de menores.ts). */
export const TIPOS_MENOR = [
  "tdr_proveedor_nombrado", "tdr_marca_sin_equivalente", "tdr_monto_distinto", "tdr_experiencia_alta",
  "contrato_monto_distinto", "contrato_ruc_distinto", "contrato_documento_ajeno",
] as const;

/** Los documentos de cada lado, en el orden en que pasan en una contratación. */
export const CLASES_PROCESO = ["bases", "consultas", "buena_pro", "contrato"] as const;
export const CLASES_MENOR = ["menor_tdr", "menor_contrato"] as const;

/** El prefijo de un tipo publicado → la clase del documento del que sale (el acta es la buena pro). */
const CLASE_DE_PREFIJO: Record<string, (typeof CLASES_PROCESO)[number]> = { acta: "buena_pro", bases: "bases", consultas: "consultas" };

const ORDEN_SEV = `CASE %s WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END`;
const ordenSev = (col: string) => ORDEN_SEV.replace("%s", col);
const LIMA = (col: string) => `to_char(max(${col}) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD')`;

// ─── Las consultas (cada una medida en PROD el 2026-11-05: 10 a 50 ms) ──────────

/** Cuántos documentos, contratos y lecturas por clase, en los dos lados, y con qué modelos. */
const SQL_CONTEO = `
  SELECT
    (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
       SELECT clase, count(DISTINCT ocid)::int AS documentos, count(*)::int AS lecturas,
              COALESCE(sum(costo_usd), 0)::float AS "costoUsd", ${LIMA("leido_at")} AS ultima
         FROM documento_lectura WHERE estado = 'ok' GROUP BY clase) x) AS procesos,
    (SELECT count(DISTINCT ocid)::int FROM documento_lectura WHERE estado = 'ok') AS "procesosContratos",
    (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
       SELECT clase, count(DISTINCT id_contrato)::int AS documentos, count(*)::int AS lecturas,
              COALESCE(sum(costo_usd), 0)::float AS "costoUsd", ${LIMA("leido_at")} AS ultima
         FROM menor_lectura WHERE estado = 'ok' GROUP BY clase) x) AS menores,
    (SELECT count(DISTINCT id_contrato)::int FROM menor_lectura WHERE estado = 'ok') AS "menoresContratos",
    (SELECT COALESCE(array_agg(m.modelo ORDER BY m.modelo), '{}') FROM (
       SELECT modelo FROM documento_lectura WHERE estado = 'ok' UNION SELECT modelo FROM menor_lectura WHERE estado = 'ok') m) AS modelos`;

/** Los dictámenes: publicados por tramo del puntaje (los cortes 70 y 40 de frontend/lib/severidad.ts) y en revisión. */
const pub = (cond = "true") => `count(*) FILTER (WHERE alerta_publicada(a.estado) AND ${cond})::int`;
const SQL_DICTAMENES = `
  SELECT ${pub()} AS publicados,
         count(*) FILTER (WHERE a.estado = 'revision')::int AS "enRevision",
         ${pub("a.score >= 60")} AS fuertes,
         ${pub("COALESCE(a.score, 0) >= 70")} AS alto,
         ${pub("COALESCE(a.score, 0) >= 40 AND COALESCE(a.score, 0) < 70")} AS medio,
         ${pub("COALESCE(a.score, 0) BETWEEN 1 AND 39")} AS bajo,
         ${pub("COALESCE(a.score, 0) = 0")} AS "sinSenales",
         ${LIMA("a.analizado_en")} AS ultima
    FROM alertas a WHERE ${alertaNoDemo("a")}`;

/** Los 6 dictámenes publicados más recientes con puntaje de 60 o más, con sus tres señales más graves. */
const SQL_DICTAMENES_EJEMPLOS = `
  SELECT COALESCE(ocid_corto(a.ocid), NULLIF(a.codigo_convocatoria, '')) AS convocatoria, left(a.objeto, 300) AS objeto,
         COALESCE(e.nombre, a.entidad_ruc) AS entidad, a.entidad_ruc AS "entidadRuc", a.score, a.region,
         a.monto_adjudicado::float AS monto, to_char(a.analizado_en AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
         razon_social_de(emp.razon_social) AS proveedor, a.proveedor_ruc AS "proveedorRuc",
         (SELECT count(*)::int FROM banderas b WHERE b.alerta_id = a.id) AS senales,
         (SELECT COALESCE(json_agg(json_build_object('regla', s.regla, 'severidad', s.severidad) ORDER BY s.o, s.regla), '[]'::json)
            FROM (SELECT b.regla, min(${ordenSev("b.severidad")}) AS o,
                         (array_agg(b.severidad ORDER BY ${ordenSev("b.severidad")}))[1] AS severidad
                    FROM banderas b WHERE b.alerta_id = a.id GROUP BY b.regla ORDER BY 2, 1 LIMIT 3) s) AS principales
    FROM alertas a
    LEFT JOIN entidades e ON e.ruc = a.entidad_ruc
    LEFT JOIN empresas emp ON emp.ruc = a.proveedor_ruc
   WHERE ${alertaPublica("a")} AND a.score >= 60
   ORDER BY a.analizado_en DESC NULLS LAST, a.id DESC
   LIMIT 6`;

/**
 * Los hallazgos publicados de los documentos de los procesos: procesos por tipo, por clase de documento (el prefijo del
 * tipo) y en total. `casos_cruce` lleva una fila por proceso y ganador (cada integrante de un consorcio): por eso DISTINCT.
 */
const SQL_PROCESOS_HALLAZGOS = `
  WITH k AS MATERIALIZED (
    SELECT DISTINCT k.ocid, t.tipo FROM casos_cruce k CROSS JOIN LATERAL unnest(k.tipos) t(tipo)
     WHERE k.tipos && $1::text[] AND t.tipo = ANY($1::text[]))
  SELECT tipo AS clave, count(*)::int AS n FROM k GROUP BY tipo
  UNION ALL SELECT 'clase:' || split_part(tipo, '_', 1), count(DISTINCT ocid)::int FROM k GROUP BY split_part(tipo, '_', 1)
  UNION ALL SELECT 'total', count(DISTINCT ocid)::int FROM k`;

/**
 * Seis procesos con hallazgos en sus documentos: primero los que ganó una empresa (RUC 20: menos datos de personas en la
 * página), luego los que juntan más hallazgos y, entre ellos, los más recientes.
 */
const SQL_PROCESOS_EJEMPLOS = `
  SELECT x.* FROM (
    SELECT DISTINCT ON (k.ocid) k.ocid, k.codigo, left(k.objeto, 300) AS objeto, k.entidad, k.entidad_ruc AS "entidadRuc",
           k.monto::float AS monto, to_char(k.fecha_buena_pro, 'YYYY-MM-DD') AS fecha, k.proveedor, k.ruc AS "proveedorRuc",
           ARRAY(SELECT t FROM unnest(k.tipos) t WHERE t = ANY($1::text[]) ORDER BY t) AS tipos
      FROM casos_cruce k WHERE k.tipos && $1::text[]
     ORDER BY k.ocid, (k.ruc LIKE '20%') DESC, k.ruc) x
   ORDER BY (x."proveedorRuc" LIKE '20%') DESC, cardinality(x.tipos) DESC, x.fecha DESC NULLS LAST, x.ocid DESC
   LIMIT 6`;

/** Las señales de lectura de los contratos menores: contratos por tipo (con su severidad más común), por documento y en total. */
const SQL_MENORES_HALLAZGOS = `
  SELECT (SELECT COALESCE(json_agg(x ORDER BY x.contratos DESC, x.tipo), '[]'::json) FROM (
            SELECT tipo, mode() WITHIN GROUP (ORDER BY severidad) AS severidad, count(DISTINCT id_contrato)::int AS contratos
              FROM menor_senal WHERE tipo = ANY($1::text[]) GROUP BY tipo) x) AS tipos,
         count(DISTINCT id_contrato) FILTER (WHERE starts_with(tipo, 'tdr_'))::int AS tdr,
         count(DISTINCT id_contrato) FILTER (WHERE starts_with(tipo, 'contrato_'))::int AS contrato,
         count(DISTINCT id_contrato)::int AS total
    FROM menor_senal WHERE tipo = ANY($1::text[])`;

/**
 * Un contrato menor por tipo de señal (el más reciente, de una empresa si lo hay), cada contrato en el tipo de su señal más
 * grave: así no sale el mismo contrato dos veces y cada hallazgo tiene su ejemplo.
 */
const SQL_MENORES_EJEMPLOS = `
  WITH peor AS (
    SELECT DISTINCT ON (s.id_contrato) s.id_contrato, s.tipo, s.severidad
      FROM menor_senal s WHERE s.tipo = ANY($1::text[])
     ORDER BY s.id_contrato, ${ordenSev("s.severidad")}, s.tipo),
  uno AS (
    SELECT DISTINCT ON (p.tipo) p.tipo, p.severidad, m.id_contrato AS id, m.codigo, left(m.descripcion, 300) AS descripcion,
           m.entidad, m.entidad_ruc AS "entidadRuc", m.monto::float AS monto, m.moneda,
           to_char(m.fecha_suscripcion, 'YYYY-MM-DD') AS fecha, m.proveedor, m.proveedor_ruc AS "proveedorRuc"
      FROM peor p JOIN seace_menores m ON m.id_contrato = p.id_contrato
     WHERE m.monto > 0
     ORDER BY p.tipo, (m.proveedor_ruc LIKE '20%') DESC, m.fecha_suscripcion DESC NULLS LAST, m.id_contrato DESC)
  SELECT u.*, ARRAY(SELECT s.tipo FROM menor_senal s WHERE s.id_contrato = u.id AND s.tipo = ANY($1::text[]) ORDER BY s.tipo) AS tipos
    FROM uno u
   ORDER BY ${ordenSev("u.severidad")}, u.fecha DESC NULLS LAST`;

// ─── El armado (puro: se prueba en test/ia.test.ts) ─────────────────────────────

interface FilaClase { clase: string; documentos: number; lecturas: number; costoUsd: number; ultima: string | null }
export interface FilasResumen {
  conteo: { procesos: FilaClase[]; procesosContratos: number; menores: FilaClase[]; menoresContratos: number; modelos: string[] };
  dictamenes: Record<string, number | string | null>;
  dictamenesEjemplos: Record<string, any>[];
  procesosHallazgos: { clave: string; n: number }[];
  procesosEjemplos: Record<string, any>[];
  menoresHallazgos: { tipos: { tipo: string; severidad: Severidad; contratos: number }[]; tdr: number; contrato: number; total: number } | null;
  menoresEjemplos: Record<string, any>[];
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const suma = (xs: FilaClase[], k: "documentos" | "lecturas" | "costoUsd") => xs.reduce((t, x) => t + n(x[k]), 0);
const masReciente = (...fs: (string | null | undefined)[]) => fs.filter((f): f is string => !!f).sort().pop() ?? null;

/** Cada clase en su orden, con ceros si todavía no se leyó ninguna (la página dibuja siempre las mismas filas). */
function porClase<C extends string>(orden: readonly C[], filas: FilaClase[], conHallazgo: (c: C) => number | null) {
  return orden.map((clase) => {
    const f = filas.find((x) => x.clase === clase);
    return { clase, documentos: n(f?.documentos), lecturas: n(f?.lecturas), conHallazgo: conHallazgo(clase), ultima: f?.ultima ?? null };
  });
}

/** Sin el proveedor: sirvió para tapar su nombre (publicar) y la página no lo muestra. */
const sinProveedor = <T extends Record<string, unknown>>(xs: T[]) => xs.map(({ proveedor: _p, proveedorRuc: _r, ...x }) => x);

export function armarResumen(f: FilasResumen, generado = new Date().toISOString()) {
  const { conteo } = f;
  const hall = new Map(f.procesosHallazgos.map((x) => [x.clave, n(x.n)]));
  const deClase = (c: string) => {
    const prefijo = Object.entries(CLASE_DE_PREFIJO).find(([, v]) => v === c)?.[0];
    return prefijo ? hall.get(`clase:${prefijo}`) ?? 0 : null; // el contrato firmado no da banderas públicas
  };
  const mh = f.menoresHallazgos;
  const d = f.dictamenes;

  // Todo el cuerpo pasa por `publicar` (los nombres de un ejemplo se tapan en todos los demás campos) y después se le
  // quita el proveedor a cada ejemplo.
  const cuerpo = publicar({
    generado,
    ultimaLectura: masReciente(...conteo.procesos.map((x) => x.ultima), ...conteo.menores.map((x) => x.ultima), d.ultima as string | null),
    modelos: conteo.modelos ?? [],
    totales: {
      documentos: suma(conteo.procesos, "documentos") + suma(conteo.menores, "documentos"),
      contratos: n(conteo.procesosContratos) + n(conteo.menoresContratos),
      lecturas: suma(conteo.procesos, "lecturas") + suma(conteo.menores, "lecturas"),
      costoUsd: Math.round((suma(conteo.procesos, "costoUsd") + suma(conteo.menores, "costoUsd")) * 100) / 100,
    },
    dictamenes: {
      publicados: n(d.publicados),
      enRevision: n(d.enRevision),
      fuertes: n(d.fuertes),
      tramos: { alto: n(d.alto), medio: n(d.medio), bajo: n(d.bajo), sinSenales: n(d.sinSenales) },
      ultima: (d.ultima as string | null) ?? null,
      ejemplos: f.dictamenesEjemplos.map((x) => ({
        ...x,
        principales: ((x.principales ?? []) as { regla: string; severidad: Severidad }[]).map((p) => ({ ...p, etiqueta: etiquetaRegla(p.regla) })),
      })),
    },
    procesos: {
      documentos: suma(conteo.procesos, "documentos"),
      contratos: n(conteo.procesosContratos),
      lecturas: suma(conteo.procesos, "lecturas"),
      conHallazgo: hall.get("total") ?? 0,
      clases: porClase(CLASES_PROCESO, conteo.procesos, deClase),
      hallazgos: Object.entries(TIPOS_PROCESO)
        .map(([tipo, severidad]) => ({ tipo, severidad, etiqueta: ETIQUETA_CRUCE[tipo] ?? tipo, procesos: hall.get(tipo) ?? 0 }))
        .filter((x) => x.procesos > 0)
        .sort((a, b) => b.procesos - a.procesos),
      ejemplos: f.procesosEjemplos.map(({ tipos, ...x }) => ({
        ...x,
        // Sólo lo que salió de los documentos (la consulta ya lo filtra): los demás cruces del ganador tienen su lugar.
        hallazgos: ((tipos ?? []) as string[]).filter((t) => t in TIPOS_PROCESO)
          .map((t) => ({ tipo: t, severidad: TIPOS_PROCESO[t], etiqueta: ETIQUETA_CRUCE[t] ?? t })),
      })),
    },
    menores: {
      documentos: suma(conteo.menores, "documentos"),
      contratos: n(conteo.menoresContratos),
      lecturas: suma(conteo.menores, "lecturas"),
      conHallazgo: n(mh?.total),
      clases: porClase(CLASES_MENOR, conteo.menores, (c) => (c === "menor_tdr" ? n(mh?.tdr) : n(mh?.contrato))),
      hallazgos: mh?.tipos ?? [],
      ejemplos: f.menoresEjemplos,
    },
  });
  return {
    ...cuerpo,
    dictamenes: { ...cuerpo.dictamenes, ejemplos: sinProveedor(cuerpo.dictamenes.ejemplos) },
    procesos: { ...cuerpo.procesos, ejemplos: sinProveedor(cuerpo.procesos.ejemplos) },
    menores: { ...cuerpo.menores, ejemplos: sinProveedor(cuerpo.menores.ejemplos) },
  };
}

async function resumen(ctl: ControlMemo) {
  const tiposProceso = Object.keys(TIPOS_PROCESO);
  const tiposMenor = [...TIPOS_MENOR];
  // Las cifras son la página: si fallan, el pedido falla (y no se guarda). Un ejemplo que falla deja su lista vacía, y
  // la respuesta sin él no se guarda: el próximo pedido lo vuelve a intentar.
  const ejemplo = <T>(p: Promise<{ rows: T[] }>) => p.then((r) => r.rows).catch((e) => {
    console.warn(`[ia:resumen] un ejemplo falló: ${(e as Error).message}`);
    ctl.noGuardar();
    return [] as T[];
  });
  const [conteo, dictamenes, procesosHallazgos, menoresHallazgos, dictamenesEjemplos, procesosEjemplos, menoresEjemplos] = await Promise.all([
    consultaConPlazo(SQL_CONTEO, [], 15_000).then((r) => r.rows[0]),
    consultaConPlazo(SQL_DICTAMENES, [], 15_000).then((r) => r.rows[0]),
    consultaConPlazo(SQL_PROCESOS_HALLAZGOS, [tiposProceso], 15_000).then((r) => r.rows),
    consultaConPlazo(SQL_MENORES_HALLAZGOS, [tiposMenor], 15_000).then((r) => r.rows[0] ?? null),
    ejemplo(consultaConPlazo(SQL_DICTAMENES_EJEMPLOS, [], 15_000)),
    ejemplo(consultaConPlazo(SQL_PROCESOS_EJEMPLOS, [tiposProceso], 15_000)),
    ejemplo(consultaConPlazo(SQL_MENORES_EJEMPLOS, [tiposMenor], 15_000)),
  ]);
  return armarResumen({ conteo, dictamenes, dictamenesEjemplos, procesosHallazgos, procesosEjemplos, menoresHallazgos, menoresEjemplos });
}

iaRouter.get("/resumen", (c) => responderJson(c, memo, "resumen", resumen, CACHE));
