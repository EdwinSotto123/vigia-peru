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

// El API da como mucho 100 filas por pedido (zod de /alertas/analizadas); más allá se pagina con
// `offset`. Tope de 1.000 para que un `?limit=` grande no dispare decenas de pedidos.
const POR_PAGINA = 100;
const TOPE = 1000;

// Sin Next data cache: un análisis recién hecho debe aparecer al instante en
// "Análisis previos". El browser dedup vía el Cache-Control de abajo (30s).
async function pagina(limit: number, offset: number): Promise<{ items: unknown[]; total: number | null }> {
  const r = await fetch(`${API_BASE}/alertas/analizadas?limit=${limit}&offset=${offset}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`upstream ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = (await r.json()) as { items?: unknown[]; total?: unknown };
  return { items: Array.isArray(d?.items) ? d.items : [], total: typeof d?.total === "number" ? d.total : null };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pedido = Math.min(Math.max(Number(searchParams.get("limit")) || 20, 1), TOPE);
  try {
    const primera = await pagina(Math.min(pedido, POR_PAGINA), 0);
    const items = [...primera.items];
    // Las páginas que faltan, en paralelo, hasta el pedido o el total real (lo que sea menor).
    const hasta = Math.min(pedido, primera.total ?? items.length);
    const offsets: number[] = [];
    for (let o = POR_PAGINA; o < hasta; o += POR_PAGINA) offsets.push(o);
    const resto = await Promise.all(offsets.map((o) => pagina(Math.min(POR_PAGINA, hasta - o), o)));
    for (const r of resto) items.push(...r.items);
    const data: { count: number; total: number | null; items: any[] } = { count: items.length, total: primera.total, items };
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
      { error: "upstream_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
}
