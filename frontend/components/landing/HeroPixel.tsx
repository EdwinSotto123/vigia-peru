"use client";

import { useRef } from "react";
import { CON_MOVIMIENTO, useEscenaGsap } from "@/lib/gsap";
import { FranjaTextil, Medalla, OjoVivo } from "@/components/marca";
import { AliadoAbrir } from "@/components/aliados/AliadoAbrir";
import type { FilaRanking } from "@/components/aliados/ranking";
import { numero } from "@/lib/formato";
import { EnlaceAccion } from "./EnlaceAccion";
import { PUESTO_POR_EL_EQUIPO_PEN } from "@/lib/costoCorrupcion";

/**
 * La portada (identidad Píxel): qué es Vigía, en cinco segundos, y un ojo hecho de
 * puntos que mira.
 *
 * El movimiento cuenta el concepto: con el scroll el ojo se agranda hasta el centro y
 * la pantalla se DISUELVE EN PÍXELES, una malla de celdas carbón que crece desde la
 * pupila hacia los bordes. Lo que aparece del otro lado es lo que Vigía mira: la
 * escala del dinero público.
 *
 * Lo que NO se anima, a propósito (igual que la portada anterior):
 *  - El titular no tiene entrada. Es el LCP y la última vez que esta portada sirvió
 *    contenido con `opacity: 0` desde el servidor, 11 de 14 filas quedaron invisibles
 *    en producción. El movimiento vive en el scroll, nunca en la carga.
 *  - En pantallas angostas o con movimiento reducido no hay pin: la portada es
 *    estática y la sección oscura sigue abajo, completa.
 *  - El ojo SÍ entra con una animación CSS (cada punto crece desde el centro), pero
 *    sólo con `transform`: si el CSS no corre, el ojo está completo igual.
 */

/**
 * Malla de celdas del disuelto: columnas y filas fijas, cada celda crece desde su centro. Se dibuja en
 * UN canvas: antes eran 510 <span> (también en el celular, ocultos) y GSAP les animaba escala y color
 * de fondo en cada cuadro del scroll; ahora el scroll mueve un número y el canvas pinta la malla.
 */
const COLS = 30;
const FILAS = 17;
/** Lo que dura cada celda y cuánto se reparte el comienzo entre el centro y el borde (en tiempo de la línea). */
const DURACION_CELDA = 0.46;
const REPARTO = 0.34;
/** El frente de la ola es lima y se apaga a carbón. */
const LIMA = [212, 255, 63] as const;
const CARBON = [4, 7, 7] as const;

/** Cuándo empieza cada celda: por su distancia al centro de la malla (el `stagger` de GSAP con `from: "center"`). */
const INICIO_CELDA = (() => {
  const cx = (COLS - 1) / 2;
  const cy = (FILAS - 1) / 2;
  const max = Math.hypot(cx, cy);
  return Array.from({ length: COLS * FILAS }, (_, k) => (Math.hypot((k % COLS) - cx, Math.floor(k / COLS) - cy) / max) * REPARTO);
})();

/** Pinta la malla con el avance `t` (0 a DURACION_CELDA + REPARTO) de la ola. */
function pintarMalla(lienzo: HTMLCanvasElement, t: number) {
  const ctx = lienzo.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = lienzo;
  ctx.clearRect(0, 0, w, h);
  if (t <= 0) return;
  const cw = w / COLS;
  const ch = h / FILAS;
  for (let k = 0; k < INICIO_CELDA.length; k++) {
    const lp = Math.min(1, Math.max(0, (t - INICIO_CELDA[k]) / DURACION_CELDA));
    if (lp <= 0) continue;
    const e = lp * lp; // power2.in
    const s = 1.04 * e;
    ctx.fillStyle = `rgb(${LIMA.map((c, i) => Math.round(c + (CARBON[i] - c) * e)).join(",")})`;
    const x = (k % COLS) * cw + (cw * (1 - s)) / 2;
    const y = Math.floor(k / COLS) * ch + (ch * (1 - s)) / 2;
    ctx.fillRect(x, y, cw * s, ch * s);
  }
}

