/**
 * El recolector de bases de empleo público (docs/automatizacion_cas.md, fases 1, 2 y 5; migración 271).
 *
 * Lo mismo que hace la ficha cuando alguien la abre (GET /empleo/plazas/:aviso/bases: buscar las bases en la web de la
 * entidad, bajar los PDF a R2 y leerlos con Haiku), pero por lotes y de noche, con prioridad para lo que miran quienes
 * pagan, y anotando lo que se aprende:
 *   - `empleo_fuente`: cada sitio de convocatorias con su familia (lib/empleoFuentes.ts), sus entidades y su último
 *     éxito o error;
 *   - `empleo_documento`: cada documento de cada convocatoria, con su tipo y su copia en R2;
 *   - `empleo_evento`: lo que cambió (documento nuevo, comunicado, resultado publicado, cronograma distinto);
 *   - `empleo_cobertura`: cuántas plazas abiertas de cada fuente tienen documentos y lectura (`medirCobertura`).
 *
 * Modos del lote (`recolectar`):
 *   medir       plazas abiertas nunca buscadas, al azar dentro de su prioridad: busca y guarda los PDF, sin leer.
 *   recolectar  las que faltan o vencieron (no encontradas hace 3 días, error hace 2 horas), las que cierran antes
 *               primero, y las lee con GLM 5.3 flash (Workers AI: ~USD 0,003 unas bases); las escaneadas, con Haiku
 *               sólo si son guardadas (su tope diario aparte).
 *   vigilar     las guardadas que ya tienen bases: vuelve a mirar la página del proceso (sin bajar nada) y anota los
 *               documentos nuevos como eventos (comunicados, resultados).
 *
 * Prioridad: 3 guardada por alguien con plan de Empleo; 2 guardada por cualquiera; 1 en una región que busca alguien con
 * plan; 0 el resto. Cortesía: de a una plaza, intercaladas por sitio y con pausa entre dos del mismo sitio.
 */
import { pool } from "./db.js";
import { buscarBases, pedidor, procesarBases, relayDe, tituloDocumento, type DocumentoBase, type ResultadoBases } from "./basesPlaza.js";
import { clienteHttp, relayCompletoDe } from "./empleoHttp.js";
import { textoPlaza, type PlazaParaResumen } from "./resumenPlaza.js";
import { cambiosCronograma, eventoDeDocumento, fuenteDe, huellaEvento, intercalarPorDominio, soloEnlace, tipoDocumento, type Fuente } from "./empleoFuentes.js";
import { registrar } from "./registro.js";
import { conEnlace } from "./empleoEnlaces.js";

/** Lo que el lote necesita del Worker: el modelo, R2 (DOCUMENTOS) y el relay de Lima. */
export type EnvRecolector = Parameters<typeof procesarBases>[0] & Parameters<typeof relayDe>[0];

/** Lecturas de bases por día como mucho: GLM 5.3 flash en Workers AI (~265 neuronas, ~USD 0,003 unas bases de 14 páginas). */
export const TOPE_LECTURAS_DIA = 1500;
/** Lecturas con Haiku por día como mucho: sólo las escaneadas, que GLM no puede leer (~USD 0,006 a 0,08 cada una). */
export const TOPE_HAIKU_DIA = 100;
const HOY = `(now() AT TIME ZONE 'America/Lima')::date`;

export type FilaPlaza = PlazaParaResumen & { detalle_url: string | null; fecha_inicio: string | null; abierta: boolean };

/** Las columnas de una plaza para buscar sus bases (alias `s` = servir_convocatoria). */
export const COLUMNAS_PLAZA = `s.aviso, s.titulo, s.entidad, s.ubicacion, s.numero, s.vacantes, s.remuneracion::float AS remuneracion,
  to_char(s.fecha_fin, 'YYYY-MM-DD') AS fecha_fin, to_char(s.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, s.detalle_url,
  s.experiencia, s.formacion, s.especializacion, s.conocimiento, s.competencias, (s.fecha_fin >= ${HOY}) AS abierta`;

