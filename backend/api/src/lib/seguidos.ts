/**
 * Lo que sigue una cuenta (migraciones 26 y 191): zonas, entidades, empresas y partidos. Valida el id de cada tipo y arma
 * lo nuevo de lo que sigue, para «Mi impacto» (GET /cuentas/me/impacto):
 *   - los contratos con antecedentes graves o de cuidado (casos_cruce) con buena pro en los últimos 30 días CON DATOS, de
 *     las entidades y empresas que sigue y de los gobiernos que ganaron en el período vigente los partidos que sigue;
 *   - los informes de la Contraloría de las entidades que sigue (90 días);
 *   - las sanciones del Tribunal de Contrataciones a las empresas que sigue (un año).
 * Cada contrato dice por qué está («sigues esta entidad», «sigues a este partido»). Del ganador, el nombre y el RUC sólo
 * si es una empresa (RUC 20), como en GET /novedades. Una empresa que se sigue es siempre un RUC 20: una persona natural
 * no tiene ficha de empresa y no se sigue.
 */
import { pool } from "./db.js";
import { PERIODOS_GOBIERNO } from "../routes/partidos.js";

export type TipoSeguido = "zona" | "entidad" | "empresa" | "partido";

/** La columna de `usuarios` de cada tipo (nunca viene del cliente: el tipo ya pasó por zod). */
export const COLUMNA_SEGUIDO: Record<TipoSeguido, string> = {
  zona: "zonas_seguidas",
  entidad: "entidades_seguidas",
  empresa: "empresas_seguidas",
  partido: "partidos_seguidos",
};

/** A lo sumo cuántas cosas de un tipo (el CHECK de la 191 dice lo mismo para empresas y partidos). */
export const TOPE_SEGUIDOS = 300;

/** null si el id vale para su tipo; si no, el código del error. */
export function errorSeguido(tipo: TipoSeguido, id: string): string | null {
  switch (tipo) {
    case "zona":
      return /^\d{2}(\d{2}(\d{2})?)?$/.test(id) ? null : "invalid_ubigeo";
    case "entidad":
      return /^\d{11}$/.test(id) ? null : "invalid_ruc";
    case "empresa":
      return /^20\d{9}$/.test(id) ? null : "invalid_ruc";
    case "partido":
      return /^[a-z0-9-]{1,80}$/.test(id) ? null : "invalid_clave";
  }
}

/** El año de la elección del período de gobierno vigente en esa fecha (el último, si ya pasaron todos). */
export function periodoVigente(hoy: string = new Date().toISOString().slice(0, 10)): number {
  const p = PERIODOS_GOBIERNO.find((x) => x.desde <= hoy && hoy <= x.hasta);
  return (p ?? PERIODOS_GOBIERNO[PERIODOS_GOBIERNO.length - 1]).anio;
}

export interface PorQue {
  tipo: "entidad" | "empresa" | "partido";
  id: string;
  nombre: string;
}

interface FilaCaso {
  entidadRuc: string;
  entidad: string | null;
  ruc: string;
  proveedor: string | null;
  partidos: string[] | null;
}

/** Por qué un contrato está en lo nuevo de alguien: la entidad, la empresa y los partidos que sigue y que lo tocan. */
export function porQue(
  f: FilaCaso,
  seguidos: { entidades: ReadonlySet<string>; empresas: ReadonlySet<string> },
  nombrePartido: ReadonlyMap<string, string>,
): PorQue[] {
  const r: PorQue[] = [];
  if (seguidos.entidades.has(f.entidadRuc)) r.push({ tipo: "entidad", id: f.entidadRuc, nombre: f.entidad ?? `Entidad con RUC ${f.entidadRuc}` });
  // Sólo una empresa: un RUC 10 nunca está entre las seguidas, pero se mira igual.
  if (/^20\d{9}$/.test(f.ruc) && seguidos.empresas.has(f.ruc)) r.push({ tipo: "empresa", id: f.ruc, nombre: f.proveedor ?? `Empresa con RUC ${f.ruc}` });
  for (const clave of f.partidos ?? []) r.push({ tipo: "partido", id: clave, nombre: nombrePartido.get(clave) ?? clave });
  return r;
}

