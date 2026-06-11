import { NextResponse } from "next/server";
import { fetchConvocatoria } from "@/lib/oece";

export const revalidate = 3600;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const data = await fetchConvocatoria(params.id);
  if (!data) {
    return NextResponse.json(
      { error: "not_found", message: `Convocatoria ${params.id} no existe en OECE` },
      { status: 404 },
    );
  }
  return NextResponse.json(data);
}
