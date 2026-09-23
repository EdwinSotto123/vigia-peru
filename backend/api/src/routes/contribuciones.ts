/**
 * "Financia una auditoría" — escritura.
 *
 *   POST /contribuciones                       crea una contribución en `pendiente_pago` (fase 0: transferencia/Yape)
 *   POST /contribuciones/:codigo/comprobante   adjunta la URL del comprobante subido (GCS vía /upload)
 *   GET  /contribuciones/:codigo               estado (privado: incluye email enmascarado) — requiere token
 *   (las rutas /admin/* viven en routes/admin.ts)
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
import { alertaNoDemo } from "../lib/publicacion.js";

export const contribucionesRouter = new Hono();

/** Config pública de pagos (Yape/Plin/cuentas/QR) editada desde /admin/pagos. */
export async function getPagosConfig() {
  const r = await pool.query("SELECT valor FROM ajustes WHERE clave = 'pagos'");
  const v = r.rows[0]?.valor ?? {};
  return {
    yape: v.yape?.numero ? { numero: v.yape.numero, titular: v.yape.titular ?? "", qrUrl: v.yape.qr_url || null } : null,
    plin: v.plin?.numero ? { numero: v.plin.numero, titular: v.plin.titular ?? "", qrUrl: v.plin.qr_url || null } : null,
    cuentas: Array.isArray(v.cuentas) ? v.cuentas : [],
    instrucciones: v.instrucciones || "Transfiere el monto exacto indicando el código de tu aporte como concepto y sube el comprobante. Validamos en menos de 48 h.",
    contactoEmail: v.contacto_email || null,
    configurado: Boolean(v.yape?.numero || v.plin?.numero || (Array.isArray(v.cuentas) && v.cuentas.length)),
  };
}

const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

const CrearBody = z.object({
  ubigeo: z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/),
  contratos: z.number().int().min(5).max(50_000),
  financiador: z.object({
    tipo: z.enum(["empresa", "persona", "organizacion"]),
    nombrePublico: z.string().trim().min(2).max(80).optional(),   // ausente = anónimo
    ruc: z.string().regex(/^\d{11}$/).optional(),
    email: z.string().email().optional(),          // obligatorio sin sesión; con sesión sale de la cuenta
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
  const uid = c.get("user")?.uid ?? null;
  if (!uid && !f.email) return c.json({ error: "email_required", detail: "Sin sesión necesitamos un correo para el comprobante" }, 400);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const zona = await client.query("SELECT nombre FROM zonas WHERE ubigeo = $1", [ubigeo]);
    if (!zona.rows.length) { await client.query("ROLLBACK"); return c.json({ error: "zona_not_found" }, 404); }

    // Financiador: con sesión, el de la cuenta (usuarios.financiador_id, migración 26) o el que tenga ese uid;
    // sin sesión, por (ruc|email) como invitado. Con sesión no hace falta repetir nombre/logo.
    let cuenta: { financiador_id: number | null; correo: string | null; nombre_publico: string | null } | null = null;
    if (uid) {
      cuenta = (await client.query(
        `SELECT financiador_id, correo, nombre_publico FROM usuarios WHERE firebase_uid = $1`, [uid])).rows[0] ?? null;
    }
    const emailEfectivo = f.email ?? cuenta?.correo ?? (uid ? `${uid}@cuenta.vigia.local` : null);
    let fin = await client.query(
      `SELECT id, visible FROM financiadores
        WHERE ($5::bigint IS NOT NULL AND id = $5)
           OR ($1::text IS NOT NULL AND firebase_uid = $1)
           OR ($1::text IS NULL AND (($2::text IS NOT NULL AND ruc = $2) OR (email = $3 AND tipo = $4)))
        ORDER BY (id = $5) DESC, (firebase_uid = $1) DESC LIMIT 1`,
      [uid, f.ruc ?? null, emailEfectivo, f.tipo, cuenta?.financiador_id ?? null]);
    let financiadorId: number;
    if (fin.rows.length) {
      financiadorId = fin.rows[0].id;
      await client.query(
        `UPDATE financiadores SET nombre_publico = COALESCE($2, nombre_publico), logo_url = COALESCE($3, logo_url),
                ruc = COALESCE(ruc, $5), firebase_uid = COALESCE(firebase_uid, $4) WHERE id = $1`,
        [financiadorId, f.nombrePublico ?? null, f.logoUrl ?? null, uid, f.ruc ?? null]);
    } else {
      const nombre = f.nombrePublico ?? cuenta?.nombre_publico ?? null;
      const slug = nombre ? slugify(nombre) + "-" + Math.random().toString(36).slice(2, 6) : null;
      const ins = await client.query(
        `INSERT INTO financiadores (tipo, nombre_publico, slug, ruc, logo_url, email, firebase_uid)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [f.tipo, nombre, slug, f.ruc ?? null, f.logoUrl ?? null, emailEfectivo, uid]);
      financiadorId = ins.rows[0].id;
    }
    if (uid) {
      await client.query(
        `INSERT INTO usuarios (firebase_uid, financiador_id) VALUES ($1, $2)
         ON CONFLICT (firebase_uid) DO UPDATE SET financiador_id = COALESCE(usuarios.financiador_id, EXCLUDED.financiador_id), updated_at = now()`,
        [uid, financiadorId]).catch(() => { /* sin migración 26 */ });
    }

    // Conflicto de interés (regla 3): sanción vigente o proveedor con alertas en la zona.
    if (f.ruc) {
      const conflicto = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM osce_sancionados s WHERE s.ruc = $1 AND (s.fecha_hasta IS NULL OR s.fecha_hasta >= current_date)) AS sancionado,
           EXISTS (SELECT 1 FROM alertas a WHERE a.proveedor_ruc = $1 AND a.estado = 'activa' AND ${alertaNoDemo("a")}) AS con_alertas`,
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

    const pagos = await getPagosConfig();
    return c.json({
      codigo,
      estado: "pendiente_pago",
      montoPen: monto,
      contratos,
      zona: zona.rows[0].nombre,
      // Fase 0: instrucciones de pago manual, editables desde el panel admin (ajustes.pagos).
      pago: { metodo, concepto: codigo, ...pagos },
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
  // No hay envío de correos: el mensaje no puede prometer un aviso. El estado se consulta con el código
  // (GET /contribuciones/:codigo y el comprobante público /financiamiento/impacto/:codigo).
  return c.json({
    ok: true, codigo, estado: "pendiente_pago",
    mensaje: `Comprobante recibido. Lo validamos en menos de 48 h; consulta el estado de tu aporte con el código ${codigo}.`,
  });
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
