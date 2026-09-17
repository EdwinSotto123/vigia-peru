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

import { API_BASE } from "./api-client";

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

/** Etiquetas de todo lo que aparece en la bitácora (agentes + pasos del driver). */
const LABELS: Record<string, string> = Object.fromEntries(FASES.map((f) => [f.key, f.label]));
Object.assign(LABELS, {
  started: "Iniciando",
  deterministic: "Arrancando el pipeline",
  perfil: "Perfil de análisis",
  ocds: "Registro OCDS",
  clasificacion: "Clasificación",
  dag: "Ramas en paralelo",
  dag_join: "Uniendo ramas",
  proveedor: "Perfil del proveedor",
  persist_checkpoint: "Guardando avance",
  safety_net: "Verificación final",
  persist: "Publicando",
  self_eval: "Autoevaluación",
  final: "Dictamen publicado",
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

export const ESTADO_PROC: Record<EstadoProc, { label: string; cls: string }> = {
  encolado: { label: "En cola", cls: "bg-paperDeep text-mute" },
  procesando: { label: "Procesando", cls: "bg-amber-soft text-amber" },
  procesado: { label: "Procesado", cls: "bg-moss/10 text-moss" },
  error: { label: "Reintentando", cls: "bg-crimson-soft text-crimson" },
  pendiente_de_procesamiento: { label: "Pendiente de procesamiento", cls: "bg-paperDeep text-amber" },
  esperando_documentos: { label: "Esperando documentos", cls: "bg-amber-soft/60 text-clay" },
  revision: { label: "En revisión humana", cls: "bg-paperDeep text-clay" },
};

/** Estado que se muestra: procesado con alerta bloqueada por la autoevaluación → revisión. */
export const estadoVisible = (p: Pick<Procesamiento, "estado" | "alertaEstado">): EstadoProc =>
  p.estado === "procesado" && p.alertaEstado === "revision" ? "revision" : p.estado;

/** URL del API utilizable desde client components (NEXT_PUBLIC_* se inyecta en build). */
export const PUBLIC_API_BASE =
  process.env.NEXT_PUBLIC_VIGIA_API_URL ?? "https://vigia-peru-api-36169102688.us-central1.run.app";

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
    const nombres = corriendo.slice(0, 2).map(faseLabelCorto).join(" ∥ ");
    return corriendo.length > 2 ? `${nombres} +${corriendo.length - 2}` : nombres;
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

/** Bitácora en lenguaje humano: "document_parser: procesando documentos SEACE" → "Leyendo los documentos del expediente". */
export function humanizar(ev: Pick<EventoFase, "kind" | "name" | "msg">): string {
  const name = canonico(ev.name);
  const msg = (ev.msg ?? "").trim();
  const label = faseLabel(name);
  if (ev.kind === "final") return msg && /abort/i.test(msg) ? `Análisis abortado: ${msg}` : "Análisis terminado";
  if (ev.kind === "phase") {
    if (msg.startsWith("omitido")) {
      const motivo = msg.includes(":") ? msg.slice(msg.indexOf(":") + 1).trim() : "no aplica";
      return `${label}: omitido · ${motivo.replace(/^no aplica a(l)?\s*/i, "no aplica a ")}`;
    }
    switch (name) {
      case "started": return "Despachando a los agentes";
      case "deterministic": return "Pipeline en marcha";
      case "perfil": {
        const m = /^(\w+)(?: · mercado=(\w+))?(?: · agentes: (.+))?$/.exec(msg);
        if (m?.[3]) return `Perfil ${m[1]} · ${m[3].split(",").length} agentes aplican`;
        return `Perfil de análisis: ${m?.[1] ?? msg}`;
      }
      case "ocds": return "Obteniendo el registro OCDS del proceso";
      case "clasificacion": {
        const m = /tipo × etapa ([\w-]+\/[\w-]+)/.exec(msg);
        return m ? `Matriz tipo × etapa: ${m[1].replace("/", " · ")}` : "Clasificando tipo y etapa";
      }
      case "dag": return "Tres ramas en paralelo: reglas ∥ expediente ∥ proveedor";
      case "dag_join": return "Las ramas terminaron; empieza la síntesis";
      case "compliance": return "Evaluando las reglas duras de contratación";
      case "document_parser": return "Leyendo los documentos del expediente";
      case "proveedor": return "Perfilando al proveedor adjudicado (OECE · SUNAT)";
      case "web_research": return msg.includes("∥") ? "Investigando empresa, prensa y funcionarios en paralelo" : "Investigando a la empresa en la web";
      case "news_research": return "Buscando cobertura de prensa";
      case "entity_personnel": return "Identificando funcionarios de la entidad";
      case "document_legal_analyst": return "Analizando legalmente el requerimiento";
      case "market": {
        const m = /\((\w+)\)/.exec(msg);
        return `Comparando precios con el mercado${m ? ` (${m[1].replace(/_/g, " ")})` : ""}`;
      }
      case "person_network": return "Mapeando la red de personas";
      case "compliance_extended": return /código/i.test(msg) ? "Reglas del perfil en código (sin LLM)" : "Cumplimiento normativo extendido (12 reglas + RAG OECE)";
      case "persist_checkpoint": return "Guardando el avance del análisis";
      case "report_writer": return "Escribiendo el dictamen";
      case "safety_net": return "Verificando la completitud del análisis";
      case "persist": return "Publicando el análisis";
      case "self_eval": return "Autoevaluación: 8 evaluadores revisan el análisis";
      default: return msg ? `${label}: ${msg}` : label;
    }
  }
  // warn / error
  let m: RegExpExecArray | null;
  if ((m = /ítems canónicos tras sanitización por LLM: (\d+) \(de (\d+) crudos\)/.exec(msg))) return `Expediente: ${m[1]} ítem${m[1] === "1" ? "" : "s"} canónico${m[1] === "1" ? "" : "s"} (de ${m[2]} crudos)`;
  if (/vacío tras reintento/i.test(msg)) return `${label}: sin resultados tras reintentar (sección vacía, declarada)`;
  if (/vacío — reintento/i.test(msg)) return `${label}: sin resultados, reintentando`;
  if (/output_key .* ausente/i.test(msg)) return `${label}: la salida del agente llegó incompleta`;
  if (/REVISI/i.test(msg) && name === "self_eval") return `Autoevaluación: alerta en revisión humana · ${msg.replace(/^.*?\(no publicada\):\s*/i, "")}`;
  if (/salida no es JSON/i.test(msg)) return `${label}: salida sin estructura (no validada)`;
  if (/Tool '.*' not found/i.test(msg)) return `${label}: herramienta no disponible, se reintenta`;
  if (/OCDS no disponible/i.test(msg)) return "Registro OCDS no disponible: fuente OECE inaccesible";
  if (/^rama (\w+):/i.test(msg)) return `Rama ${/^rama (\w+):/i.exec(msg)![1]} falló: ${msg.replace(/^rama \w+:\s*/i, "")}`;
  return msg ? `${label}: ${msg}` : label;
}

/** "hace 3 s" · "hace 2 min" · "hace 1 h" */
export function haceCuanto(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** "2 min 13 s" · "48 s" · "1 h 04 min" */
export function duracion(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "≈ 3 min" · "≈ 3–5 min" (sin historial) */
export function estimadoLabel(e: Estimado | null | undefined): string {
  if (!e?.medianaSeg || e.n < 3) return "≈ 3–5 min";
  const min = e.medianaSeg / 60;
  return min < 1 ? "≈ 1 min" : `≈ ${Math.round(min)} min`;
}

export const esActivo = (estado: EstadoProc) => estado === "encolado" || estado === "procesando" || estado === "esperando_documentos";

export function severidadCls(s: SenalRiesgo["severidad"]): { dot: string; text: string; label: string } {
  if (s === "alta") return { dot: "bg-rust", text: "text-rust", label: "Alta" };
  if (s === "media") return { dot: "bg-amber", text: "text-amber", label: "Media" };
  return { dot: "bg-mute", text: "text-mute", label: "Baja" };
}

export const reglaLabel = (regla: string) => regla.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
