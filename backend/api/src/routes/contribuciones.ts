/**
 * "Financia una auditoría" — escritura.
 *
 *   POST /contribuciones                       crea una contribución en `pendiente_pago` (fase 0: transferencia/Yape)
 *   POST /contribuciones/:codigo/comprobante   adjunta la URL del comprobante subido (GCS vía /upload)
 *   GET  /contribuciones/:codigo               estado (privado: incluye email enmascarado) — requiere token
 *   POST /admin/contribuciones/:codigo/validar   marca `pagada` y asigna contratos FIFO (ADMIN_TOKEN)
 *   POST /admin/contribuciones/:codigo/rechazar
 *   POST /admin/asignar                          re-corre la asignación para todas las contribuciones abiertas
 *
 * Reglas de independencia codificadas acá (docs/design/FINANCIA_UNA_AUDITORIA.md §6):
 *   · No existe ningún campo para elegir contratos: la asignación es `asignar_contribucion()` (SQL, FIFO).
 *   · Empresa con sanción vigente o que aparece como proveedor en alertas de la zona →
 *     se acepta el aporte pero `financiadores.visible = false` (sin ranking ni muro).
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { optionalAuth } from "../lib/auth.js";

export const contribucionesRouter = new Hono();
export const adminContribucionesRouter = new Hono();

const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

const CrearBody = z.object({
  ubigeo: z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/),
  contratos: z.number().int().min(5).max(50_000),
  financiador: z.object({
    tipo: z.enum(["empresa", "persona", "organizacion"]),
    nombrePublico: z.string().trim().min(2).max(80).optional(),   // ausente = anónimo
    ruc: z.string().regex(/^\d{11}$/).optional(),
    email: z.string().email(),
    logoUrl: z.string().url().optional(),
  }),
  mensajePublico: z.string().trim().max(140).optional(),
  metodo: z.enum(["transferencia", "yape", "plin"]).default("transferencia"),
});

// ─── POST /contribuciones ────────────────────────────────────────────────────
contribucionesRouter.post("/", optionalAuth, async (c) => {
  const body = CrearBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
  const { ubigeo, contratos, financiador: f, mensajePublico, metodo } = body.data;
  if ((f.tipo === "empresa" || f.tipo === "organizacion") && !f.ruc) {
    return c.json({ error: "ruc_required", detail: "Empresas y organizaciones deben indicar RUC" }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const zona = await client.query("SELECT nombre FROM zonas WHERE ubigeo = $1", [ubigeo]);
    if (!zona.rows.length) { await client.query("ROLLBACK"); return c.json({ error: "zona_not_found" }, 404); }

    // Financiador: reutiliza por firebase_uid o por (ruc|email).
    const uid = c.get("user")?.uid ?? null;
    let fin = await client.query(
      `SELECT id, visible FROM financiadores WHERE ($1::text IS NOT NULL AND firebase_uid = $1)
          OR ($2::text IS NOT NULL AND ruc = $2) OR (email = $3 AND tipo = $4) LIMIT 1`,
      [uid, f.ruc ?? null, f.email, f.tipo]);
    let financiadorId: number;
    if (fin.rows.length) {
      financiadorId = fin.rows[0].id;
      await client.query(
        `UPDATE financiadores SET nombre_publico = COALESCE($2, nombre_publico), logo_url = COALESCE($3, logo_url),
                firebase_uid = COALESCE(firebase_uid, $4) WHERE id = $1`,
        [financiadorId, f.nombrePublico ?? null, f.logoUrl ?? null, uid]);
    } else {
      const slug = f.nombrePublico ? slugify(f.nombrePublico) + "-" + Math.random().toString(36).slice(2, 6) : null;
      const ins = await client.query(
        `INSERT INTO financiadores (tipo, nombre_publico, slug, ruc, logo_url, email, firebase_uid)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [f.tipo, f.nombrePublico ?? null, slug, f.ruc ?? null, f.logoUrl ?? null, f.email, uid]);
      financiadorId = ins.rows[0].id;
    }

    // Conflicto de interés (regla 3): sanción vigente o proveedor con alertas en la zona.
    if (f.ruc) {
      const conflicto = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM osce_sancionados s WHERE s.ruc = $1 AND (s.fecha_hasta IS NULL OR s.fecha_hasta >= current_date)) AS sancionado,
           EXISTS (SELECT 1 FROM alertas a WHERE a.proveedor_ruc = $1 AND a.estado = 'activa') AS con_alertas`,
        [f.ruc]);
      const { sancionado, con_alertas } = conflicto.rows[0];
      if (sancionado || con_alertas) {
        await client.query(
          `UPDATE financiadores SET visible = false, motivo_no_visible = $2 WHERE id = $1`,
          [financiadorId, sancionado ? "sancion_vigente_osce" : "proveedor_con_alertas_activas"]);
      }
    }

    const tarifa = await client.query("SELECT id, precio_pen FROM tarifas ORDER BY vigente_desde DESC LIMIT 1");
    const monto = Number(tarifa.rows[0].precio_pen) * contratos;
    const codigo = (await client.query("SELECT next_codigo_contribucion() AS c")).rows[0].c as string;
    await client.query(
      `INSERT INTO contribuciones (codigo, financiador_id, ubigeo, contratos, tarifa_id, monto_pen, pasarela, mensaje_publico)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [codigo, financiadorId, ubigeo, contratos, tarifa.rows[0].id, monto, metodo, mensajePublico ?? null]);
    await client.query("COMMIT");

    return c.json({
      codigo,
      estado: "pendiente_pago",
      montoPen: monto,
      contratos,
      zona: zona.rows[0].nombre,
      // Fase 0: instrucciones de pago manual. Los datos vienen de env para no fijarlos en código.
      pago: {
        metodo,
        concepto: codigo,
        yape: process.env.PAGO_YAPE_NUMERO ?? null,
        plin: process.env.PAGO_PLIN_NUMERO ?? null,
        transferencia: process.env.PAGO_CCI ? { banco: process.env.PAGO_BANCO ?? "", cci: process.env.PAGO_CCI, titular: process.env.PAGO_TITULAR ?? "" } : null,
        instrucciones: `Transfiere S/ ${monto.toFixed(2)} indicando el código ${codigo} como concepto y sube el comprobante. Validamos en menos de 48 h.`,
      },
    }, 201);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[contribuciones] error:", (e as Error).message);
    return c.json({ error: "internal", detail: (e as Error).message }, 500);
  } finally {
    client.release();
  }
});

// ─── POST /contribuciones/:codigo/comprobante ────────────────────────────────
contribucionesRouter.post("/:codigo/comprobante", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = z.object({ url: z.string().url(), referencia: z.string().max(80).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const r = await pool.query(
    `UPDATE contribuciones SET comprobante_url = $2, pasarela_ref = COALESCE($3, pasarela_ref)
     WHERE codigo = $1 AND estado = 'pendiente_pago' RETURNING codigo`,
    [codigo, body.data.url, body.data.referencia ?? null]);
  if (!r.rows.length) return c.json({ error: "not_found_or_not_pending" }, 404);
  return c.json({ ok: true, codigo, estado: "pendiente_pago", mensaje: "Comprobante recibido. Te avisamos por email al validarlo." });
});

// ─── GET /contribuciones/:codigo (estado, para quien tiene el código) ────────
contribucionesRouter.get("/:codigo", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const r = await pool.query(
    `SELECT co.codigo, co.estado, co.contratos, co.monto_pen::float AS "montoPen", co.created_at AS "createdAt",
            co.pagada_at AS "pagadaAt", co.comprobante_url IS NOT NULL AS "tieneComprobante", z.nombre AS zona, co.ubigeo,
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id)::int AS asignados,
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id AND s.procesada_at IS NOT NULL)::int AS procesados
     FROM contribuciones co JOIN zonas z ON z.ubigeo = co.ubigeo WHERE co.codigo = $1`, [codigo]);
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  return c.json(r.rows[0]);
});

// ─── Admin (fase 0: validación manual) ───────────────────────────────────────
adminContribucionesRouter.use("*", async (c, next) => {
  const token = process.env.ADMIN_TOKEN;
  const got = c.req.header("x-admin-token") ?? "";
  if (!token || got !== token) return c.json({ error: "forbidden" }, 403);
  await next();
});

adminContribucionesRouter.post("/contribuciones/:codigo/validar", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = await c.req.json().catch(() => ({}));
  const validador = typeof body?.validador === "string" ? body.validador : "admin";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE contribuciones SET estado = 'pagada', pagada_at = now(), validada_por = $2,
              pasarela_ref = COALESCE($3, pasarela_ref)
       WHERE codigo = $1 AND estado = 'pendiente_pago' RETURNING id`,
      [codigo, validador, typeof body?.referencia === "string" ? body.referencia : null]);
    if (!r.rows.length) { await client.query("ROLLBACK"); return c.json({ error: "not_found_or_not_pending" }, 404); }
    const asig = await client.query("SELECT asignar_contribucion($1) AS n", [r.rows[0].id]);
    await client.query("SELECT refresh_financiamiento()");
    await client.query("COMMIT");
    return c.json({ ok: true, codigo, estado: asig.rows[0].n > 0 ? "en_proceso" : "pagada", asignados: asig.rows[0].n });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return c.json({ error: "internal", detail: (e as Error).message }, 500);
  } finally {
    client.release();
  }
});

adminContribucionesRouter.post("/contribuciones/:codigo/rechazar", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const r = await pool.query(
    `UPDATE contribuciones SET estado = 'rechazada' WHERE codigo = $1 AND estado = 'pendiente_pago' RETURNING codigo`, [codigo]);
  if (!r.rows.length) return c.json({ error: "not_found_or_not_pending" }, 404);
  return c.json({ ok: true, codigo, estado: "rechazada" });
});

adminContribucionesRouter.get("/contribuciones", async (c) => {
  const estado = new URL(c.req.url).searchParams.get("estado") ?? "pendiente_pago";
  const r = await pool.query(
    `SELECT co.codigo, co.estado, co.contratos, co.monto_pen::float AS "montoPen", co.pasarela, co.pasarela_ref AS "pasarelaRef",
            co.comprobante_url AS "comprobanteUrl", co.created_at AS "createdAt", z.nombre AS zona, co.ubigeo,
            f.tipo, f.nombre_publico AS "nombrePublico", f.ruc, f.email, f.visible, f.motivo_no_visible AS "motivoNoVisible"
     FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id JOIN zonas z ON z.ubigeo = co.ubigeo
     WHERE co.estado = $1 ORDER BY co.created_at DESC LIMIT 200`, [estado]);
  return c.json({ data: r.rows });
});

// Re-asigna contribuciones abiertas (p. ej. entraron contratos nuevos a una zona vaciada).
adminContribucionesRouter.post("/asignar", async (c) => {
  const r = await pool.query(
    `SELECT id, codigo FROM contribuciones WHERE estado IN ('pagada','en_proceso')
       AND contratos > (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = contribuciones.id)`);
  const out: Record<string, number> = {};
  for (const row of r.rows) {
    const a = await pool.query("SELECT asignar_contribucion($1) AS n", [row.id]);
    out[row.codigo] = a.rows[0].n;
  }
  await pool.query("SELECT refresh_financiamiento()");
  return c.json({ asignados: out });
});
