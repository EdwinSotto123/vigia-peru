import { NextResponse, type NextRequest } from "next/server";
import { PRODUCTO_POR_HOST, PRODUCTOS, hostLimpio, type Producto } from "@/lib/gobserva";

/**
 * Dos trabajos:
 *
 *   · Los productos de Gobserva (lib/gobserva.ts): cada uno se sirve desde su subdominio. `empleo.gobserva.cloud/plaza/1`
 *     se reescribe a `/empleo/plaza/1` (app/(gobserva)/empleo). Un enlace que ya trae el prefijo va a la ruta limpia, y
 *     nada de Vigía (la app, el panel) se sirve desde un producto: su ruta reescrita no existe y da 404. Desde
 *     vigia.gobserva.cloud, `/empleo/…` lleva al subdominio; en DEV (sin subdominio propio) se navega por la ruta.
 *     Cada producto tiene su robots.txt y su sitemap.xml.
 *   · Protege /admin/*: sin la cookie de sesión admin (httpOnly, la pone /api/admin/login tras validar el token contra
 *     el API) redirige al login. La validez real del token la verifica el API en cada request proxeado.
 */
const PRODUCTOS_CON_RUTA: Producto[] = ["empleo", "licitaciones", "obras"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const host = hostLimpio(req.headers.get("host"));
  const producto = PRODUCTO_POR_HOST[host];

  if (producto) {
    // La imagen para compartir: Next la publica con su ruta interna (/empleo/opengraph-image-…) y así se sirve, sin
    // redirigir (los que leen el og:image no siempre siguen una redirección).
    if (pathname.startsWith(`/${producto}/opengraph-image`) || pathname.startsWith(`/${producto}/twitter-image`)) return NextResponse.next();
    if (pathname === `/${producto}` || pathname.startsWith(`/${producto}/`)) {
      const url = req.nextUrl.clone();
      url.pathname = pathname.slice(producto.length + 1) || "/";
      return NextResponse.redirect(url, 308);
    }
    const url = req.nextUrl.clone();
    url.pathname = `/${producto}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // robots.txt y sitemap.xml pasan por aquí sólo por los subdominios de los productos.
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return NextResponse.next();

  if (host === "vigia.gobserva.cloud") {
    for (const p of PRODUCTOS_CON_RUTA) {
      if (pathname === `/${p}` || pathname.startsWith(`/${p}/`)) {
        return NextResponse.redirect(`https://${PRODUCTOS[p].host}${pathname.slice(p.length + 1) || "/"}${search}`, 308);
      }
    }
  }

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

export const config = {
  // Todas las páginas (no lo estático, ni /v1 ni /api, ni un archivo con extensión), más robots.txt y sitemap.xml. La
  // imagen para compartir (opengraph-image) sí pasa: en el subdominio, la de cada producto vive bajo su carpeta.
  matcher: ["/((?!_next/|v1/|api/|favicon\\.ico|icon|apple-icon|.*\\.[A-Za-z0-9]{2,5}$).*)", "/robots.txt", "/sitemap.xml"],
};
