import type { Metadata } from "next";
import { Suspense } from "react";
import { Checkout } from "@/components/gobserva/cuenta/Checkout";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Contratar", robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const plan = typeof searchParams.plan === "string" && /^[a-z]{3,15}$/.test(searchParams.plan) ? searchParams.plan : null;
  return (
    <Suspense>
      <Checkout producto="licitaciones" base={baseProducto("licitaciones")} plan={plan} />
    </Suspense>
  );
}
