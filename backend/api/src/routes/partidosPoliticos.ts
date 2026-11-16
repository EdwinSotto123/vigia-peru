/**
 * Los políticos de un partido (migración 299): sus candidatos que ganaron, los que no ganaron y sus aportantes, con lo
 * que otros registros dicen de cada uno. Pedido del dueño el 2026-11-16.
 *
 *   GET /partidos/:clave/politicos           la lista, paginada y filtrada: papel (gano | no_gano | aportante), cruces
 *                                            (con | alta | sin | sin_documento), senal, eleccion, q, orden, page, size.
 *                                            Con `resumen`: cuántos hay de cada papel, señal y elección en todo el partido.
 *   GET /partidos/:clave/politicos/:codigo   el detalle de una persona: candidaturas, aportes al partido, sus empresas (RNP)
 *                                            y los procesos que ganaron en gobiernos del partido, sus órdenes de servicio,
 *                                            los funcionarios que la declararon como familiar (DJI) y sus sanciones (OECE).
 *
 * Qué se cruza: sólo a quien su fuente trae con documento (el JNE no lo publica de la mayoría de candidatos). Nunca por
 * nombre: un homónimo quedaría con las empresas de otra persona. `conDocumento: false` lo dice en cada fila.
 *
 * Privacidad (docs/PRIVACIDAD.md):
 *   · el documento no sale nunca: la persona se pide por `codigo` (al azar, politico_codigo);
 *   · quien ganó una elección sale con su nombre completo (`electo: true`, como en el resto de Vigía, lib/electos.ts); los
 *     demás candidatos y los aportantes, con un apellido tapado (publicar(), llave `politicos`);
 *   · el cargo al que postuló va en `ultimaCandidatura`, nunca en `cargo` junto al nombre: publicar() trata un cargo de
 *     elección al lado de un nombre como el de una autoridad y lo destaparía;
 *   · el buscador y el orden por nombre sólo miran lo que se ve (`busca`, `nombre_orden`): de quien va tapado, su primera
 *     palabra; así no sirven para confirmar un apellido tapado;
 *   · del funcionario que la declaró como familiar, su cargo y su primer apellido sólo si el parentesco no destapa nada
 *     (apellidoFuncionario); de una empresa socia, sólo RUC 20.
 * Un cruce es un hecho para revisar, no una acusación.
 */

import type { Hono } from "hono";
import { z } from "zod";
import { esErrorPg, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { apellidoFuncionario, publicar } from "../lib/privacidad.js";

/** Los cruces de una persona con el partido, del más grave al más leve (migración 299). */
export const SENALES_POLITICO = [
  "empresas_gobierno", "ordenes_gobierno", "inhabilitado", "sancion", "empresa_inhabilitada", "empresas_estado", "ordenes", "familia",
] as const;
export type SenalPolitico = (typeof SENALES_POLITICO)[number];

type Severidad = "alta" | "media" | "baja";
const SEVERIDAD: Record<SenalPolitico, Severidad> = {
  empresas_gobierno: "alta", ordenes_gobierno: "alta", inhabilitado: "alta", sancion: "media", empresa_inhabilitada: "media", empresas_estado: "media",
  ordenes: "baja", familia: "baja",
};

const PoliticosQuery = z.object({
  papel: z.enum(["gano", "no_gano", "aportante"]).optional(),
  cruces: z.enum(["con", "alta", "sin", "sin_documento"]).optional(),
  senal: z.enum(SENALES_POLITICO).optional(),
  eleccion: z.coerce.number().int().min(2000).max(2100).optional(),
  // En lo que se ve: el nombre de quien ganó, el primer apellido de los demás, el cargo y el lugar.
  q: z.string().trim().min(3).max(80).optional(),
  orden: z.enum(["cruces", "aportes", "nombre", "reciente"]).default("cruces"),
  page: z.coerce.number().int().min(1).max(5000).default(1),
  // size=0: sólo el resumen.
  size: z.coerce.number().int().min(0).max(50).default(20),
});
type PoliticosQ = z.infer<typeof PoliticosQuery>;

const ORDEN: Record<PoliticosQ["orden"], string> = {
  cruces: "pp.sev DESC, pp.n_senales DESC, pp.emp_gob_monto DESC, pp.ord_gob_monto DESC, pp.emp_monto DESC, pp.gano DESC, pp.codigo",
  aportes: "pp.aportes_monto DESC, pp.sev DESC, pp.codigo",
  // Por lo que se ve del nombre (nombre_orden), nunca por el apellido tapado.
  nombre: "(pp.nombre_orden = '') ASC, pp.nombre_orden ASC, pp.codigo",
  reciente: "pp.anios[cardinality(pp.anios)] DESC NULLS LAST, pp.gano DESC, pp.sev DESC, pp.codigo",
};

/** Las palabras de la búsqueda como las deja mef_norm (mayúsculas, sin tildes): hasta 5, de 3 letras o más. */
function palabras(q: string | undefined): string[] {
  if (!q) return [];
  return q.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3).slice(0, 5);
}

