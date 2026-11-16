/**
 * Personas con cargo público (migraciones 318 y 319): quien presentó una declaración jurada de intereses a la Contraloría
 * o está o estuvo en una planilla del Estado. Pedido del dueño del 2026-11-16: el titular de un organismo «no aparece en
 * la BBDD… no aparece nada de su rastro», y después «no sólo es declaración jurada… ¿por qué no tenemos su data si está en
 * planilla?». Estaba en todo (14 declaraciones en 5 entidades, 81 visitas a 19, 18 meses en la planilla de su entidad),
 * pero la web no tenía por dónde llegar: sólo se encontraba a quien recibió órdenes o ganó procesos, y de la planilla sólo
 * a quien figura en el último mes de su entidad (el último archivo publicado no lo traía).
 *
 * Tres reglas de privacidad (docs/PRIVACIDAD.md), todas aquí:
 *   1. El nombre sale con el apellido MATERNO tapado, siempre el mismo (como en la planilla): en una misma página nunca
 *      se muestran dos versiones tapadas de un nombre, que juntas lo dirían entero.
 *   2. Se busca SÓLO por lo que se ve (el apellido paterno y los nombres, `funcionario_resumen.palabras`): escribir el
 *      materno no devuelve a nadie, así no se lo puede confirmar probando.
 *   3. La ficha se pide por un código al azar; el nombre completo y el documento no salen nunca.
 *
 * Identidad: la DJI no guarda el documento, así que la persona es su nombre completo. Para juntar su rastro en otros
 * registros (visitas, RNP, aportes…), que escriben el nombre de otras formas, la regla es estricta: la fila tiene que
 * traer los dos apellidos y el primer nombre, y no traer ninguna palabra que no sea de su nombre (`mismaPersona`). Un
 * homónimo con otro segundo nombre queda fuera. Dos homónimos exactos comparten ficha, y la ficha lo dice.
 */
import { consultaConPlazo, pool } from "./db.js";
import { TAPA_NOMBRE } from "./privacidad.js";

export interface FuncionarioHallado {
  codigo: string;
  /** Con el apellido materno tapado. */
  nombre: string;
  cargo: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  /** De dónde sale ese cargo: la planilla o su declaración jurada. */
  cargoDe: "planilla" | "dji" | null;
  declaraciones: number;
  entidades: number;
  /** La fecha de su declaración más reciente. */
  ultima: string | null;
  /** Figura en la planilla del último mes de alguna entidad. */
  planillaHoy: boolean;
  /** En cuántas entidades figuró en planilla (hoy o antes). */
  planillaEntidades: number;
  /** El último mes en que figuró en una planilla (AAAA-MM). */
  planillaHasta: string | null;
}

export interface Funcionario extends FuncionarioHallado {
  /** Sólo para buscar su rastro dentro de la API: nunca va en una respuesta. */
  nombreNorm: string;
  paterno: string;
  materno: string | null;
  nombres: string;
  primera: string | null;
}

/** Como `mef_norm` de la base: mayúsculas, sin tildes (la «Ñ» pasa a «N»), sólo letras y números. */
export const normalizarNombre = (t: string) =>
  t.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Las palabras de una búsqueda por nombre: de 3 letras o más, hasta 5. Con un número (DNI, RUC), ninguna. */
export function palabrasDeBusqueda(q: string | undefined): string[] {
  if (!q || /\d/.test(q)) return [];
  return [...new Set(normalizarNombre(q).split(" ").filter((w) => w.length >= 3))].slice(0, 5);
}

/** El nombre como se publica: el apellido paterno, el materno tapado y los nombres. */
export const nombreTapado = (paterno: string, nombres: string) => [paterno, TAPA_NOMBRE, nombres].filter(Boolean).join(" ");

const COLUMNAS = `f.codigo, f.paterno, f.nombres, f.cargo, f.entidad, f.entidad_ruc AS "entidadRuc", f.cargo_de AS "cargoDe",
                  f.declaraciones, f.entidades, to_char(f.ultima, 'YYYY-MM-DD') AS ultima,
                  f.planilla_hoy AS "planillaHoy", f.planilla_entidades AS "planillaEntidades", to_char(f.planilla_hasta, 'YYYY-MM') AS "planillaHasta"`;

/** Los pares de palabras de una búsqueda («A B C» → AB, AC, BC): con dos que coincidan con lo visible, basta. */
export function paresDePalabras(palabras: string[]): string[][] {
  const pares: string[][] = [];
  for (let i = 0; i < palabras.length; i++) for (let j = i + 1; j < palabras.length; j++) pares.push([palabras[i], palabras[j]]);
  return pares;
}

/**
 * Quienes tienen cargo público y coinciden, por lo que se VE de su nombre, con lo buscado: dos palabras de la búsqueda,
 * por lo menos, tienen que ser palabras enteras de su apellido paterno o de sus nombres (índice GIN de `palabras`), y una
 * de ellas de su apellido paterno. Las demás palabras escritas ordenan (más coincidencias, primero) pero no descartan: así
 * quien escribe el nombre completo, con el apellido materno, también encuentra a la persona, y el resultado es el mismo
 * escriba el materno que escriba: no sirve para confirmarlo.
 */
