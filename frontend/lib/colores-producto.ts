// Generado por scripts/colores/colores_producto.py: no editar a mano.
import type { Producto } from "./gobserva";

/**
 * El color de cada producto de Gobserva (2026-11-21), para lo que no lee los tokens de CSS (la imagen para compartir).
 * `noche`: el acento sobre carbón; `dia`: la acción sobre blanco; `banda` y `bandaAcento`: las bandas de día.
 */
export const COLOR_PRODUCTO: Record<Producto, { noche: string; dia: string; banda: string; bandaAcento: string }> = {
  salud: { noche: "#3EE6C9", dia: "#0A7266", banda: "#073B36", bandaAcento: "#8AF3E1" },
  empleo: { noche: "#B9A0FF", dia: "#5B35C9", banda: "#24154D", bandaAcento: "#D6C9FF" },
  licitaciones: { noche: "#6DB4FF", dia: "#1D5DB8", banda: "#0B2748", bandaAcento: "#A8D1FF" },
  obras: { noche: "#FF9A55", dia: "#A9480C", banda: "#3B1C09", bandaAcento: "#FFC08F" },
  car: { noche: "#FFD23F", dia: "#7A5A00", banda: "#2B2200", bandaAcento: "#FFE27A" },
};

/** Vigía: añil (las imágenes, el favicon y lo que pinta en un canvas). */
export const COLOR_VIGIA = { noche: "#39FF14", dia: "#0E7318", banda: "#06240A", bandaAcento: "#39FF14" } as const;
