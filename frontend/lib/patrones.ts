/**
 * Patrones (API /patrones, migración 276): lo que SE REPITE. Una señal de los agentes que aparece mucho más en una
 * entidad que en el país, o en varios contratos de una misma empresa; el postor que casi nunca gana y siempre acompaña
 * al mismo ganador; dos empresas que fueron socias en un consorcio y después compiten entre sí; el mismo servicio que una
 * entidad vuelve a contratar bastante más caro por mes. Un patrón es un motivo para mirar, no una acusación.
 *
 * La página (/app/patrones) pide cada lista al abrir su pestaña, desde el navegador: aquí están los tipos, las rutas de
 * la API (`ruta…`) y las mismas lecturas para un componente de servidor (`get…`).
 */
import { API_BASE } from "./api-client";
import type { VentaASuEntidad } from "@/lib/autoridadExsocio";

/** Las pestañas de /app/patrones, en su orden: clave de `?seccion=` y nombre. */
export const SECCIONES_PATRONES = {
  entidades: "Por entidad",
  proveedores: "Por proveedor",
  relleno: "Postores de relleno",
  consorcios: "Socias que compiten",
  duenos: "Mismo dueño",
  grupos: "Grupos por dueño y familia",
  repetidas: "Compras repetidas",
  doble: "Dos ingresos del Estado",
  compras: "Compras y familia",
  autoridad: "Autoridad que dejó su empresa",
  recien: "Recién creadas con órdenes",
  inhabilitadas: "Socio de inhabilitada",
  control: "Socio en informe de control",
  observados: "Observados por la Contraloría",
  renovaciones: "Renovaciones más caras",
  cierres: "Cierre de gestión",
  observacion: "En observación",
} as const;
export type SeccionPatrones = keyof typeof SECCIONES_PATRONES;

/** Filas por página: el mismo tamaño en las cuatro listas. */
export const TAM_PATRONES = 25;

export type AlcancePatron = "entidad" | "proveedor";

/** Una señal de proceso que se repite en una entidad o en una empresa. */
export interface PatronSenal {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  ruc: string;
  nombre: string | null;
  regla: string;
  /** Contratos leídos en que aparece la señal. */
  casos: number;
  /** Contratos leídos (por los agentes) de esa entidad o empresa: el denominador de `tasa`. */
  leidos: number;
  /** En cuántas entidades distintas (alcance proveedor); null en el alcance entidad. */
  entidades: number | null;
  /** Parte de sus contratos leídos con la señal (0 a 1). */
  tasa: number | null;
  /** La misma parte en todo el país (0 a 1). */
  tasaPais: number | null;
  /** Cuántas veces la tasa del país. */
  veces: number | null;
  /** Soles, o null si no se sabe. */
  monto: number | null;
  /** OCID de contratos con la señal. */
  ejemplos: string[];
  calculadoEl: string | null;
}

export interface PatronesSenal {
  total: number;
  page: number;
  size: number;
  porRegla: { regla: string; n: number }[];
  data: PatronSenal[];
}

/** Un ganador y la empresa que casi siempre postula a su lado sin ganar. */
export interface PatronAcompanante {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  rucGanador: string;
  ganador: string | null;
  rucAcompanante: string;
  acompanante: string | null;
  /** Procesos en que postularon los dos. */
  juntos: number;
  entidades: number;
  postulacionesDelAcompanante: number;
  ganadasDelAcompanante: number;
  /** Parte de las postulaciones del acompañante que fueron junto a ese ganador (0 a 1). */
  parte: number;
  desde: string | null;
  hasta: string | null;
  /** `socio_comun`: además comparten un socio. */
  vinculo: "socio_comun" | null;
  fuerte: boolean;
}

export interface PatronesAcompanantes {
  total: number;
  page: number;
  size: number;
  data: PatronAcompanante[];
}

