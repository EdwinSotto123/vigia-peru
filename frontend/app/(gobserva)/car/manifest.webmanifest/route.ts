import { manifiestoProducto } from "@/lib/gobserva-pwa";

/** El manifiesto de Gobserva Car: para instalarlo como app (lib/gobserva-pwa.ts). */
export const dynamic = "force-static";
export function GET() {
  return manifiestoProducto("car");
}
