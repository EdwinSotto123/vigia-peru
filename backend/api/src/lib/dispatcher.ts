/**
 * Dispara el Cloud Run Job del dispatcher ahora mismo (en vez de esperar su próximo ciclo),
 * usando el token de la propia service account del servicio (metadata server, sin librerías).
 * Solo funciona desplegado en Cloud Run. Usado por POST /admin/dispatcher/run y por
 * POST /admin/procesar-lote (para que un lote recién asignado con documentos ya listos no
 * espere el próximo ciclo de 5 min).
 */
export async function dispatchNow(): Promise<{ ok: boolean; operation: string | null; error?: string }> {
  const project = process.env.GCS_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.DISPATCHER_REGION ?? "us-central1";
  const job = process.env.DISPATCHER_JOB ?? "vigia-dispatcher";
  if (!project) return { ok: false, operation: null, error: "no_project" };
  try {
    const tok = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
    if (!tok.ok) return { ok: false, operation: null, error: "no_metadata_token" };
    const { access_token } = (await tok.json()) as { access_token: string };
    const r = await fetch(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`, {
      method: "POST", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" }, body: "{}",
    });
    const j = await r.json().catch(() => ({}) as any);
    if (!r.ok) return { ok: false, operation: null, error: j?.error?.message ?? String(r.status) };
    return { ok: true, operation: j?.name ?? null };
  } catch (e) {
    return { ok: false, operation: null, error: (e as Error).message };
  }
}
