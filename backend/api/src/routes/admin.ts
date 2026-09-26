/**
 * Panel admin de "Financia una auditoría". Todo bajo /admin, protegido por
 * `x-admin-token` (secreto `admin-token`). El frontend nunca expone el token:
 * sólo su servidor lo tiene y proxea vía /api/admin/*, con el perfil en `x-admin-rol`.
 *
 *   GET   /admin/ping                                  valida el token
 *   GET   /admin/resumen                               KPIs, serie diaria, pendientes, cola (revisor: sin montos ni financiadores)
 *   GET   /admin/contribuciones?estado=pendiente_pago|todas&q=
 *   GET   /admin/contribuciones/:codigo                detalle privado (email, comprobante, asignaciones)
 *   GET   /admin/contribuciones/:codigo/comprobante    stream del comprobante desde GCS (bucket privado)
 *   POST  /admin/contribuciones/:codigo/validar        → pagada + asignación FIFO
 *   POST  /admin/contribuciones/:codigo/rechazar       {motivo}
 *   PATCH /admin/contribuciones/:codigo                {notaAdmin}
 *   GET   /admin/financiadores                         (+ perfil público y `perfil`: ¿está la migración 30?)
 *   PATCH /admin/financiadores/:id                     {visible, motivoNoVisible, nombrePublico, logoUrl,
 *                                                       descripcion, sitioWeb, emailPublico, portadaUrl, redes}
 *   GET   /admin/config/pagos · PUT /admin/config/pagos
 *   GET   /admin/log                                   (revisor: sin plata, configuración ni equipo)
 *   POST  /admin/asignar                               re-asigna abiertas + refresh (lo llama Cloud Scheduler)
 *   GET   /admin/procesamientos?estado=                monitor del dispatcher (+ worker, error, latido)
 *   POST  /admin/procesamientos/:ocid/reencolar        vuelve a encolar (intentos=0)
 *   GET   /admin/clasificacion/resumen                 tipo × etapa × procesable + motivos (migración 13)
 *   GET   /admin/cobertura                             por mes: record completo, docs vigentes en GCS, análisis; lotes (migración 16)
 *   GET   /admin/pedidos · POST /admin/pedidos/:id/reintentar   pedidos de descarga (migración 15)
 *   + admin_revision.ts  (/revision, /alertas/:id/estado, /config/self_eval)
 *   + admin_operacion.ts (/operacion, /procesamientos/:ocid/reanalizar, /cobertura/progreso)
 *   + admin_procesar.ts  (GET /procesar-lote/preview, POST /procesar-lote — a nombre de Vigía Perú, sin pasarela)
 *   + admin_equipo.ts    (/equipo: miembros del panel y su perfil, admin o revisor — migración 29)
 */

import { Hono } from "hono";
import { z } from "zod";
// Pool propio del panel (lib/db.ts): 120 s por sentencia y sus propias credenciales si existen.
import { OCID_CANDIDATOS, esErrorPg, poolAdmin as pool } from "../lib/db.js";
import { storage, ubicarComprobante } from "../lib/storage.js";
import { SIN_CACHE } from "../lib/http.js";
import { actor, esRevisor, log, tokenAdminValido } from "../lib/adminlog.js";
import { dispatchNow } from "../lib/dispatcher.js";
import { invalidarMemosEnTodas } from "../lib/cache.js";
import { ingestaConvocatorias, saludRelay } from "../lib/salud.js";
import {
  alcanceORespaldo, CLAVES_RED, columnaAusente, conPerfilAliado, CORREO_PUBLICO, enlaceDeRed, perfilAliadoDisponible,
  REDES_ALIADO, urlHttps, type RedAliado,
} from "./financiamiento.js";
import { adminRevisionRouter } from "./admin_revision.js";
import { adminOperacionRouter } from "./admin_operacion.js";
import { adminProcesarRouter } from "./admin_procesar.js";
import { adminEquipoRouter } from "./admin_equipo.js";

export const adminRouter = new Hono();

// Pedidos que no cambian nada público: no vacían cachés (el último ingreso al panel es sólo una marca).
const SIN_INVALIDAR = /\/equipo\/ingreso\//;

adminRouter.use("*", async (c, next) => {
  // Nada del panel se guarda en un navegador ni en el CDN de Firebase Hosting.
  c.header("Cache-Control", SIN_CACHE);
  if (!tokenAdminValido(c)) return c.json({ error: "forbidden" }, 403);
  await next();
  if (!c.res.headers.get("Cache-Control")?.includes("no-store")) c.res.headers.set("Cache-Control", SIN_CACHE);
  // Toda escritura del panel (validar un aporte, publicar/descartar una alerta, cambiar el alcance…)
  // vacía las cachés en memoria de esta instancia y avisa a las demás (lib/cache.ts: ≤ ~2 s).
  const metodo = c.req.method;
  if (metodo === "GET" || metodo === "HEAD" || metodo === "OPTIONS" || c.res.status >= 400) return;
  if (SIN_INVALIDAR.test(c.req.path)) return;
  await invalidarMemosEnTodas();
});

adminRouter.get("/ping", (c) => c.json({ ok: true }));

// U4: cola de revisión humana + umbrales (admin_revision.ts) y operación (admin_operacion.ts).
adminRouter.route("/", adminRevisionRouter);
adminRouter.route("/", adminOperacionRouter);
// U6: procesar un lote a nombre de Vigía Perú desde el panel, sin pasarela (admin_procesar.ts).
adminRouter.route("/", adminProcesarRouter);
// Equipo del panel: quién entra y con qué perfil (admin_equipo.ts, migración 29).
adminRouter.route("/", adminEquipoRouter);

