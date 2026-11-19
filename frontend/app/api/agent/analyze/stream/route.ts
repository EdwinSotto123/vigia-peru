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

import type { NextRequest } from "next/server";
import { exigirAdmin } from "../_admin";
import { HAY_LAMBDAS, ORCHESTRATOR_URL, cabecerasOrquestador, tipoDeContrato, urlAgente } from "../../_orquestador";
import { fetchLargo } from "@/lib/fetch-largo";

export const dynamic = "force-dynamic";
export const maxDuration = 900;  // 15 min: lo más que corre una Lambda

/**
 * Las direcciones de documentos que se le pasan al agente salen de /api/agent/upload-doc: el almacén de documentos de los
 * procesos (`gs://` o su forma https). Cualquier otra se descarta: el agente las descarga con sus credenciales, y con
 * `gs://vigia-peru-privado/…` (comprobantes) o una URL ajena una sesión del equipo podía hacerle leer lo que no es un
 * documento de un proceso (auditoría del 2026-11-17).
 */
const DOCUMENTO_PROPIO = /^(?:gs:\/\/|https:\/\/storage\.googleapis\.com\/)(?:vigia-peru-documentos|vigia-peru-batch)\/[A-Za-z0-9._\/-]{1,600}$/;
/** Un tramo «.» o «..»: el cliente HTTP del agente lo resuelve y saldría del almacén permitido. */
const TRAMO_RELATIVO = /(?:^|\/)\.{1,2}(?:\/|$)/;
function soloDocumentosPropios(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const propio = (u: unknown): u is string => typeof u === "string" && DOCUMENTO_PROPIO.test(u) && !TRAMO_RELATIVO.test(u.replace(/^[a-z]+:\/\//, ""));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((x): x is [string, string] => propio(x[1])).slice(0, 200));
}

export async function POST(req: NextRequest) {
  // Cada corrida cuesta: solo el equipo (cookie de admin verificada) puede dispararla.
  const noAdmin = await exigirAdmin(req);
  if (noAdmin) return noAdmin;
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

  // La Lambda de la red del contrato (AWS). Sin Lambdas configuradas, el orquestador de siempre.
  let base = ORCHESTRATOR_URL;
  if (HAY_LAMBDAS) {
    const tipo = await tipoDeContrato(input, body.ocds);
    const url = urlAgente(tipo);
    if (!url) {
      return new Response(
        JSON.stringify({
          error: "red_desconocida",
          detail: tipo
            ? `No hay red de agentes para contratos de tipo «${tipo}».`
            : "No se pudo saber el tipo del contrato (bienes, servicios, obras…): Vigía no lo tiene y el OCDS no lo dice.",
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }
    base = url;
  }
  const orchUrl = `${base}?stream=1`;

  let upstream: Response;
  try {
    upstream = await fetchLargo(orchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await cabecerasOrquestador(base)) },
      body: JSON.stringify({
        input,
        ocds: body.ocds ?? null,
        docs_b64: body.docs_b64 || {},
        doc_urls: soloDocumentosPropios(body.doc_urls),
      }),
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
