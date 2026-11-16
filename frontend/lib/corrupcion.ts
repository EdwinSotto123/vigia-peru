/**
 * Casos de corrupción (GET /corrupcion/*, migración 90, docs/CORRUPCION.md): informes de control de la Contraloría
 * (responsabilidad PRESUNTA) y casos de la Procuraduría Anticorrupción (sentencia firme y en trámite), por entidad,
 * región y partido. Lo comprobado y lo presunto nunca se suman.
 *
 * Cada respuesta trae los conteos de TODOS los informes y una página de la lista (filtrable por tipo): la web muestra
 * la lista entera, paginada.
 */
import { API_BASE, baseApiNavegador } from "./api-client";

/** Los montos de la Ficha Resumen: el auditado y el examinado (auditoría) o el del hecho revisado (control específico). */
export interface MontosInforme {
  auditado: number | null;
  examinado: number | null;
  objeto: number | null;
}

/** Un funcionario comprendido en un informe: su nombre llega con un apellido tapado (publicar() de la API). */
export interface ImplicadoInforme {
  nombre: string;
  /** penal, civil, administrativa_entidad, administrativa_pas, administrativa: siempre PRESUNTA. */
  responsabilidades: string[];
}

/**
 * Lo que dice la Ficha Resumen de un informe, en corto (la lista de /corrupcion/*): el texto de cada observación llega
 * recortado a 300 caracteres y su tema ya en palabras («Pagos y adelantos»). El detalle entero, en GET /informes-control/:codigo.
 */
export interface FichaInformeCorta {
  objetivo: string | null;
  tipoServicio: string | null;
  montos: MontosInforme;
  observaciones: { n: number; texto: string; tema: string | null; perjuicio: number | null }[];
  recomendaciones: number;
  /** null: no se sabe; []: la ficha no nombra a nadie. */
  implicados: ImplicadoInforme[] | null;
}

export interface InformeControl {
  /** El código de la Contraloría (2025CPO131500011): abre el detalle en GET /informes-control/:codigo. */
  codigo: string;
  numero: string;
  titulo: string | null;
  fecha: string | null;
  responsabilidades: string[];
  funcionarios: number | null;
  urlPdf: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  /** null mientras Vigía no lea su Ficha Resumen (se cargan de a pocos). */
  ficha?: FichaInformeCorta | null;
}

export type TipoInforme = "penal" | "civil" | "administrativa";

export interface PaginaInformes {
  page: number;
  size: number;
  tipo: TipoInforme | null;
  /** Cuántos cumplen el filtro (todas las páginas). */
  total: number;
  filas: InformeControl[];
}

/** Lo observado de un tema (migración 314): cuántas observaciones leídas y cuánto perjuicio cuantifican, en soles. */
export interface TemaObservado {
  tema: string;
  temaTexto: string;
  observaciones: number;
  informes: number;
  perjuicioPen: number;
}

/** Lo que la Contraloría observó en un alcance (entidad, región, partido): por tema, con los contratos de Vigía nombrados. */
export interface ObservadoControl {
  observaciones: number;
  perjuicioPen: number;
  contratos: number;
  porTema: TemaObservado[];
}

/** GET /informes-control/resumen: el mapa nacional de lo observado (con `tema`, el ranking de ese tema). */
export interface ResumenControl {
  tema: string | null;
  total: { informes: number; leidos: number; observaciones: number; conPerjuicio: number; perjuicioPen: number; perjuicioUsd: number; contratos: number } | null;
  porTema: TemaObservado[];
  porAnio: { anio: number; informes: number; observaciones: number; perjuicioPen: number }[];
  entidades: {
    ruc: string;
    entidad: string | null;
    departamento: string | null;
    informes: number;
    observaciones: number;
    perjuicioPen: number;
    penal: number;
    contratos: number;
    temaPrincipal: string;
    temaPrincipalTexto: string;
  }[];
  nota: string;
}

export const TEMAS_OBSERVACION = ["seleccion_contratacion", "ejecucion_contractual", "pagos_adelantos", "personal_planillas", "bienes_almacen", "presupuesto_tesoreria", "otros"];

/** El mapa nacional (servidor); `tema` sólo si es uno de la lista. null si la API no responde o la base no lo tiene. */
export async function getResumenControl(tema?: string | null): Promise<ResumenControl | null> {
  const t = tema && TEMAS_OBSERVACION.includes(tema) ? tema : null;
  try {
    const r = await fetch(`${API_BASE}/informes-control/resumen${t ? `?tema=${t}` : ""}`, { next: { revalidate: 3600 } } as RequestInit);
    return r.ok ? ((await r.json()) as ResumenControl) : null;
  } catch {
    return null;
  }
}

