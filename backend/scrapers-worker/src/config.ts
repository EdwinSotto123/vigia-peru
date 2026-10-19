/**
 * Bindings y variables del Worker `vigia-scrapers` (wrangler.jsonc).
 */

/** Una corrida de una fuente (lo que en Python es `python -m backend.scrapers.<fuente>.pipeline [args]`). */
export interface ParamsCorrida {
  fuente: string;
  /** Parsea y cuenta, no escribe en la DB (`--dry-run`). */
  seco?: boolean;
  /** Recarga aunque el sha256 ya esté cargado (`--force`). */
  forzar?: boolean;
  /** oece_ocds: `--since`/`--until` (AAAA-MM-DD). pnda_visitas: `--desde`/`--hasta` (AAAA-MM). */
  desde?: string;
  hasta?: string;
  /** Quién la pidió: `cron <expresión>` o `manual`. */
  origen: string;
  /** mef_detalle: qué lectura del ZIP (índice de MIRADAS_POR_PASO, 1 en adelante). */
  paso?: number;
  /** mef_cargar_gasto: la clave en R2 del CSV que se carga. */
  archivo?: string;
}

export interface Env {
  /** Postgres como vigia_jobs (Hyperdrive `vigia-jobs` → túnel → PgBouncer → RDS). */
  HYPERDRIVE: Hyperdrive;
  /** R2 `vigia-peru-crudos`: el crudo de cada descarga, en raw/<fuente>/<clave>/<archivo> (antes gs://vigia-peru-batch/raw/). */
  CRUDOS: R2Bucket;
  /** Worker `vigia-relay` (Zúrich): la API OCDS del OECE responde 403 desde EE.UU. */
  RELAY: Fetcher;
  /** Workflow `CorrerFuente`: una corrida de una fuente (src/workflow.ts). */
  CORRER: Workflow<ParamsCorrida>;
  /** Browser Rendering: Claridad (ONPE) está detrás de un challenge de Cloudflare que solo pasa un navegador. */
  BROWSER: Fetcher;

  /** "1" = los crons disparan corridas. Sin eso el cron solo registra qué habría corrido. */
  SCRAPERS_ACTIVO?: string;
  /** Endpoints manuales (`Authorization: Bearer …`). */
  SCRAPERS_TOKEN?: string;
  /** El mismo de los jobs (secreto `local-downloader-token`): lo exige `/raw` del relay. */
  RELAY_TOKEN?: string;
}

export const activo = (env: Env) => (env.SCRAPERS_ACTIVO ?? "").trim() === "1";
