/**
 * La cuenta de Gobserva en el navegador (2026-11-01): tipos y llamadas a /v1/gobserva/cuenta (con el token de Firebase,
 * lib/cuentas.ts → authFetch) y al catálogo público de planes (/v1/gobserva/planes). Sin Firebase estático: lo usan
 * componentes que viven en todas las páginas de los productos (el menú de la cuenta).
 */
import { authFetch } from "./cuentas";
import { PUBLIC_API_BASE } from "./auditoria";
import type { Producto } from "./gobserva";

export type Frecuencia = "diaria" | "semanal";
export type MedioManual = "yape" | "plin" | "transferencia";

export interface Limites {
  alertas: number;
  frecuencias: Frecuencia[];
  guardados: number;
  csv: boolean;
  filasCsv: number;
  recordatorios: boolean;
}

export interface PlanCatalogo {
  id: string;
  nombre: string;
  precio: number;
  fundador: { precio: number; cupo?: number | null; meses?: number | null; libres: number | null } | null;
  limites: Limites;
}

export interface MedioQr {
  numero: string;
  titular: string;
  qrUrl: string | null;
}

export interface Catalogo {
  producto: Producto;
  planes: PlanCatalogo[];
  medios: {
    tarjeta: { publicKey: string } | null;
    yape: MedioQr | null;
    plin: MedioQr | null;
    transferencia: { cuentas: { banco?: string; numero?: string; cci?: string; titular?: string }[] } | null;
  };
  vendedor: { nombreComercial: string; ruc: string | null; razonSocial: string | null; correo: string };
  aviso: string | null;
  correoActivo: boolean;
  /** Lo que trae una cuenta gratis. */
  gratis?: Limites;
}

export interface Cuenta {
  email: string;
  emailVerificado: boolean;
  nombre: string | null;
  empresa: string | null;
  ruc: string | null;
  razonSocial: string | null;
  direccionFiscal: string | null;
  telefono: string | null;
  whatsapp: boolean;
  boletin: boolean;
  creado: string;
}

export interface PlanCliente {
  codigo: string;
  producto: Producto;
  plan: string;
  nombrePlan: string;
  nombreProducto: string;
  medio: "tarjeta" | "yape" | "plin" | "transferencia" | "cortesia";
  estado: "pendiente" | "activa" | "cancelada" | "vencida" | "rechazada";
  monto: number;
  regular: number;
  fundador: boolean;
  mesesFundador: number | null;
  cobros: number;
  renovar: boolean;
  estadoMp: string | null;
  vigenteHasta: string | null;
  creado: string;
}

export interface CobroPendiente {
  numero: string;
  medio: MedioManual | "tarjeta";
  monto: number;
  meses: number;
  operacion: string | null;
  producto: Producto;
  plan: string;
  codigo: string;
  creado: string;
}

export interface Me {
  cuenta: Cuenta;
  planes: PlanCliente[];
  pendientes: CobroPendiente[];
  producto: {
    clave: Producto;
    plan: string | null;
    nombrePlan: string;
    limites: Limites;
    usados: { alertas: number; guardados: number };
    alertas: boolean;
  } | null;
  correoActivo: boolean;
}

export interface Cobro {
  numero: string;
  medio: PlanCliente["medio"];
  monto: number;
  meses: number;
  estado: "pendiente" | "pagado" | "rechazado" | "reembolsado";
  operacion: string | null;
  motivo: string | null;
  creado: string;
  pagado: string | null;
  codigo: string;
  producto: Producto;
  plan: string;
}

export interface Recibo extends Cobro {
  email: string;
  nombre: string | null;
  empresa: string | null;
  ruc: string | null;
  razonSocial: string | null;
  direccionFiscal: string | null;
  nombrePlan: string;
  nombreProducto: string;
  vendedor: { nombreComercial: string; ruc: string; razonSocial: string; direccion: string; correo: string };
}

export interface Alerta {
  id: number;
  producto: Producto;
  nombre: string;
  filtros: Record<string, string | number | boolean>;
  frecuencia: Frecuencia;
  activa: boolean;
  ultimoConteo: number | null;
  ultimoEnvio: string | null;
  creado: string;
}

export interface ItemAviso {
  ref: string;
  titulo: string;
  enlace: string;
  datos: string[];
  marca?: string;
}

export interface Envio {
  id: number;
  producto: Producto;
  tipo: "alerta" | "recordatorio" | "recibo" | "aviso";
  asunto: string | null;
  items: ItemAviso[];
  nItems: number;
  estado: "enviado" | "en_la_web" | "fallido";
  creado: string;
}