export async function funcionariosPorNombreVisible(q: string | undefined, tope = 20): Promise<FuncionarioHallado[]> {
  const palabras = palabrasDeBusqueda(q);
  if (palabras.length < 2) return [];
  const pares = paresDePalabras(palabras);
  const r = await consultaConPlazo<Omit<FuncionarioHallado, "nombre"> & { paterno: string; nombres: string }>(
    `SELECT ${COLUMNAS} FROM funcionario_resumen f
      WHERE (${pares.map((_, i) => `f.palabras @> $${i + 2}::text[]`).join(" OR ")})
        AND string_to_array(f.paterno, ' ') && $1::text[]
      -- Primero quien está hoy en una planilla; después, por lo reciente y lo documentado de su cargo.
      ORDER BY (SELECT count(*) FROM unnest($1::text[]) w WHERE w = ANY (f.palabras)) DESC,
               f.planilla_hoy DESC, GREATEST(f.ultima, f.planilla_hasta) DESC NULLS LAST, f.declaraciones DESC, f.codigo
      LIMIT ${Math.max(1, Math.min(50, tope))}`, [palabras, ...pares], 6000);
  return r.rows.map(({ paterno, nombres, ...f }) => ({ ...f, nombre: nombreTapado(paterno, nombres) }));
}

/** La persona de un código de ficha, con su nombre completo para buscar su rastro (que no sale de la API). */
export async function funcionarioDeCodigo(codigo: string): Promise<Funcionario | null> {
  const r = await pool.query<Omit<Funcionario, "nombre">>(
    `SELECT ${COLUMNAS}, f.nombre_norm AS "nombreNorm", f.materno, to_char(f.primera, 'YYYY-MM-DD') AS primera
       FROM funcionario_resumen f WHERE f.codigo = $1`, [codigo]);
  const f = r.rows[0];
  return f ? { ...f, nombre: nombreTapado(f.paterno, f.nombres) } : null;
}

/** Cuántas otras personas con cargo público se VEN igual (mismo apellido paterno y mismos nombres): la ficha lo avisa. */
export async function parecidosA(f: Funcionario): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM funcionario_resumen x WHERE x.paterno = $1 AND x.nombres = $2 AND x.codigo <> $3`, [f.paterno, f.nombres, f.codigo]);
  return r.rows[0]?.n ?? 0;
}

const palabrasDe = (t: string | null | undefined) => normalizarNombre(t ?? "").split(" ").filter(Boolean);

/**
 * Las palabras que una fila de otro registro TIENE que traer para ser de esta persona: sus dos apellidos y su primer
 * nombre (sin materno: el paterno y todos los nombres). Con ellas se arma la búsqueda en cada registro.
 */
export function palabrasRequeridas(f: Pick<Funcionario, "paterno" | "materno" | "nombres">): string[] {
  const nombres = palabrasDe(f.nombres);
  const req = f.materno ? [...palabrasDe(f.paterno), ...palabrasDe(f.materno), ...nombres.slice(0, 1)] : [...palabrasDe(f.paterno), ...nombres];
  return [...new Set(req)];
}

/**
 * ¿El nombre de una fila de otro registro es el de esta persona? Trae todas las requeridas y ninguna palabra ajena a su
 * nombre completo (en cualquier orden: las visitas se anotan «nombres apellidos» o al revés).
 */
export function mismaPersona(f: Pick<Funcionario, "paterno" | "materno" | "nombres">): (nombre: string | null | undefined) => boolean {
  const propias = new Set([...palabrasDe(f.paterno), ...palabrasDe(f.materno), ...palabrasDe(f.nombres)]);
  const requeridas = palabrasRequeridas(f);
  return (nombre) => {
    const ws = palabrasDe(nombre);
    if (!ws.length) return false;
    const tiene = new Set(ws);
    return requeridas.every((w) => tiene.has(w)) && ws.every((w) => propias.has(w));
  };
}

/**
 * Lo que una fila de visitas dice que la persona representaba («en nombre de»). Se publica sólo si es una organización:
 * fuera lo que es el propio nombre de la persona o trae su apellido materno (lo diría entero).
 */
export function organizacionPublicable(f: Pick<Funcionario, "paterno" | "materno" | "nombres">): (org: string | null | undefined) => boolean {
  const materno = palabrasDe(f.materno);
  const propias = new Set([...palabrasDe(f.paterno), ...materno, ...palabrasDe(f.nombres)]);
  const paterno = palabrasDe(f.paterno);
  return (org) => {
    const ws = palabrasDe(org);
    if (ws.length < 1) return false;
    // Los dos apellidos juntos: es su nombre, con o sin algo más.
    if (materno.length && materno.every((m) => ws.includes(m)) && paterno.every((p) => ws.includes(p))) return false;
    return !ws.every((w) => propias.has(w));
  };
}
