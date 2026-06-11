"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type CarouselProps = {
  /** Cantidad total de slides */
  total: number;
  /** Función que renderiza cada slide */
  renderSlide: (index: number) => React.ReactNode;
  /** Autoplay (ms). 0 = off. Default 0. */
  autoplayMs?: number;
  /** Altura mínima del slot del carrusel para evitar saltos. */
  minHeight?: number | string;
  /** Color del indicador activo (clase Tailwind). Default `bg-rust`. */
  activeDotClass?: string;
  className?: string;
  /** Aria label */
  ariaLabel?: string;
};

export function Carousel({
  total,
  renderSlide,
  autoplayMs = 0,
  minHeight,
  activeDotClass = "bg-rust",
  className = "",
  ariaLabel = "Carrusel",
}: CarouselProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      setIndex((cur) => (cur + delta + total) % total);
    },
    [total],
  );

  const goTo = useCallback((i: number) => setIndex(i), []);

  // Autoplay
  useEffect(() => {
    if (!autoplayMs || paused || total <= 1) return;
    const id = window.setInterval(() => {
      setIndex((cur) => (cur + 1) % total);
    }, autoplayMs);
    return () => window.clearInterval(id);
  }, [autoplayMs, paused, total]);

  // Keyboard nav
  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    },
    [go],
  );

  // Touch swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const delta = endX - touchStartX.current;
    if (Math.abs(delta) > 40) go(delta > 0 ? -1 : 1);
    touchStartX.current = null;
  };

  return (
    <div
      className={"relative " + className}
      role="region"
      aria-label={ariaLabel}
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={handleKey}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Slot */}
      <div
        className="relative overflow-hidden"
        style={minHeight ? { minHeight } : undefined}
      >
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            aria-hidden={i !== index}
            className={
              "transition-opacity duration-500 " +
              (i === index
                ? "relative z-10 opacity-100"
                : "pointer-events-none absolute inset-0 z-0 opacity-0")
            }
          >
            {renderSlide(i)}
          </div>
        ))}
      </div>

      {/* Controls row */}
      {total > 1 && (
        <div className="mt-6 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Anterior"
            className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-ink shadow-card transition-all hover:scale-105 hover:bg-paperDeep"
          >
            <ChevronLeft size={20} className="transition-transform group-hover:-translate-x-0.5" />
          </button>

          <div className="flex items-center gap-1.5" role="tablist">
            {Array.from({ length: total }).map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Ir al slide ${i + 1}`}
                onClick={() => goTo(i)}
                className={
                  "h-1.5 rounded-full transition-all " +
                  (i === index
                    ? `w-8 ${activeDotClass}`
                    : "w-1.5 bg-line hover:bg-mute")
                }
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-mute">
              <span className="font-bold text-ink">{String(index + 1).padStart(2, "0")}</span>
              <span className="mx-1 text-mute/50">/</span>
              <span>{String(total).padStart(2, "0")}</span>
            </span>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Siguiente"
              className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-ink shadow-card transition-all hover:scale-105 hover:bg-paperDeep"
            >
              <ChevronRight size={20} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
