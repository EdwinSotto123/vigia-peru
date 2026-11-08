import Link from "next/link";
import { ArrowRight, BadgeCheck, Bot, Coins, Download, Link2, MessageSquareText } from "lucide-react";
import { IsotipoGobserva } from "@/components/gobserva/MarcaGobserva";
import { Ejemplo } from "@/components/licitaciones/portada/Maquetas";
import { cn } from "@/lib/utils";

/**
 * «Pregúntale a tu asistente» en las portadas (2026-11-08): el asistente que viene dentro de la app con los planes de pago
 * (/app/asistente, components/gobserva/app/asistente). A la izquierda qué hace y cuánto usa; a la derecha una maqueta del
 * chat marcada «Ejemplo» (entidades genéricas, ningún aviso ni proceso real). Server-safe.
 */
export interface FilaEjemplo {
  titulo: string;
  quien: string;
  cifra: string;
  nota: string;
}

export function BloqueAsistente({
  id = "asistente",
  titulo,
  bajada,
  pregunta,
  respuesta,
  filas,
  creditos,
  descargas = false,
  planes,
  className,
}: {
  id?: string;
  titulo: string;
  bajada: string;
  /** La pregunta de ejemplo, como la escribiría alguien. */
  pregunta: string;
  /** La primera frase de la respuesta de ejemplo. */
  respuesta: string;
  filas: FilaEjemplo[];
  /** «300 créditos al mes con Alertas»: lo que trae el plan de entrada. */
  creditos: string;
  /** Licitaciones: la respuesta se baja en Word, PDF y Excel. */
  descargas?: boolean;
  /** La página de planes del producto. */
  planes: string;
  className?: string;
}) {
  const puntos = [
    { Icono: Link2, texto: "Responde con datos de hoy y el enlace oficial de cada uno: no inventa." },
    { Icono: BadgeCheck, texto: "Entiende lo que pides en tus palabras y te dice lo que conviene revisar." },
    descargas
      ? { Icono: Download, texto: "Cada respuesta se baja en Word, PDF o Excel, lista para tu equipo." }
      : { Icono: MessageSquareText, texto: "Sigue la conversación: pídele que filtre, compare o te explique un requisito." },
    { Icono: Coins, texto: `Viene con los planes de pago: ${creditos}. Una pregunta rápida usa 5.` },
  ];
  return (
    <section id={id} aria-labelledby={`${id}-t`} className={cn("scroll-mt-20", className)}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-14">
        <div className="min-w-0">
          <h2 id={`${id}-t`} className="text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] text-ink sm:text-vitrina">
            {titulo}
          </h2>
          <p className="mt-4 max-w-[58ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{bajada}</p>
          <ul className="mt-6 space-y-3">
            {puntos.map(({ Icono, texto }) => (
              <li key={texto} className="flex items-start gap-3 text-dato leading-relaxed text-ink">
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-granate-50 text-granate">
                  <Icono size={16} />
                </span>
                <span className="min-w-0 pt-1">{texto}</span>
              </li>
            ))}
          </ul>
          <Link href={planes} className="mt-6 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
            Ver los planes <ArrowRight size={15} aria-hidden />
          </Link>
        </div>

        <figure className="min-w-0 overflow-hidden rounded-2xl border border-line bg-paper shadow-caja">
          <figcaption className="flex items-center justify-between gap-3 border-b border-line bg-paperSoft px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-meta font-semibold text-inkSoft">
              <Bot size={15} aria-hidden className="shrink-0 text-granate" />
              <span className="truncate">Asistente</span>
            </span>
            <Ejemplo />
          </figcaption>
          <div className="space-y-3 p-4 sm:p-5">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-md bg-granate px-3.5 py-2 text-dato font-medium leading-snug text-paper">{pregunta}</p>
            <div className="flex items-start gap-2.5">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-paper">
                <IsotipoGobserva tamano={17} />
              </span>
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-line bg-paperSoft px-3.5 py-3">
                <p className="text-dato leading-snug text-ink">{respuesta}</p>
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                  {filas.map((f) => (
                    <li key={f.titulo} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-dato font-semibold leading-snug text-granate underline decoration-granate/40 underline-offset-2">{f.titulo}</span>
                        <span className="block text-meta text-inkSoft">{f.quien}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-display text-dato font-bold tabular-nums text-ink">{f.cifra}</span>
                        <span className="block text-rotulo text-mute">{f.nota}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {descargas && (
                  <p className="mt-3 flex flex-wrap gap-1.5">
                    {["Word", "PDF", "Excel"].map((x) => (
                      <span key={x} className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-0.5 text-rotulo font-semibold text-inkSoft">
                        <Download size={11} aria-hidden /> {x}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
            <p className="border-t border-line pt-2.5 text-meta text-mute">Usó 5 créditos.</p>
          </div>
        </figure>
      </div>
    </section>
  );
}
