import { Hono } from "hono";
import { esErrorPg, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { motivoPublicable } from "../lib/cruces.js";
import { marcaElecto } from "../lib/electos.js";
import { datasetVisitas, VISITAS_CONGRESO, VISITAS_EN_LINEA } from "../lib/fuentes.js";
import { FUERA_DE_HORA, capacidades, leerPedido, paginaLista } from "../lib/visitasLista.js";

/**
 * Las visitas que recibió una entidad (fase 2.3 del plan del 2026-10-27; rediseño del 2026-11-18):
 *
 *   GET /visitas/entidad/:ruc         el resumen de la pestaña: cuántas y desde cuándo, cómo se reparten (privadas,
 *                                     públicas, a título personal, a quien decide, fuera del horario), las visitas por mes
 *                                     (migración 205), cuántas empresas cuya gente la visitó ganaron algo después
 *                                     (migración 203) y cuántas filas tiene cada lista. Sin las listas: desde el
 *                                     2026-11-18 cada una llega entera y de a una página por GET /visitas/entidad/:ruc/lista
 *                                     (antes iban aquí recortadas a las 1,000 de más visitas: varios MB en las grandes).
 *                                     Lleva una muestra corta de organizaciones, empresas y oficinas para la herramienta
 *                                     `visitas_entidad` del MCP, que la leía de aquí.
 *   GET /visitas/entidad/:ruc/lista   una página de una lista (`que` = empresas, organizaciones, areas, parientes o
 *                                     visitas) con `page`, `size`, `q`, `orden` y sus filtros: lib/visitasLista.ts.
 *
 * Privacidad: nunca el documento de quien visita; su nombre con un apellido tapado (publicar), y ni eso si es el familiar
 * de un funcionario (no se lo identifica). De quien recibe, sólo su cargo y su área. Nunca se busca a una persona por su
 * nombre: la búsqueda de la lista de visitas es por la organización que declaró.
 */
export const visitasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
/** La muestra para el MCP (herramienta visitas_entidad: toma 20 organizaciones, 15 empresas y 12 oficinas). */
const MUESTRA = { organizaciones: 20, empresas: 15, areas: 12 };
const memo = new Memo<Record<string, unknown> | null>({ nombre: "visitas:entidad", ttlMs: 900_000, staleMs: 3_600_000, max: 300 });

visitasRouter.get("/entidad/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const cuerpo = await memo.obtener(ruc, async () => {
    const cap = await capacidades();
    // Las visitas de la entidad por todos los nombres con que la registra el portal (migración 186). Sólo sin el resumen
    // precalculado (una base sin la migración 188).
    const V = `(SELECT v.* FROM visitas_entidades v WHERE v.entidad_visitada IN (SELECT entidad_visitada FROM visita_entidad_ruc WHERE ruc = $1))`;
    const decisor = cap.decisor ? `COALESCE(v.decisor, visita_decisor(v.funcionario_cargo, v.funcionario_area), false)` : "COALESCE(v.decisor, false)";
    const [resumen, totales, meses, empresas, orgs, areas] = await Promise.all([
      cap.pre
        ? pool.query(
            `SELECT total, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta, privadas, publicas, personas,
                    visitantes, decisores, fuera_de_hora AS "fueraDeHora", largas, fuentes
               FROM entidad_visita_resumen WHERE entidad_ruc = $1`, [ruc])
        : pool.query(
            `SELECT count(*)::int AS total, to_char(min(v.fecha_visita), 'YYYY-MM-DD') AS desde, to_char(max(v.fecha_visita), 'YYYY-MM-DD') AS hasta,
                    count(*) FILTER (WHERE v.tipo_entidad_visitante = 'privada')::int AS privadas,
                    count(*) FILTER (WHERE v.tipo_entidad_visitante = 'publica')::int AS publicas,
                    count(*) FILTER (WHERE v.tipo_entidad_visitante = 'persona_natural')::int AS personas,
                    count(DISTINCT v.numero_documento)::int AS visitantes,
                    count(*) FILTER (WHERE ${decisor})::int AS decisores,
                    count(*) FILTER (WHERE ${FUERA_DE_HORA})::int AS "fueraDeHora",
                    count(*) FILTER (WHERE v.duracion_min >= 240)::int AS largas,
                    array_agg(DISTINCT v.fuente) AS fuentes
               FROM ${V} v`, [ruc]),
      // Cuántas filas tiene cada lista (sus pestañas llevan ese número).
      cap.pre
        ? pool.query<{ o: number; a: number; p: number | null }>(
            `SELECT (SELECT count(*)::int FROM entidad_visita_org WHERE entidad_ruc = $1) AS o,
                    (SELECT count(*)::int FROM entidad_visita_area WHERE entidad_ruc = $1) AS a,
                    ${cap.parientes ? "(SELECT count(*)::int FROM entidad_visita_pariente WHERE entidad_ruc = $1)" : "NULL::int"} AS p`, [ruc])
            .then((x) => x.rows[0] ?? null).catch(() => null)
        : Promise.resolve(null),
      // Las visitas de cada mes, con cuántas fueron de empresas, a quien decide y cuántas empresas distintas (migración 205).
      cap.meses
        ? pool.query(
            `SELECT to_char(mes, 'YYYY-MM') AS mes, visitas, privadas, decisores, empresas
               FROM entidad_visita_mes WHERE entidad_ruc = $1 ORDER BY mes`, [ruc]).then((x) => x.rows).catch(() => [])
        : Promise.resolve([]),
      // Las empresas cuya gente la visitó (migración 203) y, de ellas, las que recibieron algo desde la primera visita.
      cap.empresas
        ? Promise.all([
            pool.query(
              `SELECT count(*)::int AS empresas, count(*) FILTER (WHERE declaradas = 0)::int AS "soloSuGente",
                      count(*) FILTER (WHERE despues IS NOT NULL)::int AS ganaron,
                      count(*) FILTER (WHERE despues IS NOT NULL AND declaradas = 0)::int AS "ganaronSoloSuGente",
                      count(*) FILTER (WHERE despues IS NOT NULL AND antes = 0)::int AS "primeraVez"
                 FROM entidad_visita_empresa WHERE entidad_ruc = $1`, [ruc]),
            pool.query(
              `SELECT e.ruc, r.nombre AS empresa, e.visitas, e.visitantes, e.decisores, e.antes,
                      to_char(e.primera, 'YYYY-MM-DD') AS primera, to_char(e.despues, 'YYYY-MM-DD') AS despues,
                      e.despues_tipo AS "despuesTipo", e.dias, e.monto::float AS monto,
                      e.despues_numero AS "despuesNumero", e.despues_monto::float AS "despuesMonto"
                 FROM entidad_visita_empresa e LEFT JOIN empresa_resumen r ON r.ruc = e.ruc
                WHERE e.entidad_ruc = $1 AND e.despues IS NOT NULL
                ORDER BY (e.antes = 0) DESC, e.monto DESC, e.visitas DESC, e.ruc LIMIT ${MUESTRA.empresas}`, [ruc]),
          ]).catch((e) => { console.warn(`[visitas] empresas: ${(e as Error).message}`); return null; })
        : Promise.resolve(null),
      cap.pre
        ? pool.query(
            `SELECT o.org, o.tipo, o.visitas, o.visitantes, to_char(o.primera, 'YYYY-MM-DD') AS primera, to_char(o.ultima, 'YYYY-MM-DD') AS ultima,
                    o.decisores, o.ruc, r.nombre AS empresa,
                    ${cap.empresas ? `e.despues_tipo AS "despuesTipo", e.despues_monto::float AS "despuesMonto"` : `NULL::text AS "despuesTipo", NULL::float AS "despuesMonto"`}
               FROM (SELECT * FROM entidad_visita_org WHERE entidad_ruc = $1 ORDER BY visitas DESC, org LIMIT ${MUESTRA.organizaciones}) o
               LEFT JOIN empresa_resumen r ON r.ruc = o.ruc
               ${cap.empresas ? "LEFT JOIN entidad_visita_empresa e ON e.entidad_ruc = $1 AND e.ruc = o.ruc" : ""}
              ORDER BY o.visitas DESC, o.org`, [ruc]).then((x) => x.rows).catch(() => [])
        : Promise.resolve([]),
      cap.pre
        ? pool.query(
            `SELECT area, NULLIF(cargo, '') AS cargo, visitas, privadas, decisor FROM entidad_visita_area
              WHERE entidad_ruc = $1 ORDER BY visitas DESC, area LIMIT ${MUESTRA.areas}`, [ruc]).then((x) => x.rows).catch(() => [])
        : Promise.resolve([]),
    ]);
    const r = resumen.rows[0];
    if (!r || !r.total) return { total: 0, hasta: null };
    const fuentes: string[] = r.fuentes ?? [];
    const solo20 = (x: unknown) => (typeof x === "string" && /^20\d{9}$/.test(x) ? x : null);
    return publicar({
      total: r.total,
      desde: r.desde,
      hasta: r.hasta,
      resumen: {
        privadas: r.privadas, publicas: r.publicas, personas: r.personas, visitantes: r.visitantes, decisores: r.decisores,
        fueraDeHora: r.fueraDeHora, largas: r.largas, parientes: totales?.p ?? 0,
      },
      totales: { organizaciones: totales?.o ?? null, areas: totales?.a ?? null, parientes: totales?.p ?? null },
      meses,
      ...(empresas ? { empresas: { ...empresas[0].rows[0], lista: empresas[1].rows } } : {}),
      // La muestra del MCP (las listas enteras van por /lista).
      organizaciones: orgs.map((o) => ({ ...o, ruc: solo20(o.ruc), empresa: solo20(o.ruc) ? o.empresa : null })),
      areas,
      fuentes: [
        fuentes.includes("congreso_visitas") && { texto: "Registro de visitas del Congreso de la República", href: VISITAS_CONGRESO },
        { texto: "Registro de Visitas en Línea (PCM)", href: VISITAS_EN_LINEA },
      ].filter(Boolean),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * GET /visitas/entidad/:ruc/lista?que=…&page=&size=&q=&orden=&…  — una página de una de las listas de la pestaña, entera
 * (nada recortado a las N primeras). Filtros de cada lista (lib/visitasLista.ts):
 *   empresas        via (representante|socio|directivo|nombre), declaro, antes, decisor (si|no), tipo (contrato|consorcio|orden);
 *                   orden nueva|monto|visitas|dias|reciente; q: la empresa, su RUC o la organización que declaró
 *   organizaciones  tipo (privada|publica), despues (si|no), decisor (si|no); orden visitas|monto|reciente; q: la organización o su RUC 20
 *   areas           decisor (si|no); orden visitas|privadas; q: la oficina o el cargo
 *   parientes       proveedor (si|no), decisor (si|no); orden reciente|antiguo; q: el parentesco, el cargo o la oficina
 *   visitas         tipo (privada|publica|persona_natural|pariente), decisor (si|no), hora (fuera|dentro), anio, org (una
 *                   organización exacta); orden reciente|antiguo; q: la organización de quien visita (nunca su nombre)
 * Responde { que, page, size, total (null si no se sabe sin recorrer), hayMas, filas, facetas, anios?, organizaciones? }.
 */
visitasRouter.get("/entidad/:ruc/lista", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const p = leerPedido(c.req.query("que"), c.req.query());
  if (!p) return c.json({ error: "consulta_invalida", detail: "que = empresas, organizaciones, areas, parientes o visitas" }, 400);
  let res: Awaited<ReturnType<typeof paginaLista>>;
  try {
    res = await paginaLista(ruc, p);
  } catch (e) {
    // Pasó el plazo de la base (filtros raros combinados que recorren las 1,2 M visitas del Congreso): se dice, y la web
    // propone elegir un año.
    if (esErrorPg(e, "57014")) return c.json({ error: "consulta_lenta", detail: "La lista tardó demasiado: elige un año o acota la búsqueda." }, 504);
    throw e;
  }
  if ("error" in res) return c.json({ ...res, detail: "Esa página está muy lejos: elige un año o el orden «Lo más antiguo»." }, 400);
  c.header("Cache-Control", CACHE);
  if (p.que !== "visitas") return c.json({ ...res, filas: publicar({ [p.que]: res.filas })[p.que] });
  // Bajo `visitas`: publicar() le tapa un apellido a quien visita, salvo a una autoridad electa (lib/electos.ts). El
  // familiar de un funcionario va sin nombre y su clave no es el id de la visita (con él se lo buscaría en otra lista).
  const filas = res.filas.map(({ id, ruc: rucEmpresa, electo, ...v }, i) => ({
    ...v,
    // El motivo en texto libre puede nombrar a otras personas: sale la categoría del registro o su clase.
    motivo: motivoPublicable(v.motivo),
    visitante: v.pariente ? null : v.visitante,
    ...marcaElecto(electo === true && !v.pariente),
    rucEmpresa: typeof rucEmpresa === "string" && /^20\d{9}$/.test(rucEmpresa) ? rucEmpresa : null,
    // Su registro: el del Congreso, el reporte mensual de la PNDA (que es sólo de Loreto) o el registro en línea de la PCM.
    enlace: v.fuente === "congreso_visitas" ? VISITAS_CONGRESO : v.fuente === "pnda_visitas" ? datasetVisitas(v.fecha as string | null) : VISITAS_EN_LINEA,
    clave: v.pariente ? `f${p.offset + i + 1}` : String(id),
  }));
  // La empresa de cada visita, con su nombre (una consulta para la página).
  const rucs = [...new Set(filas.map((x) => x.rucEmpresa).filter((x): x is string => !!x))];
  const nombres = rucs.length
    ? new Map((await pool.query<{ ruc: string; nombre: string }>(`SELECT ruc, nombre FROM empresa_resumen WHERE ruc = ANY($1)`, [rucs])).rows.map((x) => [x.ruc, x.nombre]))
    : new Map<string, string>();
  const visitas = filas.map(({ rucEmpresa, ...v }) => ({ ...v, empresa: rucEmpresa ? { ruc: rucEmpresa, nombre: nombres.get(rucEmpresa) ?? null } : null }));
  return c.json({ ...res, filas: publicar({ visitas }).visitas });
});

/**
 * GET /visitas/entidad/:ruc/buscar?en=organizaciones|areas&q=  — la búsqueda de la web anterior al 2026-11-18 (las listas
 * llegaban recortadas y ésta buscaba en todas). La web nueva usa /lista; ésta queda mientras haya páginas viejas abiertas.
 */
visitasRouter.get("/entidad/:ruc/buscar", async (c) => {
  const ruc = c.req.param("ruc");
  const en = c.req.query("en");
  const q = (c.req.query("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!/^\d{11}$/.test(ruc) || (en !== "organizaciones" && en !== "areas") || q.length < 3) return c.json({ error: "consulta_invalida" }, 400);
  const p = leerPedido(en, { q, size: "50" });
  if (!p) return c.json({ error: "consulta_invalida" }, 400);
  const res = await paginaLista(ruc, p).catch(() => null);
  c.header("Cache-Control", CACHE);
  return c.json(publicar({ [en]: res && !("error" in res) ? res.filas : [] }));
});
