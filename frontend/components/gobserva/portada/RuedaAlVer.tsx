"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Para lo que se anima al cargar pero está más abajo (2026-11-22): una cifra del Odometro o el escaneo de las cien
 * clínicas ya llegaban quietos cuando alguien bajaba a verlos. Envuelto en esto, si al montar no está en pantalla, queda
 * en su estado final (`data-visto="no"`: globals.css les quita la animación) y, cuando entra, la animación vuelve a
 * empezar (`data-visto="si"`). Si ya se ve al montar, no hace nada. Sin JavaScript o con movimiento reducido, todo queda
 * quieto y completo.
 */
export function AlVer({ children, className, como = "div" }: { children: ReactNode; className?: string; como?: "div" | "span" }) {
  const ref = useRef<HTMLElement>(null);
  const [visto, setVisto] = useState<"no" | "si" | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;
    setVisto("no");
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setVisto("si");
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const Etiqueta = como;
  return (
    <Etiqueta ref={ref as never} data-visto={visto} className={className}>
      {children}
    </Etiqueta>
  );
}

/** Una cifra del Odometro que rueda cuando entra en pantalla. */
export function RuedaAlVer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <AlVer como="span" className={className}>
      {children}
    </AlVer>
  );
}
