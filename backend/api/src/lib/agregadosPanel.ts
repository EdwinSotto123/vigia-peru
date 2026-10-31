/**
 * Las cuentas pesadas del panel, guardadas en `admin_cache` (migración 219): Fuentes (contratos y procesos por año) y
 * Clasificación (tipo × etapa sobre las ~830 mil convocatorias). Antes se hacían en cada visita (2.2 s sólo los procesos
 * de CONOSCE en PROD) y, sumadas a los ~0.4 s que cuesta cada ida y vuelta desde el Perú, el panel se sentía «demasiado
 * lento» (2026-10-31).
 *
 *   agregado(clave)            el último resultado guardado; si no hay, lo calcula ahora y lo guarda. Si el guardado
 *                              tiene más de 50 min (el cron no corrió), se sirve igual y se recalcula en segundo plano.
 *   refrescarAgregadosPanel()  lo llama el cron de cada 10 min (POST /admin/asignar): recalcula, uno por uno, los que
 *                              tienen más de 25 min.
 *
 * Sin la migración 219 (tabla inexistente) todo se calcula en vivo, como antes.
 */

import { esErrorPg, poolAdmin as pool } from "./db.js";
import { enSegundoPlano } from "./plataforma.js";

/** Edad a partir de la cual el cron recalcula una cuenta. */
const VIGENCIA_S = 25 * 60;

const filas = async (sql: string) => (await pool.query(sql)).rows;

const CALCULOS = {
  // Por año: contratos y cuántos tienen ganador, de convocatorias en vivo (sin abrir el jsonb: adjudicaciones o
  // proveedor_ruc); la cola y lo leído, de la vista contratos_agregado. Contratos y ganador de la misma tabla: si salían
  // de fuentes distintas, durante una carga "con ganador" pasaba del 100 %.
  "fuentes.base": () =>
    filas(`SELECT g.anio, g.contratos, COALESCE(a."enCola", 0) AS "enCola", COALESCE(a.leidos, 0) AS leidos, g."conGanador" FROM
             (SELECT extract(year FROM fecha_convocatoria)::int AS anio, count(*)::int AS contratos,
                     count(*) FILTER (WHERE adjudicaciones IS NOT NULL OR proveedor_ruc IS NOT NULL)::int AS "conGanador"
                FROM convocatorias WHERE ocid NOT LIKE 'ocds-vigia-%' GROUP BY 1) g
             LEFT JOIN (SELECT extract(year FROM mes)::int AS anio,
                               COALESCE(sum(n) FILTER (WHERE operativo = 'en_cola'), 0)::int AS "enCola",
                               COALESCE(sum(n) FILTER (WHERE riesgo <> 'sin_analizar'), 0)::int AS leidos
                          FROM contratos_agregado GROUP BY 1) a ON a.anio IS NOT DISTINCT FROM g.anio
            ORDER BY g.anio DESC NULLS LAST`),
  // Procesos adjudicados por año: CONOSCE desde 2018, el OCDS histórico antes.
  "fuentes.procesos": () =>
    filas(`SELECT anio, sum(n)::int AS procesos, string_agg(DISTINCT fuente, ' y ') AS fuente FROM (
             SELECT anio::int AS anio, count(DISTINCT codigo_convocatoria) AS n, 'CONOSCE' AS fuente FROM conosce_adjudicaciones GROUP BY 1
             UNION ALL
             SELECT extract(year FROM fecha_convocatoria)::int, count(*), 'OCDS' FROM procesos_historicos WHERE fecha_convocatoria < DATE '2018-01-01' GROUP BY 1
           ) x GROUP BY anio ORDER BY anio DESC`),
  // Clasificación tipo × etapa (backend/core/clasificacion.py, migración 13): la misma respuesta de siempre, salvo los
  // pendientes de procesamiento, que la ruta cuenta en vivo (cambian a cada rato y la tabla es chica).
  clasificacion: async () => {
    const [celdas, motivos, validaciones, totales] = await Promise.all([
      filas(`SELECT COALESCE(tipo_contratacion, 'sin_clasificar') AS tipo, COALESCE(etapa, 'sin_clasificar') AS etapa,
                    procesable, count(*)::int AS n
               FROM convocatorias GROUP BY 1, 2, 3 ORDER BY n DESC`),
      filas(`SELECT motivo_no_procesable AS motivo, count(*)::int AS n
               FROM convocatorias WHERE procesable = false GROUP BY 1 ORDER BY n DESC LIMIT 10`),
      filas(`SELECT v AS validacion, count(*)::int AS n
               FROM convocatorias, unnest(validaciones_pendientes) v GROUP BY 1 ORDER BY n DESC LIMIT 10`),
      filas(`SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE clasificado_at IS NOT NULL)::int AS clasificadas,
                    count(*) FILTER (WHERE procesable)::int AS procesables,
                    count(*) FILTER (WHERE procesable = false)::int AS "noProcesables",
                    max(clasificado_at) AS "ultimaClasificacion"
               FROM convocatorias`),
    ]);
    const porTipo: Record<string, number> = {};
    const porEtapa: Record<string, number> = {};
    for (const r of celdas) {
      porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + r.n;
      porEtapa[r.etapa] = (porEtapa[r.etapa] ?? 0) + r.n;
    }
    return { totales: totales[0], celdas, porTipo, porEtapa, motivosNoProcesable: motivos, validacionesPendientes: validaciones };
  },
} satisfies Record<string, () => Promise<unknown>>;

