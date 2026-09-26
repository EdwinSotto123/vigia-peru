/**
 * Índice de señales publicadas (fase 2 de la auditoría: A5, C8). Reemplaza lo que /app/hallazgos
 * armaba con `/alertas?limit=500` (universo con tope, truncado en silencio) + un `/contratos/:ocid`
 * por alerta (N+1) para saber agente, cotejo y citas.
 *
 *   GET /senales?severidad=alta|media|baja&regla=&agente=<agente>|sin_registro&entidad=<ruc>&q=
 *               &cotejo=true|false|null&cursor=&limit=25 (máx. 50)
 *   → { data, siguiente, total, facetas, limit }
 *
 *   · data: una fila por señal (bandera de una alerta PUBLICADA y no demo; vista senales_publicas de
 *     la migración 35), sin las copias repetidas de la misma alerta. Campos (camelCase plano):
 *     id, regla, etiqueta, severidad, evidencia (≤ 320), norma, opinionOece, fuenteUrl, agente,
 *     verificada (true | false | null), citas [{pagina, cita, documentoUrl, documentoTitulo, enVigia,
 *     verificada}], alertaCodigo, convocatoria (código corto), objeto, entidad, rucEntidad, proveedor,
 *     rucProveedor, montoSoles, score, region, fechaBuenaPro, nBanderas (señales del contrato).
 *   · Orden: severidad (alta → baja), score DESC, entidad, id. `siguiente` = cursor opaco (keyset
 *     sobre ese orden) o null en la última página.
 *   · facetas: {severidad[], regla[], agente[], cotejo[]} con {valor, etiqueta, n}, más `entidades`
 *     y `contratos` (distintos). Cada dimensión se cuenta con los OTROS filtros, no con el suyo
 *     (facetas cruzadas: ninguna opción lleva a cero). `total` = con todos los filtros.
 *   · Las citas salen del expediente de las alertas de ESTA página (lib/citas.ts), no de todas.
 *   · El texto de la evidencia se redacta en el frontend (Redact), como siempre.
 */

import { Hono } from "hono";
import { z } from "zod";
import { escaparLike, pool } from "../lib/db.js";
import { Memo, responderJson, type Serializado } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { codificarCursor, decodificarCursor, MAX_TOKEN } from "../lib/cursor.js";
import { hayModelosLectura } from "../lib/esquema.js";
import { etiquetaRegla } from "../lib/reglas.js";
import { citadoresDeAlertas } from "../lib/citas.js";

export const senalesRouter = new Hono();

/** Centinela de "sin agente registrado" (frontend/lib/revision.ts, SIN_AGENTE). */
const SIN_AGENTE = "sin_registro";

const COTEJO: Record<string, "true" | "false" | "null"> = {
  true: "true", cotejada: "true", verificada: "true",
  false: "false", no_confirmada: "false", fallida: "false",
  null: "null", sin_cotejo: "null", sin_dato: "null",
};
const ETIQUETA_COTEJO = { true: "Cotejada", false: "No se pudo cotejar", null: "Sin cotejo" } as const;
const ETIQUETA_SEVERIDAD: Record<string, string> = { alta: "Alta", media: "Media", baja: "Baja" };

