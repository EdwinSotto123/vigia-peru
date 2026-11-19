/**
 * La validación externa de las señales (migraciones 401, 404 y 419): la última corrida contra una verdad —lo que observó
 * la Contraloría o lo que el Tribunal declaró fundado o anuló— y, por tipo de bandera, observados / esperados con su
 * intervalo. Sólo agregados: ni procesos ni personas. La usan el panel (GET /admin/senales-validacion) y la ruta pública
 * GET /senales/validacion, que lee el MCP (herramienta `senales`, vista «confiabilidad»).
 */
import type { Pool } from "pg";
import { ETIQUETA_CRUCE } from "./cruces.js";

export type Etiqueta = "contraloria" | "tribunal";
export type Lectura = "pocos_casos" | "mas_de_lo_esperado" | "menos_de_lo_esperado" | "como_lo_esperado";

/** Con menos de 200 procesos el intervalo es demasiado ancho para decir algo; si no, si el intervalo deja fuera al 1. */
export function lecturaOE(procesos: number, oeMin: number | null, oeMax: number | null): Lectura {
  if (procesos < 200) return "pocos_casos";
  if (oeMin != null && oeMin > 1) return "mas_de_lo_esperado";
  if (oeMax != null && oeMax < 1) return "menos_de_lo_esperado";
  return "como_lo_esperado";
}

export async function leerValidacion(db: Pick<Pool, "query">, etiqueta: Etiqueta) {
  const corrida = await db.query(
    `SELECT id, calculado_at AS "calculadoAt", to_char(desde, 'YYYY') AS desde, to_char(hasta, 'YYYY') AS hasta, universo,
            observados, entidades, auc_puntaje::float AS "aucPuntaje", auc_monto::float AS "aucMonto",
            top1_puntaje AS "top1Puntaje", top1_monto AS "top1Monto", top1_azar::float AS "top1Azar",
            top5_puntaje AS "top5Puntaje", top5_monto AS "top5Monto", top5_azar::float AS "top5Azar"
       FROM validacion_corrida WHERE etiqueta = $1 ORDER BY id DESC LIMIT 1`, [etiqueta]);
  const ultima = corrida.rows[0];
  if (!ultima) return { etiqueta, corrida: null, senales: [] as Record<string, unknown>[] };
  const r = await db.query(
    `SELECT v.tipo, v.procesos, v.observados, v.esperados::float AS esperados, v.oe::float AS oe,
            v.oe_min::float AS "oeMin", v.oe_max::float AS "oeMax",
            EXISTS (SELECT 1 FROM senal_en_observacion o WHERE o.tipo = v.tipo) AS "enObservacion"
       FROM validacion_senal v WHERE v.corrida_id = $1 ORDER BY v.oe DESC NULLS LAST, v.procesos DESC`, [ultima.id]);
  return {
    etiqueta,
    corrida: ultima,
    senales: r.rows.map((x) => ({ ...x, etiqueta: ETIQUETA_CRUCE[x.tipo] ?? x.tipo, lectura: lecturaOE(x.procesos, x.oeMin, x.oeMax) })),
  };
}
