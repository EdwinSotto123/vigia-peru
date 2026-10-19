/**
 * La evidencia de cada antecedente del ganador (lib/cruces.ts): los registros oficiales que lo sostienen, para que la
 * ficha del contrato muestre de dónde sale cada afirmación y cómo verificarla, no sólo una conclusión con el enlace a
 * la portada de la fuente. El usuario lo pidió el 2026-10-19 ("ni siquiera adjuntas evidencia").
 *
 * Una forma para todos los tipos: un título, columnas tipadas, filas, cómo verificarlo y un enlace a la fuente (el
 * del registro cuando la fuente lo trae: el aporte en Claridad, la hoja de vida en el JNE, el proceso en el OECE).
 * Privacidad (lib/privacidad.ts): nunca un DNI ni el nombre de una persona natural. Lo de una persona vinculada (socio,
 * representante) se busca por su documento en el servidor, pero lo que sale es el registro sin nombre ni documento;
 * la autoridad que gobernaba la entidad va por su cargo, su organización y su período.
 */

import { pool } from "./db.js";

export type TipoColumna = "texto" | "fecha" | "soles" | "pct" | "enlace";

export interface Evidencia {
  titulo: string;
  columnas: { clave: string; titulo: string; tipo?: TipoColumna }[];
  filas: Record<string, unknown>[];
  /** Si hay más registros que los que se muestran. */
  total?: number;
  /** Cómo verificarlo en la fuente, en una frase. */
  verificar?: string;
  enlace?: { texto: string; url: string } | null;
}

/** Una fila de cruces_proveedor con lo que hace falta para buscar su evidencia (persona_doc no sale de aquí). */
export interface FilaCruce {
  tipo: string;
  ruc_empresa: string;
  persona_doc: string | null;
  detalle: Record<string, unknown> | null;
}

/** El proceso del contrato: su entidad, su código y su fecha (para los procesos repetidos y quién gobernaba). */
export interface ProcesoCruce {
  ocid: string;
  codigo: string | null;
  entidadRuc: string | null;
  ubigeo: string | null;
  fecha: string | null;
}

const TOPE = 60;
const fecha = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.slice(0, 10) : null);
const num = (v: unknown) => (v == null ? null : Number(v));
const filas = (sql: string, vals: unknown[]) => pool.query(sql, vals).then((r) => r.rows as Record<string, any>[]).catch(() => [] as Record<string, any>[]);

const PERFIL_OSCE = (ruc: string) => `https://apps.osce.gob.pe/perfilprov-ui/ficha/${ruc}`;
const PROCESO_OECE = (codigo: string) => `https://contratacionesabiertas.oece.gob.pe/proceso/${encodeURIComponent(codigo)}`;
const CLARIDAD = "https://claridadportal.onpe.gob.pe/";

/** Quién: la empresa o una persona vinculada (sin nombre: el nombre, tapado, ya va en el cruce). */
const quien = (f: FilaCruce) => (f.persona_doc ? "una persona vinculada a la empresa (socio o representante)" : "la empresa");

async function gastosCampana(f: FilaCruce): Promise<Evidencia> {
  const doc = f.persona_doc ?? f.ruc_empresa;
  const org = String(f.detalle?.organizacion ?? "");
  const r = await filas(
    `SELECT proceso, organizacion, monto, total_op FROM onpe_gastos_proveedores
      WHERE documento = $1 AND ($2 = '' OR organizacion = $2) ORDER BY anio DESC, monto DESC LIMIT ${TOPE}`, [doc, org]);
  return {
    titulo: `Lo que ${quien(f)} le vendió a la campaña`,
    columnas: [
      { clave: "proceso", titulo: "Elección" },
      { clave: "organizacion", titulo: "Organización política" },
      { clave: "monto", titulo: "Le vendió", tipo: "soles" },
      { clave: "total", titulo: "Gasto total de la campaña", tipo: "soles" },
      { clave: "parte", titulo: "Parte del gasto", tipo: "pct" },
    ],
    filas: r.map((x) => ({
      proceso: x.proceso, organizacion: x.organizacion, monto: num(x.monto), total: num(x.total_op),
      parte: x.total_op ? (100 * Number(x.monto)) / Number(x.total_op) : null,
    })),
    verificar: `En Claridad (ONPE): Gastos de campaña › ${org || "la organización"} › Proveedores, buscando el ${f.persona_doc ? "documento de la persona vinculada" : `RUC ${f.ruc_empresa}`}.`,
    enlace: { texto: "ONPE · Claridad, gastos de campaña", url: CLARIDAD },
  };
}

