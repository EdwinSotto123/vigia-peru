import Link from "next/link";
import { ArrowUpRight, ExternalLink, Scale } from "lucide-react";
import type { CasoPortada } from "@/lib/landing";
import { Severidad } from "@/components/ui/Severidad";
import { EnlaceAccion } from "./EnlaceAccion";

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
 *
 * La severidad va con `<Severidad>` (color + ícono + palabra): antes era una
 * píldora de color con la palabra y sin ícono, armada a mano acá.
 */

export function CasosReales({ casos }: { casos: CasoPortada[] }) {
  if (casos.length === 0) return null;
  return (
    <section id="casos" aria-labelledby="casos-titulo" className="scroll-mt-16 border-t border-line bg-paperSoft py-20 sm:py-24">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-4">
          <div>
            <h2 id="casos-titulo" className="font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
              Lo que ya encontró.
            </h2>
            <p className="mt-3 max-w-[58ch] text-pretty text-base leading-relaxed text-inkSoft">
              Contratos reales, tal como quedaron publicados. Señal alta quiere decir que hay indicios fuertes de
              que algo no se hizo como manda la ley; señal media, que hay algo inusual que conviene mirar. Ninguna
              es una acusación.
            </p>
          </div>
          <EnlaceAccion href="/app/hallazgos" variante="secundario">
            Ver todos los hallazgos
          </EnlaceAccion>
        </div>

        <ol className="mt-12 divide-y divide-line border-y border-line">
          {casos.map((c) => (
            <li key={c.codigo} className="grid gap-x-10 gap-y-4 py-8 lg:grid-cols-[14rem_minmax(0,1fr)_12rem]">
              {/* Dónde y cuánto */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 lg:block">
                {/* Sin región no se pone "Perú": rellenar un hueco con algo plausible es inventar. */}
                <p className={`font-display text-2xl font-bold ${c.region ? "text-ink" : "text-mute"}`}>
                  {c.region ?? "Región sin dato"}
                </p>
                {c.monto && <p className="font-mono text-[15px] tabular-nums text-ink lg:mt-2">{c.monto}</p>}
                {c.fecha && <p className="text-[13px] text-mute lg:mt-1">{c.fecha}</p>}
              </div>

              {/* Qué encontró */}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-inkSoft">{c.entidad}</p>
                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-mute">{c.objeto}</p>
                <p className="mt-3 max-w-[72ch] text-[16px] leading-relaxed text-ink">{c.hallazgo}</p>
                <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-inkSoft">
                  <Scale size={14} className="mt-0.5 shrink-0 text-granate" aria-hidden />
                  {c.norma}
                </p>
              </div>

              {/* Comprobarlo */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:flex-col lg:items-start">
                <Severidad bandera={c.severidad} />
                <Link
                  href={`/app/convocatoria/${encodeURIComponent(c.convocatoria)}`}
                  className="inline-flex min-h-[32px] items-center gap-1.5 text-[14px] font-semibold text-granate underline-offset-4 hover:underline"
                >
                  Leer el análisis <ArrowUpRight size={14} aria-hidden />
                </Link>
                {c.fuenteUrl && (
                  <a
                    href={c.fuenteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[32px] items-center gap-1.5 text-[14px] text-inkSoft underline-offset-4 hover:underline"
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
