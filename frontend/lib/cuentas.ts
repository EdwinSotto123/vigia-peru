"use client";

/**
 * Cliente de cuentas (perfil, configuración, "Mi impacto", seguir zonas, entidades, empresas y partidos).
 * Backend: backend/api/src/routes/cuentas.ts · migraciones 26 y 191 · docs/design/CUENTAS.md
 *
 * Sin sesión, nada de esto se llama: el sitio funciona igual. Con sesión, `useCuenta()`
 * carga el perfil UNA vez (caché en memoria compartida entre componentes) y expone las
 * acciones; cada mutación actualiza la caché y avisa a los suscriptores.
 *
 * Firebase NO se importa de forma estática (auditoría A14): este módulo lo usan el mapa y
 * los botones de seguir, que ven todos los visitantes. `useCuenta` sigue la sesión con
 * `useAuth()` (AuthProvider, que baja Firebase sólo si hay sesión guardada) y el token se
 * pide con `import()` cuando de verdad hay alguien que autenticar.
 */

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import { PUBLIC_API_BASE } from "./auditoria";
import { conAcentos } from "./financiamiento";
import { firebaseYaCargado, leerPista } from "./sesion";
import type { RedSocial } from "@/components/aliados/perfil";
import type { CambiosPerfilPublico } from "./perfilAliado";

export interface ZonaSeguida { ubigeo: string; nombre: string; nivel: "departamento" | "provincia" | "distrito" }
export interface EntidadSeguida { ruc: string; nombre: string }
/** Sólo empresas (RUC 20): una persona natural no se sigue (migración 191). */
export interface EmpresaSeguida { ruc: string; nombre: string }
export interface PartidoSeguido { clave: string; nombre: string }
export type TipoSeguido = "zona" | "entidad" | "empresa" | "partido";

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
  /** Se fija una sola vez desde la cuenta (PUT con `ruc`); después, 409 `ruc_inmutable`. Nunca se publica. */
  ruc: string | null;
  /**
   * Perfil público que el aliado define (migración 30, contrato A6). Opcionales: una API
   * desplegada antes de A6 no los devuelve, y entonces la configuración no los ofrece
   * (no se muestra un formulario que no se guardaría). `redes` llega `{}` si no publicó ninguna.
   */
  descripcion?: string | null;
  sitioWeb?: string | null;
  emailPublico?: string | null;
  portadaUrl?: string | null;
  redes?: Partial<Record<RedSocial, string>>;
  /** Migración 40: contacto y enlaces opcionales. */
  telefono?: string | null;
  ubicacion?: string | null;
  enlaces?: { titulo: string; url: string }[];
  zonasSeguidas: string[];
  entidadesSeguidas: string[];
  /** Migración 191. Opcionales: una API anterior no los devuelve. */
  empresasSeguidas?: string[];
  partidosSeguidos?: string[];
  zonas: ZonaSeguida[];
  entidades: EntidadSeguida[];
  empresas?: EmpresaSeguida[];
  partidos?: PartidoSeguido[];
  notificaciones: Record<string, boolean>;
  correo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** ¿La API ya acepta el perfil público completo desde la cuenta (A6)? Se sabe por `redes` en el GET. */
export const perfilCompletoDisponible = (p: Perfil | null | undefined) => !!p && p.redes !== undefined && p.redes !== null;

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
/** Una empresa que sigo, con lo que dice su ficha (o, si sólo ganó compras menores, su nombre en la SUNAT). */
export interface EmpresaSeguidaResumen {
  ruc: string; nombre: string | null; estadoSunat: string | null; entidades: number; adjProcesos: number; adjMonto: number;
  ordN: number; ordMonto: number; nAlta: number; nMedia: number; ultima: string | null; inhabilitada: string | null;
  inhabilitadaHasta: string | null; soloMenores: boolean;
}
/** Un partido que sigo, con dónde gobierna en el período vigente (`anio`: año de su elección). */
export interface PartidoSeguidoResumen { clave: string; nombre: string | null; regional: number; provincial: number; distrital: number; anio: number }
/** Por qué algo está en lo nuevo de lo que sigo: la entidad, la empresa o el partido que lo trae. */
export interface PorQueSeguido { tipo: "entidad" | "empresa" | "partido"; id: string; nombre: string }
export interface NovedadesSeguidas {
  /** Último día con buenas pro y cruces calculados (los contratos son de los `dias` hasta ese día). */
  hasta: string | null;
  dias: number;
  diasInformes: number;
  contratos: {
    ocid: string; ruc: string | null; proveedor: string | null; entidad: string | null; entidadRuc: string; tipo: string | null;
    objeto: string | null; fecha: string; monto: number | null; tipos: string[] | null; nAlta: number; nMedia: number;
    severidad: "alta" | "media"; por: PorQueSeguido[];
  }[];
  informes: { codigo: string; numero: string | null; titulo: string | null; entidad: string | null; entidadRuc: string; responsabilidades: string[] | null; fecha: string; url: string | null; por: PorQueSeguido[] }[];
  sanciones: { id: number; ruc: string; nombre: string | null; tipo: string | null; resolucion: string | null; fecha: string; desde: string | null; hasta: string | null; multa: number | null }[];
}
export interface Impacto {
  perfil: Perfil;
  aportes: AporteMio[];
  denuncias: DenunciaMia[];
  zonasSeguidas: { ubigeo: string; nivel: string; nombre: string; pendientes: number; financiados: number; procesados: number; senales: number; totalCola: number; estado: string; enRevision: number; documentosListos: number }[];
  entidadesSeguidas: EntidadSeguida[];
  /** Migración 191 (opcionales: una API anterior no los devuelve). */
  empresasSeguidas?: EmpresaSeguidaResumen[];
  partidosSeguidos?: PartidoSeguidoResumen[];
  novedades?: NovedadesSeguidas;
  resumen: { aportes: number; contratosFinanciados: number; procesados: number; senales: number; denuncias: number };
}

