"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, FileText, Scale, Search } from "lucide-react";
import { CON_MOVIMIENTO_ALTO, gsap, useGSAP } from "@/lib/gsap";
import type { CasoPortada } from "@/lib/landing";
import { Severidad } from "@/components/ui/Severidad";
import { plural } from "@/lib/formato";

/**
 * "Cómo funciona", contado con un contrato de verdad.
 *
 * La portada anterior explicaba el mecanismo con cuatro tarjetas genéricas y un
 * carrusel de "patrones ilustrativos": casos inventados, rotulados como
 * ilustrativos, en una herramienta que existe para que nadie invente nada. Acá
 * el ejemplo es uno de los contratos que Vigía ya leyó, tal como quedó
 * publicado: su entidad, su monto, lo que encontró y la norma que cita.
 *
 * La ficha se completa a medida que avanzan los pasos, porque así funciona el
 * producto: primero hay un contrato público; después, lo que Vigía encontró;
 * después, la ley que lo sustenta; al final, la fuente para comprobarlo. Cada
 * capa aparece cuando su paso se vuelve el activo — la animación es el orden del
 * razonamiento, no un adorno.
 *
 * Sin movimiento (o en pantalla angosta) la ficha se ve completa y los cuatro
 * pasos se leen como lista: el estado oculto lo pone GSAP, nunca el CSS.
 *
 * La ficha es papel sobre la sección oscura: adentro el foco vuelve a granate
 * (el maíz de `.sobre-oscuro` no se ve sobre blanco) y la severidad es la del
 * hallazgo, con sus tres canales. Antes la capa era roja aunque la señal fuera
 * media.
 */

const PASOS = [
  {
    Icono: FileText,
    t: "El Estado publica el contrato",
    d: "Queda en el SEACE con sus bases, sus actas y las ofertas de cada empresa que se presentó.",
  },
  {
    Icono: Search,
    t: "Vigía lo lee entero",
    d: "Revisa las ofertas, los plazos y los requisitos, y los cruza con registros oficiales del Estado.",
  },
  {
    Icono: Scale,
    t: "Cita la ley que aplica",
    d: "Cada hallazgo va con el artículo que lo sustenta. No depende de una opinión.",
  },
  {
    Icono: ExternalLink,
    t: "Te deja comprobarlo",
    d: "Es una señal para revisar, nunca una acusación. La ficha oficial está a un clic.",
  },
];

/** El fondo de la capa del hallazgo, según su severidad (DESIGN_SYSTEM.md §3.7). Nunca granate. */
const FONDO_HALLAZGO = { alta: "bg-crimson-soft", media: "bg-amber-soft", baja: "bg-paperDeep" } as const;

