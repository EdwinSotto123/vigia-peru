/**
 * Feature flags del frontend. Se leen en build (NEXT_PUBLIC_*), así que sirven
 * tanto en server como en client components.
 *
 * - `editorial`: generador de notas (`/noticia`). Herramienta interna; apagada
 *   por defecto. Activar con NEXT_PUBLIC_EDITORIAL=1.
 */
export const FLAGS = {
  editorial: process.env.NEXT_PUBLIC_EDITORIAL === "1",
} as const;
