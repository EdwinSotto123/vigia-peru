/**
 * «Para ti» de Gobserva Licitaciones (migración 264, 2026-11-07): las oportunidades abiertas ordenadas por su parecido
 * con una línea de negocio de la cuenta («útiles de oficina y tóner para impresoras»).
 *
 *   indexarOportunidades  el embedding (bge-m3, Workers AI) de cada licitación convocada en 20 días y de cada contrato
 *                         menor abierto, en oportunidad_vector. Lo llama la tarea del cron (/admin/asignar) con tope de
 *                         tiempo; vuelve a calcular el de una oportunidad si cambió su texto (un contrato menor recibe sus
 *                         ítems después) y borra los de más de 30 días.
 *   paraTi                las oportunidades de una línea, de la más parecida a la menos: el coseno entre los embeddings
 *                         llevado a un puntaje de 0 a 100, más un plus si el texto trae una de sus palabras clave. Las
 *                         regiones, los tipos y el rango de valor filtran.
 *
 * El puntaje no es una probabilidad de ganar: dice cuánto se parece lo que se compra a lo que la empresa vende.
 */
import { pool, poolAdmin } from "./db.js";
import { embeber, vectorLiteral, type IaWorkers } from "./rag.js";
import { palabrasBusqueda } from "../routes/personas.js";

/** El texto que se embebe de cada oportunidad: qué se compra, quién y sus ítems (con el nombre del catálogo). */
const TEXTO_PROCESO = `left(concat_ws('. ', c.objeto, e.nombre,
  (SELECT string_agg(DISTINCT concat_ws(' ', i->>'description', i->'classification'->>'description'), '; ')
     FROM jsonb_array_elements(COALESCE(c.ocds_payload->'tender'->'items', '[]'::jsonb)) i)), 1500)`;
const TEXTO_MENOR = `left(concat_ws('. ', x.descripcion, x.entidad,
  (SELECT string_agg(DISTINCT concat_ws(' ', i->>'nombre', i->>'descripcion'), '; ')
     FROM jsonb_array_elements(COALESCE(x.items, '[]'::jsonb)) i)), 1500)`;

const PROCESO_ABIERTO = `c.etapa = 'convocada' AND c.fecha_convocatoria >= current_date - 20 AND c.fecha_convocatoria <= current_date`;
const MENOR_ABIERTO = `x.estado = 'Vigente' AND x.fec_fin_cotizacion > now()`;
const LOTE = 40;

export interface ResumenIndexado {
  pendientes: number;
  calculados: number;
  borrados: number;
  segundos: number;
  error?: string;
}

/** Calcula los embeddings que faltan (los contratos menores primero: cierran antes), con tope de tiempo y de cantidad. */
export async function indexarOportunidades(ia: IaWorkers | undefined, op: { segundos?: number; maximo?: number } = {}): Promise<ResumenIndexado> {
  const t0 = Date.now();
  const segundos = op.segundos ?? 20;
  const r = await poolAdmin.query<{ fuente: string; id: string; texto: string; huella: string }>(
    `WITH t AS (
       SELECT 'menor'::text AS fuente, x.id_prod6::text AS id, ${TEXTO_MENOR} AS texto
         FROM seace_cotizacion x WHERE ${MENOR_ABIERTO}
       UNION ALL
       SELECT 'proceso', c.ocid, ${TEXTO_PROCESO}
         FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc WHERE ${PROCESO_ABIERTO}
     )
     SELECT t.fuente, t.id, t.texto, md5(t.texto) AS huella
       FROM t LEFT JOIN oportunidad_vector v ON v.fuente = t.fuente AND v.id = t.id
      WHERE length(t.texto) > 10 AND v.huella IS DISTINCT FROM md5(t.texto)
      ORDER BY (t.fuente = 'menor') DESC
      LIMIT $1`,
    [op.maximo ?? 400],
  );
  const out: ResumenIndexado = { pendientes: r.rows.length, calculados: 0, borrados: 0, segundos: 0 };
  if (ia) {
    try {
      for (let i = 0; i < r.rows.length && Date.now() - t0 < segundos * 1000; i += LOTE) {
        const lote = r.rows.slice(i, i + LOTE);
        const vecs = await embeber(ia, lote.map((x) => x.texto));
        await poolAdmin.query(
          `INSERT INTO oportunidad_vector (fuente, id, huella, embedding)
           SELECT x.fuente, x.id, x.huella, x.e::halfvec FROM jsonb_to_recordset($1::jsonb) AS x (fuente text, id text, huella text, e text)
           ON CONFLICT (fuente, id) DO UPDATE SET huella = EXCLUDED.huella, embedding = EXCLUDED.embedding, creado = now()`,
          [JSON.stringify(lote.map((x, k) => ({ fuente: x.fuente, id: x.id, huella: x.huella, e: vectorLiteral(vecs[k]) })))],
        );
        out.calculados += lote.length;
      }
    } catch (e) {
      out.error = String((e as Error)?.message ?? e).slice(0, 200);
    }
  } else out.error = "sin Workers AI";
  out.borrados = (await poolAdmin.query(`DELETE FROM oportunidad_vector WHERE creado < now() - interval '30 days'`)).rowCount ?? 0;
  out.segundos = Math.round((Date.now() - t0) / 1000);
  return out;
}

