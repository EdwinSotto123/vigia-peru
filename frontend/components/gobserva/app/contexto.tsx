"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Si la página se ve dentro de la app (MarcoApp: barra lateral, con la sesión abierta) o con el marco para visitantes.
 * La cuenta lo lee para no repetir su propia barra lateral dentro de la de la app.
 */
const EnApp = createContext(false);

export function ProveedorApp({ children }: { children: ReactNode }) {
  return <EnApp.Provider value>{children}</EnApp.Provider>;
}

export const useEnApp = () => useContext(EnApp);
