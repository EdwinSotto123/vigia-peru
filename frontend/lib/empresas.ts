/**
 * Empresas (GET /empresas*, migración 109): cada empresa (RUC 20) que ganó, postuló o recibió órdenes del Estado, con lo
 * que le adjudicaron y le compraron, su gente en el RNP, sus visitas a entidades y lo que otros registros públicos dicen
 * de ella (sus antecedentes, como hechos: qué registro, cuántas veces, con qué gravedad y su fuente). Sin puntaje: el
 * usuario lo sacó (2026-10-22: «tiene mucho sesgo y parece acusación»; migración 112).
 *
 * Las personas (socios, representantes, visitantes, funcionarios) llegan con un apellido tapado y sin documento. Las
 * personas naturales que le venden al Estado (RUC 10) no están acá: van en /app/personas.
 *
 * Los GET devuelven `null` si la API no responde: quien llama no dibuja lo que no pudo leer.
 */
import { API_BASE } from "./api-client";
import { uno } from "@/lib/utils";

export type Severidad = "alta" | "media" | "baja";

/** Una empresa en la lista (y la cabecera de su ficha). Montos en soles; lo dudoso, aparte. */
export interface EmpresaFila {
  ruc: string;
  nombre: string;
  /** Donde más le pagaron (nombre del departamento, en mayúsculas). */
  departamento: string | null;
  /** Lo que más vende: Bien, Servicio, Obra, Consultoría de Obra. */
  objeto: string | null;
  estadoSunat: string | null;
  adjProcesos: number;
  adjMonto: number;
  consProcesos: number;
  /** De todo el consorcio, no la parte de la empresa. */
  consMonto: number;
  adjDudosos: number;
  ordN: number;
  ordMonto: number;
  ordDudosas: number;
  entidades: number;
  postulaciones: number;
  ganadas: number;
  primera: string | null;
  ultima: string | null;
  visitas: number;
  inhabilitada: "temporal" | "definitiva" | null;
  inhabilitadaHasta: string | null;
  /** Su alta en la SUNAT (en la lista desde 2026-10-26; la ficha siempre la trajo). */
  fechaAlta?: string | null;
  tipos: string[];
  nAlta: number;
  nMedia: number;
  nBaja: number;
  /** Cada tipo de antecedente con su gravedad más alta y cuántos registros, los graves primero (la celda de banderas). */
  cruces: { tipo: string; severidad: Severidad; n: number }[];
}

export interface ResumenEmpresas {
  empresas: number;
  adjMonto: number;
  consMonto: number;
  ordMonto: number;
  inhabilitadas: number;
  conVisitas: number;
  dudosos: { procesos: number; monto: number; ordenes: number; montoOrdenes: number };
  conAntecedentes: number;
  /** Con algún antecedente grave (inhabilitación, partido que gobierna, socio común entre postores…). */
  conGrave: number;
  /** Con alguno de gravedad media y ninguno grave. Opcionales: una respuesta guardada de antes no los trae. */
  conMedia?: number;
  /** Con visitas de su gente a una entidad que le adjudicó o le compró. */
  conVisitasClientes?: number;
  /** Con algún contrato u orden de monto con posible error de carga. */
  conDudosos?: number;
  /** Cuántas caen en cada tramo de los filtros (`antiguedad`, `clientes`, `exito`, `ultima`). */
  tramos?: Record<TramoEmpresa, Record<string, number>>;
  porTipo: { tipo: string; n: number; etiqueta: string }[];
  porDepartamento: { departamento: string; n: number }[];
  porObjeto: { objeto: string; n: number }[];
}

export interface PaginaEmpresas {
  total: number;
  page: number;
  size: number;
  data: EmpresaFila[];
  resumen: ResumenEmpresas;
  /** Con ?entidad=: el nombre de esa entidad. */
  entidad?: string | null;
}

/** Un tipo de antecedente de la empresa: cuántos registros y su gravedad más alta. */
export interface AntecedentePorTipo {
  tipo: string;
  severidad: Severidad;
  n: number;
  etiqueta: string;
}

