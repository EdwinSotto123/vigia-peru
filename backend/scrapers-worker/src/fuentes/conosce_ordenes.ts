/**
 * CONOSCE (OECE), órdenes de compra y de servicio → conosce_ordenes (migración 51), por mes de registro; después
 * rehace ordenes_fraccionadas (posible fraccionamiento: varias órdenes "hasta 8 UIT" a la misma empresa en un
 * mismo día que juntas pasan el tope) y los cruces.
 *
 *   <BASE>/ordenes/<año>/CONOSCE_ORDENESCOMPRA<MES><año>_0.xlsx   (MES: ENERO … SEPTIEMBRE … DICIEMBRE)
 *
 * Unas 275 000 órdenes por mes (60–90 MB de XLSX). Mismo camino que conosce.ts: el archivo a R2, de ahí a la
 * tabla temporal leído por rangos y de ahí al destino; lo que el archivo reemplaza se borra y se vuelve a cargar en
 * una transacción, y si el archivo no cambió (sha256) no se toca. Hay copias viejas "SETIEMBRE" con banner y otra
 * cabecera: no se usan, y si un mes viniera así la carga falla avisando las columnas que faltan.
 *
 * Qué trae cada archivo (`particion`, se reconoce por las fechas de sus filas): hasta el 2026-10-22, `<MES><año>` eran
 * las órdenes registradas en ese mes ("registro": se reemplaza anio/mes). Desde el 2026-10-23 son las registradas en
 * ese año con fecha de emisión en ese mes, de cualquier año ("emision": AGOSTO2026 trae órdenes emitidas en agosto de
 * 2021 a 2026, registradas de enero a octubre de 2026); se reemplazan las del año con ese mes de emisión. En la tabla,
 * anio/mes siguen siendo el año y el mes de registro de cada orden.
 *
 * Semanal (sábados): el año en curso entero, y en enero y febrero también el anterior (con la partición por emisión,
 * cualquier mes del año suma órdenes registradas tarde, y las de antes cambian de estado). Con `desde`/`hasta`
 * (AAAA o AAAA-MM), ese rango; hay datos desde 2018, y hasta diciembre del año en curso.
 *
 * Tras cargar se rehace, desde 6 meses antes del primer mes cargado (una orden se registra después de emitirse):
 * el fraccionamiento y las personas contratadas (migración 91: órdenes por persona y año, y sus señales); las órdenes
 * de cada entidad por año (migración 148, el año en curso), y después los cruces. Con `relleno` (la historia, de a
 * muchos meses) no se rehace nada: se corre una vez al terminar, fuera de Hyperdrive (rehacerlo todo pasa su corte
 * de ~10 min).
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { UA } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, fechaLima, refrescarCasosCruce } from "./comun.ts";
import { BASE, copiarATemporal, describirArreglos, selectDestino } from "./conosce.ts";
import type { Mapa } from "./conosce.ts";
import { mesesEntre } from "./pnda_visitas.ts";

const FUENTE = "conosce_ordenes";
const FUENTE_URL = "https://conosce.osce.gob.pe/buscador/";
const TABLA = "conosce_ordenes";
const PRIMER_MES: [number, number] = [2018, 1];
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
/** Sin estas columnas el archivo no es el reporte de órdenes que se conoce (las fechas dicen además cómo parte los meses). */
const OBLIGATORIAS = ["ruc_entidad", "ruc_contratista", "monto_total_orden_original", "fecha_registro", "fecha_de_emision"];

