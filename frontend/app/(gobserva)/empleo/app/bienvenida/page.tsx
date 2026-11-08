import type { Metadata } from "next";
import { EntrevistaEmpleo } from "@/components/empleo-app/Entrevista";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Arma tu perfil", robots: { index: false, follow: false } };

/** El onboarding de Empleo: una entrevista en forma de chat para saber qué trabajo buscas. Llega aquí quien acaba de crear su cuenta. */
export default function Page() {
  return <EntrevistaEmpleo base={baseProducto("empleo")} />;
}
