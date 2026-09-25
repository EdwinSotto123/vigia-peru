"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * El disparador del podio de aliados (§14.6): cuando el podio entra en pantalla pone
 * `data-visto="true"` en el grupo `podio` y las columnas, medallas y corona animan
 * (clases `group-data-[visto=true]/podio:…`). Una sola vez.
 *
 * El servidor lo pinta completo y quieto (data-visto="false"): si el JS no llega, o con
 * movimiento reducido, el podio se ve igual, sin animación. Nada empieza oculto.
 */
export function PodioEscena({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visto, setVisto] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisto(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} data-visto={visto ? "true" : "false"} className={cn("group/podio", className)}>
      {children}
    </div>
  );
}