// ─── Resumen ─────────────────────────────────────────────────────────────────
adminRouter.get("/resumen", async (c) => {
  const [kpi, serie, porEstado, cola, top, alcance] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT count(*) FROM contribuciones WHERE estado = 'pendiente_pago')::int                        AS "pendientesValidar",
        (SELECT count(*) FROM contribuciones WHERE estado = 'pendiente_pago' AND comprobante_url IS NOT NULL)::int AS "pendientesConComprobante",
        (SELECT COALESCE(sum(monto_pen),0) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada'))::float AS "montoConfirmadoPen",
        (SELECT COALESCE(sum(contratos),0) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada'))::int   AS "contratosFinanciados",
        (SELECT COALESCE(sum(monto_pen),0) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada') AND pagada_at >= date_trunc('month', now()))::float AS "montoMesPen",
        (SELECT count(*) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada') AND pagada_at >= now() - interval '7 days')::int AS "aportes7d",
        (SELECT count(DISTINCT financiador_id) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada'))::int AS financiadores,
        (SELECT count(*) FROM financiadores WHERE NOT visible)::int                                        AS "financiadoresOcultos",
        (SELECT count(*) FROM asignaciones)::int                                                          AS asignados,
        (SELECT count(*) FROM asignaciones WHERE procesada_at IS NOT NULL)::int                           AS procesados,
        (SELECT count(*) FROM asignaciones s JOIN alertas a ON a.id = s.alerta_id
           WHERE alerta_publicada(a.estado) AND EXISTS (SELECT 1 FROM banderas b WHERE b.alerta_id = a.id))::int AS "senales",
        (SELECT count(*) FROM alertas WHERE estado = 'revision')::int                                     AS "enRevision",
        (SELECT count(*) FROM contribuciones WHERE estado IN ('pagada','en_proceso')
           AND contratos > (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = contribuciones.id))::int AS "esperandoContratos"`),
    pool.query(`
      SELECT d::date AS dia,
             COALESCE(sum(co.monto_pen) FILTER (WHERE co.estado IN ('pagada','en_proceso','procesada')),0)::float AS monto,
             count(co.id) FILTER (WHERE co.estado IN ('pagada','en_proceso','procesada'))::int AS aportes,
             count(co.id) FILTER (WHERE co.estado = 'pendiente_pago')::int AS pendientes
      FROM generate_series(current_date - 29, current_date, '1 day') d
      LEFT JOIN contribuciones co ON COALESCE(co.pagada_at, co.created_at)::date = d::date
      GROUP BY d ORDER BY d`),
    pool.query(`SELECT estado, count(*)::int AS n, COALESCE(sum(monto_pen),0)::float AS monto FROM contribuciones GROUP BY estado`),
    pool.query(`SELECT ubigeo, nombre, estado, pendientes, financiados, procesados, total_cola AS "totalCola"
                FROM zona_estado WHERE nivel = 'departamento' AND total_cola > 0 ORDER BY total_cola DESC LIMIT 10`),
    pool.query(`SELECT nombre, tipo, contratos_financiados AS "contratosFinanciados", contratos_procesados AS "contratosProcesados",
                       senales_halladas AS "senalesHalladas", en_revision AS "enRevision"
                FROM ranking_impacto ORDER BY contratos_financiados DESC LIMIT 5`),
    // count(*) FROM cola_auditoria cuesta ~130 ms (procesamiento_activo() por fila): se reusa el de
    // getAlcance (caché 60 s; toda escritura del panel la vacía). Con la base fallando, cola 0.
    alcanceORespaldo(),
  ]);
  const colaGlobal = alcance.colaFinanciable;
  if (esRevisor(c)) {
    // El revisor no ve plata ni quién financia: montos en null y sin el ranking de financiadores.
    // Quedan los conteos de procesamiento, señales, cola y revisión.
    return c.json({
      kpi: { ...kpi.rows[0], montoConfirmadoPen: null, montoMesPen: null, colaGlobal },
      serie: serie.rows.map((r) => ({ ...r, monto: null })),
      porEstado: porEstado.rows.map((r) => ({ ...r, monto: null })),
      cola: cola.rows,
      top: [],
    });
  }
  return c.json({ kpi: { ...kpi.rows[0], colaGlobal }, serie: serie.rows, porEstado: porEstado.rows, cola: cola.rows, top: top.rows });
});

// ─── Contribuciones ──────────────────────────────────────────────────────────
adminRouter.get("/contribuciones", async (c) => {
  const url = new URL(c.req.url);
  const estado = url.searchParams.get("estado") ?? "pendiente_pago";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const vals: any[] = [];
  const conds: string[] = [];
  if (estado !== "todas") { vals.push(estado); conds.push(`co.estado = $${vals.length}`); }
  if (q) { vals.push(`%${q}%`); conds.push(`(lower(co.codigo) LIKE $${vals.length} OR lower(f.nombre_publico) LIKE $${vals.length} OR lower(f.email) LIKE $${vals.length} OR f.ruc LIKE $${vals.length} OR lower(z.nombre) LIKE $${vals.length})`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await pool.query(
    `SELECT co.codigo, co.estado, co.contratos, co.monto_pen::float AS "montoPen", co.pasarela, co.pasarela_ref AS "pasarelaRef",
            co.comprobante_url IS NOT NULL AS "tieneComprobante", co.created_at AS "createdAt", co.pagada_at AS "pagadaAt",
            co.validada_por AS "validadaPor", co.mensaje_publico AS "mensajePublico", co.nota_admin AS "notaAdmin",
            z.nombre AS zona, z.nivel, co.ubigeo,
            f.id AS "financiadorId", f.tipo, f.nombre_publico AS "nombrePublico", f.ruc, f.email, f.visible, f.motivo_no_visible AS "motivoNoVisible",
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id)::int AS asignados,
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id AND s.procesada_at IS NOT NULL)::int AS procesados
     FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id JOIN zonas z ON z.ubigeo = co.ubigeo
     ${where} ORDER BY co.created_at DESC LIMIT 300`, vals);
  return c.json({ data: r.rows });
});

adminRouter.get("/contribuciones/:codigo", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const h = await pool.query(
    `SELECT co.*, co.monto_pen::float AS "montoPen", z.nombre AS zona, z.nivel,
            f.tipo, f.nombre_publico AS "nombrePublico", f.ruc, f.email, f.logo_url AS "logoUrl", f.visible, f.motivo_no_visible AS "motivoNoVisible", f.slug
     FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id JOIN zonas z ON z.ubigeo = co.ubigeo
     WHERE co.codigo = $1`, [codigo]);
  if (!h.rows.length) return c.json({ error: "not_found" }, 404);
  const a = await pool.query(
    `SELECT s.ocid, s.asignada_at AS "asignadaAt", s.procesada_at AS "procesadaAt", cv.objeto AS titulo, e.nombre AS entidad, al.codigo AS "alertaCodigo", al.score
     FROM asignaciones s JOIN contribuciones co ON co.id = s.contribucion_id JOIN convocatorias cv ON cv.ocid = s.ocid
     LEFT JOIN entidades e ON e.ruc = cv.entidad_ruc LEFT JOIN alertas al ON al.id = s.alerta_id
     WHERE co.codigo = $1 ORDER BY s.asignada_at`, [codigo]);
  const lg = await pool.query(`SELECT actor, accion, detalle, created_at AS "createdAt" FROM admin_log WHERE objeto = $1 ORDER BY created_at DESC LIMIT 20`, [`contribucion:${codigo}`]);
  const row = h.rows[0];
  return c.json({ ...row, monto_pen: undefined, asignaciones: a.rows, log: lg.rows });
});

// Stream del comprobante (bucket privado): el admin lo ve sin URL pública. Auditoría C4 (XSS
// almacenado): sólo se lee de los buckets propios (lib/storage.ts, BUCKETS_COMPROBANTE; antes
// cualquier bucket y, si la URL no era de GCS, un redirect abierto), sólo se sirven imágenes y PDF
// (lo demás, 415) y siempre con `nosniff` + `CSP: sandbox`: aunque el objeto dijera text/html, el
// navegador no lo ejecuta como página del panel.
const TIPOS_COMPROBANTE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const MAX_COMPROBANTE = 15 * 1024 * 1024;

adminRouter.get("/contribuciones/:codigo/comprobante", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const r = await pool.query("SELECT comprobante_url FROM contribuciones WHERE codigo = $1", [codigo]);
  const url: string | null = r.rows[0]?.comprobante_url ?? null;
  if (!url) return c.json({ error: "sin_comprobante" }, 404);
  const donde = ubicarComprobante(url);
  if (!donde) return c.json({ error: "comprobante_fuera_de_bucket", detail: "El comprobante no está en un bucket de Vigía: no se abre." }, 404);
  const file = storage.bucket(donde.bucket).file(donde.ruta);
  const [meta] = await file.getMetadata();
  const tipo = String(meta.contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = TIPOS_COMPROBANTE[tipo];
  if (!ext) return c.json({ error: "tipo_no_permitido", detail: "Sólo se muestran comprobantes en imagen (JPG, PNG, WEBP) o PDF." }, 415);
  if (Number(meta.size ?? 0) > MAX_COMPROBANTE) return c.json({ error: "comprobante_demasiado_grande" }, 413);
  const [buf] = await file.download();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": tipo,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": SIN_CACHE,
      // El visor de PDF de Chrome no abre dentro de un documento con sandbox: el PDF se descarga.
      "Content-Disposition": `${ext === "pdf" ? "attachment" : "inline"}; filename="comprobante-${codigo.replace(/[^A-Z0-9-]/g, "")}.${ext}"`,
    },
  });
});

adminRouter.post("/contribuciones/:codigo/validar", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = await c.req.json().catch(() => ({}));
  const who = actor(c);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE contribuciones SET estado = 'pagada', pagada_at = now(), validada_por = $2,
              pasarela_ref = COALESCE($3, pasarela_ref), nota_admin = COALESCE($4, nota_admin)
       WHERE codigo = $1 AND estado = 'pendiente_pago' RETURNING id`,
      [codigo, who, typeof body?.referencia === "string" ? body.referencia : null, typeof body?.nota === "string" ? body.nota : null]);
    if (!r.rows.length) { await client.query("ROLLBACK"); return c.json({ error: "not_found_or_not_pending" }, 404); }
    const asig = await client.query("SELECT asignar_contribucion($1) AS n", [r.rows[0].id]);
    await client.query("COMMIT");
    await log(who, "validar", `contribucion:${codigo}`, { asignados: asig.rows[0].n });
    // El refresco va DESPUÉS del COMMIT (auditoría A1): dentro de la transacción retenía los bloqueos
    // de la validación todo lo que tardaban las vistas materializadas.
    await pool.query("SELECT refresh_financiamiento()").catch((e) => console.warn(`[admin] refresh tras validar falló: ${(e as Error).message}`));
    return c.json({ ok: true, codigo, estado: asig.rows[0].n > 0 ? "en_proceso" : "pagada", asignados: asig.rows[0].n });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e; // index.ts lo registra con el requestId; la respuesta no lleva el mensaje interno
  } finally {
    client.release();
  }
});

