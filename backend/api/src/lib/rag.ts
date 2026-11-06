/**
 * RAG de documentos (migración 258): trocear, calcular embeddings y buscar en el texto de los documentos de cada proceso.
 *
 *   indexarRag(ia, opciones)   POST /admin/rag/indexar y el cron de 10 min (routes/admin.ts → /admin/asignar):
 *     1. las líneas del modelo estándar (rag_refrescar_lineas, una vez al mes);
 *     2. sincroniza: borra lo que ya no está (una alerta que dejó de estar publicada, una lectura reemplazada) y trocea lo
 *        nuevo o cambiado (huella distinta en rag_origen), el más importante primero: dictámenes, lecturas, informes de
 *        control y al final los documentos;
 *     3. calcula los embeddings que faltan con @cf/baai/bge-m3 (Workers AI, binding AI) en lotes de largo parecido (el
 *        modelo rellena cada texto hasta el más largo del lote y cobra ese relleno: 60 000 tokens por pedido), varios a
 *        la vez, hasta el tope de tiempo. Un trozo igual a otro (mismo md5) reusa su embedding sin llamar al modelo.
 *     Llamadas en paralelo no se pisan: cada fuente se guarda con un candado y cada trozo pendiente se reclama 5 minutos.
 *   buscarRag(busqueda, ia)    GET /documentos/buscar (routes/documentos.ts): texto completo en español (tsv, la misma
 *     expresión que la migración) y significado (coseno contra el embedding de la pregunta, HNSW con iterative_scan para
 *     los filtros), en UNA consulta; la fusión por rango recíproco, sin casi repetidos, en ragTexto.ts. Sin Workers AI,
 *     sólo texto, y la respuesta lo dice en `nota`. Todo sale por publicar() (lib/privacidad.ts), con lo que Vigía sabe de
 *     las personas de esos procesos (postores y contratistas leídos, el análisis de la alerta) para taparlas también en
 *     la prosa de los documentos.
 */
import { esErrorPg, pool, poolAdmin } from "./db.js";
import { publicar } from "./privacidad.js";
import {
  fusionarRrf, md5, quitarCasiIguales, recorte, terminos, textoDeInforme, textoDeLectura, TIPO_DOCUMENTO, tituloFragmento,
  trocear, VERSION_TROCEO, type Busqueda,
} from "./ragTexto.js";

/** Lo que se usa del binding de Workers AI (env.AI). */
export interface IaWorkers {
  run(modelo: string, entrada: Record<string, unknown>): Promise<unknown>;
}

export const MODELO_EMBEDDINGS = "@cf/baai/bge-m3";
export const DIMENSIONES = 1024;
/** Tope de tokens por pedido de bge-m3 en Workers AI (lotes × el más largo, con relleno). */
const TOKENS_POR_PEDIDO = 36_000;
const TEXTOS_POR_PEDIDO = 32;
const PEDIDOS_A_LA_VEZ = 4;
const RECLAMO_LOTE = 128;
const WEB = "https://vigia.gobserva.cloud";

const conPlazo = <T>(p: Promise<T>, ms: number, que: string): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, no) => { t = setTimeout(() => no(new Error(`${que}: sin respuesta en ${ms} ms`)), ms); })])
    .finally(() => clearTimeout(t));
};

/** Embeddings de `textos`, en el mismo orden (1024 números cada uno). Tira si la respuesta no tiene esa forma. */
export async function embeber(ia: IaWorkers, textos: string[], plazoMs = 30_000): Promise<number[][]> {
  const r = (await conPlazo(ia.run(MODELO_EMBEDDINGS, { text: textos }), plazoMs, "Workers AI")) as { data?: unknown };
  const data = r?.data;
  if (!Array.isArray(data) || data.length !== textos.length
    || data.some((v) => !Array.isArray(v) || v.length !== DIMENSIONES || typeof v[0] !== "number")) {
    throw new Error(`Workers AI devolvió otra forma (${Array.isArray(data) ? `${data.length} filas` : typeof data})`);
  }
  return data as number[][];
}

/**
 * Como embeber, pero si el lote pasa el contexto del modelo (8007/5021: los dictámenes en markdown, con tablas y cifras,
 * rinden hasta ~1,3 caracteres por token y la estimación de lotesPorLargo no alcanza) lo parte en dos y reintenta.
 */
export async function embeberPartiendo(ia: IaWorkers, textos: string[], contar: () => void = () => {}): Promise<number[][]> {
  try {
    contar();
    return await embeber(ia, textos);
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (textos.length < 2 || !/context|8007|5021|exceed/i.test(m)) throw e;
    const mitad = Math.ceil(textos.length / 2);
    return [...await embeberPartiendo(ia, textos.slice(0, mitad), contar), ...await embeberPartiendo(ia, textos.slice(mitad), contar)];
  }
}

