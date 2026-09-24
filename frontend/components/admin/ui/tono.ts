/**
 * Tono → clases: la única fuente de verdad de los colores de estado del panel.
 * Una etiqueta, un punto, una barra o una caja del mismo tono se leen igual en
 * todas las páginas, así el color se aprende una vez.
 *
 * Los textos usan las variantes *Texto (llegan a 4.5:1 sobre sus fondos suaves,
 * ver tailwind.config.ts); el tono base queda para puntos, barras y bordes.
 * `text-mute` NO pasa sobre paperDeep ni sobre los fondos suaves (≈ 4.0–4.2:1):
 * por eso el texto secundario de badges y cajas tintadas es `text-inkSoft`.
 */

export type Tone = "neutral" | "ok" | "warn" | "danger" | "pending" | "brand" | "muted";

export interface ClasesTono {
  /** Píldora: fondo suave + texto AA. */
  badge: string;
  /** Punto de 6–8 px delante de una etiqueta. */
  punto: string;
  /** Texto suelto del tono (títulos de aviso, números destacados). */
  texto: string;
  /** Caja tintada: borde + fondo (avisos, tarjetas destacadas). */
  caja: string;
  /** Relleno de barras de progreso. */
  barra: string;
}

export const TONO: Record<Tone, ClasesTono> = {
  // Lo normal: en cola, sin novedad.
  neutral: { badge: "bg-paperDeep text-inkSoft", punto: "bg-ink/40", texto: "text-ink", caja: "border-line bg-paper", barra: "bg-ink/25" },
  // Listo, confirmado, visible.
  ok: { badge: "bg-moss/10 text-mossTexto", punto: "bg-moss", texto: "text-mossTexto", caja: "border-moss/30 bg-moss/5", barra: "bg-moss" },
  // Pide atención o una decisión: por validar, procesando.
  warn: { badge: "bg-amber-soft text-amberTexto", punto: "bg-amber", texto: "text-amberTexto", caja: "border-amber/40 bg-amber-soft/50", barra: "bg-amber" },
  // Falló o quedó fuera: error, rechazada, oculto por conflicto.
  danger: { badge: "bg-crimson-soft text-crimsonTexto", punto: "bg-rust", texto: "text-crimsonTexto", caja: "border-rust/30 bg-crimson-soft/60", barra: "bg-rust" },
  // Espera algo externo: documentos, revisión humana, un proceso en curso.
  pending: { badge: "bg-amber-soft/60 text-clayTexto", punto: "bg-clay", texto: "text-clayTexto", caja: "border-clay/40 bg-amber-soft/40", barra: "bg-clay/70" },
  // Acciones de Vigía (lotes propios, selección de marca). No es un estado de riesgo.
  brand: { badge: "bg-heroViolet-soft text-heroViolet", punto: "bg-heroViolet", texto: "text-heroViolet", caja: "border-heroViolet/30 bg-heroViolet-soft/50", barra: "bg-heroViolet" },
  // Sin dato, inactivo, reembolsado.
  muted: { badge: "bg-paperDeep text-inkSoft", punto: "bg-mute/50", texto: "text-inkSoft", caja: "border-dashed border-line bg-paper/60", barra: "bg-mute/40" },
};
