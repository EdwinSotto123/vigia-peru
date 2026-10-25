import { Hono, type Context } from "hono";
import { z } from "zod";
import { consultaConPlazo } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";

// Tipo mínimo del binding R2 (no importamos workers/env.ts para no arrastrar los tipos de Cloudflare al tsconfig de Node).
type BucketR2 = { get(key: string): Promise<{ body: ReadableStream | null } | null> };

/**
 * Contratos menores (≤8 UIT) del SEACE (tabla seace_menores, migración 129): la fase de contratación directa que NO está
 * en el reporte de órdenes de CONOSCE ni en los datos abiertos OCDS. Une prod4 (el contrato: entidad+RUC, proveedor+RUC,
 * monto, PDF) con prod6 (el requerimiento/TDR). Una sola lista con filtros sirve tres superficies:
 *   GET /menores                      → sección navegable
 *   GET /menores?proveedor=<RUC>      → ficha de empresa («contratos menores que ganó»)
 *   GET /menores?entidad=<RUC>        → ficha de entidad
 * Los PDF se sirven por proxy (el WAF del SEACE exige cabeceras Referer/Origin que un enlace directo del navegador no
 * manda): GET /menores/:id/requerimiento (prod6) y GET /menores/:id/contrato (prod4).
 */
export const menoresRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "menores:lista", ttlMs: 600_000, staleMs: 600_000, max: 300 });

// Años con datos, en JS (sin tocar la base): 2024..año actual (el módulo de menores es reciente).
const listaAnios = (): number[] => {
  const max = new Date().getFullYear();
  const out: number[] = [];
  for (let y = max; y >= 2024; y--) out.push(y);
  return out;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const PROD4_DOC = "https://prod4.seace.gob.pe:9000/api/con/documentos/descargar";

const Lista = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2024).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  proveedor: z.string().regex(/^\d{11}$/).optional(),
  objeto: z.enum(["bien", "servicio"]).optional(),
  estado: z.string().trim().min(3).max(30).optional(),
  conReq: z.enum(["si"]).optional(), // solo las que ya tienen requerimiento (prod6)
  orden: z.enum(["reciente", "antiguo"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));

menoresRouter.get("/", async (c) => {
  const parsed = Lista.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await memo.obtener(JSON.stringify(q), async () => {
    const vals: unknown[] = [];
    const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds: string[] = ["m.monto > 0"];
    // entidad/proveedor son 11 dígitos (validados por zod) → literal, para que el planner use su índice.
    if (q.entidad) conds.push(`m.entidad_ruc = '${q.entidad}'`);
    if (q.proveedor) conds.push(`m.proveedor_ruc = '${q.proveedor}'`);
    if (q.anio) conds.push(`m.anio = ${p(q.anio)}`);
    if (q.objeto) conds.push(`m.objeto = ${p(q.objeto === "bien" ? "BIEN" : "SERVICIO")}`);
    if (q.estado) conds.push(`m.estado = ${p(q.estado)}`);
    if (q.conReq) conds.push(`m.id_requerimiento IS NOT NULL`);
    for (const w of palabrasBusqueda(q.q)) {
      conds.push(`mef_norm(COALESCE(m.descripcion,'') || ' ' || COALESCE(m.entidad,'') || ' ' || COALESCE(m.proveedor,'') || ' ' || COALESCE(m.codigo,'')) LIKE ${p(`%${w}%`)}`);
    }
    const dir = q.orden === "antiguo" ? "ASC" : "DESC";
    const offset = (q.page - 1) * q.size;
    const lim = q.size + 1; // una de más para saber si hay página siguiente
    const COLS = `m.id_contrato AS id, m.codigo, m.numero_contrato AS numero, m.objeto, m.descripcion,
                  m.entidad, m.entidad_ruc AS "entidadRuc", m.proveedor, m.proveedor_ruc AS "proveedorRuc",
                  m.monto::float AS monto, m.moneda, m.estado, to_char(m.fecha_suscripcion,'YYYY-MM-DD') AS fecha, m.anio,
                  (m.id_documento_contrato IS NOT NULL) AS "tieneContrato",
                  m.req_r2 AS "tieneRequerimiento", m.requerimiento_nombre AS "requerimientoNombre",
                  m.estado_prod6 AS "estadoProceso", to_char(m.fec_publica,'YYYY-MM-DD') AS "fecPublica",
                  to_char(m.fec_ini_cotizacion,'YYYY-MM-DD') AS "cotizaDesde", to_char(m.fec_fin_cotizacion,'YYYY-MM-DD') AS "cotizaHasta"`;
    const sql = `SELECT ${COLS} FROM seace_menores m WHERE ${conds.join(" AND ")}
                 ORDER BY m.fecha_suscripcion ${dir} NULLS LAST, m.id_contrato ${dir} LIMIT ${lim} OFFSET ${offset}`;
    const r = await consultaConPlazo(sql, vals);
    const hayMas = r.rows.length > q.size;
    return publicar({ page: q.page, size: q.size, hayMas, anclado: !!(q.entidad || q.proveedor),
                      anio: q.anio ?? null, anios: listaAnios(), data: r.rows.slice(0, q.size) });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/** Proxy de PDF: trae el archivo del SEACE con las cabeceras que el WAF exige y lo devuelve con caché. */
async function proxyPdf(url: string, referer: string, nombre: string, c: Context) {
  const up = await fetch(url, { headers: { "User-Agent": UA, "Referer": referer, "Origin": new URL(referer).origin, "Accept": "application/pdf,*/*" } });
  if (!up.ok || !up.body) return c.json({ error: "pdf_no_disponible" }, 502);
  return new Response(up.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombre.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}

// Requerimiento/TDR del proceso (prod6): se sirve desde R2 (vigia-peru-batch), porque el WAF de prod6 bloquea el egress
// de Cloudflare y no se puede traer en vivo. Lo espeja a R2 backend/scripts/cargar_seace_menores.py --espejar.
menoresRouter.get("/:id/requerimiento", async (c) => {
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.json({ error: "id_invalido" }, 400);
  const bucket = (c.env as { DOCUMENTOS?: BucketR2 } | undefined)?.DOCUMENTOS;
  if (!bucket) return c.json({ error: "sin_r2" }, 404);
  const obj = await bucket.get(`seace/menores/req/${id}.pdf`);
  if (!obj) return c.json({ error: "sin_requerimiento" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="requerimiento-${id}.pdf"`,
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
});

// Contrato u orden ya firmada (prod4).
menoresRouter.get("/:id/contrato", async (c) => {
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.json({ error: "id_invalido" }, 400);
  const r = await consultaConPlazo("SELECT id_documento_contrato, codigo FROM seace_menores WHERE id_contrato=$1", [id]);
  const row = r.rows[0] as { id_documento_contrato: string | null; codigo: string | null } | undefined;
  if (!row?.id_documento_contrato) return c.json({ error: "sin_contrato" }, 404);
  return proxyPdf(`${PROD4_DOC}/${row.id_documento_contrato}`,
                  "https://prod4.seace.gob.pe/contratos/publico/", `contrato-${row.codigo ?? id}.pdf`, c);
});
