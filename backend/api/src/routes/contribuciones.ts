/**
 * Aportes — escritura.
 *
 *   POST /contribuciones                       cerrado (410): era la compra de lecturas por contrato, una venta
 *   POST /contribuciones/apoyo                 aporte al fondo común que sostiene la vigilancia (migración 206): único o
 *                                              mensual, sin contratos ni zona; `para` (entidad o región) es su destino
 *                                              sugerido: sale en la constancia y no decide qué se lee
 *   POST /contribuciones/:codigo/comprobante   adjunta la URL del comprobante subido (GCS vía /upload);
 *                                              exige probar titularidad (sesión dueña o correo del aporte)
 *   GET  /contribuciones/:codigo               estado, monto y fechas para quien tiene el código (público, sin datos de
 *                                              nadie: ni nombre, ni correo, ni mensaje)
 *   (las rutas /admin/* viven en routes/admin.ts)
 *
 * Reglas de independencia codificadas acá (docs/design/FINANCIA_UNA_AUDITORIA.md §6):
 *   · No existe ningún campo para elegir contratos ni entidades: un aporte va al fondo común y lo más grave se lee
 *     primero, aporte quien aporte.
 *   · Empresa con sanción vigente o que aparece como proveedor en alertas activas →
 *     se acepta el aporte pero `financiadores.visible = false` (sin ranking ni muro): lib/aportes.ts.
 */

import { Hono } from "hono";
import { z } from "zod";
import { esErrorPg, pool } from "../lib/db.js";
import { optionalAuth } from "../lib/auth.js";
import { exigirCaptcha, limiteEscritura } from "../lib/antibots.js";
import { BUCKETS_COMPROBANTE, escaparRegex } from "../lib/storage.js";
import { SIN_CACHE } from "../lib/http.js";
import { hayAporteEntidad } from "../lib/esquema.js";
import { entidadDeAporteSql, partidoDeAporteSql, marcarConflictoDeInteres } from "../lib/aportes.js";
import { mpPublicKey } from "../lib/mercadopago.js";

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
    // Yape, Plin o transferencia (lo que valida el panel). La tarjeta va aparte: routes/pagos.ts.
    configurado: Boolean(v.yape?.numero || v.plin?.numero || (Array.isArray(v.cuentas) && v.cuentas.length)),
    /** Pago con tarjeta por Mercado Pago (la clave pública es para el formulario del navegador). */
    tarjeta: mpPublicKey() ? { publicKey: mpPublicKey() as string } : null,
  };
}

const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

type Financiador = { tipo: "empresa" | "persona" | "organizacion"; nombrePublico?: string; ruc?: string; email?: string; logoUrl?: string };

/**
 * Quién aporta. Con sesión, el financiador de la cuenta (usuarios.financiador_id, migración 26) o el que tenga ese
 * uid. Sin sesión, siempre uno nuevo: emparejar por el RUC o el correo que manda el cliente (sin verificar) dejaba a
 * cualquiera cambiar el nombre y el logo públicos de un financiador ajeno (auditoría 2026-10-21). Con sesión no hace
 * falta repetir nombre/logo. Marca el conflicto de interés (regla 3: sanción vigente o proveedor con alertas activas).
 */
export async function resolverFinanciador(client: import("pg").PoolClient, uid: string | null, f: Financiador): Promise<number> {
  let cuenta: { financiador_id: number | null; correo: string | null; nombre_publico: string | null } | null = null;
  if (uid) {
    cuenta = (await client.query(
      `SELECT financiador_id, correo, nombre_publico FROM usuarios WHERE firebase_uid = $1`, [uid])).rows[0] ?? null;
  }
  const emailEfectivo = f.email ?? cuenta?.correo ?? (uid ? `${uid}@cuenta.vigia.local` : null);
  const fin = uid
    ? await client.query(
        `SELECT id, visible FROM financiadores
          WHERE ($2::bigint IS NOT NULL AND id = $2) OR firebase_uid = $1
          ORDER BY (id = $2) DESC, (firebase_uid = $1) DESC LIMIT 1`,
        [uid, cuenta?.financiador_id ?? null])
    : { rows: [] as { id: number; visible: boolean }[] };
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
  if (f.ruc) await marcarConflictoDeInteres(client, financiadorId, f.ruc);
  return financiadorId;
}

/**
 * Un logo sólo del bucket propio, como lo deja /api/upload (auditoría 2026-10-30): con cualquier URL, el podio y el
 * comprobante mostraban una imagen de otro sitio, que además sabía la IP de cada visitante.
 */
export const LOGO_PROPIO = /^https:\/\/storage\.googleapis\.com\/vigia-peru-reportes\/logos\/[A-Za-z0-9._-]{1,160}$/;
/**
 * Tope de un aporte por el formulario: el 25 % de la UIT 2026 (S/ 5,500). Hasta ahí, el registro del pago sustenta lo
 * recibido ante SUNAT; por encima hace falta un documento con fecha cierta, que se acuerda por correo.
 */