/** Dos empresas que postularon juntas en consorcio y después se enfrentan por separado. */
export interface PatronConsorcio {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  rucA: string;
  nombreA: string | null;
  rucB: string;
  nombreB: string | null;
  /** Consorcios en que fueron socias. */
  consorcios: number;
  /** Procesos en que compitieron por separado. */
  rivales: number;
  /** De esos, en cuántos fueron las únicas dos postoras. */
  solas: number;
  ganoA: number;
  ganoB: number;
  entidades: number;
  desde: string | null;
  hasta: string | null;
  /** Coinciden en más de 20 entidades (aseguradoras, por ejemplo): es la forma del mercado, no da bandera. */
  mercadoNacional: boolean;
}

/** Un socio que gana en una entidad con dos o más empresas, procesos de objeto parecido (migraciones 292 y 293). */
export interface PatronDueno {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  entidadRuc: string;
  entidad: string | null;
  /** El socio, con un apellido tapado (o un rótulo si es una sucesión). */
  socios: { nombre: string; rol: string }[];
  empresas: { ruc: string; nombre: string | null }[];
  /** Contratos con otro de objeto parecido de una empresa hermana. */
  contratos: number;
  /** De esos, los que están a 90 días o menos del otro. */
  seguidos: number;
  monto: number | null;
  desde: string | null;
  hasta: string | null;
  ejemplos: string[];
}

/**
 * Un grupo de proveedores de una misma entidad unidos por dueño o por familia probable, con lo que hicieron juntos en las
 * órdenes (migración 343). Las personas naturales llegan con un apellido tapado y su RUC como referencia opaca.
 */
export interface PatronGrupo {
  /** La clave opaca de su ficha de caso (/app/patrones/caso/grupos/<clave>). */
  clave?: string;
  entidadRuc: string;
  entidad: string | null;
  grupo: string;
  /** `parteDeSusVentas`: qué parte de lo que le vendió al Estado por órdenes desde 2018 viene de esta entidad (0 a 1). */
  miembros: { ruc: string; nombre: string | null; ordenes: number; monto: number; persona: boolean; codigo: string | null; parteDeSusVentas: number | null }[];
  empresas: number;
  personas: number;
  ordenes: number;
  monto: number;
  desde: string | null;
  hasta: string | null;
  hasta8Uit: number;
  borde: number;
  montoBorde: number;
  sobreTope: number;
  diasJuntos: number;
  montoJuntos: number;
  correlativas: number;
  repartidos: number;
  montoRepartido: number;
  puestoGrupo: number | null;
  puestoMayor: number | null;
  /** Qué parte de lo que el grupo le vendió al Estado por órdenes viene de esta entidad (0 a 1, migración 347). */
  parteEntidad: number | null;
  severidad: "alta" | "media" | "baja";
  vinculos: { a: string; nombreA: string | null; b: string; nombreB: string | null; via: string; que: string; persona: string | null; personaB: string | null }[];
  dias: { fecha: string; ordenes: number; miembros: number; monto: number; correlativas: number; detalle: { ruc: string; nombre: string | null; orden: string; monto: number }[] }[];
  objetosRepartidos: { anio: number; objeto: string; ordenes: number; miembros: number; monto: number; tope: number; detalle: { ruc: string; nombre: string | null; orden: string; fecha: string; monto: number }[] }[];
  sobreTopeOrdenes: { ruc: string; nombre: string | null; orden: string; fecha: string; monto: number; tope: number; descripcion: string | null }[];
  /** Integrantes que un funcionario de la misma entidad declaró como pariente en su DJI (migración 344). */
  parientesDeFuncionarios: { ruc: string; nombre: string | null; cargo: string | null; parentesco: string | null; ordenes: number | null; monto: number | null; via?: "ruc10" | "socio" }[];
}
export interface PatronesGrupos {
  total: number;
  page: number;
  size: number;
  /** Lo que suman TODOS los grupos del filtro (no sólo los de la página); null sin grupos. */
  resumen?: { monto: number; altas: number; conCorrelativas: number; conRepartidos: number } | null;
  data: PatronGrupo[];
}