export interface AnioEmpresa {
  anio: number;
  contratos: number;
  adjudicado: number;
  enConsorcio: number;
  adjudicadoConsorcio: number;
  contratosDudosos: number;
  adjudicadoDudoso: number;
  ordenes: number;
  ordenado: number;
  dudosas: number;
  ordenadoDudoso: number;
}

export interface FichaEmpresa {
  empresa: EmpresaFila & {
    adjMontoDudoso: number;
    adjOtraMoneda: number;
    ordMontoDudoso: number;
    fechaAlta: string | null;
    domicilio: string | null;
    actividad: string | null;
    socios: number;
    representantes: number;
    directivos: number;
    vinculadas: number;
    visitasClientes: number;
    actualizado: string | null;
    // Ficha reducida: empresa jurídica que SOLO aparece en contratos menores (no está en empresa_resumen).
    soloMenores?: boolean;
    condicionSunat?: string | null;
    distrito?: string | null;
    menores?: number;
    menoresEntidades?: number;
    menoresMonto?: number;
  };
  antecedentes: AntecedentePorTipo[];
  anual: AnioEmpresa[];
}

/** Una opción de filtro con cuántos la tienen (sobre todo lo de la empresa). */
export interface Faceta {
  valor: string | number;
  etiqueta?: string | null;
  n: number;
  /** Lo adjudicado (familias de proceso). */
  monto?: number;
}

export interface FacetasContratos {
  anios: Faceta[];
  entidades: Faceta[];
  objetos: Faceta[];
  familias: Faceta[];
  departamentos: Faceta[];
  como: { sola: number; consorcio: number };
  /**
   * Cuántos procesos tiene cada bandera. `inhabilitada`, `sancionada_antes`, `solo_despues` y `sin_sancion` son una
   * partición (suman todos); `solo_despues` y `sin_sancion` faltan en la API vieja.
   */
  banderas: Record<"inhabilitada" | "sancionada_antes" | "sancionada_despues" | "antecedentes" | "dudoso" | "sin", number> &
    Partial<Record<"solo_despues" | "sin_sancion", number>>;
  /** Cada tipo de antecedente del ganador y en cuántos de sus procesos aparece, para el desplegable por familia. */
  cruces: { con: number; alta: number; tipos: Record<string, number> };
}

export interface FacetasOrdenes {
  anios: Faceta[];
  entidades: Faceta[];
  departamentos: Faceta[];
  estados: Faceta[];
  tipos: { compra: number; servicio: number };
  dudosas: number;
}

export interface FacetasPostulaciones {
  resultado: { gano: number; perdio: number; sin: number };
  anios: Faceta[];
  objetos: Faceta[];
  entidades: Faceta[];
  /** Quién le ganó más veces (empresas con RUC). */
  ganadores: Faceta[];
}

export interface ContratoEmpresa {
  codigo: string;
  entidadRuc: string | null;
  entidad: string | null;
  departamento: string | null;
  objeto: string | null;
  tipoProceso: string | null;
  /** La familia del tipo de proceso: «Adjudicación simplificada», «Contratación directa»… */
  familia: string | null;
  nomenclatura: string | null;
  descripcion: string | null;
  fecha: string | null;
  items: number;
  monto: number | null;
  montoOtraMoneda: number | null;
  otraMoneda: string | null;
  /** Si la ganó en consorcio: su nombre. */
  consorcio: string | null;
  /** El monto parece mal cargado (posible error de CONOSCE): su motivo. No entra en las sumas. */
  dudoso: "adjudicado_20x" | "referencial_simbolico" | null;
  /** Para abrir la ficha del contrato, si el proceso está en el SEACE. */
  ocid: string | null;
  /** Los antecedentes de la empresa que pesan sobre ESTE proceso (casos_cruce), con su gravedad; sin las sanciones. */
  antecedentes: { tipo: string; severidad: Severidad; etiqueta: string }[];
  /**
   * Sus sanciones del Tribunal frente a la fecha de la buena pro: la inhabilitación que la cubría (si ganó estando
   * inhabilitada), cuántas tenía antes y cuándo terminó la última, cuántas recibió después. null si no tiene ninguna.
   */
  sancion: {
    alGanar: { tipo: string; desde: string | null; hasta: string | null; resolucion: string | null } | null;
    antes: number;
    antesHasta: string | null;
    despues: number;
    despuesDesde: string | null;
  } | null;
}

