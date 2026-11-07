import type { Tone } from "@/components/admin/ui";

/** Un mensaje de la conversación previa a la pregunta, como lo guarda el servidor. */
export interface MensajeChat {
  rol: "usuario" | "asistente";
  texto: string;
}

/**
 * Los informes guardados del chat de investigación (GET /api/admin/chat/informes y /:id, routes/admin_chat.ts del API,
 * migración 261): cada pregunta, con quién la hizo, cómo terminó, su costo y su revisión automática.
 */

export type EstadoInforme = "corriendo" | "listo" | "error" | "detenido" | "cortado";

export interface FilaInforme {
  id: string;
  conversacion: string | null;
  creado: string;
  actualizado: string;
  actor: string | null;
  modelo_pedido: "rapido" | "fino";
  modelo: string | null;
  pregunta: string;
  estado: EstadoInforme;
  error: string | null;
  costo_usd: number | null;
  ms: number | null;
  herramientas: number | null;
  /** Resumen de la revisión: cuántos enlaces y montos tenía y cuántos quedaron por revisar. */
  revision: { enlaces: number; montos: number; por_revisar: number } | null;
}

export interface InformeCompleto extends Omit<FilaInforme, "revision" | "costo_usd" | "ms" | "herramientas"> {
  historial: MensajeChat[];
  texto: string | null;
  eventos: unknown[];
  revision: unknown;
  fin: unknown;
}

export const ESTADO_INFORME: Record<EstadoInforme, { etiqueta: string; tono: Tone }> = {
  corriendo: { etiqueta: "corriendo", tono: "warn" },
  listo: { etiqueta: "listo", tono: "ok" },
  error: { etiqueta: "con error", tono: "danger" },
  detenido: { etiqueta: "detenido", tono: "muted" },
  cortado: { etiqueta: "cortado", tono: "muted" },
};

export const NOMBRE_MODELO: Record<"rapido" | "fino", string> = { rapido: "Rápido", fino: "Profundo" };

export const rutaInforme = (id: string) => `/admin/chat/informes/${id}`;
