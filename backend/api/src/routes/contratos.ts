/**
 * Contratos (convocatorias SEACE) — lista paginada, conteos por faceta y agregado geográfico.
 * Plan: docs/superpowers/plans/2026-09-15-seace-escala.md · Workstream F. Fase 2 de la auditoría
 * (C9): todo lee los modelos de lectura de la migración 35 y cuesta según la página, no según N.
 *
 *   GET /contratos?size=50&cursor=|antes=|page=&q=&tipo=&etapa=&ubigeo=15&entidad=<ruc>&monto_min=&monto_max=
 *                 &desde=&hasta=&riesgo=alto|medio|bajo|sin_analizar|en_revision|descartado&estado=&operativo=
 *                 &orden=fecha|monto|score
 *       → { data: ContratoResumen[], total, totalExacto, page, size, siguiente, anterior }
 *       · Paginación por clave (keyset): `siguiente` / `anterior` son tokens opacos (base64url, ≤ 512)
 *         para `?cursor=` (página siguiente) y `?antes=` (anterior); null en el borde. `page` sigue
 *         aceptado (OFFSET, sólo compatibilidad: su costo crece con la página).
 *       · total: exacto desde `contratos_agregado` si los filtros son de {tipo, etapa, ubigeo, riesgo,
 *         estado, operativo} y las fechas caen en meses enteros (`totalExacto: true`; puede ir unos
 *         minutos detrás de la lista: se refresca con refresh_financiamiento_si_hace_falta). Si no,
 *         conteo acotado a 10.001: `totalExacto` = el conteo no llegó al tope.
 *       · Orden: fecha (fecha DESC, alta DESC, ocid DESC) · monto (DESC NULLS LAST, ocid DESC) ·
 *         score (score público DESC NULLS LAST, fecha DESC, alta DESC, ocid DESC).
 *       (alto/medio/bajo y `score` solo cuentan alertas PUBLICADAS; una alerta en revisión humana o
 *        descartada sale con score/banderas = null y riesgo en_revision/descartado — lib/publicacion.ts)
 *   GET /contratos/resumen?…  → { total, porTipo, porOperativo, porRiesgo, porOperativoSinLeer, porTipoRiesgo }
 *   GET /contratos/geo?nivel=distrito|provincia|departamento&ubigeo=15&tipo=&etapa=&riesgo=
 *       → { nivel, data: { ubigeo, nombre, nivel, lat, lon, total, sinAnalizar, pendientes, enProceso, procesados,
 *                          conSenales, enCola, documentosListos, enRevision, montoPen }[] }
 *   GET /contratos/:ocid y /:ocid/documento → contratos_detalle.ts
 *
 * Sin la migración 35 (lib/esquema.ts) estas rutas usan la SQL anterior (contratos_sql.ts).
 */

import { Hono } from "hono";
import { publicar } from "../lib/privacidad.js";
import { z } from "zod";
import { OCID_CANDIDATOS, escaparLike, pool } from "../lib/db.js";
import { Memo, responderConEtag, responderJson, type Serializado } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { codificarCursor, decodificarCursor } from "../lib/cursor.js";
import { hayModelosLectura } from "../lib/esquema.js";
import { casoLectura, lecturaSql } from "../lib/lectura.js";
import { BANDERAS_DE_FILA, COL_DUDOSO, crucesDeFila, joinDudoso } from "../lib/estadoFila.js";
import { COL_GOBIERNO, gobiernoDeFila } from "../lib/gobiernoFila.js";
import { ListQuery, cuboAnterior, geoAnterior, listaAnterior, ocidsDeGanadora } from "./contratos_sql.js";
import { contratosDetalleRouter } from "./contratos_detalle.js";

export const contratosRouter = new Hono();

// 5 min frescas y 1 h de margen (cdn.ts las sirve al instante y las renueva detrás): la base cambia con la carga diaria.
const CACHE_LISTA = cachePublico(300, { maxAge: 60, swr: 3600 });

type Filtros = z.infer<typeof ListQuery>;

/** Columnas de filtro según quién maneja el recorrido: convocatorias (`c`) o contrato_estado (`ce`, espejo). */
interface Mapa { ocid: string; etapa: string; ubigeo: string; entidad: string; monto: string; fecha: string }
const MAPA_C: Mapa = { ocid: "c.ocid", etapa: "c.etapa", ubigeo: "c.ubigeo_zona", entidad: "c.entidad_ruc", monto: "c.cuantia_referencial", fecha: "c.fecha_convocatoria" };
const MAPA_CE: Mapa = { ocid: "ce.ocid", etapa: "ce.etapa", ubigeo: "ce.ubigeo_zona", entidad: "ce.entidad_ruc", monto: "ce.monto", fecha: "ce.fecha_convocatoria" };

const esCodigo = (q: string) => /^[\w-]+$/.test(q) && /\d/.test(q);

/**
 * Quién maneja el recorrido de una página. Sin texto libre, `convocatorias` con sus índices keyset
 * (fecha / monto). Con texto libre, `contrato_estado` (espejo angosto de fecha, alta, monto, zona…):
 * el conjunto que coincide se cruza con una tabla de ~20 filas por página de disco en vez del heap de
 * convocatorias (con un término amplio el planificador prefiere recorrer en vez de buscar por PK).
 */
