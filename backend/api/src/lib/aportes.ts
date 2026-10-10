/**
 * Piezas compartidas de los aportes ("Financia una auditoría"): las usan el aporte ciudadano
 * (routes/contribuciones.ts), la cuenta (routes/cuentas.ts), el panel (routes/admin_procesar.ts) y
 * las lecturas públicas (routes/financiamiento.ts).
 *
 *   · tarifaVigente()             la tarifa que rige hoy (vigente_desde <= hoy).
 *   · colaDeEntidad()             contratos de una entidad en cola, cuántos con documentos, y la zona
 *                                 que llevaría su aporte (zona_de_entidad, migración 39).
 *   · entidadDeAporteSql()        `{ruc, nombre}` de un aporte por entidad (o null) como expresión SQL.
 *   · colaDePartido()             contratos en cola de un partido en un período (los de las entidades que gobernó
 *                                 cuando se convocaron) y la zona que llevaría su aporte (migración 41).
 *   · partidoDeAporteSql()        `{clave, nombre, anio}` de un aporte por partido (o null) como expresión SQL.
 *   · marcarConflictoDeInteres()  regla de independencia (docs/design/FINANCIA_UNA_AUDITORIA.md §6).
 */

import type pg from "pg";
import { alertaNoDemo } from "./publicacion.js";

/** Un pool o un cliente con transacción abierta: lo único que se usa es `query`. */
export interface Consultable {
  query(texto: string, valores?: unknown[]): Promise<pg.QueryResult<any>>;
}

/** Tarifa que rige hoy (la más reciente ya vigente). null si no hay ninguna. */
export async function tarifaVigente(q: Consultable): Promise<{ id: number; precioPen: number } | null> {
  const r = await q.query(
    "SELECT id, precio_pen FROM tarifas WHERE vigente_desde <= current_date ORDER BY vigente_desde DESC, id DESC LIMIT 1");
  const t = r.rows[0];
  return t ? { id: Number(t.id), precioPen: Number(t.precio_pen) } : null;
}

export interface ColaEntidad {
  ruc: string;
  nombre: string;
  /** Contratos de la entidad en cola_auditoria (tipos/etapas activos; con `tipos`, además sólo esos). */
  enCola: number;
  /** De esos, con documentos vigentes en GCS (documentos_listos). */
  listos: number;
  /** La zona que llevaría su aporte (moda de la zona de sus contratos en cola). null sin cola. */
  zona: { ubigeo: string; nombre: string; nivel: string } | null;
}

/** La entidad, su cola y su zona derivada; null si el RUC no es de una entidad. Requiere la migración 39. */
export async function colaDeEntidad(q: Consultable, ruc: string, tipos: string[] | null = null): Promise<ColaEntidad | null> {
  const r = await q.query(
    `SELECT e.ruc, e.nombre, k.n AS "enCola", k.listos,
            z.ubigeo AS "zonaUbigeo", z.nombre AS "zonaNombre", z.nivel AS "zonaNivel"
       FROM entidades e
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS n, count(*) FILTER (WHERE documentos_listos(q.ocid))::int AS listos
           FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid
          WHERE c.entidad_ruc = e.ruc AND ($2::text[] IS NULL OR c.tipo_contratacion = ANY ($2::text[]))) k
       LEFT JOIN zonas z ON z.ubigeo = zona_de_entidad(e.ruc)
      WHERE e.ruc = $1`,
    [ruc, tipos && tipos.length ? tipos : null]);
  const f = r.rows[0];
  if (!f) return null;
  return {
    ruc: String(f.ruc).trim(),
    nombre: f.nombre,
    enCola: f.enCola,
    listos: f.listos,
    zona: f.zonaUbigeo ? { ubigeo: f.zonaUbigeo, nombre: f.zonaNombre, nivel: f.zonaNivel } : null,
  };
}

export interface ColaPartido {
  clave: string;
  nombre: string;
  anio: number;
  /** Contratos del partido en cola_auditoria (con `tipos`, sólo esos). */
  enCola: number;
  /** De esos, con documentos vigentes en GCS. */
  listos: number;
  zona: { ubigeo: string; nombre: string; nivel: string } | null;
}

