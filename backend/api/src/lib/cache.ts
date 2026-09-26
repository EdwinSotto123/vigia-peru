/**
 * Caché en memoria de la API para lecturas que cambian despacio (conteos del mapa, facetas de la
 * lista, métricas globales, salud del sistema). Cada instancia de Cloud Run tiene la suya.
 *
 *   · TTL: dentro de `ttlMs` se devuelve lo guardado sin tocar la base. La edad se cuenta desde que
 *     EMPEZÓ la consulta (lo leído es de ese momento), no desde que terminó.
 *   · stale-while-revalidate: hasta `ttlMs + staleMs` se devuelve lo guardado AL INSTANTE y se
 *     refresca en segundo plano (nadie espera la consulta).
 *   · En vuelo: N pedidos simultáneos con la misma clave comparten UNA consulta, salvo que esa
 *     consulta lleve más de `ttlMs` (colgada): entonces se lanza otra, y la vieja, si termina, no
 *     pisa a la nueva.
 *   · Nunca guarda errores: si la consulta falla, el próximo pedido reintenta. La función también
 *     puede pedir `noGuardar()` (armó la respuesta con un respaldo tras un error): se devuelve, no se guarda.
 *   · `max` acota las claves, LRU por uso: cada acierto la mueve al final y sale primero la que
 *     hace más tiempo nadie lee. Las claves llevan los filtros del pedido; el texto libre (`q`) no
 *     tiene techo y va en una caché aparte y chica (así una ráfaga de búsquedas únicas no expulsa
 *     las páginas que todos piden).
 *
 * Respuestas JSON (fase 2, A7): `Memo<Serializado>` guarda el cuerpo YA serializado y su ETag, y
 * `responderJson` responde 304 si el `If-None-Match` del pedido coincide (antes cada acierto volvía
 * a hacer JSON.stringify y no había ETag). `responderConEtag` hace lo mismo sin caché.
 *
 * Los TTL no superan el `Cache-Control` que ya devuelve cada ruta (s-maxage + stale-while-revalidate):
 * la caché no alarga lo que un navegador o un CDN ya podían mostrar.
 *
 * Invalidación entre instancias (la API corre hasta en 3). Toda escritura del panel admin
 * (`invalidarMemosEnTodas`, ver routes/admin.ts) vacía las cachés de la instancia que la atendió y
 * sube una generación compartida en la base (`ajustes.cache_gen`). Cada instancia relee esa fila como
 * mucho cada GEN_CADA_MS (2 s), en el primer `obtener` que llega pasado ese plazo, y si cambió vacía
 * todas sus cachés. Ventana real para ver una escritura del panel:
 *   · la instancia que la atendió: al instante;
 *   · las demás: hasta ~2 s (un pedido que llega antes de que toque releer todavía puede recibir lo
 *     anterior). Esa relectura se espera como mucho GEN_ESPERA_MS; si la base tarda más, el pedido
 *     sigue con lo que hay y la instancia vacía sus cachés apenas llega la respuesta;
 *   · si la base no pudo guardar la generación (o no se puede leer), las demás se ponen al día sólo
 *     por TTL: como mucho `ttlMs + staleMs` de cada caché (2 min en las más largas).
 * Encima de eso sigue el `Cache-Control` público de cada ruta (navegador o CDN), que esto no acorta.
 *
 * En Workers cada isolate tiene su caché (sólo valores y cuerpos ya serializados, nunca sockets ni
 * clientes): la consulta corre con el pool del pedido que la lanzó y los demás esperan su resultado.
 */

import { createHash } from "node:crypto";
import type { Context } from "hono";
// Leer la generación: pool público. Subirla (escritura en ajustes) sólo lo hace el panel: poolAdmin
// (con roles por componente, el rol público no escribe ajustes; migración 37).
import { pool, poolAdmin } from "./db.js";
// Workers: el refresco en segundo plano sigue después de responder (ctx.waitUntil; en Node no hace nada).
import { enSegundoPlano } from "./plataforma.js";

interface Entrada<T> { valor: T; at: number }
interface Vuelo<T> { p: Promise<T>; t0: number }
/** Segundo argumento de la función de `obtener`: `noGuardar()` devuelve el valor sin guardarlo. */
export interface ControlMemo { noGuardar(): void }

const registro = new Set<Memo<unknown>>();

