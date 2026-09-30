import { cn } from "@/lib/utils";

/** Campo de texto del sistema (§5: inputs `rounded-xl`, hundidos en paperDeep). */
export const CAMPO = "mt-1 w-full rounded-xl border border-line bg-paperDeep px-3 py-2 text-sm text-ink placeholder:text-mute focus:border-granate";

/** El mismo campo, marcado con un error (el texto del error va debajo, no sólo el color). */
export const campo = (error?: string | null) => cn(CAMPO, error && "border-crimson focus:border-crimson");

/** Opción de un grupo de radio: la elegida en granate (selección), no en tinta. */
export const opcion = (activa: boolean) =>
  cn(
    "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors duration-rapido",
    activa ? "border-granate bg-granate-soft font-semibold text-granate" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
  );

/** Subtítulo dentro de una tarjeta: frase corta en caja normal, no un rótulo en mayúsculas. */
export const SUBTITULO = "text-xs font-semibold text-mute";

/** Etiqueta de un campo. */
export const ETIQUETA = "text-sm font-semibold text-inkSoft";
