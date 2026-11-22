import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { Carrusel } from "@/components/ui/Carrusel";
import { claseAccion } from "@/components/ui/EnlaceAccion";

export interface PasoCar {
  titulo: string;
  texto: ReactNode;
  sprite: NombreSprite;
  /** `externo`: una página oficial (otra pestaña). Si no, un enlace de esta misma página (una pestaña de abajo). */
  accion?: { href: string; etiqueta: string; externo?: boolean };
}

/**
 * Un trámite en pasos como tarjetas que se deslizan (Gobserva Car, como los pasos de /medico de Salud): número, dibujo,
 * qué hacer y el botón que lleva a hacerlo. En el celular, una tarjeta y media a la vista; en pantalla ancha, en fila.
 * Cada tarjeta es `relative` (los `sr-only` absolutos daban scroll horizontal en el celular).
 */
export function Recorrido({ pasos, etiqueta, className }: { pasos: PasoCar[]; etiqueta: string; className?: string }) {
  return (
    <Carrusel etiqueta={etiqueta} anchoTarjeta="w-[82%] sm:w-[17.5rem]" flechas="lateral" className={className}>
      {pasos.map((p, i) => (
        <article key={p.titulo} className="relative flex h-full flex-col rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-granate font-mono text-dato font-bold tabular-nums text-paper">
              {i + 1}
            </span>
            <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-xl bg-granate-50 p-1.5">
              <Pixel nombre={p.sprite} escala={3} animado={false} acento="accion" className="max-h-full max-w-full" />
            </span>
          </div>
          <h3 className="mt-3 text-balance text-cuerpo font-bold leading-snug text-ink">
            <span className="sr-only">Paso {i + 1}: </span>
            {p.titulo}
          </h3>
          <div className="mt-1.5 flex-1 text-pretty text-dato leading-relaxed text-inkSoft">{p.texto}</div>
          {p.accion &&
            (p.accion.externo ? (
              <a href={p.accion.href} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario", "mt-4 min-h-11 w-full")}>
                {p.accion.etiqueta}
                <ArrowUpRight size={15} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            ) : (
              <Link href={p.accion.href} prefetch={false} className={claseAccion("secundario", "mt-4 min-h-11 w-full")}>
                {p.accion.etiqueta}
                <ChevronDown size={15} aria-hidden />
              </Link>
            ))}
        </article>
      ))}
    </Carrusel>
  );
}
