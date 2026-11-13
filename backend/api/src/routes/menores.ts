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

/**
 * Antecedentes del proveedor, sobre la fila `x` de la consulta (abajo): lo que dice la SUNAT (el estado y la condición de
 * HOY, y si firmó a menos de 180 días de iniciar actividades: las mismas reglas que las banderas de la fila en la web) y
 * si el Tribunal de Contrataciones lo tenía inhabilitado el día en que firmó (la regla de «inhabilitado», migración 91).
 * «con» es cualquiera de ellos, incluido un estado que no es «activo» ni de baja ni en suspensión.
 */
export const ANTECEDENTE_MENOR = {
  con: `(x.sp_estado <> 'ACTIVO' OR x.sp_condicion LIKE 'NO HABIDO%' OR x.sp_condicion LIKE 'NO HALLADO%' OR x.dias BETWEEN 0 AND 179 OR x.inhabilitado)`,
  baja: `x.sp_estado LIKE 'BAJA%'`,
  suspendida: `x.sp_estado LIKE 'SUSPENSION%'`,
  no_habido: `x.sp_condicion LIKE 'NO HABIDO%'`,
  no_hallado: `x.sp_condicion LIKE 'NO HALLADO%'`,
  reciente: `x.dias BETWEEN 0 AND 179`,
  inhabilitado: `x.inhabilitado`,
} as const;

/**
 * El monto en tramos (soles; las 5 en dólares no entran en ninguno). El tope es el de 8 UIT del año de la firma
 * (uit_soles, migración 51: S/ 42 800 en 2025, S/ 44 000 en 2026): «cerca del tope» es el 90 % o más, sin pasarlo.
 */
export const MONTO_MENOR = {
  hasta_5k: `x.moneda = 'PEN' AND x.monto <= 5000`,
  "5k_20k": `x.moneda = 'PEN' AND x.monto > 5000 AND x.monto <= 20000`,
  mas_20k: `x.moneda = 'PEN' AND x.monto > 20000`,
  cerca_tope: `x.moneda = 'PEN' AND x.monto >= 0.9 * x.tope AND x.monto <= x.tope`,
  sobre_tope: `x.moneda = 'PEN' AND x.monto > x.tope`,
} as const;

export const OBJETO_MENOR = { bien: "BIEN", servicio: "SERVICIO", consultoria: "CONSULTORIA", obra: "OBRA" } as const;

/** Los tipos de señal que salen de lo que Claude leyó en el requerimiento o el contrato (dos lecturas que coinciden). */
const SENALES_DOCUMENTO = ["tdr_proveedor_nombrado", "tdr_marca_sin_equivalente", "tdr_monto_distinto", "tdr_experiencia_alta",
                           "contrato_monto_distinto", "contrato_ruc_distinto", "contrato_documento_ajeno"];
const conTipo = (...t: string[]) => `x.senal_tipos && ARRAY[${t.map((x) => `'${x}'`).join(", ")}]::text[]`;

/** Las señales de cada contrato menor (menor_senal, migración 252), como filtro: alguna, las graves o por familia. */
export const SENAL_MENOR = {
  con: `x.senal_tipos IS NOT NULL`,
  alta: `x.senal_alta`,
  partido_dia: conTipo("menor_partido_mismo_dia"),
  partido_anio: conTipo("menor_partido_en_el_anio"),
  tope: conTipo("menor_sobre_tope", "menor_borde_tope"),
  ventana: conTipo("menor_ventana_corta"),
  orden_antes: conTipo("menor_orden_antes_de_cotizar"),
  cerrada: conTipo("menor_invitacion_cerrada"),
  precio: conTipo("menor_precio_alto"),
  documento: conTipo(...SENALES_DOCUMENTO),
  fin_semana: conTipo("menor_fin_de_semana"),
} as const;

const enumDe = <T extends Record<string, unknown>>(o: T) => z.enum(Object.keys(o) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]]);

