/**
 * La red de familia de una persona con cargo público (migración 351): qué obtuvo del Estado cada familiar que declaró en
 * su declaración jurada de intereses, y cuánto de eso salió de una entidad en la que él mismo declaró.
 *
 * Privacidad (docs/PRIVACIDAD.md, lib/privacidad.ts): el familiar nunca sale con nombre, documento ni enlace a su ficha:
 * va numerado. El parentesco va con su etiqueta conocida (nunca el texto suelto de la DJI). Si el declarante puede ser una
 * autoridad electa (su nombre completo es público), sólo los parentescos de la lista cerrada que no permiten deducir un
 * apellido (parentescoPublicable); los demás salen como «Familiar» y, en su propia entidad, sin cifras (reservarParentesco).
 */
import { pool } from "./db.js";
import { etiquetaParentesco, parentescoPublicable } from "./privacidad.js";

export interface ItemFamiliar {
  tipo: "orden" | "empresa";
  entidadRuc: string | null;
  entidad: string | null;
  empresaRuc: string | null;
  empresa: string | null;
  rol: string | null;
  ordenes: number | null;
  procesos: number | null;
  monto: number | null;
  desde: number | null;
  hasta: number | null;
  /** Lo obtuvo de una entidad en la que el funcionario presentó declaración. */
  suEntidad: boolean;
  suEntidadOrdenes: number | null;
  suEntidadMonto: number | null;
  /** Autoridad electa y parentesco que destaparía un apellido: en su entidad no se dan las cifras. */
  reservado?: true;
}

export interface FamiliaFuncionario {
  declarados: number;
  conOrdenes: number;
  montoOrdenes: number;
  conEmpresas: number;
  enSuEntidad: number;
  montoSuEntidad: number;
  parientes: { n: number; parentesco: string; items: ItemFamiliar[] }[];
  /** Familiares con algo del Estado que no entraron en la lista (tope). */
  masParientes: number;
}

const TOPE_PARIENTES = 40;
const TOPE_ITEMS = 10;

export async function familiaDelFuncionario(codigo: string, declaranteElecto: boolean): Promise<FamiliaFuncionario | null> {
  const [res, filas] = await Promise.all([
    pool.query<{ declarados: number; conOrdenes: number; montoOrdenes: number; conEmpresas: number; enSuEntidad: number; montoSuEntidad: number }>(
      `SELECT r.declarados, r.con_ordenes AS "conOrdenes", r.monto_ordenes::float AS "montoOrdenes", r.con_empresas AS "conEmpresas",
              r.en_su_entidad AS "enSuEntidad", r.monto_su_entidad::float AS "montoSuEntidad"
         FROM funcionario_familia_resumen r WHERE r.codigo = $1`, [codigo]),
    pool.query<ItemFamiliar & { pariente: number; parentesco: string | null }>(
      `SELECT f.pariente, f.parentesco, f.tipo, f.entidad_ruc AS "entidadRuc", f.entidad, f.empresa_ruc AS "empresaRuc", f.empresa, f.rol,
              f.ordenes, f.procesos, f.monto::float AS monto, f.desde, f.hasta, f.su_entidad AS "suEntidad",
              f.su_entidad_ordenes AS "suEntidadOrdenes", f.su_entidad_monto::float AS "suEntidadMonto"
         FROM funcionario_familiar f WHERE f.codigo = $1
        ORDER BY f.su_entidad DESC, f.monto DESC NULLS LAST LIMIT 600`, [codigo]),
  ]);
  const r = res.rows[0];
  if (!r) return null;
  const porPariente = new Map<number, { n: number; parentesco: string; reservado: boolean; items: ItemFamiliar[]; peso: number }>();
  for (const { pariente, parentesco, ...x } of filas.rows) {
    const publicable = parentescoPublicable(parentesco);
    const reservado = declaranteElecto && !publicable;
    const etiqueta = declaranteElecto ? publicable ?? "Familiar" : etiquetaParentesco(parentesco) ?? "Familiar";
    let p = porPariente.get(pariente);
    if (!p) porPariente.set(pariente, (p = { n: pariente, parentesco: etiqueta, reservado, items: [], peso: 0 }));
    const enSuEntidad = x.suEntidad;
    const item: ItemFamiliar = reservado && enSuEntidad
      ? { ...x, ordenes: x.tipo === "orden" ? null : x.ordenes, monto: x.tipo === "orden" ? null : x.monto, suEntidadOrdenes: null, suEntidadMonto: null, reservado: true }
      : x;
    p.peso += (enSuEntidad ? 1e12 : 0) + Number(x.monto ?? 0);
    if (p.items.length < TOPE_ITEMS) p.items.push(item);
  }
  const todos = [...porPariente.values()].sort((a, b) => b.peso - a.peso);
  // Con una autoridad electa, el total de su entidad sólo suma lo que se muestra.
  const montoSuEntidad = declaranteElecto
    ? todos.flatMap((p) => p.items).filter((i) => i.suEntidad && !i.reservado).reduce((s, i) => s + Number((i.tipo === "orden" ? i.monto : i.suEntidadMonto) ?? 0), 0)
    : r.montoSuEntidad;
  return {
    ...r,
    montoSuEntidad,
    // Renumerados en el orden en que se muestran: el número de la base no sale (es estable y serviría para seguir a alguien).
    parientes: todos.slice(0, TOPE_PARIENTES).map((p, i) => ({ n: i + 1, parentesco: p.parentesco, items: p.items })),
    masParientes: Math.max(0, todos.length - TOPE_PARIENTES),
  };
}
