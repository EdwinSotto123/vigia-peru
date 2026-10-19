/**
 * OECE Contrataciones Abiertas (API OCDS) → procesos_historicos (migración 68): los procesos ADJUDICADOS antes de
 * 2018, el año en que empiezan los reportes de CONOSCE. Sin esto, el período 2015-2018 de los partidos sólo tenía
 * su último año y la historia de una entidad empezaba en 2018.
 *
 * No va a `convocatorias`: esa es la base de lo que Vigía puede leer (la cola de lectura, el mapa, el
 * financiamiento) y estos procesos ya cerraron. Aquí queda lo mismo que trae CONOSCE: el proceso, su entidad, la
 * fecha, el objeto, el valor referencial, lo adjudicado y el ganador de mayor monto.
 *
 *   GET /api/v1/releasesAfter?size=100&startDate=D&endDate=D (por fecha de convocatoria; los GET salen por el relay,
 *   como en oece_ocds). Cada release viene compilado, con las adjudicaciones del proceso (sin `status`: todas
 *   valen); si un proceso trae más de uno, se juntan sin repetir la misma adjudicación.
 *
 * Un paso por día. Con `desde`/`hasta` (AAAA-MM-DD) se elige el rango; sin ellos no hace nada (es un relleno, no
 * una fuente diaria). `seco`: cuenta y devuelve tres ejemplos, sin escribir.
 */

import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { cortar, dictDe, esDict, get, iterar, o } from "../py.ts";
import type { Dict } from "../py.ts";
import { registrar } from "../registro.ts";
import { CARGA } from "./comun.ts";
import { BASE, PAGINA, dias, obtenerJson, partyComprador, rucComprador, sinEscapes } from "./oece_ocds.ts";

const FUENTE = "oece_historico";
const TOPE_PAGINAS_DIA = 200;

/** El objeto como lo escribe CONOSCE, para que las dos fuentes se filtren igual. */
const OBJETO: Record<string, string> = { goods: "Bien", services: "Servicio", works: "Obra", consultingServices: "Consultoría de Obra" };

export interface ProcesoHistorico {
  codigo: string;
  ocid: string;
  entidad_ruc: string;
  entidad: string | null;
  fecha_convocatoria: string;
  objeto: string | null;
  tipo_proceso: string | null;
  nomenclatura: string | null;
  descripcion: string | null;
  monto_referencial: number | null;
  monto_adjudicado: number;
  moneda: string | null;
  proveedores: Map<string, { nombre: string | null; monto: number }>;
  date: string;
}

/** El texto de un campo, o "" si falta (`str()` de py.ts daría "None"). */
const texto = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const numeroDe = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);
/** "PE-RUC-20100070970" → "20100070970"; un consorcio trae su código del SEACE. */
const idProveedor = (v: unknown) => texto(v).replace(/^PE-RUC-/, "");

/** Suma un release al proceso: los datos del tender del release más reciente y TODAS sus adjudicaciones activas. */
export function sumarRelease(procesos: Map<string, ProcesoHistorico>, rel: Dict): void {
  const ocid = texto(get(rel, "ocid"));
  const tender = dictDe(get(rel, "tender"));
  const codigo = texto(o(get(tender, "id"), ""));
  const party = partyComprador(rel);
  const ruc = rucComprador(party);
  if (!ocid || !codigo || !ruc) return;
  const fecha = texto(o(o(get(dictDe(get(tender, "tenderPeriod")), "startDate"), get(tender, "datePublished")), "")).slice(0, 10);
  const date = texto(o(get(rel, "date"), ""));
  let p = procesos.get(codigo);
  if (!p) {
    p = {
      codigo, ocid, entidad_ruc: ruc, entidad: null, fecha_convocatoria: fecha, objeto: null, tipo_proceso: null, nomenclatura: null,
      descripcion: null, monto_referencial: null, monto_adjudicado: 0, moneda: null, proveedores: new Map(), date: "",
    };
    procesos.set(codigo, p);
  }
  // Los datos del proceso, del release más reciente que traiga tender.
  if (Object.keys(tender).length && date >= p.date) {
    const valor = dictDe(get(tender, "value"));
    p.date = date;
    p.entidad = texto(o(get(dictDe(get(rel, "buyer")), "name"), get(party, "name"))) || p.entidad;
    p.fecha_convocatoria = fecha || p.fecha_convocatoria;
    p.objeto = OBJETO[texto(get(tender, "mainProcurementCategory"))] ?? p.objeto;
    p.tipo_proceso = texto(get(tender, "procurementMethodDetails")) || p.tipo_proceso;
    p.nomenclatura = texto(get(tender, "title")) || p.nomenclatura;
    p.descripcion = cortar(sinEscapes(texto(o(get(tender, "description"), get(tender, "title")))), 600) || p.descripcion;
    p.monto_referencial = numeroDe(o(get(valor, "amount_PEN"), get(valor, "amount"))) ?? p.monto_referencial;
    // Con amount_PEN el monto ya está en soles, aunque el proceso se haya convocado en otra moneda.
    p.moneda = (numeroDe(get(valor, "amount_PEN")) !== null ? "PEN" : texto(get(valor, "currency"))) || p.moneda;
  }
  // Adjudicaciones: las activas (o sin estado), cada proveedor con su monto; una adjudicación repetida entre releases
  // (mismo id) cuenta una vez.
  for (const a of iterar(get(rel, "awards"))) {
    if (!esDict(a)) continue;
    const estado = texto(get(a, "status"));
    if (estado && estado !== "active") continue;
    const valor = dictDe(get(a, "value"));
    const monto = numeroDe(o(get(valor, "amount_PEN"), get(valor, "amount"))) ?? 0;
    const sups = iterar(get(a, "suppliers")).filter(esDict);
    const clave = texto(get(a, "id"));
    for (const s of sups) {
      const id = idProveedor(get(s, "id"));
      if (!id) continue;
      const k = `${clave}|${id}`;
      if (p.proveedores.has(k)) continue;
      p.proveedores.set(k, { nombre: texto(get(s, "name")) || null, monto: sups.length ? monto / sups.length : monto });
    }
  }
}

