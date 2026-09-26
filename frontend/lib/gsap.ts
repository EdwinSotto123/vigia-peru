"use client";

/**
 * GSAP diferido para las escenas de la portada (auditoría A14).
 *
 * Antes GSAP, ScrollTrigger y @gsap/react viajaban en el JS inicial de `/` para todo
 * visitante, también para quien pidió menos movimiento, que nunca ve una animación. Ahora
 * ninguna escena importa "gsap" de forma estática: `useEscenaGsap` pregunta primero si la
 * consulta de medios de la escena aplica y, sólo entonces, baja el motor con `import()`.
 * Con movimiento reducido no se descarga nada.
 *
 *  - Escenas fijadas con scroll (`CON_MOVIMIENTO`, pantalla ancha): el motor se pide al
 *    montar, porque el pin tiene que existir antes de que el usuario llegue a la escena.
 *  - Revelados livianos (`SIN_REDUCIR`, también en el celular): `diferido`, después de
 *    `load` y en un momento ocioso. Así GSAP nunca compite con el LCP en un 4G.
 *
 * Reglas que siguen todas las escenas (skills oficiales gsap-react y gsap-scrolltrigger):
 *  - Todo va dentro de `gsap.matchMedia(scope)`: los selectores no se escapan de la escena
 *    y la limpieza (tweens + ScrollTriggers) corre sola al desmontar o al dejar de aplicar
 *    la consulta.
 *  - Nunca se anima el elemento fijado (`pin`), sólo sus hijos.
 *  - El estado inicial de una animación lo pone GSAP, nunca el CSS ni el HTML del
 *    servidor: sin JS, o mientras el motor no llegó, la página está completa y quieta.
 */

import { useEffect, type RefObject } from "react";

/** Escenas fijadas con scroll: sólo en pantallas anchas y sin preferencia de movimiento reducido. */
export const CON_MOVIMIENTO = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

/** Revelados livianos (sin fijar): también en móvil, nunca con movimiento reducido. */
export const SIN_REDUCIR = "(prefers-reduced-motion: no-preference)";

type Gsap = (typeof import("gsap"))["gsap"];
type ScrollTriggerEstatico = (typeof import("gsap/ScrollTrigger"))["ScrollTrigger"];
type MatchMedia = ReturnType<Gsap["matchMedia"]>;

export interface MotorGsap {
  gsap: Gsap;
  ScrollTrigger: ScrollTriggerEstatico;
}

// Una sola descarga y un solo registro del plugin para toda la página.
let motor: Promise<MotorGsap> | null = null;

function cargarMotor(): Promise<MotorGsap> {
  if (!motor) {
    motor = Promise.all([import("gsap"), import("gsap/ScrollTrigger")])
      .then(([g, s]) => {
        g.gsap.registerPlugin(s.ScrollTrigger);
        return { gsap: g.gsap, ScrollTrigger: s.ScrollTrigger };
      })
      .catch((e) => {
        motor = null; // sin red: el próximo intento vuelve a pedirlo
        throw e;
      });
  }
  return motor;
}

// Varias escenas se arman en el mismo tick: un solo refresh al final recalcula los pines
// en orden (cada uno empuja a los de abajo).
let refrescoPendiente = false;
function refrescarAlFinal(st: ScrollTriggerEstatico) {
  if (refrescoPendiente) return;
  refrescoPendiente = true;
  window.requestAnimationFrame(() => {
    refrescoPendiente = false;
    st.refresh();
  });
}

/** Después de `load` y en un momento ocioso (con tope, para no esperar para siempre). */
function cuandoOcioso(fn: () => void): () => void {
  let cancelado = false;
  let idle: number | null = null;
  let timer: number | null = null;
  const pedir = () => {
    if (cancelado) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) idle = w.requestIdleCallback(() => !cancelado && fn(), { timeout: 2500 });
    else timer = window.setTimeout(() => !cancelado && fn(), 1200);
  };
  if (document.readyState === "complete") pedir();
  else window.addEventListener("load", pedir, { once: true });
  return () => {
    cancelado = true;
    window.removeEventListener("load", pedir);
    const w = window as Window & { cancelIdleCallback?: (id: number) => void };
    if (idle != null) w.cancelIdleCallback?.(idle);
    if (timer != null) window.clearTimeout(timer);
  };
}

/**
 * Arma una escena de GSAP sobre `scope` sólo si `consulta` aplica. `armar` corre dentro de
 * `gsap.matchMedia(scope).add(consulta, …)`: puede devolver su propia limpieza.
 *
 * `listo`: la escena depende de algo que llega después (la geometría del mapa): hasta que
 * sea `true` no se arma nada. `armar` se toma del render en que `listo` pasó a `true`.
 */
export function useEscenaGsap(
  scope: RefObject<HTMLElement | null>,
  consulta: string,
  armar: (m: MotorGsap) => void | (() => void),
  { diferido = false, listo = true }: { diferido?: boolean; listo?: boolean } = {},
) {
  useEffect(() => {
    const el = scope.current;
    if (!listo || !el || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(consulta);
    let vivo = true;
    let pedido = false;
    let mm: MatchMedia | null = null;
    let cancelarEspera: (() => void) | null = null;

    const montar = () => {
      if (pedido || !vivo) return;
      pedido = true;
      cargarMotor()
        .then((m) => {
          if (!vivo) return;
          mm = m.gsap.matchMedia(el);
          mm.add(consulta, () => armar(m));
          refrescarAlFinal(m.ScrollTrigger);
        })
        // Sin motor no hay animación, y la escena ya está completa y quieta.
        .catch(() => {
          pedido = false;
        });
    };
    // Si la consulta no aplica al montar (celular girado, ventana angosta) el motor ni se
    // pide; si después pasa a aplicar, recién ahí. Una vez armada, `matchMedia` de GSAP se
    // encarga de revertir y rearmar sola.
    const intentar = () => {
      if (!mql.matches || pedido || cancelarEspera) return;
      if (diferido) {
        cancelarEspera = cuandoOcioso(() => {
          cancelarEspera = null;
          montar();
        });
      } else montar();
    };

    intentar();
    mql.addEventListener?.("change", intentar);
    return () => {
      vivo = false;
      mql.removeEventListener?.("change", intentar);
      cancelarEspera?.();
      mm?.revert();
    };
    // `armar` se lee del render en que la escena quedó lista; volver a armarla en cada
    // render reiniciaría la animación a mitad del scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, diferido, listo]);
}