/** `[0.0123,-0.04…]` para un halfvec (float16: 4 cifras significativas alcanzan). */
export const vectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? +x.toPrecision(4) : 0)).join(",")}]`;

/** Lo que va al modelo por trozo: el título (tipo de documento, proceso y objeto) da el contexto que el trozo no dice. */
export const entradaModelo = (titulo: string | null, texto: string) => (titulo ? `${titulo}\n\n${texto}` : texto);

/**
 * Lotes para el modelo: por largo (relleno mínimo), ≤ TEXTOS_POR_PEDIDO textos y ≤ TOKENS_POR_PEDIDO tokens contando el
 * relleno, con 2 caracteres por token (los documentos con tablas y cifras rinden 2 a 4,5; el promedio medido fue 3,4).
 */
export function lotesPorLargo<T extends { entrada: string }>(items: T[]): T[][] {
  const orden = [...items].sort((a, b) => a.entrada.length - b.entrada.length);
  const lotes: T[][] = [];
  let lote: T[] = [];
  for (const it of orden) {
    const tokens = Math.ceil(it.entrada.length / 2) + 16;
    if (lote.length && (lote.length >= TEXTOS_POR_PEDIDO || (lote.length + 1) * tokens > TOKENS_POR_PEDIDO)) {
      lotes.push(lote);
      lote = [];
    }
    lote.push(it);
  }
  if (lote.length) lotes.push(lote);
  return lotes;
}

// ─── Fuentes ─────────────────────────────────────────────────────────────────

/**
 * Lo que tiene que estar indexado, con su huella. La huella no lee los textos grandes (documentos_texto: el sha256, la
 * versión del parser y cuándo se actualizó); sí el md5 de los dictámenes y de los informes, que son chicos.
 */
const DESEADAS = `
  SELECT 'documento'::text AS origen, t.sha256 AS origen_id,
         concat_ws('@', t.sha256, t.version_parser, extract(epoch FROM t.actualizado_at)::bigint, '${VERSION_TROCEO}') AS hash,
         3 AS prioridad
    FROM documentos_texto t
  UNION ALL
  SELECT 'lectura', l.ocid || ':' || l.clase, concat_ws('@', l.version, extract(epoch FROM l.leido_at)::bigint, '${VERSION_TROCEO}'), 1
    FROM (SELECT DISTINCT ON (ocid, clase) ocid, clase, version, leido_at FROM documento_lectura
           WHERE estado = 'ok' AND version NOT LIKE '%-2' AND salida IS NOT NULL
           ORDER BY ocid, clase, leido_at DESC) l
  UNION ALL
  SELECT 'dictamen', a.id::text, md5(a.dictamen_markdown) || '@${VERSION_TROCEO}', 0
    FROM alertas a
   WHERE alerta_publicada(a.estado) AND a.codigo NOT LIKE 'ALT-%' AND coalesce(a.dictamen_markdown, '') <> ''
  UNION ALL
  SELECT 'informe_control', i.codigo,
         md5(concat_ws('|', i.numero, i.titulo, i.modalidad, i.entidad_nombre, i.entidad_ruc, i.fecha_emision, i.sector,
                       i.departamento, i.responsabilidades::text, i.funcionarios, i.url_pdf, i.url_resumen)) || '@${VERSION_TROCEO}', 2
    FROM informes_control i
   WHERE coalesce(i.titulo, '') <> ''`;

interface Pendiente { origen: string; origen_id: string; hash: string }
interface FragmentoNuevo { titulo: string; pagina: number | null; orden: number; texto: string }
interface FuenteLista {
  origen: string; origen_id: string; hash: string;
  ocid: string | null; entidad_ruc: string | null; anio: number | null; tipo: string; url: string | null;
  fragmentos: FragmentoNuevo[];
}

const CONVOCATORIA = (col: string) => `LEFT JOIN LATERAL (
    SELECT c.entidad_ruc, c.objeto, extract(year FROM coalesce(c.fecha_convocatoria, c.fecha_buena_pro))::int AS anio
      FROM convocatorias c WHERE c.ocid = ANY(ARRAY[${col}, ocid_corto(${col}), 'ocds-dgv273-seacev3-' || ocid_corto(${col})])
     LIMIT 1) c ON true`;

async function cargarDocumentos(ps: Pendiente[], comunes: ReadonlySet<string>): Promise<FuenteLista[]> {
  const r = await poolAdmin.query(
    `SELECT t.sha256, ocid_corto(t.ocid) AS ocid, t.texto, g.tipo AS tipo_doc, g.titulo AS titulo_doc, g.url_origen AS url,
            c.entidad_ruc, c.anio, c.objeto
       FROM documentos_texto t
       LEFT JOIN LATERAL (SELECT g.tipo, g.titulo, g.url_origen FROM documentos_gcs g
                           WHERE g.ocid = t.ocid AND g.sha256 = t.sha256 ORDER BY g.creado_at DESC LIMIT 1) g ON true
       ${CONVOCATORIA("t.ocid")}
      WHERE t.sha256 = ANY($1::text[])`, [ps.map((p) => p.origen_id)]);
  const porId = new Map(r.rows.map((x) => [x.sha256 as string, x]));
  return ps.map((p) => {
    const x = porId.get(p.origen_id);
    const tipo = TIPO_DOCUMENTO[x?.tipo_doc ?? ""] ?? "otro";
    const trozos = x ? trocear(x.texto ?? "", { comunes }) : [];
    return {
      ...p, ocid: x?.ocid ?? null, entidad_ruc: x?.entidad_ruc?.trim() || null, anio: x?.anio ?? null, tipo, url: x?.url ?? null,
      fragmentos: trozos.map((t) => ({
        titulo: tituloFragmento({ tipo, documento: x?.titulo_doc, archivo: t.archivo, ocid: x?.ocid, objeto: x?.objeto }),
        pagina: t.pagina, orden: t.orden, texto: t.texto,
      })),
    };
  });
}

async function cargarLecturas(ps: Pendiente[]): Promise<FuenteLista[]> {
  const claves = ps.map((p) => {
    const i = p.origen_id.lastIndexOf(":");
    return { ocid: p.origen_id.slice(0, i), clase: p.origen_id.slice(i + 1) };
  });
  const r = await poolAdmin.query(
    `SELECT l.ocid || ':' || l.clase AS id, ocid_corto(l.ocid) AS ocid, l.clase, l.salida, l.banderas, d.url_origen AS url,
            c.entidad_ruc, c.anio, c.objeto
       FROM (SELECT DISTINCT ON (ocid, clase) ocid, clase, salida, banderas, documentos FROM documento_lectura
              WHERE ocid = ANY($1::text[]) AND estado = 'ok' AND version NOT LIKE '%-2' AND salida IS NOT NULL
              ORDER BY ocid, clase, leido_at DESC) l
       LEFT JOIN documentos_gcs d ON d.id = l.documentos[1]
       ${CONVOCATORIA("l.ocid")}`, [Array.from(new Set(claves.map((k) => k.ocid)))]);
  const porId = new Map(r.rows.map((x) => [x.id as string, x]));
  return ps.map((p, i) => {
    const x = porId.get(p.origen_id);
    const clase = claves[i]!.clase;
    const texto = x ? textoDeLectura(clase, x.salida, x.banderas ?? []) : "";
    const tipo = ["buena_pro", "bases", "consultas", "contrato"].includes(clase) ? clase : "otro";
    const titulo = tituloFragmento({ tipo, documento: "Lectura de IA", ocid: x?.ocid, objeto: x?.objeto });
    return {
      ...p, ocid: x?.ocid ?? null, entidad_ruc: x?.entidad_ruc?.trim() || null, anio: x?.anio ?? null, tipo, url: x?.url ?? null,
      fragmentos: texto ? trocear(texto).map((t) => ({ titulo, pagina: null, orden: t.orden, texto: t.texto })) : [],
    };
  });
}

async function cargarDictamenes(ps: Pendiente[]): Promise<FuenteLista[]> {
  const r = await poolAdmin.query(
    `SELECT a.id::text AS id, ocid_corto(a.ocid) AS ocid, a.codigo, a.dictamen_markdown AS texto, a.objeto,
            coalesce(nullif(trim(a.entidad_ruc), ''), c.entidad_ruc) AS entidad_ruc,
            coalesce(extract(year FROM a.fecha_buena_pro)::int, c.anio) AS anio
       FROM alertas a ${CONVOCATORIA("a.ocid")}
      WHERE a.id = ANY($1::uuid[]) AND alerta_publicada(a.estado) AND a.codigo NOT LIKE 'ALT-%'`, [ps.map((p) => p.origen_id)]);
  const porId = new Map(r.rows.map((x) => [x.id as string, x]));
  return ps.map((p) => {
    const x = porId.get(p.origen_id);
    const titulo = tituloFragmento({ tipo: "dictamen", documento: x?.codigo ? `alerta ${x.codigo}` : null, ocid: x?.ocid, objeto: x?.objeto });
    return {
      ...p, ocid: x?.ocid ?? null, entidad_ruc: x?.entidad_ruc ?? null, anio: x?.anio ?? null, tipo: "dictamen",
      url: x?.ocid ? `${WEB}/app/contratos/${encodeURIComponent(x.ocid)}?vista=dictamen` : null,
      fragmentos: x ? trocear(x.texto ?? "").map((t) => ({ titulo, pagina: null, orden: t.orden, texto: t.texto })) : [],
    };
  });
}

async function cargarInformes(ps: Pendiente[]): Promise<FuenteLista[]> {
  const r = await poolAdmin.query(
    `SELECT codigo, numero, titulo, modalidad, sector, nivel_gobierno, entidad_nombre, trim(entidad_ruc) AS entidad_ruc,
            departamento, provincia, distrito, responsabilidades, funcionarios, fecha_emision::text AS fecha_emision,
            extract(year FROM fecha_emision)::int AS anio, coalesce(url_resumen, url_pdf) AS url
       FROM informes_control WHERE codigo = ANY($1::text[])`, [ps.map((p) => p.origen_id)]);
  const porId = new Map(r.rows.map((x) => [x.codigo as string, x]));
  return ps.map((p) => {
    const x = porId.get(p.origen_id);
    const titulo = `Informe de control${x?.numero ? ` N° ${x.numero}` : ""}${x?.entidad_nombre ? ` — ${x.entidad_nombre}` : ""}`.slice(0, 400);
    return {
      ...p, ocid: null, entidad_ruc: x?.entidad_ruc || null, anio: x?.anio ?? null, tipo: "informe_control", url: x?.url ?? null,
      fragmentos: x ? [{ titulo, pagina: null, orden: 0, texto: textoDeInforme(x) }] : [],
    };
  });
}

/**
 * Guarda los trozos de varias fuentes en UNA transacción (en DEV, de a una eran ~0,5 s por fuente). Primero las reclama
 * en rag_origen: el upsert sólo toca las que tienen otra huella, y una llamada en paralelo que llegue con las mismas
 * espera el candado de la fila y, al ver la huella nueva, las salta. Después cambia sus trozos: los que no cambiaron
 * (mismo md5) conservan su embedding. Devuelve cuántas fuentes y trozos guardó.
 */
async function guardarLote(lote: FuenteLista[]): Promise<{ fuentes: number; fragmentos: number }> {
  if (!lote.length) return { fuentes: 0, fragmentos: 0 };
  // Siempre en el mismo orden: dos llamadas en paralelo con fuentes en común toman los candados en el mismo orden y
  // no se trancan (en DEV, con 4 a la vez y el orden al azar de cada una, una dio «deadlock detected»).
  const fuentes = [...lote].sort((a, b) => a.origen.localeCompare(b.origen) || (a.origen_id < b.origen_id ? -1 : a.origen_id > b.origen_id ? 1 : 0));
  const cliente = await poolAdmin.connect();
  try {
    await cliente.query("BEGIN");
    const reclamadas = await cliente.query<{ origen: string; origen_id: string }>(
      `INSERT INTO rag_origen (origen, origen_id, hash, fragmentos, troceado_at)
       SELECT o, i, h, n, now() FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS x(o, i, h, n)
       ON CONFLICT (origen, origen_id) DO UPDATE
          SET hash = EXCLUDED.hash, fragmentos = EXCLUDED.fragmentos, troceado_at = now()
        WHERE rag_origen.hash IS DISTINCT FROM EXCLUDED.hash
       RETURNING origen, origen_id`,
      [fuentes.map((f) => f.origen), fuentes.map((f) => f.origen_id), fuentes.map((f) => f.hash), fuentes.map((f) => f.fragmentos.length)]);
    const mias = new Set(reclamadas.rows.map((x) => `${x.origen}|${x.origen_id}`));
    const elegidas = fuentes.filter((f) => mias.has(`${f.origen}|${f.origen_id}`));
    const filas = elegidas.flatMap((f) => f.fragmentos.map((x) => ({ f, x, hash: md5(entradaModelo(x.titulo, x.texto)) })));
    if (elegidas.length) {
      await cliente.query(
        `WITH viejos AS (
           DELETE FROM rag_fragmento f USING unnest($1::text[], $2::text[]) AS c(origen, origen_id)
            WHERE f.origen = c.origen AND f.origen_id = c.origen_id
           RETURNING f.hash, f.embedding),
         reuso AS (SELECT DISTINCT ON (hash) hash, embedding FROM viejos WHERE embedding IS NOT NULL ORDER BY hash)
         INSERT INTO rag_fragmento (origen, origen_id, ocid, entidad_ruc, anio, tipo, url, titulo, pagina, orden, texto, hash,
                                    embedding, indexado_at)
         SELECT t.origen, t.origen_id, t.ocid, t.entidad_ruc, t.anio, t.tipo, t.url, t.titulo, t.pagina, t.orden, t.texto, t.hash,
                r.embedding, CASE WHEN r.embedding IS NOT NULL THEN now() END
           FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::text[], $10::text[], $11::int[],
                       $12::int[], $13::text[], $14::text[])
                AS t(origen, origen_id, ocid, entidad_ruc, anio, tipo, url, titulo, pagina, orden, texto, hash)
           LEFT JOIN reuso r ON r.hash = t.hash`,
        [elegidas.map((f) => f.origen), elegidas.map((f) => f.origen_id),
          filas.map((r) => r.f.origen), filas.map((r) => r.f.origen_id), filas.map((r) => r.f.ocid), filas.map((r) => r.f.entidad_ruc),
          filas.map((r) => r.f.anio), filas.map((r) => r.f.tipo), filas.map((r) => r.f.url), filas.map((r) => r.x.titulo),
          filas.map((r) => r.x.pagina), filas.map((r) => r.x.orden), filas.map((r) => r.x.texto), filas.map((r) => r.hash)]);
    }
    await cliente.query("COMMIT");
    return { fuentes: elegidas.length, fragmentos: filas.length };
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    // Un choque con otra llamada (candado o serialización): estas fuentes quedan para la próxima vuelta.
    if (esErrorPg(e, "40P01", "40001", "55P03")) {
      console.warn(`[rag] guardar: ${(e as Error).message}`);
      return { fuentes: 0, fragmentos: 0 };
    }
    throw e;
  } finally {
    cliente.release();
  }
}

/** Grupos para cargar y guardar juntos: de a 100 fuentes chicas, de a 4 documentos (un texto puede pesar 1 MB). */
export function gruposDe<T extends { origen: string }>(pendientes: T[]): T[][] {
  const grupos: T[][] = [];
  let actual: T[] = [];
  for (const p of pendientes) {
    const tope = p.origen === "documento" ? 4 : 100;
    if (actual.length && (actual[0]!.origen !== p.origen || actual.length >= tope)) {
      grupos.push(actual);
      actual = [];
    }
    actual.push(p);
  }
  if (actual.length) grupos.push(actual);
  return grupos;
}

// ─── Indexar ─────────────────────────────────────────────────────────────────

export interface OpcionesIndexar {
  /** Tope de tiempo de la llamada (el troceo usa hasta el 40 %). */
  segundos?: number;
  /** Tope de embeddings nuevos. */
  embeddings?: number;
  /** Tope de fuentes a trocear. */
  fuentes?: number;
  /** «auto»: las líneas comunes si tienen más de 30 días; «si»: ahora; «no»: nunca. */
  lineas?: "auto" | "si" | "no";
}

export interface ResumenIndexar {
  lineas: unknown;
  borradas: number;
  troceadas: number;
  fragmentosNuevos: number;
  embeddings: { calculados: number; reusados: number; pedidos: number; error: string | null };
  pendientes: { fuentes: number; fragmentos: number };
  segundos: number;
}

export async function indexarRag(ia: IaWorkers | undefined, op: OpcionesIndexar = {}): Promise<ResumenIndexar> {
  const t0 = Date.now();
  const hasta = t0 + Math.max(5, Math.min(110, op.segundos ?? 60)) * 1000;
  const maxEmb = Math.max(0, op.embeddings ?? 4000);
  const maxFuentes = Math.max(0, op.fuentes ?? 200);
  const resumen: ResumenIndexar = {
    lineas: null, borradas: 0, troceadas: 0, fragmentosNuevos: 0,
    embeddings: { calculados: 0, reusados: 0, pedidos: 0, error: null }, pendientes: { fuentes: 0, fragmentos: 0 }, segundos: 0,
  };

  // 1. Las líneas del modelo estándar (~75 s en DEV cuando corre; casi siempre es una lectura de rag_estado).
  if (op.lineas !== "no") {
    resumen.lineas = (await poolAdmin.query("SELECT rag_refrescar_lineas(20, $1) AS r", [op.lineas === "si" ? 0 : 30])).rows[0]?.r ?? null;
    if ((resumen.lineas as { refrescado?: boolean } | null)?.refrescado && op.lineas !== "si") {
      resumen.segundos = Math.round((Date.now() - t0) / 100) / 10;
      return resumen;
    }
  }

  // 2. Sincronizar y trocear.
  resumen.borradas = (await poolAdmin.query(
    `WITH d AS (${DESEADAS})
     DELETE FROM rag_origen o WHERE NOT EXISTS (SELECT 1 FROM d WHERE d.origen = o.origen AND d.origen_id = o.origen_id)`)).rowCount ?? 0;
  const semilla = Math.random().toString(36).slice(2, 8);
  const hastaTroceo = t0 + (hasta - t0) * 0.4;
  if (maxFuentes > 0) {
    const r = await poolAdmin.query<Pendiente & { total: number }>(
      `WITH d AS (${DESEADAS})
       SELECT d.origen, d.origen_id, d.hash, count(*) OVER ()::int AS total
         FROM d LEFT JOIN rag_origen o ON o.origen = d.origen AND o.origen_id = d.origen_id
        WHERE o.hash IS DISTINCT FROM d.hash
        ORDER BY d.prioridad, md5(d.origen_id || $1)
        LIMIT $2`, [semilla, maxFuentes]);
    resumen.pendientes.fuentes = r.rows[0]?.total ?? 0;
    let comunes: Set<string> | null = null;
    for (const grupo of gruposDe(r.rows)) {
      if (Date.now() > hastaTroceo) break;
      const origen = grupo[0]!.origen;
      if (origen === "documento" && !comunes) {
        comunes = new Set((await poolAdmin.query<{ huella: string }>("SELECT huella FROM rag_linea_comun")).rows.map((x) => x.huella));
      }
      const listas = origen === "documento" ? await cargarDocumentos(grupo, comunes ?? new Set())
        : origen === "lectura" ? await cargarLecturas(grupo)
        : origen === "dictamen" ? await cargarDictamenes(grupo)
        : await cargarInformes(grupo);
      const g = await guardarLote(listas);
      resumen.troceadas += g.fuentes;
      resumen.fragmentosNuevos += g.fragmentos;
    }
    resumen.pendientes.fuentes = Math.max(0, resumen.pendientes.fuentes - resumen.troceadas);
  }

  // 3. Embeddings.
  if (!ia) resumen.embeddings.error = "sin Workers AI (binding AI): sólo se troceó";
  while (ia && resumen.embeddings.calculados + resumen.embeddings.reusados < maxEmb && Date.now() < hasta - 6_000) {
    const r = await poolAdmin.query<{ id: string; hash: string; titulo: string | null; texto: string }>(
      `UPDATE rag_fragmento f SET reclamado_at = now()
        WHERE f.id IN (SELECT id FROM rag_fragmento
                        WHERE embedding IS NULL AND (reclamado_at IS NULL OR reclamado_at < now() - interval '5 minutes')
                        ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING f.id::text AS id, f.hash, f.titulo, f.texto`, [Math.min(RECLAMO_LOTE, maxEmb - resumen.embeddings.calculados - resumen.embeddings.reusados)]);
    if (!r.rows.length) break;
    const ids = r.rows.map((x) => x.id);
    // Un trozo igual a otro que ya tiene embedding (las bases administrativas y las integradas, un trozo que no cambió).
    const copiados = await poolAdmin.query(
      `UPDATE rag_fragmento f SET embedding = g.embedding, indexado_at = now(), reclamado_at = NULL
         FROM (SELECT DISTINCT ON (hash) hash, embedding FROM rag_fragmento
                WHERE hash = ANY($1::text[]) AND embedding IS NOT NULL ORDER BY hash) g
        WHERE f.id = ANY($2::bigint[]) AND f.hash = g.hash AND f.embedding IS NULL
       RETURNING f.id::text AS id`, [Array.from(new Set(r.rows.map((x) => x.hash))), ids]);
    resumen.embeddings.reusados += copiados.rowCount ?? 0;
    const hechos = new Set(copiados.rows.map((x) => x.id as string));
    // Uno por md5: los iguales dentro del lote van una sola vez al modelo.
    const porHash = new Map<string, { hash: string; entrada: string; ids: string[] }>();
    for (const x of r.rows) {
      if (hechos.has(x.id)) continue;
      const u = porHash.get(x.hash) ?? { hash: x.hash, entrada: entradaModelo(x.titulo, x.texto), ids: [] };
      u.ids.push(x.id);
      porHash.set(x.hash, u);
    }
    const lotes = lotesPorLargo([...porHash.values()]);
    const listos: { ids: string[]; v: string }[] = [];
    let error: string | null = null;
    for (let i = 0; i < lotes.length && !error; i += PEDIDOS_A_LA_VEZ) {
      const tanda = lotes.slice(i, i + PEDIDOS_A_LA_VEZ);
      const res = await Promise.allSettled(tanda.map((l) => embeberPartiendo(ia, l.map((u) => u.entrada), () => { resumen.embeddings.pedidos++; })));
      res.forEach((x, j) => {
        if (x.status === "fulfilled") x.value.forEach((v, k) => listos.push({ ids: tanda[j]![k]!.ids, v: vectorLiteral(v) }));
        else error = (x.reason as Error)?.message?.slice(0, 300) ?? "error de Workers AI";
      });
    }
    if (listos.length) {
      const pares = listos.flatMap((x) => x.ids.map((id) => [id, x.v] as const));
      await poolAdmin.query(
        `UPDATE rag_fragmento f SET embedding = v.e::halfvec, indexado_at = now(), reclamado_at = NULL
           FROM unnest($1::bigint[], $2::text[]) AS v(id, e) WHERE f.id = v.id`,
        [pares.map((p) => p[0]), pares.map((p) => p[1])]);
      resumen.embeddings.calculados += pares.length;
    }
    if (error) {
      // Lo que no se pudo calcular vuelve a quedar libre para la próxima.
      await poolAdmin.query("UPDATE rag_fragmento SET reclamado_at = NULL WHERE id = ANY($1::bigint[]) AND embedding IS NULL", [ids]);
      resumen.embeddings.error = error;
      break;
    }
  }
  resumen.pendientes.fragmentos = (await poolAdmin.query<{ n: number }>("SELECT count(*)::int AS n FROM rag_fragmento WHERE embedding IS NULL")).rows[0]?.n ?? 0;
  resumen.segundos = Math.round((Date.now() - t0) / 100) / 10;
  return resumen;
}

// ─── Buscar ──────────────────────────────────────────────────────────────────

/** Los embeddings de las últimas preguntas (el MCP repite la misma pregunta con otros filtros). */
const memoria = new Map<string, number[]>();

async function embeddingDeConsulta(ia: IaWorkers, q: string): Promise<number[]> {
  const clave = q.toLowerCase();
  const ya = memoria.get(clave);
  if (ya) return ya;
  const [v] = await embeber(ia, [q], 6_000);
  memoria.set(clave, v!);
  if (memoria.size > 300) memoria.delete(memoria.keys().next().value!);
  return v!;
}

const TS_Y = `websearch_to_tsquery('spanish', translate(lower($1), 'áéíóúüñ', 'aeiouun'))`;
const LEXEMAS = `unnest(tsvector_to_array(to_tsvector('spanish', translate(lower($1), 'áéíóúüñ', 'aeiouun'))))`;
/** Las mismas palabras con O (para el puntaje): una pregunta larga casi nunca tiene TODAS sus palabras en un trozo. */
const TS_O = `(SELECT string_agg(quote_literal(l), ' | ') FROM ${LEXEMAS} l)::tsquery`;
/**
 * Qué trozos entran a la lista por palabras: con 3 palabras o más, los que tienen al menos DOS de ellas (pares con Y,
 * unidos con O). Con cualquiera de ellas, una palabra común («entrega», «servicio») traía 15 mil trozos de 38 mil y
 * ordenarlos costaba 220 ms en DEV; el sentido ya cubre lo que comparte una sola palabra.
 */
const TS_FILTRO = `(SELECT CASE WHEN count(*) >= 3
                     THEN (SELECT string_agg('(' || quote_literal(a.l) || ' & ' || quote_literal(b.l) || ')', ' | ')
                             FROM ${LEXEMAS} a(l) JOIN ${LEXEMAS} b(l) ON a.l < b.l)
                     ELSE string_agg(quote_literal(l), ' | ') END
                FROM ${LEXEMAS} l)::tsquery`;

/** La consulta de los candidatos: las dos listas con los mismos filtros, cada fila con su puesto en cada una. */
export function sqlCandidatos(b: Busqueda, vector: string | null, n: number): { sql: string; vals: unknown[] } {
  const vals: unknown[] = [b.q];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const pv = vector ? p(vector) : null;
  const donde: string[] = [];
  if (b.ocids.length) donde.push(`f.ocid = ANY(${p(b.ocids)}::text[])`);
  if (b.entidad) donde.push(`f.entidad_ruc = ${p(b.entidad)}`);
  if (b.tipos.length) donde.push(`f.tipo = ANY(${p(b.tipos)}::text[])`);
  if (b.origenes.length) donde.push(`f.origen = ANY(${p(b.origenes)}::text[])`);
  if (b.desde) donde.push(`f.anio >= ${p(b.desde)}`);
  if (b.hasta) donde.push(`f.anio <= ${p(b.hasta)}`);
  const filtros = donde.length ? ` AND ${donde.join(" AND ")}` : "";
  const pn = p(n);
  const texto = `texto AS (
      SELECT x.id, x.todas, row_number() OVER (ORDER BY x.todas DESC, x.rango DESC, x.id) AS pos
        FROM (SELECT f.id, f.tsv @@ ${TS_Y} AS todas, ts_rank_cd(f.tsv, ${TS_O}, 32) AS rango
                FROM rag_fragmento f
               WHERE f.tsv @@ ${TS_FILTRO}${filtros}
               ORDER BY 2 DESC, 3 DESC, f.id LIMIT ${pn}) x)`;
  const sentido = pv ? `, sentido AS (
      SELECT y.id, row_number() OVER (ORDER BY y.distancia, y.id) AS pos, 1 - y.distancia AS similitud
        FROM (SELECT f.id, f.embedding <=> ${pv}::halfvec AS distancia
                FROM rag_fragmento f
               WHERE f.embedding IS NOT NULL${filtros}
               ORDER BY f.embedding <=> ${pv}::halfvec LIMIT ${pn}) y)` : "";
  const sql = `WITH ${texto}${sentido}
    SELECT f.id::text AS id, f.origen, f.origen_id, f.ocid, f.entidad_ruc, f.anio, f.tipo, f.titulo, f.url, f.pagina, f.texto,
           t.pos::int AS "posTexto", t.todas, ${pv ? `s.pos::int AS "posSentido", round(s.similitud::numeric, 4)::float AS similitud`
             : `NULL::int AS "posSentido", NULL::float AS similitud`}
      FROM (SELECT id FROM texto${pv ? " UNION SELECT id FROM sentido" : ""}) u
      JOIN rag_fragmento f ON f.id = u.id
      LEFT JOIN texto t ON t.id = u.id
      ${pv ? "LEFT JOIN sentido s ON s.id = u.id" : ""}
     WHERE CASE WHEN f.origen = 'dictamen'
                THEN EXISTS (SELECT 1 FROM alertas a WHERE a.id = f.origen_id::uuid AND alerta_publicada(a.estado) AND a.codigo NOT LIKE 'ALT-%')
                ELSE true END`;
  return { sql, vals };
}

interface FilaCandidato {
  id: string; origen: string; origen_id: string; ocid: string | null; entidad_ruc: string | null; anio: number | null; tipo: string;
  titulo: string | null; url: string | null; pagina: number | null; texto: string;
  posTexto: number | null; posSentido: number | null; similitud: number | null; todas: boolean | null;
}

async function candidatos(b: Busqueda, vector: string | null): Promise<FilaCandidato[]> {
  const { sql, vals } = sqlCandidatos(b, vector, Math.max(40, b.limite * 4));
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN READ ONLY");
    await cliente.query("SET LOCAL statement_timeout = 8000");
    if (vector) {
      // Con filtros, el HNSW sigue buscando hasta juntar los que pide el LIMIT (pgvector 0.8); el orden fino lo da la
      // distancia de cada fila.
      await cliente.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
      await cliente.query("SET LOCAL hnsw.ef_search = 100");
    }
    const r = await cliente.query<FilaCandidato>(sql, vals);
    await cliente.query("COMMIT");
    return r.rows;
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

/** Lo que Vigía sabe de las personas de esos procesos: no sale, sólo le dice a publicar() a quién tapar en la prosa. */
async function personasDe(ocids: string[]): Promise<unknown> {
  if (!ocids.length) return undefined;
  const todos = ocids.flatMap((o) => [o, `ocds-dgv273-seacev3-${o}`]);
  const r = await pool.query(
    `SELECT
       (SELECT jsonb_agg(jsonb_build_object('razonSocial', p->>'nombre', 'ruc', p->>'ruc'))
          FROM documento_lectura l,
               jsonb_array_elements(CASE WHEN jsonb_typeof(l.salida->'postores') = 'array' THEN l.salida->'postores' ELSE '[]'::jsonb END) p
         WHERE l.ocid = ANY($1::text[]) AND l.clase = 'buena_pro' AND l.estado = 'ok') AS "postoresDetalle",
       (SELECT jsonb_agg(l.salida->'contratista') FROM documento_lectura l
         WHERE l.ocid = ANY($1::text[]) AND l.clase = 'contrato' AND l.estado = 'ok'
           AND jsonb_typeof(l.salida->'contratista') = 'object') AS contratista,
       (SELECT jsonb_agg(a.analisis_full - 'agent_trace' - 'llm_metrics' - 'self_evals') FROM alertas a
         WHERE a.ocid = ANY($1::text[]) AND a.analisis_full IS NOT NULL) AS alertas`, [todos]);
  return r.rows[0];
}

export interface ResultadoRag {
  fragmento_id: string; origen: string; tipo: string; titulo: string | null; ocid: string | null; entidad_ruc: string | null;
  anio: number | null; pagina: number | null; url: string | null; ficha: string | null; texto: string;
  puntaje: number; por_texto: number | null; por_significado: number | null; similitud: number | null;
  /** El trozo tiene todas las palabras de la pregunta (sin las vacías), no sólo alguna. */
  todas_las_palabras: boolean;
}

export async function buscarRag(b: Busqueda, ia: IaWorkers | undefined): Promise<{
  q: string; resultados: ResultadoRag[]; total: number; modo: "hibrido" | "texto"; tiempos_ms: { significado: number; consulta: number }; nota: string;
}> {
  const t0 = Date.now();
  let vector: string | null = null;
  let aviso = "";
  if (ia) {
    try {
      vector = vectorLiteral(await embeddingDeConsulta(ia, b.q));
    } catch (e) {
      console.warn(`[rag] embedding de la consulta: ${(e as Error).message}`);
      aviso = " Workers AI no respondió: esta vez la búsqueda fue sólo por palabras (sin significado).";
    }
  } else {
    aviso = " Sin Workers AI en este entorno: la búsqueda fue sólo por palabras (sin significado).";
  }
  const t1 = Date.now();
  let filas: FilaCandidato[];
  try {
    filas = await candidatos(b, vector);
  } catch (e) {
    if (esErrorPg(e, "42P01")) throw e;
    if (!vector) throw e;
    // El índice de vectores falló (o tardó): sólo texto, para no dejar al MCP sin respuesta.
    console.warn(`[rag] búsqueda híbrida: ${(e as Error).message}`);
    aviso = " La búsqueda por significado falló: esta vez fue sólo por palabras.";
    vector = null;
    filas = await candidatos(b, null);
  }
  // Hasta 3 trozos por fuente: con un solo proceso (ocid) las respuestas mezclan bases, acta, contrato y dictamen.
  const t2 = Date.now();
  const elegidos = quitarCasiIguales(fusionarRrf(filas).map((f) => ({ ...f, fuente: `${f.origen}|${f.origen_id}` })), 0.7, b.limite, 3);
  const raices = terminos(b.q);
  const resultados: ResultadoRag[] = elegidos.map((f) => ({
    fragmento_id: f.id, origen: f.origen, tipo: f.tipo, titulo: f.titulo, ocid: f.ocid, entidad_ruc: f.entidad_ruc, anio: f.anio,
    pagina: f.pagina, url: f.url, ficha: f.ocid ? `${WEB}/app/contratos/${encodeURIComponent(f.ocid)}` : null,
    texto: recorte(f.texto, raices, 1200),
    puntaje: Math.round(f.puntaje * 10000) / 10000, por_texto: f.posTexto, por_significado: f.posSentido, similitud: f.similitud,
    todas_las_palabras: f.todas === true,
  }));
  // Lo más parecido siempre sale, trate o no del tema. La similitud no sirve de corte: en DEV, trozos que respondían una
  // pregunta («¿por qué descalificaron…?») quedaron en 0,40-0,47, igual que otros que no trataban el tema. Se avisa sin
  // juzgar: que el MCP lea los trozos antes de darlo por encontrado.
  if (!resultados.length) aviso += " No se encontró nada con esas palabras ni con ese sentido en los documentos indexados.";
  else if (!resultados.some((r) => r.todas_las_palabras)) {
    aviso += " Ningún trozo tiene todas las palabras de la pregunta: lee los trozos antes de dar por encontrado lo que buscas " +
      "(la búsqueda siempre devuelve lo más parecido que hay).";
  }
  const extra = await personasDe(Array.from(new Set(resultados.map((r) => r.ocid).filter((x): x is string => !!x))))
    .catch((e) => { console.warn(`[rag] personas para tapar: ${(e as Error).message}`); return undefined; });
  return publicar({
    q: b.q,
    resultados,
    total: resultados.length,
    modo: vector ? "hibrido" as const : "texto" as const,
    tiempos_ms: { significado: t1 - t0, consulta: t2 - t1 },
    nota: "Trozos de los documentos de cada proceso (bases, actas de buena pro, contratos, pliegos de consultas), de lo que " +
      "Claude leyó de ellos, de los dictámenes publicados de Vigía y de los títulos de los informes de control. Búsqueda " +
      "híbrida: por_texto es el puesto por palabras y por_significado el puesto por sentido (null: esa búsqueda no lo " +
      "trajo). El texto de cada trozo está recortado a la parte más relevante y sin las líneas del modelo estándar de las " +
      "bases; cita con url (el documento en el SEACE) y pagina. Los DNI, los RUC de personas, los correos, los celulares y " +
      "los nombres de las personas que Vigía reconoce van tapados." + aviso,
  }, { extra });
}
