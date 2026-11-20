import Link from "next/link";
import { MessageCircleQuestion } from "lucide-react";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

/** La dirección del asistente con una pregunta ya escrita (`/asistente?pregunta=…`): la persona la revisa y la manda. */
export const rutaAsistente = (base: string, pregunta?: string) =>
  rutaEn(base, pregunta ? `/asistente?${new URLSearchParams({ pregunta: pregunta.slice(0, 600) })}` : "/asistente");

/**
 * La entrada al asistente desde una ficha: «Pregúntale al asistente» con la pregunta que se le haría, a la vista. Lleva
 * a /asistente con la pregunta escrita en el campo (no la manda sola: la persona decide). Server-safe.
 */
export function PreguntaRapida({ base, pregunta, className }: { base: string; pregunta: string; className?: string }) {
  return (
    <Link
      href={rutaAsistente(base, pregunta)}
      prefetch={false}
      className={cn(
        "group flex min-h-11 items-start gap-3 rounded-2xl border border-line bg-paper px-3.5 py-3 transition-colors duration-rapido hover:border-granate/50 hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
        className,
      )}
    >
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
        <MessageCircleQuestion size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-dato font-semibold text-ink group-hover:text-granate">Pregúntale al asistente</span>
        <span className="mt-0.5 block text-pretty text-meta leading-snug text-inkSoft">«{pregunta}»</span>
      </span>
    </Link>
  );
}
