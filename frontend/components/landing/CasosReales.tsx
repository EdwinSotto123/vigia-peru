import Link from "next/link";
import { ArrowRight, ArrowUpRight, ExternalLink, Scale } from "lucide-react";
import type { CasoPortada } from "@/lib/landing";

/**
 * Lo que ya encontró: casos de verdad, uno debajo del otro.
 *
 * Reemplaza al carrusel de "patrones ilustrativos" (casos inventados con su
 * rótulo de ilustrativos). Cada fila es un contrato que Vigía leyó, con la
 * señal que encontró escrita tal como la dejó el análisis, la ley que cita y el
 * enlace a la ficha oficial para comprobarlo.
 *
 * Filas, no tarjetas: lo que se lee acá es texto (el hallazgo), y una grilla de
 * tres cajas iguales lo cortaría en columnas angostas. La elección de casos es
 * determinista y conservadora (ver `elegirCasos` en `lib/landing.ts`).
 */

const SEVERIDAD = {
  alta: { t: "Señal alta", clase: "bg-crimson-soft text-crimsonTexto" },
  media: { t: "Señal media", clase: "bg-amber-soft text-amberTexto" },
  baja: { t: "Señal baja", clase: "bg-paperDeep text-inkSoft" },
} as const;

export function CasosReales({ casos }: { casos: CasoPortada[] }) {
  if (casos.length === 0) return null;
  return (
    <section id="casos" aria-labelledby="casos-titulo" className="scroll-mt-16 border-t border-line bg-paperSoft py-20 sm:py-24">
      <div className="container-page max-w-[1400px]">
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-4">
          <div>
            <h2 id="casos-titulo" className="font-serif text-4xl font-bold leading-tight text-ink sm:text-5xl">
              Lo que ya encontró.
            </h2>
            <p className="mt-3 max-w-[58ch] text-base leading-relaxed text-inkSoft">
              Contratos reales, tal como quedaron publicados. Son señales para revisar con calma, no acusaciones.
            </p>
          </div>
          <Link
            href="/app/hallazgos"
            className="group inline-flex items-center gap-2 rounded-full border border-line bg-paper px-5 py-3 text-[15px] font-semibold text-ink shadow-card transition-transform duration-rapido hover:-translate-y-0.5"
          >
            Ver todos los hallazgos
            <ArrowRight size={16} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>

        <ol className="mt-12 divide-y divide-line border-y border-line">
          {casos.map((c) => (
            <li key={c.codigo} className="grid gap-x-10 gap-y-4 py-8 lg:grid-cols-[14rem_minmax(0,1fr)_12rem]">
              {/* Dónde y cuánto */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 lg:block">
                <p className="font-serif text-2xl font-bold text-ink">{c.region ?? "Perú"}</p>
                {c.monto && <p className="font-mono text-[15px] text-ink lg:mt-2">{c.monto}</p>}
                {c.fecha && <p className="text-[13px] text-mute lg:mt-1">{c.fecha}</p>}
              </div>

              {/* Qué encontró */}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-inkSoft">{c.entidad}</p>
                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-mute">{c.objeto}</p>
                <p className="mt-3 max-w-[72ch] text-[16px] leading-relaxed text-ink">{c.hallazgo}</p>
                <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-inkSoft">
                  <Scale size={14} className="mt-0.5 shrink-0 text-heroViolet" aria-hidden />
                  {c.norma}
                </p>
              </div>

              {/* Comprobarlo */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:flex-col lg:items-start">
                <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${SEVERIDAD[c.severidad].clase}`}>
                  {SEVERIDAD[c.severidad].t}
                </span>
                <Link
                  href={`/app/convocatoria/${encodeURIComponent(c.convocatoria)}`}
                  className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-heroViolet underline-offset-4 hover:underline"
                >
                  Leer el análisis <ArrowUpRight size={14} aria-hidden />
                </Link>
                {c.fuenteUrl && (
                  <a
                    href={c.fuenteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[14px] text-inkSoft underline-offset-4 hover:underline"
                  >
                    Ficha oficial <ExternalLink size={13} aria-hidden />
                    <span className="sr-only">(se abre en una pestaña nueva)</span>
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
