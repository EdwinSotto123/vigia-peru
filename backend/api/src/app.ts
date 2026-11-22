/**
 * La app Hono de la API, sin servidor: la usan las dos entradas.
 *   · `src/index.ts`  Cloud Run (Node): @hono/node-server + cierre ordenado con SIGTERM.
 *   · `src/worker.ts` Cloudflare Workers: `fetch` con un ámbito por pedido (pools sobre Hyperdrive).
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { bodyLimit } from "hono/body-limit";
import { limiteLectura } from "./lib/antibots.js";
import { ping } from "./lib/db.js";
import { SIN_CACHE } from "./lib/http.js";
import { EN_WORKERS } from "./lib/plataforma.js";
import { errorInterno, registroPedidos } from "./lib/registro.js";
import { alertasRouter } from "./routes/alertas.js";
import { entidadesRouter } from "./routes/entidades.js";
import { crucesRouter } from "./routes/cruces.js";
import { partidosRouter } from "./routes/partidos.js";
import { poderRouter } from "./routes/poder.js";
import { corrupcionRouter } from "./routes/corrupcion.js";
import { informesControlRouter } from "./routes/informesControl.js";
import { personasRouter } from "./routes/personas.js";
import { empresasRouter } from "./routes/empresas.js";
import { planillaRouter, plazasRouter } from "./routes/planilla.js";
import { historiaRouter } from "./routes/historia.js";
import { visitasRouter } from "./routes/visitas.js";
import { patronesRouter } from "./routes/patrones.js";
import { normasRouter } from "./routes/normas.js";
import { estadoRouter } from "./routes/estado.js";
import { novedadesRouter } from "./routes/novedades.js";
import { sitemapRouter } from "./routes/sitemap.js";
import { pagosRouter } from "./routes/pagos.js";
import { reportesRouter } from "./routes/reportes.js";
import { financiamientoRouter } from "./routes/financiamiento.js";
import { contribucionesRouter } from "./routes/contribuciones.js";
import { procesamientosRouter } from "./routes/procesamientos.js";
import { adminRouter } from "./routes/admin.js";
import { gastoRouter } from "./routes/gasto.js";
import { documentosRouter } from "./routes/documentos.js";
import { contratosRouter } from "./routes/contratos.js";
import { informeControlRouter } from "./routes/informeControl.js";
import { ordenesRouter } from "./routes/ordenes.js";
import { menoresRouter } from "./routes/menores.js";
import { catalogoRouter } from "./routes/catalogo.js";
import { comprasRouter } from "./routes/compras.js";
import { cuentasRouter } from "./routes/cuentas.js";
import { buscarRouter } from "./routes/buscar.js";
import { senalesRouter } from "./routes/senales.js";
import { privacidadRouter } from "./routes/privacidad.js";
import { mefRouter } from "./routes/mef.js";
import { estructuraRouter } from "./routes/estructura.js";
import { cadenaRouter } from "./routes/cadena.js";
import { obrasRouter } from "./routes/obras.js";
import { gobservaRouter } from "./routes/gobserva.js";
import { gobservaCuentaRouter } from "./routes/gobservaCuenta.js";
import { empleoRouter } from "./routes/empleo.js";
import { licitacionesRouter } from "./routes/licitaciones.js";
import { cotizacionesRouter } from "./routes/cotizaciones.js";
import { proyectosRouter } from "./routes/proyectos.js";
import { iaRouter } from "./routes/ia.js";
import { datosRouter } from "./routes/datos.js";
import { hallazgosRouter } from "./routes/hallazgos.js";
import { transparenciaRouter } from "./routes/transparencia.js";
import { saludCuentaRouter } from "./routes/saludCuenta.js";
import { saludRouter } from "./routes/gobservaSalud.js";

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
  // cf-turnstile-response: el token del captcha de las escrituras públicas (lib/antibots.ts).
  allowHeaders: ["Content-Type", "Authorization", "cf-turnstile-response"],
  exposeHeaders: ["Retry-After"],
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

// Lecturas por IP (lib/antibots.ts): después de CORS, para que el navegador pueda leer el 429. Lo guardado en la
// caché del borde (workers/cdn.ts) se responde antes y no cuenta: no cuesta una consulta.
app.use("*", limiteLectura);

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
api.route("/ia", iaRouter); // lo que leyó la IA (página /app/ia)
api.route("/entidades", entidadesRouter);
api.route("/cruces", crucesRouter);
api.route("/partidos", partidosRouter);
api.route("/poder", poderRouter);
api.route("/corrupcion", corrupcionRouter);
api.route("/informes-control", informesControlRouter); // fichas de la Contraloría y su buscador (migraciones 304-305)
api.route("/personas", personasRouter);
api.route("/empresas", empresasRouter);
api.route("/planilla", planillaRouter);
api.route("/plazas", plazasRouter);
api.route("/historia", historiaRouter);
api.route("/visitas", visitasRouter);
api.route("/patrones", patronesRouter);
api.route("/normas", normasRouter);
api.route("/estado", estadoRouter);
api.route("/novedades", novedadesRouter);
api.route("/sitemap", sitemapRouter);
api.route("/pagos", pagosRouter);
api.route("/reportes", reportesRouter);
api.route("/financiamiento/procesamientos", procesamientosRouter); // antes de /financiamiento (prefijo)
api.route("/financiamiento", financiamientoRouter);
api.route("/contribuciones", contribucionesRouter);
// El informe de indicios en formato de control de un contrato (migración 306): antes del detalle de /contratos/:ocid.
api.route("/contratos", informeControlRouter);
api.route("/contratos", contratosRouter);
// Documentos de varios procesos en un ZIP (MCP y chat del panel), desde R2.
api.route("/documentos", documentosRouter);
// Gasto por concepto (palabras alternativas sobre órdenes, procesos y compras menores): MCP y chat del panel.
api.route("/gasto", gastoRouter);
api.route("/ordenes", ordenesRouter);
api.route("/menores", menoresRouter);
api.route("/salud/cuenta", saludCuentaRouter); // la cuenta gratis de Salud: lo guardado (migr. 442)
api.route("/salud", saludRouter); // Gobserva Salud (salud.gobserva.cloud): IPRESS, sanciones de SUSALUD y médicos (migr. 432)
api.route("/catalogo", catalogoRouter);
api.route("/compras", comprasRouter);
api.route("/obras", obrasRouter);
// Gobserva (2026-11-01): los productos de pago con marca propia (empleo.gobserva.cloud y licitaciones.gobserva.cloud) y
// la lista de espera de sus planes (migración 226).
api.route("/gobserva/cuenta", gobservaCuentaRouter);
api.route("/gobserva", gobservaRouter);
api.route("/empleo", empleoRouter);
// Las contrataciones menores abiertas (migración 262), antes que las demás rutas de /licitaciones.
api.route("/licitaciones/menores", cotizacionesRouter);
api.route("/licitaciones", licitacionesRouter);
// Gobserva Obras (obras.gobserva.cloud): /obras ya es de Vigía.
api.route("/proyectos", proyectosRouter);
api.route("/cuentas", cuentasRouter);
api.route("/buscar", buscarRouter);
api.route("/privacidad", privacidadRouter);
api.route("/mef", mefRouter);
api.route("/estructura", estructuraRouter);
api.route("/cadena", cadenaRouter);
// Cifras a pedido para el MCP de Gobserva (consultar_datos): catálogo y consulta con listas cerradas (migración 254).
api.route("/datos", datosRouter);
// Hallazgos: el ranking de una cifra dentro de un grupo de entidades parecidas (migración 256). La ficha de una entidad
// va en /entidades/:ruc/hallazgos.
api.route("/hallazgos", hallazgosRouter);
// Métricas y transparencia (página /metricas): precisión de los agentes, RAG normativo, verificación, costos y bitácora
// con fecha. Sólo agregados (migración 300).
api.route("/transparencia", transparenciaRouter);
api.route("/admin", adminRouter);

app.route("/", api);
app.route("/v1", api);

// ─── 404 y errores en JSON ─────────────────────────────────────
app.notFound((c) => c.json({ error: "not_found", requestId: c.get("requestId") ?? null }, 404));
// Sin `err.message` en la respuesta (auditoría M2): el detalle queda en el log, unido por requestId.
app.onError(errorInterno);
