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
 * Solo servidor: lo importan los route handlers de /api/agent/*, nunca un componente.
 */

export const ORCHESTRATOR_URL =
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

/** Cabeceras para una llamada al orquestador: `Authorization: Bearer <ID token>` si hay token. */
export async function cabecerasOrquestador(url: string = ORCHESTRATOR_URL): Promise<Record<string, string>> {
  const token = await idTokenPara(url);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
