import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { TAPA_NOMBRE, publicar } from "../lib/privacidad.js";
import { PERIODOS_GOBIERNO } from "./partidos.js";

/**
 * Personas contratadas (migración 91): quienes reciben órdenes de servicio del Estado como personas naturales
 * (RUC 10: locadores, asesores, choferes…) y lo que otros registros dicen de ellas en cada entidad (candidaturas,
 * aportes, autoridades, DJI, sanciones, visitas). Las señales son indicios para revisar, no pruebas.
 *
 * Privacidad (docs/PRIVACIDAD.md): cada fila lleva el RUC 10 junto al nombre, así publicar() pone la ref en lugar
 * del RUC y tapa un apellido en toda la respuesta. La ficha se pide por `codigo` (persona_codigo), nunca por RUC.
 * No hay búsqueda por nombre (como en casos_cruce): sólo por entidad, región, partido, señal y servicio.
 *
 *   GET /personas                 lista persona × entidad, paginada y filtrada, con el resumen de su alcance
 *   GET /personas/:codigo         la ficha: cada entidad con sus señales completas y lo que cobró por año
 *   GET /personas/:codigo/ordenes sus órdenes, paginadas
 */
export const personasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const listaMemo = new Memo<Record<string, unknown>>({ nombre: "personas:lista", ttlMs: 600_000, staleMs: 600_000, max: 400 });
const fichaMemo = new Memo<Record<string, unknown> | null>({ nombre: "personas:ficha", ttlMs: 600_000, staleMs: 600_000, max: 400 });

export const TIPOS_SENAL = [
  "candidato_gobierna", "autoridad_contratada", "inhabilitado", "aporte_gobierna", "apellidos_autoridad", "apellidos_funcionario",
  "funcionario_contratado", "meses_seguidos", "pago_alto", "candidato", "aporte", "visita_previa", "tambien_planilla", "paso_a_planilla",
] as const;

const Lista = z.object({
  entidad: z.string().regex(/^\d{11}$/).optional(),
  dep: z.string().regex(/^\d{2}$/).optional(),
  partido: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
  periodo: z.coerce.number().int().refine((n) => PERIODOS_GOBIERNO.some((p) => p.anio === n)).optional(),
  senal: z.enum(TIPOS_SENAL).optional(),
  severidad: z.enum(["alta", "media", "baja", "con", "sin"]).optional(),
  servicio: z.string().trim().min(2).max(60).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  // El buscador: la entidad y el tipo de servicio, nunca el nombre de la persona (docs/PRIVACIDAD.md).
  q: z.string().trim().min(2).max(80).optional(),
  orden: z.enum(["senales", "monto", "ordenes", "meses", "reciente"]).default("senales"),
  page: z.coerce.number().int().min(1).max(5000).default(1),
  // size=0: sólo el resumen (los bloques del Inicio).
  size: z.coerce.number().int().min(0).max(50).default(20),
});
type ListaQ = z.infer<typeof Lista>;

const ORDEN: Record<ListaQ["orden"], string> = {
  senales: "pe.sev DESC, pe.n_senales DESC, pe.monto DESC",
  monto: "pe.monto DESC",
  ordenes: "pe.ordenes DESC, pe.monto DESC",
  meses: "pe.meses DESC, pe.monto DESC",
  reciente: "pe.ultima DESC NULLS LAST, pe.monto DESC",
};
const SEV: Record<string, number> = { alta: 3, media: 2, baja: 1 };

/**
 * Las palabras de una búsqueda como las deja `mef_norm` en la base (mayúsculas, sin tildes, sólo letras y cifras): cada
 * una va a un `LIKE '%PALABRA%'` sobre el texto normalizado, que usa los índices de trigramas (migración 103). Hasta 5
 * palabras de 3 letras o más (con menos el índice de trigramas no sirve); como no quedan `%` ni `_`, no hay que escaparlas.
 */
