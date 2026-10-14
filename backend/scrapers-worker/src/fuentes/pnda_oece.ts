/**
 * Datasets del OECE publicados en la PNDA → crudos versionados en R2 (raw/pnda_oece/<día>/<clave>__<archivo>):
 * port de backend/scrapers/pnda_oece/pipeline.py. Solo descarga y versiona; la carga a la base la hacen
 * los scripts existentes (rnp_normalize, load_sanciones, …) o DuckDB. Un archivo que la PNDA no cambió
 * (misma fecha de modificación) no se vuelve a bajar.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo } from "../almacen.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { DatasetInexistente, obtenerDataset, recursosDeDatos } from "../pnda.ts";
import { registrar } from "../registro.ts";
import { DESCARGA } from "./comun.ts";

const FUENTE = "pnda_oece";
const SLUGS: Record<string, string> = {
  ofertantes: "listado-de-ofertantes-–-organismo-especializado-para-las-contrataciones-públicas-eficientes",
  proveedores_consorcios: "proveedores-y-consorcios-organismo-especializado-para-las-contrataciones-públicas-eficientes",
  sican: "profesionales-y-técnicos-certificados-en-el-sican-–-organismo-especializado-para-las",
  pronunciamientos: "pronunciamientos-–-organismo-especializado-para-las-contrataciones-públicas-eficientes-oece",
  cuadernos_obra: "cuadernos-de-obra-digital-–-organismo-especializado-para-las-contrataciones-públicas",
  cuadernos_obra_asientos: "asientos-de-los-cuadernos-de-obra-digital-–-organismo-especializado-para-las-contrataciones",
  valorizaciones: "valorizaciones-de-obras-registradas-en-el-seace–-organismo-especializado-para-las",
};

export async function correrPndaOece(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const resumen: Record<string, unknown> = {};
  for (const [clave, slug] of Object.entries(SLUGS)) {
    resumen[clave] = await step.do(clave, DESCARGA, async () => {
      let ds;
      try {
        ds = await obtenerDataset(env, slug);
      } catch (e) {
        if (e instanceof DatasetInexistente) {
          registrar("WARNING", e.message, { fuente: FUENTE, instancia: id });
          return { inexistente: true };
        }
        throw e;
      }
      const res = recursosDeDatos(ds);
      registrar("INFO", `   ${clave}: ${res.length} recurso(s), modificado ${ds.modificado}`, { fuente: FUENTE, instancia: id });
      if (p.seco) return { recursos: res.map((r) => r.archivo), modificado: ds.modificado, seco: true };
      const almacen = new Almacen(env, FUENTE);
      const archivos: Record<string, number> = {};
      for (const r of res) {
        const e = await almacen.bajar(r.url, { archivo: `${clave}__${r.archivo}`, modificado: ds.modificado, forzar: p.forzar });
        archivos[nombreArchivo(e)] = e.bytes;
      }
      return { modificado: ds.modificado, archivos };
    });
  }
  registrar("INFO", "   crudos en r2://vigia-peru-crudos/raw/pnda_oece/ — cargar con rnp_normalize.py / load_sanciones.py / DuckDB",
    { fuente: FUENTE, instancia: id });
  return resumen;
}
