import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESION, PRODUCTO_POR_HOST, PRODUCTOS, hostLimpio, type Producto } from "@/lib/gobserva";

/**
 * Dos trabajos:
 *
 *   · Los productos de Gobserva (lib/gobserva.ts): cada uno se sirve desde su subdominio. `empleo.gobserva.cloud/plaza/1`
 *     se reescribe a `/empleo/plaza/1` (app/(gobserva)/empleo). Un enlace que ya trae el prefijo va a la ruta limpia, y
 *     nada de Vigía (la app, el panel) se sirve desde un producto: su ruta reescrita no existe y da 404. Desde
 *     vigia.gobserva.cloud, `/empleo/…` lleva al subdominio; en DEV (sin subdominio propio) se navega por la ruta.
 *     Cada producto tiene su robots.txt y su sitemap.xml.
 *   · Con la sesión de Gobserva abierta (la marca COOKIE_SESION, que pone la cabecera), la portada de un producto lleva
 *     a la cuenta y «Para ti» a su sección de la cuenta: quien ya entró va a la app, no a la página para visitantes.
 *     `?portada` deja ver la portada igual.
 *   · Protege /admin/*: sin la cookie de sesión admin (httpOnly, la pone /api/admin/login tras validar el token contra
 *     el API) redirige al login. La validez real del token la verifica el API en cada request proxeado.
 */
