import Link from "next/link";
import type { ComponentProps } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Una acción que NAVEGA, con la forma de `Button` (DESIGN_SYSTEM.md §5 y §11.2):
 * píldora, verbo, granate la primaria. `Button` es un `<button>`; casi toda acción
 * de la vista pública es un enlace ("Financiar la lectura de Lima", "Ver mi
 * región"). Antes la portada y financiar tenían cada una su copia, con alturas,
 * sombras y focos distintos para el mismo gesto.
 *
 * Variantes, según la superficie:
 *  - `primario`: granate sobre claro (10.99:1). Una por pantalla.
 *  - `secundario`: borde sobre claro.
 *  - `fantasma`: sin superficie, dentro de tarjetas.
 *  - `oscuro`: papel con texto granate, sobre ink o granate-deep (`.sobre-oscuro`).
 *  - `contornoOscuro`: borde claro sobre oscuro. La acción secundaria ahí.
 *
 * Tamaños: `sm` (40 px) en el producto, `md` (48 px) y `lg` (52 px) en la portada.
 * Sin estado ni eventos: sirve igual en server y client components.
 */

const VARIANTE = {
  primario: "bg-granate text-paper hover:bg-granate-deep",
  secundario: "border border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
  fantasma: "text-ink hover:bg-paperDeep",
  oscuro: "bg-paper text-granate hover:bg-maiz-soft",
  contornoOscuro: "border border-paper/30 text-paper hover:bg-paper/10",
} as const;

const TAMANO = {
  sm: "min-h-[40px] px-5 py-2.5 text-sm",
  md: "min-h-[48px] px-6 py-3 text-[15px] motion-safe:hover:-translate-y-0.5",
  lg: "min-h-[52px] px-7 py-3.5 text-base motion-safe:hover:-translate-y-0.5",
} as const;

export type VarianteAccion = keyof typeof VARIANTE;
export type TamanoAccion = keyof typeof TAMANO;

/** Las clases de la acción, para cuando el elemento no es un `<Link>` (un `<a>` externo, un disparador). */
export function claseAccion(variante: VarianteAccion = "primario", className?: string, tamano: TamanoAccion = "sm"): string {
  return cn(
    "group inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-rapido ease-out active:translate-y-px",
    VARIANTE[variante],
    TAMANO[tamano],
    className,
  );
}

export function EnlaceAccion({
  variante = "primario",
  tamano = "sm",
  flecha = false,
  className,
  href,
  children,
  ...rest
}: ComponentProps<typeof Link> & {
  variante?: VarianteAccion;
  tamano?: TamanoAccion;
  /** La flecha dice "esto te lleva a otra página". Sin ella, un ancla o una acción en el lugar. */
  flecha?: boolean;
}) {
  const clases = claseAccion(variante, className, tamano);
  const contenido = (
    <>
      {children}
      {flecha && (
        <ArrowRight size={tamano === "lg" ? 18 : 16} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
      )}
    </>
  );
  // Un ancla de la misma página no pasa por el router.
  if (typeof href === "string" && href.startsWith("#")) {
    return (
      <a href={href} className={clases} {...(rest as ComponentProps<"a">)}>
        {contenido}
      </a>
    );
  }
  return (
    <Link href={href} className={clases} {...rest}>
      {contenido}
    </Link>
  );
}