export interface OrdenEmpresa {
  fecha: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  departamento: string | null;
  numero: string | null;
  orden: string | null;
  tipoOrden: string | null;
  descripcion: string | null;
  monto: number | null;
  montoDudoso: number | null;
  dudosoMotivo: string | null;
  tipoContratacion: string | null;
  estado: string | null;
}

export interface ClienteEmpresa {
  entidadRuc: string;
  entidad: string | null;
  departamento: string | null;
  contratos: number;
  adjudicado: number;
  consorcio: boolean;
  ordenes: number;
  ordenado: number;
  dudosas: number;
  visitas: number;
  primera: string | null;
  ultima: string | null;
}

export interface PostulacionEmpresa {
  codigo: string;
  fecha: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  descripcion: string | null;
  objeto: string | null;
  consorcio: string | null;
  gano: boolean;
  ganadores: { ruc: string | null; nombre: string | null }[];
  monto: number | null;
}

export interface AntecedenteEmpresa {
  tipo: string;
  etiqueta: string;
  severidad: Severidad;
  ocid: string | null;
  fecha: string | null;
  montoSoles: number | null;
  detalle: Record<string, unknown>;
  socios: { nombre: string; rol: string | null; cargo?: string | null }[];
  visitas: Record<string, unknown>[];
  fuente: string;
  fuenteUrl: string | null;
  grupo: string | null;
  puntos: number;
  codigo: string | null;
  entidad: string | null;
}

/** Lo que una persona de la empresa es en el Estado, por su DNI (que no sale de la API): fase 2 del plan del 2026-10-27. */
export interface SocioEnElEstado {
  /** Locador: en cuántas entidades, cuánto cobró, su ficha y en cuántas de ellas le vende esta empresa. */
  locador: { entidades: number; monto: number; codigo: string | null; clientes: number } | null;
  autoridad: { cargo: string | null; vigente: boolean | null; desde: string | null; hasta: string | null } | null;
  candidaturas: number;
  aportes: { n: number; monto: number } | null;
}

/** Lo que un funcionario declaró en su DJI sobre la empresa (secciones 1 a 4): cargo, entidad y primer apellido. */
export interface DeclaracionDji {
  entidadRuc: string;
  entidad: string | null;
  /** 1 acciones, 2 poder, 3 directorio, 4 trabajó o asesoró. */
  seccion: number;
  apellido: string | null;
  cargo: string | null;
  desde: string | null;
  hasta: string | null;
  ejercicio: number | null;
  /** La empresa le vende (órdenes o contratos) a la entidad del funcionario. */
  leVende: boolean;
}

export interface SociosEmpresa {
  socios: { nombre: string; roles: string[]; desde: string | null; otrasEmpresas: number; enElEstado?: SocioEnElEstado | null }[];
  declaradaDji?: DeclaracionDji[];
  empresasSocias: { ruc: string | null; nombre: string; roles: string[]; desde: string | null }[];
  sociaDe: { ruc: string; nombre: string | null; roles: string[] }[];
  corte: string | null;
  vinculadas: {
    ruc: string;
    nombre: string | null;
    /** Le vende al Estado (está en el resumen de empresas). */
    vende: boolean;
    /** Cuántos tipos de antecedentes tiene, y cuántos registros graves. */
    antecedentes: number;
    graves: number;
    inhabilitada: string | null;
    monto: number;
    contratos: number;
    socios: { nombre: string; roles: string[]; rolesAlla: string[] }[];
  }[];
}

