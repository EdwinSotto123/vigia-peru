"use client";

/** Cliente del panel admin: todo pasa por /api/admin/* (cookie httpOnly → API). */

export class AdminError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") window.location.href = `/admin/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new AdminError(401, "Sesión expirada");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminError(res.status, j.detail ?? j.error ?? `HTTP ${res.status}`);
  return j as T;
}

export const fmtPEN = (n: number) => `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const ESTADO_UI: Record<string, { label: string; cls: string }> = {
  pendiente_pago: { label: "Pendiente", cls: "bg-amber-soft text-amber" },
  pagada: { label: "Pagada", cls: "bg-moss/10 text-moss" },
  en_proceso: { label: "En proceso", cls: "bg-moss/10 text-moss" },
  procesada: { label: "Procesada", cls: "bg-moss text-paper" },
  rechazada: { label: "Rechazada", cls: "bg-crimson-soft text-crimson" },
  reembolsada: { label: "Reembolsada", cls: "bg-paperDeep text-mute" },
};

export interface Resumen {
  kpi: {
    pendientesValidar: number; pendientesConComprobante: number; montoConfirmadoPen: number; contratosFinanciados: number;
    montoMesPen: number; aportes7d: number; financiadores: number; financiadoresOcultos: number;
    asignados: number; procesados: number; senales: number; colaGlobal: number; esperandoContratos: number;
  };
  serie: { dia: string; monto: number; aportes: number; pendientes: number }[];
  porEstado: { estado: string; n: number; monto: number }[];
  cola: { ubigeo: string; nombre: string; estado: string; pendientes: number; financiados: number; procesados: number; totalCola: number }[];
  top: { nombre: string; tipo: string; contratosFinanciados: number; contratosProcesados: number }[];
}

export interface ContribucionAdmin {
  codigo: string; estado: string; contratos: number; montoPen: number; pasarela: string | null; pasarelaRef: string | null;
  tieneComprobante: boolean; createdAt: string; pagadaAt: string | null; validadaPor: string | null;
  mensajePublico: string | null; notaAdmin: string | null; zona: string; nivel: string; ubigeo: string;
  financiadorId: number; tipo: string; nombrePublico: string | null; ruc: string | null; email: string; visible: boolean; motivoNoVisible: string | null;
  asignados: number; procesados: number;
}

export interface PagosConfig {
  yape: { numero: string; titular: string; qr_url: string };
  plin: { numero: string; titular: string; qr_url: string };
  cuentas: { banco: string; moneda: "PEN" | "USD"; tipo: string; numero: string; cci: string; titular: string }[];
  instrucciones: string;
  contacto_email: string;
}
