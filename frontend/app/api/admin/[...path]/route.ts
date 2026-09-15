import { NextResponse, type NextRequest } from "next/server";
import { API_BASE } from "@/lib/api-client";

/**
 * Proxy /api/admin/* → API /admin/* con el token de la cookie httpOnly.
 * El navegador nunca ve el token. Soporta JSON y binarios (comprobantes).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const token = req.cookies.get("vigia_admin")?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const actor = req.cookies.get("vigia_admin_actor")?.value ?? "admin";
  const target = `${API_BASE}/admin/${params.path.join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = { "x-admin-token": token, "x-admin-actor": actor };
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  const init: RequestInit = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
  const r = await fetch(target, init);
  // Token vencido/rotado: el API responde 403 {"error":"forbidden"} → convertimos en 401 y
  // borramos la cookie para que el cliente vuelva al login en vez de mostrar "forbidden".
  if (r.status === 403) {
    const body = await r.clone().json().catch(() => null);
    if (body?.error === "forbidden") {
      const res = NextResponse.json({ error: "unauthenticated" }, { status: 401 });
      res.cookies.set("vigia_admin", "", { path: "/", maxAge: 0 });
      return res;
    }
  }
  const out = new NextResponse(r.body, { status: r.status });
  const rct = r.headers.get("content-type");
  if (rct) out.headers.set("content-type", rct);
  out.headers.set("cache-control", "no-store");
  return out;
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
