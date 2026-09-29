import { ambitoPedido, plataforma } from "./plataforma.js";

/**
 * Dispara el Cloud Run Job del dispatcher ahora mismo (en vez de esperar su próximo ciclo), con un
 * access token de la identidad del servicio, sin librerías (lib/plataforma.ts): en Cloud Run el del
 * servidor de metadatos; en Workers el de la cuenta de servicio de GCP_SA_KEY. Local no funciona.
 * Usado por POST /admin/dispatcher/run y por POST /admin/procesar-lote (para que un lote recién
 * asignado con documentos ya listos no espere el próximo ciclo de 5 min).
 */
export async function dispatchNow(): Promise<{ ok: boolean; operation: string | null; error?: string }> {
  // Desde el 27/09/2026 el dispatcher es el Worker de Cloudflare (backend/dispatcher-worker): POST /ejecutar
  // con su token. El Job de Cloud Run queda como camino alternativo si no hay DISPATCHER_URL.
  const url = process.env.DISPATCHER_URL;
  const binding = ambitoPedido.getStore()?.servicio?.("dispatcher");
  if (url || binding) {
    const token = process.env.DISPATCHER_TOKEN;
    if (!token) return { ok: false, operation: null, error: "sin_dispatcher_token" };
    try {
      // En Workers, por service binding (la URL pública de otro workers.dev de la cuenta da 1042).
      const init = { method: "POST", headers: { Authorization: `Bearer ${token}` } };
      const r = binding
        ? await binding.fetch("https://vigia-dispatcher/ejecutar", init)
        : await fetch(`${(url as string).replace(/\/$/, "")}/ejecutar`, init);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) return { ok: false, operation: null, error: j?.error ?? String(r.status) };
      return { ok: true, operation: j?.worker ?? null };
    } catch (e) {
      return { ok: false, operation: null, error: (e as Error).message };
    }
  }
  const project = process.env.GCS_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.DISPATCHER_REGION ?? "us-central1";
  const job = process.env.DISPATCHER_JOB ?? "vigia-dispatcher";
  if (!project) return { ok: false, operation: null, error: "no_project" };
  try {
    const access_token = await plataforma().tokenAccesoGoogle();
    if (access_token === null) return { ok: false, operation: null, error: "no_metadata_token" };
    const r = await fetch(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`, {
      method: "POST", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" }, body: "{}",
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, operation: null, error: j?.error?.message ?? String(r.status) };
    return { ok: true, operation: j?.name ?? null };
  } catch (e) {
    return { ok: false, operation: null, error: (e as Error).message };
  }
}
