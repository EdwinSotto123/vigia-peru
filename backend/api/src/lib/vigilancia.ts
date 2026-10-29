/**
 * «Ayúdanos a seguir vigilando» y «Cuánto cuesta Vigía» (migración 206): lo que cuesta mantener Vigía este mes, con
 * la fuente de cada cifra; la meta del mes; lo recaudado; y lo que se vigila. Lo usan GET /financiamiento/vigilancia
 * (las dos páginas) y el comprobante de un aporte de apoyo.
 *
 *   · costos: `costos_mes` (la factura de AWS por servicio y la tarifa de Cloudflare; backend/scripts/costos_mes.py).
 *     Un mes sin cerrar va proyectado; el siguiente, al ritmo de hoy, hasta que llegue su factura.
 *   · IA: lo que costó cada lectura a fondo (alertas.analisis_full->'llm_metrics', medido en cada lectura).
 *   · meta: el piso (seguir encendidos) y la completa (además, leer a fondo todos los contratos con banderas graves de
 *     un mes: el promedio de los últimos tres meses cerrados por el costo medio de una lectura). El piso es lo que dice el
 *     equipo que cuesta mantenerla (MANTENERLA_EQUIPO_PEN), o lo facturado si algún mes lo pasa: las facturas de
 *     `costos_mes` son sólo AWS (hoy con créditos) y Cloudflare.
 *   · recaudado: los aportes validados del mes (de apoyo y por contratos), sin el capital semilla de Vigía
 *     (pasarela 'institucional'), que se dice aparte.
 */

import { pool } from "./db.js";
import { Memo } from "./cache.js";
import { alertaNoDemo } from "./publicacion.js";

/**
 * Lo que cuesta de verdad mantener Vigía encendida, dicho por el equipo el 2026-10-29 («S/ 334 al mes es imposible…
 * son cerca de 1,200 soles al mes»): las facturas de AWS y Cloudflare que lee costos_mes.py (S/ 334 en octubre de 2026)
 * son una parte, y lo demás no aparece en ellas. La meta toma el mayor de los dos; se cambia aquí si cambia.
 */
const MANTENERLA_EQUIPO_PEN = 1_200;

/** Sin el del BCRP (la tabla vacía): un tipo de cambio referencial, dicho como tal. */
const TC_REFERENCIAL = 3.75;
const VALIDADA = "estado IN ('pagada', 'en_proceso', 'procesada')";

export interface RubroCosto {
  rubro: string;
  titulo: string;
  proveedor: string;
  detalle: string | null;
  montoUsd: number;
  fuente: "factura" | "estimado";
  parcial: boolean;
  al: string | null;
  nota: string | null;
}

export interface MesVigilancia {
  mes: string;
  costoUsd: number | null;
  iaUsd: number;
  lecturas: number;
  recaudadoPen: number;
}

export interface ResumenVigilancia {
  /** El mes de la meta (AAAA-MM, en Lima). */
  mes: string;
  /** El mes de los costos que se muestran (el mismo, o el último con datos). */
  mesCostos: string | null;
  tipoCambio: { penPorUsd: number; fuente: string; referencial: boolean };
  costos: { rubros: RubroCosto[]; totalUsd: number; totalPen: number } | null;
  ia: { lecturasMes: number; costoMesUsd: number; costoMedioUsd: number | null; lecturasTotal: number; desde: string | null };
  graves: { porMes: number; costoLeerlosUsd: number | null };
  /** `medidoPen`: lo de las facturas de `costos_mes`; `equipoPen`: lo que dice el equipo; el piso es el mayor. */
  meta: { pisoPen: number | null; completaPen: number | null; medidoPen: number | null; equipoPen: number };
  recaudado: { mesPen: number; aportes: number; aportantes: number; mensuales: number; semillaPen: number };
  historial: MesVigilancia[];
  vigilamos: { anio: number; ordenes: number; procesos: number; contratosConBanderas: number; graves: number; menores: number };
  aliados: { nombres: { nombre: string; tipo: string; slug: string | null; periodicidad: string | null }[]; anonimos: number };
}

