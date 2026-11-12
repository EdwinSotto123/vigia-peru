/**
 * Laboratorio de precios (2026-11-12): el panel pide investigaciones al Worker vigia-precios-lab (service binding
 * PRECIOS_LAB; el Worker no tiene dirección pública) y las muestra.
 *
 *   POST /admin/precios-lab                      {consulta?, especificacion?, unidad?, cantidad?, precioReferencia?,
 *                                                ocid?, item?, web?}. Con `ocid` arma el pedido desde el ítem del
 *                                                contrato (descripción, unidad, cantidad, precio unitario adjudicado o
 *                                                de referencia) y suma lo que pagó el Estado por el mismo CUBSO.
 *   GET  /admin/precios-lab                      las últimas investigaciones y el gasto total
 *   GET  /admin/precios-lab/contrato/:ocid       los ítems del contrato, la última investigación de cada uno y el total
 *   POST /admin/precios-lab/contrato             {ocid, web?, repetir?}: investiga los ítems que faltan (hasta 12, escalonados)
 *   GET  /admin/precios-lab/:id                  estado, pasos, ficha, resumen y ofertas
 *   GET  /admin/precios-lab/:id/evidencia/:archivo   lo leído de cada página (R2)
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { OCID_CANDIDATOS, poolAdmin as pool } from "../lib/db.js";
import { actor, log } from "../lib/adminlog.js";

interface Servicio {
  fetch(req: Request): Promise<Response>;
}

export const adminPreciosRouter = new Hono();

const lab = (c: Context) => (c.env as { PRECIOS_LAB?: Servicio } | undefined)?.PRECIOS_LAB;

async function alLab(c: Context, ruta: string, init?: RequestInit): Promise<Response> {
  const s = lab(c);
  if (!s) return c.json({ error: "sin_laboratorio", detail: "Esta API no tiene el laboratorio de precios conectado." }, 503);
  const r = await s.fetch(new Request(`https://vigia-precios-lab.interno${ruta}`, init));
  return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json" } });
}

const Pedido = z.object({
  consulta: z.string().trim().max(300).optional(),
  especificacion: z.string().max(20_000).optional(),
  unidad: z.string().trim().max(60).optional(),
  cantidad: z.number().positive().max(1e9).optional(),
  precioReferencia: z.number().positive().max(1e9).optional(),
  ocid: z.string().trim().regex(/^[A-Za-z0-9-]{3,80}$/).optional(),
  item: z.number().int().min(0).max(100_000).optional(),
  web: z.boolean().optional(),
  urls: z.array(z.string().trim().url().max(500)).max(10).optional(),
});

interface Referencia {
  fuente: string;
  detalle: string;
  unidad: string | null;
  n: number;
  p25: number | null;
  mediana: number;
  p75: number | null;
}

/** El código corto con que convocatoria_items y precio_item guardan el contrato («1228545», «2026-988-2»). */
const ocidCorto = (ocid: string) => ocid.trim().replace(/^OECE-/i, "").replace(/^ocds-dgv273-seacev3-/i, "");

interface ItemContrato {
  numero_item: number;
  descripcion: string | null;
  descripcion_corta: string | null;
  cantidad: number | null;
  unidad: string | null;
  precio_unit_ref: number | null;
  cubso: string | null;
  unit_adj: number | null;
}

/**
 * Los ítems del contrato con su precio unitario adjudicado. precio_item numera los ítems como el OCDS (`position`) y
 * convocatoria_items como el SEACE: NO calzan por número (2026-988-2: el arroz tomaba el precio de los fideos; 2026-2543-268:
 * el captopril, el de la norepinefrina). Se empatan dentro del contrato por descripción o CUBSO, y entre iguales por
 * cantidad y precio referencial.
 */
const NORMA = (x: string) => `upper(left(regexp_replace(${x}, '\\s+', ' ', 'g'), 120))`;
const ITEMS_SQL = `
  SELECT ci.numero_item, ci.descripcion, ci.descripcion_corta, ci.cantidad::float AS cantidad, ci.unidad,
         ci.precio_unit_ref::float AS precio_unit_ref, ci.cubso, pi.unit_adj::float AS unit_adj
    FROM convocatoria_items ci
    LEFT JOIN LATERAL (
      SELECT p.unit_adj FROM precio_item p
       WHERE p.ocid = ci.ocid AND p.unit_adj > 0
         AND (p.cubso = ci.cubso OR ${NORMA("p.descripcion")} IN (${NORMA("ci.descripcion_corta")}, ${NORMA("ci.descripcion")}))
       ORDER BY coalesce(${NORMA("p.descripcion")} IN (${NORMA("ci.descripcion_corta")}, ${NORMA("ci.descripcion")}), false) DESC,
                coalesce(p.cubso = ci.cubso, false) DESC, coalesce(p.cantidad = ci.cantidad, false) DESC,
                abs(coalesce(p.unit_ref, 0) - coalesce(ci.precio_unit_ref, 0)), abs(p.posicion - ci.numero_item)
       LIMIT 1) pi ON true
   WHERE ci.ocid = $1`;