/**
 * La misma compra repetida en semanas (migraciones 348 y 349): órdenes de compra directas del mismo proveedor, el mismo
 * monto y el mismo objeto, de 7 a 90 días entre la primera y la última. Una persona natural llega con un apellido tapado y
 * su RUC como referencia opaca.
 */
export interface PatronRepetida {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  entidadRuc: string;
  entidad: string | null;
  ruc: string;
  nombre: string | null;
  /** El de cada orden: es el mismo. */
  monto: number;
  ordenes: number;
  total: number;
  /** El tope de una orden directa el año de la primera (8 UIT). */
  tope: number;
  desde: string;
  hasta: string;
  dias: number;
  devengadas: number;
  objeto: string | null;
  /** alta: juntas pasan el tope y cada una está al borde; media: juntas pasan el tope, o todas se devengaron. */
  severidad: "alta" | "media" | "baja";
  detalle: { orden: string; fecha: string; estado: string | null }[];
}

export interface PatronesRepetidas {
  total: number;
  page: number;
  size: number;
  data: PatronRepetida[];
}

/** Una empresa recién creada que recibe órdenes directas de una entidad a los pocos días de su alta (migración 355). */
export interface PatronRecien {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  entidadRuc: string;
  entidad: string | null;
  ruc: string;
  nombre: string | null;
  fechaAlta: string;
  primeraOrden: string;
  /** Del alta en la SUNAT a su primera orden directa de la entidad. */
  dias: number;
  ordenesPrimerAnio: number;
  montoPrimerAnio: number;
  ordenes: number;
  monto: number;
  /** Qué parte de lo que vendió por órdenes al Estado viene de esta entidad (0 a 1). */
  parteEntidad: number | null;
  severidad: "alta" | "media" | "baja";
}

export interface PatronesRecien {
  total: number;
  page: number;
  size: number;
  data: PatronRecien[];
}

/**
 * Cobra del Estado por dos lados (migración 352): una persona de la planilla de `entidad` que, esos mismos meses, recibió
 * órdenes de servicio de `otra`. La persona llega con el materno tapado; `codigo` es su ficha única.
 */
export interface PatronDoble {
  entidadRuc: string;
  entidad: string | null;
  cargo: string | null;
  regimen: number | null;
  sueldo: number | null;
  otraRuc: string;
  otra: string | null;
  ordenes: number;
  monto: number;
  /** Meses en que estuvo en la planilla y recibió una orden de servicio de la otra entidad. */
  meses: number;
  desde: string | null;
  hasta: string | null;
  /** Su cargo o la otra entidad son de docencia: la excepción que la ley permite. */
  docente: boolean;
  severidad: "media" | "baja";
  codigo: string | null;
  persona: string | null;
}

export interface PatronesDoble {
  total: number;
  page: number;
  size: number;
  data: PatronDoble[];
}

/**
 * En observación (migración 364): un funcionario cuyo puesto declarado es de compras, logística o contrataciones y un
 * familiar que declaró en su declaración jurada, con las órdenes que ese familiar recibió de la misma entidad. La persona
 * llega con el materno tapado; el familiar, sólo por su parentesco.
 */
export interface PatronCompraFamilia {
  entidadRuc: string;
  entidad: string | null;
  cargo: string;
  cargoDesde: string | null;
  cargoHasta: string | null;
  vistoHasta?: string | null;
  /** persona: órdenes a nombre del familiar · empresa: ventas de una empresa en la que figura (migración 368). */
  via?: "persona" | "empresa";
  empresaRuc?: string | null;
  empresa?: string | null;
  rolEnEmpresa?: string[] | null;
  parienteDesde?: string | null;
  procesosEnPuesto?: number | null;
  montoProcesosEnPuesto?: number | null;
  /** La llave del caso para pedir su evidencia (migración 369). */
  clave?: string;
  parentesco: string;
  cercano: boolean;
  ordenes: number;
  monto: number;
  desde: number | null;
  hasta: number | null;
  /** Por fecha de emisión frente al puesto (migración 366; ver lib/comprasFamilia.ts). */
  ordenesEnPuesto?: number | null;
  montoEnPuesto?: number | null;
  ordenesAntes?: number | null;
  ordenesLuego?: number | null;
  primeraEnPuesto?: string | null;
  ultimaEnPuesto?: string | null;
  coincide: boolean;
  empezoDespues: boolean;
  severidad: "alta" | "media" | "baja";
  codigo: string | null;
  persona: string | null;
}