export type ClaveAgregado = keyof typeof CALCULOS;

/** Cálculos en vuelo en este isolate: dos visitas que no encuentran la cuenta esperan la misma (como Memo, lib/cache.ts). */
const enVuelo = new Map<ClaveAgregado, { p: Promise<unknown>; t0: number }>();

function recalcular(clave: ClaveAgregado): Promise<unknown> {
  const previo = enVuelo.get(clave);
  // Uno que lleva más de 2 min (colgado) ya no se comparte.
  if (previo && Date.now() - previo.t0 < 120_000) return previo.p;
  const p = (async () => {
    const valor = await CALCULOS[clave]();
    await pool.query(
      `INSERT INTO admin_cache (clave, valor, calculado_at) VALUES ($1, $2, now())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, calculado_at = EXCLUDED.calculado_at`,
      [clave, JSON.stringify(valor)]);
    return valor;
  })().finally(() => {
    if (enVuelo.get(clave)?.p === p) enVuelo.delete(clave);
  });
  enVuelo.set(clave, { p, t0: Date.now() });
  return p;
}

/** El último resultado de `clave` y cuándo se calculó (ver la cabecera). */
export async function agregado<T>(clave: ClaveAgregado): Promise<{ valor: T; calculadoAt: string }> {
  let fila: { valor: T; calculadoAt: Date } | undefined;
  try {
    fila = (await pool.query(`SELECT valor, calculado_at AS "calculadoAt" FROM admin_cache WHERE clave = $1`, [clave])).rows[0];
  } catch (e) {
    // Base sin la migración 219: en vivo, como antes.
    if (!esErrorPg(e, "42P01")) throw e;
    return { valor: (await CALCULOS[clave]()) as T, calculadoAt: new Date().toISOString() };
  }
  if (!fila) return { valor: (await recalcular(clave)) as T, calculadoAt: new Date().toISOString() };
  if (Date.now() - new Date(fila.calculadoAt).getTime() > 2 * VIGENCIA_S * 1000) {
    enSegundoPlano(recalcular(clave).catch((e) => console.warn(`[agregados] ${clave}: ${(e as Error).message}`)));
  }
  return { valor: fila.valor, calculadoAt: new Date(fila.calculadoAt).toISOString() };
}

/** Recalcula, uno por uno (la base es una sola), los agregados con más de 25 min. Devuelve cuáles. */
export async function refrescarAgregadosPanel(): Promise<string[]> {
  const frescos = new Set(
    (await pool.query(`SELECT clave FROM admin_cache WHERE calculado_at > now() - make_interval(secs => $1)`, [VIGENCIA_S])).rows.map((r) => r.clave as string));
  const hechos: string[] = [];
  for (const clave of Object.keys(CALCULOS) as ClaveAgregado[]) {
    if (frescos.has(clave)) continue;
    await recalcular(clave);
    hechos.push(clave);
  }
  return hechos;
}
