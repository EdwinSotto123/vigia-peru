"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatSoles } from "@/lib/formato";

const FORMATOS: Record<string, (n: number) => string> = {
  entero: (n) => Math.round(n).toLocaleString("es-PE"),
  pen: (n) => `S/ ${Math.round(n).toLocaleString("es-PE")}`,
  // Mismos cortes que formatSoles() de lib/formato: un monto grande (los de
  // contratos públicos suelen ser de 6 a 9 cifras) se abrevia ("S/ 45.20 M",
  // "S/ 1.54 mil M") en vez de imprimir el número completo, que en una
  // stat-tile angosta se ve desproporcionado. "mil M" y no "B": en español un
  // billón es un millón de millones.
  pen_compacto: (n) => (n >= 1_000 ? formatSoles(n) : `S/ ${Math.round(n).toLocaleString("es-PE")}`),
};

/** Desde qué fracción del valor arranca el conteo. No desde 0: un salto corto se lee como "se actualizó", no como "cargando". */
const DESDE = 0.6;

/**
 * Magic UI — NumberTicker.
 *
 * El número SIEMPRE se sirve con su valor real: es lo que pinta el servidor, lo
 * que ve quien tiene JS lento o apagado y lo primero que se ve al hidratar.
 * Antes el estado arrancaba en 0 y sólo contaba al entrar en pantalla, así que
 * el HTML del servidor decía "0" (la misma clase de falla que el viejo BlurFade,
 * que dejó contenido invisible en producción).
 *
 * La animación es mejora progresiva y sólo ocurre si:
 *  - no hay movimiento reducido, y
 *  - el número estaba FUERA de pantalla al montar. Uno visible desde el primer
 *    cuadro no se toca: bajarlo para contarlo de nuevo sería mostrar una cifra
 *    falsa por un instante.
 * En ese caso, mientras está fuera de la vista se deja en una fracción del valor
 * y al entrar cuenta hasta el real. Durante ese tramo el número animado es
 * `aria-hidden` y el lector de pantalla lee el valor real en un texto oculto.
 *
 * Si `value` cambia después (p.ej. AliadosStats corrige en el cliente un dato
 * que llegó desactualizado del servidor) se corrige con una animación corta.
 *
 * Recibe solo datos primitivos: puede montarse desde un server component. Por
 * eso `format` es un string (una clave de FORMATOS), no una función: un server
 * component SÍ puede pasar `format="pen"`, pero NUNCA `formatear={formatPEN}`
 * (React no puede serializar una función a través de ese límite; rompe en
 * producción, no en build).
 */
export function NumberTicker({
  value,
  className,
  duration = 1200,
  format = "entero",
}: {
  value: number;
  className?: string;
  /** Duración del conteo en ms. */
  duration?: number;
  format?: keyof typeof FORMATOS;
}) {
  const formatear = FORMATOS[format] ?? FORMATOS.entero;
  const ref = useRef<HTMLSpanElement | null>(null);
  const [mostrado, setMostrado] = useState(value);
  /** true mientras lo que se ve no es el valor real (armado fuera de pantalla o contando). */
  const [enTransito, setEnTransito] = useState(false);
  const mostradoRef = useRef(value);
  mostradoRef.current = mostrado;
  const valorRef = useRef(value);
  valorRef.current = value;
  /** Armado fuera de pantalla, esperando entrar para contar. */
  const armado = useRef(false);
  const cuadro = useRef(0);

  // Primer montaje: decidir si hay animación de entrada.
  useEffect(() => {
    const el = ref.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduce || typeof IntersectionObserver === "undefined" || value === 0) return;

    let primera = true;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (primera) {
          primera = false;
          // Visible desde el primer cuadro: se queda como está, con el valor real.
          if (entry.isIntersecting) { obs.disconnect(); return; }
          // Fuera de pantalla: se arma más abajo para contar al entrar.
          armado.current = true;
          setEnTransito(true);
          setMostrado(valorRef.current * DESDE);
          return;
        }
        if (!entry.isIntersecting) return;
        obs.disconnect();
        armado.current = false;
        animar(mostradoRef.current, valorRef.current);
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      cancelAnimationFrame(cuadro.current);
      // Desmontado (o doble efecto de StrictMode) antes de entrar: nunca quedar en la fracción.
      if (armado.current) { armado.current = false; setMostrado(valorRef.current); setEnTransito(false); }
    };
    // Sólo al montar: los cambios posteriores de `value` los maneja el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `value` cambió después de montar: corregir desde lo que se ve ahora.
  const previo = useRef(value);
  useEffect(() => {
    if (previo.current === value) return;
    previo.current = value;
    // Todavía armado fuera de pantalla: re-armar con el valor nuevo y contar al entrar.
    if (armado.current) { setMostrado(value * DESDE); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMostrado(value);
      setEnTransito(false);
      return;
    }
    animar(mostradoRef.current, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function animar(desde: number, hasta: number) {
    cancelAnimationFrame(cuadro.current);
    setEnTransito(true);
    const t0 = performance.now();
    const paso = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      // ease-out cubic: arranca rápido y se asienta suave.
      const eased = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        setMostrado(desde + (hasta - desde) * eased);
        cuadro.current = requestAnimationFrame(paso);
      } else {
        setMostrado(hasta);
        setEnTransito(false);
      }
    };
    cuadro.current = requestAnimationFrame(paso);
  }

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {enTransito ? (
        <>
          <span aria-hidden="true">{formatear(mostrado)}</span>
          <span className="sr-only">{formatear(value)}</span>
        </>
      ) : (
        formatear(mostrado)
      )}
    </span>
  );
}
