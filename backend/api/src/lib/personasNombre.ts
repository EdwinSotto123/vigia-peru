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
 * Fuente: persona_busqueda (migraciones 320 y 321), una fila por persona con su primer apellido, las palabras de su nombre
 * (GIN) y sus cifras sumadas. Por cada par ordenado de palabras buscadas (a, b) se piden las personas cuyo primer apellido
 * es `a` y que traen `b`, las de mayor monto primero, y una persona se publica sólo si `a` y `b` están, enteras, entre lo
 * que se ve de su nombre. Que alguien salga depende de esas dos palabras y de nada más de lo escrito: ni el corte de cada
 * lista ni el orden miran el apellido tapado. (Antes se leía persona_orden_anual por el primer apellido: con uno común eran
 * 50 mil filas y 8 s en frío, que frenaban también el buscador general.) Pide un apellido y un nombre como mínimo.
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

/** Cuántas personas se piden por cada par (primer apellido, otra palabra): las de mayor monto. */
const POR_PAR = 80;

export async function personasPorNombreVisible(q: string | undefined, tope = 30): Promise<PersonaHallada[]> {
  const palabras = palabrasDeNombre(q);
  if (palabras.length < 2) return [];
  // En el índice las palabras van como en mef_norm: sin tildes y con la «Ñ» como «N».
  const sinEnie = (w: string) => w.replace(/Ñ/g, "N");
  const enIndice = [...new Set(palabras.map(sinEnie))];
  const as: string[] = [];
  const bs: string[] = [];
  for (const a of enIndice) for (const b of enIndice) if (a !== b) { as.push(a); bs.push(b); }
  if (!as.length) return [];
  const r = await consultaConPlazo<PersonaHallada & { a: string; b: string }>(
    `SELECT x.a, x.b, c.ruc, c.nombre, pc.codigo, c.ordenes, c.monto, c.entidades, c.entidad, c.procesos, c."montoProcesos"
       FROM unnest($1::text[], $2::text[]) AS x(a, b)
      CROSS JOIN LATERAL (
        SELECT p.ruc, p.nombre, p.ordenes, p.monto::float AS monto, p.entidades, p.entidad, p.procesos, p.monto_procesos::float AS "montoProcesos"
          FROM persona_busqueda p
         WHERE p.ap1 = x.a AND p.palabras @> ARRAY[x.b]
         ORDER BY (p.monto + p.monto_procesos) DESC, p.ruc LIMIT ${POR_PAR}) c
       JOIN persona_codigo pc ON pc.ruc = c.ruc`, [as, bs], 5000).then((x) => x.rows).catch(() => null);
  // Sin respuesta (o una base sin las migraciones 320 y 321): no se inventa nada.
  if (!r) return [];
  const halladas = new Map<string, { p: PersonaHallada; n: number }>();
  for (const { a, b, ...p } of r) {
    if (halladas.has(p.ruc)) continue;
    const visibles = palabrasVisibles(p.nombre.replace(/(?<=\p{L})¿(?=\p{L})/gu, "Ñ"));
    // La regla de privacidad: las DOS palabras del par, enteras, entre lo que se ve. Una que sólo coincide con el apellido
    // tapado no cuenta, y tampoco una que es parte de otra palabra («LEON» dentro de «LEONARDO»).
    const seVe = new Set(visibles.map(sinEnie));
    if (!seVe.has(a) || !seVe.has(b)) continue;
    halladas.set(p.ruc, { p, n: cuantasVisibles(palabras, visibles) });
  }
  return [...halladas.values()]
    .sort((x, y) => y.n - x.n || y.p.monto + y.p.montoProcesos - (x.p.monto + x.p.montoProcesos))
    .slice(0, tope)
    .map((x) => x.p);
}
