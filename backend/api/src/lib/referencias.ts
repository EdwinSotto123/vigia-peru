/**
 * Las referencias de un antecedente (cruces_proveedor) para citar cada dato en su panel: la clave para pedir su evidencia,
 * la elección, el lugar y el periodo de un cargo, el gobierno que encabeza una autoridad y lo que le compró a la empresa,
 * cada candidatura con su resultado, las otras empresas de un socio común y la entidad visitada. Las usan la pestaña
 * Antecedentes de la empresa (routes/empresas.ts) y la Historia del contrato (routes/historia.ts). El DNI sólo busca:
 * nunca sale.
 */

import { createHash } from "node:crypto";
import { pool } from "./db.js";
import { textoEleccion } from "./historia.js";
import { refDocumento } from "./privacidad.js";

/** Soles en CONOSCE: "Soles" y, en los años viejos, "Nuevos Soles". */
const SOLES = `('Soles', 'Nuevos Soles')`;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" && v ? v.slice(0, 10) : null);
const hoyIso = () => new Date().toISOString().slice(0, 10);

/**
 * La clave de un antecedente para pedir su evidencia (GET …/antecedentes/evidencia): su tipo, su proceso, su fecha, su
 * persona y su detalle, en un hash. Sin el id de la fila (el refresco de los cruces lo cambia: un enlace de la página en
 * caché quedaría huérfano) ni el DNI (va su ref HMAC: un sha256 de 8 dígitos se revierte probando). En letras (a a p, una
 * por cada medio byte), sin dígitos: en hexadecimal, 8 u 11 cifras seguidas las tapaba publicar() como un DNI o un RUC 10.
 */
export function claveCruce(x: Record<string, any>): string {
  const persona = x.persona_doc ? refDocumento(x.persona_doc) : "";
  const h = createHash("sha256").update(`${x.tipo}|${x.ocid ?? ""}|${iso(x.fecha) ?? ""}|${persona}|${JSON.stringify(x.detalle ?? {})}`).digest();
  let s = "";
  for (let i = 0; i < 8; i++) s += String.fromCharCode(97 + (h[i] >> 4), 97 + (h[i] & 15));
  return s;
}

/** Lo que el panel de un antecedente necesita para citar cada dato: de qué elección, dónde, a qué entidad lleva. */
export interface Referencias {
  /** Para pedir sus registros oficiales. */
  clave: string;
  /** «Elecciones regionales y municipales 2022», del proceso del registro (ONPE, JNE). */
  eleccion?: string | null;
  /** Autoridad y candidatura (JNE): dónde es el cargo, cuál, si sigue, el resultado y el periodo. */
  lugar?: { distrito: string | null; provincia: string | null; departamento: string | null } | null;
  cargo?: string | null;
  vigente?: boolean | null;
  resultado?: string | null;
  periodo?: { desde: string | null; hasta: string | null } | null;
  /**
   * Autoridad: las entidades del gobierno que encabeza o integra (la municipalidad, el gobierno regional y sus unidades,
   * entidad_gobierno_amplia) y lo que cada una le compró a la empresa en ese periodo (CONOSCE: órdenes y procesos).
   */
  gobierno?: {
    nivel: string;
    desde: string | null;
    hasta: string | null;
    entidades: { ruc: string; nombre: string | null; ordenes: number; montoOrdenes: number; procesos: number; montoProcesos: number }[];
  } | null;
  /** Socio común: las otras empresas del proceso con la misma persona (una persona natural, sin RUC ni nombre). */
  otros?: { ruc: string | null; nombre: string | null }[];
  /** Visitas: la entidad visitada por su RUC, si su nombre se reconoce (visita_entidad_ruc). */
  entidadVisitadaRuc?: string | null;
}

/** El nivel de gobierno de un cargo de elección y cuántos dígitos de su ubigeo lo identifican. */
const NIVEL_CARGO = (cargo: string): ["distrital" | "provincial" | "regional", number] | null =>
  /DISTRITAL/i.test(cargo) ? ["distrital", 6]
    : /PROVINCIAL|METROPOLITAN/i.test(cargo) ? ["provincial", 4]
      : /REGIONAL|GOBERNADOR|CONSEJER/i.test(cargo) ? ["regional", 2] : null;
