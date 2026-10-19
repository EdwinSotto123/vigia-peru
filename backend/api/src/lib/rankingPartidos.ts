/**
 * Ranking de partidos por período (GET /partidos/ranking), con filtros y paginación.
 *
 * Aparte de la ruta para poder probar sin base de datos: acá viven la validación de los parámetros y las
 * consultas como texto SQL con sus valores. La ruta (routes/partidos.ts) solo las ejecuta y arma la respuesta.
 *
 * Parámetros (todos opcionales salvo el período, que por defecto es el vigente, 2022):
 *   anio     elección que eligió al gobierno: 2014, 2018 o 2022
 *   region   departamento, 2 dígitos del ubigeo ("15" Lima): solo cuenta los contratos de los gobiernos de ese
 *            departamento (regional, provinciales y distritales), y las cifras del partido se recalculan
 *   q        parte del nombre, sin tildes ni mayúsculas
 *   conCola  solo los partidos con contratos esperando lectura
 *   orden    contratos (por defecto), cola, leidos, nombre, procesos o monto (los dos últimos, de CONOSCE)
 *   limit    cuántos partidos devolver (1 a 100). SIN limit se devuelven todos, como antes de existir la paginación:
 *            así no se rompen la portada, el inicio ni /app/partidos
 *   offset   desde cuál
 */

import { z } from "zod";
import { escaparLike } from "./db.js";

/*
 * Dos fuentes por partido (migración 65):
 *   · la base de Vigía (contrato_partido): los contratos que Vigía puede leer, casi todos de 2026, con leídos,
 *     señales y cola;
 *   · CONOSCE (partido_proceso): los procesos adjudicados desde 2018, para los tres períodos. Antes, para 2019-2022,
 *     ningún partido tenía "contratos" porque sólo se miraba la base de Vigía.
 * Un partido aparece si tiene algo en cualquiera de las dos.
 */

export const ANIOS_GOBIERNO = [2014, 2018, 2022] as const;
export const ORDENES_RANKING = ["contratos", "cola", "leidos", "nombre", "procesos", "monto"] as const;
export type OrdenRanking = (typeof ORDENES_RANKING)[number];

/** Una cadena vacía en la URL ("?region=") es "sin filtro", no un valor inválido. */
const opcional = <T extends z.ZodTypeAny>(esquema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), esquema.optional());

export const RankingQuery = z.object({
  anio: z.coerce
    .number()
    .int()
    .refine((n) => (ANIOS_GOBIERNO as readonly number[]).includes(n), "período inválido")
    .default(2022),
  region: opcional(z.string().regex(/^\d{2}$/, "región inválida")),
  q: opcional(z.string().trim().max(60)),
  conCola: opcional(z.enum(["1", "true", "0", "false"]).transform((v) => v === "1" || v === "true")),
  orden: opcional(z.enum(ORDENES_RANKING)),
  limit: opcional(z.coerce.number().int().min(1).max(100)),
  offset: opcional(z.coerce.number().int().min(0).max(100_000)),
});
export type RankingParams = z.infer<typeof RankingQuery>;

/** Los mismos conteos que `/contratos/geo`: leído = procesado; señal = riesgo alto o medio; en cola = sin analizar y en cola. */
export const CONTEOS = `count(*)::int AS contratos,
  count(*) FILTER (WHERE ce.estado_proc = 'procesado')::int AS leidos,
  count(*) FILTER (WHERE ce.riesgo IN ('alto','medio'))::int AS "conSenales",
  count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'en_cola')::int AS "enCola",
  count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'documentos_listos')::int AS "documentosListos",
  COALESCE(sum(ce.monto), 0)::float AS "montoPen"`;

/** ORDER BY de cada orden: lista cerrada (ningún texto del pedido entra en la SQL) y desempate estable por clave. */
const ORDER_BY: Record<OrdenRanking, string> = {
  contratos: `contratos DESC, procesos DESC, clave`,
  cola: `"enCola" DESC, contratos DESC, clave`,
  leidos: `leidos DESC, contratos DESC, clave`,
  nombre: `immutable_unaccent(lower(nombre)), clave`,
  procesos: `procesos DESC, contratos DESC, clave`,
  monto: `"montoAdjudicadoPen" DESC, procesos DESC, clave`,
};

export interface Consulta {
  sql: string;
  vals: unknown[];
}

