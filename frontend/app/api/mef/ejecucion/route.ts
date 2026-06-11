import { NextResponse } from "next/server";
import { fetchMefBudget } from "@/lib/mef";

export const revalidate = 3600;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const searchIn =
    (searchParams.get("in") as "PLIEGO_NOMBRE" | "EJECUTORA_NOMBRE" | null) ??
    "PLIEGO_NOMBRE";

  if (!q || q.trim().length < 3) {
    return NextResponse.json(
      { error: "query_too_short", message: "Mínimo 3 caracteres" },
      { status: 400 },
    );
  }

  const data = await fetchMefBudget(q.trim(), { searchIn });
  if (!data) {
    return NextResponse.json(
      { error: "fetch_failed", message: "MEF no respondió" },
      { status: 502 },
    );
  }
  return NextResponse.json(data);
}
