/**
 * El historial del asistente de cada app (migración 269, 2026-11-08, el usuario: «falta historial de chats»). Cada
 * pregunta con respuesta se suma a su conversación (o abre una nueva, con la pregunta como título). Es de quien la tuvo:
 * se lista, se lee, se renombra y se borra desde su cuenta, y se borra con la cuenta.
 */
import { pool } from "./db.js";

export interface TurnoGuardado {
  rol: "usuario" | "asistente";
  texto: string;
  modo?: string;
  creditos?: number;
  /** Lo que consultó para responder (los títulos de las herramientas). */
  consultas?: string[];
  fecha: string;
}

/** Hasta cuántos turnos guarda una conversación (después se recortan los más viejos). */
const MAX_TURNOS = 80;
const MAX_TEXTO = 40_000;

/** El título de una conversación nueva: su primera pregunta, en una línea y sin pasar de 80 letras. */
export function tituloDe(pregunta: string): string {
  const t = pregunta.replace(/\s+/g, " ").trim();
  if (t.length <= 80) return t || "Conversación";
  const corte = t.slice(0, 80);
  const espacio = corte.lastIndexOf(" ");
  return `${corte.slice(0, espacio > 40 ? espacio : 80)}…`;
}

/**
 * Suma una pregunta y su respuesta a la conversación `id` de esa cuenta y app (o abre una si no hay `id` o no es suya).
 * Devuelve su id y su título.
 */
export async function guardarTurno(a: {
  uid: string;
  app: "empleo" | "licitaciones";
  id?: string | null;
  pregunta: string;
  respuesta: string;
  modo: string;
  creditos: number;
  consultas: string[];
}): Promise<{ id: string; titulo: string }> {
  const fecha = new Date().toISOString();
  const nuevos: TurnoGuardado[] = [
    { rol: "usuario", texto: a.pregunta.slice(0, MAX_TEXTO), fecha },
    { rol: "asistente", texto: a.respuesta.slice(0, MAX_TEXTO), modo: a.modo, creditos: a.creditos, consultas: a.consultas.slice(0, 20), fecha },
  ];
  if (a.id) {
    const r = await pool.query<{ id: string; titulo: string }>(
      `UPDATE gobserva_conversaciones
          SET mensajes = (SELECT COALESCE(jsonb_agg(m ORDER BY i), '[]'::jsonb) FROM (
                SELECT m, i FROM jsonb_array_elements(mensajes || $4::jsonb) WITH ORDINALITY AS x(m, i)
                 ORDER BY i DESC LIMIT ${MAX_TURNOS}) u),
              creditos = creditos + $5, actualizado_at = now()
        WHERE id = $1 AND firebase_uid = $2 AND app = $3
        RETURNING id, titulo`,
      [a.id, a.uid, a.app, JSON.stringify(nuevos), a.creditos]);
    if (r.rows[0]) return r.rows[0];
  }
  const r = await pool.query<{ id: string; titulo: string }>(
    `INSERT INTO gobserva_conversaciones (firebase_uid, app, titulo, mensajes, creditos) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id, titulo`,
    [a.uid, a.app, tituloDe(a.pregunta), JSON.stringify(nuevos), a.creditos]);
  return r.rows[0];
}
