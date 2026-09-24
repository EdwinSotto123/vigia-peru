/**
 * GET /api/agent/history/[ocid]
 *
 * Carga un análisis ya cacheado (sin reanalizar) por OCID/codigo_convocatoria/codigo de alerta.
 * Devuelve la misma forma que /api/agent/analyze para que la UI lo renderice
 * sin cambios.
 */
import { NextResponse } from "next/server";
import { gzipSync } from "zlib";
import { adaptLoadedToUi } from "@/lib/dossier-adaptar";
import { esAlertaDemo } from "@/lib/semillas";

export const dynamic = "force-dynamic";

// La LECTURA de un dossier cacheado va a la API de datos liviana
// (vigia-peru-api, 512Mi, pool de conexiones caliente), NO al orquestador ADK
// (8Gi, maxScale=1) que solo debe ANALIZAR. El dato vive en el mismo Cloud SQL.
const API_BASE =
  process.env.VIGIA_API_URL ||
  process.env.NEXT_PUBLIC_VIGIA_API_URL ||
  "https://vigia-peru-api-36169102688.us-central1.run.app";

export async function GET(req: Request, { params }: { params: { ocid: string } }) {
  try {
    const ocid = decodeURIComponent(params.ocid);
    // OJO: NO usar Next data cache (revalidate) acá. Cachearía también los 404
    // del lag de persist (~1-3s post-análisis) por 1h y dejaría el dossier
    // "no analizado" aunque ya esté listo. La velocidad la dan el Cache-Control
    // de la respuesta (solo 200s, en el browser/edge) + el cache de cliente.
    const r = await fetch(`${API_BASE}/alertas/${encodeURIComponent(ocid)}/full`, {
      cache: "no-store",
    });
    if (r.status === 404) {
      return NextResponse.json({ error: "not_found", query: ocid }, { status: 404 });
    }
    if (!r.ok) {
      return NextResponse.json(
        { error: "upstream_failed", status: r.status, detail: (await r.text()).slice(0, 300) },
        { status: 502 },
      );
    }
    const loaded = await r.json();
    if (loaded?.error) return NextResponse.json(loaded, { status: 404 });
    // Las 10 alertas de demo `ALT-2026-00xx` viven en la base de producción
    // (ver lib/semillas.ts): sin registro OCDS ni fecha de análisis. No son un
    // dossier; para la interfaz no existen.
    if (esAlertaDemo({ codigo: loaded?.alerta_codigo }) || (!loaded?.ocds_payload && !loaded?.analizado_en)) {
      return NextResponse.json({ error: "not_found", query: ocid }, { status: 404 });
    }

    // El dossier pesa ~480 KB sin comprimir y Next no gzipea las route handlers
    // en Cloud Run → lo comprimimos a mano (zlib). gzip baja JSON ~8-10x.
    const json = JSON.stringify(adaptLoadedToUi(loaded));
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      // Un dossier se puede reprocesar (lib/dossier-cache.ts promete que una
      // recarga trae la última corrida): cache corto, no de una hora.
      "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
    };
    const accepts = req.headers.get("accept-encoding") || "";
    if (accepts.includes("gzip")) {
      const gz = gzipSync(Buffer.from(json));
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
      return new Response(gz, { status: 200, headers });
    }
    return new Response(json, { status: 200, headers });
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
}
