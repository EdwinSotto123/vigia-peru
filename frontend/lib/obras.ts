import { API_BASE } from "./api-client";
import { fecha, fechaCorta, numero, plural, porcentaje, soles } from "./formato";

/**
 * Obras públicas (INFOBRAS, Contraloría) e inversiones (Invierte.pe, MEF), migración 160. Fuente: GET /obras,
 * GET /obras/inversiones, GET /obras/resumen y los campos `obras` e `inversiones` de GET /contratos/:ocid. Las banderas
 * vienen calculadas de la API con su evidencia (los números de la fuente); aquí se dicen en palabras.
 *
 * Los parámetros de la URL van con prefijo («ob» las obras, «iv» las inversiones) para convivir con los de las otras
 * pestañas de la ficha. El ejecutor o el supervisor que es una persona natural llega con su ref y un apellido tapado.
 */

export type Severidad = "alta" | "media" | "baja";

export interface BanderaObra {
  tipo: string;
  severidad: Severidad;
  [dato: string]: unknown;
}

export interface QuienObra {
  ruc: string | null;
  nombre: string | null;
  tipo: "empresa" | "persona" | "consorcio";
}

export interface Obra {
  codigo: number;
  nombre: string;
  estado: string | null;
  modalidad: string | null;
  naturaleza: string | null;
  tipo: string | null;
  cui: string | null;
  esSaldo: boolean;
  /** `ficha`: la entidad tiene su ficha en Vigía. */
  entidad: { ruc: string | null; nombre: string | null; ficha?: boolean };
  lugar: { departamento: string | null; provincia: string | null; distrito: string | null; ubigeo: string | null };
  ejecutor: QuienObra | null;
  supervisor: QuienObra | null;
  montos: { contrato: number | null; supervision: number | null; expediente: number | null; viable: number | null; liquidacion: number | null; devengado: number | null };
  fechas: {
    inicio: string | null; finProgramada: string | null; finReprogramada: string | null; finReal: string | null; avance: string | null;
    recepcion: string | null; liquidacion: string | null; expediente: string | null;
  };
  plazo: { dias: number | null; ampliacion: number; modificaciones: number; nuevo: number | null };
  avance: { fisicoProgramado: number | null; fisicoReal: number | null; financiero: number | null; pagado: number | null; valorizadoProgramado: number | null; valorizadoReal: number | null };
  paralizacion: { si: boolean; causal: string | null; desde: string | null; dias: number | null };
  adicionales: { n: number; monto: number; deductivosN: number; deductivos: number; supervisionN: number; supervision: number };
  controversias: number;
  informesControl: number;
  veedurias: number;
  comentariosCiudadanos: number;
  motivoNo100: string | null;
  recepcion: boolean | null;
  liquidacion: boolean | null;
  banderas: BanderaObra[];
  severidad: Severidad | null;
  dudoso: string[];
  contratos: { ocid: string; codigo: string | null; rol: "ejecucion" | "supervision"; via: string; fecha: string | null }[];
  alDia: string | null;
  url: string;
}

export interface Inversion {
  cui: string;
  nombre: string | null;
  estado: "activa" | "cerrada";
  situacion: string | null;
  nivel: string | null;
  funcion: string | null;
  programa: string | null;
  tipologia: string | null;
  tipo: string | null;
  modalidad: string | null;
  marco: string | null;
  /** `ficha`: la entidad tiene su ficha en Vigía. */
  entidad: { ruc: string | null; nombre: string | null; ficha?: boolean };
  unidadEjecutora: string | null;
  lugar: { departamento: string | null; provincia: string | null; distrito: string | null; ubigeo: string | null };
  montos: {
    viable: number | null; actualizado: number | null; expediente: number | null; devengado: number | null; pimAnio: number | null; devengadoAnio: number | null;
    saldo: number | null; liquidacion: number | null; controlConcurrente: number | null; laudo: number | null; fianza: number | null;
  };
  veces: number | null;
  avanceFisico: number | null;
  expedienteTecnico: boolean | null;
  fechas: { registro: string | null; viabilidad: string | null; inicio: string | null; fin: string | null; cierre: string | null };
  beneficiarios: number | null;
  banderas: BanderaObra[];
  severidad: Severidad | null;
  dudoso: string[];
  contratos: { ocid: string; codigo: string | null; origen: string; tipo: string | null; fecha: string | null }[];
  obras: number;
  alDia: string | null;
  url: string;
}

