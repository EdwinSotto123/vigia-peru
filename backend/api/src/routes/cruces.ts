/**
 * GET /cruces — los procesos con buena pro cuyo ganador tiene cruces con otras fuentes (aportes y gastos de campaña,
 * candidaturas, sanciones, penalidades, visitas, socios comunes, fraccionamiento…), a escala nacional y con filtros.
 * Lee `casos_cruce` (migración 57: una fila por proceso × ganador, rehecha tras cada `refrescar_cruces()`). El detalle
 * de cada cruce, con su fuente y las personas, está en la ficha del contrato (GET /contratos/:ocid → `cruces`).
 *
 *   ?tipo=aporte,socio_comun   cualquiera de esos tipos (o `todos=1`: todos a la vez)
 *   ?severidad=alta|media|baja la severidad MÍNIMA del caso (alta = sólo casos con un cruce alto)
 *   ?departamento=05  ?contratacion=bienes  ?entidad=<RUC>  ?q=texto  ?desde=  ?hasta=  ?montoMin=
 *   ?orden=puntaje|reciente|monto   ?limit=  ?offset=
 *
 * Las facetas (tipos, severidad, departamentos, contratación) cuentan sobre los casos filtrados por todo lo demás:
 * así cada opción dice cuántos quedarían al elegirla.
 */
import { Hono } from "hono";
import { z } from "zod";
import { escaparLike, pool } from "../lib/db.js";
import { cachePublico, fechaIso, parametros } from "../lib/http.js";
import { ETIQUETA_CRUCE } from "../lib/cruces.js";
import { publicar } from "../lib/privacidad.js";

export const crucesRouter = new Hono();

const lista = (v: string | undefined) => (v ? v.split(",").map((x) => x.trim()).filter((x) => /^[a-z_]{2,40}$/.test(x)) : []);

