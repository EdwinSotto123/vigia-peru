// El entorno del MCP v2 (mcp.gobserva.cloud): lo del servidor de siempre (Hyperdrive, el limitador) más la API por service
// binding, el KV del OAuth y la configuración pública de Firebase (la cuenta de Gobserva).
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../db";

export interface EnvV2 extends Env {
  /** vigia-api (o vigia-api-dev) por service binding: entra como pedido interno, sin el límite por IP de la API. */
  API: Fetcher;
  OAUTH_KV: KVNamespace;
  /** Lo pone OAuthProvider en el env de los handlers. */
  OAUTH_PROVIDER: OAuthHelpers;
  /** Origen del MCP v2, sin barra final: https://mcp.gobserva.cloud */
  MCP_URL: string;
  /** Origen de la web de Vigía para los enlaces: https://vigia.gobserva.cloud */
  VIGIA_URL: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_AUTH_DOMAIN: string;
  FIREBASE_APP_ID: string;
  /** Clave web pública de Firebase (va como secreto para no dejarla en el repo público). */
  FIREBASE_API_KEY: string;
  ENTORNO?: string;
}

/** Lo que guarda la autorización (props cifradas por la librería) y lee cada herramienta. */
export interface PropsCuenta {
  uid: string;
  nombre?: string;
  /** Token de refresco de Firebase: con él se pide un ID token para escribir en la API (seguir) y para releer el plan. */
  frt?: string;
  /** Planes activos de Gobserva («licitaciones:pro», …); vacío = gratis. */
  planes: string[];
  planesAl: number;
}

export interface Usuario extends PropsCuenta {
  scope: string[];
}

export const esDePago = (u: Usuario | null) => !!u && u.planes.length > 0;
