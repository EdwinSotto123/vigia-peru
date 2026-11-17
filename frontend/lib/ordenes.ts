import { API_BASE } from "./api-client";
import type { OrdenEmpresa } from "./empresas";
import { soles } from "./formato";
import { SENAL } from "./personas";

/**
 * Lista GENERAL de órdenes de compra y de servicio (subsección de Contratos). Fuente: GET /ordenes (no atada a un RUC).
 * Params prefijados con «o» para no chocar con los de la lista de contratos en la misma URL (es un toggle `?vista=ordenes`).
 * La API pagina por fecha con `hayMas` (sin contar millones de filas en vivo); las cifras de la cabecera, el número de la
 * pestaña y el total del paginador salen de tablas precalculadas (GET /ordenes/resumen, de todo o de un año o una entidad).
 */
export type OrdenGeneral = OrdenEmpresa & {
  /**
   * Una orden en otra moneda (CONOSCE publica unas pocas en dólares, euros…): `monto` es null (es sólo en soles) y el
   * monto va aquí, con el nombre de la moneda como lo escribe CONOSCE («Dólar Canadiense»). Nunca se convierte ni se suma
   * a los soles. Faltan en la API vieja (que no listaba estas órdenes).
   */
  montoOtraMoneda?: number | null;
  otraMoneda?: string | null;
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
  /** La orden es una de varias iguales (proveedor, monto y descripción) de 7 a 90 días entre sí (migraciones 348-349). */
  repetida?: OrdenRepetida | null;
  /** Un socio, representante o directivo de la empresa es pariente declarado de un funcionario de esta entidad (migración 350). */
  parienteSocio?: ParienteSocio | null;
  /** El Tribunal de Contrataciones tenía inhabilitado al proveedor el día en que se emitió. Falta en la API vieja. */
  inhabilitacion?: InhabilitacionProveedor | null;
  /** Las demás señales de la persona con esta entidad (financió la campaña, candidato del que gobierna…): sólo el tipo. */
  senalesPersona?: { tipo: string; severidad: "alta" | "media" | "baja" }[] | null;
  /** La orden quedó entre el 95 % y el 100 % de su tope y la persona tiene la señal «al borde del tope» con la entidad. */
  alBorde?: { tope: number } | null;
  /** La ficha de la persona (RUC 10), donde está la evidencia de sus señales: un código al azar, no su RUC. */
  personaCodigo?: string | null;
  /**
   * Una orden que dice pagar un proceso de selección («Deviene de…»): los procesos que su proveedor ganó en la entidad en
   * los 3 años anteriores (la regla de compra_vinculo, migración 240), del más cercano a la orden al más lejano. null: la
   * orden no es pago de un proceso. Falta en la API vieja.
   */
  procesosPago?: ProcesosPago | null;
};

/** Un proceso que una orden puede estar pagando: el que su proveedor ganó en la entidad (CONOSCE, adjudicaciones). */
export interface ProcesoCandidato {
  codigo: string;
  nomenclatura: string | null;
  descripcion: string | null;
  /** Su ficha en Vigía; sin él, la búsqueda por código en Contrataciones Abiertas. */
  ocid: string | null;
  /** La primera buena pro de ese proveedor en el proceso (AAAA-MM-DD). */
  buenaPro: string | null;
  /** Lo adjudicado a ese proveedor, en soles (null si fue en otra moneda). */
  adjudicado: number | null;
  /** Lo adjudicado es el monto de la orden (±S/ 1): el más probable. */
  mismoMonto: boolean;
}

/** Los procesos que una orden de pago puede estar pagando: cuántos son y los más cercanos (hasta 8). */
export interface ProcesosPago {
  total: number;
  lista: ProcesoCandidato[];
}

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

/** El pariente declarado en la DJI que figura en la empresa (sin nombre ni documento: el parentesco, el cargo y su papel). */
export interface ParienteSocio {
  /** Como lo escribe la DJI («CUÑADO(A)», «HERMANO(A) DEL DECLARANTE»); «pariente» si el funcionario es autoridad electa. */
  parentesco: string | null;
  /** Del funcionario que lo declaró; null si es autoridad electa o no se encontró. */
  cargo: string | null;
  /** Su papel en la empresa (RNP): socio_accionista_titular, representante_legal, organo_administracion. */
  rol: string | null;
  /** Desde cuándo figura en la empresa. */
  desde: string | null;
  /** Cuántos parientes declarados figuran en la empresa. */
  parientes: number;
  /** Órdenes de la entidad a la empresa desde 2023. */
  ordenes: number;
  monto: number;
  severidad: "alta" | "media" | "baja";
}

