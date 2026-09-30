/**
 * Cuentas de usuario — perfil, configuración y "Mi impacto" (migración 26).
 * Diseño: docs/design/CUENTAS.md · plan 2026-09-16 § U3
 *
 *   GET    /cuentas/me            perfil + configuración (crea la fila si no existe); con la migración 30, también
 *                                 el perfil público: descripcion, sitioWeb, emailPublico, portadaUrl, redes ({} si no hay)
 *   PUT    /cuentas/me            { nombrePublico?, visible?, correo?, notificaciones?, logoUrl?, tipo?,
 *                                   descripcion?, sitioWeb?, emailPublico?, portadaUrl?, redes?, ruc? }
 *                                 El perfil público del aliado lo define QUIEN APORTA (el panel sólo modera):
 *                                 campo ausente = no se toca, "" = se borra; mismas reglas que la página pública
 *                                 (lib/perfilAliado.ts). Error → 400 {error: "perfil_invalido", campo, detalle}.
 *                                 `ruc` se fija una sola vez (otro distinto → 409 ruc_inmutable) y corre el mismo
 *                                 chequeo de conflicto de interés que POST /contribuciones (lib/aportes.ts).
 *   GET    /cuentas/me/impacto    mis aportes (progreso en vivo desde asignaciones/alertas; `entidad` si fue por entidad),
 *                                 mis denuncias (estado de moderación), zonas/entidades seguidas
 *   POST   /cuentas/me/seguir     { tipo: "zona"|"entidad", id }
 *   DELETE /cuentas/me/seguir     { tipo, id }
 *   POST   /cuentas/me/reclamar   { codigo, email } asocia a la cuenta un aporte hecho como invitado (código + correo usado)
 *   GET    /cuentas/me/exportar   JSON con todo lo que guardamos del usuario
 *   DELETE /cuentas/me            borra la cuenta: anonimiza el perfil de aliado, conserva aportes
 *
 * Todas requieren `Authorization: Bearer <Firebase ID token>`. Sin cuenta, nada de esto
 * hace falta: el sitio entero funciona igual (docs/design/CUENTAS.md).
 */

