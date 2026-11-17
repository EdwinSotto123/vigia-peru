/**
 * Métricas y transparencia (página /metricas): lo que devuelve GET /transparencia y GET /transparencia/bitacora
 * (backend/api/src/routes/transparencia.ts). Sólo agregados. Un bloque `null` es «no medido»: la página lo dice, nunca
 * pone un cero en su lugar.
 */
import { API_BASE } from "./api-client";

export interface Corrida {
  /** «2026-11-15 20:44», hora de Lima. */
  fecha: string;
  /** La etiqueta de la imagen del agente que se midió. */
  version: string | null;
  contratos: number;
  errores: number;
  /** De 0 a 100. */
  precision: number | null;
  exhaustividad: number | null;
  /** De 0 a 1. */
  f1: number | null;
  usdMedio: number | null;
  segundosMedio: number | null;
  nota: string | null;
}

export interface Citas { total: number; ok: number; otroRegimen: number; noExiste: number }

export interface RedMedida { clave: string; nombre: string; casos: number; corridas: number; ultima: Corrida; serie: Corrida[] }

export interface LegalMedido {
  clave: string;
  nombre: string;
  corridas: number;
  ultima: Corrida & { citas: Citas | null };
  serie: { fecha: string; version: string | null; f1: number | null; precision: number | null; exhaustividad: number | null; citas: Citas | null }[];
}

export interface EvaluacionRag {
  fecha: string;
  /** Qué buscador se midió: el de Vigía (`vigia_normas`) o el anterior (`chroma`). */
  sistema: string | null;
  preguntas: number;
  /** De 0 a 1. */
  acierto8: number | null;
  acierto10: number | null;
  mrr: number | null;
  normaPrimero: number | null;
  regimenEquivocado: { n: number; de: number } | null;
  nota: string | null;
}

export interface Corpus {
  normas: number;
  fragmentos: number;
  conVector: number;
  opiniones: number;
  reglas: number | null;
  actualizado: string | null;
  porTipo: { tipo: string; documentos: number; fragmentos: number }[];
}

/** Lo que encontró la Contraloría, buscable (migraciones 302-305): sólo conteos. */
export interface CorpusContraloria {
  informes: number;
  /** Fichas Resumen bajadas y leídas con el lector del formulario. */
  fichas: number;
  conObservaciones: number;
  observaciones: number;
  /** Fichas cuyas observaciones ya leyó la IA (tema, perjuicio, referencias). */
  leidasIa: number;
  /** Lo que costó esa lectura, en dólares (Workers AI, por tokens). */
  costoIaUsd?: number;
  /** Contratos de Vigía que alguna observación nombra (migración 313); null si no se pudo contar. */
  contratosAtados?: number | null;
  observacionesAtadas?: number | null;
  fragmentos: number;
  conVector: number;
  /** Funcionarios comprendidos (responsabilidad presunta); null si no se pudo contar. */
  comprendidos: number | null;
  actualizado: string | null;
}

export interface SumasDictamen {
  n: number;
  conVerificacion: number;
  degradados: number;
  reglasCitadas: number;
  reglasSinSenal: number;
  urlsSinRespaldo: number;
  urlsQuitadas: number;
  rucsSinRespaldo: number;
  rucsSustituidos: number;
  citaN: number;
  citaOk: number;
  respaldoN: number;
  respaldoOk: number;
  precioN: number;
  precioOk: number;
  descartes: number;
}

/** Un tipo de dato leído de un documento (el monto del contrato, la experiencia exigida…) y cuánto de él se comprobó. */
export interface HechosLeidos {
  tipo: string;
  clase: string;
  total: number;
  comprobados: number;
  contradicen: number;
  sinComprobar: number;
  hasta: string | null;
}