export const TOPE_APORTE = 1375;

// ─── POST /contribuciones (cerrado el 2026-10-30) ────────────────────────────
// Antes creaba la compra de N lecturas de una zona, una entidad o un partido a la tarifa vigente («S/ X por contrato»).
// Era la venta de un servicio: pedía RUC, comprobantes de pago y Libro de Reclamaciones, y además mezclaba las
// donaciones con un negocio ante SUNAT (auditoría legal del 2026-10-30). El usuario decidió que fuera una donación:
// todo aporte va al fondo común (POST /contribuciones/apoyo) y la zona o la entidad que mirabas es sólo su destino
// sugerido (`para`). Los aportes por contrato que ya existen siguen con su comprobante; el lote del administrador a
// nombre de Vigía Perú vive en routes/admin_procesar.ts.
contribucionesRouter.post("/", (c) =>
  c.json({ error: "lecturas_cerradas",
    detail: "Ya no se paga la lectura por contrato: tu aporte va al fondo común de la vigilancia, en /app/apoyar." }, 410));

// ─── POST /contribuciones/apoyo ──────────────────────────────────────────────
// «Ayúdanos a seguir vigilando» (migración 206): un aporte al fondo común que sostiene la vigilancia (la base de datos,
// los servidores, la captura de datos y la lectura a fondo de lo más grave). Sin contratos ni zona: nadie elige qué se
// lee. `para` (la entidad o la región que mirabas) es su destino sugerido: sale en la constancia y no decide nada.
// Mensual = lo que eliges hacer cada mes; con Yape, Plin o transferencia, cada mes es un aporte nuevo con el mismo
// trámite (con tarjeta, Mercado Pago lo cobra solo: routes/pagos.ts).
const ApoyoBody = z.object({
  montoPen: z.number().min(5).max(TOPE_APORTE),
  periodicidad: z.enum(["unica", "mensual"]),
  metodo: z.enum(["transferencia", "yape", "plin"]).default("yape"),
  financiador: z.object({
    tipo: z.enum(["empresa", "persona", "organizacion"]),
    nombrePublico: z.string().trim().min(2).max(80).optional(),
    ruc: z.string().regex(/^\d{11}$/).optional(),
    email: z.string().email().optional(),
  }),
  mensajePublico: z.string().trim().max(140).optional(),
  para: z.object({
    ruc: z.string().regex(/^\d{11}$/).optional(),
    ubigeo: z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/).optional(),
  }).optional(),
});

