/**
 * Bitácora del panel admin (tabla admin_log, migración 10). Toda acción que cambia estado
 * — validar/rechazar aportes, publicar/descartar alertas, re-analizar, editar configuración —
 * pasa por acá con el actor que viene en `x-admin-actor` (lo pone el proxy del frontend).
 */

import type { Context } from "hono";
import { pool } from "./db.js";

export const actor = (c: Context) => (c.req.header("x-admin-actor") ?? "admin").slice(0, 60);

export async function log(actorName: string, accion: string, objeto: string, detalle?: unknown): Promise<void> {
  await pool.query("INSERT INTO admin_log (actor, accion, objeto, detalle) VALUES ($1,$2,$3,$4)",
    [actorName, accion, objeto, detalle ? JSON.stringify(detalle) : null]);
}

/** Refresca el ranking (0.3 s) tras un cambio que afecta señales/procesados; nunca tira. */
export async function refrescarRanking(): Promise<boolean> {
  try {
    await pool.query("SELECT refresh_ranking()");
    return true;
  } catch (e) {
    console.warn("[admin] refresh_ranking falló:", (e as Error).message);
    return false;
  }
}