interface Driver { from: (usaCe: boolean) => string; m: Mapa; fecha: string; alta: string; ocid: string; monto: string }
const DRIVER_C: Driver = {
  from: (usaCe) => `convocatorias c ${usaCe ? "JOIN contrato_estado ce ON ce.ocid = c.ocid" : ""}`,
  m: MAPA_C, fecha: "c.fecha_convocatoria", alta: "c.created_at", ocid: "c.ocid", monto: "c.cuantia_referencial",
};
const DRIVER_CE: Driver = {
  from: () => "contrato_estado ce",
  m: MAPA_CE, fecha: "ce.fecha_convocatoria", alta: "ce.created_at", ocid: "ce.ocid", monto: "ce.monto",
};
const driverDe = (q: Partial<Filtros>) => (q.q && !esCodigo(q.q) ? DRIVER_CE : DRIVER_C);

/**
 * WHERE de los filtros sobre convocatorias + contrato_estado. `q` va como un conjunto de OCIDs hecho
 * de ramas indexables (auditoría C9: el `OR` entre tsvector y nombre de entidad anulaba el GIN):
 * código/OCID por PK o por código; texto por GIN de texto_busqueda UNION trigram del nombre de la
 * entidad (entidad_stats). `usaCe`: alguna condición necesita contrato_estado.
 */
function filtros(q: Partial<Filtros>, vals: unknown[], m: Mapa, excluir = new Set<string>()): { conds: string[]; usaCe: boolean } {
  const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const conds = [`${m.ocid} NOT LIKE 'ocds-vigia-%'`];
  let usaCe = m === MAPA_CE;
  const ce = (cond: string) => { conds.push(cond); usaCe = true; };
  if (q.q && !excluir.has("q")) {
    if (esCodigo(q.q)) {
      const p = add(q.q);
      conds.push(`${m.ocid} IN (SELECT c2.ocid FROM convocatorias c2 WHERE c2.ocid = ANY(${OCID_CANDIDATOS(p)}) AND ocid_corto(c2.ocid) = ocid_corto(${p})
                               UNION SELECT c3.ocid FROM convocatorias c3 WHERE c3.codigo = ${p})`);
    } else {
      const p = add(q.q);
      const like = add(`%${escaparLike(q.q.toLowerCase())}%`);
      // convocatoria_busqueda (migración 86): sólo ocid + vector, cabe en memoria; leer convocatorias por cada
      // coincidencia eran 19 mil lecturas de disco con "cemento".
      conds.push(`${m.ocid} IN (SELECT b.ocid FROM convocatoria_busqueda b WHERE b.texto @@ websearch_to_tsquery('spanish', ${p})
                               UNION SELECT c3.ocid FROM entidad_stats es JOIN convocatorias c3 ON c3.entidad_ruc = es.ruc
                                      WHERE es.nombre_norm LIKE immutable_unaccent(${like}))`);
    }
  }
  if (q.tipo && !excluir.has("tipo")) ce(`ce.tipo = ${add(q.tipo)}`);
  if (q.etapa && !excluir.has("etapa")) conds.push(`${m.etapa} = ${add(q.etapa)}`);
  if (q.ubigeo && !excluir.has("ubigeo")) conds.push(`${m.ubigeo} LIKE ${add(`${q.ubigeo}%`)}`);
  if (q.entidad && !excluir.has("entidad")) conds.push(`${m.entidad} = ${add(q.entidad)}`);
  if (q.monto_min != null && !excluir.has("monto")) conds.push(`${m.monto} >= ${add(q.monto_min)}`);
  if (q.monto_max != null && !excluir.has("monto")) conds.push(`${m.monto} <= ${add(q.monto_max)}`);
  if (q.desde && !excluir.has("fecha")) conds.push(`${m.fecha} >= ${add(q.desde)}::date`);
  if (q.hasta && !excluir.has("fecha")) conds.push(`${m.fecha} < (${add(q.hasta)}::date + 1)`);
  if (q.riesgo && !excluir.has("riesgo")) ce(`ce.riesgo = ${add(q.riesgo)}`);
  if (q.lectura && !excluir.has("lectura")) ce(lecturaSql(q.lectura, "ce."));
  if (q.estado && !excluir.has("estado")) ce(`ce.estado_proc = ${add(q.estado)}`);
  if (q.operativo && !excluir.has("operativo")) ce(`ce.operativo = ${add(q.operativo)}`);
  if (q.partido && !excluir.has("partido")) {
    // contrato_partido_idx (migración 59): la vista contrato_partido materializada, con índice por partido.
    conds.push(`EXISTS (SELECT 1 FROM contrato_partido_idx cp WHERE cp.org_clave = ${add(q.partido)} AND cp.ocid = ${m.ocid})`);
  }
  if ((q.cruces || q.cruce) && !excluir.has("cruces")) {
    const k = [`k.ocid = ${m.ocid}`];
    if (q.cruces === "alta") k.push("k.n_alta > 0");
    else if (q.cruces && q.cruces !== "con") k.push(`${add(q.cruces)} = ANY(k.tipos)`);
    if (q.cruce) k.push(`k.tipos && ${add(q.cruce.split(","))}::text[]`);
    conds.push(`EXISTS (SELECT 1 FROM casos_cruce k WHERE ${k.join(" AND ")})`);
  }
  // Un dato de la empresa que ganó (de baja en la SUNAT, un socio candidato…): conjunto de OCIDs partiendo de las
  // empresas que lo tienen (contratos_sql.ts). Vale igual con convocatorias o con contrato_estado manejando el recorrido.
  if (q.ganadora && !excluir.has("ganadora")) conds.push(`${m.ocid} IN (${ocidsDeGanadora(q.ganadora)})`);
  // Posible error de carga del OECE: son ~20 contratos (contrato_dudoso), se buscan por su PK.
  if (q.dudoso && !excluir.has("dudoso")) conds.push(`${m.ocid} IN (SELECT cdu.ocid FROM contrato_dudoso cdu)`);
  return { conds, usaCe };
}


