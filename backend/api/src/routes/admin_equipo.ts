/**
 * Equipo del panel (migración 29). Se monta bajo /admin (hereda el x-admin-token): sólo lo llama el
 * servidor del frontend, que decide antes quién puede qué (frontend/lib/permisos.ts).
 *
 *   GET    /admin/equipo                    miembros (los principales del secreto admin-emails no están acá)
 *   GET    /admin/equipo/rol/:correo        { rol } del correo si está activo, o null — lo usa el login
 *   POST   /admin/equipo/ingreso/:correo    marca el último ingreso (al entrar al panel)
 *   PUT    /admin/equipo/:correo            { rol, nombre?, activo? } — alta o cambio → bitácora
 *   DELETE /admin/equipo/:correo            baja → bitácora
 *
 * Sin la tabla (migración 29 sin aplicar) la lista sale vacía con `tabla: false` y nadie de la tabla
 * entra: siguen entrando sólo los administradores principales.
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { actor, log } from "../lib/adminlog.js";

export const adminEquipoRouter = new Hono();

// `c.req.param` ya llega decodificado (Hono): decodificarlo otra vez tiraba URIError (500) con un "%" en el correo.
const Correo = z.string().trim().toLowerCase().email().max(200);
const sinTabla = (e: unknown) => (e as { code?: string })?.code === "42P01";

const COLS = `correo, rol, nombre, activo, creado_por AS "creadoPor", creado_at AS "creadoAt",
              actualizado_por AS "actualizadoPor", actualizado_at AS "actualizadoAt", ultimo_ingreso AS "ultimoIngreso"`;

adminEquipoRouter.get("/equipo", async (c) => {
  try {
    const r = await pool.query(`SELECT ${COLS} FROM equipo ORDER BY activo DESC, rol, correo`);
    return c.json({ data: r.rows, tabla: true });
  } catch (e) {
    if (sinTabla(e)) return c.json({ data: [], tabla: false });
    throw e;
  }
});

adminEquipoRouter.get("/equipo/rol/:correo", async (c) => {
  const correo = Correo.safeParse(c.req.param("correo"));
  if (!correo.success) return c.json({ rol: null });
  try {
    const r = await pool.query(`SELECT rol FROM equipo WHERE correo = $1 AND activo`, [correo.data]);
    return c.json({ rol: r.rows[0]?.rol ?? null });
  } catch (e) {
    if (sinTabla(e)) return c.json({ rol: null, tabla: false });
    throw e;
  }
});

adminEquipoRouter.post("/equipo/ingreso/:correo", async (c) => {
  const correo = Correo.safeParse(c.req.param("correo"));
  if (!correo.success) return c.json({ ok: false });
  await pool.query(`UPDATE equipo SET ultimo_ingreso = now() WHERE correo = $1`, [correo.data]).catch(() => null);
  return c.json({ ok: true });
});

const Miembro = z.object({
  rol: z.enum(["admin", "revisor"]),
  nombre: z.string().trim().max(120).optional().nullable(),
  activo: z.boolean().optional(),
});

adminEquipoRouter.put("/equipo/:correo", async (c) => {
  const correo = Correo.safeParse(c.req.param("correo"));
  if (!correo.success) return c.json({ error: "correo_invalido", detail: "Escribe un correo válido." }, 400);
  const body = Miembro.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "datos_invalidos", detail: "Elige el perfil: admin o revisor." }, 400);
  const who = actor(c);
  try {
    const antes = await pool.query(`SELECT rol, activo, nombre FROM equipo WHERE correo = $1`, [correo.data]);
    const r = await pool.query(
      `INSERT INTO equipo (correo, rol, nombre, activo, creado_por, actualizado_por)
       VALUES ($1, $2, $3, COALESCE($4, true), $5, $5)
       ON CONFLICT (correo) DO UPDATE SET rol = EXCLUDED.rol,
         nombre = COALESCE($3, equipo.nombre), activo = COALESCE($4, equipo.activo),
         actualizado_por = $5, actualizado_at = now()
       RETURNING ${COLS}`,
      [correo.data, body.data.rol, body.data.nombre ?? null, body.data.activo ?? null, who]);
    await log(who, antes.rows.length ? "equipo_cambiar" : "equipo_agregar", `equipo:${correo.data}`,
      { rol: body.data.rol, activo: r.rows[0].activo, antes: antes.rows[0] ?? null });
    return c.json({ ok: true, miembro: r.rows[0] });
  } catch (e) {
    if (sinTabla(e)) return c.json({ error: "sin_tabla", detail: "Falta aplicar la migración 29 (equipo) en la base." }, 503);
    throw e;
  }
});

adminEquipoRouter.delete("/equipo/:correo", async (c) => {
  const correo = Correo.safeParse(c.req.param("correo"));
  if (!correo.success) return c.json({ error: "correo_invalido" }, 400);
  try {
    const r = await pool.query(`DELETE FROM equipo WHERE correo = $1 RETURNING rol`, [correo.data]);
    if (!r.rows.length) return c.json({ error: "not_found", detail: "Ese correo no está en el equipo." }, 404);
    await log(actor(c), "equipo_quitar", `equipo:${correo.data}`, { rol: r.rows[0].rol });
    return c.json({ ok: true });
  } catch (e) {
    if (sinTabla(e)) return c.json({ error: "sin_tabla", detail: "Falta aplicar la migración 29 (equipo) en la base." }, 503);
    throw e;
  }
});
