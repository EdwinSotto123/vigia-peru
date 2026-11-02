import { manifiestoProducto } from "@/lib/gobserva-pwa";

/** El manifiesto de Gobserva Empleo: para instalarlo como app (lib/gobserva-pwa.ts). */
export const dynamic = "force-static";
export function GET() {
  return manifiestoProducto("empleo");
}