export function palabrasBusqueda(q: string | undefined): string[] {
  if (!q) return [];
  return q
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 5);
}

/** La expresión indexada de persona_entidad (migración 103). */
const TEXTO_PE = `mef_norm(COALESCE(pe.entidad, '') || ' ' || COALESCE(pe.servicio, ''))`;

/** Lo que fija el alcance (entidad, región, partido): el resumen va sobre esto, sin los demás filtros. */
function alcance(q: ListaQ): { conds: string[]; vals: unknown[] } {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (q.entidad) { vals.push(q.entidad); conds.push(`pe.entidad_ruc = $${vals.length}`); }
  if (q.dep) { vals.push(q.dep); conds.push(`pe.dep = $${vals.length}`); }
  if (q.partido) { vals.push([`${q.partido}:${q.periodo ?? 2022}`]); conds.push(`pe.gobiernos @> $${vals.length}::text[]`); }
  return { conds, vals };
}

/** Los filtros de la lista dentro del alcance. */
function filtros(q: ListaQ, conds: string[], vals: unknown[]) {
  if (q.senal) { vals.push([q.senal]); conds.push(`pe.tipos @> $${vals.length}::text[]`); }
  if (q.severidad === "con") conds.push(`pe.sev > 0`);
  else if (q.severidad === "sin") conds.push(`pe.sev = 0`);
  else if (q.severidad) { vals.push(SEV[q.severidad]); conds.push(`pe.sev = $${vals.length}`); }
  if (q.servicio) { vals.push(q.servicio); conds.push(`pe.servicio = $${vals.length}`); }
  if (q.anio) { vals.push(q.anio); conds.push(`$${vals.length}::smallint = ANY (pe.anios)`); }
  for (const w of palabrasBusqueda(q.q)) { vals.push(`%${w}%`); conds.push(`${TEXTO_PE} LIKE $${vals.length}`); }
}

/** Partidos que gobernaban la entidad en esos años ('clave:anio' de persona_entidad.gobiernos), con su nombre. */
const GOBIERNOS = (col: string) => `COALESCE((
    SELECT jsonb_agg(DISTINCT jsonb_build_object('clave', g.org_clave, 'nombre', g.org_nombre, 'anio', g.anio_eleccion))
      FROM gobierno_periodo g WHERE g.org_clave || ':' || g.anio_eleccion = ANY (${col})), '[]')`;

const FILA = `pe.codigo, pe.ruc, pe.nombre, pe.entidad, pe.entidad_ruc AS "entidadRuc", pe.dep, pe.servicio, pe.ordenes, pe.meses,
              pe.monto::float AS monto, to_char(pe.primera, 'YYYY-MM-DD') AS primera, to_char(pe.ultima, 'YYYY-MM-DD') AS ultima,
              pe.anios, pe.senales, pe.n_senales AS "nSenales"`;

const RESUMEN_VACIO = { filas: 0, personas: 0, monto: 0, ordenes: 0, conSenales: 0, alta: 0, media: 0, baja: 0, porSenal: [], porServicio: [], porAnio: [] };

/** La clave de persona_resumen de un alcance simple (sólo entidad, sólo región, sólo partido o el país); null si combina. */
function claveResumen(q: ListaQ): string | null {
  const n = [q.entidad, q.dep, q.partido].filter(Boolean).length;
  if (n === 0) return "pais";
  if (n > 1) return null;
  if (q.entidad) return `ent:${q.entidad}`;
  if (q.dep) return `dep:${q.dep}`;
  return `par:${q.partido}:${q.periodo ?? 2022}`;
}

/** El resumen del alcance: ya contado en persona_resumen (migración 91) o, si el alcance combina filtros, en vivo. */
async function resumenDe(q: ListaQ, conds: string[], vals: unknown[]) {
  const clave = claveResumen(q);
  if (clave) {
    const r = await pool.query(`SELECT resumen FROM persona_resumen WHERE alcance = $1`, [clave]);
    return r.rows[0]?.resumen ?? RESUMEN_VACIO;
  }
  return resumen(conds, vals);
}

