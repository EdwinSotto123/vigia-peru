import { cn } from "@/lib/utils";
import { Isotipo } from "./Isotipo";

/**
 * La firma de Vigía (DESIGN_SYSTEM.md §2.2): el isotipo —la lupa tejida con la
 * llama— y el nombre en Montserrat, la geométrica del logotipo. En la cabecera, el
 * pie, el login y el 404.
 *
 * Por qué SVG + texto y no el PNG del logo:
 *  - El PNG de 512 px pasaba por el optimizador de Next en cada tamaño nuevo: en
 *    caché fría (justo después de cada deploy) la cabecera tardaba segundos en
 *    tener nombre. Un `<svg>` y un `<span>` no tienen caché fría.
 *  - Un texto se selecciona, se copia, lo lee un lector de pantalla sin depender
 *    de un `alt`, escala con el zoom del navegador y pesa cero.
 *
 * "Perú" lleva el acento de la superficie: granate sobre claro (10.99:1), maíz
 * sobre oscuro (9.61:1 sobre ink). `isotipo={false}` deja sólo el nombre.
 */

const TAMANO = {
  sm: { texto: "text-[15px]", iso: 26, nota: "text-[11px]" },
  md: { texto: "text-[19px]", iso: 32, nota: "text-[11px]" },
  lg: { texto: "text-[26px]", iso: 44, nota: "text-[12px]" },
} as const;

export function Marca({
  tono = "claro",
  tamano = "md",
  nota,
  isotipo = true,
  className,
}: {
  tono?: "claro" | "oscuro";
  tamano?: keyof typeof TAMANO;
  /** Bajada opcional debajo del nombre, en versalitas. El pie la usa; el header no. */
  nota?: string;
  isotipo?: boolean;
  className?: string;
}) {
  const oscuro = tono === "oscuro";
  const t = TAMANO[tamano];
  return (
    <span className={cn("inline-flex items-center gap-2.5 leading-none", className)}>
      {isotipo && <Isotipo tamano={t.iso} />}
      <span className="inline-flex flex-col">
        <span className={cn("font-display font-extrabold tracking-tight", t.texto, oscuro ? "text-paper" : "text-ink")}>
          Vigía <span className={oscuro ? "text-maiz" : "text-granate"}>Perú</span>
        </span>
        {nota && (
          <span className={cn("mt-1.5 font-medium uppercase tracking-[0.14em]", t.nota, oscuro ? "text-paper/75" : "text-mute")}>
            {nota}
          </span>
        )}
      </span>
    </span>
  );
}