export interface PatronesComprasFamilia {
  total: number;
  page: number;
  size: number;
  resumen?: Partial<Record<"alta" | "media" | "baja", { casos: number; personas: number; entidades: number; monto: number; montoEnPuesto?: number }>>;
  data: PatronCompraFamilia[];
}

/** Una empresa que gana mientras otra del mismo socio está inhabilitada (migración 297). */
export interface PatronInhabilitada {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  ruc: string;
  empresa: string | null;
  sancionadaRuc: string | null;
  sancionada: string | null;
  /** «temporal» o «definitivo». */
  sancion: string | null;
  sancionDesde: string | null;
  sancionHasta: string | null;
  /** El socio, con un apellido tapado (o un rótulo si es una sucesión). */
  socios: { nombre: string; rol: string }[];
  /** Contratos ganados dentro de la sanción. */
  contratos: number;
  /** De esos, los graves: sanción definitiva, o empresa fundada (o socio que entró) cerca del inicio de la sanción. */
  graves: number;
  monto: number | null;
  entidades: number;
  desde: string | null;
  hasta: string | null;
  hechaParaSeguir: boolean;
  fundada: string | null;
  ejemplos: string[];
}

export interface PatronesInhabilitadas {
  total: number;
  page: number;
  size: number;
  data: PatronInhabilitada[];
}

/** Una empresa que gana con un socio o representante comprendido en un informe de control anterior (migraciones 303 y 307). */
export interface PatronControl {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  ruc: string;
  empresa: string | null;
  /** La persona, con un apellido tapado, y su papel en la empresa. */
  socios: { nombre: string; rol: string }[];
  informeCodigo: string | null;
  informeNumero: string | null;
  informeEntidad: string | null;
  informeEntidadRuc: string | null;
  emision: string | null;
  /** penal, civil, administrativa_entidad, administrativa_pas: PRESUNTA. */
  responsabilidades: string[] | null;
  /** La Ficha Resumen del informe en la Contraloría. */
  ficha: string | null;
  /** Cuántos informes anteriores comprenden a la persona. */
  informes: number | null;
  /** Contratos ganados después del informe. */
  contratos: number;
  graves: number;
  monto: number | null;
  entidades: number;
  /** Algún informe es de la misma entidad que contrató. */
  mismaEntidad: boolean;
  desde: string | null;
  hasta: string | null;
  ejemplos: string[];
}

export interface PatronesControl {
  total: number;
  page: number;
  size: number;
  data: PatronControl[];
}

/** Un proveedor con procesos que la Contraloría observó en una entidad (migración 313) y lo que ella le adjudicó después. */
export interface PatronObservado {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  ruc: string;
  empresa: string | null;
  entidadRuc: string;
  entidad: string | null;
  /** Procesos del proveedor en esa entidad que alguna observación nombra. */
  observados: number;
  graves: number;
  monto: number | null;
  /** Lo que cuantifican las observaciones, en soles. */
  perjuicio: number | null;
  observaciones: number | null;
  informes: number;
  temas: string[] | null;
  /** El informe más antiguo del par. */
  informeCodigo: string | null;
  informeNumero: string | null;
  emision: string | null;
  responsabilidades: string[] | null;
  ficha: string | null;
  ejemplos: string[];
  desde: string | null;
  hasta: string | null;
  /** Lo que la misma entidad le adjudicó (con su RUC) después de emitido ese informe. */
  despues: number;
  montoDespues: number | null;
  ultimaDespues: string | null;
}

