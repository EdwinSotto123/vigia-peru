/**
 * Cliente y tipos de "Auditoría en vivo".
 * Backend: backend/api/src/routes/procesamientos.ts (lee la vista `procesamientos_publico`
 * que escribe el dispatcher, backend/dispatcher).
 * Plan:    docs/superpowers/plans/2026-09-14-vigia-utilizable.md · "Interfaces compartidas"
 *
 * Mismo contrato que lib/financiamiento.ts: los GET devuelven `null` si el API no
 * responde. Ningún tablero debe romper una página por un endpoint caído.
 *
 * El pipeline corre como DAG paralelo (backend/agent/deterministic.py): tres ramas a la vez
 * y fases que llegan desordenadas. `fases` (migración 20) trae el estado de cada agente;
 * `faseIndex` es solo el máximo alcanzado. Para filas anteriores a la migración (fases = {})
 * `reducirFases()` reconstruye el mapa desde la bitácora, con las mismas reglas que
 * backend/dispatcher/events.py.
 */

import { API_BASE, baseApiNavegador } from "./api-client";
import { diaLima, ritmoDiario } from "./auditoria-fechas";

/** `revision` no existe en `procesamientos.estado`: es procesado + alerta bloqueada por la autoevaluación. */
export type EstadoProc = "encolado" | "procesando" | "procesado" | "error" | "pendiente_de_procesamiento" | "esperando_documentos" | "revision";

export type EstadoFase = "pendiente" | "corriendo" | "hecho" | "omitido" | "error";

export interface FaseInfo {
  estado: Exclude<EstadoFase, "pendiente">;
  desde: string | null;
  hasta: string | null;
  motivo?: string | null;
  msg?: string | null;
}
export type FasesMap = Record<string, FaseInfo>;

export interface Procesamiento {
  ocid: string;
  estado: EstadoProc;
  faseActual: string | null;          // p.ej. "market"
  faseIndex: number | null;           // 0..9 (10 = final) — máximo alcanzado
  iniciadoAt: string | null;
  finalizadoAt: string | null;
  intentos: number;
  contribucionCodigo: string;         // VIG-2026-00002
  financiador: string;                // nombre público o "Anónimo"
  financiadorVisible: boolean;
  ubigeo: string;                     // zona de la contribución
  zona: string;
  titulo: string | null;              // convocatorias.objeto
  entidad: string | null;
  montoPen: number | null;            // cuantia_referencial
  alertaCodigo: string | null;        // cuando procesado
  score: number | null;
  banderas: number;                   // cuando procesado
  /** Migración 20: estado por agente (vacío en filas anteriores o recién reclamadas). */
  fases?: FasesMap | null;
  /** alertas.estado: 'revision' = bloqueada por la autoevaluación, no publicada. */
  alertaEstado?: string | null;
}

export interface EventoFase {
  ts: string;
  kind: "phase" | "warn" | "error" | "final";
  name: string;
  msg: string | null;
}

export interface SenalRiesgo {
  regla: string;
  severidad: "alta" | "media" | "baja";
  evidencia: string | null;
  norma: string | null;
  fuenteUrl?: string | null;
  agente?: string | null;
  /** banderas.verificacion.ok (migración 18): cotejada contra OCDS/SUNAT/documentos. */
  verificada?: boolean | null;
  /** U5 (GET /contratos/:ocid): páginas del expediente que respaldan la señal. */
  citas?: CitaDocumento[];
}

/** Cita a una página concreta de un documento del expediente (document_analysis / legal_analysis). */
export interface CitaDocumento {
  pagina: number | null;
  cita: string | null;
  documentoUrl: string | null;      // url_origen SEACE → /contratos/:ocid/documento firma la copia de Vigía
  documentoTitulo: string | null;
  enVigia: boolean;
  verificada: boolean | null;
}

export interface MercadoItem {
  item: string | null;
  unidad: string | null;
  veredicto: string | null;
  ofertado: number | null;
  mediana: number | null;
  diffPct: number | null;
  nPrecios: number | null;
}

/** Resumen liviano del análisis (GET /financiamiento/procesamientos/:ocid → resultado; GET /contratos/:ocid → alerta). */
export interface ResultadoAnalisis {
  id?: string;
  codigo: string;
  score: number | null;
  estado: string;                      // activa · revision · …
  analizadoEn: string | null;
  banderas: SenalRiesgo[];
  mercado: {
    estado: string | null;
    veredicto: string | null;
    nItems: number | null;
    nConMediana: number | null;
    totalOfertado: number | null;
    totalMercado: number | null;
    sobreprecioPct: number | null;
    items: MercadoItem[];
  } | null;
  documentos: { n: number; paginas: number; conError: number; titulos: string[] } | null;
  recortes: number;
  validacionesPendientes: string[];
  autoevaluacion: Record<string, number | string> | null;
  dictamenListo: boolean;
  revisionMotivo?: string | null;
  /** Motivos de la revisión humana en lenguaje claro (GET …/:ocid → resultado, GET /alertas/:codigo/revision). */
  revisionMotivos?: RevisionMotivo[] | null;
  /** U5: perfil del pipeline (bienes · servicios · obras · otros), costo/tokens y modelo. */
  perfil?: string | null;
  costo?: { costoUsd: number | null; llamadas: number | null; tokens: number | null } | null;
  modelo?: string | null;
  /** Reglas deterministas que dispararon (compliance_resumen_det.reglas). */
  reglasDisparadas?: string[] | null;
}