/**
 * Las órdenes de servicio a personas que CONOSCE publicó con un monto que no se puede creer (migración 102), en el país
 * o en una entidad: se nombran junto al total, que no las suma. Índice parcial: son ~1 mil de 29 M. Para una región o
 * un partido, null (CONOSCE no trae el ubigeo de la entidad).
 */
async function dudosasDe(q: ListaQ): Promise<{ ordenes: number; monto: number } | null> {
  if (q.dep || q.partido) return null;
  const vals: unknown[] = [];
  let ent = "";
  if (q.entidad) { vals.push(q.entidad); ent = `AND o.entidad_ruc = $1`; }
  const r = await pool.query<{ ordenes: number; monto: number | null }>(
    `WITH d AS (
       SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision, o.ruc_contratista) o.monto_dudoso
         FROM conosce_ordenes o
        WHERE o.monto_dudoso IS NOT NULL AND o.ruc_contratista LIKE '10%' AND length(o.ruc_contratista) = 11 AND o.tipo_orden = 'Orden de Servicio'
          AND o.moneda = 'Nuevos Soles' ${ent}
        ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.ruc_contratista, o.anio DESC, o.mes DESC)
     SELECT count(*)::int AS ordenes, COALESCE(sum(monto_dudoso), 0)::float AS monto FROM d`, vals);
  const d = r.rows[0];
  return d && d.ordenes > 0 ? { ordenes: d.ordenes, monto: Number(d.monto) } : null;
}

async function resumen(conds: string[], vals: unknown[]) {
  const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await pool.query(
    `WITH s AS MATERIALIZED (SELECT pe.ruc, pe.monto, pe.ordenes, pe.n_senales, pe.sev, pe.tipos, pe.servicio, pe.anios FROM persona_entidad pe ${donde})
     SELECT (SELECT count(*) FROM s)::int AS filas,
            (SELECT count(DISTINCT ruc) FROM s)::int AS personas,
            (SELECT COALESCE(sum(monto), 0) FROM s)::float AS monto,
            (SELECT COALESCE(sum(ordenes), 0) FROM s)::int AS ordenes,
            (SELECT count(*) FROM s WHERE n_senales > 0)::int AS "conSenales",
            (SELECT count(*) FROM s WHERE sev = 3)::int AS alta,
            (SELECT count(*) FROM s WHERE sev = 2)::int AS media,
            (SELECT count(*) FROM s WHERE sev = 1)::int AS baja,
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT t AS tipo, count(*)::int AS n FROM s, unnest(s.tipos) t GROUP BY t) x), '[]') AS "porSenal",
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT COALESCE(servicio, 'Otros') AS servicio, count(*)::int AS n,
                                                                         sum(monto)::float AS monto FROM s GROUP BY 1) x), '[]') AS "porServicio",
            COALESCE((SELECT json_agg(x ORDER BY x.anio) FROM (SELECT a AS anio, count(*)::int AS n FROM s, unnest(s.anios) a GROUP BY a) x), '[]') AS "porAnio"`,
    vals);
  return r.rows[0];
}

