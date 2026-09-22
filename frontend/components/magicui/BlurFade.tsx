"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Magic UI — BlurFade.
 * Revela `children` con blur+fade+slide-up cuando entra en pantalla (una sola vez).
 * `delayMs` sirve para escalonar una lista (delayMs={i * 80}) sin animar cada hijo
 * por separado a mano. Recibe solo datos primitivos — seguro desde un server component.
 *
 * SOLO PARA LA LANDING (modo Persuade). Está prohibido en las superficies de
 * producto: ahí el usuario entra a una tarea, no a mirar cómo carga la página,
 * y el contenido tiene que estar legible en el primer pintado.
 *
 * El motivo no es doctrinario, es un incidente real: este componente sirve
 * `opacity: 0` en el HTML del servidor y solo revela cuando el observer
 * dispara. En /app/contratos eso dejaba 11 de 14 filas invisibles —una lista
 * de 18.394 contratos que mostraba tres—, y la página se leía como un hueco
 * en blanco. Abajo se cierran además las dos trampas que lo permitieron.
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

    // Red de seguridad: pase lo que pase con el observer, a los 1200 ms el
    // contenido se muestra. Una animación que no llega a correr es un detalle;
    // contenido que nunca aparece es un defecto.
    const red = window.setTimeout(() => setVisible(true), 1200 + delayMs);

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        obs.disconnect();
        window.setTimeout(() => setVisible(true), delayMs);
      },
      // threshold 0, no 0.1: con 0.1 un elemento MÁS ALTO que el viewport nunca
      // llega a mostrar el 10% de sí mismo, así que su ratio tiene techo por
      // debajo del umbral y el reveal no dispara jamás. Basta con que asome.
      { threshold: 0, rootMargin },
    );
    obs.observe(el);
    return () => { obs.disconnect(); window.clearTimeout(red); };
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
