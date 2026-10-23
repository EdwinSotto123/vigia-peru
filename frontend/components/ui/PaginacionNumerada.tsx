import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Paginación numerada para listas de 25 en 25: "Mostrando 1 a 25 de 101 partidos", anterior, 1 2 3 … 9, siguiente.
 * Sin scroll infinito: cada página es una URL (`?pagina=2`) que se comparte y que el botón atrás deshace.
 *
 * Server-safe: arma los enlaces ELLA MISMA a partir de datos planos (`hrefBase` + `query`), así que se puede
 * usar desde un server component sin pasarle funciones.
 */

/** Las páginas que se dibujan: la primera, la última y la actual con una vecina a cada lado; `null` es un salto. */
export function paginasVisibles(actual: number, ultima: number): (number | null)[] {
  const unicas = new Set<number>([1, ultima, actual - 1, actual, actual + 1].filter((n) => n >= 1 && n <= ultima));
  const orden = [...unicas].sort((a, b) => a - b);
  const salida: (number | null)[] = [];
  orden.forEach((n, i) => {
    if (i > 0 && n - orden[i - 1] > 1) salida.push(null);
    salida.push(n);
  });
  return salida;
}

const BASE =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border text-meta font-semibold tabular-nums transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:min-h-9 sm:min-w-9";

export function PaginacionNumerada({
  actual,
  total,
  tam,
  nombre,
  hrefBase,
  query,
  paramPagina = "pagina",
  className,
}: {
  actual: number;
  total: number;
  tam: number;
  /** Sustantivo plural: "partidos", "entidades". */
  nombre: string;
  hrefBase: string;
  query?: Record<string, string | undefined>;
  paramPagina?: string;
  className?: string;
}) {
  const ultima = Math.max(1, Math.ceil(total / tam));
  const pagina = Math.min(Math.max(1, Math.floor(actual) || 1), ultima);
  const desde = total === 0 ? 0 : (pagina - 1) * tam + 1;
  const hasta = Math.min(total, pagina * tam);
  const href = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v) p.set(k, v);
    if (n > 1) p.set(paramPagina, String(n));
    const qs = p.toString();
    return qs ? `${hrefBase}?${qs}` : hrefBase;
  };
  const f = (n: number) => n.toLocaleString("es-PE");
  return (
    <nav aria-label={`Páginas de ${nombre}`} className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}>
      <p className="text-meta text-inkSoft">
        {total === 0 ? (
          `0 ${nombre}`
        ) : (
          <>
            Mostrando <span className="font-semibold tabular-nums text-ink">{f(desde)} a {f(hasta)}</span> de{" "}
            <span className="font-semibold tabular-nums text-ink">{f(total)}</span> {nombre}
          </>
        )}
      </p>
      {ultima > 1 && (
        <ul className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link
              href={href(pagina - 1)}
              prefetch={false}
              scroll={false}
              aria-label="Página anterior"
              aria-disabled={pagina <= 1}
              tabIndex={pagina <= 1 ? -1 : undefined}
              className={cn(BASE, "border-line bg-paper text-ink hover:bg-paperDeep", pagina <= 1 && "pointer-events-none opacity-40")}
            >
              <ChevronLeft size={15} aria-hidden />
            </Link>
          </li>
          {paginasVisibles(pagina, ultima).map((n, i) =>
            n === null ? (
              <li key={`salto-${i}`} aria-hidden className="px-1 text-mute">
                …
              </li>
            ) : (
              <li key={n}>
                <Link
                  href={href(n)}
                  prefetch={false}
                  scroll={false}
                  aria-label={`Página ${n}`}
                  aria-current={n === pagina ? "page" : undefined}
                  className={cn(BASE, n === pagina ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:bg-paperDeep")}
                >
                  {n}
                </Link>
              </li>
            ),
          )}
          <li>
            <Link
              href={href(pagina + 1)}
              prefetch={false}
              scroll={false}
              aria-label="Página siguiente"
              aria-disabled={pagina >= ultima}
              tabIndex={pagina >= ultima ? -1 : undefined}
              className={cn(BASE, "border-line bg-paper text-ink hover:bg-paperDeep", pagina >= ultima && "pointer-events-none opacity-40")}
            >
              <ChevronRight size={15} aria-hidden />
            </Link>
          </li>
        </ul>
      )}
    </nav>
  );
}
