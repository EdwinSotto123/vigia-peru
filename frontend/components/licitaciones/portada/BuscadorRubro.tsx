import { Search } from "lucide-react";
import { EscribeSolo } from "@/components/gobserva/portada/EscribeSolo";
import { cn } from "@/lib/utils";

const EJEMPLOS = ["Útiles de oficina", "Servicio de limpieza", "Combustible", "Alimentos", "Uniformes", "Mantenimiento de locales", "Agua potable"];

/**
 * El buscador del héroe de Licitaciones (2026-11-22): lo que vendes, y a Oportunidades con esa búsqueda (`q`, sin cuenta).
 * Un formulario GET que anda sin JavaScript; con él, el texto de ayuda escribe solo rubros reales hasta que lo tocas
 * (EscribeSolo). Va sobre la banda oscura del héroe: campo claro y botón maíz, como el de Empleo. Server-safe.
 */
export function BuscadorRubro({ accion, className }: { accion: string; className?: string }) {
  return (
    <form method="get" action={accion} role="search" aria-label="Buscar licitaciones por lo que vendes" className={cn("flex gap-2", className)}>
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Lo que vende tu empresa</span>
        <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/55" />
        <input
          id="buscar-rubro"
          name="q"
          type="search"
          minLength={2}
          maxLength={120}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Otro rubro: tóner, cemento…"
          className="h-12 w-full rounded-2xl border border-paper/20 bg-paper pl-11 pr-3 text-cuerpo text-ink placeholder:text-ink/55 focus:outline-none focus:ring-4 focus:ring-maiz/40 [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <button
        type="submit"
        className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-maiz px-5 text-dato font-semibold text-sobreMaiz transition-colors duration-rapido hover:bg-maiz/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maiz focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
      >
        Buscar
      </button>
      <EscribeSolo para="buscar-rubro" ejemplos={EJEMPLOS} prefijo="Otro rubro: " />
    </form>
  );
}