export function CasoLeido({ caso }: { caso: CasoPortada }) {
  const raiz = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(CON_MOVIMIENTO_ALTO, () => {
        const capas = gsap.utils.toArray<HTMLElement>(".capa");
        const pasos = gsap.utils.toArray<HTMLElement>(".paso");
        // Las capas no desaparecen: quedan desenfocadas, como un texto que todavía
        // no se leyó. Ocultas del todo dejaban media ficha en blanco, y un hueco
        // blanco se lee como "no cargó", no como "falta leer".
        gsap.set(capas, { opacity: 0.18, filter: "blur(6px)" });
        gsap.set(pasos.slice(1), { opacity: 0.55 });

        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: {
            trigger: ".caso-escena",
            start: "top 64px",
            end: "+=210%",
            pin: true,
            scrub: 0.6,
            anticipatePin: 1,
          },
        });
        capas.forEach((capa, i) => {
          const en = 0.2 + i * 0.26;
          tl.to(pasos[i], { opacity: 0.55, duration: 0.08 }, en)
            .to(pasos[i + 1], { opacity: 1, duration: 0.08 }, en)
            .to(capa, { opacity: 1, filter: "blur(0px)", duration: 0.12 }, en);
        });
        tl.to({}, { duration: 0.12 });
      });
      return () => mm.revert();
    },
    { scope: raiz },
  );

  return (
    <section
      ref={raiz}
      id="como"
      data-tema="oscuro"
      aria-labelledby="caso-titulo"
      className="sobre-oscuro relative scroll-mt-16 overflow-hidden border-t border-paper/10 bg-ink text-paper"
    >
      <div className="caso-escena container-page relative py-16 lg:flex lg:min-h-[calc(100dvh-4rem)] lg:flex-col lg:justify-center lg:py-10">
        <div className="max-w-3xl">
          <h2 id="caso-titulo" className="text-balance font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Así lee Vigía un contrato real.
          </h2>
          <p className="mt-3 max-w-[58ch] text-base leading-relaxed text-paper/75">
            Es uno de los contratos que ya leyó, tal como quedó publicado.
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start lg:gap-14">
          {/* ── La ficha del contrato ── */}
          <article className="rounded-2xl bg-paper p-5 text-ink shadow-dialog sm:p-7 [&_:focus-visible]:outline-granate">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <span className="text-[12px] font-medium text-mute">Contrato publicado en el SEACE</span>
              <span className="font-mono text-[12px] text-mute">{caso.convocatoria}</span>
            </div>
            <h3 className="mt-3 font-display text-lg font-bold leading-snug text-ink">{caso.entidad}</h3>
            <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-inkSoft">{caso.objeto}</p>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-[13px] sm:grid-cols-3">
              {caso.monto && <Dato t="Monto" v={caso.monto} mono />}
              {caso.region && <Dato t="Provincia" v={caso.region} />}
              {caso.fecha && <Dato t="Adjudicado" v={caso.fecha} />}
              {caso.proveedor && (
                <div className="col-span-2 sm:col-span-3">
                  <dt className="text-mute">Empresa ganadora</dt>
                  <dd className="mt-0.5 font-medium text-ink">{caso.proveedor}</dd>
                </div>
              )}
            </dl>

            {/* Capa 1: lo que encontró */}
            <div className={`capa mt-5 rounded-xl px-4 py-3.5 ${FONDO_HALLAZGO[caso.severidad]}`}>
              <p className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-ink">
                <Search size={13} aria-hidden /> Lo que encontró Vigía
                <Severidad bandera={caso.severidad} className="bg-paper" />
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink">{caso.hallazgo}</p>
            </div>

            {/* Capa 2: la norma */}
            <p className="capa mt-3 flex items-start gap-2 rounded-xl bg-granate-50 px-4 py-3 text-[13px] leading-relaxed text-ink">
              <Scale size={14} className="mt-0.5 shrink-0 text-granate" aria-hidden />
              <span>
                <span className="font-semibold text-granate">La norma que cita: </span>
                {caso.norma}
              </span>
            </p>

            {/* Capa 3: comprobarlo */}
            <div className="capa mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-[13px]">
              {caso.fuenteUrl && (
                <a
                  href={caso.fuenteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-granate underline-offset-2 hover:underline"
                >
                  Ver la ficha oficial <ExternalLink size={13} aria-hidden />
                  <span className="sr-only">(se abre en una pestaña nueva)</span>
                </a>
              )}
              <Link
                href={`/app/convocatoria/${encodeURIComponent(caso.convocatoria)}`}
                className="inline-flex items-center gap-1.5 font-medium text-ink underline-offset-2 hover:underline"
              >
                Leer el análisis completo <ArrowUpRight size={13} aria-hidden />
              </Link>
              {caso.otrasSenales > 0 && (
                <span className="text-mute">
                  Este contrato trae {plural(caso.otrasSenales, "señal más", "señales más")}.
                </span>
              )}
            </div>
          </article>

          {/* ── Los pasos ── Es una secuencia de verdad, por eso va numerada. */}
          <ol className="space-y-6 lg:pt-2">
            {PASOS.map(({ Icono, t, d }, i) => (
              <li key={t} className="paso flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-maiz/40 font-display text-sm font-bold tabular-nums text-maiz">
                  {i + 1}
                </span>
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-paper">
                    <Icono size={16} className="text-maiz" aria-hidden />
                    {t}
                  </h3>
                  <p className="mt-1 max-w-[42ch] text-[15px] leading-relaxed text-paper/75">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Dato({ t, v, mono = false }: { t: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-mute">{t}</dt>
      <dd className={`mt-0.5 font-medium text-ink ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
