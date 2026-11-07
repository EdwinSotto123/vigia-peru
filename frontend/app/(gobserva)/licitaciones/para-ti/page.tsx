import type { Metadata } from "next";
import { ParaTi } from "@/components/licitaciones/ParaTi";
import { urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Para ti",
  description: "Las licitaciones y los contratos menores abiertos, ordenados por cuánto se parecen a lo que vende tu empresa.",
  alternates: { canonical: urlCanonica("licitaciones", "/para-ti") },
};

/**
 * «Para ti» de Gobserva Licitaciones (2026-11-07): las oportunidades abiertas ordenadas por afinidad con las líneas de
 * negocio de la cuenta (components/licitaciones/ParaTi.tsx; GET /gobserva/cuenta/para-ti).
 */
export default function PaginaParaTi() {
  const base = baseProducto("licitaciones");
  return (
    <div className="container-page py-8 sm:py-12">
      <header className="max-w-3xl">
        <h1 className="font-display text-cifra font-bold leading-tight tracking-tight text-ink sm:text-titulo">Para ti</h1>
        <p className="mt-1.5 text-pretty text-cuerpo leading-relaxed text-inkSoft">
          Las licitaciones y los contratos menores abiertos, de lo más parecido a lo que vende tu empresa a lo menos. Se actualiza cada hora.
        </p>
      </header>
      <div className="mt-6">
        <ParaTi base={base} />
      </div>
    </div>
  );
}
