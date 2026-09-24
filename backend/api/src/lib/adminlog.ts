/**
 * Bitácora del panel admin (tabla admin_log, migración 10). Toda acción que cambia estado
 * — validar/rechazar aportes, publicar/descartar alertas, re-analizar, editar configuración —
 * pasa por acá con el actor que viene en `x-admin-actor` (lo pone el proxy del frontend).
 *
 * También las cabeceras que pone ese proxy (sólo él tiene el token, así que son de fiar):
 * `x-admin-rol` (admin | revisor; sin ella, admin: Cloud Scheduler no la manda) y el token mismo.
 */

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { pool } from "./db.js";

// 254 = largo máximo de un correo: el actor es el correo verificado de quien entró al panel.
export const actor = (c: Context) => (c.req.header("x-admin-actor") ?? "admin").slice(0, 254);

/** Perfil revisor (frontend/lib/permisos.ts): sin plata, configuración ni equipo. */
export const esRevisor = (c: Context) => (c.req.header("x-admin-rol") ?? "").trim().toLowerCase() === "revisor";

/** `x-admin-token` contra ADMIN_TOKEN en tiempo constante (con largos distintos rechaza sin comparar). */
export function tokenAdminValido(c: Context): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const got = Buffer.from(c.req.header("x-admin-token") ?? "");
  const esperado = Buffer.from(token);
  return got.length === esperado.length && timingSafeEqual(got, esperado);
}

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