adminRouter.post("/contribuciones/:codigo/rechazar", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = await c.req.json().catch(() => ({}));
  const motivo = typeof body?.motivo === "string" ? body.motivo.slice(0, 300) : null;
  const r = await pool.query(
    `UPDATE contribuciones SET estado = 'rechazada', rechazada_motivo = $2, validada_por = $3 WHERE codigo = $1 AND estado = 'pendiente_pago' RETURNING codigo`,
    [codigo, motivo, actor(c)]);
  if (!r.rows.length) return c.json({ error: "not_found_or_not_pending" }, 404);
  await log(actor(c), "rechazar", `contribucion:${codigo}`, { motivo });
  return c.json({ ok: true, codigo, estado: "rechazada" });
});

adminRouter.patch("/contribuciones/:codigo", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = z.object({ notaAdmin: z.string().max(1000).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  await pool.query("UPDATE contribuciones SET nota_admin = $2 WHERE codigo = $1", [codigo, body.data.notaAdmin ?? null]);
  return c.json({ ok: true });
});

// ─── Financiadores ───────────────────────────────────────────────────────────
// Perfil público (migración 30): descripción, web, correo de CONTACTO (`email_publico`; `email` es el
// del pago), redes y portada. Sin las columnas, la lista sale con el perfil vacío y `perfil: false`
// (el panel avisa y no deja editarlo) y un PATCH que lo toca responde 503 en palabras, no un 500.
const COLS_PERFIL_ADMIN = `f.descripcion, f.sitio_web AS "sitioWeb", f.email_publico AS "emailPublico", f.redes, f.portada_url AS "portadaUrl"`;
const COLS_PERFIL_VACIO = `NULL::text AS descripcion, NULL::text AS "sitioWeb", NULL::text AS "emailPublico", '{}'::jsonb AS redes, NULL::text AS "portadaUrl"`;

adminRouter.get("/financiadores", async (c) => {
  const { valor: r, perfil } = await conPerfilAliado((conPerfil) => pool.query(
    `SELECT f.id, f.tipo, f.nombre_publico AS "nombrePublico", f.slug, f.ruc, f.email, f.logo_url AS "logoUrl", f.visible, f.motivo_no_visible AS "motivoNoVisible", f.created_at AS "createdAt",
            ${conPerfil ? COLS_PERFIL_ADMIN : COLS_PERFIL_VACIO},
            (SELECT count(*) FROM contribuciones co WHERE co.financiador_id = f.id)::int AS aportes,
            (SELECT COALESCE(sum(contratos),0) FROM contribuciones co WHERE co.financiador_id = f.id AND co.estado IN ('pagada','en_proceso','procesada'))::int AS "contratosFinanciados",
            (SELECT COALESCE(sum(monto_pen),0) FROM contribuciones co WHERE co.financiador_id = f.id AND co.estado IN ('pagada','en_proceso','procesada'))::float AS "montoPen",
            EXISTS (SELECT 1 FROM osce_sancionados s WHERE s.ruc = f.ruc AND (s.fecha_hasta IS NULL OR s.fecha_hasta >= current_date)) AS "sancionVigente",
            EXISTS (SELECT 1 FROM alertas a WHERE a.proveedor_ruc = f.ruc AND a.estado = 'activa') AS "alertasActivas"
     FROM financiadores f ORDER BY f.created_at DESC LIMIT 500`));
  return c.json({ data: r.rows, perfil });
});

const SIN_MIGRACION_30 = {
  error: "sin_migracion",
  detail: "El perfil público todavía no se puede guardar: falta aplicar la migración 30 (perfil del aliado) en la base. Nombre, logo y visibilidad sí se pueden cambiar.",
};

// Perfil: campo ausente = no se toca; "" = se borra. Estos topes son del texto crudo; la regla fina
// (280 caracteres, https, dominio de cada red) va en perfilDelCuerpo.
const Enlace = z.string().max(500).optional();
const FinanciadorPatch = z.object({
  visible: z.boolean().optional(),
  motivoNoVisible: z.string().max(200).nullable().optional(),
  nombrePublico: z.string().max(80).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  descripcion: z.string().max(1000).optional(),
  sitioWeb: Enlace,
  emailPublico: z.string().max(254).optional(),
  portadaUrl: Enlace,
  redes: z.object({ facebook: Enlace, instagram: Enlace, linkedin: Enlace, x: Enlace, tiktok: Enlace, youtube: Enlace }).strict().optional(),
});
type FinanciadorPatch = z.infer<typeof FinanciadorPatch>;

/** Campo del API → columna de `financiadores` (lista cerrada: es lo único que entra en el SET). */
const COL_PERFIL = { descripcion: "descripcion", sitioWeb: "sitio_web", emailPublico: "email_publico", portadaUrl: "portada_url" } as const;
type CampoPerfil = keyof typeof COL_PERFIL;
interface CambiosPerfil {
  campos: Partial<Record<CampoPerfil, string | null>>;
  poner: Partial<Record<RedAliado, string>>;
  quitar: RedAliado[];
}

/** El primer problema del cuerpo, en palabras: el panel lo muestra tal cual. */
function problemaDeZod(e: z.ZodError): string {
  const i = e.issues[0];
  const campo = String(i?.path[0] ?? "");
  if (campo === "redes") {
    return i.code === "unrecognized_keys"
      ? `Sólo se aceptan estas redes: ${CLAVES_RED.map((r) => REDES_ALIADO[r].nombre).join(", ")}.`
      : "Cada red va como un enlace de hasta 500 caracteres.";
  }
  if (campo === "descripcion") return "La descripción es demasiado larga: el máximo es 280 caracteres.";
  if (campo === "emailPublico") return "El correo de contacto no es válido.";
  if (campo === "sitioWeb" || campo === "portadaUrl" || campo === "logoUrl") return "Ese enlace no es válido.";
  return "Los datos no se aceptaron: revisa lo que ingresaste.";
}

/** Valida y normaliza el perfil del cuerpo (las mismas reglas que los CHECK de la 30). Error = texto. */
function perfilDelCuerpo(b: FinanciadorPatch): CambiosPerfil | string {
  const campos: CambiosPerfil["campos"] = {};
  if (b.descripcion !== undefined) {
    // Una línea: la cabecera del perfil es un párrafo corto. Caracteres como char_length() del CHECK.
    const d = b.descripcion.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    const n = [...d].length;
    if (n > 280) return `La descripción tiene ${n} caracteres: el máximo es 280.`;
    campos.descripcion = d || null;
  }
  for (const [campo, nombre] of [["sitioWeb", "La web"], ["portadaUrl", "La imagen de portada"]] as const) {
    const v = b[campo]?.trim();
    if (v === undefined) continue;
    const href = v ? urlHttps(v) : null;
    if (v && !href) return `${nombre} tiene que ser un enlace completo que empiece con https:// (por ejemplo https://empresa.pe).`;
    campos[campo] = href;
  }
  if (b.emailPublico !== undefined) {
    const v = b.emailPublico.trim().toLowerCase();
    if (v && !(CORREO_PUBLICO.test(v) && z.string().email().safeParse(v).success)) return "El correo de contacto no es válido.";
    campos.emailPublico = v || null;
  }
  const poner: CambiosPerfil["poner"] = {};
  const quitar: RedAliado[] = [];
  for (const red of CLAVES_RED) {
    const v = b.redes?.[red]?.trim();
    if (v === undefined) continue;
    if (!v) { quitar.push(red); continue; }
    const href = enlaceDeRed(red, v);
    if (!href) {
      const { nombre, dominios } = REDES_ALIADO[red];
      return `El enlace de ${nombre} tiene que empezar con https:// y ser de ${dominios.join(" o ")}, con la página del aliado (no la portada de la red).`;
    }
    poner[red] = href;
  }
  return { campos, poner, quitar };
}

adminRouter.patch("/financiadores/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = FinanciadorPatch.safeParse(await c.req.json().catch(() => null));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "invalid_body" }, 400);
  if (!body.success) return c.json({ error: "invalid_body", detail: problemaDeZod(body.error) }, 400);
  const b = body.data;
  const perfil = perfilDelCuerpo(b);
  if (typeof perfil === "string") return c.json({ error: "datos_invalidos", detail: perfil }, 400);
  const tocaRedes = Object.keys(perfil.poner).length > 0 || perfil.quitar.length > 0;
  const tocaPerfil = tocaRedes || Object.keys(perfil.campos).length > 0;
  if (tocaPerfil && !(await perfilAliadoDisponible())) return c.json(SIN_MIGRACION_30, 503);

  // Nombre, logo y visibilidad como siempre (null o ausente = se mantiene); del perfil, sólo lo que llegó.
  const vals: unknown[] = [id, b.visible ?? null, b.motivoNoVisible ?? null, b.nombrePublico ?? null, b.logoUrl ?? null];
  const sets = [
    "visible = COALESCE($2, visible)",
    "motivo_no_visible = CASE WHEN $2 IS TRUE THEN NULL ELSE COALESCE($3, motivo_no_visible) END",
    "nombre_publico = COALESCE($4, nombre_publico)",
    "logo_url = COALESCE($5, logo_url)",
  ];
  for (const [campo, v] of Object.entries(perfil.campos) as [CampoPerfil, string | null][]) {
    vals.push(v);
    sets.push(`${COL_PERFIL[campo]} = $${vals.length}`);
  }
  if (tocaRedes) {
    vals.push(JSON.stringify(perfil.poner), perfil.quitar);
    sets.push(`redes = (redes || $${vals.length - 1}::jsonb) - $${vals.length}::text[]`);
  }

  let antes: Record<string, unknown> = {};
  try {
    if (tocaPerfil) {
      const a = await pool.query(`SELECT ${COLS_PERFIL_ADMIN} FROM financiadores f WHERE f.id = $1`, [id]);
      antes = a.rows[0] ?? {};
    }
    const r = await pool.query(`UPDATE financiadores SET ${sets.join(", ")} WHERE id = $1 RETURNING id`, vals);
    if (!r.rows.length) return c.json({ error: "not_found", detail: "Ese financiador ya no existe." }, 404);
  } catch (e) {
    if (columnaAusente(e)) return c.json(SIN_MIGRACION_30, 503);
    // 23514 = check_violation: algo pasó la validación de acá y no la de la base.
    if ((e as { code?: string })?.code === "23514") {
      return c.json({ error: "datos_invalidos", detail: "La base rechazó un dato del perfil por su formato. Revisa los enlaces y el correo." }, 400);
    }
    throw e;
  }
  // El ranking y el muro leen nombre, logo y visibilidad de vistas materializadas; el perfil no está ahí.
  if (b.visible !== undefined || b.motivoNoVisible != null || b.nombrePublico != null || b.logoUrl != null) {
    await pool.query("SELECT refresh_financiamiento()");
  }

  // Bitácora: lo de siempre arriba (lo lee components/admin/ui/bitacora.ts) y el perfil con su valor anterior.
  const detalle: Record<string, unknown> = {
    visible: b.visible, motivoNoVisible: b.motivoNoVisible, nombrePublico: b.nombrePublico, logoUrl: b.logoUrl,
  };
  if (tocaPerfil) {
    const redesTocadas = [...(Object.keys(perfil.poner) as RedAliado[]), ...perfil.quitar];
    const redesAntes = (antes.redes ?? {}) as Record<string, unknown>;
    detalle.perfil = {
      ...perfil.campos,
      ...(tocaRedes ? { redes: Object.fromEntries(redesTocadas.map((r) => [r, perfil.poner[r] ?? null])) } : {}),
    };
    detalle.perfilAntes = {
      ...Object.fromEntries(Object.keys(perfil.campos).map((k) => [k, antes[k] ?? null])),
      ...(tocaRedes ? { redes: Object.fromEntries(redesTocadas.map((r) => [r, redesAntes[r] ?? null])) } : {}),
    };
  }
  await log(actor(c), "editar_financiador", `financiador:${id}`, detalle);
  return c.json({ ok: true });
});