export interface PatronesObservados {
  total: number;
  page: number;
  size: number;
  data: PatronObservado[];
}

export interface PatronesDuenos {
  total: number;
  page: number;
  size: number;
  data: PatronDueno[];
}

export interface PatronesConsorcios {
  total: number;
  page: number;
  size: number;
  data: PatronConsorcio[];
}

/** Una entidad volvió a contratar el mismo servicio continuo y el costo por mes subió 30 % o más. */
export interface PatronRenovacion {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  ocid: string;
  ocidAnterior: string;
  entidadRuc: string;
  entidad: string | null;
  objeto: string | null;
  fecha: string | null;
  fechaAnterior: string | null;
  monto: number | null;
  montoAnterior: number | null;
  plazoDias: number | null;
  plazoAnterior: number | null;
  /** Monto entre plazo, en soles por mes. */
  costoMensual: number | null;
  costoMensualAnterior: number | null;
  /** Cuánto subió el costo por mes, en % (30 a 300). */
  diffPct: number;
  /** Qué tan igual es el objeto de los dos contratos (0.65 a 1). */
  similitud: number;
  /** Soles de más en todo el plazo, frente al costo por mes de antes. */
  exceso: number | null;
  /** RUC 20, o null. */
  proveedorRuc: string | null;
  proveedor: string | null;
  mismoProveedor: boolean | null;
}

export interface PatronesRenovaciones {
  total: number;
  /** La suma de «de más» de todas, en soles. */
  exceso: number | null;
  page: number;
  size: number;
  data: PatronRenovacion[];
}

// ─── Rutas de la API ─────────────────────────────────────────────────────────────

/**
 * Un contrato con un indicador en observación (migración 329): se muestra con su evidencia y no cuenta para el riesgo
 * hasta medir su precisión. De quien recibió una visita llega sólo el cargo y el área; quien visitó está en la ficha.
 */
export interface PatronObservacion {
  tipo:
    | "reunion_en_evaluacion"
    | "visita_personal_decisor"
    | "ofertas_a_la_vez"
    | "trabajo_en_el_ganador"
    | "firma_en_plazo_de_apelacion"
    | "solo_admitido_el_ganador"
    | "comite_mismo_ganador";
  etiqueta: string;
  severidad: "alta" | "media" | "baja";
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  ruc: string;
  empresa: string | null;
  entidadRuc: string | null;
  entidad: string | null;
  /** La última visita, o el día de las ofertas. */
  fecha: string | null;
  buenaPro: string | null;
  /** Reunión en la evaluación: el día de su oferta y cuántos días duró la evaluación. */
  oferta: string | null;
  diasEvaluacion: number | null;
  visitas: number | null;
  /** Visitas personales: en cuántos días y meses distintos. */
  dias: number | null;
  meses: number | null;
  /** Reunión en la evaluación: si la empresa ya le vendía a la entidad. */
  yaProveedor: boolean | null;
  cargo: string | null;
  area: string | null;
  /** Ofertas casi a la vez: los minutos entre las dos, sus horas y el otro postor. */
  minutos: number | null;
  horaGanador: string | null;
  horaOtro: string | null;
  otroRuc: string | null;
  otro: string | null;
  /** Trabajo en el ganador: cuándo fue el empleo frente a la buena pro (a_la_vez, despues, hasta_2_anios, antes, sin_fechas). */
  cuando?: string | null;
  empleoDesde?: string | null;
  empleoHasta?: string | null;
  /** Firma en el plazo de apelación: el día de la firma, los días hábiles desde la buena pro, las ofertas del ítem,
   * el consentimiento que registra CONOSCE y la norma según el régimen. */
  firma?: string | null;
  diasHabiles?: number | null;
  ofertas?: number | null;
  consentimiento?: string | null;
  norma?: string | null;
  /** Sólo admitieron al ganador: cuántas ofertas no se admitieron y cuáles eran de empresas (RUC 20). */
  noAdmitidas?: number | null;
  fueraEmpresas?: { ruc: string; nombre: string | null }[] | null;
  /** El mismo integrante del comité (migración 396): cuántas veces juntos, de cuántos procesos suyos, la parte que la
   * empresa gana con y sin esa persona, su papel en el comité y una clave estable (nunca su nombre). */
  veces?: number | null;
  procesosPersona?: number | null;
  parteCon?: number | null;
  parteSin?: number | null;
  rolComite?: string | null;
  integrante?: string | null;
}

