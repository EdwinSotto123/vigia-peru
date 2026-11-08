import { z } from "zod";

/**
 * La bandeja de Gobserva Licitaciones (GET /licitaciones/bandeja, la app: frontend/lib/licitaciones-app). Los mismos
 * filtros y nombres que la URL de la app (frontend/lib/licitaciones-app/filtros.ts), para que el adaptador en vivo pase
 * la búsqueda tal cual: varios tipos y regiones a la vez, procedimiento, plazo de consultas, cinco órdenes y páginas sin
 * el tope de 50 de /oportunidades. Puro (sin base): arma las condiciones SQL y se prueba sin conexión.
 */

export const TIPOS_BANDEJA = ["bienes", "servicios", "obras", "consultoria"] as const;
export const ORDENES_BANDEJA = ["recientes", "valor_desc", "valor_asc", "vence", "entidad"] as const;
export const CONSULTAS_BANDEJA = ["abiertas", "3d", "7d", "vencidas"] as const;

/** El fin del plazo de consultas del OCDS («YYYY-MM-DD») y los días de Lima, como texto comparable. */
export const FIN_CONSULTAS = `substr(c.ocds_payload->'tender'->'enquiryPeriod'->>'endDate', 1, 10)`;
const hoyMas = (n: number) => `to_char((now() AT TIME ZONE 'America/Lima')::date + ${n}, 'YYYY-MM-DD')`;
export const HOY_TEXTO = hoyMas(0);
export const TEXTO_BANDEJA = `immutable_unaccent(upper(concat_ws(' ', c.objeto, e.nombre, c.ocds_payload->'tender'->>'description', (c.ocds_payload->'tender'->'items')::text)))`;
export const PROC_BANDEJA = `c.ocds_payload->'tender'->>'procurementMethodDetails'`;

const lista = <T extends string>(validos: readonly T[] | RegExp) => (t: string | undefined): T[] =>
  [...new Set((t ?? "").split(",").map((x) => x.trim()).filter(Boolean))].filter((x): x is T =>
    validos instanceof RegExp ? validos.test(x) : (validos as readonly string[]).includes(x),
  );

const Esquema = z.object({
  q: z.string().trim().max(120).optional(),
  tipo: z.string().max(80).optional(),
  region: z.string().max(200).optional(),
  proc: z.string().trim().max(80).optional(),
  min: z.coerce.number().min(0).max(1e12).optional(),
  max: z.coerce.number().min(0).max(1e12).optional(),
  pub: z.coerce.number().int().min(1).max(60).catch(30).default(30),
  cons: z.enum(CONSULTAS_BANDEJA).optional().catch(undefined),
  orden: z.enum(ORDENES_BANDEJA).catch("recientes").default("recientes"),
  pag: z.coerce.number().int().min(1).max(2000).catch(1).default(1),
  tam: z.coerce.number().int().catch(20).default(20),
});

export interface QBandeja {
  q: string;
  tipo: (typeof TIPOS_BANDEJA)[number][];
  region: string[];
  proc: string;
  min: number | null;
  max: number | null;
  pub: number;
  cons: (typeof CONSULTAS_BANDEJA)[number] | null;
  orden: (typeof ORDENES_BANDEJA)[number];
  pag: number;
  tam: 10 | 20 | 50;
}

/** Los parámetros de la URL, validados: lo que no se entiende se descarta (nunca un 400 por un filtro raro). */
export function leerBandeja(p: Record<string, string | undefined>): QBandeja | null {
  const r = Esquema.safeParse(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "" && v != null)));
  if (!r.success) return null;
  const d = r.data;
  let min = d.min ?? null;
  let max = d.max ?? null;
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return {
    q: d.q ?? "",
    tipo: lista(TIPOS_BANDEJA)(d.tipo),
    region: lista<string>(/^\d{2}$/)(d.region),
    proc: d.proc ?? "",
    min,
    max,
    pub: d.pub,
    cons: d.cons ?? null,
    orden: d.orden,
    pag: d.pag,
    tam: d.tam === 10 || d.tam === 50 ? d.tam : 20,
  };
}

