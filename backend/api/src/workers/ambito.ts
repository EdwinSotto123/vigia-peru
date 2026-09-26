/**
 * Ámbito de un pedido en Workers (lib/plataforma.ts, `ambitoPedido`). Un socket abierto en un pedido
 * no se puede usar desde otro, así que cada pedido tiene lo suyo:
 *
 *   · Pools de Postgres por rol, abiertos al primer `pool.query`/`pool.connect` (lib/db.ts) sobre
 *     `HYPERDRIVE` o `HYPERDRIVE_ADMIN`. Un pedido que no consulta no abre ninguno.
 *   · Cierre: cada pool registra con ctx.waitUntil una tarea que, cuando el pedido ya respondió,
 *     espera lo que sigue en segundo plano (`enSegundoPlano`) y las consultas sueltas en curso, y
 *     recién entonces hace `end()`. Con tope: waitUntil da 30 s después de la respuesta.
 *   · Lo que sigue tras responder también va a ctx.waitUntil aunque el pedido no haya abierto pools
 *     (p. ej. los sondeos de salud, que sólo hacen fetch).
 *
 * Una consulta que llega después de cerrado el pool de su rol abre otro (con su propio cierre).
 */

import pg from "pg";
import { configPorPedido } from "../lib/db.js";
import { ambitoPedido, type AmbitoPedido, type RolDb } from "../lib/plataforma.js";
import { registrar } from "../lib/registro.js";
import type { Env } from "./env.js";

const TOPE_TRAS_RESPUESTA_MS = 25_000;
const PASO_MS = 25;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ocupado = (p: pg.Pool) => p.waitingCount > 0 || p.idleCount < p.totalCount;
const nada = () => {};

class Ambito implements AmbitoPedido {
  private readonly pools = new Map<RolDb, pg.Pool>();
  private readonly tareas = new Set<Promise<unknown>>();
  private terminar: () => void = nada;
  private readonly respondido = new Promise<void>((r) => { this.terminar = r; });

  constructor(private readonly env: Env, private readonly ctx: ExecutionContext) {}

  pool(rol: RolDb): pg.Pool {
    let p = this.pools.get(rol);
    if (!p) {
      const hyperdrive = rol === "api" ? this.env.HYPERDRIVE : this.env.HYPERDRIVE_ADMIN;
      if (!hyperdrive?.connectionString) throw new Error(`[db] falta el binding ${rol === "api" ? "HYPERDRIVE" : "HYPERDRIVE_ADMIN"}`);
      const nuevo = new pg.Pool(configPorPedido(hyperdrive.connectionString, rol));
      nuevo.on("error", (err) => registrar("ERROR", `[db] error del pool ${rol} del pedido: ${err.message}`));
      this.pools.set(rol, nuevo);
      this.ctx.waitUntil(this.cerrar(rol, nuevo));
      p = nuevo;
    }
    return p;
  }

  seguir(p: Promise<unknown>): void {
    const t = p.then(nada, nada);
    this.tareas.add(t);
    void t.then(() => this.tareas.delete(t));
    this.ctx.waitUntil(t);
  }

  /** El handler ya devolvió la respuesta (o tiró). */
  fin(): void {
    this.terminar();
  }

  private async cerrar(rol: RolDb, p: pg.Pool): Promise<void> {
    await this.respondido;
    const limite = Date.now() + TOPE_TRAS_RESPUESTA_MS;
    while (Date.now() < limite && (this.tareas.size > 0 || ocupado(p))) await dormir(PASO_MS);
    if (this.pools.get(rol) === p) this.pools.delete(rol);
    // `end()` espera a los clientes todavía prestados; pasado el tope se abandona (el socket muere con el pedido).
    await Promise.race([p.end().catch(nada), dormir(Math.max(0, limite - Date.now()))]);
  }
}

/** Corre `fn` (el fetch de la app) dentro del ámbito de un pedido nuevo. */
export async function atenderConAmbito(env: Env, ctx: ExecutionContext, fn: () => Response | Promise<Response>): Promise<Response> {
  const ambito = new Ambito(env, ctx);
  try {
    return await ambitoPedido.run(ambito, fn);
  } finally {
    ambito.fin();
  }
}