export interface RevisionMotivo { clave: string; titulo: string; detalle: string; valor: number | null; umbral: number | null; reglas?: string[]; reglasEtiquetas?: string[] }

/** Reglas por perfil (GET /financiamiento/procesamientos/reglas?perfil=, JSON estático de backend/scripts/exportar_reglas.py). */
export interface ReglaPerfil { id: string; etiqueta: string; descripcion: string }
export interface ReglasPerfil {
  version: string;
  generadoAt: string;
  perfil: string;
  agentes: string[];
  market_estrategia: string;
  parse_max_docs: number;
  reglas: ReglaPerfil[];
  otrasSenales: Record<string, { etiqueta: string; descripcion: string }>;
}

export interface Estimado {
  medianaSeg: number | null;
  n: number;
}

export type ProcesamientoDetalle = Procesamiento & {
  eventos: EventoFase[];
  resultado?: ResultadoAnalisis | null;
  estimado?: Estimado | null;
};

export interface ResumenProcesamientos {
  porEstado: Record<string, number>;
  procesadosHoy: number;
}

/** Orden real del pipeline (backend/agent/deterministic.py · backend/dispatcher/events.py). */
export const FASES: { key: string; label: string; agente: string }[] = [
  { key: "compliance", label: "Reglas de contratación", agente: "compliance_agent" },
  { key: "document_parser", label: "Lectura del expediente", agente: "document_parser_agent" },
  { key: "document_legal_analyst", label: "Análisis legal", agente: "document_legal_analyst_agent" },
  { key: "market", label: "Precios de mercado", agente: "market_price_agent" },
  { key: "web_research", label: "Investigación de la empresa", agente: "web_research_agent" },
  { key: "news_research", label: "Prensa", agente: "news_research_agent" },
  { key: "entity_personnel", label: "Funcionarios de la entidad", agente: "entity_personnel_agent" },
  { key: "person_network", label: "Red de personas", agente: "person_network_agent" },
  { key: "compliance_extended", label: "Cumplimiento extendido", agente: "compliance_extended_agent" },
  { key: "report_writer", label: "Dictamen", agente: "report_writer_agent" },
];

export const TOTAL_FASES = FASES.length;

/**
 * Cuántos agentes de IA leen un contrato. DERIVADO, nunca escrito a mano.
 *
 * El producto llegó a afirmar cinco números distintos en páginas que el mismo
 * usuario visita seguidas: "11 agentes" en /app/financiar y en el buscador,
 * "10 fases" en /app/auditoria, "Pipeline de 7 agentes" en AgentsPipeline (con
 * la lista hardcodeada), 13 nodos en constants.tsx y 12 claves en
 * AGENTES_PROGRESO. Con eso, lo que hace creíble al producto —que un equipo de
 * agentes leyó de verdad este expediente— no se podía ni contar.
 *
 * El número correcto es 10, y se verifica contra el backend: hay exactamente
 * diez carpetas de agente en backend/agent/agents/ (compliance,
 * compliance_extended, document_legal_analyst, document_parser,
 * entity_personnel, market_price, news_research, person_network, report_writer,
 * web_research), una por cada entrada de FASES. `_shared` no es un agente y
 * `orchestrator` es el orquestador LLM retirado: el pipeline corre determinista
 * en código.
 *
 * Si algún día se agrega un agente, se agrega a FASES y el número se mueve solo.
 * Nadie debe volver a escribirlo en una cadena de texto.
 */
export const TOTAL_AGENTES = FASES.length;

/** Etiquetas de todo lo que aparece en la bitácora (agentes + pasos del driver). */
const LABELS: Record<string, string> = Object.fromEntries(FASES.map((f) => [f.key, f.label]));
Object.assign(LABELS, {
  started: "Inicio",
  deterministic: "Inicio del análisis",
  perfil: "Tipo de contrato",
  ocds: "Registro público del proceso",
  clasificacion: "Clasificación",
  dag: "Ramas en paralelo",
  dag_join: "Unión de las ramas",
  proveedor: "Perfil del proveedor",
  persist_checkpoint: "Guardado del avance",
  safety_net: "Verificación final",
  // `persist` guarda el análisis; publicarlo o no lo decide la autoevaluación que viene después.
  persist: "Guardado del análisis",
  self_eval: "Autoevaluación",
  final: "Fin del análisis",
});

/** Etiqueta corta para los chips de los carriles. */
const LABELS_CORTOS: Record<string, string> = {
  compliance: "Reglas duras",
  document_parser: "Expediente",
  document_legal_analyst: "Legal",
  market: "Mercado",
  proveedor: "SUNAT / OECE",
  web_research: "Empresa",
  news_research: "Prensa",
  entity_personnel: "Funcionarios",
  person_network: "Red de personas",
  compliance_extended: "Cumplimiento",
  report_writer: "Dictamen",
  self_eval: "Autoevaluación",
};

