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

  // vars
  FIREBASE_PROJECT_ID?: string;
  GCS_PROJECT_ID?: string;
  GCS_BUCKET_DOCUMENTOS?: string;
  GCS_BUCKET_REPORTES?: string;
  ALLOWED_ORIGINS?: string;
  LOCAL_DOWNLOADER_URL?: string;

  // secretos
  ADMIN_TOKEN?: string;
  GCP_SA_KEY?: string;
}