// ─── fetch autenticado ───────────────────────────────────────────────────────

/**
 * El usuario de Firebase, o null. Si la pista dice que no hay sesión y Firebase no se
 * cargó en esta pestaña, no hay a quién autenticar: no se baja Firebase para confirmarlo.
 */
async function usuarioActual(): Promise<User | null> {
  if (!firebaseYaCargado() && leerPista() === "0") return null;
  try {
    const { auth } = await import("./firebase");
    // La sesión guardada se restaura de forma asíncrona: sin esperar, recién cargado
    // `currentUser` todavía es null aunque haya sesión.
    await auth.authStateReady();
    return auth.currentUser;
  } catch {
    return null;
  }
}

export async function idToken(): Promise<string | null> {
  const u = await usuarioActual();
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

/**
 * Error del API de cuentas con lo que el formulario necesita para marcar el campo:
 * `codigo` (`perfil_invalido`, `ruc_inmutable`, `invalid_body`…) y `campo` (el del cuerpo:
 * "descripcion", "redes.facebook"…). El mensaje es `detalle`/`detail` del API, o el código.
 */
export class CuentaError extends Error {
  constructor(public status: number, public codigo: string | null, message: string, public campo: string | null = null) { super(message); }
}

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const b = j as { error?: unknown; detalle?: unknown; detail?: unknown; campo?: unknown; issues?: { path?: unknown[] }[] };
    const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
    // zod (400 `invalid_body`) no trae `campo`, pero sí la ruta del primer problema.
    const ruta = Array.isArray(b.issues) && Array.isArray(b.issues[0]?.path) ? b.issues[0].path.map(String).join(".") : null;
    throw new CuentaError(r.status, texto(b.error), texto(b.detalle) ?? texto(b.detail) ?? texto(b.error) ?? `HTTP ${r.status}`, texto(b.campo) ?? (ruta || null));
  }
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
  const u = await usuarioActual();
  if (!u) { setPerfil(null); return null; }
  if (!force && cache && cache.uid === u.uid) return cache.perfil;
  if (enCurso) return enCurso;
  enCurso = authFetch("/cuentas/me").then((r) => json<Perfil>(r)).then((p) => { setPerfil(p); return p; })
    .catch(() => { return cache?.perfil ?? null; }).finally(() => { enCurso = null; });
  return enCurso;
}

/**
 * Lo que acepta PUT /cuentas/me. El perfil público (descripción, web, correo público, redes,
 * portada) va sólo con lo que cambió y "" lo borra (lib/perfilAliado.ts). `ruc`, sólo si la
 * cuenta aún no tiene uno (si ya tiene: 409 `ruc_inmutable`).
 */
export type CambiosCuenta = Partial<Pick<Perfil, "nombrePublico" | "visible" | "correo" | "notificaciones" | "logoUrl" | "tipo">> &
  CambiosPerfilPublico & { ruc?: string };

export const actualizarPerfil = (body: CambiosCuenta) =>
  authFetch("/cuentas/me", { method: "PUT", body: JSON.stringify(body) }).then((r) => json<Perfil>(r)).then((p) => { setPerfil(p); return p; });

/**
 * Sube una imagen pública del perfil (logo o portada) a /api/upload con `kind=logo`: bucket
 * público, exige sesión (Bearer). La ruta también acepta PDF; acá sólo sirve una foto.
 */
