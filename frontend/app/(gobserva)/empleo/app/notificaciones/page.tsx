import type { Metadata } from "next";
import { Suspense } from "react";
import { CabeceraPagina, Pagina } from "@/components/gobserva/app/Caja";
import { AVISOS, Vistas } from "@/components/gobserva/app/Vistas";
import { Centro } from "@/components/licitaciones-app/notificaciones/Centro";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Avisos", robots: { index: false, follow: false } };

/** El centro de notificaciones de Empleo: las plazas guardadas que cierran pronto y lo nuevo de tus alertas. */
export default function Page() {
  const base = baseProducto("empleo");
  return (
    <Pagina>
      <CabeceraPagina titulo={AVISOS.titulo} bajada={AVISOS.bajada}>
        <Vistas base={base} vistas={AVISOS.vistas} actual="recibidos" etiqueta={AVISOS.etiqueta} />
      </CabeceraPagina>
      <Suspense>
        <Centro base={base} />
      </Suspense>
    </Pagina>
  );
}