const PRODUCTOS_CON_RUTA: Producto[] = ["empleo", "licitaciones", "obras", "salud", "car"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const host = hostLimpio(req.headers.get("host"));
  const producto = PRODUCTO_POR_HOST[host];

  const aLaApp = req.cookies.get(COOKIE_SESION)?.value === "1" && !req.nextUrl.searchParams.has("portada");

  if (producto) {
    // La app (/app/*) es sólo con sesión: sin la marca, a entrar con la vuelta (307 de verdad, no una redirección del
    // navegador a mitad de la página).
    if (esApp(pathname) && !conSesion(req)) return aEntrar(req, "", pathname + search);
    if (aLaApp) {
      const bandeja = producto === "licitaciones" ? aLaBandeja(pathname, req.nextUrl.searchParams) : producto === "empleo" ? aLaAppEmpleo(pathname, search) : null;
      if (bandeja) return NextResponse.redirect(new URL(bandeja, req.nextUrl), 307);
      const destino = destinoConSesion(producto, pathname);
      if (destino) return NextResponse.redirect(new URL(destino, req.nextUrl), 307);
    }
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
    // La ruta que se ve en el navegador, para que una página del servidor sepa a dónde volver (la app manda a entrar con
    // `next`): la reescrita lleva el prefijo del producto.
    const cabeceras = new Headers(req.headers);
    cabeceras.set("x-gobserva-ruta", `${pathname}${search}`);
    return NextResponse.rewrite(url, { request: { headers: cabeceras } });
  }

  // En DEV (sin subdominio) los productos van por ruta: /licitaciones, /licitaciones/para-ti.
  for (const p of PRODUCTOS_CON_RUTA) {
    const resto = pathname.startsWith(`/${p}/`) ? pathname.slice(p.length + 1) : null;
    if (resto && esApp(resto) && !conSesion(req)) return aEntrar(req, `/${p}`, resto + search);
  }
  if (aLaApp) {
    if (pathname.startsWith("/licitaciones/")) {
      const bandeja = aLaBandeja(pathname.slice("/licitaciones".length), req.nextUrl.searchParams);
      if (bandeja) return NextResponse.redirect(new URL(`/licitaciones${bandeja}`, req.nextUrl), 307);
    }
    if (pathname.startsWith("/empleo/")) {
      const app = aLaAppEmpleo(pathname.slice("/empleo".length), search);
      if (app) return NextResponse.redirect(new URL(`/empleo${app}`, req.nextUrl), 307);
    }
    for (const p of PRODUCTOS_CON_RUTA) {
      if (pathname === `/${p}` || pathname.startsWith(`/${p}/`)) {
        const destino = destinoConSesion(p, pathname.slice(p.length + 1) || "/");
        if (destino) return NextResponse.redirect(new URL(`/${p}${destino}`, req.nextUrl), 307);
      }
    }
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

const esApp = (ruta: string) => ruta === "/app" || ruta.startsWith("/app/");
const conSesion = (req: NextRequest) => req.cookies.get(COOKIE_SESION)?.value === "1";

/** A entrar, con `next` a la ruta de la app que se pidió (dentro del producto, sin el prefijo de DEV). */
function aEntrar(req: NextRequest, prefijo: string, siguiente: string) {
  const url = req.nextUrl.clone();
  url.pathname = `${prefijo}/entrar`;
  url.search = `?next=${encodeURIComponent(siguiente)}`;
  return NextResponse.redirect(url, 307);
}

/**
 * Con la sesión abierta, la página vieja de Oportunidades y su ficha llevan a la bandeja y al detalle de la app (los
 * enlaces de los correos y de «Para ti» siguen sirviendo): los filtros se traducen a los de la bandeja.
 */
function aLaBandeja(ruta: string, sp: URLSearchParams): string | null {
  const ficha = ruta.match(/^\/oportunidad\/([^/]+)$/);
  if (ficha) return `/app/oportunidad/${ficha[1]}`;
  const menor = ruta.match(/^\/menor\/(\d{1,9})$/);
  if (menor) return `/app/menor/${menor[1]}`;
  // Contratos menores y Mercado también tienen su página en la app (con los mismos nombres de filtros).
  if (ruta === "/menores") {
    const q = new URLSearchParams();
    for (const k of ["q", "region", "tipo", "cuando", "orden"]) {
      const v = sp.get(k);
      if (v) q.set(k, v);
    }
    const pagina = sp.get("page");
    if (pagina && pagina !== "1") q.set("pag", pagina);
    const s = q.toString();
    return `/app/menores${s ? `?${s}` : ""}`;
  }
  if (ruta === "/mercado") {
    const q = sp.get("q");
    return `/app/mercado${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  }
  if (ruta !== "/oportunidades") return null;
  const q = new URLSearchParams();
  for (const k of ["q", "region", "tipo", "min", "max"]) {
    const v = sp.get(k);
    if (v) q.set(k, v);
  }
  const dias = Number(sp.get("dias"));
  if (dias && dias <= 15) q.set("pub", dias <= 7 ? "7" : "15");
  const consultas = sp.get("consultas");
  if (consultas === "abiertas") q.set("cons", "abiertas");
  if (consultas === "semana") q.set("cons", "7d");
  const orden = sp.get("orden");
  if (orden === "valor") q.set("orden", "valor_desc");
  if (orden === "consultas") q.set("orden", "vence");
  const pagina = sp.get("page");
  if (pagina && pagina !== "1") q.set("pag", pagina);
  const s = q.toString();
  return `/app/bandeja${s ? `?${s}` : ""}`;
}

/** A dónde va quien tiene la sesión abierta, desde una ruta del producto (null: se queda). */
/**
 * Con la sesión abierta, la lista y la ficha de Gobserva Empleo para visitantes llevan a las de la app (2026-11-07): los
 * filtros son los mismos, así que la consulta pasa tal cual (los enlaces de los correos y de las alertas siguen sirviendo).
 */
function aLaAppEmpleo(ruta: string, search: string): string | null {
  const ficha = ruta.match(/^\/plaza\/(\d{1,9})$/);
  if (ficha) return `/app/plaza/${ficha[1]}`;
  if (ruta === "/plazas") return `/app/plazas${search}`;
  return null;
}

function destinoConSesion(producto: Producto, ruta: string): string | null {
  // Salud y Car son abiertos: su portada es el inicio para todos, con cuenta o sin ella.
  if (producto === "salud" || producto === "car") return null;
  if (ruta === "/") return "/cuenta";
  if (producto === "licitaciones" && ruta === "/para-ti") return "/cuenta?tab=para-ti";
  if (producto === "empleo" && ruta === "/para-ti") return "/app/para-ti";
  return null;
}

export const config = {
  // Todas las páginas (no lo estático, ni /v1 ni /api, ni un archivo con extensión), más robots.txt y sitemap.xml. La
  // imagen para compartir (opengraph-image) sí pasa: en el subdominio, la de cada producto vive bajo su carpeta.
  matcher: ["/((?!_next/|v1/|api/|favicon\\.ico|icon|apple-icon|.*\\.[A-Za-z0-9]{2,5}$).*)", "/robots.txt", "/sitemap.xml"],
};
