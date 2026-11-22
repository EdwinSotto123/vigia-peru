"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History, Hospital, Pill, Stethoscope, X } from "lucide-react";
import { rutaEn } from "@/lib/gobserva";
import { rutaFicha, rutaMedicamento, rutaMedico } from "@/lib/gobserva-salud";
import { anotarVisto, borrarVistos, quitarVisto, useVistos, type TipoVisto, type Visto } from "@/lib/salud-vistos";
import { cn } from "@/lib/utils";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { formaDe, grupoDeTexto } from "@/lib/salud-formas";

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
  return <Historial vistos={vistos} base={base} cabeza={cabeza} className={className} />;
}

/** El dibujo de lo visto: el lugar por su categoría, la doctora para un médico, la forma del medicamento. */
function spriteVisto(v: Visto): NombreSprite {
  if (v.tipo === "medico") return "doctora";
  if (v.tipo === "medicamento") return formaDe(grupoDeTexto(v.detalle)).sprite;
  const cat = (v.detalle ?? "").split(",")[0]?.trim() ?? "";
  return /^I{2,3}/.test(cat) ? "lugarHospital" : /^I-[1-4]/.test(cat) ? "lugarPosta" : "lugarConsultorio";
}

/** «Hoy», «Ayer» o «12 de noviembre»: el día de una visita, para agrupar el historial. */
function diaDe(en: number): string {
  const d = new Date(en);
  if (d.toDateString() === new Date().toDateString()) return "Hoy";
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return "Ayer";
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "long" });
}

const FILTROS: { clave: TipoVisto | "todo"; etiqueta: string }[] = [
  { clave: "todo", etiqueta: "Todo" },
  { clave: "establecimiento", etiqueta: "Clínicas" },
  { clave: "medico", etiqueta: "Médicos" },
  { clave: "medicamento", etiqueta: "Medicamentos" },
];

/**
 * Lo visto como historial (2026-11-22, el usuario: «mejora, dale historial»): agrupado por día (hoy, ayer, la fecha), en
 * casillas con el dibujo de cada cosa (el lugar, la doctora, la forma del medicamento), con un filtro por tipo y «Quitar»
 * en cada una. Antes era una lista de filas iguales.
 */
function Historial({ vistos, base, cabeza, className }: { vistos: Visto[]; base: string; cabeza: React.ReactNode; className?: string }) {
  const [tipo, setTipo] = useState<TipoVisto | "todo">("todo");
  const cuenta = (t: TipoVisto | "todo") => (t === "todo" ? vistos.length : vistos.filter((v) => v.tipo === t).length);
  const lista = tipo === "todo" ? vistos : vistos.filter((v) => v.tipo === tipo);
  const dias: { dia: string; vistos: Visto[] }[] = [];
  for (const v of lista) {
    const d = diaDe(v.en);
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.dia === d) ultimo.vistos.push(v);
    else dias.push({ dia: d, vistos: [v] });
  }
  return (
    <section aria-label="Lo que viste hace poco" className={className}>
      {cabeza}
      <div role="group" aria-label="Qué mostrar" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {FILTROS.filter((f) => f.clave === "todo" || cuenta(f.clave) > 0).map((f) => (
          <button
            key={f.clave}
            type="button"
            aria-pressed={tipo === f.clave}
            onClick={() => setTipo(f.clave)}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido sm:min-h-9",
              tipo === f.clave ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-granate/50 hover:bg-granate-50",
            )}
          >
            {f.etiqueta}
            <span className={cn("tabular-nums", tipo === f.clave ? "text-paper/80" : "text-mute")}>{cuenta(f.clave)}</span>
          </button>
        ))}
      </div>
      <ol className="mt-5 space-y-6">
        {dias.map((g) => (
          <li key={g.dia}>
            <h3 className="flex items-center gap-2 text-cuerpo font-bold text-ink">
              <span aria-hidden className="h-2 w-2 rounded-full bg-granate" />
              {g.dia}
              <span className="text-meta font-medium text-mute">{g.vistos.length}</span>
            </h3>
            <ul className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {g.vistos.map((v) => (
                <li key={`${v.tipo}-${v.ref}`} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-paper transition-colors duration-rapido hover:border-granate/50">
                  <span aria-hidden className="flex h-20 items-center justify-center border-b border-line bg-granate-50 p-3">
                    <Pixel nombre={spriteVisto(v)} escala={3} animado={false} acento="accion" className="max-h-full max-w-full" />
                  </span>
                  <Link
                    href={rutaEn(base, ruta(v))}
                    className="min-w-0 flex-1 px-3 pb-3 pt-2.5 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                  >
                    <span className="line-clamp-2 text-dato font-semibold leading-snug text-ink group-hover:text-granate">{v.nombre}</span>
                    {v.detalle && <span className="mt-0.5 block truncate text-rotulo text-inkSoft">{v.detalle}</span>}
                    <span className="mt-1 block text-rotulo text-mute">{hace(v.en)}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => quitarVisto(v.tipo, v.ref)}
                    aria-label={`Quitar ${v.nombre} de lo visto`}
                    className="absolute right-1.5 top-1.5 z-10 grid h-9 w-9 place-items-center rounded-full bg-paper/90 text-mute ring-1 ring-line transition-colors duration-rapido hover:text-ink"
                  >
                    <X size={15} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
