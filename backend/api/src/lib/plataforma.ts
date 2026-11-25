/**
 * Lo que cambia entre los dos lugares donde corre la API: Cloud Run (Node, `src/index.ts`) y
 * Cloudflare Workers (`src/worker.ts`). La app, las rutas, la SQL y las cachés son el mismo código.
 *
 *   · `EN_WORKERS`: se decide al cargar el módulo (workerd se presenta como "Cloudflare-Workers").
 *   · Servicios con SDK propio de cada lado (verificar ID tokens de Firebase, GCS, credenciales de
 *     Google): cada entrada registra los suyos con `fijarPlataforma` al arrancar (node/plataforma.ts,
 *     workers/plataforma.ts). Así firebase-admin y @google-cloud/storage nunca entran en el Worker.
 *   · Ámbito del pedido (sólo Workers): los sockets no se reusan entre pedidos, así que cada pedido
 *     abre sus propios pools de Postgres (lib/db.ts) y anota lo que sigue después de responder
 *     (`enSegundoPlano` → ctx.waitUntil). En Node no hay ámbito y todo funciona como siempre.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

export const EN_WORKERS = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent === "Cloudflare-Workers";

/** Claims de un ID token de Firebase ya verificado (`uid` = `sub`, como firebase-admin). */
export interface TokenVerificado {
  uid: string;
  email?: string;
  /** El proyecto de Firebase que lo firmó: el de Vigía o el de una app de Gobserva (lib/cuentasApps.ts). */
  proyecto?: string;
  [claim: string]: unknown;
}

/** Opciones de una URL firmada v4 (mismos nombres que `getSignedUrl` de @google-cloud/storage). */
export interface OpcionesFirma {
  action: "read" | "write";
  expires: number;
  contentType?: string;
  responseDisposition?: string;
  responseType?: string;
}

/** Lo que se usa de un bucket de R2 (el tipo R2Bucket de Workers, sin depender de @cloudflare/workers-types acá). */
export interface ObjetoAlmacen {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface Almacen {
  get(clave: string): Promise<ObjetoAlmacen | null>;
  head(clave: string): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>;
}

export interface MetadatosObjeto {
  contentType?: string;
  size?: string | number;
}

export interface Plataforma {
  /** Verifica un ID token de Firebase (firma, proyecto, vencimiento); tira si no vale. */
  verificarIdToken(token: string): Promise<TokenVerificado>;
  /** URL firmada v4 de `gs://bucket/ruta`. */
  firmarUrl(bucket: string, ruta: string, opciones: OpcionesFirma): Promise<string>;
  metadatosObjeto(bucket: string, ruta: string): Promise<MetadatosObjeto>;
  descargarObjeto(bucket: string, ruta: string): Promise<Uint8Array<ArrayBuffer>>;
  /** ID token de Google con audiencia `audiencia` (invocar Cloud Run IAM-only); tira si no se pudo. */
  idTokenGoogle(audiencia: string, signal: AbortSignal): Promise<string>;
  /** Access token OAuth2 (cloud-platform) de la identidad del servicio; null si no lo dan. */
  tokenAccesoGoogle(): Promise<string | null>;
}

let actual: Plataforma | null = null;

export function fijarPlataforma(p: Plataforma): void {
  actual = p;
}

export function plataforma(): Plataforma {
  if (!actual) throw new Error("plataforma sin registrar: la entrada (index.ts o worker.ts) importa node/ o workers/plataforma.js");
  return actual;
}

// ─── Ámbito del pedido (Workers) ─────────────────────────────────────────────
export type RolDb = "api" | "admin";

export interface AmbitoPedido {
  /** Pool de Postgres de ESTE pedido para el rol: se abre al primer uso y se cierra al terminar. */
  pool(rol: RolDb): pg.Pool;
  /** Trabajo que sigue después de responder: el pedido no se cierra hasta que termina. */
  seguir(p: Promise<unknown>): void;
  /**
   * Otro Worker por service binding (solo en Workers). Un Worker no puede llamar por su URL pública a
   * otro *.workers.dev de la misma cuenta (error 1042): el dispatcher se llama por acá.
   */
  servicio?(nombre: "dispatcher" | "seace_zrh"): { fetch(input: string, init?: RequestInit): Promise<Response> } | undefined;
  /** Límite por clave exacto entre todas las instancias (Durable Object, workers/limitador.ts); sin él, en memoria. */
  /**
   * Un bucket de R2 por el nombre que tenía en GCS (vigia-peru-batch, vigia-peru-privado…): GCP quedó sin facturación y
   * sus buckets ya no responden; las copias viven en R2 con las mismas rutas (solo en Workers).
   */
  almacen?(bucket: string): Almacen | undefined;
  limitador?(): {
    /** `n`: el pedido vale por varios (entra sólo si caben todos). */
    contar(clave: string, tope: number, ventanaS: number, persistente?: boolean, n?: number): Promise<boolean>;
    cuantas(clave: string, ventanaS: number, persistente?: boolean): Promise<number>;
    /** Las marcas vigentes (ms), de la más vieja a la más nueva. */
    marcas?(clave: string, ventanaS: number, persistente?: boolean): Promise<number[]>;
    /** Quita las `n` marcas más nuevas; devuelve cuántas quedan. */
    devolver?(clave: string, n: number, ventanaS: number, persistente?: boolean): Promise<number>;
    /** Lo usado del MCP por una cuenta en el mes y el día de Lima (workers/limitador.ts). */
    usoMcp?(uid: string, mes: string, dia: string): Promise<{ mes: number; dia: number; filas: number }>;
    /** Suma créditos (y filas) a la cuenta: lo usa el chat de cada app (routes/gobservaCuenta.ts). */
    gastarMcp?(uid: string, mes: string, dia: string, creditos: number, filas: number): Promise<{ mes: number; dia: number; filas: number }>;
  } | undefined;
}

export const ambitoPedido = new AsyncLocalStorage<AmbitoPedido>();

/**
 * Marca `p` como trabajo que sigue después de responder (refresco de caché en segundo plano, sondeo
 * de salud). En Workers el pedido lo espera (ctx.waitUntil) antes de cerrar sus conexiones; en
 * Node no hace nada: el proceso sigue vivo igual.
 */
export function enSegundoPlano<T>(p: Promise<T>): Promise<T> {
  ambitoPedido.getStore()?.seguir(p);
  return p;
}