export interface PatronesObservacion {
  total: number;
  page: number;
  size: number;
  porTipo: { tipo: string; n: number; etiqueta: string; tasaBase: { casos: number; universo: number; que: string } | null }[];
  data: PatronObservacion[];
}

const consulta = (p: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
};

export const rutaPatrones = (alcance: AlcancePatron, page = 1, regla?: string, ruc?: string) =>
  `/patrones?${consulta({ alcance, page, size: TAM_PATRONES, regla, ruc })}`;
// Con el RUC de una empresa, todas sus parejas (no sólo las fuertes): la API ignora `solo` si hay RUC.
export const rutaAcompanantes = (page = 1, ruc?: string) => `/patrones/acompanantes?${consulta({ solo: ruc ? undefined : "fuertes", page, size: TAM_PATRONES, ruc })}`;
export const rutaConsorcios = (page = 1, ruc?: string) => `/patrones/consorcios?${consulta({ page, size: TAM_PATRONES, ruc })}`;
export const rutaDuenos = (page = 1, ruc?: string, graves = false) =>
  `/patrones/duenos?${consulta({ page, size: TAM_PATRONES, ruc, graves: graves ? 1 : undefined })}`;
// `q`: el buscador de una ficha (la API lo usa sólo con el RUC puesto, y nunca busca el nombre de una persona natural).
export const rutaGrupos = (page = 1, ruc?: string, graves = false, q?: string) =>
  `/patrones/grupos?${consulta({ page, size: TAM_PATRONES, buscar: ruc, severidad: graves ? "alta" : undefined, q: q?.trim().slice(0, 80) })}`;
export const rutaRepetidas = (page = 1, ruc?: string, graves = false, q?: string) =>
  `/patrones/repetidas?${consulta({ page, size: TAM_PATRONES, buscar: ruc, severidad: graves ? "alta" : undefined, q: q?.trim().slice(0, 80) })}`;
export const rutaRecien = (page = 1, ruc?: string, graves = false, q?: string) =>
  `/patrones/recien?${consulta({ page, size: TAM_PATRONES, buscar: ruc, severidad: graves ? "alta" : undefined, q: q?.trim().slice(0, 80) })}`;
/**
 * En observación (migración 367): una autoridad electa dejó de figurar en una empresa del RNP y esa empresa le vendió a la
 * entidad que gobierna o fiscaliza, dentro de su periodo. La autoridad va con su nombre completo (es electa).
 */
export interface PatronAutoridadExsocio extends VentaASuEntidad {
  /** La clave opaca de su ficha de caso. */
  clave?: string;
  empresaRuc: string;
  empresa: string | null;
  autoridad: string | null;
  periodoInicio: string;
  periodoFin: string | null;
  /** Los papeles que tuvo en la empresa: socio, representante legal, directivo. */
  roles: string[];
  desde: string | null;
}

export interface PatronesAutoridadExsocio {
  total: number;
  page: number;
  size: number;
  resumen?: { casos: number; autoridades: number; empresas: number; entidades: number; monto: number; montoEnPlazo: number } | null;
  data: PatronAutoridadExsocio[];
}

