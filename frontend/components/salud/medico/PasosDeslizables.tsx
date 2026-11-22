import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { Carrusel } from "@/components/ui/Carrusel";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import type { PasoVerificar } from "@/lib/gobserva-salud";

/** El sitio de un paso, por su dirección, con su dibujo: el CMP, SUNEDU, este producto o ninguno (se hace en el paso anterior). */
function destino(url: string): { texto: string; externo: boolean; sprite: NombreSprite } {
  if (!url) return { texto: "", externo: false, sprite: "doctora" };
  if (url.startsWith("/")) return { texto: "Buscar el establecimiento", externo: false, sprite: "clinica" };
  if (/cmp\.org\.pe/i.test(url)) return { texto: "Abrir «Conoce a tu médico»", externo: true, sprite: "escudoCheck" };
  if (/sunedu/i.test(url)) return { texto: "Abrir el registro de SUNEDU", externo: true, sprite: "documento" };
  return { texto: "Abrir el sitio", externo: true, sprite: "chequeo" };
}

/**
 * Los pasos para verificar a un médico como tarjetas que se deslizan (2026-11-22, el usuario: «hazlo con forma… deslizantes»):
 * cada una con su número, su dibujo, lo que hay que hacer y el botón que lleva a hacerlo. En el celular, una tarjeta y
 * media a la vista; en pantalla ancha, las cuatro en fila. Las palabras son las de la API (pasosVerificarMedico).
 * Cada tarjeta es `relative`: sin eso, sus textos `sr-only` (absolutos) se ubicaban respecto del contenedor de afuera del
 * carrusel y daban 560 px de scroll horizontal a la página en el celular.
 */
export function PasosDeslizables({ pasos, base, className }: { pasos: PasoVerificar[]; base: string; className?: string }) {
  return (
    <Carrusel etiqueta="Pasos para verificar a un médico" anchoTarjeta="w-[82%] sm:w-[18.5rem]" flechas="lateral" className={className}>
      {pasos.map((p, i) => {
        const d = destino(p.url);
        return (
          <article key={p.paso} className="relative flex h-full flex-col rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-granate font-mono text-dato font-bold tabular-nums text-paper"
              >
                {i + 1}
              </span>
              <span aria-hidden className="grid h-16 w-16 place-items-center rounded-xl bg-paperSoft">
                <Pixel nombre={d.sprite} escala={3} animado={false} />
              </span>
            </div>
            <h3 className="mt-3 text-balance text-cuerpo font-bold leading-snug text-ink">
              <span className="sr-only">Paso {i + 1}: </span>
              {p.paso}
            </h3>
            <p className="mt-1.5 flex-1 text-pretty text-dato leading-relaxed text-inkSoft">{p.detalle}</p>
            {!p.url ? (
              <p className="mt-4 text-meta font-semibold text-mute">Se hace en la misma consulta del paso {i}.</p>
            ) : d.externo ? (
              <a href={p.url} target="_blank" rel="noopener noreferrer" className={claseAccion(i === 0 ? "primario" : "secundario", "mt-4 min-h-11 w-full")}>
                {d.texto}
                <ArrowUpRight size={15} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            ) : (
              <Link href={rutaEn(base, p.url)} prefetch={false} className={claseAccion("secundario", "mt-4 min-h-11 w-full")}>
                {d.texto}
                <ChevronRight size={15} aria-hidden />
              </Link>
            )}
          </article>
        );
      })}
    </Carrusel>
  );
}