export const ListaMenoresQuery = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2024).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  proveedor: z.string().regex(/^\d{11}$/).optional(),
  region: z.string().trim().min(2).max(40).optional(), // departamento de la entidad (nombre); se compara normalizado
  objeto: enumDe(OBJETO_MENOR).optional(),
  estado: z.string().trim().min(3).max(30).optional(),
  conReq: z.enum(["si"]).optional(), // solo las que tienen el requerimiento (TDR) para descargar
  antecedente: enumDe(ANTECEDENTE_MENOR).optional(),
  senal: enumDe(SENAL_MENOR).optional(),
  persona: z.enum(["natural", "empresa"]).optional(), // quién ganó: una persona natural (RUC 10) o una empresa (RUC 20)
  monto: enumDe(MONTO_MENOR).optional(),
  orden: z.enum(["reciente", "antiguo"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
export type FiltrosListaMenores = z.infer<typeof ListaMenoresQuery>;

/** Los filtros que llevan conteo por opción (cada uno contado con los DEMÁS filtros, no con el suyo). */
type Faceta = "antecedente" | "senal" | "persona" | "objeto" | "monto" | "conReq" | "anio" | "region";

/**
 * Las filas de la tabla, una por contrato menor, con lo que filtra la lista ya calculado: el estado SUNAT del proveedor,
 * los días entre su inicio de actividades y la firma, si estaba inhabilitado al firmar, el tope de 8 UIT del año y la
 * región de la entidad (seace_menores no la trae: la de la entidad, la misma lista de regiones que /entidades/regiones).
 * Son ~10 mil filas. Las inhabilitaciones se cruzan una sola vez (un IN sin correlación: Postgres arma su tabla hash y
 * cada fila sólo la consulta); una búsqueda por fila en osce_sancionados eran 400 ms para contar las 10 mil. El texto de
 * la búsqueda y la región, en mayúsculas y sin tildes: las palabras de `palabrasBusqueda` son sólo letras y cifras y las
 * regiones, palabras, así que da lo mismo que `mef_norm` y cuesta un décimo (su par de regexp por fila hacía 1,2 s los
 * conteos con texto).
 */
const FILAS = `SELECT m.*, ms.tipos AS senal_tipos, COALESCE(ms.alta, false) AS senal_alta, sp.actividad_ciiu, sp.estado AS sp_estado_sunat, sp.condicion AS sp_condicion_sunat,
         sp.fecha_inicio_actividades, sp.tipo_contribuyente,
         upper(btrim(sp.estado)) AS sp_estado, upper(btrim(sp.condicion)) AS sp_condicion,
         (m.fecha_suscripcion - sp.fecha_inicio_actividades) AS dias,
         8 * uit_soles(COALESCE(m.anio::int, extract(year FROM m.fecha_suscripcion)::int)) AS tope,
         upper(immutable_unaccent(e.region)) AS entidad_region,
         upper(immutable_unaccent(COALESCE(m.descripcion, '') || ' ' || COALESCE(m.entidad, '') || ' ' || COALESCE(m.proveedor, '')
                                  || ' ' || COALESCE(m.codigo, ''))) AS texto,
         -- La regla de «inhabilitado» de las personas (migración 91): firmó dentro de una inhabilitación temporal o definitiva.
         (m.id_contrato IN (SELECT m2.id_contrato FROM seace_menores m2 JOIN osce_sancionados s ON s.ruc = m2.proveedor_ruc
                              AND m2.fecha_suscripcion BETWEEN s.fecha_desde AND COALESCE(s.fecha_hasta, CASE WHEN s.tipo = 'definitivo' THEN DATE '9999-12-31' END)
                             WHERE s.tipo IN ('temporal', 'definitivo') AND s.fecha_desde IS NOT NULL)) AS inhabilitado
    FROM seace_menores m
    LEFT JOIN seace_proveedor_sunat sp ON sp.ruc = m.proveedor_ruc
    LEFT JOIN entidades e ON e.ruc = m.entidad_ruc::bpchar
    -- Las señales de cada contrato (menor_senal, migración 252): sus tipos y si alguna es de severidad alta.
    LEFT JOIN (SELECT id_contrato, array_agg(tipo ORDER BY tipo) AS tipos, bool_or(severidad = 'alta') AS alta
                 FROM menor_senal GROUP BY id_contrato) ms ON ms.id_contrato = m.id_contrato`;

/**
 * Las condiciones de la consulta: `ancla` (entidad o proveedor, por su índice) va dentro de las filas; el resto, cada una
 * con su faceta, sobre ellas. Los valores de las listas cerradas (zod) van como literales; el texto y la región, como
 * parámetros.
 */
export function condicionesMenores(q: FiltrosListaMenores, vals: unknown[]): { ancla: string[]; filtros: { faceta: Faceta | null; sql: string }[] } {
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const ancla = ["m.monto > 0"];
  // entidad/proveedor son 11 dígitos (validados por zod) → literal, para que el planner use su índice.
  if (q.entidad) ancla.push(`m.entidad_ruc = '${q.entidad}'`);
  if (q.proveedor) ancla.push(`m.proveedor_ruc = '${q.proveedor}'`);
  const filtros: { faceta: Faceta | null; sql: string }[] = [];
  if (q.anio) filtros.push({ faceta: "anio", sql: `x.anio = ${Number(q.anio)}` });
  if (q.region) filtros.push({ faceta: "region", sql: `x.entidad_region = upper(immutable_unaccent(${p(q.region)}))` });
  if (q.objeto) filtros.push({ faceta: "objeto", sql: `x.objeto = '${OBJETO_MENOR[q.objeto]}'` });
  if (q.estado) filtros.push({ faceta: null, sql: `x.estado = ${p(q.estado)}` });
  // El requerimiento que se puede abrir (espejado en R2): el mismo que enlaza el panel. Antes el filtro miraba
  // id_requerimiento y dejaba pasar ~1 000 contratos sin PDF.
  if (q.conReq) filtros.push({ faceta: "conReq", sql: `x.req_r2` });
  if (q.antecedente) filtros.push({ faceta: "antecedente", sql: ANTECEDENTE_MENOR[q.antecedente] });
  if (q.senal) filtros.push({ faceta: "senal", sql: SENAL_MENOR[q.senal] });
  if (q.persona) filtros.push({ faceta: "persona", sql: `x.proveedor_ruc LIKE '${q.persona === "natural" ? "10" : "20"}%'` });
  if (q.monto) filtros.push({ faceta: "monto", sql: MONTO_MENOR[q.monto] });
  for (const w of palabrasBusqueda(q.q)) filtros.push({ faceta: null, sql: `x.texto LIKE ${p(`%${w}%`)}` });
  return { ancla, filtros };
}

/** Las columnas de una fila de la lista, sobre `x` (las FILAS de arriba). */
const COLS_MENOR = `x.id_contrato AS id, x.codigo, x.numero_contrato AS numero, x.objeto, x.descripcion,
                  x.entidad, x.entidad_ruc AS "entidadRuc", x.proveedor, x.proveedor_ruc AS "proveedorRuc",
                  x.monto::float AS monto, x.moneda, x.estado, to_char(x.fecha_suscripcion,'YYYY-MM-DD') AS fecha, x.anio,
                  (x.id_documento_contrato IS NOT NULL) AS "tieneContrato",
                  x.req_r2 AS "tieneRequerimiento", x.requerimiento_nombre AS "requerimientoNombre",
                  x.estado_prod6 AS "estadoProceso", to_char(x.fec_publica,'YYYY-MM-DD') AS "fecPublica",
                  to_char(x.fec_ini_cotizacion,'YYYY-MM-DD') AS "cotizaDesde", to_char(x.fec_fin_cotizacion,'YYYY-MM-DD') AS "cotizaHasta",
                  -- La ventana de cotización con su hora (migración 251) y cuántas horas duró.
                  to_char(x.fec_ini_cotizacion,'YYYY-MM-DD"T"HH24:MI') AS "cotizaInicio", to_char(x.fec_fin_cotizacion,'YYYY-MM-DD"T"HH24:MI') AS "cotizaCierre",
                  round((extract(epoch FROM x.fec_fin_cotizacion - x.fec_ini_cotizacion) / 3600)::numeric, 1)::float AS "cotizaHoras",
                  x.area_usuaria AS "areaUsuaria", x.tipo_invitacion AS "tipoInvitacion",
                  -- Las señales del contrato (menor_senal), de la más grave a la más leve, con lo que cabe en la fila.
                  (SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', s.tipo, 'severidad', s.severidad, 'monto', s.monto,
                                                                'contratos', s.detalle->'contratos', 'horas', s.detalle->'horas',
                                                                'pct', s.detalle->'pct')
                                             ORDER BY CASE s.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, s.tipo), '[]'::jsonb)
                     FROM menor_senal s WHERE s.id_contrato = x.id_contrato) AS senales,
                  EXISTS (SELECT 1 FROM menor_lectura l WHERE l.id_contrato = x.id_contrato AND l.version = 'v1' AND l.estado = 'ok') AS leido,
                  x.actividad_ciiu AS "provActividad", x.sp_estado_sunat AS "provEstado", x.sp_condicion_sunat AS "provCondicion",
                  to_char(x.fecha_inicio_actividades,'YYYY-MM-DD') AS "provDesde", x.tipo_contribuyente AS "provTipo",
                  CASE WHEN x.fecha_inicio_actividades IS NOT NULL THEN x.dias END AS "provDiasAlGanar",
                  -- El tope de 8 UIT del año y si el monto lo pasa (en soles): un contrato menor no debería.
                  x.tope::float AS tope, (x.moneda = 'PEN' AND x.monto > x.tope) AS "sobreTope",
                  -- La inhabilitación del Tribunal vigente el día de la firma, con su resolución: la evidencia de la bandera.
                  CASE WHEN x.inhabilitado THEN (
                    SELECT jsonb_build_object('tipo', s.tipo, 'resolucion', s.resolucion, 'desde', to_char(s.fecha_desde, 'YYYY-MM-DD'),
                                              'hasta', to_char(s.fecha_hasta, 'YYYY-MM-DD'))
                      FROM osce_sancionados s WHERE s.ruc = x.proveedor_ruc AND s.tipo IN ('temporal', 'definitivo') AND s.fecha_desde IS NOT NULL
                       AND x.fecha_suscripcion BETWEEN s.fecha_desde AND COALESCE(s.fecha_hasta, CASE WHEN s.tipo = 'definitivo' THEN DATE '9999-12-31' END)
                     ORDER BY s.fecha_desde DESC LIMIT 1) END AS inhabilitacion`;

/** Las filas de unos contratos menores por su id, con las columnas de la lista (routes/compras.ts). */
export async function filasMenores(ids: number[]): Promise<Record<string, unknown>[]> {
  if (!ids.length) return [];
  const r = await consultaConPlazo(`WITH x AS (${FILAS} WHERE m.id_contrato = ANY($1::int[])) SELECT ${COLS_MENOR} FROM x`, [ids]);
  return r.rows as Record<string, unknown>[];
}

/** Las llaves de una página con sus filtros: id, fecha y monto (la rama de los menores de la lista de compras). */
export async function clavesMenores(q: Omit<FiltrosListaMenores, "page" | "size" | "orden">, n: number, dir: "DESC" | "ASC", con?: string)
  : Promise<{ id: number; fecha: string | null; monto: number | null }[]> {
  const vals: unknown[] = [];
  const { ancla, filtros } = condicionesMenores({ ...q, orden: "reciente", page: 1, size: 1 }, vals);
  if (con) ancla.push(q.entidad ? `m.proveedor_ruc = '${con}'` : `m.entidad_ruc = '${con}'`);
  const where = filtros.length ? `WHERE ${filtros.map((f) => f.sql).join(" AND ")}` : "";
  const r = await consultaConPlazo(
    `WITH x AS (${FILAS} WHERE ${ancla.join(" AND ")})
     SELECT x.id_contrato AS id, to_char(x.fecha_suscripcion, 'YYYY-MM-DD') AS fecha, x.monto::float AS monto FROM x ${where}
      ORDER BY x.fecha_suscripcion ${dir}, x.id_contrato ${dir} LIMIT ${n}`, vals);
  return r.rows as { id: number; fecha: string | null; monto: number | null }[];
}

/** Las opciones con conteo de cada faceta (la región se cuenta aparte, agrupada). */
const OPCIONES: Record<Exclude<Faceta, "region">, Record<string, string>> = {
  antecedente: ANTECEDENTE_MENOR,
  senal: SENAL_MENOR,
  persona: { natural: `x.proveedor_ruc LIKE '10%'`, empresa: `x.proveedor_ruc LIKE '20%'` },
  objeto: Object.fromEntries(Object.entries(OBJETO_MENOR).map(([k, v]) => [k, `x.objeto = '${v}'`])),
  monto: MONTO_MENOR,
  conReq: { si: `x.req_r2` },
  anio: {}, // los años se arman con la lista de años (abajo)
};

/**
 * Los conteos de los filtros: cada opción con todos los filtros puestos MENOS el de su propia faceta (como los chips de
 * Contratos), en una pasada: cada condición se evalúa una vez por fila (`y`, materializada, columnas f0…/o0…) y los
 * conteos sólo combinan esos booleanos. Antes, con la búsqueda de texto repetida en cada uno de los 25 conteos, eran
 * 1,9 s; la región se agrupa aparte (jsonb, por su nombre normalizado).
 */
export function sqlFacetasMenores(q: FiltrosListaMenores, anios: number[]): { sql: string; vals: unknown[] } {
  const vals: unknown[] = [];
  const { ancla, filtros } = condicionesMenores(q, vals);
  const opciones = { ...OPCIONES, anio: Object.fromEntries(anios.map((a) => [String(a), `x.anio = ${a}`])) };
  const lista = (Object.entries(opciones) as [Exclude<Faceta, "region">, Record<string, string>][])
    .flatMap(([f, ops]) => Object.entries(ops).map(([k, sql]) => ({ faceta: f, clave: k, sql })));
  const sin = (f: Faceta) => filtros.map((x, i) => (x.faceta !== f ? `y.f${i}` : null)).filter(Boolean) as string[];
  const y = [...filtros.map((x, i) => `(${x.sql}) AS f${i}`), ...lista.map((o, j) => `(${o.sql}) AS o${j}`), "x.entidad_region AS region"];
  const cols = lista.map((o, j) => `count(*) FILTER (WHERE ${[...sin(o.faceta), `y.o${j}`].join(" AND ")})::int AS "${o.faceta}:${o.clave}"`);
  const enRegion = sin("region");
  const region = `(SELECT COALESCE(jsonb_object_agg(r.region, r.n), '{}'::jsonb) FROM (SELECT y.region, count(*)::int AS n FROM y
                    WHERE ${[...enRegion, "y.region IS NOT NULL"].join(" AND ")} GROUP BY 1) r) AS "region"`;
  return {
    sql: `WITH x AS (${FILAS} WHERE ${ancla.join(" AND ")}), y AS MATERIALIZED (SELECT ${y.join(", ")} FROM x)
          SELECT ${[...cols, region].join(",\n ")} FROM y`,
    vals,
  };
}

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));

