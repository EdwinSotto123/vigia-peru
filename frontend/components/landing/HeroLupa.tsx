"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CON_MOVIMIENTO, gsap, useGSAP } from "@/lib/gsap";

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

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(CON_MOVIMIENTO, () => {
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
      });
      return () => {
        mm.revert();
        delete escena.current?.dataset.tema;
      };
    },
    { scope: escena },
  );

  return (
    <section id="inicio" aria-labelledby="hero-titulo" className="relative">
      <div
        ref={escena}
        className="relative isolate flex min-h-[calc(100dvh-4rem)] items-center overflow-hidden bg-paper"
      >
        {/* Halo detrás de la lupa: le da profundidad al blanco sin competir con ella. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-[10%] top-1/2 -z-10 h-[46rem] w-[46rem] -translate-y-1/2 rounded-full bg-heroViolet-soft/70 blur-3xl"
        />

        <div className="container-page grid w-full max-w-[1400px] items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:py-16">
          <div className="hero-texto relative z-10">
            <h1
              id="hero-titulo"
              className="max-w-[20ch] text-balance font-serif text-[2.6rem] font-bold leading-[1.04] tracking-tight text-ink sm:text-6xl xl:text-[4.25rem]"
            >
              ¿En qué se gasta el dinero de tu región?
            </h1>
            <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-inkSoft sm:text-xl">
              Vigía lee los contratos del Estado, los cruza con registros oficiales y te muestra cuáles merecen una
              segunda mirada.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/app/mapa"
                className="group inline-flex items-center gap-2 rounded-full bg-heroViolet px-7 py-4 text-base font-semibold text-paper shadow-card transition-transform duration-rapido hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50 focus-visible:ring-offset-2"
              >
                Ver mi región
                <ArrowRight size={18} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <a
                href="#como"
                className="inline-flex items-center rounded-full px-5 py-4 text-base font-semibold text-ink underline-offset-4 transition-colors duration-rapido hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50"
              >
                Cómo funciona
              </a>
            </div>
          </div>

          {/* El ancla no se transforma nunca: es la referencia para medir. */}
          <div className="lupa-ancla relative z-20 mx-auto w-[min(78vw,26rem)] lg:w-[min(40vw,32rem)]">
            <div className="lupa will-change-transform">
              <Image
                src="/assets/logo/lupa-llama.webp"
                alt="El símbolo de Vigía: una lupa con una llama adentro, sobre tejido andino"
                width={720}
                height={725}
                priority
                sizes="(min-width: 1024px) 40vw, 78vw"
                className="h-auto w-full select-none drop-shadow-[0_24px_48px_rgba(51,36,99,0.22)]"
              />
            </div>
          </div>
        </div>

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
          className="puente pointer-events-none invisible absolute inset-0 z-40 hidden items-center justify-center text-center font-serif text-3xl text-paper/85 lg:flex"
        >
          Esto es lo que Vigía mira.
        </p>
      </div>
    </section>
  );
}
