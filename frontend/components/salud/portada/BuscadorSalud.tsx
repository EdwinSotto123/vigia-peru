import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El buscador de Gobserva Salud: un formulario GET a /buscar (funciona sin JavaScript y la búsqueda queda en la URL).
 * Un solo campo para todo: el nombre de un establecimiento, su código IPRESS, su RUC o un número de colegiatura.
 * `oscuro`: sobre la banda del héroe (campo claro, botón lima). Server-safe.
 */
export function BuscadorSalud({
  accion,
  q = "",
  oscuro = false,
  id = "buscar-salud",
  autoFocus = false,
  className,
}: {
  /** La ruta de /buscar con la base del producto. */
  accion: string;
  q?: string;
  oscuro?: boolean;
  id?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <form method="get" action={accion} role="search" aria-label="Verificar un establecimiento o un médico" className={cn("flex flex-col gap-2 sm:flex-row", className)}>
      <label htmlFor={id} className="relative min-w-0 flex-1">
        <span className="sr-only">Nombre del establecimiento, código IPRESS, RUC o número de colegiatura</span>
        <Search size={19} aria-hidden className={cn("pointer-events-none absolute left-4 top-1/2 -translate-y-1/2", oscuro ? "text-ink/55" : "text-mute")} />
        <input
          id={id}
          name="q"
          type="search"
          defaultValue={q}
          required
          minLength={2}
          maxLength={120}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Clínica, hospital, colegiatura o medicamento"
          className={cn(
            "h-14 w-full rounded-2xl border pl-12 pr-4 text-destacado text-ink placeholder:text-mute focus:outline-none [&::-webkit-search-cancel-button]:hidden",
            oscuro
              ? "border-paper/20 bg-paper placeholder:text-ink/55 focus:ring-4 focus:ring-maiz/40"
              : "border-line bg-caja focus:border-granate focus:ring-2 focus:ring-granate/30",
          )}
        />
      </label>
      <button
        type="submit"
        className={cn(
          "inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-full px-7 text-cuerpo font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          oscuro ? "bg-maiz text-sobreMaiz hover:bg-maiz/85 focus-visible:ring-maiz focus-visible:ring-offset-ink" : "bg-granate text-paper hover:bg-granate-deep focus-visible:ring-granate",
        )}
      >
        Verificar
      </button>
    </form>
  );
}
