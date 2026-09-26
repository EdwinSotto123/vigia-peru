import { NextResponse, type NextRequest } from "next/server";

/**
 * Protege /admin/*: sin la cookie de sesión admin (httpOnly, la pone
 * /api/admin/login tras validar el token contra el API) redirige al login.
 * La validez real del token la verifica el API en cada request proxeado.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    // `__session`: el nombre que deja pasar Firebase Hosting; `vigia_admin`: el anterior (sesiones abiertas).
    if (!req.cookies.get("__session")?.value && !req.cookies.get("vigia_admin")?.value) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
