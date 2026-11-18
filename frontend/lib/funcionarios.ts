/**
 * Personas con cargo público (API /personas/buscar y /personas/cargo/:codigo, migraciones 318 y 319): quien presentó una
 * declaración jurada de intereses a la Contraloría o está o estuvo en una planilla del Estado, y su rastro en los demás
 * registros de Vigía. Pedido del dueño del 2026-11-16: alguien con un cargo de poder «no aparece en la BBDD»; estaba (en
 * la planilla, en las declaraciones y en las visitas), pero la web no tenía por dónde llegar.
 *
 * Privacidad: el nombre llega con el apellido materno tapado y una sola vez (las filas de cada registro no traen nombre);
 * la ficha se pide por un código al azar; no hay documentos. El empate con los otros registros es por nombre completo.
 */
import { API_BASE } from "./api-client";
import type { PersonaPorNombre } from "./personas";

export const rutaFuncionario = (codigo: string, seccion?: string) => `/app/personas/cargo/${codigo}${seccion ? `?seccion=${seccion}` : ""}`;

/** Una persona con cargo público hallada por su nombre visible. */
export interface FuncionarioHallado {
  codigo: string;
  nombre: string;
  cargo: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  /** De dónde sale ese cargo: la planilla o su declaración jurada. */
  cargoDe: "planilla" | "dji" | null;
  declaraciones: number;
  entidades: number;
  ultima: string | null;
  /** Figura en la planilla del último mes de alguna entidad. */
  planillaHoy: boolean;
  planillaEntidades: number;
  /** El último mes en que figuró en una planilla (AAAA-MM). */
  planillaHasta: string | null;
}

/** GET /personas/buscar?q=: una persona buscada por su nombre en los registros que tienen ficha. */
export interface PersonasEncontradas {
  q: string;
  /** Qué falta para poder buscar (un apellido y un nombre). */
  falta?: string;
  /** Con cargo público: declaraciones juradas de intereses o planilla (de hoy o de antes). */
  conCargo: FuncionarioHallado[];
  /** Con órdenes de servicio o procesos ganados como persona natural. */
  contratadas: PersonaPorNombre[];
}

export interface CargoDeclarado {
  entidad: string | null;
  entidadRuc: string | null;
  cargo: string | null;
  declaraciones: number;
  inicio: string | null;
  cese: string | null;
  /** Alguna declaración de ese cargo no trae fecha de cese. */
  sinCese: boolean;
  primera: string | null;
  ultima: string | null;
  /**
   * El puesto con sus palabras, cuando `cargo` es sólo la categoría del formulario («Colaborador», «Otro cargo, función o
   * labor»): sale de la sección de empleos de esas mismas declaraciones (migración 357).
   */
  cargoReal?: string | null;
}

/** Un trabajo que la persona escribió en sus declaraciones juradas (sección de empleos). El empleador siempre tiene RUC 20. */
export interface EmpleoDeclarado {
  ruc: string;
  entidad: string | null;
  /** El empleador es una entidad pública con ficha en Vigía. */
  publica: boolean;
  cargo: string;
  declaraciones: number;
  inicio: string | null;
  cese: string | null;
  /** Ninguna declaración le pone fecha de cese. */
  sinCese: boolean;
}

/** Un cargo que tuvo en la planilla de una entidad, con sus meses publicados y lo que cobró en un mes habitual. */
export interface CargoEnPlanilla {
  cargo: string | null;
  dependencia: string | null;
  regimen: number | null;
  meses: number;
  primerMes: string | null;
  ultimoMes: string | null;
  /** Remuneración u honorarios de un mes habitual. */
  base: number | null;
  /** Todo lo que cobró en un mes habitual, con gratificaciones y otros conceptos. */
  total: number | null;
}

/** Lo que cobró de la planilla de una entidad en un año: la suma de sus meses publicados, sin los montos dudosos. */
export interface CobradoEnPlanilla {
  entidadRuc: string;
  entidad: string | null;
  anio: number;
  meses: number;
  primerMes: string | null;
  ultimoMes: string | null;
  total: number;
  /** Meses con un monto dudoso: no entran en `total`. */
  mesesDudosos: number;
  cargos: string[];
  /** El régimen laboral con que figura ese año (CAS, 276, 728…). Una API anterior no lo trae. */
  regimen?: number | null;
  /** De qué se compone `total`, como lo publica la entidad. */
  remuneraciones?: number;
  honorarios?: number;
  gratificacion?: number;
  incentivo?: number;
  otros?: number;
}

