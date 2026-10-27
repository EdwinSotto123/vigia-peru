import { API_BASE } from "./api-client";
import type { OrdenEmpresa } from "./empresas";

/**
 * Lista GENERAL de órdenes de compra y de servicio (subsección de Contratos). Fuente: GET /ordenes (no atada a un RUC).
 * Params prefijados con «o» para no chocar con los de la lista de contratos en la misma URL (es un toggle `?vista=ordenes`).
 * La API acota por año (defecto: el último) y pagina por fecha con `hayMas` (sin total exacto, para no contar millones).
 */
export type OrdenGeneral = OrdenEmpresa & {
  contratista: string | null;
  rucContratista: string | null;
  /** Campos que CONOSCE trae en el reporte de órdenes y que el panel muestra cuando vienen (suelen faltar en órdenes viejas). */
  objeto: string | null;            // BIENES | SERVICIOS | CONSULTORÍAS | OBRAS…
  fechaNotificacion: string | null; // cuándo se le notificó al proveedor
  fechaCompromiso: string | null;   // compromiso presupuestal (cuando la entidad separó la plata)
  /** El proveedor (locador RUC-10) es pariente declarado de un funcionario de ESTA entidad (señal nepotismo). Indicio. */
  conNepotismo?: boolean;
  /** La orden es una de varias que la entidad le emitió ese día y que juntas pasan 8 UIT (ordenes_fraccionadas). Falta en la API vieja. */
  fraccionamiento?: OrdenFraccionada | null;
  /** El Tribunal de Contrataciones tenía inhabilitado al proveedor el día en que se emitió. Falta en la API vieja. */
  inhabilitacion?: InhabilitacionProveedor | null;
};

/** El grupo de órdenes del mismo día al que pertenece una orden partida: la evidencia de su bandera. */
export interface OrdenFraccionada {
  ordenes: number;
  total: number;
  /** El tope de 8 UIT de ese año (9 con el D.U. 016-2022). */
  tope: number;
  mismaDescripcion: boolean;
  severidad: "alta" | "media" | "baja";
  detalle: { orden: string; monto: number; descripcion: string | null; estado: string | null }[];
}

/** La inhabilitación del Tribunal de Contrataciones vigente en la fecha (temporal o definitiva) y su resolución. */
export interface InhabilitacionProveedor {
  tipo: "temporal" | "definitivo" | string;
  resolucion: string | null;
  desde: string | null;
  hasta: string | null;
}

export interface OrdenesPagina {
  page: number;
  size: number;
  hayMas: boolean;
  anio: number | null;
  anios: number[];
  /**
   * Cuántas órdenes recientes se revisaron cuando la lista se acotó (con búsqueda de texto, o si los filtros pedían
   * recorrer demasiadas): puede haber más antes de ésas. null (o ausente, API vieja) = la lista está completa.
   */
  revisadas?: number | null;
  data: OrdenGeneral[];
}

export type FiltrosOrdenes = {
  q?: string; anio?: number; entidad?: string; proveedor?: string; region?: string;
  tipo?: string; estado?: string; dudosa?: string; persona?: string; como?: string; monto?: string; antecedente?: string;
  orden?: string; page?: number; size?: number;
};

/** Los estados de una orden en CONOSCE (las anuladas no se listan). En la URL y en la API, en minúsculas. */
export const ESTADOS_ORDEN = [
  { valor: "emitida", etiqueta: "Emitida" },
  { valor: "comprometida", etiqueta: "Comprometida (presupuesto separado)" },
  { valor: "devengada", etiqueta: "Devengada (deuda reconocida)" },
] as const;

/** Cómo se contrató, en las palabras de `tipoContratacion` (lib/personas.ts); la API lo reconoce por el texto de CONOSCE. */
export const COMO_ORDEN = [
  { valor: "hasta_uit", etiqueta: "Hasta 8 UIT, sin concurso" },
  { valor: "sin_proceso", etiqueta: "Sin proceso de selección" },
  { valor: "proceso", etiqueta: "De un proceso de selección" },
  { valor: "directa", etiqueta: "Contratación directa" },
  { valor: "catalogo", etiqueta: "Catálogo electrónico" },
  { valor: "servicio_publico", etiqueta: "Servicio público (agua, luz, teléfono)" },
] as const;

