"use client";

import { useRef } from "react";
import { CON_MOVIMIENTO, useEscenaGsap } from "@/lib/gsap";
import { FranjaTextil } from "@/components/marca";
import { EnlaceAccion } from "./EnlaceAccion";

/**
 * La portada: qué es Vigía, en cinco segundos, y la lupa que se abre.
 *
 * El símbolo de la marca es una lupa con una llama adentro, sobre tejido
 * andino: "vigía" es mirar de cerca. Por eso es la lupa, y no otra cosa, lo que
 * crece con el scroll: se desplaza al centro, se agranda y termina ABRIÉNDOSE —
 * un círculo oscuro nace de su interior y cubre la pantalla. Lo que aparece del
 * otro lado es lo que Vigía ve: la escala del dinero público. La animación no
 * decora, cuenta el concepto del producto.
 *
 * Lo que NO se anima, a propósito:
 *  - El titular no tiene entrada. Es el LCP de la página, y la última vez que
 *    esta portada sirvió contenido con `opacity: 0` desde el servidor, 11 de 14
 *    filas quedaron invisibles en producción. El movimiento vive en el scroll,
 *    nunca en la carga.
 *  - En pantallas angostas o con movimiento reducido no hay pin: la portada es
 *    estática y la sección oscura sigue abajo, completa. Nada del contenido
 *    depende de la animación para leerse.
 *
 * La prueba de los cinco segundos (qué es, para quién, por qué, qué hacer) la
 * pasa el texto solo. El usuario ya rechazó portadas cinematográficas que no
 * decían qué es el producto: acá lo cinematográfico viene DESPUÉS del mensaje.
 *
 * La lupa es el logo de verdad —la manta tejida, la llama blanca—, no el
 * `Isotipo` en SVG. El isotipo es para la cabecera, el pie y todo lo que mide
 * menos de ~100 px; a tamaño de portada, sus dieciséis tramos de color plano se
 * leen como una rueda de colores y se pierde lo que hace reconocible a la
 * marca: el tejido. No pasa por el optimizador de Next (con la caché fría de
 * cada deploy era el problema que DESIGN_SYSTEM.md le atribuye al PNG): se
 * sirven dos WebP ya recortados (544 y 720 px, generados con ffmpeg desde
 * `lupa-llama.webp`) y el navegador elige con `srcSet` y `sizes`.
 *
 * Detrás, un disco de papel granate muy claro, centrado en el lente, le da
 * peso sin halo difuso (nada de brillo "IA"). Abajo, la franja textil cierra la
 * escena como el borde de una manta.
 */

/** Centro del lente dentro de la imagen recortada, en fracción del ancho y alto. */
const LENTE = { x: 0.465, y: 0.455 };
/** Diámetro del disco interior del lente (el vino donde está la llama), en fracción del ancho. */
const INTERIOR = 0.666;
/** Escala de la lupa cuando llega al centro. */
const EN_CENTRO = 1.2;
/** Diámetro base del círculo que se abre. Chico a propósito: escala con transform, no con width. */
const ABERTURA = 120;

