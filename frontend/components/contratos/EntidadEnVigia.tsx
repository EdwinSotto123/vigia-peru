import Link from "next/link";
import { numero } from "@/lib/formato";

/**
 * "Esta entidad en Vigía": cuatro cifras reales de la entidad que contrata (publicados, leídos, de riesgo medio o alto
 * y esperando lectura), una por renglón, con el enlace a su ficha. Sale de /contratos/resumen?entidad=. Server-safe.
 */
export function EntidadEnVigia({
  ruc,
  total,
  leidos,
  conSenales,
  esperando,
}: {
  ruc: string;
  total: number;
  leidos: number;
  conSenales: number;
  esperando: number;
}) {
  const filas: [string, number][] = [
    ["contratos publicados", total],
    ["ya leídos", leidos],
    ["de riesgo medio o alto", conSenales],
    ["esperando lectura", esperando],
  ];
  return (
    <section aria-labelledby="entidad-en-vigia" className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="entidad-en-vigia" className="text-[13px] font-semibold text-ink">
          Esta entidad en Vigía
        </h2>
        <Link
          href={`/entidad/${ruc}`}
          className="text-[13px] font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          Ver su ficha
        </Link>
      </div>
      <dl className="divide-y divide-line text-[13px]">
        {filas.map(([etiqueta, n]) => (
          <div key={etiqueta} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-inkSoft">{etiqueta}</dt>
            <dd className="font-mono font-semibold tabular-nums text-ink">{numero(n)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
