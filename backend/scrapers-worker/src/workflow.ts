/**
 * Workflow `CorrerFuente`: una corrida de una fuente (lo que en GCP era una ejecución del Cloud Run Job
 * `scraper-<fuente>`). Cada fuente arma sus pasos en src/fuentes/<fuente>.ts: las lecturas y
 * descargas se reintentan; las cargas son idempotentes (upsert o reemplazo por clave en una
 * transacción), así que un reintento no duplica nada.
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "./config.ts";
import { colo, diagnosticar } from "./diagnostico.ts";
import { correrJne } from "./fuentes/jne_infogob.ts";
import { correrMef, correrMefCargarGasto, correrMefDetalle } from "./fuentes/mef_presupuesto.ts";
import { correrConosce } from "./fuentes/conosce.ts";
import { correrOrdenes } from "./fuentes/conosce_ordenes.ts";
import { correrGastos } from "./fuentes/onpe_gastos.ts";
import { correrOcds } from "./fuentes/oece_ocds.ts";
import { correrHistorico } from "./fuentes/oece_historico.ts";
import { correrDocumentos } from "./fuentes/documentos.ts";
import { correrOnpe } from "./fuentes/onpe_claridad.ts";
import { correrDji } from "./fuentes/pnda_dji.ts";
import { correrPndaOece } from "./fuentes/pnda_oece.ts";
import { correrSancionados } from "./fuentes/pnda_sancionados.ts";
import { correrVisitas } from "./fuentes/pnda_visitas.ts";
import { registrar } from "./registro.ts";

type Corredor = (env: Env, p: ParamsCorrida, step: WorkflowStep, id: string) => Promise<unknown>;

export const FUENTES: Record<string, Corredor> = {
  oece_ocds: correrOcds,
  oece_historico: correrHistorico,
  documentos: correrDocumentos,
  pnda_sancionados: correrSancionados,
  pnda_visitas: correrVisitas,
  pnda_dji: correrDji,
  jne_infogob: correrJne,
  pnda_oece: correrPndaOece,
  mef_presupuesto: correrMef,
  mef_detalle: correrMefDetalle,
  mef_cargar_gasto: correrMefCargarGasto,
  conosce: correrConosce,
  conosce_ordenes: correrOrdenes,
  onpe_gastos: correrGastos,
  onpe_claridad: correrOnpe,
};

export class CorrerFuente extends WorkflowEntrypoint<Env, ParamsCorrida> {
  async run(event: Readonly<WorkflowEvent<ParamsCorrida>>, step: WorkflowStep): Promise<unknown> {
    const p = event.payload;
    const id = event.instanceId;
    const t0 = Date.now();
    registrar("INFO", `━━ ${p.fuente}${p.seco ? " (en seco)" : ""} · ${p.origen}`, { fuente: p.fuente, instancia: id });
    if (p.fuente === "diagnostico") {
      return step.do("diagnostico", { retries: { limit: 0, delay: 0 }, timeout: "5 minutes" }, async () => ({
        colo_paso: await colo(),
        ...(await diagnosticar(this.env, new Set(["pnda", "relay", "oece", "mef_vel"]))),
      }));
    }
    const correr = FUENTES[p.fuente];
    if (!correr) throw new Error(`fuente desconocida: ${p.fuente}`);
    try {
      const r = await correr(this.env, p, step, id);
      registrar("INFO", `✓ ${p.fuente} en ${Math.round((Date.now() - t0) / 1000)}s`, { fuente: p.fuente, instancia: id });
      return r;
    } catch (e) {
      registrar("ERROR", `✗ ${p.fuente}: ${String((e as Error)?.message ?? e)}`, { fuente: p.fuente, instancia: id });
      throw e;
    }
  }
}
