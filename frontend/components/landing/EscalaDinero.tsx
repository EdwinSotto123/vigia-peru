"use client";

import { useRef } from "react";
import { gsap, SIN_REDUCIR, useGSAP } from "@/lib/gsap";

/**
 * Lo que se ve del otro lado de la lupa: la escala del dinero público, y cuánto
 * de eso lee alguien.
 *
 * Cada punto de la matriz son 20 contratos: 18 394 contratos son 920 puntos, y
 * los 98 que Vigía leyó a fondo son cinco. La matriz se construye con el scroll
 * —la masa sin leer primero, los cinco verdes al final— porque el orden ES el
 * argumento: primero se entiende cuánto hay, después cuán poco se miró.
 *
 * Un solo `<rect>` con un patrón de puntos, no 920 nodos: la matriz entera
 * cuesta un elemento en el DOM y la revelación es un solo tween sobre el ancho
 * del recorte. En móvil también se construye (no hay pin, es liviano); con
 * movimiento reducido aparece completa desde el principio.
 *
 * Todas las cifras llegan por props desde el servidor, que las lee de la API.
 * Si la API no responde, esta sección no se dibuja: una portada que estima
 * cuántos contratos quedaron sin leer es exactamente el tipo de dato que este
 * producto le reprocha al Estado.
 */

const POR_PUNTO = 20;
const COLUMNAS = 46;

export function EscalaDinero({
  montoTotal,
  publicados,
  leidos,
  senalAlta,
}: {
  /** Suma del monto de los contratos de las 25 regiones, en soles. */
  montoTotal: number;
  publicados: number;
  leidos: number;
  senalAlta: number;
}) {
  const raiz = useRef<HTMLElement>(null);
  const n = (v: number) => v.toLocaleString("es-PE");

  const puntos = Math.ceil(publicados / POR_PUNTO);
  const filas = Math.ceil(puntos / COLUMNAS);
  const verdes = Math.max(1, Math.round(leidos / POR_PUNTO));
  const milMillones = Math.floor(montoTotal / 1e9);
  const millones = Math.round(montoTotal / 1e6);
  const pct = publicados > 0 ? (leidos / publicados) * 100 : 0;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(SIN_REDUCIR, () => {
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          // Termina cuando la matriz llega al CENTRO de la pantalla, que es donde se
          // la lee. Con `bottom 45%` los cinco puntos verdes —el remate de toda la
          // sección— todavía no habían aparecido en esa posición.
          scrollTrigger: { trigger: ".matriz", start: "top 88%", end: "center 58%", scrub: 0.6 },
        });
        tl.fromTo(".matriz-recorte", { attr: { width: 0 } }, { attr: { width: COLUMNAS }, duration: 0.72 })
          .fromTo(
            ".punto-leido",
            { scale: 0, transformOrigin: "50% 50%" },
            { scale: 1, duration: 0.18, stagger: 0.02, ease: "back.out(3)" },
            0.74,
          );

        // El 98 cuenta hacia arriba cuando entra, una sola vez: es la cifra que la
        // matriz acaba de mostrar, dicha en número.
        const cifra = raiz.current!.querySelector<HTMLElement>(".cifra-leidos")!;
        const valor = { v: 0 };
        gsap.to(valor, {
          v: leidos,
          duration: 1.2,
          ease: "power2.out",
          scrollTrigger: { trigger: cifra, start: "top 85%", once: true },
          onUpdate: () => {
            cifra.textContent = Math.round(valor.v).toLocaleString("es-PE");
          },
        });
      });
      return () => mm.revert();
    },
    { scope: raiz },
  );

  return (
    <section ref={raiz} aria-labelledby="escala-titulo" className="relative overflow-hidden bg-ink text-paper">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 top-24 h-[30rem] w-[30rem] rounded-full bg-heroViolet/25 blur-[130px]" />
      </div>

      <div className="container-page relative max-w-[1400px] pb-20 pt-16 sm:pb-24 sm:pt-24">
        <h2 id="escala-titulo" className="font-serif text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl lg:text-8xl">
          Más de S/ {n(milMillones)} mil millones
        </h2>
        <p className="mt-5 max-w-[40ch] text-xl leading-snug text-paper/80 sm:text-2xl">
          en {n(publicados)} contratos públicos: obras, compras y servicios pagados con plata de todos.
        </p>
        {/* Sólo lo verificable: que se publican, que son miles y qué trae cada uno.
            Una frase como "nadie puede leerlos" sería una afirmación sin fuente. */}
        <p className="mt-6 max-w-[62ch] text-[15px] leading-relaxed text-paper/70 sm:text-base">
          El Estado los publica todos. Pero son miles, suman S/ {n(millones)} millones y cada uno trae bases, actas y
          adendas que alguien tendría que leer.
        </p>

        <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-center">
          <figure className="matriz">
            <svg
              viewBox={`0 0 ${COLUMNAS} ${filas}`}
              className="h-auto w-full"
              role="img"
              aria-label={`${n(publicados)} contratos en una matriz de ${n(puntos)} puntos. Los ${n(verdes)} puntos verdes son los ${n(leidos)} que Vigía leyó a fondo.`}
            >
              <defs>
                <pattern id="punto-contrato" width="1" height="1" patternUnits="userSpaceOnUse">
                  <circle cx="0.5" cy="0.5" r="0.3" fill="rgba(244,238,221,0.28)" />
                </pattern>
                <clipPath id="recorte-matriz">
                  <rect className="matriz-recorte" x="0" y="0" width={COLUMNAS} height={filas} />
                </clipPath>
              </defs>
              <rect
                x="0"
                y="0"
                width={COLUMNAS}
                height={filas}
                fill="url(#punto-contrato)"
                clipPath="url(#recorte-matriz)"
              />
              {Array.from({ length: verdes }, (_, i) => (
                <circle key={i} className="punto-leido" cx={i + 0.5} cy={0.5} r={0.42} fill="#2FA84C" />
              ))}
            </svg>
            <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-paper/70">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="h-2 w-2 rounded-full bg-paper/40" /> cada punto, {POR_PUNTO} contratos
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="h-2 w-2 rounded-full bg-heroGreen" /> leídos a fondo por Vigía
              </span>
            </figcaption>
          </figure>

          <div>
            <h3 className="text-lg font-semibold text-paper/85">¿Cuántos se leyeron a fondo?</h3>
            <p className="mt-2 font-serif text-7xl font-bold leading-none text-heroGreen sm:text-8xl">
              <span className="cifra-leidos">{n(leidos)}</span>
            </p>
            <p className="mt-4 max-w-[34ch] text-base leading-relaxed text-paper/75">
              De {n(publicados)} contratos, el {pct.toLocaleString("es-PE", { maximumFractionDigits: 2 })} %. Y de
              esos {n(leidos)},{" "}
              <strong className="font-semibold text-crimson-soft">{n(senalAlta)} salieron con señal de riesgo alto</strong>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
