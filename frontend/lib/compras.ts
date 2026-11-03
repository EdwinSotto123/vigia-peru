import { API_BASE } from "./api-client";
import type { ContratoResumen } from "./contratos";
import type { ContratoEmpresa } from "./empresas";
import type { OrdenCatalogo } from "./catalogo";
import type { ContratoMenor } from "./menores";
import { ANTECEDENTES_ORDEN, type OrdenGeneral } from "./ordenes";

/**
 * Las compras de una entidad (o las ventas de una empresa) en UNA lista, una fila por compra (GET /compras, migración
 * 240). Antes eran cuatro vistas que se repetían: una compra por catálogo estaba en «Catálogo» y en «Órdenes», un contrato
 * menor en «Menores» y en «Órdenes», un proceso en «Contratos» y sus pagos en «Órdenes». Ahora cada compra va una vez y
 * su panel junta lo que dice cada registro.
 */

export type ClaseCompra = "proceso" | "catalogo" | "menor" | "directa" | "pago";

/** Cómo se compró: lo que dice la fila y su filtro. */
export const CLASES_COMPRA: { valor: ClaseCompra; etiqueta: string; explica: string }[] = [
  {
    valor: "proceso", etiqueta: "Proceso de selección",
    explica: "Hubo convocatoria y postores (licitación, concurso, adjudicación simplificada) o una contratación directa con su expediente.",
  },
  {
    valor: "catalogo", etiqueta: "Catálogo de Perú Compras",
    explica: "La entidad compró en la tienda en línea del Estado, a proveedores ya aprobados por un acuerdo marco, sin concurso.",
  },
  {
    valor: "menor", etiqueta: "Contrato menor",
    explica: "Hasta 8 UIT, con cotización pública en el módulo de contrataciones menores del SEACE (desde 2025).",
  },
  {
    valor: "directa", etiqueta: "Sin concurso",
    explica: "Una orden de compra o de servicio emitida directamente, sin proceso ni catálogo: por lo general, hasta 8 UIT.",
  },
  {
    valor: "pago", etiqueta: "Pago de un contrato",
    explica: "Una orden que dice pagar un proceso de selección que no está en los datos (de antes de 2018, o ganado por un consorcio).",
  },
];
export const claseCompra = (c: ClaseCompra) => CLASES_COMPRA.find((x) => x.valor === c)!;

/** Las banderas que se pueden filtrar, por la fuente que las tiene. */
export const BANDERAS_COMPRA = [
  { valor: "sobreprecio", etiqueta: "Pagó el doble de la mediana (catálogo)", grupo: "Del precio" },
  { valor: "antecedentes", etiqueta: "El ganador tiene antecedentes", grupo: "De quien ganó un proceso" },
  ...ANTECEDENTES_ORDEN.map((a) => ({ valor: a.valor, etiqueta: a.etiqueta, grupo: "De la orden y su proveedor" })),
  { valor: "sunat", etiqueta: "Proveedor con alertas en la SUNAT (contratos menores)", grupo: "De la orden y su proveedor" },
] as const;
export type BanderaCompra = (typeof BANDERAS_COMPRA)[number]["valor"];

/** Claves en la URL. `cq`, `canio`, `cord` y `cpag` son las mismas del catálogo y de los contratos de una empresa de antes. */
export const P_COMPRAS = { q: "cq", como: "como", anio: "canio", bandera: "csenal", persona: "cper", con: "ccon", orden: "cord", page: "cpag" } as const;

/** Los filtros de la lista de contratos de una entidad que traen los enlaces de sus banderas: dejan sólo los procesos. */
export const FILTROS_PROCESO = ["cruces", "cruce", "lectura", "riesgo", "tipo", "etapa", "operativo", "obra", "desde", "hasta"] as const;