/**
 * Carriles del DAG tal como corre en deterministic.py: cada paso es un grupo de agentes
 * que corren en paralelo. Las reglas duras corren en su propia rama pero sobre el mismo
 * expediente OCDS, así que se muestran en ese carril.
 */
export const CARRILES: { key: string; label: string; pasos: string[][] }[] = [
  { key: "expediente", label: "Expediente", pasos: [["compliance"], ["document_parser"], ["document_legal_analyst", "market"]] },
  { key: "proveedor", label: "Proveedor", pasos: [["proveedor"], ["web_research", "news_research", "entity_personnel"]] },
  { key: "sintesis", label: "Síntesis", pasos: [["person_network"], ["compliance_extended"], ["report_writer"], ["self_eval"]] },
];

/** Agentes que cuentan para el progreso (los chips de los carriles). */
export const AGENTES_PROGRESO: string[] = CARRILES.flatMap((c) => c.pasos.flat());

/**
 * Píldoras de estado. El texto usa los tokens `*Texto` (≥ 4.5:1 sobre su fondo): los tonos
 * base (clay, amber, crimson) daban 2.9–4.0:1 sobre su propio `-soft`, por debajo de AA.
 */
export const ESTADO_PROC: Record<EstadoProc, { label: string; cls: string }> = {
  encolado: { label: "En cola", cls: "bg-paperDeep text-mute" },
  procesando: { label: "Procesando", cls: "bg-amber-soft text-amberTexto" },
  // "Leído" es la palabra de DESIGN_SYSTEM.md §10.1 (análisis terminado, por cualquier vía).
  procesado: { label: "Leído", cls: "bg-moss/10 text-mossTexto" },
  error: { label: "Reintentando", cls: "bg-crimson-soft text-crimsonTexto" },
  pendiente_de_procesamiento: { label: "No procesable todavía", cls: "bg-paperDeep text-amberTexto" },
  esperando_documentos: { label: "Esperando documentos", cls: "bg-amber-soft/60 text-clayTexto" },
  // §10.1: "En revisión", la misma palabra en todas las superficies.
  revision: { label: "En revisión", cls: "bg-paperDeep text-clayTexto" },
};

/** Estado que se muestra: procesado con alerta bloqueada por la autoevaluación → revisión. */
export const estadoVisible = (p: Pick<Procesamiento, "estado" | "alertaEstado">): EstadoProc =>
  p.estado === "procesado" && p.alertaEstado === "revision" ? "revision" : p.estado;

/** URL del API para client components: `/v1` del mismo dominio detrás de Firebase Hosting (ver `baseApiNavegador`). */
export const PUBLIC_API_BASE = baseApiNavegador();

async function getJson<T>(path: string, revalidate = 5): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { next: { revalidate } } as any);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface ProcesamientosQuery {
  ubigeo?: string;
  codigo?: string;
  estado?: Exclude<EstadoProc, "revision">;
  financiador?: string;
  /** YYYY-MM-DD, sobre `encolado_at` (el único timestamp que siempre existe). */
  desde?: string;
  hasta?: string;
  limit?: number;
  offset?: number;
}

