"use client";

/**
 * Error de una página del dashboard. Sin este archivo, el error subía hasta
 * app/error.tsx, que reemplaza también al layout del dashboard: la barra lateral
 * desaparecía y no quedaba navegación. Acá el límite queda DEBAJO del layout, así
 * que la barra sigue en su lugar y sólo se reemplaza el contenido. Misma pantalla
 * y misma recarga automática ante un chunk viejo que la raíz, sin la firma: la
 * barra lateral ya la muestra.
 */

import { PantallaError } from "@/components/sitio/PantallaError";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PantallaError error={error} reset={reset} />;
}