// ─── Configuración de pagos ──────────────────────────────────────────────────
const Cuenta = z.object({
  banco: z.string().min(2).max(40),
  moneda: z.enum(["PEN", "USD"]).default("PEN"),
  tipo: z.string().max(30).optional().default("Ahorros"),
  numero: z.string().max(40).optional().default(""),
  cci: z.string().max(30).optional().default(""),
  titular: z.string().max(80).optional().default(""),
});
export const PagosSchema = z.object({
  yape: z.object({ numero: z.string().max(20).default(""), titular: z.string().max(80).default(""), qr_url: z.string().default("") }),
  plin: z.object({ numero: z.string().max(20).default(""), titular: z.string().max(80).default(""), qr_url: z.string().default("") }),
  cuentas: z.array(Cuenta).max(10).default([]),
  instrucciones: z.string().max(600).default(""),
  contacto_email: z.string().max(120).default(""),
});

adminRouter.get("/config/pagos", async (c) => {
  const r = await pool.query("SELECT valor, updated_at AS \"updatedAt\", updated_by AS \"updatedBy\" FROM ajustes WHERE clave = 'pagos'");
  return c.json(r.rows[0] ?? { valor: {} });
});

adminRouter.put("/config/pagos", async (c) => {
  const body = PagosSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
  await pool.query(
    `INSERT INTO ajustes (clave, valor, updated_at, updated_by) VALUES ('pagos', $1, now(), $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(body.data), actor(c)]);
  await log(actor(c), "editar_pagos", "ajustes:pagos");
  return c.json({ ok: true, valor: body.data });
});

// ─── Procesamiento activo (migración 19): qué tipos × etapas entran a la cola ───────────
const ProcesamientoSchema = z.object({
  tipos_activos: z.array(z.enum(["bienes", "servicios", "consultoria", "obras", "convenio", "directa", "otro"])).min(1),
  etapas_activas: z.array(z.enum(["planificacion", "convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada"])).min(1),
  nota: z.string().max(300).optional().default(""),
});

adminRouter.get("/config/procesamiento", async (c) => {
  // El conteo de la cola sale de getAlcance (misma consulta, ~130 ms, en caché; el PUT de abajo la vacía).
  const [r, alcance] = await Promise.all([
    pool.query("SELECT valor, updated_at AS \"updatedAt\", updated_by AS \"updatedBy\" FROM ajustes WHERE clave = 'procesamiento'"),
    alcanceORespaldo(),
  ]);
  return c.json({ ...(r.rows[0] ?? { valor: {} }), cola: alcance.colaFinanciable });
});

adminRouter.put("/config/procesamiento", async (c) => {
  const body = ProcesamientoSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
  await pool.query(
    `INSERT INTO ajustes (clave, valor, updated_at, updated_by) VALUES ('procesamiento', $1, now(), $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(body.data), actor(c)]);
  await pool.query("SELECT refresh_financiamiento()").catch(() => null);
  await log(actor(c), "editar_procesamiento", "ajustes:procesamiento", body.data);
  return c.json({ ok: true, valor: body.data });
});

