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
 *   GET  /admin/procesar-lote/preview?ubigeo=&tipos=bienes   zona + contratos en cola + listos (con documentos) + precio
 *   GET  /admin/procesar-lote/preview?entidadRuc=&tipos=      lo mismo para una ENTIDAD (migración 39): su cola, y como
 *                                                            zona la que llevaría su aporte; + `entidad: {ruc, nombre}`
 *   POST /admin/procesar-lote {ubigeo | entidadRuc, contratos, correrDispatcher, tipos?, soloConDocumentos?}
 *        (por zona 5–500, por entidad 1–500 y hasta lo que tenga en cola; un revisor, hasta 50: 403 tope_revisor)
 *        · por entidad: contratos al azar entre los suyos en cola (asignar_contribucion, migración 39).
 *        · soloConDocumentos (por defecto true, migración 38): solo contratos con documentos ya en GCS; si no
 *          alcanzan, el resto se pide al batch y el cron de asignación completa el aporte después.
 *        · tipos (p. ej. ["bienes"]): además de los tipos activos de ajustes.procesamiento.
 *        → crea/reusa el financiador "Vigía Perú" (slug vigia-peru), contribución YA `pagada`,
 *          asigna hasta `contratos` (por antigüedad en la zona; al azar en la entidad), abre pedido de descarga para los que no
 *          tengan documentos vigentes (el batch nocturno los toma; correrDispatcher además
 *          dispara el Job ahora para los que YA tengan documentos).
 */

import { Hono } from "hono";
import { z } from "zod";
import { poolAdmin as pool } from "../lib/db.js"; // pool del panel (lib/db.ts)
import { actor, esRevisor, log } from "../lib/adminlog.js";
import { dispatchNow } from "../lib/dispatcher.js";
import { hayAporteEntidad } from "../lib/esquema.js";
import { colaDeEntidad, tarifaVigente } from "../lib/aportes.js";

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

const SIN_MIGRACION_39 = {
  error: "sin_migracion",
  detail: "Todavía no se puede procesar por entidad: falta aplicar la migración 39 en la base. Por zona sí.",
};