export interface InformesControl {
  total: number;
  penal: number;
  civil: number;
  administrativa: number;
  funcionarios: number;
  entidades: number;
  desde: string | null;
  hasta: string | null;
  /** Lo observado por tema (migración 314); null mientras ninguna ficha del alcance tenga sus observaciones leídas. */
  observado?: ObservadoControl | null;
  pagina: PaginaInformes;
}

export interface CasosProcuraduria {
  corte: string;
  en_tramite: number;
  en_ejecucion: number;
  sentencias: number | null;
  reparacion_civil: number | null;
  casos_nuevos: number | null;
  url_fuente: string | null;
  sedes: { sede: string; en_tramite: number; en_ejecucion: number; sentencias?: number | null; reparacion_civil?: number | null }[];
}

export interface Corrupcion {
  informes: InformesControl;
  departamento?: string | null;
  procuraduria?: CasosProcuraduria | null;
  /** Sólo en la de un partido: el mandato. */
  desde?: string;
  hasta?: string;
}

/** Filas por página de la tabla de informes. */
export const TAM_INFORMES = 10;

/** La ruta de la API (sin la página ni el tipo): la usa la tabla para pedir las páginas siguientes. */
export const rutaCorrupcion = {
  entidad: (ruc: string) => `/corrupcion/entidad/${ruc}`,
  region: (ubigeo: string) => `/corrupcion/region/${ubigeo}`,
  partido: (clave: string, anio: number) => `/corrupcion/partido/${encodeURIComponent(clave)}?anio=${anio}`,
};

/** Una página: `ruta` de rutaCorrupcion, más la página y el tipo. */
export function urlCorrupcion(ruta: string, page = 1, tipo: TipoInforme | null = null, q: string | null = null): string {
  const [base, qs] = ruta.split("?");
  const p = new URLSearchParams(qs);
  p.set("page", String(page));
  p.set("size", String(TAM_INFORMES));
  if (tipo) p.set("tipo", tipo);
  if (q && q.trim().length >= 2) p.set("q", q.trim());
  return `${base}?${p.toString()}`;
}

async function leer(ruta: string, base = API_BASE): Promise<Corrupcion | null> {
  try {
    const r = await fetch(`${base}${urlCorrupcion(ruta)}`, { next: { revalidate: 3600 } } as RequestInit);
    return r.ok ? ((await r.json()) as Corrupcion) : null;
  } catch {
    return null;
  }
}

export const getCorrupcionEntidad = (ruc: string) => leer(rutaCorrupcion.entidad(ruc));
export const getCorrupcionPartido = (clave: string, anio: number) => leer(rutaCorrupcion.partido(clave, anio));
/** Desde el navegador (el panel de la región es de cliente). */
export const getCorrupcionRegion = (ubigeo: string) => leer(rutaCorrupcion.region(ubigeo), baseApiNavegador());

/** Otra página, otro filtro u otra búsqueda (asunto, número o entidad), desde el navegador. */
export async function paginaCorrupcion(ruta: string, page: number, tipo: TipoInforme | null, q: string | null = null): Promise<PaginaInformes | null> {
  try {
    const r = await fetch(`${baseApiNavegador()}${urlCorrupcion(ruta, page, tipo, q)}`);
    return r.ok ? ((await r.json()) as Corrupcion).informes.pagina : null;
  } catch {
    return null;
  }
}

/** "penal" → "Penal", etc. (los tipos del buscador de la Contraloría). */
export const TIPO_RESPONSABILIDAD: Record<string, string> = {
  penal: "Penal",
  civil: "Civil",
  administrativa_entidad: "Administrativa",
  administrativa_pas: "Sanción administrativa",
  administrativa: "Administrativa",
};

/** Qué pasa con cada responsabilidad presunta: a quién la deriva la Contraloría. Para la ayuda del panel de un informe. */
export const QUE_ES_RESPONSABILIDAD: { tipo: string; texto: string }[] = [
  { tipo: "penal", texto: "Un posible delito. La Contraloría lo deriva y la Fiscalía decide si investiga." },
  { tipo: "civil", texto: "Un perjuicio económico que se pide reparar. La Procuraduría puede demandarlo ante un juez." },
  { tipo: "administrativa_entidad", texto: "Una falta en la función. La ve la propia entidad, en su proceso disciplinario." },
  { tipo: "administrativa_pas", texto: "Una falta más grave. La ve la Contraloría, en su procedimiento sancionador." },
];