export interface VisitaEmpresa {
  fecha: string | null;
  entidad: string | null;
  /** Si la entidad visitada le adjudicó o le compró algo alguna vez. */
  entidadRuc: string | null;
  via: string;
  visitante: string | null;
  /** De quien recibió la visita, sólo su cargo (su nombre no se publica). */
  cargoFuncionario: string | null;
  area: string | null;
  motivo: string | null;
  lugar: string | null;
  entidadDeclarada: string | null;
  fuente: string | null;
  /** Lo primero que esa entidad le adjudicó o le compró después de la visita. */
  despues: string | null;
  diasDespues: number | null;
  despuesTipo: "contrato" | "consorcio" | "orden" | null;
  /** CUÁL fue: la orden (número, tipo, qué, cuánto) o el contrato (nomenclatura, código, su ficha si está en la base). */
  primero?: { numero: string | null; descripcion: string | null; monto: number | null; tipoOrden: string | null; codigo: string | null; ocid: string | null } | null;
  /** En los 90 días desde la visita (con la del mismo día): cuántas órdenes y contratos, y lo que suman las órdenes. */
  en90?: { ordenes: number; contratos: number; montoOrdenes: number | null } | null;
  /** Si esa entidad ya le había vendido antes de la visita. */
  antes?: boolean;
}

export interface Pagina<T> {
  total: number;
  page: number;
  size: number;
  data: T[];
}

// ─── Parámetros de la lista ─────────────────────────────────────────────────────────────────────

export const ORDENES_EMPRESAS = [
  { valor: "monto", etiqueta: "Más dinero recibido" },
  { valor: "contratos", etiqueta: "Más contratos" },
  { valor: "ordenes", etiqueta: "Más órdenes" },
  { valor: "reciente", etiqueta: "Más recientes" },
  { valor: "nombre", etiqueta: "Por nombre" },
] as const;

export const OBJETOS = ["Bien", "Servicio", "Obra", "Consultoría de Obra"] as const;
export const OBJETO_TEXTO: Record<string, string> = { Bien: "Bienes", Servicio: "Servicios", Obra: "Obras", "Consultoría de Obra": "Consultoría de obras" };

export interface FiltrosEmpresas {
  q?: string;
  antecedentes?: string;
  tipo?: string;
  departamento?: string;
  objeto?: string;
  inhabilitada?: string;
  visitas?: string;
  montoMin?: string;
  actividad?: string;
  vinculadas?: string;
  antiguedad?: string;
  clientes?: string;
  exito?: string;
  ultima?: string;
  dudoso?: string;
  entidad?: string;
  orden?: string;
  page?: number;
  size?: number;
}

export const MONTOS_MIN = [
  { valor: "100000", etiqueta: "Más de S/ 100 mil" },
  { valor: "1000000", etiqueta: "Más de S/ 1 millón" },
  { valor: "10000000", etiqueta: "Más de S/ 10 millones" },
  { valor: "100000000", etiqueta: "Más de S/ 100 millones" },
] as const;

export const ACTIVIDADES = [
  { valor: "contratos", etiqueta: "Ganó contratos" },
  { valor: "consorcios", etiqueta: "Ganó en consorcio" },
  { valor: "ordenes", etiqueta: "Sólo órdenes, sin contratos" },
  { valor: "solo_postula", etiqueta: "Sólo postuló, nunca ganó" },
] as const;

/**
 * Los filtros por tramos (los mismos de la API, `TRAMOS_EMPRESA`): cada opción con su nombre. Una empresa sin el dato
 * (sin fecha de alta en la SUNAT, con menos de 5 postulaciones) no cae en ninguno.
 */
export type TramoEmpresa = "antiguedad" | "clientes" | "exito" | "ultima";
export const TRAMOS_EMPRESA: Record<Exclude<TramoEmpresa, "ultima">, readonly { valor: string; etiqueta: string }[]> = {
  antiguedad: [
    { valor: "hasta1", etiqueta: "Menos de 1 año" },
    { valor: "1a2", etiqueta: "De 1 a 2 años" },
    { valor: "2a5", etiqueta: "De 2 a 5 años" },
    { valor: "mas5", etiqueta: "Más de 5 años" },
  ],
  clientes: [
    { valor: "1", etiqueta: "Una sola entidad" },
    { valor: "2a5", etiqueta: "De 2 a 5 entidades" },
    { valor: "6a20", etiqueta: "De 6 a 20 entidades" },
    { valor: "mas20", etiqueta: "Más de 20 entidades" },
  ],
  // Sólo entre las que postularon 5 veces o más (lo dice el nombre del filtro).
  exito: [
    { valor: "alto", etiqueta: "Gana 8 de cada 10 o más" },
    { valor: "bajo", etiqueta: "Gana menos de 1 de cada 10" },
  ],
};