export const MAPA_ORDENES: Mapa = [
  ["entidad", ["entidad"], "t"],
  ["entidad_ruc", ["ruc_entidad"], "t"],
  ["departamento", ["departamento_entidad"], "t"],
  ["tipo_orden", ["tipoorden", "tipo_orden"], "t"],
  ["nro_orden", ["nro_de_orden", "nro_orden"], "t"],
  ["orden", ["orden"], "t"],
  ["descripcion", ["descripcion_orden"], "t"],
  ["objeto", ["objetocontractual", "objeto_contractual"], "t"],
  ["estado", ["estadocontratacion", "estado_contratacion"], "t"],
  ["tipo_contratacion", ["tipodecontratacion", "tipo_de_contratacion"], "t"],
  ["monto", ["monto_total_orden_original"], "n"],
  ["moneda", ["moneda"], "t"],
  ["ruc_contratista", ["ruc_contratista"], "t"],
  ["contratista", ["nombre_razon_contratista"], "t"],
  ["fecha_registro", ["fecha_registro"], "d"],
  ["fecha_emision", ["fecha_de_emision"], "d"],
  ["fecha_compromiso", ["fecha_compromiso_presupuestal"], "d"],
  ["fecha_notificacion", ["fecha_de_notificacion"], "d"],
];

export const urlOrdenes = (anio: number, mes: number, ext = "xlsx") =>
  `${BASE}/ordenes/${anio}/CONOSCE_ORDENESCOMPRA${MESES[mes - 1]}${anio}_0.${ext}`;

const aMes = (t: string, fin: boolean): [number, number] => {
  const [a, m] = t.split("-").map(Number);
  return [a, m || (fin ? 12 : 1)];
};
const menor = (x: [number, number], y: [number, number]) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);

/**
 * Por defecto el año en curso entero (también los meses que no llegaron: traen lo emitido en esos meses de años
 * anteriores y registrado este año) y, en enero y febrero, también el anterior. Con `desde`/`hasta` (AAAA o AAAA-MM),
 * ese rango, desde 2018 y hasta diciembre del año en curso.
 */
export function mesesOrdenes(p: Pick<ParamsCorrida, "desde" | "hasta">, hoy: string): [number, number][] {
  const [a, m] = aMes(hoy, false);
  const ultimo: [number, number] = [a, 12];
  if (!p.desde && !p.hasta) return mesesEntre([m <= 2 ? a - 1 : a, 1], ultimo);
  let d = aMes(p.desde ?? p.hasta!, false);
  let h = aMes(p.hasta ?? p.desde!, true);
  if (menor(d, PRIMER_MES)) d = PRIMER_MES;
  if (menor(ultimo, h)) h = ultimo;
  return menor(h, d) ? [] : mesesEntre(d, h);
}

/** Cómo parte CONOSCE las órdenes en sus archivos mensuales (ver arriba). */
export type Particion = "registro" | "emision";

/** Filas de un archivo, cuántas se registraron en su mes y cuántas son de su año de registro con su mes de emisión. */
export interface FechasArchivo {
  filas: number;
  registro: number;
  emision: number;
}

/**
 * La partición del archivo según sus fechas. Una de cada 200 filas puede no cuadrar; un archivo de antes con algunas
 * fechas raras sigue siendo "registro" (como siempre), pero si no es claramente ninguna de las dos, null: cargarlo con la
 * regla equivocada duplicaría o borraría cientos de miles de órdenes.
 */
export function particion(c: FechasArchivo): Particion | null {
  if (!c.filas || c.registro >= 0.995 * c.filas) return "registro";
  if (c.emision >= 0.995 * c.filas) return "emision";
  return c.registro >= 0.9 * c.filas ? "registro" : null;
}

/** El mes de registro de la fila (sobre la temporal) y si cae en lo que reemplaza un archivo "emision" ($1 año, $2 mes). */
const MES_REGISTRO = `extract(month FROM conosce_fecha("fecha_registro"))::int`;
const EN_ALCANCE = `extract(year FROM conosce_fecha("fecha_registro")) = $1 AND extract(month FROM conosce_fecha("fecha_de_emision")) = $2`;
const SQL_FECHAS = `SELECT count(*)::int AS filas,
    count(*) FILTER (WHERE r >= make_date($1, $2, 1) AND r < make_date($1, $2, 1) + interval '1 month')::int AS registro,
    count(*) FILTER (WHERE extract(year FROM r) = $1 AND extract(month FROM e) = $2)::int AS emision
  FROM (SELECT conosce_fecha("fecha_registro") AS r, conosce_fecha("fecha_de_emision") AS e FROM _st) x`;