/** Un gobierno local o regional con una ola de personas nuevas al cierre de una gestión (migración 380). */
export interface PatronCierre {
  entidadRuc: string;
  entidad: string | null;
  region: string | null;
  provincia: string | null;
  distrito: string | null;
  eleccion: string;
  cambio: string;
  personas: number;
  personasNuevas: number;
  ordenesNuevas: number;
  montoNuevas: number;
  personasBase: number;
  personasNuevasBase: number;
  personasNuevasDespues: number | null;
  /** educacion, salud, municipalidad u otro; y cuántas veces subieron las personas nuevas de todo ese sector. */
  sector?: string | null;
  vecesSector?: number | null;
  severidad: "alta" | "media";
}
export interface PatronesCierres {
  total: number;
  page: number;
  size: number;
  eleccion: string;
  resumen?: Record<string, { entidades: number; personasNuevas: number; montoNuevas: number }>;
  data: PatronCierre[];
}
export const rutaCierres = (page = 1, ruc?: string, graves = false) =>
  `/patrones/cierres?${consulta({ page, size: TAM_PATRONES, buscar: ruc, severidad: graves ? "alta" : undefined })}`;

export const rutaAutoridadExsocio = (page = 1, ruc?: string, graves = false) =>
  `/patrones/autoridad-exsocio?${consulta({ page, size: TAM_PATRONES, buscar: ruc, severidad: graves ? "alta" : undefined })}`;
export const rutaComprasFamilia = (page = 1, ruc?: string, graves = false) =>
  `/patrones/compras-familia?${consulta({ page, size: TAM_PATRONES, buscar: ruc, severidad: graves ? "alta" : undefined })}`;
export const rutaDoble = (page = 1, ruc?: string, graves = false) =>
  `/patrones/doble?${consulta({ page, size: TAM_PATRONES, buscar: ruc, severidad: graves ? "media" : undefined })}`;
export const rutaInhabilitadas = (page = 1, ruc?: string, graves = false) =>
  `/patrones/inhabilitadas?${consulta({ page, size: TAM_PATRONES, ruc, graves: graves ? 1 : undefined })}`;
export const rutaControl = (page = 1, ruc?: string, graves = false, misma = false) =>
  `/patrones/control?${consulta({ page, size: TAM_PATRONES, ruc, graves: graves ? 1 : undefined, misma: misma ? 1 : undefined })}`;
export const rutaObservados = (page = 1, ruc?: string, graves = false, siguio = false) =>
  `/patrones/observados?${consulta({ page, size: TAM_PATRONES, ruc, graves: graves ? 1 : undefined, siguio: siguio ? 1 : undefined })}`;
export const rutaRenovaciones = (page = 1, ruc?: string) => `/patrones/renovaciones?${consulta({ page, size: TAM_PATRONES, ruc })}`;
export const rutaObservacion = (page = 1, tipo?: string, ruc?: string, integrante?: string) =>
  `/patrones/observacion?${consulta({ page, size: TAM_PATRONES, tipo, ruc, integrante })}`;

// ─── Lecturas (servidor) ─────────────────────────────────────────────────────────

/**
 * El índice de la pestaña «Patrones» de una entidad (API GET /patrones/entidad/:ruc): cuántos casos tiene cada lista de
 * patrones en ella y los antecedentes de quienes ganaron sus contratos, por tipo, con contratos de ejemplo.
 */
export interface PatronesDeEntidad {
  ruc: string;
  /** `casos: null`: esa lista no respondió (no es un cero). */
  listas: { clave: SeccionPatrones; casos: number | null }[];
  cruces: {
    tipo: string;
    etiqueta: string;
    contratos: number;
    graves: number;
    medias: number;
    monto: number;
    empresas: number;
    ejemplos: { ocid: string; codigo: string | null; objeto: string | null; proveedor: string | null; ruc: string | null; monto: number | null; fecha: string | null; severidad: string }[] | null;
    /** Los proveedores con dos o más contratos de la entidad con ese antecedente (hasta cinco): quiénes lo repiten. */
    repiten?: { ruc: string | null; proveedor: string | null; contratos: number; monto: number }[] | null;
  }[];
}
export const getPatronesDeEntidad = (ruc: string) => leer<PatronesDeEntidad>(`/patrones/entidad/${ruc}`);

