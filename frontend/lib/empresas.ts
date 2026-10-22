/**
 * Empresas (GET /empresas*, migración 109): cada empresa (RUC 20) que ganó, postuló o recibió órdenes del Estado, con lo
 * que le adjudicaron y le compraron, su gente en el RNP, sus visitas a entidades y su PUNTAJE DE ANTECEDENTES (0 a 100):
 * cuánto pesa lo que otros registros públicos dicen de ella, con su desglose. No es una acusación.
 *
 * Las personas (socios, representantes, visitantes, funcionarios) llegan con un apellido tapado y sin documento. Las
 * personas naturales que le venden al Estado (RUC 10) no están acá: van en /app/personas.
 *
 * Los GET devuelven `null` si la API no responde: quien llama no dibuja lo que no pudo leer.
 */
import { API_BASE } from "./api-client";

export type Severidad = "alta" | "media" | "baja";
export type Nivel = "alto" | "medio" | "bajo" | "sin";

export const NIVEL: Record<Nivel, { corto: string; titulo: string; explica: string; variante: "crimson" | "amber" | "neutral" | "ink" }> = {
  alto: { corto: "Alto", titulo: "Muchos antecedentes", explica: "50 puntos o más: varios registros públicos pesan sobre la empresa.", variante: "crimson" },
  medio: { corto: "Medio", titulo: "Antecedentes para revisar", explica: "De 20 a 49 puntos.", variante: "amber" },
  bajo: { corto: "Bajo", titulo: "Pocos antecedentes", explica: "De 1 a 19 puntos.", variante: "neutral" },
  sin: { corto: "Sin antecedentes", titulo: "Sin antecedentes", explica: "Ningún otro registro cruzado la nombra.", variante: "neutral" },
};

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
  puntaje: number;
  nivel: Nivel;
  tipos: string[];
  nAlta: number;
  nMedia: number;
  nBaja: number;
  /** Sus antecedentes, de los que más pesan a los que menos (para la celda de banderas). */
  cruces: { tipo: string; severidad: Severidad }[];
}

export interface ResumenEmpresas {
  empresas: number;
  adjMonto: number;
  consMonto: number;
  ordMonto: number;
  inhabilitadas: number;
  conVisitas: number;
  dudosos: { procesos: number; monto: number; ordenes: number; montoOrdenes: number };
  porNivel: Partial<Record<Nivel, number>>;
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
}

export interface GrupoPuntaje {
  grupo: string;
  titulo: string;
  explica: string | null;
  puntos: number;
  tope: number;
  cruces: { tipo: string; severidad: Severidad; n: number; puntos: number; etiqueta: string }[];
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
  };
  antecedentes: GrupoPuntaje[];
  anual: AnioEmpresa[];
}

export interface ReglasPuntaje {
  niveles: { nivel: Nivel; desde: number }[];
  grupos: { grupo: string; titulo: string; explica: string; tope: number; reglas: { tipo: string; severidad: Severidad; puntos: number; etiqueta: string }[] }[];
}