import { Hono } from "hono";
import { z } from "zod";
import { esErrorPg, pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { SIN_CACHE } from "../lib/http.js";
import { columnaAusente, conPerfilAliado, hayAporteEntidad, perfilEditableDesdeCuenta } from "../lib/esquema.js";
import {
  CAMPO_DEL_CHECK, CamposPerfil, esProblema, normalizarPerfil, problemaDeZod, setsDelPerfil, tocaPerfil,
} from "../lib/perfilAliado.js";
import { entidadDeAporteSql, marcarConflictoDeInteres } from "../lib/aportes.js";

export const cuentasRouter = new Hono();
// Todo es de la persona que entró: nunca en un CDN ni en la caché compartida (también los 401).
cuentasRouter.use("*", async (c, next) => {
  c.header("Cache-Control", SIN_CACHE);
  await next();
  c.res.headers.set("Cache-Control", SIN_CACHE);
});
cuentasRouter.use("*", requireAuth);

const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

// Perfil público (migración 30): sólo si las columnas existen y el rol público puede escribirlas (39).
// Si no, esas claves no salen y el frontend no ofrece editarlas (lo detecta por `redes`).
const COLS_PERFIL_PUBLICO = `,
         f.descripcion, f.sitio_web AS "sitioWeb", f.email_publico AS "emailPublico", f.portada_url AS "portadaUrl",
         COALESCE(f.redes, '{}'::jsonb) AS redes`;

const perfilSql = (conPerfil: boolean) => `
  SELECT u.firebase_uid AS uid, u.financiador_id AS "financiadorId",
         COALESCE(u.nombre_publico, f.nombre_publico) AS "nombrePublico",
         u.visible, u.zonas_seguidas AS "zonasSeguidas", u.entidades_seguidas AS "entidadesSeguidas",
         u.notificaciones, u.correo, u.created_at AS "createdAt", u.updated_at AS "updatedAt",
         f.slug, f.logo_url AS "logoUrl", f.tipo, f.ruc, f.visible AS "aliadoVisible", f.motivo_no_visible AS "motivoNoVisible",
         (SELECT json_agg(json_build_object('ubigeo', z.ubigeo, 'nombre', z.nombre, 'nivel', z.nivel) ORDER BY z.nombre)
            FROM zonas z WHERE z.ubigeo = ANY(u.zonas_seguidas)) AS "zonas",
         (SELECT json_agg(json_build_object('ruc', e.ruc, 'nombre', e.nombre) ORDER BY e.nombre)
            FROM entidades e WHERE e.ruc = ANY(u.entidades_seguidas)) AS "entidades"${conPerfil ? COLS_PERFIL_PUBLICO : ""}
  FROM usuarios u LEFT JOIN financiadores f ON f.id = u.financiador_id
  WHERE u.firebase_uid = $1`;

/** Crea la fila de `usuarios` si no existe; enlaza el financiador que ya tuviera ese uid (aportes previos con sesión). */
export async function asegurarUsuario(uid: string) {
  await pool.query(
    `INSERT INTO usuarios (firebase_uid, financiador_id)
     VALUES ($1, (SELECT id FROM financiadores WHERE firebase_uid = $1 LIMIT 1))
     ON CONFLICT (firebase_uid) DO UPDATE
       SET financiador_id = COALESCE(usuarios.financiador_id, EXCLUDED.financiador_id)`,
    [uid]);
}

async function perfil(uid: string) {
  await asegurarUsuario(uid);
  const editable = await perfilEditableDesdeCuenta();
  const { valor: r } = await conPerfilAliado((conPerfil) => pool.query(perfilSql(conPerfil && editable), [uid]));
  const p = r.rows[0];
  return { ...p, zonas: p.zonas ?? [], entidades: p.entidades ?? [] };
}

// ─── GET /cuentas/me ─────────────────────────────────────────────────────────
cuentasRouter.get("/me", async (c) => {
  const u = c.get("user");
  c.header("Cache-Control", "private, no-store");
  return c.json({ ...(await perfil(u.uid)), userId: u.userId });
});

// ─── PUT /cuentas/me ─────────────────────────────────────────────────────────
// RUC: "" o null cuentan como no enviado (un formulario que manda el campo vacío no es un error).
const Ruc = z.preprocess((v) => (v === "" || v === null ? undefined : typeof v === "string" ? v.trim() : v),
  z.string().regex(/^\d{11}$/).optional());

const PutBody = z.object({
  nombrePublico: z.string().trim().max(80).nullable().optional(),
  visible: z.boolean().optional(),
  correo: z.string().trim().email().nullable().optional().or(z.literal("").transform(() => null)),
  notificaciones: z.record(z.boolean()).optional(),
  logoUrl: z.string().url().nullable().optional(),
  tipo: z.enum(["empresa", "persona", "organizacion"]).optional(),
  ...CamposPerfil,
  ruc: Ruc,
});

// Aviso en palabras (503) si la base todavía no tiene lo necesario para guardar el perfil público:
// columnas de la migración 30 o permisos de la 39 para el rol público.
const PERFIL_NO_DISPONIBLE = {
  error: "sin_migracion",
  detail: "Todavía no podemos guardar tu perfil público: estamos terminando de habilitarlo. Inténtalo más tarde; el resto de tu cuenta sí se guarda.",
};

cuentasRouter.put("/me", async (c) => {
  const u = c.get("user");
  const body = PutBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    // Un problema en un campo del perfil (o el RUC): { campo, detalle } para marcarlo en el formulario.
    const problema = problemaDeZod(body.error);
    if (problema) return c.json({ error: "perfil_invalido", ...problema }, 400);
    return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
  }
  const b = body.data;
  const cambios = normalizarPerfil(b);
  if (esProblema(cambios)) return c.json({ error: "perfil_invalido", ...cambios }, 400);
  const conPerfil = tocaPerfil(cambios);
  if (conPerfil && !(await perfilEditableDesdeCuenta())) return c.json(PERFIL_NO_DISPONIBLE, 503);
  await asegurarUsuario(u.uid);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT financiador_id, correo FROM usuarios WHERE firebase_uid = $1 FOR UPDATE`, [u.uid]);
    let finId: number | null = cur.rows[0]?.financiador_id ?? null;

    // RUC: se fija una sola vez. Uno distinto del que ya tiene → 409; el mismo, no hay nada que cambiar.
    let rucNuevo: string | null = null;
    if (b.ruc) {
      const actual = finId
        ? (await client.query(`SELECT ruc FROM financiadores WHERE id = $1 FOR UPDATE`, [finId])).rows[0]?.ruc
        : null;
      const rucActual = typeof actual === "string" && actual.trim() ? actual.trim() : null;
      if (rucActual && rucActual !== b.ruc) {
        await client.query("ROLLBACK");
        return c.json({ error: "ruc_inmutable", detail: "Tu perfil ya tiene un RUC registrado y no se puede cambiar. Si es un error, escríbenos." }, 409);
      }
      if (!rucActual) rucNuevo = b.ruc;
    }

    // El perfil público de aliado (financiadores) se crea si el usuario quiere aparecer en el muro, pone
    // nombre/logo o define cualquier dato del perfil (descripción, web, correo, portada, redes, RUC), aunque
    // siga anónimo; si no, se queda sin fila (anónimo total).
    const quiereMuro = b.visible === true || (!!b.nombrePublico && b.nombrePublico.length >= 2) || !!b.logoUrl
      || conPerfil || rucNuevo !== null;
    if (!finId && quiereMuro) {
      const email = b.correo ?? cur.rows[0]?.correo ?? `${u.uid}@cuenta.vigia.local`;
      const ins = await client.query(
        `INSERT INTO financiadores (tipo, nombre_publico, slug, logo_url, email, firebase_uid, visible)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [b.tipo ?? "persona", b.nombrePublico || null,
         b.nombrePublico ? slugify(b.nombrePublico) + "-" + Math.random().toString(36).slice(2, 6) : null,
         b.logoUrl ?? null, email, u.uid, b.visible ?? false]);
      finId = ins.rows[0].id;
    } else if (finId) {
      await client.query(
        `UPDATE financiadores SET
           nombre_publico = CASE WHEN $2::boolean THEN $3 ELSE nombre_publico END,
           slug = CASE WHEN $2::boolean AND $3::text IS NOT NULL AND slug IS NULL THEN $4 ELSE slug END,
           logo_url = CASE WHEN $5::boolean THEN $6 ELSE logo_url END,
           tipo = COALESCE($7, tipo),
           -- visible solo si el usuario lo pide Y no hay conflicto de interés declarado
           visible = CASE WHEN $8::boolean IS NULL THEN visible
                          WHEN motivo_no_visible IS NOT NULL AND motivo_no_visible <> 'cuenta_borrada' THEN false
                          ELSE $8 END,
           email = COALESCE($9, email)
         WHERE id = $1`,
        [finId, b.nombrePublico !== undefined, b.nombrePublico ?? null,
         b.nombrePublico ? slugify(b.nombrePublico) + "-" + Math.random().toString(36).slice(2, 6) : null,
         b.logoUrl !== undefined, b.logoUrl ?? null, b.tipo ?? null, b.visible ?? null, b.correo ?? null]);
    }

    // Perfil público y RUC: sólo lo que llegó (columnas de lista cerrada, valores como parámetros).
    if (finId && (conPerfil || rucNuevo)) {
      const vals: unknown[] = [finId];
      const sets = setsDelPerfil(cambios, vals);
      if (rucNuevo) { vals.push(rucNuevo); sets.push(`ruc = COALESCE(ruc, $${vals.length})`); }
      await client.query(`UPDATE financiadores SET ${sets.join(", ")} WHERE id = $1`, vals);
    }
    // Al fijar el RUC, el mismo chequeo que POST /contribuciones: sanción vigente o alertas activas
    // → el aliado no aparece (visible = false, con el motivo).
    if (finId && rucNuevo) await marcarConflictoDeInteres(client, finId, rucNuevo);

    await client.query(
      `UPDATE usuarios SET
         financiador_id = COALESCE($2, financiador_id),
         nombre_publico = CASE WHEN $3::boolean THEN $4 ELSE nombre_publico END,
         visible = COALESCE($5, visible),
         correo = CASE WHEN $6::boolean THEN $7 ELSE correo END,
         notificaciones = COALESCE($8::jsonb, notificaciones),
         updated_at = now()
       WHERE firebase_uid = $1`,
      [u.uid, finId, b.nombrePublico !== undefined, b.nombrePublico ?? null, b.visible ?? null,
       b.correo !== undefined, b.correo ?? null, b.notificaciones ? JSON.stringify(b.notificaciones) : null]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    // 42501: el rol público todavía no puede escribir esas columnas (falta la migración 39). 42703: faltan (30).
    if (esErrorPg(e, "42501") || columnaAusente(e)) return c.json(PERFIL_NO_DISPONIBLE, 503);
    // 23514: algo pasó la validación de acá y no un CHECK de la 30.
    const campo = esErrorPg(e, "23514") ? CAMPO_DEL_CHECK[String((e as { constraint?: string }).constraint ?? "")] : undefined;
    if (campo) return c.json({ error: "perfil_invalido", campo, detalle: "Ese dato no tiene un formato válido. Revisa el enlace o el correo." }, 400);
    throw e;
  } finally {
    client.release();
  }
  c.header("Cache-Control", "private, no-store");
  return c.json({ ...(await perfil(u.uid)), userId: u.userId });
});

