"use client";

/**
 * GSAP registrado UNA vez para todo el cliente.
 *
 * Las escenas de la portada (la lupa que se abre, el caso leído paso a paso, el
 * mapa que narra por regiones, el aporte que se vuelve impacto) importan desde
 * acá y nunca de "gsap" directo: así ScrollTrigger y useGSAP quedan registrados
 * antes de la primera escena, sin depender de qué componente monte primero.
 *
 * Reglas que siguen todas las escenas (skills oficiales gsap-react y
 * gsap-scrolltrigger):
 *  - `useGSAP` con `scope`: los selectores no se escapan del componente y la
 *    limpieza (tweens + ScrollTriggers) corre sola al desmontar.
 *  - Nunca se anima el elemento fijado (`pin`), sólo sus hijos.
 *  - Todo va dentro de `gsap.matchMedia()` con `CON_MOVIMIENTO`: quien pidió
 *    menos movimiento en su sistema, o mira desde un teléfono, recibe la página
 *    estática y completa. El contenido nunca depende de la animación para verse.
 */

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Escenas fijadas con scroll: sólo en pantallas anchas y sin preferencia de movimiento reducido. */
export const CON_MOVIMIENTO = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

/** Revelados livianos (sin fijar): también en móvil, nunca con movimiento reducido. */
export const SIN_REDUCIR = "(prefers-reduced-motion: no-preference)";

export { gsap, ScrollTrigger, useGSAP };
