import type { Metadata } from "next";
import { Suspense } from "react";
import { Entrar } from "@/components/gobserva/cuenta/Entrar";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Entrar", robots: { index: false, follow: false } };

/** Entrar o crear la cuenta gratis de Gobserva Salud (2026-11-21): su propio grupo en Cognito, sin planes. */
export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const next = typeof searchParams.next === "string" ? searchParams.next : null;
  return (
    <Suspense>
      <Entrar producto="salud" base={baseProducto("salud")} next={next} crear={searchParams.crear === "1"} />
    </Suspense>
  );
}
