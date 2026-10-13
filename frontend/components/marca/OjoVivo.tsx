"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * El ojo de Vigía, vivo y con más píxeles: una malla de ~500 puntos que dibuja un ojo de verdad
 * (ceja, párpados en almendra, esclerótica tenue, iris en anillos, pupila blanca y un reflejo).
 * `OjoPixel` sigue siendo el logo chico de 11 × 5; éste es el de la portada.
 *
 * Qué hace, además de seguir al cursor (o al dedo) con la mirada, inclinarse en 3D y parpadear:
 *  - Cerca del cursor los puntos se agrandan y brillan, como una onda que se acerca.
 *  - Al tocarlo o hacerle clic guiña y sale una onda de puntos desde donde se tocó.
 *  - La pupila se dilata según qué tan cerca esté el cursor (ver más = abrir más).
 *  - En reposo el iris respira y la ceja se levanta un poco cuando algo se acerca.
 *
 * Seguridad (la misma lección que el resto de la portada): el servidor pinta el ojo completo y
 * quieto, con todos sus puntos visibles, y todo movimiento lo pone el cliente después de montar.
 * Con `prefers-reduced-motion` no se mueve nada. Un solo bucle de requestAnimationFrame, sólo
 * mientras el ojo está en pantalla, que cambia atributos de los puntos directamente (React no
 * vuelve a renderizar nada por cuadro) y sólo toca los puntos cuyo valor cambió.
 *
 * Rendimiento (2026-10-13): el ojo son tres capas SVG apiladas (párpado y esclerótica, iris, ceja).
 * La mirada, el parpadeo, la ceja, la inclinación y la respiración del iris son `transform` de
 * una capa entera, que compone la GPU sin volver a pintar. Antes el iris se movía con un atributo
 * dentro del SVG y la respiración reescribía el radio de ~150 puntos en cada cuadro: el SVG entero
 * (~600 círculos) se repintaba 60 veces por segundo aunque nadie lo tocara, y en el celular la
 * portada se trababa. Ahora, en reposo, el bucle no escribe nada en los puntos: sólo el cursor
 * cerca (o un toque) los agranda, y al irse vuelven a su valor una vez.
 */

// ─── Geometría ───────────────────────────────────────────────────────────────
const S = 1.3; // cuánto más densa que el dibujo base de 41 × 23
const COLS = 53;
const FILAS = 29;
const CX = COLS / 2; // 26.5: centro de una celda
const CY = FILAS / 2; // 14.5
const HW = 19.6 * S; // media anchura del ojo
const A_ARRIBA = 8.2 * S; // altura del párpado superior
const A_ABAJO = 7 * S; // y del inferior
const R_PUPILA = 1.7 * S;
const R_DILATA = 3.1 * S; // hasta aquí se abre la pupila
const R_IRIS_1 = 4.3 * S;
const R_IRIS_2 = 5.1 * S;
const R_IRIS = 5.8 * S; // borde del iris (anillo límbico)
const MAX_X = 6 * S; // cuánto se mueve el iris (en celdas)
const MAX_Y = 1.3 * S;
const RADIO_CURSOR = 7.5 * S; // alcance del cursor sobre los puntos

type Clase = "parpado" | "esclera" | "iris" | "pupila" | "dilata" | "ceja";
interface Punto {
  x: number;
  y: number;
  clase: Clase;
  r: number; // radio base
  o: number; // opacidad base
  fill: string;
  retardo: number; // ms de la entrada
  /** Sólo `dilata`: 0 en el borde de la pupila, 1 en el borde exterior del anillo. */
  anillo?: number;
}

const LIMA = "#D4FF3F";
const BLANCO = "#FFFFFF";

