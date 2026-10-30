/**
 * Límite por IP exacto (lib/antibots.ts): un Durable Object por clave (tipo de límite + IP), con su ventana deslizante
 * en memoria. Un objeto atiende sus pedidos de a uno, así que la cuenta no se escapa aunque lleguen juntos.
 *
 * Reemplaza a los bindings de Rate Limiting de Workers, que cuentan en cada máquina y se sincronizan en segundo plano:
 * con la API y la web ubicadas junto a la base (placement aws:us-east-2) dejaban pasar casi todo (probado el 2026-10-30:
 * 600 pedidos en 9 s sin un 429; un Worker mínimo con tope de 5 cada 10 s dejó pasar 49 de 60).
 *
 * Si el objeto se descarta por inactividad, su cuenta vuelve a cero: da igual, la ventana es de un minuto. No guarda
 * nada en disco. La web (frontend/worker-prod.js) usa esta misma clase con su binding `script_name: "vigia-api"`.
 */

import { DurableObject } from "cloudflare:workers";

export class Limitador extends DurableObject {
  private marcas: number[] = [];

  /** true si el pedido entra: hubo menos de `tope` en los últimos `ventanaMs`. */
  async contar(tope: number, ventanaMs: number): Promise<boolean> {
    const ahora = Date.now();
    this.marcas = this.marcas.filter((t) => ahora - t < ventanaMs);
    if (this.marcas.length >= tope) return false;
    this.marcas.push(ahora);
    return true;
  }
}
