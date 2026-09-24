import { NextResponse } from "next/server";
import { getZonas } from "@/lib/financiamiento";

/**
 * Las regiones con su cola sin financiar, para los componentes de cliente que
 * necesitan elegir una (el panel admin procesa lotes por región). Son los
 * mismos datos públicos del mapa; `getZonas` ya los cachea 5 minutos.
 *
 * `force-dynamic`: un GET sin cookies ni cabeceras, Next 14 lo arma estático
 * en el build, y si el API fallaba en ese momento quedaba servido `[]` hasta
 * el próximo despliegue. Así se resuelve en cada pedido (con el caché de
 * `getZonas` y el `cache-control` de abajo).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const zonas = await getZonas("departamento");
  return NextResponse.json({ data: zonas ?? [] }, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=60" } });
}
