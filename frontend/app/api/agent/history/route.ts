/**
 * GET /api/agent/history
 *
 * Lista los análisis ya procesados (convocatorias para las que el agente
 * corrió y persistió el dictamen). Proxy a la Cloud Function en GCP.
 */
import { NextResponse } from "next/server";
import { esAlertaDemo } from "@/lib/semillas";

export const dynamic = "force-dynamic";

// La lista de análisis cacheados se sirve desde la API de datos liviana
// (no desde el orquestador ADK). Misma forma de respuesta { count, items }.
const API_BASE =
  process.env.VIGIA_API_URL ||
  process.env.NEXT_PUBLIC_VIGIA_API_URL ||
  "https://vigia-peru-api-36169102688.us-central1.run.app";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") ?? "20";
  try {
    // Sin Next data cache: un análisis recién hecho debe aparecer al instante en
    // "Análisis previos". El browser dedup vía el Cache-Control de abajo (30s).
    const r = await fetch(`${API_BASE}/alertas/analizadas?limit=${encodeURIComponent(limit)}`, {
      cache: "no-store",
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: "upstream_failed", status: r.status, detail: (await r.text()).slice(0, 300) },
        { status: 502 },
      );
    }
    const data = await r.json();
    // Fuera las alertas de DEMO sembradas en la base (ALT-2026-00xx, con RUC y
    // montos inventados) y las filas sin OCID o sin fecha de análisis: no hay
    // dossier real detrás, y listarlas es presentar como hecho algo que nadie leyó.
    if (Array.isArray(data?.items)) {
      data.items = data.items.filter(
        (it: any) => it && !esAlertaDemo(it) && !!it.ocid && !!it.analizado_en,
      );
      data.count = data.items.length;
    }
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
}
