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
  /** Cabecera `x-vigia-interno` que manda el chat del panel (vigia-api, por service binding): cuenta del equipo. */
  MCP_INTERNO_TOKEN?: string;
  /** Los grupos de Cognito de las apps de Gobserva, como en la API: «empleo|pool|cliente,licitaciones|pool|cliente». */
  COGNITO_GOBSERVA?: string;
}

/** Créditos al mes, lo más que se gasta en un día y las filas que se pueden traer en un día. */
export interface TopesMcp {
  creditos: number;
  topeDia: number;
  topeFilasDia: number;
}

/** Lo que guarda la autorización (props cifradas por la librería) y lee cada herramienta. */
export interface PropsCuenta {
  uid: string;
  nombre?: string;
  /** Con qué cuenta entró: la de una app de Gobserva (Cognito) o, sin `app`, la de Vigía (Firebase). */
  app?: "empleo" | "licitaciones";
  /** Token de refresco de Firebase: con él se pide un ID token para escribir en la API (seguir) y para releer el plan. */
  frt?: string;
  /** Token de refresco de Cognito (cuentas de las apps): lo mismo que `frt`. */
  crt?: string;
  /** Planes activos de Gobserva («licitaciones:pro», …); vacío = sin plan (desde 2026-11-08 no usa el MCP). */
  planes: string[];
  /** Los créditos del MCP de sus planes y sus topes (los calcula la API: backend/api/src/lib/creditosMcp.ts). */
  mcp?: TopesMcp;
  planesAl: number;
}

export interface Usuario extends PropsCuenta {
  scope: string[];
}

export const esDePago = (u: Usuario | null) => !!u && u.planes.length > 0;

/**
 * El MCP es de los planes de pago (2026-11-08). Las herramientas de un producto piden el plan de ese producto
 * (Obras viene con Licitaciones); las de Vigía, cualquier plan. «interno» es el chat del panel.
 */
export function tienePlanPara(planes: string[], producto: "empleo" | "licitaciones" | undefined): boolean {
  if (planes.includes("interno")) return true;
  const de = (p: string) => p.split(":")[0];
  if (producto === "empleo") return planes.some((p) => de(p) === "empleo");
  if (producto === "licitaciones") return planes.some((p) => de(p) === "licitaciones" || de(p) === "obras");
  return planes.some((p) => p.includes(":"));
}