const precioDe = (f: ItemContrato) => (f.unit_adj && f.unit_adj > 0 ? f.unit_adj : f.precio_unit_ref && f.precio_unit_ref > 0 ? f.precio_unit_ref : null);

/** Lo que pagó el Estado por el mismo CUBSO (procesos y compras menores), en la unidad del ítem si la hay. */
async function referenciasDe(cubso: string | null, unidad: string | null): Promise<Referencia[]> {
  if (!cubso) return [];
  const vacio = () => ({ rows: [] as Record<string, unknown>[] });
  const [proc, men] = await Promise.all([
    pool.query(
      `SELECT unidad, anio, n::int, p25::float, mediana::float, p75::float
         FROM precio_referencia WHERE cubso = $1 AND mediana > 0 AND base = 'adjudicado'
        ORDER BY coalesce(lower(unidad) = lower($2), false) DESC, anio DESC, n DESC LIMIT 1`,
      [cubso, unidad],
    ).catch(vacio),
    pool.query(
      `SELECT i.unidad, count(*)::int AS n,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY i.precio_unitario)::float AS p25,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY i.precio_unitario)::float AS mediana,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY i.precio_unitario)::float AS p75
         FROM seace_menor_item i JOIN seace_menores m USING (id_contrato)
        WHERE i.cubso = $1 AND i.precio_unitario > 0 AND m.fecha_suscripcion >= current_date - 730
        GROUP BY i.unidad ORDER BY coalesce(lower(i.unidad) = lower($2), false) DESC, count(*) DESC LIMIT 1`,
      [cubso, unidad],
    ).catch(vacio),
  ]);
  const referencias: Referencia[] = [];
  const p = proc.rows[0];
  if (p?.mediana) {
    referencias.push({ fuente: "procesos", detalle: `${p.n} procesos del Estado en ${p.anio}, mismo CUBSO`, unidad: (p.unidad as string) ?? null,
      n: p.n as number, p25: (p.p25 as number) ?? null, mediana: p.mediana as number, p75: (p.p75 as number) ?? null });
  }
  const m = men.rows[0];
  if (m?.mediana && (m.n as number) > 0) {
    referencias.push({ fuente: "compras_menores", detalle: `${m.n} compras menores de los últimos 2 años, mismo CUBSO`, unidad: (m.unidad as string) ?? null,
      n: m.n as number, p25: (m.p25 as number) ?? null, mediana: m.mediana as number, p75: (m.p75 as number) ?? null });
  }
  return referencias;
}

/** El pedido al laboratorio para un ítem del contrato. */
async function entradaDeItem(ocid: string, f: ItemContrato) {
  return {
    consulta: String(f.descripcion_corta || f.descripcion || "").slice(0, 300),
    especificacion: f.descripcion && f.descripcion !== f.descripcion_corta ? String(f.descripcion) : undefined,
    unidad: f.unidad ?? undefined,
    cantidad: f.cantidad ?? undefined,
    precioReferencia: precioDe(f) ?? undefined,
    ocid,
    item: f.numero_item,
    referencias: await referenciasDe(f.cubso, f.unidad),
  };
}

/** Un ítem del contrato y lo que pagó el Estado por su CUBSO. */
async function desdeContrato(ocid: string, item: number | undefined) {
  const it = await pool.query<ItemContrato>(`${ITEMS_SQL} AND ($2::int IS NULL OR ci.numero_item = $2) ORDER BY ci.numero_item LIMIT 1`, [ocidCorto(ocid), item ?? null]);
  return it.rows[0] ? entradaDeItem(ocidCorto(ocid), it.rows[0]) : null;
}

/** Los ítems distintos del contrato: algunos vienen repetidos en convocatoria_items (2026-988-2: 12 filas, 6 ítems). */
async function itemsDelContrato(ocid: string): Promise<ItemContrato[]> {
  const r = await pool.query<ItemContrato>(`${ITEMS_SQL} ORDER BY ci.numero_item LIMIT 300`, [ocidCorto(ocid)]);
  const vistos = new Set<string>();
  return r.rows.filter((f) => {
    const k = [f.descripcion_corta ?? f.descripcion, f.unidad, f.cantidad, f.precio_unit_ref].join("|").toUpperCase();
    return !vistos.has(k) && !!vistos.add(k);
  });
}

