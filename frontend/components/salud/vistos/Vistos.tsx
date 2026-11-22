"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History, Hospital, Pill, Stethoscope, X } from "lucide-react";
import { rutaEn } from "@/lib/gobserva";
import { rutaFicha, rutaMedicamento, rutaMedico } from "@/lib/gobserva-salud";
import { anotarVisto, borrarVistos, quitarVisto, useVistos, type TipoVisto, type Visto } from "@/lib/salud-vistos";
import { cn } from "@/lib/utils";

const ICONO: Record<TipoVisto, typeof Hospital> = { establecimiento: Hospital, medico: Stethoscope, medicamento: Pill };
const ruta = (v: Visto) => (v.tipo === "establecimiento" ? rutaFicha(v.ref) : v.tipo === "medico" ? rutaMedico(v.ref) : rutaMedicamento(v.ref));

/** Hace cuánto: «hace 5 min», «hoy», «ayer», «el 12 nov.». */
function hace(en: number): string {
  const min = Math.round((Date.now() - en) / 60_000);
  if (min < 60) return min <= 1 ? "recién" : `hace ${min} min`;
  const d = new Date(en);
  const hoy = new Date();
  const ayer = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === hoy.toDateString()) return "hoy";
  if (d.toDateString() === ayer.toDateString()) return "ayer";
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "short" });
}

/** Anota la ficha abierta en lo visto (sin dibujar nada). `codigo`, no `ref`: React se reserva `ref`. */
export function AnotarVisto({ tipo, codigo, nombre, detalle }: { tipo: TipoVisto; codigo: string; nombre: string; detalle?: string | null }) {
  useEffect(() => {
    anotarVisto({ tipo, ref: codigo, nombre, detalle });
  }, [tipo, codigo, nombre, detalle]);
  return null;
}

/**
 * «Lo que viste hace poco»: las últimas fichas abiertas en este dispositivo. `fila`: una fila que se desliza (la portada);
 * si no, la lista entera con «Quitar» (Guardados y vistos). Sin vistos no dibuja nada (o el vacío, en la lista).
 */
export function VistosRecientes({ base, fila = false, className }: { base: string; fila?: boolean; className?: string }) {
  const vistos = useVistos();
  const [, setTic] = useState(0);
  useEffect(() => {
    const h = window.setInterval(() => setTic((t) => t + 1), 60_000);
    return () => window.clearInterval(h);
  }, []);
  if (vistos === null) return null;
  if (!vistos.length) {
    if (fila) return null;
    return (
      <p className={cn("rounded-2xl border border-dashed border-line bg-paper px-5 py-4 text-dato text-inkSoft", className)}>
        Todavía no abriste ninguna ficha en este dispositivo. Las que abras aparecerán aquí para volver en un toque.
      </p>
    );
  }
  const cabeza = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
        <History size={18} aria-hidden className="text-granate" /> Lo que viste hace poco
      </h2>
      <p className="flex items-center gap-3 text-meta text-mute">
        Sólo en este dispositivo.
        <button type="button" onClick={borrarVistos} className="gs-hunde inline-flex min-h-11 items-center font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
          Borrar
        </button>
      </p>
    </div>
  );
  if (fila) {
    return (
      <section aria-label="Lo que viste hace poco" className={cn("gs-llegan", className)}>
        {cabeza}
        {vistos.length > 6 && (
          <Link href={rutaEn(base, "/cuenta")} className="mt-1 inline-flex min-h-11 items-center text-meta font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
            Ver los {vistos.length}
          </Link>
        )}
        <ul className="-mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 [&::-webkit-scrollbar]:hidden">
          {vistos.slice(0, 6).map((v) => {
            const Icono = ICONO[v.tipo];
            return (
              <li key={`${v.tipo}-${v.ref}`} className="w-64 shrink-0 sm:w-auto">
                <Link
                  href={rutaEn(base, ruta(v))}
                  className="gs-hunde group flex h-full items-start gap-3 rounded-2xl border border-line bg-paper p-3.5 hover:border-granate/50 hover:bg-granate-50/50"
                >
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
                    <Icono size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-dato font-semibold text-ink group-hover:underline group-hover:decoration-granate/50 group-hover:underline-offset-4">{v.nombre}</span>
                    <span className="block truncate text-meta text-mute">{[v.detalle, hace(v.en)].filter(Boolean).join(", ")}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
  return (
    <section aria-label="Lo que viste hace poco" className={className}>
      {cabeza}
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
        {vistos.map((v) => {
          const Icono = ICONO[v.tipo];
          return (
            <li key={`${v.tipo}-${v.ref}`} className="flex items-center gap-2 pr-2">
              <Link href={rutaEn(base, ruta(v))} className="group flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] sm:px-5">
                <Icono size={17} aria-hidden className="shrink-0 text-granate" />
                <span className="min-w-0">
                  <span className="block truncate text-dato font-semibold text-ink group-hover:underline group-hover:decoration-granate/50 group-hover:underline-offset-4">{v.nombre}</span>
                  <span className="block truncate text-meta text-mute">{[v.detalle, hace(v.en)].filter(Boolean).join(", ")}</span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => quitarVisto(v.tipo, v.ref)}
                aria-label={`Quitar ${v.nombre} de lo visto`}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-mute transition-colors duration-rapido hover:bg-ink/[0.06] hover:text-ink"
              >
                <X size={16} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
