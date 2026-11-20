import Link from "next/link";
import { ArrowRight, BadgeCheck, Bot, Gavel, Link2, ShieldQuestion, UserX } from "lucide-react";
import { IsotipoGobserva } from "@/components/gobserva/MarcaGobserva";
import { Ejemplo } from "@/components/licitaciones/portada/Maquetas";
import { fechaCorta } from "@/lib/gobserva-salud";

/**
 * «Pregúntale al asistente» en la portada de Salud (2026-11-20): a la izquierda qué hace y qué no hace; a la derecha una
 * maqueta del chat marcada «Ejemplo», con establecimientos genéricos (ningún nombre ni código real). El asistente de
 * verdad vive en /asistente. Server-safe.
 */
export function BloqueAsistenteSalud({ href, renipressAl, sancionesAl, className }: { href: string; renipressAl: string | null; sancionesAl: string | null; className?: string }) {
  const puntos = [
    { Icono: Link2, texto: "Responde con los registros oficiales y dice de dónde sale cada dato y a qué fecha." },
    { Icono: Gavel, texto: "No mezcla una sanción firme con una denuncia: te dice cuál es cuál." },
    { Icono: UserX, texto: "No da nombres de personas ni opina sobre un médico: te dice cómo verificarlo en su colegio." },
    { Icono: BadgeCheck, texto: "Gratis y sin cuenta, con un tope de preguntas al día por conexión." },
  ];
  return (
    <section id="asistente" aria-labelledby="asistente-t" className={className}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-14">
        <div className="min-w-0">
          <h2 id="asistente-t" className="text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] text-ink sm:text-vitrina">
            Pregúntale al asistente
          </h2>
          <p className="mt-4 max-w-[58ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">
            Escribe tu duda como se la contarías a alguien. El asistente busca en RENIPRESS, en el Registro de Sanciones de SUSALUD y en las normas
            de salud, y te contesta con lo que dicen.
          </p>
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
          <Link href={href} className="mt-6 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
            Abrir el asistente <ArrowRight size={15} aria-hidden />
          </Link>
        </div>

        <figure className="min-w-0 overflow-hidden rounded-2xl border border-line bg-paper shadow-caja">
          <figcaption className="flex items-center justify-between gap-3 border-b border-line bg-paperSoft px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-meta font-semibold text-inkSoft">
              <Bot size={15} aria-hidden className="shrink-0 text-granate" />
              <span className="truncate">Asistente de Gobserva Salud</span>
            </span>
            <Ejemplo />
          </figcaption>
          <div className="space-y-3 p-4 sm:p-5">
            <p className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-tr-md bg-granate px-3.5 py-2 text-dato font-medium leading-snug text-paper">
              Me van a operar de la vesícula en una clínica de Surco. ¿Cómo sé si puede hacer cirugías?
            </p>
            <div className="flex items-start gap-2.5">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-paper">
                <IsotipoGobserva tamano={17} />
              </span>
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-line bg-paperSoft px-3.5 py-3">
                <p className="text-dato leading-snug text-ink">Busqué en RENIPRESS. Estos tres calzan con lo que me cuentas, en Santiago de Surco:</p>
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                  {[
                    { titulo: "Una clínica de Surco", quien: "Con internamiento, activa", cifra: "II-1", nota: "Centro quirúrgico" },
                    { titulo: "Un centro médico de Surco", quien: "Sin internamiento, activo", cifra: "I-3", nota: "Sin centro quirúrgico" },
                    { titulo: "Un consultorio de Surco", quien: "Cierre temporal", cifra: "I-2", nota: "No está activo" },
                  ].map((f) => (
                    <li key={f.titulo} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-dato font-semibold leading-snug text-granate underline decoration-granate/40 underline-offset-2">{f.titulo}</span>
                        <span className="block text-meta text-inkSoft">{f.quien}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-dato font-bold text-ink">{f.cifra}</span>
                        <span className="block text-rotulo text-mute">{f.nota}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-dato leading-snug text-ink">
                  Sólo la primera tiene registrado un centro quirúrgico activo. Ninguna figura en el Registro de Sanciones de SUSALUD revisado el{" "}
                  {sancionesAl ? fechaCorta(sancionesAl) : "viernes"}. Pregunta también dónde se hará la operación y verifica al cirujano en el Colegio Médico.
                </p>
                <p className="mt-2 flex items-start gap-1.5 text-rotulo leading-snug text-mute">
                  <ShieldQuestion size={13} aria-hidden className="mt-px shrink-0" />
                  <span>
                    Fuentes: RENIPRESS (SUSALUD), al {renipressAl ? fechaCorta(renipressAl) : "último viernes"}, y Registro de Sanciones de SUSALUD.
                  </span>
                </p>
              </div>
            </div>
          </div>
        </figure>
      </div>
    </section>
  );
}