export interface FiltrosCompras {
  q?: string;
  como?: ClaseCompra;
  anio?: number;
  bandera?: BanderaCompra;
  /** Con una bandera de la orden: sólo personas naturales o sólo empresas (la bandera «Empresas al borde del tope»). */
  persona?: "natural" | "empresa";
  con?: string;
  orden?: "reciente" | "antiguo";
  page?: number;
  /** Los filtros de contratos de un enlace de antes (sólo en la ficha de una entidad). */
  proceso?: Partial<Record<(typeof FILTROS_PROCESO)[number], string>>;
}

type Busqueda = Record<string, string | string[] | undefined>;

/**
 * Los filtros de la URL, con los de las cuatro vistas de antes traducidos: así siguen andando los enlaces de las banderas,
 * de las migas y de otras fichas (`vista=catalogo&csob=si`, `vista=ordenes&oant=al_borde_del_tope`, `cruce=…`, `oent=…`).
 * Lo que la API no acepta se ignora (con ello respondía 400 y la lista decía «No pudimos cargar»).
 */
export function parseCompras(sp: Busqueda | undefined, ancla: "entidad" | "proveedor"): FiltrosCompras {
  const g = (k: string) => { const v = sp?.[k]; const x = Array.isArray(v) ? v[0] : v; return x?.trim() || undefined; };
  const num = (k: string) => { const v = g(k); const x = v ? parseInt(v, 10) : NaN; return Number.isFinite(x) ? x : undefined; };
  const ruc = (v: string | undefined) => (v && /^\d{11}$/.test(v) ? v : undefined);
  const vista = g("vista");

  let como = CLASES_COMPRA.some((c) => c.valor === g(P_COMPRAS.como)) ? (g(P_COMPRAS.como) as ClaseCompra) : undefined;
  if (!como) como = vista === "catalogo" ? "catalogo" : vista === "menores" ? "menor" : vista === "contratos" ? "proceso" : undefined;
  const ocomo = g("ocomo");
  if (!como && ocomo) como = ocomo === "catalogo" ? "catalogo" : ocomo === "proceso" || ocomo === "directa" ? "proceso" : "directa";

  let bandera = BANDERAS_COMPRA.some((b) => b.valor === g(P_COMPRAS.bandera)) ? (g(P_COMPRAS.bandera) as BanderaCompra) : undefined;
  if (!bandera && g("csob") === "si") bandera = "sobreprecio";
  const oant = g("oant");
  if (!bandera && oant && ANTECEDENTES_ORDEN.some((a) => a.valor === oant)) bandera = oant as BanderaCompra;
  const mant = g("mant");
  if (!bandera && mant) bandera = mant === "inhabilitado" ? "inhabilitado" : "sunat";
  if (!bandera && (g("ccruce") === "con" || g("cband") === "antecedentes")) bandera = "antecedentes";

  const q = g(P_COMPRAS.q) ?? g("oq") ?? g("mq") ?? (ancla === "entidad" ? g("q") : undefined);
  const anio = num(P_COMPRAS.anio) ?? num("oanio") ?? num("manio");
  const con = ruc(g(P_COMPRAS.con)) ?? (ancla === "entidad" ? ruc(g("oprov")) ?? ruc(g("mprov")) : ruc(g("oent")) ?? ruc(g("ment")) ?? ruc(g("cent")));
  const page = num(P_COMPRAS.page);
  const proceso: FiltrosCompras["proceso"] = {};
  if (ancla === "entidad") for (const k of FILTROS_PROCESO) { const v = g(k); if (v) proceso[k] = v.slice(0, 200); }

  return {
    q: q && q.length >= 3 ? q.slice(0, 80) : undefined,
    como,
    anio: anio && anio >= 2015 && anio <= 2100 ? anio : undefined,
    bandera,
    persona: bandera && ANTECEDENTES_ORDEN.some((x) => x.valor === bandera) && (g(P_COMPRAS.persona) ?? g("oper")) === "empresa" ? "empresa"
      : bandera && (g(P_COMPRAS.persona) ?? g("oper")) === "natural" ? "natural" : undefined,
    con,
    orden: g(P_COMPRAS.orden) === "antiguo" ? "antiguo" : undefined,
    page: page && page >= 1 && page <= 200 ? page : undefined,
    proceso: Object.keys(proceso).length ? proceso : undefined,
  };
}

