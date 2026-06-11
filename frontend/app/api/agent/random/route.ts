/**
 * GET /api/agent/random
 *
 * Elige al azar una convocatoria del SEACE (ingestada en Cloud SQL). Por
 * defecto excluye las ya analizadas — sirve para "explorar una convocatoria
 * nueva sin saber cuál". Pasá ?todas=1 para incluir las analizadas.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ORCHESTRATOR_URL =
  process.env.VIGIA_AGENT_URL ||
  "https://agent-orchestrator-adk-oq3gq6a4ka-uc.a.run.app";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const todas = searchParams.get("todas") === "1";
  try {
    const r = await fetch(
      `${ORCHESTRATOR_URL}?action=random${todas ? "&excluir_analizadas=0" : ""}`,
      { cache: "no-store" },
    );
    if (!r.ok) {
      return NextResponse.json(
        { error: "upstream_failed", status: r.status, detail: (await r.text()).slice(0, 300) },
        { status: 502 },
      );
    }
    return NextResponse.json(await r.json());
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
}
