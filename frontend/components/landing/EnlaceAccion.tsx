import type { ComponentProps } from "react";
import { EnlaceAccion as Accion } from "@/components/ui/EnlaceAccion";

/**
 * La acción de la portada: la misma pieza de `ui/EnlaceAccion`, en su tamaño
 * grande (48 px) y con flecha por defecto. Cualquier prop explícita manda.
 */
export function EnlaceAccion(props: ComponentProps<typeof Accion>) {
  return <Accion tamano="md" flecha {...props} />;
}
