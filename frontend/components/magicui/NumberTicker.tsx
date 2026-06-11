"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Magic UI — Number Ticker.
 * Anima desde 0 (o desde `value` si direction="down") usando easing cúbico.
 * Arranca solo cuando el elemento entra al viewport.
 */
export function NumberTicker({
  value,
  direction = "up",
  duration = 1500,
  delay = 0,
  decimals = 0,
  className,
  formatter,
}: {
  value: number;
  direction?: "up" | "down";
  duration?: number;
  delay?: number;
  decimals?: number;
  className?: string;
  formatter?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(direction === "down" ? value : 0);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setInView(true);
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    let frame: number;
    let start: number | null = null;
    const from = direction === "down" ? value : 0;
    const to = direction === "down" ? 0 : value;
    const tick = (now: number) => {
      if (start === null) start = now + delay;
      if (now < start) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, direction, duration, delay]);

  const text = formatter
    ? formatter(display)
    : new Intl.NumberFormat("es-PE", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(display);

  return (
    <span ref={ref} className={cn("font-mono tabular-nums", className)}>
      {text}
    </span>
  );
}