/** Una fila para COPY de procesos_historicos, o null si el proceso no se adjudicó. */
export function filaHistorica(p: ProcesoHistorico): unknown[] | null {
  if (!p.proveedores.size || !p.fecha_convocatoria) return null;
  const porProveedor = new Map<string, { nombre: string | null; monto: number }>();
  for (const [k, v] of p.proveedores) {
    const id = k.split("|")[1];
    const x = porProveedor.get(id) ?? { nombre: v.nombre, monto: 0 };
    x.monto += v.monto;
    porProveedor.set(id, x);
  }
  const ganador = [...porProveedor.entries()].sort((a, b) => b[1].monto - a[1].monto)[0];
  const adjudicado = [...porProveedor.values()].reduce((s, v) => s + v.monto, 0);
  return [p.codigo, p.ocid, p.entidad_ruc, p.entidad, p.fecha_convocatoria, p.objeto, p.tipo_proceso, p.nomenclatura, p.descripcion,
    p.monto_referencial, adjudicado, p.moneda, porProveedor.size, ganador[1].nombre, ganador[0]];
}

const celda = (v: unknown) => (v === null || v === undefined || v === "" ? "" : `"${String(v).replaceAll('"', '""')}"`);

export async function correrHistorico(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  if (!p.desde || !p.hasta) throw new Error("oece_historico necesita desde y hasta (AAAA-MM-DD)");
  const lista = dias(p.desde.slice(0, 10), p.hasta.slice(0, 10));
  let total = 0;
  let releases = 0;
  const ejemplos: unknown[] = [];
  for (const dia of lista) {
    const r = await step.do(`dia ${dia}`, { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: "20 minutes" }, async () => {
      const procesos = new Map<string, ProcesoHistorico>();
      let url: string | null = `${BASE}/releasesAfter`;
      let params: Record<string, string | number> | undefined = { size: PAGINA, startDate: dia, endDate: dia };
      let paginas = 0;
      let n = 0;
      while (url && paginas < TOPE_PAGINAS_DIA) {
        const datos = await obtenerJson(env, url, params);
        params = undefined;
        if (!datos) break;
        const rels = iterar(get(datos, "releases"));
        if (!rels.length) break;
        paginas++;
        n += rels.length;
        for (const rel of rels) if (esDict(rel)) sumarRelease(procesos, rel);
        const sig = get(dictDe(get(datos, "links")), "next");
        url = typeof sig === "string" && sig ? sig : null;
      }
      const filas = [...procesos.values()].map(filaHistorica).filter((x): x is unknown[] => x !== null);
      if (!p.seco && filas.length) {
        const csv = filas.map((f) => f.map(celda).join(",")).join("\n") + "\n";
        await conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
          // Reemplaza lo del día (por fecha de convocatoria), así un reintento no duplica.
          await db.ejecutar("DELETE FROM procesos_historicos WHERE fecha_convocatoria = $1", [dia]);
          await db.copiar(
            `COPY procesos_historicos (codigo, ocid, entidad_ruc, entidad, fecha_convocatoria, objeto, tipo_proceso, nomenclatura, descripcion,
                                       monto_referencial, monto_adjudicado, moneda, proveedores, proveedor, ruc_proveedor) FROM STDIN WITH (FORMAT csv)`,
            new Blob([csv]).stream());
        }));
      }
      // Los ejemplos como texto: un paso sólo devuelve datos serializables.
      return { paginas, releases: n, procesos: procesos.size, adjudicados: filas.length, ejemplos: p.seco ? filas.slice(0, 3).map((f) => JSON.stringify(f)) : [] };
    });
    total += r.adjudicados;
    releases += r.releases;
    if (ejemplos.length < 3) ejemplos.push(...r.ejemplos.slice(0, 3 - ejemplos.length));
    registrar("INFO", `   ${dia} · ${r.releases} releases · ${r.procesos} procesos · ${r.adjudicados} adjudicados`, { fuente: FUENTE, instancia: id });
  }
  const salida: Record<string, unknown> = { ventana: `${lista[0]} → ${lista[lista.length - 1]}`, dias: lista.length, releases, adjudicados: total };
  if (p.seco) return { ...salida, ejemplos };
  // Los partidos y las entidades leen esto junto con CONOSCE (migración 68).
  salida.partidos = await step.do("refrescar_partido_proceso", CARGA, () =>
    conDb(env.HYPERDRIVE, async (db) => (await db.filas<{ entidades: number; procesos: number }>("SELECT * FROM refrescar_partido_proceso()"))[0]));
  return salida;
}
