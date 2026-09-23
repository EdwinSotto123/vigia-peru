/**
 * "Procesar" desde el panel admin — la misma acción que /app/financiar/[ubigeo] ofrece a
 * cualquier visitante ("Financiar esta zona"), pero a nombre de Vigía Perú y sin pasarela: el
 * admin ve exactamente la misma página y el mismo formulario que una persona normal (mismo
 * selector de zona en el mapa, mismo paso de cantidad); lo único que cambia es el botón final
 * — en vez de "pagar", "procesar" — y el resultado es inmediato, no queda `pendiente_pago`.
 *
 * Reusa las MISMAS funciones SQL que ya usan /contribuciones (ciudadano) y
 * backend/scripts/aporte_institucional.py (línea de comandos, sigue existiendo para lotes
 * grandes fuera del navegador): `next_codigo_contribucion()`, `asignar_contribucion()` (FIFO,
 * nadie elige contratos), `documentos_vigentes()`, `pedir_descarga()`, `refresh_financiamiento()`.
 *
 *   GET  /admin/procesar-lote/preview?ubigeo=        zona + contratos en cola + precio (antes de confirmar)
 *   POST /admin/procesar-lote {ubigeo, contratos, correrDispatcher}
 *        → crea/reusa el financiador "Vigía Perú" (slug vigia-peru), contribución YA `pagada`,
 *          asigna hasta `contratos` por antigüedad, abre pedido de descarga para los que no
 *          tengan documentos vigentes (el batch nocturno los toma; correrDispatcher además
 *          dispara el Job ahora para los que YA tengan documentos).
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { actor, log } from "../lib/adminlog.js";
import { dispatchNow } from "../lib/dispatcher.js";

export const adminProcesarRouter = new Hono();

const SLUG_VIGIA = "vigia-peru";
const NOMBRE_VIGIA = "Vigía Perú";
const LOGO_VIGIA = "https://vigia-peru-frontend-36169102688.us-central1.run.app/assets/logo/vigia_peru_512.png";
const EMAIL_VIGIA = "contacto@reescala.com";

async function financiadorVigia(client: import("pg").PoolClient): Promise<number> {
  const r = await client.query("SELECT id FROM financiadores WHERE slug = $1", [SLUG_VIGIA]);
  if (r.rowCount) return r.rows[0].id as number;
  const ins = await client.query(
    `INSERT INTO financiadores (tipo, nombre_publico, slug, logo_url, email, visible)
     VALUES ('organizacion', $1, $2, $3, $4, true) RETURNING id`,
    [NOMBRE_VIGIA, SLUG_VIGIA, LOGO_VIGIA, EMAIL_VIGIA]);
  return ins.rows[0].id as number;
}

adminProcesarRouter.get("/procesar-lote/preview", async (c) => {
  const ubigeo = c.req.query("ubigeo") ?? "";
  if (!/^\d{2}(\d{2}(\d{2})?)?$/.test(ubigeo)) return c.json({ error: "ubigeo_invalido" }, 400);
  const zona = await pool.query("SELECT nombre, nivel FROM zonas WHERE ubigeo = $1", [ubigeo]);
  if (!zona.rowCount) return c.json({ error: "zona_no_existe" }, 404);
  const [enCola, tarifa] = await Promise.all([
    pool.query("SELECT count(*)::int AS n FROM cola_auditoria WHERE ubigeo LIKE $1", [ubigeo + "%"]),
    pool.query("SELECT precio_pen FROM tarifas WHERE vigente_desde <= current_date ORDER BY vigente_desde DESC, id DESC LIMIT 1"),
  ]);
  return c.json({
    ubigeo, zona: zona.rows[0].nombre, nivel: zona.rows[0].nivel,
    enCola: enCola.rows[0].n, precioPen: Number(tarifa.rows[0]?.precio_pen ?? 3),
  });
});

const ProcesarBody = z.object({
  ubigeo: z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/),
  // mínimo 5: mismo CHECK (contratos >= 5) que la tabla contribuciones exige para cualquier aporte.
  contratos: z.coerce.number().int().min(5).max(500),
  correrDispatcher: z.boolean().optional().default(true),
});

adminProcesarRouter.post("/procesar-lote", async (c) => {
  const parsed = ProcesarBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { ubigeo, contratos, correrDispatcher } = parsed.data;
  const quien = actor(c);

  const client = await pool.connect();
  let codigo = "";
  let cid = 0;
  try {
    await client.query("BEGIN");
    const zona = await client.query("SELECT nombre FROM zonas WHERE ubigeo = $1", [ubigeo]);
    if (!zona.rowCount) { await client.query("ROLLBACK"); return c.json({ error: "zona_no_existe" }, 404); }
    const fid = await financiadorVigia(client);
    const tarifa = await client.query("SELECT id, precio_pen FROM tarifas WHERE vigente_desde <= current_date ORDER BY vigente_desde DESC, id DESC LIMIT 1");
    if (!tarifa.rowCount) { await client.query("ROLLBACK"); return c.json({ error: "sin_tarifa_vigente" }, 500); }
    const precio = Number(tarifa.rows[0].precio_pen);
    codigo = (await client.query("SELECT next_codigo_contribucion() AS c")).rows[0].c as string;
    // `mensaje_publico` sale tal cual en /financiamiento/recientes e /impacto/:codigo: antes guardaba
    // "Procesado desde el panel admin por {admin}…" y publicaba el nombre de quien operó el panel.
    // Queda NULL; quién lo hizo sigue registrado en privado: `validada_por` (columna interna, no la
    // lee ninguna ruta pública) + la bitácora `admin_log` (log(...) más abajo). El carácter institucional
    // ya se ve público por `pasarela = 'institucional'` y el financiador "Vigía Perú".
    const ins = await client.query(
      `INSERT INTO contribuciones (codigo, financiador_id, ubigeo, contratos, tarifa_id, monto_pen, estado, pasarela, pasarela_ref, validada_por, pagada_at, mensaje_publico)
       VALUES ($1,$2,$3,$4,$5,$6,'pagada','institucional','admin-panel',$7,now(),NULL) RETURNING id`,
      [codigo, fid, ubigeo, contratos, tarifa.rows[0].id, precio * contratos, quien]);
    cid = ins.rows[0].id as number;
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return c.json({ error: "internal", detail: (e as Error).message }, 500);
  } finally {
    client.release();
  }

  // Asignación (FIFO, misma función que usa el ciudadano) y pedidos de descarga: fuera de la
  // transacción anterior porque asignar_contribucion() hace su propio commit interno por fila.
  const asig = await pool.query("SELECT asignar_contribucion($1) AS n", [cid]);
  const asignados = asig.rows[0].n as number;
  const ocidsRes = await pool.query("SELECT ocid FROM asignaciones WHERE contribucion_id = $1 ORDER BY id", [cid]);
  const ocids = ocidsRes.rows.map((r) => r.ocid as string);

  let pedidos = 0;
  const ocidsConDocs: string[] = [];
  for (const ocid of ocids) {
    const dv = await pool.query("SELECT count(*)::int AS n FROM documentos_vigentes($1)", [ocid]);
    if (Number(dv.rows[0].n) > 0) { ocidsConDocs.push(ocid); continue; }
    await pool.query("SELECT pedir_descarga($1, 'financiado')", [ocid]).catch(() => null);
    pedidos++;
  }
  await pool.query("SELECT refresh_financiamiento()").catch(() => null);
  await log(quien, "procesar_lote", codigo, { ubigeo, contratos, asignados, pedidos, conDocumentos: ocidsConDocs.length });

  let dispatcher: { ok: boolean; operation: string | null; error?: string } | null = null;
  if (correrDispatcher && ocidsConDocs.length > 0) dispatcher = await dispatchNow();

  return c.json({
    codigo, ubigeo, asignados, solicitados: contratos, ocids,
    pedidosAbiertos: pedidos, listosParaProcesar: ocidsConDocs.length,
    dispatcherDisparado: !!dispatcher?.ok,
  });
});