/** El embedding de una línea de negocio: su nombre, lo que vende y sus palabras clave. */
export async function embeberLinea(ia: IaWorkers, l: { nombre: string; descripcion: string; palabras: string[] }): Promise<string> {
  const [v] = await embeber(ia, [[l.nombre, l.descripcion, l.palabras.join(", ")].filter(Boolean).join(". ")]);
  return vectorLiteral(v);
}

/**
 * Del coseno (bge-m3) a un puntaje de 0 a 100. Calibrado el 2026-11-07 con líneas de prueba sobre las oportunidades de
 * ese día: lo que no tiene que ver queda por debajo de ~0,45; lo del mismo rubro, por encima de ~0,6.
 */
const SIM_PISO = 0.42;
const SIM_TECHO = 0.72;
const PLUS_PALABRA = 15;

export function puntajeDe(sim: number, conPalabra: boolean): number {
  const base = Math.max(0, Math.min(1, (sim - SIM_PISO) / (SIM_TECHO - SIM_PISO))) * (100 - PLUS_PALABRA);
  return Math.round(Math.min(100, base + (conPalabra ? PLUS_PALABRA : 0)));
}

export interface OportunidadParaTi {
  fuente: "proceso" | "menor";
  id: string;
  titulo: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  tipo: string | null;
  regiones: string[] | null;
  valor: number | null;
  fecha: string | null;
  cierra: string | null;
  consultasHasta: string | null;
  puntaje: number;
  /** Las palabras clave de la línea que aparecen en la oportunidad. */
  palabras: string[];
}

/** Las oportunidades abiertas de una línea de negocio de la cuenta, de la más parecida a la menos (hasta `limite`). */
export async function paraTi(uid: string, lineaId: number, limite: number): Promise<{ linea: Record<string, unknown>; data: OportunidadParaTi[] } | null> {
  const l = await pool.query<{ id: number; nombre: string; palabras: string[]; tiene: boolean }>(
    `SELECT id, nombre, palabras, embedding IS NOT NULL AS tiene FROM gobserva_lineas WHERE id = $1 AND firebase_uid = $2`, [lineaId, uid]);
  const linea = l.rows[0];
  if (!linea) return null;
  if (!linea.tiene) return { linea, data: [] };
  const r = await pool.query<Omit<OportunidadParaTi, "puntaje" | "palabras"> & { sim: number; texto: string }>(
    `WITH l AS (SELECT * FROM gobserva_lineas WHERE id = $1),
     c AS (
       SELECT 'proceso'::text AS fuente, c.ocid AS id, c.objeto AS titulo, e.nombre AS entidad, c.entidad_ruc::text AS "entidadRuc",
              c.tipo_contratacion AS tipo, ARRAY[left(c.ubigeo_zona, 2)] AS regiones, NULLIF(c.cuantia_referencial, 0)::float AS valor,
              to_char(c.fecha_convocatoria, 'YYYY-MM-DD') AS fecha, NULL::timestamptz AS cierra,
              substr(c.ocds_payload->'tender'->'enquiryPeriod'->>'endDate', 1, 10) AS "consultasHasta",
              1 - (v.embedding <=> l.embedding) AS sim,
              immutable_unaccent(upper(concat_ws(' ', c.objeto, (c.ocds_payload->'tender'->'items')::text))) AS texto
         FROM l, convocatorias c
         JOIN oportunidad_vector v ON v.fuente = 'proceso' AND v.id = c.ocid
         LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
        WHERE ${PROCESO_ABIERTO}
       UNION ALL
       SELECT 'menor', x.id_prod6::text, x.descripcion, x.entidad, x.entidad_ruc,
              CASE x.objeto WHEN 'Bien' THEN 'bienes' WHEN 'Servicio' THEN 'servicios' WHEN 'Obra' THEN 'obras' ELSE 'consultoria' END,
              x.departamentos, NULL::float, to_char(x.fec_publica AT TIME ZONE 'America/Lima', 'YYYY-MM-DD'), x.fec_fin_cotizacion, NULL,
              1 - (v.embedding <=> l.embedding),
              immutable_unaccent(upper(coalesce(x.descripcion, '') || ' ' || coalesce(x.items::text, '')))
         FROM l, seace_cotizacion x
         JOIN oportunidad_vector v ON v.fuente = 'menor' AND v.id = x.id_prod6::text
        WHERE ${MENOR_ABIERTO}
     )
     SELECT c.* FROM c, l
      WHERE (cardinality(l.tipos) = 0 OR c.tipo = ANY(l.tipos))
        AND (cardinality(l.regiones) = 0 OR c.regiones && l.regiones)
        AND (l.monto_min IS NULL OR c.valor IS NULL OR c.valor >= l.monto_min)
        AND (l.monto_max IS NULL OR c.valor IS NULL OR c.valor <= l.monto_max)
      ORDER BY c.sim DESC
      LIMIT 300`,
    [lineaId],
  );
  // Las palabras clave, como las busca la lista (mayúsculas sin tildes).
  const claves = linea.palabras.map((p) => ({ p, w: palabrasBusqueda(p) })).filter((x) => x.w.length);
  const data = r.rows
    .map(({ sim, texto, ...o }) => {
      const palabras = claves.filter((k) => k.w.every((w) => texto.includes(w))).map((k) => k.p);
      return { ...o, puntaje: puntajeDe(Number(sim), palabras.length > 0), palabras };
    })
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, limite);
  return { linea: { id: linea.id, nombre: linea.nombre }, data };
}