/** Seis meses antes del primer mes cargado, AAAA-MM-01: desde ahí se rehace lo que sale de las órdenes. */
export function desdeRefresco([a, m]: [number, number]): string {
  const total = a * 12 + (m - 1) - 6;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

const PASO = { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" } as const;

export async function correrOrdenes(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const resumen: Record<string, unknown> = {};
  let cargados = 0;
  let primero: [number, number] | null = null;
  for (const [anio, mes] of mesesOrdenes(p, fechaLima())) {
    const clave = `${anio}-${String(mes).padStart(2, "0")}`;
    const r = await step.do(`órdenes ${clave}`, PASO, async () => {
      let archivo: { url: string; modificado: string | null } | null = null;
      for (const ext of ["xlsx", "csv"]) {
        const url = urlOrdenes(anio, mes, ext);
        const h = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
        if (h.ok) {
          const lm = h.headers.get("last-modified");
          archivo = { url, modificado: lm ? new Date(lm).toISOString() : null };
          break;
        }
        if (h.status !== 404) throw new Error(`HTTP ${h.status} en ${url}`);
      }
      if (!archivo) return { sin_archivo: true };
      const almacen = new Almacen(env, FUENTE);
      const e = await almacen.bajar(archivo.url, { modificado: archivo.modificado, forzar: p.forzar, subdir: String(anio) });
      return conDb(env.HYPERDRIVE, async (db) => {
        if (!p.seco && !p.forzar && (await yaCargado(db, FUENTE, clave, e.sha256))) {
          registrar("INFO", `   ${clave}: sin cambios (sha256), se salta`, { fuente: FUENTE, instancia: id });
          return { ya_cargado: true };
        }
        const t0 = Date.now();
        await db.ejecutar("BEGIN");
        try {
          const { columnas, copiadas, arreglos } = await copiarATemporal(env, db, almacen, [e]);
          for (const a of arreglos) registrar("WARNING", `   ${clave}: ${describirArreglos(a)}`, { fuente: FUENTE, instancia: id });
          const arreglado = arreglos.length ? arreglos : undefined;
          const faltan = OBLIGATORIAS.filter((c) => !columnas.includes(c));
          if (faltan.length) throw new Error(`${nombreArchivo(e)}: no es el reporte de órdenes esperado (faltan ${faltan.join(", ")})`);
          const fechas = (await db.filas<FechasArchivo>(SQL_FECHAS, [anio, mes]))[0];
          const forma = particion(fechas);
          if (!forma) {
            throw new Error(`${nombreArchivo(e)}: de ${fechas.filas} órdenes, ${fechas.registro} registradas en ${clave} y ${fechas.emision} ` +
              `registradas en ${anio} y emitidas en ese mes: no se reconoce qué trae el archivo`);
          }
          // Con "emision", las filas de otro año de registro o de otro mes de emisión no se cargan (no hay cómo
          // reemplazarlas después): se cuentan.
          const fuera = forma === "emision" ? fechas.filas - fechas.emision : 0;
          if (fuera) registrar("WARNING", `   ${clave}: ${fuera} órdenes fuera de lo que trae el archivo (año de registro o mes de emisión): no se cargan`, { fuente: FUENTE, instancia: id });
          if (p.seco || !copiadas) {
            // Un mes futuro viene como plantilla vacía: no borra lo que haya.
            await db.ejecutar("ROLLBACK");
            return { seco: p.seco || undefined, vacio: !copiadas || undefined, filas: copiadas, particion: forma, fuera: fuera || undefined, arreglos: arreglado };
          }
          let filas: number;
          if (forma === "registro") {
            const { cols, select } = selectDestino(MAPA_ORDENES, new Set(columnas), { anio, mes });
            await db.ejecutar(`DELETE FROM ${TABLA} WHERE anio = $1 AND mes = $2`, [anio, mes]);
            filas = await db.ejecutar(`INSERT INTO ${TABLA} (${cols}) SELECT ${select} FROM _st`);
            // El RUC o el número de la orden escrito como monto (migración 97): queda NULL.
            await db.ejecutar(`SELECT limpiar_montos_ordenes($1, $2)`, [anio, mes]);
          } else {
            const { cols, select } = selectDestino(MAPA_ORDENES, new Set(columnas), { anio, mes: MES_REGISTRO });
            // De a un mes de registro, en la misma transacción: cada sentencia va por el índice (anio, mes) y es corta. De
            // una vez, el planificador recorría la tabla entera (14 GB, ~2 min) y el INSERT de ~300 mil filas, con otra
            // carga al lado, pasó el corte de Hyperdrive (~10 min) en DEV.
            for (let k = 1; k <= 12; k++) {
              await db.ejecutar(`DELETE FROM ${TABLA} WHERE anio = $1 AND mes = $2 AND extract(month FROM fecha_emision) = $3`, [anio, k, mes]);
            }
            filas = 0;
            for (const { k } of await db.filas<{ k: number }>(`SELECT DISTINCT ${MES_REGISTRO} AS k FROM _st WHERE ${EN_ALCANCE} ORDER BY 1`, [anio, mes])) {
              filas += await db.ejecutar(`INSERT INTO ${TABLA} (${cols}) SELECT ${select} FROM _st WHERE ${EN_ALCANCE} AND ${MES_REGISTRO} = $3`, [anio, mes, k]);
              // El RUC o el número de la orden escrito como monto (migración 97): queda NULL (va por año y mes de registro).
              await db.ejecutar(`SELECT limpiar_montos_ordenes($1, $2)`, [anio, k]);
            }
          }
          await registrarCarga(db, {
            fuente: FUENTE, clave, tabla: TABLA, archivo: nombreArchivo(e), gcs_uri: uri(e), sha256: e.sha256,
            bytes: e.bytes, filas, fuente_url: FUENTE_URL, descargado_at: e.downloaded_at,
          });
          await db.ejecutar("COMMIT");
          const segundos = Math.round((Date.now() - t0) / 1000);
          registrar("INFO", `   ${clave}: ${filas} órdenes → ${TABLA} (${nombreArchivo(e)}, por ${forma}, ${segundos}s)`, { fuente: FUENTE, instancia: id });
          return { filas, segundos, particion: forma, fuera: fuera || undefined, arreglos: arreglado };
        } catch (err) {
          await db.ejecutar("ROLLBACK").catch(() => undefined);
          throw err;
        }
      });
    });
    resumen[clave] = r;
    if (r && "segundos" in r) {
      cargados++;
      if (!primero) primero = [anio, mes];
    }
  }
  if (p.seco || !cargados) return resumen;
  // Las estadísticas de los montos dudosos (migración 102): con las viejas, el planificador dejaba de usar el índice
  // parcial y la API recorría los 29 M de órdenes para contarlos (106 s, el 2026-10-22). Unos segundos (muestra).
  await step.do("analizar montos dudosos", CARGA, () => conDb(env.HYPERDRIVE, (db) => db.ejecutar("ANALYZE conosce_ordenes (monto_dudoso, monto)")));
  if (!primero || p.relleno) return resumen;
  // En la corrida de siempre (el año entero) se rehace como cuando se cargaban los últimos 3 meses: desde 6 meses antes
  // del antepenúltimo. Las personas se rehacen por año (migraciones 91-94): desde el primer mes del año serían dos años,
  // el doble de trabajo, y ya pasan el corte de Hyperdrive con poco.
  const [aHoy, mHoy] = aMes(fechaLima(), false);
  const antepenultimo: [number, number] = mHoy > 2 ? [aHoy, mHoy - 2] : [aHoy - 1, mHoy + 10];
  const desde = desdeRefresco(!p.desde && !p.hasta && menor(primero, antepenultimo) ? antepenultimo : primero);
  const uno = (nombre: string, sql: string, params: unknown[] = []) => step.do(nombre, CARGA, () =>
    conDb(env.HYPERDRIVE, async (db) => Number((await db.filas<{ n: number }>(sql, params))[0]?.n ?? 0)));
  // Una función de una migración que puede no estar aplicada todavía en esa base (despliegue previo a la migración): si
  // falta, el paso devuelve null en vez de tumbar la corrida. Se pregunta antes en otra sentencia: un CASE con
  // to_regprocedure no alcanza, Postgres resuelve el nombre de la función al analizar la consulta y falla igual.
  const siExiste = (nombre: string, firma: string, sql: string) => step.do(nombre, CARGA, () =>
    conDb(env.HYPERDRIVE, async (db) => {
      const [{ existe }] = await db.filas<{ existe: boolean }>("SELECT to_regprocedure($1) IS NOT NULL AS existe", [firma]);
      if (!existe) {
        registrar("WARNING", `   ${firma} no existe en esta base: no se rehace`, { fuente: FUENTE, instancia: id });
        return null;
      }
      return Number((await db.filas<{ n: number }>(sql))[0]?.n ?? 0);
    }));
  resumen.fraccionamiento = await uno("refrescar_fraccionamiento", "SELECT refrescar_fraccionamiento($1::date) AS n", [desde]);
  resumen.personas_ordenes = await uno("refrescar_personas_ordenes", "SELECT refrescar_personas_ordenes($1::date) AS n", [desde]);
  // Sólo las personas con órdenes desde ese año (migración 94) y, en otro paso, el resumen de cada alcance.
  resumen.personas = await uno("refrescar_personas_senales", "SELECT refrescar_personas_senales($1::date) AS n", [desde]);
  // Nepotismo (migración 137): la señal se rehace entera (es barata) tras las señales de persona, y parcha persona_entidad.
  await siExiste("refrescar_nepotismo_senal", "refrescar_nepotismo_senal()", "SELECT refrescar_nepotismo_senal() AS n");
  // Financió la campaña del que gobierna, y lo nacional (el partido del Presidente en el Ejecutivo) para locadores y
  // planilla (migración 177): también tras las señales de persona, y antes del resumen, que las cuenta.
  resumen.senales_politicas = await siExiste("refrescar_senales_politicas", "refrescar_senales_politicas()", "SELECT refrescar_senales_politicas() AS n");
  // Doble planilla, socio de un proveedor, pariente locador, nepotismo en el mismo gobierno y órdenes al borde del tope
  // (migración 179).
  resumen.senales_extra = await siExiste("refrescar_senales_extra", "refrescar_senales_extra()", "SELECT refrescar_senales_extra() AS n");
  // Y cuántos de ellos trabajan en cada entidad, para su bandera (migración 178).
  await siExiste("refrescar_entidad_senal_politica", "refrescar_entidad_senal_politica()", "SELECT refrescar_entidad_senal_politica() AS n");
  resumen.personas_resumen = await uno("refrescar_personas_resumen", "SELECT refrescar_personas_resumen() AS n");
  // Órdenes de cada entidad por año (migración 148): el año en curso, y en enero y febrero también el anterior (las
  // órdenes llegan con atraso; por eso 62 días atrás).
  resumen.entidad_ordenes = await siExiste("refrescar_entidad_ordenes", "refrescar_entidad_ordenes(date,date)",
    "SELECT refrescar_entidad_ordenes(current_date - 62) AS n");
  resumen.cruces = await step.do("refrescar_cruces", CARGA, () =>
    conDb(env.HYPERDRIVE, (db) => db.filas<{ tipo: string; filas: number }>("SELECT * FROM refrescar_cruces()")));
  // Casos cruzados (migración 57) y lo que los alimenta, en pasos separados (comun.ts: refrescarCasosCruce).
  await refrescarCasosCruce(env, step);
  return resumen;
}
