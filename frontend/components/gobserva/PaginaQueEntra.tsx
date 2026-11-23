import type { ReactNode } from "react";

/**
 * El template.tsx de cada producto (Next lo vuelve a montar en cada cambio de página, no al cambiar sólo los filtros):
 * la página nueva entra con un fundido corto (globals.css, `.gs-pagina`). Con la franja de ProgresoNavegacion es la
 * respuesta a tocar un enlace. Server-safe.
 */
export function PaginaQueEntra({ children }: { children: ReactNode }) {
  return <div className="gs-pagina">{children}</div>;
}
