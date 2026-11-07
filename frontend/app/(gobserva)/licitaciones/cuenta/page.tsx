import type { Metadata } from "next";
import { Suspense } from "react";
import { Cuenta } from "@/components/gobserva/cuenta/Cuenta";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false, follow: false } };

/** La cuenta de Licitaciones; los planes del catálogo van a «Plan y pagos» (la tabla que compara). */
export default async function Page() {
  const catalogo = await planesServidor("licitaciones");
  return (
    <Suspense>
      <Cuenta producto="licitaciones" base={baseProducto("licitaciones")} catalogo={catalogo} />
    </Suspense>
  );
}
