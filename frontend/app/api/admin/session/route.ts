import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ADMIN, correosAdmin, leerSesionDetalle } from "@/lib/admin-sesion";

/**
 * A diferencia de /api/admin/[...path] (que proxea a la API y devuelve 401 si no hay cookie —
 * correcto para una acción real, pero cada 401 queda como error en la consola del navegador),
 * esto es un chequeo silencioso: 200 con `{ admin, correo, rol, principal }` (503 sólo si el perfil no
 * se pudo confirmar ahora: el panel reintenta en vez de creer que ya no es del equipo) (`admin` = es
 * del equipo, cualquiera sea su perfil; `principales` sólo se le dice a un administrador). Verifica la firma de la
 * sesión: antes bastaba con que existiera una cookie con ese nombre, cualquiera fuera su valor. Lo usa
 * `useEsAdmin()` en páginas públicas (/app/mapa, /app/financiar/[ubigeo]…) que ve cualquier
 * visitante, para decidir si mostrar la acción de admin sin ensuciarle la consola a nadie.
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const lectura = await leerSesionDetalle(req.cookies.get(COOKIE_ADMIN)?.value);
  // Perfil sin confirmar (API lenta): 503 para que el panel reintente en vez de creer que ya no es del equipo.
  if (lectura.estado === "sin_verificar") {
    return NextResponse.json({ error: "perfil_sin_verificar" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const sesion = lectura.estado === "ok" ? lectura.sesion : null;
  return NextResponse.json(
    {
      admin: !!sesion,
      correo: sesion?.correo ?? null,
      rol: sesion?.rol ?? null,
      principal: sesion?.principal ?? false,
      principales: sesion?.rol === "admin" ? correosAdmin() : undefined,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
