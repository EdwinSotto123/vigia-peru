"use client";

import { useRef } from "react";
import { gsap, SIN_REDUCIR, useGSAP } from "@/lib/gsap";
import { numero } from "@/lib/formato";

/**
 * El movimiento de la sección de aliados, y nada más: el contenido lo arma el
 * servidor y llega como `children`. Así los avatares, las insignias y los
 * enlaces se quedan en el servidor, y a este lado del límite no cruza ninguna
 * función.
 *
 * El orden de la escena es el de la frase que cuenta: se enciende el foco, sube
 * la placa de quien más financió, se dibuja la cadena y cada cifra cuenta
 * hasta su valor (una sola vez). Con movimiento reducido todo está en su lugar
 * desde el principio: los estados ocultos los pone GSAP, nunca el CSS.
 */
export function EscenaAliados({ children }: { children: React.ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(SIN_REDUCIR, () => {
        const foco = raiz.current!.querySelector(".foco");
        if (foco) {
          gsap
            .timeline({
              defaults: { ease: "none" },
              scrollTrigger: { trigger: foco, start: "top 92%", end: "top 38%", scrub: 0.6 },
            })
            .fromTo(".foco-luz", { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 1 }, 0)
            .fromTo(".foco-logo", { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.55, ease: "power2.out" }, 0.25)
            .fromTo(
              ".foco-nombre",
              { clipPath: "inset(0% 100% 0% 0%)" },
              { clipPath: "inset(0% 0% 0% 0%)", duration: 0.5, ease: "power2.out" },
              0.4,
            );
        }

        const cadena = raiz.current!.querySelector(".cadena");
        if (cadena) {
          gsap
            .timeline({
              defaults: { ease: "none" },
              scrollTrigger: { trigger: cadena, start: "top 85%", end: "center 55%", scrub: 0.6 },
            })
            .fromTo(".cadena-linea", { scaleX: 0 }, { scaleX: 1, duration: 1 }, 0)
            // Cada nodo aparece cuando la línea llega a su columna.
            .fromTo(".cadena-nodo", { scale: 0 }, { scale: 1, duration: 0.12, stagger: 0.25, ease: "back.out(3)" }, 0);
          raiz.current!.querySelectorAll<HTMLElement>(".cadena-cifra").forEach((el, i) => {
            const meta = Number(el.dataset.valor ?? 0);
            const valor = { v: 0 };
            gsap.to(valor, {
              v: meta,
              duration: 1.1,
              delay: i * 0.15,
              ease: "power2.out",
              scrollTrigger: { trigger: cadena, start: "top 80%", once: true },
              onStart: () => {
                el.textContent = "0";
              },
              onUpdate: () => {
                el.textContent = numero(valor.v);
              },
            });
          });
        }

        gsap.utils.toArray<HTMLElement>(".placa").forEach((placa, i) => {
          gsap.from(placa, {
            autoAlpha: 0,
            y: 28,
            duration: 0.6,
            delay: (i % 3) * 0.08,
            ease: "power2.out",
            scrollTrigger: { trigger: placa, start: "top 90%", once: true },
          });
        });
      });
      return () => mm.revert();
    },
    { scope: raiz },
  );

  return <div ref={raiz}>{children}</div>;
}
