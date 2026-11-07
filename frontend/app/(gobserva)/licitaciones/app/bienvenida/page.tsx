import type { Metadata } from "next";
import { Bienvenida } from "@/components/licitaciones-app/onboarding/Bienvenida";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Arma tu perfil", robots: { index: false, follow: false } };

/** El onboarding: cuatro pasos para que la app sepa qué vende tu empresa. Llega aquí quien acaba de crear su cuenta. */
export default function Page() {
  return <Bienvenida base={baseProducto("licitaciones")} />;
}