// ─── Bitácora ────────────────────────────────────────────────────────────────
// El revisor no ve lo de plata (aportes, financiadores, medios de pago), la configuración (ajustes:
// pagos, procesamiento, self_eval) ni los cambios del equipo: sólo lo que opera (alertas, procesos,
// lotes, pedidos, dispatcher). Por acción y por objeto, así una acción nueva sobre esos objetos
// tampoco se cuela.
const LOG_OCULTO_REVISOR = `accion NOT IN ('validar', 'rechazar', 'editar_financiador', 'editar_pagos', 'editar_procesamiento',
    'editar_self_eval', 'equipo_agregar', 'equipo_cambiar', 'equipo_quitar')
  AND objeto NOT LIKE 'contribucion:%' AND objeto NOT LIKE 'financiador:%'
  AND objeto NOT LIKE 'ajustes:%' AND objeto NOT LIKE 'equipo:%'`;

adminRouter.get("/log", async (c) => {
  const where = esRevisor(c) ? `WHERE ${LOG_OCULTO_REVISOR}` : "";
  const r = await pool.query(`SELECT actor, accion, objeto, detalle, created_at AS "createdAt" FROM admin_log ${where} ORDER BY created_at DESC LIMIT 100`);
  return c.json({ data: r.rows });
});


