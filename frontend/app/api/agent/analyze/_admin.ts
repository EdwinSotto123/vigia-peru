/**
 * Guardia de las rutas que GASTAN: /api/agent/analyze, /analyze/stream,
 * /upload-doc y /random.
 *
 * Cada análisis corre ~10 agentes de Gemini y cuesta plata real. Estas rutas
 * no tenían ningún control: cualquiera con la URL (o con `?run=` en el
 * buscador público) disparaba una corrida pagada. Ahora exigen la sesión de
 * equipo: la cookie httpOnly firmada que deja /api/admin/login tras verificar
 * la cuenta de Firebase (ver lib/admin-sesion.ts). Verificar la firma es
 * local, así que ya no hace falta preguntarle al API en cada subida.
 *
 * El middleware sólo protege /admin/*; estas rutas viven en /api/agent/*, así
 * que la guardia tiene que estar acá.
 */
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ADMIN, cookieAdmin, leerSesion } from "@/lib/admin-sesion";

function noAutorizado(detail = "Solo el equipo de Vigía puede iniciar un análisis.") {
  return NextResponse.json({ error: "unauthorized", detail }, { status: 401 });
}

/** `null` si la sesión de equipo es válida; si no, la respuesta que hay que devolver. */
export async function exigirAdmin(req: NextRequest): Promise<NextResponse | null> {
  const valor = cookieAdmin(req);
  if (!valor) return noAutorizado();
  const sesion = await leerSesion(valor);
  return sesion ? null : noAutorizado("Tu sesión de equipo venció. Vuelve a entrar desde /admin/login.");
}
