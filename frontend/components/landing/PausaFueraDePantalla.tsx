"use client";

import { useEffect } from "react";

/**
 * Pausa las animaciones CSS de cada bloque de la portada mientras está fuera de pantalla.
 *
 * La portada tiene una docena de animaciones en bucle (la cinta de aportes, los pulsos del pipeline,
 * los cables con datos, el latido de los nodos, los puntos del podio…). El navegador las sigue
 * calculando aunque el bloque esté tres pantallas más abajo: con ellas, la portada tenía el hilo
 * principal ocupado más de la mitad del tiempo sin que nadie hiciera nada, y en el celular se
 * trababa al hacer scroll. Un solo IntersectionObserver marca `data-pausa` en los bloques que no se
 * ven (con 300 px de margen, para que ya estén corriendo al llegar) y `globals.css` pausa todo lo
 * que hay dentro.
 *
 * Sólo pausa: no oculta nada ni cambia el layout. Sin IntersectionObserver, nada se pausa.
 * GSAP no se toca (sus escenas ya corren sólo con el scroll).
 */
export function PausaFueraDePantalla({ contenedor = "contenido" }: { contenedor?: string }) {
  useEffect(() => {
    const raiz = document.getElementById(contenedor);
    if (!raiz || typeof IntersectionObserver === "undefined") return;
    const bloques = Array.from(raiz.children) as HTMLElement[];
    const io = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) delete el.dataset.pausa;
          else el.dataset.pausa = "";
        }
      },
      { rootMargin: "300px 0px" },
    );
    for (const b of bloques) io.observe(b);
    return () => {
      io.disconnect();
      for (const b of bloques) delete b.dataset.pausa;
    };
  }, [contenedor]);
  return null;
}
