import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { aCruce, ETIQUETA_CRUCE } from "../lib/cruces.js";
import { publicar } from "../lib/privacidad.js";
import { visitasHasta } from "../lib/visitas.js";
import { conEnie, palabrasBusqueda } from "./personas.js";

/**
 * Empresas (migraciones 109 y 112): cada RUC 20 que ganó, postuló o recibió órdenes del Estado, y lo que otros registros
 * públicos dicen de ella (sus antecedentes, como hechos: qué registro, cuántas veces, con qué gravedad, y su fuente). Sin
 * puntaje: el usuario lo sacó (2026-10-22, «tiene mucho sesgo y parece acusación»). Las personas naturales (RUC 10) no
 * están acá: van en /personas.
 *
 * Privacidad (docs/PRIVACIDAD.md): la razón social y el RUC de una empresa son públicos y se buscan. Sus socios,
 * representantes y directivos son personas: salen bajo `socios` y `visitas` (papeles que publicar() reconoce y les
 * tapa un apellido) y nunca con su documento.
 *
 *   GET /empresas                       lista paginada: buscador (nombre o RUC), filtros, orden y el resumen
 *   GET /empresas/:ruc                  la ficha: resumen, sus antecedentes por tipo, año por año
 *   GET /empresas/:ruc/contratos        procesos que ganó, sola o en consorcio (CONOSCE)
 *   GET /empresas/:ruc/ordenes          órdenes de compra y de servicio (CONOSCE)
 *   GET /empresas/:ruc/clientes         las entidades que le adjudicaron o le compraron
 *   GET /empresas/:ruc/postulaciones    los procesos en que fue postor y quién ganó
 *   GET /empresas/:ruc/antecedentes     cada antecedente (cruces_proveedor) con su fuente
 *   GET /empresas/:ruc/socios           socios, representantes y directivos (RNP) y las empresas vinculadas
 *   GET /empresas/:ruc/visitas          visitas registradas de su gente a entidades públicas
 */
export const empresasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const listaMemo = new Memo<Record<string, unknown>>({ nombre: "empresas:lista", ttlMs: 600_000, staleMs: 600_000, max: 400 });
const fichaMemo = new Memo<Record<string, unknown> | null>({ nombre: "empresas:ficha", ttlMs: 600_000, staleMs: 600_000, max: 600 });

export const RUC_EMPRESA = /^20\d{9}$/;
export const OBJETOS = ["Bien", "Servicio", "Obra", "Consultoría de Obra"] as const;
/** Soles en CONOSCE: "Soles" y, en los años viejos, "Nuevos Soles". */
const SOLES = `('Soles', 'Nuevos Soles')`;

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));

// ─── GET /empresas ──────────────────────────────────────────────────────────────────────────────
/**
 * Los filtros por tramos de la lista, cada uno con su condición sobre `empresa_resumen e` (texto fijo, sin nada del
 * pedido): la misma condición filtra la lista y cuenta cada opción en el resumen. Una empresa sin el dato (sin fecha de
 * alta, sin postulaciones) no cae en ningún tramo: «Sin dato» no es 0. Las fechas de corte van en una subconsulta suelta
 * (se calcula una vez, no por fila) y las proporciones en enteros: el resumen las cuenta sobre 236 mil empresas.
 */
const HACE = (intervalo: string) => `(SELECT (current_date - interval '${intervalo}')::date)`;
const ENERO = (anios: number) => `(SELECT (date_trunc('year', current_date) - interval '${anios} years')::date)`;
export const TRAMOS_EMPRESA = {
  // Cuánto lleva en la SUNAT, por su fecha de alta.
  antiguedad: {
    hasta1: `e.fecha_alta > ${HACE("1 year")}`,
    "1a2": `e.fecha_alta <= ${HACE("1 year")} AND e.fecha_alta > ${HACE("2 years")}`,
    "2a5": `e.fecha_alta <= ${HACE("2 years")} AND e.fecha_alta > ${HACE("5 years")}`,
    mas5: `e.fecha_alta <= ${HACE("5 years")}`,
  },
  // A cuántas entidades les vendió (contratos u órdenes).
  clientes: {
    "1": `e.entidades = 1`,
    "2a5": `e.entidades BETWEEN 2 AND 5`,
    "6a20": `e.entidades BETWEEN 6 AND 20`,
    mas20: `e.entidades > 20`,
  },
  // Cómo le va cuando postula, entre las que postularon 5 veces o más: gana 8 de cada 10 o más, o menos de 1 de cada 10.
  exito: {
    alto: `e.postulaciones >= 5 AND 5 * e.ganadas >= 4 * e.postulaciones`,
    bajo: `e.postulaciones >= 5 AND 10 * e.ganadas < e.postulaciones`,
  },
  // Su última venta al Estado (contrato u orden): este año, el anterior o antes.
  ultima: {
    este: `e.ultima >= ${ENERO(0)}`,
    pasado: `e.ultima >= ${ENERO(1)} AND e.ultima < ${ENERO(0)}`,
    antes: `e.ultima < ${ENERO(1)}`,
  },
} as const;
type Tramo = keyof typeof TRAMOS_EMPRESA;
type Opcion<T extends Tramo> = keyof (typeof TRAMOS_EMPRESA)[T] & string;
const tramo = <T extends Tramo>(t: T) => z.enum(Object.keys(TRAMOS_EMPRESA[t]) as [Opcion<T>, ...Opcion<T>[]]);

/** Con un monto que puede ser un error de carga del Estado, en un contrato o en una orden (migración 102). */
const DUDOSA = `(e.adj_dudosos > 0 OR e.ord_dudosas > 0)`;

export const Lista = z.object({
  // El nombre (palabras) o el RUC (sus primeras cifras).
  q: z.string().trim().min(2).max(80).optional(),
  // Con antecedentes en otros registros, con alguno grave (inhabilitación, partido que gobierna…), con alguno medio y
  // ninguno grave, o sin ninguno.
  antecedentes: z.enum(["con", "grave", "media", "sin"]).optional(),
  tipo: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  departamento: z.string().trim().min(2).max(40).optional(),
  objeto: z.enum(OBJETOS).optional(),
  inhabilitada: z.enum(["si"]).optional(),
  // Visitas de su gente a cualquier entidad (`si`) o a una que le adjudicó o le compró (`clientes`).
  visitas: z.enum(["si", "clientes"]).optional(),
  // Lo que recibió (contratos sola + órdenes), desde: 100 mil, 1 M, 10 M, 100 M.
  montoMin: z.coerce.number().refine((n) => [1e5, 1e6, 1e7, 1e8].includes(n)).optional(),
  actividad: z.enum(["contratos", "ordenes", "solo_postula", "consorcios"]).optional(),
  vinculadas: z.enum(["si"]).optional(),
  antiguedad: tramo("antiguedad").optional(),
  clientes: tramo("clientes").optional(),
  exito: tramo("exito").optional(),
  ultima: tramo("ultima").optional(),
  dudoso: z.enum(["si"]).optional(),
  // Las que le vendieron a esta entidad (contratos u órdenes): lo pide la ficha de la entidad.
  entidad: z.string().regex(/^\d{11}$/).optional(),
  orden: z.enum(["monto", "contratos", "ordenes", "reciente", "nombre"]).default("monto"),
  page: z.coerce.number().int().min(1).max(5000).default(1),
  size: z.coerce.number().int().min(0).max(50).default(20),
});
type ListaQ = z.infer<typeof Lista>;

/** Lo que recibió: contratos que ganó sola y órdenes. Lo ganado en consorcio es de todo el consorcio: no se suma (índice de la migración 109). */
const MONTO = `(e.adj_monto + e.ord_monto)`;
const ORDEN: Record<ListaQ["orden"], string> = {
  monto: `${MONTO} DESC`,
  contratos: `(e.adj_procesos + e.cons_procesos) DESC, ${MONTO} DESC`,
  ordenes: `e.ord_n DESC, ${MONTO} DESC`,
  reciente: `e.ultima DESC NULLS LAST, ${MONTO} DESC`,
  nombre: `e.nombre ASC`,
};

/** "lima" → "LIMA", como mef_norm. */
const norm = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function filtros(q: ListaQ): { conds: string[]; vals: unknown[] } {
  const conds: string[] = [];
  const vals: unknown[] = [];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  if (q.q) {
    const cifras = q.q.replace(/\s+/g, "");
    if (/^\d{3,11}$/.test(cifras)) conds.push(`e.ruc LIKE ${p(`${cifras}%`)}`);
    else for (const w of palabrasBusqueda(q.q)) conds.push(`e.texto LIKE ${p(`%${w}%`)}`);
  }
  if (q.antecedentes === "con") conds.push(`cardinality(e.tipos) > 0`);
  else if (q.antecedentes === "grave") conds.push(`e.n_alta > 0`);
  else if (q.antecedentes === "media") conds.push(`e.n_alta = 0 AND e.n_media > 0`);
  else if (q.antecedentes === "sin") conds.push(`cardinality(e.tipos) = 0`);
  if (q.tipo) conds.push(`e.tipos @> ${p([q.tipo])}::text[]`);
  if (q.departamento) conds.push(`e.departamento = ${p(norm(q.departamento))}`);
  if (q.objeto) conds.push(`e.objeto = ${p(q.objeto)}`);
  if (q.inhabilitada) conds.push(`e.inhabilitada IS NOT NULL`);
  if (q.visitas === "si") conds.push(`e.visitas > 0`);
  else if (q.visitas === "clientes") conds.push(`e.visitas_clientes > 0`);
  if (q.montoMin) conds.push(`${MONTO} >= ${p(q.montoMin)}`);
  if (q.actividad === "contratos") conds.push(`e.adj_procesos > 0`);
  else if (q.actividad === "ordenes") conds.push(`e.ord_n > 0 AND e.adj_procesos = 0 AND e.cons_procesos = 0`);
  else if (q.actividad === "solo_postula") conds.push(`e.postulaciones > 0 AND e.adj_procesos = 0 AND e.cons_procesos = 0 AND e.ord_n = 0`);
  else if (q.actividad === "consorcios") conds.push(`e.cons_procesos > 0`);
  if (q.vinculadas) conds.push(`e.vinculadas > 0`);
  if (q.antiguedad) conds.push(TRAMOS_EMPRESA.antiguedad[q.antiguedad]);
  if (q.clientes) conds.push(TRAMOS_EMPRESA.clientes[q.clientes]);
  if (q.exito) conds.push(TRAMOS_EMPRESA.exito[q.exito]);
  if (q.ultima) conds.push(TRAMOS_EMPRESA.ultima[q.ultima]);
  if (q.dudoso) conds.push(DUDOSA);
  if (q.entidad) {
    const ent = p(q.entidad);
    conds.push(`e.ruc IN (SELECT ruc FROM empresa_orden_anual WHERE entidad_ruc = ${ent}
                          UNION SELECT ruc_proveedor FROM conosce_adjudicaciones WHERE entidad_ruc = ${ent} AND ruc_proveedor ~ '^20[0-9]{9}$')`);
  }
  return { conds, vals };
}