export type TipoGuardado = "plaza" | "oportunidad" | "proyecto" | "empresa" | "entidad";
export type EstadoGuardado = "guardada" | "postule" | "entrevista" | "descartada" | "preparando" | "presentada" | "ganada" | "perdida";

export interface Guardado {
  producto: Producto;
  tipo: TipoGuardado;
  ref: string;
  titulo: string | null;
  datos: Record<string, string | number | boolean | null>;
  estado: EstadoGuardado;
  nota: string | null;
  recordar: boolean;
  creado: string;
  actualizado: string;
}

/** Un error de la API de la cuenta, con su código y el mensaje para mostrar. */
export class ErrorCuenta extends Error {
  constructor(public status: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

const MENSAJES: Record<string, string> = {
  missing_token: "Tu sesión terminó. Vuelve a entrar.",
  invalid_token: "Tu sesión terminó. Vuelve a entrar.",
  rate_limited: "Hiciste muchos cambios seguidos. Espera un momento.",
};

async function api<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const r = await authFetch(`/gobserva/cuenta${ruta}`, init);
  const j = (await r.json().catch(() => null)) as (T & { error?: string; detail?: string }) | null;
  if (!r.ok) {
    const codigo = j?.error ?? `http_${r.status}`;
    throw new ErrorCuenta(r.status, codigo, j?.detail ?? MENSAJES[codigo] ?? "No pudimos completar eso. Vuelve a intentarlo.");
  }
  return j as T;
}

const cuerpo = (b: unknown): RequestInit => ({ body: JSON.stringify(b) });

export const cargarMe = (producto: Producto) => api<Me>(`/me?producto=${producto}`);
export const guardarPerfil = (b: Partial<Omit<Cuenta, "email" | "emailVerificado" | "creado">>) => api<{ ok: true }>("/me", { method: "PUT", ...cuerpo(b) });
export const borrarCuenta = () => api<{ ok: true }>("/me", { method: "DELETE" });

export const pagarConTarjeta = (b: { producto: Producto; plan: string; tarjeta: unknown }) =>
  api<{ ok: true; codigo: string; estado: string; vigenteHasta: string | null; monto: number }>("/checkout/tarjeta", { method: "POST", ...cuerpo(b) });
export const pagarConQr = (b: { producto: Producto; plan: string; medio: MedioManual; meses: number }) =>
  api<{ ok: true; codigo: string; numero: string; monto: number; meses: number; medio: MedioManual; destino: MedioQr | { cuentas: unknown[] } }>(
    "/checkout/manual", { method: "POST", ...cuerpo(b) });
export const enviarOperacion = (numero: string, operacion: string) =>
  api<{ ok: true }>(`/cobros/${encodeURIComponent(numero)}/operacion`, { method: "POST", ...cuerpo({ operacion }) });
export const cancelarPlan = (codigo: string, motivo?: string) =>
  api<{ ok: true; estado: string; vigenteHasta: string | null }>(`/planes/${encodeURIComponent(codigo)}/cancelar`, { method: "POST", ...cuerpo({ motivo }) });
export const cargarCobros = () => api<{ data: Cobro[] }>("/cobros");
export const cargarRecibo = (numero: string) => api<Recibo>(`/cobros/${encodeURIComponent(numero)}`);

export const cargarAlertas = (producto: Producto) => api<{ data: Alerta[] }>(`/alertas?producto=${producto}`);
export const crearAlerta = (b: { producto: Producto; nombre: string; filtros: Alerta["filtros"]; frecuencia: Frecuencia }) =>
  api<{ ok: true; id: number }>("/alertas", { method: "POST", ...cuerpo(b) });
export const cambiarAlerta = (id: number, b: Partial<Pick<Alerta, "nombre" | "filtros" | "frecuencia" | "activa">>) =>
  api<{ ok: true }>(`/alertas/${id}`, { method: "PUT", ...cuerpo(b) });
export const borrarAlerta = (id: number) => api<{ ok: true }>(`/alertas/${id}`, { method: "DELETE" });
export const probarAlerta = (producto: Producto, filtros: Alerta["filtros"]) =>
  api<{ total: number; items: ItemAviso[] }>("/alertas/probar", { method: "POST", ...cuerpo({ producto, filtros }) });
export const enviarAlertaAhora = (id: number) => api<{ ok: true; conNovedades: number; correos: number; enLaWeb: number }>(`/alertas/${id}/enviar`, { method: "POST" });
export const cargarBandeja = (producto: Producto) => api<{ data: Envio[] }>(`/bandeja?producto=${producto}`);

export const cargarGuardados = (producto: Producto) => api<{ data: Guardado[] }>(`/guardados?producto=${producto}`);
export const guardar = (b: { producto: Producto; tipo: TipoGuardado; ref: string; titulo?: string; datos?: Guardado["datos"]; estado?: EstadoGuardado; nota?: string; recordar?: boolean }) =>
  api<{ ok: true; nuevo: boolean }>("/guardados", { method: "PUT", ...cuerpo(b) });
export const quitarGuardado = (producto: Producto, tipo: TipoGuardado, ref: string) =>
  api<{ ok: true }>(`/guardados?${new URLSearchParams({ producto, tipo, ref })}`, { method: "DELETE" });

export interface DispositivoPush {
  id: number;
  producto: Producto;
  dispositivo: string | null;
  creado: string;
  ultimoOk: string | null;
}
/** La llave para suscribirse (null: la API no tiene notificaciones) y los dispositivos activados en ese producto. */
export const cargarPush = (producto: Producto) => api<{ clave: string | null; dispositivos: DispositivoPush[] }>(`/push?producto=${producto}`);
export const activarPush = (producto: Producto, suscripcion: PushSubscriptionJSON, dispositivo: string) =>
  api<{ ok: true }>("/push", { method: "POST", ...cuerpo({ producto, suscripcion, dispositivo }) });
export const desactivarPush = (b: { endpoint?: string; id?: number }) => api<{ ok: true }>("/push", { method: "DELETE", ...cuerpo(b) });
export const probarPush = (producto: Producto) => api<{ ok: true; enviados: number }>("/push/probar", { method: "POST", ...cuerpo({ producto }) });

/** Descarga la búsqueda en CSV (planes de pago): pide el archivo con la sesión y lo guarda en el equipo. */
export async function descargarCsv(producto: Producto, filtros: Record<string, string>): Promise<number> {
  const qs = new URLSearchParams({ producto, ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)) });
  const r = await authFetch(`/gobserva/cuenta/exportar?${qs}`);
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: string; detail?: string } | null;
    throw new ErrorCuenta(r.status, j?.error ?? `http_${r.status}`, j?.detail ?? "No pudimos preparar el archivo.");
  }
  const blob = await r.blob();
  const nombre = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `gobserva-${producto}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return Number(r.headers.get("x-filas") ?? 0);
}

/** El catálogo público de planes de un producto (precios de hoy, medios de pago y vendedor). */
export async function cargarCatalogo(producto: Producto): Promise<Catalogo> {
  const r = await fetch(`${PUBLIC_API_BASE}/gobserva/planes?producto=${producto}`, { cache: "no-store" });
  if (!r.ok) throw new ErrorCuenta(r.status, `http_${r.status}`, "No pudimos cargar los planes. Vuelve a intentarlo.");
  return (await r.json()) as Catalogo;
}

/** Pausa una alerta con el enlace de su correo (sin sesión). */
export async function pausarAlerta(token: string): Promise<{ nombre: string; producto: Producto }> {
  const r = await fetch(`${PUBLIC_API_BASE}/gobserva/alertas/pausar?t=${encodeURIComponent(token)}`, { method: "POST", cache: "no-store" });
  const j = (await r.json().catch(() => null)) as { nombre?: string; producto?: Producto; detail?: string } | null;
  if (!r.ok || !j?.nombre) throw new ErrorCuenta(r.status, "no_encontrado", j?.detail ?? "Ese enlace ya no sirve.");
  return { nombre: j.nombre, producto: j.producto as Producto };
}

// ─── Textos ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export { precioCorto, soles2 } from "./gobserva-planes";

export const NOMBRE_MEDIO: Record<PlanCliente["medio"], string> = {
  tarjeta: "Tarjeta (Mercado Pago)",
  yape: "Yape",
  plin: "Plin",
  transferencia: "Transferencia",
  cortesia: "Cortesía",
};

export const ESTADO_PLAN: Record<PlanCliente["estado"], string> = {
  pendiente: "Esperando el pago",
  activa: "Activo",
  cancelada: "Cancelado",
  vencida: "Vencido",
  rechazada: "No se completó",
};

const MESES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
/** «2026-11-05» → «5 nov. 2026». */
export function fechaLarga(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : "Sin fecha";
}