export interface Transparencia {
  generado: string;
  agentes: { fecha: string | null; desde: string | null; redes: RedMedida[]; legal: LegalMedido[] } | null;
  rag: { corpus: Corpus | null; contraloria?: CorpusContraloria | null; serie: EvaluacionRag[]; fecha: string | null } | null;
  verificacion: {
    senales: { total: number; cotejadas: number; noCotejadas: number; sinCotejo: number; contratos: number; alta: number; media: number; baja: number } | null;
    dictamenes: (SumasDictamen & { desde: string | null; hasta: string | null; porRed: (SumasDictamen & { red: string; nombre: string })[] }) | null;
    /** Los datos leídos de los documentos, por tipo, y cuántos se comprobaron sin modelo (migración 323). Una API anterior no lo trae. */
    hechos?: HechosLeidos[] | null;
  };
  costos: {
    analizados: { total: number; porMes: { mes: string; n: number }[] } | null;
    analisis: {
      n: number;
      conCosto: number;
      usd: number;
      medioUsd: number | null;
      porMes: { mes: string; n: number; usd: number }[];
      porRed: { red: string; nombre: string; n: number; usd: number; medioUsd: number | null }[];
      porModelo: { modelo: string | null; n: number; usd: number }[];
      porDia: { dia: string; n: number; usd: number }[];
    } | null;
    validacion: { corridas: number; contratos: number; conCosto: number; usd: number; segundos: number; desde: string | null; hasta: string | null } | null;
    lectores: {
      documentos: { n: number; ok: number; paginas: number | null; usd: number; hasta: string | null };
      porClase: { clase: string; nombre: string; n: number; ok: number; paginas: number | null; usd: number }[];
      porModelo: { modelo: string | null; n: number; ok: number; paginas: number | null; usd: number }[];
      porMes: { mes: string; n: number; ok: number; paginas: number | null; usd: number }[];
      menores: { n: number; ok: number; usd: number; hasta: string | null; porClase: { clase: string; nombre: string; n: number; ok: number; usd: number }[] } | null;
    } | null;
    masivo: {
      n: number;
      usd: number;
      porEstado: { estado: string; nombre: string; n: number; usd: number }[];
      porDia: { dia: string; ok: number; errores: number; usd: number }[];
      porRed: { red: string; nombre: string; ok: number; errores: number; usd: number }[];
      tandas: { n: number; enCurso: number; ok: number; errores: number; usd: number; topeUsd: number | null; desde: string | null; ultima: string | null } | null;
      desde: string | null;
      hasta: string | null;
    } | null;
    almacenamiento: {
      baseBytes: number | null;
      tablas: { nombre: string; filas: number; bytes: number }[];
      documentos: { n: number; bytes: number | null; hasta: string | null } | null;
    } | null;
    facturas: {
      filas: { mes: string; titulo: string; proveedor: string | null; montoUsd: number; fuente: string; parcial: boolean; al: string | null }[];
      tipoCambio: { mes: string; penPorUsd: number; fuente: string | null } | null;
    } | null;
    declarados: { mes: string; concepto: string; categoria: string; monto: number; moneda: "USD" | "PEN"; fuente: string; nota: string | null; registrado: string }[] | null;
  };
}

export const TIPOS_BITACORA = ["validacion", "rag", "masivo", "refresco", "carga"] as const;
export type TipoBitacora = (typeof TIPOS_BITACORA)[number];
export const ETIQUETA_BITACORA: Record<TipoBitacora, string> = {
  validacion: "Validaciones",
  rag: "RAG normativo",
  masivo: "Tandas del masivo",
  refresco: "Refrescos",
  carga: "Cargas de datos",
};

export interface RenglonBitacora {
  fecha: string;
  tipo: TipoBitacora;
  titulo: string;
  estado: "ok" | "error" | "en_curso" | "saltado";
  resultado: string;
  version: string | null;
  nota: string | null;
}

export interface Bitacora {
  data: RenglonBitacora[];
  total: number;
  porTipo: { tipo: TipoBitacora; n: number }[];
  pagina: number;
  tam: number;
  hasta: string | null;
}

async function getJson<T>(ruta: string, revalidate: number): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const getTransparencia = () => getJson<Transparencia>("/transparencia", 900);

export function getBitacora({ tipo, q, pagina = 1, tam = 25 }: { tipo?: TipoBitacora; q?: string; pagina?: number; tam?: number }) {
  const p = new URLSearchParams({ pagina: String(pagina), tam: String(tam) });
  if (tipo) p.set("tipo", tipo);
  if (q) p.set("q", q);
  return getJson<Bitacora>(`/transparencia/bitacora?${p.toString()}`, 300);
}

const NBSP = " ";

/** Dólares como se escriben en el sitio (es-PE: coma de miles y punto decimal): «US$ 1,692.78». */
export function dolares(n: number | null | undefined, decimales = 2): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "Sin dato";
  return `US$${NBSP}${new Intl.NumberFormat("es-PE", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n)}`;
}

