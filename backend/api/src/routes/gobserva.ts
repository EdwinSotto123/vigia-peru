import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { exigirCaptcha, limiteEscritura } from "../lib/antibots.js";
import { SIN_CACHE, cachePublico } from "../lib/http.js";
import { mpPublicKey } from "../lib/mercadopago.js";
import { correoConfigurado } from "../lib/correo.js";
import { LIMITES_GRATIS, cupoFundadorLibre, esProductoPago, leerConfig, planesDe } from "../lib/gobservaPlanes.js";
import { pausarPorToken } from "../lib/gobservaAlertas.js";
import { getPagosConfig } from "./contribuciones.js";

/**
 * POST /gobserva/suscripciones — anotarse en un producto de Gobserva (empleo.gobserva.cloud, licitaciones.gobserva.cloud o
 * el MCP), con el plan que le interesa y sus filtros (migración 226). Pedido del usuario (2026-11-01): productos de pago
 * con lo que Vigía ya captura; primero se valida la demanda con una lista de espera con precio de fundador (todavía no se
 * cobra ni se mandan alertas). El mismo correo en el mismo producto actualiza su suscripción, no se duplica.
 *
 * Como todo formulario público: Turnstile y límite de escrituras por IP. Nunca devuelve datos de otros suscriptores: la
 * lista la lee el panel (GET /admin/gobserva/suscripciones). Del RUC, sólo el de una empresa (20…).
 */
export const gobservaRouter = new Hono();

const PLANES = ["gratis", "alertas", "pro", "empresa", "institucional", "mcp"] as const;
const opcional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

const Suscripcion = z.object({
  producto: z.enum(["empleo", "licitaciones", "obras", "mcp"]),
  email: z.string().trim().toLowerCase().max(254).email(),
  nombre: opcional(120),
  empresa: opcional(160),
  ruc: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || /^20\d{9}$/.test(v), { message: "ruc_empresa" }),
  telefono: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.replace(/[\s-]/g, "") : undefined))
    .refine((v) => v === undefined || /^\+?\d{7,15}$/.test(v), { message: "telefono" }),
  plan: z.enum(PLANES).default("gratis"),
  // Los filtros que eligió (palabras, regiones, tipos, sueldo mínimo…): texto corto, sin estructura fija.
  intereses: z
    .record(z.union([z.string().max(300), z.number(), z.boolean(), z.array(z.string().max(120)).max(30)]))
    .optional()
    .refine((v) => v === undefined || JSON.stringify(v).length <= 3000, { message: "intereses" }),
  origen: opcional(200),
  acepta: z.literal(true, { errorMap: () => ({ message: "acepta" }) }),
});

gobservaRouter.post("/suscripciones", limiteEscritura, exigirCaptcha, async (c) => {
  const cuerpo = await c.req.json().catch(() => null);
  const p = Suscripcion.safeParse(cuerpo);
  if (!p.success) {
    // Qué campo falló (sin repetir lo que mandó): el formulario lo muestra junto al campo.
    const campos = [...new Set(p.error.issues.map((i) => String(i.path[0] ?? i.message)))];
    return c.json({ error: "invalid_body", campos }, 400);
  }
  const s = p.data;
  const r = await pool.query<{ nueva: boolean }>(
    `SELECT gobserva_suscribir($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10) AS nueva`,
    [s.producto, s.email, s.nombre ?? null, s.empresa ?? null, s.ruc ?? null, s.telefono ?? null, s.plan, JSON.stringify(s.intereses ?? {}), s.origen ?? null, s.acepta],
  );
  c.header("Cache-Control", SIN_CACHE);
  return c.json({ ok: true, nueva: r.rows[0]?.nueva ?? true, producto: s.producto, plan: s.plan }, 201);
});

// ─── GET /gobserva/planes?producto= ──────────────────────────────────────────────────────────────────────────────────
/**
 * Los planes que se venden en un producto, con su precio de hoy (el de fundador y cuántos lugares quedan), los medios de
 * pago abiertos y los datos del vendedor para el recibo (el RUC es una variable del panel: mientras no esté, el recibo es
 * una constancia de pago). Lo que la página de planes y el pago necesitan; el precio que se cobra lo vuelve a calcular la
 * API al contratar.
 */
gobservaRouter.get("/planes", async (c) => {
  const producto = c.req.query("producto");
  if (!esProductoPago(producto)) return c.json({ error: "invalid_query" }, 400);
  const [config, pagos, planes] = await Promise.all([leerConfig(), getPagosConfig(), planesDe(producto)]);
  const conCupo = await Promise.all(
    planes.filter((p) => p.activo).map(async (p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: p.precio,
      fundador: p.fundador ? { ...p.fundador, libres: await cupoFundadorLibre(p) } : null,
      limites: p.limites,
    })));
  c.header("Cache-Control", cachePublico(60, { maxAge: 30, swr: 300 }));
  return c.json({
    producto,
    planes: conCupo,
    gratis: LIMITES_GRATIS,
    medios: {
      tarjeta: config.medios.tarjeta && mpPublicKey() ? { publicKey: mpPublicKey() } : null,
      yape: config.medios.yape && pagos.yape ? { numero: pagos.yape.numero, titular: pagos.yape.titular, qrUrl: pagos.yape.qrUrl } : null,
      plin: config.medios.plin && pagos.plin ? { numero: pagos.plin.numero, titular: pagos.plin.titular, qrUrl: pagos.plin.qrUrl } : null,
      transferencia: config.medios.transferencia && pagos.cuentas.length ? { cuentas: pagos.cuentas } : null,
    },
    vendedor: { nombreComercial: config.vendedor.nombreComercial, ruc: config.vendedor.ruc || null, razonSocial: config.vendedor.razonSocial || null, correo: config.vendedor.correo },
    aviso: config.aviso || null,
    correoActivo: correoConfigurado(),
  });
});

// ─── POST /gobserva/alertas/pausar?t= ────────────────────────────────────────────────────────────────────────────────
/**
 * Pausa una alerta con el enlace de su correo: la página /pausar (con un botón) y la cabecera List-Unsubscribe (el POST de
 * un clic de Gmail y compañía, RFC 8058). Un GET no pausa nada: los filtros de correo abren los enlaces solos.
 */
gobservaRouter.post("/alertas/pausar", limiteEscritura, async (c) => {
  c.header("Cache-Control", SIN_CACHE);
  const r = await pausarPorToken(c.req.query("t") ?? "");
  return r ? c.json({ ok: true, ...r }) : c.json({ error: "no_encontrado", detail: "Ese enlace ya no sirve. Entra a tu cuenta para ver tus alertas." }, 404);
});
