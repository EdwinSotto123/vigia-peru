import type { Metadata } from "next";
import { Suspense } from "react";
import { Pausar } from "@/components/gobserva/cuenta/Pausar";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Pausar una alerta", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <Pausar producto="licitaciones" base={baseProducto("licitaciones")} />
    </Suspense>
  );
}
