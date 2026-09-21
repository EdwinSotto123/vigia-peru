"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const FORMATOS: Record<string, (n: number) => string> = {
  entero: (n) => Math.round(n).toLocaleString("es-PE"),
  pen: (n) => `S/ ${Math.round(n).toLocaleString("es-PE")}`,
};

/**
 * Magic UI — NumberTicker.
 * Cuenta desde 0 hasta `value` cuando el número entra en pantalla (una sola vez). Si `value`
 * cambia DESPUÉS de esa primera animación — p.ej. AliadosStats corrige en el cliente un dato
 * que llegó desactualizado del servidor — se corrige con una animación corta en vez de
 * quedarse pegado para siempre en el primer valor mostrado (el guard de "una sola vez" antes
 * tapaba cualquier cambio posterior de `value`, sin importar que sí llegaran datos nuevos).
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
  const mostradoRef = useRef(0);
  mostradoRef.current = mostrado;
  const empezado = useRef(false);
  const ultimoValor = useRef<number | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const animarHacia = (desde: number) => {
      if (reduce) { setMostrado(value); return; }
      const t0 = performance.now();
      const paso = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        // ease-out cubic: arranca rápido, se asienta suave — se siente "vivo", no mecánico.
        const eased = 1 - Math.pow(1 - p, 3);
        setMostrado(desde + (value - desde) * eased);
        if (p < 1) requestAnimationFrame(paso);
        else setMostrado(value);
      };
      requestAnimationFrame(paso);
    };

    // Ya entró en pantalla antes: si `value` cambió desde entonces, corrige ya mismo desde
    // lo que se ve ahora — no hace falta esperar a que vuelva a cruzar el viewport.
    if (empezado.current) {
      if (ultimoValor.current !== value) {
        ultimoValor.current = value;
        animarHacia(mostradoRef.current);
      }
      return;
    }

    const el = ref.current;
    if (!el) return;
    if (reduce) { empezado.current = true; ultimoValor.current = value; setMostrado(value); return; }

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || empezado.current) return;
        empezado.current = true;
        ultimoValor.current = value;
        obs.disconnect();
        animarHacia(0);
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