/** Las órdenes iguales a una orden, emitidas en pocas semanas: la evidencia de su bandera «Compra repetida». */
export interface OrdenRepetida {
  ordenes: number;
  total: number;
  /** El tope de una orden directa el año de la primera (8 UIT). */
  tope: number;
  /** Entre la primera y la última. */
  dias: number;
  devengadas: number;
  /** alta: juntas pasan el tope y cada una quedó al borde; media: juntas pasan el tope, o todas se devengaron. */
  severidad: "alta" | "media" | "baja";
  detalle: { orden: string; fecha: string; estado: string | null }[];
}

/** La inhabilitación del Tribunal de Contrataciones vigente en la fecha (temporal o definitiva) y su resolución. */
export interface InhabilitacionProveedor {
  tipo: "temporal" | "definitivo" | string;
  resolucion: string | null;
  desde: string | null;
  hasta: string | null;
  /**
   * Por qué lo inhabilitó, como lo escribe el Tribunal («- j) Presentar documentos falsos…», una infracción por renglón).
   * Lo traen las órdenes desde el 2026-11-05; los contratos menores, todavía no.
   */
  infraccion?: string | null;
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

/**
 * Los antecedentes de la orden que se pueden filtrar, en dos grupos: los de la persona con la entidad que le dio la orden
 * (los mismos nombres que sus banderas) y los de la orden misma.
 */
const DE_LA_PERSONA = "De la persona con la entidad";
const DE_LA_ORDEN = "De la orden";
export const ANTECEDENTES_ORDEN = [
  { valor: "nepotismo", etiqueta: `${SENAL.nepotismo.corto} (pariente de un funcionario)`, grupo: DE_LA_PERSONA },
  { valor: "financio_campana", etiqueta: SENAL.financio_campana.corto, grupo: DE_LA_PERSONA },
  { valor: "candidato_gobierna", etiqueta: SENAL.candidato_gobierna.corto, grupo: DE_LA_PERSONA },
  { valor: "autoridad_contratada", etiqueta: SENAL.autoridad_contratada.corto, grupo: DE_LA_PERSONA },
  { valor: "fraccionamiento", etiqueta: "Órdenes del mismo día que pasan 8 UIT", grupo: DE_LA_ORDEN },
  // La misma orden (proveedor, monto y descripción) repetida de 7 a 90 días después (migraciones 348-349).
  { valor: "repetida", etiqueta: "Compra repetida en pocas semanas", grupo: DE_LA_ORDEN },
  // Un socio o representante de la empresa es pariente declarado de un funcionario de la entidad (migración 350).
  { valor: "pariente_socio", etiqueta: "Empresa de un pariente de un funcionario", grupo: DE_LA_ORDEN },
  // Persona o empresa con la mitad o más de las órdenes de la entidad así (migraciones 179 y 207).
  { valor: "al_borde_del_tope", etiqueta: "Al borde del tope (95 % a 100 %)", grupo: DE_LA_ORDEN },
  { valor: "inhabilitado", etiqueta: "Proveedor inhabilitado al emitirse", grupo: DE_LA_ORDEN },
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

/**
 * Las cifras de la cabecera de la vista Órdenes (GET /ordenes/resumen), de toda la base o de un año o una entidad: las
 * tablas precalculadas no tienen los demás filtros. Sólo las órdenes en soles (las de otra moneda se listan, no se suman).
 */
export interface ResumenOrdenes {
  anio: number | null;
  entidad: string | null;
  /** Cada orden una vez, sin anuladas; las de monto dudoso cuentan aquí, pero no en `monto`. */
  ordenes: number;
  monto: number;
  dudosas: number;
  /** A personas naturales (RUC 10): por lo general, locadores. */
  aPersonas: number;
  montoPersonas: number;
  entidades: number;
  /** El primer y el último mes con órdenes («2018-01», «2026-10»). */
  desde: string | null;
  hasta: string | null;
  /** Las compras partidas el mismo día: grupos de órdenes al mismo proveedor que juntas pasan 8 UIT. null: no se pudo contar. */
  partidas: { grupos: number; ordenes: number; graves: number } | null;
  /** Los proveedores al borde del tope con alguna entidad (de toda su historia, sin año). null: no se pudo contar. */
  alBorde: { personas: number; empresas: number } | null;
}

export const getResumenOrdenes = (f: { anio?: number; entidad?: string } = {}) =>
  leer<ResumenOrdenes>(`/ordenes/resumen?${consulta(f)}`, 3600);

/**
 * Las monedas en que CONOSCE publica algunas órdenes (además de los soles), por su nombre allá: el código con que va el
 * monto («CAD 7,445», como los contratos en otra moneda, lib/contratos.ts `formatMonto`) y el nombre que lo explica. El
 * mismo juego de monedas que MONEDA_TEXTO de la API (routes/historia.ts).
 */
export const MONEDAS_ORDEN: Record<string, { codigo: string; nombre: string }> = {
  "Dólar Norteamericano": { codigo: "USD", nombre: "dólares estadounidenses" },
  "Dólar Canadiense": { codigo: "CAD", nombre: "dólares canadienses" },
  Euro: { codigo: "EUR", nombre: "euros" },
  "Libra Esterlina": { codigo: "GBP", nombre: "libras esterlinas" },
  "Real Brasileño": { codigo: "BRL", nombre: "reales brasileños" },
  "Yen Japonés": { codigo: "JPY", nombre: "yenes japoneses" },
  "Franco Suizo": { codigo: "CHF", nombre: "francos suizos" },
  Yuan: { codigo: "CNY", nombre: "yuanes chinos" },
};

/** La moneda de una orden en otra moneda; una que no está en la lista, con su nombre tal cual (en minúsculas). */
export const monedaOrden = (m: string) => MONEDAS_ORDEN[m] ?? { codigo: m, nombre: m.toLocaleLowerCase("es") };

/**
 * El monto de una orden como se muestra: en soles («S/ 7,445») o en su moneda («CAD 7,445», con el mismo redondeo), nunca
 * convertido. `moneda`: la de una orden en otra moneda (para decir cuál es); null en soles. Sin monto: `texto` null.
 */
export function montoOrden(o: { monto: number | null; montoOtraMoneda?: number | null; otraMoneda?: string | null }): {
  texto: string | null;
  moneda: { codigo: string; nombre: string } | null;
} {
  if (o.monto != null) return { texto: soles(o.monto), moneda: null };
  if (o.montoOtraMoneda != null && o.otraMoneda) {
    const moneda = monedaOrden(o.otraMoneda);
    return { texto: soles(o.montoOtraMoneda).replace(/^S\/\s/, `${moneda.codigo} `), moneda };
  }
  return { texto: null, moneda: null };
}

/** Claves en la URL (prefijo «o»), para no pisar los filtros de la vista Contratos. */
export const P_ORD = {
  q: "oq", anio: "oanio", entidad: "oent", proveedor: "oprov", region: "oreg",
  tipo: "otipo", estado: "oest", dudosa: "odud", persona: "oper", como: "ocomo", monto: "omonto", antecedente: "oant",
  orden: "oord", page: "opag",
} as const;

/**
 * La vista Órdenes de /app/contratos con una entidad, un proveedor y un antecedente: la lista de las órdenes que sostienen
 * una bandera (la evidencia de su tarjeta en el panel). El proveedor, sólo si es una empresa (RUC 20): el RUC 10 lleva el
 * DNI y nunca va en un enlace.
 */
export function rutaOrdenes(f: { entidad?: string | null; proveedor?: string | null; antecedente?: (typeof ANTECEDENTES_ORDEN)[number]["valor"] }): string {
  const q = new URLSearchParams({ vista: "ordenes" });
  if (f.entidad && /^\d{11}$/.test(f.entidad)) q.set(P_ORD.entidad, f.entidad);
  if (f.proveedor && /^20\d{9}$/.test(f.proveedor)) q.set(P_ORD.proveedor, f.proveedor);
  if (f.antecedente) q.set(P_ORD.antecedente, f.antecedente);
  return `/app/contratos?${q}`;
}

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