/** Cuántas bases leyó Haiku en el último día (las escaneadas). */
export async function haikuHoy(): Promise<number> {
  return (await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM servir_resumen WHERE bases_at > now() - interval '1 day' AND bases->>'modelo' = 'claude-haiku-5-5'`)).rows[0]?.n ?? 0;
}

export async function leidasHoy(): Promise<number> {
  return (await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM servir_resumen WHERE bases_at > now() - interval '1 day' AND bases->>'leida_at' IS NOT NULL`)).rows[0]?.n ?? 0;
}

// ─── Lo que se anota ─────────────────────────────────────────────────────────────────────────────────

/** La fuente de la plaza en el registro (se crea la primera vez; la familia y el estado no se pisan después). */
export async function registrarFuente(f: Fuente, entidad: string | null, resultado: "ok" | "error" | null, error?: string): Promise<number> {
  const lista = f.familia === "B" || f.familia === "C" || f.familia === "D" ? f.url : null;
  const r = await pool.query<{ id: number }>(
    `INSERT INTO empleo_fuente AS e (dominio, url_lista, familia, adaptador, necesita_lima, estado, entidades,
                                     ultimo_exito, ultimo_error, ultimo_error_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::text IS NULL THEN '{}'::text[] ELSE ARRAY[$7::text] END,
             CASE WHEN $8 = 'ok' THEN now() END, CASE WHEN $8 = 'error' THEN $9 END, CASE WHEN $8 = 'error' THEN now() END)
     ON CONFLICT (dominio) DO UPDATE SET
       entidades = CASE WHEN $7::text IS NULL OR $7::text = ANY (e.entidades) THEN e.entidades ELSE (e.entidades || $7::text)[1:200] END,
       url_lista = COALESCE(e.url_lista, EXCLUDED.url_lista),
       ultimo_exito = CASE WHEN $8 = 'ok' THEN now() ELSE e.ultimo_exito END,
       ultimo_error = CASE WHEN $8 = 'error' THEN $9 ELSE e.ultimo_error END,
       ultimo_error_at = CASE WHEN $8 = 'error' THEN now() ELSE e.ultimo_error_at END,
       actualizado_at = now()
     RETURNING id`,
    [f.dominio, lista, f.familia, f.adaptador, f.necesitaLima, f.estado, entidad, resultado, (error ?? "").slice(0, 300) || null]);
  return r.rows[0].id;
}

/**
 * Los documentos de una convocatoria: se anotan todos (con su tipo) y, si la convocatoria ya tenía documentos, cada uno
 * nuevo es un evento. De los resultados sólo el enlace (sin copia en R2).
 */
