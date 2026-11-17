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
import { OCID_CANDIDATOS, esErrorPg, poolAdmin as pool } from "../lib/db.js";
import { actor, log } from "../lib/adminlog.js";
import { itemsDeDocumentos, leerFichasPiezas } from "../lib/fichasPiezas.js";
import { depurarReferencias } from "../lib/laboratorioPrecios.js";

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

/**
 * Lo que pagó el Estado por un bien nombrado con esas palabras (migración 338, `precios_por_texto`): catálogo de Perú
 * Compras, procesos adjudicados, compras menores y otros contratos leídos. Para los renglones leídos de las bases y del
 * contrato, que no traen CUBSO; y como segunda mirada cuando el CUBSO es el de un paquete.
 */
export async function referenciasPorTexto(consulta: string, unidad: string | null): Promise<Referencia[]> {
  if (consulta.trim().length < 5) return [];
  const r = await pool.query(
    `SELECT fuente, detalle, unidad, n, p25::float AS p25, mediana::float AS mediana, p75::float AS p75
       FROM precios_por_texto($1, $2) WHERE mediana > 0`,
    [consulta.slice(0, 300), unidad],
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  return r.rows.map((x) => ({
    fuente: String(x.fuente), detalle: String(x.detalle), unidad: (x.unidad as string) ?? null, n: Number(x.n) || 0,
    p25: (x.p25 as number) ?? null, mediana: x.mediana as number, p75: (x.p75 as number) ?? null,
  }));
}

/** El pedido al laboratorio para un ítem del contrato: con las referencias del Estado por CUBSO y por texto. */
async function entradaDeItem(ocid: string, f: ItemContrato) {
  const consulta = consultaDe(f);
  const [porCubso, porTexto] = await Promise.all([referenciasDe(f.cubso, f.unidad), referenciasPorTexto(consulta, f.unidad)]);
  return {
    consulta,
    especificacion: f.descripcion && f.descripcion !== f.descripcion_corta ? String(f.descripcion) : undefined,
    unidad: f.unidad ?? undefined,
    cantidad: f.cantidad ?? undefined,
    precioReferencia: precioDe(f) ?? undefined,
    ocid,
    item: f.numero_item,
    referencias: depurarReferencias([...porCubso, ...porTexto]).slice(0, 10),
  };
}

/** Un ítem del contrato y lo que pagó el Estado por su CUBSO. */
async function desdeContrato(ocid: string, item: number | undefined) {
  const it = await pool.query<ItemContrato>(`${ITEMS_SQL} AND ($2::int IS NULL OR ci.numero_item = $2) ORDER BY ci.numero_item LIMIT 1`, [ocidCorto(ocid), item ?? null]);
  return it.rows[0] ? entradaDeItem(ocidCorto(ocid), it.rows[0]) : null;
}

/**
 * Los renglones que leyeron los lectores por pieza (las bases y el contrato, lib/fichasPiezas.ts), como ítems del
 * laboratorio. El SEACE registra a veces un paquete como UN ítem («insumos para el programa Vaso de Leche», «adquisición
 * de lubricantes»): investigar su precio era buscar un paquete en las tiendas. Cada renglón lleva lo que pedían las
 * bases como especificación, la presentación y la marca del contrato, y su precio unitario si cuadra con su total.
 */
async function renglonesDelContrato(ocid: string): Promise<ItemContrato[]> {
  const fichas = await leerFichasPiezas(ocid).catch(() => new Map());
  const d = itemsDeDocumentos(fichas.get("bases"), fichas.get("contrato"), new Set());
  if (!d) return [];
  return d.filas.map((f, i) => {
    const k = f.contratado;
    // El producto como lo nombra el contrato («ACEITE DE MOTOR 15W40 : MOBIL DELVAC MODERN»), si no, lo que piden las bases.
    const nombre = (k?.descripcion ?? f.descripcion ?? "").replace(/\s*:\s*/, " ").trim();
    return {
      numero_item: Number(f.numero) || i + 1,
      descripcion: f.descripcion ?? k?.descripcion ?? null,
      descripcion_corta: [nombre, k?.marca && !nombre.toUpperCase().includes(k.marca.toUpperCase()) ? k.marca : null].filter(Boolean).join(", ").slice(0, 300) || null,
      cantidad: f.cantidad ?? k?.cantidad ?? null,
      // La presentación del contrato («BALDE DE 05 GALONES») dice más que la unidad de las bases («galones»).
      unidad: k?.unidad ?? f.unidad ?? null,
      precio_unit_ref: null,
      cubso: null,
      unit_adj: k?.cuadra !== false ? k?.precioUnitario ?? null : null,
    };
  });
}

/** Los ítems distintos del contrato: algunos vienen repetidos en convocatoria_items (2026-988-2: 12 filas, 6 ítems). Si
 * los documentos leídos traen más renglones que el registro (un paquete registrado como un ítem), mandan los renglones. */
async function itemsDelContrato(ocid: string): Promise<ItemContrato[]> {
  const [r, renglones] = await Promise.all([
    pool.query<ItemContrato>(`${ITEMS_SQL} ORDER BY ci.numero_item LIMIT 300`, [ocidCorto(ocid)]),
    renglonesDelContrato(ocidCorto(ocid)),
  ]);
  const vistos = new Set<string>();
  const items = r.rows.filter((f) => {
    const k = [f.descripcion_corta ?? f.descripcion, f.unidad, f.cantidad, f.precio_unit_ref].join("|").toUpperCase();
    return !vistos.has(k) && !!vistos.add(k);
  });
  return renglones.length >= 2 && renglones.length > items.length ? renglones : items;
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
  consulta: string;
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

/** Las investigaciones de cada ítem del contrato, de la más nueva a la más vieja (así viene la lista del Worker). */
async function investigacionesDe(c: Context, ocid: string): Promise<Map<number, InvestigacionCorta[]> | null> {
  const r = await alLab(c, `/jobs?ocid=${encodeURIComponent(ocid)}&limite=200`);
  if (!r.ok) return null;
  const j = (await r.json()) as { investigaciones?: InvestigacionCorta[] };
  const por = new Map<number, InvestigacionCorta[]>();
  for (const i of j.investigaciones ?? []) {
    if (i.item == null) continue;
    const k = Number(i.item);
    por.set(k, [...(por.get(k) ?? []), i]);
  }
  return por;
}

const consultaDe = (f: ItemContrato) => String(f.descripcion_corta || f.descripcion || "").slice(0, 300);
const mismaConsulta = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toUpperCase() === b.replace(/\s+/g, " ").trim().toUpperCase();

/**
 * La última investigación de ESTE renglón: mismo número y mismo producto. Sólo el número no basta: el registro del SEACE y
 * los renglones leídos numeran desde 1, y el «ítem 1» de un paquete («suministros para el Vaso de Leche», 2026-212-10) no
 * es el renglón 1 (leche evaporada). Antes, investigado el paquete, el renglón quedaba como hecho.
 */
function ultimaDe(invs: Map<number, InvestigacionCorta[]> | null, f: ItemContrato): InvestigacionCorta | null {
  return (invs?.get(f.numero_item) ?? []).find((i) => mismaConsulta(i.consulta ?? "", consultaDe(f))) ?? null;
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
    const inv = ultimaDe(invs, f);
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

type Lanzada = { item: number; id?: string; reutilizada?: boolean; error?: string };
type ResultadoContrato =
  | { ok: true; ocid: string; lanzadas: Lanzada[]; quedan: number; sinTiendas: number; items: number }
  | { ok: false; error: "sin_item" | "sin_laboratorio" };

/**
 * Lanza en el laboratorio los renglones del contrato que faltan (o todos, con `repetir`), hasta `maximo`, escalonados
 * cada 40 s desde `desde` (para no abrir a la vez las mismas tiendas, el contenedor de Crawl4AI y GLM). La usan el panel y
 * la cola (`precios_lab_cola`, el cron de 10 min).
 */
async function lanzarContrato(c: Context, ocidPedido: string, o: { web?: boolean; repetir?: boolean; autor: string; maximo?: number; desde?: number }): Promise<ResultadoContrato> {
  const ocid = ocidCorto(ocidPedido);
  const [items, invs] = await Promise.all([itemsDelContrato(ocid), investigacionesDe(c, ocid)]);
  if (!items.length) return { ok: false, error: "sin_item" };
  if (!invs) return { ok: false, error: "sin_laboratorio" };
  const pendientes = items.filter((f) => {
    if (sinTiendas(f)) return false;
    const e = ultimaDe(invs, f)?.estado;
    return o.repetir ? e !== "en_cola" && e !== "corriendo" : !e || e === "error";
  });
  const lote = pendientes.slice(0, Math.max(0, o.maximo ?? MAX_ITEMS_CONTRATO));
  const lanzadas: Lanzada[] = [];
  for (const [k, f] of lote.entries()) {
    const entrada = await entradaDeItem(ocid, f);
    if (entrada.consulta.length < 3) {
      lanzadas.push({ item: f.numero_item, error: "el ítem no tiene descripción" });
      continue;
    }
    const r = await alLab(c, "/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...entrada, web: o.web, autor: o.autor, espera: ((o.desde ?? 0) + k) * ESCALON_SEGUNDOS, repetir: o.repetir }),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; reutilizada?: boolean; error?: string };
    lanzadas.push({ item: f.numero_item, id: j.id, reutilizada: j.reutilizada, error: r.ok ? undefined : j.error ?? `HTTP ${r.status}` });
  }
  await log(o.autor, "precios_lab_contrato", `precios_lab:${ocid}`, { ocid, items: lanzadas.filter((x) => x.id && !x.reutilizada).map((x) => x.item) });
  return { ok: true, ocid, lanzadas, quedan: pendientes.length - lote.length, sinTiendas: items.filter(sinTiendas).length, items: items.length };
}

/**
 * POST /admin/precios-lab/contrato {ocid, web?, repetir?} — investiga los ítems del contrato (hasta 12), uno cada 40 s.
 */
adminPreciosRouter.post("/precios-lab/contrato", async (c) => {
  const b = PedidoContrato.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body" }, 400);
  const r = await lanzarContrato(c, b.data.ocid, { web: b.data.web, repetir: b.data.repetir, autor: actor(c) });
  if (!r.ok) {
    return r.error === "sin_item"
      ? c.json({ error: "sin_item", detail: "Ese contrato no tiene ítems cargados." }, 404)
      : c.json({ error: "sin_laboratorio", detail: "Esta API no tiene el laboratorio de precios conectado." }, 503);
  }
  const { ok: _ok, items: _n, ...cuerpo } = r;
  return c.json(cuerpo, 202);
});

/** Renglones que la cola lanza en cada vuelta del cron de 10 min (entre todos sus contratos). */
const RENGLONES_POR_VUELTA = 14;

/**
 * La cola del laboratorio (migración 338): en cada vuelta del cron toma los contratos pendientes (prioridad y antigüedad)
 * y lanza hasta RENGLONES_POR_VUELTA renglones entre ellos, escalonados. Un contrato con más renglones sigue «en curso» y
 * continúa en la vuelta siguiente; sin renglones queda «sin_items» (se vuelve a pedir cuando sus documentos estén leídos).
 * Sin la migración (42P01) o sin el laboratorio conectado, nada.
 */
export async function procesarColaPreciosLab(c: Context): Promise<Record<string, unknown> | null> {
  if (!lab(c)) return null;
  const cola = await pool.query<{ ocid: string; web: boolean; repetir: boolean; autor: string | null; vueltas: number }>(
    `SELECT ocid, web, repetir, autor, vueltas FROM precios_lab_cola
      WHERE estado IN ('pendiente', 'en_curso') AND (ultimo_at IS NULL OR ultimo_at < now() - interval '8 minutes')
      ORDER BY prioridad DESC, pedido_at LIMIT 6`,
  ).catch((e) => {
    if (!esErrorPg(e, "42P01")) throw e;
    return null;
  });
  if (!cola?.rows.length) return cola ? { contratos: 0 } : null;
  let usados = 0;
  const hechos: Record<string, unknown>[] = [];
  for (const fila of cola.rows) {
    if (usados >= RENGLONES_POR_VUELTA) break;
    let r: ResultadoContrato;
    try {
      // `repetir` sólo en la primera vuelta: en las siguientes, los que ya se lanzaron cuentan como hechos.
      r = await lanzarContrato(c, fila.ocid, { web: fila.web, repetir: fila.repetir && fila.vueltas === 0, autor: fila.autor || "cola-precios-lab",
        maximo: RENGLONES_POR_VUELTA - usados, desde: usados });
    } catch (e) {
      await pool.query(`UPDATE precios_lab_cola SET estado = 'error', ultimo_at = now(), vueltas = vueltas + 1, detalle = $2 WHERE ocid = $1`,
        [fila.ocid, JSON.stringify({ error: (e as Error).message.slice(0, 300) })]);
      hechos.push({ ocid: fila.ocid, error: "excepcion" });
      continue;
    }
    if (!r.ok) {
      await pool.query(`UPDATE precios_lab_cola SET estado = $2, ultimo_at = now(), vueltas = vueltas + 1, detalle = $3 WHERE ocid = $1`,
        [fila.ocid, r.error === "sin_item" ? "sin_items" : "error", JSON.stringify({ error: r.error })]);
      hechos.push({ ocid: fila.ocid, error: r.error });
      if (r.error === "sin_laboratorio") break;
      continue;
    }
    const nuevos = r.lanzadas.filter((x) => x.id && !x.reutilizada).length;
    usados += r.lanzadas.length;
    await pool.query(
      `UPDATE precios_lab_cola SET estado = $2, ultimo_at = now(), vueltas = vueltas + 1, lanzados = lanzados + $3, detalle = $4 WHERE ocid = $1`,
      [fila.ocid, r.quedan > 0 ? "en_curso" : "hecho", nuevos,
        JSON.stringify({ items: r.items, sinTiendas: r.sinTiendas, quedan: r.quedan, errores: r.lanzadas.filter((x) => x.error).length })],
    );
    hechos.push({ ocid: r.ocid, lanzados: nuevos, quedan: r.quedan });
  }
  return { contratos: hechos.length, renglones: usados, hechos };
}

const PedidoCola = z.object({
  ocids: z.array(z.string().trim().regex(/^[A-Za-z0-9-]{3,80}$/)).min(1).max(2000),
  motivo: z.string().trim().max(200).optional(),
  prioridad: z.number().int().min(-10).max(10).optional(),
  web: z.boolean().optional(),
  repetir: z.boolean().optional(),
});

/** POST /admin/precios-lab/cola {ocids[], motivo?, prioridad?, web?, repetir?} — pone contratos en la cola (o los reabre). */
adminPreciosRouter.post("/precios-lab/cola", async (c) => {
  const b = PedidoCola.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body" }, 400);
  const p = b.data;
  const r = await pool.query(
    `INSERT INTO precios_lab_cola (ocid, prioridad, web, repetir, autor, motivo)
     SELECT DISTINCT ocid_corto(x), $2, $3, $4, $5, $6 FROM unnest($1::text[]) x
     ON CONFLICT (ocid) DO UPDATE SET estado = 'pendiente', pedido_at = now(), prioridad = EXCLUDED.prioridad, web = EXCLUDED.web,
       repetir = EXCLUDED.repetir, autor = EXCLUDED.autor, motivo = EXCLUDED.motivo, vueltas = 0
     WHERE precios_lab_cola.estado NOT IN ('pendiente', 'en_curso') OR EXCLUDED.repetir`,
    [p.ocids, p.prioridad ?? 0, p.web ?? true, p.repetir ?? false, actor(c), p.motivo ?? null],
  );
  await log(actor(c), "precios_lab_cola", "precios_lab_cola", { contratos: p.ocids.length, motivo: p.motivo ?? null });
  return c.json({ encolados: r.rowCount ?? 0 }, 202);
});

/** GET /admin/precios-lab/cola — cuántos contratos hay en cada estado y los últimos movidos. */
adminPreciosRouter.get("/precios-lab/cola", async (c) => {
  const [porEstado, ultimos] = await Promise.all([
    pool.query(`SELECT estado, count(*)::int AS n, sum(lanzados)::int AS lanzados FROM precios_lab_cola GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT ocid, estado, motivo, prioridad, vueltas, lanzados, detalle, to_char(pedido_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS "pedidoAt",
                       to_char(ultimo_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS "ultimoAt"
                  FROM precios_lab_cola ORDER BY COALESCE(ultimo_at, pedido_at) DESC LIMIT 60`),
  ]);
  return c.json({ porEstado: porEstado.rows, ultimos: ultimos.rows });
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
