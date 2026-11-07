/**
 * Un informe del chat de investigación (lib/chatInvestigacion.ts) corriendo en su propio Durable Object, uno por informe
 * (idFromName del id del informe). Así sigue aunque se cierre la pestaña: la ruta (routes/admin_chat.ts) lo inicia y se
 * suscribe a sus eventos, y si quien mira se va, sólo se pierde esa suscripción.
 *
 *   iniciar   guarda el pedido y pone una alarma para ya: la alarma es la que corre el chat (no depende de que alguien
 *             siga conectado). Un informe tarda de segundos a ~5 minutos.
 *   suscribir los eventos desde el número `desde` y, si sigue corriendo, los que vayan llegando (NDJSON). null si este
 *             objeto ya no los tiene en memoria (terminó y se descartó): entonces están en la base.
 *   parar     «Detener»: corta la llamada al modelo en curso y no empieza otra vuelta.
 *
 * Al terminar guarda todo en admin_chat_informe (migración 261) por HYPERDRIVE_ADMIN y deja marcado en su disco que ya
 * terminó. Si la alarma se reintenta porque el objeto murió a mitad de camino (un despliegue, un reinicio), no vuelve a
 * preguntar (costaría otra vez y el equipo ya esperó): guarda el informe como cortado con lo que alcanzó a llegar.
 */

import { DurableObject } from "cloudflare:workers";
import pg from "pg";
import { correrChat, type PedidoChat } from "../lib/chatInvestigacion.js";
import { configPorPedido } from "../lib/db.js";
import type { Env } from "./env.js";

type Evento = Record<string, unknown>;
type Pedido = PedidoChat & { informe: string };

const codificar = new TextEncoder();
const linea = (e: Evento) => codificar.encode(`${JSON.stringify(e)}\n`);

export class ChatInforme extends DurableObject<Env> {
  private eventos: Evento[] = [];
  private suscriptores = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private terminado = false;
  private control: AbortController | null = null;

  async iniciar(pedido: Pedido): Promise<void> {
    await this.ctx.storage.put({ pedido, estado: "pendiente" });
    await this.ctx.storage.setAlarm(Date.now());
  }

  async suscribir(desde = 0): Promise<ReadableStream<Uint8Array> | null> {
    // Sin nada en memoria: o terminó y se descartó (está en la base) o nunca recibió un pedido. Sólo se espera si hay uno
    // pendiente o corriendo.
    if (!this.eventos.length && !this.control) {
      const estado = await this.ctx.storage.get<string>("estado");
      if (estado !== "pendiente" && estado !== "corriendo") return null;
    }
    let propio: ReadableStreamDefaultController<Uint8Array> | null = null;
    return new ReadableStream<Uint8Array>({
      start: (c) => {
        for (const e of this.eventos.slice(Math.max(0, desde))) c.enqueue(linea(e));
        if (this.terminado) c.close();
        else {
          propio = c;
          this.suscriptores.add(c);
        }
      },
      cancel: () => {
        if (propio) this.suscriptores.delete(propio);
      },
    });
  }

  async parar(): Promise<boolean> {
    if (!this.control) return false;
    this.control.abort();
    return true;
  }

  async alarm(): Promise<void> {
    const estado = await this.ctx.storage.get<string>("estado");
    const pedido = await this.ctx.storage.get<Pedido>("pedido");
    if (!pedido || estado === "terminado") return;
    if (estado === "corriendo") {
      // Un reintento de la alarma: la vuelta anterior murió sin terminar.
      this.emitir({ tipo: "error", mensaje: "La respuesta se cortó en el servidor antes de terminar (un reinicio). Vuelve a preguntar." });
      await this.cerrar(pedido, "cortado");
      return;
    }
    await this.ctx.storage.put("estado", "corriendo");
    this.control = new AbortController();
    await correrChat(this.env, pedido, (e) => this.emitir(e), this.control.signal);
    await this.cerrar(pedido, this.control.signal.aborted ? "detenido" : null);
  }

  private emitir(e: Evento): void {
    this.eventos.push(e);
    const l = linea(e);
    for (const c of this.suscriptores) {
      try {
        c.enqueue(l);
      } catch {
        this.suscriptores.delete(c);
      }
    }
  }

  /** Guarda el informe en la base, marca el objeto como terminado y cierra las suscripciones. */
  private async cerrar(pedido: Pedido, forzado: "detenido" | "cortado" | null): Promise<void> {
    const respuesta = this.eventos.findLast((e) => e.tipo === "respuesta");
    const error = this.eventos.findLast((e) => e.tipo === "error");
    const estado = forzado ?? (respuesta ? "listo" : "error");
    try {
      await guardar(this.env, pedido.informe, {
        estado,
        modelo: (this.eventos.find((e) => e.tipo === "inicio")?.modelo as string | undefined) ?? null,
        texto: (respuesta?.texto as string | undefined) ?? null,
        eventos: this.eventos,
        revision: this.eventos.findLast((e) => e.tipo === "revision") ?? null,
        fin: this.eventos.findLast((e) => e.tipo === "fin") ?? null,
        error: (error?.mensaje as string | undefined) ?? null,
      });
    } catch (e) {
      console.error(JSON.stringify({ chat: "guardar_error", informe: pedido.informe, error: String((e as Error)?.message ?? e).slice(0, 300) }));
    }
    // El pedido ya no hace falta: sólo queda la marca, para que una alarma repetida no vuelva a correrlo.
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put("estado", "terminado");
    this.terminado = true;
    this.control = null;
    for (const c of this.suscriptores) {
      try {
        c.close();
      } catch {
        /* ya cerrada */
      }
    }
    this.suscriptores.clear();
  }
}

async function guardar(env: Env, id: string, d: Record<string, unknown>): Promise<void> {
  const cadena = env.HYPERDRIVE_ADMIN?.connectionString;
  if (!cadena) throw new Error("falta HYPERDRIVE_ADMIN");
  const cliente = new pg.Client(configPorPedido(cadena, "admin"));
  await cliente.connect();
  try {
    await cliente.query(
      `UPDATE admin_chat_informe
          SET estado = $2, modelo = coalesce($3, modelo), texto = $4, eventos = $5::jsonb, revision = $6::jsonb, fin = $7::jsonb,
              error = $8, actualizado = now()
        WHERE id = $1`,
      [id, d.estado, d.modelo, d.texto, JSON.stringify(d.eventos), d.revision ? JSON.stringify(d.revision) : null,
        d.fin ? JSON.stringify(d.fin) : null, d.error],
    );
  } finally {
    await cliente.end().catch(() => undefined);
  }
}