/** Lo que se dice siempre junto a un informe con responsabilidad: la del aviso de la API. */
export const AVISO_PRESUNTA = "Responsabilidad presunta: la Contraloría la señala y la deriva; no es una condena.";

// ─── Lo que encontró la Contraloría: el detalle de un informe y su buscador (GET /informes-control/*) ───────────────

/** Una observación de la Ficha Resumen, entera, con lo que le puso la lectura de IA (tema, perjuicio y referencias). */
export interface ObservacionInforme {
  n: number;
  texto: string;
  /** La clave del tema (pagos_adelantos…): null mientras la IA no la lea. */
  tema: string | null;
  temaTexto: string | null;
  perjuicio: number | null;
  moneda: "PEN" | "USD" | null;
  normas: string[];
  obras: { nombre: string; cui: string | null }[];
  contratos: string[];
  procesos: string[];
  /** Sólo RUC 15, 17 o 20 (nunca un RUC 10: la API los descarta). */
  empresas: { razon_social: string; ruc: string | null }[];
  /** Los contratos de Vigía que la observación nombra (migración 313): por la nomenclatura del proceso o por el CUI. */
  enVigia?: { ocid: string; nomenclatura: string | null; via: "codigo" | "sigla" | "unico" | "cui"; cui: string | null; objeto: string | null }[];
}

/** GET /informes-control/:codigo: el informe con su ficha leída (si la hay) y sus funcionarios comprendidos. */
export interface DetalleInformeControl {
  codigo: string;
  numero: string | null;
  titulo: string | null;
  /** La modalidad del buscador de la Contraloría, en mayúsculas («AUDITORIA CUMPLIMIENTO»). */
  modalidad: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  responsabilidades: string[];
  funcionarios: number | null;
  fecha: string | null;
  urlResumen: string | null;
  urlPdf: string | null;
  objetivo: string | null;
  tipoServicio: string | null;
  tipoServicioTexto: string | null;
  unidadEmisora: string | null;
  montos: MontosInforme;
  /** «Observaciones» o, en un control específico, «Argumentos de hecho (irregularidades advertidas)». */
  observacionesRotulo: string | null;
  observaciones: ObservacionInforme[];
  recomendaciones: number;
  implicados: ImplicadoInforme[] | null;
  /** Cuándo leyó la IA sus observaciones (null: sólo el lector del formulario). */
  leidoIa: string | null;
  /** true si Vigía ya leyó su Ficha Resumen. */
  ficha: boolean;
  aviso: string;
}

/** Un resultado del buscador: UNA observación (o el objetivo, con tema «objetivo») y los datos de su informe. */
export interface ResultadoControl {
  codigo: string;
  numero: string | null;
  titulo: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  fecha: string | null;
  modalidad: string | null;
  responsabilidades: string[];
  observacion: string;
  tema: string | null;
  temaTexto: string | null;
  score: number;
  urlFicha: string | null;
  urlInforme: string | null;
}

export interface BusquedaControl {
  q: string;
  /** `texto`: esta vez sólo por palabras (el buscador por sentido no respondió). */
  modo: "hibrido" | "texto";
  total: number;
  resultados: ResultadoControl[];
}

/** Cuántas observaciones se piden de una vez (el tope de la API): se pagina en el navegador, sin otro pedido. */
export const N_BUSQUEDA_CONTROL = 30;

export type RespuestaBusquedaControl =
  | { tipo: "ok"; datos: BusquedaControl }
  /** Demasiadas búsquedas seguidas desde esta conexión (20 por minuto): cuántos segundos esperar. */
  | { tipo: "tope"; reintentarEn: number }
  | { tipo: "error"; motivo: "no_disponible" | "lenta" | "red" };

/**
 * Busca en lo que encontró la Contraloría (GET /informes-control/buscar), desde el navegador. `entidad`: el RUC de una
 * entidad para buscar sólo en sus informes. Un pedido cancelado (`signal`) tira su AbortError: quien llama lo ignora.
 */