/** Las condiciones SQL de la búsqueda, sin la dimensión `sin` (para contar sus opciones con los demás filtros puestos). */
export function condicionesBandeja(q: QBandeja, palabras: string[], sin?: "tipo" | "region" | "proc") {
  const conds = [`c.etapa = 'convocada'`, `c.fecha_convocatoria >= current_date - $1::int`, `c.fecha_convocatoria <= current_date`];
  const vals: unknown[] = [q.pub];
  const poner = (v: unknown) => {
    vals.push(v);
    return `$${vals.length}`;
  };
  if (q.tipo.length && sin !== "tipo") conds.push(`c.tipo_contratacion = ANY(${poner(q.tipo)}::text[])`);
  if (q.region.length && sin !== "region") conds.push(`left(c.ubigeo_zona, 2) = ANY(${poner(q.region)}::text[])`);
  if (q.proc && sin !== "proc") conds.push(`${PROC_BANDEJA} = ${poner(q.proc)}`);
  if (q.min != null) conds.push(`c.cuantia_referencial >= ${poner(q.min)}`);
  if (q.max != null) conds.push(`c.cuantia_referencial > 0 AND c.cuantia_referencial <= ${poner(q.max)}`);
  if (q.cons === "abiertas") conds.push(`${FIN_CONSULTAS} >= ${HOY_TEXTO}`);
  if (q.cons === "3d") conds.push(`${FIN_CONSULTAS} BETWEEN ${HOY_TEXTO} AND ${hoyMas(3)}`);
  if (q.cons === "7d") conds.push(`${FIN_CONSULTAS} BETWEEN ${HOY_TEXTO} AND ${hoyMas(7)}`);
  if (q.cons === "vencidas") conds.push(`${FIN_CONSULTAS} < ${HOY_TEXTO}`);
  for (const w of palabras) conds.push(`${TEXTO_BANDEJA} LIKE ${poner(`%${w}%`)}`);
  return { conds, vals };
}

/** Hasta cuántas palabras cuenta el calce del onboarding: las 10 del perfil (MAX_PALABRAS del front) y 6 sugeridas. */
export const MAX_FRASES_CALCE = 16;

/**
 * El calce del onboarding (GET /licitaciones/bandeja/calce): las abiertas con los filtros del perfil (tipos, regiones,
 * montos) leídas UNA vez con su texto (`t`), y por cada palabra su condición sobre ese texto (una frase pide todas sus
 * palabras). `alguna`: calza con cualquiera de las `delPerfil` primeras (las elegidas, como ordena «Para ti»); las demás
 * (sugeridas, aún sin elegir) sólo se cuentan. Sin palabras del perfil, nada calza.
 */
export function sqlCalce(q: QBandeja, frases: string[][], delPerfil = frases.length) {
  const { conds, vals } = condicionesBandeja(q, []);
  const poner = (v: unknown) => {
    vals.push(v);
    return `$${vals.length}`;
  };
  const porFrase = frases.slice(0, MAX_FRASES_CALCE).map((ws) => (ws.length ? ws.map((w) => `b.t LIKE ${poner(`%${w}%`)}`).join(" AND ") : "false"));
  const elegidas = porFrase.slice(0, delPerfil);
  const alguna = elegidas.length ? elegidas.map((x) => `(${x})`).join(" OR ") : "false";
  const base = `SELECT c.ocid, ${TEXTO_BANDEJA} AS t FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc WHERE ${conds.join(" AND ")}`;
  return { base, porFrase, alguna, vals };
}

/** El orden: siempre con desempate, para que una página no repita ni salte filas. */
export function ordenBandeja(o: QBandeja["orden"]): string {
  const desempate = `c.fecha_convocatoria DESC, c.ocid DESC`;
  if (o === "valor_desc") return `c.cuantia_referencial DESC NULLS LAST, ${desempate}`;
  if (o === "valor_asc") return `NULLIF(c.cuantia_referencial, 0) ASC NULLS LAST, ${desempate}`;
  if (o === "vence") return `(${FIN_CONSULTAS} >= ${HOY_TEXTO}) DESC NULLS LAST, ${FIN_CONSULTAS} ASC NULLS LAST, ${desempate}`;
  if (o === "entidad") return `e.nombre ASC NULLS LAST, ${desempate}`;
  return `${desempate}, c.cuantia_referencial DESC NULLS LAST`;
}
