import { NextResponse } from "next/server";
import { API_BASE } from "@/lib/api-client";
import {
  accesoConfigurado,
  COOKIE_ADMIN,
  esAdmin,
  firmarSesion,
  opcionesCookie,
  perfilDe,
  tokenApi,
  verificarCuentaFirebase,
} from "@/lib/admin-sesion";

export const runtime = "nodejs";

/**
 * POST { idToken } → verifica la cuenta de Firebase, exige que su correo sea
 * del equipo (administrador principal o miembro activo de /admin/equipo) y
 * deja la sesión firmada, con su perfil, en una cookie httpOnly.
 *
 * Las respuestas dicen qué pasó (para que el login lo explique), pero nunca
 * cuáles son los correos autorizados.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  if (!idToken) return NextResponse.json({ error: "falta_token" }, { status: 400 });
  if (!accesoConfigurado()) return NextResponse.json({ error: "sin_configurar" }, { status: 503 });

  const cuenta = await verificarCuentaFirebase(idToken);
  if (!cuenta.ok) return NextResponse.json({ error: cuenta.motivo }, { status: 401 });
  // Si el token de servicio fue rotado en el API y no aquí, mejor decirlo en el
  // login que dejar entrar a un panel donde todo responde 401.
  const ping = await fetch(`${API_BASE}/admin/ping`, { headers: { "x-admin-token": tokenApi()! }, cache: "no-store" }).catch(() => null);
  if (!ping?.ok) return NextResponse.json({ error: "api_no_responde" }, { status: 502 });

  const rol = await perfilDe(cuenta.correo, { fresco: true });
  // Sin poder confirmar el perfil no se entra, pero tampoco se dice "no tienes acceso".
  if (rol === "sin_verificar") return NextResponse.json({ error: "api_no_responde" }, { status: 502 });
  if (!rol) return NextResponse.json({ error: "no_autorizado" }, { status: 403 });

  const sesion = await firmarSesion(cuenta.correo, rol);
  if (!sesion) return NextResponse.json({ error: "sin_configurar" }, { status: 503 });
  if (!esAdmin(cuenta.correo)) {
    // Último ingreso, para que /admin/equipo muestre quién usa su acceso. Si falla, no importa.
    fetch(`${API_BASE}/admin/equipo/ingreso/${encodeURIComponent(cuenta.correo)}`, {
      method: "POST", headers: { "x-admin-token": tokenApi()! }, cache: "no-store",
    }).catch(() => {});
  }
  const res = NextResponse.json({ ok: true, correo: cuenta.correo, rol });
  res.cookies.set(COOKIE_ADMIN, sesion, opcionesCookie);
  // La cookie del autor escrito a mano ya no se usa: el autor es el correo verificado.
  res.cookies.set("vigia_admin_actor", "", { path: "/", maxAge: 0 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_ADMIN, "", { path: "/", maxAge: 0 });
  res.cookies.set("vigia_admin_actor", "", { path: "/", maxAge: 0 });
  return res;
}
