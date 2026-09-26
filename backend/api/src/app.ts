/**
 * La app Hono de la API, sin servidor: la usan las dos entradas.
 *   · `src/index.ts`  Cloud Run (Node): @hono/node-server + cierre ordenado con SIGTERM.
 *   · `src/worker.ts` Cloudflare Workers: `fetch` con un ámbito por pedido (pools sobre Hyperdrive).
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { bodyLimit } from "hono/body-limit";
import { ping } from "./lib/db.js";
import { SIN_CACHE } from "./lib/http.js";
import { EN_WORKERS } from "./lib/plataforma.js";
import { errorInterno, registroPedidos } from "./lib/registro.js";
import { alertasRouter } from "./routes/alertas.js";
import { entidadesRouter } from "./routes/entidades.js";
import { reportesRouter } from "./routes/reportes.js";
import { uploadRouter } from "./routes/upload.js";
import { financiamientoRouter } from "./routes/financiamiento.js";
import { contribucionesRouter } from "./routes/contribuciones.js";
import { procesamientosRouter } from "./routes/procesamientos.js";
import { adminRouter } from "./routes/admin.js";
import { contratosRouter } from "./routes/contratos.js";
import { cuentasRouter } from "./routes/cuentas.js";
import { buscarRouter } from "./routes/buscar.js";
import { senalesRouter } from "./routes/senales.js";

export const app = new Hono();

// Una línea JSON por pedido (severity, httpRequest, traza, requestId): lib/registro.ts.
app.use("*", registroPedidos);

// La respuesta cambia según Accept-Encoding (gzip o no): el CDN de Firebase Hosting tiene que
// guardar las dos variantes por separado. Corre después de compress() (se registra antes).
// `nosniff` en todo (auditoría M16): el navegador nunca reinterpreta el tipo de una respuesta.
app.use("*", async (c, next) => {
  await next();
  try {
    const vary = c.res.headers.get("Vary");
    if (!vary || !/accept-encoding/i.test(vary)) c.res.headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  } catch { /* cabeceras inmutables: se deja como está */ }
});

// gzip de las respuestas JSON. El dossier/listas pesan cientos de KB sin
// comprimir y el mapa pega a la API directo desde el browser. gzip baja ~8-10x.
// En Workers no: Cloudflare ya comprime en el borde (gzip/brotli según Accept-Encoding) y, con
// Content-Encoding puesto a mano, el runtime volvería a codificar el cuerpo; además comprimir acá
// gastaría CPU del pedido, que en Workers es el recurso con tope.
if (!EN_WORKERS) app.use("*", compress());

// Lista explícita de orígenes (si está en env) + Firebase Hosting (sitio y canales de vista previa).
// Si no, política tolerante: localhost cualquier puerto + cualquier subdominio Cloud Run del proyecto.
const explicitOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ORIGENES_HOSTING = ["https://vigia-peru.web.app", "https://vigia-peru.firebaseapp.com"];
const ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/vigia-peru-frontend[a-z0-9-]*\.(us-central1|us-east1|europe-west1)\.run\.app$|^https:\/\/[a-z0-9-]+-oq3gq6a4ka-uc\.a\.run\.app$|^https:\/\/vigia-peru--[a-z0-9-]+\.web\.app$/;
app.use("*", cors({
  origin: (origin) => {
    if (!origin) return origin;
    if (explicitOrigins.includes(origin) || ORIGENES_HOSTING.includes(origin)) return origin;
    if (ORIGIN_REGEX.test(origin)) return origin;
    return null; // rechaza
  },
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  // Sin x-admin-*: el panel pasa por el proxy del servidor del frontend (servidor a servidor, sin CORS).
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
}));

// Tope del cuerpo de las escrituras (auditoría A9): 64 KB en lo público (el formulario más grande,
// una denuncia con 20 adjuntos por URL, pesa unos pocos KB); 1 MB en el panel admin (con token).
const demasiadoGrande = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "payload_too_large", requestId: c.get("requestId") ?? null }, 413) });
const demasiadoGrandeAdmin = bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "payload_too_large", requestId: c.get("requestId") ?? null }, 413) });
app.use("*", async (c, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) return next();
  return (/^\/(v1\/)?admin(\/|$)/.test(c.req.path) ? demasiadoGrandeAdmin : demasiadoGrande)(c, next);
});

// ─── Rutas: sin prefijo (como siempre) y bajo /v1 (Firebase Hosting reenvía /v1/** con la ruta entera) ──
const api = new Hono();

api.get("/", (c) => c.json({ service: "vigia-peru-api", status: "ok" }));

// /health toca la base (SELECT 1, 2 s como mucho): 503 si no responde. /livez sólo dice que el proceso vive.
api.get("/health", async (c) => {
  const db = await ping();
  c.header("Cache-Control", SIN_CACHE);
  return c.json({ ok: db.ok, db }, db.ok ? 200 : 503);
});
api.get("/livez", (c) => {
  c.header("Cache-Control", SIN_CACHE);
  return c.json({ ok: true });
});

api.route("/alertas", alertasRouter);
api.route("/senales", senalesRouter);
api.route("/entidades", entidadesRouter);
api.route("/reportes", reportesRouter);
api.route("/upload", uploadRouter);
api.route("/financiamiento/procesamientos", procesamientosRouter); // antes de /financiamiento (prefijo)
api.route("/financiamiento", financiamientoRouter);
api.route("/contribuciones", contribucionesRouter);
api.route("/contratos", contratosRouter);
api.route("/cuentas", cuentasRouter);
api.route("/buscar", buscarRouter);
api.route("/admin", adminRouter);

app.route("/", api);
app.route("/v1", api);

// ─── 404 y errores en JSON ─────────────────────────────────────
app.notFound((c) => c.json({ error: "not_found", requestId: c.get("requestId") ?? null }, 404));
// Sin `err.message` en la respuesta (auditoría M2): el detalle queda en el log, unido por requestId.
app.onError(errorInterno);
