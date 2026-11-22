import { notFound } from "next/navigation";

/**
 * Cualquier dirección de salud.gobserva.cloud que no es una página: el «no encontrado» de Salud (not-found.tsx de esta
 * carpeta) en vez del de Vigía. Las páginas de verdad (y sus [codigo]) ganan siempre a esta ruta comodín.
 */
export default function Resto() {
  notFound();
}
