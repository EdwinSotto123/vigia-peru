"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { cn } from "@/lib/utils";
import { Odometro } from "./Odometro";

export interface OpcionPrueba {
  /** El botón: «Técnico», «Agua potable». */
  etiqueta: string;
  /** La cifra de hoy, ya con su formato («1,204», «S/ 3,200»). */
  cifra: string;
  /** Lo que cuenta la cifra: «plazas que puedes postular hoy». */
  unidad: ReactNode;
  /** Una línea con un caso real: «La que cierra primero: …». */
  detalle?: ReactNode;
  href: string;
  /** El botón de abajo: «Ver esas plazas». */
  accion: string;
}

/**
 * «Pruébalo» (2026-11-22, el usuario: «portadas vivas», «que llame a usarlo, entendible»): una pregunta con sus
 * respuestas como botones y, debajo, lo que Gobserva encuentra HOY para esa respuesta, con la cifra que rueda
 * (Odometro), un caso real y el enlace a la lista. Es el producto funcionando en la portada, sin cuenta y sin escribir.
 *
 * Mientras nadie lo toca y se ve, pasa solo de una respuesta a otra (`auto`, ms) para mostrar que se puede tocar; al
 * primer toque se queda en la que eligieron y desde ahí avisa los cambios a los lectores de pantalla. Con movimiento
 * reducido no avanza solo. Las cifras vienen del servidor (las mismas de la portada): no consulta nada.
 */
export function Pruebalo({
  pregunta,
  opciones,
  auto = 3600,
  oscuro = false,
  className,
}: {
  pregunta: string;
  opciones: OpcionPrueba[];
  auto?: number;
  oscuro?: boolean;
  className?: string;
}) {
  const id = useId();
  const [i, setI] = useState(0);
  const [solo, setSolo] = useState(true);
  const raiz = useRef<HTMLDivElement>(null);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const n = opciones.length;

  useEffect(() => {
    if (!solo || n < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSolo(false);
      return;
    }
    let visible = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const programar = () => {
      clearTimeout(t);
      if (visible && document.visibilityState === "visible") t = setTimeout(() => setI((x) => (x + 1) % n), auto);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      programar();
    }, { threshold: 0.5 });
    if (raiz.current) io.observe(raiz.current);
    document.addEventListener("visibilitychange", programar);
    return () => {
      clearTimeout(t);
      io.disconnect();
      document.removeEventListener("visibilitychange", programar);
    };
  }, [solo, i, n, auto]);

  if (!n) return null;
  const o = opciones[Math.min(i, n - 1)];

  const elegir = (j: number) => {
    setSolo(false);
    setI(j);
  };
  const teclas = (e: KeyboardEvent<HTMLButtonElement>) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + n) % n;
    elegir(j);
    botones.current[j]?.focus();
  };

  return (
    <div ref={raiz} className={cn("min-w-0", className)}>
      <p id={`${id}-p`} className={cn("text-dato font-semibold", oscuro ? "text-paper" : "text-ink")}>
        {pregunta}
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-p`} className="mt-3 flex flex-wrap gap-2">
        {opciones.map((x, j) => {
          const activa = j === i;
          return (
            <button
              key={x.etiqueta}
              ref={(el) => {
                botones.current[j] = el;
              }}
              type="button"
              role="radio"
              aria-checked={activa}
              tabIndex={activa ? 0 : -1}
              onClick={() => elegir(j)}
              onKeyDown={teclas}
              className={cn(
                "gs-ficha min-h-10 rounded-full border px-4 text-dato font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2",
                oscuro
                  ? activa
                    ? "border-paper bg-paper text-ink focus-visible:ring-paper/60"
                    : "border-paper/25 text-paper/85 hover:border-paper/60 hover:text-paper focus-visible:ring-paper/60"
                  : activa
                    ? "border-granate bg-granate text-paper focus-visible:ring-granate"
                    : "border-line bg-paper text-inkSoft hover:border-granate/50 hover:text-ink focus-visible:ring-granate",
              )}
            >
              {x.etiqueta}
            </button>
          );
        })}
      </div>
      <div
        aria-live={solo ? "off" : "polite"}
        className={cn("gs-mira mt-4 rounded-2xl border p-5 sm:p-6", oscuro ? "border-paper/15 bg-paper/[0.06]" : "border-line bg-paper shadow-sm")}
      >
        <div key={i} className="gs-resultado">
          <p className={cn("flex flex-wrap items-baseline gap-x-2.5 gap-y-1", oscuro ? "text-paper" : "text-ink")}>
            <Odometro texto={o.cifra} className="font-display text-cifra font-bold leading-none tracking-[-0.02em] sm:text-portada" />
            <span className={cn("text-dato font-semibold", oscuro ? "text-paper/85" : "text-inkSoft")}>{o.unidad}</span>
          </p>
          {o.detalle ? <p className={cn("mt-3 max-w-[52ch] text-pretty text-dato leading-relaxed", oscuro ? "text-paper/75" : "text-inkSoft")}>{o.detalle}</p> : null}
          <Link href={o.href} className={claseAccion("primario", "mt-4 min-h-11")}>
            {o.accion}
            <ArrowRight size={16} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </div>
  );
}
