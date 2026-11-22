"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Oculta lo de adentro en las rutas que calzan con `patron` (2026-11-22, auditoría de Salud: «dos buscadores a la vez»:
 * el de la barra de arriba y el de la página, con otro alcance). El patrón mira el final del camino, así sirve con la
 * ruta reescrita del servidor («/salud/medicamentos») y con la del subdominio («/medicamentos»).
 */
export function OcultarEnRutas({ patron, children }: { patron: string; children: ReactNode }) {
  const camino = usePathname() ?? "";
  // Texto y no RegExp: lo que pasa del servidor al cliente tiene que poder serializarse.
  return new RegExp(patron).test(camino.replace(/\/+$/, "") || "/") ? null : <>{children}</>;
}
