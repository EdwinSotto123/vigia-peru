/**
 * El consumo del asistente y del MCP de Gobserva, por día y por cuenta (migración 268, 2026-11-08): para el panel
 * («Consumo»: cuánto se usa, cuántos créditos y cuánto cuesta el modelo frente a lo que pagan los planes). El corte de
 * créditos no depende de esto (lo lleva el Durable Object `Limitador`); si guardar falla, el uso igual se atendió.
 */
import { pool } from "./db.js";
import { diaLima } from "./creditosMcp.js";

export interface Consumo {
  uid: string;
  canal: "mcp" | "asistente";
  /** La herramienta del MCP o el modo del asistente. */
  detalle: string;
  /** La app o la dirección del MCP («empleo», «licitaciones», «todo»). */
  app: string;
  llamadas?: number;
  creditos: number;
  costoUsd?: number;
}

export async function registrarConsumo(c: Consumo): Promise<void> {
  await pool.query(
    `INSERT INTO gobserva_consumo (dia, firebase_uid, canal, detalle, app, llamadas, creditos, costo_usd)
     VALUES ($1::date, $2, $3, left($4, 60), left($5, 20), $6, $7, $8)
     ON CONFLICT (dia, firebase_uid, canal, detalle, app) DO UPDATE
       SET llamadas = gobserva_consumo.llamadas + EXCLUDED.llamadas,
           creditos = gobserva_consumo.creditos + EXCLUDED.creditos,
           costo_usd = gobserva_consumo.costo_usd + EXCLUDED.costo_usd,
           actualizado_at = now()`,
    [diaLima(), c.uid, c.canal, c.detalle || "-", c.app || "", Math.max(0, Math.floor(c.llamadas ?? 1)), Math.max(0, Math.floor(c.creditos)),
      Math.max(0, c.costoUsd ?? 0)],
  );
}
