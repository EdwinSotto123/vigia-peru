"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { PUNTOS_OJO } from "./OjoPixel";

/**
 * El ojo de Vigía, vivo: la pupila sigue al cursor (o al dedo), el ojo entero se inclina un
 * poco en 3D hacia donde mira, parpadea cada tanto y, si nadie lo toca, recorre la pantalla con
 * la vista. Es el mismo dibujo de `OjoPixel`; sólo cambia que aquí la pupila es un grupo aparte
 * que se mueve dentro del ojo.
 *
 * Seguridad (la misma lección que el resto de la portada): el servidor pinta el ojo completo y
 * quieto, y todo movimiento lo pone el cliente después de montar. Con `prefers-reduced-motion`
 * no se mueve nada. El bucle sólo corre mientras el ojo está en pantalla.
 *
 * Unidades: la pupila se mueve en celdas del dibujo (11 × 5). Los topes (0,95 celdas a los lados,
 * 0,4 arriba y abajo) dejan la cruz dentro del párpado sin pisar sus puntos.
 */

const COLS = 11;
const ALTO = 5;
const MAX_X = 0.95;
const MAX_Y = 0.4;

const lids = PUNTOS_OJO.filter((p) => !p.pupila);
const pupila = PUNTOS_OJO.filter((p) => p.pupila);

export function OjoVivo({
  tamano = 560,
  className,
  titulo,
}: {
  tamano?: number;
  className?: string;
  titulo?: string;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const grupoPupila = useRef<SVGGElement>(null);
  const grupoOjo = useRef<SVGGElement>(null);

  useEffect(() => {
    const el = raiz.current;
    const gp = grupoPupila.current;
    const go = grupoOjo.current;
    if (!el || !gp || !go) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // Estado: hacia dónde mira (objetivo) y dónde está (actual), en -1 … 1.
    let objX = 0;
    let objY = 0;
    let x = 0;
    let y = 0;
    let visible = false;
    let ultimoPuntero = 0; // cuándo se movió el cursor por última vez
    let proximoGiro = 0;
    let parpadeoHasta = 0;
    let proximoParpadeo = performance.now() + 2500;
    let raf = 0;

    const alPuntero = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // Distancia normalizada al ancho de la pantalla: mirar lejos = pupila al borde.
      objX = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth * 0.45)));
      objY = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight * 0.45)));
      ultimoPuntero = performance.now();
    };

    const bucle = (t: number) => {
      if (!visible) return;
      // Sin cursor hace rato: la vista recorre el ojo sola (izquierda, arriba, derecha, abajo…).
      if (t - ultimoPuntero > 2600 && t > proximoGiro) {
        const dirs: [number, number][] = [[-1, 0], [0.9, -0.6], [1, 0.4], [0, 0], [-0.8, 0.7], [0.5, 0.9], [-1, -0.5]];
        const d = dirs[Math.floor(Math.random() * dirs.length)];
        objX = d[0];
        objY = d[1];
        proximoGiro = t + 1400 + Math.random() * 1800;
      }
      // Suaviza hacia el objetivo (exponencial).
      x += (objX - x) * 0.1;
      y += (objY - y) * 0.1;
      gp.setAttribute("transform", `translate(${(x * MAX_X).toFixed(3)} ${(y * MAX_Y).toFixed(3)})`);
      el.style.transform = `perspective(900px) rotateY(${(x * 14).toFixed(2)}deg) rotateX(${(-y * 9).toFixed(2)}deg)`;

      // Parpadeo: cierra los párpados 140 ms cada 3,5 a 7 s.
      if (t > proximoParpadeo) {
        parpadeoHasta = t + 140;
        proximoParpadeo = t + 3500 + Math.random() * 3500;
      }
      const cerrando = t < parpadeoHasta;
      go.style.transform = `scaleY(${cerrando ? 0.08 : 1})`;
      raf = requestAnimationFrame(bucle);
    };

    const io = new IntersectionObserver(
      ([e]) => {
        const antes = visible;
        visible = e.isIntersecting;
        if (visible && !antes) raf = requestAnimationFrame(bucle);
        if (!visible) cancelAnimationFrame(raf);
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    window.addEventListener("pointermove", alPuntero, { passive: true });
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", alPuntero);
      el.style.transform = "";
      go.style.transform = "";
      gp.removeAttribute("transform");
    };
  }, []);

  return (
    <div ref={raiz} className={cn("will-change-transform", className)} style={{ transformStyle: "preserve-3d" }}>
      <svg
        viewBox={`0 0 ${COLS} ${ALTO}`}
        width={tamano}
        height={(tamano * ALTO) / COLS}
        className="h-auto w-full overflow-visible"
        {...(titulo ? { role: "img", "aria-label": titulo } : { "aria-hidden": true })}
        focusable="false"
      >
        {titulo && <title>{titulo}</title>}
        <g ref={grupoOjo} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          {lids.map((p, k) => (
            <circle
              key={k}
              cx={p.x}
              cy={p.y}
              r={0.42}
              fill="#D4FF3F"
              style={{
                transformBox: "fill-box",
                transformOrigin: "center",
                animation: `puntoEntra 480ms cubic-bezier(0.22,1,0.36,1) ${p.retardo}ms both`,
              }}
            />
          ))}
          <g ref={grupoPupila}>
            {pupila.map((p, k) => (
              <circle
                key={k}
                cx={p.x}
                cy={p.y}
                r={0.42}
                fill="#FFFFFF"
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  animation: `puntoEntra 480ms cubic-bezier(0.22,1,0.36,1) ${p.retardo}ms both`,
                }}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
