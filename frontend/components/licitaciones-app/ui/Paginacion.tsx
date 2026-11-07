import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { numero } from "@/lib/formato";
import { numeros } from "@/lib/licitaciones-app/paginas";
import { cn } from "@/lib/utils";

/**
 * La paginación de una lista: cuántos se ven de cuántos y los enlaces a cada página (la página va en la URL, así el
 * botón Atrás vuelve a la anterior y un enlace se puede compartir). Las páginas lejanas se resumen con «…». En el
 * celular, sólo anterior, «2 de 16» y siguiente. Server-safe.
 */
export function Paginacion({
  pagina, paginas, total, tamano, href, nombre = "resultados",
}: {
  pagina: number;
  paginas: number;
  total: number;
  tamano: number;
  href: (n: number) => string;
  nombre?: string;
}) {
  const desde = total ? (pagina - 1) * tamano + 1 : 0;
  const hasta = Math.min(total, pagina * tamano);
  return (
    <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-meta text-inkSoft" aria-live="polite">
        Mostrando <b className="font-semibold tabular-nums text-ink">{numero(desde)}</b> a <b className="font-semibold tabular-nums text-ink">{numero(hasta)}</b> de{" "}
        <b className="font-semibold tabular-nums text-ink">{numero(total)}</b> {nombre}
      </p>
      {paginas > 1 && (
        <nav aria-label="Páginas" className="flex items-center gap-1">
          <Paso href={pagina > 1 ? href(pagina - 1) : null} etiqueta="Página anterior">
            <ChevronLeft size={16} aria-hidden />
          </Paso>
          <span className="px-2 text-meta font-semibold tabular-nums text-ink sm:hidden">
            {pagina} de {paginas}
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
                    href={href(n)}
                    scroll={false}
                    aria-current={n === pagina ? "page" : undefined}
                    aria-label={`Página ${n}`}
                    className={cn(
                      "grid h-9 min-w-9 place-items-center rounded-lg px-2 text-meta font-semibold tabular-nums transition-colors duration-rapido",
                      n === pagina ? "bg-granate text-paper" : "text-inkSoft hover:bg-ink/[0.06] hover:text-ink",
                    )}
                  >
                    {n}
                  </Link>
                </li>
              ),
            )}
          </ul>
          <Paso href={pagina < paginas ? href(pagina + 1) : null} etiqueta="Página siguiente">
            <ChevronRight size={16} aria-hidden />
          </Paso>
        </nav>
      )}
    </div>
  );
}

function Paso({ href, etiqueta, children }: { href: string | null; etiqueta: string; children: React.ReactNode }) {
  const clase = "grid h-9 w-9 place-items-center rounded-lg border border-line transition-colors duration-rapido";
  if (!href) {
    return (
      <span aria-disabled="true" className={cn(clase, "text-mute opacity-50")}>
        {children}
        <span className="sr-only">{etiqueta} (no hay)</span>
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} aria-label={etiqueta} className={cn(clase, "text-ink hover:bg-ink/[0.06]")}>
      {children}
    </Link>
  );
}