const normalOrg = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/**
 * Autoridad electa: su registro en el JNE (cargo, lugar, periodo, si sigue) y el gobierno que encabeza o integra, con lo
 * que cada entidad de ese gobierno le compró a la empresa mientras ejercía. Es lo que hace pesar el antecedente: la
 * empresa de una autoridad que le vende a su propia municipalidad. El DNI sólo busca; no sale.
 */
async function autoridadDe(ruc: string, doc: string, cargo: string, fecha: string | null): Promise<Partial<Referencias>> {
  const a = (await pool.query(
    `SELECT ubigeo, cargo, distrito, provincia, departamento, proceso, vigente,
            to_char(periodo_inicio, 'YYYY-MM-DD') AS desde, to_char(periodo_fin, 'YYYY-MM-DD') AS hasta
       FROM jne_autoridades WHERE dni = $1
      ORDER BY (cargo = $2) DESC, (periodo_inicio = $3::date) DESC NULLS LAST, periodo_inicio DESC NULLS LAST LIMIT 1`,
    [doc, cargo, fecha]).catch(() => null))?.rows[0];
  if (!a) return {};
  const ref: Partial<Referencias> = {
    lugar: { distrito: a.distrito ?? null, provincia: a.provincia ?? null, departamento: a.departamento ?? null },
    vigente: a.vigente ?? null, periodo: { desde: a.desde ?? null, hasta: a.hasta ?? null }, eleccion: textoEleccion(a.proceso),
  };
  const nivel = NIVEL_CARGO(String(a.cargo ?? ""));
  const desde: string | null = a.desde ?? fecha;
  if (!nivel || !a.ubigeo || String(a.ubigeo).length < nivel[1] || !desde) return ref;
  const ents = (await pool.query(
    `SELECT g.ruc, e.nombre FROM entidad_gobierno_amplia g LEFT JOIN entidades e ON e.ruc = g.ruc
      WHERE g.nivel = $1 AND g.ubigeo = left($2, $3)`, [nivel[0], String(a.ubigeo), nivel[1]]).catch(() => null))?.rows ?? [];
  if (!ents.length) return ref;
  const hoy = hoyIso();
  const hasta: string = a.hasta && a.hasta < hoy ? a.hasta : hoy;
  const rucs = ents.map((e) => String(e.ruc));
  const [ord, adj] = await Promise.all([
    pool.query(
      `SELECT entidad_ruc AS ruc, sum(monto)::float AS monto, sum(ordenes)::int AS n FROM empresa_orden_anual
        WHERE ruc = $1 AND entidad_ruc = ANY($2::text[]) AND anio BETWEEN $3 AND $4 GROUP BY 1`,
      [ruc, rucs, Number(desde.slice(0, 4)), Number(hasta.slice(0, 4))]).then((r) => r.rows).catch(() => [] as Record<string, any>[]),
    // Sola o en consorcio (conosce_consorcios), como en sus visitas.
    pool.query(
      `SELECT a.entidad_ruc::text AS ruc, COALESCE(sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ${SOLES}), 0)::float AS monto,
              count(DISTINCT a.codigo_convocatoria)::int AS n
         FROM conosce_adjudicaciones a
        WHERE a.ruc_proveedor = ANY(ARRAY(SELECT $1::text UNION SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1))
          AND a.entidad_ruc::text = ANY($2::text[]) AND a.fecha_buenapro BETWEEN $3::date AND $4::date
        GROUP BY 1`, [ruc, rucs, desde, hasta]).then((r) => r.rows).catch(() => [] as Record<string, any>[]),
  ]);
  const o = new Map(ord.map((x) => [String(x.ruc), x]));
  const p = new Map(adj.map((x) => [String(x.ruc), x]));
  ref.gobierno = {
    nivel: nivel[0], desde, hasta,
    entidades: ents
      .map((e) => ({
        ruc: String(e.ruc), nombre: (e.nombre as string | null) ?? null,
        ordenes: Number(o.get(String(e.ruc))?.n ?? 0), montoOrdenes: Number(o.get(String(e.ruc))?.monto ?? 0),
        procesos: Number(p.get(String(e.ruc))?.n ?? 0), montoProcesos: Number(p.get(String(e.ruc))?.monto ?? 0),
      }))
      // Las que le compraron primero (por monto) y, si ninguna, en orden alfabético: un gobierno regional tiene decenas de
      // unidades (hospitales, UGEL…).
      .sort((x, y) => y.montoOrdenes + y.montoProcesos - (x.montoOrdenes + x.montoProcesos) || (x.nombre ?? "").localeCompare(y.nombre ?? ""))
      .slice(0, 12),
  };
  return ref;
}