export async function subirImagenPerfil(f: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", f);
  fd.append("kind", "logo");
  const token = await idToken();
  const r = await fetch("/api/upload", { method: "POST", body: fd, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  const j = (await r.json().catch(() => ({}))) as { url?: string; tipo?: string; mensaje?: string };
  if (!r.ok || !j.url) throw new Error(j.mensaje ?? "No pudimos subir la imagen. Inténtalo otra vez en un momento.");
  if (j.tipo !== "foto") throw new Error("Sube una imagen JPG, PNG o WebP.");
  return j.url;
}

export const seguir = (tipo: TipoSeguido, id: string) =>
  authFetch("/cuentas/me/seguir", { method: "POST", body: JSON.stringify({ tipo, id }) }).then((r) => json<Perfil>(r)).then((p) => { setPerfil(p); return p; });

export const dejarDeSeguir = (tipo: TipoSeguido, id: string) =>
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

/** ¿Sigue esa entidad, empresa o partido? (Las zonas, con `sigueZona`.) */
export function sigue(p: Perfil | null | undefined, tipo: Exclude<TipoSeguido, "zona">, id: string): boolean {
  if (!p) return false;
  const lista = tipo === "entidad" ? p.entidadesSeguidas : tipo === "empresa" ? p.empresasSeguidas : p.partidosSeguidos;
  return (lista ?? []).includes(id);
}

/** ¿La zona (o su departamento) está entre las seguidas? Acepta ubigeo de 2/4/6 dígitos. */
export function sigueZona(p: Perfil | null | undefined, ubigeo: string | null | undefined): boolean {
  if (!p || !ubigeo) return false;
  return p.zonasSeguidas.some((z) => z === ubigeo);
}

/** Hook: perfil de la cuenta (null sin sesión) + acciones. Se comparte la caché entre componentes. */
export function useCuenta(): { perfil: Perfil | null; cargando: boolean; recargar: () => Promise<Perfil | null> } {
  const { user, loading } = useAuth();
  const uid = user?.uid ?? null;
  const [perfil, setP] = useState<Perfil | null>(cache?.perfil ?? null);
  const [cargando, setCargando] = useState(!cache);
  useEffect(() => {
    const f = () => setP(cache?.perfil ?? null);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  // La sesión la sigue AuthProvider: el perfil se pide cuando hay usuario, y se vacía sin él.
  useEffect(() => {
    if (loading) return;
    if (!uid) { setPerfil(null); setCargando(false); return; }
    let vivo = true;
    setCargando(true);
    cargarPerfil().finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [uid, loading]);
  return { perfil, cargando, recargar: () => cargarPerfil(true) };
}

// ─── borrador local del flujo de financiar (sin cuenta también) ─────────────

export interface BorradorFinanciar {
  ubigeo: string; contratos: number; tipo: string; nombre: string; ruc: string; email: string; mensaje: string; metodo: string;
  creada?: { codigo: string; montoPen: number; contratos: number; pago: unknown; creadaAt: string } | null;
}
const KEY = (ubigeo: string) => `vigia:financiar:${ubigeo}`;
const PREFIJO_BORRADOR = "vigia:financiar:";
/** Evento de la misma pestaña: `storage` solo avisa a las OTRAS pestañas. */
export const EVENTO_BORRADOR = "vigia:borrador";
const avisar = () => { try { window.dispatchEvent(new Event(EVENTO_BORRADOR)); } catch { /* sin window */ } };
export function leerBorrador(ubigeo: string): BorradorFinanciar | null {
  try { const raw = localStorage.getItem(KEY(ubigeo)); return raw ? (JSON.parse(raw) as BorradorFinanciar) : null; } catch { return null; }
}
export function guardarBorrador(b: BorradorFinanciar) {
  try { localStorage.setItem(KEY(b.ubigeo), JSON.stringify(b)); } catch { /* sin storage */ }
  avisar();
}
export function borrarBorrador(ubigeo: string) {
  try { localStorage.removeItem(KEY(ubigeo)); } catch { /* sin storage */ }
  avisar();
}

/** Aportes ya creados (con código) que siguen sin comprobante, en este navegador: el más reciente primero. */
export function listarPagosPendientes(maxDias = 7): (BorradorFinanciar & { creada: NonNullable<BorradorFinanciar["creada"]> })[] {
  const out: (BorradorFinanciar & { creada: NonNullable<BorradorFinanciar["creada"]> })[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIJO_BORRADOR)) continue;
      const b = JSON.parse(localStorage.getItem(k) ?? "null") as BorradorFinanciar | null;
      if (!b?.creada?.codigo) continue;
      if (Date.now() - new Date(b.creada.creadaAt).getTime() > maxDias * 86_400_000) continue;
      out.push({ ...b, ubigeo: k.slice(PREFIJO_BORRADOR.length), creada: b.creada });
    }
  } catch { /* sin storage */ }
  return out.sort((a, b) => +new Date(b.creada.creadaAt) - +new Date(a.creada.creadaAt));
}

/** Página donde se financia ese borrador (inverso de `claveAlcance`). */
export function hrefDeBorrador(clave: string): string {
  if (clave.startsWith("entidad-")) return `/app/financiar/entidad/${clave.slice(8)}`;
  const m = /^partido-(.+)-(\d{4})$/.exec(clave);
  if (m) return `/app/financiar/partido/${m[1]}?anio=${m[2]}`;
  return `/app/financiar/${clave}`;
}