/** La última venta, con los años escritos: este año, el anterior o antes (la API corta por el 1 de enero). */
export function ultimasVentas(anio: number): { valor: string; etiqueta: string }[] {
  return [
    { valor: "este", etiqueta: `En ${anio}` },
    { valor: "pasado", etiqueta: `En ${anio - 1}` },
    { valor: "antes", etiqueta: `Antes de ${anio - 1}` },
  ];
}
const ULTIMAS = ["este", "pasado", "antes"];

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** Lee de la URL los filtros de la lista, validados como la API. */
export function filtrosEmpresasDeUrl(sp: Busqueda): FiltrosEmpresas {
  const antecedentes = uno(sp?.antecedentes);
  const tipo = uno(sp?.tipo);
  const objeto = uno(sp?.objeto);
  const orden = uno(sp?.orden);
  const q = uno(sp?.q)?.slice(0, 80);
  return {
    q: q && q.length >= 2 ? q : undefined,
    antecedentes: antecedentes && ["con", "grave", "media", "sin"].includes(antecedentes) ? antecedentes : undefined,
    tipo: tipo && /^[a-z_]{2,40}$/.test(tipo) ? tipo : undefined,
    departamento: uno(sp?.departamento)?.slice(0, 40),
    objeto: objeto && (OBJETOS as readonly string[]).includes(objeto) ? objeto : undefined,
    inhabilitada: uno(sp?.inhabilitada) === "si" ? "si" : undefined,
    visitas: ["si", "clientes"].includes(uno(sp?.visitas) ?? "") ? uno(sp?.visitas) : undefined,
    montoMin: MONTOS_MIN.some((m) => m.valor === uno(sp?.montoMin)) ? uno(sp?.montoMin) : undefined,
    actividad: ACTIVIDADES.some((m) => m.valor === uno(sp?.actividad)) ? uno(sp?.actividad) : undefined,
    vinculadas: uno(sp?.vinculadas) === "si" ? "si" : undefined,
    antiguedad: TRAMOS_EMPRESA.antiguedad.some((t) => t.valor === uno(sp?.antiguedad)) ? uno(sp?.antiguedad) : undefined,
    clientes: TRAMOS_EMPRESA.clientes.some((t) => t.valor === uno(sp?.clientes)) ? uno(sp?.clientes) : undefined,
    exito: TRAMOS_EMPRESA.exito.some((t) => t.valor === uno(sp?.exito)) ? uno(sp?.exito) : undefined,
    ultima: ULTIMAS.includes(uno(sp?.ultima) ?? "") ? uno(sp?.ultima) : undefined,
    dudoso: uno(sp?.dudoso) === "si" ? "si" : undefined,
    entidad: /^\d{11}$/.test(uno(sp?.entidad) ?? "") ? uno(sp?.entidad) : undefined,
    orden: orden && ORDENES_EMPRESAS.some((o) => o.valor === orden) ? orden : undefined,
    page: Math.max(1, Number(uno(sp?.page)) || 1),
  };
}

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

export const esRucEmpresa = (ruc: string) => /^20\d{9}$/.test(ruc);

export const getEmpresas = (f: FiltrosEmpresas) => leer<PaginaEmpresas>(`/empresas?${consulta({ ...f })}`);
export const getFichaEmpresa = (ruc: string) => (esRucEmpresa(ruc) ? leer<FichaEmpresa>(`/empresas/${ruc}`) : Promise.resolve(null));

export type FiltrosContratosEmpresa = { q?: string; anio?: number; entidad?: string; como?: string; objeto?: string; familia?: string; departamento?: string; bandera?: string; dudoso?: string; cruce?: string; orden?: string; page?: number; size?: number };
export type FiltrosOrdenesEmpresa = { q?: string; anio?: number; entidad?: string; departamento?: string; tipo?: string; estado?: string; dudosa?: string; orden?: string; page?: number; size?: number };
export type FiltrosPostulacionesEmpresa = { q?: string; resultado?: string; anio?: number; objeto?: string; entidad?: string; ganador?: string; orden?: string; page?: number; size?: number };

