"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * La respuesta a tocar un enlace (2026-11-22). En el celular, con datos lentos, el servidor tarda uno o dos segundos en
 * armar la página de destino y la pantalla se quedaba quieta: no se sabía si el toque había entrado. Ahora, apenas se toca
 * un enlace de la misma web, arriba se enciende una franja del color del producto que avanza en escalones de píxel
 * (globals.css, `.gs-nav`) y se completa cuando llega la página. Si llega antes de 120 ms, no se ve nada.
 *
 * Sólo enlaces de este mismo sitio que cambian de página o de filtros: no los de otra pestaña, ni las descargas, ni los
 * que llevan a un ancla de la misma página. Si en 10 s no cambió la dirección (un enlace que la página intercepta), se
 * apaga sola.
 */
function Franja() {
  const ruta = usePathname();
  const busqueda = useSearchParams()?.toString() ?? "";
  const [estado, setEstado] = useState<"quieta" | "cargando" | "llega">("quieta");
  const esperando = useRef(false);

  useEffect(() => {
    if (!esperando.current) return;
    esperando.current = false;
    setEstado("llega");
    const t = setTimeout(() => setEstado((e) => (e === "llega" ? "quieta" : e)), 450);
    return () => clearTimeout(t);
  }, [ruta, busqueda]);

  useEffect(() => {
    let limite: ReturnType<typeof setTimeout> | undefined;
    const alTocar = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      let destino: URL;
      try {
        destino = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (destino.origin !== window.location.origin) return;
      if (destino.pathname === window.location.pathname && destino.search === window.location.search) return;
      esperando.current = true;
      setEstado("cargando");
      clearTimeout(limite);
      limite = setTimeout(() => {
        if (!esperando.current) return;
        esperando.current = false;
        setEstado("quieta");
      }, 10_000);
    };
    document.addEventListener("click", alTocar, true);
    return () => {
      document.removeEventListener("click", alTocar, true);
      clearTimeout(limite);
    };
  }, []);

  return <div aria-hidden className="gs-nav" data-estado={estado} />;
}

/** Va dentro del marco de cada producto (toma su `--acento`). useSearchParams pide su propio Suspense. */
export function ProgresoNavegacion() {
  return (
    <Suspense fallback={null}>
      <Franja />
    </Suspense>
  );
}
