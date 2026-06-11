import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { compress } from "hono/compress";
import { serve } from "@hono/node-server";
import { ping } from "./lib/db.js";
import { alertasRouter } from "./routes/alertas.js";
import { entidadesRouter } from "./routes/entidades.js";
import { reportesRouter } from "./routes/reportes.js";
import { uploadRouter } from "./routes/upload.js";

const app = new Hono();

app.use(logger());
// gzip de las respuestas JSON. El dossier/listas pesan cientos de KB sin
// comprimir y el mapa pega a la API directo desde el browser. gzip baja ~8-10x.
app.use("*", compress());

// Lista explícita de orígenes (si está en env). Si no, política tolerante:
// localhost cualquier puerto + cualquier subdominio Cloud Run del proyecto.
const explicitOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/vigia-peru-frontend[a-z0-9-]*\.(us-central1|us-east1|europe-west1)\.run\.app$|^https:\/\/[a-z0-9-]+-oq3gq6a4ka-uc\.a\.run\.app$/;
app.use("*", cors({
  origin: (origin) => {
    if (!origin) return origin;
    if (explicitOrigins.includes(origin)) return origin;
    if (ORIGIN_REGEX.test(origin)) return origin;
    return null; // rechaza
  },
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
}));

// ─── Health ────────────────────────────────────────────────────
app.get("/", (c) => c.json({ service: "vigia-peru-api", status: "ok" }));

app.get("/health", async (c) => {
  const db = await ping();
  return c.json({ ok: db.ok, db });
});

// ─── Routers ───────────────────────────────────────────────────
app.route("/alertas", alertasRouter);
app.route("/entidades", entidadesRouter);
app.route("/reportes", reportesRouter);
app.route("/upload", uploadRouter);

// ─── Error handler ─────────────────────────────────────────────
app.onError((err, c) => {
  console.error("[unhandled]", err);
  return c.json({ error: "internal", message: err.message }, 500);
});

// ─── Server ────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`vigia-peru-api listening on :${info.port}`);
});