export const DIAS_CONTRATOS = 30;
export const DIAS_INFORMES = 90;

export interface Seguidos {
  entidades: string[];
  empresas: string[];
  partidos: string[];
}

/** Lo nuevo de lo que sigue. Vacío (sin consultar) si no sigue entidades, empresas ni partidos. */
export async function novedadesSeguidas(s: Seguidos, nombrePartido: ReadonlyMap<string, string>) {
  const vacio = { hasta: null as string | null, dias: DIAS_CONTRATOS, diasInformes: DIAS_INFORMES, contratos: [] as unknown[], informes: [] as unknown[], sanciones: [] as unknown[] };
  if (!s.entidades.length && !s.empresas.length && !s.partidos.length) return vacio;
  const anio = periodoVigente();
  const [contratos, informes, sanciones] = await Promise.all([
    // La ventana termina en la última buena pro con cruces calculados (llegan con días de atraso), y se dice cuál es.
    // Cada rama usa su índice (191): la fecha, y por contrato su partido (contrato_partido_tabla por ocid).
    pool.query(
      `WITH v AS (SELECT max(fecha_buena_pro) AS f FROM casos_cruce WHERE fecha_buena_pro <= current_date)
       SELECT k.ocid, k.ruc, k.proveedor, k.entidad, k.entidad_ruc AS "entidadRuc", k.tipo_contratacion AS tipo,
              left(k.objeto, 200) AS objeto, to_char(k.fecha_buena_pro, 'YYYY-MM-DD') AS fecha, k.monto::float AS monto,
              k.tipos, k.n_alta AS "nAlta", k.n_media AS "nMedia", k.severidad, to_char(v.f, 'YYYY-MM-DD') AS hasta,
              (SELECT array_agg(DISTINCT c.org_clave) FROM contrato_partido_tabla c
                WHERE c.ocid = k.ocid AND c.org_clave = ANY($3::text[]) AND c.anio_eleccion = $4) AS partidos
         FROM casos_cruce k, v
        WHERE k.fecha_buena_pro > v.f - $5::int AND k.fecha_buena_pro <= v.f AND k.severidad IN ('alta', 'media')
          AND (k.entidad_ruc = ANY($1::text[]) OR k.ruc = ANY($2::text[])
               OR EXISTS (SELECT 1 FROM contrato_partido_tabla c
                           WHERE c.ocid = k.ocid AND c.org_clave = ANY($3::text[]) AND c.anio_eleccion = $4))
        ORDER BY k.fecha_buena_pro DESC, k.n_alta DESC, k.monto DESC NULLS LAST
        LIMIT 100`,
      [s.entidades, s.empresas, s.partidos, anio, DIAS_CONTRATOS]),
    s.entidades.length
      ? pool.query(
          `SELECT i.codigo, i.numero, i.titulo, i.entidad_nombre AS entidad, i.entidad_ruc AS "entidadRuc", i.responsabilidades,
                  to_char(i.fecha_emision, 'YYYY-MM-DD') AS fecha, COALESCE(i.url_pdf, i.url_resumen) AS url
             FROM informes_control i
            WHERE i.entidad_ruc = ANY($1::text[]) AND i.fecha_emision >= current_date - $2::int AND i.fecha_emision <= current_date
            ORDER BY i.fecha_emision DESC LIMIT 50`, [s.entidades, DIAS_INFORMES])
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    s.empresas.length
      ? pool.query(
          `SELECT s.id, s.ruc, s.razon_social AS nombre, s.tipo, s.resolucion, to_char(s.fecha_resolucion, 'YYYY-MM-DD') AS fecha,
                  to_char(s.fecha_desde, 'YYYY-MM-DD') AS desde, to_char(s.fecha_hasta, 'YYYY-MM-DD') AS hasta, s.monto_multa_soles::float AS multa
             FROM osce_sancionados s
            WHERE s.ruc = ANY($1::text[]) AND s.ruc ~ '^20\\d{9}$' AND NOT COALESCE(s.es_persona_natural, false)
              AND s.fecha_resolucion >= current_date - 365
            ORDER BY s.fecha_resolucion DESC LIMIT 50`, [s.empresas])
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);
  const conjuntos = { entidades: new Set(s.entidades), empresas: new Set(s.empresas) };
  return {
    ...vacio,
    hasta: (contratos.rows[0]?.hasta as string | undefined) ?? null,
    contratos: contratos.rows.map(({ hasta: _h, partidos, ...r }) => {
      const empresa = /^20\d{9}$/.test(r.ruc);
      return {
        ...r,
        ruc: empresa ? r.ruc : null,
        proveedor: empresa ? r.proveedor : null,
        por: porQue({ entidadRuc: r.entidadRuc, entidad: r.entidad, ruc: r.ruc, proveedor: r.proveedor, partidos }, conjuntos, nombrePartido),
      };
    }),
    informes: informes.rows.map((r) => ({ ...r, por: [{ tipo: "entidad", id: r.entidadRuc, nombre: r.entidad ?? `Entidad con RUC ${r.entidadRuc}` }] })),
    sanciones: sanciones.rows,
  };
}

/** Las empresas que sigue, con lo que ya dice su ficha (o, si sólo ganó compras menores, su nombre en la SUNAT). */
export async function empresasSeguidas(rucs: string[]) {
  if (!rucs.length) return [];
  const r = await pool.query(
    `SELECT x.ruc, COALESCE(r.nombre, sp.razon_social) AS nombre, r.estado_sunat AS "estadoSunat",
            COALESCE(r.entidades, 0) AS entidades, COALESCE(r.adj_procesos, 0) AS "adjProcesos", COALESCE(r.adj_monto, 0)::float AS "adjMonto",
            COALESCE(r.ord_n, 0) AS "ordN", COALESCE(r.ord_monto, 0)::float AS "ordMonto",
            COALESCE(r.n_alta, 0) AS "nAlta", COALESCE(r.n_media, 0) AS "nMedia", to_char(r.ultima, 'YYYY-MM-DD') AS ultima,
            r.inhabilitada, to_char(r.inhabilitada_hasta, 'YYYY-MM-DD') AS "inhabilitadaHasta", r.ruc IS NULL AS "soloMenores"
       FROM unnest($1::text[]) AS x(ruc)
       LEFT JOIN empresa_resumen r ON r.ruc = x.ruc
       LEFT JOIN seace_proveedor_sunat sp ON sp.ruc = x.ruc AND r.ruc IS NULL
      WHERE x.ruc ~ '^20\\d{9}$'
      ORDER BY 2 NULLS LAST`, [rucs]);
  return r.rows;
}

/** Los partidos que sigue, con dónde gobiernan en el período vigente (o en ninguno: se dice). */
export async function partidosSeguidos(claves: string[]) {
  if (!claves.length) return [];
  const anio = periodoVigente();
  const r = await pool.query(
    `SELECT x.clave, max(g.org_nombre) AS nombre,
            count(*) FILTER (WHERE g.anio_eleccion = $2 AND g.nivel = 'regional')::int AS regional,
            count(*) FILTER (WHERE g.anio_eleccion = $2 AND g.nivel = 'provincial')::int AS provincial,
            count(*) FILTER (WHERE g.anio_eleccion = $2 AND g.nivel = 'distrital')::int AS distrital
       FROM unnest($1::text[]) AS x(clave)
       LEFT JOIN gobierno_periodo g ON g.org_clave = x.clave
      GROUP BY x.clave ORDER BY 2 NULLS LAST`, [claves, anio]);
  return r.rows.map((p) => ({ ...p, anio }));
}