// ─── Salud del sistema (para el resumen del panel) ───────────────────────────
adminRouter.get("/salud", async (c) => {
  const [ingesta, proc, ult, pend, sched, relay] = await Promise.all([
    ingestaConvocatorias(), // compartida con /operacion, caché 30 s (lib/salud.ts)
    pool.query(`SELECT estado, count(*)::int AS n FROM procesamientos GROUP BY estado`),
    pool.query(`SELECT p.ocid, p.finalizado_at AS "finalizadoAt",
                       EXTRACT(EPOCH FROM (p.finalizado_at - p.iniciado_at))::int AS "segundos",
                       cv.objeto AS titulo, a.score
                FROM procesamientos p JOIN convocatorias cv ON cv.ocid = p.ocid
                LEFT JOIN alertas a ON ocid_corto(a.ocid) = ocid_corto(p.ocid)
                WHERE p.estado = 'procesado' ORDER BY p.finalizado_at DESC NULLS LAST LIMIT 5`),
    pool.query(`SELECT count(*) FILTER (WHERE estado = 'pendiente_pago')::int AS "pendientesValidar",
                       count(*) FILTER (WHERE estado IN ('pagada','en_proceso')
                         AND contratos > (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = contribuciones.id))::int AS "esperandoContratos"
                FROM contribuciones`),
    pool.query(`SELECT max(iniciado_at) AS "ultimoInicio", max(latido_at) AS "ultimoLatido",
                       count(*) FILTER (WHERE estado = 'procesando')::int AS "activos"
                FROM procesamientos`),
    // Relay residencial (VPS Lima): sin él, el orquestador en GCP no obtiene el OCDS. Antes se esperaba
    // el fetch (4 s con el relay caído); ahora sale el último estado conocido (lib/salud.ts).
    saludRelay(),
  ]);
  const porEstado = Object.fromEntries(proc.rows.map((r) => [r.estado, r.n]));
  const ultimaIngesta = ingesta.ultimaIngesta;
  const horasSinIngesta = ultimaIngesta ? (Date.now() - new Date(ultimaIngesta).getTime()) / 36e5 : null;
  return c.json({
    ingesta: { ...ingesta, horasSinIngesta, ok: horasSinIngesta !== null && horasSinIngesta < 36 },
    procesamientos: { porEstado, ultimos: ult.rows, ...sched.rows[0] },
    contribuciones: pend.rows[0],
    relay,
    generadoEn: new Date().toISOString(),
  });
});

