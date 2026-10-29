"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Una pestaña pesada que no estaba abierta al cargar: en vez de viajar con la página (en el Minsa, sus visitas eran 12 MB,
 * su organización 6 MB y su historia 4 MB de los 28 MB de la ficha, aunque se abriera sólo el Inicio), se pide al
 * abrirla. `Pestanas` la monta la primera vez que se abre; entonces pide la misma página con esa pestaña abierta (el
 * servidor arma sólo ésa) sin mover la vista, y mientras llega muestra su esqueleto. Las livianas siguen viajando con la
 * página, así cambiar a ellas sigue siendo instantáneo.
 */
export function PestanaAPedido({ clave, param = "seccion", children }: { clave: string; param?: string; children: ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set(param, clave);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [clave, param, router]);
  return <>{children}</>;
}
