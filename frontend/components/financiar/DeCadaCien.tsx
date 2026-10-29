import { Banknote, Construction, ExternalLink } from "lucide-react";
import { numero, oracion } from "@/lib/formato";
import { CONTRALORIA_CORRUPCION, DE_CADA_CIEN, DE_CADA_CIEN_SOLES } from "@/lib/costoCorrupcion";
import { cn } from "@/lib/utils";

/**
 * Lo que cuesta la corrupción, dibujado (pedido del 2026-10-29: «texto y ya, nada de jerarquía»): cien cuadros, uno por
 * cada sol de 100 del presupuesto, y encendidos los que se habrían llevado la corrupción y la inconducta funcional según
 * la Contraloría (12,7: doce enteros y el decimotercero a 70 %). Debajo, las dos cifras con su ícono y la fuente: antes
 * eran un párrafo con los números adentro. Cuadros y no puntos, para no confundirlos con los contratos de la portada.
 *
 * Va sobre una banda oscura (`sobre-oscuro`: /app/apoyar y la portada): encendidos en maíz, los demás en el tono del
 * texto con poca opacidad. `horizontal` pone los cuadros a la izquierda de las cifras desde sm. Server-safe.
 */
export function DeCadaCien({ horizontal = false, className }: { horizontal?: boolean; className?: string }) {
  const c = CONTRALORIA_CORRUPCION;
  const llenos = Math.floor(c.porCien);
  const parte = c.porCien - llenos;
  return (
    <figure className={cn("min-w-0", horizontal ? "grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-10" : "space-y-6", className)}>
      <div className="flex items-end gap-4">
        <div
          role="img"
          aria-label={`Según la Contraloría, ${DE_CADA_CIEN_SOLES} del presupuesto de ${c.anio} se habrían perdido por corrupción e inconducta funcional.`}
          className="grid w-fit shrink-0 grid-cols-10 gap-[3px]"
        >
          {Array.from({ length: 100 }, (_, i) => (
            <span key={i} className="relative h-3.5 w-3.5 overflow-hidden rounded-[3px] bg-paper/15 sm:h-4 sm:w-4">
              {i < llenos ? (
                <span className="absolute inset-0 bg-maiz" />
              ) : i === llenos && parte > 0 ? (
                <span className="absolute inset-y-0 left-0 bg-maiz" style={{ width: `${Math.round(parte * 100)}%` }} />
              ) : null}
            </span>
          ))}
        </div>
        {/* El rótulo directo de la figura en dos niveles: en uno solo, al lado de los cuadros, se partía en cinco renglones. */}
        <p aria-hidden className="pb-0.5">
          <span className="block font-display text-cifra font-bold leading-none text-maiz">
            {oracion(`${DE_CADA_CIEN.cerca ? `${DE_CADA_CIEN.cerca} ` : ""}${DE_CADA_CIEN.redondo}`)}
          </span>
          <span className="mt-1.5 block max-w-[10ch] text-meta leading-snug text-paper/75">de cada 100 soles</span>
        </p>
      </div>

      <div className="min-w-0 space-y-4">
        <ul className="space-y-3.5">
          <li className="flex gap-3">
            <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper/10 text-maiz">
              <Banknote size={17} />
            </span>
            <p className="min-w-0 text-meta leading-snug text-paper/75">
              <span className="block font-display text-destacado font-bold text-paper">S/{"\u00a0"}{numero(c.millones)} millones</span>
              se habrían perdido en {c.anio} por corrupción e inconducta funcional
            </p>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper/10 text-maiz">
              <Construction size={17} />
            </span>
            <p className="min-w-0 text-meta leading-snug text-paper/75">
              <span className="block font-display text-destacado font-bold text-paper">S/{"\u00a0"}{numero(c.inversionMillones)} millones</span>
              la tajada más grande, en la inversión: carreteras, hospitales y colegios
            </p>
          </li>
        </ul>
        <figcaption className="text-rotulo leading-snug text-paper/60">
          Estimación de la Contraloría General de la República.{" "}
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-maiz underline decoration-maiz/50 underline-offset-2 hover:decoration-maiz"
          >
            Ver la fuente
            <ExternalLink size={11} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </figcaption>
      </div>
    </figure>
  );
}