// ─── Dispatcher: ejecutar el Cloud Run Job ahora ─────────────────────────────
adminRouter.post("/dispatcher/run", async (c) => {
  const r = await dispatchNow();
  if (!r.ok) return c.json({ error: r.error === "no_project" ? "no_project" : "run_failed", detail: r.error }, r.error === "no_project" ? 500 : 502);
  await log(actor(c), "dispatcher_run", "job:vigia-dispatcher", { operation: r.operation });
  return c.json({ ok: true, operation: r.operation });
});

// ─── Re-encolar todos los que quedaron en error ──────────────────────────────
adminRouter.post("/procesamientos/reencolar-errores", async (c) => {
  const r = await pool.query(`UPDATE procesamientos SET estado = 'encolado', intentos = 0, error = NULL, worker = NULL WHERE estado = 'error' RETURNING ocid`);
  await log(actor(c), "reencolar_errores", "procesamientos", { n: r.rowCount });
  return c.json({ ok: true, reencolados: r.rowCount });
});

// ─── Re-asignación (Cloud Scheduler) ─────────────────────────────────────────
// Auditoría A1: antes llamaba asignar_contribucion() por cada aporte abierto aunque su zona no
// tuviera nada en la cola, y refrescaba las vistas materializadas SIEMPRE (cada 10 min). Ahora
// salta las zonas sin pendientes y refresca sólo si algo cambió (refresh_financiamiento_si_hace_falta,
// migración 32: mira las marcas que dejan los triggers; las asignaciones dejan la suya).
adminRouter.post("/asignar", async (c) => {
  const r = await pool.query(
    `SELECT co.id, co.codigo,
            EXISTS (SELECT 1 FROM cola_auditoria q WHERE q.ubigeo LIKE co.ubigeo || '%') AS "hayCola"
       FROM contribuciones co
      WHERE co.estado IN ('pagada','en_proceso')
        AND co.contratos > (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id)`);
  const out: Record<string, number> = {};
  const sinCola: string[] = [];
  for (const row of r.rows) {
    if (!row.hayCola) { sinCola.push(row.codigo); continue; }
    const a = await pool.query("SELECT asignar_contribucion($1) AS n", [row.id]);
    if (a.rows[0].n > 0) out[row.codigo] = a.rows[0].n;
  }
  let refrescado: boolean;
  try {
    refrescado = (await pool.query<{ r: boolean }>("SELECT refresh_financiamiento_si_hace_falta() AS r")).rows[0].r;
  } catch (e) {
    // Base sin la migración 32: se refresca como antes, siempre.
    if (!esErrorPg(e, "42883")) throw e;
    await pool.query("SELECT refresh_financiamiento()");
    refrescado = true;
  }
  return c.json({ asignados: out, sinCola, refrescado });
});

// ─── Monitor del dispatcher (procesamientos) ─────────────────────────────────
// Perfil (servicio de agentes) que atiende cada tipo de contratación: mismo mapa que backend/dispatcher/main.py.
const PERFIL_SQL = `CASE WHEN cv.tipo_contratacion IS NULL THEN NULL
  WHEN cv.tipo_contratacion IN ('bienes','servicios','obras') THEN cv.tipo_contratacion ELSE 'otros' END`;

