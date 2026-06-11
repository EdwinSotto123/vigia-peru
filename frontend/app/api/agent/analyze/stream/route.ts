/**
 * POST /api/agent/analyze/stream
 *
 * Variante streaming del bridge: hace el mismo setup que `/api/agent/analyze`
 * (OCDS + PDFs + GCS archive) pero proxea el response del orchestrator como
 * NDJSON line-per-event en tiempo real. El cliente consume el stream con
 * `ReadableStream` y muestra hallazgos parciales mientras los agentes corren.
 *
 * El último evento del stream es `{kind: "final", ...}`. Tras recibirlo, el
 * cliente debe llamar a `/api/agent/history/<ocid>` para obtener el shape
 * adaptado (ya persistido en Cloud SQL por el orchestrator).
 */

import { Agent as UndiciAgent } from "undici";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;  // 60 min — Cloud Run max es 3600s

const LONG_TIMEOUT_DISPATCHER = new UndiciAgent({
  headersTimeout: 3_600_000,  // 60 min
  bodyTimeout: 3_600_000,
  connectTimeout: 30_000,
});

const ORCHESTRATOR_URL =
  process.env.VIGIA_AGENT_URL ||
  "https://agent-orchestrator-adk-oq3gq6a4ka-uc.a.run.app";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const input = (body.input ?? "").toString().trim();
  if (!input) {
    return new Response(
      JSON.stringify({ error: "missing 'input'" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // `ocds` es OPCIONAL: si el browser no lo pudo pre-cargar (OECE bloquea el
  // relay con 403), lo mandamos vacío y el orquestador lo trae por el
  // downloader local (IP residencial PE). Igual con los documentos.

  // Proxy del stream hacia el orchestrator. No archivamos a GCS acá — el
  // path streaming asume que el non-streaming fue llamado antes o que el
  // orchestrator puede operar con `docs_b64` inline. Esto simplifica el
  // pipeline y minimiza latencia para mostrar la primera bandera.
  const orchUrl = `${ORCHESTRATOR_URL}?stream=1`;

  let upstream: Response;
  try {
    upstream = await fetch(orchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        ocds: body.ocds ?? null,
        docs_b64: body.docs_b64 || {},
        doc_urls: body.doc_urls || {},
      }),
      // @ts-expect-error undici dispatcher
      dispatcher: LONG_TIMEOUT_DISPATCHER,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "upstream_unreachable", detail: (e as Error).message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: "upstream_error", status: upstream.status, detail: text.slice(0, 500) }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  // Re-stream el body como NDJSON. Pasa los chunks 1:1 al cliente.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
