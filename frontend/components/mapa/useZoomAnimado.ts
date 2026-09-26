"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Encuadre del grupo del mapa: traslación y escala en unidades del viewBox. */
export interface Encuadre {
  tx: number;
  ty: number;
  s: number;
}

export const ENCUADRE_PAIS: Encuadre = { tx: 0, ty: 0, s: 1 };

/** Duración del zoom (duration-panel) y su curva: cúbica de salida. */
const DURACION_MS = 240;

const aTexto = (e: Encuadre) => `translate(${e.tx.toFixed(2)},${e.ty.toFixed(2)}) scale(${e.s.toFixed(4)})`;
const iguales = (a: Encuadre, b: Encuadre) => Math.abs(a.tx - b.tx) < 0.01 && Math.abs(a.ty - b.ty) < 0.01 && Math.abs(a.s - b.s) < 0.0001;

// useLayoutEffect avisa en el render del servidor; el efecto sólo hace falta en el navegador.
const useLayoutEffectCliente = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Lleva el `<g>` del mapa al encuadre `destino` (entrar a un departamento, volver al país)
 * SIN un render de React por cuadro: antes cada cuadro hacía `setState` y re-dibujaba los
 * 25 departamentos, las provincias, los puntos y las etiquetas (2 s de tareas largas en el
 * celular al elegir una región). Ahora el cuadro escribe sólo el atributo `transform` del
 * grupo, directo en el DOM; React nunca lo toca (el `<g>` no lleva `transform` en el JSX).
 *
 * Todo lo que se dibuja a tamaño de pantalla (etiquetas, puntos) se calcula una vez, para
 * el encuadre final. Mientras dura el zoom se esconde (`animando`): son dos renders por
 * zoom, al empezar y al terminar, en vez de uno por cuadro.
 *
 * `listo`: el `<g>` ya existe (la geometría llegó). Con movimiento reducido, salta sin animar.
 */
export function useZoomAnimado(ref: RefObject<SVGGElement>, destino: Encuadre, listo: boolean): boolean {
  const actual = useRef<Encuadre>(ENCUADRE_PAIS);
  const [animando, setAnimando] = useState(false);

  useLayoutEffectCliente(() => {
    const g = ref.current;
    if (!listo || !g) return;
    const aplicar = (e: Encuadre) => {
      actual.current = e;
      g.setAttribute("transform", aTexto(e));
    };
    const desde = actual.current;
    const reducido = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducido || iguales(desde, destino)) {
      aplicar(destino);
      setAnimando(false);
      return;
    }
    setAnimando(true);
    const inicio = performance.now();
    let raf = 0;
    const paso = (ahora: number) => {
      const t = Math.min((ahora - inicio) / DURACION_MS, 1);
      const k = 1 - Math.pow(1 - t, 3);
      aplicar({
        tx: desde.tx + (destino.tx - desde.tx) * k,
        ty: desde.ty + (destino.ty - desde.ty) * k,
        s: desde.s + (destino.s - desde.s) * k,
      });
      if (t < 1) raf = requestAnimationFrame(paso);
      else setAnimando(false);
    };
    raf = requestAnimationFrame(paso);
    // Un zoom nuevo a mitad de camino arranca desde donde quedó este (`actual`).
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino.tx, destino.ty, destino.s, listo]);

  return animando;
}