/** Los partidos del período, con sus conteos, ya filtrados. `contar` = solo cuántos cumplen (sin paginar). */
export function consultaRanking(p: RankingParams, contar = false): Consulta {
  const vals: unknown[] = [p.anio];
  let region = "";
  if (p.region) {
    vals.push(p.region);
    region = ` AND left(cp.gobierno_ubigeo, 2) = $${vals.length}`;
  }
  const filtros: string[] = [];
  if (p.q) {
    vals.push(`%${escaparLike(p.q.toLowerCase())}%`);
    filtros.push(`immutable_unaccent(lower(nombre)) LIKE immutable_unaccent($${vals.length})`);
  }
  if (p.conCola) filtros.push(`"enCola" > 0`);
  const where = filtros.length ? ` WHERE ${filtros.join(" AND ")}` : "";

  let regionH = "";
  if (p.region) regionH = ` AND left(pp.gobierno_ubigeo, 2) = $2`;
  const base = `WITH vigia AS (
  SELECT cp.org_clave AS clave,
         count(DISTINCT cp.nivel || ':' || cp.gobierno_ubigeo)::int AS "gobiernosConContratos",
         array_agg(DISTINCT left(cp.gobierno_ubigeo, 2)) AS regiones,
         ${CONTEOS}
    FROM contrato_partido cp
    JOIN contrato_estado ce ON ce.ocid = cp.ocid
   WHERE cp.anio_eleccion = $1${region}
   GROUP BY cp.org_clave
), historia AS (
  SELECT pp.org_clave AS clave, count(*)::int AS procesos,
         COALESCE(sum(pp.monto_adjudicado_pen), 0)::float AS "montoAdjudicadoPen",
         count(DISTINCT pp.nivel || ':' || pp.gobierno_ubigeo)::int AS "gobiernosConProcesos",
         array_agg(DISTINCT left(pp.gobierno_ubigeo, 2)) AS regiones
    FROM partido_proceso pp
   WHERE pp.anio_eleccion = $1${regionH}
   GROUP BY pp.org_clave
), nombres AS (
  SELECT org_clave AS clave, max(org_nombre) AS nombre, max(org_tipo) AS tipo FROM gobierno_periodo WHERE anio_eleccion = $1 GROUP BY 1
), base AS (
  SELECT n.clave, n.nombre, n.tipo,
         COALESCE(v."gobiernosConContratos", 0) AS "gobiernosConContratos",
         ARRAY(SELECT DISTINCT r FROM unnest(COALESCE(v.regiones, '{}') || COALESCE(h.regiones, '{}')) r ORDER BY r) AS regiones,
         COALESCE(v.contratos, 0) AS contratos, COALESCE(v.leidos, 0) AS leidos, COALESCE(v."conSenales", 0) AS "conSenales",
         COALESCE(v."enCola", 0) AS "enCola", COALESCE(v."documentosListos", 0) AS "documentosListos",
         COALESCE(v."montoPen", 0)::float AS "montoPen",
         COALESCE(h.procesos, 0) AS procesos, COALESCE(h."montoAdjudicadoPen", 0)::float AS "montoAdjudicadoPen",
         COALESCE(h."gobiernosConProcesos", 0) AS "gobiernosConProcesos"
    FROM nombres n
    LEFT JOIN vigia v ON v.clave = n.clave
    LEFT JOIN historia h ON h.clave = n.clave
   WHERE v.clave IS NOT NULL OR h.clave IS NOT NULL
)`;
  if (contar) return { sql: `${base} SELECT count(*)::int AS total FROM base${where}`, vals };

  let paginar = "";
  if (p.limit != null) {
    vals.push(p.limit, p.offset ?? 0);
    paginar = ` LIMIT $${vals.length - 1} OFFSET $${vals.length}`;
  }
  return { sql: `${base} SELECT * FROM base${where} ORDER BY ${ORDER_BY[p.orden ?? "contratos"]}${paginar}`, vals };
}

/** Gobiernos de los partidos dados, por nivel; con `region`, solo los de ese departamento. */
export function consultaGobiernos(claves: string[], anio: number, region?: string): Consulta {
  const vals: unknown[] = [anio, claves];
  let filtro = "";
  if (region) {
    vals.push(region);
    filtro = ` AND left(ubigeo, 2) = $${vals.length}`;
  }
  return {
    sql: `SELECT org_clave AS clave, nivel, count(*)::int AS n
            FROM gobierno_periodo
           WHERE anio_eleccion = $1 AND org_clave = ANY($2::text[])${filtro}
           GROUP BY 1, 2`,
    vals,
  };
}

/** Clave de caché con TODOS los parámetros, normalizados: dos pedidos equivalentes comparten entrada. */
export const claveRanking = (p: RankingParams) =>
  JSON.stringify([p.anio, p.region ?? null, (p.q ?? "").toLowerCase(), p.conCola ?? false, p.orden ?? "contratos", p.limit ?? null, p.offset ?? 0]);
