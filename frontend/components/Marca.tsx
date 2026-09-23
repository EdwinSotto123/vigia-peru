import { cn } from "@/lib/utils";

/**
 * El nombre, escrito. Reemplaza al PNG del isotipo en el header y el pie.
 *
 * Por qué texto y no imagen:
 *  - El logotipo vivía como PNG de 512 px pasando por el optimizador de Next en
 *    cada tamaño nuevo. En cache fría —o sea, justo después de cada deploy— el
 *    thumbnail del header tardaba segundos en aparecer, y hasta entonces el
 *    sitio no tenía nombre. Un `<span>` no tiene cache fría.
 *  - En el pie, el PNG necesitaba una caja blanca detrás para no perderse sobre
 *    tinta. Esa caja se leía como una calcomanía pegada encima del footer, no
 *    como la firma del sitio.
 *  - Un texto se selecciona, se copia, lo lee un lector de pantalla sin
 *    depender de un `alt`, escala con el zoom del navegador y pesa cero.
 *
 * La barra lateral del dashboard ya escribía el nombre a mano con este mismo
 * tratamiento ("Vigía" + "Perú" en el acento). Esto lo vuelve un solo
 * componente en vez de cinco lugares que pueden divergir.
 *
 * El acento cambia con la superficie, igual que el resto de la paleta de este
 * producto: `heroViolet` (#4F3D96) da 2.2:1 sobre tinta y desaparece, así que
 * sobre oscuro el acento es `heroGreen`, que llega a 5.9:1 y es además el color
 * con el que ya hablan todas las secciones oscuras del sitio.
 */

const TAMANO = {
  sm: "text-[15px]",
  md: "text-[19px]",
  lg: "text-[26px]",
} as const;

const NOTA = {
  sm: "text-[8px]",
  md: "text-[9px]",
  lg: "text-[10px]",
} as const;

export function Marca({
  tono = "claro",
  tamano = "md",
  nota,
  className,
}: {
  tono?: "claro" | "oscuro";
  tamano?: keyof typeof TAMANO;
  /** Bajada opcional debajo del nombre, en versalitas. El pie la usa; el header no. */
  nota?: string;
  className?: string;
}) {
  const oscuro = tono === "oscuro";
  return (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span className={cn("font-serif font-bold tracking-tight", TAMANO[tamano], oscuro ? "text-paper" : "text-ink")}>
        Vigía <span className={oscuro ? "text-heroGreen" : "text-heroViolet"}>Perú</span>
      </span>
      {nota && (
        <span
          className={cn(
            "mt-1.5 font-medium uppercase tracking-[0.2em]",
            NOTA[tamano],
            oscuro ? "text-paper/60" : "text-mute",
          )}
        >
          {nota}
        </span>
      )}
    </span>
  );
}
