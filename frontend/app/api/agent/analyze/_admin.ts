/**
 * Guardia de las rutas que GASTAN: /api/agent/analyze, /analyze/stream,
 * /upload-doc y /random.
 *
 * Cada análisis corre ~10 agentes de Gemini y cuesta plata real. Estas rutas
 * no tenían ningún control: cualquiera con la URL (o con `?run=` en el
 * buscador público) disparaba una corrida pagada. Ahora exigen la sesión de
 * equipo: la cookie httpOnly `vigia_admin` que deja /api/admin/login, y el
 * token adentro se verifica contra `/admin/ping` del API (lo mismo que hace
 * el login). Un token válido se recuerda 5 minutos en memoria para que subir
 * 30 documentos de un expediente no sean 30 pings.
 *
 * El middleware sólo protege /admin/*; estas rutas viven en /api/agent/*, así
 * que la guardia tiene que estar acá.
 */
import { NextResponse, type NextRequest } from "next/server";
import { API_BASE } from "@/lib/api-client";

const COOKIE = "vigia_admin";
const TTL_MS = 5 * 60 * 1000;
const validos = new Map<string, number>();

function noAutorizado(detail = "Solo el equipo de Vigía puede iniciar un análisis.") {
  return NextResponse.json({ error: "unauthorized", detail }, { status: 401 });
}

/** `null` si la sesión de equipo es válida; si no, la respuesta que hay que devolver. */
export async function exigirAdmin(req: NextRequest): Promise<NextResponse | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return noAutorizado();

  const expira = validos.get(token);
  if (expira && expira > Date.now()) return null;

  try {
    const r = await fetch(`${API_BASE}/admin/ping`, {
      headers: { "x-admin-token": token },
      cache: "no-store",
    });
    if (r.ok) {
      validos.set(token, Date.now() + TTL_MS);
      return null;
    }
    validos.delete(token);
    if (r.status === 401 || r.status === 403) {
      return noAutorizado("Tu sesión de equipo venció. Vuelve a entrar desde /admin/login.");
    }
    return NextResponse.json(
      { error: "auth_unavailable", detail: "No se pudo verificar la sesión de equipo. Reintenta en un momento." },
      { status: 503 },
    );
  } catch {
    return NextResponse.json(
      { error: "auth_unavailable", detail: "No se pudo verificar la sesión de equipo. Reintenta en un momento." },
      { status: 503 },
    );
  }
}
