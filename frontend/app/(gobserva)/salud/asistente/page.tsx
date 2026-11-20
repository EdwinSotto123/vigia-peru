import type { Metadata } from "next";
import { AsistenteSalud } from "@/components/salud/asistente/AsistenteSalud";
import { urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Asistente",
  description:
    "Pregúntale al asistente de Gobserva Salud por una clínica, un hospital, sus sanciones firmes o cómo verificar a un médico: responde con fuentes oficiales y su fecha. Gratis y sin cuenta.",
  alternates: { canonical: urlCanonica("salud", "/asistente") },
};

/** La conversación vive en el navegador (sessionStorage): la página se arma en cada pedido sólo por la base del host. */
export const dynamic = "force-dynamic";

/**
 * El asistente público de Gobserva Salud (POST /salud/asistente). `?pregunta=` llega desde una ficha
 * (PreguntaRapida): queda escrita en el campo para que la persona la mande.
 */
export default function PaginaAsistente({ searchParams }: { searchParams: { pregunta?: string | string[] } }) {
  const base = baseProducto("salud");
  const pregunta = typeof searchParams.pregunta === "string" ? searchParams.pregunta.trim().slice(0, 4000) : undefined;
  return <AsistenteSalud base={base} pregunta={pregunta || undefined} />;
}
