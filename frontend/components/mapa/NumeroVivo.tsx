"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Un entero que, cuando CAMBIA, cuenta del valor anterior al nuevo en ~400 ms.
 *
 * El primer render ya muestra el valor real (también en el servidor): nada
 * arranca en cero para "animarse", porque un cero que dura medio segundo es un
 * dato falso. Sólo se mueve cuando el usuario cambió algo (la medida, el mes,
 * la región) y la cifra de verdad cambió. Con `prefers-reduced-motion`, salta.
 *
 * Los lectores de pantalla leen el valor final, nunca los intermedios.
 */
export function NumeroVivo({ valor, className }: { valor: number; className?: string }) {
  const [mostrado, setMostrado] = useState(valor);
  const previo = useRef(valor);

  useEffect(() => {
    const desde = previo.current;
    previo.current = valor;
    if (desde === valor) return;
    const reducido = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducido) {
      setMostrado(valor);
      return;
    }
    const inicio = performance.now();
    const dur = 420;
    let raf = 0;
    const paso = (t: number) => {
      const k = Math.min(1, (t - inicio) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setMostrado(Math.round(desde + (valor - desde) * e));
      if (k < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => {
      cancelAnimationFrame(raf);
      setMostrado(valor);
    };
  }, [valor]);

  return (
    <span className={className}>
      <span aria-hidden>{mostrado.toLocaleString("es-PE")}</span>
      <span className="sr-only">{valor.toLocaleString("es-PE")}</span>
    </span>
  );
}
