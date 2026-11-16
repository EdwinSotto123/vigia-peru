/**
 * Buscar a una persona natural por su nombre VISIBLE (pedido del dueño del 2026-11-16: «lo busco y parece que no tiene
 * perfil»). La lista de personas sólo buscaba por la entidad y el servicio; por nombre no había cómo llegar a una ficha
 * desde la web (el rastro por nombre entero es sólo del MCP: en la API pública permitiría confirmar un apellido tapado).
 *
 * La regla que evita esa fuga: se busca en el nombre entero (índice del primer apellido), pero un resultado SÓLO sale si
 * dos de las palabras buscadas, por lo menos, coinciden con palabras que el público ve de ese nombre, ya tapado por
 * publicar(). Las demás palabras no cuentan: quien escriba el apellido escondido (el nombre completo) recibe lo mismo que
 * quien escriba otra palabra en su lugar, así que encuentra a la persona y no puede confirmar el apellido probando.
 *
 * Fuente: persona_busqueda (migración 320), una fila por persona con las palabras de su nombre (GIN) y sus cifras sumadas;
 * preselecciona a quien trae dos de las palabras buscadas y aquí se publica sólo a quien coincide por lo que se ve. Antes
 * se leía persona_orden_anual por el primer apellido: con uno común eran 50 mil filas y 8 s en frío, que frenaban también
 * el buscador general. Esa lectura queda de respaldo si la tabla no está. Pide un apellido y un nombre como mínimo (dos
 * palabras de 3 letras o más).
 */
import { consultaConPlazo } from "./db.js";
import { publicar } from "./privacidad.js";

export interface PersonaHallada {
  codigo: string;
  /** RUC 10: publicar() lo vuelve una referencia y, por él, tapa un apellido del nombre. */
  ruc: string;
  nombre: string;
  /** De sus órdenes de servicio (0 si sólo ganó procesos). */
  ordenes: number;
  monto: number;
  entidades: number;
  /** La entidad que más le pagó o, si sólo ganó procesos, nada. */
  entidad: string | null;
  /** De los procesos de selección que ganó (0 si sólo tiene órdenes). */
  procesos: number;
  montoProcesos: number;
}

// En mayúsculas primero: «ñ» se descompone en «n» + tilde, y la «Ñ» se conserva (las demás tildes se quitan).
const sinTildes = (t: string) => t.toUpperCase().normalize("NFD").replace(/Ñ/g, "Ñ").replace(/\p{M}/gu, "");

