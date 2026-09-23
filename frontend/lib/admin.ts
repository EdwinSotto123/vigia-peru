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
  // Texto con los tokens *Texto: amber/moss/crimson base no llegan a 4.5:1 como
  // texto sobre sus propios fondos suaves (ver tailwind.config.ts).
  pendiente_pago: { label: "Pendiente", cls: "bg-amber-soft text-amberTexto" },
  pagada: { label: "Pagada", cls: "bg-moss/10 text-mossTexto" },
  en_proceso: { label: "En proceso", cls: "bg-moss/10 text-mossTexto" },
  procesada: { label: "Procesada", cls: "bg-moss text-paper" },
  rechazada: { label: "Rechazada", cls: "bg-crimson-soft text-crimsonTexto" },
  reembolsada: { label: "Reembolsada", cls: "bg-paperDeep text-mute" },
};

export interface Resumen {
  kpi: {
    pendientesValidar: number; pendientesConComprobante: number; montoConfirmadoPen: number; contratosFinanciados: number;
    montoMesPen: number; aportes7d: number; financiadores: number; financiadoresOcultos: number;
    asignados: number; procesados: number; senales: number; enRevision?: number; colaGlobal: number; esperandoContratos: number;
  };
  serie: { dia: string; monto: number; aportes: number; pendientes: number }[];
  porEstado: { estado: string; n: number; monto: number }[];
  cola: { ubigeo: string; nombre: string; estado: string; pendientes: number; financiados: number; procesados: number; totalCola: number }[];
  top: { nombre: string; tipo: string; contratosFinanciados: number; contratosProcesados: number; senalesHalladas?: number; enRevision?: number }[];
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

// ─── U4 · Operación (GET /admin/operacion) ───────────────────────────────────

export interface SaludServicio {
  perfil: "bienes" | "servicios" | "obras" | "otros";
  nombre: string;
  url: string;
  ok: boolean | null;              // null = sin respuesta en 3 s (posible arranque en frío)
  status: number | null;
  ms: number | null;
  detalle: { perfil?: string; tipos_aceptados?: string[]; model?: string; agentes?: string[] } | null;
  error: string | null;
}

export interface Operacion {
  dispatcher: {
    ultimoInicio: string | null; ultimoLatido: string | null; ultimoFin: string | null; ultimaCorrida: string | null;
    horasDesdeUltimaCorrida: number | null; activos: number; colgados: number; procesados24h: number; errores: number; ok: boolean;
  };
  cola: Record<string, number>;
  servicios: { data: SaludServicio[]; consultadoAt: string; cacheado: boolean };
  relay: { url: string | null; ok: boolean | null };
  pedidos: { pendientes: number; descargando: number; fallidos: number; listos24h: number } | null;
  aportes: { pendientesValidar: number; conComprobante: number; esperandoContratos: number };
  revision: { n: number; masAntigua: string | null };
  lote: { id: string; tipo: string; estado: string; total: number; ok: number; fallidos: number; iniciadoAt: string | null; finalizadoAt: string | null; error: string | null } | null;
  ingesta: { ultimaIngesta: string | null; ultimas24h: number; total: number; horasSinIngesta: number | null; ok: boolean };
  ultimos: { ocid: string; finalizadoAt: string | null; segundos: number | null; titulo: string | null; score: number | null; alertaEstado: string | null }[];
  generadoEn: string;
}

// ─── U4 · Revisión humana (GET /admin/revision) ──────────────────────────────

export interface MotivoBloqueo { clave: "respaldo" | "tono" | "coherencia" | "cita" | "precio" | "urls"; texto: string; valor?: number | null; umbral?: number | null }

export interface RevisionRow {
  id: string; codigo: string; ocid: string; objeto: string | null; score: number | null; estado: string;
  region: string | null; provincia: string | null; distrito: string | null; ubigeo: string | null; zona: string | null;
  analizadoEn: string | null; createdAt: string; montoAdjudicado: number | null;
  entidadRuc: string | null; entidad: string | null; proveedorRuc: string | null; tipo: string; etapa: string | null; perfil: string | null;
  banderas: number; pct: Record<string, number | string> | null;
  moderacion: { accion: string; actor: string; motivo: string; at: string } | null;
  contribucionCodigo: string | null; financiador: string | null; procesamientoOcid: string | null;
  motivoPipeline: string | null; motivos: MotivoBloqueo[]; motivo: string;
}

export interface SelfEvalConfig { min_respaldo: number; min_cita: number; min_precio: number; bloquea_tono: boolean; bloquea_coherencia: boolean; nota?: string }

export interface BanderaRevision {
  id: string; regla: string; severidad: "alta" | "media" | "baja"; evidencia: string | null; norma: string | null; fuenteUrl: string | null; agente: string | null;
  verificacion: { ok?: boolean; motivos?: string[]; n_checks?: number } | null;
}

export interface RevisionDetalle extends RevisionRow {
  banderas: number;
  banderasDetalle?: never;
  dictamen: string | null;
  verificacionDictamen: unknown;
  validacionesPendientes: string[];
  descartes: unknown[];
  autoevaluacion: {
    pct: Record<string, number | string> | null;
    respaldo: { n?: number; ok?: number } | null; cita: { n?: number; ok?: number } | null; precio: { n?: number; ok?: number } | null;
    tono: string | null; tonoReason: string | null; coherencia: string | null; coherenciaReason: string | null;
    perBandera: { regla?: string; reason?: string; respaldada?: boolean }[];
    perPrecio: { item?: string; reason?: string; plausible?: boolean }[];
  } | null;
  umbrales: SelfEvalConfig;
  log: { actor: string; accion: string; detalle: unknown; createdAt: string }[];
}

// ─── U4 · Cobertura: progreso del lote nocturno (GET /admin/cobertura/progreso) ──

export interface ProgresoDocumentos {
  publicados: number; vigentes: number; restantes: number; pct: number;
  contratosConDocsPublicados: number; contratosConDocs: number; contratosSinBajar: number;
  ritmo: { dia: string; n: number; contratos: number }[];
  porNoche: number; nochesRestantes: number | null; estimadoFin: string | null; itemsPendientes: number;
  loteActual: { id: string; tipo: string; estado: string; total: number; ok: number; fallidos: number; iniciadoAt: string | null; finalizadoAt: string | null; error: string | null } | null;
  errores: { loteId: string; clave: string; error: string | null; procesadoAt: string | null }[];
  generadoAt: string;
}

export const PERFIL_LABEL: Record<string, string> = { bienes: "Bienes", servicios: "Servicios", obras: "Obras", otros: "Otros (consultoría, convenio, directa)" };

// ─── U6 · Procesar un lote a nombre de Vigía Perú (sin pasarela) ─────────────

export interface PreviewLote { ubigeo: string; zona: string; nivel: string; enCola: number; precioPen: number }
export interface LoteProcesado {
  codigo: string; ubigeo: string; asignados: number; solicitados: number; ocids: string[];
  pedidosAbiertos: number; listosParaProcesar: number; dispatcherDisparado: boolean;
}

/** Vista previa (cuántos hay en cola en esa zona) antes de confirmar — no escribe nada. */
export const previewLote = (ubigeo: string) => adminFetch<PreviewLote>(`/procesar-lote/preview?ubigeo=${encodeURIComponent(ubigeo)}`);

/** Crea la contribución YA `pagada` a nombre de Vigía Perú, asigna por antigüedad (FIFO, igual
 *  que un aporte ciudadano) y abre pedidos de descarga; si algún contrato ya tiene documentos,
 *  además dispara el dispatcher ahora en vez de esperar su ciclo. */
export const procesarLote = (ubigeo: string, contratos: number) =>
  adminFetch<LoteProcesado>("/procesar-lote", { method: "POST", body: JSON.stringify({ ubigeo, contratos }) });
