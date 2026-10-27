import { API_BASE } from "./api-client";
import type { InhabilitacionProveedor } from "./ordenes";

/**
 * Contratos menores (≤8 UIT) del SEACE. Fuente: GET /menores (prod4 contrato + prod6 requerimiento, unidos por código CM).
 * Params prefijados con «m» para convivir en la misma URL con los toggles de Contratos/Órdenes (?vista=menores).
 */
export interface ContratoMenor {
  id: number;
  codigo: string | null;
  numero: string | null;
  objeto: string | null;              // BIEN | SERVICIO
  descripcion: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  proveedor: string | null;
  proveedorRuc: string | null;
  monto: number | null;
  moneda: string | null;
  estado: string | null;              // estado del contrato (prod4)
  fecha: string | null;               // fecha de suscripción
  anio: number | null;
  tieneContrato: boolean;             // hay PDF del contrato (prod4)
  tieneRequerimiento: boolean;        // hay PDF del requerimiento/TDR (prod6)
  requerimientoNombre: string | null;
  estadoProceso: string | null;       // Vigente | En Evaluación | Culminado (prod6)
  fecPublica: string | null;
  cotizaDesde: string | null;
  cotizaHasta: string | null;
  // Identidad SUNAT del proveedor (seace_proveedor_sunat): giro, estado y antigüedad al ganar.
  provActividad: string | null;       // actividad económica (CIIU)
  provEstado: string | null;          // ACTIVO | BAJA… | SUSPENSION… (en SUNAT)
  provCondicion: string | null;       // HABIDO | NO HABIDO | NO HALLADO
  provDesde: string | null;           // fecha de inicio de actividades
  provTipo: string | null;            // tipo de contribuyente SUNAT
  provDiasAlGanar: number | null;     // días entre inicio de actividades y la firma del contrato
  /** El tope de 8 UIT del año de la firma y si el monto (en soles) lo pasa. Faltan en la API vieja. */
  tope?: number | null;
  sobreTope?: boolean | null;
  /** El Tribunal de Contrataciones tenía inhabilitado al proveedor el día de la firma. Falta en la API vieja. */
  inhabilitacion?: InhabilitacionProveedor | null;
}

/** Los conteos de cada opción de los filtros, con los demás filtros puestos (la región, por su nombre normalizado). */
export type FacetasMenores = Partial<Record<"antecedente" | "persona" | "objeto" | "monto" | "conReq" | "anio" | "region", Record<string, number>>>;

export interface MenoresPagina {
  page: number;
  size: number;
  hayMas: boolean;
  anclado: boolean;
  /** Qué fija la lista: la ficha de una empresa (proveedor) o de una entidad. Falta en la API vieja. */
  ancla?: "proveedor" | "entidad" | null;
  anio: number | null;
  anios: number[];
  /** null si no se pudieron contar (la barra filtra igual, sin números). Falta en la API vieja. */
  facetas?: FacetasMenores | null;
  data: ContratoMenor[];
}

export type FiltrosMenores = {
  q?: string; anio?: number; entidad?: string; proveedor?: string; region?: string;
  objeto?: string; estado?: string; conReq?: string; antecedente?: string; persona?: string; monto?: string;
  orden?: string; page?: number; size?: number;
};

/** Bien, servicio, consultoría u obra (el objeto del contrato menor). */
export const OBJETOS_MENOR = [
  { valor: "bien", etiqueta: "Bienes" },
  { valor: "servicio", etiqueta: "Servicios" },
  { valor: "consultoria", etiqueta: "Consultorías" },
  { valor: "obra", etiqueta: "Obras" },
] as const;

/**
 * Los antecedentes del proveedor que filtran la lista (la API los calcula con las mismas reglas que las banderas de la
 * fila): lo que dice HOY la SUNAT, si empezó actividades hace menos de 6 meses al firmar y si estaba inhabilitado.
 */
export const ANTECEDENTES_MENOR = [
  { valor: "con", etiqueta: "Con alguno", grupo: undefined },
  { valor: "baja", etiqueta: "De baja", grupo: "En la SUNAT, hoy" },
  { valor: "suspendida", etiqueta: "En suspensión temporal", grupo: "En la SUNAT, hoy" },
  { valor: "no_habido", etiqueta: "No habido (la SUNAT no lo ubica)", grupo: "En la SUNAT, hoy" },
  { valor: "no_hallado", etiqueta: "No hallado en su domicilio fiscal", grupo: "En la SUNAT, hoy" },
  { valor: "reciente", etiqueta: "Menos de 6 meses de actividad al firmar", grupo: "En la SUNAT, hoy" },
  { valor: "inhabilitado", etiqueta: "Inhabilitado por el Tribunal al firmar", grupo: "Tribunal de Contrataciones" },
] as const;