// ─── GET /personas ──────────────────────────────────────────────────────────────────────────────
personasRouter.get("/", async (c) => {
  const crudos = Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
  const parsed = Lista.safeParse(crudos);
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await listaMemo.obtener(JSON.stringify(q), async () => {
    const { conds, vals } = alcance(q);
    const res = Promise.all([resumenDe(q, [...conds], [...vals]), dudosasDe(q)]).then(([r, dudosas]) => ({ ...r, dudosas }));
    if (q.size === 0) return publicar({ total: 0, page: 1, size: 0, data: [], resumen: await res });
    const sinFiltros = conds.length;
    filtros(q, conds, vals);
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // La página va sola (con LIMIT usa el índice del orden) y el total aparte: con count(*) OVER () se ordenaba todo el
    // alcance (1,2 M filas en el país) para devolver 20. Sin filtros, el total es el del resumen.
    const [filas, rs, cuenta] = await Promise.all([
      pool.query(
        `WITH pag AS (
           SELECT pe.* FROM persona_entidad pe ${donde}
            ORDER BY ${ORDEN[q.orden]}, pe.entidad_ruc, pe.ruc
            LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size})
         SELECT ${FILA.replace(/pe\./g, "pag.")}, ${GOBIERNOS("pag.gobiernos")} AS gobiernos
           FROM pag ORDER BY ${ORDEN[q.orden].replace(/pe\./g, "pag.")}, pag.entidad_ruc, pag.ruc`, vals),
      res,
      conds.length > sinFiltros ? pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM persona_entidad pe ${donde}`, vals) : null,
    ]);
    const total = cuenta ? cuenta.rows[0]?.n ?? 0 : rs.filas;
    return publicar({ total, page: q.page, size: q.size, data: filas.rows.map((f) => ({ ...f, nombre: f.nombre ? conEnie(f.nombre) : f.nombre })), resumen: rs });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /personas/:codigo ──────────────────────────────────────────────────────────────────────
const CODIGO = /^[0-9a-f]{12}$/;

personasRouter.get("/:codigo", async (c) => {
  const codigo = c.req.param("codigo");
  if (!CODIGO.test(codigo)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await fichaMemo.obtener(codigo, async () => {
    const p = await pool.query<{ ruc: string }>(`SELECT ruc FROM persona_codigo WHERE codigo = $1`, [codigo]);
    const ruc = p.rows[0]?.ruc;
    if (!ruc) return null;
    const [ent, senales, anual, mensual, dudosas] = await Promise.all([
      pool.query(
        `SELECT ${FILA}, ${GOBIERNOS("pe.gobiernos")} AS gobiernos, z.nombre AS "depNombre"
           FROM persona_entidad pe LEFT JOIN zonas z ON z.ubigeo = pe.dep
          WHERE pe.ruc = $1 ORDER BY pe.sev DESC, pe.monto DESC`, [ruc]),
      pool.query(
        `SELECT s.entidad_ruc AS "entidadRuc", s.tipo, s.severidad, s.detalle, s.fuente, s.fuente_url AS "fuenteUrl"
           FROM persona_senal s WHERE s.ruc = $1
          ORDER BY CASE s.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, s.tipo`, [ruc]),
      // Lo que cobró por mes cada año, junto a lo que paga la entidad y el país por el mismo servicio.
      pool.query(
        `SELECT a.entidad_ruc AS "entidadRuc", a.entidad, a.anio, a.servicio, a.ordenes, a.meses, a.monto::float AS monto,
                round(a.monto / NULLIF(a.meses, 0), 2)::float AS "porMes", servicio_es_personal(a.servicio) AS personal,
                CASE WHEN re.personas IS NULL THEN NULL ELSE jsonb_build_object('personas', re.personas, 'mediana', re.mediana_mes,
                     'p25', re.p25_mes, 'p75', re.p75_mes, 'p90', re.p90_mes) END AS "enLaEntidad",
                CASE WHEN rp.personas IS NULL THEN NULL ELSE jsonb_build_object('personas', rp.personas, 'mediana', rp.mediana_mes,
                     'p25', rp.p25_mes, 'p75', rp.p75_mes, 'p90', rp.p90_mes) END AS "enElPais"
           FROM persona_orden_anual a
           LEFT JOIN servicio_referencia re ON re.entidad_ruc = a.entidad_ruc AND re.anio = a.anio AND re.servicio = a.servicio
           LEFT JOIN servicio_referencia rp ON rp.entidad_ruc = '' AND rp.anio = a.anio AND rp.servicio = a.servicio
          WHERE a.ruc = $1 ORDER BY a.anio DESC, a.monto DESC`, [ruc]),
      // Lo que cobró cada mes (línea de tiempo): el monto de cada orden tal como lo publicó CONOSCE; lo que puede ser un
      // error suyo, aparte (`dudoso`).
      pool.query<{ mes: string; monto: number; dudoso: number; ordenes: number }>(
        `WITH o AS (
           SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.fecha_emision, o.monto, o.monto_dudoso
             FROM conosce_ordenes o
            WHERE o.ruc_contratista = $1 AND o.tipo_orden = 'Orden de Servicio' AND o.moneda = 'Nuevos Soles'
              AND o.estado IS DISTINCT FROM 'Anulada' AND (o.monto > 0 OR o.monto_dudoso IS NOT NULL) AND o.fecha_emision IS NOT NULL
            ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
         SELECT to_char(date_trunc('month', fecha_emision), 'YYYY-MM') AS mes, COALESCE(sum(monto), 0)::float AS monto,
                COALESCE(sum(monto_dudoso), 0)::float AS dudoso, count(*)::int AS ordenes
           FROM o GROUP BY 1 ORDER BY 1`, [ruc]),
      // Sus órdenes con un monto que puede ser un error de CONOSCE (migración 102): se muestran, no entran en sus sumas.
      pool.query<{ ordenes: number; monto: number | null; motivos: string[] | null }>(
        `WITH d AS (
           SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.monto_dudoso, o.dudoso_motivo
             FROM conosce_ordenes o
            WHERE o.ruc_contratista = $1 AND o.tipo_orden = 'Orden de Servicio' AND o.moneda = 'Nuevos Soles' AND o.monto_dudoso IS NOT NULL
            ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
         SELECT count(*)::int AS ordenes, sum(monto_dudoso)::float AS monto, array_agg(DISTINCT dudoso_motivo) AS motivos FROM d`, [ruc]),
    ]);
    if (!ent.rows.length) return null;
    const nombrePersona = ent.rows[0]?.nombre ? conEnie(ent.rows[0].nombre) : null;
    // Las órdenes CONCRETAS detrás de la señal "inhabilitado" (el mismo JOIN órdenes↔sanción por vigencia que la computa
    // en la migración 91): se citan para que un humano pueda revisar cada una. Sólo si la persona tiene esa señal; el
    // `detalle.ordenes` (conteo) y estas filas salen del mismo DISTINCT ON, así que coinciden.
    const ordsInhab = new Map<string, Record<string, unknown>[]>();
    if (senales.rows.some((s) => s.tipo === "inhabilitado")) {
      const ro = await pool.query(
        `WITH _san AS (
           SELECT fecha_desde, COALESCE(fecha_hasta, CASE WHEN tipo = 'definitivo' THEN DATE '9999-12-31' END) AS hasta, resolucion
             FROM osce_sancionados
            WHERE ruc = $1 AND tipo IN ('temporal','definitivo') AND fecha_desde IS NOT NULL),
         o AS (
           SELECT DISTINCT ON (c.entidad_ruc, c.orden, c.fecha_emision)
                  c.entidad_ruc AS "entidadRuc", c.entidad, c.fecha_emision, c.nro_orden AS numero, c.orden,
                  c.descripcion, c.monto::float AS monto, c.tipo_contratacion AS "tipoContratacion", c.estado,
                  servicio_persona(c.descripcion) AS servicio
             FROM _san s
             JOIN conosce_ordenes c ON c.ruc_contratista = $1 AND c.fecha_emision BETWEEN s.fecha_desde AND s.hasta
            WHERE c.tipo_orden = 'Orden de Servicio' AND c.estado IS DISTINCT FROM 'Anulada' AND c.moneda = 'Nuevos Soles' AND c.monto > 0
            ORDER BY c.entidad_ruc, c.orden, c.fecha_emision, c.anio DESC, c.mes DESC)
         SELECT o."entidadRuc", o.entidad, to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.numero, o.orden, o.descripcion,
                o.monto, o."tipoContratacion", o.estado, o.servicio,
                (SELECT s.resolucion FROM _san s WHERE o.fecha_emision BETWEEN s.fecha_desde AND s.hasta ORDER BY s.fecha_desde LIMIT 1) AS resolucion
           FROM o ORDER BY o."entidadRuc", o.fecha_emision DESC`, [ruc]);
      for (const o of ro.rows) {
        const { entidadRuc, ...resto } = o as { entidadRuc: string } & Record<string, unknown>;
        const l = ordsInhab.get(entidadRuc) ?? [];
        l.push({ ...resto, descripcion: taparNombrePropio(resto.descripcion as string | null, nombrePersona) });
        ordsInhab.set(entidadRuc, l);
      }
    }
    const porEntidad = new Map<string, unknown[]>();
    for (const s of senales.rows) {
      const l = porEntidad.get(s.entidadRuc) ?? [];
      const detalle = s.tipo === "inhabilitado"
        ? { ...(s.detalle as Record<string, unknown>), ordenes_detalle: ordsInhab.get(s.entidadRuc) ?? [] }
        : s.detalle;
      l.push({ tipo: s.tipo, severidad: s.severidad, detalle, fuente: s.fuente, fuenteUrl: s.fuenteUrl });
      porEntidad.set(s.entidadRuc, l);
    }
    const entidades = ent.rows.map((e) => ({ ...e, nombre: e.nombre ? conEnie(e.nombre) : e.nombre, senalesDetalle: porEntidad.get(e.entidadRuc) ?? [] }));
    const sum = (k: "ordenes" | "monto" | "meses") => entidades.reduce((t, e) => t + Number(e[k] ?? 0), 0);
    const fechas = (k: "primera" | "ultima") => entidades.map((e) => e[k]).filter(Boolean).sort();
    return publicar({
      persona: {
        codigo, ruc, nombre: entidades[0].nombre, entidades: entidades.length, ordenes: sum("ordenes"), monto: sum("monto"),
        meses: sum("meses"), primera: fechas("primera")[0] ?? null, ultima: fechas("ultima").at(-1) ?? null,
        nSenales: senales.rows.length,
        dudosas: dudosas.rows[0]?.ordenes ? dudosas.rows[0] : null,
      },
      entidades,
      anual: anual.rows,
      mensual: mensual.rows,
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * El nombre de la persona dentro de la descripción de sus órdenes, ya tapado (el materno): en orden SUNAT ("VARGAS
 * ROJAS LUIS") y hablado ("LUIS VARGAS ROJAS"). publicar() no lo reconoce bien en prosa cuando va pegado a otras palabras
 * en mayúsculas ("ASISTENCIA DE VARGAS ROJAS…" tapaba el "DE").
 */
/** La Ñ que CONOSCE escribe "¿" entre letras ("NURE¿A"): sin ella el tapado no reconoce la palabra. */
export const conEnie = (t: string) => t.replace(/(?<=\p{L})¿(?=\p{L})/gu, "Ñ");

export function taparNombrePropio(texto: string | null, nombre: string | null): string | null {
  if (!texto || !nombre) return texto;
  texto = conEnie(texto);
  nombre = conEnie(nombre);
  const p = nombre.trim().split(/\s+/);
  if (p.length < 3) return texto;
  // Por palabras enteras (sin \b: no conoce la Ñ ni las tildes).
  const esc = (w: string[]) => w.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const sunat = new RegExp(`(?<!\\p{L})${esc(p)}(?!\\p{L})`, "giu");
  const hablado = new RegExp(`(?<!\\p{L})${esc([...p.slice(2), p[0], p[1]])}(?!\\p{L})`, "giu");
  return texto
    .replace(sunat, [p[0], TAPA_NOMBRE, ...p.slice(2)].join(" "))
    .replace(hablado, [...p.slice(2), p[0], TAPA_NOMBRE].join(" "));
}

// ─── GET /personas/:codigo/ordenes ──────────────────────────────────────────────────────────────
const Ordenes = z.object({
  entidad: z.string().regex(/^\d{11}$/).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  // En la descripción, la entidad o el número de la orden.
  q: z.string().trim().min(2).max(80).optional(),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

personasRouter.get("/:codigo/ordenes", async (c) => {
  const codigo = c.req.param("codigo");
  const crudos = Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
  const parsed = Ordenes.safeParse(crudos);
  if (!CODIGO.test(codigo) || !parsed.success) return c.json({ error: "not_found" }, 404);
  const q = parsed.data;
  const cuerpo = await fichaMemo.obtener(`ordenes:${codigo}:${JSON.stringify(q)}`, async () => {
    const p = await pool.query<{ ruc: string; nombre: string | null }>(
      `SELECT pc.ruc, (SELECT pe.nombre FROM persona_entidad pe WHERE pe.ruc = pc.ruc LIMIT 1) AS nombre
         FROM persona_codigo pc WHERE pc.codigo = $1`, [codigo]);
    const ruc = p.rows[0]?.ruc;
    if (!ruc) return null;
    const vals: unknown[] = [ruc];
    // Con las de monto dudoso (migración 98): se muestran con su monto original, que no se suma.
    const conds = [`o.ruc_contratista = $1`, `o.tipo_orden = 'Orden de Servicio'`, `o.moneda = 'Nuevos Soles'`, `(o.monto > 0 OR o.monto_dudoso IS NOT NULL)`];
    if (q.entidad) { vals.push(q.entidad); conds.push(`o.entidad_ruc = $${vals.length}`); }
    if (q.anio) { vals.push(q.anio); conds.push(`o.fecha_emision >= make_date($${vals.length}, 1, 1) AND o.fecha_emision < make_date($${vals.length} + 1, 1, 1)`); }
    for (const w of palabrasBusqueda(q.q)) {
      vals.push(`%${w}%`);
      conds.push(`mef_norm(COALESCE(o.descripcion, '') || ' ' || COALESCE(o.entidad, '') || ' ' || COALESCE(o.nro_orden, '')) LIKE $${vals.length}`);
    }
    // Una vez cada orden (un archivo mensual puede repetirla; vale la del más nuevo), como persona_orden_anual.
    const r = await pool.query(
      `WITH o AS (
         SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.*
           FROM conosce_ordenes o WHERE ${conds.join(" AND ")}
          ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
       SELECT to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.entidad, o.entidad_ruc AS "entidadRuc", o.nro_orden AS numero,
              o.orden, o.descripcion, COALESCE(o.monto, o.monto_dudoso)::float AS monto, o.monto_dudoso::float AS "montoDudoso",
              o.dudoso_motivo AS "dudosoMotivo",
              o.tipo_contratacion AS "tipoContratacion", o.estado, servicio_persona(o.descripcion) AS servicio,
              count(*) OVER ()::int AS total
         FROM o ORDER BY o.fecha_emision DESC, o.orden DESC
        LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, vals);
    const total = r.rows[0]?.total ?? 0;
    // Las descripciones pueden traer el DNI o el nombre de la persona: publicar() los tapa (por eso va su RUC 10 con
    // su nombre: así la reconoce, y el RUC sale como ref).
    return publicar({ persona: { ruc, nombre: p.rows[0]?.nombre ? conEnie(p.rows[0].nombre) : null }, total, page: q.page, size: q.size,
                      data: r.rows.map(({ total: _t, ...f }) => ({ ...f, descripcion: taparNombrePropio(f.descripcion, p.rows[0]?.nombre ?? null) })) });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