/** Los ítems que no se comparan en tiendas: servicios y montos globales. */
const sinTiendas = (f: ItemContrato) => /^(servicio|global)/i.test(f.unidad ?? "");

adminPreciosRouter.post("/precios-lab", async (c) => {
  const b = Pedido.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body" }, 400);
  const p = b.data;
  let entrada: Record<string, unknown> = { ...p };
  if (p.ocid) {
    const d = await desdeContrato(p.ocid, p.item);
    if (!d) return c.json({ error: "sin_item", detail: "Ese contrato no tiene ítems cargados." }, 404);
    // Lo que escribió quien pide manda sobre lo que trae el contrato.
    entrada = { ...d, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")), ocid: ocidCorto(p.ocid), item: d.item };
  }
  if (!entrada.consulta || String(entrada.consulta).length < 3) return c.json({ error: "falta_consulta" }, 400);
  const r = await alLab(c, "/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...entrada, autor: actor(c) }),
  });
  if (r.ok) {
    const j = (await r.clone().json().catch(() => ({}))) as { id?: string; reutilizada?: boolean };
    if (j.id && !j.reutilizada) await log(actor(c), "precios_lab_investigar", `precios_lab:${j.id}`, { consulta: entrada.consulta, ocid: p.ocid ?? null });
  }
  return r;
});

adminPreciosRouter.get("/precios-lab", (c) => alLab(c, "/jobs?limite=50"));

/** Hasta cuántos ítems de un contrato se investigan de una vez, y cada cuántos segundos arranca el siguiente. */
const MAX_ITEMS_CONTRATO = 12;
const ESCALON_SEGUNDOS = 40;

interface InvestigacionCorta {
  id: string;
  estado: string;
  paso: string | null;
  item: number | null;
  creado: string;
  veredicto: string | null;
  mediana: number | null;
  p25: number | null;
  p75: number | null;
  validas: number | null;
  razon: number | null;
  referencia: number | null;
  unidad: string | null;
  caja: number | null;
  sinComparar: string | null;
  costo: number | null;
}

/** La investigación más reciente de cada ítem del contrato (la lista del Worker viene de la más nueva a la más vieja). */
async function investigacionesDe(c: Context, ocid: string): Promise<Map<number, InvestigacionCorta> | null> {
  const r = await alLab(c, `/jobs?ocid=${encodeURIComponent(ocid)}&limite=200`);
  if (!r.ok) return null;
  const j = (await r.json()) as { investigaciones?: InvestigacionCorta[] };
  const por = new Map<number, InvestigacionCorta>();
  for (const i of j.investigaciones ?? []) if (i.item != null && !por.has(Number(i.item))) por.set(Number(i.item), i);
  return por;
}

/**
 * GET /admin/precios-lab/contrato/:ocid — los ítems del contrato con lo que pagó el Estado y la última investigación de
 * cada uno; y el total: lo pagado frente a la mediana de las tiendas, solo en los ítems con 3 o más ofertas válidas, sin
 * sospecha de caja y con una unidad comparable (si no, la unidad no es la misma y la resta no vale).
 */
adminPreciosRouter.get("/precios-lab/contrato/:ocid", async (c) => {
  const ocid = ocidCorto(c.req.param("ocid"));
  if (!/^[A-Za-z0-9-]{3,80}$/.test(ocid)) return c.json({ error: "not_found" }, 404);
  const [cab, items, invs] = await Promise.all([
    pool.query(
      `SELECT c.ocid, c.codigo, c.objeto AS titulo, c.categoria, e.nombre AS entidad, c.entidad_ruc AS "entidadRuc"
         FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
        WHERE c.ocid = ANY(${OCID_CANDIDATOS("$1")}) AND ocid_corto(c.ocid) = ocid_corto($1) LIMIT 1`,
      [ocid],
    ),
    itemsDelContrato(ocid),
    investigacionesDe(c, ocid),
  ]);
  if (!items.length) return c.json({ error: "sin_item", detail: "Ese contrato no tiene ítems cargados." }, 404);
  let pagado = 0, mercado = 0, comparados = 0, encima = 0, exceso = 0;
  const filas = items.map((f) => {
    const inv = invs?.get(f.numero_item) ?? null;
    const precio = precioDe(f);
    const cuenta = !!(inv && inv.estado === "listo" && precio && f.cantidad && inv.mediana && inv.razon != null && (inv.validas ?? 0) >= 3 && !inv.caja &&
      !/no concluyente/i.test(inv.veredicto ?? ""));
    if (cuenta) {
      comparados++;
      pagado += precio! * f.cantidad!;
      mercado += inv!.mediana! * f.cantidad!;
      // Lo pagado de más solo en los ítems por encima del mercado: un ítem barato no tapa a uno caro (2026-1967-7: la
      // frazada humanitaria frente a frazadas de tienda daba −11 millones y escondía la mesa a 1,49 veces).
      if ((inv!.razon ?? 0) >= 1.15) {
        encima++;
        exceso += (precio! - inv!.mediana!) * f.cantidad!;
      }
    }
    return {
      item: f.numero_item,
      descripcion: f.descripcion_corta || f.descripcion,
      unidad: f.unidad,
      cantidad: f.cantidad,
      precioReferencial: f.precio_unit_ref,
      precioAdjudicado: f.unit_adj,
      cubso: f.cubso,
      sinTiendas: sinTiendas(f),
      cuentaEnTotal: cuenta,
      investigacion: inv,
    };
  });
  return c.json({
    contrato: cab.rows[0] ?? { ocid },
    items: filas,
    laboratorio: invs != null,
    total: { comparados, encima, pagado: Math.round(pagado * 100) / 100, mercado: Math.round(mercado * 100) / 100, exceso: Math.round(exceso * 100) / 100 },
  });
});

