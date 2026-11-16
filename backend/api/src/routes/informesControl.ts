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
import { buscarInformesControl, detallesDeInformes } from "../lib/contraloriaFichas.js";

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
