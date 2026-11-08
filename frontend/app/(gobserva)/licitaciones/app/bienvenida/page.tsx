import type { Metadata } from "next";
import { Entrevista } from "@/components/licitaciones-app/onboarding/Entrevista";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Arma tu perfil", robots: { index: false, follow: false } };

/** El onboarding: una entrevista en forma de chat para que la app sepa qué vende tu empresa. Llega aquí quien acaba de crear su cuenta. */
export default function Page() {
  return <Entrevista base={baseProducto("licitaciones")} />;
}
