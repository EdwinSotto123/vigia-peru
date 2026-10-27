import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import {
  BANDERA_INVERSION, BANDERA_OBRA, ESTADO_OBRA, MODALIDAD_OBRA, MONTO_INVERSION, MONTO_OBRA,
  aInversion, aObra, diaInfobras, facetasDe, sqlFacetasInversiones, sqlFacetasObras, sqlListaInversiones, sqlListaObras, sqlResumenEntidad,
} from "../lib/obras.js";

/**
 * Obras públicas (INFOBRAS) e inversiones (Invierte.pe) de una entidad o de una empresa (migración 160):
 *   GET /obras?entidad=<RUC>                 las obras que registra la entidad en INFOBRAS (su pestaña «Obras»)
 *   GET /obras?empresa=<RUC 20>              las que ejecuta o supervisa la empresa (sola o en consorcio)
 *   GET /obras/inversiones?entidad=<RUC>     sus inversiones de Invierte.pe (activas y cerradas)
 *   GET /obras/resumen?entidad=<RUC>         cuántas y con qué banderas (el número de la pestaña y el Inicio)
 * Cada fila trae sus banderas con su evidencia, el contrato de Vigía que la ejecuta o supervisa (si se reconoce) y el
 * enlace a su ficha oficial. Una empresa se pide sólo con RUC 20: un RUC 10 lleva un DNI (docs/PRIVACIDAD.md).
 * Todo pasa por publicar(): el ejecutor o el supervisor que es persona natural sale con su ref y un apellido tapado.
 */
export const obrasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "obras:lista", ttlMs: 600_000, staleMs: 3_600_000, max: 400 });

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
const claves = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]];

export const ListaObrasQuery = z.object({
  entidad: z.string().regex(/^\d{11}$/).optional(),
  empresa: z.string().regex(/^20\d{9}$/).optional(),
  rol: z.enum(["ejecucion", "supervision"]).optional(),
  q: z.string().trim().min(2).max(80).optional(),
  estado: z.enum(claves(ESTADO_OBRA)).optional(),
  bandera: z.enum(["con", "alta", ...claves(BANDERA_OBRA)]).optional(),
  modalidad: z.enum(claves(MODALIDAD_OBRA)).optional(),
  monto: z.enum(claves(MONTO_OBRA)).optional(),
  anio: z.coerce.number().int().min(1990).max(2100).optional(),
  contrato: z.enum(["con"]).optional(),
  orden: z.enum(["reciente", "antiguo", "monto"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(25),
}).refine((q) => !!q.entidad !== !!q.empresa, { message: "una entidad o una empresa (RUC 20)" });

export const ListaInversionesQuery = z.object({
  entidad: z.string().regex(/^\d{11}$/),
  q: z.string().trim().min(2).max(80).optional(),
  estado: z.enum(["activa", "cerrada"]).optional(),
  bandera: z.enum(["con", ...claves(BANDERA_INVERSION)]).optional(),
  funcion: z.string().trim().min(2).max(80).optional(),
  monto: z.enum(claves(MONTO_INVERSION)).optional(),
  contrato: z.enum(["con"]).optional(),
  orden: z.enum(["reciente", "antiguo", "monto"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(25),
});

/** ¿Ya están las tablas de la migración 160? Presentes, no se vuelve a preguntar; ausentes, cada minuto. */
let tablas: { ok: boolean; at: number } | null = null;
export async function hayObras(): Promise<boolean> {
  if (tablas && (tablas.ok || Date.now() - tablas.at < 60_000)) return tablas.ok;
  try {
    const r = await pool.query<{ ok: boolean }>(`SELECT to_regclass('public.obra_infobras') IS NOT NULL AND to_regclass('public.contrato_cui') IS NOT NULL AS ok`);
    tablas = { ok: !!r.rows[0]?.ok, at: Date.now() };
  } catch {
    return false;
  }
  return tablas.ok;
}

obrasRouter.get("/", async (c) => {
  const parsed = ListaObrasQuery.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  if (!(await hayObras())) return c.json({ page: q.page, size: q.size, total: 0, hayMas: false, sinDatos: true, facetas: null, data: [] });
  const cuerpo = await memo.obtener(`obras:${JSON.stringify(q)}`, async () => {
    const lista = sqlListaObras(q, q.orden, q.page, q.size);
    const fa = sqlFacetasObras(q);
    const [r, f, al] = await Promise.all([
      consultaConPlazo(lista.sql, lista.vals),
      // Sin conteos, la barra filtra igual (sin números) y el total sale de la página.
      consultaConPlazo(fa.sql, fa.vals).catch(() => null),
      diaInfobras(),
    ]);
    const { total, facetas } = facetasDe(f?.rows[0], ["anio"]);
    const data = r.rows.map((x) => aObra(x, al));
    return publicar({
      page: q.page, size: q.size, total, hayMas: total != null ? q.page * q.size < total : data.length === q.size,
      ancla: q.empresa ? "empresa" : "entidad", alDia: al, facetas, data,
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

obrasRouter.get("/inversiones", async (c) => {
  const parsed = ListaInversionesQuery.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  if (!(await hayObras())) return c.json({ page: q.page, size: q.size, total: 0, hayMas: false, sinDatos: true, facetas: null, data: [] });
  const cuerpo = await memo.obtener(`inversiones:${JSON.stringify(q)}`, async () => {
    const lista = sqlListaInversiones(q, q.orden, q.page, q.size);
    const fa = sqlFacetasInversiones(q);
    const [r, f] = await Promise.all([consultaConPlazo(lista.sql, lista.vals), consultaConPlazo(fa.sql, fa.vals).catch(() => null)]);
    const { total, facetas } = facetasDe(f?.rows[0], ["funcion"]);
    const data = r.rows.map(aInversion);
    return publicar({ page: q.page, size: q.size, total, hayMas: total != null ? q.page * q.size < total : data.length === q.size, facetas, data });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

obrasRouter.get("/resumen", async (c) => {
  const ruc = c.req.query("entidad") ?? "";
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  if (!(await hayObras())) return c.json({ obras: null, inversiones: null, alDia: null });
  const cuerpo = await memo.obtener(`resumen:${ruc}`, async () => {
    const [r, al] = await Promise.all([pool.query(sqlResumenEntidad(ruc)), diaInfobras()]);
    const fila = r.rows[0] ?? {};
    return { obras: fila.obras ?? null, inversiones: fila.inversiones ?? null, alDia: al };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