// ─── ¿Sale del agregado? ─────────────────────────────────────────────────────
const esPrimeroDeMes = (d: string) => d.endsWith("-01");
function esFinDeMes(d: string): boolean {
  const [a, m, dia] = d.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate() === dia;
}
/** Filtros que `contratos_agregado` responde exacto: sin q, entidad ni montos, y fechas en meses enteros. */
const agregable = (q: Partial<Filtros>) =>
  !q.q && !q.cruces && !q.cruce && !q.partido && !q.entidad && q.monto_min == null && q.monto_max == null && !q.ganadora && !q.dudoso
  && (!q.desde || esPrimeroDeMes(q.desde)) && (!q.hasta || esFinDeMes(q.hasta));

/** WHERE sobre contratos_agregado (columnas: ubigeo, tipo, etapa, mes, riesgo, estado_proc, operativo). */
function filtrosAgregado(q: Partial<Filtros>, vals: unknown[], excluir = new Set<string>()): string {
  const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const w = ["TRUE"];
  if (q.tipo && !excluir.has("tipo")) w.push(`tipo = ${add(q.tipo)}`);
  if (q.etapa && !excluir.has("etapa")) w.push(`etapa = ${add(q.etapa)}`);
  if (q.ubigeo && !excluir.has("ubigeo")) w.push(`ubigeo LIKE ${add(`${q.ubigeo}%`)}`);
  if (q.riesgo && !excluir.has("riesgo")) w.push(`riesgo = ${add(q.riesgo)}`);
  if (q.lectura && !excluir.has("lectura")) w.push(lecturaSql(q.lectura, ""));
  if (q.estado && !excluir.has("estado")) w.push(`estado_proc = ${add(q.estado)}`);
  if (q.operativo && !excluir.has("operativo")) w.push(`operativo = ${add(q.operativo)}`);
  if (q.desde) w.push(`mes >= date_trunc('month', ${add(q.desde)}::date)::date`);
  if (q.hasta) w.push(`mes <= date_trunc('month', ${add(q.hasta)}::date)::date`);
  return w.join(" AND ");
}

// Cachés en memoria (lib/cache.ts) por combinación de filtros. TTL + stale ≤ el Cache-Control de cada
// ruta. Lo que lleva `q` (texto libre) va en cachés aparte y chicas.
const listaMemo = new Memo<Serializado>({ nombre: "contratos:lista", ttlMs: 30_000, staleMs: 30_000, max: 300 });
const listaTextoMemo = new Memo<Serializado>({ nombre: "contratos:lista:texto", ttlMs: 30_000, max: 50 });
const cuboMemo = new Memo<Celda[]>({ nombre: "contratos:resumen", ttlMs: 30_000, staleMs: 30_000, max: 300 });
const cuboTextoMemo = new Memo<Celda[]>({ nombre: "contratos:resumen:texto", ttlMs: 30_000, max: 50 });
const geoMemo = new Memo<Serializado>({ nombre: "contratos:geo", ttlMs: 60_000, staleMs: 60_000, max: 60 });
const geoTextoMemo = new Memo<Serializado>({ nombre: "contratos:geo:texto", ttlMs: 60_000, max: 20 });

// ─── GET /contratos/resumen ──────────────────────────────────────────────────
// Conteos por tipo/operativo/riesgo para los filtros rápidos (chips con número). Cada faceta se
// cuenta ignorando su propio filtro pero respetando los demás. UNA consulta arma el cubo
// tipo × operativo × riesgo con todo MENOS esas tres facetas; su clave de caché NO lleva tipo,
// operativo ni riesgo (auditoría M1: la portada calculaba 5 cubos idénticos). El reparto es en memoria.
// `porTipoRiesgo[tipo][riesgo]` = lo que daría `porRiesgo` con ese `tipo` elegido (respeta operativo):
// la matriz tipo × riesgo de una sola llamada.
const ResumenQuery = ListQuery.pick({ q: true, ubigeo: true, entidad: true, monto_min: true, monto_max: true, desde: true, hasta: true, tipo: true, etapa: true, riesgo: true, operativo: true, cruces: true, cruce: true, lectura: true, partido: true, ganadora: true, dudoso: true });
type Faceta = "tipo" | "operativo" | "riesgo";
type Celda = Record<Faceta, string | null> & { n: number };
const FACETAS: Faceta[] = ["tipo", "operativo", "riesgo"];

