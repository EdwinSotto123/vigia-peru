/**
 * Lo que encontró la Contraloría, buscable (migraciones 304 y 305, lib/contraloriaFichas.ts).
 *
 *   GET /informes-control/buscar?q=&entidad=&desde=&n=
 *     q        lo que se busca, en palabras normales («pagos por partidas no ejecutadas», «fraccionamiento»);
 *     entidad  RUC de la entidad (11 dígitos) o palabras de su nombre;
 *     desde    fecha de emisión mínima (AAAA-MM-DD o AAAA);
 *     n        cuántos trozos (1 a 30; 10).
 *   Búsqueda híbrida (palabras + significado, por buscar_informe_control) en las observaciones y los objetivos de las
 *   Fichas Resumen: cada resultado es una observación con su tema y los datos de su informe. Pública, en caché y con
 *   límite por IP como GET /documentos/buscar (un embedding por Workers AI y dos índices por búsqueda).
 *
 *   GET /informes-control/resumen?tema=&n=
 *     el mapa de lo observado (migración 314): cuántas observaciones se leyeron, cuánto perjuicio cuantifican, por tema
 *     y por año, y las entidades con más perjuicio señalado (con `tema`, sólo el de ese tema). Sin textos ni personas.
 *
 *   GET /informes-control/:codigo
 *     un informe con el detalle de su ficha: objetivo, montos, observaciones (tema, perjuicio, normas, obras, contratos,
 *     procesos, empresas) y los funcionarios comprendidos, con su responsabilidad PRESUNTA (si existe la vista 302).
 *
 * Todo sale por publicar() (lib/privacidad.ts): los implicados con un apellido tapado, sin DNI ni RUC 10.
 */
import { Hono } from "hono";
import { z } from "zod";
import { esErrorPg, pool } from "../lib/db.js";
import { claveIp, dentroDeTope, ipCliente, pedidoInterno } from "../lib/antibots.js";
import { SIN_CACHE, cachePublico, fechaIso, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import type { IaWorkers } from "../lib/rag.js";
import { TEMAS_CONTROL, buscarInformesControl, detallesDeInformes } from "../lib/contraloriaFichas.js";
import { Memo } from "../lib/cache.js";

export const informesControlRouter = new Hono();

const WEB = "https://vigia.gobserva.cloud";
const TOPE_BUSCAR = 20;
const AVISO = "Responsabilidad PRESUNTA: la Contraloría la identifica y la deriva; no es una condena.";

const Buscar = z.object({
  q: z.string().trim().min(3).max(300),
  entidad: z.string().trim().min(3).max(120).optional(),
  // AAAA o una fecha que exista (fechaIso: un 2026-02-30 pasaba un regex y la base respondía 500).
  desde: z.union([z.string().trim().regex(/^(19|20)\d{2}$/), fechaIso()]).optional(),
  n: z.coerce.number().int().min(1).max(30).default(10),
});

informesControlRouter.get("/buscar", async (c) => {
  const leido = Buscar.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!leido.success) return c.json({ error: "pedido_invalido", issues: leido.error.issues }, 400);
  const p = leido.data;
  if (!pedidoInterno(c) && !(await dentroDeTope(`control|${claveIp(ipCliente(c))}`, TOPE_BUSCAR, 60))) {
    c.header("Retry-After", "60");
    return c.json({ error: "demasiados_pedidos", detail: "Son muchas búsquedas seguidas: espera un minuto.", reintentarEn: 60 }, 429);
  }
  const ia = (c.env as { AI?: IaWorkers } | undefined)?.AI;
  try {
    const r = await buscarInformesControl({ q: p.q, entidad: p.entidad ?? null, desde: p.desde?.length === 4 ? `${p.desde}-01-01` : p.desde ?? null, n: p.n }, ia);
    const resultados = r.resultados.map((x) => ({
      ...x,
      enlace: x.entidadRuc && /^\d{11}$/.test(x.entidadRuc) ? `${WEB}/entidad/${x.entidadRuc}?seccion=control` : null,
    }));
    let nota = "Observaciones (y objetivos) de las Fichas Resumen de los informes de control de la Contraloría. " +
      "Búsqueda por palabras y por significado; `tema` es el de la lectura de IA (GLM 5.3 flash) y «objetivo» marca el " +
      "objetivo del informe. Cita el número del informe y su ficha (urlFicha). " + AVISO;
    if (r.modo === "texto") nota += " Esta vez la búsqueda fue sólo por palabras (sin significado).";
    if (!resultados.length) nota += " No se encontró nada con esas palabras ni con ese sentido.";
    // Sólo por palabras porque Workers AI falló: que no quede guardada en el borde.
    c.header("Cache-Control", r.modo === "hibrido" || !ia ? cachePublico(600, { maxAge: 120 }) : SIN_CACHE);
    return c.json(publicar({ ...r, resultados, nota }));
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883")) return c.json({ error: "no_disponible", detail: "El buscador de informes de control todavía no existe en esta base." }, 503);
    if (/statement timeout|canceling statement/i.test(String((e as Error).message))) {
      return c.json({ error: "consulta_lenta", detail: "La búsqueda tardó demasiado: acota con entidad o desde." }, 504);
    }
    throw e;
  }
});

