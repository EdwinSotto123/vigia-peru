/**
 * Vigía Perú · dispatcher en Cloudflare Workers: réplica de backend/dispatcher (Cloud Run Job
 * `vigia-dispatcher` + Cloud Scheduler cada 5 min), que sigue igual. Ver README.md.
 *
 *   cron (`*\/5 * * * *`, apagado por defecto) → una corrida si DISPATCHER_ACTIVO=1
 *   POST /ejecutar          → una corrida ahora (Bearer DISPATCHER_TOKEN)
 *   GET  /simular[?n=&tokens=1] → corrida en seco: no reclama ni escribe nada (Bearer DISPATCHER_TOKEN)
 *   GET  /instancias/:id    → estado de un Workflow de la corrida (Bearer DISPATCHER_TOKEN)
 *   GET  /salud             → {ok, activo}
 */

import { autorizado } from "./auth.ts";
import { ejecutarCiclo, simular } from "./ciclo.ts";
import { leerConfig } from "./config.ts";
import type { Env } from "./config.ts";
import { registrar } from "./registro.ts";

export { ProcesarContratos } from "./workflow.ts";

const json = (datos: unknown, status = 200) =>
  new Response(JSON.stringify(datos, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

async function atender(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  if (ruta === "/salud" && req.method === "GET") {
    let activo = false;
    try {
      activo = leerConfig(env).activo;
    } catch {
      return json({ ok: false, error: "configuración inválida" }, 500);
    }
    return json({ ok: true, activo });
  }
  const conocida = ruta === "/ejecutar" || ruta === "/simular" || ruta.startsWith("/instancias/");
  if (!conocida) return json({ error: "no encontrado" }, 404);
  if (!(await autorizado(req, env.DISPATCHER_TOKEN))) return json({ error: "no autorizado" }, 401);

  if (ruta === "/ejecutar") {
    if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
    const r = await ejecutarCiclo(env, "manual");
    return json(r, r.ok ? 200 : 503);
  }
  if (ruta === "/simular") {
    if (req.method !== "GET") return json({ error: "método no permitido" }, 405);
    const n = url.searchParams.get("n");
    return json(await simular(env, { n: n ? Number(n) : undefined, tokens: url.searchParams.get("tokens") === "1" }));
  }
  if (req.method !== "GET") return json({ error: "método no permitido" }, 405);
  const id = decodeURIComponent(ruta.slice("/instancias/".length));
  try {
    const instancia = await env.PROCESAR.get(id);
    return json({ id, ...(await instancia.status()) });
  } catch (e) {
    return json({ id, error: String((e as Error)?.message ?? e) }, 404);
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    try {
      return await atender(req, env);
    } catch (e) {
      registrar("ERROR", `pedido falló: ${String((e as Error)?.stack ?? e)}`);
      return json({ error: "interno", detalle: String((e as Error)?.message ?? e) }, 500);
    }
  },

  async scheduled(controlador, env, ctx): Promise<void> {
    // Doble llave mientras corra el job de Cloud Run: sin cron en wrangler.jsonc no se llega acá, y
    // aunque se agregue, no reclama nada sin DISPATCHER_ACTIVO=1.
    if (!leerConfig(env).activo) {
      registrar("INFO", `cron ${controlador.cron}: DISPATCHER_ACTIVO≠1, no se reclama nada`);
      return;
    }
    ctx.waitUntil(ejecutarCiclo(env, `cron ${controlador.cron}`).then(
      (r) => { if (!r.ok) registrar("ERROR", `corrida del cron falló: ${r.error}`); },
      (e) => registrar("ERROR", `corrida del cron falló: ${String((e as Error)?.stack ?? e)}`),
    ));
  },
} satisfies ExportedHandler<Env>;
