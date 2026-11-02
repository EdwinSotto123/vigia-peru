/**
 * Las notificaciones de Gobserva en los dispositivos de cada persona (2026-11-01, migración 233): manda a todos los
 * navegadores que la persona activó en ese producto, borra los que el servicio dio de baja (404/410) y los que fallan una
 * y otra vez, y deja la hora del último envío que llegó.
 */
import { poolAdmin as db } from "./db.js";
import { registrar } from "./registro.js";
import { enviarPush, pushConfigurado, type Notificacion } from "./webpush.js";
import type { ProductoPago } from "./gobservaPlanes.js";

/** A cuántos dispositivos llegó. */
export async function avisarPush(uid: string, producto: ProductoPago, n: Notificacion): Promise<number> {
  if (!pushConfigurado()) return 0;
  const subs = await db.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM gobserva_push WHERE firebase_uid = $1 AND producto = $2`, [uid, producto]);
  let llegaron = 0;
  await Promise.all(subs.rows.map(async (s) => {
    try {
      const r = await enviarPush(s, n);
      if (r.resultado === "ok") {
        llegaron++;
        await db.query(`UPDATE gobserva_push SET ultimo_ok_at = now(), fallos = 0 WHERE id = $1`, [s.id]);
      } else if (r.resultado === "vencida") {
        await db.query(`DELETE FROM gobserva_push WHERE id = $1`, [s.id]);
      } else {
        await db.query(`UPDATE gobserva_push SET fallos = fallos + 1 WHERE id = $1`, [s.id]);
        registrar("WARNING", `[gobserva] push respondió ${r.status}`);
      }
    } catch (e) {
      await db.query(`UPDATE gobserva_push SET fallos = fallos + 1 WHERE id = $1`, [s.id]);
      registrar("WARNING", `[gobserva] push falló: ${(e as Error).message.slice(0, 200)}`);
    }
  }));
  // Un dispositivo que falla diez veces seguidas ya no está: se olvida (la persona lo vuelve a activar si quiere).
  if (subs.rows.length) await db.query(`DELETE FROM gobserva_push WHERE firebase_uid = $1 AND fallos >= 10`, [uid]);
  return llegaron;
}
