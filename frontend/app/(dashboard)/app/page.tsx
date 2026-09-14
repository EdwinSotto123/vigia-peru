import { redirect } from "next/navigation";

/**
 * El mapa es la puerta de entrada pública. El antiguo "Inicio" (análisis a
 * demanda, sorteo, métricas de operación) vive ahora en /admin/analisis.
 */
export default function AppHome() {
  redirect("/app/mapa");
}