/** El partido en ese período, su cola y su zona derivada; null si no gobernó nada ese período. Requiere la migración 41. */
export async function colaDePartido(q: Consultable, clave: string, anio: number, tipos: string[] | null = null): Promise<ColaPartido | null> {
  const r = await q.query(
    `SELECT g.nombre, k.n AS "enCola", k.listos, z.ubigeo AS "zonaUbigeo", z.nombre AS "zonaNombre", z.nivel AS "zonaNivel"
       FROM (SELECT max(org_nombre) AS nombre FROM gobierno_periodo WHERE org_clave = $1 AND anio_eleccion = $2) g
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS n, count(*) FILTER (WHERE documentos_listos(q.ocid))::int AS listos
           FROM cola_auditoria q
           JOIN convocatorias c ON c.ocid = q.ocid
           JOIN contrato_partido cp ON cp.ocid = q.ocid
          WHERE cp.org_clave = $1 AND cp.anio_eleccion = $2
            AND ($3::text[] IS NULL OR c.tipo_contratacion = ANY ($3::text[]))) k
       LEFT JOIN zonas z ON z.ubigeo = zona_de_partido($1, $2)
      WHERE g.nombre IS NOT NULL`,
    [clave, anio, tipos && tipos.length ? tipos : null]);
  const f = r.rows[0];
  if (!f) return null;
  return {
    clave, anio, nombre: f.nombre, enCola: f.enCola, listos: f.listos,
    zona: f.zonaUbigeo ? { ubigeo: f.zonaUbigeo, nombre: f.zonaNombre, nivel: f.zonaNivel } : null,
  };
}

/** `{clave, nombre, anio}` del partido de un aporte por partido, o null. `alias` es el de `contribuciones`. */
export const partidoDeAporteSql = (alias: string, disponible: boolean) => disponible
  ? `(SELECT json_build_object('clave', ${alias}.partido_clave, 'anio', ${alias}.partido_anio,
            'nombre', (SELECT max(gp.org_nombre) FROM gobierno_periodo gp WHERE gp.org_clave = ${alias}.partido_clave))
       WHERE ${alias}.partido_clave IS NOT NULL)`
  : "NULL::json";

/**
 * `{ruc, nombre}` de la entidad de un aporte por entidad, o null (aporte por zona). `alias` es el de
 * `contribuciones` en la consulta. Sin la migración 39 (`disponible` = hayAporteEntidad()), siempre null.
 */
export const entidadDeAporteSql = (alias: string, disponible: boolean) => disponible
  ? `(SELECT json_build_object('ruc', en.ruc, 'nombre', en.nombre) FROM entidades en WHERE en.ruc = ${alias}.entidad_ruc)`
  : "NULL::json";

/**
 * Conflicto de interés (regla 3 del diseño): una empresa con sanción vigente del OSCE o que es
 * proveedora en alertas activas puede aportar, pero no aparece (visible = false, con el motivo).
 * Devuelve el motivo si lo marcó; null si no hay conflicto.
 */
export async function marcarConflictoDeInteres(q: Consultable, financiadorId: number, ruc: string): Promise<string | null> {
  const r = await q.query(
    `SELECT
       EXISTS (SELECT 1 FROM osce_sancionados s WHERE s.ruc = $1 AND (s.fecha_hasta IS NULL OR s.fecha_hasta >= current_date)) AS sancionado,
       EXISTS (SELECT 1 FROM alertas a WHERE a.proveedor_ruc = $1 AND a.estado = 'activa' AND ${alertaNoDemo("a")}) AS con_alertas`,
    [ruc]);
  const { sancionado, con_alertas } = r.rows[0] ?? {};
  if (!sancionado && !con_alertas) return null;
  const motivo = sancionado ? "sancion_vigente_osce" : "proveedor_con_alertas_activas";
  await q.query(`UPDATE financiadores SET visible = false, motivo_no_visible = $2 WHERE id = $1`, [financiadorId, motivo]);
  return motivo;
}