export function getContratosEmpresa(ruc: string, f: FiltrosContratosEmpresa) {
  return esRucEmpresa(ruc) ? leer<Pagina<ContratoEmpresa> & { facetas: FacetasContratos | null }>(`/empresas/${ruc}/contratos?${consulta(f)}`) : Promise.resolve(null);
}
export function getOrdenesEmpresa(ruc: string, f: FiltrosOrdenesEmpresa) {
  return esRucEmpresa(ruc) ? leer<Pagina<OrdenEmpresa> & { facetas: FacetasOrdenes | null }>(`/empresas/${ruc}/ordenes?${consulta(f)}`) : Promise.resolve(null);
}
export function getPostulacionesEmpresa(ruc: string, f: FiltrosPostulacionesEmpresa) {
  return esRucEmpresa(ruc)
    ? leer<Pagina<PostulacionEmpresa> & { ganadas: number; facetas: FacetasPostulaciones | null }>(`/empresas/${ruc}/postulaciones?${consulta(f)}`)
    : Promise.resolve(null);
}
export const getClientesEmpresa = (ruc: string) =>
  esRucEmpresa(ruc) ? leer<{ total: number; data: ClienteEmpresa[] }>(`/empresas/${ruc}/clientes`) : Promise.resolve(null);
export const getAntecedentesEmpresa = (ruc: string) =>
  esRucEmpresa(ruc) ? leer<{ total: number; data: AntecedenteEmpresa[] }>(`/empresas/${ruc}/antecedentes`) : Promise.resolve(null);
export const getSociosEmpresa = (ruc: string) => (esRucEmpresa(ruc) ? leer<SociosEmpresa>(`/empresas/${ruc}/socios`) : Promise.resolve(null));
export const getVisitasEmpresa = (ruc: string) =>
  esRucEmpresa(ruc) ? leer<{ total: number; visitas: VisitaEmpresa[]; hasta?: string | null }>(`/empresas/${ruc}/visitas`) : Promise.resolve(null);

/**
 * Las etiquetas cortas de un antecedente cuando se habla de la empresa y no de un proceso: «Sancionado antes» (de un
 * proceso) es aquí «Sancionada por el Tribunal». Lo demás, como en lib/cruces.
 */
export const CORTO_EMPRESA: Record<string, string> = {
  sancion: "Sancionada por el Tribunal",
  sancion_vigente: "Ganó inhabilitada",
};

// ─── Pestañas de la ficha ───────────────────────────────────────────────────────────────────────

/**
 * Las seis pestañas de la ficha (2026-10-26: eran nueve, una por lista, y a 1366 px «Visitas» quedaba fuera de la barra).
 * «Ventas al Estado» y «Su gente» juntan varias listas: cada una es una vista (`?vista=`) dentro de la pestaña.
 */
// «obras»: las obras públicas que construye o supervisa (INFOBRAS, migración 160); va sólo si tiene alguna.
export const PESTANAS_EMPRESA = ["inicio", "historia", "ventas", "clientes", "postulaciones", "antecedentes", "gente", "obras"] as const;
export type PestanaEmpresa = (typeof PESTANAS_EMPRESA)[number];
/** Las listas de «Ventas al Estado» y de «Su gente»; la primera de cada una va sin parámetro. */
export const VISTAS_VENTAS = ["contratos", "ordenes", "menores"] as const;
export const VISTAS_GENTE = ["socios", "visitas"] as const;
export type VistaEmpresa = (typeof VISTAS_VENTAS)[number] | (typeof VISTAS_GENTE)[number];
/** Adónde puede llevar un enlace: una pestaña o una de sus listas. */
export type SeccionEmpresa = PestanaEmpresa | VistaEmpresa;
/** El parámetro de la lista abierta dentro de una pestaña. */
export const P_VISTA = "vista";