const Query = z.object({
  tipo: z.string().max(400).optional(),
  todos: z.enum(["1", "0"]).optional(),
  severidad: z.enum(["alta", "media", "baja"]).optional(),
  departamento: z.string().regex(/^\d{2}$/).optional(),
  contratacion: z.string().regex(/^[a-z_]{2,20}$/).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  q: z.string().trim().max(120).optional(),
  desde: fechaIso().optional(),
  hasta: fechaIso().optional(),
  montoMin: z.coerce.number().min(0).optional(),
  orden: z.enum(["puntaje", "reciente", "monto"]).default("puntaje"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
type Q = z.infer<typeof Query>;
type Dim = "tipo" | "severidad" | "departamento" | "contratacion";

const ORDEN: Record<Q["orden"], string> = {
  puntaje: "k.puntaje DESC, k.fecha_buena_pro DESC NULLS LAST, k.ocid, k.ruc",
  reciente: "k.fecha_buena_pro DESC NULLS LAST, k.puntaje DESC, k.ocid, k.ruc",
  monto: "k.monto DESC NULLS LAST, k.puntaje DESC, k.ocid, k.ruc",
};
const SEV_MIN: Record<string, string> = {
  alta: "k.n_alta > 0",
  media: "(k.n_alta > 0 OR k.n_media > 0)",
  baja: "TRUE",
};

/** WHERE de los filtros, sin la dimensión `sin` (para la faceta de esa dimensión). */
function filtros(q: Q, sin?: Dim): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const tipos = lista(q.tipo);
  if (tipos.length && sin !== "tipo") conds.push(`k.tipos ${q.todos === "1" ? "@>" : "&&"} ${p(tipos)}::text[]`);
  if (q.severidad && sin !== "severidad") conds.push(SEV_MIN[q.severidad]);
  if (q.departamento && sin !== "departamento") conds.push(`k.departamento = ${p(q.departamento)}`);
  if (q.contratacion && sin !== "contratacion") conds.push(`k.tipo_contratacion = ${p(q.contratacion)}`);
  if (q.entidad) conds.push(`k.entidad_ruc = ${p(q.entidad)}`);
  if (q.q) {
    for (const w of q.q.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6))
      conds.push(`k.texto LIKE ${p(`%${escaparLike(w)}%`)}`);
  }
  if (q.desde) conds.push(`k.fecha_buena_pro >= ${p(q.desde)}::date`);
  if (q.hasta) conds.push(`k.fecha_buena_pro <= ${p(q.hasta)}::date`);
  if (q.montoMin) conds.push(`k.monto >= ${p(q.montoMin)}`);
  return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

crucesRouter.get("/", async (c) => {
  const parsed = Query.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "parametros_invalidos", detalle: parsed.error.issues }, 400);
  const q = parsed.data;
  const f = filtros(q);
  // Con `todos=1` cada chip de tipo cuenta los casos que, además, tienen todos los ya elegidos.
  const fT = q.todos === "1" ? f : filtros(q, "tipo"), fS = filtros(q, "severidad"), fD = filtros(q, "departamento"), fC = filtros(q, "contratacion");
  const res = await Promise.all([
    pool.query(
      `SELECT k.* FROM casos_cruce k ${f.where} ORDER BY ${ORDEN[q.orden]} LIMIT ${q.limit} OFFSET ${q.offset}`, f.params),
    // Los distintos por GROUP BY (hash): count(DISTINCT) ordena texto y sin filtros eran 1,3 s; así, 0,5 s.
    pool.query(
      `WITH k AS MATERIALIZED (SELECT k.ocid, k.entidad_ruc, k.ruc, k.monto, k.n_alta FROM casos_cruce k ${f.where})
       SELECT (SELECT count(*)::int FROM k) AS total,
              (SELECT count(*)::int FROM (SELECT ocid FROM k GROUP BY 1) x) AS procesos,
              (SELECT count(*)::int FROM (SELECT entidad_ruc FROM k WHERE entidad_ruc IS NOT NULL GROUP BY 1) x) AS entidades,
              (SELECT count(*)::int FROM (SELECT ruc FROM k WHERE ruc IS NOT NULL GROUP BY 1) x) AS proveedores,
              (SELECT COALESCE(sum(monto), 0)::float FROM k) AS monto,
              (SELECT count(*)::int FROM k WHERE n_alta > 0) AS altas`, f.params),
    pool.query(`SELECT t AS valor, count(*)::int AS n FROM casos_cruce k, unnest(k.tipos) t ${fT.where} GROUP BY t ORDER BY n DESC`, fT.params),
    pool.query(
      `SELECT count(*) FILTER (WHERE k.n_alta > 0)::int AS alta,
              count(*) FILTER (WHERE k.n_alta > 0 OR k.n_media > 0)::int AS media, count(*)::int AS baja
         FROM casos_cruce k ${fS.where}`, fS.params),
    pool.query(
      `SELECT k.departamento AS valor, z.nombre, count(*)::int AS n FROM casos_cruce k
         LEFT JOIN zonas z ON z.ubigeo = k.departamento ${fD.where} GROUP BY 1, 2 ORDER BY n DESC`, fD.params),
    pool.query(`SELECT k.tipo_contratacion AS valor, count(*)::int AS n FROM casos_cruce k ${fC.where} GROUP BY 1 ORDER BY n DESC`, fC.params),
  ]).catch((e) => {
    // Sin la migración 57 la ruta responde vacío (la web muestra "aún no hay cruces").
    if (/casos_cruce/.test(String(e?.message))) return null;
    throw e;
  });
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  if (!res) return c.json({ total: 0, casos: [], resumen: null, facetas: null });
  const [pagina, resumen, tipos, sev, dptos, contr] = res;
  const fecha = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);
  return c.json(publicar({
    total: resumen.rows[0].total,
    resumen: resumen.rows[0],
    casos: pagina.rows.map((r) => ({
      ocid: r.ocid, codigo: r.codigo, objeto: r.objeto, tipoContratacion: r.tipo_contratacion,
      entidadRuc: r.entidad_ruc, entidad: r.entidad, departamento: r.departamento,
      fechaBuenaPro: fecha(r.fecha_buena_pro), montoSoles: r.monto == null ? null : Number(r.monto),
      rucProveedor: r.ruc, proveedor: r.proveedor, consorcio: r.consorcio,
      severidad: r.severidad, puntaje: r.puntaje,
      cruces: (r.cruces as { tipo: string; severidad: string; n: number }[]).map((x) => ({ ...x, etiqueta: ETIQUETA_CRUCE[x.tipo] ?? x.tipo })),
    })),
    facetas: {
      tipos: tipos.rows.map((r) => ({ ...r, etiqueta: ETIQUETA_CRUCE[r.valor] ?? r.valor })),
      severidad: sev.rows[0],
      departamentos: dptos.rows.filter((r) => r.valor),
      contratacion: contr.rows.filter((r) => r.valor),
    },
  }));
});
