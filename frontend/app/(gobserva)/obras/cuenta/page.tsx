import type { Metadata } from "next";
import { Suspense } from "react";
import { Cuenta } from "@/components/gobserva/cuenta/Cuenta";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <Cuenta producto="obras" base={baseProducto("obras")} />
    </Suspense>
  );
}
