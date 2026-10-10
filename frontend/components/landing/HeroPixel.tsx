"use client";

import { useRef } from "react";
import { CON_MOVIMIENTO, useEscenaGsap } from "@/lib/gsap";
import { FranjaTextil, Medalla, OjoVivo } from "@/components/marca";
import { AliadoAbrir } from "@/components/aliados/AliadoAbrir";
import type { FilaRanking } from "@/components/aliados/ranking";
import { numero } from "@/lib/formato";
import { EnlaceAccion } from "./EnlaceAccion";

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

/** Malla de celdas del disuelto: columnas y filas fijas, cada celda crece desde su centro. */
const COLS = 30;
const FILAS = 17;
const CELDAS = Array.from({ length: COLS * FILAS }, (_, i) => i);

/** Los tres del podio, ya en la primera pantalla: quién hace posible la lectura, y un toque para ver quién es. */
function LoHacenPosible({ aliados }: { aliados: FilaRanking[] }) {
  if (aliados.length === 0) return null;
  return (
    <div className="mt-10">
      <p className="etiqueta-mono mb-3">Lo hacen posible</p>
      <ul className="flex flex-wrap gap-2.5">
        {aliados.slice(0, 3).map((f) => (
          <li key={f.id}>
            <AliadoAbrir
              fila={f}
              className="group/mini flex items-center gap-2.5 rounded-full border border-paperEdge bg-paperSoft/80 py-1.5 pl-1.5 pr-4 transition-colors hover:border-granate hover:bg-paperDeep"
            >
              <Medalla puesto={Math.min(f.puesto, 3) as 1 | 2 | 3} tamano={30} corona={false} />
              <span className="flex flex-col leading-tight">
                <span className="max-w-[11rem] truncate text-[14px] font-semibold text-ink">{f.nombre}</span>
                <span className="text-[12px] text-mute">
                  {numero(f.contratosFinanciados)} {f.contratosFinanciados === 1 ? "contrato" : "contratos"}
                </span>
              </span>
            </AliadoAbrir>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HeroPixel({ aliados = [], precio = null }: { aliados?: FilaRanking[]; precio?: number | null }) {
  const escena = useRef<HTMLDivElement>(null);

  useEscenaGsap(escena, CON_MOVIMIENTO, ({ gsap }) => {
    const raiz = escena.current!;
    const ancla = raiz.querySelector<HTMLElement>(".ojo-ancla")!;

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
      // La malla crece desde el centro hacia afuera (la pupila).
      .fromTo(
        ".celda",
        { scale: 0, backgroundColor: "#D4FF3F" },
        {
          scale: 1.04,
          backgroundColor: "#040707", // el frente de la ola es lima y se apaga a carbón
          duration: 0.46,
          ease: "power2.in",
          stagger: { amount: 0.34, grid: [FILAS, COLS], from: "center" },
        },
        0.32,
      )
      .to(".ojo-escena", { autoAlpha: 0, duration: 0.14 }, 0.66)
      // La frase puente: sin ella, al soltar el pin quedaba casi una pantalla de
      // oscuro mudo antes de que subiera la cifra.
      .fromTo(".puente", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.12 }, 0.84)
      .to({}, { duration: 0.06 });

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
        <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0 -z-10" />

        <div className="container-page grid w-full max-w-7xl flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:py-16">
          <div className="hero-texto relative z-10">
            <p className="etiqueta-mono mb-5 text-granate">Plataforma cívica anticorrupción</p>
            <h1
              id="hero-titulo"
              className="max-w-[18ch] text-balance font-display text-[2.5rem] font-bold leading-[1.04] tracking-tight text-ink sm:text-5xl lg:text-[3.6rem]"
            >
              ¿En qué se gasta el dinero de tu <span className="text-granate">región?</span>
            </h1>
            <p className="mt-6 max-w-[46ch] text-pretty text-lg leading-relaxed text-inkSoft sm:text-xl">
              Agentes de inteligencia artificial leen los contratos del Estado y los cruzan con registros oficiales
              para detectar indicios de corrupción. Tú ves cuáles merecen una segunda mirada.
            </p>
            <p className="mt-4 max-w-[46ch] rounded-xl border border-paperEdge bg-paperSoft/80 px-4 py-3 text-[15px] leading-snug text-inkSoft">
              <span className="font-semibold text-ink">Nos financiamos con donaciones.</span>{" "}
              {precio != null
                ? `Con S/ ${numero(precio)} pagas la lectura de un contrato. Tu granito de arena sí cuenta.`
                : "Tu granito de arena paga la lectura de contratos."}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <EnlaceAccion href="/app/mapa" tamano="lg">
                Ver mi región
              </EnlaceAccion>
              <EnlaceAccion href="/app/financiar" variante="secundario" tamano="lg" flecha={false}>
                Aportar mi granito
              </EnlaceAccion>
            </div>
            <LoHacenPosible aliados={aliados} />
          </div>

          <div className="ojo-ancla relative z-20 mx-auto w-[min(78vw,22rem)] sm:w-[min(60vw,28rem)] lg:w-[min(42vw,36rem)]">
            <div className="ojo-escena will-change-transform">
              <OjoVivo tamano={560} titulo="El símbolo de Vigía: un ojo hecho de puntos que mira" className="h-auto w-full" />
            </div>
          </div>
        </div>

        <FranjaTextil alto={12} />

        {/* La malla que disuelve la pantalla en píxeles. Sólo existe con movimiento y en
            pantalla ancha: ahí hay pin. Sin animación la sección oscura empieza sola. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 hidden lg:grid"
          style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${FILAS}, 1fr)` }}
        >
          {CELDAS.map((i) => (
            <span key={i} className="celda block scale-0 bg-ink" />
          ))}
        </div>
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
