"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Magic UI — BlurFade.
 * Revela `children` con blur+fade+slide-up cuando entra en pantalla (una sola vez).
 * `delayMs` sirve para escalonar una lista (delayMs={i * 80}) sin animar cada hijo
 * por separado a mano. Recibe solo datos primitivos — seguro desde un server component.
 */
export function BlurFade({
  children,
  className,
  delayMs = 0,
  durationMs = 500,
  y = 10,
  as: Tag = "div",
  // El elemento arranca en opacity:0 incluso en el HTML servido ("use client" igual
  // renderiza en el servidor) — un rootMargin negativo en el borde inferior dispara el
  // reveal un poco ANTES de que el elemento cruce el viewport, para que contenido
  // explicativo (pasos de "cómo funciona", tarjetas de audiencia) no pueda quedar
  // atrapado en blanco si el observer tarda (JS lento, dispositivos de gama baja).
  rootMargin = "0px 0px -10% 0px",
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  durationMs?: number;
  /** Desplazamiento vertical inicial en px. */
  y?: number;
  as?: "div" | "li" | "span";
  /** rootMargin del IntersectionObserver — cuánto antes de entrar en pantalla dispara el reveal. */
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setVisible(true); return; }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        obs.disconnect();
        window.setTimeout(() => setVisible(true), delayMs);
      },
      { threshold: 0.1, rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [delayMs, rootMargin]);

  return (
    <Tag
      ref={ref as any}
      className={cn(className)}
      style={{
        opacity: visible ? 1 : 0,
        filter: visible ? "blur(0px)" : "blur(6px)",
        transform: visible ? "translateY(0)" : `translateY(${y}px)`,
        transition: `opacity ${durationMs}ms cubic-bezier(0.22,1,0.36,1), filter ${durationMs}ms cubic-bezier(0.22,1,0.36,1), transform ${durationMs}ms cubic-bezier(0.22,1,0.36,1)`,
        willChange: "opacity, filter, transform",
      }}
    >
      {children}
    </Tag>
  );
}
