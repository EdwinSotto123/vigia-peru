/**
 * Laboratorio de precios (2026-11-12): el panel pide investigaciones al Worker vigia-precios-lab (service binding
 * PRECIOS_LAB; el Worker no tiene dirección pública) y las muestra.
 *
 *   POST /admin/precios-lab                      {consulta?, especificacion?, unidad?, cantidad?, precioReferencia?,
 *                                                ocid?, item?, web?}. Con `ocid` arma el pedido desde el ítem del
 *                                                contrato (descripción, unidad, cantidad, precio unitario adjudicado o
 *                                                de referencia) y suma lo que pagó el Estado por el mismo CUBSO.
 *   GET  /admin/precios-lab                      las últimas investigaciones y el gasto total
 *   GET  /admin/precios-lab/:id                  estado, pasos, ficha, resumen y ofertas
 *   GET  /admin/precios-lab/:id/evidencia/:archivo   lo leído de cada página (R2)
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { poolAdmin as pool } from "../lib/db.js";
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

/** El ítem del contrato y lo que pagó el Estado por su CUBSO (procesos y compras menores). */
async function desdeContrato(ocid: string, item: number | undefined) {
  const it = await pool.query(
    `SELECT ci.numero_item, ci.descripcion, ci.descripcion_corta, ci.cantidad::float, ci.unidad, ci.precio_unit_ref::float, ci.cubso,
            pi.unit_adj::float AS unit_adj
       FROM convocatoria_items ci
       LEFT JOIN precio_item pi ON pi.ocid = ci.ocid AND pi.posicion = ci.numero_item
      WHERE ci.ocid = $1 AND ($2::int IS NULL OR ci.numero_item = $2)
      ORDER BY ci.numero_item LIMIT 1`,
    [ocid.replace(/^OECE-/i, ""), item ?? null],
  );
  const f = it.rows[0];
  if (!f) return null;
  const referencias: Referencia[] = [];
  if (f.cubso) {
    const [proc, men] = await Promise.all([
      pool.query(
        `SELECT DISTINCT ON (cubso) unidad, anio, n::int, p25::float, mediana::float, p75::float
           FROM precio_referencia WHERE cubso = $1 AND mediana > 0 AND base = 'adjudicado' ORDER BY cubso, anio DESC, n DESC`,
        [f.cubso],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      pool.query(
        `SELECT max(i.unidad) AS unidad, count(*)::int AS n,
                percentile_cont(0.25) WITHIN GROUP (ORDER BY i.precio_unitario)::float AS p25,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY i.precio_unitario)::float AS mediana,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY i.precio_unitario)::float AS p75
           FROM seace_menor_item i JOIN seace_menores m USING (id_contrato)
          WHERE i.cubso = $1 AND i.precio_unitario > 0 AND m.fecha_suscripcion >= current_date - 730`,
        [f.cubso],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);
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
  }
  return {
    consulta: String(f.descripcion_corta || f.descripcion || "").slice(0, 300),
    especificacion: f.descripcion && f.descripcion !== f.descripcion_corta ? String(f.descripcion) : undefined,
    unidad: f.unidad ?? undefined,
    cantidad: f.cantidad ?? undefined,
    precioReferencia: f.unit_adj > 0 ? f.unit_adj : f.precio_unit_ref > 0 ? f.precio_unit_ref : undefined,
    item: f.numero_item,
    referencias,
  };
}

adminPreciosRouter.post("/precios-lab", async (c) => {
  const b = Pedido.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body" }, 400);
  const p = b.data;
  let entrada: Record<string, unknown> = { ...p };
  if (p.ocid) {
    const d = await desdeContrato(p.ocid, p.item);
    if (!d) return c.json({ error: "sin_item", detail: "Ese contrato no tiene ítems cargados." }, 404);
    // Lo que escribió quien pide manda sobre lo que trae el contrato.
    entrada = { ...d, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) };
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
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^(tiendas|web-\d{1,2})\.json$/.test(archivo)) return c.json({ error: "not_found" }, 404);
  return alLab(c, `/evidencia/${id}/${archivo}`);
});
