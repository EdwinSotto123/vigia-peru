"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const FORMATOS: Record<string, (n: number) => string> = {
  entero: (n) => Math.round(n).toLocaleString("es-PE"),
  pen: (n) => `S/ ${Math.round(n).toLocaleString("es-PE")}`,
};

/**
 * Magic UI — NumberTicker.
 * Cuenta desde 0 hasta `value` cuando el número entra en pantalla (una sola vez).
 * Recibe solo datos primitivos — puede montarse directo desde un server component
 * (p.ej. HeroCompacto) sin cruzar funciones por el límite server/client. Por eso
 * `format` es un string (una clave de FORMATOS), no una función: un server component
 * SÍ puede pasar `format="pen"`, pero NUNCA `formatear={formatPEN}` (React no puede
 * serializar una función a través de ese límite — rompe en producción, no en build).
 */
export function NumberTicker({
  value,
  className,
  duration = 1200,
  format = "entero",
}: {
  value: number;
  className?: string;
  /** Duración del conteo en ms. */
  duration?: number;
  format?: keyof typeof FORMATOS;
}) {
  const formatear = FORMATOS[format] ?? FORMATOS.entero;
  const ref = useRef<HTMLSpanElement | null>(null);
  const [mostrado, setMostrado] = useState(0);
  const empezado = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Sin JS/reduced-motion o si ya se disparó: no repetir la animación.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setMostrado(value); return; }

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || empezado.current) return;
        empezado.current = true;
        obs.disconnect();
        const t0 = performance.now();
        const paso = (t: number) => {
          const p = Math.min(1, (t - t0) / duration);
          // ease-out cubic: arranca rápido, se asienta suave — se siente "vivo", no mecánico.
          const eased = 1 - Math.pow(1 - p, 3);
          setMostrado(value * eased);
          if (p < 1) requestAnimationFrame(paso);
          else setMostrado(value);
        };
        requestAnimationFrame(paso);
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [value, duration]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {formatear(mostrado)}
    </span>
  );
}