const memo = new Memo<ResumenVigilancia>({ nombre: "vigilancia", ttlMs: 5 * 60_000, staleMs: 10 * 60_000 });
// Lo que se vigila este año cuenta millones de filas: una vez por hora basta.
const memoVigilamos = new Memo<ResumenVigilancia["vigilamos"]>({ nombre: "vigilancia:vigilamos", ttlMs: 60 * 60_000, staleMs: 60 * 60_000 });

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export function resumenVigilancia(): Promise<ResumenVigilancia> {
  return memo.obtener("resumen", async () => {
    // El mes en Lima y sus bordes como instantes (la base está en UTC).
    const m = (await pool.query(
      `SELECT to_char(d, 'YYYY-MM') AS mes, d::date AS dia,
              (d AT TIME ZONE 'America/Lima') AS ini, ((d + interval '1 month') AT TIME ZONE 'America/Lima') AS fin
         FROM (SELECT date_trunc('month', now() AT TIME ZONE 'America/Lima') AS d) x`)).rows[0];

    const [costos, tc, ia, graves, recaudado, historial, aliados, vigilamos] = await Promise.all([
      pool.query(
        `SELECT to_char(mes, 'YYYY-MM') AS mes, rubro, titulo, proveedor, detalle, monto_usd::float AS "montoUsd", fuente, parcial,
                to_char(al, 'YYYY-MM-DD') AS al, nota
           FROM costos_mes WHERE mes = (SELECT max(mes) FROM costos_mes WHERE mes <= $1)
          ORDER BY monto_usd DESC`, [m.dia]).catch(() => ({ rows: [] as any[] })),
      pool.query(`SELECT pen_por_usd::float AS v, fuente FROM tipo_cambio_mes WHERE mes <= $1 ORDER BY mes DESC LIMIT 1`, [m.dia])
        .catch(() => ({ rows: [] as any[] })),
      pool.query(
        `SELECT count(*) FILTER (WHERE a.analizado_en >= $1 AND a.analizado_en < $2)::int AS "lecturasMes",
                COALESCE(sum((a.analisis_full->'llm_metrics'->>'cost_usd')::numeric) FILTER (WHERE a.analizado_en >= $1 AND a.analizado_en < $2), 0)::float AS "costoMesUsd",
                avg((a.analisis_full->'llm_metrics'->>'cost_usd')::numeric)::float AS "costoMedioUsd",
                count(*)::int AS "lecturasTotal",
                to_char(min(a.analizado_en) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS desde
           FROM alertas a
          WHERE a.analisis_full ? 'llm_metrics' AND (a.analisis_full->'llm_metrics'->>'cost_usd') IS NOT NULL AND ${alertaNoDemo("a")}`,
        [m.ini, m.fin]),
      // Los contratos con banderas graves de un mes: el promedio de los tres últimos meses cerrados.
      pool.query(
        `SELECT round(count(DISTINCT ocid)::numeric / 3)::int AS n FROM casos_cruce
          WHERE severidad = 'alta' AND fecha_buena_pro >= ($1::date - interval '3 months') AND fecha_buena_pro < $1::date`, [m.dia]),
      pool.query(
        `SELECT COALESCE(sum(monto_pen) FILTER (WHERE pasarela IS DISTINCT FROM 'institucional'), 0)::float AS "mesPen",
                count(*) FILTER (WHERE pasarela IS DISTINCT FROM 'institucional')::int AS aportes,
                count(DISTINCT financiador_id) FILTER (WHERE pasarela IS DISTINCT FROM 'institucional')::int AS aportantes,
                COALESCE(sum(monto_pen) FILTER (WHERE pasarela = 'institucional'), 0)::float AS "semillaPen",
                (SELECT count(DISTINCT financiador_id) FROM contribuciones
                  WHERE tipo = 'apoyo' AND periodicidad = 'mensual' AND ${VALIDADA} AND pagada_at >= now() - interval '45 days')::int AS mensuales
           FROM contribuciones WHERE ${VALIDADA} AND pagada_at >= $1 AND pagada_at < $2`, [m.ini, m.fin]),
      // Mes a mes desde el primero con costos (a lo más doce).
      pool.query(
        `WITH meses AS (
           SELECT generate_series(GREATEST((SELECT min(mes) FROM costos_mes), $1::date - interval '11 months'), $1::date, interval '1 month')::date AS mes
         )
         SELECT to_char(x.mes, 'YYYY-MM') AS mes,
                (SELECT sum(monto_usd)::float FROM costos_mes c WHERE c.mes = x.mes) AS "costoUsd",
                (SELECT COALESCE(sum((a.analisis_full->'llm_metrics'->>'cost_usd')::numeric), 0)::float FROM alertas a
                  WHERE a.analisis_full ? 'llm_metrics' AND ${alertaNoDemo("a")}
                    AND a.analizado_en >= (x.mes::timestamp AT TIME ZONE 'America/Lima')
                    AND a.analizado_en < ((x.mes + interval '1 month')::timestamp AT TIME ZONE 'America/Lima')) AS "iaUsd",
                (SELECT count(*)::int FROM alertas a
                  WHERE a.analisis_full ? 'llm_metrics' AND ${alertaNoDemo("a")}
                    AND a.analizado_en >= (x.mes::timestamp AT TIME ZONE 'America/Lima')
                    AND a.analizado_en < ((x.mes + interval '1 month')::timestamp AT TIME ZONE 'America/Lima')) AS lecturas,
                (SELECT COALESCE(sum(monto_pen), 0)::float FROM contribuciones co
                  WHERE co.${VALIDADA} AND co.pasarela IS DISTINCT FROM 'institucional'
                    AND co.pagada_at >= (x.mes::timestamp AT TIME ZONE 'America/Lima')
                    AND co.pagada_at < ((x.mes + interval '1 month')::timestamp AT TIME ZONE 'America/Lima')) AS "recaudadoPen"
           FROM meses x WHERE x.mes IS NOT NULL ORDER BY x.mes`, [m.dia]).catch(() => ({ rows: [] as any[] })),
      // Quiénes sostienen la vigilancia (los dos últimos meses): sólo quien eligió aparecer, sin montos ni ranking.
      pool.query(
        `SELECT DISTINCT ON (f.id) f.nombre_publico AS nombre, f.tipo, f.slug, co.periodicidad, co.pagada_at
           FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id
          WHERE co.tipo = 'apoyo' AND co.${VALIDADA} AND co.pagada_at >= now() - interval '60 days'
            AND f.visible AND f.nombre_publico IS NOT NULL
          ORDER BY f.id, co.pagada_at DESC`).catch(() => ({ rows: [] as any[] })),
      memoVigilamos.obtener("vigilamos", async () => {
        const r = await pool.query(
          `SELECT extract(year FROM current_date)::int AS anio,
                  (SELECT COALESCE(sum(ordenes), 0)::bigint FROM entidad_orden_anual WHERE anio = extract(year FROM current_date)) AS ordenes,
                  (SELECT count(DISTINCT codigo_convocatoria) FROM conosce_adjudicaciones WHERE fecha_buenapro >= date_trunc('year', current_date)) AS procesos,
                  (SELECT count(DISTINCT ocid) FROM casos_cruce WHERE fecha_buena_pro >= date_trunc('year', current_date)) AS "contratosConBanderas",
                  (SELECT count(DISTINCT ocid) FROM casos_cruce WHERE fecha_buena_pro >= date_trunc('year', current_date) AND severidad = 'alta') AS graves,
                  (SELECT count(*) FROM seace_menores WHERE anio = extract(year FROM current_date)) AS menores`);
        const x = r.rows[0];
        return { anio: num(x.anio), ordenes: num(x.ordenes), procesos: num(x.procesos), contratosConBanderas: num(x.contratosConBanderas), graves: num(x.graves), menores: num(x.menores) };
      }).catch(() => ({ anio: new Date().getFullYear(), ordenes: 0, procesos: 0, contratosConBanderas: 0, graves: 0, menores: 0 })),
    ]);

    const tipoCambio = tc.rows[0]
      ? { penPorUsd: num(tc.rows[0].v), fuente: tc.rows[0].fuente as string, referencial: false }
      : { penPorUsd: TC_REFERENCIAL, fuente: "Tipo de cambio referencial (sin el del BCRP)", referencial: true };
    const rubros = costos.rows.map(({ mes: _mes, ...r }) => r as RubroCosto);
    const totalUsd = rubros.reduce((s, r) => s + r.montoUsd, 0);
    const iaRow = ia.rows[0];
    const costoMedioUsd = iaRow.costoMedioUsd == null ? null : num(iaRow.costoMedioUsd);
    const porMes = num(graves.rows[0]?.n);
    const costoLeerlosUsd = costoMedioUsd == null ? null : porMes * costoMedioUsd;
    const pen = (usd: number) => Math.round(usd * tipoCambio.penPorUsd);
    const medidoPen = rubros.length ? pen(totalUsd) : null;
    const pisoPen = Math.max(medidoPen ?? 0, MANTENERLA_EQUIPO_PEN);
    const visibles = aliados.rows.map((r) => ({ nombre: r.nombre as string, tipo: r.tipo as string, slug: (r.slug as string) ?? null, periodicidad: (r.periodicidad as string) ?? null }));
    const anonimos = (await pool.query(
      `SELECT count(DISTINCT co.financiador_id)::int AS n FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id
        WHERE co.tipo = 'apoyo' AND co.${VALIDADA} AND co.pagada_at >= now() - interval '60 days'
          AND NOT (f.visible AND f.nombre_publico IS NOT NULL)`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n as number;

    return {
      mes: m.mes as string,
      mesCostos: costos.rows[0]?.mes ?? null,
      tipoCambio,
      costos: rubros.length ? { rubros, totalUsd: Math.round(totalUsd * 100) / 100, totalPen: pen(totalUsd) } : null,
      ia: { lecturasMes: num(iaRow.lecturasMes), costoMesUsd: num(iaRow.costoMesUsd), costoMedioUsd, lecturasTotal: num(iaRow.lecturasTotal), desde: iaRow.desde ?? null },
      graves: { porMes, costoLeerlosUsd },
      meta: {
        pisoPen,
        completaPen: costoLeerlosUsd != null ? pisoPen + pen(costoLeerlosUsd) : null,
        medidoPen,
        equipoPen: MANTENERLA_EQUIPO_PEN,
      },
      recaudado: {
        mesPen: num(recaudado.rows[0]?.mesPen), aportes: num(recaudado.rows[0]?.aportes), aportantes: num(recaudado.rows[0]?.aportantes),
        mensuales: num(recaudado.rows[0]?.mensuales), semillaPen: num(recaudado.rows[0]?.semillaPen),
      },
      historial: historial.rows.map((r) => ({ mes: r.mes, costoUsd: r.costoUsd == null ? null : num(r.costoUsd), iaUsd: num(r.iaUsd), lecturas: num(r.lecturas), recaudadoPen: num(r.recaudadoPen) })),
      vigilamos,
      aliados: { nombres: visibles, anonimos },
    };
  });
}
