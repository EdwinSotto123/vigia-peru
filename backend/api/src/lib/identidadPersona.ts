/**
 * La misma persona en las tres fichas de Vigía (pedido del usuario del 2026-11-17: «para la misma PERSONA se encuentra
 * en diversas fuentes, unifícalo»). Cada ficha nació de una fuente y tiene su propio código al azar:
 *   · cargo público   funcionario_resumen (DJI ∪ planilla), por nombre completo           /app/personas/cargo/<código>
 *   · contratada      persona_codigo, por su RUC 10 (el único registro con documento)     /app/personas/<código>
 *   · planilla        planilla_persona.ficha, por entidad y nombre completo               /app/personas/planilla/<código>
 * Las tres escriben el nombre igual (mef_norm: apellidos y nombres), así que la llave que las une es ese nombre. La
 * planilla y la DJI no traen documento: una persona contratada (un RUC concreto) se une a ellas sólo si
 *   · «planilla»: la planilla de una entidad ya la empató (planilla_persona.codigo: misma entidad y mismo nombre), o
 *   · «nombre»:   su nombre completo tiene 4 palabras o más y UN solo RUC 10 de todo el registro de órdenes lo lleva.
 * Con dos o más RUC 10 del mismo nombre (homónimos) no se une ninguno: `homonimos` dice cuántos.
 *
 * Sólo devuelve códigos al azar y nombres de entidades: ni nombres de personas ni documentos.
 */
import { pool } from "./db.js";

export interface FichasDeLaPersona {
  /** Su ficha de cargo público (la ficha única de la persona, si existe). */
  fichaCargo: string | null;
  /** Su ficha de persona contratada y por qué se unió. */
  fichaContratada: { codigo: string; via: "planilla" | "nombre" } | null;
  /** Sus fichas de planilla de hoy (una por entidad). */
  fichasPlanilla: { ficha: string; entidadRuc: string; entidad: string | null }[];
  /** RUC 10 distintos que llevan ese nombre completo en las órdenes (2 o más: homónimos, no se une). */
  homonimos: number;
}

const VACIA: FichasDeLaPersona = { fichaCargo: null, fichaContratada: null, fichasPlanilla: [], homonimos: 0 };
const palabras = (n: string) => n.trim().split(/\s+/).filter(Boolean).length;

interface FilaPlanilla { ficha: string | null; entidadRuc: string; entidad: string | null; codigo: string | null }

/** Las fichas de planilla de un nombre y los RUC 10 que lo llevan (por el índice de apellidos de persona_orden_anual). */
async function porNombre(nombreNorm: string): Promise<{ cargo: string | null; planillas: FilaPlanilla[]; contratadas: string[] }> {
  const [cargo, planillas, contratadas] = await Promise.all([
    pool.query<{ codigo: string }>(`SELECT codigo FROM funcionario_resumen WHERE nombre_norm = $1`, [nombreNorm]),
    pool.query<FilaPlanilla>(
      `SELECT p.ficha, p.entidad_ruc AS "entidadRuc", p.entidad, p.codigo
         FROM planilla_persona p WHERE p.nombre_norm = $1 ORDER BY p.total DESC NULLS LAST LIMIT 12`, [nombreNorm]),
    pool.query<{ codigo: string }>(
      `SELECT pc.codigo
         FROM (SELECT DISTINCT o.ruc FROM persona_orden_anual o
                WHERE o.ap1 = split_part($1, ' ', 1) AND o.ap2 = split_part($1, ' ', 2) AND o.nom_n = $1 LIMIT 6) x
         JOIN persona_codigo pc ON pc.ruc = x.ruc`, [nombreNorm]),
  ]);
  return { cargo: cargo.rows[0]?.codigo ?? null, planillas: planillas.rows, contratadas: contratadas.rows.map((r) => r.codigo) };
}

const fichasPlanilla = (ps: FilaPlanilla[]) =>
  ps.filter((p): p is FilaPlanilla & { ficha: string } => !!p.ficha).map((p) => ({ ficha: p.ficha, entidadRuc: p.entidadRuc, entidad: p.entidad }));

/** La persona contratada de un nombre: la que empató una planilla (todas la misma) o la única con ese nombre largo. */
function contratadaDe(nombreNorm: string, planillas: FilaPlanilla[], contratadas: string[]): FichasDeLaPersona["fichaContratada"] {
  const dePlanilla = [...new Set(planillas.map((p) => p.codigo).filter((c): c is string => !!c))];
  if (dePlanilla.length === 1) return { codigo: dePlanilla[0], via: "planilla" };
  if (dePlanilla.length > 1) return null;
  return contratadas.length === 1 && palabras(nombreNorm) >= 4 ? { codigo: contratadas[0], via: "nombre" } : null;
}

/** Desde la ficha de cargo o la de planilla: las tienen por nombre completo. */
export async function fichasPorNombre(nombreNorm: string | null | undefined): Promise<FichasDeLaPersona> {
  if (!nombreNorm || palabras(nombreNorm) < 2) return VACIA;
  try {
    const x = await porNombre(nombreNorm);
    return { fichaCargo: x.cargo, fichaContratada: contratadaDe(nombreNorm, x.planillas, x.contratadas), fichasPlanilla: fichasPlanilla(x.planillas), homonimos: x.contratadas.length };
  } catch (e) {
    console.warn(`[identidad] por nombre: ${(e as Error).message}`);
    return VACIA;
  }
}

/** Desde la ficha de la persona contratada (un RUC): sus otras fichas, sólo si el enlace es seguro. */
export async function fichasDeContratada(ruc: string, codigo: string): Promise<FichasDeLaPersona> {
  try {
    // Lo que una planilla ya empató con esta persona (misma entidad y mismo nombre).
    const [suyas, nombre] = await Promise.all([
      pool.query<FilaPlanilla & { nombreNorm: string }>(
        `SELECT p.ficha, p.entidad_ruc AS "entidadRuc", p.entidad, p.codigo, p.nombre_norm AS "nombreNorm"
           FROM planilla_persona p WHERE p.codigo = $1 ORDER BY p.total DESC NULLS LAST LIMIT 12`, [codigo]),
      pool.query<{ n: string }>(`SELECT o.nom_n AS n FROM persona_orden_anual o WHERE o.ruc = $1 AND o.nom_n IS NOT NULL ORDER BY o.anio DESC LIMIT 1`, [ruc]),
    ]);
    const nombreNorm = suyas.rows[0]?.nombreNorm ?? nombre.rows[0]?.n ?? null;
    if (!nombreNorm) return VACIA;
    // La misma regla que desde la ficha de cargo (contratadaDe): si desde allá no se llega a ESTA persona, desde aquí
    // tampoco se enlaza. Así las dos fichas siempre dicen lo mismo y la redirección no deja a nadie en una ficha ajena.
    const x = await porNombre(nombreNorm);
    const c = contratadaDe(nombreNorm, x.planillas, x.contratadas);
    if (c?.codigo !== codigo) return { ...VACIA, homonimos: x.contratadas.length };
    return { fichaCargo: x.cargo, fichaContratada: c, fichasPlanilla: fichasPlanilla(x.planillas), homonimos: x.contratadas.length };
  } catch (e) {
    console.warn(`[identidad] de contratada: ${(e as Error).message}`);
    return VACIA;
  }
}