/** Los filtros como parámetros de la URL de la lista (los de antes ya traducidos: el enlace que sigue queda limpio). */
export function parametrosCompras(f: FiltrosCompras): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.q) out[P_COMPRAS.q] = f.q;
  if (f.como) out[P_COMPRAS.como] = f.como;
  if (f.anio) out[P_COMPRAS.anio] = String(f.anio);
  if (f.bandera) out[P_COMPRAS.bandera] = f.bandera;
  if (f.persona) out[P_COMPRAS.persona] = f.persona;
  if (f.con) out[P_COMPRAS.con] = f.con;
  if (f.orden) out[P_COMPRAS.orden] = f.orden;
  for (const [k, v] of Object.entries(f.proceso ?? {})) if (v) out[k] = v;
  return out;
}

/** Una orden en la lista de pagos de un proceso (sin sus antecedentes). */
export interface PagoProceso {
  fecha: string | null;
  entidadRuc: string | null;
  numero: string | null;
  orden: string;
  tipoOrden: string | null;
  monto: number | null;
  estado: string | null;
  fechaCompromiso: string | null;
  /** De cuántos procesos puede ser (en `posibles`). */
  candidatos?: number;
}

export interface PagosProceso {
  /** Las órdenes que sólo pueden ser de este proceso: cuántas y las más recientes. */
  total: number;
  /** Lo que suman esas órdenes (sin las de monto dudoso) y lo adjudicado a sus ganadores (CONOSCE). */
  pagado: number | null;
  adjudicado: number | null;
  lista: PagoProceso[];
  /** Las que pueden ser de este o de otro proceso que la misma empresa ganó en la entidad. */
  posibles: { n: number; muestra: PagoProceso[] } | null;
}

/** El proceso que paga una orden (con una bandera de la orden, que la lista muestra sola). */
export interface PagoDe {
  candidatos: number;
  codigo?: string;
  ocid?: string | null;
  titulo?: string | null;
}

export interface Compra {
  clase: ClaseCompra;
  id: string;
  fecha: string | null;
  monto: number | null;
  /** Lo adjudicado de un proceso (sin adjudicación, null: `monto` es entonces el valor referencial). */
  adjudicado?: number | null;
  /** El proceso: en la ficha de una entidad, la fila de su lista de contratos; en la de una empresa, el proceso que ganó. */
  proceso?: ContratoResumen | ContratoEmpresa | null;
  pagos?: PagosProceso | null;
  catalogo?: OrdenCatalogo | null;
  menor?: ContratoMenor | null;
  /** La orden del SEACE: la compra misma (sin concurso, pago) o la de su catálogo o su contrato menor. */
  orden?: OrdenGeneral | null;
  pagoDe?: PagoDe | null;
}

export interface ComprasPagina {
  page: number;
  size: number;
  hayMas: boolean;
  disponible: boolean;
  ancla: "entidad" | "proveedor";
  /** Cuántas compras y por cuánto, con el año y la forma de compra elegidos (sin texto, bandera ni contraparte). */
  resumen: { compras: number; monto: number } | null;
  facetas: { como: Partial<Record<ClaseCompra, number>>; anio: Record<string, number> } | null;
  data: Compra[];
}

const consulta = (f: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return p.toString();
};

/** La página de compras de una entidad o de una empresa. */
export async function getCompras(ancla: { entidad: string } | { proveedor: string }, f: FiltrosCompras, size = 20): Promise<ComprasPagina | null> {
  const { proceso, ...resto } = f;
  try {
    const r = await fetch(`${API_BASE}/compras?${consulta({ ...ancla, ...resto, ...(proceso ?? {}), size })}`, { next: { revalidate: 300 } } as RequestInit);
    return r.ok ? ((await r.json()) as ComprasPagina) : null;
  } catch {
    return null;
  }
}
