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
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  durationMs?: number;
  /** Desplazamiento vertical inicial en px. */
  y?: number;
  as?: "div" | "li" | "span";
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
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [delayMs]);

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