const PedidoContrato = z.object({
  ocid: z.string().trim().regex(/^[A-Za-z0-9-]{3,80}$/),
  web: z.boolean().optional(),
  /** Volver a investigar también los ítems que ya tienen una investigación (si no, solo los que faltan o fallaron). */
  repetir: z.boolean().optional(),
});

/**
 * POST /admin/precios-lab/contrato {ocid, web?, repetir?} — investiga los ítems del contrato (hasta 12), uno cada 40 s
 * para no abrir a la vez las mismas tiendas, el contenedor de Crawl4AI y GLM.
 */
adminPreciosRouter.post("/precios-lab/contrato", async (c) => {
  const b = PedidoContrato.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body" }, 400);
  const ocid = ocidCorto(b.data.ocid);
  const [items, invs] = await Promise.all([itemsDelContrato(ocid), investigacionesDe(c, ocid)]);
  if (!items.length) return c.json({ error: "sin_item", detail: "Ese contrato no tiene ítems cargados." }, 404);
  if (!invs) return c.json({ error: "sin_laboratorio", detail: "Esta API no tiene el laboratorio de precios conectado." }, 503);
  const pendientes = items.filter((f) => {
    if (sinTiendas(f)) return false;
    const e = invs.get(f.numero_item)?.estado;
    return b.data.repetir ? e !== "en_cola" && e !== "corriendo" : !e || e === "error";
  });
  const lote = pendientes.slice(0, MAX_ITEMS_CONTRATO);
  const lanzadas: { item: number; id?: string; reutilizada?: boolean; error?: string }[] = [];
  for (const [k, f] of lote.entries()) {
    const entrada = await entradaDeItem(ocid, f);
    if (entrada.consulta.length < 3) {
      lanzadas.push({ item: f.numero_item, error: "el ítem no tiene descripción" });
      continue;
    }
    const r = await alLab(c, "/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...entrada, web: b.data.web, autor: actor(c), espera: k * ESCALON_SEGUNDOS, repetir: b.data.repetir }),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; reutilizada?: boolean; error?: string };
    lanzadas.push({ item: f.numero_item, id: j.id, reutilizada: j.reutilizada, error: r.ok ? undefined : j.error ?? `HTTP ${r.status}` });
  }
  await log(actor(c), "precios_lab_contrato", `precios_lab:${ocid}`, { ocid, items: lanzadas.filter((x) => x.id && !x.reutilizada).map((x) => x.item) });
  return c.json({ ocid, lanzadas, quedan: pendientes.length - lote.length, sinTiendas: items.filter(sinTiendas).length }, 202);
});

adminPreciosRouter.get("/precios-lab/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/.test(id)) return c.json({ error: "not_found" }, 404);
  const [d, r] = await Promise.all([alLab(c, `/jobs/${id}`), alLab(c, `/results/${id}`)]);
  if (!d.ok) return d;
  const det = (await d.json()) as Record<string, unknown>;
  const res = r.ok ? ((await r.json()) as { ofertas?: unknown[] }) : { ofertas: [] };
  return c.json({ ...det, ofertas: res.ofertas ?? [] });
});

adminPreciosRouter.get("/precios-lab/:id/evidencia/:archivo", (c) => {
  const { id, archivo } = c.req.param();
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^(tiendas|buscador-\d{1,2}|web-\d{1,2})\.json$/.test(archivo)) return c.json({ error: "not_found" }, 404);
  return alLab(c, `/evidencia/${id}/${archivo}`);
});
