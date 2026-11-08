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
  /** Comprobantes de aportes y de pagos (vigia-peru-privado, antes en GCS): solo los lee el panel. */
  PRIVADO?: R2Bucket;
  /** El bucket viejo de documentos (vigia-peru-documentos, antes en GCS): comprobantes con la ruta de antes. */
  DOCUMENTOS_VIEJOS?: R2Bucket;

  // vars
  FIREBASE_PROJECT_ID?: string;
  /** Los grupos de Cognito de las apps de Gobserva: «app|pool|cliente,…» (lib/cuentasApps.ts). */
  COGNITO_GOBSERVA?: string;
  /** «todas» (transición) o «planes»: qué puede pedir una cuenta de Vigía en /gobserva/cuenta. */
  GOBSERVA_CUENTAS_VIGIA?: string;
  GCS_PROJECT_ID?: string;
  GCS_BUCKET_DOCUMENTOS?: string;
  GCS_BUCKET_REPORTES?: string;
  ALLOWED_ORIGINS?: string;
  LOCAL_DOWNLOADER_URL?: string;

  /** Chat del panel (routes/admin_chat.ts): el modelo por vigia-llm y las herramientas del MCP v2, por service binding. */
  LLM?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  MCP?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  /** URL del MCP v2 que se pide por el binding (el host decide el servidor): https://mcp.gobserva.cloud/mcp */
  MCP_INTERNO_URL?: string;
  /** Secretos del chat: el token de vigia-llm y la cabecera interna que el MCP acepta como cuenta del equipo. */
  LLM_TOKEN?: string;
  MCP_INTERNO_TOKEN?: string;
  /** Service binding al Worker vigia-dispatcher (lib/dispatcher.ts: "correr el dispatcher ahora"). */
  DISPATCHER?: { fetch(input: string, init?: RequestInit): Promise<Response> };
  /** Service binding al Worker vigia-seace-zrh (routes/ordenes.ts: el expediente SIAF de una orden, a pedido). */
  SEACE_ZRH?: { fetch(input: string, init?: RequestInit): Promise<Response> };
  /** Workers AI (wrangler.jsonc → "ai"): embeddings de @cf/baai/bge-m3 para el RAG de documentos (lib/rag.ts, migración 258). */
  AI?: Ai;
  /** Límite por IP de lecturas, búsquedas y escrituras (lib/antibots.ts): un Durable Object por clave (workers/limitador.ts). */
  LIMITADOR?: DurableObjectNamespace<import("./limitador.js").Limitador>;
  /** Un informe del chat de investigación que sigue aunque se cierre la pestaña (workers/chatInforme.ts, migración 261). */
  CHAT_INFORME?: DurableObjectNamespace<import("./chatInforme.js").ChatInforme>;

  // secretos
  ADMIN_TOKEN?: string;
  /** Mercado Pago (routes/pagos.ts, lib/mercadopago.ts): en vigia-api-dev, los de la cuenta de prueba. */
  MP_ACCESS_TOKEN?: string;
  MP_PUBLIC_KEY?: string;
  MP_WEBHOOK_SECRET?: string;
  GCP_SA_KEY?: string;
  /** Secreto del widget Turnstile (lib/antibots.ts). */
  TURNSTILE_SECRET_KEY?: string;
  /** Clave de las referencias opacas de DNI y RUC 10 (lib/privacidad.ts). La misma que en Cloud Run. */
  PRIVACIDAD_CLAVE?: string;
  /** El build de la web en el CI lo manda en `x-vigia-build` para leer con la API cerrada (lib/antibots.ts). */
  BUILD_TOKEN?: string;
  /** El token de vigia-seace-zrh (el mismo del relay, SSM /vigia/relay/token). */
  SEACE_ZRH_TOKEN?: string;
  /** "si" vuelve a abrir la API al público (lib/antibots.ts → cerradaAlPublico). */
  API_PUBLICA?: string;
}
