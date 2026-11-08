import type { Metadata } from "next";
import { Asistente } from "@/components/gobserva/app/asistente/Asistente";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Asistente", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** El asistente de Empleo (2026-11-08): Claude con las herramientas del MCP de Empleo, cobrado en créditos. */
export default function AsistenteEmpleo() {
  return <Asistente app="empleo" base={baseProducto("empleo")} />;
}
