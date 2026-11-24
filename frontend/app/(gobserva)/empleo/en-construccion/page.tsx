import type { Metadata } from "next";
import { EnConstruccion } from "@/components/gobserva/EnConstruccion";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "En construcción", robots: { index: false, follow: true } };

/** La app de Empleo (/app/*) mientras está en construcción: el middleware reescribe aquí (lib/gobserva.ts, APP_EN_CONSTRUCCION). */
export default function Page() {
  return <EnConstruccion producto="empleo" base={baseProducto("empleo")} />;
}