interface FilaBase {
  codigo: string; tipo: "persona" | "empresa"; nombre: string; publico: boolean; ruc: string | null; gano: boolean; candidato: boolean;
  aportante: boolean; nCandidaturas: number; elecciones: number[]; cargo: string | null; lugar: string | null; aportesN: number;
  aportesMonto: number; aporteDesde: string | null; aporteHasta: string | null; conDocumento: boolean; personaCodigo: string | null;
  empN: number; empMonto: number; empInhab: number; empGobN: number; empGobMonto: number; ordEntidades: number; ordMonto: number;
  ordGobEntidades: number; ordGobMonto: number; familiaN: number; sancionesN: number; senales: string[]; sev: number;
}

const COLS = `pp.codigo, pp.tipo, pp.nombre, pp.publico, CASE WHEN pp.tipo = 'empresa' THEN pp.doc END AS ruc, pp.gano, pp.candidato, pp.aportante,
  pp.n_candidaturas AS "nCandidaturas", pp.anios AS elecciones, pp.cargo, pp.lugar, pp.aportes_n AS "aportesN", pp.aportes_monto::float AS "aportesMonto",
  to_char(pp.aporte_desde, 'YYYY-MM-DD') AS "aporteDesde", to_char(pp.aporte_hasta, 'YYYY-MM-DD') AS "aporteHasta",
  (pp.doc IS NOT NULL) AS "conDocumento", pp.persona_codigo AS "personaCodigo",
  pp.emp_n AS "empN", pp.emp_monto::float AS "empMonto", pp.emp_inhab AS "empInhab", pp.emp_gob_n AS "empGobN", pp.emp_gob_monto::float AS "empGobMonto",
  pp.ord_entidades AS "ordEntidades", pp.ord_monto::float AS "ordMonto", pp.ord_gob_entidades AS "ordGobEntidades", pp.ord_gob_monto::float AS "ordGobMonto",
  pp.familia_n AS "familiaN", pp.sanciones_n AS "sancionesN", pp.senales, pp.sev`;

/**
 * Una fila como sale al público. La persona va en `nombre` (publicar() le tapa un apellido si no lleva `electo`); una
 * empresa que aporta, en `razonSocial` con su RUC (una razón social sin «S.A.C.» se taparía como si fuera una persona).
 * El cargo al que postuló va dentro de `ultimaCandidatura`: al lado del nombre lo destaparía (ver arriba).
 */
