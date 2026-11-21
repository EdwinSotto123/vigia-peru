import { cn } from "@/lib/utils";

/**
 * La franja de puntos (identidad Píxel): una hilera de puntos del color de la marca y de tinta, como la trama del ojo.
 * Mantiene el nombre `FranjaTextil` y su API (la cabecera, el pie y varias portadas ya la importaban).
 *
 * Desde 2026-11-21 los puntos los dibuja `.franja-textil` (globals.css) con los tokens: el color de la marca
 * (--marca-acento: añil en Vigía, el de cada producto) y el texto de marca de cada modo. Antes era una baldosa SVG con el lima fijo.
 *
 * Reglas: 4 px en la cabecera (la firma del sitio); una franja más por pantalla como
 * mucho; nunca detrás de texto, en tablas, formularios ni informes. Decorativa.
 */
const ALTOS = { 4: "h-1", 8: "h-2", 12: "h-3", 16: "h-4" } as const;

export function FranjaTextil({ alto = 8, className }: { alto?: keyof typeof ALTOS; className?: string }) {
  // El alto también como `font-size`: la baldosa de .franja-textil se mide en `em`.
  return <div aria-hidden className={cn("franja-textil w-full bg-repeat-x", ALTOS[alto], className)} style={{ fontSize: alto }} />;
}

/**
 * La bandera, en una línea: rojo-blanco-rojo (DESIGN_SYSTEM.md §3.5). Sólo en el
 * pie y en el sello "Hecho en Perú". El rojo Perú no se usa en ningún otro lugar:
 * en este producto el rojo significa riesgo.
 */
export function FranjaBandera({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex h-[3px] w-9 overflow-hidden rounded-full ring-1 ring-line", className)}>
      <span className="flex-1 bg-rojoPeru" />
      <span className="flex-1 bg-paper" />
      <span className="flex-1 bg-rojoPeru" />
    </span>
  );
}
