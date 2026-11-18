/**
 * El cargo que la persona de verdad tuvo (migración 357).
 *
 * Dos registros decían menos de lo que sabían (reporte del usuario, 2026-11-17: un ex rector salía como «Colaborador» y
 * «Profesor principal» con S/ 296 al mes):
 *
 *   · La declaración jurada de intereses trae la CATEGORÍA del formulario («COLABORADOR» u «OTRO CARGO FUNCION O LABOR» en
 *     9 de cada 10). El puesto, con las palabras de quien declara, está en la sección de empleos de la misma declaración
 *     (dji_empleos): «RECTOR DE LA UNI».
 *   · La planilla resumía a la persona con su último mes. Quien cambió de cargo (o cobró su liquidación ese mes) quedaba
 *     con un cargo y un sueldo que no eran los suyos. Aquí, cada cargo que tuvo en cada entidad, con sus meses y su pago.
 *
 * Privacidad: de los empleos sólo salen empleadores con RUC 20 (personas jurídicas); un empleador persona natural, nunca.
 */
import { consultaConPlazo } from "./db.js";

/** Las categorías del formulario que no dicen el puesto. */
export const CARGO_GENERICO = /^(COLABORADOR|OTRO CARGO,? FUNCI[OÓ]N O LABOR|OTROS?)$/i;
export const esCargoGenerico = (cargo: unknown): boolean => typeof cargo === "string" && CARGO_GENERICO.test(cargo.trim());

export interface EmpleoDeclarado {
  /** RUC del empleador (siempre una persona jurídica). */
  ruc: string;
  entidad: string | null;
  /** El empleador es una entidad pública con ficha en Vigía. */
  publica: boolean;
  cargo: string;
  /** En cuántas declaraciones figura. */
  declaraciones: number;
  inicio: string | null;
  cese: string | null;
  /** Ninguna declaración le pone fecha de cese. */
  sinCese: boolean;
}

/** Un cargo que la persona tuvo en la planilla de una entidad: sus meses publicados y lo que cobró en un mes habitual. */
export interface CargoEnPlanilla {
  entidadRuc: string;
  cargo: string | null;
  dependencia: string | null;
  regimen: number | null;
  meses: number;
  primerMes: string | null;
  ultimoMes: string | null;
  /** Remuneración u honorarios de un mes habitual (la mediana, sin los montos dudosos). */
  base: number | null;
  /** Todo lo que cobró en un mes habitual, con gratificaciones y otros conceptos. */
  total: number | null;
}

const DIA = 86_400_000;
const dias = (a: string | null, b: string | null) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / DIA : Infinity);

/**
 * Un mismo empleo, escrito de varias formas entre una declaración y otra («RECTOR», «RECTOR UNI», «RECTOR DE LA UNI»), es una
 * sola fila: mismo empleador e inicio a 31 días o menos. Queda la forma más repetida; el cese, el último que declaró.
 */
export function juntarEmpleos(filas: EmpleoDeclarado[]): EmpleoDeclarado[] {
  const grupos: (EmpleoDeclarado & { formas: Map<string, number> })[] = [];
  const orden = [...filas].sort((a, b) => b.declaraciones - a.declaraciones || a.cargo.localeCompare(b.cargo));
  for (const f of orden) {
    const g = grupos.find((x) => x.ruc === f.ruc && (x.cargo === f.cargo || dias(x.inicio, f.inicio) <= 31));
    if (!g) { grupos.push({ ...f, formas: new Map([[f.cargo, f.declaraciones]]) }); continue; }
    g.formas.set(f.cargo, (g.formas.get(f.cargo) ?? 0) + f.declaraciones);
    g.declaraciones += f.declaraciones;
    g.inicio = [g.inicio, f.inicio].filter(Boolean).sort()[0] ?? null;
    g.cese = [g.cese, f.cese].filter(Boolean).sort().pop() ?? null;
    g.sinCese = g.sinCese && f.sinCese;
    g.entidad = g.entidad ?? f.entidad;
  }
  return grupos
    .map(({ formas, ...g }) => ({ ...g, cargo: [...formas.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]![0] }))
    // Primero lo vigente (sin cese), después lo más reciente.
    .sort((a, b) => Number(b.sinCese) - Number(a.sinCese) || (b.cese ?? b.inicio ?? "").localeCompare(a.cese ?? a.inicio ?? ""));
}

