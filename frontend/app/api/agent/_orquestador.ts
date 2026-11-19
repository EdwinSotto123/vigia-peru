/**
 * Invocación autenticada del orquestador (servicios Cloud Run de agentes).
 *
 * Los servicios de agentes (agent-orchestrator-adk, agente-servicios/obras/otros) van a pasar a
 * IAM-only (sin `allUsers`): cada corrida cuesta y cualquiera con la URL podía dispararla. Con
 * IAM, Cloud Run exige un ID token firmado por Google cuya audiencia sea la URL del servicio.
 * Este módulo lo obtiene del servidor de metadatos de Cloud Run (identidad de la cuenta de
 * servicio del frontend, que necesita roles/run.invoker en cada servicio de agentes) y lo
 * guarda ~50 min (el token dura 60).
 *
 * Local (`npm run dev`, sin servidor de metadatos): no manda cabecera y avisa una vez en consola.
 * Mientras el orquestador siga público funciona igual; después del cambio a IAM-only se puede
 * probar local con `AGENT_ID_TOKEN=$(gcloud auth print-identity-token) npm run dev`.
 *
 * Cloudflare Workers (réplica, CLOUDFLARE.md): no hay servidor de metadatos; el token se firma
 * con la llave de la misma cuenta de servicio (secreto `GCP_SA_KEY`, lib/cuenta-google.ts).
 *
 * Solo servidor: lo importan los route handlers de /api/agent/*, nunca un componente.
 */

import { idTokenDeCuenta } from "@/lib/cuenta-google";
import { EN_WORKERS } from "@/lib/entorno";
import { API_BASE } from "@/lib/api-client";

/**
 * Las Lambdas de agentes de AWS, una por red (las mismas de backend/dispatcher-worker/wrangler.jsonc): desde el
 * 2026-11-18 «Analizar» del panel corre aquí y no en Cloud Run (GCP sin facturación, servicios internos). Cada Lambda
 * corre el mismo main.py con su PIPELINE_PROFILE: un contrato de servicios en la de bienes se analizaría mal, así que la
 * red sale del tipo del contrato (`urlAgente`).
 */
const RED_DE_TIPO: Record<string, string> = {
  bienes: "BIENES", servicios: "SERVICIOS", obras: "OBRAS", consultoria: "CONSULTORIA",
  convenio: "OTROS", directa: "OTROS", otro: "OTROS",
};

/** La Lambda de la red de ese tipo de contrato, o null si no hay (sin la variable, o un tipo desconocido). */
export function urlAgente(tipo: string | null | undefined): string | null {
  const red = RED_DE_TIPO[(tipo ?? "").toLowerCase()];
  return (red && process.env[`AGENT_URL_${red}`]?.trim()) || null;
}

/** ¿Hay Lambdas configuradas? Con ellas, nada va a Cloud Run. */
export const HAY_LAMBDAS = Boolean(process.env.AGENT_URL_BIENES?.trim());

const esLambda = (url: string) => /\.lambda-url\.[a-z0-9-]+\.on\.aws$/.test(new URL(url).host);

/**
 * El tipo del contrato (bienes, servicios, obras, consultoria, convenio, directa, otro) según la API de Vigía; si no lo
 * tiene, por la categoría del OCDS que trajo el navegador (goods, services, works). Null si no se sabe.
 */
