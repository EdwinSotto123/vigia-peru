import { NextResponse } from "next/server";
import { getRegionBudget } from "@/lib/mef-cache";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { dept: string } },
) {
  const dept = decodeURIComponent(params.dept).toUpperCase();
  const data = await getRegionBudget(dept);
  if (!data) {
    return NextResponse.json(
      {
        error: "no_cache_no_data",
        message: `${dept} no está en cache ni respondió MEF live.`,
      },
      { status: 502 },
    );
  }
  return NextResponse.json(data, {
    headers: {
      "Cache-Control":
        "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
