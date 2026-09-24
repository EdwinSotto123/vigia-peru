import { promisify } from "util";
import { gzip } from "zlib";
import { NextResponse, type NextRequest } from "next/server";
import { API_BASE } from "@/lib/api-client";
import { COOKIE_ADMIN, esAdmin, leerSesionDetalle, olvidarPerfil, tokenApi } from "@/lib/admin-sesion";
import { puedeApi, ROLES } from "@/lib/permisos";

/**
 * Proxy /api/admin/* → API /admin/*. La cookie trae la sesión firmada (el
 * correo verificado); el token del API lo agrega el servidor y el correo va
 * como autor a la bitácora. El navegador nunca ve el token. Soporta JSON y
 * binarios (comprobantes).
 *
 * Perfiles: el API confía en el token, así que ACÁ se decide qué puede cada
 * perfil (lib/permisos.ts). Un revisor que pide algo de admin recibe 403
 * `sin_permiso` sin que el pedido llegue al API. Los segmentos `.`/`..` se
 * rechazan y el resto va codificado: la ruta que se autoriza es exactamente
 * la que se reenvía.
 *
 * Compresión: el fetch de Node ya descomprime lo que manda el API, y Next no
 * gzipea las route handlers (sí las páginas), así que el JSON llegaba plano al
 * navegador: /procesamientos pesa ~75 KB y el dossier admin ~480 KB. El JSON de
 * más de 1 KB se vuelve a comprimir acá si el navegador acepta gzip; lo binario
 * (comprobantes, imágenes) sigue pasando como stream, sin tocarlo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gzipAsync = promisify(gzip);
const MIN_GZIP = 1024;

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const lectura = await leerSesionDetalle(req.cookies.get(COOKIE_ADMIN)?.value);
  const token = tokenApi();
  // No se pudo confirmar el perfil (API lenta o caída): no pasa, pero la sesión sigue viva.
  if (lectura.estado === "sin_verificar" && token) {
    return NextResponse.json(
      { error: "perfil_sin_verificar", detail: "No pudimos confirmar tu acceso en este momento. Vuelve a intentar en unos segundos." },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } },
    );
  }
  if (lectura.estado !== "ok" || !token) {
    const res = NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    res.cookies.set(COOKIE_ADMIN, "", { path: "/", maxAge: 0 });
    return res;
  }
  const sesion = lectura.sesion;
  const segmentos = params.path ?? [];
  if (!segmentos.length || segmentos.some((x) => x === "." || x === ".." || x.includes("/") || x.includes("\\"))) {
    return NextResponse.json({ error: "ruta_invalida" }, { status: 400 });
  }
  const ruta = `/${segmentos.join("/")}`;
  if (!puedeApi(sesion.rol, req.method, ruta)) {
    return NextResponse.json(
      { error: "sin_permiso", detail: `Tu perfil (${ROLES[sesion.rol].nombre.toLowerCase()}) no incluye esta acción. Pídesela a un administrador.` },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  // Un principal (secreto admin-emails) no se agrega ni se cambia desde el panel: si entrara a la
  // tabla, sacarlo del secreto ya no le quitaría el acceso.
  if (segmentos[0] === "equipo" && segmentos.length === 2 && req.method !== "GET" && esAdmin(segmentos[1])) {
    return NextResponse.json(
      { error: "es_principal", detail: "Ese correo es administrador principal: se gestiona en la configuración del servidor, no desde el panel." },
      { status: 409 },
    );
  }
  const actor = sesion.correo;
  const target = `${API_BASE}/admin/${segmentos.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = { "x-admin-token": token, "x-admin-actor": actor, "x-admin-rol": sesion.rol };
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  const init: RequestInit = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
  const r = await fetch(target, init);
  // Alta, cambio o baja en el equipo: esta instancia vuelve a consultar ese perfil ya (las demás, en ≤ 60 s).
  if (segmentos[0] === "equipo" && segmentos.length === 2 && req.method !== "GET" && r.ok) olvidarPerfil(segmentos[1]);
  // Token vencido/rotado: el API responde 403 {"error":"forbidden"} → convertimos en 401 y
  // borramos la cookie para que el cliente vuelva al login en vez de mostrar "forbidden".
  if (r.status === 403) {
    const body = await r.clone().json().catch(() => null);
    if (body?.error === "forbidden") {
      const res = NextResponse.json({ error: "unauthenticated" }, { status: 401 });
      res.cookies.set(COOKIE_ADMIN, "", { path: "/", maxAge: 0 });
      return res;
    }
  }
  const rct = r.headers.get("content-type");
  const esJson = !!rct && rct.includes("json");
  const aceptaGzip = (req.headers.get("accept-encoding") ?? "").includes("gzip");
  const conCuerpo = req.method !== "HEAD" && ![204, 205, 304].includes(r.status);
  if (esJson && aceptaGzip && conCuerpo) {
    const cuerpo = Buffer.from(await r.arrayBuffer());
    const out = cuerpo.length >= MIN_GZIP
      ? new NextResponse(await gzipAsync(cuerpo), { status: r.status })
      : new NextResponse(cuerpo, { status: r.status });
    if (cuerpo.length >= MIN_GZIP) out.headers.set("content-encoding", "gzip");
    out.headers.set("content-type", rct);
    out.headers.set("vary", "Accept-Encoding");
    out.headers.set("cache-control", "no-store");
    return out;
  }
  const out = new NextResponse(r.body, { status: r.status });
  if (rct) out.headers.set("content-type", rct);
  out.headers.set("cache-control", "no-store");
  return out;
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