menoresRouter.get("/", async (c) => {
  const parsed = ListaMenoresQuery.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await memo.obtener(JSON.stringify(q), async () => {
    const vals: unknown[] = [];
    const { ancla, filtros } = condicionesMenores(q, vals);
    const dir = q.orden === "antiguo" ? "ASC" : "DESC";
    const offset = (q.page - 1) * q.size;
    const lim = q.size + 1; // una de más para saber si hay página siguiente
    const where = filtros.length ? `WHERE ${filtros.map((f) => f.sql).join(" AND ")}` : "";
    const sql = `WITH x AS (${FILAS} WHERE ${ancla.join(" AND ")})
                 SELECT ${COLS_MENOR} FROM x ${where}
                 ORDER BY x.fecha_suscripcion ${dir} NULLS LAST, x.id_contrato ${dir} LIMIT ${lim} OFFSET ${offset}`;
    const anios = listaAnios();
    const f = sqlFacetasMenores(q, anios);
    const [r, fa] = await Promise.all([
      consultaConPlazo(sql, vals),
      // Sin conteos, la barra igual filtra (sin números): un error aquí no tumba la lista.
      consultaConPlazo(f.sql, f.vals).catch(() => null),
    ]);
    const hayMas = r.rows.length > q.size;
    // {"antecedente:baja": 12, …, region: {LIMA: 4086}} → { antecedente: { baja: 12 }, region: { LIMA: 4086 } }. La región
    // va en mayúsculas y sin tildes («ANCASH»), como la web normaliza el nombre de cada opción.
    let facetas: Record<string, Record<string, number>> | null = null;
    if (fa?.rows[0]) {
      const { region, ...conteos } = fa.rows[0] as Record<string, number> & { region: Record<string, number> };
      facetas = { region: region ?? {} };
      for (const [k, n] of Object.entries(conteos)) {
        const [faceta, opcion] = k.split(":");
        (facetas[faceta] ??= {})[opcion] = n;
      }
    }
    return publicar({ page: q.page, size: q.size, hayMas, anclado: !!(q.entidad || q.proveedor),
                      ancla: q.proveedor ? "proveedor" : q.entidad ? "entidad" : null,
                      anio: q.anio ?? null, anios, facetas, data: r.rows.slice(0, q.size) });
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

// ─── Resumen y ficha de un contrato menor ────────────────────────────────────

const ResumenQuery = z.object({
  entidad: z.string().regex(/^\d{11}$/).optional(),
  proveedor: z.string().regex(/^\d{11}$/).optional(),
  anio: z.coerce.number().int().min(2024).max(2100).optional(),
});
const memoResumen = new Memo<Record<string, unknown>>({ nombre: "menores:resumen", ttlMs: 3_600_000, staleMs: 3_600_000, max: 200 });

/**
 * Las cifras de la cabecera de la vista (o de la pestaña de una entidad o empresa): cuántos contratos menores, cuánto
 * suman, cuántos tienen sus PDF y cuántos leyó la IA, y cuántos tienen cada señal (con los grupos de los partidos: un
 * grupo es la compra entera que se partió).
 */
menoresRouter.get("/resumen", async (c) => {
  const parsed = ResumenQuery.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await memoResumen.obtener(JSON.stringify(q), async () => {
    const donde = ["m.monto > 0"];
    if (q.entidad) donde.push(`m.entidad_ruc = '${q.entidad}'`);
    if (q.proveedor) donde.push(`m.proveedor_ruc = '${q.proveedor}'`);
    if (q.anio) donde.push(`m.anio = ${Number(q.anio)}`);
    const w = donde.join(" AND ");
    const [t, s] = await Promise.all([
      consultaConPlazo(
        `SELECT count(*)::int AS contratos, COALESCE(sum(m.monto) FILTER (WHERE m.moneda = 'PEN'), 0)::float AS monto,
                count(DISTINCT m.entidad_ruc)::int AS entidades, count(DISTINCT m.proveedor_ruc)::int AS proveedores,
                count(*) FILTER (WHERE m.req_r2)::int AS "conRequerimiento",
                count(*) FILTER (WHERE m.id_documento_contrato IS NOT NULL)::int AS "conContrato",
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM seace_menor_item i WHERE i.id_contrato = m.id_contrato))::int AS "conItems",
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM menor_lectura l WHERE l.id_contrato = m.id_contrato
                                                AND l.version = 'v1' AND l.estado = 'ok'))::int AS leidos,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM menor_senal s WHERE s.id_contrato = m.id_contrato))::int AS "conSenal",
                COALESCE(sum(m.monto) FILTER (WHERE m.moneda = 'PEN' AND EXISTS (SELECT 1 FROM menor_senal s WHERE s.id_contrato = m.id_contrato)), 0)::float AS "montoConSenal",
                min(m.fecha_suscripcion)::text AS desde, max(m.fecha_suscripcion)::text AS hasta
           FROM seace_menores m WHERE ${w}`, []),
      consultaConPlazo(
        `SELECT s.tipo, s.severidad, count(*)::int AS contratos, COALESCE(sum(m.monto), 0)::float AS monto,
                count(DISTINCT s.grupo) FILTER (WHERE s.grupo IS NOT NULL)::int AS grupos
           FROM menor_senal s JOIN seace_menores m ON m.id_contrato = s.id_contrato
          WHERE ${w} GROUP BY 1, 2 ORDER BY 3 DESC`, []),
    ]);
    return { ...(t.rows[0] as Record<string, unknown>), senales: s.rows };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * La ficha de un contrato menor: la fila de la lista con lo de prod6 (área usuaria, invitación, etapas), sus ítems con
 * el precio que pagan las demás entidades por el mismo ítem del catálogo (precio_referencia, 84), lo que Claude leyó en
 * el requerimiento y en el contrato, sus señales con la evidencia (los contratos del grupo), los demás contratos menores
 * de la entidad con ese proveedor (donde un contrato partido se ve solo) y las órdenes de pago que le corresponden.
 */
menoresRouter.get("/:id{[0-9]+}", async (c) => {
  const id = Number(c.req.param("id"));
  const [fila] = await filasMenores([id]);
  if (!fila) return c.json({ error: "no_encontrado" }, 404);
  const entidadRuc = (fila.entidadRuc as string | null) ?? null;
  const proveedorRuc = (fila.proveedorRuc as string | null) ?? null;
  const [extra, items, lecturas, senales, historial, ordenes] = await Promise.all([
    consultaConPlazo(
      `SELECT x.justif_invitacion AS "justifInvitacion", x.ccmn, x.ccmn_nombre AS "ccmnNombre",
              to_char(x.fec_publica, 'YYYY-MM-DD"T"HH24:MI') AS "publicado",
              to_char(x.consultas_desde, 'YYYY-MM-DD"T"HH24:MI') AS "consultasDesde",
              to_char(x.consultas_hasta, 'YYYY-MM-DD"T"HH24:MI') AS "consultasHasta",
              to_char(x.fecha_inicio, 'YYYY-MM-DD') AS "ejecucionDesde", to_char(x.fecha_fin, 'YYYY-MM-DD') AS "ejecucionHasta"
         FROM seace_menores x WHERE x.id_contrato = $1`, [id]),
    consultaConPlazo(
      // El precio por ítem sólo si vale (menor_item_con_precio, migración 252): con varios ítems, prod6 suele repetir en
      // cada uno el total del contrato.
      `SELECT i.n, i.cubso, i.cubso_nombre AS "cubsoNombre", i.descripcion, i.unidad, i.cantidad::float,
              CASE WHEN ok.id_contrato IS NOT NULL THEN i.precio_total::float END AS "precioTotal",
              CASE WHEN ok.id_contrato IS NOT NULL THEN i.precio_unitario::float END AS "precioUnitario",
              i.estado_cotiza AS "estadoCotiza", i.distrito,
              r.mediana::float AS "refMediana", r.p25::float AS "refP25", r.p75::float AS "refP75", r.n AS "refN",
              r.entidades AS "refEntidades", r.anio AS "refAnio"
         FROM seace_menor_item i JOIN seace_menores m ON m.id_contrato = i.id_contrato
         LEFT JOIN menor_item_con_precio ok ON ok.id_contrato = i.id_contrato
         LEFT JOIN LATERAL (SELECT * FROM precio_referencia r
                             WHERE r.cubso = i.cubso AND r.base = 'adjudicado' AND r.anio <= COALESCE(m.anio::int, 2100)
                               AND upper(immutable_unaccent(r.unidad)) = upper(immutable_unaccent(i.unidad))
                             ORDER BY r.anio DESC LIMIT 1) r ON true
        WHERE i.id_contrato = $1 ORDER BY i.n`, [id]),
    consultaConPlazo(
      `SELECT clase, version, salida, paginas, modelo, to_char(leido_at, 'YYYY-MM-DD') AS leido
         FROM menor_lectura WHERE id_contrato = $1 AND estado = 'ok' AND version = 'v1' ORDER BY clase`, [id]),
    consultaConPlazo(
      `SELECT tipo, severidad, monto::float, grupo, detalle FROM menor_senal WHERE id_contrato = $1
        ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, tipo`, [id]),
    entidadRuc && proveedorRuc
      ? consultaConPlazo(
        `SELECT h.id_contrato AS id, h.codigo, h.objeto, left(h.descripcion, 200) AS descripcion, h.monto::float, h.moneda,
                to_char(h.fecha_suscripcion, 'YYYY-MM-DD') AS fecha, h.anio,
                (SELECT array_agg(s.tipo ORDER BY s.tipo) FROM menor_senal s WHERE s.id_contrato = h.id_contrato) AS senales
           FROM seace_menores h WHERE h.entidad_ruc = $1 AND h.proveedor_ruc = $2 AND h.monto > 0
          ORDER BY h.fecha_suscripcion DESC NULLS LAST, h.id_contrato DESC LIMIT 80`, [entidadRuc, proveedorRuc])
      : Promise.resolve({ rows: [] }),
    consultaConPlazo(
      `SELECT v.orden, to_char(v.fecha_emision, 'YYYY-MM-DD') AS fecha, v.regla
         FROM compra_vinculo v WHERE v.clase = 'menor' AND v.ref = $1 ORDER BY v.fecha_emision`, [String(id)]).catch(() => ({ rows: [] })),
  ]);
  const lectura = (clase: string) => (lecturas.rows as { clase: string }[]).find((l) => l.clase === clase) ?? null;
  c.header("Cache-Control", CACHE);
  return c.json(publicar({
    menor: { ...fila, ...(extra.rows[0] as Record<string, unknown>) },
    items: items.rows,
    senales: senales.rows,
    lecturas: { tdr: lectura("menor_tdr"), contrato: lectura("menor_contrato") },
    historial: historial.rows,
    ordenes: ordenes.rows,
  }));
});
