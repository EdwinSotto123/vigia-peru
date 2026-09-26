/**
 * Entrada de Cloud Run (Node): la app de src/app.ts servida con @hono/node-server. Lo propio de Node
 * (firebase-admin, @google-cloud/storage, servidor de metadatos) se registra en node/plataforma.ts
 * antes de cargar la app.
 */

import "./node/plataforma.js";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { cerrarPools } from "./lib/db.js";
import { registrar } from "./lib/registro.js";

// ─── Server ────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 8080);
const server = serve({ fetch: app.fetch, port }, (info) => {
  registrar("INFO", `vigia-peru-api escuchando en :${info.port}`);
});

// Cierre ordenado: Cloud Run manda SIGTERM y da 10 s. Se deja de aceptar conexiones, se esperan los
// pedidos en curso y se cierran los pools; a los 9 s se sale igual.
let cerrando = false;
function cerrar(senal: string) {
  if (cerrando) return;
  cerrando = true;
  registrar("INFO", `${senal}: cerrando el servidor y los pools`);
  setTimeout(() => process.exit(0), 9_000).unref();
  server.close(() => { void cerrarPools().finally(() => process.exit(0)); });
}
process.on("SIGTERM", () => cerrar("SIGTERM"));
process.on("SIGINT", () => cerrar("SIGINT"));