export async function guardarDocumentos(aviso: number, fuenteId: number, docs: DocumentoBase[]): Promise<{ nuevos: number; eventos: number }> {
  if (!docs.length) return { nuevos: 0, eventos: 0 };
  const conv = `cas:${aviso}`;
  const previos = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM empleo_documento WHERE convocatoria = $1`, [conv])).rows[0]?.n ?? 0;
  const filas = docs.map((d) => ({
    url: d.url.slice(0, 2000),
    titulo: (d.titulo || "Documento").slice(0, 300),
    tipo: tipoDocumento(d.titulo, d.url),
    clave_r2: soloEnlace(d.titulo, d.url) ? null : (d.clave ?? null),
  }));
  const r = await pool.query<{ url: string; tipo: string; titulo: string; nuevo: boolean }>(
    `INSERT INTO empleo_documento AS e (fuente_id, convocatoria, aviso, url, titulo, tipo, clave_r2)
     SELECT $1, $2, $3, x.url, x.titulo, x.tipo, x.clave_r2
       FROM jsonb_to_recordset($4::jsonb) AS x (url text, titulo text, tipo text, clave_r2 text)
     ON CONFLICT (convocatoria, url) DO UPDATE SET
       visto_ultimo = now(), titulo = EXCLUDED.titulo, tipo = EXCLUDED.tipo,
       clave_r2 = COALESCE(EXCLUDED.clave_r2, e.clave_r2), fuente_id = COALESCE(e.fuente_id, EXCLUDED.fuente_id)
     RETURNING e.url, e.tipo, e.titulo, (e.xmax = 0) AS nuevo`,
    [fuenteId, conv, aviso, JSON.stringify(filas)]);
  const nuevos = r.rows.filter((x) => x.nuevo);
  let eventos = 0;
  if (previos > 0) {
    for (const d of nuevos) {
      const tipo = eventoDeDocumento(d.tipo as ReturnType<typeof tipoDocumento>);
      eventos += await anotarEvento(conv, tipo, d.url, { titulo: d.titulo, tipo_documento: d.tipo });
    }
  }
  return { nuevos: nuevos.length, eventos };
}

/** Un evento de una convocatoria (con huella: el mismo hecho no se anota dos veces). 1 si es nuevo. */
export async function anotarEvento(conv: string, tipo: string, url: string | null, detalle: Record<string, unknown>): Promise<number> {
  const r = await pool.query(
    `INSERT INTO empleo_evento (convocatoria, tipo, hash, detalle, url, fecha) VALUES ($1, $2, $3, $4::jsonb, $5, ${HOY})
     ON CONFLICT (convocatoria, hash) DO NOTHING`,
    [conv, tipo, huellaEvento(conv, tipo, url, JSON.stringify(detalle)), JSON.stringify(detalle), url]);
  return r.rowCount ?? 0;
}

/**
 * Lo que se encontró de una plaza: `servir_resumen` (lo que lee la ficha), la fuente, los documentos y los eventos (un
 * cronograma que cambió entre dos lecturas). Lo usan la ruta de la ficha y el recolector.
 */
export async function guardarBases(fila: Pick<FilaPlaza, "aviso" | "entidad" | "detalle_url">, r: ResultadoBases): Promise<{ nuevos: number; eventos: number }> {
  const { tokens: _tokens, ...guardar } = r;
  const antes = (await pool.query<{ cronograma: { etapa: string; fecha: string }[] | null }>(
    `SELECT bases->'lectura'->'cronograma' AS cronograma FROM servir_resumen WHERE aviso = $1`, [fila.aviso])).rows[0]?.cronograma ?? null;
  await pool.query(
    `INSERT INTO servir_resumen (aviso, huella, modelo, bases, bases_estado, bases_at) VALUES ($1, '', 'claude-haiku-5-5', $2::jsonb, $3, now())
     ON CONFLICT (aviso) DO UPDATE SET bases = EXCLUDED.bases, bases_estado = EXCLUDED.bases_estado, bases_at = now()`,
    [fila.aviso, JSON.stringify(guardar), r.estado]);
  // Lo demás es la bitácora del recolector: si falla, la ficha igual responde con sus bases.
  try {
    const f = fuenteDe(fila.detalle_url);
    const fuenteId = await registrarFuente(f, fila.entidad, r.estado === "encontradas" ? "ok" : null);
    if (r.estado !== "encontradas") return { nuevos: 0, eventos: 0 };
    const d = await guardarDocumentos(fila.aviso, fuenteId, r.documentos);
    const cambios = cambiosCronograma(antes, r.lectura?.cronograma ?? null);
    if (cambios.length) d.eventos += await anotarEvento(`cas:${fila.aviso}`, "cambio_cronograma", null, { cambios });
    return d;
  } catch (e) {
    registrar("WARNING", `[empleo] la bitácora de la plaza ${fila.aviso} no se guardó: ${(e as Error).message.slice(0, 160)}`);
    return { nuevos: 0, eventos: 0 };
  }
}

/** Antes de procesar una plaza: un intento más (ver ESPERA_INTENTOS). guardarBases lo borra al guardar. */
export async function marcarIntento(aviso: number): Promise<void> {
  await pool.query(
    `INSERT INTO servir_resumen (aviso, huella, modelo, bases, bases_at) VALUES ($1, '', 'claude-haiku-5-5', '{"intentos": 1}'::jsonb, now())
     ON CONFLICT (aviso) DO UPDATE SET bases_at = now(),
       bases = COALESCE(servir_resumen.bases, '{}'::jsonb) || jsonb_build_object('intentos', COALESCE((servir_resumen.bases->>'intentos')::int, 0) + 1)`,
    [aviso]);
}

/** Una búsqueda que falló (el sitio no respondió, el relay estaba apagado): se reintenta en 2 horas. */
export async function guardarError(fila: Pick<FilaPlaza, "aviso" | "entidad" | "detalle_url">, mensaje: string): Promise<void> {
  await pool.query(
    `INSERT INTO servir_resumen (aviso, huella, modelo, bases_estado, bases_at) VALUES ($1, '', 'claude-haiku-5-5', 'error', now())
     ON CONFLICT (aviso) DO UPDATE SET bases_estado = 'error', bases_at = now()`, [fila.aviso]);
  await registrarFuente(fuenteDe(fila.detalle_url), fila.entidad, "error", mensaje).catch(() => undefined);
}

// ─── El lote ─────────────────────────────────────────────────────────────────────────────────────────

export type ModoLote = "medir" | "recolectar" | "vigilar";

export interface OpcionesLote {
  modo: ModoLote;
  limite: number;
  /** Leer las bases (GLM 5.3 flash; las escaneadas de las guardadas, Haiku), dentro de los topes diarios. */
  leer: boolean;
  /** Tiempo máximo del lote. */
  segundos: number;
  /** Pausa entre dos plazas seguidas del mismo sitio. */
  pausaMs?: number;
  /** Para correr varios lotes a la vez sin pisarse: [k, n] toma sólo las plazas con aviso % n = k. */
  particion?: [number, number];
}

export interface ResumenLote {
  modo: ModoLote;
  candidatas: number;
  procesadas: number;
  encontradas: number;
  no_encontradas: number;
  sin_fuente: number;
  errores: number;
  leidas: number;
  /** De ésas, las escaneadas que leyó Haiku. */
  leidas_haiku: number;
  documentos_nuevos: number;
  eventos: number;
  cortado: boolean;
  por_familia: Record<string, { procesadas: number; encontradas: number }>;
  segundos: number;
}

/**
 * Cada vez que el lote toma una plaza le suma un intento (marcarIntento) y lo borra al guardar lo que encontró. Si el
 * Worker se cae en ella (una plaza «venenosa»: el 2026-11-09, unas bases de 47 MB), queda con el intento anotado y espera
 * 2, 4, 8… horas (hasta 128) antes de volver: no traba la cola ni el cron de la madrugada.
 */
const ESPERA_INTENTOS = `(COALESCE((r.bases->>'intentos')::int, 0) = 0
     OR r.bases_at < now() - interval '1 hour' * power(2, least(COALESCE((r.bases->>'intentos')::int, 0), 7)))`;

const CONDICION: Record<ModoLote, string> = {
  medir: `r.bases_estado IS NULL AND ${ESPERA_INTENTOS}`,
  recolectar: `${ESPERA_INTENTOS} AND (r.bases_estado IS NULL
     OR (r.bases_estado = 'error' AND r.bases_at < now() - interval '2 hours')
     OR (r.bases_estado = 'no_encontradas' AND r.bases_at < now() - interval '3 days')
     OR (r.bases_estado = 'encontradas' AND jsonb_typeof(r.bases->'lectura') IS DISTINCT FROM 'object' AND r.bases_at < now() - interval '6 hours'))`,
  vigilar: `g.ref IS NOT NULL AND r.bases_estado = 'encontradas'
     AND COALESCE((r.bases->>'vigilado_at')::timestamptz, r.bases_at) < now() - interval '20 hours'`,
};

const ORDEN: Record<ModoLote, string> = {
  medir: "prioridad DESC, random()",
  recolectar: "prioridad DESC, s.fecha_fin ASC, s.aviso",
  vigilar: "prioridad DESC, s.fecha_fin ASC",
};

/** Las plazas abiertas que tocan, con su prioridad para quienes pagan. */
export function sqlCandidatas(modo: ModoLote, particion?: [number, number]): string {
  const parte = particion && particion[1] > 1 ? ` AND s.aviso % ${Math.trunc(particion[1])} = ${Math.trunc(particion[0])}` : "";
  return `
    WITH pagadores AS (
      SELECT DISTINCT firebase_uid FROM gobserva_planes_cliente WHERE producto = 'empleo' AND estado = 'activa'),
    guardadas AS (
      SELECT g.ref, bool_or(g.firebase_uid IN (SELECT firebase_uid FROM pagadores)) AS de_pagador
        FROM gobserva_guardados g WHERE g.tipo = 'plaza' GROUP BY g.ref),
    regiones AS (
      SELECT DISTINCT upper(replace(substring(b.query from '(?:^|&)region=([^&]+)'), '-', ' ')) AS region
        FROM gobserva_busquedas b JOIN pagadores p USING (firebase_uid) WHERE b.producto = 'empleo')
    SELECT ${COLUMNAS_PLAZA},
           CASE WHEN g.de_pagador THEN 3 WHEN g.ref IS NOT NULL THEN 2
                WHEN EXISTS (SELECT 1 FROM regiones x WHERE x.region IS NOT NULL
                               AND translate(upper(split_part(s.ubicacion, ' - ', 1)), 'ÁÉÍÓÚ', 'AEIOU') = x.region) THEN 1
                ELSE 0 END AS prioridad
      FROM servir_convocatoria s
      LEFT JOIN guardadas g ON g.ref = s.aviso::text
      LEFT JOIN servir_resumen r ON r.aviso = s.aviso
     WHERE s.fecha_fin >= ${HOY} AND ${CONDICION[modo]}${parte}
     ORDER BY ${ORDEN[modo]}
     LIMIT $1`;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un lote de plazas: de a una, intercaladas por sitio, hasta el límite o el tiempo. */
export async function recolectar(env: EnvRecolector, op: OpcionesLote): Promise<ResumenLote> {
  const inicio = Date.now();
  const fin = inicio + op.segundos * 1000;
  const pausa = op.pausaMs ?? 1500;
  // Las de entidades sin enlace (o sólo Facebook) cuyo sitio ya conocemos van con ese enlace (lib/empleoEnlaces.ts).
  const candidatas = (await pool.query<FilaPlaza & { prioridad: number }>(sqlCandidatas(op.modo, op.particion), [Math.max(1, op.limite) * 3])).rows.map(conEnlace);
  const lista = intercalarPorDominio(candidatas, (x) => fuenteDe(x.detalle_url).dominio).slice(0, op.limite);
  const relay = relayDe(env);
  const relayCompleto = relayCompletoDe(env);
  let leidas = op.leer ? await leidasHoy() : TOPE_LECTURAS_DIA;
  let haiku = op.leer ? await haikuHoy() : TOPE_HAIKU_DIA;
  const res: ResumenLote = {
    modo: op.modo, candidatas: candidatas.length, procesadas: 0, encontradas: 0, no_encontradas: 0, sin_fuente: 0, errores: 0,
    leidas: 0, leidas_haiku: 0, documentos_nuevos: 0, eventos: 0, cortado: false, por_familia: {}, segundos: 0,
  };
  let anterior = "";
  for (const fila of lista) {
    if (Date.now() > fin) {
      res.cortado = true;
      break;
    }
    const f = fuenteDe(fila.detalle_url);
    const fam = (res.por_familia[f.familia] ??= { procesadas: 0, encontradas: 0 });
    res.procesadas++;
    fam.procesadas++;
    // Sin web que leer (sin enlace, sólo Facebook, captcha): se anota la fuente y la plaza queda «no encontradas».
    if (f.familia === "E" || f.familia === "G" || f.familia === "H") {
      res.sin_fuente++;
      if (op.modo !== "vigilar") await guardarBases(fila, { estado: "no_encontradas", pagina: null, documentos: [], lectura: null });
      continue;
    }
    if (anterior === f.dominio) await dormir(pausa);
    anterior = f.dominio;
    try {
      if (op.modo === "vigilar") {
        // Sólo la página del proceso: los documentos que aparecieron (comunicados, resultados), sin bajar ni leer.
        const h = await buscarBases(fila, pedidor(9, fetch, relay).pedir, clienteHttp(20, fetch, relayCompleto));
        const docs: DocumentoBase[] = (h?.documentos ?? []).map((e) => ({ titulo: tituloDocumento(e), url: e.url }));
        const fuenteId = await registrarFuente(f, fila.entidad, h ? "ok" : null);
        const d = await guardarDocumentos(fila.aviso, fuenteId, docs);
        await pool.query(`UPDATE servir_resumen SET bases = bases || jsonb_build_object('vigilado_at', now()) WHERE aviso = $1`, [fila.aviso]);
        res.documentos_nuevos += d.nuevos;
        res.eventos += d.eventos;
        if (h) {
          res.encontradas++;
          fam.encontradas++;
        }
        continue;
      }
      await marcarIntento(fila.aviso);
      const puedeLeer = op.leer && leidas < TOPE_LECTURAS_DIA;
      const puedeHaiku = puedeLeer && fila.prioridad >= 2 && haiku < TOPE_HAIKU_DIA;
      const r = await procesarBases(env, { ...fila, datosServir: textoPlaza(fila) }, { puedeLeer, puedeHaiku, relay, relayCompleto });
      if (r.tokens) {
        leidas++;
        res.leidas++;
        if (r.modelo === "claude-haiku-5-5") {
          haiku++;
          res.leidas_haiku++;
        }
      }
      const d = await guardarBases(fila, r);
      res.documentos_nuevos += d.nuevos;
      res.eventos += d.eventos;
      if (r.estado === "encontradas") {
        res.encontradas++;
        fam.encontradas++;
      } else res.no_encontradas++;
    } catch (e) {
      res.errores++;
      await guardarError(fila, (e as Error).message).catch(() => undefined);
    }
  }
  res.segundos = Math.round((Date.now() - inicio) / 1000);
  registrar("INFO", `[empleo] lote ${op.modo}: ${res.procesadas} plazas, ${res.encontradas} con bases, ${res.errores} errores, ${res.leidas} leídas (${res.leidas_haiku} con Haiku), ${res.eventos} eventos`);
  return res;
}

// ─── La cobertura ────────────────────────────────────────────────────────────────────────────────────

export interface CoberturaFuente {
  dominio: string;
  familia: string;
  estado: string;
  adaptador: string;
  necesita_lima: boolean;
  entidades: string[];
  plazas_90d: number;
  abiertas: number;
  con_documentos: number;
  con_lectura: number;
  errores: number;
}

/** Agrupa las plazas de los últimos 90 días por fuente (puro, para las pruebas). */
export function agruparCobertura(
  filas: { entidad: string | null; ubicacion?: string | null; detalle_url: string | null; abierta: boolean; bases_estado: string | null; con_lectura: boolean }[],
): CoberturaFuente[] {
  const m = new Map<string, CoberturaFuente & { _ent: Set<string> }>();
  for (const x of filas) {
    const f = fuenteDe(conEnlace(x).detalle_url);
    let c = m.get(f.dominio);
    if (!c) {
      c = { dominio: f.dominio, familia: f.familia, estado: f.estado, adaptador: f.adaptador, necesita_lima: f.necesitaLima, entidades: [],
        plazas_90d: 0, abiertas: 0, con_documentos: 0, con_lectura: 0, errores: 0, _ent: new Set() };
      m.set(f.dominio, c);
    }
    c.plazas_90d++;
    if (x.entidad) c._ent.add(x.entidad);
    if (!x.abierta) continue;
    c.abiertas++;
    if (x.bases_estado === "encontradas") c.con_documentos++;
    if (x.con_lectura) c.con_lectura++;
    if (x.bases_estado === "error") c.errores++;
  }
  return [...m.values()]
    .map(({ _ent, ...c }) => ({ ...c, entidades: [..._ent].sort().slice(0, 200) }))
    .sort((a, b) => b.plazas_90d - a.plazas_90d);
}

/** Mide la cobertura de hoy: llena el registro de fuentes con todas las que publican y anota `empleo_cobertura`. */
export async function medirCobertura(): Promise<{ fuentes: number; abiertas: number; con_documentos: number; con_lectura: number; por_familia: Record<string, { fuentes: number; abiertas: number; con_documentos: number; con_lectura: number }> }> {
  const filas = (await pool.query<{ entidad: string | null; ubicacion: string | null; detalle_url: string | null; abierta: boolean; bases_estado: string | null; con_lectura: boolean }>(
    `SELECT s.entidad, s.ubicacion, s.detalle_url, (s.fecha_fin >= ${HOY}) AS abierta, r.bases_estado,
            COALESCE(jsonb_typeof(r.bases->'lectura') = 'object', false) AS con_lectura
       FROM servir_convocatoria s LEFT JOIN servir_resumen r ON r.aviso = s.aviso
      WHERE s.fecha_inicio >= ${HOY} - 90 OR s.fecha_fin >= ${HOY}`)).rows;
  const fuentes = agruparCobertura(filas);
  const json = JSON.stringify(fuentes.map((c) => ({ ...c, url_lista: null })));
  await pool.query(
    `INSERT INTO empleo_fuente AS e (dominio, familia, adaptador, estado, necesita_lima, entidades, plazas_90d)
     SELECT x.dominio, x.familia, x.adaptador, x.estado, x.necesita_lima, ARRAY(SELECT jsonb_array_elements_text(x.entidades)), x.plazas_90d
       FROM jsonb_to_recordset($1::jsonb) AS x (dominio text, familia text, adaptador text, estado text, necesita_lima boolean, entidades jsonb, plazas_90d int)
     ON CONFLICT (dominio) DO UPDATE SET entidades = EXCLUDED.entidades, plazas_90d = EXCLUDED.plazas_90d, actualizado_at = now()`,
    [json]);
  await pool.query(
    `INSERT INTO empleo_cobertura AS c (fecha, fuente_id, familia, abiertas, con_documentos, con_lectura, con_guia, errores, sin_web)
     SELECT ${HOY}, e.id, x.familia, x.abiertas, x.con_documentos, x.con_lectura,
            CASE WHEN EXISTS (SELECT 1 FROM empleo_guia g WHERE g.fuente_id = e.id) THEN x.abiertas ELSE 0 END,
            x.errores, CASE WHEN x.familia IN ('E', 'G', 'H') THEN x.abiertas ELSE 0 END
       FROM jsonb_to_recordset($1::jsonb) AS x (dominio text, familia text, abiertas int, con_documentos int, con_lectura int, errores int)
       JOIN empleo_fuente e ON e.dominio = x.dominio
     ON CONFLICT (fecha, fuente_id) DO UPDATE SET familia = EXCLUDED.familia, abiertas = EXCLUDED.abiertas,
       con_documentos = EXCLUDED.con_documentos, con_lectura = EXCLUDED.con_lectura, con_guia = EXCLUDED.con_guia,
       errores = EXCLUDED.errores, sin_web = EXCLUDED.sin_web, medido_at = now()`,
    [json]);
  const por_familia: Record<string, { fuentes: number; abiertas: number; con_documentos: number; con_lectura: number }> = {};
  for (const c of fuentes) {
    const p = (por_familia[c.familia] ??= { fuentes: 0, abiertas: 0, con_documentos: 0, con_lectura: 0 });
    p.fuentes++;
    p.abiertas += c.abiertas;
    p.con_documentos += c.con_documentos;
    p.con_lectura += c.con_lectura;
  }
  const suma = (k: "abiertas" | "con_documentos" | "con_lectura") => fuentes.reduce((a, c) => a + c[k], 0);
  return { fuentes: fuentes.length, abiertas: suma("abiertas"), con_documentos: suma("con_documentos"), con_lectura: suma("con_lectura"), por_familia };
}
