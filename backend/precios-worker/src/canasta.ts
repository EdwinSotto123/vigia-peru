/**
 * Canasta del índice semanal: bienes que el Estado compra seguido y que estas tiendas venden. El cron la consulta
 * una vez por semana y guarda cada precio en `precio_observado`, así hay una serie propia y fechada que no depende
 * de que la tienda responda el día del análisis. Ampliarla es agregar términos (cada uno = 1 consulta por tienda).
 */
export const CANASTA: string[] = [
  // construcción y ferretería
  "cemento sol tipo i 42.5 kg", "cemento portland puzolanico ip 42.5 kg", "fierro corrugado 1/2", "alambre negro recocido",
  "clavos para madera", "arena gruesa", "ladrillo king kong", "tubo pvc agua 1/2", "pintura latex", "thinner",
  "casco de seguridad", "guantes de seguridad", "botas de seguridad", "lentes de seguridad",
  // limpieza
  "lejia", "detergente en polvo", "desinfectante", "papel higienico", "jabon liquido", "bolsas de basura",
  // oficina
  "papel bond a4 75 g", "toner", "archivador de palanca", "lapicero", "folder manila",
  // alimentos (programas sociales)
  "arroz extra", "azucar rubia", "aceite vegetal", "leche evaporada", "atun en conserva", "avena",
];