/** El monto en tramos; el tope es el de 8 UIT del año de la firma. */
export const MONTOS_MENOR = [
  { valor: "hasta_5k", etiqueta: "Hasta S/ 5 mil" },
  { valor: "5k_20k", etiqueta: "De S/ 5 mil a 20 mil" },
  { valor: "mas_20k", etiqueta: "Más de S/ 20 mil" },
  { valor: "cerca_tope", etiqueta: "Cerca del tope de 8 UIT (90 % o más)" },
  { valor: "sobre_tope", etiqueta: "Por encima del tope de 8 UIT" },
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

export const getMenores = (f: FiltrosMenores) => leer<MenoresPagina>(`/menores?${consulta(f)}`);

/** URL del PDF (proxy por nuestra API, que añade las cabeceras que el WAF del SEACE exige). */
export const urlRequerimiento = (id: number) => `${API_BASE}/menores/${id}/requerimiento`;
export const urlContratoMenor = (id: number) => `${API_BASE}/menores/${id}/contrato`;

/** Claves en la URL (prefijo «m»), para no pisar los filtros de Contratos/Órdenes. */
export const P_MEN = {
  q: "mq", anio: "manio", entidad: "ment", proveedor: "mprov", region: "mreg",
  objeto: "mobj", estado: "mest", conReq: "mreq", antecedente: "mant", persona: "mper", monto: "mmonto",
  orden: "mord", page: "mpag",
} as const;

export function parseMenoresQuery(sp?: Record<string, string | string[] | undefined>): FiltrosMenores {
  const g = (k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };
  const num = (k: string) => { const v = g(k); const x = v ? parseInt(v, 10) : NaN; return Number.isFinite(x) ? x : undefined; };
  // Lo que la API no acepta se ignora (con ello respondía 400 y la lista decía «No pudimos cargar»).
  const ruc = (k: string) => (/^\d{11}$/.test(g(k) ?? "") ? g(k) : undefined);
  return {
    q: g(P_MEN.q) || undefined,
    anio: num(P_MEN.anio),
    entidad: ruc(P_MEN.entidad),
    proveedor: ruc(P_MEN.proveedor),
    region: g(P_MEN.region) || undefined,
    objeto: valida(OBJETOS_MENOR, g(P_MEN.objeto)),
    estado: g(P_MEN.estado) || undefined,
    conReq: g(P_MEN.conReq) === "si" ? "si" : undefined,
    antecedente: valida(ANTECEDENTES_MENOR, g(P_MEN.antecedente)),
    persona: g(P_MEN.persona) === "natural" || g(P_MEN.persona) === "empresa" ? g(P_MEN.persona) : undefined,
    monto: valida(MONTOS_MENOR, g(P_MEN.monto)),
    orden: g(P_MEN.orden) || undefined,
    page: num(P_MEN.page),
  };
}

/** Filtros (prefijados) para el estado del Listado: sin la página, con la vista fija. */
export function menoresParametros(q: FiltrosMenores): Record<string, string> {
  const out: Record<string, string> = { vista: "menores" };
  const set = (k: string, v: unknown) => { if (v != null && v !== "") out[k] = String(v); };
  set(P_MEN.q, q.q); set(P_MEN.anio, q.anio); set(P_MEN.entidad, q.entidad); set(P_MEN.proveedor, q.proveedor);
  set(P_MEN.region, q.region);
  set(P_MEN.objeto, q.objeto); set(P_MEN.estado, q.estado); set(P_MEN.conReq, q.conReq);
  set(P_MEN.antecedente, q.antecedente); set(P_MEN.persona, q.persona); set(P_MEN.monto, q.monto);
  set(P_MEN.orden, q.orden);
  return out;
}

/** El nombre de una región como lo cuenta la API (mayúsculas, sin tildes): «Áncash» → «ANCASH». */
export const claveRegion = (r: string) => r.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().trim();