function construir(): { fijos: Punto[]; iris: Punto[]; ceja: Punto[] } {
  const fijos: Punto[] = [];
  const iris: Punto[] = [];
  const ceja: Punto[] = [];
  const retardo = (x: number, y: number) => Math.round(Math.hypot(x - CX, (y - CY) * 1.5) * 16);

  for (let j = 0; j < FILAS; j++) {
    for (let i = 0; i < COLS; i++) {
      const x = i + 0.5;
      const y = j + 0.5;
      const dx = x - CX;
      const dy = y - CY;
      const t = 1 - (dx / HW) ** 2;
      if (t < 0) continue;
      const h = (dy < 0 ? A_ARRIBA : A_ABAJO) * t ** 0.75;
      const ady = Math.abs(dy);
      const r = Math.hypot(dx, dy);

      // El contorno del párpado: una banda de unas 1,4 celdas pegada al borde.
      if (ady >= h - 1.0 && ady <= h + 0.45) {
        fijos.push({ x, y, clase: "parpado", r: 0.42, o: 1, fill: LIMA, retardo: retardo(x, y) });
        continue;
      }
      if (ady > h) continue;

      // Dentro del ojo.
      if (r <= R_IRIS) {
        // Reflejo: dos puntos blancos arriba a la izquierda, dentro del iris.
        const reflejo = (dx === -4 && dy === -3) || (dx === -3 && dy === -4);
        // Cuántas celdas del iris caben en el párpado con la mirada al máximo: todas las que
        // están dentro del círculo; el movimiento lo pone el grupo.
        if (reflejo) iris.push({ x, y, clase: "iris", r: 0.44, o: 1, fill: BLANCO, retardo: retardo(x, y) });
        else if (r <= R_PUPILA) iris.push({ x, y, clase: "pupila", r: 0.44, o: 1, fill: BLANCO, retardo: retardo(x, y) });
        else if (r <= R_DILATA)
          iris.push({ x, y, clase: "dilata", r: 0.4, o: 0.92, fill: LIMA, retardo: retardo(x, y), anillo: (r - R_PUPILA) / (R_DILATA - R_PUPILA) });
        else if (r <= R_IRIS_1) iris.push({ x, y, clase: "iris", r: 0.4, o: 0.92, fill: LIMA, retardo: retardo(x, y) });
        else if (r <= R_IRIS_2) iris.push({ x, y, clase: "iris", r: 0.34, o: 0.5, fill: LIMA, retardo: retardo(x, y) });
        else iris.push({ x, y, clase: "iris", r: 0.42, o: 1, fill: LIMA, retardo: retardo(x, y) });
      } else if ((i + j) % 2 === 0) {
        // La esclerótica: puntitos tenues en tablero, para que el ojo tenga cuerpo.
        fijos.push({ x, y, clase: "esclera", r: 0.17, o: 0.26, fill: LIMA, retardo: retardo(x, y) });
      }
    }
  }

  // La ceja: un arco de puntos sobre el párpado.
  for (let dx = -Math.round(16 * S); dx <= Math.round(16 * S); dx++) {
    const x = CX + dx + (CX % 1 === 0.5 ? 0 : 0.5);
    const y = Math.floor(CY - A_ARRIBA - 3.4 * S + (dx / (16 * S)) ** 2 * 3.2 * S) + 0.5;
    ceja.push({ x, y, clase: "ceja", r: 0.3, o: 0.55, fill: LIMA, retardo: retardo(x, y) });
  }
  return { fijos, iris, ceja };
}

const { fijos: FIJOS, iris: IRIS, ceja: CEJA } = construir();

/**
 * Centro vertical del ojo (párpados + iris), en % del alto del dibujo: el eje del parpadeo. Antes era
 * el `fill-box` del grupo; con capas separadas, las dos capas que parpadean comparten este origen.
 */
const ORIGEN_PARPADEO = (() => {
  const ys = [...FIJOS, ...IRIS];
  const min = Math.min(...ys.map((p) => p.y - p.r));
  const max = Math.max(...ys.map((p) => p.y + p.r));
  return `50% ${(((min + max) / 2 / FILAS) * 100).toFixed(2)}%`;
})();