/** Las palabras que se buscan: sin tildes ni signos, de 3 letras o más, hasta 5. Con un número (DNI, RUC), ninguna. */
export function palabrasDeNombre(q: string | undefined): string[] {
  if (!q || /\d/.test(q)) return [];
  return [...new Set(sinTildes(q).replace(/[^A-ZÑ ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3))].slice(0, 5);
}

/** Las palabras que el público VE de un nombre: se tapa como lo tapa la API y se quita lo tapado. */
export function palabrasVisibles(nombre: string): string[] {
  const tapado = publicar({ socios: [{ nombre }] }).socios[0]?.nombre ?? "";
  // Si por algo no se tapó nada (una sola palabra, no parece persona), no se da por visible ninguna.
  if (!tapado.includes("•")) return [];
  return sinTildes(tapado).split(/\s+/).filter((w) => w && !w.includes("•")).map((w) => w.replace(/[^A-ZÑ]/g, "")).filter(Boolean);
}

/** ¿Todas las palabras buscadas están (enteras o como parte) en alguna palabra visible? «Ñ» y «N» valen igual. */
export function coincideConLoVisible(palabras: string[], visibles: string[]): boolean {
  const n = (w: string) => w.replace(/Ñ/g, "N");
  const vs = visibles.map(n);
  return palabras.length > 0 && palabras.every((w) => vs.some((v) => v.includes(n(w))));
}

/** Cuántas de las palabras buscadas están (enteras o como parte) en alguna palabra visible. */
export function cuantasVisibles(palabras: string[], visibles: string[]): number {
  const n = (w: string) => w.replace(/Ñ/g, "N");
  const vs = visibles.map(n);
  return palabras.filter((w) => vs.some((v) => v.includes(n(w)))).length;
}

export async function personasPorNombreVisible(q: string | undefined, tope = 30): Promise<PersonaHallada[]> {
  const palabras = palabrasDeNombre(q);
  if (palabras.length < 2) return [];
  // En el índice las palabras van como en mef_norm: sin tildes y con la «Ñ» como «N».
  const enIndice = [...new Set(palabras.map((w) => w.replace(/Ñ/g, "N")))];
  const pares: string[][] = [];
  for (let i = 0; i < enIndice.length; i++) for (let j = i + 1; j < enIndice.length; j++) pares.push([enIndice[i], enIndice[j]]);
  try {
    const r = await consultaConPlazo<PersonaHallada>(
      `SELECT b.ruc, b.nombre, pc.codigo, b.ordenes, b.monto::float AS monto, b.entidades, b.entidad, b.procesos, b.monto_procesos::float AS "montoProcesos"
         FROM persona_busqueda b JOIN persona_codigo pc ON pc.ruc = b.ruc
        WHERE ${pares.map((_, i) => `b.palabras @> $${i + 2}::text[]`).join(" OR ")}
        ORDER BY (SELECT count(*) FROM unnest($1::text[]) w WHERE w = ANY (b.palabras)) DESC, (b.monto + b.monto_procesos) DESC, b.ruc
        LIMIT 400`, [enIndice, ...pares], 5000);
    return r.rows
      // La regla de privacidad: sólo quien coincide, en dos palabras o más, por lo que se VE. Lo demás escrito no decide.
      .map((p) => ({ p, n: cuantasVisibles(palabras, palabrasVisibles(p.nombre.replace(/(?<=\p{L})¿(?=\p{L})/gu, "Ñ"))) }))
      .filter((x) => x.n >= 2)
      .sort((a, b) => b.n - a.n || b.p.monto + b.p.montoProcesos - (a.p.monto + a.p.montoProcesos))
      .slice(0, tope)
      .map((x) => x.p);
  } catch {
    // Sin la tabla (una base sin la migración 320) o si no respondió: la lectura de antes, por el primer apellido.
    return porPrimerApellido(q, palabras, tope);
  }
}

/** La lectura anterior, de respaldo: persona_orden_anual y persona_ganadora por el primer apellido (lenta con uno común). */
async function porPrimerApellido(q: string | undefined, palabras: string[], tope: number): Promise<PersonaHallada[]> {
  // El primer apellido en la base va como lo deja mef_norm: con «Ñ» o con «N» según la fuente; se prueban las dos. Entran
  // también las partículas cortas («DE», «LA») por si el nombre empieza con una.
  const primeras = [...new Set(sinTildes(q ?? "").replace(/[^A-ZÑ ]+/g, " ").split(/\s+/).filter((w) => w.length >= 2).flatMap((w) => [w, w.replace(/Ñ/g, "N")]))];
  const pats = palabras.map((w) => `%${w.replace(/Ñ/g, "_")}%`);
  type Fila = { ruc: string; nombre: string; codigo: string; ordenes?: number; monto?: number; entidades?: number; entidad?: string | null; procesos?: number; montoProcesos?: number };
  const [ordenes, ganadores] = await Promise.all([
    consultaConPlazo<Fila>(
      `SELECT o.ruc, max(o.nombre) AS nombre, max(pc.codigo) AS codigo, sum(o.ordenes)::int AS ordenes, COALESCE(sum(o.monto), 0)::float AS monto,
              count(DISTINCT o.entidad_ruc)::int AS entidades, (array_agg(o.entidad ORDER BY o.monto DESC NULLS LAST))[1] AS entidad
         FROM persona_orden_anual o JOIN persona_codigo pc ON pc.ruc = o.ruc
        WHERE o.ap1 = ANY($1::text[]) AND (SELECT count(*) FROM unnest($2::text[]) p WHERE upper(o.nombre) LIKE p) >= 2
        GROUP BY o.ruc ORDER BY 5 DESC NULLS LAST LIMIT 150`, [primeras, pats], 8000).then((r) => r.rows).catch(() => [] as Fila[]),
    consultaConPlazo<Fila>(
      `SELECT g.ruc, g.nombre, pc.codigo, g.procesos, COALESCE(g.monto, 0)::float AS "montoProcesos"
         FROM persona_ganadora g JOIN persona_codigo pc ON pc.ruc = g.ruc
        WHERE g.ap1 = ANY($1::text[]) AND (SELECT count(*) FROM unnest($2::text[]) p WHERE upper(g.nombre) LIKE p) >= 2
        ORDER BY g.monto DESC NULLS LAST LIMIT 150`, [primeras, pats], 8000).then((r) => r.rows).catch(() => [] as Fila[]),
  ]);
  const porRuc = new Map<string, PersonaHallada>();
  for (const f of ordenes) {
    porRuc.set(f.ruc, { codigo: f.codigo, ruc: f.ruc, nombre: f.nombre, ordenes: f.ordenes ?? 0, monto: f.monto ?? 0, entidades: f.entidades ?? 0,
                         entidad: f.entidad ?? null, procesos: 0, montoProcesos: 0 });
  }
  for (const f of ganadores) {
    const p = porRuc.get(f.ruc);
    if (p) Object.assign(p, { procesos: f.procesos ?? 0, montoProcesos: f.montoProcesos ?? 0 });
    else porRuc.set(f.ruc, { codigo: f.codigo, ruc: f.ruc, nombre: f.nombre, ordenes: 0, monto: 0, entidades: 0, entidad: null, procesos: f.procesos ?? 0, montoProcesos: f.montoProcesos ?? 0 });
  }
  return [...porRuc.values()]
    // La regla de privacidad: sólo quien coincide, en dos palabras o más, por lo que se VE. Lo demás escrito no decide.
    .map((p) => ({ p, n: cuantasVisibles(palabras, palabrasVisibles(p.nombre.replace(/(?<=\p{L})¿(?=\p{L})/gu, "Ñ"))) }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n || b.p.monto + b.p.montoProcesos - (a.p.monto + a.p.montoProcesos))
    .slice(0, tope)
    .map((x) => x.p);
}
