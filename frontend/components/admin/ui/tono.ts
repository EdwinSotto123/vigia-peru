/**
 * Tono → clases: la única fuente de verdad de los colores de estado del panel.
 * Una etiqueta, un punto, una barra o una caja del mismo tono se leen igual en
 * todas las páginas, así el color se aprende una vez.
 *
 * El panel es neutro (carbón, sin tinte de área): el color es de los ESTADOS. Ámbar
 * pide una decisión, rojo falló, verde quedó listo, arcilla espera algo de afuera.
 * El lima (`brand`) no es un estado: marca lo que hace Vigía y la selección.
 *
 * Los textos usan las variantes *Texto (llegan a 4.5:1 sobre sus fondos suaves,
 * ver tailwind.config.ts); el tono base queda para puntos, barras y bordes. Las
 * píldoras llevan un borde fino del mismo tono, como las del sitio público.
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
  neutral: { badge: "border-paperEdge bg-paperDeep text-inkSoft", punto: "bg-mute", texto: "text-ink", caja: "border-line bg-paperSoft", barra: "bg-mute/60" },
  // Listo, confirmado, visible.
  ok: { badge: "border-moss/30 bg-moss/10 text-mossTexto", punto: "bg-moss", texto: "text-mossTexto", caja: "border-moss/30 bg-moss/[0.06]", barra: "bg-moss" },
  // Pide atención o una decisión: por validar, procesando.
  warn: { badge: "border-amber/35 bg-amber-soft text-amberTexto", punto: "bg-amber", texto: "text-amberTexto", caja: "border-amber/35 bg-amber-soft/60", barra: "bg-amber" },
  // Falló o quedó fuera: error, rechazada, oculto por conflicto.
  danger: { badge: "border-rust/35 bg-crimson-soft text-crimsonTexto", punto: "bg-rust", texto: "text-crimsonTexto", caja: "border-rust/35 bg-crimson-soft/70", barra: "bg-rust" },
  // Espera algo externo: documentos, revisión humana, un proceso en curso.
  pending: { badge: "border-clay/35 bg-clay/10 text-clayTexto", punto: "bg-clay", texto: "text-clayTexto", caja: "border-clay/35 bg-clay/[0.07]", barra: "bg-clay/80" },
  // Acciones de Vigía (lotes propios, selección). No es un estado de riesgo.
  brand: { badge: "border-granate/30 bg-granate-soft text-granate", punto: "bg-granate", texto: "text-granate", caja: "border-granate/30 bg-granate-50", barra: "bg-granate" },
  // Sin dato, inactivo, reembolsado.
  muted: { badge: "border-line bg-paperSoft text-mute", punto: "bg-mute/50", texto: "text-inkSoft", caja: "border-dashed border-line bg-paperSoft/60", barra: "bg-mute/40" },
};