contribucionesRouter.post("/apoyo", limiteEscritura, exigirCaptcha, optionalAuth, async (c) => {
  const body = ApoyoBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
  const { montoPen, periodicidad, metodo, financiador: f, mensajePublico, para } = body.data;
  if ((f.tipo === "empresa" || f.tipo === "organizacion") && !f.ruc) {
    return c.json({ error: "ruc_required", detail: "Empresas y organizaciones deben indicar RUC" }, 400);
  }
  const uid = c.get("user")?.uid ?? null;
  if (!uid && !f.email) return c.json({ error: "email_required", detail: "Sin sesión necesitamos un correo para el comprobante" }, 400);
  // Sin medio de pago no se crea un aporte que no tiene cómo pagarse.
  const pagos = await getPagosConfig();
  if (!pagos.configurado) {
    return c.json({ error: "pagos_cerrados", detail: "Todavía no hay un medio de pago conectado. Mientras tanto, Vigía se sostiene con su capital semilla." }, 503);
  }
  const monto = Math.round(montoPen * 100) / 100;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const financiadorId = await resolverFinanciador(client, uid, f);
    const codigo = (await client.query("SELECT next_codigo_contribucion() AS c")).rows[0].c as string;
    await client.query(
      `INSERT INTO contribuciones (codigo, financiador_id, contratos, monto_pen, pasarela, mensaje_publico, tipo, periodicidad, para_ruc, para_ubigeo)
       VALUES ($1, $2, 0, $3, $4, $5, 'apoyo', $6, $7, $8)`,
      [codigo, financiadorId, monto, metodo, mensajePublico ?? null, periodicidad, para?.ruc ?? null, para?.ubigeo ?? null]);
    await client.query("COMMIT");
    return c.json({
      codigo,
      estado: "pendiente_pago",
      tipo: "apoyo",
      periodicidad,
      montoPen: monto,
      pago: { metodo, concepto: codigo, ...pagos },
    }, 201);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

// ─── POST /contribuciones/:codigo/comprobante ────────────────────────────────
// Los códigos son correlativos (VIG-2026-00001, 00002…) y públicos (URL del comprobante de impacto):
// el código solo NO prueba que el aporte sea tuyo. Hace falta UNA de estas pruebas de titularidad:
//   · sesión: `Authorization: Bearer <Firebase ID token>` de la cuenta dueña del aporte
//     (financiadores.firebase_uid, o usuarios.financiador_id — mismo criterio que /cuentas/me/impacto);
//   · correo: `email` en el cuerpo = el correo con el que se registró el aporte (financiadores.email),
//     sin distinguir mayúsculas ni espacios (mismo criterio que /cuentas/me/reclamar).
// Sin ninguna → 403 `titularidad_requerida`; con una que no coincide → 403 `titularidad_no_coincide`.
// La URL solo puede apuntar a un archivo subido por /api/upload como comprobante, en un bucket
// PROPIO (auditoría C4): antes aceptaba `<cualquier bucket>/comprobantes/…` y el panel admin lo
// descargaba y lo servía con el Content-Type que trajera (XSS almacenado). Hoy los comprobantes van
// al bucket privado (GCS_BUCKET_PRIVADO); se sigue aceptando la ruta vieja del bucket de documentos.
// El panel los lee con la cuenta de servicio de la API (routes/admin.ts, BUCKETS_COMPROBANTE).
const URL_COMPROBANTE = new RegExp(
  `^https://storage\\.googleapis\\.com/(${BUCKETS_COMPROBANTE.map(escaparRegex).join("|")})/comprobantes/[A-Za-z0-9._-]{1,120}$`);
const ComprobanteBody = z.object({
  url: z.string().max(400).regex(URL_COMPROBANTE),
  referencia: z.string().max(80).optional(),
  email: z.string().trim().max(254).optional(),
});

contribucionesRouter.post("/:codigo/comprobante", limiteEscritura, exigirCaptcha, optionalAuth, async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = ComprobanteBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const uid = c.get("user")?.uid ?? null;
  const email = body.data.email?.trim().toLowerCase() || null;
  if (!uid && !email) {
    return c.json({ error: "titularidad_requerida",
      detail: "Para adjuntar el comprobante inicia sesión con la cuenta del aporte o indica el correo con el que lo registraste." }, 403);
  }
  const dueno = await pool.query(
    `SELECT co.estado,
            COALESCE(($2::text IS NOT NULL AND (f.firebase_uid = $2
               OR EXISTS (SELECT 1 FROM usuarios u WHERE u.firebase_uid = $2 AND u.financiador_id = co.financiador_id)))
             OR ($3::text IS NOT NULL AND lower(btrim(f.email)) = $3), false) AS "esTitular"
       FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id
      WHERE co.codigo = $1`,
    [codigo, uid, email]);
  const fila = dueno.rows[0] as { estado: string; esTitular: boolean } | undefined;
  if (!fila) return c.json({ error: "not_found_or_not_pending" }, 404);
  if (!fila.esTitular) {
    return c.json({ error: "titularidad_no_coincide",
      detail: "El correo o la cuenta no coinciden con los del aporte." }, 403);
  }
  // Sólo los aportes que se pagan a mano: uno con tarjeta lo resuelve Mercado Pago, y una captura no debe ponerlo en la
  // lista del panel para validarlo a mano. Un archivo sirve para un solo aporte (índice único, migración 217).
  const r = await pool.query(
    `UPDATE contribuciones SET comprobante_url = $2, pasarela_ref = COALESCE($3, pasarela_ref)
     WHERE codigo = $1 AND estado = 'pendiente_pago' AND pasarela IN ('yape', 'plin', 'transferencia') RETURNING codigo`,
    [codigo, body.data.url, body.data.referencia ?? null]).catch((e) => {
      if (esErrorPg(e, "23505")) return null;
      throw e;
    });
  if (r === null) return c.json({ error: "comprobante_usado", detail: "Ese comprobante ya se adjuntó a otro aporte." }, 409);
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
  const conEntidad = await hayAporteEntidad();
  const r = await pool.query(
    `SELECT co.codigo, co.estado, co.contratos, co.monto_pen::float AS "montoPen", co.created_at AS "createdAt",
            co.pagada_at AS "pagadaAt", co.comprobante_url IS NOT NULL AS "tieneComprobante", z.nombre AS zona, co.ubigeo,
            ${entidadDeAporteSql("co", conEntidad)} AS entidad, ${partidoDeAporteSql("co", conEntidad)} AS partido,
            co.tipo, co.periodicidad, co.pasarela,
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id)::int AS asignados,
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id AND s.procesada_at IS NOT NULL)::int AS procesados
     FROM contribuciones co LEFT JOIN zonas z ON z.ubigeo = co.ubigeo WHERE co.codigo = $1`, [codigo]);
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", SIN_CACHE);
  return c.json(r.rows[0]);
});
