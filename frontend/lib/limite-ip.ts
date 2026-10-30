/**
 * Límite de pedidos por IP. Sólo servidor.
 *
 *  - Cloudflare Workers: el Durable Object `Limitador` de la API (binding LIMITADOR, el mismo del freno de páginas de
 *    worker-comun.js), exacto entre todas las máquinas, con una IPv6 por su /64. El binding de Rate Limiting
 *    (`ratelimits` de wrangler.jsonc) queda de respaldo: con la web ubicada en us-east-2 (placement) deja pasar casi todo
 *    (probado el 2026-10-30) y no dice cuánto falta, así que se pide esperar el periodo entero.
 *  - Cloud Run y `next dev`: una ventana fija en memoria de cada instancia. Con varias
 *    instancias el tope real es N veces el límite: frena ráfagas, no es un cupo exacto.
 *
 * La IP: `cf-connecting-ip` (la pone Cloudflare) o el primer `x-forwarded-for` (Cloud Run).
 */
import "server-only";
import { bindingCloudflare } from "./entorno";

interface LimitadorCloudflare {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}
interface NamespaceLimitador {
  idFromName(nombre: string): unknown;
  get(id: unknown): { pasar(tope: number, ventanaMs: number): Promise<"ok" | "lleno" | "vetado"> };
}

/** Una IPv4 entera; una IPv6 por su /64, que el proveedor le da entero a cada cliente (como la API, lib/antibots.ts). */
function claveIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const antes = cabeza ? cabeza.split(":") : [];
  const despues = ip.includes("::") && cola ? cola.split(":") : [];
  const grupos = ip.includes("::") ? [...antes, ...Array<string>(Math.max(0, 8 - antes.length - despues.length)).fill("0"), ...despues] : antes;
  return `${grupos.slice(0, 4).join(":")}::/64`;
}

export interface Limite {
  /** Nombre del binding en wrangler.jsonc. */
  binding: string;
  /** Pedidos permitidos por periodo. Debe coincidir con `simple.limit` del binding. */
  limite: number;
  /** Segundos. Debe coincidir con `simple.period` del binding (Cloudflare sólo admite 10 o 60). */
  periodoS: number;
}

export type ResultadoLimite = { ok: true } | { ok: false; reintentarEn: number };

export function ipDelPedido(h: Headers): string | null {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || null;
}

/** Ventanas en memoria, por límite y por IP: inicio de la ventana y pedidos contados. */
const ventanas = new Map<string, { desde: number; n: number }>();
/** Con más claves que esto se barren las vencidas (una IP por clave: no crece sin tope). */
const MAX_CLAVES = 10_000;

function enMemoria(clave: string, l: Limite): ResultadoLimite {
  const ahora = Date.now();
  const periodoMs = l.periodoS * 1000;
  if (ventanas.size > MAX_CLAVES) {
    for (const [k, v] of ventanas) if (ahora - v.desde >= periodoMs) ventanas.delete(k);
  }
  const v = ventanas.get(clave);
  if (!v || ahora - v.desde >= periodoMs) {
    ventanas.set(clave, { desde: ahora, n: 1 });
    return { ok: true };
  }
  if (v.n >= l.limite) return { ok: false, reintentarEn: Math.max(1, Math.ceil((v.desde + periodoMs - ahora) / 1000)) };
  v.n += 1;
  return { ok: true };
}

export async function limitarPorIp(ip: string | null, l: Limite): Promise<ResultadoLimite> {
  // Sin IP (no debería pasar detrás de Cloudflare ni de Cloud Run) todos comparten una cuenta.
  const clave = `${l.binding}:${ip ?? "sin-ip"}`;
  const objetos = bindingCloudflare<NamespaceLimitador>("LIMITADOR");
  if (objetos) {
    try {
      const paso = await objetos.get(objetos.idFromName(`${l.binding}|${claveIp(ip ?? "sin-ip")}`)).pasar(l.limite, l.periodoS * 1000);
      return paso === "ok" ? { ok: true } : { ok: false, reintentarEn: l.periodoS };
    } catch (e) {
      console.error("[limite-ip] Durable Object", (e as Error).message);
    }
  }
  const cf = bindingCloudflare<LimitadorCloudflare>(l.binding);
  if (cf) {
    try {
      const { success } = await cf.limit({ key: clave });
      return success ? { ok: true } : { ok: false, reintentarEn: l.periodoS };
    } catch (e) {
      // El limitador de Cloudflare no respondió: se sigue con el de memoria, no se corta el sitio.
      console.error("[limite-ip]", (e as Error).message);
    }
  }
  return enMemoria(clave, l);
}
