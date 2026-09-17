import { NextResponse, type NextRequest } from "next/server";

/**
 * A diferencia de /api/admin/[...path] (que proxea a la API y devuelve 401 si no hay cookie —
 * correcto para una acción real, pero cada 401 queda como error en la consola del navegador),
 * esto es un chequeo silencioso: SIEMPRE 200, con `{ admin: boolean }`. Solo mira si la cookie
 * está — la validez real la sigue comprobando el backend en cualquier acción de verdad. Lo usa
 * `useEsAdmin()` en páginas públicas (/app/mapa, /app/financiar/[ubigeo]…) que ve cualquier
 * visitante, para decidir si mostrar la acción de admin sin ensuciarle la consola a nadie.
 */
export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return NextResponse.json({ admin: !!req.cookies.get("vigia_admin")?.value }, { headers: { "cache-control": "no-store" } });
}
