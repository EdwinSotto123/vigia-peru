/**
 * Bindings del Worker `vigia-api` (wrangler.jsonc). Las variables y los secretos llegan además a
 * `process.env` (nodejs_compat con compatibility_date ≥ 2025-04-01), que es lo que lee el código
 * compartido; acá sólo se tipan. Lista completa y cómo cargarlos: CLOUDFLARE.md.
 */

export interface Env {
  /** Postgres como vigia_api (rutas públicas; 10 s por sentencia en el rol). */
  HYPERDRIVE: Hyperdrive;
  /** Postgres como vigia_api_admin (panel y tareas programadas; 120 s por sentencia en el rol). */
  HYPERDRIVE_ADMIN: Hyperdrive;
  /** Réplica R2 de documentos (vigia-peru-batch): sirve los requerimientos de contratos menores espejados desde prod6
   * (su WAF bloquea el egress de Cloudflare, así que no se pueden traer en vivo). Lo llena backend/scripts/cargar_seace_menores.py. */
  DOCUMENTOS?: R2Bucket;

  // vars
  FIREBASE_PROJECT_ID?: string;
  GCS_PROJECT_ID?: string;
  GCS_BUCKET_DOCUMENTOS?: string;
  GCS_BUCKET_REPORTES?: string;
  ALLOWED_ORIGINS?: string;
  LOCAL_DOWNLOADER_URL?: string;

  /** Service binding al Worker vigia-dispatcher (lib/dispatcher.ts: "correr el dispatcher ahora"). */
  DISPATCHER?: { fetch(input: string, init?: RequestInit): Promise<Response> };
  /** Límite por IP de lecturas, búsquedas y escrituras (lib/antibots.ts): un Durable Object por clave (workers/limitador.ts). */
  LIMITADOR?: DurableObjectNamespace<import("./limitador.js").Limitador>;

  // secretos
  ADMIN_TOKEN?: string;
  GCP_SA_KEY?: string;
  /** Secreto del widget Turnstile (lib/antibots.ts). */
  TURNSTILE_SECRET_KEY?: string;
  /** Clave de las referencias opacas de DNI y RUC 10 (lib/privacidad.ts). La misma que en Cloud Run. */
  PRIVACIDAD_CLAVE?: string;
}
