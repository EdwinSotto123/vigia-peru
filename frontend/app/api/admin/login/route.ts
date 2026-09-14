import { NextResponse } from "next/server";
import { API_BASE } from "@/lib/api-client";

export const runtime = "nodejs";
const COOKIE = "vigia_admin";
const MAX_AGE = 12 * 60 * 60; // 12 h

/** POST {token, actor} → valida contra el API y deja el token en cookie httpOnly. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const actor = typeof body?.actor === "string" ? body.actor.trim().slice(0, 60) : "";
  if (!token) return NextResponse.json({ error: "token_required" }, { status: 400 });
  const r = await fetch(`${API_BASE}/admin/ping`, { headers: { "x-admin-token": token }, cache: "no-store" });
  if (!r.ok) return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: MAX_AGE });
  res.cookies.set("vigia_admin_actor", actor || "admin", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: MAX_AGE });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set("vigia_admin_actor", "", { path: "/", maxAge: 0 });
  return res;
}