contratosRouter.get("/resumen", async (c) => {
  const parsed = ResumenQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const { tipo: _t, operativo: _o, riesgo: _r, ...base } = q;
  const celdas = await (q.q ? cuboTextoMemo : cuboMemo).obtener(JSON.stringify(base), () => cubo(q));
  const pasa = (celda: Celda, salvo: Faceta | null) => FACETAS.every((f) => f === salvo || q[f] == null || celda[f] === q[f]);
  const contar = (f: Faceta) => {
    const out: Record<string, number> = {};
    for (const celda of celdas) if (pasa(celda, f)) { const k = celda[f] ?? "sin_clasificar"; out[k] = (out[k] ?? 0) + celda.n; }
    return out;
  };
  const porTipoRiesgo: Record<string, Record<string, number>> = {};
  for (const celda of celdas) {
    if (q.operativo != null && celda.operativo !== q.operativo) continue;
    const t = celda.tipo ?? "sin_clasificar";
    const r = celda.riesgo ?? "sin_clasificar";
    const fila = (porTipoRiesgo[t] ??= {});
    fila[r] = (fila[r] ?? 0) + celda.n;
  }
  const total = celdas.reduce((s, celda) => s + (pasa(celda, null) ? celda.n : 0), 0);
  // El estado operativo de los que Vigía aún no leyó: en cola, con documentos o sin ellos suman, con los leídos, el
  // total (porOperativo cuenta también a los leídos, que siguen "en cola" por su tipo y etapa).
  const porOperativoSinLeer: Record<string, number> = {};
  for (const celda of celdas) {
    if (!pasa(celda, null) || celda.riesgo !== "sin_analizar") continue;
    const k = celda.operativo ?? "sin_clasificar";
    porOperativoSinLeer[k] = (porOperativoSinLeer[k] ?? 0) + celda.n;
  }
  const [porCruces, porLectura, porDudoso] = await Promise.all([
    crucesMemo.obtener(JSON.stringify({ ...q, cruces: undefined }), () => contarCruces(q)).catch(() => null),
    lecturaMemo.obtener(JSON.stringify({ ...q, lectura: undefined, riesgo: undefined }), () => contarLectura(q)).catch(() => null),
    dudosoMemo.obtener(JSON.stringify({ ...q, dudoso: undefined }), () => contarDudosos(q)).catch(() => null),
  ]);
  return responderConEtag(c, { total, porTipo: contar("tipo"), porOperativo: contar("operativo"), porRiesgo: contar("riesgo"), porOperativoSinLeer, porTipoRiesgo, porCruces, porLectura, porDudoso }, CACHE_LISTA);
});

const dudosoMemo = new Memo<number>({ nombre: "contratos:resumen:dudoso", ttlMs: 60_000, staleMs: 60_000, max: 200 });

/**
 * Cuántos contratos con posible error de carga (contrato_dudoso, ~20) cumplen los demás filtros: el conteo de su opción.
 * Parte de esos pocos OCIDs y los busca por PK en contrato_estado.
 */
