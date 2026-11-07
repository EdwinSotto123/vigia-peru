import type { Metadata } from "next";
import { Suspense } from "react";
import { CabeceraPagina, Pagina } from "@/components/gobserva/app/Caja";
import { Centro } from "@/components/licitaciones-app/notificaciones/Centro";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Notificaciones", robots: { index: false, follow: false } };

/** El centro de notificaciones: los plazos que vencen de lo que sigues y lo nuevo de tus alertas. */
export default function Page() {
  const base = baseProducto("licitaciones");
  return (
    <Pagina>
      <CabeceraPagina titulo="Notificaciones" bajada="Lo que vence pronto de lo que sigues y lo nuevo que encontraron tus alertas. Cada aviso lleva a donde actuar." />
      <Suspense>
        <Centro base={base} />
      </Suspense>
    </Pagina>
  );
}
