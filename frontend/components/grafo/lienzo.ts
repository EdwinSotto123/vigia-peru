"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";

/**
 * Un lienzo grande (un SVG dentro de un contenedor con su propio desplazamiento) que se recorre como un mapa: arrastrar
 * con el mouse lo mueve, la rueda acerca y aleja donde está el puntero (y el pellizco del trackpad o de una pantalla
 * táctil), el doble clic acerca (con Mayúsculas, aleja) y, con el lienzo enfocado, + y − acercan y alejan, 0 vuelve al
 * tamaño real y las flechas lo mueven. Pedido del usuario el 2026-10-28 para el mapa mental de la organización: «debería
 * desplazarse con el mouse, aumentar con el ratón».
 *
 * El tamaño vive afuera (`escala`, `setEscala`): quien dibuja multiplica por él el ancho y el alto del SVG. Este hook
 * corre el desplazamiento para que el punto bajo el puntero quede donde estaba al cambiar el tamaño. Un clic sigue
 * siendo un clic: sólo cuando el puntero se mueve más de 4 px es un arrastre (y entonces el clic de después no cuenta).
 */
export function useLienzoNavegable(
  lienzo: RefObject<HTMLDivElement>,
  contenido: RefObject<SVGSVGElement>,
  escala: number,
  setEscala: (e: number) => void,
  { min, max, activo = true }: { min: number; max: number; activo?: boolean },
) {
  const escalaRef = useRef(escala);
  escalaRef.current = escala;
  // El punto del contenido (en px a tamaño real) que tiene que quedar en (ox, oy) del área visible tras cambiar el tamaño.
  const ancla = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null);
  const arrastre = useRef<{ x: number; y: number; sl: number; st: number; movio: boolean } | null>(null);
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const pinza = useRef<{ d: number; escala: number } | null>(null);
  const suprimir = useRef(false);
  const rueda = useRef<{ factor: number; ox: number; oy: number } | null>(null);
  const cuadro = useRef<number | null>(null);

  /** Dónde empieza el contenido dentro del área desplazable (centrado con mx-auto cuando es más chico que ella). */
  const origen = () => {
    const el = lienzo.current;
    const svg = contenido.current;
    if (!el || !svg) return { x: 0, y: 0 };
    const a = el.getBoundingClientRect();
    const b = svg.getBoundingClientRect();
    return { x: b.left - a.left + el.scrollLeft, y: b.top - a.top + el.scrollTop };
  };
  const acotar = (e: number) => Math.min(max, Math.max(min, Math.round(e * 100) / 100));

  /** Lleva el tamaño a `nueva` con el punto en (ox, oy) del área visible fijo (sin punto: el centro). */
  const zoomEn = (nueva: number, ox?: number, oy?: number) => {
    const el = lienzo.current;
    if (!el) return;
    const e = acotar(nueva);
    if (e === escalaRef.current) return;
    const px = ox ?? el.clientWidth / 2;
    const py = oy ?? el.clientHeight / 2;
    const o = origen();
    ancla.current = { cx: (el.scrollLeft + px - o.x) / escalaRef.current, cy: (el.scrollTop + py - o.y) / escalaRef.current, ox: px, oy: py };
    setEscala(e);
  };
  const zoomRef = useRef(zoomEn);
  zoomRef.current = zoomEn;

  /** Pone en el centro del área visible el punto (cx, cy) del contenido, en px a tamaño real. */
  const centrarEn = (cx: number, cy: number, behavior: ScrollBehavior = "smooth") => {
    const el = lienzo.current;
    if (!el) return;
    const o = origen();
    el.scrollTo({ left: cx * escalaRef.current + o.x - el.clientWidth / 2, top: cy * escalaRef.current + o.y - el.clientHeight / 2, behavior });
  };

  /** Que el contenido (de `ancho` × `alto` a tamaño real) entre entero, centrado. */
  const encajar = (ancho: number, alto: number) => {
    const el = lienzo.current;
    if (!el) return;
    const e = acotar(Math.min(1, (el.clientWidth / ancho) * 0.97, ((el.clientHeight || 600) / alto) * 0.97));
    ancla.current = { cx: ancho / 2, cy: alto / 2, ox: el.clientWidth / 2, oy: el.clientHeight / 2 };
    if (e === escalaRef.current) centrarEn(ancho / 2, alto / 2);
    else setEscala(e);
  };

  // Tras dibujar con el tamaño nuevo: el punto anclado, de vuelta bajo el puntero.
  useLayoutEffect(() => {
    const el = lienzo.current;
    const a = ancla.current;
    if (!el || !a) return;
    ancla.current = null;
    const o = origen();
    el.scrollLeft = a.cx * escala + o.x - a.ox;
    el.scrollTop = a.cy * escala + o.y - a.oy;
    // origen() lee los refs: sólo importa el tamaño nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escala]);

  // La rueda: no pasiva (para que no desplace la página) y un cambio de tamaño por cuadro (un ministerio tiene cientos de
  // oficinas: redibujar en cada evento de la rueda trababa). Con Mayúsculas desplaza de costado, como siempre.
  useEffect(() => {
    const el = lienzo.current;
    if (!el || !activo) return;
    const alGirar = (ev: WheelEvent) => {
      if (ev.shiftKey) return;
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      // El pellizco del trackpad llega como rueda con Ctrl y pasos chicos: más sensible.
      const f = Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0015));
      rueda.current = { factor: (rueda.current?.factor ?? 1) * f, ox: ev.clientX - r.left, oy: ev.clientY - r.top };
      if (cuadro.current == null) {
        cuadro.current = requestAnimationFrame(() => {
          cuadro.current = null;
          const q = rueda.current;
          rueda.current = null;
          if (q) zoomRef.current(escalaRef.current * q.factor, q.ox, q.oy);
        });
      }
    };
    el.addEventListener("wheel", alGirar, { passive: false });
    return () => {
      el.removeEventListener("wheel", alGirar);
      if (cuadro.current != null) cancelAnimationFrame(cuadro.current);
      cuadro.current = null;
    };
  }, [lienzo, activo]);

  const alPresionar = (e: PointerEvent<HTMLDivElement>) => {
    const el = lienzo.current;
    if (!el) return;
    suprimir.current = false;
    // El botón derecho deja su menú; el izquierdo y el del medio arrastran.
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size === 2) {
      const [a, b] = [...punteros.current.values()];
      pinza.current = { d: Math.hypot(a.x - b.x, a.y - b.y), escala: escalaRef.current };
      arrastre.current = null;
      return;
    }
    arrastre.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, movio: false };
  };
  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    const el = lienzo.current;
    if (!el) return;
    if (punteros.current.has(e.pointerId)) punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinza.current && punteros.current.size === 2) {
      const [a, b] = [...punteros.current.values()];
      const r = el.getBoundingClientRect();
      zoomEn((pinza.current.escala * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, pinza.current.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      suprimir.current = true;
      return;
    }
    const d = arrastre.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.movio && Math.hypot(dx, dy) < 4) return;
    if (!d.movio) {
      // Recién al moverse se captura el puntero: un clic en una oficina sigue llegando a la oficina.
      d.movio = true;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    }
    el.scrollLeft = d.sl - dx;
    el.scrollTop = d.st - dy;
  };
  const alSoltar = (e: PointerEvent<HTMLDivElement>) => {
    const el = lienzo.current;
    punteros.current.delete(e.pointerId);
    if (punteros.current.size < 2) pinza.current = null;
    if (arrastre.current?.movio) suprimir.current = true;
    arrastre.current = null;
    if (el) {
      el.style.cursor = "";
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    }
  };
  // El clic que cierra un arrastre no es un clic (no elige la oficina donde se soltó).
  const alClicCaptura = (e: MouseEvent<HTMLDivElement>) => {
    if (!suprimir.current) return;
    suprimir.current = false;
    e.stopPropagation();
    e.preventDefault();
  };
  const alDobleClic = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("[role=button], button, a")) return;
    const el = lienzo.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomEn(escalaRef.current * (e.shiftKey ? 1 / 1.6 : 1.6), e.clientX - r.left, e.clientY - r.top);
  };
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    // Sólo con el lienzo enfocado (en una oficina, Enter y espacio son suyos).
    if (e.target !== e.currentTarget) return;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomEn(escalaRef.current * 1.25);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomEn(escalaRef.current / 1.25);
    } else if (e.key === "0") {
      e.preventDefault();
      zoomEn(1);
    }
  };

  return {
    manejadores: {
      onPointerDown: alPresionar,
      onPointerMove: alMover,
      onPointerUp: alSoltar,
      onPointerCancel: alSoltar,
      onClickCapture: alClicCaptura,
      onDoubleClick: alDobleClic,
      onKeyDown: alTeclear,
    },
    zoomEn,
    centrarEn,
    encajar,
  };
}
