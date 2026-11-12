/**
 * Cortesía con cada sitio: como mucho un pedido por segundo a cada dominio, sumando todas las investigaciones que
 * corran a la vez. Un Durable Object por dominio reparte los turnos: devuelve cuánto esperar y reserva el siguiente.
 */
import { DurableObject } from "cloudflare:workers";

export const INTERVALO_MS = 1100;

export class Turnos extends DurableObject {
  private siguiente = 0;

  /** Cuántos ms debe esperar quien pide; el turno ya queda reservado. */
  async turno(): Promise<number> {
    const ahora = Date.now();
    const toca = Math.max(ahora, this.siguiente);
    this.siguiente = toca + INTERVALO_MS;
    return toca - ahora;
  }
}

export interface EnvTurnos {
  TURNOS: DurableObjectNamespace<Turnos>;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera su turno para ese dominio (www. y sin www. son el mismo sitio). */
export async function esperarTurno(env: EnvTurnos, dominio: string): Promise<void> {
  const id = env.TURNOS.idFromName(dominio.replace(/^www\./, ""));
  const ms = await env.TURNOS.get(id).turno();
  if (ms > 0) await dormir(Math.min(ms, 30_000));
}
