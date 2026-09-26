"use client";

import { useRef } from "react";
import { AlertTriangle, CalendarDays, ClipboardList, FileText, HardHat, Package, Wrench, type LucideIcon } from "lucide-react";
import { SIN_REDUCIR, useEscenaGsap } from "@/lib/gsap";
import { numero, porcentaje } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Ayuda } from "@/components/patrones";
import type { AnioEscala, TipoEscala } from "@/lib/landing";

/**
 * Lo que se ve del otro lado de la lupa: la escala del dinero público, y cuánto de eso
 * lee alguien. En dos filas, sin párrafos:
 *
 *   titular (el monto) + el total ········· las cajitas por tipo (cuántos y cuántos leídos)
 *   la matriz de puntos ··················· cuántos se leyeron a fondo
 *
 * Antes el total iba en una frase ("en 18,393 contratos públicos: obras, compras y
 * servicios…") y dos párrafos más; ahora el desglose ES el dibujo: una cajita por tipo,
 * con su número, su parte del total en una barra y sus leídos en maíz, el mismo color de
 * los puntos leídos de la matriz.
 *
 * Cada punto de la matriz son 20 contratos: 18 393 contratos son 920 puntos, y los 118
 * que Vigía leyó son seis. La matriz se construye con el scroll —la masa sin leer
 * primero, los puntos de maíz al final— porque el orden ES el argumento. Un solo
 * `<rect>` con un patrón de puntos, no 920 nodos.
 *
 * Animación (sólo sin movimiento reducido): las cajitas entran una tras otra, sus
 * números cuentan desde cero y sus barras crecen; nunca parten invisibles (atenuadas
 * al 25 %: un hueco en blanco se lee como "no cargó"). El HTML del servidor trae los
 * números finales: sin JS o con movimiento reducido se ve todo quieto y completo.
 *
 * Todas las cifras llegan por props desde el servidor, que las lee de la API. Si la API
 * no responde, esta sección no se dibuja: una portada que estima cuántos contratos
 * quedaron sin leer es exactamente el tipo de dato que este producto le reprocha al Estado.
 */

const POR_PUNTO = 20;
const COLUMNAS = 46;

const ICONO: Record<TipoEscala["clave"], LucideIcon> = {
  bienes: Package,
  servicios: Wrench,
  obras: HardHat,
  consultoria: ClipboardList,
  otros: FileText,
};