async function contarDudosos(q: z.infer<typeof ResumenQuery>): Promise<number> {
  const vals: unknown[] = [];
  const { conds } = filtros({ ...q, dudoso: "si" }, vals, MAPA_CE);
  const r = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM contrato_estado ce WHERE ${conds.join(" AND ")}`, vals);
  return r.rows[0]?.n ?? 0;
}

const crucesMemo = new Memo<{ con: number; alta: number; tipos: Record<string, number> }>({ nombre: "contratos:resumen:cruces", ttlMs: 60_000, staleMs: 60_000, max: 200 });

/**
 * Contratos con cruces del ganador (con alguno, con uno grave y con cada tipo) bajo los demás filtros: los conteos del
 * desplegable "Antecedentes". Todo por GROUP BY (hash): count(DISTINCT) ordena los ocid como texto y sin filtros eran
 * 2,2 s sobre los 161 mil casos; así, 0,8 s (con filtros, de 0,43 a 0,23 s). Mismos números (2026-10-20).
 */
async function contarCruces(q: z.infer<typeof ResumenQuery>): Promise<{ con: number; alta: number; tipos: Record<string, number> }> {
  const vals: unknown[] = [];
  const { conds } = filtros({ ...q, cruces: undefined }, vals, MAPA_CE);
  // Sin filtros de usuario (sólo el de las convocatorias de demo) la faceta es la de TODOS los contratos, que sólo
  // cambia con casos_cruce: está precomputada en casos_cruce_totales (migración 114) y se lee en O(1). Antes recorría
  // los 174 mil casos (seq scan + unnest + agregados con volcado a disco): ~0,9-1,2 s en frío, la consulta de usuario
  // más cara del camino caliente.
  if (conds.length === 1) {
    const r = await pool.query<{ con: number; alta: number; tipos: Record<string, number> }>(
      `SELECT con, alta, tipos FROM casos_cruce_totales`);
    return r.rows[0] ?? { con: 0, alta: 0, tipos: {} };
  }
  const base = `SELECT k.ocid, k.n_alta, k.tipos FROM contrato_estado ce JOIN casos_cruce k ON k.ocid = ce.ocid WHERE ${conds.join(" AND ")}`;
  const r = await pool.query(
    `WITH k AS MATERIALIZED (${base}),
          o AS (SELECT k.ocid, bool_or(k.n_alta > 0) AS alta FROM k GROUP BY 1),
          t AS (SELECT x.t, count(*)::int AS n FROM (SELECT k.ocid, t FROM k, unnest(k.tipos) t GROUP BY 1, 2) x GROUP BY 1)
     SELECT (SELECT count(*)::int FROM o) AS con,
            (SELECT count(*)::int FROM o WHERE alta) AS alta,
            (SELECT COALESCE(jsonb_object_agg(t, n), '{}'::jsonb) FROM t) AS tipos`, vals);
  return r.rows[0];
}

const lecturaMemo = new Memo<Record<string, number>>({ nombre: "contratos:resumen:lectura", ttlMs: 30_000, staleMs: 30_000, max: 300 });

/** Conteos de "¿Lo leyó Vigía?" con los demás filtros (sin lectura ni riesgo, que son la misma pregunta). */
async function contarLectura(q: z.infer<typeof ResumenQuery>): Promise<Record<string, number>> {
  const base = { ...q, lectura: undefined, riesgo: undefined };
  const vals: unknown[] = [];
  const casos = casoLectura;
  const r = agregable(base)
    ? await pool.query(`SELECT ${casos("")} AS k, sum(n)::int AS n FROM contratos_agregado WHERE ${filtrosAgregado(base, vals)} GROUP BY 1`, vals)
    : await (async () => {
        const { conds } = filtros(base, vals, MAPA_CE);
        return pool.query(`SELECT ${casos("ce.")} AS k, count(*)::int AS n FROM contrato_estado ce WHERE ${conds.join(" AND ")} GROUP BY 1`, vals);
      })();
  return Object.fromEntries(r.rows.map((x) => [x.k, x.n]));
}

async function cubo(q: z.infer<typeof ResumenQuery>): Promise<Celda[]> {
  const sinFacetas = new Set<string>(FACETAS);
  if (!(await hayModelosLectura())) return cuboAnterior({ ...q, page: 1, size: 1, orden: "fecha" });
  const vals: unknown[] = [];
  if (agregable(q)) {
    const r = await pool.query<Celda>(
      `SELECT tipo, operativo, riesgo, sum(n)::int AS n FROM contratos_agregado
        WHERE ${filtrosAgregado(q, vals, sinFacetas)} GROUP BY 1, 2, 3`, vals);
    return r.rows;
  }
  // q, entidad o montos: la consulta base sobre contrato_estado (+ convocatorias sólo para `q`).
  const { conds } = filtros(q, vals, MAPA_CE, sinFacetas);
  const r = await pool.query<Celda>(
    `SELECT ce.tipo, ce.operativo, ce.riesgo, count(*)::int AS n FROM contrato_estado ce
      WHERE ${conds.join(" AND ")} GROUP BY 1, 2, 3`, vals);
  return r.rows;
}

// ─── GET /contratos ──────────────────────────────────────────────────────────
const ListaQuery = ListQuery.extend({
  cursor: z.string().max(512).optional(),
  antes: z.string().max(512).optional(),
});
type ListaQ = z.infer<typeof ListaQuery>;

/** Tope del conteo acotado: más allá, la UI dice "10.000+". */
const TOPE_CONTEO = 10_000;

contratosRouter.get("/", async (c) => {
  const parsed = ListaQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = { ...parsed.data, q: parsed.data.q || undefined };
  if (q.cursor && q.antes) q.antes = undefined; // con los dos, manda el cursor (hacia adelante)
  const tipoCursor = q.orden === "monto" ? "m" : q.orden === "score" ? "s" : "f";
  const nClaves = tipoCursor === "m" ? 2 : tipoCursor === "s" ? 4 : 3;
  const token = q.cursor ?? q.antes;
  if (token && !decodificarCursor(token, tipoCursor, nClaves)) return c.json({ error: "invalid_cursor" }, 400);
  if (!(await hayModelosLectura())) {
    return responderJson(c, q.q ? listaTextoMemo : listaMemo, `v0:${JSON.stringify(q)}`, () => listaAnterior(q).then(publicar), CACHE_LISTA);
  }
  return responderJson(c, q.q ? listaTextoMemo : listaMemo, JSON.stringify(q), () => lista(q).then(publicar), CACHE_LISTA);
});

/** Columnas de cada fila (mismas claves que antes). */
const COLS_FILA = `c.ocid, c.codigo, c.objeto AS titulo, e.nombre AS entidad, c.entidad_ruc::text AS "entidadRuc",
  ce.tipo, c.etapa, COALESCE(c.modalidad, c.ocds_payload->'tender'->>'procurementMethodDetails') AS modalidad,
  c.cuantia_referencial::float AS "montoPen", COALESCE(c.ocds_payload->'tender'->'value'->>'currency', 'PEN') AS moneda,
  to_char(c.fecha_convocatoria, 'YYYY-MM-DD') AS fecha, c.ubigeo_zona AS ubigeo, z.nombre AS zona,
  z.lat::float AS lat, z.lon::float AS lon, c.procesable,
  ce.estado_proc AS "estadoProcesamiento", ce.operativo AS "estadoOperativo", ce.score,
  CASE WHEN ce.alerta_id IS NULL OR alerta_publicada(ce.alerta_estado) THEN COALESCE(b.n, 0)::int END AS banderas,
  COALESCE(ce.alerta_estado = 'revision', false) AS "enRevision",
  -- Sin record completo, las adjudicaciones recortadas de oece_ocds (migración 71).
  COALESCE(razon_social_de(emp.razon_social), COALESCE(c.ocds_payload->'awards', c.adjudicaciones)->0->'suppliers'->0->>'name') AS proveedor,
  COALESCE(c.proveedor_ruc::text, NULLIF(regexp_replace(COALESCE(c.ocds_payload->'awards', c.adjudicaciones)->0->'suppliers'->0->>'id', '^PE-RUC-', ''), '')) AS "proveedorRuc",
  kc.cruces,
  -- Posible error de carga del OECE (migración 102): adjudicado 20 veces el referencial o referencial de S/ 1.
  ${COL_DUDOSO},
  -- El partido que gobernaba la entidad cuando se convocó (lib/gobiernoFila.ts).
  ${COL_GOBIERNO},
  -- Los datos de la empresa que ganó (no del contrato): la fila los muestra cuando se filtra por uno (?ganadora=).
  dg.datos AS "datosGanadora"`;

/** Los tipos de empresa_resumen que son datos de la empresa y no antecedentes del contrato (?ganadora=). */
const TIPOS_GANADORA = ListQuery.shape.ganadora.unwrap().options;

const JOIN_FILA = `JOIN convocatorias c ON c.ocid = pag.ocid
  JOIN contrato_estado ce ON ce.ocid = pag.ocid
  LEFT JOIN zonas z ON z.ubigeo = c.ubigeo_zona
  LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
  LEFT JOIN empresas emp ON emp.ruc = c.proveedor_ruc
  ${BANDERAS_DE_FILA}
  ${crucesDeFila("c.ocid")}
  ${joinDudoso("c.ocid")}
  ${gobiernoDeFila("c.ocid")}
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('tipo', x->>'tipo', 'severidad', x->>'severidad') ORDER BY x->>'tipo') AS datos
      FROM empresa_resumen er, jsonb_array_elements(er.cruces) x
     WHERE er.ruc = c.proveedor_ruc::text AND x->>'tipo' IN (${TIPOS_GANADORA.map((t) => `'${t}'`).join(", ")})
  ) dg ON TRUE`;

interface Orden {
  /** SELECT de la página (ocid + claves tipadas k0..k2) con WHERE/ORDER/LIMIT ya puestos. */
  pagina(vals: unknown[], dir: "adelante" | "atras", claves: (string | number | null)[] | null, n: number, offset: number): string;
  /** ORDER BY de afuera sobre `pag` (hacia adelante). */
  orden: string;
  ordenAtras: string;
  /** Claves de la fila como texto (para el token) — columnas `_k0`… de la consulta de afuera. */
  claves: string;
  token(fila: Record<string, unknown>): string;
}

function ordenDe(q: ListaQ): Orden {
  if (q.orden === "score") {
    // Todo en contrato_estado (índice contrato_estado_keyset_score_idx).
    const K = `(COALESCE(ce.score, -1)), (COALESCE(ce.fecha_convocatoria, '-infinity'::date)), ce.created_at, ce.ocid`;
    return {
      pagina(vals, dir, claves, n, offset) {
        const { conds } = filtros(q, vals, MAPA_CE);
        if (claves) {
          vals.push(claves[0], claves[1], claves[2], claves[3]);
          const i = vals.length;
          conds.push(`(${K}) ${dir === "adelante" ? "<" : ">"} ($${i - 3}::int, $${i - 2}::date, $${i - 1}::timestamptz, $${i})`);
        }
        const d = dir === "adelante" ? "DESC" : "ASC";
        return `SELECT ce.ocid, COALESCE(ce.score, -1) AS k0, COALESCE(ce.fecha_convocatoria, '-infinity'::date) AS k1, ce.created_at AS k2
                  FROM contrato_estado ce WHERE ${conds.join(" AND ")}
                 ORDER BY COALESCE(ce.score, -1) ${d}, COALESCE(ce.fecha_convocatoria, '-infinity'::date) ${d}, ce.created_at ${d}, ce.ocid ${d}
                 LIMIT ${n} OFFSET ${offset}`;
      },
      orden: `pag.k0 DESC, pag.k1 DESC, pag.k2 DESC, pag.ocid DESC`,
      ordenAtras: `pag.k0 ASC, pag.k1 ASC, pag.k2 ASC, pag.ocid ASC`,
      claves: `pag.k0 AS _k0, pag.k1::text AS _k1, pag.k2::text AS _k2`,
      token: (f) => codificarCursor("s", [f._k0 as number, f._k1 as string, f._k2 as string, f.ocid as string]),
    };
  }
  if (q.orden === "monto") {
    // Índice convocatorias_keyset_monto_idx (monto DESC NULLS LAST, ocid DESC). Dos tramos: con monto
    // (comparación por fila) y sin monto (van al final, por ocid). Hoy no hay montos nulos.
    const d = driverDe(q);
    return {
      pagina(vals, dir, claves, n, offset) {
        const tramo = (extra: string[], orden: string) => {
          const { conds, usaCe } = filtros(q, vals, d.m);
          return `(SELECT ${d.ocid} AS ocid, ${d.monto} AS k0 FROM ${d.from(usaCe)}
                    WHERE ${[...conds, ...extra].join(" AND ")} ORDER BY ${orden} LIMIT ${n + offset})`;
        };
        const m = claves?.[0] ?? null;
        const o = claves?.[1] ?? null;
        const partes: string[] = [];
        if (dir === "adelante") {
          if (!claves || m !== null) {
            const cond = [`${d.monto} IS NOT NULL`];
            if (claves) { vals.push(m, o); cond.push(`(${d.monto}, ${d.ocid}) < ($${vals.length - 1}::numeric, $${vals.length})`); }
            partes.push(tramo(cond, `${d.monto} DESC, ${d.ocid} DESC`));
          }
          const condNulos = [`${d.monto} IS NULL`];
          if (claves && m === null) { vals.push(o); condNulos.push(`${d.ocid} < $${vals.length}`); }
          partes.push(tramo(condNulos, `${d.ocid} DESC`));
          return `SELECT * FROM (${partes.join(" UNION ALL ")}) t ORDER BY k0 DESC NULLS LAST, ocid DESC LIMIT ${n} OFFSET ${offset}`;
        }
        // Hacia atrás: lo que está antes del cursor, del más cercano al más lejano.
        if (m === null) {
          vals.push(o);
          partes.push(tramo([`${d.monto} IS NULL`, `${d.ocid} > $${vals.length}`], `${d.ocid} ASC`));
          partes.push(tramo([`${d.monto} IS NOT NULL`], `${d.monto} ASC, ${d.ocid} ASC`));
        } else {
          vals.push(m, o);
          partes.push(tramo([`${d.monto} IS NOT NULL`, `(${d.monto}, ${d.ocid}) > ($${vals.length - 1}::numeric, $${vals.length})`],
            `${d.monto} ASC, ${d.ocid} ASC`));
        }
        return `SELECT * FROM (${partes.join(" UNION ALL ")}) t ORDER BY k0 ASC NULLS FIRST, ocid ASC LIMIT ${n}`;
      },
      orden: `pag.k0 DESC NULLS LAST, pag.ocid DESC`,
      ordenAtras: `pag.k0 ASC NULLS FIRST, pag.ocid ASC`,
      claves: `pag.k0::text AS _k0`,
      token: (f) => codificarCursor("m", [(f._k0 as string | null) ?? null, f.ocid as string]),
    };
  }
  // Fecha (por defecto): índice convocatorias_keyset_fecha_idx (con texto libre, contrato_estado).
  const d = driverDe(q);
  const F = `COALESCE(${d.fecha}, '-infinity'::date)`;
  return {
    pagina(vals, dir, claves, n, offset) {
      const { conds, usaCe } = filtros(q, vals, d.m);
      if (claves) {
        vals.push(claves[0], claves[1], claves[2]);
        const i = vals.length;
        conds.push(`((${F}), ${d.alta}, ${d.ocid}) ${dir === "adelante" ? "<" : ">"} ($${i - 2}::date, $${i - 1}::timestamptz, $${i})`);
      }
      const o = dir === "adelante" ? "DESC" : "ASC";
      return `SELECT ${d.ocid} AS ocid, ${F} AS k1, ${d.alta} AS k2
                FROM ${d.from(usaCe)}
               WHERE ${conds.join(" AND ")}
               ORDER BY ${F} ${o}, ${d.alta} ${o}, ${d.ocid} ${o}
               LIMIT ${n} OFFSET ${offset}`;
    },
    orden: `pag.k1 DESC, pag.k2 DESC, pag.ocid DESC`,
    ordenAtras: `pag.k1 ASC, pag.k2 ASC, pag.ocid ASC`,
    claves: `pag.k1::text AS _k1, pag.k2::text AS _k2`,
    token: (f) => codificarCursor("f", [f._k1 as string, f._k2 as string, f.ocid as string]),
  };
}

async function pagina(q: ListaQ, o: Orden, dir: "adelante" | "atras", claves: (string | number | null)[] | null, offset: number) {
  const vals: unknown[] = [];
  const sql = `WITH pag AS (${o.pagina(vals, dir, claves, q.size + 1, offset)})
    SELECT ${COLS_FILA}, ${o.claves}
      FROM pag ${JOIN_FILA}
     ORDER BY ${dir === "adelante" ? o.orden : o.ordenAtras}`;
  return (await pool.query(sql, vals)).rows as Record<string, unknown>[];
}

async function contarTotal(q: ListaQ): Promise<{ total: number; totalExacto: boolean }> {
  const vals: unknown[] = [];
  if (agregable(q)) {
    const r = await pool.query(`SELECT COALESCE(sum(n), 0)::int AS n FROM contratos_agregado WHERE ${filtrosAgregado(q, vals)}`, vals);
    return { total: r.rows[0].n, totalExacto: true };
  }
  // Sólo texto (sin otros filtros): se cuenta sobre las coincidencias mismas (convocatoria_busqueda, en memoria), sin
  // buscar cada una en contrato_estado: con "cemento" eran 10 mil lecturas sueltas en frío (8,6 s, la API daba 500).
  const soloTexto = q.q && !esCodigo(q.q) && !q.tipo && !q.etapa && !q.ubigeo && !q.entidad && q.monto_min == null && q.monto_max == null
    && !q.desde && !q.hasta && !q.riesgo && !q.lectura && !q.estado && !q.operativo && !q.partido && !q.cruces && !q.cruce && !q.ganadora && !q.dudoso;
  if (soloTexto) {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM (
         SELECT u.ocid FROM (SELECT b.ocid FROM convocatoria_busqueda b WHERE b.texto @@ websearch_to_tsquery('spanish', $1)
                             UNION SELECT c3.ocid FROM entidad_stats es JOIN convocatorias c3 ON c3.entidad_ruc = es.ruc
                                    WHERE es.nombre_norm LIKE immutable_unaccent($2)) u
          WHERE u.ocid NOT LIKE 'ocds-vigia-%' LIMIT ${TOPE_CONTEO + 1}) x`,
      [q.q, `%${escaparLike(q.q!.toLowerCase())}%`]);
    const n = r.rows[0].n as number;
    return { total: n, totalExacto: n <= TOPE_CONTEO };
  }
  const d = driverDe(q);
  const { conds, usaCe } = filtros(q, vals, d.m);
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM (SELECT 1 FROM ${d.from(usaCe)} WHERE ${conds.join(" AND ")} LIMIT ${TOPE_CONTEO + 1}) x`, vals);
  const n = r.rows[0].n as number;
  // Un conteo que no llegó al tope es exacto; en el tope, la UI dice "10.000+".
  return { total: n, totalExacto: n <= TOPE_CONTEO };
}

async function lista(q: ListaQ) {
  const o = ordenDe(q);
  const tipo = q.orden === "monto" ? "m" : q.orden === "score" ? "s" : "f";
  const n = tipo === "m" ? 2 : tipo === "s" ? 4 : 3;
  const quitar = (filas: Record<string, unknown>[]) => filas.map(({ _k0, _k1, _k2, ...fila }) => fila);
  const [tot, filas] = await Promise.all([
    contarTotal(q),
    (async () => {
      if (q.antes) {
        const atras = await pagina(q, o, "atras", decodificarCursor(q.antes, tipo, n), 0);
        // Llegó al principio: se devuelve la primera página tal cual (así "anterior" queda en null).
        if (atras.length <= q.size) return { modo: "primera" as const, filas: await pagina(q, o, "adelante", null, 0) };
        return { modo: "atras" as const, filas: atras.slice(0, q.size).reverse() };
      }
      const claves = q.cursor ? decodificarCursor(q.cursor, tipo, n) : null;
      const offset = !q.cursor ? (q.page - 1) * q.size : 0;
      return { modo: claves ? ("cursor" as const) : offset > 0 ? ("offset" as const) : ("primera" as const), filas: await pagina(q, o, "adelante", claves, offset) };
    })(),
  ]);
  let data: Record<string, unknown>[];
  let siguiente: string | null;
  let anterior: string | null;
  if (filas.modo === "atras") {
    data = filas.filas;
    anterior = data.length ? o.token(data[0]) : null;
    siguiente = data.length ? o.token(data[data.length - 1]) : null;
  } else {
    const hayMas = filas.filas.length > q.size;
    data = filas.filas.slice(0, q.size);
    siguiente = hayMas && data.length ? o.token(data[data.length - 1]) : null;
    anterior = filas.modo !== "primera" && data.length ? o.token(data[0]) : null;
  }
  return { data: quitar(data), total: tot.total, totalExacto: tot.totalExacto, page: q.page, size: q.size, siguiente, anterior };
}

// ─── GET /contratos/geo ──────────────────────────────────────────────────────
const GeoQuery = ListQuery.pick({
  tipo: true, etapa: true, riesgo: true, ubigeo: true, entidad: true, q: true, desde: true, hasta: true,
  // Los filtros del mapa: lectura, antecedentes del ganador y partido que gobierna.
  lectura: true, cruces: true, cruce: true, partido: true,
}).extend({
  nivel: z.enum(["distrito", "provincia", "departamento"]).default("distrito"),
});

contratosRouter.get("/geo", async (c) => {
  const parsed = GeoQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = { ...parsed.data, q: parsed.data.q || undefined };
  return responderJson(c, q.q ? geoTextoMemo : geoMemo, JSON.stringify(q), async () => ({ nivel: q.nivel, data: await geo(q) }),
    cachePublico(300, { maxAge: 60, swr: 3600 }));
});

const COLS_GEO_AGREGADO = `sum(n)::int AS total,
  COALESCE(sum(n) FILTER (WHERE estado_proc = 'sin_analizar'), 0)::int AS "sinAnalizar",
  COALESCE(sum(n) FILTER (WHERE estado_proc = 'pendiente_de_procesamiento'), 0)::int AS pendientes,
  COALESCE(sum(n) FILTER (WHERE estado_proc IN ('encolado','procesando')), 0)::int AS "enProceso",
  COALESCE(sum(n) FILTER (WHERE estado_proc = 'procesado'), 0)::int AS procesados,
  COALESCE(sum(n) FILTER (WHERE riesgo IN ('alto','medio')), 0)::int AS "conSenales",
  COALESCE(sum(n) FILTER (WHERE estado_proc = 'sin_analizar' AND operativo = 'en_cola'), 0)::int AS "enCola",
  COALESCE(sum(n) FILTER (WHERE estado_proc = 'sin_analizar' AND operativo = 'documentos_listos'), 0)::int AS "documentosListos",
  COALESCE(sum(n_revision), 0)::int AS "enRevision",
  COALESCE(sum(monto), 0)::float AS "montoPen"`;

const COLS_GEO_BASE = `count(*)::int AS total,
  count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar')::int AS "sinAnalizar",
  count(*) FILTER (WHERE ce.estado_proc = 'pendiente_de_procesamiento')::int AS pendientes,
  count(*) FILTER (WHERE ce.estado_proc IN ('encolado','procesando'))::int AS "enProceso",
  count(*) FILTER (WHERE ce.estado_proc = 'procesado')::int AS procesados,
  count(*) FILTER (WHERE ce.riesgo IN ('alto','medio'))::int AS "conSenales",
  count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'en_cola')::int AS "enCola",
  count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'documentos_listos')::int AS "documentosListos",
  count(*) FILTER (WHERE ce.alerta_estado = 'revision')::int AS "enRevision",
  COALESCE(sum(ce.monto), 0)::float AS "montoPen"`;

async function geo(q: z.infer<typeof GeoQuery>) {
  const len = q.nivel === "distrito" ? 6 : q.nivel === "provincia" ? 4 : 2;
  if (!(await hayModelosLectura())) return geoAnterior({ ...q, page: 1, size: 1, orden: "fecha" }, len);
  const vals: unknown[] = [];
  let agg: string;
  if (agregable(q)) {
    const w = filtrosAgregado(q, vals);
    agg = `SELECT left(ubigeo, ${len}) AS ubigeo, ${COLS_GEO_AGREGADO} FROM contratos_agregado WHERE ubigeo IS NOT NULL AND ${w} GROUP BY 1`;
  } else {
    // entidad, q o fechas sueltas: la consulta base sobre contrato_estado (sin las CASE de antes).
    const { conds } = filtros(q, vals, MAPA_CE);
    agg = `SELECT left(ce.ubigeo_zona, ${len}) AS ubigeo, ${COLS_GEO_BASE} FROM contrato_estado ce
            WHERE ce.ubigeo_zona IS NOT NULL AND ${conds.join(" AND ")} GROUP BY 1`;
  }
  const r = await pool.query(
    `WITH agg AS (${agg})
     SELECT agg.ubigeo, z.nombre, z.nivel, z.lat::float AS lat, z.lon::float AS lon,
            agg.total, agg."sinAnalizar", agg.pendientes, agg."enProceso", agg.procesados, agg."conSenales",
            agg."enCola", agg."documentosListos", agg."enRevision", agg."montoPen"
       FROM agg JOIN zonas z ON z.ubigeo = agg.ubigeo
      WHERE z.lat IS NOT NULL AND z.lon IS NOT NULL
      ORDER BY agg.total DESC, agg.ubigeo`, vals);
  return r.rows;
}

// Detalle (`/:ocid`, `/:ocid/documento`): después de las rutas fijas de arriba.
contratosRouter.route("/", contratosDetalleRouter);