// ─── GET /cuentas/me/impacto ─────────────────────────────────────────────────
cuentasRouter.get("/me/impacto", async (c) => {
  const u = c.get("user");
  const p = await perfil(u.uid);
  const conEntidad = await hayAporteEntidad();
  const [aportes, denuncias, zonas] = await Promise.all([
    p.financiadorId
      ? pool.query(
          `SELECT co.codigo, co.estado, co.contratos, co.monto_pen::float AS "montoPen", co.created_at AS "createdAt",
                  co.pagada_at AS "pagadaAt", co.comprobante_url IS NOT NULL AS "tieneComprobante", co.comprobante_url AS "comprobanteUrl",
                  z.ubigeo, z.nombre AS zona, z.nivel, ${entidadDeAporteSql("co", conEntidad)} AS entidad,
                  (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id)::int AS asignados,
                  (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id AND s.procesada_at IS NOT NULL)::int AS procesados,
                  (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
                    WHERE s.contribucion_id = co.id AND alerta_publicada(a.estado)
                      AND EXISTS (SELECT 1 FROM banderas b WHERE b.alerta_id = a.id))::int AS senales,
                  (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
                    WHERE s.contribucion_id = co.id AND a.estado = 'revision')::int AS "enRevision",
                  (SELECT s.ocid FROM asignaciones s WHERE s.contribucion_id = co.id AND s.procesada_at IS NOT NULL
                    ORDER BY s.procesada_at LIMIT 1) AS "primerOcid"
           FROM contribuciones co JOIN zonas z ON z.ubigeo = co.ubigeo
           WHERE co.financiador_id = $1 ORDER BY co.created_at DESC`, [p.financiadorId])
      : Promise.resolve({ rows: [] as any[] }),
    pool.query(
      `SELECT id, categoria, left(descripcion, 160) AS descripcion, region, provincia, distrito, fecha, created_at AS "createdAt",
              COALESCE(moderacion_estado, 'pendiente') AS "moderacionEstado", confirmado, confirmaciones, convergencia_id AS "convergenciaId",
              foto_url AS "fotoUrl"
       FROM reportes_indexados WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [u.uid]).catch(() => ({ rows: [] as any[] })),
    p.zonasSeguidas?.length
      ? pool.query(
          `SELECT ubigeo, nivel, nombre, pendientes, financiados, procesados, senales, total_cola AS "totalCola", estado,
                  en_revision AS "enRevision", documentos_listos AS "documentosListos"
           FROM zona_estado WHERE ubigeo = ANY($1) ORDER BY nombre`, [p.zonasSeguidas])
      : Promise.resolve({ rows: [] as any[] }),
  ]);
  c.header("Cache-Control", "private, no-store");
  return c.json({
    perfil: p,
    aportes: aportes.rows,
    denuncias: denuncias.rows,
    zonasSeguidas: zonas.rows,
    entidadesSeguidas: p.entidades,
    resumen: {
      aportes: aportes.rows.length,
      contratosFinanciados: aportes.rows.filter((a: any) => ["pagada", "en_proceso", "procesada"].includes(a.estado)).reduce((n: number, a: any) => n + a.contratos, 0),
      procesados: aportes.rows.reduce((n: number, a: any) => n + a.procesados, 0),
      senales: aportes.rows.reduce((n: number, a: any) => n + a.senales, 0),
      denuncias: denuncias.rows.length,
    },
  });
});

// ─── POST/DELETE /cuentas/me/seguir ──────────────────────────────────────────
const SeguirBody = z.object({
  tipo: z.enum(["zona", "entidad"]),
  id: z.string().trim().min(2).max(20),
});

cuentasRouter.post("/me/seguir", async (c) => {
  const u = c.get("user");
  const body = SeguirBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const { tipo, id } = body.data;
  if (tipo === "zona" && !/^\d{2}(\d{2}(\d{2})?)?$/.test(id)) return c.json({ error: "invalid_ubigeo" }, 400);
  if (tipo === "entidad" && !/^\d{11}$/.test(id)) return c.json({ error: "invalid_ruc" }, 400);
  await asegurarUsuario(u.uid);
  const col = tipo === "zona" ? "zonas_seguidas" : "entidades_seguidas";
  await pool.query(
    `UPDATE usuarios SET ${col} = (SELECT array_agg(DISTINCT x) FROM unnest(array_append(${col}, $2)) x), updated_at = now()
     WHERE firebase_uid = $1`, [u.uid, id]);
  c.header("Cache-Control", "private, no-store");
  return c.json(await perfil(u.uid));
});

cuentasRouter.delete("/me/seguir", async (c) => {
  const u = c.get("user");
  const body = SeguirBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const { tipo, id } = body.data;
  const col = tipo === "zona" ? "zonas_seguidas" : "entidades_seguidas";
  await pool.query(`UPDATE usuarios SET ${col} = array_remove(${col}, $2), updated_at = now() WHERE firebase_uid = $1`, [u.uid, id]);
  c.header("Cache-Control", "private, no-store");
  return c.json(await perfil(u.uid));
});

// ─── POST /cuentas/me/reclamar — aporte hecho como invitado → mi cuenta ──────
// El código es público (está en la URL del comprobante); el correo con el que se aportó es privado:
// ambos juntos son la prueba de que el aporte es tuyo.
cuentasRouter.post("/me/reclamar", async (c) => {
  const u = c.get("user");
  const body = z.object({ codigo: z.string().trim().max(20), email: z.string().trim().email() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const codigo = body.data.codigo.toUpperCase();
  await asegurarUsuario(u.uid);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT co.id, co.financiador_id AS fin, f.email, f.firebase_uid AS uid FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id WHERE co.codigo = $1 FOR UPDATE`, [codigo]);
    const row = r.rows[0];
    if (!row) { await client.query("ROLLBACK"); return c.json({ error: "not_found" }, 404); }
    if (String(row.email).toLowerCase() !== body.data.email.toLowerCase()) { await client.query("ROLLBACK"); return c.json({ error: "email_mismatch", detail: "El correo no coincide con el usado en el aporte." }, 403); }
    if (row.uid && row.uid !== u.uid) { await client.query("ROLLBACK"); return c.json({ error: "otra_cuenta", detail: "Este aporte ya está asociado a otra cuenta." }, 409); }
    const mio = await client.query(`SELECT financiador_id FROM usuarios WHERE firebase_uid = $1`, [u.uid]);
    const finMio: number | null = mio.rows[0]?.financiador_id ?? null;
    if (!finMio) {
      await client.query(`UPDATE financiadores SET firebase_uid = $2 WHERE id = $1 AND firebase_uid IS NULL`, [row.fin, u.uid]);
      await client.query(`UPDATE usuarios SET financiador_id = $2, correo = COALESCE(correo, $3), updated_at = now() WHERE firebase_uid = $1`, [u.uid, row.fin, row.email]);
    } else if (finMio !== row.fin) {
      await client.query(`UPDATE contribuciones SET financiador_id = $2 WHERE id = $1`, [row.id, finMio]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  c.header("Cache-Control", "private, no-store");
  return c.json({ ok: true, codigo, perfil: await perfil(u.uid) });
});

// ─── GET /cuentas/me/exportar ────────────────────────────────────────────────
cuentasRouter.get("/me/exportar", async (c) => {
  const u = c.get("user");
  const p = await perfil(u.uid);
  const [aportes, asignaciones, denuncias] = await Promise.all([
    p.financiadorId
      ? pool.query(`SELECT co.codigo, co.estado, co.contratos, co.monto_pen::float AS "montoPen", co.ubigeo, co.created_at AS "createdAt",
                           co.pagada_at AS "pagadaAt", co.mensaje_publico AS "mensajePublico", co.pasarela
                    FROM contribuciones co WHERE co.financiador_id = $1 ORDER BY co.created_at`, [p.financiadorId])
      : Promise.resolve({ rows: [] as any[] }),
    p.financiadorId
      ? pool.query(`SELECT co.codigo, s.ocid, s.asignada_at AS "asignadaAt", s.procesada_at AS "procesadaAt", a.codigo AS "alertaCodigo", a.estado AS "alertaEstado"
                    FROM asignaciones s JOIN contribuciones co ON co.id = s.contribucion_id LEFT JOIN alertas a ON a.id = s.alerta_id
                    WHERE co.financiador_id = $1 ORDER BY s.asignada_at`, [p.financiadorId])
      : Promise.resolve({ rows: [] as any[] }),
    pool.query(`SELECT id, modo, categoria, descripcion, region, provincia, distrito, fecha, created_at AS "createdAt",
                       moderacion_estado AS "moderacionEstado", anonimo, contacto_email AS "contactoEmail", media_urls AS "mediaUrls"
                FROM reportes_indexados WHERE user_id = $1 ORDER BY created_at`, [u.uid]).catch(() => ({ rows: [] as any[] })),
  ]);
  c.header("Cache-Control", "private, no-store");
  c.header("Content-Disposition", `attachment; filename="vigia-peru-mis-datos-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json({
    exportadoAt: new Date().toISOString(),
    cuenta: { uid: u.uid, userId: u.userId, correo: p.correo, createdAt: p.createdAt },
    perfilPublico: {
      nombrePublico: p.nombrePublico, slug: p.slug, logoUrl: p.logoUrl, tipo: p.tipo, ruc: p.ruc, visible: p.visible, aliadoVisible: p.aliadoVisible,
      descripcion: p.descripcion ?? null, sitioWeb: p.sitioWeb ?? null, emailPublico: p.emailPublico ?? null,
      portadaUrl: p.portadaUrl ?? null, redes: p.redes ?? {},
    },
    configuracion: { notificaciones: p.notificaciones, zonasSeguidas: p.zonasSeguidas, entidadesSeguidas: p.entidadesSeguidas },
    aportes: aportes.rows,
    contratosAsignados: asignaciones.rows,
    denuncias: denuncias.rows,
    nota: "Los aportes y los contratos analizados con ellos son públicos por diseño (comprobante de impacto). Al borrar la cuenta se anonimiza el perfil de aliado y se conservan los aportes.",
  });
});

// ─── DELETE /cuentas/me ──────────────────────────────────────────────────────
cuentasRouter.delete("/me", async (c) => {
  const u = c.get("user");
  const r = await pool.query(`SELECT borrar_cuenta($1) AS aportes`, [u.uid]);
  c.header("Cache-Control", "private, no-store");
  return c.json({ ok: true, aportesConservados: r.rows[0]?.aportes ?? 0,
    mensaje: "Cuenta borrada. Tus aportes siguen siendo públicos como 'Anónimo'; tus denuncias quedan sin autor. Para eliminar también la credencial de acceso, borra el usuario en el cliente." });
});