const TEMAS_OBSERVACION = ["seleccion_contratacion", "ejecucion_contractual", "pagos_adelantos", "personal_planillas", "bienes_almacen", "presupuesto_tesoreria", "otros"] as const;
const Resumen = z.object({
  tema: z.enum(TEMAS_OBSERVACION).optional(),
  n: z.coerce.number().int().min(5).max(100).default(30),
});
const memoResumen = new Memo<Record<string, unknown>>({ nombre: "control-resumen", ttlMs: 900_000, staleMs: 3_600_000, max: 40 });
const AVISO_PERJUICIO = "El perjuicio es el que cuantifica cada observación según una lectura automática de su Ficha Resumen: " +
  "un orden de magnitud para saber dónde mirar, no una liquidación. Si varias observaciones de un informe repiten el mismo monto, se cuenta una vez.";

// Antes de /:codigo: «resumen» no es un código de informe.
informesControlRouter.get("/resumen", async (c) => {
  const leido = Resumen.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!leido.success) return c.json({ error: "pedido_invalido", issues: leido.error.issues }, 400);
  const q = leido.data;
  try {
    const cuerpo = await memoResumen.obtener(JSON.stringify(q), async () => {
      const PERJ = (m: string) => `COALESCE(sum(o.perjuicio) FILTER (WHERE o.cuenta AND o.moneda = '${m}'), 0)::float`;
      const [tot, temas, anios, ents] = await Promise.all([
        pool.query(
          `SELECT (SELECT count(*) FROM informes_control)::int AS informes, count(DISTINCT o.codigo)::int AS leidos, count(*)::int AS observaciones,
                  count(*) FILTER (WHERE o.perjuicio IS NOT NULL)::int AS "conPerjuicio", ${PERJ("PEN")} AS "perjuicioPen", ${PERJ("USD")} AS "perjuicioUsd",
                  (SELECT count(DISTINCT p.ocid) FROM informe_control_proceso p)::int AS contratos
             FROM informe_control_observacion o`),
        pool.query(
          `SELECT o.tema, count(*)::int AS observaciones, count(DISTINCT o.codigo)::int AS informes, ${PERJ("PEN")} AS "perjuicioPen"
             FROM informe_control_observacion o GROUP BY o.tema ORDER BY 4 DESC, 2 DESC`),
        pool.query(
          `SELECT extract(year FROM COALESCE(ic.fecha_emision, ic.fecha_publicacion))::int AS anio, count(DISTINCT o.codigo)::int AS informes,
                  count(*)::int AS observaciones, ${PERJ("PEN")} AS "perjuicioPen"
             FROM informe_control_observacion o JOIN informes_control ic ON ic.codigo = o.codigo
            WHERE COALESCE(ic.fecha_emision, ic.fecha_publicacion) IS NOT NULL ${q.tema ? "AND o.tema = $1" : ""}
            GROUP BY 1 ORDER BY 1`, q.tema ? [q.tema] : []),
        pool.query(
          `WITH x AS (
             SELECT btrim(ic.entidad_ruc::text) AS ruc, max(ic.entidad_nombre) AS nombre,
                    -- El departamento sólo si todos sus informes son de uno (EsSalud o un ministerio los tienen en varios).
                    CASE WHEN count(DISTINCT ic.departamento) = 1 THEN max(ic.departamento) END AS departamento,
                    count(DISTINCT ic.departamento)::int AS departamentos,
                    count(DISTINCT o.codigo)::int AS informes, count(*)::int AS observaciones, ${PERJ("PEN")} AS perjuicio,
                    count(DISTINCT o.codigo) FILTER (WHERE 'penal' = ANY (ic.responsabilidades))::int AS penal,
                    mode() WITHIN GROUP (ORDER BY o.tema) AS tema_principal
               FROM informe_control_observacion o JOIN informes_control ic ON ic.codigo = o.codigo
              WHERE ic.entidad_ruc ~ '^20[0-9]{9}' ${q.tema ? "AND o.tema = $2" : ""}
              GROUP BY 1)
           SELECT x.ruc, COALESCE(e.nombre, x.nombre) AS entidad, x.departamento, x.departamentos, x.informes, x.observaciones, x.perjuicio AS "perjuicioPen", x.penal,
                  x.tema_principal AS "temaPrincipal",
                  (SELECT count(DISTINCT p.ocid) FROM informe_control_proceso p JOIN informes_control i2 ON i2.codigo = p.codigo
                    WHERE btrim(i2.entidad_ruc::text) = x.ruc)::int AS contratos
             FROM x LEFT JOIN entidades e ON btrim(e.ruc::text) = x.ruc
            WHERE x.perjuicio > 0
            ORDER BY x.perjuicio DESC, x.observaciones DESC, x.ruc LIMIT $1`, q.tema ? [q.n, q.tema] : [q.n]),
      ]);
      return publicar({
        tema: q.tema ?? null,
        total: tot.rows[0] ?? null,
        porTema: temas.rows.map((t) => ({ ...t, temaTexto: TEMAS_CONTROL[t.tema] ?? t.tema })),
        porAnio: anios.rows,
        entidades: ents.rows.map((e) => ({ ...e, temaPrincipalTexto: TEMAS_CONTROL[e.temaPrincipal] ?? e.temaPrincipal, enlace: `${WEB}/entidad/${e.ruc}?seccion=control` })),
        nota: `Observaciones de las Fichas Resumen de los informes de control, leídas con IA (tema y perjuicio). ${AVISO_PERJUICIO} ${AVISO}`,
      });
    });
    c.header("Cache-Control", cachePublico(3600, { maxAge: 600, swr: 86400 }));
    return c.json(cuerpo);
  } catch (e) {
    if (esErrorPg(e, "42P01", "42883", "42501")) return c.json({ error: "no_disponible", detail: "El resumen de lo observado todavía no existe en esta base." }, 503);
    throw e;
  }
});

informesControlRouter.get("/:codigo", async (c) => {
  const codigo = c.req.param("codigo");
  if (!/^[0-9A-Z]{6,24}$/.test(codigo)) return c.json({ error: "not_found" }, 404);
  const r = await pool.query(
    `SELECT codigo, numero, titulo, modalidad, entidad_nombre AS entidad, btrim(entidad_ruc) AS "entidadRuc", responsabilidades, funcionarios,
            to_char(coalesce(fecha_emision, fecha_publicacion), 'YYYY-MM-DD') AS fecha, url_resumen AS "urlResumen", url_pdf AS "urlPdf"
       FROM informes_control WHERE codigo = $1`, [codigo]);
  const inf = r.rows[0];
  if (!inf) return c.json({ error: "not_found" }, 404);
  const det = (await detallesDeInformes([codigo])).get(codigo) ?? null;
  c.header("Cache-Control", cachePublico(3600, { maxAge: 600, swr: 86400 }));
  return c.json(publicar({ ...inf, ...(det ?? {}), ficha: !!det && (det.objetivo != null || det.observaciones.length > 0), aviso: AVISO }));
});
