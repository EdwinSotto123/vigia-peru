import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { numeros } from "@/lib/licitaciones-app/paginas";
import { numero } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/**
 * La paginación de las listas de Salud: cuántos se ven de cuántos y los enlaces a cada página (en la URL: se comparte y el
 * botón Atrás vuelve). Cada enlace lleva al comienzo de la lista (`ancla`), también el de abajo. En el celular, anterior,
 * «2 de 16» y siguiente, de 44 px. Server-safe.
 */
export function Paginas({
  pagina,
  paginas,
  total,
  tamano,
  href,
  nombre,
  ancla = "resultados",
  className,
}: {
  pagina: number;
  paginas: number;
  total: number;
  tamano: number;
  href: (n: number) => string;
  /** «establecimientos», «sanciones». */
  nombre: string;
  ancla?: string;
  className?: string;
}) {
  const desde = total ? (pagina - 1) * tamano + 1 : 0;
  const hasta = Math.min(total, pagina * tamano);
  const ir = (n: number) => `${href(n)}#${ancla}`;
  const caja = "grid h-11 min-w-11 place-items-center rounded-xl px-2 text-meta font-semibold tabular-nums transition-colors duration-rapido sm:h-9 sm:min-w-9 sm:rounded-lg";
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <p className="text-meta text-inkSoft" aria-live="polite">
        Mostrando <b className="font-semibold tabular-nums text-ink">{numero(desde)}</b> a <b className="font-semibold tabular-nums text-ink">{numero(hasta)}</b> de{" "}
        <b className="font-semibold tabular-nums text-ink">{numero(total)}</b> {nombre}
      </p>
      {paginas > 1 && (
        <nav aria-label="Páginas" className="flex items-center gap-1">
          {pagina > 1 ? (
            <Link href={ir(pagina - 1)} prefetch={false} aria-label="Página anterior" className={cn(caja, "border border-line text-ink hover:bg-ink/[0.06]")}>
              <ChevronLeft size={16} aria-hidden />
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(caja, "border border-line text-mute opacity-50")}>
              <ChevronLeft size={16} aria-hidden />
              <span className="sr-only">Página anterior (no hay)</span>
            </span>
          )}
          <span className="px-2 text-meta font-semibold tabular-nums text-ink sm:hidden">
            {numero(pagina)} de {numero(paginas)}
          </span>
          <ul className="hidden items-center gap-1 sm:flex">
            {numeros(pagina, paginas).map((n, i) =>
              n === null ? (
                <li key={`h${i}`} aria-hidden className="px-1 text-meta text-mute">
                  …
                </li>
              ) : (
                <li key={n}>
                  <Link
                    href={ir(n)}
                    prefetch={false}
                    aria-current={n === pagina ? "page" : undefined}
                    aria-label={`Página ${n}`}
                    className={cn(caja, n === pagina ? "bg-granate text-paper" : "text-inkSoft hover:bg-ink/[0.06] hover:text-ink")}
                  >
                    {numero(n)}
                  </Link>
                </li>
              ),
            )}
          </ul>
          {pagina < paginas ? (
            <Link href={ir(pagina + 1)} prefetch={false} aria-label="Página siguiente" className={cn(caja, "border border-line text-ink hover:bg-ink/[0.06]")}>
              <ChevronRight size={16} aria-hidden />
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(caja, "border border-line text-mute opacity-50")}>
              <ChevronRight size={16} aria-hidden />
              <span className="sr-only">Página siguiente (no hay)</span>
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
