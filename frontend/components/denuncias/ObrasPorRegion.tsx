import Link from "next/link";
import { numero, solesCompacto } from "@/lib/formato";
import type { ContratoZona } from "@/lib/contratos";

/**
 * Para contrastar lo que se ve con lo que se contrató: cuántos contratos de OBRAS hay publicados por región
 * (los mismos de /app/contratos). Sirve a quien ve una obra parada y quiere saber si hay contratos de obras en su
 * región. No dice que ninguna obra esté parada: es el registro oficial, región por región.
 *
 * Server component: recibe ya las zonas de la API (datos planos). La región es la sede de la entidad que contrata.
 * Todas las regiones con obras (antes, las 8 o 16 primeras), de la que más tiene a la que menos.
 */
export function ObrasPorRegion({ zonas }: { zonas: ContratoZona[] }) {
  const filas = [...zonas].filter((z) => z.total > 0).sort((a, b) => b.total - a.total);
  if (filas.length === 0) return null;
  const max = Math.max(1, ...filas.map((z) => z.total));
  return (
    <section aria-labelledby="obras-por-region" className="rounded-2xl border border-line bg-paper px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="obras-por-region" className="font-display text-[16px] font-bold text-ink">Contratos de obras publicados por región</h2>
        <Link href="/app/contratos?tipo=obras" className="text-[13px] font-semibold text-granate underline-offset-4 hover:underline">
          Ver los contratos
        </Link>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-mute">
        Antes de denunciar, mira qué obras hay contratadas en tu región. Es el registro oficial: no dice si una obra está parada.
      </p>
      <ol className="mt-3 space-y-2">
        {filas.map((z) => (
          <li key={z.ubigeo} className="flex items-center gap-3 py-0.5">
            <Link href={`/app/mapa?region=${z.ubigeo}`} className="w-28 shrink-0 truncate rounded text-[14px] font-semibold text-ink underline-offset-4 hover:text-granate hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate">
              {z.nombre}
            </Link>
            {/* La barra es un gráfico (SVG): su largo es el número de contratos de obras de la región. */}
            <svg className="h-2 min-w-0 flex-1" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label={`${numero(z.total)} contratos de obras en ${z.nombre}`}>
              <rect width="100" height="8" className="fill-paperDeep" />
              <rect width={Math.max(3, (z.total / max) * 100)} height="8" className="fill-granate" />
            </svg>
            <span className="w-24 shrink-0 text-right leading-tight">
              <span className="block font-mono text-[12.5px] tabular-nums text-ink">{numero(z.total)} {z.total === 1 ? "obra" : "obras"}</span>
              {z.montoPen != null && <span className="block font-mono text-[11.5px] tabular-nums text-mute">{solesCompacto(z.montoPen)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