/** Los tres del podio, ya en la primera pantalla: quién hace posible la lectura, y un toque para ver quién es. */
function LoHacenPosible({ aliados }: { aliados: FilaRanking[] }) {
  if (aliados.length === 0) return null;
  return (
    // El rótulo va en la misma fila que los aliados y en letra normal: en versalitas encima era un antetítulo (prohibido).
    <div className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <p className="text-meta font-semibold text-inkSoft">Lo hacen posible</p>
      <ul className="flex flex-wrap gap-2.5" aria-label="Lo hacen posible">
        {/* recorte: tres aliados en la portada; todos, en /app/aliados */}
        {aliados.slice(0, 3).map((f) => (
          <li key={f.id}>
            <AliadoAbrir
              fila={f}
              className="group/mini flex items-center gap-2.5 rounded-full border border-paperEdge bg-paperSoft/80 py-1.5 pl-1.5 pr-4 transition-colors hover:border-granate hover:bg-paperDeep"
            >
              <Medalla puesto={Math.min(f.puesto, 3) as 1 | 2 | 3} tamano={30} corona={false} />
              <span className="flex flex-col leading-tight">
                <span className="max-w-[11rem] truncate text-dato font-semibold text-ink">{f.nombre}</span>
                <span className="text-rotulo text-mute">
                  {numero(f.meses ?? 0)} {f.meses === 1 ? "mes" : "meses"} sosteniendo
                </span>
              </span>
            </AliadoAbrir>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HeroPixel({ aliados = [], piso = null }: { aliados?: FilaRanking[]; /** Lo que cuesta mantener Vigía al mes (S/). */ piso?: number | null }) {
  const escena = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);

  useEscenaGsap(escena, CON_MOVIMIENTO, ({ gsap }) => {
    const raiz = escena.current!;
    const ancla = raiz.querySelector<HTMLElement>(".ojo-ancla")!;
    const malla = lienzo.current!;

    // El canvas toma el tamaño de la escena (en píxeles del dispositivo) y se repinta con el avance actual.
    const ola = { t: 0 };
    const medir = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(malla.clientWidth * dpr);
      const h = Math.round(malla.clientHeight * dpr);
      if (malla.width !== w || malla.height !== h) {
        malla.width = w;
        malla.height = h;
        pintarMalla(malla, ola.t);
      }
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(malla);

    // Cuánto mover el ojo para que su centro (la pupila) quede en el centro de la
    // escena. Se mide el ancla, que nunca se transforma, así un refresco no mide el
    // ojo ya desplazado.
    const hastaCentro = () => {
      const e = raiz.getBoundingClientRect();
      const a = ancla.getBoundingClientRect();
      return { x: e.left + e.width / 2 - (a.left + a.width / 2), y: e.top + e.height / 2 - (a.top + a.height / 2) };
    };

    const tl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: raiz,
        start: "top 64px", // debajo del header fijo
        end: "+=130%",
        pin: true,
        scrub: 0.8,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        // Cuando la malla ya cubrió la escena, lo que hay bajo el header es carbón
        // más oscuro: se lo dice al header (que lee `data-tema`).
        onUpdate: (self) => {
          raiz.dataset.tema = self.progress > 0.62 ? "oscuro" : "claro";
        },
      },
    });

    tl.to(".hero-texto", { autoAlpha: 0, y: -56, duration: 0.3 }, 0)
      // El ojo se agranda y se centra.
      .to(
        ".ojo-escena",
        { x: () => hastaCentro().x, y: () => hastaCentro().y, scale: 1.3, duration: 0.4, ease: "power1.inOut" },
        0,
      )
      // La malla crece desde el centro hacia afuera (la pupila): el scroll mueve la ola y el canvas la pinta.
      .fromTo(
        ola,
        { t: 0 },
        { t: DURACION_CELDA + REPARTO, duration: DURACION_CELDA + REPARTO, onUpdate: () => pintarMalla(malla, ola.t) },
        0.32,
      )
      .to(".ojo-escena", { autoAlpha: 0, duration: 0.14 }, 0.66)
      // La frase puente: sin ella, al soltar el pin quedaba casi una pantalla de
      // oscuro mudo antes de que subiera la cifra.
      .fromTo(".puente", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.12 }, 0.84)
      .to({}, { duration: 0.06 });

    return () => {
      ro.disconnect();
      pintarMalla(malla, 0);
      delete raiz.dataset.tema;
    };
  });

  return (
    <section id="inicio" aria-labelledby="hero-titulo" className="relative">
      <div
        ref={escena}
        className="relative isolate flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-paper"
      >
        <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0 -z-10" />

        <div className="container-page grid w-full max-w-7xl flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:py-16">
          <header className="hero-texto relative z-10">
            <h1
              id="hero-titulo"
              className="max-w-[18ch] text-balance font-display text-[2.5rem] font-bold leading-[1.04] tracking-tight text-ink sm:text-5xl lg:text-[3.6rem]"
            >
              ¿En qué se gasta el dinero de tu <span className="text-granate">región?</span>
            </h1>
            <p className="mt-6 max-w-[46ch] text-pretty text-bloque leading-relaxed text-inkSoft sm:text-xl">
              Agentes de inteligencia artificial leen los contratos del Estado y los cruzan con registros oficiales
              para detectar indicios de corrupción. Tú ves cuáles merecen una segunda mirada.
            </p>
            <p className="mt-4 max-w-[46ch] rounded-xl border border-paperEdge bg-paperSoft/80 px-4 py-3 text-cuerpo leading-snug text-inkSoft">
              <span className="font-semibold text-ink">Nos sostenemos con aportes ciudadanos.</span>{" "}
              {`Hasta hoy pusimos casi S/ ${numero(PUESTO_POR_EL_EQUIPO_PEN)} para que exista. `}
              {piso != null
                ? `Mantenerla encendida cuesta S/ ${numero(piso)} al mes: tu granito de arena sí cuenta.`
                : "Tu granito de arena nos mantiene vigilando."}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <EnlaceAccion href="/app/mapa" tamano="lg">
                Ver mi región
              </EnlaceAccion>
              <EnlaceAccion href="/app/apoyar" variante="secundario" tamano="lg" flecha={false}>
                Aportar mi granito
              </EnlaceAccion>
            </div>
            <LoHacenPosible aliados={aliados} />
          </header>

          <div className="ojo-ancla relative z-20 mx-auto w-[min(78vw,22rem)] sm:w-[min(60vw,28rem)] lg:w-[min(42vw,36rem)]">
            <div className="ojo-escena will-change-transform">
              <OjoVivo tamano={560} titulo="El símbolo de Vigía: un ojo hecho de puntos que mira" className="h-auto w-full" />
            </div>
          </div>
        </div>

        <FranjaTextil alto={12} />

        {/* La malla que disuelve la pantalla en píxeles. Sólo se pinta con movimiento y en
            pantalla ancha: ahí hay pin. Sin animación queda vacía y la sección oscura empieza sola. */}
        <canvas ref={lienzo} aria-hidden className="pointer-events-none absolute inset-0 z-30 hidden h-full w-full lg:block" />
        <p
          aria-hidden
          className="puente pointer-events-none invisible absolute inset-0 z-40 hidden items-center justify-center text-center font-display text-3xl font-bold text-ink/85 lg:flex"
        >
          Vigía mira. Alguien lo hace posible.
        </p>
      </div>
    </section>
  );
}