/** El monto de la orden en tramos (sin las de monto con posible error, que van aparte). */
export const MONTOS_ORDEN = [
  { valor: "hasta_1k", etiqueta: "Hasta S/ 1 mil" },
  { valor: "1k_10k", etiqueta: "De S/ 1 mil a 10 mil" },
  { valor: "10k_50k", etiqueta: "De S/ 10 mil a 50 mil" },
  { valor: "50k_500k", etiqueta: "De S/ 50 mil a 500 mil" },
  { valor: "mas_500k", etiqueta: "Más de S/ 500 mil" },
] as const;

/** Los antecedentes de la orden que se pueden filtrar (la inhabilitación del proveedor se ve en la fila, no filtra). */
export const ANTECEDENTES_ORDEN = [
  { valor: "nepotismo", etiqueta: "Pariente de un funcionario de la entidad" },
  { valor: "fraccionamiento", etiqueta: "Órdenes del mismo día que pasan 8 UIT" },
] as const;

const valida = (lista: readonly { valor: string }[], v: string | undefined) => (v && lista.some((x) => x.valor === v) ? v : undefined);

async function leer<T>(ruta: string, revalidate = 300): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const consulta = (f: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return p.toString();
};

export const getOrdenes = (f: FiltrosOrdenes) => leer<OrdenesPagina>(`/ordenes?${consulta(f)}`);

/** Claves en la URL (prefijo «o»), para no pisar los filtros de la vista Contratos. */
export const P_ORD = {
  q: "oq", anio: "oanio", entidad: "oent", proveedor: "oprov", region: "oreg",
  tipo: "otipo", estado: "oest", dudosa: "odud", persona: "oper", como: "ocomo", monto: "omonto", antecedente: "oant",
  orden: "oord", page: "opag",
} as const;

export function parseOrdenesQuery(sp?: Record<string, string | string[] | undefined>): FiltrosOrdenes {
  const g = (k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };
  const num = (k: string) => { const v = g(k); const x = v ? parseInt(v, 10) : NaN; return Number.isFinite(x) ? x : undefined; };
  // Lo que la API no acepta (un RUC mal escrito, un estado que no existe) se ignora: con él respondía 400 y la lista
  // entera decía «No pudimos cargar las órdenes».
  const ruc = (k: string) => (/^\d{11}$/.test(g(k) ?? "") ? g(k) : undefined);
  return {
    q: g(P_ORD.q) || undefined,
    anio: num(P_ORD.anio),
    entidad: ruc(P_ORD.entidad),
    proveedor: ruc(P_ORD.proveedor),
    region: g(P_ORD.region) || undefined,
    tipo: g(P_ORD.tipo) === "compra" || g(P_ORD.tipo) === "servicio" ? g(P_ORD.tipo) : undefined,
    estado: valida(ESTADOS_ORDEN, g(P_ORD.estado)?.toLowerCase()),
    dudosa: g(P_ORD.dudosa) === "si" ? "si" : undefined,
    persona: g(P_ORD.persona) === "natural" || g(P_ORD.persona) === "empresa" ? g(P_ORD.persona) : undefined,
    como: valida(COMO_ORDEN, g(P_ORD.como)),
    monto: valida(MONTOS_ORDEN, g(P_ORD.monto)),
    antecedente: valida(ANTECEDENTES_ORDEN, g(P_ORD.antecedente)),
    orden: g(P_ORD.orden) || undefined,
    page: num(P_ORD.page),
  };
}

/** Los filtros (prefijados) para el estado del Listado: sin la página, con la vista fija. */
export function ordenesParametros(q: FiltrosOrdenes): Record<string, string> {
  const out: Record<string, string> = { vista: "ordenes" };
  const set = (k: string, v: unknown) => { if (v != null && v !== "") out[k] = String(v); };
  set(P_ORD.q, q.q); set(P_ORD.anio, q.anio); set(P_ORD.entidad, q.entidad); set(P_ORD.proveedor, q.proveedor);
  set(P_ORD.region, q.region);
  set(P_ORD.tipo, q.tipo); set(P_ORD.estado, q.estado); set(P_ORD.dudosa, q.dudosa);
  set(P_ORD.persona, q.persona); set(P_ORD.como, q.como); set(P_ORD.monto, q.monto); set(P_ORD.antecedente, q.antecedente);
  set(P_ORD.orden, q.orden);
  return out;
}