/** Las visitas que la persona hizo a una entidad (registro de visitas de esa entidad). */
export interface VisitaHecha {
  entidad: string;
  entidad_ruc: string | null;
  visitas: number;
  primera: string | null;
  ultima: string | null;
  /** La organización que dijo representar (sólo organizaciones). */
  en_nombre_de: string[];
  /** El cargo y la oficina de a quién visitó. */
  a_quien: string[] | null;
}

/** Una empresa cuya gente (socios, representantes, directivos o quien dijo venir de ella) visitó a la persona en una
 * entidad en que tuvo un cargo o figuró en planilla (migración 335). Nunca quién visitó. */
export interface VisitaRecibida {
  entidadRuc: string;
  entidad: string | null;
  ruc: string;
  empresa: string | null;
  visitas: number;
  primera: string | null;
  ultima: string | null;
  /** Procesos que la empresa le ganó a esa entidad (sola) desde su primera visita. */
  ganoDespues: number;
  montoDespues: number | null;
  primeraBuenaPro: string | null;
}

export interface EmpresaDeLaPersona { ruc: string; empresa: string | null; rol: string | null; desde: string | null }
/** Una planilla en que la persona figura («hoy»: en el último mes de la entidad) o figuró («antes»). */
export interface PlanillaDeLaPersona {
  situacion: "hoy" | "antes";
  /** La ficha de planilla (sólo la de hoy la tiene): /app/personas/planilla/<ficha>. */
  ficha: string | null;
  entidad: string | null; entidadRuc: string; cargo: string | null; dependencia: string | null; regimen: number | null;
  /** El sueldo base de un mes. */
  base: number | null;
  meses: number | null;
  primerMes: string | null; ultimoMes: string | null;
  /** Hasta qué mes llega la planilla publicada de esa entidad. */
  ultimoMesEntidad: string | null;
  /** Los cargos que tuvo en esa entidad, del último al primero; sólo si fueron más de uno (migración 357). */
  cargos?: CargoEnPlanilla[];
}
export interface OrdenesDeLaPersona {
  codigo: string | null; entidad: string | null; entidad_ruc: string; servicio: string | null; ordenes: number; monto: number | null; primera: string | null; ultima: string | null;
}
export interface AporteDeLaPersona { partido: string | null; anio: number | null; monto: number | null; aportes: number }
export interface CargoExpuesto { cargo: string | null; entidad: string | null; desde: number | null; hasta: number | null }
/** Una candidatura suya (JNE, desde 2014). */
export interface CandidaturaDeLaPersona {
  anio: number | null; cargo: string | null; partido: string | null; resultado: string | null;
  region: string | null; provincia: string | null; distrito: string | null;
}
export interface InformeDeLaPersona {
  codigo: string; numero: string | null; titulo: string | null; entidad: string | null; entidad_ruc: string | null; fecha: string | null;
  responsabilidades: string[] | null; ficha: string | null;
}