/** El puesto declarado en esa entidad, para una fila que sólo trae la categoría del formulario. */
export function cargoRealDe(cargo: string | null, entidadRuc: string | null, empleos: EmpleoDeclarado[]): string | null {
  if (!entidadRuc || !(cargo == null || esCargoGenerico(cargo))) return null;
  const suyos = empleos.filter((e) => e.ruc === entidadRuc && !esCargoGenerico(e.cargo));
  return suyos.sort((a, b) => b.declaraciones - a.declaraciones)[0]?.cargo ?? null;
}

/** Los empleos que la persona escribió en sus declaraciones juradas, ya juntados. null: no respondió a tiempo. */
export async function empleosDeclarados(nombreNorm: string): Promise<EmpleoDeclarado[] | null> {
  return consultaConPlazo<EmpleoDeclarado & { entidadPublica: string | null }>(
    `SELECT e.ruc_entidad AS ruc, (SELECT s.nombre FROM entidad_stats s WHERE s.ruc = e.ruc_entidad) AS "entidadPublica",
            mode() WITHIN GROUP (ORDER BY btrim(e.nombre_entidad)) AS entidad, upper(btrim(e.cargo)) AS cargo,
            count(DISTINCT e.codigo_ddjj)::int AS declaraciones,
            to_char(min(fecha_dji(e.fecha_inicio)), 'YYYY-MM-DD') AS inicio, to_char(max(fecha_dji(e.fecha_cese)), 'YYYY-MM-DD') AS cese,
            bool_and(COALESCE(btrim(e.fecha_cese), '') = '') AS "sinCese"
       FROM dji_empleos e
      WHERE e.codigo_ddjj IN (SELECT d.codigo_ddjj FROM dji_funcionarios d WHERE d.nombre_norm = $1)
        AND e.ruc_entidad ~ '^20[0-9]{9}$' AND length(btrim(COALESCE(e.cargo, ''))) >= 3
      GROUP BY e.ruc_entidad, upper(btrim(e.cargo))
      ORDER BY count(DISTINCT e.codigo_ddjj) DESC LIMIT 150`, [nombreNorm], 8000)
    .then((r) => juntarEmpleos(r.rows.map(({ entidadPublica, ...x }) => ({ ...x, entidad: entidadPublica ?? x.entidad, publica: entidadPublica != null }))))
    .catch(() => null);
}

/** Cada cargo que tuvo en cada planilla, del más reciente al más antiguo. null: no respondió a tiempo. */
export async function cargosEnPlanilla(nombreNorm: string): Promise<CargoEnPlanilla[] | null> {
  return consultaConPlazo<CargoEnPlanilla>(
    `SELECT p.entidad_ruc AS "entidadRuc", NULLIF(btrim(p.cargo), '') AS cargo,
            (array_agg(p.dependencia ORDER BY p.anio DESC, p.mes DESC))[1] AS dependencia,
            (array_agg(p.regimen ORDER BY p.anio DESC, p.mes DESC))[1] AS regimen,
            count(DISTINCT p.anio * 100 + p.mes)::int AS meses,
            to_char(min(make_date(p.anio, p.mes, 1)), 'YYYY-MM') AS "primerMes", to_char(max(make_date(p.anio, p.mes, 1)), 'YYYY-MM') AS "ultimoMes",
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE
               WHEN x.dudoso THEN NULL
               WHEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0) > 0 THEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0)
               WHEN COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0) = 0 THEN p.total END))::float AS base,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN x.dudoso THEN NULL ELSE p.total END))::float AS total
       FROM planilla_pte p,
            LATERAL (SELECT motivo_planilla_dudosa(p.remuneraciones, p.honorarios, p.incentivo, p.gratificacion, p.otros, p.total) IS NOT NULL AS dudoso) x
      WHERE p.nombre_norm = $1
      GROUP BY 1, 2 ORDER BY 1, max(p.anio * 100 + p.mes) DESC LIMIT 150`, [nombreNorm], 8000)
    .then((r) => r.rows).catch(() => null);
}
