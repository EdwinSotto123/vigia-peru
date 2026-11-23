"use client";

import { useEffect } from "react";

/**
 * Un buscador que muestra qué se puede escribir (2026-11-22, el usuario: «que llame a usarlo, entendible»): mientras el
 * campo está vacío y nadie lo tocó, su texto de ayuda escribe solo un ejemplo real, letra por letra, lo deja un momento,
 * lo borra y pasa al siguiente. Apenas lo enfocas o escribes, se detiene y vuelve el texto de ayuda de siempre.
 *
 * Toma el campo por su `id` (el buscador es un formulario del servidor y sigue andando sin JavaScript). Sólo mientras se
 * ve y con la pestaña al frente; con movimiento reducido no hace nada. No pinta nada propio.
 */
export function EscribeSolo({ para, ejemplos, prefijo = "" }: { para: string; ejemplos: string[]; prefijo?: string }) {
  useEffect(() => {
    const campo = document.getElementById(para);
    if (!(campo instanceof HTMLInputElement) || !ejemplos.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const original = campo.placeholder;
    let vivo = true;
    let visible = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    let i = 0;
    let n = 0;
    let borrando = false;

    const parar = () => {
      vivo = false;
      clearTimeout(t);
      campo.placeholder = original;
    };
    const paso = () => {
      if (!vivo) return;
      if (!visible || document.visibilityState !== "visible" || campo.value) {
        t = setTimeout(paso, 600);
        return;
      }
      const texto = ejemplos[i % ejemplos.length];
      if (!borrando) {
        n += 1;
        campo.placeholder = prefijo + texto.slice(0, n);
        if (n >= texto.length) {
          borrando = true;
          t = setTimeout(paso, 1700);
          return;
        }
        t = setTimeout(paso, 55 + Math.random() * 60);
      } else {
        n -= 2;
        campo.placeholder = prefijo + texto.slice(0, Math.max(0, n));
        if (n <= 0) {
          borrando = false;
          n = 0;
          i += 1;
          t = setTimeout(paso, 350);
          return;
        }
        t = setTimeout(paso, 28);
      }
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(campo);
    campo.addEventListener("focus", parar);
    campo.addEventListener("input", parar);
    t = setTimeout(paso, 900);
    return () => {
      parar();
      io.disconnect();
      campo.removeEventListener("focus", parar);
      campo.removeEventListener("input", parar);
    };
  }, [para, ejemplos, prefijo]);
  return null;
}
