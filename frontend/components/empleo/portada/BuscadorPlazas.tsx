import { MapPin, Search } from "lucide-react";
import { REGIONES_EMPLEO, nombreRegion, slugRegion } from "@/lib/empleo";
import { cn } from "@/lib/utils";

/**
 * El buscador de la portada de Gobserva Empleo (2026-11-21): qué trabajo y dónde, y a /plazas con esos filtros. Un
 * formulario GET (funciona sin JavaScript; la búsqueda queda en la URL con los mismos nombres que usa /plazas: `q` y
 * `region` en slug). Va sobre la banda oscura del héroe: campos claros y el botón lima. Buscar no pide cuenta.
 * Server-safe.
 */
export function BuscadorPlazas({ accion, className }: { accion: string; className?: string }) {
  const regiones = [...REGIONES_EMPLEO].sort((a, b) => nombreRegion(a).localeCompare(nombreRegion(b), "es"));
  return (
    <form method="get" action={accion} role="search" aria-label="Buscar plazas del Estado" className={cn("grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]", className)}>
      <label className="relative min-w-0">
        <span className="sr-only">Qué trabajo buscas: un puesto, una carrera o una entidad</span>
        <Search size={19} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/55" />
        <input
          name="q"
          type="search"
          minLength={2}
          maxLength={80}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Contador, enfermera, abogado…"
          className="h-14 w-full rounded-2xl border border-paper/20 bg-paper pl-12 pr-4 text-destacado text-ink placeholder:text-ink/55 focus:outline-none focus:ring-4 focus:ring-maiz/40 [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <label className="relative min-w-0">
        <span className="sr-only">Dónde</span>
        <MapPin size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/55" />
        <select
          name="region"
          defaultValue=""
          className="h-14 w-full appearance-none rounded-2xl border border-paper/20 bg-paper pl-11 pr-9 text-destacado text-ink focus:outline-none focus:ring-4 focus:ring-maiz/40"
        >
          <option value="">Todo el Perú</option>
          {regiones.map((r) => (
            <option key={r} value={slugRegion(r)}>
              {nombreRegion(r)}
            </option>
          ))}
        </select>
        <svg aria-hidden viewBox="0 0 10 6" className="pointer-events-none absolute right-4 top-1/2 h-1.5 w-2.5 -translate-y-1/2 text-ink/60" shapeRendering="crispEdges">
          <path d="M0 0h2v2H0zM2 2h2v2H2zM4 4h2v2H4zM6 2h2v2H6zM8 0h2v2H8z" fill="currentColor" />
        </svg>
      </label>
      <button
        type="submit"
        className="inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-full bg-maiz px-7 text-cuerpo font-semibold text-sobreMaiz transition-colors duration-rapido hover:bg-maiz/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maiz focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
      >
        Buscar plazas
      </button>
    </form>
  );
}
