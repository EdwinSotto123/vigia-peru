import { BellRing, CalendarClock, Sparkles } from "lucide-react";
import { IsotipoGobserva } from "@/components/gobserva/MarcaGobserva";
import { Ejemplo } from "@/components/licitaciones/portada/Maquetas";
import { cn } from "@/lib/utils";

/**
 * Lo memorable de la portada de Gobserva Empleo (2026-11-08): un celular a las 7:00 de la mañana al que le llegan, una tras
 * otra, las alertas de Gobserva Empleo. Es lo que el producto hace por quien busca trabajo: la plaza nueva que calza, la
 * que cierra mañana. Un solo movimiento al cargar (cada aviso entra después del anterior) y quieto después; con menos
 * movimiento, ya están todos. Todo es un EJEMPLO y lo dice: entidades genéricas, ningún aviso real. Server-safe.
 */
const AVISOS = [
  {
    Icono: Sparkles,
    titulo: "3 plazas nuevas para ti",
    texto: "Contador en una UGEL de Cusco, S/ 3,200 al mes. Cierra en 5 días.",
    cuando: "ahora",
  },
  {
    Icono: CalendarClock,
    titulo: "Mañana cierra una plaza que guardaste",
    texto: "Asistente administrativo en un hospital de Arequipa. Todavía estás a tiempo.",
    cuando: "7:00",
  },
  {
    Icono: BellRing,
    titulo: "Calza contigo: pide 1 año de experiencia",
    texto: "Técnico en archivo en una municipalidad de Lima, S/ 2,400 al mes.",
    cuando: "ayer",
  },
];

export function AvisosDeLaManana({ className }: { className?: string }) {
  return (
    <figure className={cn("relative mx-auto w-full max-w-[24rem]", className)}>
      <div className="relative rounded-[2.5rem] border border-paper/15 bg-paper/[0.05] p-3 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.6)]">
        <div className="relative overflow-hidden rounded-[2rem] border border-paper/10 bg-ink px-4 pb-6 pt-4">
          <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-30" />
          <div aria-hidden className="relative mx-auto h-1.5 w-20 rounded-full bg-paper/15" />
          <p className="relative mt-6 text-center font-display text-cartel font-bold leading-none tracking-[-0.03em] text-paper tabular-nums">7:00</p>
          <p className="relative mt-1 text-center text-meta text-paper/60">Lunes</p>
          <ol className="relative mt-6 space-y-2.5" aria-label="Avisos de ejemplo">
            {AVISOS.map(({ Icono, titulo, texto, cuando }, i) => (
              <li
                key={titulo}
                className="motion-safe:animate-fadeInUp rounded-2xl bg-paper p-3 text-ink shadow-pop"
                style={{ animationDelay: `${300 + i * 650}ms` }}
              >
                <p className="flex items-center justify-between gap-3 text-rotulo text-mute">
                  <span className="flex min-w-0 items-center gap-1.5 font-semibold text-inkSoft">
                    {/* El ícono de la app, como en una notificación de verdad: la lupa sobre su cuadro oscuro. */}
                    <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-ink">
                      <IsotipoGobserva tamano={14} />
                    </span>
                    <span className="truncate">Gobserva Empleo</span>
                  </span>
                  <span className="shrink-0">{cuando}</span>
                </p>
                <p className="mt-1.5 flex items-start gap-1.5 text-dato font-semibold leading-snug text-ink">
                  <Icono size={15} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                  {titulo}
                </p>
                <p className="mt-0.5 pl-[1.3rem] text-meta leading-snug text-inkSoft">{texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <figcaption className="mt-4 flex items-start justify-center gap-2 text-center text-meta leading-snug text-paper/70">
        <Ejemplo oscuro className="mt-px shrink-0" />
        Así te llegan las plazas: antes de que cierren.
      </figcaption>
    </figure>
  );
}