export function filaPolitico(f: FilaBase) {
  const empresa = f.tipo === "empresa";
  return {
    codigo: f.codigo,
    tipo: f.tipo,
    nombre: empresa ? null : f.nombre,
    razonSocial: empresa ? f.nombre : null,
    ruc: empresa ? f.ruc : null,
    ...(f.publico && !empresa ? { electo: true as const } : {}),
    gano: f.gano,
    candidato: f.candidato,
    aportante: f.aportante,
    nCandidaturas: f.nCandidaturas,
    elecciones: f.elecciones,
    ultimaCandidatura: f.cargo || f.lugar ? { puesto: f.cargo, lugar: f.lugar } : null,
    aportes: { n: f.aportesN, monto: f.aportesMonto, desde: f.aporteDesde, hasta: f.aporteHasta },
    conDocumento: f.conDocumento,
    personaCodigo: f.personaCodigo,
    cruces: {
      empresas: { n: f.empN, vendido: f.empMonto, inhabilitadas: f.empInhab, enGobiernos: { procesos: f.empGobN, monto: f.empGobMonto } },
      ordenes: { entidades: f.ordEntidades, monto: f.ordMonto, enGobiernos: { entidades: f.ordGobEntidades, monto: f.ordGobMonto } },
      familia: f.familiaN,
      sanciones: f.sancionesN,
    },
    senales: f.senales.filter((t): t is SenalPolitico => (SENALES_POLITICO as readonly string[]).includes(t)).map((t) => ({ tipo: t, severidad: SEVERIDAD[t] })),
  };
}

const listaMemo = new Memo<Record<string, unknown>>({ nombre: "partidos:politicos", ttlMs: 600_000, staleMs: 600_000, max: 400 });
const busquedaMemo = new Memo<Record<string, unknown>>({ nombre: "partidos:politicos:q", ttlMs: 300_000, max: 100 });
const resumenMemo = new Memo<Record<string, unknown> | null>({ nombre: "partidos:politicos:resumen", ttlMs: 600_000, staleMs: 600_000, max: 300 });
const detalleMemo = new Memo<Record<string, unknown> | null>({ nombre: "partidos:politico", ttlMs: 600_000, staleMs: 600_000, max: 400 });
const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });

/** La tabla todavía no existe en esta base (migración 299 sin aplicar): la lista responde vacía y lo dice. */
const sinTabla = (e: unknown) => esErrorPg(e, "42P01", "42703");