/** La obra o la inversión de un contrato (GET /contratos/:ocid): con qué papel y cómo se reconoció. */
export type ObraDelContrato = Obra & { rol: "ejecucion" | "supervision"; via: string };
export type InversionDelContrato = Inversion & { origenCui: "ocds" | "texto" | "snip" };

export type FacetasObras = Partial<Record<"estado" | "bandera" | "modalidad" | "monto" | "anio" | "rol" | "contrato", Record<string, number>>>;
export type FacetasInversiones = Partial<Record<"estado" | "bandera" | "monto" | "contrato" | "funcion", Record<string, number>>>;

export interface ObrasPagina {
  page: number;
  size: number;
  total: number | null;
  hayMas: boolean;
  ancla?: "entidad" | "empresa";
  alDia?: string | null;
  /** La API respondió sin la migración 160. */
  sinDatos?: boolean;
  facetas: FacetasObras | null;
  data: Obra[];
}
export interface InversionesPagina {
  page: number;
  size: number;
  total: number | null;
  hayMas: boolean;
  sinDatos?: boolean;
  facetas: FacetasInversiones | null;
  data: Inversion[];
}

export interface ResumenObras {
  obras: { total: number; con: number; alta: number; enObra: number; conContrato: number; porBandera: Record<string, number> } | null;
  inversiones: { total: number; con: number; activas: number; porBandera: Record<string, number> } | null;
  alDia: string | null;
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

export const ESTADOS_OBRA = [
  { valor: "ejecucion", etiqueta: "En ejecución" },
  { valor: "paralizada", etiqueta: "Paralizada" },
  { valor: "finalizada", etiqueta: "Finalizada" },
  { valor: "sin_ejecucion", etiqueta: "Sin empezar" },
] as const;

/** Los filtros por bandera de la lista de obras (los mismos de la API, lib/obras.ts BANDERA_OBRA). */
export const BANDERAS_OBRA = [
  { valor: "con", etiqueta: "Con alguna bandera", grupo: undefined },
  { valor: "alta", etiqueta: "Con una bandera grave", grupo: undefined },
  { valor: "paralizada", etiqueta: "Paralizada hoy", grupo: "En la obra" },
  { valor: "paralizacion", etiqueta: "Paralizada alguna vez", grupo: "En la obra" },
  { valor: "atraso", etiqueta: "Atrasada 20 puntos o más", grupo: "En la obra" },
  { valor: "pago", etiqueta: "Pagada más de lo construido", grupo: "En la obra" },
  { valor: "plazo", etiqueta: "Plazo ampliado a la mitad o más", grupo: "En la obra" },
  { valor: "adicionales", etiqueta: "Con adicionales de obra", grupo: "Adicionales" },
  { valor: "adicionales_tope", etiqueta: "Adicionales sobre el tope legal (15 %)", grupo: "Adicionales" },
  { valor: "controversia", etiqueta: "Con controversias o arbitraje", grupo: "Control" },
  { valor: "control", etiqueta: "Con informes de la Contraloría", grupo: "Control" },
] as const;

export const MODALIDADES_OBRA = [
  { valor: "contrata", etiqueta: "Por contrata (una empresa)" },
  { valor: "directa", etiqueta: "Administración directa (la entidad)" },
  { valor: "nucleo", etiqueta: "Núcleo ejecutor" },
  { valor: "impuestos", etiqueta: "Obras por impuestos" },
  { valor: "otra", etiqueta: "Otra modalidad" },
] as const;

export const MONTOS_OBRA = [
  { valor: "hasta_1m", etiqueta: "Hasta S/ 1 millón" },
  { valor: "1m_10m", etiqueta: "De S/ 1 a 10 millones" },
  { valor: "mas_10m", etiqueta: "Más de S/ 10 millones" },
  { valor: "sin_monto", etiqueta: "Sin monto registrado" },
] as const;

export const ESTADOS_INVERSION = [
  { valor: "activa", etiqueta: "Activas" },
  { valor: "cerrada", etiqueta: "Cerradas" },
] as const;

export const BANDERAS_INVERSION = [
  { valor: "con", etiqueta: "Con alguna bandera" },
  { valor: "sobrecosto", etiqueta: "Cuesta 1.5 veces o más lo aprobado" },
  { valor: "sobrecosto_extremo", etiqueta: "Cuesta 2 veces o más lo aprobado" },
  { valor: "laudo", etiqueta: "Con laudo arbitral" },
] as const;

export const MONTOS_INVERSION = [
  { valor: "hasta_1m", etiqueta: "Hasta S/ 1 millón" },
  { valor: "1m_10m", etiqueta: "De S/ 1 a 10 millones" },
  { valor: "mas_10m", etiqueta: "Más de S/ 10 millones" },
] as const;

export const ORDENES_LISTA = [
  { valor: "reciente", etiqueta: "Más recientes" },
  { valor: "antiguo", etiqueta: "Más antiguas" },
  { valor: "monto", etiqueta: "Mayor monto" },
] as const;

export type FiltrosObras = {
  entidad?: string; empresa?: string; rol?: string; q?: string; estado?: string; bandera?: string; modalidad?: string; monto?: string;
  anio?: number; contrato?: string; orden?: string; page?: number; size?: number;
};
export type FiltrosInversiones = {
  entidad?: string; q?: string; estado?: string; bandera?: string; funcion?: string; monto?: string; contrato?: string; orden?: string;
  page?: number; size?: number;
};

/** Claves en la URL (prefijo «ob» y «iv»), para no pisar los filtros de las otras pestañas. */
export const P_OBRA = {
  q: "obq", estado: "obest", bandera: "obband", modalidad: "obmod", monto: "obmonto", anio: "obanio", contrato: "obcon", rol: "obrol",
  orden: "obord", page: "obpag",
} as const;
export const P_INV = {
  q: "ivq", estado: "ivest", bandera: "ivband", funcion: "ivfun", monto: "ivmonto", contrato: "ivcon", orden: "ivord", page: "ivpag",
} as const;

type Busqueda = Record<string, string | string[] | undefined> | undefined;
const valida = (lista: readonly { valor: string }[], v: string | undefined) => (v && lista.some((x) => x.valor === v) ? v : undefined);
const de = (sp: Busqueda, k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };
const numeroDe = (sp: Busqueda, k: string) => { const x = parseInt(de(sp, k) ?? "", 10); return Number.isFinite(x) ? x : undefined; };

export function parseObrasQuery(sp: Busqueda): FiltrosObras {
  const q = de(sp, P_OBRA.q)?.trim();
  return {
    q: q && q.length >= 2 ? q.slice(0, 80) : undefined,
    estado: valida(ESTADOS_OBRA, de(sp, P_OBRA.estado)),
    bandera: valida(BANDERAS_OBRA, de(sp, P_OBRA.bandera)),
    modalidad: valida(MODALIDADES_OBRA, de(sp, P_OBRA.modalidad)),
    monto: valida(MONTOS_OBRA, de(sp, P_OBRA.monto)),
    anio: ((a) => (a && a >= 1990 && a <= 2100 ? a : undefined))(numeroDe(sp, P_OBRA.anio)),
    contrato: de(sp, P_OBRA.contrato) === "con" ? "con" : undefined,
    rol: de(sp, P_OBRA.rol) === "ejecucion" || de(sp, P_OBRA.rol) === "supervision" ? de(sp, P_OBRA.rol) : undefined,
    orden: valida(ORDENES_LISTA, de(sp, P_OBRA.orden)),
    page: ((p) => (p && p >= 1 ? p : undefined))(numeroDe(sp, P_OBRA.page)),
  };
}

export function parseInversionesQuery(sp: Busqueda): FiltrosInversiones {
  const q = de(sp, P_INV.q)?.trim();
  const funcion = de(sp, P_INV.funcion)?.trim();
  return {
    q: q && q.length >= 2 ? q.slice(0, 80) : undefined,
    estado: valida(ESTADOS_INVERSION, de(sp, P_INV.estado)),
    bandera: valida(BANDERAS_INVERSION, de(sp, P_INV.bandera)),
    funcion: funcion && funcion.length >= 2 ? funcion.slice(0, 80) : undefined,
    monto: valida(MONTOS_INVERSION, de(sp, P_INV.monto)),
    contrato: de(sp, P_INV.contrato) === "con" ? "con" : undefined,
    orden: valida(ORDENES_LISTA, de(sp, P_INV.orden)),
    page: ((p) => (p && p >= 1 ? p : undefined))(numeroDe(sp, P_INV.page)),
  };
}

/** Los filtros puestos de una lista, con los nombres de su URL (sin la página). */
export function parametrosDe(P: Readonly<Record<string, string>>, f: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, param] of Object.entries(P)) {
    const v = (f as Record<string, unknown>)[k];
    if (k !== "page" && v != null && v !== "") out[param] = String(v);
  }
  return out;
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

