"use client";

import type { ReactNode } from "react";
import { useDossierDrawer, type DetalleDrawer } from "./DossierDrawer";

/**
 * Hace clickeable un bloque del dossier: al hacer clic abre el drawer lateral con `detalle`, sin salir de la pestaña.
 * Es un componente CLIENTE para poder usar el hook del drawer desde componentes server (como la lista de órdenes).
 */
export function AbrirDetalle({
  detalle,
  className,
  etiqueta,
  children,
}: {
  detalle: DetalleDrawer;
  className?: string;
  /** aria-label del botón (qué se abre). */
  etiqueta?: string;
  children: ReactNode;
}) {
  const { abrir } = useDossierDrawer();
  return (
    <button type="button" aria-label={etiqueta} className={className} onClick={() => abrir(detalle)}>
      {children}
    </button>
  );
}
