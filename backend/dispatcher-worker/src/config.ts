/**
 * Bindings y variables del Worker `vigia-dispatcher` (wrangler.jsonc). Las variables tienen los
 * mismos nombres y valores por defecto que backend/dispatcher/main.py; las propias de Workers
 * (DISPATCHER_ACTIVO, DISPATCHER_TRAMO_S, DISPATCHER_OECE_BASE) están documentadas en el README.
 */

export interface ParamsSlot {
  /** Identidad de la corrida (`cloudflare-<id>`): va en `procesamientos.worker`. */
  worker: string;
  /** Número de hilo de la corrida (1..DISPATCHER_PARALLEL). */
  slot: number;
  /** Primer contrato, ya reclamado por la corrida. */
  ocid: string;
  /** Inicio de la corrida y fin de su ventana de reclamo (ms epoch, `plazo_de_reclamo`). */
  inicio: number;
  plazo: number;
}

export interface Env {
  /** Postgres como vigia_dispatcher, en modo transacción (PgBouncer): sin estado de sesión. */
  HYPERDRIVE: Hyperdrive;
  /** Workflow `ProcesarContratos`: un hilo de una corrida (ver src/workflow.ts). */
  PROCESAR: Workflow<ParamsSlot>;

  DISPATCHER_ACTIVO?: string;
  AGENT_URL?: string;
  AGENT_URL_BIENES?: string;
  AGENT_URL_SERVICIOS?: string;
  AGENT_URL_OBRAS?: string;
  AGENT_URL_OTROS?: string;
  DISPATCHER_PARALLEL?: string;
  DISPATCHER_MAX_MINUTES?: string;
  DISPATCHER_TASK_TIMEOUT_S?: string;
  DISPATCHER_ANALISIS_MAX_S?: string;
  DISPATCHER_STREAM_TIMEOUT?: string;
  DISPATCHER_GRACE_MINUTES?: string;
  DISPATCHER_MAX_EVENTOS?: string;
  DISPATCHER_PREFETCH_OCDS?: string;
  DISPATCHER_REQUIERE_DOCS_GCS?: string;
  DISPATCHER_TRAMO_S?: string;
  DISPATCHER_OECE_BASE?: string;

  // secretos
  GCP_SA_KEY?: string;
  DISPATCHER_TOKEN?: string;
  /** Solo desarrollo: ID token fijo (`gcloud auth print-identity-token`), como en main.py. */
  AGENT_ID_TOKEN?: string;
}

export const OECE_BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1";
export const MAX_INTENTOS = 3;
/** Tope de un paso de Workflows (las reglas de Workflows piden timeouts de 30 min o menos). */
export const TOPE_PASO_S = 30 * 60;

export interface Config {
  parallel: number;
  maxMin: number;
  streamTimeoutS: number;
  graceMin: number;
  taskTimeoutS: number;
  analisisMaxS: number;
  maxEventos: number;
  prefetchOcds: boolean;
  requiereDocsGcs: boolean;
  tramoS: number;
  oeceBase: string;
  activo: boolean;
}

/** `int(os.getenv(nombre, defecto))`: un valor que no es entero es un error de configuración. */
function entero(env: Env, nombre: keyof Env, defecto: number): number {
  const v = env[nombre];
  if (v === undefined || v === null) return defecto;
  const t = String(v).trim();
  if (!/^[+-]?\d+$/.test(t)) throw new Error(`${String(nombre)} no es un entero: ${JSON.stringify(v)}`);
  return Number(t);
}

const bandera = (env: Env, nombre: keyof Env, defecto: string) => String(env[nombre] ?? defecto) === "1";

export function leerConfig(env: Env): Config {
  const cfg: Config = {
    parallel: entero(env, "DISPATCHER_PARALLEL", 2),
    maxMin: entero(env, "DISPATCHER_MAX_MINUTES", 25),
    streamTimeoutS: entero(env, "DISPATCHER_STREAM_TIMEOUT", 1200),
    graceMin: entero(env, "DISPATCHER_GRACE_MINUTES", 20),
    taskTimeoutS: entero(env, "DISPATCHER_TASK_TIMEOUT_S", 7200),
    analisisMaxS: entero(env, "DISPATCHER_ANALISIS_MAX_S", 3600),
    maxEventos: entero(env, "DISPATCHER_MAX_EVENTOS", 400),
    prefetchOcds: bandera(env, "DISPATCHER_PREFETCH_OCDS", "1"),
    requiereDocsGcs: bandera(env, "DISPATCHER_REQUIERE_DOCS_GCS", "1"),
    tramoS: entero(env, "DISPATCHER_TRAMO_S", 1200),
    oeceBase: (env.DISPATCHER_OECE_BASE || OECE_BASE).replace(/\/+$/, ""),
    activo: bandera(env, "DISPATCHER_ACTIVO", "0"),
  };
  // Un tramo del stream es un paso de Workflows: tiene que terminar antes de su timeout de 30 min
  // (la espera de cabeceras del primer tramo se suma, así que tampoco puede pasar de 25 min).
  if (cfg.tramoS < 10 || cfg.tramoS > 25 * 60) throw new Error("DISPATCHER_TRAMO_S tiene que estar entre 10 y 1500 s");
  return cfg;
}

/**
 * Hasta cuándo se puede reclamar (ms epoch): la ventana MAX_MIN, pero nunca tan tarde que el peor
 * análisis (ANALISIS_MAX_S) más la espera de gracia no alcance a terminar antes del timeout de la
 * tarea. Misma fórmula que `plazo_de_reclamo` de main.py (en segundos allá).
 */
export function plazoDeReclamo(inicioMs: number, cfg: Pick<Config, "taskTimeoutS" | "analisisMaxS" | "graceMin" | "maxMin">): number {
  const margen = 300; // arranque, cierre en DB y refresco final
  const limiteSeguro = inicioMs + (cfg.taskTimeoutS - cfg.analisisMaxS - cfg.graceMin * 60 - margen) * 1000;
  return Math.min(inicioMs + cfg.maxMin * 60 * 1000, limiteSeguro);
}
