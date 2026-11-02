import type { Metadata } from "next";
import { Suspense } from "react";
import { Entrar } from "@/components/gobserva/cuenta/Entrar";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Entrar", robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const next = typeof searchParams.next === "string" ? searchParams.next : null;
  return (
    <Suspense>
      <Entrar producto="obras" base={baseProducto("obras")} next={next} crear={searchParams.crear === "1"} />
    </Suspense>
  );
}
