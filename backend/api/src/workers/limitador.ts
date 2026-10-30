/**
 * Límite por IP exacto (lib/antibots.ts): un Durable Object por clave (tipo de límite + IP), con su ventana deslizante
 * en memoria. Un objeto atiende sus pedidos de a uno, así que la cuenta no se escapa aunque lleguen juntos.
 *
 * Reemplaza a los bindings de Rate Limiting de Workers, que cuentan en cada máquina y se sincronizan en segundo plano:
 * con la API y la web ubicadas junto a la base (placement aws:us-east-2) dejaban pasar casi todo (probado el 2026-10-30:
 * 600 pedidos en 9 s sin un 429; un Worker mínimo con tope de 5 cada 10 s dejó pasar 49 de 60).
 *
 * Si el objeto se descarta por inactividad, su cuenta vuelve a cero: da igual, la ventana es de un minuto. Las ventanas
 * largas (los topes de la tarjeta: 10 minutos y un día) piden `persistente` y guardan sus marcas en disco. El veto de la
 * trampa (frontend/worker-prod.js: la IP que pidió el enlace escondido que robots.txt prohíbe) también, porque dura una
 * hora. La web usa esta misma clase con su binding `script_name: "vigia-api"`.
 */

import { DurableObject } from "cloudflare:workers";

export type Paso = "ok" | "lleno" | "vetado";

export class Limitador extends DurableObject {
  private marcas: number[] = [];
  /** Las marcas persistentes ya se leyeron del disco. */
  private leidas = false;
  /** Hasta cuándo está vetada esta clave (ms); `undefined` = todavía no se leyó del disco. */
  private vetadoHasta: number | undefined;

  private async vigentes(ventanaMs: number, persistente: boolean): Promise<number[]> {
    if (persistente && !this.leidas) {
      this.marcas = (await this.ctx.storage.get<number[]>("marcas")) ?? [];
      this.leidas = true;
    }
    const ahora = Date.now();
    this.marcas = this.marcas.filter((t) => ahora - t < ventanaMs);
    return this.marcas;
  }

  /**
   * true si el pedido entra: hubo menos de `tope` en los últimos `ventanaMs`. `persistente`: las marcas se guardan en
   * disco (ventanas que deben sobrevivir a que el objeto se descarte).
   */
  async contar(tope: number, ventanaMs: number, persistente = false): Promise<boolean> {
    const marcas = await this.vigentes(ventanaMs, persistente);
    if (marcas.length >= tope) return false;
    marcas.push(Date.now());
    if (persistente) await this.ctx.storage.put("marcas", marcas);
    return true;
  }

  /** Cuántos hubo en los últimos `ventanaMs`, sin contar uno más (el corte general de la tarjeta). */
  async cuantas(ventanaMs: number, persistente = false): Promise<number> {
    return (await this.vigentes(ventanaMs, persistente)).length;
  }

  /** Como `contar`, pero primero mira el veto de la trampa. */
  async pasar(tope: number, ventanaMs: number): Promise<Paso> {
    if (this.vetadoHasta === undefined) this.vetadoHasta = (await this.ctx.storage.get<number>("vetadoHasta")) ?? 0;
    if (this.vetadoHasta > Date.now()) return "vetado";
    return (await this.contar(tope, ventanaMs)) ? "ok" : "lleno";
  }

  /** Veta la clave por `ms`. */
  async vetar(ms: number): Promise<void> {
    this.vetadoHasta = Date.now() + ms;
    await this.ctx.storage.put("vetadoHasta", this.vetadoHasta);
  }
}