async function leer<T>(ruta: string, revalidate = 600): Promise<T | null> {
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

export const getObras = (f: FiltrosObras) => leer<ObrasPagina>(`/obras?${consulta(f)}`);
export const getInversiones = (f: FiltrosInversiones) => leer<InversionesPagina>(`/obras/inversiones?${consulta(f)}`);
export const getResumenObras = (ruc: string) => leer<ResumenObras>(`/obras/resumen?entidad=${encodeURIComponent(ruc)}`);

// ─── Las banderas en palabras ─────────────────────────────────────────────────

const n = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const t = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const pp = (x: number | null) => (x == null ? "Sin dato" : porcentaje(x, { decimales: 1 }));
const puntos = (x: number | null) => (x == null ? "Sin dato" : `${numero(x)} ${Math.round(x) === 1 ? "punto" : "puntos"}`);

/**
 * La bandera de una obra o de una inversión dicha en una frase, con sus números y sus fechas (la evidencia de la fuente).
 * `sujeto`: de quién se habla («La obra», «La obra que supervisa este contrato»).
 */
export function fraseBandera(b: BanderaObra, sujeto = "La obra"): string {
  switch (b.tipo) {
    case "obra_paralizada_larga":
    case "obra_paralizada": {
      const desde = t(b.desde), dias = n(b.dias), causal = t(b.causal), al = t(b.al);
      return `${sujeto} está paralizada${desde ? ` desde el ${fecha(desde)}` : ""}${dias ? `: ${plural(dias, "día", "días")}${al ? ` al ${fecha(al)}` : ""}` : ""}`
        + `${causal ? `, por «${causal}»` : ""}, según INFOBRAS.`;
    }
    case "obra_paralizacion": {
      const desde = t(b.desde), dias = n(b.dias), causal = t(b.causal), estado = t(b.estado);
      return `${sujeto} estuvo paralizada${dias ? ` ${plural(dias, "día", "días")}` : ""}${desde ? ` desde el ${fecha(desde)}` : ""}${causal ? `, por «${causal}»` : ""}`
        + `${estado ? `; hoy figura como «${estado.toLocaleLowerCase("es")}»` : ""}.`;
    }
    case "obra_atraso_grave":
    case "obra_atraso": {
      const al = t(b.al);
      const quien = al ? sujeto.charAt(0).toLocaleLowerCase("es") + sujeto.slice(1) : sujeto;
      return `${al ? `Al ${fecha(al)}, ` : ""}${quien} llevaba ${pp(n(b.real))} de avance físico cuando debía llevar ${pp(n(b.programado))}: `
        + `${puntos(n(b.puntos))} de atraso.`;
    }
    case "obra_pagado_sin_avance":
    case "obra_pago_adelantado": {
      const al = t(b.al), pagado = n(b.pagado);
      return `${al ? `Al ${fecha(al)}, la` : "La"} ejecución financiera era de ${pp(n(b.financiero))}${pagado ? ` (${soles(pagado)})` : ""} con ${pp(n(b.fisico))} de avance físico: `
        + `se pagó ${puntos(n(b.puntos))} por encima de lo construido.`;
    }
    case "obra_adicionales_sobre_tope":
    case "obra_adicionales_altos":
    case "obra_adicionales": {
      const cuantos = n(b.n) ?? 0, monto = n(b.monto), base = n(b.base), pct = n(b.porcentaje), neto = n(b.neto), deduc = n(b.deductivos);
      const deQue = b.base_de === "expediente" ? "del costo del expediente técnico (INFOBRAS no trae un monto de contrato)" : "del contrato";
      return `${sujeto} sumó ${cuantos > 0 ? plural(cuantos, "adicional", "adicionales") : "adicionales"} por ${soles(monto)}`
        + `${pct != null && base ? `: el ${pp(pct)} ${deQue} de ${soles(base)}` : ""}`
        + `${deduc && deduc > 0 && neto != null ? `; descontados los deductivos (${soles(deduc)}), el ${pp(neto)}` : ""}.`
        + `${b.tipo === "obra_adicionales_sobre_tope" ? " Pasa el 15 % que la ley permite sin la autorización previa de la Contraloría." : ""}`;
    }
    case "obra_plazo_duplicado":
    case "obra_plazo_ampliado": {
      const plazo = n(b.plazo), ampl = n(b.ampliacion), mods = n(b.modificaciones), fin = t(b.fin_programado), rep = t(b.fin_reprogramado);
      return `Las ampliaciones de plazo suman ${plural(ampl ?? 0, "día", "días")} sobre un plazo de ${plural(plazo ?? 0, "día", "días")} (${pp(n(b.porcentaje))})`
        + `${mods ? ` en ${plural(mods, "modificación", "modificaciones")}` : ""}${fin && rep && fin !== rep ? `: debía terminar el ${fechaCorta(fin)} y se reprogramó al ${fechaCorta(rep)}` : ""}.`;
    }
    case "obra_controversia":
      return `INFOBRAS registra ${plural(n(b.n) ?? 1, "controversia", "controversias")} entre la entidad y el contratista (arbitraje o conciliación).`;
    case "obra_informe_control":
      return `La Contraloría emitió ${plural(n(b.n) ?? 1, "informe de control", "informes de control")} sobre esta obra.`;
    case "inversion_sobrecosto_extremo":
    case "inversion_sobrecosto": {
      const veces = n(b.veces), viab = t(b.viabilidad);
      return `Se declaró viable${viab ? ` el ${fecha(viab)}` : ""} por ${soles(n(b.viable))} y hoy cuesta ${soles(n(b.actualizado))}: `
        + `${veces != null ? `${veces.toLocaleString("es-PE", { maximumFractionDigits: 2 })} veces` : "más que"} lo aprobado (${soles(n(b.diferencia))} más), según Invierte.pe.`;
    }
    case "inversion_laudo":
      return `Invierte.pe registra laudos arbitrales por ${soles(n(b.monto))} en esta inversión: la entidad y el contratista resolvieron una controversia en un arbitraje.`;
    default:
      return "";
  }
}

/** Qué muestra el estado de la obra en un chip. */
export const ESTADO_TEXTO: Record<string, string> = {
  "Finalizado": "Finalizada",
  "En Ejecución": "En ejecución",
  "Paralizada": "Paralizada",
  "Sin Ejecución": "Sin empezar",
};

/** La ficha de la obra en INFOBRAS y el seguimiento de la inversión en el MEF (los enlaces que trae la API). */
export const FUENTE_OBRA = "INFOBRAS (Contraloría)";
export const FUENTE_INVERSION = "Invierte.pe (MEF)";
