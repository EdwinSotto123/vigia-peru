/**
 * ID tokens para invocar servicios Cloud Run protegidos con IAM (roles/run.invoker).
 *
 * Los servicios de agentes (agent-orchestrator-adk, agente-servicios/obras/otros) van a pasar a
 * IAM-only (sin `allUsers`). Cloud Run exige entonces `Authorization: Bearer <ID token>` firmado
 * por Google con audiencia = URL del servicio. El token se guarda ~50 min (dura 60) y sale de
 * (lib/plataforma.ts):
 *   · Cloud Run: el servidor de metadatos (identidad de la cuenta de servicio de esta API).
 *   · Workers: la cuenta de servicio de GCP_SA_KEY (JWT firmado + canje en oauth2.googleapis.com).
 *
 * Local (`npm run dev`, sin servidor de metadatos): no manda cabecera y avisa una vez. Después del
 * cambio a IAM-only se puede probar local con `AGENT_ID_TOKEN=$(gcloud auth print-identity-token)`.
 */

import { EN_WORKERS, plataforma } from "./plataforma.js";

const TTL_MS = 50 * 60 * 1000;
// Metadatos: local al host. Workers: un canje con oauth2.googleapis.com (más lejos).
const PLAZO_MS = EN_WORKERS ? 5000 : 2000;
// K_SERVICE: servicio Cloud Run · CLOUD_RUN_JOB: job. Fuera de Cloud Run un fallo del servidor de
// metadatos es definitivo (no se reintenta en cada request); dentro, se reintenta la próxima vez.
// En Workers también se reintenta, salvo que falte GCP_SA_KEY (error `permanente`).
const EN_CLOUD_RUN = Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB);
const REINTENTA = EN_CLOUD_RUN || EN_WORKERS;

const cache = new Map<string, { token: string; expira: number }>();
const enVuelo = new Map<string, Promise<string | null>>();
let sinMetadatos = false;
let avisado = false;

/** Audiencia = origen del servicio (sin path ni query): es lo que valida Cloud Run. */
export function audienciaDe(url: string): string {
  return new URL(url).origin;
}

async function pedirToken(audiencia: string): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PLAZO_MS);
  try {
    const token = await plataforma().idTokenGoogle(audiencia, ctl.signal);
    cache.set(audiencia, { token, expira: Date.now() + TTL_MS });
    return token;
  } catch (e) {
    const definitivo = !REINTENTA || (e as { permanente?: boolean }).permanente === true;
    if (definitivo) sinMetadatos = true;
    if (!avisado || !definitivo) {
      avisado = true;
      console.warn(
        `[cloudrun-auth] sin ID token para ${audiencia} (${(e as Error).message}): la llamada va sin Authorization. ` +
        (EN_WORKERS ? "Revisar el secreto GCP_SA_KEY." : EN_CLOUD_RUN ? "Revisar el servidor de metadatos." : "Normal en local; con el servicio IAM-only usar AGENT_ID_TOKEN."),
      );
    }
    return null;
  } finally {
    clearTimeout(t);
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

/** `{ Authorization: "Bearer <ID token>" }` para invocar `url`, o `{}` si no hay token. */
export async function cabecerasInvocacion(url: string): Promise<Record<string, string>> {
  const token = await idTokenPara(url);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