/** Cuántos hay de cada papel, señal y elección en TODO el partido (no cambia con los filtros). */
async function resumenDe(clave: string) {
  return resumenMemo.obtener(clave, async () => {
    const [t, s, a] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE pp.gano)::int AS gano,
                count(*) FILTER (WHERE pp.candidato AND NOT pp.gano)::int AS "noGano", count(*) FILTER (WHERE pp.aportante)::int AS aportantes,
                count(*) FILTER (WHERE pp.tipo = 'empresa')::int AS empresas,
                count(*) FILTER (WHERE pp.doc IS NOT NULL)::int AS "conDocumento", count(*) FILTER (WHERE pp.n_senales > 0)::int AS "conCruces",
                count(*) FILTER (WHERE pp.sev = 3)::int AS alta, count(*) FILTER (WHERE pp.sev = 2)::int AS media, count(*) FILTER (WHERE pp.sev = 1)::int AS baja,
                COALESCE(sum(pp.aportes_monto), 0)::float AS "aportesMonto", COALESCE(sum(pp.aportes_n), 0)::int AS "aportesN"
           FROM partido_politico pp WHERE pp.org_clave = $1`, [clave]),
      pool.query<{ tipo: string; n: number }>(
        `SELECT t AS tipo, count(*)::int AS n FROM partido_politico pp, unnest(pp.senales) t WHERE pp.org_clave = $1 GROUP BY 1`, [clave]),
      pool.query<{ anio: number; n: number }>(
        `SELECT a AS anio, count(*)::int AS n FROM partido_politico pp, unnest(pp.anios) a WHERE pp.org_clave = $1 GROUP BY 1 ORDER BY 1 DESC`, [clave]),
    ]);
    if (!t.rows[0]?.total) return null;
    return { ...t.rows[0], porSenal: s.rows, porEleccion: a.rows };
  });
}

/** Monta las dos rutas en el router de partidos (routes/partidos.ts). */
export function montarPoliticos(router: Hono): void {
  router.get("/:clave/politicos", async (c) => {
    const clave = c.req.param("clave");
    if (!/^[a-z0-9-]{1,80}$/.test(clave)) return c.json({ error: "not_found" }, 404);
    const crudos = Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
    const parsed = PoliticosQuery.safeParse(crudos);
    if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
    const q = parsed.data;
    const memo = q.q ? busquedaMemo : listaMemo;
    try {
      const cuerpo = await memo.obtener(`${clave}:${JSON.stringify(q)}`, async () => {
        const vals: unknown[] = [clave];
        const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
        const conds = ["pp.org_clave = $1"];
        if (q.papel === "gano") conds.push("pp.gano");
        if (q.papel === "no_gano") conds.push("pp.candidato AND NOT pp.gano");
        if (q.papel === "aportante") conds.push("pp.aportante");
        if (q.cruces === "con") conds.push("pp.n_senales > 0");
        if (q.cruces === "alta") conds.push("pp.sev = 3");
        if (q.cruces === "sin") conds.push("pp.n_senales = 0 AND pp.doc IS NOT NULL");
        if (q.cruces === "sin_documento") conds.push("pp.doc IS NULL");
        if (q.senal) conds.push(`${add(q.senal)} = ANY (pp.senales)`);
        if (q.eleccion) conds.push(`${add(q.eleccion)} = ANY (pp.anios)`);
        for (const w of palabras(q.q)) conds.push(`pp.busca LIKE ${add(`%${w}%`)}`);
        const where = conds.join(" AND ");
        const [filas, total, resumen] = await Promise.all([
          q.size > 0
            ? pool.query<FilaBase>(`SELECT ${COLS} FROM partido_politico pp WHERE ${where} ORDER BY ${ORDEN[q.orden]} LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, vals)
            : Promise.resolve({ rows: [] as FilaBase[] }),
          pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM partido_politico pp WHERE ${where}`, vals),
          resumenDe(clave),
        ]);
        return publicar({
          disponible: true, total: total.rows[0]?.n ?? 0, page: q.page, size: q.size,
          politicos: filas.rows.map(filaPolitico),
          resumen,
        });
      });
      c.header("Cache-Control", CACHE);
      return c.json(cuerpo);
    } catch (e) {
      if (!sinTabla(e)) throw e;
      c.header("Cache-Control", cachePublico(60));
      return c.json({ disponible: false, total: 0, page: q.page, size: q.size, politicos: [], resumen: null });
    }
  });

  router.get("/:clave/politicos/:codigo", async (c) => {
    const clave = c.req.param("clave");
    const codigo = c.req.param("codigo");
    if (!/^[a-z0-9-]{1,80}$/.test(clave) || !/^[0-9a-f]{12}$/.test(codigo)) return c.json({ error: "not_found" }, 404);
    try {
      const cuerpo = await detalleMemo.obtener(`${clave}:${codigo}`, () => detallePolitico(clave, codigo));
      if (!cuerpo) return c.json({ error: "not_found" }, 404);
      c.header("Cache-Control", CACHE);
      return c.json(cuerpo);
    } catch (e) {
      if (!sinTabla(e)) throw e;
      return c.json({ error: "not_found" }, 404);
    }
  });
}

/** El nombre de una organización de la ONPE o el JNE, a la clave del partido: lo mismo que hace la migración 299. */
const CLAVE_DE = (col: string) => `(SELECT COALESCE(
    (SELECT g.org_clave FROM gobierno_periodo g WHERE g.org_clave = k.k LIMIT 1),
    (SELECT g.org_clave FROM gobierno_periodo g WHERE g.org_clave = regexp_replace(k.k, '-del-peru$', '') LIMIT 1),
    (SELECT g.org_clave FROM gobierno_periodo g WHERE g.org_clave = regexp_replace(k.k, '^partido-politico-', '') LIMIT 1))
   FROM (SELECT left(lower(replace(mef_norm(${col}), ' ', '-')), 80) AS k) k)`;

async function detallePolitico(clave: string, codigo: string): Promise<Record<string, unknown> | null> {
  const p = await pool.query<{ doc: string | null; tipo: "persona" | "empresa"; nombre: string; publico: boolean; candidaturas: unknown; desde: string | null; personaCodigo: string | null }>(
    `SELECT pp.doc, pp.tipo, pp.nombre, pp.publico, pp.candidaturas, to_char(pp.desde, 'YYYY-MM-DD') AS desde, pp.persona_codigo AS "personaCodigo"
       FROM partido_politico pp WHERE pp.org_clave = $1 AND pp.codigo = $2`, [clave, codigo]);
  const yo = p.rows[0];
  if (!yo) return null;
  const base = { codigo, tipo: yo.tipo, conDocumento: yo.doc != null, vinculoDesde: yo.desde, candidaturas: yo.candidaturas };
  // Para que publicar() reconozca a la persona si su nombre aparece en un texto libre (la descripción de un proceso).
  const extra = { politicos: [{ nombre: yo.tipo === "empresa" ? null : yo.nombre, ...(yo.publico ? { electo: true } : {}) }] };
  const otros = pool.query(
    `SELECT pp.org_clave AS clave, (SELECT max(g.org_nombre) FROM gobierno_periodo g WHERE g.org_clave = pp.org_clave) AS partido,
            pp.gano, pp.candidato, pp.aportante, pp.anios AS elecciones, pp.aportes_monto::float AS "aportesMonto"
       FROM partido_politico pp WHERE pp.codigo = $1 AND pp.org_clave <> $2 ORDER BY pp.gano DESC, pp.org_clave LIMIT 30`, [codigo, clave]);
  if (!yo.doc) {
    return publicar({ ...base, aportes: null, empresas: [], procesos: { total: 0, filas: [] }, ordenes: null, familia: [], sanciones: [], otrosPartidos: (await otros).rows }, { extra });
  }
  const doc = yo.doc;
  const esEmpresa = yo.tipo === "empresa";
  // El RUC 10 de la persona: «10» + su DNI + un dígito. Sólo para leer por el índice; nunca sale.
  const ruc10 = esEmpresa ? null : [`10${doc}0`, `10${doc}9`];
  const [aportes, empresas, ordenes, familia, sanciones] = await Promise.all([
    // Sus aportes a ESTE partido, cada uno una vez (la vista de la migración 211).
    pool.query<{ fecha: string | null; anio: number | null; monto: number; tipo: string | null; proceso: string | null; nivel: string | null }>(
      `SELECT to_char(a.fecha_aporte, 'YYYY-MM-DD') AS fecha, a."año" AS anio, a.monto::float AS monto, a.tipo_aporte AS tipo, a.proceso, a.nivel
         FROM onpe_aporte_unico a
        WHERE (a.numero_documento = $1 OR a.numero_documento BETWEEN $2 AND $3) AND ${CLAVE_DE("a.partido")} = $4
        ORDER BY a.fecha_aporte DESC NULLS LAST, a."año" DESC NULLS LAST, a.monto DESC LIMIT 300`,
      [doc, ruc10?.[0] ?? doc, ruc10?.[1] ?? doc, clave]),
    // Sus empresas (RNP, sólo RUC 20); una empresa que aporta es su propia fila.
    esEmpresa
      ? pool.query(
          `SELECT er.ruc, er.nombre, NULL::text AS rol, NULL::text AS desde, (COALESCE(er.adj_monto, 0) + COALESCE(er.ord_monto, 0))::float AS vendido,
                  er.entidades, er.inhabilitada, er.estado_sunat AS "estadoSunat"
             FROM empresa_resumen er WHERE er.ruc = $1`, [doc])
      : pool.query(
          `SELECT r.ruc_empresa::text AS ruc, er.nombre, string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol,
                  to_char(min(r.fecha_inicio_vigencia), 'YYYY-MM-DD') AS desde,
                  (COALESCE(er.adj_monto, 0) + COALESCE(er.ord_monto, 0))::float AS vendido, er.entidades, er.inhabilitada, er.estado_sunat AS "estadoSunat"
             FROM rnp_conformacion_juridica r LEFT JOIN empresa_resumen er ON er.ruc = r.ruc_empresa::text
            WHERE r.numero_documento = $1 AND (r.tipo_documento LIKE 'DOC. NACIONAL%' OR r.tipo_documento = 'REG. UNICO DE CONTRIBUYENTES')
              AND r.ruc_empresa::text ~ '^20[0-9]{9}$'
            GROUP BY r.ruc_empresa, er.nombre, er.adj_monto, er.ord_monto, er.entidades, er.inhabilitada, er.estado_sunat
            ORDER BY vendido DESC NULLS LAST, desde LIMIT 60`, [doc]),
    // Sus órdenes de servicio como persona natural, por entidad, y si la gobernaba este partido cuando se las dieron.
    esEmpresa
      ? Promise.resolve({ rows: [] as Record<string, unknown>[] })
      : pool.query(
          `SELECT pe.entidad_ruc AS "entidadRuc", pe.entidad, pe.servicio, pe.ordenes, pe.monto::float AS monto,
                  to_char(pe.primera, 'YYYY-MM-DD') AS primera, to_char(pe.ultima, 'YYYY-MM-DD') AS ultima, pe.tipos,
                  (pe.gobiernos && ARRAY[$3 || ':2014', $3 || ':2018', $3 || ':2022']) AS gobernaba
             FROM persona_codigo pc JOIN persona_entidad pe ON pe.ruc = pc.ruc
            WHERE pc.ruc BETWEEN $1 AND $2
            ORDER BY gobernaba DESC, pe.monto DESC NULLS LAST LIMIT 60`, [ruc10![0], ruc10![1], clave]),
    // Los funcionarios que la declararon como familiar. Por la función de la migración 213: la API no lee dji_vinculos.
    esEmpresa
      ? Promise.resolve({ rows: [] as { entidadRuc: string; entidad: string | null; parentesco: string | null; grado: string | null; declarante: string | null; puesto: string | null; ficha: string | null }[] })
      : pool.query<{ entidadRuc: string; entidad: string | null; parentesco: string | null; grado: string | null; declarante: string | null; puesto: string | null; ficha: string | null }>(
          `SELECT v.entidad_ruc AS "entidadRuc", COALESCE(e.nombre, v.entidad_ruc) AS entidad, v.parentesco, v.grado, v.declarante_norm AS declarante,
                  (SELECT fc.cargo FROM dji_funcionarios fc WHERE fc.codigo_ddjj = v.codigo_ddjj AND fc.cargo IS NOT NULL
                    ORDER BY fc.fecha_inicio_cargo DESC NULLS LAST LIMIT 1) AS puesto,
                  pl.ficha
             FROM dji_familia_de($1) v
             LEFT JOIN entidades e ON e.ruc::text = v.entidad_ruc
             LEFT JOIN planilla_persona pl ON pl.entidad_ruc = v.entidad_ruc AND pl.nombre_norm = v.declarante_norm
            LIMIT 40`, [doc]).catch(() => ({ rows: [] })),
    // Sus sanciones del Tribunal de Contrataciones (de la persona, por su RUC 10; de la empresa que aporta, por su RUC).
    pool.query(
      `SELECT s.tipo, to_char(s.fecha_desde, 'YYYY-MM-DD') AS desde, to_char(s.fecha_hasta, 'YYYY-MM-DD') AS hasta, s.resolucion,
              left(s.infraccion, 400) AS infraccion, s.estado, s.monto_multa_soles::float AS multa
         FROM osce_sancionados s WHERE s.ruc BETWEEN $1 AND $2
        ORDER BY s.fecha_desde DESC NULLS LAST LIMIT 40`, [ruc10?.[0] ?? doc, ruc10?.[1] ?? doc]),
  ]);

  // Los procesos que ganaron SUS empresas en gobiernos de este partido (partido_proceso), con su fecha: después de su
  // primer aporte o candidatura con el partido es lo que cuenta la bandera; los de antes también se muestran, marcados.
  const rucs = (empresas.rows as { ruc: string }[]).map((e) => e.ruc);
  const procesos = rucs.length
    ? await pool.query<{ codigo: string; ruc: string; fecha: string | null; entidad: string | null; entidadRuc: string | null; descripcion: string | null;
                         objeto: string | null; monto: number | null; ocid: string | null; nivel: string | null; despues: boolean | null; total: number }>(
        `SELECT pp.codigo_convocatoria::text AS codigo, pp.ruc_proveedor AS ruc, to_char(pp.fecha_convocatoria, 'YYYY-MM-DD') AS fecha, pp.entidad,
                pp.entidad_ruc AS "entidadRuc", left(pp.descripcion, 220) AS descripcion, pp.objeto, pp.monto_adjudicado_pen::float AS monto, pp.ocid, pp.nivel,
                CASE WHEN $3::date IS NULL THEN NULL ELSE pp.fecha_convocatoria >= $3::date END AS despues, count(*) OVER ()::int AS total
           FROM partido_proceso pp WHERE pp.org_clave = $1 AND pp.ruc_proveedor = ANY ($2::text[])
          ORDER BY pp.fecha_convocatoria DESC NULLS LAST, pp.monto_adjudicado_pen DESC NULLS LAST LIMIT 100`, [clave, rucs, yo.desde])
    : { rows: [] };
  const porEmpresa = new Map<string, { procesos: number; monto: number; despues: number; montoDespues: number }>();
  if (rucs.length) {
    const r = await pool.query<{ ruc: string; procesos: number; monto: number; despues: number; montoDespues: number }>(
      `SELECT pp.ruc_proveedor AS ruc, count(DISTINCT pp.codigo_convocatoria)::int AS procesos, COALESCE(sum(pp.monto_adjudicado_pen), 0)::float AS monto,
              count(DISTINCT pp.codigo_convocatoria) FILTER (WHERE pp.fecha_convocatoria >= $3::date)::int AS despues,
              COALESCE(sum(pp.monto_adjudicado_pen) FILTER (WHERE pp.fecha_convocatoria >= $3::date), 0)::float AS "montoDespues"
         FROM partido_proceso pp WHERE pp.org_clave = $1 AND pp.ruc_proveedor = ANY ($2::text[]) GROUP BY 1`, [clave, rucs, yo.desde]);
    for (const x of r.rows) porEmpresa.set(x.ruc, x);
  }

  const filasAporte = aportes.rows;
  return publicar({
    ...base,
    aportes: filasAporte.length
      ? { n: filasAporte.length, monto: filasAporte.reduce((s, x) => s + (x.monto ?? 0), 0), filas: filasAporte }
      : null,
    empresas: (empresas.rows as Record<string, unknown>[]).map((e) => {
      const g = porEmpresa.get(e.ruc as string);
      return { ...e, enGobiernos: g ? { procesos: g.procesos, monto: g.monto, despues: g.despues, montoDespues: g.montoDespues } : null };
    }),
    procesos: { total: procesos.rows[0]?.total ?? 0, filas: procesos.rows.map(({ total: _t, ...f }) => f) },
    ordenes: ordenes.rows.length ? { personaCodigo: yo.personaCodigo, entidades: ordenes.rows } : null,
    // Sin el nombre del funcionario: su primer apellido y su ficha sólo si el parentesco no destapa el apellido tapado.
    familia: familia.rows.map(({ declarante, ficha, ...f }) => {
      const funcionarioApellido = apellidoFuncionario(f.parentesco, declarante);
      return { ...f, funcionarioApellido, ficha: funcionarioApellido ? ficha : null };
    }),
    sanciones: sanciones.rows,
    otrosPartidos: (await otros).rows,
  }, { extra });
}
