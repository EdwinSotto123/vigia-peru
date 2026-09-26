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
import type { Env } from "./workers/env.js";

export default {
  fetch(request, env, ctx) {
    return atenderConAmbito(env, ctx, () => app.fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;