/**
 * Un antecedente en una entidad (API GET /patrones/entidad/:ruc/cruce/:tipo): año por año y quiénes ganaron esos
 * contratos, todos. Se pide en el navegador al elegirlo en el índice: con los 44 de EsSalud armados en el servidor, la
 * página cargaba todas sus listas.
 */
export interface AntecedenteDeEntidad {
  ruc: string;
  tipo: string;
  etiqueta: string;
  contratos: number;
  graves: number;
  medias: number;
  monto: number;
  empresas: number;
  /** Contratos sin fecha de buena pro: no entran al gráfico por año. */
  sinFecha: number;
  porAnio: { anio: number; contratos: number; graves: number; monto: number }[];
  /** Una persona natural llega con su RUC como referencia opaca y un apellido tapado: sin enlace. */
  proveedores: { ruc: string; proveedor: string | null; contratos: number; graves: number; monto: number }[];
}
/** Un contrato con ese antecedente (la severidad es la de ESE antecedente en él). */
export interface ContratoDelAntecedente {
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  proveedor: string | null;
  ruc: string | null;
  monto: number | null;
  fecha: string | null;
  severidad: "alta" | "media" | "baja" | null;
  tipoContratacion: string | null;
}
export interface ContratosDelAntecedente {
  total: number;
  page: number;
  size: number;
  data: ContratoDelAntecedente[];
}
export const rutaAntecedenteEntidad = (ruc: string, tipo: string) => `/patrones/entidad/${ruc}/cruce/${encodeURIComponent(tipo)}`;
export const rutaContratosAntecedente = (ruc: string, tipo: string, page = 1, q?: string, severidad?: string) =>
  `/patrones/entidad/${ruc}/cruce/${encodeURIComponent(tipo)}/contratos?${consulta({ page, size: TAM_PATRONES, q: q?.trim().slice(0, 80), severidad })}`;
/** En qué patrones aparece una empresa (API GET /patrones/empresa/:ruc): arriba de su pestaña «Antecedentes». */
export const getPatronesDeEmpresa = (ruc: string) => leer<Pick<PatronesDeEntidad, "ruc" | "listas">>(`/patrones/empresa/${ruc}`);

/** Los casos en observación de una ficha (entidad o empresa), para pintarlos en ella: sólo los graves y medios. */
export const getCasosComprasFamilia = (ruc: string) => leer<PatronesComprasFamilia>(`/patrones/compras-familia?buscar=${ruc}&relevantes=1&size=50`);
export const getCasosAutoridadExsocio = (ruc: string) => leer<PatronesAutoridadExsocio>(`/patrones/autoridad-exsocio?buscar=${ruc}&size=50`);

async function leer<T>(ruta: string, revalidate = 600): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getPatrones = (alcance: AlcancePatron, page = 1, regla?: string) => leer<PatronesSenal>(rutaPatrones(alcance, page, regla));
export const getPatronesAcompanantes = (page = 1) => leer<PatronesAcompanantes>(rutaAcompanantes(page));
export const getPatronesConsorcios = (page = 1) => leer<PatronesConsorcios>(rutaConsorcios(page));
export const getPatronesRenovaciones = (page = 1) => leer<PatronesRenovaciones>(rutaRenovaciones(page));

// ─── Para mostrar ────────────────────────────────────────────────────────────────

/** El código corto de un OCID («ocds-dgv273-seacev3-1235259» → «1235259»): el que se lee en una fila. */
export const codigoDeOcid = (ocid: string) => ocid.replace(/^ocds-[a-z0-9]+-seacev3-/i, "");

/** Una página pedida en la URL (`?page=`): un entero desde 1. */
export const paginaDe = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};