/** Candidatura (ONPE): a qué cargo postuló, dónde y si salió elegido, de su registro en el JNE de esa elección. */
async function candidaturaDe(doc: string, d: Record<string, unknown>): Promise<Partial<Referencias>> {
  const anio = Number(String(d.proceso ?? "").match(/\d{4}/)?.[0] ?? 0) || null;
  const r = (await pool.query(
    `SELECT cargo, partido, "año" AS anio, resultado, region, provincia, distrito FROM jne_candidaturas
      WHERE numero_documento = $1 ORDER BY ("año" = $2) DESC NULLS LAST, "año" DESC LIMIT 10`, [doc, anio]).catch(() => null))?.rows ?? [];
  const org = normalOrg(d.organizacion);
  const c = r.find((x) => Number(x.anio) === anio && normalOrg(x.partido) === org) ?? r.find((x) => Number(x.anio) === anio);
  if (!c) return {};
  return {
    cargo: c.cargo ?? null, resultado: c.resultado ?? null,
    lugar: { distrito: c.distrito ?? null, provincia: c.provincia ?? null, departamento: c.region ?? null },
  };
}

/**
 * Las referencias de cada antecedente (mismo orden): las de lote (nombres, entidades visitadas) en una consulta cada una.
 * Cada fila trae su `ruc_empresa` (la Historia del contrato junta los de cada integrante de un consorcio).
 */
export async function referenciasDe(filas: Record<string, any>[]): Promise<Referencias[]> {
  const visitadas = [...new Set(filas.filter((x) => String(x.tipo).startsWith("visita_")).map((x) => x.detalle?.entidad_visitada)
    .filter((v): v is string => typeof v === "string" && v.length > 0))];
  const otros = [...new Set(filas.filter((x) => x.tipo === "socio_comun")
    .flatMap((x) => (Array.isArray(x.detalle?.otros_postores) ? (x.detalle.otros_postores as unknown[]) : []))
    .filter((v): v is string => typeof v === "string" && /^20\d{9}$/.test(v)))];
  const [vis, nom] = await Promise.all([
    visitadas.length
      ? pool.query(`SELECT entidad_visitada, min(ruc) AS ruc FROM visita_entidad_ruc WHERE entidad_visitada = ANY($1::text[]) GROUP BY 1`, [visitadas])
        .then((r) => r.rows).catch(() => [] as Record<string, any>[])
      : [],
    otros.length
      ? pool.query(
        `SELECT k.ruc, COALESCE(r.nombre, e.razon_social) AS nombre
           FROM unnest($1::text[]) AS k(ruc) LEFT JOIN empresa_resumen r ON r.ruc = k.ruc LEFT JOIN empresas e ON e.ruc = k.ruc`, [otros])
        .then((r) => r.rows).catch(() => [] as Record<string, any>[])
      : [],
  ]);
  const rucVisitada = new Map(vis.map((x) => [String(x.entidad_visitada), (x.ruc as string | null) ?? null]));
  const nombreOtro = new Map(nom.map((x) => [String(x.ruc), (x.nombre as string | null) ?? null]));
  return Promise.all(filas.map(async (x): Promise<Referencias> => {
    const d = (x.detalle ?? {}) as Record<string, unknown>;
    const ref: Referencias = { clave: claveCruce(x) };
    if (typeof d.proceso === "string" && d.proceso) ref.eleccion = textoEleccion(d.proceso);
    if (String(x.tipo).startsWith("visita_") && typeof d.entidad_visitada === "string") ref.entidadVisitadaRuc = rucVisitada.get(d.entidad_visitada) ?? null;
    if (x.tipo === "socio_comun") {
      ref.otros = (Array.isArray(d.otros_postores) ? (d.otros_postores as unknown[]) : [])
        .filter((v): v is string => typeof v === "string")
        .map((r) => (r.startsWith("20") ? { ruc: r, nombre: nombreOtro.get(r) ?? null } : { ruc: null, nombre: null }));
    }
    if (x.tipo === "autoridad" && x.persona_doc) Object.assign(ref, await autoridadDe(String(x.ruc_empresa), x.persona_doc, String(d.cargo ?? ""), iso(x.fecha)));
    if (x.tipo === "candidato" && x.persona_doc) Object.assign(ref, await candidaturaDe(x.persona_doc, d));
    return ref;
  }));
}
