/**
 * Entrada de Cloudflare Workers (`vigia-api`, wrangler.jsonc): la misma app que Cloud Run (src/app.ts).
 *
 * Cada pedido corre dentro de su ámbito (workers/ambito.ts): pools de Postgres propios sobre
 * Hyperdrive, abiertos al primer uso y cerrados con ctx.waitUntil cuando el pedido termina. Lo propio
 * de Workers (jose, GCS por REST, credenciales desde GCP_SA_KEY) se registra en workers/plataforma.ts.
 * Variables y secretos: CLOUDFLARE.md.
 */

import "./workers/plataforma.js";
import { app } from "./app.js";
import { atenderConAmbito } from "./workers/ambito.js";
import { conCdn } from "./workers/cdn.js";
import type { Env } from "./workers/env.js";

export default {
  fetch(request, env, ctx) {
    // Lecturas públicas desde la caché del borde (workers/cdn.ts), como Firebase Hosting delante de Cloud Run.
    return conCdn(request, ctx, () => atenderConAmbito(env, ctx, () => app.fetch(request, env, ctx)));
  },

  // Cada 10 min (wrangler.jsonc): re-asigna aportes abiertos y refresca las vistas de financiamiento.
  // Reemplaza al Cloud Scheduler `vigia-financiamiento-asignar` (pausado desde 2026-09-27): mismo
  // POST /admin/asignar, por dentro, con el mismo token de servicio.
  async scheduled(_evento, env, ctx) {
    const pedido = new Request("https://vigia-api.interno/admin/asignar", {
      method: "POST",
      headers: { "x-admin-token": env.ADMIN_TOKEN ?? "", "x-admin-actor": "cron-cloudflare" },
    });
    const r = await atenderConAmbito(env, ctx, () => app.fetch(pedido, env, ctx));
    console.log(JSON.stringify({ severity: r.ok ? "INFO" : "ERROR", message: `[cron] asignar → HTTP ${r.status}`, cuerpo: (await r.text()).slice(0, 300) }));
  },
} satisfies ExportedHandler<Env>;
