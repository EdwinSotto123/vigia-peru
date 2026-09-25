import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Seccion } from "@/components/patrones";

export interface PreguntaFAQ {
  /** El ancla de la pregunta: /preguntas#<slug>. Hay enlaces a ellas desde otras páginas. */
  slug: string;
  q: string;
  /** Nodo ya armado en el servidor (texto y enlaces). Nunca una función. */
  a: ReactNode;
}

export interface TemaFAQ {
  /** El ancla del tema es /preguntas#tema-<id>; no choca con el slug de una pregunta. */
  id: string;
  titulo: string;
  preguntas: PreguntaFAQ[];
}

/**
 * Un tema: su h2 (vía `Seccion`) y sus preguntas plegadas.
 *
 * Cada pregunta es un `<details>` nativo: se abre con Enter o Espacio sin JS, el
 * buscador del navegador encuentra el texto de las respuestas cerradas y el HTML
 * del servidor ya trae todo. Todas empiezan cerradas: la página se lee de un
 * vistazo y cada respuesta está a un clic (DESIGN_SYSTEM.md §10.7). Abrir la que
 * nombra el ancla lo hace `AbrirPorAncla`.
 *
 * Las preguntas no son títulos: el `<summary>` es un botón y un h3 adentro se
 * aplana para los lectores de pantalla. La jerarquía queda h1 (página) → h2 (tema).
 */
export function TemaPreguntas({ tema }: { tema: TemaFAQ }) {
  return (
    <Seccion id={`tema-${tema.id}`} titulo={tema.titulo}>
      {/* overflow-hidden: el fondo del hover no asoma por las esquinas redondeadas.
          El foco va por dentro del resumen (outline-offset negativo), así no se recorta. */}
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
        {tema.preguntas.map((p) => (
          <li key={p.slug}>
            <details id={p.slug} className="group/pregunta scroll-mt-20">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft focus-visible:[outline-offset:-2px] sm:px-5 [&::-webkit-details-marker]:hidden">
                <span className="font-display text-[16px] font-semibold leading-snug text-ink text-balance">{p.q}</span>
                <ChevronDown
                  size={20}
                  aria-hidden
                  className="shrink-0 text-mute transition-transform duration-normal ease-salida group-open/pregunta:rotate-180"
                />
              </summary>
              <div className="max-w-[68ch] px-4 pb-4 text-[15px] leading-relaxed text-inkSoft text-pretty sm:px-5">{p.a}</div>
            </details>
          </li>
        ))}
      </ul>
    </Seccion>
  );
}
