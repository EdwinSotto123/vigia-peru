"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Producto } from "@/lib/gobserva";

/**
 * Si la página se ve dentro de la app (MarcoApp: barra lateral, con la sesión abierta) o con el marco para visitantes,
 * y de qué producto es la app. La cuenta lo lee para no repetir su propia barra lateral dentro de la de la app; el
 * seguimiento, las notificaciones y la campana, para saber si son de Licitaciones o de Empleo.
 */
const ProductoApp = createContext<Producto | null>(null);

export function ProveedorApp({ producto, children }: { producto: Producto; children: ReactNode }) {
  return <ProductoApp.Provider value={producto}>{children}</ProductoApp.Provider>;
}

export const useEnApp = () => useContext(ProductoApp) !== null;

/** El producto de la app en la que estás (null fuera de la app). */
export const useProductoApp = () => useContext(ProductoApp);