/** Los cruces entre registros que la API ya trae hechos. El empate es por nombre completo: hay que confirmarlo. */
export interface CrucesDeLaPersona {
  visitoYSuEmpresaGano: {
    entidad: string | null; entidad_ruc: string; empresa: string | null; empresa_ruc: string; rol_en_la_empresa: string | null; visitas: number;
    primera_visita: string | null; ultima_visita: string | null; procesos_ganados: number; monto_soles: number | null;
    primera_buena_pro: string | null; ultima_buena_pro: string | null; visito_antes_de_ganar: boolean;
  }[];
  salioYSuEmpresaGano: {
    entidad: string | null; entidad_ruc: string; cargo_que_tenia: string | null; salio_de_planilla: string | null; empresa: string | null; empresa_ruc: string;
    rol_en_la_empresa: string | null; procesos_ganados_despues: number; monto_soles: number | null; primera_buena_pro_tras_salir: string | null;
  }[];
  variasEmpresasEnUnaEntidad: {
    entidad: string | null; entidad_ruc: string; empresas: { ruc: string; nombre: string | null }[] | null; contratos_con_objeto_parecido: number;
    con_90_dias_o_menos_entre_si: number; monto_soles: number | null; desde: string | null; hasta: string | null;
  }[];
  empresaInhabilitadaYOtraGano: {
    empresa_inhabilitada: string | null; empresa_inhabilitada_ruc: string; sancion: string | null; sancion_desde: string | null; sancion_hasta: string | null;
    empresa_que_gano: string | null; empresa_que_gano_ruc: string; procesos_ganados_durante_la_sancion: number; monto_soles: number | null;
  }[];
  enInformeYDespuesCobro: {
    entidad: string | null; entidad_ruc: string; informe: string | null; fecha_del_informe: string | null; ordenes_de_esa_entidad: number; monto_soles: number | null;
    ultima_orden: string | null;
  }[];
  /**
   * Cobra del Estado por dos lados (migración 352): en la planilla de `entidad` y, esos mismos meses, con órdenes de servicio
   * de `otra`. `docente`: su cargo o la otra entidad son de docencia, la excepción que la ley permite (entonces «baja»).
   * Una API anterior no lo trae.
   */
  doblePercepcion?: {
    entidad: string | null; entidad_ruc: string; cargo: string | null; sueldo: number | null; otra: string | null; otra_ruc: string;
    ordenes: number; monto_soles: number; meses: number; desde: string | null; hasta: string | null; docente: boolean; severidad: "media" | "baja";
  }[];
  /**
   * En observación (migración 364): su puesto declarado es de compras o decide el gasto, y un familiar que declaró recibió
   * órdenes a su nombre de esa misma entidad. El familiar, sólo por su parentesco. Una API anterior no lo trae.
   */
  comprasFamiliar?: CompraFamiliar[];
}

export interface CompraFamiliar {
  entidadRuc: string;
  entidad: string | null;
  cargo: string;
  tipoCargo: "compras" | "decide";
  cargoDesde: string | null;
  /** null: sin cese declarado. */
  cargoHasta: string | null;
  parentesco: string;
  cercano: boolean;
  ordenes: number;
  monto: number;
  /** Años de las órdenes del familiar en esa entidad. */
  desde: number | null;
  hasta: number | null;
  coincide: boolean;
  /** La primera orden del familiar en la entidad es del año en que asumió el puesto, o posterior. */
  empezoDespues: boolean;
  severidad: "alta" | "media" | "baja";
}

/**
 * Las otras fichas de la MISMA persona (API lib/identidadPersona.ts): códigos al azar, nunca un nombre ni un documento.
 * La persona contratada se une sólo si una planilla ya la empató (misma entidad y mismo nombre) o si su nombre completo,
 * de 4 palabras o más, lo lleva un solo RUC 10 de todo el registro de órdenes.
 */
export interface FichasDeLaPersona {
  fichaCargo: string | null;
  fichaContratada: { codigo: string; via: "planilla" | "nombre" } | null;
  fichasPlanilla: { ficha: string; entidadRuc: string; entidad: string | null }[];
  /** RUC 10 distintos con ese nombre completo en las órdenes: con 2 o más (homónimos) no se une ninguno. */
  homonimos: number;
}

/** Lo que obtuvo del Estado un familiar que la persona declaró en su DJI (migración 351): sin nombre ni documento. */
export interface ItemFamiliar {
  tipo: "orden" | "empresa";
  entidadRuc: string | null;
  entidad: string | null;
  empresaRuc: string | null;
  empresa: string | null;
  rol: string | null;
  ordenes: number | null;
  procesos: number | null;
  monto: number | null;
  desde: number | null;
  hasta: number | null;
  /** Lo obtuvo de una entidad en la que la persona presentó declaración. */
  suEntidad: boolean;
  suEntidadOrdenes: number | null;
  suEntidadMonto: number | null;
  /** Autoridad electa y parentesco que destaparía un apellido: en su entidad no se dan las cifras. */
  reservado?: true;
}

export interface FamiliaDeLaPersona {
  declarados: number;
  conOrdenes: number;
  montoOrdenes: number;
  conEmpresas: number;
  enSuEntidad: number;
  montoSuEntidad: number;
  /** `cercano`: cónyuge, padres, hijos o hermanos; null si el parentesco va reservado. */
  parientes: { n: number; parentesco: string; cercano?: boolean | null; items: ItemFamiliar[] }[];
  /** Familiares cercanos, no reservados, que obtuvieron algo de su entidad: lo que hace grave la bandera. */
  cercanosEnSuEntidad?: number;
  masParientes: number;
}