// `backwards`, no `both`: el punto espera en escala 0 su turno y al terminar la animación deja de estar
// en efecto (su fin es el estado natural). Con `both` quedaban ~600 animaciones retenidas que el
// navegador volvía a aplicar en cada recálculo de estilos de la página.
const anim = (p: Punto) =>
  ({
    transformBox: "fill-box",
    transformOrigin: "center",
    animation: `puntoEntra 480ms cubic-bezier(0.22,1,0.36,1) ${p.retardo}ms backwards`,
  }) as const;

const circulo = (p: Punto, k: number) => (
  <circle key={k} cx={p.x} cy={p.y} r={p.r} fill={p.fill} fillOpacity={p.o < 1 ? p.o : undefined} style={anim(p)} />
);

const suave = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Las capas que se mueven enteras: su propia capa de composición, así moverlas no repinta. */
const CAPA: React.CSSProperties = { willChange: "transform", transformOrigin: ORIGEN_PARPADEO };
const VIEWBOX = `0 0 ${COLS} ${FILAS}`;

/** Escribe un `transform` sólo si cambió: en reposo, ningún cuadro toca el estilo. */
function ponerTransform(el: HTMLElement | SVGElement, valor: string, ultimo: { v: string }) {
  if (valor === ultimo.v) return;
  el.style.transform = valor;
  ultimo.v = valor;
}

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
  const capaOjo = useRef<SVGSVGElement>(null);
  const capaIris = useRef<HTMLDivElement>(null);
  const capaCeja = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = raiz.current;
    const sv = capaOjo.current;
    const si = capaIris.current;
    const sc = capaCeja.current;
    if (!el || !sv || !si || !sc) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // Los puntos de cada capa (el <title> de la capa del ojo no es un punto).
    const cFijos = Array.from(sv.querySelectorAll("circle"));
    const cIris = Array.from(si.querySelectorAll("circle"));
    const cCeja = Array.from(sc.querySelectorAll("circle"));

    // Lo último escrito en cada punto y en cada capa: sólo se toca el DOM si cambia.
    const ultR = new Float32Array(FIJOS.length + IRIS.length + CEJA.length);
    const ultO = new Float32Array(ultR.length);
    ultR.fill(-1);
    ultO.fill(-1);
    const ultTono = new Int8Array(IRIS.length).fill(-1);
    const tInclina = { v: "" };
    const tOjo = { v: "" };
    const tIris = { v: "" };
    const tCeja = { v: "" };

    // Mirada: objetivo y posición actual, de -1 a 1.
    let objX = 0;
    let objY = 0;
    let x = 0;
    let y = 0;
    let visible = false;
    let ultimoPuntero = -1e9;
    let proximoGiro = 0;
    let parpadeoHasta = 0;
    let proximoParpadeo = performance.now() + 2500;
    let raf = 0;
    // Cursor en coordenadas del dibujo (celdas) y ondas de los toques.
    let cur = { x: CX, y: CY };
    let dilata = 0.4;
    let ceja = 0;
    // El cuadro anterior agrandó puntos: hay que devolverlos a su valor una vez.
    let huboEfecto = false;
    const ondas: { x: number; y: number; t0: number }[] = [];
    // El último puntero sin procesar: el layout se lee una vez por cuadro, no en cada evento.
    let pendiente: { cx: number; cy: number } | null = null;

    const aDibujo = (cx: number, cy: number) => {
      const r = sv.getBoundingClientRect();
      return { x: ((cx - r.left) / r.width) * COLS, y: ((cy - r.top) / r.height) * FILAS };
    };

    const procesarPuntero = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      objX = Math.max(-1, Math.min(1, (cx - (r.left + r.width / 2)) / (window.innerWidth * 0.45)));
      objY = Math.max(-1, Math.min(1, (cy - (r.top + r.height / 2)) / (window.innerHeight * 0.45)));
      cur = aDibujo(cx, cy);
    };

    const alPuntero = (e: PointerEvent) => {
      pendiente = { cx: e.clientX, cy: e.clientY };
      ultimoPuntero = performance.now();
    };

    // Un toque o un clic: guiño y una onda de puntos desde donde se tocó.
    const alTocar = (e: PointerEvent) => {
      procesarPuntero(e.clientX, e.clientY);
      pendiente = null;
      const t = performance.now();
      ultimoPuntero = t;
      if (ondas.length >= 4) ondas.shift();
      ondas.push({ ...cur, t0: t });
      parpadeoHasta = t + 260;
      proximoParpadeo = t + 3500 + Math.random() * 3000;
    };

    const poner = (c: SVGCircleElement, k: number, r: number, o: number, baseO: number) => {
      if (Math.abs(r - ultR[k]) > 0.004) {
        c.setAttribute("r", r.toFixed(3));
        ultR[k] = r;
      }
      if (Math.abs(o - ultO[k]) > 0.01) {
        if (o >= 0.999 && baseO >= 0.999) c.removeAttribute("fill-opacity");
        else c.setAttribute("fill-opacity", o.toFixed(2));
        ultO[k] = o;
      }
    };

    const bucle = (t: number) => {
      if (!visible) return;
      // Lectura primero (una por cuadro, y sólo si el puntero se movió); después, sólo escrituras.
      if (pendiente) {
        procesarPuntero(pendiente.cx, pendiente.cy);
        pendiente = null;
      }
      const sinCursor = t - ultimoPuntero > 2600;

      // Sin cursor hace rato: la vista recorre el ojo sola.
      if (sinCursor && t > proximoGiro) {
        const dirs: [number, number][] = [[-1, 0], [0.9, -0.6], [1, 0.4], [0, 0], [-0.8, 0.7], [0.5, 0.9], [-1, -0.5]];
        const d = dirs[Math.floor(Math.random() * dirs.length)];
        objX = d[0];
        objY = d[1];
        proximoGiro = t + 1400 + Math.random() * 1800;
      }
      x += (objX - x) * 0.1;
      y += (objY - y) * 0.1;
      const gx = x * MAX_X;
      const gy = y * MAX_Y;
      ponerTransform(el, `perspective(900px) rotateY(${(x * 14).toFixed(2)}deg) rotateX(${(-y * 9).toFixed(2)}deg)`, tInclina);

      // Parpadeo: cierra los párpados 140 ms cada 3,5 a 7 s (260 ms si fue un guiño).
      if (t > proximoParpadeo) {
        parpadeoHasta = t + 140;
        proximoParpadeo = t + 3500 + Math.random() * 3500;
      }
      const cerrando = t < parpadeoHasta;
      const parpado = cerrando ? "scaleY(0.08)" : "";
      ponerTransform(sv, parpado, tOjo);

      // Cuánto cuenta el cursor: se desvanece solo cuando deja de moverse.
      const fuerza = 1 - suave(1500, 2600, t - ultimoPuntero);
      // La mirada mueve la capa del iris; su respiración es una animación CSS del SVG de adentro (`.ojo-respira`).
      ponerTransform(si, `${parpado} translate(${((gx / COLS) * 100).toFixed(2)}%, ${((gy / FILAS) * 100).toFixed(2)}%)`, tIris);

      // Dilatación: cerca del cursor abre; en reposo late despacio.
      const dist = Math.hypot(cur.x - CX, cur.y - CY);
      const cerca = (1 - suave(4 * S, 34 * S, dist)) * fuerza;
      const objDil = sinCursor ? 0.4 + 0.15 * Math.sin(t / 900) : 0.2 + 0.8 * cerca;
      dilata += (objDil - dilata) * 0.12;
      ceja += (cerca - ceja) * 0.1;
      ponerTransform(sc, `translate(0, ${(((-1.1 * S * ceja + (cerrando ? 0.5 : 0)) / FILAS) * 100).toFixed(2)}%)`, tCeja);

      // El anillo que se abre con la pupila: blanco cuando está abierta hasta ahí, lima cuando no.
      for (let n = 0; n < IRIS.length; n++) {
        const p = IRIS[n];
        if (p.clase !== "dilata") continue;
        const tono = Math.round(suave(-0.12, 0.12, dilata - (p.anillo ?? 0)) * 6);
        if (tono !== ultTono[n]) {
          ultTono[n] = tono;
          const m = tono / 6;
          cIris[n].setAttribute("fill", `rgb(${Math.round(212 + 43 * m)},255,${Math.round(63 + 192 * m)})`);
        }
      }

      // Ondas vivas.
      for (let w = ondas.length - 1; w >= 0; w--) if (t - ondas[w].t0 > 1500) ondas.splice(w, 1);
      const hayOndas = ondas.length > 0;
      const hayCursor = fuerza > 0.01;

      // Los puntos sólo se tocan si el cursor o una onda los alcanza, y una vez más al irse (vuelven a su valor).
      if (hayCursor || hayOndas || huboEfecto) {
        huboEfecto = hayCursor || hayOndas;
        const efecto = (px: number, py: number): number => {
          let v = 0;
          if (hayCursor) {
            const d = Math.hypot(px - cur.x, py - cur.y);
            if (d < RADIO_CURSOR) v += (1 - d / RADIO_CURSOR) ** 2 * fuerza;
          }
          if (hayOndas) {
            for (const o of ondas) {
              const a = (t - o.t0) / 1000;
              const frente = a * 26 * S * 0.55;
              const d = Math.hypot(px - o.x, py - o.y);
              const q = 1 - Math.abs(d - frente) / (2.4 * S);
              if (q > 0) v += q * Math.max(0, 1 - a / 1.5) * 1.2;
            }
          }
          return Math.min(1.6, v);
        };

        let k = 0;
        for (let n = 0; n < FIJOS.length; n++, k++) {
          const p = FIJOS[n];
          const v = huboEfecto ? efecto(p.x, p.y) : 0;
          poner(cFijos[n], k, p.r * (1 + 0.9 * v), Math.min(1, p.o + 0.55 * v), p.o);
        }
        for (let n = 0; n < IRIS.length; n++, k++) {
          const p = IRIS[n];
          const v = huboEfecto ? efecto(p.x + gx, p.y + gy) : 0;
          poner(cIris[n], k, p.r * (1 + 0.8 * v), Math.min(1, p.o + 0.5 * v), p.o);
        }
        for (let n = 0; n < CEJA.length; n++, k++) {
          const p = CEJA[n];
          const v = huboEfecto ? efecto(p.x, p.y) : 0;
          poner(cCeja[n], k, p.r * (1 + 0.9 * v), Math.min(1, p.o + 0.5 * v), p.o);
        }
      }
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
    el.addEventListener("pointerdown", alTocar);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", alPuntero);
      el.removeEventListener("pointerdown", alTocar);
      for (const capa of [el, sv, si, sc]) capa.style.transform = "";
    };
  }, []);

  return (
    <div ref={raiz} className={cn("relative will-change-transform", className)} style={{ transformStyle: "preserve-3d" }}>
      {/* Párpados y esclerótica: la capa que da el tamaño. Iris y ceja se apilan encima, con el mismo viewBox. */}
      <svg
        ref={capaOjo}
        viewBox={VIEWBOX}
        width={tamano}
        height={(tamano * FILAS) / COLS}
        className="block h-auto w-full overflow-visible"
        style={CAPA}
        {...(titulo ? { role: "img", "aria-label": titulo } : { "aria-hidden": true })}
        focusable="false"
      >
        {titulo && <title>{titulo}</title>}
        {FIJOS.map(circulo)}
      </svg>
      {/* El iris: la capa se mueve con la mirada (JS) y el SVG de adentro respira (CSS, en la GPU). */}
      <div ref={capaIris} aria-hidden className="pointer-events-none absolute inset-0" style={CAPA}>
        <svg viewBox={VIEWBOX} focusable="false" className="ojo-respira h-full w-full overflow-visible">
          {IRIS.map(circulo)}
        </svg>
      </div>
      <svg ref={capaCeja} viewBox={VIEWBOX} aria-hidden focusable="false" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" style={CAPA}>
        {CEJA.map(circulo)}
      </svg>
    </div>
  );
}
