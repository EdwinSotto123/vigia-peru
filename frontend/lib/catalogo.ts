import { API_BASE } from "./api-client";

/**
 * Las compras por los Catálogos Electrónicos de Perú Compras (GET /catalogo, migraciones 236-237): qué compró cada
 * orden, producto por producto, a cuánto la unidad y cómo se compara con lo que pagaron las demás entidades por la misma
 * ficha-producto ese año. Los parámetros van con el prefijo «c» para convivir en la misma URL con los de Contratos,
 * Órdenes y Menores (?vista=catalogo).
 */

/** El precio de referencia de una ficha-producto un año: lo que pagaron las demás entidades por unidad, sin IGV. */
export interface RefPrecio {
  mediana: number;
  p25: number;
  p75: number;
  /** Cuántas entidades distintas y cuántas líneas la compraron ese año (la referencia cuenta con 5 o más entidades). */
  entidades: number;
  lineas: number;
}

/** Una línea de lo pedido: un producto, su cantidad y su precio por unidad (sin IGV). */
export interface ItemCatalogo {
  linea: number;
  descripcion: string | null;
  marca: string | null;
  nroParte: string | null;
  categoria: string | null;
  /** La ficha-producto (la página /producto/<ficha> compara quién más la compró). */
  ficha: string | null;
  cantidad: number | null;
  precio: number | null;
  subtotal: number | null;
  ref: RefPrecio | null;
  /** Pagó el doble de la mediana o más, con S/ 1 000 o más de diferencia por la cantidad comprada. */
  sobreprecio: { veces: number; exceso: number } | null;
}

export type EstadoGrupo = "pagada" | "en_curso" | "retraso" | "resuelta" | "anulada";

export interface OrdenCatalogo {
  orden: string;
  acuerdoCodigo: string | null;
  acuerdo: string | null;
  tipo: string | null;
  entidadRuc: string | null;
  entidad: string | null;
  proveedorRuc: string | null;
  proveedor: string | null;
  procedimiento: string | null;
  tipoCompra: string | null;
  estado: string | null;
  estadoGrupo: EstadoGrupo | null;
  /** El número de la orden en el sistema de la entidad («OC 199-2026»): el que se busca en CONOSCE. */
  ordenFisica: string | null;
  fecha: string | null;
  aceptada: string | null;
  subtotal: number | null;
  igv: number | null;
  total: number | null;
  versiones: number | null;
  pdfOrden: string | null;
  pdfSustento: string | null;
  /** Cuántas líneas pidió; `items` trae hasta 15. */
  lineas: number;
  items: ItemCatalogo[];
  /** Sus líneas al doble de la mediana o más: cuántas, cuánto por encima en total y la mayor proporción. */
  sobreprecio: { lineas: number; exceso: number; veces: number } | null;
  entregas: { entregas: number; hasta: string | null; plazo: number | null } | null;
}

export interface CatalogoPagina {
  page: number;
  size: number;
  hayMas: boolean;
  /** false: la base todavía no tiene las tablas (la vista dice que se está cargando). */
  disponible: boolean;
  ancla?: "entidad" | "proveedor" | null;
  facetas: { anio: Record<string, number>; estado: Record<string, number>; sobreprecio: { si: number } } | null;
  /** Lo que cumple los filtros: cuántas órdenes, por cuánto y cuánto pagaron sus líneas marcadas por encima de la mediana. */
  resumen?: { ordenes: number; monto: number; exceso: number } | null;
  data: OrdenCatalogo[];
}

export type FiltrosCatalogo = {
  q?: string; entidad?: string; proveedor?: string; anio?: number; estado?: string; sobreprecio?: string;
  orden?: string; page?: number; size?: number;
};

export const ESTADOS_CATALOGO: { valor: EstadoGrupo; etiqueta: string }[] = [
  { valor: "pagada", etiqueta: "Pagadas" },
  { valor: "en_curso", etiqueta: "En curso" },
  { valor: "retraso", etiqueta: "Con retraso o penalidad" },
  { valor: "resuelta", etiqueta: "Resueltas o en controversia" },
  { valor: "anulada", etiqueta: "Anuladas o rechazadas" },
];

export const ORDENES_CATALOGO = [
  { valor: "reciente", etiqueta: "Más recientes" },
  { valor: "monto", etiqueta: "Mayor monto" },
  { valor: "sobreprecio", etiqueta: "Más sobre la mediana" },
] as const;

/** Claves en la URL (prefijo «c»), para no pisar los filtros de las demás vistas. */
export const P_CAT = { q: "cq", anio: "canio", estado: "cest", sobreprecio: "csob", orden: "cord", page: "cpag" } as const;

export function parseCatalogoQuery(sp?: Record<string, string | string[] | undefined>): FiltrosCatalogo {
  const g = (k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };
  const num = (k: string) => { const v = g(k); const x = v ? parseInt(v, 10) : NaN; return Number.isFinite(x) ? x : undefined; };
  const anio = num(P_CAT.anio);
  const q = g(P_CAT.q)?.trim();
  return {
    // Lo que la API no acepta se ignora (con ello respondía 400 y la lista decía «No pudimos cargar»).
    q: q && q.length >= 3 ? q.slice(0, 80) : undefined,
    anio: anio && anio >= 2015 && anio <= 2100 ? anio : undefined,
    estado: ESTADOS_CATALOGO.some((e) => e.valor === g(P_CAT.estado)) ? g(P_CAT.estado) : undefined,
    sobreprecio: g(P_CAT.sobreprecio) === "si" ? "si" : undefined,
    orden: ORDENES_CATALOGO.some((o) => o.valor === g(P_CAT.orden)) ? g(P_CAT.orden) : undefined,
    page: num(P_CAT.page),
  };
}

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

export const getCatalogo = (f: FiltrosCatalogo) => leer<CatalogoPagina>(`/catalogo?${consulta(f)}`);

// ─── Un producto: quién más lo compró ────────────────────────────────────────────

export interface CompraFicha {
  orden: string;
  linea: number;
  descripcion: string | null;
  marca: string | null;
  nroParte: string | null;
  cantidad: number;
  precio: number;
  subtotal: number;
  fecha: string | null;
  entidadRuc: string | null;
  entidad: string | null;
  proveedorRuc: string | null;
  proveedor: string | null;
  estado: string | null;
  acuerdoCodigo: string | null;
  veces: number | null;
  exceso: number | null;
}

export interface FichaCatalogo {
  ficha: string;
  anio: number;
  producto: { descripcion: string | null; marca: string | null; nroParte: string | null; categoria: string | null } | null;
  referencias: (RefPrecio & { anio: number })[];
  compras: CompraFicha[];
}

export const getFichaCatalogo = (ficha: string, anio?: number) =>
  /^[0-9A-Za-z]{1,40}$/.test(ficha) ? leer<FichaCatalogo>(`/catalogo/ficha/${ficha}${anio ? `?anio=${anio}` : ""}`, 3600) : Promise.resolve(null);

/** La página de un producto: quién más compró esa ficha y a cuánto (el año, si se pide uno). */
export const rutaProducto = (ficha: string, anio?: number | null) => `/producto/${ficha}${anio ? `?anio=${anio}` : ""}`;

/** Cuánto pagó frente a la mediana, en palabras: «2,3 veces la mediana». */
export const vecesTexto = (v: number) => `${v.toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces la mediana`;
