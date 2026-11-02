import type { Tone } from "@/components/admin/ui";

/**
 * Lo que devuelve /api/admin/gobserva/* (backend/api/src/routes/admin_gobserva.ts) y cómo se nombra cada cosa en el
 * panel. Sólo admin: trae correos, teléfonos y pagos.
 */
export type ProductoG = "empleo" | "licitaciones" | "obras";
export const PRODUCTOS_G: ProductoG[] = ["empleo", "licitaciones", "obras"];

export const PRODUCTO: Record<string, string> = { empleo: "Empleo", licitaciones: "Licitaciones", obras: "Obras", mcp: "MCP" };
export const PLAN: Record<string, string> = {
  gratis: "Gratis",
  alertas: "Alertas",
  pro: "Pro",
  empresa: "Empresa",
  institucional: "Institucional",
  mcp: "MCP",
};
export const MEDIO: Record<string, string> = { tarjeta: "Tarjeta", yape: "Yape", plin: "Plin", transferencia: "Transferencia", cortesia: "Cortesía" };

export const ESTADO_PLAN: Record<string, { etiqueta: string; tono: Tone }> = {
  activa: { etiqueta: "Activo", tono: "ok" },
  pendiente: { etiqueta: "Esperando el pago", tono: "warn" },
  cancelada: { etiqueta: "No se renueva", tono: "muted" },
  vencida: { etiqueta: "Vencido", tono: "muted" },
  rechazada: { etiqueta: "No se completó", tono: "danger" },
};
export const ESTADO_COBRO: Record<string, { etiqueta: string; tono: Tone }> = {
  pendiente: { etiqueta: "Por validar", tono: "warn" },
  pagado: { etiqueta: "Pagado", tono: "ok" },
  rechazado: { etiqueta: "Rechazado", tono: "danger" },
  reembolsado: { etiqueta: "Devuelto", tono: "pending" },
};
export const ESTADO_ENVIO: Record<string, { etiqueta: string; tono: Tone }> = {
  enviado: { etiqueta: "Enviado", tono: "ok" },
  en_la_web: { etiqueta: "En la web", tono: "neutral" },
  fallido: { etiqueta: "Falló", tono: "danger" },
};
export const TIPO_ENVIO: Record<string, string> = { alerta: "Alerta", recordatorio: "Recordatorio", recibo: "Recibo", aviso: "Aviso" };

const PEN = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** «S/ 4.90», «S/ 1,250.00». */
export const soles = (n: number | null | undefined) => (n == null ? "S/ 0.00" : `S/ ${PEN.format(n)}`);

export interface Resumen {
  ingresos: { esteMes: number; total: number; cobros: number };
  porProducto: { producto: ProductoG; nombre: string; activos: number; mensual: number; fundadores: number; cortesias: number }[];
  mensualTotal: number;
  cuentas: { cuentas: number; semana: number; verificadas: number };
  pendientes: { n: number; conOperacion: number };
  alertas: { activas: number; total: number };
  envios: { enviados: number; enLaWeb: number; fallidos: number };
  correoActivo: boolean;
  tarjetaActiva: boolean;
}

export interface ClienteAdmin {
  codigo: string;
  producto: ProductoG;
  plan: string;
  medio: string;
  estado: string;
  monto: number;
  regular: number;
  fundador: boolean;
  cobros: number;
  renovar: boolean;
  estadoMp: string | null;
  motivo: string | null;
  vigenteHasta: string | null;
  creado: string;
  email: string;
  nombre: string | null;
  empresa: string | null;
  ruc: string | null;
  telefono: string | null;
}

export interface CobroAdmin {
  numero: string;
  medio: string;
  monto: number;
  meses: number;
  estado: string;
  operacion: string | null;
  validadoPor: string | null;
  motivo: string | null;
  pasarelaRef: string | null;
  creado: string;
  pagado: string | null;
  codigo: string;
  producto: ProductoG;
  plan: string;
  email: string;
  nombre: string | null;
  empresa: string | null;
}

export interface EnvioAdmin {
  id: number;
  producto: ProductoG;
  tipo: string;
  asunto: string;
  nItems: number;
  estado: string;
  error: string | null;
  creado: string;
  email: string | null;
}

export interface Fundador {
  precio: number;
  cupo?: number | null;
  meses?: number | null;
}

export interface ConfigGobserva {
  vendedor: { nombreComercial: string; ruc: string; razonSocial: string; direccion: string; correo: string };
  medios: { tarjeta: boolean; yape: boolean; plin: boolean; transferencia: boolean };
  planes: Partial<Record<ProductoG, Record<string, { precio?: number; fundador?: Fundador | null; activo?: boolean }>>>;
  aviso: string;
}

export interface PlanBase {
  nombre: string;
  precio: number;
  fundador: Fundador | null;
  activo: boolean;
}

export interface RespuestaConfig {
  config: ConfigGobserva;
  base: Record<ProductoG, Record<string, PlanBase>>;
  guardado: { updatedAt: string; updatedBy: string | null } | null;
  disponibles: { tarjeta: boolean; yape: boolean; plin: boolean; transferencia: boolean };
  correoActivo: boolean;
}

export interface ResumenTareas {
  alertas?: number;
  conNovedades?: number;
  correos?: number;
  enLaWeb?: number;
  fallidas?: number;
  recordatorios?: number;
  vencidos?: number;
}
