import { rutaContrato } from "@/lib/rutas";
import Link from "next/link";
import { ArrowUpRight, Banknote, ExternalLink, Scale } from "lucide-react";
import type { CasoPortada } from "@/lib/landing";
import { Severidad } from "@/components/ui/Severidad";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "./EnlaceAccion";
import { oracion, plural } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";

/** Un caso de la portada con el nombre de su regla («Única oferta válida»), si se encontró su bandera. */
export type CasoConRegla = CasoPortada & { regla: string | null };

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
 * El orden de cada fila (2026-10-29, «texto y ya, nada de jerarquía»): antes el título
 * era la región y lo encontrado iba en un párrafo largo sin nombre. Ahora manda QUÉ se
 * encontró (la regla, con su severidad), después dónde, cuánto y cuándo como datos con
 * ícono, y el texto del análisis va aparte, en su recuadro, con la ley que cita.
 */

export function CasosReales({ casos }: { casos: CasoConRegla[] }) {
  if (casos.length === 0) return null;
  return (
    <section id="casos" aria-labelledby="casos-titulo" className="scroll-mt-16 border-t border-line bg-paperSoft py-20 sm:py-24">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-4">
          <div>
            <h2 id="casos-titulo" className="font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">
              Lo que ya encontró.
            </h2>
            <p className="mt-3 max-w-[58ch] text-pretty text-destacado leading-relaxed text-inkSoft">
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
            <li key={c.codigo} className="grid gap-x-10 gap-y-5 py-8 lg:grid-cols-[minmax(0,1fr)_12rem]">
              <article className="min-w-0" aria-labelledby={`caso-${c.codigo}`}>
                {/* Qué encontró: la severidad y el nombre de la regla. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Severidad bandera={c.severidad} />
                  {c.otrasSenales > 0 && (
                    <span className="text-meta text-mute">y {plural(c.otrasSenales, "señal más", "señales más")} en el mismo contrato</span>
                  )}
                </div>
                <h3 id={`caso-${c.codigo}`} className="mt-3 text-balance font-display text-seccion font-bold leading-tight text-ink">
                  {/* Sin región no se pone "Perú": rellenar un hueco con algo plausible es inventar. */}
                  {c.regla ?? (c.region ? `Una señal en ${c.region}` : "Una señal en el contrato")}
                </h3>

                {/* Dónde, cuánto y cuándo. */}
                <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-dato text-inkSoft">
                  <Dato tipo="entidad">{tituloNatural(c.entidad)}</Dato>
                  {c.region && <Dato tipo="lugar">{c.region}</Dato>}
                  {c.monto && (
                    <Dato icono={Banknote} nombre="Monto" mono>
                      {c.monto}
                    </Dato>
                  )}
                  {c.fecha && <Dato tipo="fecha">{c.fecha}</Dato>}
                </p>
                <p className="mt-2 line-clamp-2 max-w-[80ch] text-meta leading-relaxed text-mute">{oracion(c.objeto)}</p>

                {/* Lo que dejó escrito el análisis, con la ley que cita. */}
                <div className="mt-4 max-w-[78ch] rounded-2xl border border-line bg-paper px-4 py-3.5 sm:px-5">
                  <p className="text-dato leading-relaxed text-ink">{c.hallazgo}</p>
                  <p className="mt-2.5 flex items-start gap-2 border-t border-dashed border-line pt-2.5 text-meta leading-relaxed text-inkSoft">
                    <Scale size={14} className="mt-0.5 shrink-0 text-granate" aria-hidden />
                    {c.norma}
                  </p>
                </div>
              </article>

              {/* Comprobarlo */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:flex-col lg:items-start lg:pt-1">
                <Link
                  href={rutaContrato(c.convocatoria, "dictamen")}
                  className="inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline"
                >
                  Leer el análisis <ArrowUpRight size={14} aria-hidden />
                </Link>
                {c.fuenteUrl && (
                  <a
                    href={c.fuenteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 text-dato text-inkSoft underline-offset-4 hover:underline"
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