export async function buscarEnControl(q: string, entidad: string | null, signal?: AbortSignal): Promise<RespuestaBusquedaControl> {
  const p = new URLSearchParams({ q, n: String(N_BUSQUEDA_CONTROL) });
  if (entidad) p.set("entidad", entidad);
  let r: Response;
  try {
    r = await fetch(`${baseApiNavegador()}/informes-control/buscar?${p.toString()}`, { signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return { tipo: "error", motivo: "red" };
  }
  if (r.status === 429) {
    const cuerpo = (await r.json().catch(() => null)) as { reintentarEn?: number } | null;
    const segundos = Number(cuerpo?.reintentarEn ?? r.headers.get("Retry-After") ?? 60);
    return { tipo: "tope", reintentarEn: Number.isFinite(segundos) && segundos > 0 ? Math.min(segundos, 300) : 60 };
  }
  if (r.status === 503) return { tipo: "error", motivo: "no_disponible" };
  if (r.status === 504) return { tipo: "error", motivo: "lenta" };
  if (!r.ok) return { tipo: "error", motivo: "red" };
  try {
    const d = (await r.json()) as BusquedaControl;
    return { tipo: "ok", datos: { q: d.q, modo: d.modo, total: d.total, resultados: Array.isArray(d.resultados) ? d.resultados : [] } };
  } catch {
    return { tipo: "error", motivo: "red" };
  }
}

/** El detalle de un informe, desde el navegador (lo pide su panel al abrirse). null: la Contraloría no tiene ese código. */
export async function pedirDetalleInforme(codigo: string): Promise<DetalleInformeControl | null> {
  const r = await fetch(`${baseApiNavegador()}/informes-control/${encodeURIComponent(codigo)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`informe ${r.status}`);
  return (await r.json()) as DetalleInformeControl;
}

/**
 * El tipo de servicio en corto, para una fila: «Servicio de Control Específico a Hechos con Presunta Irregularidad» →
 * «Control específico». Lo que no se reconoce va como oración.
 */
export function tipoServicioCorto(t: string | null | undefined): string | null {
  const s = (t ?? "").trim();
  if (!s) return null;
  const conocidos: [RegExp, string][] = [
    [/control espec[ií]fico/i, "Control específico"],
    [/auditor[ií]a\s+(de\s+)?cumplimiento/i, "Auditoría de cumplimiento"],
    [/auditor[ií]a\s+financiera/i, "Auditoría financiera"],
    [/auditor[ií]a\s+de\s+desempe[ñn]o/i, "Auditoría de desempeño"],
    [/examen especial/i, "Examen especial"],
    [/control concurrente/i, "Control concurrente"],
    [/visita de control/i, "Visita de control"],
    [/orientaci[oó]n de oficio/i, "Orientación de oficio"],
  ];
  const conocido = conocidos.find(([re]) => re.test(s));
  if (conocido) return conocido[1];
  const minus = s.toLocaleLowerCase("es");
  return minus.charAt(0).toLocaleUpperCase("es") + minus.slice(1);
}

/**
 * Lo que una ficha corta permite contar en una fila: sus observaciones y sus funcionarios comprendidos (los de la ficha o,
 * sin ella, los que cuenta el buscador de la Contraloría). El perjuicio no: la ficha corta no trae su moneda.
 */
export function cuentasDeFicha(i: Pick<InformeControl, "ficha" | "funcionarios">): { observaciones: number; comprendidos: number } {
  const f = i.ficha;
  return {
    observaciones: f?.observaciones.length ?? 0,
    comprendidos: f?.implicados?.length || i.funcionarios || 0,
  };
}

/**
 * El informe que cita el detalle de una bandera (cruces_proveedor.detalle), como lo pide el panel del informe
 * (components/control/InformeEnPanel.tsx). null sin código. Vive aquí y no en ese archivo porque lo llama un Server
 * Component (contratos/CrucesProveedor.tsx): una función exportada desde un módulo «use client» no se puede llamar en el
 * servidor (la ficha del contrato se caía al dibujar la bandera, 2026-11-16).
 */
export function informeDeDetalle(d: Record<string, unknown>): {
  codigo: string;
  numero: string | null;
  titulo: string | null;
  fecha: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  responsabilidades: string[];
  urlResumen: string | null;
} | null {
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const codigo = t(d.informe_codigo);
  if (!codigo || !/^[0-9A-Z]{6,24}$/.test(codigo)) return null;
  return {
    codigo,
    numero: t(d.informe_numero),
    titulo: t(d.informe_titulo),
    fecha: t(d.emision),
    entidad: t(d.informe_entidad),
    entidadRuc: t(d.informe_entidad_ruc),
    responsabilidades: Array.isArray(d.responsabilidades) ? d.responsabilidades.filter((r): r is string => typeof r === "string") : [],
    urlResumen: t(d.url_resumen),
  };
}