export function EscalaDinero({
  montoTotal,
  publicados,
  leidos,
  senalAlta,
  tipos,
  anio,
}: {
  /** Suma del monto de los contratos de las 25 regiones, en soles. */
  montoTotal: number;
  publicados: number;
  leidos: number;
  senalAlta: number;
  /** Las cajitas por tipo; suman `publicados`. Vacío si su lectura falló. */
  tipos: TipoEscala[];
  /** El año de la convocatoria, sólo si casi todo es de ese año. */
  anio: AnioEscala | null;
}) {
  const raiz = useRef<HTMLElement>(null);

  const puntos = Math.ceil(publicados / POR_PUNTO);
  const filas = Math.ceil(puntos / COLUMNAS);
  const puntosLeidos = Math.max(1, Math.round(leidos / POR_PUNTO));
  // El titular redondea hacia abajo ("más de"); el ⓘ no hace falta: el monto exacto no le cambia nada a nadie.
  const milMillones = Math.floor(montoTotal / 1e9);
  const pct = publicados > 0 ? (leidos / publicados) * 100 : 0;

  // Revelado liviano: GSAP llega después de `load`, en un momento ocioso, y nunca con
  // movimiento reducido. Hasta entonces las cifras se ven en su valor final.
  useEscenaGsap(
    raiz,
    SIN_REDUCIR,
    ({ gsap }) => {
      // La matriz: se construye con el scroll y termina cuando llega al centro de la pantalla.
      const matriz = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: ".matriz", start: "top 88%", end: "center 58%", scrub: 0.6 },
      });
      matriz
        .fromTo(".matriz-recorte", { attr: { width: 0 } }, { attr: { width: COLUMNAS }, duration: 0.72 })
        .fromTo(
          ".punto-leido",
          { scale: 0, transformOrigin: "50% 50%" },
          { scale: 1, duration: 0.18, stagger: 0.02, ease: "back.out(3)" },
          0.74,
        );

      // Cuenta hacia arriba cada número marcado con data-valor, dentro de una línea de tiempo.
      const contar = (tl: ReturnType<typeof gsap.timeline>, el: HTMLElement, en: number, duracion = 1.1) => {
        const fin = Number(el.dataset.valor ?? 0);
        const v = { v: 0 };
        el.textContent = "0";
        tl.to(v, { v: fin, duration: duracion, ease: "power2.out", onUpdate: () => (el.textContent = numero(v.v)) }, en);
      };

      // Las cajitas: entran una tras otra, cuentan y llenan su barra, una sola vez.
      // Sin cajitas (su lectura falló), el total cuenta solo, al entrar él.
      const cajitas = gsap.utils.toArray<HTMLElement>(".cajita");
      const total = raiz.current!.querySelector<HTMLElement>(".cuenta-total")!;
      const tl = gsap.timeline({ scrollTrigger: { trigger: cajitas.length ? ".cajitas" : total, start: "top 82%", once: true } });
      if (cajitas.length) {
        gsap.set(cajitas, { opacity: 0.25, y: 18 });
        gsap.set(".barra-tipo", { scaleX: 0, transformOrigin: "0 50%" });
        tl.to(cajitas, { opacity: 1, y: 0, duration: 0.5, stagger: 0.09, ease: "power2.out", clearProps: "opacity,transform" }, 0).to(
          ".barra-tipo",
          { scaleX: 1, duration: 0.9, stagger: 0.09, ease: "power3.out" },
          0.2,
        );
        gsap.utils.toArray<HTMLElement>(".cajita .cuenta").forEach((el, i) => contar(tl, el, 0.1 + i * 0.09));
      }
      contar(tl, total, 0, 1.4);

      // La cifra de leídos: la que la matriz acaba de mostrar, dicha en número.
      const cifra = raiz.current!.querySelector<HTMLElement>(".cifra-leidos")!;
      const leida = gsap.timeline({ scrollTrigger: { trigger: cifra, start: "top 85%", once: true } });
      contar(leida, cifra, 0, 1.2);
    },
    { diferido: true },
  );

  return (
    <section
      ref={raiz}
      data-tema="oscuro"
      aria-labelledby="escala-titulo"
      className="sobre-oscuro relative overflow-hidden bg-ink text-paper"
    >
      <div className="container-page relative pb-20 pt-16 sm:pb-24 sm:pt-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-14">
          <div>
            {anio && (
              <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-maiz/40 bg-maiz/10 px-3 py-1 text-[13px] font-semibold text-maiz">
                <CalendarDays size={14} aria-hidden />
                Convocatorias {anio.anio}
              </span>
            )}
            <h2 id="escala-titulo" className="text-balance font-display text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-7xl">
              Más de S/ {numero(milMillones)} mil millones
            </h2>
            <p className="mt-5 flex flex-wrap items-center gap-x-1.5 text-xl leading-snug text-paper/80 sm:text-2xl">
              <span>
                en{" "}
                <span className="cuenta-total font-semibold tabular-nums text-paper" data-valor={publicados}>
                  {numero(publicados)}
                </span>{" "}
                contratos públicos
              </span>
              <Ayuda titulo="¿De dónde salen estas cifras?" className="text-paper/60 hover:bg-paper/10 hover:text-maiz">
                <span className="block">Convocatorias publicadas en el SEACE que Vigía tiene en su base.</span>
                {anio && (
                  <span className="mt-2 block text-mute">
                    {numero(anio.enAnio)} de {numero(publicados)} se convocaron en {anio.anio}; el resto no tiene fecha de
                    convocatoria o es anterior.
                  </span>
                )}
              </Ayuda>
            </p>
          </div>

          {tipos.length > 0 && (
            <ul className="cajitas grid grid-cols-2 gap-2.5 sm:gap-3" aria-label="Contratos por tipo">
              {tipos.map((t) => (
                <Cajita key={t.clave} tipo={t} publicados={publicados} />
              ))}
            </ul>
          )}
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-center">
          <figure className="matriz">
            <svg
              viewBox={`0 0 ${COLUMNAS} ${filas}`}
              className="h-auto w-full text-paper/30"
              role="img"
              aria-label={`${numero(publicados)} contratos en una matriz de ${numero(puntos)} puntos. Los ${numero(puntosLeidos)} puntos dorados son los ${numero(leidos)} que Vigía leyó.`}
            >
              <defs>
                {/* `currentColor` hereda del <svg> (text-paper/30): el contenido de
                    un patrón toma el color de su lugar en el DOM. */}
                <pattern id="punto-contrato" width="1" height="1" patternUnits="userSpaceOnUse">
                  <circle cx="0.5" cy="0.5" r="0.3" fill="currentColor" />
                </pattern>
                <clipPath id="recorte-matriz">
                  <rect className="matriz-recorte" x="0" y="0" width={COLUMNAS} height={filas} />
                </clipPath>
              </defs>
              <rect x="0" y="0" width={COLUMNAS} height={filas} fill="url(#punto-contrato)" clipPath="url(#recorte-matriz)" />
              {Array.from({ length: puntosLeidos }, (_, i) => (
                <circle key={i} className="punto-leido fill-maiz" cx={i + 0.5} cy={0.5} r={0.42} />
              ))}
            </svg>
            <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-paper/75">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="h-2 w-2 rounded-full bg-paper/40" /> cada punto, {POR_PUNTO} contratos
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="h-2 w-2 rounded-full bg-maiz" /> leídos por Vigía
              </span>
            </figcaption>
          </figure>

          <div>
            <h3 className="text-lg font-semibold text-paper/85">¿Cuántos se leyeron a fondo?</h3>
            <p className="mt-2 font-display text-7xl font-extrabold leading-none tabular-nums text-maiz sm:text-8xl">
              <span className="cifra-leidos" data-valor={leidos}>
                {numero(leidos)}
              </span>
            </p>
            {/* Dos datos, dos pastillas: sin la frase que los encadenaba. */}
            <ul className="mt-5 flex flex-wrap gap-2 text-[14px]">
              <li className="rounded-full border border-paper/15 bg-paper/[0.05] px-3 py-1.5 text-paper/85">
                <span className="font-semibold tabular-nums text-paper">{porcentaje(pct, { decimales: 2 })}</span> de los publicados
              </li>
              {/* Peso del riesgo (§10.1): el tramo del puntaje. Tres canales: color, ícono y palabra. */}
              <li className="inline-flex items-center gap-1.5 rounded-full border border-crimson-soft/30 bg-crimson-soft/10 px-3 py-1.5 text-crimson-soft">
                <AlertTriangle size={14} aria-hidden />
                <span>
                  <span className="font-semibold tabular-nums">{numero(senalAlta)}</span> con riesgo alto
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Una cajita: el tipo, cuántos hay, su parte del total y cuántos leyó Vigía. */
function Cajita({ tipo: t, publicados }: { tipo: TipoEscala; publicados: number }) {
  const Icono = ICONO[t.clave];
  const parte = publicados > 0 ? (t.total / publicados) * 100 : 0;
  return (
    <li
      className={cn(
        "cajita min-w-0 rounded-2xl border border-paper/12 bg-paper/[0.04] p-4 sm:p-5",
        // "Convenios y otros" cierra la cuadrícula a lo ancho: con cinco cajitas no queda un hueco.
        t.clave === "otros" && "col-span-2",
      )}
    >
      <p className="flex items-center gap-2 text-[13px] font-medium text-paper/80 sm:text-[14px]">
        <Icono size={16} className="shrink-0 text-maiz/90" aria-hidden />
        <span className="truncate">{t.etiqueta}</span>
      </p>
      <p className="mt-2 font-display text-3xl font-extrabold leading-none tabular-nums sm:text-4xl">
        <span className="cuenta" data-valor={t.total}>
          {numero(t.total)}
        </span>
      </p>
      <div className="mt-3 flex items-center gap-2">
        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper/10" aria-hidden>
          <span className="barra-tipo block h-full rounded-full bg-paper/55" style={{ width: `${Math.max(1, parte)}%` }} />
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-paper/60">{porcentaje(parte)}</span>
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] sm:text-[13px]">
        {t.leidos == null ? (
          <span className="text-paper/60">Leídos: sin dato</span>
        ) : t.leidos > 0 ? (
          <>
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-maiz" />
            <span className="font-semibold tabular-nums text-maiz">{numero(t.leidos)}</span>
            <span className="text-paper/70">{t.leidos === 1 ? "leído por Vigía" : "leídos por Vigía"}</span>
          </>
        ) : (
          <span className="text-paper/60">Ninguno leído todavía</span>
        )}
      </p>
    </li>
  );
}
