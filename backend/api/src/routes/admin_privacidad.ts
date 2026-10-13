/**
 * Bandeja de pedidos de privacidad (Ley 29733; tabla de la migración 45, formulario en /privacidad).
 * Se monta bajo /admin (hereda el x-admin-token).
 *
 *   GET   /admin/privacidad?estado=pendiente|en_revision|resuelta|rechazada|todas&limit=&offset=
 *         → { data, total, porEstado: {pendiente, en_revision, resuelta, rechazada}, tabla }
 *   PATCH /admin/privacidad/:id  { estado, respuesta? } → la fila actualizada; queda en la bitácora
 *
 * Sin la tabla (migración sin aplicar) la lista sale vacía con `tabla: false`.
 */

import { Hono } from "hono";
import { z } from "zod";
import { poolAdmin as pool } from "../lib/db.js"; // pool del panel (lib/db.ts)
import { actor, esRevisor, log } from "../lib/adminlog.js";

export const adminPrivacidadRouter = new Hono();

// Llevan el correo y el pedido de una persona: sólo administradores, no el perfil revisor.
adminPrivacidadRouter.use("/privacidad/*", async (c, next) => (esRevisor(c) ? c.json({ error: "forbidden" }, 403) : next()));
adminPrivacidadRouter.use("/privacidad", async (c, next) => (esRevisor(c) ? c.json({ error: "forbidden" }, 403) : next()));

const ESTADOS = ["pendiente", "en_revision", "resuelta", "rechazada"] as const;
const sinTabla = (e: unknown) => (e as { code?: string })?.code === "42P01";

const COLS = `id::text AS id, codigo, tipo, nombre, email, enlace, mensaje, estado, respuesta,
              atendida_por AS "atendidaPor", atendida_at AS "atendidaAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

const Lista = z.object({
  estado: z.enum([...ESTADOS, "todas"]).default("pendiente"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

adminPrivacidadRouter.get("/privacidad", async (c) => {
  const q = Lista.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!q.success) return c.json({ error: "invalid_query" }, 400);
  const { estado, limit, offset } = q.data;
  const filtro = estado === "todas" ? "" : "WHERE estado = $3";
  const vals: unknown[] = estado === "todas" ? [limit, offset] : [limit, offset, estado];
  try {
    const [r, n] = await Promise.all([
      // Lo abierto primero y, dentro, lo más viejo: la Ley pone plazo para responder.
      pool.query(`SELECT ${COLS} FROM solicitudes_privacidad ${filtro}
                   ORDER BY CASE estado WHEN 'pendiente' THEN 0 WHEN 'en_revision' THEN 1 ELSE 2 END,
                            CASE WHEN estado IN ('pendiente', 'en_revision') THEN created_at END ASC,
                            created_at DESC, id
                   LIMIT $1 OFFSET $2`, vals),
      pool.query<{ estado: string; n: number }>(`SELECT estado, count(*)::int AS n FROM solicitudes_privacidad GROUP BY estado`),
    ]);
    const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, n.rows.find((x) => x.estado === e)?.n ?? 0]));
    const total = estado === "todas" ? n.rows.reduce((s, x) => s + x.n, 0) : porEstado[estado];
    return c.json({ data: r.rows, total, porEstado, tabla: true });
  } catch (e) {
    if (sinTabla(e)) return c.json({ data: [], total: 0, porEstado: Object.fromEntries(ESTADOS.map((x) => [x, 0])), tabla: false });
    throw e;
  }
});

const Cambio = z.object({
  estado: z.enum(ESTADOS),
  respuesta: z.string().trim().max(4000).optional().nullable(),
});

adminPrivacidadRouter.patch("/privacidad/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,18}$/.test(id)) return c.json({ error: "invalid_id" }, 400);
  const parsed = Cambio.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { estado, respuesta } = parsed.data;
  const quien = actor(c);
  const cerrada = estado === "resuelta" || estado === "rechazada";
  const r = await pool.query(
    `UPDATE solicitudes_privacidad
        SET estado = $2,
            respuesta = COALESCE($3, respuesta),
            atendida_por = CASE WHEN $4 THEN $5 ELSE atendida_por END,
            atendida_at = CASE WHEN $4 THEN now() ELSE atendida_at END,
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, estado, respuesta ?? null, cerrada, quien],
  );
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  // En la bitácora va el código y el estado, no el pedido ni el correo.
  await log(quien, `privacidad_${estado}`, "solicitudes_privacidad", { codigo: r.rows[0].codigo, tipo: r.rows[0].tipo });
  return c.json(r.rows[0]);
});