export function HeroLupa() {
  const escena = useRef<HTMLDivElement>(null);

  // GSAP se baja sólo si aplica CON_MOVIMIENTO (pantalla ancha, sin movimiento reducido).
  useEscenaGsap(escena, CON_MOVIMIENTO, ({ gsap }) => {
    const raiz = escena.current!;
    const ancla = raiz.querySelector<HTMLElement>(".lupa-ancla")!;

    // Cuánto hay que mover la lupa para que el CENTRO DEL LENTE (no el de la
    // imagen) quede en el centro de la escena. Se mide el ancla, que nunca se
    // transforma, para que un refresco no mida la lupa ya desplazada.
    const hastaCentro = () => {
      const e = raiz.getBoundingClientRect();
      const a = ancla.getBoundingClientRect();
      return {
        x: e.left + e.width / 2 - (a.left + a.width * LENTE.x),
        y: e.top + e.height / 2 - (a.top + a.height * LENTE.y),
      };
    };
    const cubrir = () => (Math.hypot(raiz.clientWidth, raiz.clientHeight) / ABERTURA) * 1.08;
    // El círculo NACE del tamaño exacto del disco interior del lente. Si
    // arrancara en cero se vería primero como un punto negro sobre el cuerpo
    // de la llama: una mancha, no una apertura. Así, primero la llama se
    // funde en oscuro y recién después el lente se abre.
    const interior = () => (ancla.getBoundingClientRect().width * EN_CENTRO * INTERIOR) / ABERTURA;
    // La lupa escala desde el centro del LENTE: así, al agrandarse, el disco
    // con la llama queda exactamente donde nace la abertura.
    gsap.set(".lupa", { transformOrigin: `${LENTE.x * 100}% ${LENTE.y * 100}%` });

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
        // Cuando la lupa ya cubrió la escena, lo que hay bajo el header es
        // negro: se lo dice al header (que lee `data-tema`) para que pase a
        // vidrio oscuro junto con la página.
        onUpdate: (self) => {
          raiz.dataset.tema = self.progress > 0.62 ? "oscuro" : "claro";
        },
      },
    });

    tl.to(".hero-texto", { autoAlpha: 0, y: -56, duration: 0.3 }, 0)
      .to(
        ".lupa",
        { x: () => hastaCentro().x, y: () => hastaCentro().y, scale: EN_CENTRO, duration: 0.36, ease: "power1.inOut" },
        0,
      )
      // 1. El interior del lente se oscurece: la llama se funde en negro.
      .fromTo(".abertura", { scale: interior, autoAlpha: 0 }, { scale: interior, autoAlpha: 1, duration: 0.12 }, 0.34)
      // 2. El lente se abre y cubre la escena, mientras la lupa pasa de largo.
      .to(".abertura", { scale: cubrir, duration: 0.4, ease: "power2.in" }, 0.46)
      .to(".lupa", { scale: 2.6, autoAlpha: 0, duration: 0.3, ease: "power1.in" }, 0.5)
      // 3. La frase puente: sin ella, al soltar el pin quedaba casi una
      // pantalla de negro mudo antes de que subiera la cifra.
      .fromTo(".puente", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.12 }, 0.82)
      .to({}, { duration: 0.08 });

    return () => {
      delete raiz.dataset.tema;
    };
  });

  return (
    <section id="inicio" aria-labelledby="hero-titulo" className="relative">
      <div
        ref={escena}
        className="relative isolate flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-paper"
      >
        <div className="container-page grid w-full max-w-7xl flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:py-16">
          <div className="hero-texto relative z-10">
            <h1
              id="hero-titulo"
              className="max-w-[18ch] text-balance font-display text-[2.5rem] font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[3.5rem]"
            >
              ¿En qué se gasta el dinero de tu región?
            </h1>
            <p className="mt-6 max-w-[46ch] text-pretty text-lg leading-relaxed text-inkSoft sm:text-xl">
              Vigía lee los contratos del Estado, los cruza con registros oficiales y te muestra cuáles merecen una
              segunda mirada.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <EnlaceAccion href="/app/mapa" tamano="lg">
                Ver mi región
              </EnlaceAccion>
              <EnlaceAccion href="#como" variante="secundario" tamano="lg" flecha={false}>
                Cómo funciona
              </EnlaceAccion>
            </div>
          </div>

          {/* El ancla no se transforma nunca: es la referencia para medir. */}
          <div className="lupa-ancla relative z-20 mx-auto w-[min(64vw,17rem)] sm:w-[min(52vw,22rem)] lg:w-[min(38vw,30rem)]">
            <div className="lupa relative will-change-transform">
              {/* El disco de fondo, centrado en el lente (46.5 %, 45.5 %) y no en
                  el cuadro: la lupa parece apoyada sobre su propia luz. */}
              <div
                aria-hidden
                className="absolute -left-[8.5%] -top-[9.5%] -z-10 aspect-square w-[110%] rounded-full bg-granate-50 ring-1 ring-granate/10"
              />
              {/* `<img>` con dos tamaños (544 y 720 px) en vez de `next/image` sin optimizar: el
                  celular baja la de 544 (51 KB) y no la de 720 (93 KB). Es el LCP en el celular:
                  va en el HTML, con prioridad alta, sin esperar a ningún JS. Los `sizes` copian
                  los anchos de `.lupa-ancla`. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/logo/lupa-llama-720.webp"
                srcSet="/assets/logo/lupa-llama-544.webp 544w, /assets/logo/lupa-llama-720.webp 720w"
                sizes="(min-width: 1264px) 480px, (min-width: 1024px) 38vw, (min-width: 677px) 352px, (min-width: 640px) 52vw, (min-width: 425px) 272px, 64vw"
                alt="El símbolo de Vigía: una lupa tejida en manta andina, con una llama adentro"
                width={720}
                height={725}
                fetchPriority="high"
                loading="eager"
                className="h-auto w-full select-none"
              />
            </div>
          </div>
        </div>

        {/* La franja textil, como el borde de una manta: cierra la portada y da
            paso a lo oscuro. Con la animación, la abertura la cubre. */}
        <FranjaTextil alto={12} />

        {/* El círculo que nace del lente y cubre la escena. Escala con transform
            (compuesto en GPU), nunca con width/height. Invisible sin JS y en
            pantallas angostas: ahí no hay pin y la sección oscura sigue abajo. */}
        <div
          aria-hidden
          className="abertura pointer-events-none absolute left-1/2 top-1/2 z-30 hidden scale-0 rounded-full bg-ink lg:block"
          style={{ width: ABERTURA, height: ABERTURA, marginLeft: -ABERTURA / 2, marginTop: -ABERTURA / 2 }}
        />
        {/* Sólo existe del otro lado de la lupa, o sea con movimiento y en
            pantalla ancha. Sin animación, la sección oscura empieza sola y no
            hace falta el puente. */}
        <p
          aria-hidden
          className="puente pointer-events-none invisible absolute inset-0 z-40 hidden items-center justify-center text-center font-display text-3xl font-bold text-paper/85 lg:flex"
        >
          Esto es lo que Vigía mira.
        </p>
      </div>
    </section>
  );
}