adminRouter.get("/procesamientos", async (c) => {
  const url = new URL(c.req.url);
  const estado = url.searchParams.get("estado") ?? "";
  const perfil = url.searchParams.get("perfil") ?? "";
  const vals: unknown[] = [];
  const conds: string[] = [];
  if (["encolado", "procesando", "procesado", "error", "pendiente_de_procesamiento", "esperando_documentos"].includes(estado)) { vals.push(estado); conds.push(`v.estado = $${vals.length}`); }
  if (["bienes", "servicios", "obras", "otros"].includes(perfil)) { vals.push(perfil); conds.push(`${PERFIL_SQL} = $${vals.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await pool.query(
    `SELECT v.ocid, v.estado, v.fase_actual AS "faseActual", v.fase_index AS "faseIndex", v.intentos,
            v.encolado_at AS "encoladoAt", v.iniciado_at AS "iniciadoAt", v.finalizado_at AS "finalizadoAt",
            v.contribucion_codigo AS "contribucionCodigo", v.financiador, v.financiador_visible AS "financiadorVisible",
            v.ubigeo, v.zona, v.titulo, v.entidad, v.monto_pen::float AS "montoPen", v.alerta_codigo AS "alertaCodigo", v.score, v.banderas::int,
            v.alerta_estado AS "alertaEstado", cv.tipo_contratacion AS tipo, ${PERFIL_SQL} AS perfil,
            p.worker, p.error, p.latido_at AS "latidoAt", jsonb_array_length(p.eventos) AS eventos
     FROM procesamientos_publico v JOIN procesamientos p ON p.ocid = v.ocid JOIN convocatorias cv ON cv.ocid = v.ocid
     ${where}
     ORDER BY CASE v.estado WHEN 'procesando' THEN 0 WHEN 'error' THEN 1 WHEN 'encolado' THEN 2 ELSE 3 END,
              COALESCE(v.finalizado_at, v.iniciado_at, v.encolado_at) DESC, v.ocid
     LIMIT 200`, vals);
  return c.json({ data: r.rows });
});

// Cobertura (migración 16): qué tenemos de cada mes — record completo, documentos vigentes en GCS,
// clasificación, análisis — más los lotes ingeridos y el estado del bucket según la DB.
let coberturaCache: { at: number; body: unknown } | null = null;
adminRouter.get("/cobertura", async (c) => {
  if (coberturaCache && Date.now() - coberturaCache.at < 60_000) return c.json(coberturaCache.body);
  const [meses, lotes, docs, gcs, fuentes] = await Promise.all([
    pool.query(`SELECT mes, contratos, con_record AS "conRecord", con_docs AS "conDocs", docs_publicados::int AS "docsPublicados",
                       docs_vigentes::int AS "docsVigentes", clasificados, analizados, en_cola AS "enCola"
                FROM cobertura_resumen()`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id, tipo, estado, total::int, ok::int, fallidos::int, iniciado_at AS "iniciadoAt", finalizado_at AS "finalizadoAt", error
                FROM lotes_ingesta ORDER BY iniciado_at DESC NULLS LAST LIMIT 30`).catch(() => ({ rows: [] })),
    pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE borrado_at IS NULL AND expira_at > now())::int AS vigentes,
                       COALESCE(sum(bytes) FILTER (WHERE borrado_at IS NULL AND expira_at > now()), 0)::bigint AS "bytesVigentes",
                       min(expira_at) FILTER (WHERE borrado_at IS NULL AND expira_at > now()) AS "proximaExpiracion",
                       count(DISTINCT formato) AS formatos
                FROM documentos_gcs`).then((q) => q.rows[0]).catch(() => null),
    pool.query(`SELECT formato, count(*)::int AS n, COALESCE(sum(bytes),0)::bigint AS bytes FROM documentos_gcs
                WHERE borrado_at IS NULL AND expira_at > now() GROUP BY formato ORDER BY n DESC`).catch(() => ({ rows: [] })),
    // Fuentes externas (migración 23, vista datasets_cobertura): visitas, ONPE, JNE, DJI… una fila por fuente.
    pool.query(`SELECT fuente, tabla, cargas::int, cargas_con_error::int AS "cargasConError", COALESCE(filas, 0)::bigint AS filas,
                       ultima_clave AS "ultimaClave", ultima_descarga AS "ultimaDescarga", ultima_carga AS "ultimaCarga", ultimo_error AS "ultimoError"
                FROM datasets_cobertura ORDER BY fuente`).catch(() => ({ rows: [] })),
  ]);
  const body = { meses: meses.rows, lotes: lotes.rows, documentos: docs, porFormato: gcs.rows, fuentes: fuentes.rows, generadoAt: new Date().toISOString() };
  coberturaCache = { at: Date.now(), body };
  return c.json(body);
});

// Pedidos de descarga (migración 15): qué espera al batch nocturno y qué falló.
adminRouter.get("/pedidos", async (c) => {
  const r = await pool.query(
    `SELECT p.id, p.ocid, p.motivo, p.estado, p.solicitado_at AS "solicitadoAt", p.tomado_at AS "tomadoAt",
            p.atendido_at AS "atendidoAt", p.intentos, p.lote_id AS "loteId", p.error,
            c.objeto AS titulo, e.nombre AS entidad
     FROM pedidos_descarga p
     LEFT JOIN convocatorias c ON c.ocid = ANY(${OCID_CANDIDATOS("p.ocid")}) AND ocid_corto(c.ocid) = ocid_corto(p.ocid)
     LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
     ORDER BY CASE p.estado WHEN 'descargando' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'fallido' THEN 2 ELSE 3 END, p.solicitado_at DESC
     LIMIT 200`).catch(() => ({ rows: [] }));
  return c.json({ data: r.rows });
});

// Reabre un pedido fallido (y vuelve a poner el procesamiento a esperar).
adminRouter.post("/pedidos/:id/reintentar", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await pool.query(
    `UPDATE pedidos_descarga SET estado = 'pendiente', intentos = 0, error = NULL, tomado_at = NULL WHERE id = $1 AND estado = 'fallido' RETURNING ocid`, [id]);
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  await pool.query(`UPDATE procesamientos SET estado = 'esperando_documentos', error = 'esperando documentos: se descargan en el lote nocturno' WHERE ocid = $1 AND estado = 'error'`, [r.rows[0].ocid]);
  await log(actor(c), "reintentar_pedido", `pedido:${id}`, { ocid: r.rows[0].ocid });
  return c.json({ ok: true, ocid: r.rows[0].ocid });
});

adminRouter.post("/procesamientos/:ocid/reencolar", async (c) => {
  const ocid = c.req.param("ocid");
  const r = await pool.query(
    `UPDATE procesamientos SET estado = 'encolado', intentos = 0, error = NULL, worker = NULL, fase_actual = NULL, fase_index = NULL
     WHERE ocid = $1 RETURNING ocid`, [ocid]);
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  await log(actor(c), "reencolar", `procesamiento:${ocid}`);
  return c.json({ ok: true, ocid, estado: "encolado" });
});

// ─── Clasificación tipo × etapa (backend/core/clasificacion.py, migración 13) ───
adminRouter.get("/clasificacion/resumen", async (c) => {
  const [celdas, motivos, validaciones, totales] = await Promise.all([
    pool.query(`
      SELECT COALESCE(tipo_contratacion, 'sin_clasificar') AS tipo, COALESCE(etapa, 'sin_clasificar') AS etapa,
             procesable, count(*)::int AS n
      FROM convocatorias GROUP BY 1, 2, 3 ORDER BY n DESC`),
    pool.query(`
      SELECT motivo_no_procesable AS motivo, count(*)::int AS n
      FROM convocatorias WHERE procesable = false GROUP BY 1 ORDER BY n DESC LIMIT 10`),
    pool.query(`
      SELECT v AS validacion, count(*)::int AS n
      FROM convocatorias, unnest(validaciones_pendientes) v GROUP BY 1 ORDER BY n DESC LIMIT 10`),
    pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE clasificado_at IS NOT NULL)::int AS clasificadas,
             count(*) FILTER (WHERE procesable)::int AS procesables,
             count(*) FILTER (WHERE procesable = false)::int AS "noProcesables",
             (SELECT count(*) FROM procesamientos WHERE estado = 'pendiente_de_procesamiento')::int AS "pendientesDeProcesamiento",
             max(clasificado_at) AS "ultimaClasificacion"
      FROM convocatorias`),
  ]);
  const porTipo: Record<string, number> = {};
  const porEtapa: Record<string, number> = {};
  for (const r of celdas.rows) {
    porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + r.n;
    porEtapa[r.etapa] = (porEtapa[r.etapa] ?? 0) + r.n;
  }
  return c.json({
    totales: totales.rows[0],
    celdas: celdas.rows,            // [{tipo, etapa, procesable, n}]
    porTipo, porEtapa,
    motivosNoProcesable: motivos.rows,
    validacionesPendientes: validaciones.rows,
  });
});