async function aportes(f: FilaCruce): Promise<Evidencia> {
  const doc = f.persona_doc ?? f.ruc_empresa;
  const partido = String(f.detalle?.partido ?? "");
  const r = await filas(
    `SELECT fecha_aporte, "año" AS anio, proceso, partido, tipo_aporte, monto, fuente_url, count(*) OVER () AS n
       FROM onpe_aportantes WHERE numero_documento = $1 AND ($2 = '' OR partido = $2)
      ORDER BY fecha_aporte DESC NULLS LAST LIMIT ${TOPE}`, [doc, partido]);
  return {
    titulo: `Los aportes de ${quien(f)}`,
    columnas: [
      { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
      { clave: "proceso", titulo: "Elección" },
      { clave: "partido", titulo: "A quién" },
      { clave: "tipo", titulo: "Tipo de aporte" },
      { clave: "monto", titulo: "Monto", tipo: "soles" },
      { clave: "fuente", titulo: "Registro", tipo: "enlace" },
    ],
    filas: r.map((x) => ({
      fecha: fecha(x.fecha_aporte), proceso: x.proceso ?? (x.anio ? String(x.anio) : null), partido: x.partido, tipo: x.tipo_aporte,
      monto: num(x.monto), fuente: x.fuente_url ? { texto: "ONPE", url: x.fuente_url } : null,
    })),
    total: r.length ? Number(r[0].n) : 0,
    verificar: "En Claridad (ONPE): Aportes, buscando a la organización política y el aportante.",
    enlace: { texto: "ONPE · Claridad, aportes", url: "https://claridad.onpe.gob.pe/" },
  };
}

async function candidaturas(f: FilaCruce): Promise<Evidencia> {
  const r = await filas(`SELECT organizacion, proceso, departamento, fuente_url FROM onpe_candidatos WHERE dni = $1 LIMIT ${TOPE}`, [f.persona_doc]);
  return {
    titulo: "Su candidatura",
    columnas: [
      { clave: "proceso", titulo: "Elección" },
      { clave: "organizacion", titulo: "Organización política" },
      { clave: "departamento", titulo: "Departamento" },
      { clave: "fuente", titulo: "Registro", tipo: "enlace" },
    ],
    filas: r.map((x) => ({ proceso: x.proceso, organizacion: x.organizacion, departamento: x.departamento, fuente: x.fuente_url ? { texto: "ONPE", url: x.fuente_url } : null })),
    verificar: "En Claridad (ONPE): Candidatos, por organización y elección.",
    enlace: { texto: "ONPE · Claridad, candidatos", url: "https://claridad.onpe.gob.pe/" },
  };
}

const COL_AUTORIDAD: Evidencia["columnas"] = [
  { clave: "cargo", titulo: "Cargo" },
  { clave: "organizacion", titulo: "Organización política" },
  { clave: "lugar", titulo: "Dónde" },
  { clave: "periodo", titulo: "Período" },
  { clave: "fuente", titulo: "Registro", tipo: "enlace" },
];
const filaAutoridad = (x: Record<string, any>) => ({
  cargo: x.cargo, organizacion: x.organizacion_politica,
  lugar: [x.distrito, x.provincia, x.departamento].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || null,
  periodo: [fecha(x.periodo_inicio)?.slice(0, 4), fecha(x.periodo_fin)?.slice(0, 4)].filter(Boolean).join("–") || null,
  fuente: x.fuente_url ? { texto: "JNE", url: x.fuente_url } : null,
});

async function autoridad(f: FilaCruce): Promise<Evidencia> {
  const r = await filas(
    `SELECT cargo, organizacion_politica, departamento, provincia, distrito, periodo_inicio, periodo_fin, fuente_url
       FROM jne_autoridades WHERE dni = $1 ORDER BY periodo_inicio DESC NULLS LAST LIMIT ${TOPE}`, [f.persona_doc]);
  return {
    titulo: "El cargo de la persona vinculada (JNE)",
    columnas: COL_AUTORIDAD,
    filas: r.map(filaAutoridad),
    verificar: "En Infogob / Voto Informado (JNE), su hoja de vida.",
    enlace: { texto: "JNE · Infogob", url: "https://infogob.jne.gob.pe/" },
  };
}

/** Quién gobernaba la entidad del proceso, de esa organización, cuando se convocó (sin el nombre: cargo y período). */
async function gobernante(f: FilaCruce, p: ProcesoCruce): Promise<Evidencia | null> {
  const cargo = String(f.detalle?.cargo_gobernante ?? "");
  const org = String(f.detalle?.organizacion_gobernante ?? "");
  if (!cargo || !org || !p.ubigeo) return null;
  const r = await filas(
    `SELECT cargo, organizacion_politica, departamento, provincia, distrito, periodo_inicio, periodo_fin, fuente_url
       FROM jne_autoridades
      WHERE cargo = $1 AND organizacion_politica = $2
        AND CASE $1 WHEN 'ALCALDE DISTRITAL' THEN ubigeo = $3 WHEN 'ALCALDE PROVINCIAL' THEN left(ubigeo, 4) = left($3, 4)
                    ELSE left(ubigeo, 2) = left($3, 2) END
        AND ($4::date IS NULL OR ((periodo_inicio IS NULL OR $4::date >= periodo_inicio) AND (periodo_fin IS NULL OR $4::date <= periodo_fin)))
      ORDER BY periodo_inicio DESC NULLS LAST LIMIT 5`, [cargo, org, p.ubigeo, p.fecha]);
  return {
    titulo: "Quién gobernaba la entidad cuando se convocó",
    columnas: COL_AUTORIDAD,
    filas: r.map(filaAutoridad),
    verificar: "En Infogob (JNE): autoridades electas de la región, provincia o distrito de la entidad.",
    enlace: { texto: "JNE · Infogob", url: "https://infogob.jne.gob.pe/" },
  };
}

async function penalidades(f: FilaCruce): Promise<Evidencia> {
  const r = await filas(
    `SELECT fecha, entidad_contratante, tipo_penalidad, objeto_contrato, descripcion, monto, contrato_id, count(*) OVER () AS n
       FROM penalidades WHERE empresa_ruc = $1 ORDER BY fecha DESC NULLS LAST LIMIT ${TOPE}`, [f.ruc_empresa]);
  return {
    titulo: "Las penalidades que le aplicaron",
    columnas: [
      { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
      { clave: "entidad", titulo: "Entidad que la aplicó" },
      { clave: "tipo", titulo: "Penalidad" },
      { clave: "motivo", titulo: "Detalle" },
      { clave: "monto", titulo: "Monto", tipo: "soles" },
    ],
    filas: r.map((x) => ({
      fecha: fecha(x.fecha), entidad: x.entidad_contratante, tipo: x.tipo_penalidad,
      motivo: x.descripcion ?? x.objeto_contrato, monto: num(x.monto),
    })),
    total: r.length ? Number(r[0].n) : 0,
    verificar: `En el perfil del proveedor del OSCE (RUC ${f.ruc_empresa}), pestaña de penalidades.`,
    enlace: { texto: "OSCE · perfil del proveedor", url: PERFIL_OSCE(f.ruc_empresa) },
  };
}

async function sanciones(f: FilaCruce): Promise<Evidencia> {
  const r = await filas(
    `SELECT tipo, resolucion, fecha_resolucion, fecha_desde, fecha_hasta, infraccion, norma, estado, monto_multa_soles
       FROM osce_sancionados WHERE ruc = $1 ORDER BY fecha_resolucion DESC NULLS LAST LIMIT ${TOPE}`, [f.ruc_empresa]);
  return {
    titulo: "Las sanciones del Tribunal de Contrataciones",
    columnas: [
      { clave: "resolucion", titulo: "Resolución" },
      { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
      { clave: "tipo", titulo: "Sanción" },
      { clave: "vigencia", titulo: "Vigencia" },
      { clave: "infraccion", titulo: "Infracción" },
      { clave: "multa", titulo: "Multa", tipo: "soles" },
    ],
    filas: r.map((x) => ({
      resolucion: x.resolucion, fecha: fecha(x.fecha_resolucion), tipo: [x.tipo, x.estado].filter(Boolean).join(" · "),
      vigencia: x.fecha_desde ? `${fecha(x.fecha_desde)} → ${fecha(x.fecha_hasta) ?? "sin fin"}` : null,
      infraccion: [x.infraccion, x.norma].filter(Boolean).join(" — ") || null, multa: num(x.monto_multa_soles),
    })),
    verificar: `En el perfil del proveedor del OSCE (RUC ${f.ruc_empresa}), sanciones; o en el buscador de resoluciones del Tribunal.`,
    enlace: { texto: "OSCE · perfil del proveedor", url: PERFIL_OSCE(f.ruc_empresa) },
  };
}

async function recurrente(f: FilaCruce, p: ProcesoCruce): Promise<Evidencia | null> {
  if (!p.entidadRuc) return null;
  const r = await filas(
    `SELECT a.codigo_convocatoria AS codigo, min(a.fecha_convocatoria) AS fecha, max(a.descripcion_proceso) AS descripcion,
            max(a.objeto) AS objeto, sum(a.monto_adjudicado) AS monto,
            (SELECT c.ocid FROM convocatorias c WHERE c.codigo = a.codigo_convocatoria AND c.entidad_ruc = $1 LIMIT 1) AS ocid,
            count(*) OVER () AS n
       FROM conosce_adjudicaciones a
      WHERE a.entidad_ruc = $1 AND a.ruc_proveedor = $2 AND a.codigo_convocatoria IS DISTINCT FROM $3
      GROUP BY a.codigo_convocatoria ORDER BY min(a.fecha_convocatoria) DESC NULLS LAST LIMIT ${TOPE}`,
    [p.entidadRuc, f.ruc_empresa, p.codigo]);
  return {
    titulo: "Los otros procesos que le ganó a esta entidad",
    columnas: [
      { clave: "fecha", titulo: "Convocado", tipo: "fecha" },
      { clave: "proceso", titulo: "Proceso", tipo: "enlace" },
      { clave: "objeto", titulo: "Objeto" },
      { clave: "monto", titulo: "Adjudicado", tipo: "soles" },
    ],
    filas: r.map((x) => ({
      fecha: fecha(x.fecha), objeto: x.objeto, monto: num(x.monto),
      proceso: { texto: x.descripcion ?? `Proceso ${x.codigo}`, url: x.ocid ? `/app/contratos/${x.ocid}` : PROCESO_OECE(String(x.codigo)) },
    })),
    total: r.length ? Number(r[0].n) : 0,
    verificar: "Cada proceso abre su ficha en Vigía o, si no está en la base, su registro en el OECE (Contrataciones Abiertas).",
    enlace: { texto: "OSCE · perfil del proveedor", url: PERFIL_OSCE(f.ruc_empresa) },
  };
}

/** La evidencia de cada fila (mismo orden), [] donde no hay nada que agregar a lo que el cruce ya trae. */
export async function evidenciasDe(rows: FilaCruce[], p: ProcesoCruce): Promise<Evidencia[][]> {
  return Promise.all(rows.map(async (f): Promise<Evidencia[]> => {
    const ev: (Evidencia | null)[] = [];
    switch (f.tipo) {
      case "proveedor_campana": ev.push(await gastosCampana(f)); break;
      case "aporte":
      case "aporte_empresa": ev.push(await aportes(f)); break;
      case "candidato": ev.push(await candidaturas(f)); break;
      case "autoridad": ev.push(await autoridad(f)); break;
      case "partido_gobernante": {
        const via = String(f.detalle?.via ?? "");
        ev.push(via === "proveedor_campana" ? await gastosCampana(f) : await aportes(f));
        ev.push(await gobernante(f, p));
        break;
      }
      case "penalidad": ev.push(await penalidades(f)); break;
      case "sancion":
      case "sancion_vigente": ev.push(await sanciones(f)); break;
      case "recurrente": ev.push(await recurrente(f, p)); break;
      default: break;
    }
    return ev.filter((e): e is Evidencia => !!e && e.filas.length > 0);
  }));
}
