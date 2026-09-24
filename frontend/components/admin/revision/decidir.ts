/**
 * Publicar o descartar una alerta en revisión: lo comparten la cola (app/admin/revision) y el
 * detalle (app/admin/revision/[id]), para que las dos digan lo mismo cuando algo sale mal.
 *
 *  · El motivo se pide con al menos 3 letras (lo mismo que exige el API).
 *  · Si otra persona ya la decidió, el API responde 409 `ya_resuelta` con una frase: se muestra
 *    esa frase y se refresca todo, para que la página pase a mostrar cómo quedó.
 *  · Cualquier otro error, en palabras (mensajeError), nunca el código crudo.
 */

import { AdminError, adminFetch } from "@/lib/admin";
import { refrescarTodo } from "@/lib/useAdmin";
import { mensajeError } from "@/components/admin/ui";
import type { DialogField } from "@/components/admin/Dialog";

export const MINIMO_MOTIVO = 3;

export const campoMotivo = (placeholder?: string): DialogField => ({
  name: "motivo",
  label: "Motivo de la decisión",
  type: "textarea",
  required: true,
  minimo: MINIMO_MOTIVO,
  placeholder,
  hint: "Queda en la bitácora con tu correo.",
});

/** El `detail` del API cuando es una frase para personas (no un código como "invalid_body" ni "HTTP 409"). */
function fraseDelApi(e: unknown): string | null {
  if (!(e instanceof AdminError)) return null;
  const m = e.message.trim();
  return m.includes(" ") && !/^HTTP \d+/.test(m) ? m : null;
}

export async function decidirAlerta(id: string, estado: "activa" | "descartada", motivo: string): Promise<void> {
  try {
    await adminFetch(`/alertas/${id}/estado`, { method: "PUT", body: JSON.stringify({ estado, motivo: motivo.trim() }) });
  } catch (e) {
    if (e instanceof AdminError && e.status === 409) {
      // Otra persona se adelantó: la página tiene que pasar a mostrar cómo quedó.
      void refrescarTodo();
      throw new Error(fraseDelApi(e) ?? "Otra persona ya decidió sobre esta alerta. Actualizamos la página con su decisión.");
    }
    // Un 400 con frase (motivo muy corto o muy largo) se dice tal cual; el resto, en palabras.
    throw new Error(e instanceof AdminError && e.status === 400 ? fraseDelApi(e) ?? mensajeError(e) : mensajeError(e));
  }
}