const SenalesQuery = z.object({
  severidad: z.enum(["alta", "media", "baja"]).optional(),
  regla: z.string().trim().max(120).optional(),
  agente: z.string().trim().max(120).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  q: z.string().trim().max(120).optional(),
  cotejo: z.string().trim().toLowerCase().refine((v) => v in COTEJO, { message: "cotejo inválido" }).optional(),
  cursor: z.string().max(MAX_TOKEN).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
type Q = z.infer<typeof SenalesQuery>;

const memo = new Memo<Serializado>({ nombre: "senales", ttlMs: 60_000, staleMs: 60_000, max: 300 });
const memoTexto = new Memo<Serializado>({ nombre: "senales:texto", ttlMs: 60_000, max: 40 });

senalesRouter.get("/", async (c) => {
  // Sin la migración 35 no hay vista: 404, que el frontend lee como "API vieja" y usa su ruta anterior.
  if (!(await hayModelosLectura())) return c.json({ error: "not_found" }, 404);
  const parsed = SenalesQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q: Q = {
    ...parsed.data,
    regla: parsed.data.regla || undefined, agente: parsed.data.agente || undefined, q: parsed.data.q || undefined,
    cotejo: parsed.data.cotejo ? COTEJO[parsed.data.cotejo] : undefined,
  };
  let claves: (string | number | null)[] | null = null;
  if (q.cursor) {
    claves = decodificarCursor(q.cursor, "sn", 4) ?? decodificarCursor(q.cursor, "sn1", 1);
    if (!claves) return c.json({ error: "invalid_cursor" }, 400);
  }
  return responderJson(c, q.q ? memoTexto : memo, JSON.stringify(q), () => senales(q, claves),
    cachePublico(120, { maxAge: 60, swr: 60 }));
});

type Dim = "severidad" | "regla" | "agente" | "cotejo";

/** Condición de cada dimensión sobre el alias `t` (vista o CTE), con su parámetro ya puesto. */
function condiciones(q: Q, vals: unknown[], t: string): Record<Dim, string | null> {
  const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  return {
    severidad: q.severidad ? `${t}.severidad = ${add(q.severidad)}` : null,
    regla: q.regla ? `${t}.regla = ${add(q.regla)}` : null,
    agente: q.agente ? (q.agente === SIN_AGENTE ? `NULLIF(${t}.agente, '') IS NULL` : `${t}.agente = ${add(q.agente)}`) : null,
    cotejo: q.cotejo ? `${t}.verificada IS ${q.cotejo === "true" ? "TRUE" : q.cotejo === "false" ? "FALSE" : "NULL"}` : null,
  };
}

/** Filtros que no son facetas (entidad y texto libre): acotan el universo de todo, facetas incluidas. */
function universo(q: Q, vals: unknown[], t: string): string[] {
  const w = [`NOT ${t}.repetida`];
  if (q.entidad) { vals.push(q.entidad); w.push(`${t}.entidad_ruc = $${vals.length}`); }
  if (q.q) {
    vals.push(`%${escaparLike(q.q)}%`);
    const p = `$${vals.length}`;
    w.push(`(${t}.objeto ILIKE ${p} OR ${t}.entidad ILIKE ${p} OR ${t}.evidencia ILIKE ${p})`);
  }
  return w;
}

const ORDEN = `s.severidad_orden, -s.score, s.entidad, s.bandera_id`;

async function senales(q: Q, claves: (string | number | null)[] | null) {
  // ─ Página ─
  const vals: unknown[] = [];
  const w = universo(q, vals, "s");
  for (const cond of Object.values(condiciones(q, vals, "s"))) if (cond) w.push(cond);
  if (claves?.length === 4) {
    vals.push(claves[0], claves[1], claves[2], claves[3]);
    const i = vals.length;
    w.push(`(${ORDEN}) > ($${i - 3}::int, -($${i - 2}::int), $${i - 1}::text, $${i}::bigint)`);
  } else if (claves?.length === 1) {
    vals.push(claves[0]);
    w.push(`(${ORDEN}) > (SELECT s2.severidad_orden, -s2.score, s2.entidad, s2.bandera_id FROM senales_publicas s2 WHERE s2.bandera_id = $${vals.length}::bigint)`);
  }
  vals.push(q.limit + 1);
  const pagina = pool.query(
    `SELECT s.bandera_id::text AS id, s.alerta_id::text AS "_alerta", s.severidad_orden AS "_k0",
            s.regla, s.severidad, left(s.evidencia, 320) AS evidencia, s.norma, s.opinion_oece AS "opinionOece",
            s.fuente_url AS "fuenteUrl", s.agente, s.verificada,
            s.alerta_codigo AS "alertaCodigo", COALESCE(ocid_corto(s.ocid), NULLIF(s.codigo_convocatoria, '')) AS convocatoria,
            s.objeto, s.entidad, s.entidad_ruc AS "rucEntidad", s.proveedor, s.proveedor_ruc AS "rucProveedor",
            s.monto_adjudicado::float AS "montoSoles", s.score, s.region,
            to_char(s.fecha_buena_pro, 'YYYY-MM-DD') AS "fechaBuenaPro", s.senales_del_contrato AS "nBanderas"
       FROM senales_publicas s
      WHERE ${w.join(" AND ")}
      ORDER BY ${ORDEN}
      LIMIT $${vals.length}`, vals);

  // ─ Facetas cruzadas + totales, en una sentencia sobre el universo (entidad y q) ─
  const fv: unknown[] = [];
  const uw = universo(q, fv, "s");
  const cond = condiciones(q, fv, "u");
  const salvo = (d: Dim | null) => {
    const cs = (Object.entries(cond) as [Dim, string | null][]).filter(([k, v]) => v && k !== d).map(([, v]) => v as string);
    return cs.length ? `WHERE ${cs.join(" AND ")}` : "";
  };
  const facetas = pool.query<{ dim: string; valor: string | null; n: number }>(
    `WITH u AS MATERIALIZED (
       SELECT s.severidad, s.regla, NULLIF(s.agente, '') AS agente, s.verificada, s.entidad_ruc, s.alerta_id
         FROM senales_publicas s WHERE ${uw.join(" AND ")})
     SELECT 'severidad' AS dim, u.severidad AS valor, count(*)::int AS n FROM u ${salvo("severidad")} GROUP BY 2
     UNION ALL SELECT 'regla', u.regla, count(*)::int FROM u ${salvo("regla")} GROUP BY 2
     UNION ALL SELECT 'agente', u.agente, count(*)::int FROM u ${salvo("agente")} GROUP BY 2
     UNION ALL SELECT 'cotejo', u.verificada::text, count(*)::int FROM u ${salvo("cotejo")} GROUP BY 2
     UNION ALL SELECT 'entidades', NULL, count(DISTINCT u.entidad_ruc)::int FROM u ${salvo(null)}
     UNION ALL SELECT 'contratos', NULL, count(DISTINCT u.alerta_id)::int FROM u ${salvo(null)}
     UNION ALL SELECT 'total', NULL, count(*)::int FROM u ${salvo(null)}`, fv);

  const [p, f] = await Promise.all([pagina, facetas]);
  const hayMas = p.rows.length > q.limit;
  const filas = p.rows.slice(0, q.limit);
  const citadores = await citadoresDeAlertas(filas.map((r) => r._alerta).filter((x): x is string => !!x));
  const data = filas.map(({ _alerta, _k0, ...r }) => ({
    ...r,
    etiqueta: etiquetaRegla(r.regla),
    citas: citadores.get(_alerta)?.citasDeBandera(r) ?? [],
  }));
  let siguiente: string | null = null;
  if (hayMas && filas.length) {
    const u = filas[filas.length - 1];
    siguiente = codificarCursor("sn", [u._k0, u.score, u.entidad, u.id]);
    if (siguiente.length > 500) siguiente = codificarCursor("sn1", [u.id]); // entidad de nombre muy largo
  }

  const orden = (a: { n: number; etiqueta: string }, b: { n: number; etiqueta: string }) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, "es");
  const de = (dim: string) => f.rows.filter((x) => x.dim === dim);
  const uno = (dim: string) => f.rows.find((x) => x.dim === dim)?.n ?? 0;
  return {
    data,
    siguiente,
    total: uno("total"),
    limit: q.limit,
    facetas: {
      severidad: ["alta", "media", "baja"].map((v) => ({ valor: v, etiqueta: ETIQUETA_SEVERIDAD[v], n: de("severidad").find((x) => x.valor === v)?.n ?? 0 }))
        .filter((x) => x.n > 0),
      regla: de("regla").map((x) => ({ valor: x.valor, etiqueta: etiquetaRegla(x.valor ?? ""), n: x.n })).sort(orden),
      // valor null = sin agente registrado (se filtra con agente=sin_registro)
      agente: de("agente").map((x) => ({ valor: x.valor, etiqueta: x.valor ?? "Sin agente registrado", n: x.n })).sort(orden),
      cotejo: de("cotejo").map((x) => {
        const v = x.valor === "true" ? true : x.valor === "false" ? false : null;
        return { valor: v, etiqueta: ETIQUETA_COTEJO[String(v) as "true" | "false" | "null"], n: x.n };
      }).sort(orden),
      entidades: uno("entidades"),
      contratos: uno("contratos"),
    },
  };
}
