import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";
import { convocatoriaNoDemo } from "../lib/publicacion.js";
import { POR_ARCHIVO, leerPaginaSitemap } from "../lib/sitemap.js";
import { NOMBRE_VALIDO } from "./entidades.js";

/**
 * GET /sitemap y GET /sitemap/:tipo/:pagina — los identificadores que la web lista en su sitemap.xml
 * (frontend/app/sitemap.xml y app/sitemaps/[archivo]). Sólo fichas que se indexan y no son de personas naturales:
 * entidades, empresas (empresa_resumen, todas RUC 20), contratos (convocatorias, sin las de demo) y plazas CAS. Las fichas
 * de personas (locadores y planilla) son noindex y no van.
 *
 * Cada página son `POR_ARCHIVO` identificadores en el orden de la llave primaria. Sin fecha de cambio: la que guardan las
 * tablas es la de la última carga, no la del contenido, y Google ignora un lastmod que no es fiel. Un día en la caché del
 * borde (la página más honda, la última de contratos, tarda ~1 s en frío).
 */
export const sitemapRouter = new Hono();

const CACHE = cachePublico(86_400, { maxAge: 3_600, swr: 86_400 });

/** Cada tipo: de dónde sale, su identificador (el de la URL de su ficha) y qué filas entran. */
const FUENTES = {
  entidades: { desde: "entidades e", id: "e.ruc", donde: NOMBRE_VALIDO("immutable_unaccent(lower(e.nombre))") },
  empresas: { desde: "empresa_resumen e", id: "e.ruc", donde: "e.ruc LIKE '20%'" },
  contratos: { desde: "convocatorias c", id: "c.ocid", donde: convocatoriaNoDemo("c") },
  plazas: { desde: "servir_convocatoria s", id: "s.aviso", donde: "true" },
} as const;
type Tipo = keyof typeof FUENTES;
const TIPOS = Object.keys(FUENTES) as Tipo[];

const totalesMemo = new Memo<Record<Tipo, number>>({ nombre: "sitemap:totales", ttlMs: 21_600_000, staleMs: 86_400_000, max: 1 });

sitemapRouter.get("/", async (c) => {
  const totales = await totalesMemo.obtener("todos", async () => {
    const n = await Promise.all(
      TIPOS.map((t) =>
        pool
          .query<{ n: number }>(`SELECT count(*)::int AS n FROM ${FUENTES[t].desde} WHERE ${FUENTES[t].donde}`)
          .then((r) => r.rows[0]?.n ?? 0),
      ),
    );
    return Object.fromEntries(TIPOS.map((t, i) => [t, n[i]])) as Record<Tipo, number>;
  });
  c.header("Cache-Control", CACHE);
  return c.json({ porArchivo: POR_ARCHIVO, totales });
});

sitemapRouter.get("/:tipo/:pagina", async (c) => {
  const p = leerPaginaSitemap(c.req.param("tipo"), c.req.param("pagina"), TIPOS);
  if (!p) return c.json({ error: "not_found" }, 404);
  const f = FUENTES[p.tipo];
  const r = await pool.query<{ id: string }>(
    `SELECT ${f.id}::text AS id FROM ${f.desde} WHERE ${f.donde} ORDER BY ${f.id} OFFSET $1 LIMIT $2`,
    [p.offset, POR_ARCHIVO],
  );
  c.header("Cache-Control", CACHE);
  return c.json({ tipo: p.tipo, pagina: p.pagina, ids: r.rows.map((x) => x.id) });
});