/** Un tamaño en disco: «82.4 GB», «613.7 GB», «215 MB». */
export function tamano(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "Sin dato";
  const f = (n: number, d: number) => new Intl.NumberFormat("es-PE", { maximumFractionDigits: d }).format(n);
  if (bytes >= 1e12) return `${f(bytes / 1e12, 2)}${NBSP}TB`;
  if (bytes >= 1e9) return `${f(bytes / 1e9, 1)}${NBSP}GB`;
  if (bytes >= 1e6) return `${f(bytes / 1e6, 0)}${NBSP}MB`;
  return `${f(bytes / 1e3, 0)}${NBSP}KB`;
}

/** «2026-11-15 20:44» → el día («2026-11-15») para las funciones de fecha del sitio. */
export const diaDe = (fechaHora: string | null | undefined) => (fechaHora ? fechaHora.slice(0, 10) : null);
/** «2026-11-15 20:44» → «20:44». */
export const horaDe = (fechaHora: string | null | undefined) => (fechaHora && fechaHora.length >= 16 ? fechaHora.slice(11, 16) : null);

const MESES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
/** «2026-11» → «nov. 2026». */
export function mesLargo(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return MESES[m - 1] ? `${MESES[m - 1]} ${a}` : mes;
}
/** «2026-11-15» → «15 nov.» (el rótulo de un día en un eje). */
export function diaCorto(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  return MESES[m - 1] ? `${d} ${MESES[m - 1]}` : dia;
}

/** Los tipos de norma del corpus, como se leen. */
export const TIPO_NORMA: Record<string, string> = {
  opinion: "Opiniones del OECE",
  directiva: "Directivas",
  ley: "Leyes",
  bases_estandar: "Bases estándar",
  acuerdo_sala_plena: "Acuerdos de Sala Plena",
  reglamento: "Reglamentos",
  control: "Normas de control",
  precedente: "Precedentes",
  otra: "Otras",
};

/** El buscador que se midió en una evaluación del RAG. */
export const SISTEMA_RAG: Record<string, string> = { vigia_normas: "Buscador de Vigía", chroma: "Buscador anterior" };

/** Un instante ISO («2026-11-16T08:20:52Z») como lo guarda el resto de la página: «2026-11-16 03:20», hora de Lima. */
export function enLima(iso: string | null | undefined): string | null {
  const f = iso ? new Date(iso) : null;
  if (!f || Number.isNaN(f.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(f);
}

// ─── Gasto por día y actividad en vivo (GET /transparencia/gasto y /ahora) ──────────────────────────────────────────

export type ClaveGasto = "analisis" | "oro" | "fichas" | "transcripcion" | "lectores" | "menores" | "otros";

export interface ComponenteGasto {
  clave: ClaveGasto;
  etiqueta: string;
  /** Qué cubre, en una frase. */
  que: string;
  /** Qué cuenta `n30` («análisis», «páginas»…). */
  unidad: string;
  usd30: number;
  usd7: number;
  usdHoy: number;
  n30: number;
}

export interface GastoIa {
  generado: string;
  desde: string;
  hasta: string;
  componentes: ComponenteGasto[];
  /** Los 30 días, del más viejo al de hoy; los sin gasto vienen en cero. */
  dias: { dia: string; total: number; partes: Partial<Record<ClaveGasto, number>> }[];
  totales: { usd30: number; usd7: number; hoy: number; mes: number; workersAi30: number; anthropic30: number };
  medios: { porAnalisis: number | null; porFicha: number | null; porPagina: number | null };
  /** Lo que mide Cloudflare para Workers AI (migración 336); null mientras no se cargue. */
  factura: { dias: { dia: string; usd: number }[]; usd30: number | null; medidaAt: string | null; cubren: number | null } | null;
  /** Libros que no respondieron: su gasto no está sumado. */
  sinLibro: string[];
}

export interface AhoraVigia {
  generado: string;
  /** «2026-11-17 14:32», hora de Lima: el último documento leído o análisis terminado. */
  ultimaActividad: string | null;
  enVuelo: { analisis: number; tandaAbierta: boolean; topeTanda: number | null; gastoTanda: number | null } | null;
  ultimaHora: TramoActividad | null;
  hoy: TramoActividad | null;
  /** Las últimas 24 horas («2026-11-17 14»), de la más vieja a la actual. */
  porHora: { hora: string; analisis: number; documentos: number }[] | null;
  recientes: { codigo: string | null; ocid: string; objeto: string | null; entidad: string | null; score: number | null; analizado: string }[];
}

export interface TramoActividad { analisis: number; documentos: number; paginas: number; usd: number }

export const getGasto = () => getJson<GastoIa>("/transparencia/gasto", 600);
export const getAhora = () => getJson<AhoraVigia>("/transparencia/ahora", 15);