export const FILA_EMPRESA = `e.ruc, e.nombre, e.departamento, e.objeto, e.estado_sunat AS "estadoSunat",
  e.adj_procesos AS "adjProcesos", e.adj_monto::float AS "adjMonto", e.cons_procesos AS "consProcesos", e.cons_monto::float AS "consMonto",
  e.adj_dudosos AS "adjDudosos", e.ord_n AS "ordN", e.ord_monto::float AS "ordMonto", e.ord_dudosas AS "ordDudosas",
  e.entidades, e.postulaciones, e.ganadas, to_char(e.primera, 'YYYY-MM-DD') AS primera, to_char(e.ultima, 'YYYY-MM-DD') AS ultima,
  e.visitas, e.inhabilitada, to_char(e.inhabilitada_hasta, 'YYYY-MM-DD') AS "inhabilitadaHasta",
  e.tipos, e.n_alta AS "nAlta", e.n_media AS "nMedia", e.n_baja AS "nBaja",
  e.cruces`;  // [{tipo, severidad, n}]: cada tipo de antecedente con su gravedad más alta y cuántos registros (migración 112)

/** Cuántas empresas caen en cada tramo de `TRAMOS_EMPRESA`: `{antiguedad: {hasta1: n, …}, …}`, en la misma pasada. */
const CONTEO_TRAMOS = `jsonb_build_object(${Object.entries(TRAMOS_EMPRESA)
  .map(([t, opciones]) => `'${t}', jsonb_build_object(${Object.entries(opciones).map(([v, cond]) => `'${v}', count(*) FILTER (WHERE ${cond})`).join(", ")})`)
  .join(", ")})`;

/**
 * El resumen de la lista: todas las cifras en UNA pasada sobre las empresas filtradas (antes, una subconsulta por cifra:
 * diez pasadas sobre las 236 mil). Exportada para medirla con EXPLAIN tal como corre.
 */
export const sqlResumen = (donde: string) =>
  `WITH s AS MATERIALIZED (SELECT e.ruc, e.n_alta, e.n_media, e.tipos, e.departamento, e.objeto, e.inhabilitada, e.visitas, e.visitas_clientes,
                                    e.adj_monto, e.cons_monto, e.ord_monto, e.adj_dudosos, e.adj_monto_dudoso, e.ord_dudosas, e.ord_monto_dudoso,
                                    e.fecha_alta, e.entidades, e.postulaciones, e.ganadas, e.ultima
                               FROM empresa_resumen e ${donde}),
          cifras AS (SELECT count(*)::int AS empresas,
                       COALESCE(sum(e.adj_monto), 0)::float AS "adjMonto",
                       COALESCE(sum(e.cons_monto), 0)::float AS "consMonto",
                       COALESCE(sum(e.ord_monto), 0)::float AS "ordMonto",
                       (count(*) FILTER (WHERE e.inhabilitada IS NOT NULL))::int AS inhabilitadas,
                       (count(*) FILTER (WHERE e.visitas > 0))::int AS "conVisitas",
                       (count(*) FILTER (WHERE e.visitas_clientes > 0))::int AS "conVisitasClientes",
                       jsonb_build_object('procesos', COALESCE(sum(e.adj_dudosos), 0), 'monto', COALESCE(sum(e.adj_monto_dudoso), 0),
                                          'ordenes', COALESCE(sum(e.ord_dudosas), 0), 'montoOrdenes', COALESCE(sum(e.ord_monto_dudoso), 0)) AS dudosos,
                       (count(*) FILTER (WHERE ${DUDOSA}))::int AS "conDudosos",
                       (count(*) FILTER (WHERE cardinality(e.tipos) > 0))::int AS "conAntecedentes",
                       (count(*) FILTER (WHERE e.n_alta > 0))::int AS "conGrave",
                       (count(*) FILTER (WHERE e.n_alta = 0 AND e.n_media > 0))::int AS "conMedia",
                       ${CONTEO_TRAMOS} AS tramos
                  FROM s e)
     SELECT cifras.*,
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT t AS tipo, count(*)::int AS n FROM s, unnest(s.tipos) t GROUP BY t) x), '[]') AS "porTipo",
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT departamento, count(*)::int AS n FROM s WHERE departamento IS NOT NULL GROUP BY 1) x), '[]') AS "porDepartamento",
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT objeto, count(*)::int AS n FROM s WHERE objeto IS NOT NULL GROUP BY 1) x), '[]') AS "porObjeto"
       FROM cifras`;

async function resumen(conds: string[], vals: unknown[]) {
  const r = await pool.query(sqlResumen(conds.length ? `WHERE ${conds.join(" AND ")}` : ""), vals);
  const fila = r.rows[0];
  return { ...fila, porTipo: (fila.porTipo as { tipo: string; n: number }[]).map((t) => ({ ...t, etiqueta: ETIQUETA_CRUCE[t.tipo] ?? t.tipo })) };
}

