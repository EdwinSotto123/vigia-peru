"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Revelado en píxeles: una malla de celdas carbón cubre el contenido y se disuelve,
 * celda por celda, cuando entra en pantalla. Es la firma de movimiento de la
 * identidad Píxel.
 *
 * Reglas (la lección de BlurFade, que dejó 11 de 14 filas invisibles en producción):
 *  - El servidor y el primer render pintan el contenido COMPLETO, sin overlay. La malla
 *    la monta el cliente, después de hidratar y sólo si el bloque está por debajo del
 *    pliegue: sin JS, o con movimiento reducido, no existe y no tapa nada.
 *  - El overlay es un `<canvas>` (una sola capa, no cientos de divs) con
 *    `pointer-events: none`: nunca bloquea clics.
 *  - Sin IntersectionObserver no hay overlay (nada que dispare el revelado).
 *  - Con movimiento reducido tampoco. El overlay nunca queda esperando algo que no llega.
 *  - Las celdas se dibujan con alpha: la última, ya transparente, retira el canvas.
 *
 * Úsalo en secciones y bandas de portada, nunca en tablas, formularios ni listas que se
 * actualizan: un dato no debería esperar una animación para leerse.
 */

export function PixelReveal({
  children,
  className,
  celda = 26,
  desde = "arriba",
  acento = true,
}: {
  children: ReactNode;
  className?: string;
  /** Lado de cada celda en px. */
  celda?: number;
  /** De dónde empieza a disolverse la malla. */
  desde?: "arriba" | "centro" | "izquierda";
  /** Algunas celdas lima antes de desaparecer, como chispas de la trama. */
  acento?: boolean;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [activo, setActivo] = useState(false);

  // 1. Decidir (en el cliente, tras hidratar) si hace falta overlay.
  useEffect(() => {
    const el = caja.current;
    if (!el || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined" || typeof ResizeObserver === "undefined") return;
    const r = el.getBoundingClientRect();
    // Ya a la vista (o por encima): no se tapa nada.
    if (r.top < window.innerHeight * 0.92) return;
    setActivo(true);
  }, []);

  // 2. Con el overlay montado: dibujar la malla sólida y esperar a que entre en pantalla.
  useEffect(() => {
    if (!activo) return;
    const el = caja.current;
    const cv = lienzo.current;
    if (!el || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) {
      setActivo(false);
      return;
    }

    let vivo = true;
    let raf = 0;
    let cols = 0;
    let filas = 0;
    let retardos: number[] = [];
    let chispas: boolean[] = [];
    let inicio = 0;
    let revelando = false;
    const DUR = 520; // cuánto tarda UNA celda en desvanecerse
    const BARRIDO = 780; // cuánto tarda el barrido completo

    const medir = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = el.clientWidth;
      const h = el.clientHeight;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / celda);
      filas = Math.ceil(h / celda);
      retardos = [];
      chispas = [];
      for (let j = 0; j < filas; j++) {
        for (let i = 0; i < cols; i++) {
          const nx = cols > 1 ? i / (cols - 1) : 0;
          const ny = filas > 1 ? j / (filas - 1) : 0;
          const base =
            desde === "centro"
              ? Math.hypot(nx - 0.5, (ny - 0.5) * 0.8) / 0.75
              : desde === "izquierda"
                ? nx * 0.8 + ny * 0.2
                : ny * 0.8 + nx * 0.2;
          retardos.push(base * BARRIDO * 0.62 + Math.random() * BARRIDO * 0.38);
          chispas.push(acento && Math.random() < 0.06);
        }
      }
    };

    const pintar = (t: number) => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      let quedan = false;
      for (let j = 0; j < filas; j++) {
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i;
          const a = revelando ? 1 - Math.min(1, Math.max(0, (t - retardos[k]) / DUR)) : 1;
          if (a <= 0) continue;
          quedan = true;
          ctx.globalAlpha = a;
          ctx.fillStyle = chispas[k] && a < 1 ? "#D4FF3F" : "#0B0F0F";
          ctx.fillRect(i * celda, j * celda, celda + 0.5, celda + 0.5);
        }
      }
      ctx.globalAlpha = 1;
      return quedan;
    };

    const bucle = (ahora: number) => {
      if (!vivo) return;
      const t = ahora - inicio;
      if (pintar(t)) raf = requestAnimationFrame(bucle);
      else setActivo(false);
    };

    medir();
    pintar(0);

    const ro = new ResizeObserver(() => {
      if (!revelando) {
        medir();
        pintar(0);
      }
    });
    ro.observe(el);

    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || revelando) return;
        revelando = true;
        inicio = performance.now();
        raf = requestAnimationFrame(bucle);
        io.disconnect();
      },
      { threshold: 0.18 },
    );
    io.observe(el);

    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [activo, celda, desde, acento]);

  return (
    <div ref={caja} className={cn("relative", className)}>
      {children}
      {activo && (
        <canvas ref={lienzo} aria-hidden className="pointer-events-none absolute left-0 top-0 z-30" />
      )}
    </div>
  );
}