export function procesamientosQueryString(q: ProcesamientosQuery = {}): string {
  const params = new URLSearchParams(
    Object.entries(q)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
  return params.toString();
}

export const getProcesamientos = (q: ProcesamientosQuery = {}) =>
  getJson<{ data: Procesamiento[] }>(`/financiamiento/procesamientos?${procesamientosQueryString(q)}`).then((r) => r?.data ?? null);

export interface ProcesamientosPagina { data: Procesamiento[]; total: number; limit: number; offset: number }

/** Como `getProcesamientos`, pero conserva `total` — para el histórico paginado (no el tablero en vivo). */
export const getProcesamientosPaginado = (q: ProcesamientosQuery = {}) =>
  getJson<ProcesamientosPagina>(`/financiamiento/procesamientos?${procesamientosQueryString(q)}`, 5);

export interface FinanciadorProcesamientos { nombre: string; n: number }

export const getFinanciadoresProcesamientos = () =>
  getJson<{ data: FinanciadorProcesamientos[] }>(`/financiamiento/procesamientos/financiadores`, 60).then((r) => r?.data ?? []);

export const getProcesamiento = (ocid: string) =>
  getJson<ProcesamientoDetalle>(`/financiamiento/procesamientos/${encodeURIComponent(ocid)}`, 3);

export const getReglasPerfil = (perfil: string) =>
  getJson<ReglasPerfil>(`/financiamiento/procesamientos/reglas?perfil=${encodeURIComponent(perfil)}`, 3600);

export const getResumenProcesamientos = () =>
  getJson<ResumenProcesamientos>(`/financiamiento/procesamientos/resumen`, 10);

// ─── Ritmo diario: GET /financiamiento/procesamientos/ritmo?dias=N ───────────

/** Días de la ventana del ritmo (barras por día) en /app/auditoria. */
export const DIAS_RITMO = 14;

/** Tope de filas de `GET /financiamiento/procesamientos` (el `max` del zod del API). */
export const TOPE_LISTA_PROCESAMIENTOS = 300;

/** Análisis terminados por día (hora de Lima), los días en cero incluidos, hasta hoy. */
export interface RitmoProcesamientos {
  dias: { dia: string; n: number }[];
  total: number;
  /** ISO del último análisis terminado (de cualquier día), o null si no hay ninguno. */
  ultimoFin: string | null;
  /**
   * Sólo en el respaldo: la lista con tope cortó la ventana, así que los días más viejos
   * pueden estar incompletos. Con el endpoint nuevo el conteo sale de SQL y nunca es parcial.
   */
  parcial?: boolean;
}

/** La respuesta del API, validada. `null` si no tiene la forma del contrato. */
export function leerRitmo(j: unknown): RitmoProcesamientos | null {
  const o = j as Partial<RitmoProcesamientos> | null;
  if (!o || !Array.isArray(o.dias)) return null;
  const dias = o.dias
    .filter((d) => d && typeof d.dia === "string")
    .map((d) => ({ dia: d.dia.slice(0, 10), n: Number(d.n) || 0 }));
  const total = typeof o.total === "number" ? o.total : dias.reduce((s, d) => s + d.n, 0);
  return { dias, total, ultimoFin: typeof o.ultimoFin === "string" ? o.ultimoFin : null };
}

/**
 * COMPAT-API-VIEJA: mientras `/ritmo` no esté en prod, el ritmo se cuenta sobre la lista de
 * procesados (los más recientes primero, con tope). Si la lista llegó al tope y su fila más
 * vieja cae dentro de la ventana, los días del principio pueden faltar: se marca `parcial`.
 */
export function ritmoDesdeLista(ps: Pick<Procesamiento, "finalizadoAt">[], ahora: number, dias: number, tope = TOPE_LISTA_PROCESAMIENTOS): RitmoProcesamientos {
  const finalizados = ps.map((p) => p.finalizadoAt).filter((f): f is string => !!f);
  const ventana = ritmoDiario(finalizados, ahora, dias);
  let max = -Infinity;
  let min = Infinity;
  for (const f of finalizados) {
    const t = Date.parse(f);
    if (!Number.isFinite(t)) continue;
    if (t > max) max = t;
    if (t < min) min = t;
  }
  const inicio = ventana[0]?.dia ?? null;
  const masViejo = Number.isFinite(min) ? diaLima(min) : null;
  const parcial = ps.length >= tope && !!inicio && !!masViejo && masViejo >= inicio;
  return {
    dias: ventana,
    total: ventana.reduce((s, d) => s + d.n, 0),
    ultimoFin: Number.isFinite(max) ? new Date(max).toISOString() : null,
    parcial,
  };
}

/** Ruta del ritmo, la misma para el servidor y el navegador. */
export const rutaRitmo = (dias: number) => `/financiamiento/procesamientos/ritmo?dias=${dias}`;

/**
 * El ritmo para el render del servidor. Endpoint nuevo primero (60 s de caché, como su Memo);
 * si responde 404 (COMPAT-API-VIEJA: la API de prod todavía no lo tiene), la lista con tope.
 * `null` si el API no responde: la cifra no se inventa.
 */
export async function getRitmoProcesamientos(dias = 14): Promise<RitmoProcesamientos | null> {
  try {
    const res = await fetch(`${API_BASE}${rutaRitmo(dias)}`, { next: { revalidate: 60 } } as any);
    if (res.ok) return leerRitmo(await res.json());
    if (res.status !== 404) return null;
  } catch {
    return null;
  }
  // COMPAT-API-VIEJA: borrar este respaldo cuando `/ritmo` esté en prod.
  const procs = await getProcesamientos({ estado: "procesado", limit: TOPE_LISTA_PROCESAMIENTOS });
  return procs ? ritmoDesdeLista(procs, Date.now(), dias) : null;
}

// ─── Fases: reducción de la bitácora (misma lógica que backend/dispatcher/events.py) ──

const ALIASES: Record<string, string> = {
  legal: "document_legal_analyst",
  research_parallel: "web_research",
  news: "news_research",
  compliance_rules: "compliance_extended",
};
const RASTREADAS = new Set([...FASES.map((f) => f.key), "ocds", "proveedor", "persist_checkpoint", "safety_net", "persist", "self_eval"]);
const RAMAS = ["compliance", "document_parser", "document_legal_analyst", "market", "proveedor", "web_research", "news_research", "entity_personnel"];
const RAMA_FASES: Record<string, string[]> = {
  compliance: ["compliance"],
  documentos: ["document_parser", "document_legal_analyst", "market"],
  proveedor: ["proveedor", "web_research", "news_research", "entity_personnel"],
};
const SINTESIS_PREVIA = [...RAMAS, "ocds", "person_network", "compliance_extended"];
const CIERRA: Record<string, string[]> = {
  compliance: ["ocds"],
  document_parser: ["ocds"],
  proveedor: ["ocds"],
  document_legal_analyst: ["document_parser"],
  market: ["document_parser"],
  web_research: ["proveedor"],
  news_research: ["proveedor", "web_research"],
  entity_personnel: ["proveedor", "news_research"],
  dag_join: [...RAMAS, "ocds"],
  person_network: [...RAMAS, "ocds"],
  compliance_extended: [...RAMAS, "ocds", "person_network"],
  persist_checkpoint: SINTESIS_PREVIA,
  report_writer: [...SINTESIS_PREVIA, "persist_checkpoint"],
  safety_net: [...SINTESIS_PREVIA, "persist_checkpoint", "report_writer"],
  persist: [...SINTESIS_PREVIA, "persist_checkpoint", "report_writer", "safety_net"],
  self_eval: [...SINTESIS_PREVIA, "persist_checkpoint", "report_writer", "safety_net", "persist"],
};
const ORDEN: Record<string, number> = Object.fromEntries(FASES.map((f, i) => [f.key, i]));
Object.assign(ORDEN, { ocds: -1, proveedor: 3.5, persist_checkpoint: 8.5, safety_net: 9.5, persist: 9.6, self_eval: 9.7 });

export function canonico(raw: string | null | undefined): string {
  let n = (raw ?? "").trim();
  if (n.endsWith("_agent")) n = n.slice(0, -"_agent".length);
  return ALIASES[n] ?? n;
}

function cerrar(fases: FasesMap, nombres: Iterable<string>, ts: string, estado: FaseInfo["estado"] = "hecho", motivo?: string) {
  for (const n of nombres) {
    const f = fases[n];
    if (f && f.estado === "corriendo") {
      f.estado = estado;
      f.hasta = ts;
      if (motivo) f.motivo = motivo;
    }
  }
}

function arrancar(fases: FasesMap, nombre: string, ts: string, msg: string | null) {
  const prev = fases[nombre];
  fases[nombre] = { estado: "corriendo", desde: prev?.estado === "corriendo" && prev.desde ? prev.desde : ts, hasta: null, msg: msg || null };
}

/** Reconstruye `fases` desde la bitácora (filas anteriores a la migración 20 o del dispatcher viejo). */
export function reducirFases(eventos: EventoFase[]): FasesMap {
  const fases: FasesMap = {};
  let enDag = false;
  for (const ev of eventos) {
    const ts = ev.ts;
    const msg = ev.msg ?? "";
    if (ev.kind === "phase") {
      const name = canonico(ev.name);
      if (msg.startsWith("omitido")) {
        if (RASTREADAS.has(name)) {
          const motivo = msg.includes(":") ? msg.slice(msg.indexOf(":") + 1).trim() : "no aplica";
          fases[name] = { estado: "omitido", desde: ts, hasta: ts, motivo };
        }
        continue;
      }
      if (name === "dag") enDag = true;
      else if (name === "dag_join") enDag = false;
      if (CIERRA[name]) cerrar(fases, CIERRA[name], ts);
      if (!enDag && name in ORDEN) cerrar(fases, Object.keys(fases).filter((n) => (ORDEN[n] ?? 99) < ORDEN[name]), ts);
      if (RASTREADAS.has(name)) arrancar(fases, name, ts, msg);
      if (ev.name === "research_parallel" || (RASTREADAS.has(name) && msg.includes("∥"))) {
        const cola = msg.includes(":") ? msg.slice(msg.indexOf(":") + 1) : msg;
        const listados = cola.split(/∥|,/).map((t) => canonico(t)).filter((t) => RASTREADAS.has(t));
        for (const extra of listados.length ? listados : ["news_research", "entity_personnel"]) {
          if (extra !== name && RASTREADAS.has(extra)) arrancar(fases, extra, ts, null);
        }
      }
    } else if (ev.kind === "final") {
      cerrar(fases, Object.keys(fases), ts);
    } else if (ev.kind === "error") {
      const objetivo = canonico(ev.name);
      const afectadas = RAMA_FASES[objetivo] ?? (RASTREADAS.has(objetivo) ? [objetivo] : []);
      cerrar(fases, afectadas, ts, "error", msg.slice(0, 160));
    } else if (ev.kind === "warn") {
      const name = canonico(ev.name);
      if (RASTREADAS.has(name) && /reintento/i.test(msg)) {
        if (/tras reintento/i.test(msg)) cerrar(fases, [name], ts, "hecho", "sin resultados (default tipado)");
        else if (fases[name] && fases[name].estado !== "corriendo") fases[name] = { ...fases[name], estado: "corriendo", hasta: null, motivo: null };
      }
    }
  }
  return fases;
}

/**
 * Mapa de fases efectivo: el del API (migración 20); si viene vacío, el reducido de la
 * bitácora; y si tampoco hay bitácora, uno sintético desde faseIndex (dispatcher viejo).
 */
export function fasesEfectivas(p: Pick<Procesamiento, "estado" | "faseActual" | "faseIndex" | "fases">, eventos?: EventoFase[]): FasesMap {
  if (p.fases && Object.keys(p.fases).length) return p.fases;
  if (eventos?.length) return reducirFases(eventos);
  const out: FasesMap = {};
  if (p.estado === "procesado" || p.estado === "revision") {
    for (const k of AGENTES_PROGRESO) out[k] = { estado: "hecho", desde: null, hasta: null };
    return out;
  }
  if (p.estado !== "procesando" || p.faseIndex == null) return out;
  FASES.forEach((f, i) => {
    if (i < p.faseIndex!) out[f.key] = { estado: "hecho", desde: null, hasta: null };
    else if (i === p.faseIndex && p.faseActual !== "started") out[f.key] = { estado: "corriendo", desde: null, hasta: null };
  });
  return out;
}

export function estadoDeFase(fases: FasesMap, key: string, estado: EstadoProc): EstadoFase {
  const f = fases[key];
  if (f) return f.estado;
  if (estado === "procesado" || estado === "revision") return "hecho";
  return "pendiente";
}

/** Progreso global: fases hechas sobre las aplicables (las omitidas no cuentan). */
export function progresoFases(fases: FasesMap, estado: EstadoProc): { hechas: number; aplicables: number; pct: number; corriendo: string[] } {
  const aplicables = AGENTES_PROGRESO.filter((k) => estadoDeFase(fases, k, estado) !== "omitido");
  const hechas = aplicables.filter((k) => estadoDeFase(fases, k, estado) === "hecho");
  const corriendo = AGENTES_PROGRESO.filter((k) => estadoDeFase(fases, k, estado) === "corriendo");
  const pct = estado === "procesado" || estado === "revision" ? 100 : aplicables.length ? Math.round((hechas.length / aplicables.length) * 100) : 0;
  return { hechas: hechas.length, aplicables: aplicables.length, pct, corriendo };
}

/** Progreso 0..1 de cada carril (hechas / aplicables del carril) para las mini-barras del kanban. */
export function progresoCarriles(fases: FasesMap, estado: EstadoProc): { key: string; label: string; pct: number; activo: boolean }[] {
  return CARRILES.map((c) => {
    const claves = c.pasos.flat();
    const aplicables = claves.filter((k) => estadoDeFase(fases, k, estado) !== "omitido");
    const hechas = aplicables.filter((k) => estadoDeFase(fases, k, estado) === "hecho").length;
    const activo = claves.some((k) => estadoDeFase(fases, k, estado) === "corriendo");
    const pct = estado === "procesado" || estado === "revision" ? 100 : aplicables.length ? Math.round((hechas / aplicables.length) * 100) : 0;
    return { key: c.key, label: c.label, pct, activo };
  });
}

/** Fase (backend/dispatcher) → id de nodo del grafo agéntico (components/convocatoria/sections/FlowGraph). */
const NODO_POR_FASE: Record<string, string> = {
  compliance: "compliance",
  document_parser: "parser",
  document_legal_analyst: "legal",
  market: "market",
  web_research: "web",
  news_research: "news",
  entity_personnel: "entity",
  person_network: "person",
  compliance_extended: "extended",
  report_writer: "writer",
};

/**
 * Traduce el `FasesMap` real (con `desde`/`hasta` por fase) al {activeId, doneIds} que
 * espera `FlowGraph` — el mismo grafo animado del buscador a demanda, alimentado acá por
 * la cola financiada en vez del stream ADK crudo. Usa el ESTADO real de cada fase, no el
 * orden de arranque: el DAG corre ramas en paralelo, así que una fase que arrancó antes
 * puede seguir "corriendo" cuando otra ya empezó — basarse solo en el orden la marcaría
 * "hecha" por error. Si varias corren a la vez, la más reciente en arrancar es la activa
 * (el grafo solo ilumina un nodo a la vez, igual que en el buscador a demanda).
 */
export function nodoActivoYHechos(fases: FasesMap): { activeId: string; doneIds: string[] } {
  const doneIds: string[] = [];
  let activeId: string | null = null;
  let activeDesde = "";
  for (const [fase, nodo] of Object.entries(NODO_POR_FASE)) {
    const f = fases[fase];
    if (!f) continue;
    if (f.estado === "hecho" || f.estado === "omitido" || f.estado === "error") doneIds.push(nodo);
    else if (f.estado === "corriendo" && f.desde && f.desde > activeDesde) { activeId = nodo; activeDesde = f.desde; }
  }
  return { activeId: activeId ?? "orch", doneIds };
}

// ─── Helpers de presentación ─────────────────────────────────────────────────

/** Etiqueta humana de una fase; para nombres fuera del pipeline devuelve el nombre tal cual. */
export function faseLabel(key: string | null | undefined): string {
  if (!key) return "En espera";
  const k = canonico(key);
  return LABELS[k] ?? k.replace(/_/g, " ");
}

export const faseLabelCorto = (key: string) => LABELS_CORTOS[key] ?? faseLabel(key);

/**
 * Qué está haciendo un contrato ahora, en una frase: los agentes corriendo (hasta dos) o la
 * fase actual. Con el DAG varias fases corren a la vez, `faseActual` sola se queda corta.
 */
export function faseHumana(p: Pick<Procesamiento, "estado" | "faseActual" | "faseIndex" | "fases" | "iniciadoAt">, ahora?: number, fases?: FasesMap): string {
  fases = fases ?? fasesEfectivas(p);
  const corriendo = AGENTES_PROGRESO.filter((k) => fases[k]?.estado === "corriendo");
  if (corriendo.length) {
    const nombres = corriendo.slice(0, 2).map(faseLabelCorto);
    if (corriendo.length > 2) return `${nombres.join(", ")} y ${corriendo.length - 2} más`;
    return nombres.join(" y ");
  }
  if (p.faseActual === "started" || !p.faseActual) {
    const espera = ahora && p.iniciadoAt ? ahora - new Date(p.iniciadoAt).getTime() : 0;
    return espera > 90_000 ? "Esperando turno en los agentes" : "Iniciando";
  }
  return faseLabel(p.faseActual);
}

/** Progreso 0..100 de un procesamiento según sus fases. */
export function faseProgreso(p: Pick<Procesamiento, "estado" | "faseIndex" | "faseActual" | "fases">): number {
  if (p.estado === "procesado" || p.estado === "revision") return 100;
  if (p.estado === "encolado") return 0;
  return progresoFases(fasesEfectivas(p), p.estado).pct;
}

// ─── Lenguaje humano: tipo de contrato, etapa, estrategia de mercado ─────────

const TIPO_HUMANO: Record<string, string> = {
  bienes: "bienes",
  servicios: "servicios",
  obras: "obras",
  otros: "otro tipo",
  otro: "otro tipo",
  consultoria: "consultoría",
  convenio: "convenios",
  directa: "contratación directa",
};
const ETAPA_HUMANA: Record<string, string> = {
  convocada: "convocada",
  adjudicada: "adjudicada",
  contratada: "contratada",
  en_ejecucion: "en ejecución",
  finalizada: "finalizada",
};
/** Estrategia de precios del perfil (reglas.json · market_estrategia) en palabras de un ciudadano. */
const ESTRATEGIA_MERCADO: Record<string, string> = {
  goods_retail: "precios de venta al público",
  historico_seace: "precios pagados antes por el Estado",
  presupuesto_obra: "presupuestos de obra",
  cotizaciones: "cotizaciones",
};

/** "bienes" → "bienes"; "otros" → "otro tipo". Nunca devuelve el id crudo con guiones bajos. */
export const tipoContratoHumano = (t: string | null | undefined): string | null =>
  t ? TIPO_HUMANO[t.toLowerCase()] ?? t.replace(/_/g, " ") : null;

function tipoEtapaHumano(par: string): string {
  const [t, e] = par.split("/");
  return `contratos de ${tipoContratoHumano(t) ?? t} en etapa ${ETAPA_HUMANA[e] ?? (e ?? "").replace(/_/g, " ")}`;
}

/** Motivo de un paso omitido ("no aplica a bienes/contratada") en castellano llano. */
export function motivoHumano(motivo: string | null | undefined): string {
  const m = (motivo ?? "").trim();
  if (!m || /^no aplica$/i.test(m)) return "no aplica a este contrato";
  const te = /no aplica al?\s+([\w-]+\/[\w-]+)/i.exec(m);
  if (te) return `no aplica a ${tipoEtapaHumano(te[1])}`;
  if (/default tipado|sin resultados/i.test(m)) return "terminó sin resultados";
  return m;
}

const RAMA_HUMANA: Record<string, string> = { compliance: "de las reglas", documentos: "del expediente", proveedor: "del proveedor" };

/**
 * Bitácora en lenguaje humano: "document_parser: procesando documentos SEACE" → "Leyendo los
 * documentos del expediente".
 *
 * Nunca cae a imprimir el mensaje crudo del backend: la bitácora llegó a mostrar
 * "web_research: hallazgos_prensa 1→0 por schema (1 descarte(s) anotados en state.descartes)".
 * Un aviso que no se reconoce se dice en una línea genérica; el detalle técnico vive en los
 * logs del backend, no en la pantalla de un ciudadano.
 */
export function humanizar(ev: Pick<EventoFase, "kind" | "name" | "msg">): string {
  const name = canonico(ev.name);
  const msg = (ev.msg ?? "").trim();
  const label = faseLabel(name);
  if (ev.kind === "final") return msg && /abort/i.test(msg) ? "El análisis se detuvo antes de terminar" : "Análisis terminado";
  if (ev.kind === "phase") {
    if (msg.startsWith("omitido")) {
      const motivo = msg.includes(":") ? msg.slice(msg.indexOf(":") + 1).trim() : "no aplica";
      return `${label}: se omitió porque ${motivoHumano(motivo)}`;
    }
    switch (name) {
      case "started": return "El contrato entra al análisis";
      case "deterministic": return "Empieza el análisis";
      case "perfil": {
        const m = /^(\w+)(?: · mercado=(\w+))?(?: · agentes: (.+))?$/.exec(msg);
        const tipo = tipoContratoHumano(m?.[1] ?? null);
        if (m?.[3]) return `Contrato de ${tipo}: le aplican ${m[3].split(",").length} agentes`;
        return tipo ? `Contrato de ${tipo}` : "Identificando el tipo de contrato";
      }
      case "ocds": return "Leyendo el registro público del proceso en el OECE";
      case "clasificacion": {
        const m = /tipo × etapa ([\w-]+\/[\w-]+)/.exec(msg);
        return m ? `Clasificado entre los ${tipoEtapaHumano(m[1])}` : "Clasificando el tipo y la etapa del contrato";
      }
      case "dag": return "Arrancan tres ramas a la vez: reglas, expediente y proveedor";
      case "dag_join": return "Las ramas terminaron; empieza la síntesis";
      case "compliance": return "Evaluando las reglas de contratación";
      case "document_parser": return "Leyendo los documentos del expediente";
      case "proveedor": return "Revisando al proveedor ganador en el OECE y la SUNAT";
      case "web_research": return msg.includes("∥") ? "Investigando a la vez la empresa, la prensa y los funcionarios" : "Investigando a la empresa en la web";
      case "news_research": return "Buscando cobertura de prensa";
      case "entity_personnel": return "Identificando funcionarios de la entidad";
      case "document_legal_analyst": return "Analizando legalmente el requerimiento";
      case "market": {
        const m = /\((\w+)\)/.exec(msg);
        const estrategia = m ? ESTRATEGIA_MERCADO[m[1]] : null;
        return `Comparando precios con el mercado${estrategia ? `, contra ${estrategia}` : ""}`;
      }
      case "person_network": return "Mapeando la red de personas";
      case "compliance_extended": return /código/i.test(msg) ? "Aplicando las reglas fijas de este tipo de contrato (sin IA)" : "Revisando el cumplimiento de la norma";
      case "persist_checkpoint": return "Guardando el avance del análisis";
      case "report_writer": return "Escribiendo el dictamen";
      case "safety_net": return "Comprobando que el análisis esté completo";
      case "persist": return "Guardando el análisis";
      case "self_eval": return "Ocho revisores automáticos controlan el análisis";
      default: return label;
    }
  }
  // warn / error
  let m: RegExpExecArray | null;
  if ((m = /ítems canónicos tras sanitización por LLM: (\d+) \(de (\d+) crudos\)/.exec(msg))) {
    return `Expediente: ${m[1]} ${m[1] === "1" ? "ítem útil" : "ítems útiles"} de ${m[2]} ${m[2] === "1" ? "leído" : "leídos"}`;
  }
  if (/vacío tras reintento/i.test(msg)) return `${label}: sin resultados después de reintentar`;
  if (/vacío\s*[—-]\s*reintento/i.test(msg)) return `${label}: sin resultados, se reintenta`;
  if (/output_key .* ausente/i.test(msg)) return `${label}: su resultado llegó incompleto`;
  if (/REVISI/i.test(msg) && name === "self_eval") return "La autoevaluación pidió que una persona revise el análisis antes de publicarlo";
  if (/salida no es JSON/i.test(msg)) return `${label}: su resultado llegó sin formato y no se usó`;
  if (/Tool '.*' not found/i.test(msg)) return `${label}: no pudo usar la búsqueda web`;
  if (/OCDS no disponible/i.test(msg)) return "El registro público del OECE no respondió";
  if ((m = /^rama (\w+):/i.exec(msg))) return `Falló la rama ${RAMA_HUMANA[m[1].toLowerCase()] ?? m[1]}`;
  if ((m = /(\d+) descarte\(s\)/.exec(msg))) {
    return `${label}: ${m[1] === "1" ? "se descartó 1 dato que no tenía" : `se descartaron ${m[1]} datos que no tenían`} el formato esperado`;
  }
  if (/malformado/i.test(msg) && name === "report_writer") return "Dictamen: el primer borrador salió incompleto y se vuelve a escribir";
  if ((m = /(\d+) RUC sin respaldo/i.exec(msg))) return `Dictamen: se ${m[1] === "1" ? "quitó 1 RUC" : `quitaron ${m[1]} RUC`} sin respaldo`;
  return ev.kind === "error" ? `${label}: falló este paso` : `${label}: aviso técnico durante este paso`;
}

// ─── Fechas: siempre en hora de Lima → lib/auditoria-fechas.ts ──────────────
export * from "./auditoria-fechas";

/** "≈ 3 min" · "≈ 3–5 min" (sin historial) */
export function estimadoLabel(e: Estimado | null | undefined): string {
  if (!e?.medianaSeg || e.n < 3) return "≈ 3–5 min";
  const min = e.medianaSeg / 60;
  return min < 1 ? "≈ 1 min" : `≈ ${Math.round(min)} min`;
}

export const esActivo = (estado: EstadoProc) => estado === "encolado" || estado === "procesando" || estado === "esperando_documentos";

export function severidadCls(s: SenalRiesgo["severidad"]): { dot: string; text: string; label: string } {
  if (s === "alta") return { dot: "bg-rust", text: "text-rust", label: "Alta" };
  // amber base sobre papel da 3.47:1: el texto va en amberTexto; el punto puede seguir en amber.
  if (s === "media") return { dot: "bg-amber", text: "text-amberTexto", label: "Media" };
  // Señal baja: neutra (DESIGN_SYSTEM.md §3.7), texto inkSoft.
  return { dot: "bg-mute", text: "text-inkSoft", label: "Baja" };
}

// ─── Etiquetas de reglas sin catálogo → lib/auditoria-reglas.ts (este módulo pasaba las 800 líneas) ──
export * from "./auditoria-reglas";