export class Memo<T> {
  private entradas = new Map<string, Entrada<T>>();
  private enVuelo = new Map<string, Vuelo<T>>();
  private generacion = 0;

  constructor(private readonly opts: { nombre: string; ttlMs: number; staleMs?: number; max?: number }) {
    registro.add(this as Memo<unknown>);
  }

  /** Valor de `clave`: guardado si está vigente, si no lo calcula `fn` (una sola vez aunque lo pidan N a la vez). */
  async obtener(clave: string, fn: (ctl: ControlMemo) => Promise<T>): Promise<T> {
    const sync = sincronizarGeneracion();
    if (sync) await sync;
    const e = this.entradas.get(clave);
    if (e) {
      // LRU por uso: la clave leída pasa al final (la que sale por `max` es la menos leída).
      this.entradas.delete(clave);
      this.entradas.set(clave, e);
      const edad = Date.now() - e.at;
      if (edad < this.opts.ttlMs) return e.valor;
      if (edad < this.opts.ttlMs + (this.opts.staleMs ?? 0)) {
        enSegundoPlano(this.calcular(clave, fn).catch((err) => console.warn(`[cache:${this.opts.nombre}] refresco en segundo plano falló: ${(err as Error).message}`)));
        return e.valor;
      }
    }
    return this.calcular(clave, fn);
  }

  /** Vacía la caché (y descarta lo que esté en vuelo: no se guarda un valor calculado antes de invalidar). */
  invalidar(): void {
    this.entradas.clear();
    this.enVuelo.clear();
    this.generacion++;
  }

  private calcular(clave: string, fn: (ctl: ControlMemo) => Promise<T>): Promise<T> {
    const previo = this.enVuelo.get(clave);
    // Una consulta en vuelo hace más de un TTL (colgada) ya no se comparte: lo que trajera nacería vencido.
    if (previo && Date.now() - previo.t0 < this.opts.ttlMs) return previo.p;
    const gen = this.generacion;
    const t0 = Date.now();
    let guardar = true;
    const p = fn({ noGuardar: () => { guardar = false; } }).then((valor) => {
      if (guardar && gen === this.generacion) this.guardar(clave, valor, t0);
      return valor;
    }).finally(() => {
      if (this.enVuelo.get(clave)?.p === p) this.enVuelo.delete(clave);
    });
    this.enVuelo.set(clave, { p, t0 });
    return p;
  }

  private guardar(clave: string, valor: T, at: number): void {
    // Una consulta que empezó antes que la guardada (la colgada que se reemplazó) no la pisa.
    const actual = this.entradas.get(clave);
    if (actual && actual.at > at) return;
    this.entradas.delete(clave); // re-inserta al final: las que salen por `max` son las menos usadas
    this.entradas.set(clave, { valor, at });
    const max = this.opts.max ?? 1;
    while (this.entradas.size > max) {
      const primera = this.entradas.keys().next().value;
      if (primera === undefined) break;
      this.entradas.delete(primera);
    }
  }
}

/** Vacía todas las cachés `Memo` de ESTA instancia. */
export function invalidarMemos(): void {
  for (const m of registro) m.invalidar();
}

// ─── Generación compartida entre instancias (ajustes.cache_gen) ─────────────
const GEN_CADA_MS = 2_000;    // cada cuánto una instancia relee la generación
const GEN_ESPERA_MS = 250;    // lo más que los pedidos esperan esa relectura (contado desde que se lanzó)
const AVISO_ESPERA_MS = 1_000; // lo más que una escritura del panel espera a subir la generación

const LEER_GEN_SQL = `SELECT valor::text AS v FROM ajustes WHERE clave = 'cache_gen'`;
// Marca de tiempo de la base (clock_timestamp, µs): cambia en cada escritura y no depende del valor anterior.
const SUBIR_GEN_SQL = `INSERT INTO ajustes (clave, valor) VALUES ('cache_gen', to_jsonb(extract(epoch from clock_timestamp())))
  ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`;

let genVista: string | null | undefined; // undefined = todavía no leída en esta instancia
let genLanzadaAt = 0;
let genEnVuelo: Promise<void> | null = null;

/** Espera `p` como mucho `ms` (nunca rechaza). */
function aTiempo(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    p.then(() => { clearTimeout(t); resolve(); }, () => { clearTimeout(t); resolve(); });
  });
}

