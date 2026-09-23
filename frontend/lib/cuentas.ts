"use client";

/**
 * Cliente de cuentas (perfil, configuración, "Mi impacto", seguir zonas/entidades).
 * Backend: backend/api/src/routes/cuentas.ts · migración 26 · docs/design/CUENTAS.md
 *
 * Sin sesión, nada de esto se llama: el sitio funciona igual. Con sesión, `useCuenta()`
 * carga el perfil UNA vez (caché en memoria compartida entre componentes) y expone las
 * acciones; cada mutación actualiza la caché y avisa a los suscriptores.
 */

import { useEffect, useState } from "react";
import { auth } from "./firebase";
import { PUBLIC_API_BASE } from "./auditoria";
import { conAcentos } from "./financiamiento";

export interface ZonaSeguida { ubigeo: string; nombre: string; nivel: "departamento" | "provincia" | "distrito" }
export interface EntidadSeguida { ruc: string; nombre: string }

export interface Perfil {
  uid: string;
  userId: string | null;
  financiadorId: number | null;
  nombrePublico: string | null;
  visible: boolean;
  aliadoVisible: boolean | null;
  motivoNoVisible: string | null;
  slug: string | null;
  logoUrl: string | null;
  tipo: "empresa" | "persona" | "organizacion" | null;
  ruc: string | null;
  zonasSeguidas: string[];
  entidadesSeguidas: string[];
  zonas: ZonaSeguida[];
  entidades: EntidadSeguida[];
  notificaciones: Record<string, boolean>;
  correo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AporteMio {
  codigo: string; estado: string; contratos: number; montoPen: number; createdAt: string; pagadaAt: string | null;
  tieneComprobante: boolean; comprobanteUrl: string | null; ubigeo: string; zona: string; nivel: string;
  asignados: number; procesados: number; senales: number; enRevision: number; primerOcid: string | null;
}
export interface DenunciaMia {
  id: string; categoria: string; descripcion: string; region: string | null; provincia: string | null; distrito: string | null;
  fecha: string | null; createdAt: string; moderacionEstado: string; confirmado: boolean; confirmaciones: number;
  convergenciaId: string | null; fotoUrl: string | null;
}
export interface Impacto {
  perfil: Perfil;
  aportes: AporteMio[];
  denuncias: DenunciaMia[];
  zonasSeguidas: { ubigeo: string; nivel: string; nombre: string; pendientes: number; financiados: number; procesados: number; senales: number; totalCola: number; estado: string; enRevision: number; documentosListos: number }[];
  entidadesSeguidas: EntidadSeguida[];
  resumen: { aportes: number; contratosFinanciados: number; procesados: number; senales: number; denuncias: number };
}

// ─── fetch autenticado ───────────────────────────────────────────────────────

export async function idToken(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u) return null;
  try { return await u.getIdToken(); } catch { return null; }
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await idToken();
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${PUBLIC_API_BASE}${path}`, { ...init, headers, cache: "no-store" });
}

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).detail ?? (j as any).error ?? `HTTP ${r.status}`);
  return j as T;
}

// ─── caché compartida ────────────────────────────────────────────────────────

let cache: { uid: string; perfil: Perfil } | null = null;
let enCurso: Promise<Perfil | null> | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

function setPerfil(p: Perfil | null) {
  cache = p ? { uid: p.uid, perfil: p } : null;
  notify();
}

export async function cargarPerfil(force = false): Promise<Perfil | null> {
  const u = auth.currentUser;
  if (!u) { setPerfil(null); return null; }
  if (!force && cache && cache.uid === u.uid) return cache.perfil;
  if (enCurso) return enCurso;
  enCurso = authFetch("/cuentas/me").then((r) => json<Perfil>(r)).then((p) => { setPerfil(p); return p; })
    .catch(() => { return cache?.perfil ?? null; }).finally(() => { enCurso = null; });
  return enCurso;
}

export const actualizarPerfil = (body: Partial<Pick<Perfil, "nombrePublico" | "visible" | "correo" | "notificaciones" | "logoUrl" | "tipo">>) =>
  authFetch("/cuentas/me", { method: "PUT", body: JSON.stringify(body) }).then((r) => json<Perfil>(r)).then((p) => { setPerfil(p); return p; });

export const seguir = (tipo: "zona" | "entidad", id: string) =>
  authFetch("/cuentas/me/seguir", { method: "POST", body: JSON.stringify({ tipo, id }) }).then((r) => json<Perfil>(r)).then((p) => { setPerfil(p); return p; });

export const dejarDeSeguir = (tipo: "zona" | "entidad", id: string) =>
  authFetch("/cuentas/me/seguir", { method: "DELETE", body: JSON.stringify({ tipo, id }) }).then((r) => json<Perfil>(r)).then((p) => { setPerfil(p); return p; });

export const reclamarAporte = (codigo: string, email: string) =>
  authFetch("/cuentas/me/reclamar", { method: "POST", body: JSON.stringify({ codigo, email }) }).then((r) => json<{ ok: true; codigo: string; perfil: Perfil }>(r)).then((x) => { setPerfil(x.perfil); return x; });

export const getImpacto = () =>
  authFetch("/cuentas/me/impacto").then((r) => json<Impacto>(r)).then((d) => ({
    ...d,
    aportes: d.aportes.map((a) => ({ ...a, zona: conAcentos(a.zona) })),
    zonasSeguidas: d.zonasSeguidas.map((z) => ({ ...z, nombre: conAcentos(z.nombre) })),
  }));

export const exportarDatos = () => authFetch("/cuentas/me/exportar").then((r) => json<Record<string, unknown>>(r));

export const borrarCuentaApi = () =>
  authFetch("/cuentas/me", { method: "DELETE" }).then((r) => json<{ ok: true; aportesConservados: number; mensaje: string }>(r)).then((x) => { setPerfil(null); return x; });

/** ¿La zona (o su departamento) está entre las seguidas? Acepta ubigeo de 2/4/6 dígitos. */
export function sigueZona(p: Perfil | null | undefined, ubigeo: string | null | undefined): boolean {
  if (!p || !ubigeo) return false;
  return p.zonasSeguidas.some((z) => z === ubigeo);
}

/** Hook: perfil de la cuenta (null sin sesión) + acciones. Se comparte la caché entre componentes. */
export function useCuenta(): { perfil: Perfil | null; cargando: boolean; recargar: () => Promise<Perfil | null> } {
  const [perfil, setP] = useState<Perfil | null>(cache?.perfil ?? null);
  const [cargando, setCargando] = useState(!cache);
  useEffect(() => {
    const f = () => setP(cache?.perfil ?? null);
    subs.add(f);
    const unsub = auth.onAuthStateChanged((u) => {
      if (!u) { setPerfil(null); setCargando(false); return; }
      setCargando(true);
      cargarPerfil().finally(() => setCargando(false));
    });
    return () => { subs.delete(f); unsub(); };
  }, []);
  return { perfil, cargando, recargar: () => cargarPerfil(true) };
}

// ─── borrador local del flujo de financiar (sin cuenta también) ─────────────

export interface BorradorFinanciar {
  ubigeo: string; contratos: number; tipo: string; nombre: string; ruc: string; email: string; mensaje: string; metodo: string;
  creada?: { codigo: string; montoPen: number; contratos: number; pago: unknown; creadaAt: string } | null;
}
const KEY = (ubigeo: string) => `vigia:financiar:${ubigeo}`;
export function leerBorrador(ubigeo: string): BorradorFinanciar | null {
  try { const raw = localStorage.getItem(KEY(ubigeo)); return raw ? (JSON.parse(raw) as BorradorFinanciar) : null; } catch { return null; }
}
export function guardarBorrador(b: BorradorFinanciar) {
  try { localStorage.setItem(KEY(b.ubigeo), JSON.stringify(b)); } catch { /* sin storage */ }
}
export function borrarBorrador(ubigeo: string) {
  try { localStorage.removeItem(KEY(ubigeo)); } catch { /* sin storage */ }
}
