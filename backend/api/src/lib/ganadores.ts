/**
 * Quién ganó cada contrato de una página de la lista, para el panel de su fila: los integrantes de un consorcio
 * (CONOSCE, cada uno con su RUC) y de cada ganador sus antecedentes (casos_cruce: una fila por ganador o por integrante de
 * consorcio, migración 57). Antes el panel decía «RUC del proveedor 1830304» (el código del consorcio en el SEACE, que no
 * es un RUC) sin decir quiénes lo forman, y no mostraba la bandera que su fila sí («Multa del Tribunal», de uno de los
 * integrantes): la fila junta los antecedentes de todos los ganadores y no dice de quién es cada uno.
 *
 * Dos consultas por la llave (casos_cruce por ocid; conosce_consorcios por el código del consorcio), sólo para las filas
 * que lo necesitan: las que tienen antecedentes o las que ganó un consorcio sin RUC. Quien llama pasa la respuesta por
 * `publicar()`: cada ganador va como `{ ruc, nombre }` (un RUC 10 sale como ref y con un apellido tapado).
 */

import { pool } from "./db.js";

type Severidad = "alta" | "media" | "baja";
const RANGO: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };
const sev = (v: unknown): Severidad => (v === "alta" || v === "media" ? v : "baja");

/** Un ganador del contrato: la empresa (o persona) que ganó, o un integrante del consorcio que ganó. */
export interface Ganador {
  ruc: string;
  nombre: string | null;
  /** El consorcio del que es integrante (su nombre), si ganó en consorcio. */
  consorcio: string | null;
  /** Sus antecedentes en este contrato, los graves primero (vacío: ninguno). */
  cruces: { tipo: string; severidad: Severidad }[];
}

/** Un código de consorcio del SEACE (no un RUC: 4 a 10 dígitos). */
export const esCodigoConsorcio = (v: unknown) => typeof v === "string" && /^\d{4,10}$/.test(v);

/** Una fila de casos_cruce de la página. */
export interface FilaCaso { ocid: string; ruc: string; nombre: string | null; consorcio: string | null; cruces: unknown }
/** Un integrante de un consorcio (conosce_consorcios). */
export interface FilaMiembro { codigo: string; ruc: string; nombre: string | null }

const crucesDe = (v: unknown): Ganador["cruces"] =>
  (Array.isArray(v) ? v : [])
    .map((x) => ({ tipo: String((x as { tipo?: unknown })?.tipo ?? ""), severidad: sev((x as { severidad?: unknown })?.severidad) }))
    .filter((x) => x.tipo)
    .sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad] || a.tipo.localeCompare(b.tipo));

/**
 * Los ganadores de cada fila: los integrantes del consorcio que ganó (con sus antecedentes o ninguno) y, si no, los
 * ganadores con antecedentes. Una fila sin consorcio y sin antecedentes no lleva `ganadores` (el panel ya dice quién ganó).
 */
export function armarGanadores(
  filas: { ocid: string; proveedor?: unknown; proveedorRuc?: unknown }[],
  casos: FilaCaso[],
  miembros: FilaMiembro[],
): Map<string, Ganador[]> {
  const porOcid = new Map<string, FilaCaso[]>();
  for (const k of casos) porOcid.set(k.ocid, [...(porOcid.get(k.ocid) ?? []), k]);
  const porCodigo = new Map<string, FilaMiembro[]>();
  for (const m of miembros) porCodigo.set(m.codigo, [...(porCodigo.get(m.codigo) ?? []), m]);
  const out = new Map<string, Ganador[]>();
  for (const f of filas) {
    const ks = porOcid.get(f.ocid) ?? [];
    const codigo = esCodigoConsorcio(f.proveedorRuc) ? String(f.proveedorRuc) : null;
    const integrantes = codigo ? porCodigo.get(codigo) ?? [] : [];
    const nombreConsorcio = codigo && typeof f.proveedor === "string" ? f.proveedor : null;
    const ganadores: Ganador[] = integrantes.map((m) => {
      const k = ks.find((x) => x.ruc === m.ruc);
      return { ruc: m.ruc, nombre: m.nombre ?? k?.nombre ?? null, consorcio: nombreConsorcio ?? k?.consorcio ?? null, cruces: crucesDe(k?.cruces) };
    });
    // Los ganadores con antecedentes que no son integrantes del consorcio de la fila (otro ítem, otro ganador).
    for (const k of ks) {
      if (ganadores.some((g) => g.ruc === k.ruc)) continue;
      ganadores.push({ ruc: k.ruc, nombre: k.nombre, consorcio: k.consorcio, cruces: crucesDe(k.cruces) });
    }
    if (ganadores.length) out.set(f.ocid, ganadores);
  }
  return out;
}

/** Agrega `ganadores` a las filas que lo necesitan (en el lugar). Si las consultas fallan, la lista sigue sin él. */
export async function conGanadores(filas: Record<string, unknown>[]): Promise<void> {
  const conCruces = filas.filter((f) => Array.isArray(f.cruces) && (f.cruces as unknown[]).length > 0).map((f) => String(f.ocid));
  const codigos = [...new Set(filas.map((f) => f.proveedorRuc).filter(esCodigoConsorcio).map(String))];
  const consorcio = filas.filter((f) => esCodigoConsorcio(f.proveedorRuc)).map((f) => String(f.ocid));
  const ocids = [...new Set([...conCruces, ...consorcio])];
  if (!ocids.length) return;
  try {
    const [casos, miembros] = await Promise.all([
      pool.query<FilaCaso>(
        `SELECT k.ocid, k.ruc, k.proveedor AS nombre, k.consorcio, k.cruces FROM casos_cruce k WHERE k.ocid = ANY($1::text[])`, [ocids]),
      codigos.length
        ? pool.query<FilaMiembro>(
            `SELECT DISTINCT ON (m.ruc_consorcio, m.ruc_miembro) m.ruc_consorcio AS codigo, m.ruc_miembro AS ruc, m.miembro AS nombre
               FROM conosce_consorcios m
              WHERE m.ruc_consorcio = ANY($1::text[]) AND m.ruc_miembro ~ '^(10|20)[0-9]{9}$'
              ORDER BY m.ruc_consorcio, m.ruc_miembro, m.anio DESC`, [codigos])
        : Promise.resolve({ rows: [] as FilaMiembro[] }),
    ]);
    const g = armarGanadores(filas as { ocid: string }[], casos.rows, miembros.rows);
    for (const f of filas) {
      const x = g.get(String(f.ocid));
      if (x) f.ganadores = x;
    }
  } catch (e) {
    console.warn(`[contratos] ganadores: ${(e as Error).message}`);
  }
}