export async function tipoDeContrato(input: string, ocds?: unknown): Promise<string | null> {
  try {
    const r = await fetch(`${API_BASE}/contratos/${encodeURIComponent(input)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (r.ok) {
      const tipo = ((await r.json()) as { tipo?: unknown }).tipo;
      if (typeof tipo === "string" && tipo) return tipo.toLowerCase();
    }
  } catch {
    /* sigue con el OCDS */
  }
  const o = ocds as { tender?: { mainProcurementCategory?: string }; compiledRelease?: { tender?: { mainProcurementCategory?: string } } } | null;
  const cat = o?.compiledRelease?.tender?.mainProcurementCategory ?? o?.tender?.mainProcurementCategory;
  return ({ goods: "bienes", services: "servicios", works: "obras" } as Record<string, string>)[cat ?? ""] ?? null;
}

/** El orquestador por omisión (lecturas que no dependen del tipo, como «sortear»): la Lambda de bienes si existe. */
export const ORCHESTRATOR_URL =
  process.env.AGENT_URL_BIENES?.trim() ||
  process.env.VIGIA_AGENT_URL ||
  "https://agent-orchestrator-adk-oq3gq6a4ka-uc.a.run.app";

const METADATA_IDENTITY =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const TTL_MS = 50 * 60 * 1000;
const METADATA_TIMEOUT_MS = 2000;
// K_SERVICE: servicio Cloud Run · CLOUD_RUN_JOB: job. Fuera de Cloud Run un fallo del servidor de
// metadatos es definitivo (no se reintenta en cada request); dentro, se reintenta la próxima vez.
const EN_CLOUD_RUN = Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB);

const cache = new Map<string, { token: string; expira: number }>();
const enVuelo = new Map<string, Promise<string | null>>();
let sinMetadatos = false;
let avisado = false;

/** Audiencia = origen del servicio (sin path ni query): es lo que valida Cloud Run. */
export function audienciaDe(url: string): string {
  return new URL(url).origin;
}

async function pedirToken(audiencia: string): Promise<string | null> {
  if (EN_WORKERS) return tokenDeCuenta(audiencia);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), METADATA_TIMEOUT_MS);
  try {
    const r = await fetch(`${METADATA_IDENTITY}?audience=${encodeURIComponent(audiencia)}`, {
      headers: { "Metadata-Flavor": "Google" },
      signal: ctl.signal,
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const token = (await r.text()).trim();
    if (!token) throw new Error("respuesta vacía");
    cache.set(audiencia, { token, expira: Date.now() + TTL_MS });
    return token;
  } catch (e) {
    if (!EN_CLOUD_RUN) sinMetadatos = true;
    if (!avisado || EN_CLOUD_RUN) {
      avisado = true;
      console.warn(
        `[orquestador] sin ID token para ${audiencia} (${(e as Error).message}): la llamada va sin Authorization. ` +
        (EN_CLOUD_RUN ? "Revisar el servidor de metadatos." : "Normal en local; con el orquestador IAM-only usar AGENT_ID_TOKEN."),
      );
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Workers: el ID token sale de `GCP_SA_KEY`. Sin llave o con error, va sin Authorization (avisa). */
async function tokenDeCuenta(audiencia: string): Promise<string | null> {
  try {
    return await idTokenDeCuenta(audiencia);
  } catch (e) {
    console.warn(`[orquestador] sin ID token para ${audiencia} (${(e as Error).message}): la llamada va sin Authorization.`);
    return null;
  }
}

/** ID token para invocar `url` (o null si no se pudo obtener). */
export async function idTokenPara(url: string): Promise<string | null> {
  const manual = process.env.AGENT_ID_TOKEN?.trim();
  if (manual) return manual;
  const audiencia = audienciaDe(url);
  const hit = cache.get(audiencia);
  if (hit && hit.expira > Date.now()) return hit.token;
  if (sinMetadatos) return null;
  let p = enVuelo.get(audiencia);
  if (!p) {
    p = pedirToken(audiencia).finally(() => enVuelo.delete(audiencia));
    enVuelo.set(audiencia, p);
  }
  return p;
}

/**
 * Cabeceras para una llamada al orquestador. Lambda: `Authorization: Bearer <AGENTE_TOKEN>` (secreto de la web, el mismo
 * del SSM /vigia/agente/token que usan el dispatcher y el masivo). Cloud Run: el ID token de Google, si hay.
 */
export async function cabecerasOrquestador(url: string = ORCHESTRATOR_URL): Promise<Record<string, string>> {
  if (esLambda(url)) {
    const t = process.env.AGENTE_TOKEN?.trim();
    if (!t) console.warn("[orquestador] falta el secreto AGENTE_TOKEN: la Lambda responderá 401");
    return t ? { Authorization: `Bearer ${t}` } : {};
  }
  const token = await idTokenPara(url);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