empresasRouter.get("/", async (c) => {
  const parsed = Lista.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await listaMemo.obtener(JSON.stringify(q), async () => {
    const { conds, vals } = filtros(q);
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [filas, rs] = await Promise.all([
      // Con su fecha de alta en la SUNAT: la vista previa la dice (el filtro de antigüedad sale de ella).
      q.size === 0 ? null : pool.query(
        `SELECT ${FILA_EMPRESA}, to_char(e.fecha_alta, 'YYYY-MM-DD') AS "fechaAlta" FROM empresa_resumen e ${donde}
          ORDER BY ${ORDEN[q.orden]}, e.ruc LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, vals),
      resumen(conds, vals),
    ]);
    const entidad = q.entidad
      ? (await pool.query<{ nombre: string }>(`SELECT nombre FROM entidades WHERE ruc = $1`, [q.entidad])).rows[0]?.nombre ?? null
      : null;
    return publicar({ total: rs.empresas, page: q.page, size: q.size, data: filas?.rows.map(conNombre) ?? [], resumen: rs, entidad });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const conNombre = <T extends { nombre?: string | null }>(f: T): T => ({ ...f, nombre: f.nombre ? conEnie(f.nombre) : f.nombre });

/**
 * Ficha MÍNIMA para una empresa jurídica (RUC-20) que NO está en empresa_resumen pero sí ganó contratos menores:
 * `empresa_resumen` se reconstruye entero desde contratos/órdenes, así que estos proveedores «solo-menores» no caben.
 * Se arma al vuelo desde seace_proveedor_sunat (identidad SUNAT) + seace_menores (sus menores). `soloMenores: true` le
 * dice al frontend que renderice la ficha reducida (identidad + sus menores). RUC-10 (persona) NO: sale como persona.
 */
async function fichaMenoresOnly(ruc: string) {
  if (!ruc.startsWith("20")) return null;
  const r = await pool.query<{
    razon_social: string | null; estado: string | null; condicion: string | null; actividad_ciiu: string | null;
    departamento: string | null; distrito: string | null; fecha_inicio: string | null;
    menores: number; entidades: number; monto: number;
  }>(
    `SELECT sp.razon_social, sp.estado, sp.condicion, sp.actividad_ciiu, sp.departamento, sp.distrito,
            to_char(sp.fecha_inicio_actividades,'YYYY-MM-DD') AS fecha_inicio,
            (SELECT count(*) FROM seace_menores m WHERE m.proveedor_ruc = sp.ruc)::int AS menores,
            (SELECT count(DISTINCT m.entidad_ruc) FROM seace_menores m WHERE m.proveedor_ruc = sp.ruc)::int AS entidades,
            (SELECT COALESCE(sum(m.monto),0) FROM seace_menores m WHERE m.proveedor_ruc = sp.ruc)::float AS monto
       FROM seace_proveedor_sunat sp WHERE sp.ruc = $1`, [ruc]);
  const s = r.rows[0];
  if (!s || !s.menores) return null;
  return publicar({
    empresa: {
      soloMenores: true, ruc, nombre: s.razon_social, estadoSunat: s.estado, condicionSunat: s.condicion,
      actividad: s.actividad_ciiu, departamento: s.departamento, distrito: s.distrito, fechaAlta: s.fecha_inicio,
      menores: s.menores, menoresEntidades: s.entidades, menoresMonto: s.monto,
    },
    antecedentes: [], anual: [],
  });
}

// ─── GET /empresas/:ruc ─────────────────────────────────────────────────────────────────────────
empresasRouter.get("/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!RUC_EMPRESA.test(ruc)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await fichaMemo.obtener(`ficha:${ruc}`, async () => {
    const [e, anual] = await Promise.all([
      pool.query(
        `SELECT ${FILA_EMPRESA}, e.adj_monto_dudoso::float AS "adjMontoDudoso", e.adj_otra_moneda AS "adjOtraMoneda",
                e.ord_monto_dudoso::float AS "ordMontoDudoso", to_char(e.fecha_alta, 'YYYY-MM-DD') AS "fechaAlta", e.domicilio,
                e.actividad, e.socios, e.representantes, e.directivos, e.vinculadas, e.visitas_clientes AS "visitasClientes",
                to_char(e.actualizado, 'YYYY-MM-DD') AS actualizado
           FROM empresa_resumen e WHERE e.ruc = $1`, [ruc]),
      // Año por año: lo adjudicado (sola y en consorcio, en soles y sin lo dudoso) y lo pagado por órdenes.
      pool.query(
        `WITH a AS (
           SELECT false AS cons, a.codigo_convocatoria, a.entidad_ruc, a.fecha_buenapro, a.monto_adjudicado, a.moneda
             FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1
           UNION ALL
           SELECT true, a.codigo_convocatoria, a.entidad_ruc, a.fecha_buenapro, a.monto_adjudicado, a.moneda
             FROM conosce_adjudicaciones a
            WHERE a.ruc_proveedor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1)
              AND a.ruc_proveedor !~ '^(10|20)[0-9]{9}$'
         ), pr AS (
           -- Cada proceso una vez (el año de su buena pro), y si su monto parece mal cargado: ése no se suma.
           SELECT codigo_convocatoria, entidad_ruc, cons, extract(year FROM max(fecha_buenapro))::int AS anio,
                  sum(monto_adjudicado) FILTER (WHERE moneda IN ${SOLES}) AS monto
             FROM a GROUP BY 1, 2, 3 HAVING max(fecha_buenapro) IS NOT NULL
         ), ad AS (
           SELECT anio, count(*) FILTER (WHERE NOT cons)::int AS contratos,
                  COALESCE(sum(monto) FILTER (WHERE NOT cons AND NOT dud), 0)::float AS adjudicado,
                  count(*) FILTER (WHERE cons)::int AS "enConsorcio",
                  COALESCE(sum(monto) FILTER (WHERE cons AND NOT dud), 0)::float AS "adjudicadoConsorcio",
                  count(*) FILTER (WHERE dud)::int AS "contratosDudosos", COALESCE(sum(monto) FILTER (WHERE dud), 0)::float AS "adjudicadoDudoso"
             FROM pr CROSS JOIN LATERAL (SELECT ${DUDOSO_ADJ("pr")} AS dud) d GROUP BY anio
         ), o AS (
           SELECT anio, sum(ordenes)::int AS ordenes, sum(monto)::float AS ordenado, sum(dudosas)::int AS dudosas, sum(monto_dudoso)::float AS "ordenadoDudoso"
             FROM empresa_orden_anual WHERE ruc = $1 GROUP BY anio
         )
         SELECT COALESCE(ad.anio, o.anio) AS anio, COALESCE(ad.contratos, 0) AS contratos, COALESCE(ad.adjudicado, 0) AS adjudicado,
                COALESCE(ad."enConsorcio", 0) AS "enConsorcio", COALESCE(ad."adjudicadoConsorcio", 0) AS "adjudicadoConsorcio",
                COALESCE(ad."contratosDudosos", 0) AS "contratosDudosos", COALESCE(ad."adjudicadoDudoso", 0) AS "adjudicadoDudoso",
                COALESCE(o.ordenes, 0) AS ordenes, COALESCE(o.ordenado, 0) AS ordenado, COALESCE(o.dudosas, 0) AS dudosas,
                COALESCE(o."ordenadoDudoso", 0) AS "ordenadoDudoso"
           FROM ad FULL JOIN o ON o.anio = ad.anio ORDER BY 1`, [ruc]),
    ]);
    const fila = e.rows[0];
    if (!fila) return fichaMenoresOnly(ruc);
    // Sus antecedentes por tipo: qué registro la nombra, cuántas veces y con qué gravedad (sin puntos ni puntaje).
    const antecedentes = ((fila.cruces as { tipo: string; severidad: string; n: number }[] | null) ?? [])
      .map((x) => ({ ...x, etiqueta: ETIQUETA_CRUCE[x.tipo] ?? x.tipo }));
    return publicar({ empresa: conNombre(fila), antecedentes, anual: anual.rows });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * El proceso de un ítem adjudicado tiene un monto que parece mal cargado (la regla de los contratos, migración 102):
 * la adjudicación más grande es 20 veces el referencial de todo el proceso y pasa S/ 1 M, o el referencial es de
 * S/ 1 o menos y la adjudicación pasa S/ 100 mil. `t` es el alias de la fila de conosce_adjudicaciones.
 */
const DUDOSO_ADJ = (t: string) => `EXISTS (
  SELECT 1 FROM (SELECT sum(ref) AS ref, max(adj) AS adj
                   FROM (SELECT x.n_item, max(x.monto_referencial) AS ref, max(x.monto_adjudicado) AS adj
                           FROM conosce_adjudicaciones x
                          WHERE x.codigo_convocatoria = ${t}.codigo_convocatoria AND x.entidad_ruc = ${t}.entidad_ruc AND x.moneda IN ${SOLES}
                          GROUP BY x.n_item) i) p
   WHERE p.ref > 0 AND ((p.ref <= 1 AND p.adj > 100000) OR (p.ref > 1 AND p.adj >= 20 * p.ref AND p.adj > 1000000)))`;

/** La empresa existe en el resumen (las subrutas responden 404 si no). */
async function existe(ruc: string): Promise<{ nombre: string } | null> {
  if (!RUC_EMPRESA.test(ruc)) return null;
  const r = await pool.query<{ nombre: string }>(`SELECT nombre FROM empresa_resumen WHERE ruc = $1`, [ruc]);
  return r.rows[0] ?? null;
}

// ─── GET /empresas/:ruc/contratos ───────────────────────────────────────────────────────────────
/** Las 25 variantes de `tipo_proceso` de CONOSCE en familias legibles (las leyes y decretos de urgencia, juntos). */
const FAMILIA_PROCESO = (c: string) => `CASE
  WHEN ${c} ILIKE 'Adjudicación Simplificada%' THEN 'Adjudicación simplificada'
  WHEN ${c} ILIKE 'Subasta Inversa%' THEN 'Subasta inversa'
  WHEN ${c} ILIKE 'Contratación Directa%' THEN 'Contratación directa'
  WHEN ${c} ILIKE 'Licitación Pública Abreviada%' THEN 'Licitación pública abreviada'
  WHEN ${c} ILIKE 'Licitación Pública%' THEN 'Licitación pública'
  WHEN ${c} ILIKE 'Comparación de Precios%' THEN 'Comparación de precios'
  WHEN ${c} ILIKE 'R_gimen Especial%' THEN 'Régimen especial'
  WHEN ${c} ILIKE 'Concurso Público Abreviado%' THEN 'Concurso público abreviado'
  WHEN ${c} ILIKE 'Concurso Público%' THEN 'Concurso público'
  WHEN ${c} ILIKE 'Convenio%' THEN 'Convenio'
  WHEN ${c} ILIKE 'Contratación Internacional%' THEN 'Contratación internacional'
  WHEN ${c} ILIKE 'Procedimiento Especial%' THEN 'Procedimiento especial'
  WHEN ${c} ILIKE 'Adjudicación Selectiva%' OR ${c} ILIKE 'Adjudicación Abreviada%' THEN 'Adjudicación selectiva o abreviada'
  WHEN ${c} IS NULL THEN 'Sin dato'
  ELSE 'Otro' END`;

/**
 * Las banderas de un proceso de la empresa. La faceta de la ficha (chips) es una PARTICIÓN por la sanción del Tribunal
 * frente a la buena pro: inhabilitada al ganar, sancionada antes, sancionada sólo después y sin sanciones suman todos sus
 * procesos (2026-10-27: «Todos 321, Sancionada antes 149, Sancionada después 172, Sin banderas 171» no sumaba, porque
 * «después» se cruzaba con las otras dos). `sancionada_despues`, `antecedentes`, `dudoso` y `sin` siguen valiendo por los
 * enlaces de antes; el posible error de carga tiene su propio filtro (`dudoso=si`).
 */
export const BANDERAS_CONTRATO = ["inhabilitada", "sancionada_antes", "solo_despues", "sin_sancion", "sancionada_despues", "antecedentes", "dudoso", "sin"] as const;

const Contratos = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2015).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  como: z.enum(["sola", "consorcio"]).optional(),
  objeto: z.enum(OBJETOS).optional(),
  familia: z.string().trim().min(3).max(60).optional(),
  departamento: z.string().trim().min(2).max(40).optional(),
  bandera: z.enum(BANDERAS_CONTRATO).optional(),
  // Sólo los de monto con posible error de carga (se cruza con cualquier sanción: va aparte de la faceta).
  dudoso: z.enum(["si"]).optional(),
  // Un antecedente concreto del ganador sobre ESTE proceso (casos_cruce): "con" (cualquiera), "alta" (alguno grave) o un
  // tipo (penalidad, visita_previa, partido_gobernante…). Desglosa la vieja bandera "Con antecedentes" en la lista completa.
  cruce: z.string().trim().min(2).max(40).regex(/^[a-z_]+$/).optional(),
  orden: z.enum(["reciente", "antiguo", "monto", "monto_asc"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const ORDEN_CONTRATOS: Record<z.infer<typeof Contratos>["orden"], string> = {
  reciente: "x.fecha DESC NULLS LAST, x.codigo DESC",
  antiguo: "x.fecha ASC NULLS LAST, x.codigo",
  monto: "x.monto DESC NULLS LAST, x.fecha DESC NULLS LAST",
  monto_asc: "x.monto ASC NULLS LAST, x.fecha DESC NULLS LAST",
};

/** Las banderas de un proceso ya calculadas en `x` (ver la consulta): para filtrar y para contar. */
export const BANDERA_SQL: Record<(typeof BANDERAS_CONTRATO)[number], string> = {
  // La partición (cada proceso en una sola): inhabilitada > sancionada antes > sólo después > sin sanciones.
  inhabilitada: `x.al_ganar IS NOT NULL`,
  sancionada_antes: `x.al_ganar IS NULL AND x.s_antes > 0`,
  solo_despues: `x.al_ganar IS NULL AND COALESCE(x.s_antes, 0) = 0 AND x.s_despues > 0`,
  sin_sancion: `x.al_ganar IS NULL AND COALESCE(x.s_antes, 0) = 0 AND COALESCE(x.s_despues, 0) = 0`,
  sancionada_despues: `x.s_despues > 0`,
  antecedentes: `x.n_antecedentes > 0`,
  dudoso: `x.dudoso IS NOT NULL`,
  sin: `x.al_ganar IS NULL AND COALESCE(x.s_antes, 0) = 0 AND x.n_antecedentes = 0 AND x.dudoso IS NULL`,
};

empresasRouter.get("/:ruc/contratos", async (c) => {
  const ruc = c.req.param("ruc");
  const parsed = Contratos.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await fichaMemo.obtener(`contratos:${ruc}:${JSON.stringify(q)}`, async () => {
    if (!(await existe(ruc))) return null;
    const vals: unknown[] = [ruc];
    const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds: string[] = [];
    if (q.anio) conds.push(`extract(year FROM x.fecha) = ${p(q.anio)}`);
    if (q.entidad) conds.push(`x.entidad_ruc = ${p(q.entidad)}`);
    if (q.como) conds.push(q.como === "consorcio" ? `x.consorcio IS NOT NULL` : `x.consorcio IS NULL`);
    if (q.objeto) conds.push(`x.objeto = ${p(q.objeto)}`);
    if (q.familia) conds.push(`x.familia = ${p(q.familia)}`);
    if (q.departamento) conds.push(`mef_norm(x.departamento) = ${p(norm(q.departamento))}`);
    if (q.bandera) conds.push(BANDERA_SQL[q.bandera]);
    if (q.dudoso) conds.push(BANDERA_SQL.dudoso);
    if (q.cruce === "con") conds.push(`x.n_antecedentes > 0`);
    else if (q.cruce === "alta") conds.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(x.cruces, '[]')) e WHERE e->>'severidad' = 'alta' AND e->>'tipo' NOT IN ('sancion', 'sancion_vigente'))`);
    else if (q.cruce) conds.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(x.cruces, '[]')) e WHERE e->>'tipo' = ${p(q.cruce)})`);
    for (const w of palabrasBusqueda(q.q)) {
      conds.push(`mef_norm(concat_ws(' ', x.descripcion, x.entidad, x.nomenclatura, x.codigo, x.consorcio)) LIKE ${p(`%${w}%`)}`);
    }
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // Cada proceso una vez con sus ítems sumados (en soles; otra moneda, aparte) y, para TODOS (los filtros y los conteos
    // los usan): si el monto parece mal cargado, su OCID, sus antecedentes en casos_cruce y sus sanciones frente a la
    // buena pro. Los conteos de cada filtro van sobre todos los procesos de la empresa; la página, sobre los filtrados.
    const r = await pool.query(
      `WITH a AS (
         SELECT a.*, NULL::text AS consorcio FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1
         UNION ALL
         SELECT a.*, a.proveedor FROM conosce_adjudicaciones a
          WHERE a.ruc_proveedor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1) AND a.ruc_proveedor !~ '^(10|20)[0-9]{9}$'
       ), pr AS (
         SELECT a.codigo_convocatoria AS codigo, a.entidad_ruc, max(a.entidad) AS entidad, max(a.entidad_departamento) AS departamento,
                max(a.objeto) AS objeto, max(a.tipo_proceso) AS tipo_proceso, ${FAMILIA_PROCESO("max(a.tipo_proceso)")} AS familia,
                max(a.nomenclatura) AS nomenclatura, max(a.descripcion_proceso) AS descripcion, max(a.fecha_buenapro) AS fecha,
                count(*)::int AS items,
                sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ${SOLES}) AS monto,
                sum(a.monto_adjudicado) FILTER (WHERE a.moneda NOT IN ${SOLES}) AS monto_otra,
                max(a.moneda) FILTER (WHERE a.moneda NOT IN ${SOLES}) AS otra_moneda,
                max(a.consorcio) AS consorcio
           FROM a GROUP BY a.codigo_convocatoria, a.entidad_ruc
       ), dud AS (
         -- La regla de DUDOSO_ADJ (con su motivo) para todos los procesos de una vez (no una subconsulta por fila).
         SELECT codigo_convocatoria, entidad_ruc, CASE WHEN sum(ref) <= 1 THEN 'referencial_simbolico' ELSE 'adjudicado_20x' END AS motivo
           FROM (SELECT x.codigo_convocatoria, x.entidad_ruc, x.n_item, max(x.monto_referencial) AS ref, max(x.monto_adjudicado) AS adj
                   FROM conosce_adjudicaciones x
                  WHERE x.codigo_convocatoria IN (SELECT codigo FROM pr) AND x.moneda IN ${SOLES}
                  GROUP BY 1, 2, 3) i
          GROUP BY 1, 2
         HAVING sum(ref) > 0 AND ((sum(ref) <= 1 AND max(adj) > 100000) OR (sum(ref) > 1 AND max(adj) >= 20 * sum(ref) AND max(adj) > 1000000))
       ), cv AS (
         SELECT DISTINCT ON (c.codigo, c.entidad_ruc) c.codigo, c.entidad_ruc, c.ocid
           FROM convocatorias c WHERE c.codigo IN (SELECT codigo FROM pr)
          ORDER BY c.codigo, c.entidad_ruc, c.ocid
       ), s AS (
         SELECT tipo, fecha_desde, fecha_hasta, fecha_resolucion, resolucion FROM osce_sancionados WHERE ruc = $1
       ), x AS MATERIALIZED (
         SELECT pr.*, d.motivo AS dudoso, cv.ocid, k.cruces,
                (SELECT count(*) FROM jsonb_array_elements(COALESCE(k.cruces, '[]')) e
                  WHERE e->>'tipo' NOT IN ('sancion', 'sancion_vigente'))::int AS n_antecedentes,
                sx.al_ganar, sx.s_antes, sx.s_antes_hasta, sx.s_despues, sx.s_despues_desde
           FROM pr
           LEFT JOIN dud d ON d.codigo_convocatoria = pr.codigo AND d.entidad_ruc = pr.entidad_ruc
           LEFT JOIN cv ON cv.codigo = pr.codigo AND cv.entidad_ruc = pr.entidad_ruc
           LEFT JOIN casos_cruce k ON k.ocid = cv.ocid AND k.ruc = $1
           -- Las sanciones del Tribunal frente a la buena pro (la regla de sancion_vigente, migración 56).
           LEFT JOIN LATERAL (
             SELECT (array_agg(jsonb_build_object('tipo', s.tipo, 'desde', s.fecha_desde, 'hasta', s.fecha_hasta, 'resolucion', s.resolucion)
                               ORDER BY s.fecha_desde DESC)
                       FILTER (WHERE s.tipo IN ('temporal', 'definitivo') AND pr.fecha >= s.fecha_desde
                                     AND (s.fecha_hasta IS NULL OR pr.fecha <= s.fecha_hasta)))[1] AS al_ganar,
                    count(*) FILTER (WHERE COALESCE(s.fecha_desde, s.fecha_resolucion) < pr.fecha)::int AS s_antes,
                    max(s.fecha_hasta) FILTER (WHERE COALESCE(s.fecha_desde, s.fecha_resolucion) < pr.fecha) AS s_antes_hasta,
                    count(*) FILTER (WHERE COALESCE(s.fecha_desde, s.fecha_resolucion) > pr.fecha)::int AS s_despues,
                    min(COALESCE(s.fecha_desde, s.fecha_resolucion)) FILTER (WHERE COALESCE(s.fecha_desde, s.fecha_resolucion) > pr.fecha) AS s_despues_desde
               FROM s WHERE pr.fecha IS NOT NULL
             HAVING count(*) > 0) sx ON true
       ), fac AS (
         SELECT jsonb_build_object(
           'anios', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', y, 'n', n) ORDER BY y DESC)
                                FROM (SELECT extract(year FROM fecha)::int AS y, count(*) AS n FROM x WHERE fecha IS NOT NULL GROUP BY 1) t), '[]'),
           'entidades', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', entidad_ruc, 'etiqueta', entidad, 'n', n) ORDER BY n DESC, entidad)
                                    FROM (SELECT entidad_ruc, max(entidad) AS entidad, count(*) AS n FROM x WHERE entidad_ruc IS NOT NULL
                                           GROUP BY 1 ORDER BY 3 DESC LIMIT 300) t), '[]'),
           'objetos', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', objeto, 'n', n) ORDER BY n DESC)
                                  FROM (SELECT objeto, count(*) AS n FROM x WHERE objeto IS NOT NULL GROUP BY 1) t), '[]'),
           'familias', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', familia, 'n', n, 'monto', m) ORDER BY n DESC)
                                   FROM (SELECT familia, count(*) AS n, COALESCE(sum(monto) FILTER (WHERE dudoso IS NULL), 0)::float AS m
                                           FROM x GROUP BY 1) t), '[]'),
           'departamentos', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', d, 'n', n) ORDER BY d)
                                        FROM (SELECT mef_norm(departamento) AS d, count(*) AS n FROM x WHERE departamento IS NOT NULL GROUP BY 1) t), '[]'),
           'como', jsonb_build_object('sola', (SELECT count(*) FROM x WHERE consorcio IS NULL), 'consorcio', (SELECT count(*) FROM x WHERE consorcio IS NOT NULL)),
           'banderas', jsonb_build_object(${BANDERAS_CONTRATO.map((b) => `'${b}', (SELECT count(*) FROM x WHERE ${BANDERA_SQL[b]})`).join(", ")}),
           -- Cada tipo de antecedente del ganador y cuantos de sus procesos lo tienen, para el desplegable segmentado por
           -- familia (como /app/contratos). con = con alguno; alta = con alguno grave. Sin las sanciones (van en banderas).
           'cruces', jsonb_build_object(
             'con', (SELECT count(*) FROM x WHERE n_antecedentes > 0),
             'alta', (SELECT count(*) FROM x WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(x.cruces, '[]')) e
                                                            WHERE e->>'severidad' = 'alta' AND e->>'tipo' NOT IN ('sancion', 'sancion_vigente'))),
             'tipos', COALESCE((SELECT jsonb_object_agg(tipo, n) FROM (
                        SELECT e->>'tipo' AS tipo, count(*) AS n FROM x, jsonb_array_elements(COALESCE(x.cruces, '[]')) e
                         WHERE e->>'tipo' NOT IN ('sancion', 'sancion_vigente') GROUP BY 1) t), '{}'::jsonb))
         ) AS facetas
       ), f AS (
         SELECT x.*, count(*) OVER ()::int AS total FROM x ${donde}
          ORDER BY ${ORDEN_CONTRATOS[q.orden]} LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}
       )
       SELECT fac.facetas, f.codigo, f.entidad_ruc AS "entidadRuc", f.entidad, f.departamento, f.objeto, f.tipo_proceso AS "tipoProceso",
              f.familia, f.nomenclatura, f.descripcion, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.items, f.monto::float AS monto,
              f.monto_otra::float AS "montoOtraMoneda", f.otra_moneda AS "otraMoneda", f.consorcio, f.total, f.dudoso, f.ocid,
              f.cruces AS antecedentes,
              CASE WHEN f.s_antes IS NULL THEN NULL ELSE jsonb_build_object('alGanar', f.al_ganar, 'antes', f.s_antes, 'antesHasta', f.s_antes_hasta,
                                                                          'despues', f.s_despues, 'despuesDesde', f.s_despues_desde) END AS sancion
         FROM fac LEFT JOIN f ON true
        ORDER BY ${ORDEN_CONTRATOS[q.orden].replace(/x\./g, "f.")}`, vals);
    const filas = r.rows.filter((x) => x.codigo != null);
    return publicar({
      total: filas[0]?.total ?? 0, page: q.page, size: q.size,
      facetas: r.rows[0]?.facetas ?? null,
      data: filas.map(({ total: _t, facetas: _f, antecedentes, sancion, ...f }) => ({
        ...f,
        sancion: sancion ?? null,
        // casos_cruce.cruces: [{tipo, severidad, n}] (migración 57), los graves primero. Las sanciones van aparte, en
        // `sancion`, con su momento frente a la buena pro (al ganar, antes o después).
        antecedentes: ((antecedentes as { tipo: string; severidad: string }[] | null) ?? [])
          .filter((t) => t.tipo !== "sancion" && t.tipo !== "sancion_vigente")
          .map((t) => ({ tipo: t.tipo, severidad: t.severidad, etiqueta: ETIQUETA_CRUCE[t.tipo] ?? t.tipo }))
          .sort((a, b) => "amb".indexOf(a.severidad[0]) - "amb".indexOf(b.severidad[0])),
      })),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/ordenes ─────────────────────────────────────────────────────────────────
const Ordenes = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  departamento: z.string().trim().min(2).max(40).optional(),
  tipo: z.enum(["compra", "servicio"]).optional(),
  estado: z.string().trim().min(3).max(30).optional(),
  dudosa: z.enum(["si"]).optional(),
  orden: z.enum(["reciente", "antiguo", "monto", "monto_asc"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const ORDEN_ORDENES: Record<z.infer<typeof Ordenes>["orden"], string> = {
  reciente: "o.fecha_emision DESC, o.orden DESC",
  antiguo: "o.fecha_emision ASC, o.orden",
  // Las de monto dudoso (monto NULL) al final: si no, un RUC escrito como monto encabezaría la lista.
  monto: "o.monto DESC NULLS LAST, o.fecha_emision DESC",
  monto_asc: "o.monto ASC NULLS LAST, o.fecha_emision DESC",
};

empresasRouter.get("/:ruc/ordenes", async (c) => {
  const ruc = c.req.param("ruc");
  const parsed = Ordenes.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await fichaMemo.obtener(`ordenes:${ruc}:${JSON.stringify(q)}`, async () => {
    if (!(await existe(ruc))) return null;
    const vals: unknown[] = [ruc];
    const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    // Como empresa_orden_anual (refrescar_empresa_ordenes): en soles, sin las anuladas, emitidas desde 2018 (los archivos
    // de 2018 traen algunas de 2014 a 2017) y hasta un mes adelante; las de monto dudoso, con su monto original. Así el
    // total y los conteos de los filtros son los mismos números.
    const base = [`o.ruc_contratista = $1`, `o.moneda = 'Nuevos Soles'`, `o.estado IS DISTINCT FROM 'Anulada'`, `(o.monto > 0 OR o.monto_dudoso IS NOT NULL)`,
                  `o.fecha_emision >= DATE '2018-01-01'`, `o.fecha_emision <= current_date + 31`, `o.entidad_ruc ~ '^[0-9]{11}$'`];
    // Lo que no cambia entre las versiones de una orden (entidad, región, fecha) se filtra antes de deduplicar; lo que sí
    // puede cambiar de un archivo mensual al siguiente (estado, monto, descripción), después: vale la versión más nueva,
    // como en empresa_orden_anual (antes, «devengadas» contaba también las que en su última versión ya no lo eran).
    const fijos: string[] = [];
    if (q.entidad) fijos.push(`o.entidad_ruc = ${p(q.entidad)}`);
    if (q.departamento) fijos.push(`mef_norm(o.departamento) = ${p(norm(q.departamento))}`);
    if (q.anio) fijos.push(`o.fecha_emision >= make_date(${p(q.anio)}, 1, 1) AND o.fecha_emision < make_date($${vals.length} + 1, 1, 1)`);
    const variables: string[] = [];
    if (q.tipo) variables.push(q.tipo === "compra" ? `o.tipo_orden ILIKE '%compra%'` : `o.tipo_orden NOT ILIKE '%compra%'`);
    if (q.estado) variables.push(`o.estado = ${p(q.estado)}`);
    if (q.dudosa) variables.push(`o.monto_dudoso IS NOT NULL`);
    for (const w of palabrasBusqueda(q.q)) {
      variables.push(`mef_norm(COALESCE(o.descripcion, '') || ' ' || COALESCE(o.entidad, '') || ' ' || COALESCE(o.nro_orden, '')) LIKE ${p(`%${w}%`)}`);
    }
    const donde = fijos.length ? `AND ${fijos.join(" AND ")}` : "";
    const despues = variables.length ? `WHERE ${variables.join(" AND ")}` : "";
    const COLS = `to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.entidad, o.entidad_ruc AS "entidadRuc", o.departamento, o.nro_orden AS numero,
                  o.orden, o.tipo_orden AS "tipoOrden", o.descripcion, COALESCE(o.monto, o.monto_dudoso)::float AS monto,
                  o.monto_dudoso::float AS "montoDudoso", o.dudoso_motivo AS "dudosoMotivo", o.tipo_contratacion AS "tipoContratacion", o.estado`;
    const DEDUP = `DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision)`;
    const DEDUP_ORDEN = `o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC`;
    // El total sin recorrer sus órdenes: exacto desde empresa_orden_anual (cada orden ya contada una vez, en su versión
    // más nueva, por entidad, año y región). Sólo sin filtros variables; con ellos, la consulta completa cuenta el suyo.
    const totalAnual = async () => {
      const v: unknown[] = [ruc];
      const c2 = [`ruc = $1`];
      if (q.entidad) { v.push(q.entidad); c2.push(`entidad_ruc = $${v.length}`); }
      if (q.anio) { v.push(q.anio); c2.push(`anio = $${v.length}`); }
      if (q.departamento) { v.push(norm(q.departamento)); c2.push(`mef_norm(departamento) = $${v.length}`); }
      const t = await pool.query<{ n: number }>(`SELECT COALESCE(sum(ordenes), 0)::int AS n FROM empresa_orden_anual WHERE ${c2.join(" AND ")}`, v);
      return t.rows[0]?.n ?? 0;
    };
    // La página por fecha y sin filtros variables: con el índice (ruc_contratista, fecha_emision) de la migración 111 se
    // leen sólo las primeras órdenes por fecha (una ventana holgada: un archivo mensual repite a veces una orden) y se
    // deduplican ésas. Por monto, o con estado, tipo, texto o monto dudoso, todas sus órdenes deduplicadas y luego el
    // filtro (con plazo propio: un gran proveedor pasa los 10 s del rol con la caché fría).
    const porFecha = (q.orden === "reciente" || q.orden === "antiguo") && !variables.length;
    const dir = q.orden === "antiguo" ? "ASC" : "DESC";
    const offset = (q.page - 1) * q.size;
    const ventana = (offset + q.size) * 3 + 200;
    const pagina = porFecha
      ? consultaConPlazo(
          `WITH c AS (
             SELECT o.* FROM conosce_ordenes o WHERE ${base.join(" AND ")} ${donde}
              ORDER BY o.fecha_emision ${dir}, ${DEDUP_ORDEN} LIMIT ${ventana}
           ), d AS (SELECT ${DEDUP} o.* FROM c o ORDER BY ${DEDUP_ORDEN})
           SELECT ${COLS} FROM d o ORDER BY o.fecha_emision ${dir}, o.orden ${dir} LIMIT ${q.size} OFFSET ${offset}`, vals)
      : consultaConPlazo(
          `WITH o AS MATERIALIZED (
             SELECT ${DEDUP} o.* FROM conosce_ordenes o WHERE ${base.join(" AND ")} ${donde} ORDER BY ${DEDUP_ORDEN})
           SELECT ${COLS}, count(*) OVER ()::int AS total FROM o ${despues}
            ORDER BY ${ORDEN_ORDENES[q.orden]} LIMIT ${q.size} OFFSET ${offset}`, vals);
    const [r, total0, fac] = await Promise.all([
      pagina,
      // Por fecha, el total de empresa_orden_anual; la consulta completa trae el suyo (count(*) OVER).
      porFecha ? totalAnual() : Promise.resolve(null),
      // Los conteos de cada filtro, sobre todas sus órdenes, ya contados en empresa_orden_anual (migración 110: también
      // por estado): no vuelven a recorrer sus órdenes.
      fichaMemo.obtener(`ordenes-facetas:${ruc}`, async () => {
        const anual = await pool.query(
            `SELECT jsonb_build_object(
               'anios', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', anio, 'n', n) ORDER BY anio DESC)
                                    FROM (SELECT anio, sum(ordenes)::int AS n FROM empresa_orden_anual WHERE ruc = $1 GROUP BY 1) t), '[]'),
               'entidades', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', entidad_ruc, 'etiqueta', entidad, 'n', n) ORDER BY n DESC, entidad)
                                        FROM (SELECT entidad_ruc, max(entidad) AS entidad, sum(ordenes)::int AS n FROM empresa_orden_anual
                                               WHERE ruc = $1 GROUP BY 1 ORDER BY 3 DESC LIMIT 300) t), '[]'),
               'departamentos', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', d, 'n', n) ORDER BY d)
                                            FROM (SELECT mef_norm(departamento) AS d, sum(ordenes)::int AS n FROM empresa_orden_anual
                                                   WHERE ruc = $1 AND departamento IS NOT NULL GROUP BY 1) t), '[]'),
               'dudosas', (SELECT COALESCE(sum(dudosas), 0)::int FROM empresa_orden_anual WHERE ruc = $1),
               'estados', (SELECT jsonb_build_array(
                                    jsonb_build_object('valor', 'Emitida', 'n', COALESCE(sum(emitidas), 0)),
                                    jsonb_build_object('valor', 'Comprometida', 'n', COALESCE(sum(comprometidas), 0)),
                                    jsonb_build_object('valor', 'Devengada', 'n', COALESCE(sum(devengadas), 0)))
                             FROM empresa_orden_anual WHERE ruc = $1),
               'tipos', (SELECT jsonb_build_object('compra', COALESCE(sum(compras), 0), 'servicio', COALESCE(sum(ordenes - compras), 0))
                           FROM empresa_orden_anual WHERE ruc = $1)) AS f`, [ruc]);
        return anual.rows[0]?.f ?? null;
      }),
    ]);
    const total = total0 ?? r.rows[0]?.total ?? 0;
    return publicar({ total, page: q.page, size: q.size, facetas: fac, data: r.rows.map(({ total: _t, ...f }) => f) });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/clientes ────────────────────────────────────────────────────────────────
empresasRouter.get("/:ruc/clientes", async (c) => {
  const ruc = c.req.param("ruc");
  const cuerpo = await fichaMemo.obtener(`clientes:${ruc}`, async () => {
    if (!(await existe(ruc))) return null;
    // Cada entidad con lo que le adjudicó (sola o en consorcio) y lo que le compró por órdenes, y las visitas de la gente
    // de la empresa a esa entidad. Todas: la web las pagina y las busca.
    const r = await pool.query(
      `WITH a AS (
         SELECT a.entidad_ruc, a.entidad, a.entidad_departamento AS departamento, a.codigo_convocatoria, a.fecha_buenapro,
                CASE WHEN a.moneda IN ${SOLES} THEN a.monto_adjudicado END AS monto, false AS cons
           FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1
         UNION ALL
         SELECT a.entidad_ruc, a.entidad, a.entidad_departamento, a.codigo_convocatoria, a.fecha_buenapro,
                CASE WHEN a.moneda IN ${SOLES} THEN a.monto_adjudicado END, true
           FROM conosce_adjudicaciones a
          WHERE a.ruc_proveedor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1) AND a.ruc_proveedor !~ '^(10|20)[0-9]{9}$'
       ), ad AS (
         SELECT entidad_ruc, max(entidad) AS entidad, max(departamento) AS departamento,
                count(DISTINCT codigo_convocatoria)::int AS contratos, COALESCE(sum(monto), 0)::float AS adjudicado,
                bool_or(cons) AS consorcio, min(fecha_buenapro) AS primera, max(fecha_buenapro) AS ultima
           FROM a WHERE entidad_ruc IS NOT NULL GROUP BY entidad_ruc
       ), o AS (
         SELECT entidad_ruc, max(entidad) AS entidad, max(departamento) AS departamento, sum(ordenes)::int AS ordenes,
                sum(monto)::float AS ordenado, sum(dudosas)::int AS dudosas, min(primera) AS primera, max(ultima) AS ultima
           FROM empresa_orden_anual WHERE ruc = $1 GROUP BY entidad_ruc
       ), v AS (
         SELECT entidad_ruc, count(*)::int AS visitas FROM empresa_visita WHERE ruc = $1 AND entidad_ruc IS NOT NULL GROUP BY entidad_ruc
       )
       SELECT COALESCE(ad.entidad_ruc, o.entidad_ruc) AS "entidadRuc", COALESCE(ad.entidad, o.entidad) AS entidad,
              COALESCE(ad.departamento, o.departamento) AS departamento, COALESCE(ad.contratos, 0) AS contratos,
              COALESCE(ad.adjudicado, 0) AS adjudicado, COALESCE(ad.consorcio, false) AS consorcio, COALESCE(o.ordenes, 0) AS ordenes,
              COALESCE(o.ordenado, 0) AS ordenado, COALESCE(o.dudosas, 0) AS dudosas, COALESCE(v.visitas, 0) AS visitas,
              to_char(least(ad.primera, o.primera), 'YYYY-MM-DD') AS primera, to_char(greatest(ad.ultima, o.ultima), 'YYYY-MM-DD') AS ultima
         FROM ad FULL JOIN o ON o.entidad_ruc = ad.entidad_ruc
         LEFT JOIN v ON v.entidad_ruc = COALESCE(ad.entidad_ruc, o.entidad_ruc)
        ORDER BY COALESCE(ad.adjudicado, 0) + COALESCE(o.ordenado, 0) DESC
        LIMIT 5000`, [ruc]);
    return publicar({ total: r.rows.length, data: r.rows });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/postulaciones ───────────────────────────────────────────────────────────
const Postulaciones = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  resultado: z.enum(["gano", "perdio", "sin"]).optional(),
  anio: z.coerce.number().int().min(2015).max(2100).optional(),
  objeto: z.enum(OBJETOS).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  // Quién le ganó: el RUC de la empresa que se llevó la buena pro.
  ganador: z.string().regex(/^20\d{9}$/).optional(),
  orden: z.enum(["reciente", "antiguo", "monto"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const ORDEN_POSTULACIONES: Record<z.infer<typeof Postulaciones>["orden"], string> = {
  reciente: "COALESCE(g.fecha, g.convocatoria) DESC NULLS LAST, g.codigo DESC",
  antiguo: "COALESCE(g.fecha, g.convocatoria) ASC NULLS LAST, g.codigo",
  monto: "g.monto DESC NULLS LAST, g.codigo DESC",
};

empresasRouter.get("/:ruc/postulaciones", async (c) => {
  const ruc = c.req.param("ruc");
  const parsed = Postulaciones.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await fichaMemo.obtener(`postulaciones:${ruc}:${JSON.stringify(q)}`, async () => {
    if (!(await existe(ruc))) return null;
    const vals: unknown[] = [ruc];
    const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds: string[] = [];
    if (q.resultado === "gano") conds.push(`g.gano`);
    else if (q.resultado === "perdio") conds.push(`NOT g.gano AND g.hay_ganador`);
    else if (q.resultado === "sin") conds.push(`NOT g.hay_ganador`);
    if (q.anio) conds.push(`extract(year FROM COALESCE(g.fecha, g.convocatoria)) = ${p(q.anio)}`);
    if (q.objeto) conds.push(`g.objeto = ${p(q.objeto)}`);
    if (q.entidad) conds.push(`g.entidad_ruc = ${p(q.entidad)}`);
    if (q.ganador) conds.push(`${p(q.ganador)} = ANY (g.rucs_ganadores)`);
    for (const w of palabrasBusqueda(q.q)) {
      conds.push(`mef_norm(concat_ws(' ', g.descripcion, g.entidad, g.codigo, g.consorcio)) LIKE ${p(`%${w}%`)}`);
    }
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // Los procesos en que fue postor (sola o en un consorcio) y, de cada uno, quién ganó: con su RUC si es una empresa.
    // Los conteos de cada filtro (años, rubros, entidades y quién le ganó más veces) van sobre todas sus postulaciones.
    const r = await pool.query(
      `WITH p AS (
         SELECT p.codigo_convocatoria AS codigo, min(p.fecha_propuesta) AS fecha, max(p.fecha_convocatoria) AS convocatoria,
                max(CASE WHEN p.ruc_postor <> $1 THEN p.postor END) AS consorcio,
                array_agg(DISTINCT p.ruc_postor) AS postores
           FROM conosce_postores p
          WHERE p.ruc_postor = $1
             OR (p.ruc_postor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1) AND p.ruc_postor !~ '^(10|20)[0-9]{9}$')
          GROUP BY p.codigo_convocatoria
       ), g AS MATERIALIZED (
         SELECT p.*, w.entidad, w.entidad_ruc, w.descripcion, w.objeto, w.ganadores, w.rucs_ganadores, w.monto,
                COALESCE(w.gano, false) AS gano, w.ganadores IS NOT NULL AS hay_ganador
           FROM p
           -- Cada proceso ya juntado (conosce_proceso_resumen, migración 184): su entidad, sus ganadores (con su RUC también si
           -- es una persona, para que publicar() la reconozca y le tape un apellido) y su monto en soles, por su llave.
           LEFT JOIN LATERAL (
             SELECT r.entidad, r.entidad_ruc, r.descripcion, r.objeto, r.ganadores,
                    ARRAY(SELECT x FROM unnest(r.rucs) x WHERE x ~ '^20[0-9]{9}$' AND x <> ALL (p.postores::text[])) AS rucs_ganadores,
                    r.monto, r.rucs && p.postores::text[] AS gano
               FROM conosce_proceso_resumen r WHERE r.codigo = p.codigo::text) w ON true
       ), fac AS (
         SELECT jsonb_build_object(
           'resultado', jsonb_build_object('gano', (SELECT count(*) FROM g WHERE gano), 'perdio', (SELECT count(*) FROM g WHERE NOT gano AND hay_ganador),
                                           'sin', (SELECT count(*) FROM g WHERE NOT hay_ganador)),
           'anios', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', y, 'n', n) ORDER BY y DESC)
                                FROM (SELECT extract(year FROM COALESCE(fecha, convocatoria))::int AS y, count(*) AS n FROM g
                                       WHERE COALESCE(fecha, convocatoria) IS NOT NULL GROUP BY 1) t), '[]'),
           'objetos', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', objeto, 'n', n) ORDER BY n DESC)
                                  FROM (SELECT objeto, count(*) AS n FROM g WHERE objeto IS NOT NULL GROUP BY 1) t), '[]'),
           'entidades', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', entidad_ruc, 'etiqueta', entidad, 'n', n) ORDER BY n DESC, entidad)
                                    FROM (SELECT entidad_ruc, max(entidad) AS entidad, count(*) AS n FROM g WHERE entidad_ruc IS NOT NULL
                                           GROUP BY 1 ORDER BY 3 DESC LIMIT 300) t), '[]'),
           -- Quién le ganó más veces (sólo empresas con RUC): sus competidores.
           'ganadores', COALESCE((SELECT jsonb_agg(jsonb_build_object('valor', t.ruc, 'etiqueta', COALESCE(e.nombre, t.ruc), 'n', t.n) ORDER BY t.n DESC)
                                    FROM (SELECT r AS ruc, count(*) AS n FROM g, unnest(g.rucs_ganadores) r WHERE NOT g.gano
                                           GROUP BY 1 ORDER BY 2 DESC LIMIT 50) t
                                    LEFT JOIN empresa_resumen e ON e.ruc = t.ruc), '[]')
         ) AS facetas
       ), f AS (
         SELECT g.*, count(*) OVER ()::int AS total, count(*) FILTER (WHERE g.gano) OVER ()::int AS ganadas_f
           FROM g ${donde}
          ORDER BY ${ORDEN_POSTULACIONES[q.orden]}
          LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}
       )
       SELECT fac.facetas, f.codigo, to_char(COALESCE(f.fecha, f.convocatoria), 'YYYY-MM-DD') AS fecha, f.entidad, f.entidad_ruc AS "entidadRuc",
              f.descripcion, f.objeto, f.consorcio, f.gano, f.ganadores, f.monto::float AS monto, f.total, f.ganadas_f
         FROM fac LEFT JOIN f ON true
        ORDER BY ${ORDEN_POSTULACIONES[q.orden].replace(/g\./g, "f.")}`, vals);
    const filas = r.rows.filter((x) => x.codigo != null);
    const facetas = r.rows[0]?.facetas ?? null;
    return publicar({
      total: filas[0]?.total ?? 0,
      ganadas: facetas?.resultado?.gano ?? 0,
      page: q.page, size: q.size, facetas,
      data: filas.map(({ total: _t, ganadas_f: _g, facetas: _f, ganadores, ...f }) => ({
        ...f,
        // Un ganador sin nada (el proceso no tiene adjudicación cargada) no se lista.
        ganadores: ((ganadores as { ruc: string | null; nombre: string | null }[] | null) ?? []).filter((x) => x.nombre || x.ruc),
      })),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/antecedentes ────────────────────────────────────────────────────────────
empresasRouter.get("/:ruc/antecedentes", async (c) => {
  const ruc = c.req.param("ruc");
  const cuerpo = await fichaMemo.obtener(`antecedentes:${ruc}`, async () => {
    if (!(await existe(ruc))) return null;
    // Cada cruce con su fuente; si es de un proceso, el código y la entidad para abrir su ficha (allí está la evidencia).
    const r = await pool.query(
      `SELECT p.tipo, p.ruc_empresa, p.ocid, p.severidad, p.fecha, p.monto, p.persona_nombre, p.persona_rol, p.detalle, p.fuente, p.fuente_url,
              cv.codigo, cv.entidad
         FROM cruces_proveedor p
         LEFT JOIN LATERAL (SELECT c.codigo, e.nombre AS entidad FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
                             WHERE p.ocid IS NOT NULL AND c.ocid = p.ocid LIMIT 1) cv ON true
        WHERE p.ruc_empresa = $1
        ORDER BY CASE p.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, p.tipo, p.fecha DESC NULLS LAST
        LIMIT 2000`, [ruc]);
    return publicar({
      total: r.rows.length,
      data: r.rows.map((x) => ({ ...aCruce(x), codigo: x.codigo ?? null, entidad: x.entidad ?? null })),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/socios ──────────────────────────────────────────────────────────────────
const ROL: Record<string, string> = {
  SOCIO_ACCIONISTA_TITULAR: "socio",
  REPRESENTANTE_LEGAL: "representante legal",
  ORGANO_ADMINISTRACION: "directivo",
};

empresasRouter.get("/:ruc/socios", async (c) => {
  const ruc = c.req.param("ruc");
  const cuerpo = await fichaMemo.obtener(`socios:${ruc}`, async () => {
    if (!(await existe(ruc))) return null;
    const [socios, vinculadas, sociaDe, declarada] = await Promise.all([
      // Cada persona una vez, con todos sus papeles. Una empresa socia sale con su RUC (las empresas son públicas).
      pool.query(
        `SELECT max(r.nombre) AS nombre, array_agg(DISTINCT r.tipo_rol) AS roles, to_char(min(r.fecha_inicio_vigencia), 'YYYY-MM-DD') AS desde,
                bool_or(r.tipo_documento = 'REG. UNICO DE CONTRIBUYENTES') AS es_empresa,
                CASE WHEN bool_or(r.tipo_documento = 'REG. UNICO DE CONTRIBUYENTES') AND max(r.numero_documento) ~ '^20[0-9]{9}$'
                     THEN max(r.numero_documento) END AS ruc,
                max(r.forma_societaria) AS forma, to_char(max(r.fecha_corte), 'YYYY-MM-DD') AS corte,
                (SELECT count(DISTINCT r2.ruc_empresa)::int FROM rnp_conformacion_juridica r2
                  WHERE r2.numero_documento = r.numero_documento AND r2.ruc_empresa <> $1 AND r2.ruc_empresa LIKE '20%') AS "otrasEmpresas",
                -- Lo que la persona es en el Estado, por su DNI (que no sale de aquí; plan 2026-10-27, fase 2): locador (y
                -- en cuántas de esas entidades le vende esta empresa), autoridad, candidaturas y aportes.
                CASE WHEN r.numero_documento ~ '^[0-9]{8}$' THEN (
                  SELECT jsonb_build_object('entidades', count(*), 'monto', COALESCE(sum(pe.monto), 0)::float, 'codigo', min(pe.codigo),
                                            'clientes', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM empresa_orden_anual eo WHERE eo.ruc = $1 AND eo.entidad_ruc = pe.entidad_ruc)
                                                                         OR EXISTS (SELECT 1 FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1 AND a.entidad_ruc::text = pe.entidad_ruc)))
                    FROM persona_entidad pe
                   WHERE pe.ruc BETWEEN '10' || r.numero_documento || '0' AND '10' || r.numero_documento || '9'
                  HAVING count(*) > 0) END AS locador,
                CASE WHEN r.numero_documento ~ '^[0-9]{8}$' THEN (
                  SELECT jsonb_build_object('cargo', a.cargo, 'vigente', a.vigente, 'desde', to_char(a.periodo_inicio, 'YYYY'), 'hasta', to_char(a.periodo_fin, 'YYYY'))
                    FROM jne_autoridades a WHERE a.dni = r.numero_documento
                   ORDER BY a.vigente DESC NULLS LAST, a.periodo_inicio DESC NULLS LAST LIMIT 1) END AS autoridad,
                CASE WHEN r.numero_documento ~ '^[0-9]{8}$' THEN
                  (SELECT count(*)::int FROM jne_candidaturas j WHERE j.numero_documento = r.numero_documento) END AS candidaturas,
                CASE WHEN r.numero_documento ~ '^[0-9]{8}$' THEN (
                  SELECT jsonb_build_object('n', count(*), 'monto', COALESCE(sum(o.monto), 0)::float)
                    FROM onpe_aportantes o WHERE o.numero_documento = r.numero_documento HAVING count(*) > 0) END AS aportes
           FROM rnp_conformacion_juridica r WHERE r.ruc_empresa = $1 AND r.numero_documento IS NOT NULL
          GROUP BY r.numero_documento
          ORDER BY bool_or(r.tipo_rol = 'REPRESENTANTE_LEGAL') DESC, bool_or(r.tipo_rol = 'SOCIO_ACCIONISTA_TITULAR') DESC, max(r.nombre)`, [ruc]),
      // Otras empresas con alguien en común, y quiénes: cada persona una vez, con sus papeles aquí y allá.
      pool.query(
        `WITH par AS (
           SELECT r2.ruc_empresa::text AS ruc, r1.numero_documento AS doc, max(r1.nombre) AS nombre,
                  array_agg(DISTINCT r1.tipo_rol) AS aqui, array_agg(DISTINCT r2.tipo_rol) AS alla
             FROM rnp_conformacion_juridica r1
             JOIN rnp_conformacion_juridica r2 ON r2.numero_documento = r1.numero_documento AND r2.ruc_empresa <> r1.ruc_empresa
            WHERE r1.ruc_empresa = $1 AND r2.ruc_empresa LIKE '20%'
            GROUP BY 1, 2)
         SELECT par.ruc, e.nombre, cardinality(e.tipos) AS antecedentes, e.n_alta AS graves, e.inhabilitada, (e.adj_monto + e.ord_monto)::float AS monto,
                e.ruc IS NOT NULL AS vende,
                (e.adj_procesos + e.cons_procesos) AS contratos,
                jsonb_agg(jsonb_build_object('nombre', par.nombre, 'aqui', par.aqui, 'alla', par.alla) ORDER BY par.nombre) AS socios
           FROM par LEFT JOIN empresa_resumen e ON e.ruc = par.ruc
          GROUP BY par.ruc, e.ruc, e.nombre, e.tipos, e.n_alta, e.inhabilitada, e.adj_monto, e.ord_monto, e.adj_procesos, e.cons_procesos
          ORDER BY COALESCE(e.adj_monto + e.ord_monto, 0) DESC, par.ruc
          LIMIT 500`, [ruc]),
      // Las empresas de las que esta es socia.
      pool.query(
        `SELECT r.ruc_empresa::text AS ruc, e.nombre, array_agg(DISTINCT r.tipo_rol) AS roles
           FROM rnp_conformacion_juridica r LEFT JOIN empresa_resumen e ON e.ruc = r.ruc_empresa::text
          WHERE r.numero_documento = $1 GROUP BY r.ruc_empresa, e.nombre ORDER BY e.nombre`, [ruc]),
      // Lo que funcionarios declararon en su DJI sobre la empresa (vista de las secciones 1 a 4, migración 184): su cargo,
      // su entidad, su primer apellido y si la empresa le vende a esa entidad. Nunca el nombre completo.
      pool.query(
        `SELECT d.entidad_ruc AS "entidadRuc", d.entidad, d.seccion, d.apellido, d.cargo, to_char(d.desde, 'YYYY-MM-DD') AS desde,
                to_char(d.hasta, 'YYYY-MM-DD') AS hasta, d.ejercicio,
                (EXISTS (SELECT 1 FROM empresa_orden_anual eo WHERE eo.ruc = $1 AND eo.entidad_ruc = d.entidad_ruc)
                 OR EXISTS (SELECT 1 FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1 AND a.entidad_ruc::text = d.entidad_ruc)) AS "leVende"
           FROM empresa_dji_declarada d WHERE d.ruc = $1
          ORDER BY 9 DESC, d.seccion, d.entidad LIMIT 100`, [ruc]).catch(() => ({ rows: [] })),
    ]);
    const roles = (rs: string[] | null) => (rs ?? []).map((x) => ROL[x] ?? x.toLowerCase().replace(/_/g, " "));
    return publicar({
      // Las personas bajo `socios` (publicar() les tapa un apellido, en orden SUNAT); las empresas socias, aparte y completas.
      socios: socios.rows.filter((s) => !s.es_empresa).map((s) => ({
        nombre: s.nombre, roles: roles(s.roles), desde: s.desde, otrasEmpresas: s.otrasEmpresas,
        enElEstado: s.locador || s.autoridad || s.candidaturas || s.aportes
          ? { locador: s.locador ?? null, autoridad: s.autoridad ?? null, candidaturas: s.candidaturas ?? 0, aportes: s.aportes ?? null }
          : null,
      })),
      declaradaDji: declarada.rows,
      empresasSocias: socios.rows.filter((s) => s.es_empresa).map((s) => ({ ruc: s.ruc, nombre: s.nombre, roles: roles(s.roles), desde: s.desde })),
      sociaDe: sociaDe.rows.map((s) => ({ ...s, roles: roles(s.roles) })),
      corte: socios.rows[0]?.corte ?? null,
      vinculadas: vinculadas.rows.map((v) => ({
        ruc: v.ruc, nombre: v.nombre ?? null, vende: v.vende === true, antecedentes: v.antecedentes ?? 0, graves: v.graves ?? 0, inhabilitada: v.inhabilitada ?? null,
        monto: v.monto ?? 0, contratos: v.contratos ?? 0,
        socios: (v.socios as { nombre: string; aqui: string[]; alla: string[] }[]).map((s) => ({ nombre: s.nombre, roles: roles(s.aqui), rolesAlla: roles(s.alla) })),
      })),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empresas/:ruc/visitas ─────────────────────────────────────────────────────────────────
const VIA: Record<string, string> = {
  socio: "socio", representante: "representante legal", directivo: "directivo", nombre: "dijo venir de la empresa",
};

/** Lo primero que una entidad le dio a la empresa después de una visita: cuál orden o cuál contrato (para citarlo). */
type PrimeroDespues = { numero: string | null; descripcion: string | null; monto: number | null; tipoOrden: string | null; codigo: string | null; ocid: string | null };

empresasRouter.get("/:ruc/visitas", async (c) => {
  const ruc = c.req.param("ruc");
  const cuerpo = await fichaMemo.obtener(`visitas:${ruc}`, async () => {
    if (!(await existe(ruc))) return null;
    // De cada visita, lo primero que la entidad visitada le dio desde ese día: CUÁL orden (número, qué, cuánto) o CUÁL
    // contrato (sola o en consorcio, con su ficha si está en la base); cuánto le dio en los 90 días siguientes y si ya le
    // vendía antes. El usuario: «le dio una orden ese mismo día… pero no dice cuál». La entidad visitada se reconoce
    // también por todos sus nombres (visita_entidad_ruc, migraciones 186 y 197), no sólo si ya era cliente.
    const r = await pool.query(
      // Cada paso por índice y una vez por entidad y día de visita (un proveedor grande tiene miles de visitas, muchas el
      // mismo día): la fecha primero (min por el índice de la 201, o por proveedor y entidad) y después la orden o el proceso
      // de ESE día; la empresa y sus consorcios como un arreglo (con «= $1 OR IN (…)» la base recorría todas las
      // adjudicaciones en cada visita: 15 s con 90 visitas).
      `WITH prov AS (SELECT array_agg(DISTINCT c) AS codigos
                       FROM (SELECT $1::text AS c UNION SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1) z),
            vis AS (
              SELECT v.id, v.fecha_visita, v.entidad_visitada, ev.via, v.visitante, v.funcionario_cargo, v.funcionario_area, v.motivo,
                     v.lugar_especifico, v.entidad_visitante, v.fuente,
                     COALESCE(ev.entidad_ruc, (SELECT min(m.ruc) FROM visita_entidad_ruc m WHERE m.entidad_visitada = v.entidad_visitada)) AS ent
                FROM empresa_visita ev JOIN visitas_entidades v ON v.id = ev.visita_id
               WHERE ev.ruc = $1
               ORDER BY v.fecha_visita DESC NULLS LAST, v.id DESC
               LIMIT 3000),
            d AS (SELECT DISTINCT ent, fecha_visita FROM vis WHERE ent IS NOT NULL AND fecha_visita IS NOT NULL),
            r AS (
              SELECT d.ent, d.fecha_visita,
                     o1.f AS of, od.numero AS onum, od.tipo AS otipo, od.descripcion AS odesc, od.monto AS omonto,
                     a1.f AS af, ad.numero AS anum, ad.codigo AS acod, ad.descripcion AS adesc, ad.monto AS amonto, ad.consorcio AS acons,
                     w.ordenes AS o90, w.monto AS m90, wa.contratos AS c90,
                     (EXISTS (SELECT 1 FROM conosce_ordenes o WHERE o.entidad_ruc = d.ent AND o.ruc_contratista = $1
                                AND o.fecha_emision < d.fecha_visita AND o.estado IS DISTINCT FROM 'Anulada')
                      OR EXISTS (SELECT 1 FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = ANY(p.codigos) AND a.entidad_ruc = d.ent
                                   AND a.fecha_buenapro < d.fecha_visita)) AS antes
                FROM d
                CROSS JOIN prov p
                LEFT JOIN LATERAL (
                  SELECT min(o.fecha_emision) AS f FROM conosce_ordenes o
                   WHERE o.entidad_ruc = d.ent AND o.ruc_contratista = $1 AND o.fecha_emision >= d.fecha_visita
                     AND o.estado IS DISTINCT FROM 'Anulada') o1 ON true
                LEFT JOIN LATERAL (
                  SELECT o.nro_orden AS numero, o.tipo_orden AS tipo, left(btrim(o.descripcion), 220) AS descripcion, o.monto::float AS monto
                    FROM conosce_ordenes o
                   WHERE o1.f IS NOT NULL AND o.entidad_ruc = d.ent AND o.ruc_contratista = $1 AND o.fecha_emision = o1.f
                     AND o.estado IS DISTINCT FROM 'Anulada'
                   ORDER BY o.monto DESC NULLS LAST
                   LIMIT 1) od ON true
                LEFT JOIN LATERAL (
                  SELECT min(a.fecha_buenapro) AS f FROM conosce_adjudicaciones a
                   WHERE a.ruc_proveedor = ANY(p.codigos) AND a.entidad_ruc = d.ent AND a.fecha_buenapro >= d.fecha_visita) a1 ON true
                LEFT JOIN LATERAL (
                  SELECT a.codigo_convocatoria AS codigo, min(COALESCE(a.nomenclatura, a.codigo_convocatoria)) AS numero,
                         left(min(COALESCE(NULLIF(btrim(a.descripcion_proceso), ''), NULLIF(btrim(a.descripcion_item), ''), a.objeto)), 220) AS descripcion,
                         sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles'))::float AS monto,
                         bool_or(a.ruc_proveedor <> $1) AS consorcio
                    FROM conosce_adjudicaciones a
                   WHERE a1.f IS NOT NULL AND a.ruc_proveedor = ANY(p.codigos) AND a.entidad_ruc = d.ent AND a.fecha_buenapro = a1.f
                   GROUP BY a.codigo_convocatoria
                   ORDER BY sum(a.monto_adjudicado) DESC NULLS LAST
                   LIMIT 1) ad ON true
                LEFT JOIN LATERAL (
                  SELECT count(*)::int AS ordenes, sum(o.monto) FILTER (WHERE o.monto_dudoso IS NULL)::float AS monto
                    FROM conosce_ordenes o
                   WHERE o1.f IS NOT NULL AND o1.f < d.fecha_visita + 90 AND o.entidad_ruc = d.ent AND o.ruc_contratista = $1
                     AND o.fecha_emision >= d.fecha_visita AND o.fecha_emision < d.fecha_visita + 90
                     AND o.estado IS DISTINCT FROM 'Anulada') w ON true
                LEFT JOIN LATERAL (
                  SELECT count(DISTINCT a.codigo_convocatoria)::int AS contratos
                    FROM conosce_adjudicaciones a
                   WHERE a1.f IS NOT NULL AND a1.f < d.fecha_visita + 90 AND a.ruc_proveedor = ANY(p.codigos) AND a.entidad_ruc = d.ent
                     AND a.fecha_buenapro >= d.fecha_visita AND a.fecha_buenapro < d.fecha_visita + 90) wa ON true)
       SELECT to_char(x.fecha_visita, 'YYYY-MM-DD') AS fecha, x.entidad_visitada AS entidad, x.ent AS "entidadRuc", x.via,
              x.visitante, x.funcionario_cargo AS "cargoFuncionario", x.funcionario_area AS area,
              x.motivo, x.lugar_especifico AS lugar, x.entidad_visitante AS "entidadDeclarada", x.fuente,
              to_char(r.of, 'YYYY-MM-DD') AS "ordenFecha", r.onum AS "ordenNumero", r.otipo AS "ordenTipo",
              r.odesc AS "ordenDescripcion", r.omonto AS "ordenMonto",
              to_char(r.af, 'YYYY-MM-DD') AS "contratoFecha", r.anum AS "contratoNumero", r.acod AS "contratoCodigo",
              r.adesc AS "contratoDescripcion", r.amonto AS "contratoMonto", r.acons AS "contratoConsorcio",
              CASE WHEN r.acod IS NOT NULL THEN
                (SELECT cv.ocid FROM convocatorias cv
                  WHERE cv.codigo = r.acod AND cv.entidad_ruc::text = x.ent AND cv.ocid NOT LIKE 'ocds-vigia-%'
                  ORDER BY cv.ocid LIMIT 1) END AS "contratoOcid",
              r.o90 AS "ordenes90", r.m90 AS "monto90", r.c90 AS "contratos90", COALESCE(r.antes, false) AS antes
         FROM vis x
         LEFT JOIN r ON r.ent = x.ent AND r.fecha_visita = x.fecha_visita
        ORDER BY x.fecha_visita DESC NULLS LAST, x.id DESC`, [ruc]);
    const dias = (desde: string | null, hasta: string | null) =>
      desde && hasta ? Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) : null;
    return publicar({
      total: r.rows.length,
      // Hasta qué día llega el registro de visitas (la PNDA no publicó después de mayo de 2026).
      hasta: await visitasHasta(),
      // Bajo `visitas`: publicar() le tapa un apellido al visitante. De quien recibió, sólo su cargo y su área (nunca su nombre).
      visitas: r.rows.map((v) => {
        // Lo primero: el contrato si llegó antes o el mismo día que la orden; si no, la orden.
        const esContrato = !!v.contratoFecha && (!v.ordenFecha || v.contratoFecha <= v.ordenFecha);
        const despues: string | null = esContrato ? v.contratoFecha : v.ordenFecha ?? null;
        const primero: PrimeroDespues | null = !despues ? null : esContrato
          ? { numero: v.contratoNumero, descripcion: v.contratoDescripcion, monto: v.contratoMonto, tipoOrden: null, codigo: v.contratoCodigo, ocid: v.contratoOcid }
          : { numero: v.ordenNumero, descripcion: v.ordenDescripcion, monto: v.ordenMonto, tipoOrden: v.ordenTipo, codigo: null, ocid: null };
        return {
          fecha: v.fecha, entidad: v.entidad, entidadRuc: v.entidadRuc, via: VIA[v.via] ?? v.via, visitante: v.visitante,
          cargoFuncionario: v.cargoFuncionario, area: v.area, motivo: v.motivo, lugar: v.lugar, entidadDeclarada: v.entidadDeclarada,
          fuente: v.fuente,
          despues,
          diasDespues: dias(v.fecha, despues),
          despuesTipo: !despues ? null : esContrato ? (v.contratoConsorcio ? "consorcio" : "contrato") : "orden",
          primero,
          // En los 90 días desde la visita (con la del mismo día): cuántas órdenes y contratos, y lo que suman las órdenes.
          en90: despues ? { ordenes: v.ordenes90 ?? 0, contratos: v.contratos90 ?? 0, montoOrdenes: v.monto90 } : null,
          // Si esa entidad ya le había vendido antes de la visita (para no leer «ese mismo día» como algo raro en un proveedor
          // de siempre).
          antes: !!v.antes,
        };
      }),
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