export interface ContratoEmpresa {
  codigo: string;
  entidadRuc: string | null;
  entidad: string | null;
  departamento: string | null;
  objeto: string | null;
  tipoProceso: string | null;
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

export interface SociosEmpresa {
  socios: { nombre: string; roles: string[]; desde: string | null; otrasEmpresas: number }[];
  empresasSocias: { ruc: string | null; nombre: string; roles: string[]; desde: string | null }[];
  sociaDe: { ruc: string; nombre: string | null; puntaje: number | null; nivel: Nivel | null; roles: string[] }[];
  corte: string | null;
  vinculadas: {
    ruc: string;
    nombre: string | null;
    puntaje: number | null;
    nivel: Nivel | null;
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
  funcionario: string | null;
  cargoFuncionario: string | null;
  area: string | null;
  motivo: string | null;
  lugar: string | null;
  entidadDeclarada: string | null;
  fuente: string | null;
  /** Lo primero que esa entidad le adjudicó o le compró después de la visita. */
  despues: string | null;
  diasDespues: number | null;
  despuesTipo: "contrato" | "orden" | null;
}

export interface Pagina<T> {
  total: number;
  page: number;
  size: number;
  data: T[];
}

// ─── Parámetros de la lista ─────────────────────────────────────────────────────────────────────

export const ORDENES_EMPRESAS = [
  { valor: "puntaje", etiqueta: "Más antecedentes" },
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
  nivel?: string;
  tipo?: string;
  departamento?: string;
  objeto?: string;
  inhabilitada?: string;
  visitas?: string;
  orden?: string;
  page?: number;
  size?: number;
}

type Busqueda = Record<string, string | string[] | undefined> | undefined;
const uno = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Lee de la URL los filtros de la lista, validados como la API. */
export function filtrosEmpresasDeUrl(sp: Busqueda): FiltrosEmpresas {
  const nivel = uno(sp?.nivel);
  const tipo = uno(sp?.tipo);
  const objeto = uno(sp?.objeto);
  const orden = uno(sp?.orden);
  const q = uno(sp?.q)?.slice(0, 80);
  return {
    q: q && q.length >= 2 ? q : undefined,
    nivel: nivel && ["alto", "medio", "bajo", "sin", "con"].includes(nivel) ? nivel : undefined,
    tipo: tipo && /^[a-z_]{2,40}$/.test(tipo) ? tipo : undefined,
    departamento: uno(sp?.departamento)?.slice(0, 40),
    objeto: objeto && (OBJETOS as readonly string[]).includes(objeto) ? objeto : undefined,
    inhabilitada: uno(sp?.inhabilitada) === "si" ? "si" : undefined,
    visitas: uno(sp?.visitas) === "si" ? "si" : undefined,
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
export const getReglasPuntaje = () => leer<ReglasPuntaje>(`/empresas/reglas`, 3600);
export const getFichaEmpresa = (ruc: string) => (esRucEmpresa(ruc) ? leer<FichaEmpresa>(`/empresas/${ruc}`) : Promise.resolve(null));

export function getContratosEmpresa(ruc: string, f: { q?: string; anio?: number; entidad?: string; como?: string; page?: number; size?: number }) {
  return esRucEmpresa(ruc) ? leer<Pagina<ContratoEmpresa>>(`/empresas/${ruc}/contratos?${consulta(f)}`) : Promise.resolve(null);
}
export function getOrdenesEmpresa(ruc: string, f: { q?: string; anio?: number; entidad?: string; tipo?: string; dudosa?: string; page?: number; size?: number }) {
  return esRucEmpresa(ruc) ? leer<Pagina<OrdenEmpresa>>(`/empresas/${ruc}/ordenes?${consulta(f)}`) : Promise.resolve(null);
}
export function getPostulacionesEmpresa(ruc: string, f: { q?: string; resultado?: string; page?: number; size?: number }) {
  return esRucEmpresa(ruc) ? leer<Pagina<PostulacionEmpresa> & { ganadas: number }>(`/empresas/${ruc}/postulaciones?${consulta(f)}`) : Promise.resolve(null);
}
export const getClientesEmpresa = (ruc: string) =>
  esRucEmpresa(ruc) ? leer<{ total: number; data: ClienteEmpresa[] }>(`/empresas/${ruc}/clientes`) : Promise.resolve(null);
export const getAntecedentesEmpresa = (ruc: string) =>
  esRucEmpresa(ruc) ? leer<{ total: number; data: AntecedenteEmpresa[] }>(`/empresas/${ruc}/antecedentes`) : Promise.resolve(null);
export const getSociosEmpresa = (ruc: string) => (esRucEmpresa(ruc) ? leer<SociosEmpresa>(`/empresas/${ruc}/socios`) : Promise.resolve(null));
export const getVisitasEmpresa = (ruc: string) =>
  esRucEmpresa(ruc) ? leer<{ total: number; visitas: VisitaEmpresa[] }>(`/empresas/${ruc}/visitas`) : Promise.resolve(null);

/**
 * Las etiquetas cortas de un antecedente cuando se habla de la empresa y no de un proceso: «Sancionado antes» (de un
 * proceso) es aquí «Sancionada por el Tribunal». Lo demás, como en lib/cruces.
 */
export const CORTO_EMPRESA: Record<string, string> = {
  sancion: "Sancionada por el Tribunal",
  sancion_vigente: "Ganó inhabilitada",
};

export type SeccionEmpresa = "inicio" | "contratos" | "ordenes" | "clientes" | "postulaciones" | "antecedentes" | "socios" | "visitas";

/** La ficha de una empresa: /empresa/<RUC> (como /entidad/<RUC>). */
export function rutaEmpresa(ruc: string, seccion?: SeccionEmpresa, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  if (seccion && seccion !== "inicio") q.set("seccion", seccion);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const qs = q.toString();
  return `/empresa/${ruc}${qs ? `?${qs}` : ""}`;
}

/** El enlace a la ficha de un proveedor, si es una empresa (RUC 20); null para una persona o un consorcio sin RUC. */
export const enlaceProveedor = (ruc: string | null | undefined) => (ruc && esRucEmpresa(ruc) ? rutaEmpresa(ruc) : null);
