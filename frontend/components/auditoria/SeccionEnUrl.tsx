"use client";

import { useEffect } from "react";

/**
 * Deja en la URL la pestaña con que el servidor abrió /app/auditoria cuando no venía pedida (`?seccion=`): sin nada
 * pedido abre en la primera pestaña con contenido, y si esa no es la primera de la barra, filtrar (que conserva la
 * pestaña de la URL VIVA, `Listado`) devolvía a la primera. Con `history.replaceState`, como `Pestanas`: no recarga ni
 * ensucia el historial. Sin JS no hace falta: la página ya abrió en esa pestaña.
 */
export function SeccionEnUrl({ clave, param = "seccion" }: { clave: string; param?: string }) {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get(param)) return;
      url.searchParams.set(param, clave);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* sin URL la pestaña se ve igual; sólo no queda en el enlace */
    }
  }, [clave, param]);
  return null;
}