const DESTINO: Record<SeccionEmpresa, { seccion: PestanaEmpresa; vista?: VistaEmpresa }> = {
  inicio: { seccion: "inicio" },
  historia: { seccion: "historia" },
  ventas: { seccion: "ventas" },
  contratos: { seccion: "ventas" },
  ordenes: { seccion: "ventas", vista: "ordenes" },
  menores: { seccion: "ventas", vista: "menores" },
  clientes: { seccion: "clientes" },
  postulaciones: { seccion: "postulaciones" },
  antecedentes: { seccion: "antecedentes" },
  gente: { seccion: "gente" },
  socios: { seccion: "gente" },
  visitas: { seccion: "gente", vista: "visitas" },
  obras: { seccion: "obras" },
};

/** La pestaña y la vista de un destino (`ordenes` → Ventas al Estado, vista Órdenes). */
export const destinoEmpresa = (s: SeccionEmpresa) => DESTINO[s];

/**
 * Los `?seccion=` de antes de agrupar las pestañas, que ya no son una pestaña: los enlaces guardados o compartidos
 * (`?seccion=socios`, `?seccion=ordenes`…) se redirigen a su pestaña y su vista. Los demás valores no cambiaron.
 */
export const SECCIONES_VIEJAS: readonly SeccionEmpresa[] = ["contratos", "ordenes", "menores", "socios", "visitas"];

/** La pestaña y la vista de una lista, como parámetros de su `Listado`: filtrar o paginar no la cambian de lugar. */
export function parametrosSeccion(s: SeccionEmpresa): Record<string, string> {
  const d = DESTINO[s];
  return d.seccion === "inicio" ? {} : { seccion: d.seccion, ...(d.vista ? { [P_VISTA]: d.vista } : {}) };
}

/** La ficha de una empresa: /empresa/<RUC> (como /entidad/<RUC>), en una pestaña o en una de sus listas. */
export function rutaEmpresa(ruc: string, seccion?: SeccionEmpresa, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams(seccion ? parametrosSeccion(seccion) : {});
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const qs = q.toString();
  return `/empresa/${ruc}${qs ? `?${qs}` : ""}`;
}

/** Palabras que no identifican a una empresa (la forma societaria, rubros frecuentes): no cuentan como «en común». */
const GENERICAS = new Set(["SOCIEDAD", "ANONIMA", "CERRADA", "ABIERTA", "COMERCIAL", "RESPONSABILIDAD", "LIMITADA", "EMPRESA", "INDIVIDUAL",
  "EIRL", "PERU", "SERVICIOS", "GENERALES", "CONTRATISTAS", "INVERSIONES", "CORPORACION"]);
const palabrasNombre = (t: string) =>
  t.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !GENERICAS.has(w));

/**
 * El nombre corto de una empresa, si su razón social lo trae: el registro publica muchas como «RAZÓN SOCIAL - NOMBRE
 * CORTO» («GRUPO SANTA FE SOCIEDAD ANONIMA CERRADA - GRUPO SANTA FE S.A.C.»), que en el celular ocupaba cinco renglones
 * de título. Sólo si lo de después del guion es más corto y comparte una palabra propia con lo de antes: una sigla
 * suelta («Y.I. E.I.R.L.») o un nombre distinto («… - HIDRANDINA») no se toman por nombre corto. `null` si no lo trae.
 */
export function nombreCortoEmpresa(nombre: string | null | undefined): { corto: string; razonSocial: string } | null {
  if (!nombre) return null;
  const i = nombre.lastIndexOf(" - ");
  if (i <= 0) return null;
  const razonSocial = nombre.slice(0, i).trim();
  const corto = nombre.slice(i + 3).trim();
  if (corto.length < 3 || corto.length >= razonSocial.length) return null;
  const propias = new Set(palabrasNombre(razonSocial));
  return palabrasNombre(corto).some((w) => propias.has(w)) ? { corto, razonSocial } : null;
}

/** El enlace a la ficha de un proveedor, si es una empresa (RUC 20); null para una persona o un consorcio sin RUC. */
export const enlaceProveedor = (ruc: string | null | undefined) => (ruc && esRucEmpresa(ruc) ? rutaEmpresa(ruc) : null);