adminProcesarRouter.get("/procesar-lote/preview", async (c) => {
  const ubigeo = c.req.query("ubigeo") ?? "";
  const entidadRuc = c.req.query("entidadRuc") ?? "";
  const tipos = (c.req.query("tipos") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z_]{3,20}$/.test(s));
  if (ubigeo && entidadRuc) return c.json({ error: "alcance_requerido", detail: "Elige una zona o una entidad (sólo una de las dos)." }, 400);
  if (entidadRuc) {
    if (!/^\d{11}$/.test(entidadRuc)) return c.json({ error: "entidad_invalida", detail: "El RUC de la entidad tiene 11 dígitos." }, 400);
    if (!(await hayAporteEntidad())) return c.json(SIN_MIGRACION_39, 503);
    const [ent, tarifa] = await Promise.all([colaDeEntidad(pool, entidadRuc, tipos), tarifaVigente(pool)]);
    if (!ent) return c.json({ error: "entidad_no_encontrada" }, 404);
    // La zona es la que llevaría el aporte (la de la mayoría de sus contratos en cola); null sin cola.
    return c.json({
      ubigeo: ent.zona?.ubigeo ?? null, zona: ent.zona?.nombre ?? null, nivel: ent.zona?.nivel ?? null,
      enCola: ent.enCola, listos: ent.listos, precioPen: tarifa?.precioPen ?? null,
      entidad: { ruc: ent.ruc, nombre: ent.nombre },
    });
  }
  if (!/^\d{2}(\d{2}(\d{2})?)?$/.test(ubigeo)) return c.json({ error: "ubigeo_invalido" }, 400);
  const zona = await pool.query("SELECT nombre, nivel FROM zonas WHERE ubigeo = $1", [ubigeo]);
  if (!zona.rowCount) return c.json({ error: "zona_no_existe" }, 404);
  const [enCola, tarifa] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE documentos_listos(q.ocid))::int AS listos
         FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid
        WHERE q.ubigeo LIKE $1 AND ($2::text[] IS NULL OR c.tipo_contratacion = ANY ($2))`,
      [ubigeo + "%", tipos.length ? tipos : null]),
    pool.query("SELECT precio_pen FROM tarifas WHERE vigente_desde <= current_date ORDER BY vigente_desde DESC, id DESC LIMIT 1"),
  ]);
  return c.json({
    ubigeo, zona: zona.rows[0].nombre, nivel: zona.rows[0].nivel,
    enCola: enCola.rows[0].n, listos: enCola.rows[0].listos, precioPen: Number(tarifa.rows[0]?.precio_pen ?? 3),
    entidad: null,
  });
});

// Alcance: una zona o una entidad (migración 39), no las dos.
const MINIMO_ZONA = 5;
const ProcesarBody = z.object({
  ubigeo: z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/).optional(),
  entidadRuc: z.string().regex(/^\d{11}$/).optional(),
  // Mismo CHECK que la tabla (39): por zona mínimo 5 (abajo); por entidad mínimo 1.
  contratos: z.coerce.number().int().min(1).max(500),
  correrDispatcher: z.boolean().optional().default(true),
  tipos: z.array(z.string().regex(/^[a-z_]{3,20}$/)).min(1).max(8).optional(),
  soloConDocumentos: z.boolean().optional().default(true),
});

// Un revisor (x-admin-rol) procesa lotes chicos; el tope de 500 queda para el admin.
const TOPE_REVISOR = 50;

adminProcesarRouter.post("/procesar-lote", async (c) => {
  const parsed = ProcesarBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { ubigeo, entidadRuc, contratos, correrDispatcher, tipos, soloConDocumentos } = parsed.data;
  if (!ubigeo === !entidadRuc) return c.json({ error: "alcance_requerido", detail: "Elige una zona o una entidad (sólo una de las dos)." }, 400);
  if (ubigeo && contratos < MINIMO_ZONA) {
    return c.json({ error: "minimo_contratos", minimo: MINIMO_ZONA, detail: `El mínimo por zona son ${MINIMO_ZONA} contratos.` }, 400);
  }
  if (entidadRuc && !(await hayAporteEntidad())) return c.json(SIN_MIGRACION_39, 503);
  if (esRevisor(c) && contratos > TOPE_REVISOR) {
    return c.json({ error: "tope_revisor", detail: `Un revisor procesa hasta ${TOPE_REVISOR} contratos por lote; para más, pídeselo a un administrador.` }, 403);
  }
  const quien = actor(c);

  const client = await pool.connect();
  let codigo = "";
  let cid = 0;
  let zonaUbigeo = ubigeo ?? "";
  let entidad: { ruc: string; nombre: string } | null = null;
  try {
    await client.query("BEGIN");
    if (ubigeo) {
      const zona = await client.query("SELECT nombre FROM zonas WHERE ubigeo = $1", [ubigeo]);
      if (!zona.rowCount) { await client.query("ROLLBACK"); return c.json({ error: "zona_no_existe" }, 404); }
    } else {
      // Mismas reglas que el aporte ciudadano por entidad (routes/contribuciones.ts).
      const ent = await colaDeEntidad(client, entidadRuc!, tipos ?? null);
      if (!ent) { await client.query("ROLLBACK"); return c.json({ error: "entidad_no_encontrada" }, 404); }
      if (ent.enCola === 0 || !ent.zona) {
        await client.query("ROLLBACK");
        return c.json({ error: "entidad_sin_cola", detail: "Esta entidad no tiene contratos en cola para esos tipos." }, 409);
      }
      if (contratos > ent.enCola) {
        await client.query("ROLLBACK");
        return c.json({ error: "excede_cola", disponibles: ent.enCola, detail: `Esta entidad tiene ${ent.enCola} ${ent.enCola === 1 ? "contrato" : "contratos"} en cola.` }, 409);
      }
      zonaUbigeo = ent.zona.ubigeo;
      entidad = { ruc: ent.ruc, nombre: ent.nombre };
    }
    const fid = await financiadorVigia(client);
    const tarifa = await tarifaVigente(client);
    if (!tarifa) { await client.query("ROLLBACK"); return c.json({ error: "sin_tarifa_vigente" }, 500); }
    const precio = tarifa.precioPen;
    codigo = (await client.query("SELECT next_codigo_contribucion() AS c")).rows[0].c as string;
    // `mensaje_publico` sale tal cual en /financiamiento/recientes e /impacto/:codigo: antes guardaba
    // "Procesado desde el panel admin por {admin}…" y publicaba el nombre de quien operó el panel.
    // Queda NULL; quién lo hizo sigue registrado en privado: `validada_por` (columna interna, no la
    // lee ninguna ruta pública) + la bitácora `admin_log` (log(...) más abajo). El carácter institucional
    // ya se ve público por `pasarela = 'institucional'` y el financiador "Vigía Perú".
    // Por zona, el INSERT de siempre (no nombra entidad_ruc: funciona en una base sin la 39).
    const ins = await client.query(
      `INSERT INTO contribuciones (codigo, financiador_id, ubigeo, contratos, tarifa_id, monto_pen, estado, pasarela, pasarela_ref, validada_por, pagada_at, mensaje_publico, solo_con_documentos, tipos${entidad ? ", entidad_ruc" : ""})
       VALUES ($1,$2,$3,$4,$5,$6,'pagada','institucional','admin-panel',$7,now(),NULL,$8,$9${entidad ? ",$10" : ""}) RETURNING id`,
      [codigo, fid, zonaUbigeo, contratos, tarifa.id, precio * contratos, quien, soloConDocumentos, tipos ?? null,
       ...(entidad ? [entidad.ruc] : [])]);
    cid = ins.rows[0].id as number;
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e; // index.ts lo registra con el requestId; la respuesta no lleva el mensaje interno
  } finally {
    client.release();
  }

  // Asignación (misma función que usa el ciudadano: FIFO en la zona, al azar en la entidad) y pedidos de descarga: fuera de la
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
  await log(quien, "procesar_lote", codigo, {
    ubigeo: zonaUbigeo, entidadRuc: entidad?.ruc ?? null, contratos, asignados, pedidos,
    conDocumentos: ocidsConDocs.length, tipos: tipos ?? null, soloConDocumentos,
  });

  let dispatcher: { ok: boolean; operation: string | null; error?: string } | null = null;
  if (correrDispatcher && ocidsConDocs.length > 0) dispatcher = await dispatchNow();

  return c.json({
    codigo, ubigeo: zonaUbigeo, entidad, asignados, solicitados: contratos, ocids, tipos: tipos ?? null, soloConDocumentos,
    pedidosAbiertos: pedidos, listosParaProcesar: ocidsConDocs.length,
    dispatcherDisparado: !!dispatcher?.ok,
  });
});
