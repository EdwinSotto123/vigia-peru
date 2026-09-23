/**
 * GET /api/agent/random
 *
 * Elige al azar una convocatoria del SEACE (ingestada en Cloud SQL). Por
 * defecto excluye las ya analizadas — sirve para "explorar una convocatoria
 * nueva sin saber cuál". Con ?todas=1 incluye las analizadas.
 *
 * Solo equipo: despierta al orquestador (8 GiB, una sola instancia) y su único
 * uso es elegir un contrato para despachar un análisis pagado.
 */
import { NextResponse, type NextRequest } from "next/server";
import { exigirAdmin } from "../analyze/_admin";
import { ORCHESTRATOR_URL, cabecerasOrquestador } from "../_orquestador";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const noAdmin = await exigirAdmin(req);
  if (noAdmin) return noAdmin;
  const { searchParams } = new URL(req.url);
  const todas = searchParams.get("todas") === "1";
  try {
    const r = await fetch(
      `${ORCHESTRATOR_URL}?action=random${todas ? "&excluir_analizadas=0" : ""}`,
      { cache: "no-store", headers: await cabecerasOrquestador(ORCHESTRATOR_URL) },
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
