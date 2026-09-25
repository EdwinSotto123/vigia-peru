"use client";

/**
 * Red de seguridad para cualquier error de render que se escape en el árbol de la
 * app. En la raíz este límite reemplaza también a la cabecera y al pie del sitio,
 * así que la pantalla trae su propia firma (`conMarca`). La lógica —recarga
 * automática una sola vez ante un chunk viejo de un deploy reciente— y el diseño
 * viven en components/sitio/PantallaError.tsx, compartidos con el dashboard.
 */

import { PantallaError } from "@/components/sitio/PantallaError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PantallaError error={error} reset={reset} conMarca />;
}