/**
 * Relee la generación compartida si pasaron GEN_CADA_MS desde la última lectura (una sola en vuelo)
 * y, si cambió, vacía las cachés de la instancia. Devuelve qué esperar (acotado a GEN_ESPERA_MS
 * desde que se lanzó la lectura) o null si no hay nada que esperar. Un error de la base no corta el
 * pedido: se sigue con lo local y se reintenta pasado el plazo.
 */
function sincronizarGeneracion(): Promise<void> | null {
  const ahora = Date.now();
  if (!genEnVuelo) {
    if (ahora - genLanzadaAt < GEN_CADA_MS) return null;
    genLanzadaAt = ahora;
    genEnVuelo = pool.query<{ v: string }>(LEER_GEN_SQL)
      .then((r) => {
        const v = r.rows[0]?.v ?? null;
        // La primera lectura también vacía: lo calculado antes de conocer la generación puede ser anterior a ella.
        if (v !== genVista) invalidarMemos();
        genVista = v;
      }, (e) => {
        console.warn(`[cache] no se pudo leer la generación compartida: ${(e as Error).message}`);
      })
      .finally(() => { genEnVuelo = null; });
  }
  const resta = GEN_ESPERA_MS - (ahora - genLanzadaAt);
  return resta > 0 ? aTiempo(genEnVuelo, resta) : null;
}

/**
 * Tras una escritura del panel admin: vacía las cachés de esta instancia y sube la generación
 * compartida para que las demás vacíen las suyas. Nunca tira: si la base falla, se avisa en el log
 * (las demás instancias se ponen al día por TTL); si tarda más de AVISO_ESPERA_MS, termina sola.
 */
export async function invalidarMemosEnTodas(): Promise<void> {
  invalidarMemos();
  const p = poolAdmin.query(SUBIR_GEN_SQL).catch((e) => {
    console.warn(`[cache] no se pudo subir la generación compartida: ${(e as Error).message}`);
  });
  await aTiempo(p, AVISO_ESPERA_MS);
}

// ─── Respuestas JSON con ETag (fase 2) ──────────────────────────────────────

/** Cuerpo JSON ya serializado y su ETag débil (sha1 del cuerpo). */
export interface Serializado { cuerpo: string; etag: string }

export const etagDe = (cuerpo: string) => `W/"${createHash("sha1").update(cuerpo).digest("base64url")}"`;

export function serializar(valor: unknown): Serializado {
  const cuerpo = JSON.stringify(valor);
  return { cuerpo, etag: etagDe(cuerpo) };
}

/** ¿El `If-None-Match` del pedido nombra este ETag? Comparación débil (RFC 9110 §13.1.2), acepta listas y `*`. */
export function coincideEtag(c: Context, etag: string): boolean {
  const inm = c.req.header("if-none-match");
  if (!inm) return false;
  if (inm.trim() === "*") return true;
  const sinW = (t: string) => t.trim().replace(/^W\//, "");
  const buscado = sinW(etag);
  return inm.split(",").some((t) => sinW(t) === buscado);
}

/** Responde un cuerpo serializado con su ETag y `Cache-Control`; 304 sin cuerpo si el pedido ya lo tiene. */
export function responderSerializado(c: Context, s: Serializado, cacheControl: string): Response {
  c.header("Cache-Control", cacheControl);
  c.header("ETag", s.etag);
  if (coincideEtag(c, s.etag)) {
    const r = c.body(null, 304);
    r.headers.delete("Content-Type"); // un 304 no lleva cuerpo ni tipo
    return r;
  }
  c.header("Content-Type", "application/json; charset=UTF-8");
  return c.body(s.cuerpo, 200);
}

/**
 * Respuesta JSON desde una caché de cuerpos serializados: `fn` arma el valor sólo si `clave` no
 * está vigente en `memo`; el acierto ya no se vuelve a serializar. 304 ante `If-None-Match`.
 */
export async function responderJson(
  c: Context, memo: Memo<Serializado>, clave: string, fn: (ctl: ControlMemo) => Promise<unknown>, cacheControl: string,
): Promise<Response> {
  const s = await memo.obtener(clave, async (ctl) => serializar(await fn(ctl)));
  return responderSerializado(c, s, cacheControl);
}

/** Como `responderJson`, sin caché: serializa, pone el ETag y responde 304 si corresponde. */
export function responderConEtag(c: Context, valor: unknown, cacheControl: string): Response {
  return responderSerializado(c, serializar(valor), cacheControl);
}