export interface FichaFuncionario {
  codigo: string;
  /** Sus otras fichas. Una API anterior no las trae. */
  mismaPersona?: FichasDeLaPersona | null;
  /** Su red de familia; null: no declaró familiares (o una API anterior). */
  familia?: FamiliaDeLaPersona | null;
  persona: {
    nombre: string; cargo: string | null; entidad: string | null; entidadRuc: string | null; cargoDe: "planilla" | "dji" | null;
    declaraciones: number; entidades: number; primera: string | null; ultima: string | null;
    planillaHoy: boolean; planillaEntidades: number; planillaHasta: string | null;
  };
  /** Otras personas con cargo público que se ven igual (mismo apellido paterno y mismos nombres): son fichas aparte. */
  parecidos: number;
  cargos: CargoDeclarado[];
  /** Los trabajos que escribió en sus declaraciones. Una API anterior no los trae. */
  empleos?: EmpleoDeclarado[];
  visitas: { total: number; entidades: number; primera: string | null; ultima: string | null; filas: VisitaHecha[] };
  empresas: EmpresaDeLaPersona[];
  /** Las visitas que recibió, por empresa. null: no respondió a tiempo; una API anterior no las trae. */
  recibidas?: { empresas: number; visitas: number; ganaronDespues: number; filas: VisitaRecibida[] } | null;
  planilla: PlanillaDeLaPersona[];
  /** Lo que cobró en planilla, por entidad y año. Una API anterior no lo trae. */
  cobradoPlanilla?: CobradoEnPlanilla[];
  ordenes: OrdenesDeLaPersona[];
  aportes: AporteDeLaPersona[];
  expuesta: CargoExpuesto[];
  /** Una API anterior no las trae. */
  candidaturas?: CandidaturaDeLaPersona[];
  informes: InformeDeLaPersona[];
  cruces: CrucesDeLaPersona;
  /** Registros que no respondieron a tiempo: su parte de la ficha puede estar incompleta. */
  sinRespuesta: string[];
}

async function leer<T>(ruta: string, revalidate = 600): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * La dirección de la ficha única de una persona (/app/personas/cargo/<código>) desde otra de sus fichas: conserva la
 * pestaña y los filtros de la dirección de origen (`?seccion=`, `?sent=`, `?oent=`…) y aplica `cambios` (una clave con
 * `undefined` se quita). `directo` nunca viaja: es el que pide ver la ficha de origen sola.
 */
export function rutaFichaUnica(codigo: string, sp?: Record<string, string | string[] | undefined>, cambios: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp ?? {})) {
    const uno = Array.isArray(v) ? v[0] : v;
    if (uno != null && uno !== "" && k !== "directo") q.set(k, uno);
  }
  for (const [k, v] of Object.entries(cambios)) {
    if (v == null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return `/app/personas/cargo/${codigo}${s ? `?${s}` : ""}`;
}

export const getFichaFuncionario = (codigo: string) =>
  /^[0-9a-f]{12}$/.test(codigo) ? leer<FichaFuncionario>(`/personas/cargo/${codigo}`) : Promise.resolve(null);

/** Con menos de dos palabras, o con un número, no se pide nada (la API tampoco busca). */
export const getPersonasEncontradas = (q: string | undefined) => {
  const t = (q ?? "").trim();
  return t.split(/\s+/).filter((w) => w.length >= 3).length >= 2 && !/\d/.test(t)
    ? leer<PersonasEncontradas>(`/personas/buscar?q=${encodeURIComponent(t.slice(0, 80))}`)
    : Promise.resolve(null);
};

/** Cuántos cruces trae la ficha, sumados. */
export const totalCruces = (c: CrucesDeLaPersona) =>
  c.visitoYSuEmpresaGano.length + c.salioYSuEmpresaGano.length + c.variasEmpresasEnUnaEntidad.length + c.empresaInhabilitadaYOtraGano.length + c.enInformeYDespuesCobro.length +
  // Sólo los que piden revisión: con docencia (la excepción legal) o pocos meses es un dato, no un caso.
  (c.doblePercepcion ?? []).filter((x) => x.severidad === "media").length +
  // En observación, pero pide revisión: quien trabaja en compras y un familiar cercano cobra de su entidad.
  (c.comprasFamiliar ?? []).filter((x) => x.severidad !== "baja").length;
