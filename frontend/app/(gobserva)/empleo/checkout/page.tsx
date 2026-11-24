import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { rutaEn } from "@/lib/gobserva";
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
import { Checkout } from "@/components/gobserva/cuenta/Checkout";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Contratar", robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  // Cobros en pausa (2026-11-24): no se vende nada; /planes dice qué trae gratis una cuenta con el correo confirmado.
  if (COBROS_EN_PAUSA) redirect(rutaEn(baseProducto("empleo"), "/planes"));
  const plan = typeof searchParams.plan === "string" && /^[a-z]{3,15}$/.test(searchParams.plan) ? searchParams.plan : null;
  return (
    <Suspense>
      <Checkout producto="empleo" base={baseProducto("empleo")} plan={plan} />
    </Suspense>
  );
}
