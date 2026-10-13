/**
 * Pedidos de privacidad (Ley 29733): quien aparece en Vigía pide corregir, retirar, conocer u oponerse
 * al uso de un dato suyo. La página pública es /privacidad (frontend); el equipo los atiende en
 * /admin/privacidad (routes/admin_privacidad.ts). Tabla de la migración 45.
 *
 *   POST /privacidad/solicitudes  {tipo, nombre, email, enlace?, mensaje} → 201 {codigo}
 *
 * Sin sesión, como las denuncias: límite por IP y captcha (lib/antibots.ts). No se pide DNI.
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { exigirCaptcha, limiteEscritura } from "../lib/antibots.js";
import { registrar } from "../lib/registro.js";

export const privacidadRouter = new Hono();

export const TIPOS_SOLICITUD = ["correccion", "retiro", "acceso", "oposicion", "otro"] as const;

const Solicitud = z.object({
  tipo: z.enum(TIPOS_SOLICITUD),
  nombre: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email().max(200),
  // La página de Vigía donde aparece (la llena sola el enlace "Pide una corrección" del dossier).
  enlace: z.string().trim().max(500).optional().nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v == null || /^(https?:\/\/|\/)/.test(v), { message: "enlace inválido" }),
  mensaje: z.string().trim().min(10).max(4000),
});

privacidadRouter.post("/solicitudes", limiteEscritura, exigirCaptcha, async (c) => {
  const parsed = Solicitud.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", campos: parsed.error.issues.map((i) => i.path.join(".")) }, 400);
  const d = parsed.data;
  try {
    const r = await pool.query<{ codigo: string }>(
      `INSERT INTO solicitudes_privacidad (tipo, nombre, email, enlace, mensaje) VALUES ($1, $2, $3, $4, $5) RETURNING codigo`,
      [d.tipo, d.nombre, d.email, d.enlace, d.mensaje],
    );
    c.header("Cache-Control", "no-store");
    return c.json({ codigo: r.rows[0].codigo }, 201);
  } catch (e) {
    // Sin la migración 45 no hay dónde guardarla: que la persona sepa que no llegó.
    if ((e as { code?: string })?.code === "42P01") {
      registrar("ERROR", "[privacidad] falta la tabla solicitudes_privacidad (migración 45)");
      return c.json({ error: "no_disponible" }, 503);
    }
    throw e;
  }
});
